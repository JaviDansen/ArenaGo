import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),
  DATABASE_CA_CERT: z.string().optional(),
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(`Configuração de ambiente inválida: ${z.prettifyError(result.error)}`);
}

export const environment = result.data;
