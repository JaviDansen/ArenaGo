import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import {
  InvalidParam,
  ProblemException,
} from "../common/errors/problem.exception";
import { MAX_GAME_NAME_LENGTH } from "../games/games.dto";
import { deduplicateGameNames } from "../games/games.service";
import {
  DEFAULT_REFERENCE_CIVIL_TIMEZONE,
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  MARKET_INTEREST_OPTIONS,
  MARKET_KNOWLEDGE_OPTIONS,
} from "./profile-questionnaire.types";

const CIVIL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function getReferenceCivilTimezone(): string {
  const configured = process.env.ARENAGO_CIVIL_TIMEZONE?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_REFERENCE_CIVIL_TIMEZONE;
}

/**
 * Valida se uma string `YYYY-MM-DD` corresponde a uma data civil real do calendário gregoriano,
 * sem conversões de fuso horário (`Date` UTC/local).
 */
export function isValidGregorianCivilDate(iso: string): boolean {
  const match = CIVIL_DATE_REGEX.exec(iso);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

/**
 * Obtém a data civil (`YYYY-MM-DD`) do instante informado no fuso civil de referência do servidor.
 */
export function getServerCivilDateToday(
  now: Date = new Date(),
  timeZone: string = getReferenceCivilTimezone(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Falha ao formatar data civil no fuso ${timeZone}.`);
  }

  return `${year}-${month}-${day}`;
}

export function buildUpsertQuestionnaireSchema(
  todayCivilDate: string = getServerCivilDateToday(),
) {
  return z
    .object({
      birthDate: z
        .string({ error: "A data de nascimento é obrigatória e deve ser texto." })
        .trim()
        .superRefine((val, ctx) => {
          if (!CIVIL_DATE_REGEX.test(val)) {
            ctx.addIssue({
              code: "custom",
              message: "Informe a data de nascimento no formato civil YYYY-MM-DD.",
            });
            return;
          }
          if (!isValidGregorianCivilDate(val)) {
            ctx.addIssue({
              code: "custom",
              message:
                "Informe uma data de nascimento real do calendário gregoriano.",
            });
            return;
          }
          if (val > todayCivilDate) {
            ctx.addIssue({
              code: "custom",
              message: "A data de nascimento não pode estar no futuro.",
            });
          }
        }),
      gender: z.enum(GENDER_OPTIONS, {
        error:
          "Selecione uma opção de gênero válida (Feminino, Masculino, Outro ou Prefiro não informar).",
      }),
      otherGender: z
        .string({ error: "O campo otherGender deve ser texto ou nulo." })
        .nullable()
        .optional(),
      education: z.enum(EDUCATION_OPTIONS, {
        error:
          "Selecione uma opção de escolaridade válida (Fundamental, Médio, Superior, Pós-graduação ou Prefiro não informar).",
      }),
      selectedGames: z
        .array(
          z
            .string({ error: "Cada nome de jogo deve ser texto." })
            .transform((name) => name.trim())
            .refine(
              (trimmed) =>
                trimmed.length >= 1 && trimmed.length <= MAX_GAME_NAME_LENGTH,
              {
                message:
                  "Cada nome de jogo deve possuir entre 1 e 100 caracteres após remoção de espaços.",
              },
            ),
          {
            error: "A lista de jogos selecionados (selectedGames) é obrigatória.",
          },
        )
        .min(1, {
          message: "É necessário selecionar ao menos um jogo.",
        }),
      marketKnowledge: z.enum(MARKET_KNOWLEDGE_OPTIONS, {
        error: "Selecione uma opção válida sobre conhecimento do mercado de games.",
      }),
      marketInterest: z.enum(MARKET_INTEREST_OPTIONS, {
        error: "Selecione uma opção válida sobre interesse no mercado de games.",
      }),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (data.gender === "Outro") {
        const trimmedOther =
          typeof data.otherGender === "string" ? data.otherGender.trim() : "";
        if (trimmedOther.length < 1 || trimmedOther.length > 100) {
          ctx.addIssue({
            code: "custom",
            path: ["otherGender"],
            message:
              "Quando o gênero for 'Outro', otherGender deve conter entre 1 e 100 caracteres após remoção de espaços.",
          });
        }
      }
    })
    .transform((data) => ({
      birthDate: data.birthDate,
      gender: data.gender,
      otherGender:
        data.gender === "Outro" ? data.otherGender!.trim() : null,
      education: data.education,
      selectedGames: deduplicateGameNames(data.selectedGames),
      marketKnowledge: data.marketKnowledge,
      marketInterest: data.marketInterest,
    }));
}

export type UpsertQuestionnaireDto = z.infer<
  ReturnType<typeof buildUpsertQuestionnaireSchema>
>;

export function validateUpsertQuestionnaireDto(
  payload: unknown,
  todayCivilDate: string = getServerCivilDateToday(),
): UpsertQuestionnaireDto {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new ProblemException({
      typeSlug: "validation-error",
      title: "Dados inválidos",
      status: HttpStatus.BAD_REQUEST,
      code: "VALIDATION_ERROR",
      detail: "O corpo da requisição deve ser um objeto JSON válido.",
      invalidParams: [{ name: "body", reason: "Objeto JSON esperado." }],
    });
  }

  const schema = buildUpsertQuestionnaireSchema(todayCivilDate);
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    const invalidParams: InvalidParam[] = parsed.error.issues.map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys =
          "keys" in issue && Array.isArray(issue.keys)
            ? issue.keys
            : ["unknown"];
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
