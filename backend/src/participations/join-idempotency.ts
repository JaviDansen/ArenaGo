import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransactionExecutor } from "../database/database-executor";
import { events } from "../database/schema/events.schema";
import { idempotencyOperations } from "../database/schema/idempotency.schema";
import { users } from "../database/schema/identity.schema";

/** Valor compatível com JSON usado na canonicalização de pedidos e respostas mínimas. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Nome persistido da operação de ingresso aprovado no schema e nos testes DB-08/V11-05. */
export const JOIN_IDEMPOTENCY_OPERATION = "join";

export type IdempotencyReservationResult =
  | { kind: "reserved"; operationId: string }
  | {
    kind: "replay";
    operationId: string;
    httpStatus: number;
    resultReference: string | null;
    resultPayload: JsonValue | null;
  }
  | { kind: "request_conflict"; operationId: string }
  | { kind: "in_progress"; operationId: string };

export interface ReserveIdempotencyOperationInput {
  actorUserId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  /** Expiração explícita; a política de TTL de produto permanece pendente. */
  expiresAt: Date;
}

export interface CompleteIdempotencyOperationInput {
  httpStatus: number;
  resultReference: string | null;
  /** Somente campos mínimos e não sensíveis devem ser persistidos aqui. */
  resultPayload: JsonValue | null;
}

export interface CompletedIdempotencyOperation extends CompleteIdempotencyOperationInput {
  operationId: string;
}

function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Fingerprint JSON não aceita números não finitos.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Gera SHA-256 sobre JSON canônico: objetos ordenam chaves recursivamente e listas mantêm sua ordem.
 * O ator não entra no pedido; sua identidade é resolvida pelo chamador e compõe a chave UNIQUE.
 */
export function createRequestFingerprint(operation: string, request: JsonValue): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, request }), "utf8")
    .digest("hex");
}

/** O eventId é o conteúdo relevante do pedido de ingresso nesta etapa. */
export function createJoinRequestFingerprint(eventId: string): string {
  return createRequestFingerprint(JOIN_IDEMPOTENCY_OPERATION, { eventId });
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value).every(isJsonValue);
}

function getPersistedJsonValue(value: unknown): JsonValue | null {
  if (value === null) return null;
  if (!isJsonValue(value)) {
    throw new Error("A resposta persistida da operação idempotente não contém JSON válido.");
  }
  return value;
}

/**
 * Reserva ou interpreta uma chave dentro da transação corrente.
 *
 * @remarks O chamador deve adquirir primeiro os locks de domínio exigidos pela operação; no ingresso,
 * a ordem é `events FOR UPDATE` e depois `users FOR UPDATE`. Este helper não abre conexão nem transação.
 */
export async function reserveIdempotencyOperationWithTx(
  tx: DatabaseTransactionExecutor,
  input: ReserveIdempotencyOperationInput,
): Promise<IdempotencyReservationResult> {
  if (!/^[a-f0-9]{64}$/.test(input.requestHash)) {
    throw new Error("requestHash deve ser SHA-256 hexadecimal em letras minúsculas.");
  }

  const [inserted] = await tx
    .insert(idempotencyOperations)
    .values({
      id: randomUUID(),
      actorUserId: input.actorUserId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: "in_progress",
      httpStatus: null,
      resultReference: null,
      resultPayload: null,
      createdAt: sql`clock_timestamp()`,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: [
        idempotencyOperations.actorUserId,
        idempotencyOperations.operation,
        idempotencyOperations.idempotencyKey,
      ],
    })
    .returning({ id: idempotencyOperations.id });

  if (inserted) return { kind: "reserved", operationId: inserted.id };

  // READ COMMITTED dá a esta consulta um snapshot novo após a eventual espera no índice UNIQUE.
  const [existing] = await tx
    .select({
      id: idempotencyOperations.id,
      requestHash: idempotencyOperations.requestHash,
      status: idempotencyOperations.status,
      httpStatus: idempotencyOperations.httpStatus,
      resultReference: idempotencyOperations.resultReference,
      resultPayload: idempotencyOperations.resultPayload,
    })
    .from(idempotencyOperations)
    .where(and(
      eq(idempotencyOperations.actorUserId, input.actorUserId),
      eq(idempotencyOperations.operation, input.operation),
      eq(idempotencyOperations.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1);

  if (!existing) {
    throw new Error("A chave idempotente conflitou, mas o registro não foi encontrado em READ COMMITTED.");
  }
  if (existing.requestHash !== input.requestHash) {
    return { kind: "request_conflict", operationId: existing.id };
  }
  if (existing.status === "in_progress") {
    return { kind: "in_progress", operationId: existing.id };
  }
  if (existing.status !== "completed" || existing.httpStatus === null) {
    throw new Error("A operação idempotente persistida viola o contrato de status e resposta.");
  }

  return {
    kind: "replay",
    operationId: existing.id,
    httpStatus: existing.httpStatus,
    resultReference: existing.resultReference,
    resultPayload: getPersistedJsonValue(existing.resultPayload),
  };
}

/** Código de domínio persistido como resultado terminal de uma intenção de ingresso abandonada. */
export const ADMISSION_INTENT_ABANDONED = "ADMISSION_INTENT_ABANDONED";

/**
 * Resultado terminal de abandono gravado na própria linha de idempotência do ingresso
 * (`status=completed`, sem referência de participação). Por ocupar a mesma chave UNIQUE
 * (ator, `join`, chave), nenhuma requisição posterior com essa chave pode criar participação.
 */
export const ABANDONED_JOIN_RESULT = {
  httpStatus: 409,
  resultReference: null,
  resultPayload: { code: ADMISSION_INTENT_ABANDONED },
} as const satisfies CompleteIdempotencyOperationInput;

/** Leitura semântica de uma operação `join` concluída. */
export type CompletedJoinOutcome =
  | { state: "completed"; participationId: string }
  | { state: "abandoned" };

/**
 * Interpreta o resultado persistido de uma operação `join` concluída.
 * Ingresso: HTTP 201 com `resultReference` igual a `resultPayload.participationId` (formato
 * gravado desde a Etapa 3). Abandono: {@link ABANDONED_JOIN_RESULT}. Qualquer outro formato
 * é violação de integridade e nunca é tratado como ingresso nem como chave livre.
 */
export function classifyCompletedJoin(result: {
  httpStatus: number;
  resultReference: string | null;
  resultPayload: JsonValue | null;
}): CompletedJoinOutcome {
  const payload = result.resultPayload;
  const isObject = payload !== null && typeof payload === "object" && !Array.isArray(payload);
  if (result.httpStatus === 201 && result.resultReference && isObject
    && (payload as { readonly [key: string]: JsonValue }).participationId === result.resultReference) {
    return { state: "completed", participationId: result.resultReference };
  }
  if (result.httpStatus === ABANDONED_JOIN_RESULT.httpStatus && result.resultReference === null && isObject
    && (payload as { readonly [key: string]: JsonValue }).code === ADMISSION_INTENT_ABANDONED) {
    return { state: "abandoned" };
  }
  throw new Error("Resultado persistido de ingresso com formato desconhecido.");
}

/** Estado de uma intenção de ingresso visto pela consulta somente-leitura. */
export type JoinIntentLookupResult =
  | CompletedJoinOutcome
  | { state: "not_found" }
  | { state: "in_progress" }
  | { state: "conflict" };

/**
 * Consulta a linha de idempotência `join` da chave, sem reservar, travar ou escrever.
 * `not_found` significa apenas ausência visível no instante da leitura: uma requisição original
 * ainda em trânsito pode criar o registro depois. Só `abandoned` impede a execução futura.
 */
export async function readJoinIntentWithExecutor(
  executor: DatabaseTransactionExecutor,
  input: { actorUserId: string; eventId: string; idempotencyKey: string },
): Promise<JoinIntentLookupResult> {
  const [existing] = await executor
    .select({
      requestHash: idempotencyOperations.requestHash,
      status: idempotencyOperations.status,
      httpStatus: idempotencyOperations.httpStatus,
      resultReference: idempotencyOperations.resultReference,
      resultPayload: idempotencyOperations.resultPayload,
    })
    .from(idempotencyOperations)
    .where(and(
      eq(idempotencyOperations.actorUserId, input.actorUserId),
      eq(idempotencyOperations.operation, JOIN_IDEMPOTENCY_OPERATION),
      eq(idempotencyOperations.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1);
  if (!existing) return { state: "not_found" };
  if (existing.requestHash !== createJoinRequestFingerprint(input.eventId)) return { state: "conflict" };
  if (existing.status === "in_progress") return { state: "in_progress" };
  if (existing.status !== "completed" || existing.httpStatus === null) {
    throw new Error("A operação idempotente persistida viola o contrato de status e resposta.");
  }
  return classifyCompletedJoin({
    httpStatus: existing.httpStatus,
    resultReference: existing.resultReference,
    resultPayload: getPersistedJsonValue(existing.resultPayload),
  });
}

/**
 * Reserva especificamente o ingresso depois de bloquear evento e usuário na ordem arquitetural.
 * A transação continua pertencendo ao chamador, que deve revalidar e concluir ou fazer rollback;
 * nunca deve confirmar apenas a reserva `in_progress`.
 */
export async function reserveJoinIntentWithTx(
  tx: DatabaseTransactionExecutor,
  input: {
    actorUserId: string;
    eventId: string;
    idempotencyKey: string;
    expiresAt: Date;
  },
): Promise<IdempotencyReservationResult> {
  await tx
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, input.eventId))
    .for("update")
    .limit(1);
  await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.actorUserId))
    .for("update")
    .limit(1);

  return reserveIdempotencyOperationWithTx(tx, {
    actorUserId: input.actorUserId,
    operation: JOIN_IDEMPOTENCY_OPERATION,
    idempotencyKey: input.idempotencyKey,
    requestHash: createJoinRequestFingerprint(input.eventId),
    expiresAt: input.expiresAt,
  });
}

/** Atualiza a reserva para concluída dentro do mesmo tx do efeito de negócio. */
export async function completeIdempotencyOperationWithTx(
  tx: DatabaseTransactionExecutor,
  operationId: string,
  input: CompleteIdempotencyOperationInput,
): Promise<CompletedIdempotencyOperation> {
  const [completed] = await tx
    .update(idempotencyOperations)
    .set({
      status: "completed",
      httpStatus: input.httpStatus,
      resultReference: input.resultReference,
      resultPayload: input.resultPayload,
    })
    .where(and(
      eq(idempotencyOperations.id, operationId),
      eq(idempotencyOperations.status, "in_progress"),
    ))
    .returning({
      id: idempotencyOperations.id,
      httpStatus: idempotencyOperations.httpStatus,
      resultReference: idempotencyOperations.resultReference,
      resultPayload: idempotencyOperations.resultPayload,
    });

  if (!completed || completed.httpStatus === null) {
    throw new Error("Somente uma reserva in_progress pode ser concluída.");
  }

  return {
    operationId: completed.id,
    httpStatus: completed.httpStatus,
    resultReference: completed.resultReference,
    resultPayload: getPersistedJsonValue(completed.resultPayload),
  };
}
