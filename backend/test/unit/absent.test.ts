import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { ABSENT_SERVICE_OPERATION, AbsentService, AbsentServiceIntegrityError, createAbsentServiceFingerprint } from "../../src/events/absent.service";
import type { AbsentServiceInput } from "../../src/events/absent.types";
import { createRequestFingerprint } from "../../src/participations/join-idempotency";

const input: AbsentServiceInput = { staffUserId: "staff", eventId: "event", serviceSessionId: "session",
  idempotencyKey: "absent-intent", expiresAt: new Date("2099-01-01") };
const at = new Date("2026-11-03T18:00:00Z");
const order = "9007199254741003";
const payload = { serviceSession: { id: input.serviceSessionId, status: "absent", resolvedAt: at.toISOString() },
  previousQueueEntry: { id: "entry", status: "closed", closeReason: "absent" }, requeued: true,
  newQueueEntry: { id: "new-entry", status: "waiting", queueOrder: order, position: 3 } };
function fixture(options: {
  missing?: "target" | "event" | "experience" | "station" | "staff" | "person" | "entry" | "session";
  status?: string; participantStatus?: string; pointer?: string | null; entryStatus?: string;
  ended?: boolean; clock?: number; closeCount?: number; pointerCount?: number;
  requeue?: boolean; noStation?: boolean; notReady?: boolean; queueOrder?: string; count?: string;
  eventTimes?: { startsAtMs?: unknown; officialEndsAtMs?: unknown; operationalDeadlineAtMs?: unknown };
  reservation?: "replay" | "conflict" | "in_progress"; replayPayload?: unknown;
  fail?: "resolve" | "close" | "insert" | "pointer" | "complete";
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [], marker = new Error(`E076_${options.fail}`);
  const client = { async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (text.includes('SELECT s.experience_id AS "experienceId"')) return { rows: options.missing === "target" ? [] : [{ experienceId: "experience", stationId: "station", queueEntryId: "entry", participationId: "person" }] };
    if (text.includes("FROM events WHERE id=")) return { rows: options.missing === "event" ? [] : [{ id: input.eventId,
      name: options.notReady ? "" : "ArenaGo", accessCodeNormalized: "ARENA", timezone: "America/Sao_Paulo", externalQueueEnabled: false,
      startsAtMs: at.getTime()-3600000, officialEndsAtMs: at.getTime()+3600000, operationalDeadlineAtMs: at.getTime()+5400000,
      ...options.eventTimes }] };
    if (text.includes("SELECT id FROM experiences")) return { rows: options.missing === "experience" ? [] : [{ id: "experience" }] };
    if (text.includes("AND availability='available'")) return { rows: options.noStation ? [] : [{ id: "station" }] };
    if (text.includes("SELECT id FROM stations")) return { rows: options.missing === "station" ? [] : [{ id: "station" }] };
    if (text.includes("SELECT r.id FROM users")) return { rows: options.missing === "staff" ? [] : [{ id: "role" }] };
    if (text.includes('AS "currentId"')) return { rows: options.missing === "person" ? [] : [{ status: options.participantStatus ?? "active", currentId: options.pointer === undefined ? "entry" : options.pointer }] };
    if (text.includes("SELECT status FROM queue_entries")) return { rows: options.missing === "entry" ? [] : [{ status: options.entryStatus ?? "called" }] };
    if (text.includes("SELECT status FROM service_sessions")) return { rows: options.missing === "session" ? [] : [{ status: options.status ?? "pending" }] };
    if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation ? [] : [["reservation"]] };
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
      options.reservation === "conflict" ? "other" : createAbsentServiceFingerprint(input.eventId, input.serviceSessionId),
      options.reservation === "in_progress" ? "in_progress" : "completed", 200, input.serviceSessionId, options.replayPayload ?? payload]] };
    if (text.includes("UPDATE service_sessions s SET")) {
      if (options.fail === "resolve") throw marker;
      return { rows: options.ended ? [] : [{ resolvedAtMs: options.clock ?? at.getTime() }] };
    }
    if (text.includes("UPDATE queue_entries q SET")) {
      if (options.fail === "close") throw marker;
      return { rows: options.closeCount === 0 ? [] : [{ id: "entry" }] };
    }
    if (text.includes("INSERT INTO queue_entries")) {
      if (options.fail === "insert") throw marker;
      return { rows: options.requeue === false || options.noStation || options.notReady ? [] : [{ queueOrder: options.queueOrder ?? order }] };
    }
    if (text.includes("SELECT count(*)::text AS count")) return { rows: [{ count: options.count ?? "3" }] };
    if (text.includes("UPDATE participations SET")) {
      if (options.fail === "pointer") throw marker;
      return { rows: options.pointerCount === 0 ? [] : [{ id: "person" }] };
    }
    if (text.includes('update "idempotency_operations"')) {
      if (options.fail === "complete") throw marker;
      return { rows: [["reservation", 200, input.serviceSessionId, payload]] };
    }
    return { rows: [] };
  } };
  return { service: new AbsentService(drizzle(client as unknown as Client, { schema })), queries, marker };
}
test("E07.6 fingerprint fixa evento/sessão em namespace separado da conclusão", () => {
  const hash = createAbsentServiceFingerprint("e", "s");
  assert.equal(hash, createAbsentServiceFingerprint("e", "s"));
  assert.notEqual(hash, createAbsentServiceFingerprint("other", "s")); assert.notEqual(hash, createAbsentServiceFingerprint("e", "other"));
  assert.notEqual(hash, createRequestFingerprint("complete_service_session", { eventId: "e", serviceSessionId: "s" }));
  assert.equal(ABSENT_SERVICE_OPERATION, "absent_service_session");
});
test("E07.6 registra absent e nova waiting no mesmo tx, com ordem bigint exata e novo ID", async () => {
  const { service, queries } = fixture(); const result = await service.absent(input);
  assert.ok(result.kind === "absent" && result.requeued);
  assert.deepEqual(result.serviceSession, { id: input.serviceSessionId, status: "absent", resolvedAt: at });
  assert.deepEqual(result.previousQueueEntry, payload.previousQueueEntry);
  assert.equal(result.newQueueEntry.queueOrder, order); assert.equal(result.newQueueEntry.position, 3);
  assert.notEqual(result.newQueueEntry.id, "entry");
  assert.ok(queries.find(q => q.text.includes("UPDATE participations SET"))?.params.includes(result.newQueueEntry.id));
  assert.equal(queries[0].text, "begin isolation level read committed"); assert.equal(queries.at(-1)?.text, "commit");
  assert.equal(queries.some(q => /UPDATE stations|status='completed'|SET status='finished'/.test(q.text)), false);
});
test("E07.6 corte/fila pausada não reentram e liberam somente o ponteiro original", async () => {
  const { service, queries } = fixture({ requeue: false }); const result = await service.absent(input);
  assert.ok(result.kind === "absent" && !result.requeued); assert.equal(result.newQueueEntry, null);
  const pointer = queries.find(q => q.text.includes("UPDATE participations SET"))!;
  assert.ok(pointer.params.includes(null)); assert.ok(pointer.params.includes("entry"));
  assert.equal(queries.some(q => q.text.includes("SELECT count(*)")), false);
});
test("E07.6 ordem de locks comum inclui testemunha disponível antes de pessoa/entrada/sessão", async () => {
  const { service, queries } = fixture(); await service.absent(input);
  const order = ['SELECT s.experience_id AS "experienceId"', "FROM events WHERE id=", "SELECT id FROM experiences", "SELECT id FROM stations\n",
    "AND availability='available'", "SELECT r.id FROM users", 'AS "currentId"', "SELECT status FROM queue_entries", "SELECT status FROM service_sessions", 'insert into "idempotency_operations"', "UPDATE service_sessions s SET"];
  const index = (p: string) => queries.findIndex(q => q.text.includes(p));
  for (let n=1;n<order.length;n++) assert.ok(index(order[n-1]) < index(order[n]), order[n]);
  assert.doesNotMatch(queries[1].text, /FOR UPDATE|FOR SHARE|current_queue_entry_id/);
  for (const p of [order[2], order[3], order[6], order[7], order[8]]) assert.match(queries[index(p)].text, /FOR UPDATE/);
  for (const p of [order[1], order[4], order[5]]) assert.match(queries[index(p)].text, /FOR SHARE/);
});
test("E07.6 Staff ativo/verificado e escopo vigente são obrigatórios inclusive no replay", async () => {
  const { service, queries } = fixture({ reservation: "replay" }); await service.absent(input);
  const auth = queries.find(q => q.text.includes("SELECT r.id FROM users"))!;
  for (const p of ["u.is_active=true", "u.email_verified_at IS NOT NULL", "r.role='staff'", "r.revoked_at IS NULL", "FOR SHARE OF u, r"]) assert.ok(auth.text.includes(p));
  assert.ok(auth.params.includes(input.eventId)); assert.doesNotMatch(auth.text, /admin/);
  assert.deepEqual(await fixture({ missing: "staff", reservation: "replay" }).service.absent(input), { kind: "staff_event_forbidden" });
});
test("E07.6 relógios decisivos distintos para resolução residual e INSERT condicionado de reentrada", async () => {
  const { service, queries } = fixture(); await service.absent(input);
  const resolve = queries.find(q => q.text.includes("UPDATE service_sessions s SET"))!.text;
  for (const p of ["clock_timestamp()", "d.at < e.operational_deadline_at", "d.at < e.admin_deadline_at", "s.status='pending'", "q.status='called'"]) assert.ok(resolve.includes(p));
  assert.doesNotMatch(resolve, /official_ends_at|closure_requested_at|queue_accepting_entries|availability/);
  const insert = queries.find(q => q.text.includes("INSERT INTO queue_entries"))!.text;
  for (const p of ["clock_timestamp()", "x.queue_accepting_entries=true", "e.status NOT IN ('closing','closed')", "d.at < e.official_ends_at", "d.at < e.closure_requested_at", "x.last_queue_order+1", "FROM assigned a"]) assert.ok(insert.includes(p));
  assert.match(queries.find(q => q.text.includes("UPDATE queue_entries q SET"))!.text, /closed_at=s.resolved_at/);
});
test("E07.6 prontidão/configuração e estação disponível da experiência condicionam só reentrada", async () => {
  for (const options of [{ notReady: true }, { noStation: true }]) {
    const { service, queries } = fixture(options); const result = await service.absent(input);
    assert.ok(result.kind === "absent" && !result.requeued);
    assert.ok(queries.find(q => q.text.includes("INSERT INTO queue_entries"))!.params.includes(false));
  }
});
test("E07.6 converte epoch PostgreSQL para prontidão e rejeita horários brutos inválidos com rollback", async () => {
  const { service, queries } = fixture(); assert.ok((await service.absent(input)).kind === "absent");
  const query = queries.find(q => q.text.includes("FROM events WHERE id="))!.text;
  for (const field of ["starts_at", "official_ends_at", "operational_deadline_at"]) {
    assert.ok(query.includes(`(EXTRACT(EPOCH FROM ${field})*1000)::double precision`));
  }
  for (const eventTimes of [{ startsAtMs: "2026-11-03 17:00:00+00" }, { startsAtMs: NaN },
    { officialEndsAtMs: Infinity }, { operationalDeadlineAtMs: 1e20 }]) {
    const f = fixture({ eventTimes }); await assert.rejects(f.service.absent(input), AbsentServiceIntegrityError);
    assert.equal(f.queries.at(-1)?.text, "rollback");
    assert.equal(f.queries.some(q => q.text.includes("INSERT INTO queue_entries") || q.text.includes('update "idempotency_operations"')), false);
  }
});
for (const [name, options, kind] of [
  ["evento ausente", { missing: "event" }, "staff_event_forbidden"], ["sem Staff", { missing: "staff" }, "staff_event_forbidden"],
  ["sessão ausente/alheia", { missing: "target" }, "service_not_found"],
  ["completed", { status: "completed" }, "service_not_pending"], ["absent", { status: "absent" }, "service_not_pending"],
  ["canceled", { status: "canceled" }, "service_not_pending"], ["prazo vencido", { ended: true }, "event_operation_ended"],
] as const) {
  test(`E07.6 bloqueia ${name} e reverte reserva`, async () => {
    const { service, queries } = fixture(options); assert.deepEqual(await service.absent(input), { kind });
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes("UPDATE queue_entries") || q.text.includes("INSERT INTO queue_entries") || q.text.includes('update "idempotency_operations"')), false);
  });
}
test("E07.6 replay histórico com/sem reentrada ignora estado e ponteiro posteriores", async () => {
  for (const requeued of [false, true]) {
    const replayPayload = requeued ? payload : { ...payload, requeued: false, newQueueEntry: null };
    const { service, queries } = fixture({ reservation: "replay", replayPayload, status: "absent", participantStatus: "finished", pointer: "later", entryStatus: "closed", ended: true });
    const result = await service.absent(input); assert.equal(result.kind, "replay");
    assert.deepEqual(result, { kind: "replay", ...replayPayload, serviceSession: { ...payload.serviceSession, resolvedAt: at } });
    assert.equal(queries.some(q => q.text.includes("WITH decision") || q.text.includes("UPDATE participations")), false);
  }
});
test("E07.6 conflito/in_progress não escrevem domínio", async () => {
  for (const reservation of ["conflict", "in_progress"] as const) {
    const { service, queries } = fixture({ reservation });
    assert.deepEqual(await service.absent(input), { kind: reservation === "conflict" ? "request_conflict" : "in_progress" });
    assert.equal(queries.some(q => q.text.includes("WITH decision")), false);
  }
});
test("E07.6 inconsistência de vínculos/estados/linhas/ordem/posição faz rollback", async () => {
  for (const options of [{ missing: "experience" }, { missing: "station" }, { missing: "person" }, { missing: "entry" }, { missing: "session" },
    { status: "unknown" }, { participantStatus: "finished" }, { pointer: null }, { entryStatus: "waiting" }, { closeCount: 0 }, { pointerCount: 0 },
    { clock: NaN }, { queueOrder: "0" }, { count: "0" }, { count: "9007199254740992" }] as const) {
    const { service, queries } = fixture(options);
    await assert.rejects(service.absent(input), AbsentServiceIntegrityError); assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("E07.6 replay malformado não fabrica resultado válido", async () => {
  for (const replayPayload of [{}, { ...payload, serviceSession: { ...payload.serviceSession, id: "other" } },
    { ...payload, previousQueueEntry: { ...payload.previousQueueEntry, id: "other" } },
    { ...payload, serviceSession: { ...payload.serviceSession, resolvedAt: "invalid" } },
    { ...payload, newQueueEntry: { ...payload.newQueueEntry, id: "entry" } },
    { ...payload, newQueueEntry: { ...payload.newQueueEntry, position: 0 } }, { ...payload, requeued: false }]) {
    await assert.rejects(fixture({ reservation: "replay", replayPayload }).service.absent(input), AbsentServiceIntegrityError);
  }
});
test("E07.6 falha em cada escrita propaga causa e solicita rollback", async () => {
  for (const fail of ["resolve", "close", "insert", "pointer", "complete"] as const) {
    const { service, queries, marker } = fixture({ fail });
    await assert.rejects(service.absent(input), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});
test("E07.6 input inválido não abre transação e contrato não expõe dados pessoais", async () => {
  const { service, queries } = fixture();
  for (const changes of [{ idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }, { expiresAt: new Date(NaN) }]) await assert.rejects(service.absent({ ...input, ...changes }), /inválida/);
  assert.equal(queries.length, 0); assert.equal(JSON.stringify(await service.absent(input)).includes(input.staffUserId), false);
});
