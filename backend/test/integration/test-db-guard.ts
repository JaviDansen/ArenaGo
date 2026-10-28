import { URL } from "node:url";

const ALLOWED_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_PORTS = new Set(["5432", "55432"]);
const ALLOWED_DATABASES = new Set(["arenago_test", "arenago_k03_test"]);

/**
 * Barreira explícita de segurança contra execução em bancos remotos/compartilhados.
 * Reconhece apenas conexões locais comprovadas (localhost / 127.0.0.1), portas autorizadas (5432 / 55432)
 * e bancos de teste descartáveis autorizados (arenago_test / arenago_k03_test).
 *
 * Valida rigorosamente:
 * 1. Protocolo suportado (postgresql: ou postgres:).
 * 2. Host da autoridade e parâmetros de query (impedindo redirecionamento para host remoto ou socket).
 * 3. Porta da autoridade e parâmetros de query (impedindo redirecionamento para portas não autorizadas ou divergentes).
 * 4. Nome do banco de dados (impedindo bancos com indicadores de produção ou backup).
 */
export function assertSafeTestDatabase(urlStr: string | undefined): string {
  if (!urlStr || typeof urlStr !== "string" || !urlStr.trim()) {
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

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Protocolo "${parsed.protocol}" inválido. Apenas conexões PostgreSQL ("postgresql:" ou "postgres:") são permitidas.`,
    );
  }

  // Verificar se há redirecionamento de host ou porta via parâmetros de busca (ex: ?host=..., ?port=..., ?h%6fst=...)
  // Em drivers pg (pg-connection-string), o último parâmetro host/port decodificado prevalece sobre a autoridade.
  let queryHost: string | null = null;
  let queryPort: string | null = null;

  if (parsed.search) {
    const rawQuery = parsed.search.replace(/^\?/, "");
    const pairs = rawQuery.split("&");
    for (const pair of pairs) {
      const [rawKey, rawVal] = pair.split("=");
      try {
        const decodedKey = decodeURIComponent(rawKey || "").trim().toLowerCase();
        if (decodedKey === "host") {
          queryHost = decodeURIComponent(rawVal || "").trim().toLowerCase();
        } else if (decodedKey === "port") {
          queryPort = decodeURIComponent(rawVal || "").trim().toLowerCase();
        }
      } catch {
        throw new Error("[SEGURANÇA BLOQUEADA] Parâmetros de query malformados.");
      }
    }
  }

  const authorityHost = parsed.hostname.toLowerCase();
  const authorityPort = parsed.port || "5432";

  // Host e porta efetivamente interpretados pelo driver pg
  const effectiveHost = queryHost !== null ? queryHost : authorityHost;
  const effectivePort = queryPort !== null ? queryPort : authorityPort;

  // Rejeitar redirecionamento divergente entre autoridade e parâmetros de query
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

  // Bloqueio categórico contra hosts remotos, nuvem ou socket Unix não atestado
  if (
    effectiveHost.includes("neon.tech") ||
    effectiveHost.includes("aws.neon.tech") ||
    effectiveHost.includes("supabase.co") ||
    effectiveHost.includes("rds.amazonaws.com") ||
    effectiveHost.includes("example") ||
    effectiveHost.startsWith("/")
  ) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Execução de testes de integração rejeitada contra host compartilhado/remoto "${effectiveHost}". Os testes devem rodar exclusivamente contra um PostgreSQL local descartável.`,
    );
  }

  if (!ALLOWED_HOSTS.has(effectiveHost)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O host "${effectiveHost}" não é reconhecido como host local loopback autorizado.`,
    );
  }

  // Validar se a porta efetiva pertence à allowlist de portas locais de teste autorizadas
  if (!ALLOWED_PORTS.has(effectivePort)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] A porta efetiva "${effectivePort}" não pertence à allowlist de portas autorizadas para testes locais descartáveis (portas permitidas: 5432, 55432).`,
    );
  }

  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();

  // Rejeitar nomes com indicadores de produção ou backup
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

  if (!ALLOWED_DATABASES.has(databaseName)) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] O banco "${databaseName}" não está na lista de bancos descartáveis de teste autorizados (${Array.from(ALLOWED_DATABASES).join(", ")}).`,
    );
  }

  return urlStr;
}
