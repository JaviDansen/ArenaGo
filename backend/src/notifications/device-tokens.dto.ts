import { z } from "zod";
import { HttpStatus } from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";

export const registerPushTokenSchema = z.object({
  pushToken: z
    .string()
    .trim()
    .min(10, "Token de push deve conter pelo menos 10 caracteres.")
    .max(255, "Token de push não pode exceder 255 caracteres."),
  platform: z
    .enum(["android", "ios"])
    .optional()
    .default("android"),
});

export type RegisterPushTokenDto = z.infer<typeof registerPushTokenSchema>;

export const unregisterPushTokenSchema = z.object({
  pushToken: z
    .string()
    .trim()
    .min(10, "Token de push deve conter pelo menos 10 caracteres.")
    .max(255, "Token de push não pode exceder 255 caracteres."),
});

export type UnregisterPushTokenDto = z.infer<typeof unregisterPushTokenSchema>;

export function validateDto<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const invalidParams = result.error.issues.map((issue) => ({
      name: issue.path.join("."),
      reason: issue.message,
    }));
    throw new ProblemException({
      typeSlug: "invalid-request-body",
      title: "Corpo da requisição inválido",
      status: HttpStatus.BAD_REQUEST,
      code: "INVALID_REQUEST_BODY",
      detail: "Os dados enviados não atendem aos requisitos de validação.",
      invalidParams,
    });
  }
  return result.data;
}
