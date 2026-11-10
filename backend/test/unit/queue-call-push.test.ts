import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import {
  QueueCallPushService,
  type PushHttpTransport,
} from "../../src/notifications/queue-call-push.service";
import { DeviceTokensService } from "../../src/notifications/device-tokens.service";

const sessionId = "11111111-1111-4000-8000-000000000001";
const userId = "22222222-2222-4000-8000-000000000002";
const eventId = "33333333-3333-4000-8000-000000000003";
const experienceId = "44444444-4444-4000-8000-000000000004";
const participationId = "55555555-5555-4000-8000-000000000005";
const pushToken = "ExponentPushToken[unit-test-token-abcdef]";

test("QueueCallPushService: inserção da outbox cria payload estritamente silencioso (sem title/body/message)", async () => {
  let capturedQuery: string = "";
  const client = {
    async query(config: { text: string }) {
      capturedQuery = config.text;
      return { rows: [] };
    },
  };
  const db = drizzle(client as unknown as Client, { schema });

  const service = new QueueCallPushService(db, null as any);
  const outboxId = await service.createOutboxEntryWithTx(db as any, {
    sessionId,
    userId,
    eventId,
    experienceId,
    participationId,
    calledAt: new Date("2026-11-10T12:00:00Z"),
  });

  assert.ok(typeof outboxId === "string" && outboxId.length > 0);
  assert.ok(capturedQuery.includes("queue_call_outbox"));
  // Garante que campos visuais proibidos NÃO constam no SQL/payload
  assert.equal(capturedQuery.includes('"title"'), false);
  assert.equal(capturedQuery.includes('"body"'), false);
  assert.equal(capturedQuery.includes('"message"'), false);
});

test("QueueCallPushService: descarta chamadas encerradas ou invalidadas (status !== pending)", async () => {
  const updates: string[] = [];
  const client = {
    async query(config: { text: string }) {
      const text = config.text;
      if (text.includes("FROM queue_call_outbox")) {
        return {
          rows: [
            {
              id: "outbox-1",
              serviceSessionId: sessionId,
              userId,
              eventId,
              experienceId,
              payload: {
                type: "queue.called" as const,
                serviceSessionId: sessionId,
                participationId,
                eventId,
                version: 1 as const,
              },
              attempts: 0,
            },
          ],
        };
      }
      if (text.includes("FROM service_sessions")) {
        // Sessão já foi concluída ou cancelada antes do envio
        return { rows: [{ status: "completed" }] };
      }
      if (text.includes("UPDATE queue_call_outbox")) {
        updates.push(text);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
  const db = drizzle(client as unknown as Client, { schema });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(db, mockDeviceTokensService);
  const result = await service.dispatchPending();

  assert.equal(result.processed, 1);
  assert.equal(result.expired, 1);
  assert.equal(result.delivered, 0);
  assert.ok(updates.some((u) => u.includes("expired")));
});

test("QueueCallPushService: envio silencioso data-only com prioridade alta e contentAvailable", async () => {
  const dispatchedRequests: any[] = [];
  const mockTransport: PushHttpTransport = async (url, options) => {
    dispatchedRequests.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: "ok", id: "ticket-1" }],
      }),
    };
  };

  const client = {
    async query(config: { text: string }) {
      const text = config.text;
      if (text.includes("FROM queue_call_outbox")) {
        return {
          rows: [
            {
              id: "outbox-1",
              serviceSessionId: sessionId,
              userId,
              eventId,
              experienceId,
              payload: {
                type: "queue.called" as const,
                serviceSessionId: sessionId,
                participationId,
                eventId,
                version: 1 as const,
              },
              attempts: 0,
            },
          ],
        };
      }
      if (text.includes("FROM service_sessions")) {
        return { rows: [{ status: "pending" }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const db = drizzle(client as unknown as Client, { schema });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(db, mockDeviceTokensService, mockTransport);

  const result = await service.dispatchPending();
  assert.equal(result.delivered, 1);
  assert.equal(dispatchedRequests.length, 1);

  const req = dispatchedRequests[0];
  assert.equal(req.url, "https://exp.host/--/api/v2/push/send");
  const msg = req.body[0];
  assert.equal(msg.to, pushToken);
  assert.equal(msg.priority, "high");
  assert.equal(msg._contentAvailable, true);
  // Garante que não possui campos de notificação visual
  assert.equal(msg.title, undefined);
  assert.equal(msg.body, undefined);
  assert.equal(msg.message, undefined);
  assert.equal(msg.sound, undefined);
  assert.equal(msg.data.type, "queue.called");
  assert.equal(msg.data.serviceSessionId, sessionId);
});

test("QueueCallPushService: trata DeviceNotRegistered revogando o token", async () => {
  const revokedTokens: string[] = [];
  const mockTransport: PushHttpTransport = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ status: "error", message: "DeviceNotRegistered", details: { error: "DeviceNotRegistered" } }],
    }),
  });

  const client = {
    async query(config: { text: string }) {
      const text = config.text;
      if (text.includes("FROM queue_call_outbox")) {
        return {
          rows: [
            {
              id: "outbox-1",
              serviceSessionId: sessionId,
              userId,
              eventId,
              experienceId,
              payload: {
                type: "queue.called" as const,
                serviceSessionId: sessionId,
                participationId,
                eventId,
                version: 1 as const,
              },
              attempts: 0,
            },
          ],
        };
      }
      if (text.includes("FROM service_sessions")) {
        return { rows: [{ status: "pending" }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const db = drizzle(client as unknown as Client, { schema });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async (t: string) => {
      revokedTokens.push(t);
    },
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(db, mockDeviceTokensService, mockTransport);

  const result = await service.dispatchPending();
  assert.equal(result.delivered, 1);
  assert.deepEqual(revokedTokens, [pushToken]);
});
