import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../auth/session-auth.guard";
import { ProblemException } from "../errors/problem.exception";

export const operationUuid = z.uuid().transform(value => value.toLowerCase());
export const emptyOperationBody = z.object({}).strict();
type OperationRequest = Pick<AuthenticatedRequest, "headers" | "rawHeaders">;

function invalid(name: string, reason: string): never {
  throw new ProblemException({ typeSlug: "validation-error", title: "Requisição inválida", status: HttpStatus.BAD_REQUEST,
    code: "VALIDATION_ERROR", detail: "Confira os parâmetros, o corpo e o cabeçalho Idempotency-Key.", invalidParams: [{ name, reason }] });
}

export function validateOperationParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) invalid("params", "Os identificadores da rota devem ser UUIDs válidos.");
  return result.data;
}

/** Validação HTTP compartilhada; não decide regras de domínio ou idempotência persistida. */
export function validateOperationBody<T>(schema: z.ZodType<T>, body: unknown, request: OperationRequest, allowAbsent = false): T {
  if (body !== undefined && request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    invalid("body", "Quando houver corpo, envie JSON com Content-Type application/json.");
  }
  if (body === undefined && (request.headers["transfer-encoding"]
    || (request.headers["content-length"] && request.headers["content-length"] !== "0"))) {
    invalid("body", "O corpo enviado deve ser JSON válido.");
  }
  const value = body === undefined && allowAbsent ? {} : body;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid("body", "Envie somente o objeto JSON definido para esta operação.");
  }
  const result = schema.safeParse(value);
  if (!result.success) invalid("body", "Confira os campos obrigatórios; propriedades adicionais não são permitidas.");
  return result.data;
}

/** Chave opaca original, única, não vazia, até 128 caracteres e sem controles. */
export function validateOperationIdempotencyKey(request: OperationRequest): string {
  let occurrences = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() === "idempotency-key") occurrences++;
  }
  const key = request.headers["idempotency-key"];
  if (occurrences !== 1 || typeof key !== "string" || !key.trim() || key.length > 128
    || [...key].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    invalid("Idempotency-Key", "Envie uma única chave não vazia, de até 128 caracteres, sem controles.");
  }
  return key;
}
