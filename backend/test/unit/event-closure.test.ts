import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { EventClosureService, AUTOMATIC_ADMIN_REASON, AUTOMATIC_OPERATIONAL_REASON } from "../../src/events/event-closure.service";

const deadlineAt = "2026-11-03T15:00:00.123456Z", executedAt = "2026-11-04T15:00:00.987654Z";
function fixture(options: { missing?: boolean; status?: string; due?: boolean; empty?: boolean; invalid?: boolean; pointers?: boolean;
  reason?: string; fail?: string; wrong?: string } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const count = options.empty ? 0 : 1;
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.includes("SELECT e.id FROM events")) return { rows: [{ id: "event-a" }, { id: "event-b" }] };
    if (text.includes("SELECT status FROM events")) return { rows: options.missing ? [] : [{ status: options.status ?? "open" }] };
    if (text.includes("AS valid")) return { rows: [{ valid: !options.invalid, pointers: options.pointers ?? false }] };
    const phase = text.includes("WITH decision") ? "event" : text.includes("WITH canceled") ? "services"
      : text.includes("WITH closed") ? "queues" : text.includes("WITH finished") ? "people" : undefined;
    if (phase && options.fail === phase) throw new Error("SQL_FAILURE");
    if (phase === "event") return { rows: options.due === false ? [] : [{ deadlineAt, executedAt, reason: options.reason ?? AUTOMATIC_OPERATIONAL_REASON }] };
    if (phase) return { rows: [{ count: options.wrong === phase ? count + 1 : count }] };
    if (text.includes("FROM (SELECT")) return { rows: [{ count }] };
    throw new Error(`SQL inesperado ${text}`);
  } } as unknown as Client, { schema });
  return { service: new EventClosureService(database), queries };
}

test("E08.9 regulariza em READ COMMITTED e preserva prazo lógico distinto da execução", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.regularizeEvent("event"), { kind: "closed", deadlineAt, executedAt, people: 1, queues: 1, services: 1 });
  assert.equal(f.queries[0].text, "begin isolation level read committed"); assert.equal(f.queries.at(-1)?.text, "commit");
  const locks = f.queries.filter(q => q.text.includes("FOR UPDATE")); assert.equal(locks.length, 6);
  for (const [i, name] of ["events", "experiences", "stations", "participations", "queue_entries", "service_sessions"].entries()) assert.ok(locks[i].text.includes(name));
  for (const q of locks.slice(1)) { assert.match(q.text, /ORDER BY/); assert.doesNotMatch(q.text, /SKIP LOCKED/); }
  assert.ok(f.queries.findIndex(q => q.text.includes("AS valid")) < f.queries.findIndex(q => q.text.includes("WITH decision")));
});
test("E08.9 cancela sem ator inventado, ausência ou conclusão e fecha somente correntes", async () => {
  const f = fixture(); await f.service.regularizeEvent("event");
  const mutations = f.queries.filter(q => /WITH (canceled|closed|finished)/.test(q.text));
  assert.equal(mutations.length, 3);
  for (const q of mutations) { assert.match(q.text, /LEAST\(e.operational_deadline_at,e.admin_deadline_at\)/); assert.ok(q.params.includes(AUTOMATIC_OPERATIONAL_REASON)); }
  assert.match(mutations[0].text, /resolved_by_user_id=NULL/); assert.match(mutations[0].text, /s.status='pending'/);
  assert.match(mutations[1].text, /q.status IN \('waiting','called'\)/);
  assert.match(mutations[2].text, /p.status IN \('waiting','active'\)/); assert.match(mutations[2].text, /current_queue_entry_id=NULL/);
  assert.equal(f.queries.some(q => /INSERT INTO|status='completed'|status='absent'|SET availability|SET closure_mode|last_queue_order=|external_last_order=/.test(q.text)), false);
});
test("E08.9 relógio decisivo após locks usa limite inclusivo e LEAST mesmo em dados incoerentes", async () => {
  const f = fixture({ reason: AUTOMATIC_ADMIN_REASON }); await f.service.regularizeEvent("event");
  const decision = f.queries.find(q => q.text.includes("WITH decision"))!;
  assert.match(decision.text, /clock_timestamp\(\)/); assert.match(decision.text, /LEAST\(e.operational_deadline_at,e.admin_deadline_at\)<=d.at/);
  assert.match(decision.text, /updated_at=d.at/); assert.match(decision.text, /HH24:MI:SS.US/);
  assert.ok(f.queries.find(q => q.text.includes("WITH finished"))!.params.includes(AUTOMATIC_ADMIN_REASON));
  assert.ok(AUTOMATIC_ADMIN_REASON.length <= 40 && AUTOMATIC_OPERATIONAL_REASON.length <= 40);
});
for (const status of ["open", "scheduled", "closing"]) test(`E08.9 ${status} antes do prazo não muda estado`, async () => {
  const f = fixture({ due: false, status }); assert.deepEqual(await f.service.regularizeEvent("event"), { kind: "not_due" });
  assert.equal(f.queries.some(q => /WITH (canceled|closed|finished)/.test(q.text)), false);
});
test("E08.9 evento vazio vencido fecha sem Staff, capacidade ou participação", async () => {
  const f = fixture({ empty: true }); const r = await f.service.regularizeEvent("event");
  assert.deepEqual(r, { kind: "closed", deadlineAt, executedAt, people: 0, queues: 0, services: 0 });
  assert.equal(f.queries.some(q => /user_roles|sessions WHERE|availability='available'/.test(q.text)), false);
});
test("E08.9 evento fechado íntegro é no-op inclusive para Admin imediato", async () => {
  const f = fixture({ status: "closed", empty: true }); assert.deepEqual(await f.service.regularizeEvent("event"), { kind: "already_closed" });
  assert.equal(f.queries.some(q => q.text.includes("WITH decision")), false);
});
for (const options of [{ status: "closed" }, { status: "closed", empty: true, pointers: true }, { invalid: true }]) test(`E08.9 integridade não é ocultada ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); await assert.rejects(f.service.regularizeEvent("event"), /EVENT_CLOSURE_INTEGRITY/);
  assert.equal(f.queries.at(-1)?.text, "rollback"); assert.equal(f.queries.some(q => q.text.includes("WITH decision")), false);
});
test("E08.9 evento ausente/bloqueado não adquire recursos ou produz efeitos", async () => {
  const f = fixture({ missing: true }); assert.deepEqual(await f.service.regularizeEvent("event", true), { kind: "unavailable" });
  assert.match(f.queries[1].text, /FOR UPDATE SKIP LOCKED/); assert.equal(f.queries.length, 3);
});
for (const phase of ["event", "services", "queues", "people"]) test(`E08.9 erro SQL em ${phase} reverte transação`, async () => {
  const f = fixture({ fail: phase }); await assert.rejects(f.service.regularizeEvent("event")); assert.equal(f.queries.at(-1)?.text, "rollback");
  assert.equal(f.queries.some(q => q.text === "commit"), false);
});
for (const wrong of ["services", "queues", "people"]) test(`E08.9 contagem ${wrong} divergente aborta todos os efeitos`, async () => {
  const f = fixture({ wrong }); await assert.rejects(f.service.regularizeEvent("event"), /EVENT_CLOSURE_INTEGRITY/); assert.equal(f.queries.at(-1)?.text, "rollback");
});
test("E08.9 descoberta paginada inclui fechado incompatível e limita resposta", async () => {
  const f = fixture(); assert.deepEqual(await f.service.findCandidates(null), ["event-a", "event-b"]); await f.service.findCandidates("event-b");
  assert.ok(f.queries[0].params.includes(100)); assert.ok(f.queries[1].params.includes("event-b"));
  assert.match(f.queries[0].text, /e.status='closed'/); assert.match(f.queries[0].text, /ORDER BY e.id LIMIT/);
});
