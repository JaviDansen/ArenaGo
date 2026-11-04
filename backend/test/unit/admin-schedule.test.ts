import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { adminScheduleBody, normalizeScheduleInstant } from "../../src/events/admin-schedule.dto";
import { ADMIN_SCHEDULE_OPERATION, AdminScheduleService, scheduleFingerprint } from "../../src/events/admin-schedule.service";
import type { AdminScheduleInput } from "../../src/events/admin-schedule.types";

const input: AdminScheduleInput = { userId: "admin", sessionId: "session", eventId: "event", reason: "Alteração autorizada",
  officialEndsAt: "2026-11-05T23:00:00.000Z", operationalDeadlineAt: "2026-11-06T00:00:00.000Z",
  idempotencyKey: "intent", expiresAt: new Date("2099-01-01") };
const changedAt = "2026-11-03T15:00:00.123456Z";
const state = { eventId: input.eventId, officialEndsAt: input.officialEndsAt, operationalDeadlineAt: input.operationalDeadlineAt };
const old = { officialEndsAt: "2026-11-04T23:00:00.123456+00:00", operationalDeadlineAt: "2026-11-05T00:00:00.123456+00:00" };
function fixture(options: { absent?: boolean; active?: boolean; admin?: boolean; session?: boolean; revoked?: boolean;
  secondFactor?: boolean; expiredAt?: number; same?: boolean; outcome?: string;
  reservation?: "replay" | "request_conflict" | "in_progress"; payload?: object | null; replayStatus?: number;
  fail?: "update" | "audit" | "complete"; auditCount?: number } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [], marker = new Error("PRIVATE_E087_SQL");
  let checks = 0;
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.includes("SELECT id FROM events")) return { rows: options.absent ? [] : [{ id: input.eventId }] };
    if (text.includes("FROM users WHERE")) return { rows: [{ active: options.active ?? true }] };
    if (text.includes("SELECT id FROM user_roles")) return { rows: options.admin === false ? [] : [{ id: "role" }] };
    if (text.includes("SELECT id FROM sessions")) return { rows: options.session === false ? [] : [{ id: input.sessionId }] };
    if (text.includes('AS "secondFactor"')) return { rows: [{ revoked: options.revoked ?? false,
      expired: ++checks >= (options.expiredAt ?? Infinity), secondFactor: options.secondFactor ?? true }] };
    if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation ? [] : [["reservation"]] };
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
      options.reservation === "request_conflict" ? "different" : scheduleFingerprint(input.eventId, input.officialEndsAt, input.operationalDeadlineAt, input.reason),
      options.reservation === "in_progress" ? "in_progress" : "completed", options.replayStatus ?? 200, input.eventId,
      options.payload === undefined ? { ...state, changedAt } : options.payload]] };
    if (text.includes(" AS same")) return { rows: [{ same: options.same ?? false }] };
    if (text.includes("WITH decision AS MATERIALIZED")) { if (options.fail === "update") throw marker; return { rows: [{ outcome: options.outcome ?? "changed", changedAt, before: old }] }; }
    if (text.includes("INSERT INTO audit_logs")) { if (options.fail === "audit") throw marker; return { rows: options.auditCount === 0 ? [] : [{ id: "audit" }] }; }
    if (text.startsWith('update "idempotency_operations"')) { if (options.fail === "complete") throw marker; return { rows: [["reservation", 200, input.eventId, {}]] }; }
    throw new Error(`SQL inesperado: ${text}`);
  } } as unknown as Client, { schema });
  return { service: new AdminScheduleService(database), queries, marker };
}

test("E08.7 datas ISO inequívocas são normalizadas sem perda e margem inclui zero/60 minutos", () => {
  for (const [value, expected] of [["2026-11-05T20:00:00-03:00", input.officialEndsAt], ["2026-11-06T01:00:00+02:00", input.officialEndsAt],
    ["2024-02-29T12:00:00.1Z", "2024-02-29T12:00:00.100Z"], ["0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000Z"]]) assert.equal(normalizeScheduleInstant(value), expected);
  for (const margin of [0, 3_600_000]) assert.equal(adminScheduleBody.safeParse({ ...input, operationalDeadlineAt: new Date(Date.parse(input.officialEndsAt) + margin).toISOString(),
    userId: undefined }).success, false, "O DTO permanece estrito, inclusive para propriedades undefined.");
  for (const margin of [0, 3_600_000]) assert.equal(adminScheduleBody.safeParse({ officialEndsAt: input.officialEndsAt,
    operationalDeadlineAt: new Date(Date.parse(input.officialEndsAt) + margin).toISOString(), reason: input.reason }).success, true);
});
test("E08.7 recusa datas impossíveis, ambíguas, submilissegundos e normalização silenciosa", () => {
  for (const value of ["2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "1900-02-29T00:00:00Z", "2026-00-01T00:00:00Z",
    "2026-01-00T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z",
    "2026-01-01", "2026-01-01T12:00:00", "2026-01-01 12:00:00Z", "2026-01-01T00:00:00.1234Z",
    "2026-01-01T00:00:00-00:00", "2026-01-01T00:00:00+24:00", "2026-01-01T00:00:00+01:60", "0000-01-01T00:00:00Z",
    "0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00", " 2026-01-01T12:00:00Z"]) assert.equal(normalizeScheduleInstant(value), undefined, value);
});
test("E08.7 intervalo negativo ou acima de 60 minutos e reason inválida falham antes do tx", async () => {
  for (const patch of [{ operationalDeadlineAt: "2026-11-05T22:59:59.999Z" }, { operationalDeadlineAt: "2026-11-06T00:00:00.001Z" },
    { officialEndsAt: "bad" }, { reason: " " }, { reason: "x".repeat(501) }, { reason: "x\u0000y" },
    { idempotencyKey: "" }, { idempotencyKey: "x\u007fy" }, { expiresAt: new Date(NaN) }]) {
    const f = fixture(); await assert.rejects(f.service.updateSchedule({ ...input, ...patch })); assert.equal(f.queries.length, 0);
  }
});
test("E08.7 efeito, auditoria exata e intenção concluída usam um tx READ COMMITTED", async () => {
  const f = fixture(); assert.deepEqual(await f.service.updateSchedule(input), { kind: "completed", ...state, changedAt });
  assert.equal(f.queries[0].text, "begin isolation level read committed"); assert.equal(f.queries.at(-1)?.text, "commit");
  const order = ["SELECT id FROM events", "FROM users WHERE", "SELECT id FROM user_roles", "SELECT id FROM sessions",
    'insert into "idempotency_operations"', " AS same", "WITH decision AS MATERIALIZED", "INSERT INTO audit_logs", 'update "idempotency_operations"'];
  for (let n = 1; n < order.length; n++) assert.ok(f.queries.findIndex(q => q.text.includes(order[n - 1])) < f.queries.findIndex(q => q.text.includes(order[n])), order[n]);
  assert.match(f.queries[1].text, /FOR UPDATE/);
  const audit = f.queries.find(q => q.text.includes("INSERT INTO audit_logs"))!;
  assert.match(audit.text, /'user','event','event_schedule_changed'/); assert.match(audit.text, /e.updated_at/);
  assert.ok(audit.params.includes(JSON.stringify(old))); assert.ok(audit.params.includes(input.reason));
  assert.equal(f.queries.filter(q => q.text.includes('AS "secondFactor"')).length, 4);
});
test("E08.7 escrita condiciona corte antigo, novo instante, estado Admin e sessão no relógio PostgreSQL", async () => {
  const f = fixture(); await f.service.updateSchedule(input);
  const q = f.queries.find(q => q.text.includes("WITH decision AS MATERIALIZED"))!;
  for (const text of ["clock_timestamp()", "d.at >= e.official_ends_at", "e.status IN ('closing','closed')", "e.closure_requested_at IS NOT NULL",
    "e.admin_deadline_at IS NOT NULL", "::timestamptz <= e.starts_at", "::timestamptz <= d.at", "AND NOT p.closed AND NOT p.invalid", "p.at < a.expires_at", "interval '1 hour'"]) assert.ok(q.text.includes(text), text);
  for (const table of ["participations", "stations", "experiences", "queue_entries", "service_sessions"]) assert.equal(q.text.includes(table), false);
  assert.match(q.text, /SET official_ends_at=.*\n\s*operational_deadline_at=/);
});
test("E08.7 autorização global compartilhada usa conta, concessão e sessão própria retidas", async () => {
  const f = fixture(); await f.service.updateSchedule(input);
  const role = f.queries.find(q => q.text.includes("SELECT id FROM user_roles"))!;
  for (const text of ["role='admin'", "event_id IS NULL", "revoked_at IS NULL", "ORDER BY id FOR SHARE"]) assert.ok(role.text.includes(text));
  const session = f.queries.find(q => q.text.includes("SELECT id FROM sessions"))!;
  assert.deepEqual(session.params, [input.sessionId, input.userId]); assert.match(session.text, /FOR SHARE/);
});
test("E08.7 no-op autorizado não emite UPDATE de evento nem auditoria, mas persiste intenção", async () => {
  const f = fixture({ same: true }); assert.deepEqual(await f.service.updateSchedule(input), { kind: "completed", ...state });
  assert.equal(f.queries.some(q => q.text.includes("WITH decision") || q.text.includes("audit_logs")), false);
  assert.ok(f.queries.some(q => q.text.startsWith('update "idempotency_operations"')));
});
test("E08.7 replay histórico e replay de no-op não reaplicam programação posterior", async () => {
  for (const payload of [{ ...state, changedAt }, state]) {
    const f = fixture({ reservation: "replay", payload }); assert.deepEqual(await f.service.updateSchedule(input), { kind: "replay", ...payload });
    assert.equal(f.queries.some(q => q.text.includes(" AS same") || q.text.includes("WITH decision") || q.text.startsWith("update") || q.text.includes("audit_logs")), false);
    assert.equal(f.queries.at(-1)?.text, "rollback");
  }
});
test("E08.7 fingerprint canônico distingue evento, dois horários e reason, normaliza fusos/trim", () => {
  const hash = scheduleFingerprint(input.eventId, input.officialEndsAt, input.operationalDeadlineAt, input.reason);
  assert.equal(ADMIN_SCHEDULE_OPERATION, "admin_update_event_schedule");
  assert.equal(hash, scheduleFingerprint(input.eventId, "2026-11-05T20:00:00-03:00", input.operationalDeadlineAt, ` ${input.reason} `));
  for (const patch of [{ eventId: "other" }, { officialEndsAt: "2026-11-05T23:00:01Z" }, { operationalDeadlineAt: "2026-11-05T23:59:59Z" }, { reason: "other" }]) {
    const p = { ...input, ...patch }; assert.notEqual(hash, scheduleFingerprint(p.eventId, p.officialEndsAt, p.operationalDeadlineAt, p.reason));
  }
});
for (const [name, options, kind] of [
  ["conta inativa", { active: false }, "account_inactive"], ["Staff/participante/Admin revogado", { admin: false }, "admin_required"],
  ["sessão ausente", { session: false }, "invalid_session"], ["sessão revogada", { revoked: true }, "session_revoked"],
  ["sessão expirada após locks", { expiredAt: 1 }, "session_expired"], ["2FA ausente", { secondFactor: false }, "admin_2fa_required"],
  ["sessão expirada após reserva", { expiredAt: 2 }, "session_expired"], ["sessão expirada na escrita", { expiredAt: 3 }, "session_expired"],
  ["sessão expirada após auditoria", { expiredAt: 4 }, "session_expired"], ["evento ausente", { absent: true }, "resource_not_found"],
  ["corte antigo ou fechamento", { outcome: "closed" }, "event_time_change_closed"], ["novo instante inválido", { outcome: "invalid" }, "invalid_schedule"],
  ["chave reutilizada", { reservation: "request_conflict" }, "request_conflict"], ["intenção em processamento", { reservation: "in_progress" }, "in_progress"],
] as const) test(`E08.7 ${name} faz rollback da reserva e dos efeitos`, async () => {
  const f = fixture(options); assert.deepEqual(await f.service.updateSchedule(input), { kind }); assert.equal(f.queries.at(-1)?.text, "rollback");
  assert.equal(f.queries.some(q => q.text.startsWith('update "idempotency_operations"')), false);
});
test("E08.7 evento inexistente continua sujeito à autorização antes de revelar 404", async () => {
  const f = fixture({ absent: true, admin: false }); assert.deepEqual(await f.service.updateSchedule(input), { kind: "admin_required" });
  assert.equal(f.queries.some(q => q.text.includes('insert into "idempotency_operations"')), false);
});
test("E08.7 falhas de UPDATE/auditoria/conclusão preservam causa e revertem transação", async () => {
  for (const fail of ["update", "audit", "complete"] as const) {
    const f = fixture({ fail }); await assert.rejects(f.service.updateSchedule(input), e => e instanceof Error && e.cause === f.marker);
    assert.equal(f.queries.at(-1)?.text, "rollback"); assert.equal(f.queries.some(q => q.text === "commit"), false);
  }
  for (const options of [{ auditCount: 0 }, { outcome: "not_written" }]) {
    const f = fixture(options); await assert.rejects(f.service.updateSchedule(input)); assert.equal(f.queries.at(-1)?.text, "rollback");
  }
});
test("E08.7 replay corrupto falha fechado e não produz mutação", async () => {
  for (const payload of [null, {}, { ...state, eventId: "other" }, { ...state, officialEndsAt: "2027-01-01T00:00:00Z" }, { ...state, changedAt: "bad" }]) {
    const f = fixture({ reservation: "replay", payload }); await assert.rejects(f.service.updateSchedule(input), /inválid/); assert.equal(f.queries.at(-1)?.text, "rollback");
  }
  const f = fixture({ reservation: "replay", replayStatus: 201 }); await assert.rejects(f.service.updateSchedule(input), /Status/);
});
