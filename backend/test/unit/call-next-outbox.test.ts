import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import {
  CALL_NEXT_OPERATION,
  CallNextService,
  createCallNextFingerprint,
} from "../../src/events/call-next.service";
import type { CallNextInput } from "../../src/events/call-next.types";
import type { QueueCallPushService } from "../../src/notifications/queue-call-push.service";

const input: CallNextInput = {
  staffUserId: "staff-1",
  eventId: "event-1",
  experienceId: "exp-1",
  stationId: "station-1",
  idempotencyKey: "call-intent-outbox",
  expiresAt: new Date("2099-01-01"),
};
const at = new Date("2026-11-10T12:00:00Z");

function createFixture(options: {
  isReplay?: boolean;
  failOutbox?: boolean;
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let triggerDispatchCalls = 0;

  const mockPushService: Partial<QueueCallPushService> = {
    triggerDispatch: () => {
      triggerDispatchCalls++;
    },
  };

  const payload = {
    serviceSession: {
      id: "session-1",
      queueEntryId: "entry-1",
      experienceId: input.experienceId,
      station: { id: input.stationId, label: "Estação 1" },
      status: "pending",
      calledAt: at.toISOString(),
    },
  };

  const client = {
    async query(config: { text: string }, params: unknown[]) {
      const text = config.text;
      queries.push({ text, params });

      if (text.includes("SELECT id FROM events")) return { rows: [{ id: input.eventId }] };
      if (text.includes("SELECT id FROM experiences")) return { rows: [{ id: input.experienceId }] };
      if (text.includes("SELECT availability, label")) return { rows: [{ availability: "available", label: "Estação 1" }] };
      if (text.includes("SELECT r.id FROM users")) return { rows: [{ id: "role-1" }] };

      if (text.includes('insert into "idempotency_operations"')) {
        return { rows: options.isReplay ? [] : [["reservation"]] };
      }
      if (text.includes('from "idempotency_operations"')) {
        return {
          rows: [
            [
              "reservation",
              createCallNextFingerprint(input.eventId, input.experienceId, input.stationId),
              options.isReplay ? "completed" : "in_progress",
              201,
              "session-1",
              payload,
            ],
          ],
        };
      }

      if (text.includes("AS operating")) return { rows: [{ operating: true }] };
      if (text.includes("WHERE station_id=")) return { rows: [] };
      if (text.includes('participation_id AS "participationId"')) return { rows: [{ id: "entry-1", participationId: "person-1" }] };
      if (text.includes('AS "currentId"')) return { rows: [{ status: "active", currentId: "entry-1", userId: "participant-user-1" }] };
      if (text.includes("SELECT id FROM queue_entries")) return { rows: [{ id: "entry-1" }] };
      if (text.includes("WHERE queue_entry_id=")) return { rows: [] };
      if (text.includes("INSERT INTO service_sessions")) return { rows: [{ calledAtMs: at.getTime() }] };
      if (text.includes("UPDATE queue_entries SET")) return { rows: [{ id: "entry-1" }] };

      if (text.includes("INSERT INTO queue_call_outbox")) {
        if (options.failOutbox) throw new Error("OUTBOX_INSERT_FAILED");
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('update "idempotency_operations"')) {
        return { rows: [["reservation", 201, "session-1", payload]] };
      }

      return { rows: [] };
    },
  };

  const db = drizzle(client as unknown as Client, { schema });
  const service = new CallNextService(db, mockPushService as QueueCallPushService);

  return {
    service,
    queries,
    getTriggerCalls: () => triggerDispatchCalls,
  };
}

test("CallNext outbox: nova chamada insere registro na queue_call_outbox e dispara triggerDispatch", async () => {
  const fixture = createFixture({ isReplay: false });
  const result = await fixture.service.callNext(input);

  assert.equal(result.kind, "created");
  const outboxQuery = fixture.queries.find((q) => q.text.includes("INSERT INTO queue_call_outbox"));
  assert.ok(outboxQuery, "Deveria ter executado INSERT na queue_call_outbox");
  assert.ok(outboxQuery.text.includes("service_session_id"));
  assert.ok(outboxQuery.text.includes("ON CONFLICT (service_session_id) DO NOTHING"));
  assert.equal(fixture.getTriggerCalls(), 1);
});

test("CallNext outbox: replay idempotente NÃO grava outbox e NÃO dispara triggerDispatch", async () => {
  const fixture = createFixture({ isReplay: true });
  const result = await fixture.service.callNext(input);

  assert.equal(result.kind, "replay");
  const outboxQuery = fixture.queries.find((q) => q.text.includes("INSERT INTO queue_call_outbox"));
  assert.equal(outboxQuery, undefined, "Replay idempotente não deve inserir na outbox");
  assert.equal(fixture.getTriggerCalls(), 0, "Replay idempotente não deve disparar triggerDispatch");
});

test("CallNext outbox: falha ao inserir na outbox reverte a transação de chamada", async () => {
  const fixture = createFixture({ isReplay: false, failOutbox: true });
  await assert.rejects(
    async () => fixture.service.callNext(input),
    (err: any) => err.message.includes("OUTBOX_INSERT_FAILED") || err.cause?.message === "OUTBOX_INSERT_FAILED",
  );
  assert.equal(fixture.getTriggerCalls(), 0);
});
