import "dotenv/config";
import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().url(),
    DATABASE_DIRECT_URL: z.string().url().optional(),
    DATABASE_CA_CERT: z.string().optional(),
    JWT_SECRET: z.string().min(32).default("arenago-local-dev-jwt-secret-key-at-least-32-chars"),
    JWT_TEMP_SECRET: z.string().min(32).default("arenago-local-dev-temp-jwt-secret-key-32-chars"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.JWT_SECRET === "arenago-local-dev-jwt-secret-key-at-least-32-chars") {
        ctx.addIssue({
          code: "custom",
          path: ["JWT_SECRET"],
          message: "JWT_SECRET explícito é obrigatório em produção.",
        });
      }
      if (env.JWT_TEMP_SECRET === "arenago-local-dev-temp-jwt-secret-key-32-chars") {
        ctx.addIssue({
          code: "custom",
          path: ["JWT_TEMP_SECRET"],
          message: "JWT_TEMP_SECRET explícito é obrigatório em produção.",
        });
      }
    }
    if (env.JWT_SECRET === env.JWT_TEMP_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_TEMP_SECRET"],
        message: "JWT_TEMP_SECRET deve ser distinto de JWT_SECRET.",
      });
    }
  });

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(`Configuração de ambiente inválida: ${z.prettifyError(result.error)}`);
}

export const environment = result.data;
