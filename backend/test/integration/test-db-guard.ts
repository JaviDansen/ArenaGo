import { URL } from "node:url";

const ALLOWED_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_DATABASES = new Set(["arenago_test", "arenago_k03_test"]);

/**
 * Barreira explícita de segurança contra execução em bancos remotos/compartilhados.
 * Reconhece apenas conexões locais comprovadas (localhost / 127.0.0.1) e bancos de teste autorizados.
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

  // Verificar se há redirecionamento de host via parâmetros de busca (ex: ?host=..., ?h%6fst=...)
  // Em drivers pg, o último parâmetro host decodificado da query prevalece sobre a autoridade.
  let effectiveHost = parsed.hostname.toLowerCase();
  if (parsed.search) {
    const rawQuery = parsed.search.replace(/^\?/, "");
    const pairs = rawQuery.split("&");
    for (const pair of pairs) {
      const [rawKey, rawVal] = pair.split("=");
      try {
        const decodedKey = decodeURIComponent(rawKey || "").trim().toLowerCase();
        if (decodedKey === "host") {
          const decodedVal = decodeURIComponent(rawVal || "").trim().toLowerCase();
          effectiveHost = decodedVal;
        }
      } catch {
        throw new Error("[SEGURANÇA BLOQUEADA] Parâmetros de query malformados.");
      }
    }
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
