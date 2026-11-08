import assert from "node:assert/strict";
import { test } from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import { AdminRoleManagementService } from "../../src/auth/admin-role-management.service";
import { AdminRoleManagementError } from "../../src/auth/admin-role-management.problem";
import { createRequestFingerprint } from "../../src/participations/join-idempotency";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { userId: id(1), sessionId: id(2) }, targetId = id(3), grantId = id(4), eventId = id(5);
const at = "2026-11-06T12:00:00.123Z", expiresAt = new Date("2026-11-06T12:01:00Z");
const session = { revoked: false, expired: false, secondFactor: true };
const grantView = { id: grantId, userId: targetId, role: "staff" as const, eventId, grantedAt: at, revokedAt: null };
type Step = { match: RegExp; rows: Record<string, unknown>[] };
const step = (match: RegExp, ...rows: Record<string, unknown>[]): Step => ({ match, rows });
const sessionStep = () => step(/SELECT revoked_at IS NOT NULL/, session);
function authorization(): Step[] {
  return [step(/is_active AS active.*FOR SHARE/s, { active: true }), step(/FROM user_roles.*FOR SHARE/s, { id: id(6) }),
    step(/FROM sessions.*FOR SHARE/s, { id: actor.sessionId }), sessionStep(), step(/email_verified_at IS NOT NULL AS verified/, { verified: true })];
}

/** Double somente unitário: verifica decisões e chamadas. Rollback físico é coberto na suíte PostgreSQL. */
function fixture(steps: Step[], existing?: Record<string, unknown>) {
  const pending = [...steps], queries: string[] = [], transitions: string[] = [];
  const reservations: Record<string, unknown>[] = [], completions: Record<string, unknown>[] = [];
  const tx = {
    execute: async (statement: SQL) => {
      const query = new PgDialect().sqlToQuery(statement).sql; queries.push(query);
      const expected = pending.shift(); assert.ok(expected, `SQL inesperado: ${query}`); assert.match(query, expected.match);
      return { rows: expected.rows };
    },
    insert: () => ({ values: (value: Record<string, unknown>) => {
      reservations.push(value);
      return { onConflictDoNothing: () => ({ returning: async () => existing ? [] : [{ id: id(9) }] }) };
    } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => existing ? [existing] : [] }) }) }),
    update: () => ({ set: (value: Record<string, unknown>) => {
      completions.push(value);
      return { where: () => ({ returning: async () => [{ id: id(9), ...value }] }) };
    } }),
  } as unknown as DatabaseTransactionExecutor;
  const database = { transaction: async (work: (executor: DatabaseTransactionExecutor) => Promise<unknown>, config: unknown) => {
    assert.deepEqual(config, { isolationLevel: "read committed" }); transitions.push("begin");
    try { const value = await work(tx); transitions.push("commit"); return value; }
    catch (error) { transitions.push("rollback"); throw error; }
  } } as unknown as NodePgDatabase<typeof schema>;
  return { service: new AdminRoleManagementService(database), queries, reservations, completions, transitions,
    done: () => assert.equal(pending.length, 0, "Todas as revalidações previstas devem ocorrer.") };
}
const grantInput = { ...actor, body: { role: "staff" as const, email: "target@example.test", eventId }, idempotencyKey: "unit-key", expiresAt };
const revokeInput = { ...actor, grantId, idempotencyKey: "unit-revoke", expiresAt };
function grantPrefix(): Step[] { return [step(/FROM events.*FOR UPDATE/s, { id: eventId }), step(/pg_advisory_xact_lock/), ...authorization(), sessionStep()]; }
function revokePrefix(role = "staff"): Step[] {
  return [step(/SELECT user_id AS/, { userId: targetId, role, eventId: role === "staff" ? eventId : null }),
    ...(role === "staff" ? [step(/FROM events.*FOR UPDATE/s, { id: eventId })] : []),
    step(/pg_advisory_xact_lock/), ...authorization(), sessionStep()];
}
function grantRows(): Step[] { return [step(/lower\(btrim\(email\)\)/, { id: targetId, active: true, verified: true }), step(/FROM user_roles.*FOR UPDATE/s)]; }
function revokeTarget(role = "staff", revoked = false): Step[] {
  return [step(/FROM users.*FOR UPDATE/s, { active: true, verified: true }),
    step(/FROM user_roles.*FOR UPDATE/s, { id: grantId, userId: targetId, role, eventId: role === "staff" ? eventId : null, revoked })];
}
function denied(kind: string) { return (error: unknown) => error instanceof AdminRoleManagementError && error.kind === kind; }

test("T6.1-D serviço concede Staff com lock do evento, fingerprint e resposta idempotente mínima", async () => {
  const f = fixture([...grantPrefix(), ...grantRows(), step(/WITH decision.*admin_role_granted/s,
    { ...grantView, grantedAt: at, auditCount: 1 }), sessionStep()]);
  assert.deepEqual(await f.service.grant(grantInput), { grant: grantView }); f.done();
  assert.equal(f.reservations[0].actorUserId, actor.userId);
  assert.equal(f.reservations[0].requestHash, createRequestFingerprint("admin_grant_role", { role: "staff", email: grantInput.body.email, eventId }));
  assert.deepEqual(f.completions[0].resultPayload, { grant: grantView }); assert.equal(f.completions[0].httpStatus, 201);
  assert.deepEqual(f.transitions, ["begin", "commit"]);
});

test("T6.1-D serviço exige autorização persistida antes de reservar ou modificar papéis", async () => {
  const auth = authorization();
  for (const [index, rows, kind] of [
    [0, [{ active: false }], "account_inactive"], [1, [], "admin_required"], [2, [], "invalid_session"],
    [3, [{ ...session, revoked: true }], "session_revoked"], [3, [{ ...session, expired: true }], "session_expired"],
    [3, [{ ...session, secondFactor: false }], "admin_2fa_required"], [4, [{ verified: false }], "actor_email_unverified"],
  ] as const) {
    const prefix = auth.slice(0, index + 1).map(s => ({ ...s })); prefix[index] = { ...prefix[index], rows: [...rows] };
    const f = fixture([step(/FROM events.*FOR UPDATE/s, { id: eventId }), step(/pg_advisory_xact_lock/), ...prefix]);
    await assert.rejects(f.service.grant(grantInput), denied(kind)); f.done();
    assert.equal(f.reservations.length, 0); assert.equal(f.completions.length, 0); assert.deepEqual(f.transitions, ["begin", "rollback"]);
  }
});

test("T6.1-D serviço recusa destinatário ausente, inativo ou não verificado antes da escrita", async () => {
  for (const rows of [[], [{ id: targetId, active: false, verified: true }], [{ id: targetId, active: true, verified: false }]]) {
    const f = fixture([...grantPrefix(), { match: /lower\(btrim\(email\)\)/, rows }]);
    await assert.rejects(f.service.grant(grantInput), denied(rows.length ? "target_ineligible" : "target_not_found"));
    f.done(); assert.equal(f.completions.length, 0); assert.equal(f.queries.some(q => q.includes("admin_role_granted")), false);
  }
});

test("T6.1-D serviço recusa duplicidade sem executar concessão nem auditoria", async () => {
  const rows = grantRows(); rows[1] = step(/FROM user_roles.*FOR UPDATE/s, { id: grantId });
  const f = fixture([...grantPrefix(), ...rows]);
  await assert.rejects(f.service.grant(grantInput), denied("role_already_granted")); f.done(); assert.equal(f.completions.length, 0);
});

test("T6.1-D serviço reproduz concessão sem consultar ou alterar o destinatário novamente", async () => {
  const hash = createRequestFingerprint("admin_grant_role", { role: "staff", email: grantInput.body.email, eventId });
  const f = fixture(grantPrefix(), { id: id(9), requestHash: hash, status: "completed", httpStatus: 201,
    resultReference: grantId, resultPayload: { grant: grantView } });
  assert.deepEqual(await f.service.grant(grantInput), { grant: grantView }); f.done(); assert.equal(f.completions.length, 0);
});

test("T6.1-D serviço impede conflito e reserva em andamento sem efeitos de domínio", async () => {
  for (const conflict of [false, true]) {
    const f = fixture(grantPrefix(), { id: id(9), requestHash: conflict ? "0".repeat(64)
      : createRequestFingerprint("admin_grant_role", { role: "staff", email: grantInput.body.email, eventId }), status: "in_progress" });
    await assert.rejects(f.service.grant(grantInput), denied(conflict ? "request_conflict" : "in_progress")); f.done();
    assert.equal(f.completions.length, 0); assert.deepEqual(f.transitions, ["begin", "rollback"]);
  }
});

test("T6.1-D serviço revalida sessão após a escrita e propaga expiração para rollback", async () => {
  const f = fixture([...grantPrefix(), ...grantRows(), step(/admin_role_granted/, { ...grantView, auditCount: 1 }),
    step(/SELECT revoked_at IS NOT NULL/, { ...session, expired: true })]);
  await assert.rejects(f.service.grant(grantInput), denied("session_expired")); f.done();
  assert.equal(f.completions.length, 1); assert.deepEqual(f.transitions, ["begin", "rollback"]);
});

test("T6.1-D serviço revoga Staff logicamente e persiste somente resposta mínima", async () => {
  const f = fixture([...revokePrefix(), ...revokeTarget(), step(/FROM user_totp_credentials/), sessionStep(),
    step(/admin_role_revoked/, { ...grantView, revokedAt: at, auditCount: 1 }), step(/SELECT to_char\(granted_at/, { grantedAt: at }), sessionStep()]);
  const body = { grant: { ...grantView, revokedAt: at } };
  assert.deepEqual(await f.service.revoke(revokeInput), body); f.done();
  assert.equal(f.completions[0].httpStatus, 200); assert.deepEqual(f.completions[0].resultPayload, body);
  assert.equal(f.queries.some(q => /DELETE|UPDATE sessions/.test(q)), false);
});

test("T6.1-D serviço não repete revogação com chave nova nem audita concessão já revogada", async () => {
  const f = fixture([...revokePrefix(), ...revokeTarget("staff", true)]);
  await assert.rejects(f.service.revoke(revokeInput), denied("role_not_found")); f.done(); assert.equal(f.completions.length, 0);
});

test("T6.1-D serviço reproduz revogação com mesma chave sem segunda auditoria", async () => {
  const body = { grant: { ...grantView, revokedAt: at } };
  const f = fixture(revokePrefix(), { id: id(9), requestHash: createRequestFingerprint("admin_revoke_role", { grantId }),
    status: "completed", httpStatus: 200, resultReference: grantId, resultPayload: body });
  assert.deepEqual(await f.service.revoke(revokeInput), body); f.done(); assert.equal(f.completions.length, 0);
});

test("T6.1-D serviço bloqueia último Admin viável antes da revogação", async () => {
  const f = fixture([...revokePrefix("admin"), ...revokeTarget("admin"), step(/FROM user_totp_credentials/, { verified: true }),
    step(/SELECT count\(\*\)/, { count: 0 })]);
  await assert.rejects(f.service.revoke(revokeInput), denied("last_admin")); f.done(); assert.equal(f.completions.length, 0);
});

test("T6.1-D serviço permite revogação Admin quando outra autoridade viável permanece", async () => {
  const view = { ...grantView, role: "admin", eventId: null, revokedAt: at };
  const f = fixture([...revokePrefix("admin"), ...revokeTarget("admin"), step(/FROM user_totp_credentials/, { verified: true }),
    step(/SELECT count\(\*\)/, { count: 1 }), sessionStep(), step(/admin_role_revoked/, { ...view, auditCount: 1 }),
    step(/SELECT to_char\(granted_at/, { grantedAt: at }), sessionStep()]);
  assert.deepEqual(await f.service.revoke(revokeInput), { grant: view }); f.done(); assert.deepEqual(f.transitions, ["begin", "commit"]);
});
