
import { URL } from "node:url";

const ALLOWED_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_PORTS = new Set(["5432", "55432"]);

const ALLOWED_DATABASES = new Set([
  "arenago_test",
  "arenago_k03_test",
  "arenago_events_test",
]);

/**
 * Barreira de segurança contra execução de testes em bancos
 * remotos, de desenvolvimento ou de homologação.
 *
 * Permite somente bancos descartáveis explicitamente
 * autorizados em servidores PostgreSQL locais.
 *
 * Regras:
 * 1. Protocolo PostgreSQL obrigatório.
 * 2. Host limitado a localhost ou 127.0.0.1.
 * 3. Portas limitadas a 5432 e 55432.
 * 4. Banco limitado à lista de testes autorizados.
 * 5. arenago_events_test permitido somente na porta 55432.
 * 6. Redirecionamentos de host, porta ou banco bloqueados.
 */
export function assertSafeTestDatabase(
  urlStr: string | undefined,
): string {
  if (!urlStr || typeof urlStr !== "string" || !urlStr.trim()) {
    throw new Error(
      "DATABASE_URL local descartável é obrigatório para os testes de integração.",
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("DATABASE_URL inválida.");
  }

  // 1. Validar protocolo.
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Protocolo "${parsed.protocol}" inválido. Apenas conexões PostgreSQL são permitidas.`,
    );
  }

  // 2. Ler parâmetros que podem alterar o destino da conexão.
  let queryHost: string | null = null;
  let queryPort: string | null = null;

  for (const [rawKey, rawValue] of parsed.searchParams) {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim().toLowerCase();

    // O banco deve ser definido exclusivamente no caminho da URL.
    if (key === "database" || key === "dbname") {
      throw new Error(
        "[SEGURANÇA BLOQUEADA] Redirecionamento de banco pela URL não permitido.",
      );
    }

    if (key === "host") {
      if (queryHost !== null) {
        throw new Error(
          "[SEGURANÇA BLOQUEADA] Parâmetro host duplicado.",
        );
      }

      queryHost = value;
    }

    if (key === "port") {
      if (queryPort !== null) {
        throw new Error(
          "[SEGURANÇA BLOQUEADA] Parâmetro port duplicado.",
        );
      }

      queryPort = value;
    }
  }

  // 3. Identificar o destino informado na autoridade da URL.
  const authorityHost = parsed.hostname.toLowerCase();
  const authorityPort = parsed.port || "5432";

  // 4. Rejeitar parâmetros que tentem alterar host ou porta.
  if (queryHost !== null && queryHost !== authorityHost) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Redirecionamento de host divergente detectado na query URL ("${authorityHost}" -> "${queryHost}").`,
    );
  }

  if (queryPort !== null && queryPort !== authorityPort) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Redirecionamento de porta divergente detectado na query URL ("${authorityPort}" -> "${queryPort}").`,
    );
  }

  const effectiveHost = queryHost ?? authorityHost;
  const effectivePort = queryPort ?? authorityPort;

  // 5. Bloquear servidores remotos ou compartilhados.
  if (
    effectiveHost.includes("neon.tech") ||
    effectiveHost.includes("aws.neon.tech") ||
    effectiveHost.includes("supabase.co") ||
    effectiveHost.includes("rds.amazonaws.com") ||
    effectiveHost.includes("example") ||
    effectiveHost.startsWith("/")
  ) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Execução de testes de integração rejeitada contra host compartilhado/remoto "${effectiveHost}".`,
    );
  }

  if (!ALLOWED_HOSTS.has(effectiveHost)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O host "${effectiveHost}" não é reconhecido como host local loopback autorizado.`,
    );
  }

  // 6. Validar porta.
  if (!ALLOWED_PORTS.has(effectivePort)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] A porta efetiva "${effectivePort}" não pertence à allowlist de portas autorizadas para testes locais descartáveis.`,
    );
  }

  // 7. Identificar o banco solicitado.
  const databaseName = parsed.pathname
    .replace(/^\//, "")
    .toLowerCase();

  // Bloquear nomes associados a produção ou backups.
  if (
    databaseName.includes("prod") ||
    databaseName.includes("production") ||
    databaseName.includes("backup") ||
    databaseName.includes("latest")
  ) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O banco "${databaseName}" contém indicador de produção ou backup.`,
    );
  }

  // 8. Exigir banco de testes explicitamente autorizado.
  if (!ALLOWED_DATABASES.has(databaseName)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O banco "${databaseName}" não está na lista de bancos descartáveis de teste autorizados (${Array.from(ALLOWED_DATABASES).join(", ")}).`,
    );
  }

  // 9. Restringir o banco dos eventos ao PostgreSQL local na porta 55432.
  if (
    databaseName === "arenago_events_test" &&
    effectivePort !== "55432"
  ) {
    throw new Error(
      "[SEGURANÇA BLOQUEADA] arenago_events_test exige a porta 55432.",
    );
  }

  return urlStr;
}
