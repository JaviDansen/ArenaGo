import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import { DeviceTokensService } from "./device-tokens.service";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const PUSH_HTTP_TRANSPORT = Symbol("PUSH_HTTP_TRANSPORT");

export type PushHttpTransport = (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface QueueCallOutboxPayload {
  type: "queue.called";
  serviceSessionId: string;
  participationId: string;
  eventId: string;
  version: 1;
}

export interface CreateOutboxEntryInput {
  sessionId: string;
  userId: string;
  eventId: string;
  experienceId: string;
  participationId: string;
  calledAt: Date;
}

@Injectable()
export class QueueCallPushService {
  private readonly logger = new Logger(QueueCallPushService.name);
  private isProcessing = false;

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly database: NodePgDatabase<typeof schema>,
    @Inject(DeviceTokensService)
    private readonly deviceTokensService: DeviceTokensService,
    @Optional()
    @Inject(PUSH_HTTP_TRANSPORT)
    private readonly transport?: PushHttpTransport,
  ) {}

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
   * Processa a fila de outbox: verifica integridade da sessão, consulta tokens ativos,
   * envia push estritamente de dados (silencioso) e atualiza o status.
   */
  async dispatchPending(): Promise<{
    processed: number;
    delivered: number;
    expired: number;
    failed: number;
  }> {
    if (this.isProcessing) {
      return { processed: 0, delivered: 0, expired: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let delivered = 0;
    let expired = 0;
    let failed = 0;

    try {
      const pendingEntries = await this.database.execute<{
        id: string;
        serviceSessionId: string;
        userId: string;
        eventId: string;
        experienceId: string;
        payload: QueueCallOutboxPayload;
        attempts: number;
      }>(sql`
        SELECT
          id,
          service_session_id AS "serviceSessionId",
          user_id AS "userId",
          event_id AS "eventId",
          experience_id AS "experienceId",
          payload,
          attempts
        FROM queue_call_outbox
        WHERE status = 'pending' AND attempts < 3
        ORDER BY created_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      `);

      for (const entry of pendingEntries.rows) {
        processed++;

        // 1. Evitar despachar alertas de chamadas encerradas ou invalidadas
        const sessionCheck = await this.database.execute<{ status: string }>(
          sql`SELECT status FROM service_sessions WHERE id = ${entry.serviceSessionId}`,
        );

        if (!sessionCheck.rows.length || sessionCheck.rows[0].status !== "pending") {
          await this.database.execute(sql`
            UPDATE queue_call_outbox
            SET status = 'expired',
                processed_at = clock_timestamp(),
                last_error = 'Sessão de atendimento não está mais pendente'
            WHERE id = ${entry.id}
          `);
          expired++;
          continue;
        }

        // 2. Consultar tokens do participante chamado
        const tokens = await this.deviceTokensService.getActiveTokensForUser(entry.userId);

        if (tokens.length === 0) {
          // Sem dispositivos cadastrados: registrar conclusão da tentativa sem falha
          await this.database.execute(sql`
            UPDATE queue_call_outbox
            SET status = 'delivered',
                processed_at = clock_timestamp(),
                last_error = 'Nenhum dispositivo ativo registrado para o participante'
            WHERE id = ${entry.id}
          `);
          delivered++;
          continue;
        }

        // 3. Montar e transmitir push estritamente data-only
        try {
          await this.sendSilentPush(tokens.map((t) => t.pushToken), entry.payload);

          await this.database.execute(sql`
            UPDATE queue_call_outbox
            SET status = 'delivered',
                processed_at = clock_timestamp(),
                last_error = NULL
            WHERE id = ${entry.id}
          `);
          delivered++;
        } catch (pushError: unknown) {
          const errorMessage =
            pushError instanceof Error ? pushError.message : String(pushError);
          const nextAttempts = entry.attempts + 1;
          const newStatus = nextAttempts >= 3 ? "failed" : "pending";

          await this.database.execute(sql`
            UPDATE queue_call_outbox
            SET attempts = ${nextAttempts},
                status = ${newStatus},
                last_error = ${errorMessage}
            WHERE id = ${entry.id}
          `);

          if (newStatus === "failed") {
            failed++;
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, delivered, expired, failed };
  }

  private async sendSilentPush(
    tokens: string[],
    payload: QueueCallOutboxPayload,
  ): Promise<void> {
    const messages = tokens.map((token) => ({
      to: token,
      data: {
        type: payload.type,
        serviceSessionId: payload.serviceSessionId,
        participationId: payload.participationId,
        eventId: payload.eventId,
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

    let response: { ok: boolean; status: number; json: () => Promise<unknown> };

    if (this.transport) {
      response = await this.transport(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: bodyString,
      });
    } else {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: bodyString,
      });
      response = {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
      };
    }

    if (!response.ok) {
      throw new Error(`Expo Push API retornou status HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
    };

    if (Array.isArray(result?.data)) {
      for (let i = 0; i < result.data.length; i++) {
        const ticket = result.data[i];
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          const invalidToken = tokens[i];
          if (invalidToken) {
            await this.deviceTokensService.revokeInvalidToken(invalidToken).catch(() => undefined);
          }
        }
      }
    }
  }
}
