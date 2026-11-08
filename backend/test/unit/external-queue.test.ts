import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { buildEventAvailabilityResult, evaluateEventConfigurationReadiness } from "../../src/events/event-availability";
import { evaluateEventEntryWindow } from "../../src/events/event-entry-window";
import { buildEventOperationalCapacityResult } from "../../src/events/event-operational-capacity";
import { EventsService } from "../../src/events/events.service";
import { ParticipationsService } from "../../src/participations/participations.service";

const eventId = "00000000-0000-4000-8000-000000000001";
const decisionAt = new Date("2026-10-28T15:00:00Z");

function fixture(options: {
  enabled?: boolean;
  exists?: boolean;
  clock?: number;
  status?: string;
  startsAt?: Date;
  officialEndsAt?: Date;
  closureRequestedAt?: Date | null;
  hasStaff?: boolean;
  hasStation?: boolean;
  failRelease?: boolean;
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const client = {
    async query(config: { text: string }, params: unknown[]) {
      const query = config.text;
      queries.push({ text: query, params });
      if (query.startsWith("select") && query.includes('from "events"')) {
        return { rows: options.exists === false ? [] : [[options.enabled ?? true]], rowCount: 1 };
      }
      if (query.startsWith("SELECT") && query.includes("clock_timestamp()")) {
        return { rows: [{ decisionAtMs: options.clock ?? decisionAt.getTime() }], rowCount: 1 };
      }
      if (query.startsWith('update "participations"')) {
        if (options.failRelease) throw new Error("falha de persistência da liberação");
        return { rows: [], rowCount: 3 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const database = drizzle(client as unknown as Client, { schema });
  const events = new EventsService(database);
  events.evaluateEventAvailabilityById = async (id, at, executor) => {
    assert.equal(id, eventId);
    assert.equal(at.getTime(), decisionAt.getTime());
    assert.notEqual(executor, database, "a disponibilidade precisa usar a mesma transação");
    const event = {
      name: "E05 unit",
      accessCodeNormalized: "E05-UNIT",
      timezone: "America/Sao_Paulo",
      externalQueueEnabled: options.enabled ?? true,
      startsAt: options.startsAt ?? new Date("2026-10-28T14:00:00Z"),
      officialEndsAt: options.officialEndsAt ?? new Date("2026-10-28T16:00:00Z"),
      operationalDeadlineAt: new Date("2026-10-28T17:00:00Z"),
      closureRequestedAt: options.closureRequestedAt ?? null,
      adminDeadlineAt: null,
    };
    return buildEventAvailabilityResult({
      eventId: id,
      eventStatus: options.status ?? "open",
      configuration: evaluateEventConfigurationReadiness(event),
      entryWindow: evaluateEventEntryWindow(event, at),
      operationalCapacity: buildEventOperationalCapacityResult(
        options.hasStaff ?? true, options.hasStation ?? true,
      ),
    });
  };
  return { service: new ParticipationsService(database, events), queries };
}

test("E05 libera waiting na mesma transação e usa o relógio após todos os locks", async () => {
  const { service, queries } = fixture();
  assert.deepEqual(await service.setExternalQueueEnabled(eventId, false), {
    kind: "changed", eventId, externalQueueEnabled: false, releasedCount: 3, changedAt: decisionAt,
  });
  assert.equal(queries[0].text, "begin isolation level read committed");
  assert.match(queries[1].text, /from "events".*for update/);
  assert.match(queries[2].text, /from "participations".*order by.*for update/);
  assert.deepEqual(queries[2].params, [eventId, "waiting"]);
  assert.match(queries[3].text, /clock_timestamp\(\)/);
  const writes = queries.filter((q) => q.text.startsWith("update"));
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /^update "events" set "external_queue_enabled" = \$1, "updated_at" = \$2 where/);
  assert.deepEqual(writes[0].params, [false, decisionAt.toISOString(), eventId]);
  assert.match(writes[1].text, /^update "participations" set "status" = \$1, "arena_entered_at" = \$2 where/);
  assert.deepEqual(writes[1].params, ["active", decisionAt.toISOString(), eventId, "waiting"]);
  assert.equal(queries.at(-1)?.text, "commit");
});

test("E05 reativação só muda o evento; repetições não escrevem nem consultam novo horário", async () => {
  const enabling = fixture({ enabled: false });
  const result = await enabling.service.setExternalQueueEnabled(eventId, true);
  assert.equal(result.kind, "changed");
  if (result.kind === "changed") assert.equal(result.releasedCount, 0);
  assert.equal(enabling.queries.some((q) => q.text.includes('"participations"')), false);
  for (const enabled of [false, true]) {
    const repeated = fixture({ enabled, status: "closed" });
    assert.deepEqual(await repeated.service.setExternalQueueEnabled(eventId, enabled), {
      kind: "unchanged", eventId, externalQueueEnabled: enabled, releasedCount: 0,
    });
    assert.equal(repeated.queries.length, 3); // BEGIN, lock/leitura do evento, COMMIT.
  }
});

test("E05 evento ausente não altera dados", async () => {
  const { service, queries } = fixture({ exists: false });
  assert.deepEqual(await service.setExternalQueueEnabled(eventId, false), { kind: "event_not_found" });
  assert.equal(queries.length, 3);
});

test("E05 início inclusivo permite mudança; cortes exatos, fechamento e falta de prontidão bloqueiam", async () => {
  const atStart = fixture({ startsAt: decisionAt });
  assert.equal((await atStart.service.setExternalQueueEnabled(eventId, false)).kind, "changed");
  const cases = [
    { startsAt: new Date(decisionAt.getTime() + 1) },
    { officialEndsAt: decisionAt },
    { closureRequestedAt: decisionAt },
    { status: "closing" },
    { status: "closed" },
    { hasStaff: false },
    { hasStation: false },
  ];
  for (const options of cases) {
    for (const enabled of [true, false]) {
      const { service, queries } = fixture({ ...options, enabled: !enabled });
      const result = await service.setExternalQueueEnabled(eventId, enabled);
      assert.equal(result.kind, "blocked", JSON.stringify(options));
      assert.equal(queries.some((q) => q.text.startsWith("update")), false);
    }
  }
});

test("E05 relógio inválido e falha na liberação abortam a transação", async () => {
  for (const clock of [NaN, Infinity, 9e15]) {
    const { service, queries } = fixture({ clock });
    await assert.rejects(service.setExternalQueueEnabled(eventId, false), /PostgreSQL/);
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some((q) => q.text.startsWith("update")), false);
  }
  const failed = fixture({ failRelease: true });
  await assert.rejects(failed.service.setExternalQueueEnabled(eventId, false));
  assert.equal(failed.queries.at(-1)?.text, "rollback");
});
