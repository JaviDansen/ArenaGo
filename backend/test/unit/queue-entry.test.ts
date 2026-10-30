import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { createQueueJoinFingerprint, QueueEntryService } from "../../src/events/queue-entry.service";
import type { EventAvailabilityMissingCode, EventAvailabilityResult } from "../../src/events/event-availability";

const input = {
  userId: "00000000-0000-4000-8000-000000000001",
  participationId: "00000000-0000-4000-8000-000000000002",
  experienceId: "00000000-0000-4000-8000-000000000003",
  idempotencyKey: "intention", expiresAt: new Date("2099-01-01T00:00:00Z"),
};
const eventId = "00000000-0000-4000-8000-000000000004";
const enteredAt = new Date("2026-10-30T15:00:00Z");
const order = "9007199254741001";

function fixture(options: {
  access?: boolean; revalidated?: boolean; experience?: boolean; status?: string;
  currentPointer?: boolean; currentRow?: boolean; accepting?: boolean;
  station?: boolean; staff?: boolean; missing?: EventAvailabilityMissingCode[];
  reservation?: "new" | "replay" | "conflict" | "in_progress";
  fail?: "insert" | "pointer" | "complete"; decisionExpired?: boolean; clock?: number;
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const payload = { queueEntryId: input.experienceId, participationId: input.participationId,
    experienceId: input.experienceId, status: "waiting", queueOrder: order, enteredAt: enteredAt.toISOString() };
  const client = {
    async query(config: { text: string }, params: unknown[]) {
      const text = config.text;
      queries.push({ text, params });
      if (text.includes('event_id AS "eventId"')) return { rows: options.access === false ? [] : [{ eventId }] };
      if (text.includes("FROM events WHERE")) return { rows: [{ id: eventId }] };
      if (text.includes("AS accepting FROM experiences")) return { rows: options.experience === false ? [] : [{ accepting: options.accepting ?? true }] };
      if (text.includes("SELECT id FROM stations")) return { rows: options.station === false ? [] : [{ id: "station" }] };
      if (text.includes('AS "currentId"')) return { rows: options.revalidated === false ? [] : [{ status: options.status ?? "active", currentId: options.currentPointer ? "current" : null }] };
      if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation && options.reservation !== "new" ? [] : [["reservation"]] };
      if (text.includes('from "idempotency_operations"')) return { rows: [[
        "reservation", options.reservation === "conflict" ? "different" : createQueueJoinFingerprint(input.participationId, input.experienceId),
        options.reservation === "in_progress" ? "in_progress" : "completed", 201, input.experienceId, payload,
      ]] };
      if (text.includes("SELECT id FROM queue_entries")) return { rows: options.currentRow ? [{ id: "current" }] : [] };
      if (text.includes("SELECT r.id FROM user_roles")) return { rows: options.staff === false ? [] : [{ id: "staff" }] };
      if (text.includes('AS "atMs"')) return { rows: [{ atMs: options.clock ?? enteredAt.getTime() }] };
      if (text.includes("WITH decision AS MATERIALIZED")) return { rows: options.decisionExpired ? [] : [{ queueOrder: order, enteredAtMs: enteredAt.getTime() }] };
      if (text.includes('insert into "queue_entries"') && options.fail === "insert") throw new Error("injected insert failure");
      if (text.includes("UPDATE participations SET") && options.fail === "pointer") throw new Error("injected pointer failure");
      if (text.includes('update "idempotency_operations"')) {
        if (options.fail === "complete") throw new Error("injected complete failure");
        return { rows: [["reservation", 201, input.experienceId, payload]] };
      }
      return { rows: [] };
    },
  };
  const database = drizzle(client as unknown as Client, { schema });
  const events = new EventsService(database);
  events.evaluateEventAvailabilityById = async (id, at, tx): Promise<EventAvailabilityResult> => {
    assert.equal(id, eventId); assert.equal(at.getTime(), enteredAt.getTime()); assert.notEqual(tx, database);
    const missing = options.missing ?? [];
    return { eventExists: true, eventId, ready: !missing.length, withinEntryWindow: !missing.length,
      eventAcceptingNewEntries: !missing.length, missing, cutoffAt: new Date("2099-01-01"),
      checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
        hasAvailableStation: true, hasAuthorizedStaff: true, hasOperationalCapacity: true } };
  };
  return { service: new QueueEntryService(database, events), queries };
}

test("E07.1 fingerprint inclui ambos os IDs e separa operação da E03", () => {
  const hash = createQueueJoinFingerprint("p", "e");
  assert.equal(hash, createQueueJoinFingerprint("p", "e"));
  assert.notEqual(hash, createQueueJoinFingerprint("p2", "e"));
  assert.notEqual(hash, createQueueJoinFingerprint("p", "e2"));
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("E07.1 cria contrato exato e segue locks, relógio decisivo e escrita atômica", async () => {
  const { service, queries } = fixture();
  const result = await service.joinExperienceQueue(input);
  assert.equal(result.kind, "created");
  if (result.kind !== "created") assert.fail();
  assert.equal(result.queueOrder, order); assert.equal(result.status, "waiting");
  assert.equal(result.enteredAt.toISOString(), enteredAt.toISOString());
  assert.equal(result.participationId, input.participationId);
  assert.equal(result.experienceId, input.experienceId);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(queries[0].text, "begin isolation level read committed");
  const index = (fragment: string) => queries.findIndex(q => q.text.includes(fragment));
  assert.ok(index("FROM events WHERE") < index("AS accepting FROM experiences"));
  assert.ok(index("AS accepting FROM experiences") < index('AS "currentId"'));
  assert.ok(index('AS "currentId"') < index("SELECT id FROM queue_entries"));
  assert.ok(index("SELECT r.id FROM user_roles") < index('AS "atMs"'));
  const decisive = queries[index("WITH decision AS MATERIALIZED")].text;
  assert.match(decisive, /clock_timestamp\(\)/); assert.match(decisive, /d.at < v.official_ends_at/);
  assert.match(decisive, /d.at < v.closure_requested_at/);
  assert.match(decisive, /last_queue_order=e.last_queue_order\+1/);
  assert.ok(index('insert into "queue_entries"') < index("UPDATE participations SET"));
  assert.ok(index("UPDATE participations SET") < index('update "idempotency_operations"'));
  assert.equal(queries.at(-1)?.text, "commit");
});

for (const [label, options, expected] of [
  ["inexistente/outro titular", { access: false }, "access_denied"],
  ["revalidação após locks", { revalidated: false }, "access_denied"],
  ["experiência de outro evento", { experience: false }, "access_denied"],
  ...["waiting", "finished", "canceled"].map(status => [status, { status }, "participation_not_active"] as const),
  ["ponteiro corrente", { currentPointer: true }, "queue_occupied"],
  ["entrada waiting/called sem ponteiro", { currentRow: true }, "queue_occupied"],
  ["fila fechada", { accepting: false }, "queue_closed"],
  ["sem estação protegida", { station: false }, "experience_unavailable"],
  ["sem Staff protegido", { staff: false }, "event_unavailable"],
  ["corte durante consulta", { decisionExpired: true }, "event_closed"],
] as const) {
  test(`E07.1 bloqueia ${label} com rollback e sem inserir fila`, async () => {
    const { service, queries } = fixture(options);
    assert.equal((await service.joinExperienceQueue(input)).kind, expected);
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes('insert into "queue_entries"')), false);
  });
}

test("E07.1 prontidão/capacidade e cortes permanecem distintos", async () => {
  for (const code of ["EVENT_HAS_NO_AVAILABLE_STATION", "EVENT_HAS_NO_AUTHORIZED_STAFF", "EVENT_NAME_OR_ACCESS_CODE_INVALID",
    "EVENT_NOT_STARTED", "EVENT_ENTRY_CLOSED", "EVENT_ADMIN_CLOSING", "EVENT_CLOSED"] as const) {
    const { service, queries } = fixture({ missing: [code] });
    const result = await service.joinExperienceQueue(input);
    assert.equal(result.kind, ["EVENT_NOT_STARTED", "EVENT_ENTRY_CLOSED", "EVENT_ADMIN_CLOSING", "EVENT_CLOSED"].includes(code) ? "event_closed" : "event_unavailable");
    assert.equal(queries.some(q => q.text.includes("WITH decision AS MATERIALIZED")), false);
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});

test("E07.1 replay histórico ignora estado atual; conflito e in_progress não mutam domínio", async () => {
  for (const reservation of ["replay", "conflict", "in_progress"] as const) {
    const { service, queries } = fixture({ reservation, status: "finished", currentRow: true });
    const result = await service.joinExperienceQueue(input);
    assert.equal(result.kind, reservation === "conflict" ? "request_conflict" : reservation);
    if (result.kind === "replay") { assert.equal(result.queueOrder, order); assert.deepEqual(result.enteredAt, enteredAt); }
    assert.equal(queries.some(q => q.text.includes("WITH decision AS MATERIALIZED")), false);
    assert.equal(queries.at(-1)?.text, "commit");
  }
});

test("E07.1 falhas intermediárias e relógio inválido fazem rollback", async () => {
  for (const fail of ["insert", "pointer", "complete"] as const) {
    const { service, queries } = fixture({ fail });
    await assert.rejects(service.joinExperienceQueue(input), (error: Error) => {
      assert.match(String(error.cause ?? error), /injected/);
      return true;
    });
    assert.equal(queries.at(-1)?.text, "rollback");
  }
  const badClock = fixture({ clock: NaN });
  await assert.rejects(badClock.service.joinExperienceQueue(input), /Relógio PostgreSQL/);
  assert.equal(badClock.queries.at(-1)?.text, "rollback");
});

test("E07.1 rejeita chave/expiração inválidas antes de abrir transação", async () => {
  const { service, queries } = fixture();
  for (const overrides of [{ idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }, { expiresAt: new Date(NaN) }]) {
    await assert.rejects(service.joinExperienceQueue({ ...input, ...overrides }), /inválida/);
  }
  assert.equal(queries.length, 0);
});
