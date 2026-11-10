import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import {
  EXPO_PUSH_URL,
  EXPO_RECEIPTS_URL,
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_RETRY_DELAYS_SECONDS,
  QueueCallPushService,
  getOutboxRetryDelaySeconds,
  type PushHttpTransport,
  type QueueCallOutboxPayload,
} from "../../src/notifications/queue-call-push.service";
import { DeviceTokensService } from "../../src/notifications/device-tokens.service";

const sessionId = "11111111-1111-4000-8000-000000000001";
const userId = "22222222-2222-4000-8000-000000000002";
const eventId = "33333333-3333-4000-8000-000000000003";
const experienceId = "44444444-4444-4000-8000-000000000004";
const participationId = "55555555-5555-4000-8000-000000000005";
const pushToken = "ExponentPushToken[unit-test-token-abcdef]";

interface SimulatedOutboxRow {
  id: string;
  serviceSessionId: string;
  userId: string;
  eventId: string;
  experienceId: string;
  payload: QueueCallOutboxPayload;
  status: string;
  attempts: number;
  nextAttemptAtMs: number | null;
  lockedAtMs: number | null;
  ticketId: string | null;
  lastError: string | null;
  createdAtMs: number;
  processedAtMs: number | null;
}

function createStatefulOutboxDb(options: {
  initialRows: SimulatedOutboxRow[];
  sessionStatus?: string;
  nowMs?: () => number;
}) {
  const rows = options.initialRows.map((r) => ({ ...r }));
  const getNow = options.nowMs ?? (() => Date.now());
  const sessionStatus = options.sessionStatus ?? "pending";
  const queries: Array<{ text: string; values: unknown[] }> = [];

  const client = {
    async query(config: { text: string; values?: unknown[] }, extraValues?: unknown[]) {
      const text = config.text;
      const values = config.values ?? extraValues ?? [];
      queries.push({ text, values });
      const now = getNow();

      // 1. Limpeza de processing órfãos esgotados
      if (text.includes("AND attempts >=") && text.includes("SET status = 'failed'")) {
        const lockTimeoutSec = Number(values[0] ?? 60);
        const maxAttempts = Number(values[1] ?? 3);
        const updated: Array<{ id: string }> = [];
        for (const row of rows) {
          if (
            row.status === "processing" &&
            row.lockedAtMs !== null &&
            row.lockedAtMs <= now - lockTimeoutSec * 1000 &&
            row.attempts >= maxAttempts
          ) {
            row.status = "failed";
            row.lockedAtMs = null;
            row.processedAtMs = now;
            row.lastError = row.lastError ?? "Processamento interrompido após atingir o limite máximo de tentativas";
            updated.push({ id: row.id });
          }
        }
        return { rows: updated, rowCount: updated.length };
      }

      // 2. Reserva atômica de registros pendentes ou órfãos em processing
      if (text.includes("SET status = 'processing'") && text.includes("FOR UPDATE SKIP LOCKED")) {
        const lockTimeoutSec = Number(values[0] ?? 60);
        const maxAttempts = Number(values[1] ?? 3);
        const claimed: unknown[] = [];
        for (const row of rows) {
          const isEligiblePending =
            row.status === "pending" &&
            (row.nextAttemptAtMs === null || row.nextAttemptAtMs <= now);
          const isStaleProcessing =
            row.status === "processing" &&
            row.lockedAtMs !== null &&
            row.lockedAtMs <= now - lockTimeoutSec * 1000;

          if ((isEligiblePending || isStaleProcessing) && row.attempts < maxAttempts) {
            row.status = "processing";
            row.attempts += 1;
            row.lockedAtMs = now;
            claimed.push({
              id: row.id,
              serviceSessionId: row.serviceSessionId,
              userId: row.userId,
              eventId: row.eventId,
              experienceId: row.experienceId,
              payload: row.payload,
              attempts: row.attempts,
            });
          }
        }
        return { rows: claimed, rowCount: claimed.length };
      }

      // 3. Verificação da service_session
      if (text.includes("FROM service_sessions")) {
        if (sessionStatus === "missing") return { rows: [], rowCount: 0 };
        return { rows: [{ status: sessionStatus }], rowCount: 1 };
      }

      // 4. Reserva para verificação de recibos de registros accepted
      if (text.includes("WHERE status = 'accepted'") && text.includes("FOR UPDATE SKIP LOCKED")) {
        const lockTimeoutSec = Number(values[0] ?? 60);
        const claimedAccepted: unknown[] = [];
        for (const row of rows) {
          if (
            row.status === "accepted" &&
            row.ticketId !== null &&
            (row.lockedAtMs === null || row.lockedAtMs <= now - lockTimeoutSec * 1000)
          ) {
            row.lockedAtMs = now;
            claimedAccepted.push({
              id: row.id,
              serviceSessionId: row.serviceSessionId,
              userId: row.userId,
              ticketId: row.ticketId,
              payload: row.payload,
              attempts: row.attempts,
            });
          }
        }
        return { rows: claimedAccepted, rowCount: claimedAccepted.length };
      }

      // 4.1. Renovação de lease / heartbeat de registro em processing
      if (
        text.includes("UPDATE queue_call_outbox") &&
        text.includes("SET locked_at = clock_timestamp()") &&
        text.includes("AND status = 'processing'")
      ) {
        const targetId = String(values[0]);
        const expectedAttempts = Number(values[1]);
        const row = rows.find((r) => r.id === targetId);
        if (!row || row.status !== "processing" || row.attempts !== expectedAttempts) {
          return { rows: [], rowCount: 0 };
        }
        row.lockedAtMs = now;
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      // 5. Atualizações individuais de status da outbox
      if (text.includes("UPDATE queue_call_outbox")) {
        const hasProcessingFence =
          text.includes("AND status = 'processing'") && text.includes("AND attempts =");
        const hasAcceptedFence = text.includes("AND status = 'accepted'");

        const targetId = hasProcessingFence
          ? String(values[values.length - 2])
          : String(values[values.length - 1]);
        const expectedAttempts = hasProcessingFence
          ? Number(values[values.length - 1])
          : null;

        const row = rows.find((r) => r.id === targetId);
        if (!row) return { rows: [], rowCount: 0 };

        if (hasProcessingFence && (row.status !== "processing" || row.attempts !== expectedAttempts)) {
          return { rows: [], rowCount: 0 };
        }
        if (hasAcceptedFence && row.status !== "accepted") {
          return { rows: [], rowCount: 0 };
        }

        if (text.includes("SET status = 'expired'")) {
          row.status = "expired";
          row.lockedAtMs = null;
          row.processedAtMs = now;
          row.lastError = "Sessão de atendimento não está mais pendente";
        } else if (text.includes("SET status = 'no_device'")) {
          row.status = "no_device";
          row.lockedAtMs = null;
          row.processedAtMs = now;
          row.lastError = "Nenhum dispositivo ativo registrado para o participante";
        } else if (text.includes("SET status = 'accepted'")) {
          row.status = "accepted";
          row.ticketId = (values[0] as string | null) ?? null;
          if (typeof values[1] === "string") {
            try {
              row.payload = JSON.parse(values[1]) as QueueCallOutboxPayload;
            } catch {
              // ignore
            }
          }
          row.lockedAtMs = null;
          row.lastError = (values[2] as string | null) ?? null;
        } else if (text.includes("SET status = 'delivered'")) {
          row.status = "delivered";
          row.lockedAtMs = null;
          row.processedAtMs = now;
          row.lastError = (values[0] as string | null) ?? null;
        } else if (text.includes("SET status = 'failed'")) {
          row.status = "failed";
          row.lockedAtMs = null;
          row.processedAtMs = now;
          row.lastError = String(values[0] ?? "");
        } else if (text.includes("SET status = 'pending'")) {
          const delaySec = Number(values[0] ?? 5);
          row.status = "pending";
          if (text.includes("ticket_id = NULL")) {
            row.ticketId = null;
          }
          row.lockedAtMs = null;
          row.nextAttemptAtMs = now + delaySec * 1000;
          row.lastError = String(values[1] ?? "");
        } else if (text.includes("SET locked_at = NULL")) {
          row.lockedAtMs = null;
          if (values.length > 1) {
            row.lastError = String(values[0] ?? "");
          }
        }
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  return {
    db: drizzle(client as unknown as Client, { schema }),
    rows,
    queries,
  };
}

function makeSampleRow(overrides: Partial<SimulatedOutboxRow> = {}): SimulatedOutboxRow {
  return {
    id: "outbox-1",
    serviceSessionId: sessionId,
    userId,
    eventId,
    experienceId,
    payload: {
      type: "queue.called",
      serviceSessionId: sessionId,
      participationId,
      eventId,
      userId,
      calledAt: "2026-11-10T12:00:00.000Z",
      version: 1,
    },
    status: "pending",
    attempts: 0,
    nextAttemptAtMs: null,
    lockedAtMs: null,
    ticketId: null,
    lastError: null,
    createdAtMs: 1000,
    processedAtMs: null,
    ...overrides,
  };
}

test("QueueCallPushService: inserção da outbox cria payload estritamente silencioso (sem title/body/message)", async () => {
  let capturedQuery = "";
  let capturedValues: unknown[] = [];
  const client = {
    async query(config: { text: string; values?: unknown[] }, extraValues?: unknown[]) {
      capturedQuery = config.text;
      capturedValues = config.values ?? extraValues ?? [];
      return { rows: [] };
    },
  };
  const db = drizzle(client as unknown as Client, { schema });

  const service = new QueueCallPushService(db, null as unknown as DeviceTokensService);
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
  const serializedPayload = String(capturedValues.find((v) => typeof v === "string" && v.includes("queue.called")) ?? "");
  assert.ok(serializedPayload.length > 0);
  const parsed = JSON.parse(serializedPayload);
  assert.equal(parsed.type, "queue.called");
  assert.equal(parsed.serviceSessionId, sessionId);
  assert.equal(parsed.userId, userId);
  assert.equal(parsed.title, undefined);
  assert.equal(parsed.body, undefined);
  assert.equal(parsed.message, undefined);
  assert.equal(parsed.sound, undefined);
});

test("QueueCallPushService: descarta chamadas encerradas ou invalidadas (status !== pending)", async () => {
  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
    sessionStatus: "completed",
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService);
  const result = await service.dispatchPending();

  assert.equal(result.processed, 1);
  assert.equal(result.expired, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.delivered, 0);
  assert.equal(state.rows[0].status, "expired");
});

test("QueueCallPushService: NÃO marca como entregue quando não há dispositivo destinatário (status = no_device)", async () => {
  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService);
  const result = await service.dispatchPending();

  assert.equal(result.processed, 1);
  assert.equal(result.noDevice, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.delivered, 0);
  assert.equal(state.rows[0].status, "no_device");
  assert.match(state.rows[0].lastError ?? "", /Nenhum dispositivo ativo/);
});

test("QueueCallPushService: distingue envio aceito pelo Expo (accepted) de entrega confirmada por recibo (delivered)", async () => {
  const dispatchedRequests: Array<{ url: string; body: any }> = [];
  let receiptReady = false;

  const mockTransport: PushHttpTransport = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    dispatchedRequests.push({ url, body: parsedBody });

    if (url === EXPO_PUSH_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: "ok", id: "expo-receipt-ticket-123" }],
        }),
      };
    }

    if (url === EXPO_RECEIPTS_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: receiptReady
            ? { "expo-receipt-ticket-123": { status: "ok" } }
            : {},
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);

  // 1º ciclo: Expo aceita o ticket, mas o recibo de entrega ainda não está disponível
  const pass1 = await service.dispatchPending();
  assert.equal(pass1.processed, 1);
  assert.equal(pass1.accepted, 1);
  assert.equal(pass1.delivered, 0);
  assert.equal(state.rows[0].status, "accepted");
  assert.equal(state.rows[0].ticketId, "expo-receipt-ticket-123");

  const sendReq = dispatchedRequests.find((r) => r.url === EXPO_PUSH_URL);
  assert.ok(sendReq);
  const msg = sendReq.body[0];
  assert.equal(msg.to, pushToken);
  assert.equal(msg.priority, "high");
  assert.equal(msg._contentAvailable, true);
  assert.equal(msg.title, undefined);
  assert.equal(msg.body, undefined);
  assert.equal(msg.sound, undefined);
  assert.equal(msg.data.type, "queue.called");
  assert.equal(msg.data.serviceSessionId, sessionId);

  // 2º ciclo: Provedor confirma o recibo de entrega (status = ok)
  receiptReady = true;
  const pass2 = await service.dispatchPending();
  assert.equal(pass2.processed, 0);
  assert.equal(pass2.delivered, 1);
  assert.equal(state.rows[0].status, "delivered");
  assert.ok(state.rows[0].processedAtMs !== null);
});

test("QueueCallPushService: falha em todos os tickets DeviceNotRegistered revoga token e marca como failed (nunca delivered)", async () => {
  const revokedTokens: string[] = [];
  const mockTransport: PushHttpTransport = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          status: "error",
          message: "The recipient device is not registered with FCM.",
          details: { error: "DeviceNotRegistered" },
        },
      ],
    }),
  });

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async (t: string) => {
      revokedTokens.push(t);
    },
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);
  const result = await service.dispatchPending();

  assert.equal(result.processed, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
  assert.equal(state.rows[0].status, "failed");
  assert.deepEqual(revokedTokens, [pushToken]);
});

test("QueueCallPushService: múltiplos tokens tratam erro individual e entregam no dispositivo válido", async () => {
  const revokedTokens: string[] = [];
  const deadToken = "ExponentPushToken[dead-token]";
  const validToken = "ExponentPushToken[valid-token]";

  const mockTransport: PushHttpTransport = async (url) => {
    if (url === EXPO_PUSH_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { status: "error", message: "Unregistered", details: { error: "DeviceNotRegistered" } },
            { status: "ok", id: "ticket-valid-2" },
          ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { "ticket-valid-2": { status: "ok" } },
      }),
    };
  };

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [
      { pushToken: deadToken, platform: "android" },
      { pushToken: validToken, platform: "android" },
    ],
    revokeInvalidToken: async (t: string) => {
      revokedTokens.push(t);
    },
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);
  const result = await service.dispatchPending();

  assert.deepEqual(revokedTokens, [deadToken]);
  assert.equal(result.accepted, 1);
  assert.equal(result.delivered, 1);
  assert.equal(state.rows[0].status, "delivered");
});

test("QueueCallPushService: retries com intervalo de backoff definido e limite de 3 tentativas em falha de rede/503", async () => {
  let currentTimeMs = 10_000;
  let shouldSucceed = false;

  const mockTransport: PushHttpTransport = async (url) => {
    if (!shouldSucceed) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ errors: [{ message: "Service Unavailable" }] }),
      };
    }
    if (url === EXPO_PUSH_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: "ok", id: "ticket-retry-ok" }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { "ticket-retry-ok": { status: "ok" } } }),
    };
  };

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
    nowMs: () => currentTimeMs,
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);

  // Tentativa 1 falha -> agenda retry para +5s (OUTBOX_RETRY_DELAYS_SECONDS[0])
  const r1 = await service.dispatchPending();
  assert.equal(r1.processed, 1);
  assert.equal(r1.retried, 1);
  assert.equal(r1.failed, 0);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].attempts, 1);
  assert.equal(state.rows[0].nextAttemptAtMs, currentTimeMs + OUTBOX_RETRY_DELAYS_SECONDS[0] * 1000);

  // Antes do intervalo de 5s -> não processa novamente
  currentTimeMs += 2000;
  const rEarly = await service.dispatchPending();
  assert.equal(rEarly.processed, 0);

  // Após 5s -> Tentativa 2 falha -> agenda retry para +15s (OUTBOX_RETRY_DELAYS_SECONDS[1])
  currentTimeMs += 4000;
  const r2 = await service.dispatchPending();
  assert.equal(r2.processed, 1);
  assert.equal(r2.retried, 1);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].attempts, 2);
  assert.equal(state.rows[0].nextAttemptAtMs, currentTimeMs + OUTBOX_RETRY_DELAYS_SECONDS[1] * 1000);

  // Após 15s -> Tentativa 3 falha -> atinge MAX_OUTBOX_ATTEMPTS (3) e marca como failed definitivo
  currentTimeMs += 16_000;
  const r3 = await service.dispatchPending();
  assert.equal(r3.processed, 1);
  assert.equal(r3.retried, 0);
  assert.equal(r3.failed, 1);
  assert.equal(state.rows[0].status, "failed");
  assert.equal(state.rows[0].attempts, MAX_OUTBOX_ATTEMPTS);

  // Mesmo se o serviço voltar depois, registro failed não é reprocessado
  shouldSucceed = true;
  currentTimeMs += 60_000;
  const rAfter = await service.dispatchPending();
  assert.equal(rAfter.processed, 0);
  assert.equal(getOutboxRetryDelaySeconds(1), 5);
  assert.equal(getOutboxRetryDelaySeconds(2), 15);
});

test("QueueCallPushService: concorrência entre múltiplas instâncias reserva cada registro uma única vez", async () => {
  let sendCount = 0;
  const mockTransport: PushHttpTransport = async (url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (url === EXPO_PUSH_URL) {
      sendCount++;
      const ticketId = `ticket-${sendCount}`;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: "ok", id: ticketId }] }),
      };
    }
    const { ids } = JSON.parse(options.body) as { ids: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: Object.fromEntries(ids.map((id) => [id, { status: "ok" }])),
      }),
    };
  };

  const state = createStatefulOutboxDb({
    initialRows: [
      makeSampleRow({ id: "outbox-concurrent-1", serviceSessionId: "11111111-1111-4000-8000-000000000011" }),
      makeSampleRow({ id: "outbox-concurrent-2", serviceSessionId: "11111111-1111-4000-8000-000000000012" }),
    ],
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  // Duas instâncias independentes do serviço compartilhando o mesmo banco
  const instanceA = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);
  const instanceB = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);

  const [resA, resB] = await Promise.all([
    instanceA.dispatchPending(),
    instanceB.dispatchPending(),
  ]);

  assert.equal(resA.processed + resB.processed, 2);
  assert.equal(sendCount, 2, "Cada registro deve ser enviado exatamente uma vez");
  assert.equal(state.rows[0].status, "delivered");
  assert.equal(state.rows[1].status, "delivered");
});

test("QueueCallPushService: retomada após reinício recupera registros pendentes e processing órfãos", async () => {
  const nowMs = 500_000;
  const state = createStatefulOutboxDb({
    nowMs: () => nowMs,
    initialRows: [
      // Registro preso em processing há 120s (servidor caiu durante tentativa 1)
      makeSampleRow({
        id: "outbox-stale-processing",
        serviceSessionId: "11111111-1111-4000-8000-000000000021",
        status: "processing",
        attempts: 1,
        lockedAtMs: nowMs - 120_000,
      }),
      // Registro preso em processing que já estava na 3ª tentativa -> deve ir para failed
      makeSampleRow({
        id: "outbox-exhausted-processing",
        serviceSessionId: "11111111-1111-4000-8000-000000000022",
        status: "processing",
        attempts: 3,
        lockedAtMs: nowMs - 120_000,
      }),
      // Registro accepted aguardando confirmação de recibo antes do reinício
      makeSampleRow({
        id: "outbox-accepted-before-restart",
        serviceSessionId: "11111111-1111-4000-8000-000000000023",
        status: "accepted",
        attempts: 1,
        ticketId: "ticket-before-restart",
        lockedAtMs: null,
      }),
    ],
  });

  const mockTransport: PushHttpTransport = async (url) => {
    if (url === EXPO_PUSH_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: "ok", id: "ticket-recovered" }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          "ticket-recovered": { status: "ok" },
          "ticket-before-restart": { status: "ok" },
        },
      }),
    };
  };

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const restartedService = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);
  const recoveryResult = await restartedService.recoverOnStartup();

  assert.equal(recoveryResult.processed, 1);
  assert.equal(recoveryResult.accepted, 1);
  assert.equal(recoveryResult.delivered, 2);
  assert.equal(recoveryResult.failed, 1);

  assert.equal(state.rows[0].status, "delivered");
  assert.equal(state.rows[0].attempts, 2);
  assert.equal(state.rows[1].status, "failed");
  assert.equal(state.rows[2].status, "delivered");
});

test("QueueCallPushService (P1): recibo DeviceNotRegistered revoga SOMENTE o dispositivo inválido sem afetar outro dispositivo válido do mesmo usuário", async () => {
  const invalidDeviceToken = "ExponentPushToken[device-invalid-1]";
  const validDeviceToken = "ExponentPushToken[device-valid-2]";
  const activeTokens = new Set([invalidDeviceToken, validDeviceToken]);
  const revokedIndividualTokens: string[] = [];
  let revokeAllCalled = false;
  let receiptsAvailable = false;

  const mockTransport: PushHttpTransport = async (url) => {
    if (url === EXPO_PUSH_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { status: "ok", id: "receipt-ticket-invalid-1" },
            { status: "ok", id: "receipt-ticket-valid-2" },
          ],
        }),
      };
    }

    if (url === EXPO_RECEIPTS_URL) {
      if (!receiptsAvailable) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            "receipt-ticket-invalid-1": {
              status: "error",
              message: "The recipient device is not registered with FCM.",
              details: { error: "DeviceNotRegistered" },
            },
            "receipt-ticket-valid-2": {
              status: "ok",
            },
          },
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () =>
      Array.from(activeTokens).map((t) => ({ pushToken: t, platform: "android" })),
    revokeInvalidToken: async (token: string) => {
      revokedIndividualTokens.push(token);
      activeTokens.delete(token);
    },
    revokeAllUserTokens: async () => {
      revokeAllCalled = true;
      activeTokens.clear();
    },
  } as unknown as DeviceTokensService;

  // Instância 1 envia os pushes e recebe os 2 tickets ok
  const serviceInstance1 = new QueueCallPushService(
    state.db,
    mockDeviceTokensService,
    mockTransport,
  );
  const pass1 = await serviceInstance1.dispatchPending();
  assert.equal(pass1.accepted, 1);
  assert.equal(pass1.delivered, 0);
  assert.equal(state.rows[0].status, "accepted");
  assert.equal(state.rows[0].ticketId, "receipt-ticket-invalid-1,receipt-ticket-valid-2");

  // Instância 2 (simulando inclusive outra instância/reinício lendo do banco) consulta os recibos
  receiptsAvailable = true;
  const serviceInstance2 = new QueueCallPushService(
    state.db,
    mockDeviceTokensService,
    mockTransport,
  );
  const pass2 = await serviceInstance2.dispatchPending();

  assert.equal(pass2.delivered, 1);
  assert.equal(state.rows[0].status, "delivered");
  assert.equal(revokeAllCalled, false, "NUNCA deve chamar revokeAllUserTokens");
  assert.deepEqual(
    revokedIndividualTokens,
    [invalidDeviceToken],
    "Apenas o token associado ao recibo DeviceNotRegistered deve ser revogado",
  );
  assert.equal(activeTokens.has(validDeviceToken), true, "O dispositivo válido deve permanecer ativo");
  assert.equal(activeTokens.has(invalidDeviceToken), false);
});

test("QueueCallPushService (P2): rejeita tickets ok sem ID válido (sem criar accepted-0), classifica como inconclusivo e aplica retry preservando deduplicação", async () => {
  let currentTimeMs = 20_000;
  let callAttempt = 0;
  const sentPayloads: any[] = [];

  const mockTransport: PushHttpTransport = async (url, options) => {
    if (url === EXPO_PUSH_URL) {
      callAttempt++;
      sentPayloads.push(JSON.parse(options.body));
      if (callAttempt === 1) {
        // 1ª tentativa: ticket ok sem id
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ status: "ok" }],
          }),
        };
      }
      if (callAttempt === 2) {
        // 2ª tentativa: ticket ok com id vazio/espaços
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ status: "ok", id: "   " }],
          }),
        };
      }
      // 3ª tentativa: ticket ok com id real válido
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: "ok", id: "real-expo-ticket-uuid-999" }],
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { "real-expo-ticket-uuid-999": { status: "ok" } },
      }),
    };
  };

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
    nowMs: () => currentTimeMs,
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  const service = new QueueCallPushService(state.db, mockDeviceTokensService, mockTransport);

  // Tentativa 1: ticket ok sem id -> NÃO aceita, agenda retry (+5s)
  const r1 = await service.dispatchPending();
  assert.equal(r1.processed, 1);
  assert.equal(r1.accepted, 0);
  assert.equal(r1.delivered, 0);
  assert.equal(r1.retried, 1);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].ticketId, null, "Não deve gravar accepted-0 nem ticket fictício");
  assert.match(state.rows[0].lastError ?? "", /Ticket ok sem identificador válido/i);

  // Tentativa 2 (após 5s): ticket ok com id em branco -> NÃO aceita, agenda retry (+15s)
  currentTimeMs += 6000;
  const r2 = await service.dispatchPending();
  assert.equal(r2.processed, 1);
  assert.equal(r2.accepted, 0);
  assert.equal(r2.retried, 1);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].ticketId, null);

  // Tentativa 3 (após 15s): ticket ok com id válido -> aceita e confirma recibo
  currentTimeMs += 16_000;
  const r3 = await service.dispatchPending();
  assert.equal(r3.processed, 1);
  assert.equal(r3.accepted, 1);
  assert.equal(r3.delivered, 1);
  assert.equal(state.rows[0].status, "delivered");
  assert.equal(state.rows[0].ticketId, "real-expo-ticket-uuid-999");

  // Deduplicação lógica preservada: todas as tentativas mantiveram exatamente o mesmo serviceSessionId
  assert.equal(sentPayloads.length, 3);
  for (const batch of sentPayloads) {
    assert.equal(batch[0].data.serviceSessionId, sessionId);
  }
});

test("QueueCallPushService (P2): aplica timeout explícito quando resposta do provedor é incerta e impede processamento concorrente durante ou após expiração do lease", async () => {
  let currentTimeMs = 100_000;
  let attemptCount = 0;
  const abortSignalsObserved: boolean[] = [];

  const state = createStatefulOutboxDb({
    initialRows: [makeSampleRow()],
    nowMs: () => currentTimeMs,
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  // Parte 1: Timeout explícito quando o provedor não responde (resposta incerta)
  const slowOrRecoveringTransport: PushHttpTransport = async (url, options) => {
    if (url === EXPO_PUSH_URL) {
      attemptCount++;
      if (attemptCount === 1) {
        // Simula requisição presa que nunca responde até o AbortController abortar
        return await new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            abortSignalsObserved.push(Boolean(options.signal?.aborted));
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: "ok", id: "ticket-after-timeout-recovery" }],
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { "ticket-after-timeout-recovery": { status: "ok" } },
      }),
    };
  };

  const serviceA = new QueueCallPushService(
    state.db,
    mockDeviceTokensService,
    slowOrRecoveringTransport,
  );
  serviceA.setHttpTimeoutMs(30);

  const timeoutRun = await serviceA.dispatchPending();
  assert.equal(timeoutRun.processed, 1);
  assert.equal(timeoutRun.accepted, 0);
  assert.equal(timeoutRun.delivered, 0);
  assert.equal(timeoutRun.retried, 1);
  assert.deepEqual(abortSignalsObserved, [true]);
  assert.equal(state.rows[0].status, "pending");
  assert.match(state.rows[0].lastError ?? "", /Timeout na requisição para a Expo Push API/i);

  // Após o backoff de 5s, a retomada entrega com sucesso
  currentTimeMs += 6000;
  const recoveredRun = await serviceA.dispatchPending();
  assert.equal(recoveredRun.processed, 1);
  assert.equal(recoveredRun.accepted, 1);
  assert.equal(recoveredRun.delivered, 1);
  assert.equal(state.rows[0].status, "delivered");

  // Parte 2: Requisição em andamento mantém o lease renovado (heartbeat) e fencing impede sobrescrita concorrente
  const concurrentState = createStatefulOutboxDb({
    initialRows: [
      makeSampleRow({
        id: "outbox-lease-guard",
        serviceSessionId: "11111111-1111-4000-8000-000000000099",
      }),
    ],
    nowMs: () => currentTimeMs,
  });

  let releaseInFlightRequest!: () => void;
  let notifyInFlightStarted!: () => void;
  const inFlightStarted = new Promise<void>((resolve) => {
    notifyInFlightStarted = resolve;
  });
  let pushSendCalls = 0;

  const inFlightTransport: PushHttpTransport = async (url) => {
    if (url === EXPO_PUSH_URL) {
      pushSendCalls++;
      notifyInFlightStarted();
      await new Promise<void>((resolve) => {
        releaseInFlightRequest = resolve;
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: "ok", id: `ticket-lease-${pushSendCalls}` }],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { "ticket-lease-1": { status: "ok" } },
      }),
    };
  };

  const worker1 = new QueueCallPushService(
    concurrentState.db,
    mockDeviceTokensService,
    inFlightTransport,
  );
  worker1.setHttpTimeoutMs(80);

  const worker2 = new QueueCallPushService(
    concurrentState.db,
    mockDeviceTokensService,
    inFlightTransport,
  );
  worker2.setHttpTimeoutMs(80);

  const worker1Promise = worker1.dispatchPending();
  await inFlightStarted;

  // Avança o relógio simulado em 65s enquanto a requisição do worker1 ainda está em andamento:
  // o heartbeat de worker1 (a cada 20ms) renova locked_at e impede que worker2 processe a mesma entrega concorrentemente
  currentTimeMs += 65_000;
  await new Promise((resolve) => setTimeout(resolve, 35));

  const worker2ResultWhileInFlight = await worker2.dispatchPending();
  assert.equal(
    worker2ResultWhileInFlight.processed,
    0,
    "Worker 2 não deve assumir o registro enquanto a requisição do Worker 1 ainda está ativa e renovando o lease",
  );
  assert.equal(pushSendCalls, 1, "Apenas 1 envio deve estar em andamento");

  releaseInFlightRequest();
  const worker1Result = await worker1Promise;
  assert.equal(worker1Result.accepted, 1);
  assert.equal(worker1Result.delivered, 1);
  assert.equal(concurrentState.rows[0].status, "delivered");
  assert.equal(pushSendCalls, 1);

  // Parte 3: Fencing por tentativa (attempts) impede que resposta tardia de instância congelada sobrescreva outra instância
  const fencingState = createStatefulOutboxDb({
    initialRows: [
      makeSampleRow({
        id: "outbox-fenced-row",
        serviceSessionId: "11111111-1111-4000-8000-000000000100",
      }),
    ],
    nowMs: () => currentTimeMs,
  });

  let releaseFrozenWorker!: () => void;
  let notifyFrozenStarted!: () => void;
  const frozenStarted = new Promise<void>((resolve) => {
    notifyFrozenStarted = resolve;
  });
  let callIndex = 0;

  const fencingTransport: PushHttpTransport = async (url) => {
    if (url === EXPO_PUSH_URL) {
      callIndex++;
      if (callIndex === 1) {
        notifyFrozenStarted();
        await new Promise<void>((resolve) => {
          releaseFrozenWorker = resolve;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ status: "ok", id: "stale-worker-ticket" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: "ok", id: "fresh-worker-ticket" }],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { "fresh-worker-ticket": { status: "ok" } },
      }),
    };
  };

  const staleWorker = new QueueCallPushService(
    fencingState.db,
    mockDeviceTokensService,
    fencingTransport,
  );
  staleWorker.setHttpTimeoutMs(500);

  const freshWorker = new QueueCallPushService(
    fencingState.db,
    mockDeviceTokensService,
    fencingTransport,
  );
  freshWorker.setHttpTimeoutMs(500);

  const stalePromise = staleWorker.dispatchPending();
  await frozenStarted;

  // Simula congelamento da instância 1 avançando o relógio imediatamente além do lease antes do próximo tick de heartbeat
  currentTimeMs += 65_000;
  const freshResult = await freshWorker.dispatchPending();
  assert.equal(freshResult.processed, 1);
  assert.equal(freshResult.delivered, 1);
  assert.equal(fencingState.rows[0].status, "delivered");
  assert.equal(fencingState.rows[0].attempts, 2);

  // Quando a resposta tardia da instância 1 chega (attempts = 1), o UPDATE cercado (fenced) não altera o registro já entregue
  releaseFrozenWorker();
  const staleResult = await stalePromise;
  assert.equal(staleResult.accepted, 0, "Instância obsoleta não deve marcar accepted após perder o lease");
  assert.equal(fencingState.rows[0].status, "delivered");
  assert.equal(fencingState.rows[0].ticketId, "fresh-worker-ticket");
});

test("QueueCallPushService (P2): timeout estendido à leitura completa do corpo (json() pendente/abort), liberação do lease, retomada e fencing de worker obsoleto", async () => {
  let currentTimeMs = 200_000;
  let attemptsMade = 0;
  const abortSignalsDuringBodyRead: boolean[] = [];

  const state = createStatefulOutboxDb({
    initialRows: [
      makeSampleRow({
        id: "outbox-body-read-timeout",
        serviceSessionId: "11111111-1111-4000-8000-000000000201",
      }),
    ],
    nowMs: () => currentTimeMs,
  });

  const mockDeviceTokensService = {
    getActiveTokensForUser: async () => [{ pushToken, platform: "android" }],
    revokeInvalidToken: async () => undefined,
  } as unknown as DeviceTokensService;

  let releaseStalledBodyRead!: () => void;
  let notifyBodyReadStarted!: () => void;
  const bodyReadStartedPromise = new Promise<void>((resolve) => {
    notifyBodyReadStarted = resolve;
  });

  const bodyStallTransport: PushHttpTransport = async (url, options) => {
    if (url === EXPO_PUSH_URL) {
      attemptsMade++;
      if (attemptsMade === 1) {
        // Resposta HTTP 200 recebida, mas json() fica pendente e monitora abort
        return {
          ok: true,
          status: 200,
          json: async () => {
            notifyBodyReadStarted();
            return await new Promise<unknown>((resolve, reject) => {
              options.signal?.addEventListener("abort", () => {
                abortSignalsDuringBodyRead.push(Boolean(options.signal?.aborted));
                const abortErr = new Error("The operation was aborted");
                abortErr.name = "AbortError";
                reject(abortErr);
              });
              releaseStalledBodyRead = () => {
                resolve({ data: [{ status: "ok", id: "ticket-late-body" }] });
              };
            });
          },
        };
      }

      // 2ª tentativa (retomada): leitura do corpo completa normalmente
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: "ok", id: "ticket-recovered-after-body-timeout" }],
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { "ticket-recovered-after-body-timeout": { status: "ok" } },
      }),
    };
  };

  const service = new QueueCallPushService(
    state.db,
    mockDeviceTokensService,
    bodyStallTransport,
  );
  service.setHttpTimeoutMs(35);

  // 1. Executa o ciclo: resposta HTTP chega, mas json() nunca resolve antes do timeout de 35ms
  const dispatchPromise = service.dispatchPending();
  await bodyReadStartedPromise;

  const result1 = await dispatchPromise;

  assert.equal(result1.processed, 1);
  assert.equal(result1.accepted, 0);
  assert.equal(result1.delivered, 0);
  assert.equal(result1.retried, 1);
  assert.deepEqual(abortSignalsDuringBodyRead, [true], "AbortController deve ser acionado pelo timeout durante a leitura do corpo");

  // 2. Garantir liberação do lease e recuperação da outbox
  const rowAfterTimeout = state.rows[0];
  assert.equal(rowAfterTimeout.status, "pending");
  assert.equal(rowAfterTimeout.lockedAtMs, null, "O lease deve ser liberado imediatamente (locked_at = NULL)");
  assert.equal(rowAfterTimeout.attempts, 1);
  assert.match(rowAfterTimeout.lastError ?? "", /Timeout na requisição para a Expo Push API após 35ms/);

  // 3. Retomada após falha: após decorrer o backoff de 5s, o reprocessamento tem sucesso completo
  currentTimeMs += 6000;
  const recoveryResult = await service.dispatchPending();

  assert.equal(recoveryResult.processed, 1);
  assert.equal(recoveryResult.accepted, 1);
  assert.equal(recoveryResult.delivered, 1);
  assert.equal(state.rows[0].status, "delivered");
  assert.equal(state.rows[0].attempts, 2);
  assert.equal(state.rows[0].ticketId, "ticket-recovered-after-body-timeout");

  // 4. Ausência de alteração indevida por worker obsoleto:
  // Se a leitura pendente da tentativa 1 resolver tardiamente agora, ela não deve sobrescrever o registro entregue
  releaseStalledBodyRead();
  assert.equal(state.rows[0].status, "delivered");
  assert.equal(state.rows[0].ticketId, "ticket-recovered-after-body-timeout");
  assert.equal(state.rows[0].attempts, 2);
});
