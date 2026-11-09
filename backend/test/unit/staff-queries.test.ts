import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { StaffQueriesService } from "../../src/events/staff-queries.service";

const eventId = "event", experienceId = "experience", userId = "staff", at = new Date("2026-11-03T15:00:00Z");
const station = { id: "station", experienceId, label: "Estação", availability: "available",
  pendingServiceSessionId: "pending", pendingCalledAtMs: at.getTime() };
const queue = { queueAcceptingEntries: true, hasAvailableStation: true, waitingCount: "2", firstWaitingQueueEntryId: "first" };
test("descoberta usa SQL parametrizado, concessão ativa e conta apta", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    queries.push({ text: config.text, params });
    return { rows: [{ id: "e1", name: "Arena", status: "open", accessCode: "private" }] };
  } } as unknown as Client, { schema });
  const service = new StaffQueriesService(database, new EventsService(database));
  assert.deepEqual(await service.listEvents(userId), [{ id: "e1", name: "Arena", status: "open" }]);
  assert.equal(queries.length, 1); assert.deepEqual(queries[0].params, [userId]);
  for (const expression of [/r.role='staff'/, /r.event_id=e.id/, /r.revoked_at IS NULL/,
    /u.is_active=true/, /u.email_verified_at IS NOT NULL/, /ORDER BY e.name, e.id/]) {
    assert.match(queries[0].text, expression);
  }
  assert.doesNotMatch(queries[0].text, /\b(insert|update|delete)\b/i);
});
function fixture(options: { denied?: boolean; clock?: number; operating?: boolean; accepting?: boolean;
  stations?: object[]; queue?: object[] } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let evaluations = 0;
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    queries.push({ text: config.text, params });
    if (config.text.includes("FROM events e")) return { rows: options.denied ? [] : [{ observedAtMs: options.clock ?? at.getTime(), operating: options.operating ?? true }] };
    if (config.text.includes("FROM experiences e JOIN stations")) return { rows: options.stations ?? [station] };
    if (config.text.includes("WITH waiting")) return { rows: options.queue ?? [queue] };
    return { rows: [] };
  } } as unknown as Client, { schema });
  const events = new EventsService(database);
  events.evaluateEventAvailabilityById = async (id, observed, executor) => {
    evaluations++; assert.equal(id, eventId); assert.deepEqual(observed, at); assert.ok(executor && executor !== database);
    return { eventExists: true, eventId, ready: true, withinEntryWindow: true,
      eventAcceptingNewEntries: options.accepting ?? true, checks: { nameAndAccessCode: true,
        validScheduleAndTimezone: true, externalQueueConfigured: true, hasAuthorizedStaff: true,
        hasAvailableStation: true, hasOperationalCapacity: true }, missing: [], cutoffAt: at };
  };
  return { service: new StaffQueriesService(database, events), queries, evaluations: () => evaluations };
}

test("E08.4 estações preservam configuração e instante pending sem ocupação redundante", async () => {
  const f = fixture({ stations: [station, { ...station, id: "unavailable", availability: "unavailable", pendingServiceSessionId: null, pendingCalledAtMs: null }] });
  assert.deepEqual(await f.service.getStations(userId, eventId), { kind: "ok", eventId, stations: [
    { id: "station", experienceId, label: "Estação", availability: "available", pendingServiceSessionId: "pending", pendingCalledAt: at },
    { id: "unavailable", experienceId, label: "Estação", availability: "unavailable", pendingServiceSessionId: null, pendingCalledAt: null },
  ] });
  assert.equal(f.evaluations(), 0); assert.match(f.queries[2].text, /p.status='pending'/);
  assert.match(f.queries[2].text, /ORDER BY e.id, s.id/);
});
test("E08.4 autorização consulta concessão vigente, conta apta e evento antes dos dados", async () => {
  for (const method of ["getStations", "getQueue"] as const) {
    const f = fixture({ denied: true });
    assert.deepEqual(await f.service[method](userId, eventId, experienceId), { kind: "access_denied" });
    assert.equal(f.queries.length, 3); assert.equal(f.evaluations(), 0);
    const access = f.queries[1]; assert.deepEqual(access.params, [eventId, userId]);
    for (const expression of [/r.role='staff'/, /r.event_id=e.id/, /r.revoked_at IS NULL/, /u.is_active=true/, /u.email_verified_at IS NOT NULL/]) assert.match(access.text, expression);
  }
});
test("E08.4 consultas usam repeatable read read only, somente SELECTs e relógio PostgreSQL", async () => {
  for (const method of ["getStations", "getQueue"] as const) {
    const f = fixture(); await f.service[method](userId, eventId, experienceId);
    assert.equal(f.queries[0].text, "begin isolation level repeatable read read only");
    assert.equal(f.queries.at(-1)?.text, "commit"); assert.match(f.queries[1].text, /statement_timestamp\(\)/);
    assert.equal(f.queries.some(q => /\b(insert|update|delete|for share|for update)\b/i.test(q.text)), false);
  }
});
test("E08.4 evento sem estações retorna coleção vazia; experiência alheia recusa neutra", async () => {
  const f = fixture({ stations: [], queue: [] });
  assert.deepEqual(await f.service.getStations(userId, eventId), { kind: "ok", eventId, stations: [] });
  assert.deepEqual(await f.service.getQueue(userId, eventId, experienceId), { kind: "access_denied" });
  assert.equal(f.evaluations(), 0);
});
test("E08.4 FIFO e contagem são feitos no PostgreSQL sem converter queue_order bigint", async () => {
  const f = fixture(), r = await f.service.getQueue(userId, eventId, experienceId);
  assert.deepEqual(r, { kind: "ok", eventId, experienceId, observedAt: at, waitingCount: 2,
    acceptingNewEntries: true, canCallWaitingEntries: true, firstWaitingQueueEntryId: "first" });
  assert.equal(f.evaluations(), 1); const query = f.queries[2];
  assert.match(query.text, /status='waiting'/); assert.match(query.text, /ORDER BY queue_order, id LIMIT 1/);
  assert.match(query.text, /count\(\*\)::text/); assert.deepEqual(query.params, [eventId, experienceId, experienceId, eventId]);
});
test("E08.4 pausa, falta de estação ou corte de ingressos não fecham janela de chamada", async () => {
  for (const options of [{ queue: [{ ...queue, queueAcceptingEntries: false }] },
    { queue: [{ ...queue, hasAvailableStation: false }] }, { accepting: false }]) {
    const f = fixture(options), r = await f.service.getQueue(userId, eventId, experienceId);
    assert.ok(r.kind === "ok"); assert.equal(r.acceptingNewEntries, false);
    assert.equal(r.canCallWaitingEntries, true); assert.equal(r.waitingCount, 2); assert.equal(r.firstWaitingQueueEntryId, "first");
  }
});
test("E08.4 fim operacional impede chamadas e fila vazia conserva primeiro ID nulo", async () => {
  const f = fixture({ operating: false, accepting: false, queue: [{ ...queue, waitingCount: "0", firstWaitingQueueEntryId: null }] });
  const r = await f.service.getQueue(userId, eventId, experienceId); assert.ok(r.kind === "ok");
  assert.equal(r.canCallWaitingEntries, false); assert.equal(r.acceptingNewEntries, false);
  assert.equal(r.waitingCount, 0); assert.equal(r.firstWaitingQueueEntryId, null);
});
test("E08.4 contagem segura aceita limite e rejeita overflow, negativos e decimais", async () => {
  const f = fixture({ queue: [{ ...queue, waitingCount: String(Number.MAX_SAFE_INTEGER) }] });
  const r = await f.service.getQueue(userId, eventId, experienceId); assert.ok(r.kind === "ok"); assert.equal(r.waitingCount, Number.MAX_SAFE_INTEGER);
  for (const waitingCount of ["9007199254740992", "-1", "1.5", "garbage", "01"]) {
    const invalid = fixture({ queue: [{ ...queue, waitingCount }] });
    await assert.rejects(invalid.service.getQueue(userId, eventId, experienceId), /Contagem/);
    assert.equal(invalid.queries.at(-1)?.text, "rollback");
  }
});
test("E08.4 relógios inválidos falham sem resposta operacional inventada", async () => {
  for (const clock of [NaN, Infinity, 9e15]) {
    const f = fixture({ clock }); await assert.rejects(f.service.getQueue(userId, eventId, experienceId), /Instante PostgreSQL/);
    assert.equal(f.queries.at(-1)?.text, "rollback");
    const stations = fixture({ stations: [{ ...station, pendingCalledAtMs: clock }] });
    await assert.rejects(stations.service.getStations(userId, eventId), /Instante PostgreSQL/);
  }
});
