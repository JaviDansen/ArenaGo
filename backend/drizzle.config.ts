import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Sem configuração explícita, o CLI só aponta para um destino local fictício.
const migrationUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL ||
  "postgresql://arenago:local-only@127.0.0.1:55432/arenago_dev";

export default defineConfig({
  dialect: "postgresql",
  schema: process.env.DRIZZLE_SCHEMA || "./src/database/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true,
});
