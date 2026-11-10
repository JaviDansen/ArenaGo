import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { DeviceTokensService } from "./device-tokens.service";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const PUSH_HTTP_TRANSPORT = Symbol("PUSH_HTTP_TRANSPORT");

export const MAX_OUTBOX_ATTEMPTS = 3;
export const OUTBOX_RETRY_DELAYS_SECONDS = [5, 15] as const;
export const OUTBOX_PROCESSING_LOCK_TIMEOUT_SECONDS = 60;
export const EXPO_HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_OUTBOX_POLL_INTERVAL_MS = 5000;

const NON_RETRYABLE_EXPO_ERRORS = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "InvalidCredentials",
  "MismatchSenderId",
]);

export type OutboxEntryStatus =
  | "pending"
  | "processing"
  | "accepted"
  | "delivered"
  | "no_device"
  | "expired"
  | "failed";

export type PushHttpTransport = (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface QueueCallOutboxPayload {
  type: "queue.called";
  serviceSessionId: string;
  participationId: string;
  eventId: string;
  userId?: string;
  calledAt?: string;
  version: 1;
  _ticketTokens?: Record<string, string>;
}

export interface CreateOutboxEntryInput {
  sessionId: string;
  userId: string;
  eventId: string;
  experienceId: string;
  participationId: string;
  calledAt: Date;
}

export interface DispatchOutboxResult {
  processed: number;
  accepted: number;
  delivered: number;
  noDevice: number;
  expired: number;
  retried: number;
  failed: number;
}

type ClaimedOutboxRow = {
  id: string;
  serviceSessionId: string;
  userId: string;
  eventId: string;
  experienceId: string;
  payload: QueueCallOutboxPayload;
  attempts: number;
};

type AcceptedOutboxRow = {
  id: string;
  serviceSessionId: string;
  userId: string;
  ticketId: string;
  payload?: QueueCallOutboxPayload;
  attempts: number;
};

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: {
    error?: string;
  };
}

class TicketDispatchError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TicketDispatchError";
  }
}

export function getOutboxRetryDelaySeconds(attemptNumber: number): number {
  const index = Math.max(0, Math.min(attemptNumber - 1, OUTBOX_RETRY_DELAYS_SECONDS.length - 1));
  return OUTBOX_RETRY_DELAYS_SECONDS[index];
}

@Injectable()
export class QueueCallPushService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(QueueCallPushService.name);
  private inFlightDispatch: Promise<DispatchOutboxResult> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private httpTimeoutMs = EXPO_HTTP_TIMEOUT_MS;
  private readonly ticketTokenCache = new Map<string, string>();

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly database: NodePgDatabase<typeof schema>,
    @Inject(DeviceTokensService)
    private readonly deviceTokensService: DeviceTokensService,
    @Optional()
    @Inject(PUSH_HTTP_TRANSPORT)
    private readonly transport?: PushHttpTransport,
  ) {}

  setHttpTimeoutMs(timeoutMs: number): void {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      this.httpTimeoutMs = Math.floor(timeoutMs);
    }
  }

  getHttpTimeoutMs(): number {
    return this.httpTimeoutMs;
  }

  async onApplicationBootstrap(): Promise<void> {
    const enabled =
      process.env.NODE_ENV !== "test" ||
      process.env.QUEUE_CALL_OUTBOX_JOB_TEST_ENABLED === "true";
    if (!enabled) {
      return;
    }
    await this.recoverOnStartup();
    this.startScheduler();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stopScheduler();
  }

  /**
   * Retoma pendências após reinício do servidor:
   * - Expira ou libera registros presos em `processing` com lock expirado.
   * - Reprocessa registros `pending` elegíveis e verifica recibos de registros `accepted`.
   */
  async recoverOnStartup(): Promise<DispatchOutboxResult> {
    try {
      return await this.dispatchPending();
    } catch (err) {
      this.logger.error("Falha na recuperação inicial da outbox de chamadas:", err);
      return {
        processed: 0,
        accepted: 0,
        delivered: 0,
        noDevice: 0,
        expired: 0,
        retried: 0,
        failed: 0,
      };
    }
  }

  startScheduler(intervalMs = DEFAULT_OUTBOX_POLL_INTERVAL_MS): void {
    this.stopped = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const scheduleNext = () => {
      if (this.stopped) return;
      this.pollTimer = setTimeout(() => {
        void this.dispatchPending()
          .catch((err) => {
            this.logger.error("Erro no ciclo periódico da outbox de chamadas:", err);
          })
          .finally(() => {
            scheduleNext();
          });
      }, intervalMs);
      this.pollTimer.unref?.();
    };
    scheduleNext();
  }

  async stopScheduler(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.inFlightDispatch) {
      await this.inFlightDispatch.catch(() => undefined);
    }
  }

  /**
   * Insere o registro de outbox na mesma transação que confirmou a chamada do Staff.
   * A chave única em service_session_id garante no máximo um evento de alerta por atendimento.
   */
  async createOutboxEntryWithTx(
    tx: { execute: (query: unknown) => Promise<unknown> },
    input: CreateOutboxEntryInput,
  ): Promise<string> {
    const outboxId = randomUUID();
    const payload: QueueCallOutboxPayload = {
      type: "queue.called",
      serviceSessionId: input.sessionId,
      participationId: input.participationId,
      eventId: input.eventId,
      userId: input.userId,
      calledAt: input.calledAt.toISOString(),
      version: 1,
    };

    await tx.execute(sql`
      INSERT INTO queue_call_outbox (
        id,
        service_session_id,
        user_id,
        event_id,
        experience_id,
        payload,
        status,
        attempts,
        created_at
      ) VALUES (
        ${outboxId},
        ${input.sessionId},
        ${input.userId},
        ${input.eventId},
        ${input.experienceId},
        ${JSON.stringify(payload)}::jsonb,
        'pending',
        0,
        ${input.calledAt}
      )
      ON CONFLICT (service_session_id) DO NOTHING
    `);

    return outboxId;
  }

  /**
   * Dispara a entrega de forma assíncrona pós-commit, sem bloquear nem propagar erros.
   */
  triggerDispatch(): void {
    setImmediate(() => {
      this.dispatchPending().catch((err) => {
        this.logger.error("Erro no processamento da outbox de chamadas:", err);
      });
    });
  }

  /**
   * Processa a fila de outbox com reserva atômica por registro:
   * 1. Finaliza registros órfãos em `processing` que já esgotaram `MAX_OUTBOX_ATTEMPTS`.
   * 2. Reserva atomicamente registros `pending` elegíveis ou `processing` com lock expirado (`FOR UPDATE SKIP LOCKED`).
   * 3. Valida que a `service_session` segue `pending`.
   * 4. Não marca como entregue quando não há dispositivo ativo (`status = 'no_device'`).
   * 5. Distingue envio aceito pelo Expo (`status = 'accepted'`), erro de ticket (`pending` com backoff ou `failed`)
   *    e entrega confirmada por recibo do provedor (`status = 'delivered'`).
   */
  async dispatchPending(): Promise<DispatchOutboxResult> {
    if (this.inFlightDispatch) {
      return this.inFlightDispatch;
    }

    const run = this.executeDispatchCycle();
    this.inFlightDispatch = run;
    try {
      return await run;
    } finally {
      if (this.inFlightDispatch === run) {
        this.inFlightDispatch = null;
      }
    }
  }

  private async executeDispatchCycle(): Promise<DispatchOutboxResult> {
    let processed = 0;
    let accepted = 0;
    let delivered = 0;
    let noDevice = 0;
    let expired = 0;
    let retried = 0;
    let failed = 0;

    // 1. Marcar como falha registros presos em processing que já atingiram o limite de tentativas
    const exhaustedStale = await this.database.execute<{ id: string }>(sql`
      UPDATE queue_call_outbox
      SET status = 'failed',
          locked_at = NULL,
          processed_at = clock_timestamp(),
          last_error = COALESCE(last_error, 'Processamento interrompido após atingir o limite máximo de tentativas')
      WHERE status = 'processing'
        AND locked_at <= clock_timestamp() - (${OUTBOX_PROCESSING_LOCK_TIMEOUT_SECONDS} * INTERVAL '1 second')
        AND attempts >= ${MAX_OUTBOX_ATTEMPTS}
      RETURNING id
    `);
    failed += exhaustedStale.rows?.length ?? 0;

    // 2. Reserva atômica: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING ...
    // Impede que múltiplas instâncias processem o mesmo registro simultaneamente.
    const claimedEntries = await this.database.execute<ClaimedOutboxRow>(sql`
      UPDATE queue_call_outbox
      SET status = 'processing',
          attempts = attempts + 1,
          locked_at = clock_timestamp()
      WHERE id IN (
        SELECT id
        FROM queue_call_outbox
        WHERE (
          (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp()))
          OR
          (status = 'processing' AND locked_at <= clock_timestamp() - (${OUTBOX_PROCESSING_LOCK_TIMEOUT_SECONDS} * INTERVAL '1 second'))
        )
        AND attempts < ${MAX_OUTBOX_ATTEMPTS}
        ORDER BY created_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        service_session_id AS "serviceSessionId",
        user_id AS "userId",
        event_id AS "eventId",
        experience_id AS "experienceId",
        payload,
        attempts
    `);

    for (const entry of claimedEntries.rows ?? []) {
      processed++;
      const currentAttempt = Number(entry.attempts ?? 1);

      // 2.1. Evitar despachar alertas de chamadas já encerradas, ausentes ou invalidadas
      const sessionCheck = await this.database.execute<{ status: string }>(
        sql`SELECT status FROM service_sessions WHERE id = ${entry.serviceSessionId}`,
      );

      if (!sessionCheck.rows.length || sessionCheck.rows[0].status !== "pending") {
        const expUpdate = await this.database.execute<{ id: string }>(sql`
          UPDATE queue_call_outbox
          SET status = 'expired',
              locked_at = NULL,
              processed_at = clock_timestamp(),
              last_error = 'Sessão de atendimento não está mais pendente'
          WHERE id = ${entry.id}
            AND status = 'processing'
            AND attempts = ${currentAttempt}
          RETURNING id
        `);
        if ((expUpdate.rowCount ?? expUpdate.rows?.length ?? 0) > 0) {
          expired++;
        }
        continue;
      }

      // 2.2. Consultar tokens ativos do participante chamado
      const tokens = await this.deviceTokensService.getActiveTokensForUser(entry.userId);

      if (tokens.length === 0) {
        // IMPORTANTE: Não marcar como entregue quando não há dispositivo destinatário
        const noDevUpdate = await this.database.execute<{ id: string }>(sql`
          UPDATE queue_call_outbox
          SET status = 'no_device',
              locked_at = NULL,
              processed_at = clock_timestamp(),
              last_error = 'Nenhum dispositivo ativo registrado para o participante'
          WHERE id = ${entry.id}
            AND status = 'processing'
            AND attempts = ${currentAttempt}
          RETURNING id
        `);
        if ((noDevUpdate.rowCount ?? noDevUpdate.rows?.length ?? 0) > 0) {
          noDevice++;
        }
        continue;
      }

      // 2.3. Confirmar posse do lease antes de iniciar a chamada externa ao provedor
      const leaseRefresh = await this.database.execute<{ id: string }>(sql`
        UPDATE queue_call_outbox
        SET locked_at = clock_timestamp()
        WHERE id = ${entry.id}
          AND status = 'processing'
          AND attempts = ${currentAttempt}
        RETURNING id
      `);
      if ((leaseRefresh.rowCount ?? leaseRefresh.rows?.length ?? 0) === 0) {
        // Outra instância assumiu o registro após expiração do lease; aborta para impedir envio concorrente
        continue;
      }

      // Mantém o lease renovado enquanto a requisição externa ainda estiver em andamento (dentro do timeout HTTP)
      const heartbeatIntervalMs = Math.max(
        15,
        Math.floor(
          Math.min(
            this.httpTimeoutMs,
            OUTBOX_PROCESSING_LOCK_TIMEOUT_SECONDS * 1000,
          ) / 4,
        ),
      );
      const leaseHeartbeat = setInterval(() => {
        void this.database
          .execute(sql`
            UPDATE queue_call_outbox
            SET locked_at = clock_timestamp()
            WHERE id = ${entry.id}
              AND status = 'processing'
              AND attempts = ${currentAttempt}
          `)
          .catch(() => undefined);
      }, heartbeatIntervalMs);
      leaseHeartbeat.unref?.();

      // 2.4. Transmitir push silencioso e avaliar tickets individuais
      try {
        const dispatchOutcome = await this.sendSilentPush(
          tokens.map((t) => t.pushToken),
          entry.payload,
        );

        const joinedTicketIds =
          dispatchOutcome.acceptedTicketIds.length > 0
            ? dispatchOutcome.acceptedTicketIds.join(",")
            : null;

        const payloadWithTicketMap: QueueCallOutboxPayload = {
          ...entry.payload,
          _ticketTokens: dispatchOutcome.ticketTokenMap,
        };

        const acceptUpdate = await this.database.execute<{ id: string }>(sql`
          UPDATE queue_call_outbox
          SET status = 'accepted',
              ticket_id = ${joinedTicketIds},
              payload = ${JSON.stringify(payloadWithTicketMap)}::jsonb,
              locked_at = NULL,
              last_error = ${dispatchOutcome.partialErrorSummary}
          WHERE id = ${entry.id}
            AND status = 'processing'
            AND attempts = ${currentAttempt}
          RETURNING id
        `);
        if ((acceptUpdate.rowCount ?? acceptUpdate.rows?.length ?? 0) > 0) {
          accepted++;
        }
      } catch (pushError: unknown) {
        const errorMessage =
          pushError instanceof Error ? pushError.message : String(pushError);
        const isRetryable =
          pushError instanceof TicketDispatchError ? pushError.retryable : true;

        if (!isRetryable || currentAttempt >= MAX_OUTBOX_ATTEMPTS) {
          const failUpdate = await this.database.execute<{ id: string }>(sql`
            UPDATE queue_call_outbox
            SET status = 'failed',
                 locked_at = NULL,
                 processed_at = clock_timestamp(),
                 last_error = ${errorMessage}
            WHERE id = ${entry.id}
              AND status = 'processing'
              AND attempts = ${currentAttempt}
            RETURNING id
          `);
          if ((failUpdate.rowCount ?? failUpdate.rows?.length ?? 0) > 0) {
            failed++;
          }
        } else {
          const delaySeconds = getOutboxRetryDelaySeconds(currentAttempt);
          const retryUpdate = await this.database.execute<{ id: string }>(sql`
            UPDATE queue_call_outbox
            SET status = 'pending',
                locked_at = NULL,
                next_attempt_at = clock_timestamp() + (${delaySeconds} * INTERVAL '1 second'),
                last_error = ${errorMessage}
            WHERE id = ${entry.id}
              AND status = 'processing'
              AND attempts = ${currentAttempt}
            RETURNING id
          `);
          if ((retryUpdate.rowCount ?? retryUpdate.rows?.length ?? 0) > 0) {
            retried++;
          }
        }
      } finally {
        clearInterval(leaseHeartbeat);
      }
    }

    // 3. Verificar recibos de entrega de registros já aceitos pelo Expo (status = 'accepted')
    const receiptStats = await this.verifyAcceptedReceipts();
    delivered += receiptStats.delivered;
    expired += receiptStats.expired;
    retried += receiptStats.retried;
    failed += receiptStats.failed;

    return {
      processed,
      accepted,
      delivered,
      noDevice,
      expired,
      retried,
      failed,
    };
  }

  /**
   * Consulta a API de Push Receipts do Expo para confirmar a entrega real ao provedor (FCM/APNs)
   * dos registros em estado `accepted`.
   */
  async verifyAcceptedReceipts(): Promise<{
    delivered: number;
    expired: number;
    retried: number;
    failed: number;
  }> {
    let delivered = 0;
    let expired = 0;
    let retried = 0;
    let failed = 0;

    const acceptedRows = await this.database.execute<AcceptedOutboxRow>(sql`
      UPDATE queue_call_outbox
      SET locked_at = clock_timestamp()
      WHERE id IN (
        SELECT id
        FROM queue_call_outbox
        WHERE status = 'accepted'
          AND ticket_id IS NOT NULL
          AND (
            locked_at IS NULL
            OR locked_at <= clock_timestamp() - (${OUTBOX_PROCESSING_LOCK_TIMEOUT_SECONDS} * INTERVAL '1 second')
          )
        ORDER BY created_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        service_session_id AS "serviceSessionId",
        user_id AS "userId",
        ticket_id AS "ticketId",
        payload,
        attempts
    `);

    for (const row of acceptedRows.rows ?? []) {
      const sessionCheck = await this.database.execute<{ status: string }>(
        sql`SELECT status FROM service_sessions WHERE id = ${row.serviceSessionId}`,
      );

      if (!sessionCheck.rows.length || sessionCheck.rows[0].status !== "pending") {
        await this.database.execute(sql`
          UPDATE queue_call_outbox
          SET status = 'expired',
              locked_at = NULL,
              processed_at = clock_timestamp(),
              last_error = 'Sessão de atendimento encerrada antes da confirmação do recibo'
          WHERE id = ${row.id}
            AND status = 'accepted'
        `);
        expired++;
        continue;
      }

      const ticketIds = row.ticketId
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (ticketIds.length === 0) {
        await this.database.execute(sql`
          UPDATE queue_call_outbox
          SET locked_at = NULL
          WHERE id = ${row.id}
            AND status = 'accepted'
        `);
        continue;
      }

      const persistedTicketTokens =
        row.payload &&
        typeof row.payload === "object" &&
        row.payload._ticketTokens &&
        typeof row.payload._ticketTokens === "object"
          ? row.payload._ticketTokens
          : {};

      try {
        const receiptsOutcome = await this.fetchExpoReceipts(
          ticketIds,
          persistedTicketTokens,
        );

        if (receiptsOutcome.kind === "delivered") {
          await this.database.execute(sql`
            UPDATE queue_call_outbox
            SET status = 'delivered',
                locked_at = NULL,
                processed_at = clock_timestamp(),
                last_error = ${receiptsOutcome.partialErrorSummary}
            WHERE id = ${row.id}
              AND status = 'accepted'
          `);
          delivered++;
        } else if (receiptsOutcome.kind === "pending_receipt") {
          // O recibo ainda não foi gerado pelo provedor; permanece em 'accepted'
          await this.database.execute(sql`
            UPDATE queue_call_outbox
            SET locked_at = NULL
            WHERE id = ${row.id}
              AND status = 'accepted'
          `);
        } else {
          // Todos os recibos retornaram erro
          const currentAttempt = Number(row.attempts ?? 1);
          if (!receiptsOutcome.retryable || currentAttempt >= MAX_OUTBOX_ATTEMPTS) {
            await this.database.execute(sql`
              UPDATE queue_call_outbox
              SET status = 'failed',
                  locked_at = NULL,
                  processed_at = clock_timestamp(),
                  last_error = ${receiptsOutcome.errorMessage}
              WHERE id = ${row.id}
                AND status = 'accepted'
            `);
            failed++;
          } else {
            const delaySeconds = getOutboxRetryDelaySeconds(currentAttempt);
            await this.database.execute(sql`
              UPDATE queue_call_outbox
              SET status = 'pending',
                  ticket_id = NULL,
                  locked_at = NULL,
                  next_attempt_at = clock_timestamp() + (${delaySeconds} * INTERVAL '1 second'),
                  last_error = ${receiptsOutcome.errorMessage}
              WHERE id = ${row.id}
                AND status = 'accepted'
            `);
            retried++;
          }
        }
      } catch (err: unknown) {
        // Falha transitória ao consultar getReceipts: mantém 'accepted' para nova checagem
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.database.execute(sql`
          UPDATE queue_call_outbox
          SET locked_at = NULL,
              last_error = ${errorMessage}
          WHERE id = ${row.id}
            AND status = 'accepted'
        `);
      }
    }

    return { delivered, expired, retried, failed };
  }

  private async sendSilentPush(
    tokens: string[],
    payload: QueueCallOutboxPayload,
  ): Promise<{
    acceptedTicketIds: string[];
    ticketTokenMap: Record<string, string>;
    partialErrorSummary: string | null;
  }> {
    const messages = tokens.map((token) => ({
      to: token,
      data: {
        type: payload.type,
        serviceSessionId: payload.serviceSessionId,
        participationId: payload.participationId,
        eventId: payload.eventId,
        ...(payload.userId ? { userId: payload.userId } : {}),
        ...(payload.calledAt ? { calledAt: payload.calledAt } : {}),
        version: payload.version,
      },
      priority: "high",
      _contentAvailable: true,
    }));

    const bodyString = JSON.stringify(messages);
    const headers = {
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    };

    const response = await this.performHttpPost(EXPO_PUSH_URL, headers, bodyString);

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new TicketDispatchError(
        `Expo Push API retornou status HTTP ${response.status}`,
        retryable,
      );
    }

    const result = (await response.json()) as {
      data?: ExpoPushTicket[];
      errors?: Array<{ code?: string; message?: string }>;
    };

    const tickets: ExpoPushTicket[] | undefined = Array.isArray(result?.data)
      ? result.data
      : undefined;

    if (!tickets || tickets.length === 0) {
      const topError =
        Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors.map((e) => e.message || e.code || "Erro Expo").join("; ")
          : "Resposta da Expo Push API sem tickets de envio";
      throw new TicketDispatchError(topError, true);
    }

    const acceptedTicketIds: string[] = [];
    const ticketTokenMap: Record<string, string> = {};
    const ticketErrors: string[] = [];
    let hasRetryableError = false;

    for (let i = 0; i < tickets.length; i++) {
      const ticket: ExpoPushTicket | undefined = tickets[i];
      const token = tokens[i];

      if (!ticket || typeof ticket !== "object") {
        ticketErrors.push("Ticket malformado na resposta do Expo");
        hasRetryableError = true;
        continue;
      }

      if (ticket.status === "ok") {
        if (typeof ticket.id === "string" && ticket.id.trim().length > 0) {
          const validTicketId = ticket.id.trim();
          acceptedTicketIds.push(validTicketId);
          if (token) {
            ticketTokenMap[validTicketId] = token;
            this.ticketTokenCache.set(validTicketId, token);
          }
        } else {
          // P2: Não gerar identificadores fictícios como accepted-0; classificar como resposta inconclusiva e elegível a retry
          ticketErrors.push(
            "Ticket ok sem identificador válido (resposta inconclusiva da Expo Push API)",
          );
          hasRetryableError = true;
        }
        continue;
      }

      const errorCode = ticket.details?.error || "UnknownTicketError";
      const errorDesc = ticket.message
        ? `${errorCode}: ${ticket.message}`
        : errorCode;
      ticketErrors.push(errorDesc);

      if (errorCode === "DeviceNotRegistered" && token) {
        await this.deviceTokensService.revokeInvalidToken(token).catch(() => undefined);
      }

      if (!NON_RETRYABLE_EXPO_ERRORS.has(errorCode)) {
        hasRetryableError = true;
      }
    }

    if (acceptedTicketIds.length === 0) {
      const summary =
        ticketErrors.join("; ") || "Todos os tickets de push falharam no Expo";
      throw new TicketDispatchError(summary, hasRetryableError);
    }

    return {
      acceptedTicketIds,
      ticketTokenMap,
      partialErrorSummary: ticketErrors.length > 0 ? ticketErrors.join("; ") : null,
    };
  }

  private async fetchExpoReceipts(
    ticketIds: string[],
    ticketTokenMap: Record<string, string> = {},
  ): Promise<
    | { kind: "delivered"; partialErrorSummary: string | null }
    | { kind: "pending_receipt" }
    | { kind: "failed"; errorMessage: string; retryable: boolean }
  > {
    const headers = {
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    };
    const bodyString = JSON.stringify({ ids: ticketIds });

    const response = await this.performHttpPost(EXPO_RECEIPTS_URL, headers, bodyString);
    if (!response.ok) {
      throw new Error(`Expo Push Receipts API retornou status HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      data?: Record<string, ExpoPushReceipt>;
    };

    const receiptsMap = result?.data;
    if (!receiptsMap || typeof receiptsMap !== "object" || Array.isArray(receiptsMap)) {
      return { kind: "pending_receipt" };
    }

    let okCount = 0;
    let missingCount = 0;
    let hasRetryableError = false;
    const receiptErrors: string[] = [];

    for (const ticketId of ticketIds) {
      const receipt = receiptsMap[ticketId];
      if (!receipt) {
        missingCount++;
        continue;
      }

      if (receipt.status === "ok") {
        okCount++;
        this.ticketTokenCache.delete(ticketId);
        continue;
      }

      const errorCode = receipt.details?.error || "UnknownReceiptError";
      const errorDesc = receipt.message
        ? `${errorCode}: ${receipt.message}`
        : errorCode;
      receiptErrors.push(errorDesc);

      if (errorCode === "DeviceNotRegistered") {
        // P1: Revogar apenas o token correspondente ao recibo inválido, preservando outros dispositivos do usuário
        const invalidToken =
          ticketTokenMap[ticketId] ?? this.ticketTokenCache.get(ticketId);
        if (invalidToken) {
          await this.deviceTokensService
            .revokeInvalidToken(invalidToken)
            .catch(() => undefined);
        }
        this.ticketTokenCache.delete(ticketId);
      }

      if (!NON_RETRYABLE_EXPO_ERRORS.has(errorCode)) {
        hasRetryableError = true;
      }
    }

    if (okCount > 0) {
      return {
        kind: "delivered",
        partialErrorSummary: receiptErrors.length > 0 ? receiptErrors.join("; ") : null,
      };
    }

    if (missingCount > 0 && receiptErrors.length === 0) {
      return { kind: "pending_receipt" };
    }

    return {
      kind: "failed",
      errorMessage: receiptErrors.join("; ") || "Recibo de push indicou falha na entrega",
      retryable: hasRetryableError,
    };
  }

  private async performHttpPost(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    const timeoutMs = this.httpTimeoutMs;
    const controller =
      typeof AbortController === "function" ? new AbortController() : null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller?.abort();
        reject(
          new TicketDispatchError(
            `Timeout na requisição para a Expo Push API após ${timeoutMs}ms (resposta do provedor incerta)`,
            true,
          ),
        );
      }, timeoutMs);
      timeoutHandle.unref?.();
    });

    const executeRequest = async (): Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }> => {
      try {
        if (this.transport) {
          return await this.transport(url, {
            method: "POST",
            headers,
            body,
            ...(controller ? { signal: controller.signal } : {}),
          });
        }

        const res = await fetch(url, {
          method: "POST",
          headers,
          body,
          ...(controller ? { signal: controller.signal } : {}),
        });
        return {
          ok: res.ok,
          status: res.status,
          json: () => res.json(),
        };
      } catch (err: unknown) {
        const isAbortOrTimeout =
          (err instanceof Error &&
            (err.name === "AbortError" ||
              /timeout|timed out|aborted/i.test(err.message))) ||
          controller?.signal.aborted;
        if (isAbortOrTimeout) {
          throw new TicketDispatchError(
            `Timeout na requisição para a Expo Push API após ${timeoutMs}ms (resposta do provedor incerta)`,
            true,
          );
        }
        throw err;
      }
    };

    try {
      return await Promise.race([executeRequest(), timeoutPromise]);
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
