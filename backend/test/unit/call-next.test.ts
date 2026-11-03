import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { CALL_NEXT_OPERATION, CallNextIntegrityError, CallNextService, createCallNextFingerprint } from "../../src/events/call-next.service";
import type { CallNextInput } from "../../src/events/call-next.types";
import { createRequestFingerprint } from "../../src/participations/join-idempotency";

const input: CallNextInput = { staffUserId: "staff", eventId: "event", experienceId: "experience", stationId: "station",
  idempotencyKey: "call-intent", expiresAt: new Date("2099-01-01") };
const at = new Date("2026-11-02T18:00:00Z");

function fixture(options: {
  missing?: "event" | "experience" | "station" | "staff"; availability?: string; pending?: boolean; empty?: boolean;
  operating?: boolean; endedAtInsert?: boolean; participantStatus?: string; pointer?: string | null;
  entryCount?: number; priorSession?: boolean; calledCount?: number; clock?: number;
  reservation?: "replay" | "conflict" | "in_progress"; invalidReplay?: boolean;
  fail?: "insert" | "entry" | "complete";
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const marker = new Error(`E074_${options.fail}`);
  const payload = { serviceSession: { id: "session", queueEntryId: "entry", experienceId: input.experienceId,
    station: { id: input.stationId, label: "Estação" }, status: "pending", calledAt: at.toISOString() } };
  const client = { async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (text.includes("SELECT id FROM events")) return { rows: options.missing === "event" ? [] : [{ id: input.eventId }] };
    if (text.includes("SELECT id FROM experiences")) return { rows: options.missing === "experience" ? [] : [{ id: input.experienceId }] };
    if (text.includes("SELECT availability, label")) return { rows: options.missing === "station" ? [] : [{ availability: options.availability ?? "available", label: "Estação" }] };
    if (text.includes("SELECT r.id FROM users")) return { rows: options.missing === "staff" ? [] : [{ id: "role" }] };
    if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation ? [] : [["reservation"]] };
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
      options.reservation === "conflict" ? "other" : createCallNextFingerprint(input.eventId, input.experienceId, input.stationId),
      options.reservation === "in_progress" ? "in_progress" : "completed", 201, "session", options.invalidReplay ? {} : payload]] };
    if (text.includes("AS operating")) return { rows: [{ operating: options.operating ?? true }] };
    if (text.includes("WHERE station_id=")) return { rows: options.pending ? [{ id: "occupied" }] : [] };
    if (text.includes('participation_id AS "participationId"')) return { rows: options.empty ? [] : [{ id: "entry", participationId: "person" }] };
    if (text.includes('AS "currentId"')) return { rows: [{ status: options.participantStatus ?? "active", currentId: options.pointer === undefined ? "entry" : options.pointer }] };
    if (text.includes("SELECT id FROM queue_entries")) return { rows: options.entryCount === 0 ? [] : [{ id: "entry" }] };
    if (text.includes("WHERE queue_entry_id=")) return { rows: options.priorSession ? [{ id: "prior" }] : [] };
    if (text.includes("INSERT INTO service_sessions")) {
      if (options.fail === "insert") throw marker;
      return { rows: options.endedAtInsert ? [] : [{ calledAtMs: options.clock ?? at.getTime() }] };
    }
    if (text.includes("UPDATE queue_entries SET")) {
      if (options.fail === "entry") throw marker;
      return { rows: options.calledCount === 0 ? [] : [{ id: "entry" }] };
    }
    if (text.includes('update "idempotency_operations"')) {
      if (options.fail === "complete") throw marker;
      return { rows: [["reservation", 201, "session", payload]] };
    }
    return { rows: [] };
  } };
  return { service: new CallNextService(drizzle(client as unknown as Client, { schema })), queries, marker };
}

test("E07.4 fingerprint vincula evento, experiência e estação em namespace próprio", () => {
  const hash = createCallNextFingerprint("e", "x", "s");
  assert.equal(hash, createCallNextFingerprint("e", "x", "s"));
  for (const args of [["other", "x", "s"], ["e", "other", "s"], ["e", "x", "other"]]) {
    assert.notEqual(hash, createCallNextFingerprint(args[0], args[1], args[2]));
  }
  assert.notEqual(hash, createRequestFingerprint("join_experience_queue", { eventId: "e", experienceId: "x", stationId: "s" }));
  assert.equal(CALL_NEXT_OPERATION, "call_next");
});

test("E07.4 cria pending e called com autoria e idempotência no mesmo tx", async () => {
  const { service, queries } = fixture(); const result = await service.callNext(input);
  assert.ok(result.kind === "created");
  assert.equal(result.serviceSession.status, "pending"); assert.deepEqual(result.serviceSession.calledAt, at);
  assert.equal(result.serviceSession.queueEntryId, "entry");
  assert.deepEqual(result.serviceSession.station, { id: input.stationId, label: "Estação" });
  assert.equal(queries[0].text, "begin isolation level read committed"); assert.equal(queries.at(-1)?.text, "commit");
  assert.ok(queries.find(q => q.text.includes("INSERT INTO service_sessions"))?.params.includes(input.staffUserId));
  assert.equal(queries.some(q => /UPDATE participations|UPDATE stations|last_queue_order\s*=|INSERT INTO queue_entries/i.test(q.text)), false);
  assert.equal(JSON.stringify(result).includes(input.staffUserId), false);
});

test("E07.4 locks e revalidação seguem evento → experiência → estação → pessoa → entrada", async () => {
  const { service, queries } = fixture(); await service.callNext(input);
  const order = ["SELECT id FROM events", "SELECT id FROM experiences", "SELECT availability, label", "SELECT r.id FROM users",
    'participation_id AS "participationId"', 'AS "currentId"', "SELECT id FROM queue_entries", "WHERE queue_entry_id=", "INSERT INTO service_sessions", "UPDATE queue_entries SET"];
  const index = (part: string) => queries.findIndex(q => q.text.includes(part));
  for (let i = 1; i < order.length; i++) assert.ok(index(order[i-1]) < index(order[i]), order[i]);
  assert.match(queries[index(order[0])].text, /FOR SHARE/);
  for (const part of [order[1], order[2], order[5], order[6], order[7]]) assert.match(queries[index(part)].text, /FOR UPDATE/);
  const select = queries[index(order[6])].text;
  assert.match(select, /status='waiting'/); assert.match(select, /ORDER BY queue_order, id LIMIT 1/);
  assert.equal(queries.some(q => q.text.includes("SKIP LOCKED")), false);
});

test("E07.4 autorização exige conta ativa/verificada e Staff vigente do evento, inclusive em replay", async () => {
  const { service, queries } = fixture({ reservation: "replay" }); await service.callNext(input);
  const auth = queries.find(q => q.text.includes("SELECT r.id FROM users"))!;
  for (const text of ["u.is_active=true", "u.email_verified_at IS NOT NULL", "r.role='staff'", "r.revoked_at IS NULL", "FOR SHARE OF u, r"]) assert.ok(auth.text.includes(text));
  assert.ok(auth.params.includes(input.eventId)); assert.ok(auth.params.includes(input.staffUserId));
  assert.doesNotMatch(auth.text, /admin/);
  const denied = fixture({ missing: "staff", reservation: "replay" });
  assert.deepEqual(await denied.service.callNext(input), { kind: "staff_event_forbidden" });
  assert.equal(denied.queries.some(q => q.text.includes('insert into "idempotency_operations"')), false);
});

test("E07.4 corte decisivo usa clock_timestamp depois das esperas e permite janela residual", async () => {
  const { service, queries } = fixture(); await service.callNext(input);
  const decisive = queries.find(q => q.text.includes("INSERT INTO service_sessions"))!.text;
  for (const text of ["clock_timestamp()", "d.at < e.operational_deadline_at", "d.at < e.admin_deadline_at", "e.status <> 'closed'", "e.starts_at <= d.at", "p.current_queue_entry_id=q.id"]) assert.ok(decisive.includes(text));
  assert.doesNotMatch(decisive, /official_ends_at|closure_requested_at|queue_accepting_entries/);
});

for (const [name, options, kind] of [
  ["evento ausente", { missing: "event" }, "staff_event_forbidden"],
  ["experiência alheia", { missing: "experience" }, "staff_event_forbidden"],
  ["estação alheia", { missing: "station" }, "staff_event_forbidden"],
  ["sem Staff", { missing: "staff" }, "staff_event_forbidden"],
  ["estação indisponível", { availability: "unavailable" }, "station_unavailable"],
  ["estação ocupada", { pending: true }, "station_has_pending_call"],
  ["fila vazia", { empty: true }, "queue_empty"],
  ["fora da janela", { operating: false }, "event_operation_ended"],
  ["prazo atingido após locks", { endedAtInsert: true }, "event_operation_ended"],
] as const) {
  test(`E07.4 bloqueia ${name} e reverte reserva`, async () => {
    const { service, queries } = fixture(options);
    assert.deepEqual(await service.callNext(input), { kind }); assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes("UPDATE queue_entries SET") || q.text.includes('update "idempotency_operations"')), false);
  });
}

test("E07.4 replay histórico precede ocupação/tempo/fila e não escreve domínio", async () => {
  const { service, queries } = fixture({ reservation: "replay", pending: true, operating: false, empty: true, availability: "unavailable" });
  const result = await service.callNext(input); assert.ok(result.kind === "replay");
  assert.deepEqual(result.serviceSession.calledAt, at);
  assert.equal(queries.some(q => q.text.includes("AS operating") || q.text.includes("INSERT INTO service_sessions")), false);
});

test("E07.4 conflito e in_progress não escrevem domínio", async () => {
  for (const reservation of ["conflict", "in_progress"] as const) {
    const { service, queries } = fixture({ reservation });
    assert.deepEqual(await service.callNext(input), { kind: reservation === "conflict" ? "request_conflict" : "in_progress" });
    assert.equal(queries.some(q => q.text.includes("INSERT INTO service_sessions")), false);
  }
});

test("E07.4 inconsistência de pessoa/entrada/atendimento/replay causa rollback", async () => {
  for (const options of [{ participantStatus: "finished" }, { pointer: null }, { entryCount: 0 }, { priorSession: true },
    { calledCount: 0 }, { clock: NaN }, { availability: "unknown" }, { reservation: "replay" as const, invalidReplay: true }]) {
    const { service, queries } = fixture(options);
    await assert.rejects(service.callNext(input), CallNextIntegrityError); assert.equal(queries.at(-1)?.text, "rollback");
  }
});

test("E07.4 falha nas escritas propaga causa e reverte toda a transação", async () => {
  for (const fail of ["insert", "entry", "complete"] as const) {
    const { service, queries, marker } = fixture({ fail });
    await assert.rejects(service.callNext(input), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause = cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});

test("E07.4 input inválido falha antes de abrir transação", async () => {
  const { service, queries } = fixture();
  for (const changes of [{ idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }, { expiresAt: new Date(NaN) }]) {
    await assert.rejects(service.callNext({ ...input, ...changes }), /inválida/);
  }
  assert.equal(queries.length, 0);
});
