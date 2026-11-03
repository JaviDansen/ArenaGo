import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";

const uuid = z.uuid().transform(value => value.toLowerCase());
export const callNextParamsSchema = z.object({ eventId: uuid, experienceId: uuid, stationId: uuid }).strict();
export const serviceSessionParamsSchema = z.object({ eventId: uuid, serviceSessionId: uuid }).strict();

function invalid(name: string, reason: string): never {
  throw new ProblemException({ typeSlug: "validation-error", title: "Requisição inválida", status: HttpStatus.BAD_REQUEST,
    code: "VALIDATION_ERROR", detail: "Confira os parâmetros, o corpo e o cabeçalho Idempotency-Key.", invalidParams: [{ name, reason }] });
}

export function validateStaffParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) invalid("params", "Os identificadores da rota devem ser UUIDs válidos.");
  return result.data;
}

/** Mesmos limites dos serviços: chave opaca não vazia, até 128 caracteres, sem normalização. */
export function validateStaffRequest(body: unknown, request: Pick<AuthenticatedRequest, "headers" | "rawHeaders">): string {
  if (body !== undefined && request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    invalid("body", "Quando houver corpo, envie um objeto JSON vazio com Content-Type application/json.");
  }
  if (body === undefined) {
    // Sem parser para text/plain/outros tipos não significa corpo vazio.
    if (request.headers["transfer-encoding"] || (request.headers["content-length"] && request.headers["content-length"] !== "0")) {
      invalid("body", "Envie apenas um objeto JSON vazio ou nenhum corpo.");
    }
  } else if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).length !== 0) {
    invalid("body", "Nenhuma propriedade é permitida; envie apenas {}.");
  }
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
