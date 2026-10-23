import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import {
  InvalidParam,
  ProblemException,
} from "../common/errors/problem.exception";

export const DEFAULT_GAMES_LIMIT = 20;
export const MIN_GAMES_LIMIT = 1;
export const MAX_GAMES_LIMIT = 50;
export const MAX_GAME_NAME_LENGTH = 100;

export const listGamesQuerySchema = z
  .object({
    query: z
      .string({ error: "O filtro query deve ser texto." })
      .transform((val) => val.trim())
      .refine(
        (val) => val.length >= 1 && val.length <= MAX_GAME_NAME_LENGTH,
        {
          message:
            "O parâmetro query, quando informado, deve conter entre 1 e 100 caracteres válidos após remoção de espaços.",
        },
      )
      .optional(),
    limit: z
      .union([
        z.number(),
        z
          .string()
          .trim()
          .refine((val) => /^\d+$/.test(val), {
            message: "O parâmetro limit deve ser um número inteiro entre 1 e 50.",
          })
          .transform((val) => Number(val)),
      ])
      .refine(
        (val) =>
          Number.isInteger(val) &&
          val >= MIN_GAMES_LIMIT &&
          val <= MAX_GAMES_LIMIT,
        {
          message: "O parâmetro limit deve ser um número inteiro entre 1 e 50.",
        },
      )
      .optional()
      .default(DEFAULT_GAMES_LIMIT),
  })
  .strict();

export type ListGamesQueryDto = z.infer<typeof listGamesQuerySchema>;

export function validateGamesQuery(rawQuery: unknown): ListGamesQueryDto {
  if (
    typeof rawQuery !== "object" ||
    rawQuery === null ||
    Array.isArray(rawQuery)
  ) {
    throw new ProblemException({
      typeSlug: "validation-error",
      title: "Dados inválidos",
      status: HttpStatus.BAD_REQUEST,
      code: "VALIDATION_ERROR",
      detail: "Os parâmetros de consulta informados são inválidos.",
      invalidParams: [{ name: "query", reason: "Parâmetros de consulta inválidos." }],
    });
  }

  const parsed = listGamesQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const invalidParams: InvalidParam[] = parsed.error.issues.map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys =
          "keys" in issue && Array.isArray(issue.keys)
            ? issue.keys
            : ["unknown"];
        return {
          name: String(keys[0]),
          reason: `Parâmetro de consulta não permitido: ${keys.join(", ")}.`,
        };
      }
      const fieldName = issue.path.length > 0 ? issue.path.join(".") : "query";
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
      detail: "Confira os parâmetros de filtro enviados.",
      invalidParams,
    });
  }

  return parsed.data;
}
