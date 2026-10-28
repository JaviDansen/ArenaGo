import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import { InvalidParam, ProblemException } from "../common/errors/problem.exception";

export const updateProfileSchema = z
  .object({
    name: z
      .string({ error: "O nome é obrigatório e deve ser texto." })
      .transform((val) => val.trim())
      .refine((val) => val.length >= 2 && val.length <= 150, {
        message:
          "O nome deve possuir entre 2 e 150 caracteres após remoção de espaços.",
      }),
  })
  .strict();

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export function validateUpdateProfileDto(payload: unknown): UpdateProfileDto {
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

  const parsed = updateProfileSchema.safeParse(payload);
  if (!parsed.success) {
    const invalidParams: InvalidParam[] = parsed.error.issues.map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys =
          "keys" in issue && Array.isArray(issue.keys)
            ? issue.keys
            : ["unknown"];
        return {
          name: String(keys[0]),
          reason: `Propriedade não permitida no contrato de perfil: ${keys.join(", ")}.`,
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
