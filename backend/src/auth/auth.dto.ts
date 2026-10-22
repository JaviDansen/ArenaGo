import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import { InvalidParam, ProblemException } from "../common/errors/problem.exception";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string): string {
  return name.trim();
}

export const registerSchema = z
  .object({
    name: z
      .string({ error: "O nome é obrigatório e deve ser texto." })
      .transform(normalizeName)
      .refine((v) => v.length >= 2 && v.length <= 150, {
        message: "O nome deve possuir entre 2 e 150 caracteres após remoção de espaços.",
      }),
    email: z
      .string({ error: "O e-mail é obrigatório e deve ser texto." })
      .transform(normalizeEmail)
      .refine((v) => v.length > 0 && v.length <= 255 && EMAIL_REGEX.test(v), {
        message: "Informe um e-mail com formato válido (até 255 caracteres).",
      }),
    password: z
      .string({ error: "A senha é obrigatória e deve ser texto." })
      .min(8, { message: "A senha deve possuir no mínimo 8 caracteres." })
      .max(128, { message: "A senha deve possuir no máximo 128 caracteres." }),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z
      .string({ error: "O e-mail é obrigatório e deve ser texto." })
      .transform(normalizeEmail)
      .refine((v) => v.length > 0 && v.length <= 255 && EMAIL_REGEX.test(v), {
        message: "Informe um e-mail com formato válido.",
      }),
    password: z
      .string({ error: "A senha é obrigatória e deve ser texto." })
      .min(1, { message: "A senha é obrigatória." })
      .max(128, { message: "A senha deve possuir no máximo 128 caracteres." }),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z
      .string({ error: "O refresh token é obrigatório e deve ser texto." })
      .trim()
      .min(16, { message: "Informe um refresh token válido." })
      .max(512, { message: "Informe um refresh token válido." }),
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;

export function validateDto<T>(schema: z.ZodType<T>, payload: unknown): T {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProblemException({
      typeSlug: "validation-error",
      title: "Dados inválidos",
      status: HttpStatus.BAD_REQUEST,
      code: "VALIDATION_ERROR",
      detail: "O corpo da requisição deve ser um objeto JSON válido.",
      invalidParams: [{ name: "body", reason: "Objeto JSON esperado." }],
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const invalidParams: InvalidParam[] = parsed.error.issues.map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys : ["unknown"];
        return {
          name: String(keys[0]),
          reason: `Propriedade não permitida no contrato da API: ${keys.join(", ")}.`,
        };
      }
      const fieldName = issue.path.length > 0 ? issue.path.join(".") : "body";
      return {
        name: fieldName,
        reason: issue.message,
      };
    });

    throw new ProblemException({
      typeSlug: "validation-error",
      title: "Dados inválidos",
      status: HttpStatus.BAD_REQUEST,
      code: "VALIDATION_ERROR",
      detail: "Confira as informações enviadas.",
      invalidParams,
    });
  }

  return parsed.data;
}
