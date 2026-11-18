import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { ParticipationsService } from "../../src/participations/participations.service";

const eventId = "550e8400-e29b-41d4-a716-446655440101";
const userId = "550e8400-e29b-41d4-a716-446655440102";
const versionId = "550e8400-e29b-41d4-a716-446655440103";
const midnight = BigInt(Date.UTC(2030, 0, 1)) * 1000n;
const input = { eventId, userId, idempotencyKey: "join-precision", expiresAt: new Date("2030-01-02") };

function fixture(clockFractions: number[]) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const clocks = [...clockFractions];
  const database = drizzle({
    async query({ text }: { text: string }, params: unknown[]) {
      queries.push({ text, params });
      if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
      if (text.includes("WITH instant AS MATERIALIZED")) {
        assert.match(text, /clock_timestamp\(\)/);
        assert.match(text, /extract\(epoch from at\) \* 1000000\)::text AS micros/);
        const fraction = clocks.shift();
        assert.ok(fraction !== undefined, "consulta inesperada ao relógio");
        const iso = `2030-01-01T00:00:00.${String(fraction).padStart(6, "0")}Z`;
        return { rows: [{ micros: (midnight + BigInt(fraction)).toString(), iso }] };
      }
      if (text.includes('from "events"')) {
        if (text.includes("for update")) return { rows: [[eventId]] };
        if (!text.includes("extract(epoch")) {
          assert.match(text, /^select "external_queue_enabled"/);
          return { rows: [[false]] };
        }
        for (const column of ["starts_at", "official_ends_at", "operational_deadline_at", "closure_requested_at"]) {
          assert.ok(text.includes(`extract(epoch from "${column}") * 1000000)::text`), column);
        }
        return { rows: [[eventId, (midnight + 123n).toString(), (midnight + 456n).toString(),
          (midnight + 456n).toString(), null, null, "ArenaGo", "ARENA-2030", "UTC", false, "scheduled"]] };
      }
      if (text.includes('from "users"')) return { rows: [[userId, true]] };
      if (text.includes('from "user_roles"') || text.includes('from "stations"')) return { rows: [[eventId]] };
      if (text.includes('left join "questionnaire_versions"')) {
        const facts = [new Date(0), versionId, new Date(0)];
        return { rows: [text.startsWith('select "profiles"."user_id"') ? [userId, ...facts] : facts] };
      }
      if (text.includes('from "profiles"')) return { rows: [[null, null, null, null, null, versionId]] };
      if (text.includes('from "user_games"')) return { rows: [[eventId, "Arena", true]] };
      if (text.includes('from "participations"')) return { rows: [] };
      if (text.startsWith('insert into "idempotency_operations"')) return { rows: [[eventId]] };
      if (text.startsWith('update "idempotency_operations"')) return { rows: [[eventId, 201, eventId, {}]] };
      if (text.startsWith('insert into "participations"') || text.startsWith('insert into "participation_profile_snapshots"')) {
        return { rows: [] };
      }
      throw new Error(`SQL inesperado: ${text}`);
    },
  } as unknown as Client, { schema });
  const events = new EventsService(database);
  return { service: new ParticipationsService(database, events), events, queries };
}

test("lookup usa o relógio do PostgreSQL e lê o início sem truncar a precisão persistida", async () => {
  const f = fixture([122, 123]);
  const before = await f.service.evaluateJoinEligibility(userId, eventId);
  assert.deepEqual(before.blockingReasons, ["EVENT_NOT_STARTED"]);
  assert.equal((await f.service.evaluateJoinEligibility(userId, eventId)).eligible, true);
});

test("ingresso admite um microssegundo antes do corte e grava o mesmo instante decisivo", async () => {
  const f = fixture([123, 455]);
  assert.equal((await f.service.createParticipation(input)).kind, "created");
  const participation = f.queries.find(q => q.text.startsWith('insert into "participations"'));
  const snapshot = f.queries.find(q => q.text.startsWith('insert into "participation_profile_snapshots"'));
  assert.ok(participation);
  assert.ok(snapshot);
  const decision = "2030-01-01T00:00:00.000455Z";
  assert.equal(participation.params.filter(param => param === decision).length, 2);
  assert.ok(snapshot.params.includes(decision));
  assert.equal(f.queries.at(-1)?.text, "commit");
});

test("ingresso revalida o corte exclusivo no instante decisivo e reverte a reserva", async () => {
  const f = fixture([123, 456]);
  const result = await f.service.createParticipation(input);
  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") assert.fail("esperava bloqueio no limite oficial");
  assert.deepEqual(result.eligibility.blockingReasons, ["EVENT_REGISTRATION_CLOSED"]);
  assert.equal(f.queries.some(q => q.text.startsWith('insert into "participations"')), false);
  assert.equal(f.queries.at(-1)?.text, "rollback");
});

test("disponibilidade aceita a referência Date legada e mantém o formato de cutoffAt", async () => {
  const f = fixture([]);
  const result = await f.events.evaluateEventAvailabilityById(eventId, new Date("2030-01-01T00:00:00.000Z"));
  if (!result.eventExists) assert.fail("esperava evento existente");
  assert.equal(result.ready, true);
  assert.equal(result.withinEntryWindow, false);
  assert.deepEqual(result.missing, ["EVENT_NOT_STARTED"]);
  assert.equal(result.cutoffAt.toISOString(), "2030-01-01T00:00:00.000Z");
});
