import { URL } from "node:url";

/**
 * Barreira explícita de segurança contra execução em bancos compartilhados (Seção G).
 * Reconhece apenas bancos locais descartáveis como arenago_k03_test.
 */
export function assertSafeTestDatabase(urlStr: string | undefined): string {
  if (!urlStr) {
    throw new Error(
      "DATABASE_URL local descartável é obrigatório para os testes de integração.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`DATABASE_URL inválido: ${urlStr}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();

  // Bloqueio categórico contra Neon e serviços compartilhados em nuvem
  if (
    hostname.includes("neon.tech") ||
    hostname.includes("aws.neon.tech") ||
    hostname.includes("supabase.co") ||
    hostname.includes("rds.amazonaws.com")
  ) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Execução de testes de integração rejeitada contra host compartilhado/nuvem "${hostname}". Os testes devem rodar exclusivamente contra um PostgreSQL local descartável.`,
    );
  }

  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "postgres" ||
    hostname === "arenago-local-pg";

  if (!isLocalHost) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O host "${hostname}" não é reconhecido como ambiente local descartável.`,
    );
  }

  const isAuthorizedDbName =
    databaseName.includes("test") ||
    databaseName.includes("descarta") ||
    databaseName.includes("k03");

  if (!isAuthorizedDbName) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O banco "${databaseName}" não contém 'test' em seu nome. Apenas bancos de teste descartáveis (ex: arenago_k03_test) são autorizados.`,
    );
  }

  return urlStr;
}
