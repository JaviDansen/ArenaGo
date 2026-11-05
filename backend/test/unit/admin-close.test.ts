import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { adminCloseBody } from "../../src/events/admin-close.dto";
import { AdminCloseService, closeFingerprint, ADMIN_CLOSE_OPERATION } from "../../src/events/admin-close.service";
import type { AdminCloseInput } from "../../src/events/admin-close.types";

const at = "2026-11-03T15:00:00.123456Z", deadline = "2026-11-03T15:30:00.000000Z";
const input: AdminCloseInput = { userId: "admin", sessionId: "session", eventId: "event", mode: "immediate", reason: "Interrupção autorizada", idempotencyKey: "intent", expiresAt: new Date("2099-01-01") };
const controlled: AdminCloseInput = { ...input, mode: "controlled", controlledUntilAt: "2026-11-03T15:30:00.000Z" };
const state = { eventId: input.eventId, status: "closed", closureMode: "immediate", newEntriesClosedAt: at, effectiveOperationalDeadlineAt: at, externalWaitingFinalized: 1 } as const;
function fixture(options: { absent?: boolean; active?: boolean; admin?: boolean; missingSession?: boolean; revoked?: boolean; secondFactor?: boolean; expiredAt?: number;
  reservation?: "replay" | "request_conflict" | "in_progress"; payload?: object | null; outcome?: string; invalidLinks?: boolean;
  fail?: string; wrongCount?: string } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [], marker = new Error("PRIVATE_E088_SQL"); let checks = 0;
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.includes("SELECT id FROM events")) return { rows: options.absent ? [] : [{ id: "event" }] };
    if (text.includes("SELECT id FROM experiences")) return { rows: [{ id: "experience" }] };
    if (text.includes('SELECT s.id,s.experience_id AS "experienceId"')) return { rows: [{ id: "station", experienceId: "experience" }] };
    if (text.includes('SELECT id,status,current_queue_entry_id')) return { rows: [
      { id: "outside", status: "waiting", currentId: null }, { id: "inside", status: "active", currentId: options.invalidLinks ? "bad" : "entry" },
      { id: "idle", status: "active", currentId: null }, { id: "history", status: "finished", currentId: null }] };
    if (text.includes('SELECT id,participation_id AS "personId"')) return { rows: [{ id: "entry", personId: "inside", experienceId: "experience", status: "called" }] };
    if (text.includes('SELECT s.id,s.queue_entry_id AS "entryId"')) return { rows: [{ id: "pending", entryId: "entry", experienceId: "experience", stationId: "station" }] };
    if (text.includes("FROM users WHERE")) return { rows: [{ active: options.active ?? true }] };
    if (text.includes("SELECT id FROM user_roles")) return { rows: options.admin === false ? [] : [{ id: "role" }] };
    if (text.includes("SELECT id FROM sessions")) return { rows: options.missingSession ? [] : [{ id: "session" }] };
    if (text.includes('AS "secondFactor"')) return { rows: [{ revoked: options.revoked ?? false, expired: ++checks >= (options.expiredAt ?? Infinity), secondFactor: options.secondFactor ?? true }] };
    if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation ? [] : [["reservation"]] };
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation", options.reservation === "request_conflict" ? "other" : closeFingerprint(input.eventId, { mode: "immediate", reason: input.reason }),
      options.reservation === "in_progress" ? "in_progress" : "completed", 200, input.eventId, options.payload === undefined ? state : options.payload]] };
    const phase = text.includes("WITH decision AS MATERIALIZED") ? "event" : text.includes("UPDATE service_sessions") ? "services" : text.includes("UPDATE queue_entries") ? "queues"
      : text.includes("WITH targets AS MATERIALIZED") ? "people" : text.includes("INSERT INTO audit_logs") ? "audit" : text.startsWith('update "idempotency_operations"') ? "complete" : undefined;
    if (options.fail === phase) throw marker;
    if (phase === "event") return { rows: [{ outcome: options.outcome ?? "changed", at, deadline: params.includes("controlled") ? deadline : at, before: { status: "open", operationalDeadlineAt: "2026-11-03T16:00:00Z" } }] };
    if (phase === "services" || phase === "queues" || phase === "audit") return { rows: options.wrongCount === phase ? [] : [{ id: "id" }] };
    if (phase === "people") return { rows: options.wrongCount === phase ? [] : params.includes("admin_immediate") ? [{ previousStatus: "waiting" }, { previousStatus: "active" }, { previousStatus: "active" }] : [{ previousStatus: "waiting" }] };
    if (phase === "complete") return { rows: [["reservation", 200, input.eventId, {}]] };
    throw new Error(`SQL inesperado: ${text}`);
  } } as unknown as Client, { schema });
  return { service: new AdminCloseService(database), queries, marker };
}
test("E08.8 DTO estrito valida modos, prazo somente controlado e reason normalizada", () => {
  assert.deepEqual(adminCloseBody.parse({ mode: "controlled", controlledUntilAt: "2026-11-03T12:30:00-03:00", reason: "  autorização  " }), { mode: "controlled", controlledUntilAt: controlled.controlledUntilAt, reason: "autorização" });
  for (const body of [{}, { mode: "bad", reason: "x" }, { mode: "controlled", reason: "x" }, { mode: "immediate", reason: "x", controlledUntilAt: deadline },
    { mode: "immediate", reason: " " }, { mode: "immediate", reason: "x".repeat(501) }, { mode: "immediate", reason: "x\u0000y" },
    { mode: "immediate", reason: "x", status: "closed" }, ...["bad", "2026-02-30T00:00:00Z", "2026-11-03T12:00:00", "2026-11-03T12:00:00.1234Z"].map(controlledUntilAt => ({ mode: "controlled", reason: "x", controlledUntilAt }))]) assert.equal(adminCloseBody.safeParse(body).success, false);
});
test("E08.8 imediato cancela pendências, fecha filas, finaliza pessoas e audita em um tx", async () => {
  const f = fixture(); assert.deepEqual(await f.service.closeEvent(input), { kind: "completed", ...state }); assert.equal(f.queries[0].text, "begin isolation level read committed"); assert.equal(f.queries.at(-1)?.text, "commit");
  const order = ["SELECT id FROM events", "SELECT id FROM experiences", 'SELECT s.id,s.experience_id', 'SELECT id,status,current_queue_entry_id', 'SELECT id,participation_id', 'SELECT s.id,s.queue_entry_id', "FROM users WHERE", "SELECT id FROM user_roles", "SELECT id FROM sessions", 'insert into "idempotency_operations"', "WITH decision", "UPDATE service_sessions", "UPDATE queue_entries", "WITH targets", "INSERT INTO audit_logs", 'update "idempotency_operations"'];
  for (let n = 1; n < order.length; n++) assert.ok(f.queries.findIndex(q => q.text.includes(order[n - 1])) < f.queries.findIndex(q => q.text.includes(order[n])), order[n]);
  for (const q of f.queries.filter(q => q.text.includes("ORDER BY"))) assert.match(q.text, /FOR (UPDATE|SHARE)/);
  for (const name of ["UPDATE service_sessions", "UPDATE queue_entries", "WITH targets"]) assert.ok(f.queries.find(q => q.text.includes(name))!.text.includes("LEAST(e.operational_deadline_at,e.admin_deadline_at)"));
  for (const name of ["UPDATE service_sessions", "UPDATE queue_entries", "WITH targets"]) assert.ok(f.queries.find(q => q.text.includes(name))!.text.includes("e.operational_deadline_at<=e.closure_requested_at"));
  assert.match(f.queries.find(q => q.text.includes("WITH targets"))!.text,/finished_at=CASE WHEN \$\d+::boolean\s+THEN LEAST\(e\.operational_deadline_at,e\.admin_deadline_at\) ELSE e\.closure_requested_at END/);
  assert.ok(f.queries.find(q => q.text.includes("INSERT INTO audit_logs"))!.text.includes("e.closure_requested_at"));
  const canceled = f.queries.find(q => q.text.includes("UPDATE service_sessions"))!; assert.match(canceled.text, /status='pending'/); assert.match(canceled.text, /status='canceled'/); assert.ok(canceled.params.includes("admin_immediate"));
  assert.equal(f.queries.some(q => /INSERT INTO evaluations|status='completed'|status='absent'/.test(q.text)), false);
});
test("E08.8 controlado finaliza somente waiting externa e preserva operação residual", async () => {
  const f = fixture(), r = await f.service.closeEvent(controlled); assert.deepEqual(r, { kind: "completed", ...state, status: "closing", closureMode: "controlled", effectiveOperationalDeadlineAt: deadline });
  const finish = f.queries.find(q => q.text.includes("WITH targets"))!;
  assert.match(finish.text,/THEN LEAST\(e\.operational_deadline_at,e\.admin_deadline_at\) ELSE e\.closure_requested_at END/);
  assert.ok(finish.params.includes(false)); assert.ok(finish.params.includes("admin_controlled_external_wait_closed"));
  assert.equal(f.queries.some(q => q.text.includes("UPDATE service_sessions") || q.text.includes("UPDATE queue_entries")), false);
  const p = f.queries.find(q => q.text.includes("WITH targets"))!; assert.ok(p.params.includes("admin_controlled_external_wait_closed")); assert.ok(p.params.includes(false));
  assert.equal(f.queries.some(q => /SET availability|SET queue_accepting_entries|last_queue_order=/.test(q.text)), false);
});
test("E08.8 instante decisivo e sessão condicionam UPDATE após todos os locks e reserva", async () => {
  const f = fixture(); await f.service.closeEvent(controlled); const q = f.queries.find(q => q.text.includes("WITH decision"))!.text;
  for (const part of ["clock_timestamp()", "d.at+interval '1 hour'", "<= d.at", "> e.operational_deadline_at", "e.closure_requested_at IS NOT NULL", "NOT p.closed AND NOT p.invalid", "p.at<a.expires_at", "a.admin_2fa_verified_at IS NOT NULL"]) assert.ok(q.includes(part), part);
  assert.equal(f.queries.filter(q => q.text.includes('AS "secondFactor"')).length, 5);
});
test("E08.8 fingerprint distingue evento, modo, prazo e motivo e normaliza fuso/trim", () => {
  assert.equal(ADMIN_CLOSE_OPERATION, "admin_close_event"); const body = { mode: "controlled", reason: "x", controlledUntilAt: controlled.controlledUntilAt } as const;
  const hash = closeFingerprint("event", body); assert.equal(hash, closeFingerprint("event", { ...body, reason: " x ", controlledUntilAt: "2026-11-03T12:30:00-03:00" }));
  for (const h of [closeFingerprint("other", body), closeFingerprint("event", { mode: "immediate", reason: "x" }), closeFingerprint("event", { ...body, reason: "y" }), closeFingerprint("event", { ...body, controlledUntilAt: "2026-11-03T15:31:00Z" })]) assert.notEqual(hash, h);
});
test("E08.8 replay autorizado retorna resposta original sem efeitos/auditoria/conclusão novos", async () => {
  const f = fixture({ reservation: "replay" }); assert.deepEqual(await f.service.closeEvent(input), { kind: "replay", ...state });
  assert.equal(f.queries.some(q => q.text.includes("WITH decision") || q.text.includes("UPDATE service_sessions") || q.text.includes("INSERT INTO audit_logs")), false); assert.equal(f.queries.at(-1)?.text, "rollback");
});
for (const [name, options, kind] of [
  ["evento ausente", { absent: true }, "resource_not_found"], ["conta inativa", { active: false }, "account_inactive"], ["Staff/Admin revogado", { admin: false }, "admin_required"],
  ["sessão ausente", { missingSession: true }, "invalid_session"], ["sessão revogada", { revoked: true }, "session_revoked"], ["2FA ausente", { secondFactor: false }, "admin_2fa_required"],
  ["expiração após locks", { expiredAt: 1 }, "session_expired"], ["expiração após reserva", { expiredAt: 2 }, "session_expired"], ["expiração na decisão", { expiredAt: 3 }, "session_expired"],
  ["expiração após auditoria", { expiredAt: 4 }, "session_expired"], ["expiração antes de commit", { expiredAt: 5 }, "session_expired"],
  ["encerramento iniciado/fechado", { outcome: "closed" }, "event_already_closed"], ["prazo inválido", { outcome: "invalid" }, "closure_deadline_invalid"],
  ["chave conflitante", { reservation: "request_conflict" }, "request_conflict"], ["intenção em andamento", { reservation: "in_progress" }, "in_progress"],
] as const) test(`E08.8 ${name} não confirma encerramento`, async () => {
  const f = fixture(options); assert.deepEqual(await f.service.closeEvent(input), { kind }); assert.equal(f.queries.at(-1)?.text, "rollback"); assert.equal(f.queries.some(q => q.text === "commit"), false);
});
test("E08.8 falhas em todas as escritas e contagens inconsistentes causam rollback", async () => {
  for (const fail of ["event", "services", "queues", "people", "audit", "complete"]) { const f = fixture({ fail }); await assert.rejects(f.service.closeEvent(input), e => e instanceof Error && e.cause === f.marker); assert.equal(f.queries.at(-1)?.text, "rollback"); }
  for (const wrongCount of ["services", "queues", "people", "audit"]) { const f = fixture({ wrongCount }); await assert.rejects(f.service.closeEvent(input), /Integridade/); assert.equal(f.queries.at(-1)?.text, "rollback"); }
});
test("E08.8 vínculos divergentes falham antes de qualquer efeito de domínio", async () => {
  const f = fixture({ invalidLinks: true }); await assert.rejects(f.service.closeEvent(input), /Integridade/); assert.equal(f.queries.some(q => q.text.includes("WITH decision")), false);
});
test("E08.8 replay corrupto não fabrica resposta nem reexecuta encerramento", async () => {
  for (const payload of [null, {}, { ...state, eventId: "other" }, { ...state, externalWaitingFinalized: -1 }, { ...state, newEntriesClosedAt: "bad" }, { ...state, status: "closing" }]) { const f = fixture({ reservation: "replay", payload }); await assert.rejects(f.service.closeEvent(input), /Integridade/); assert.equal(f.queries.at(-1)?.text, "rollback"); }
});
test("E08.8 chave/data de expiração internas inválidas falham antes do tx", async () => {
  for (const patch of [{ idempotencyKey: " " }, { idempotencyKey: "x\u0000y" }, { expiresAt: new Date(NaN) }, { reason: " " }]) { const f = fixture(); await assert.rejects(f.service.closeEvent({ ...input, ...patch })); assert.equal(f.queries.length, 0); }
});
