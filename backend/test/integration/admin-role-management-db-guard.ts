const names = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const;
const databaseName = "arenago_roles_test";
const serverAddress = "127.0.0.1";
const serverPort = 55432;

/** Guarda exclusiva das integrações T6.1-D: nunca aceita o banco compartilhado. */
export function assertAdminRoleManagementTestDatabaseUrls(env: Record<string, string | undefined>): string {
  if (env.NODE_ENV !== "test") throw new Error("[SEGURANÇA BLOQUEADA] A integração T6.1-D exige NODE_ENV=test.");
  const urls = names.map(name => {
    const value = env[name];
    if (!value || value.trim() !== value) throw new Error(`[SEGURANÇA BLOQUEADA] ${name} explícita é obrigatória.`);
    let parsed: URL;
    try { parsed = new URL(value); }
    catch { throw new Error(`[SEGURANÇA BLOQUEADA] ${name} inválida.`); }
    if ((parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") || parsed.hostname !== serverAddress
      || parsed.port !== String(serverPort) || parsed.pathname !== `/${databaseName}` || !parsed.username || !parsed.password
      || value.includes("?") || value.includes("#")) {
      throw new Error(`[SEGURANÇA BLOQUEADA] ${name} exige 127.0.0.1:55432/arenago_roles_test e credenciais explícitas, sem query ou fragmento.`);
    }
    return value;
  });
  if (urls.some(value => value !== urls[0])) throw new Error("[SEGURANÇA BLOQUEADA] As três URLs devem ser idênticas.");
  return urls[0];
}

interface PreflightClient {
  query(statement: string): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

interface PreflightPool {
  connect(): Promise<PreflightClient>;
  end(): Promise<void>;
}

function blocked(reason: string): Error {
  return new Error(`[SEGURANÇA BLOQUEADA] ${reason}`);
}

async function read(client: PreflightClient, statement: string, operation: string) {
  try {
    return (await client.query(statement)).rows;
  } catch {
    throw blocked(`Falha na consulta de ${operation} do PostgreSQL dedicado.`);
  }
}

async function verifyDatabase(client: PreflightClient, expectedMigrations: readonly string[]): Promise<void> {
  const [identity] = await read(client, `SELECT current_database() AS database_name,
    current_user AS current_role, session_user AS session_role,
    pg_catalog.host(pg_catalog.inet_server_addr()) AS server_address,
    pg_catalog.inet_server_port() AS server_port,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
    FROM pg_catalog.pg_roles r WHERE r.rolname = session_user`, "identidade");
  if (identity?.database_name !== databaseName) throw blocked("Banco conectado diferente de arenago_roles_test.");
  if (identity.current_role !== databaseName || identity.session_role !== databaseName) {
    throw blocked("current_user e session_user devem corresponder à role dedicada arenago_roles_test.");
  }
  if (identity.server_address !== serverAddress) throw blocked("Endereço do servidor PostgreSQL diferente de 127.0.0.1.");
  if (identity.server_port !== serverPort) throw blocked("Porta do servidor PostgreSQL diferente de 55432.");
  if ([identity.rolsuper, identity.rolcreatedb, identity.rolcreaterole, identity.rolreplication, identity.rolbypassrls]
    .some(privilege => privilege !== false)) {
    throw blocked("Role dedicada deve estar sem SUPERUSER, CREATEDB, CREATEROLE, REPLICATION e BYPASSRLS.");
  }

  const [schema] = await read(client, `SELECT bool_and(pg_catalog.to_regclass('public.' || name) IS NOT NULL) AS ready
    FROM unnest(ARRAY['users','user_roles','sessions','refresh_tokens','user_totp_credentials','user_backup_codes',
      'totp_activation_tokens','email_verification_tokens','password_reset_tokens','admin_2fa_challenges','audit_logs',
      'idempotency_operations','events','experiences','stations','participations','queue_entries','service_sessions',
      'evaluations','participation_profile_snapshots','profiles','questionnaire_versions','games','user_games',
      'staff_idempotency_epochs','external_entry_calls']) AS required(name)`, "tabelas");
  if (schema?.ready !== true) throw blocked("Tabelas necessárias à integração ausentes.");

  const migrations = await read(client, `SELECT created_at::text AS migration
    FROM drizzle.__drizzle_migrations ORDER BY created_at`, "histórico de migrations");
  if (!expectedMigrations.length || migrations.length !== expectedMigrations.length
    || migrations.some((row, index) => row.migration !== expectedMigrations[index])) {
    throw blocked("Histórico de migrations diferente do journal do checkout.");
  }

  const [admins] = await read(client, `SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role = 'admin'
  ) AS present`, "concessões Admin históricas");
  if (admins?.present !== false) {
    throw blocked("A prova do último Admin exige banco dedicado sem Admins preexistentes, inclusive revogados.");
  }
}

export async function startAdminRoleManagementAfterPreflight<T>(
  pool: PreflightPool,
  expectedMigrations: readonly string[],
  initialize: () => Promise<T>,
): Promise<T> {
  try {
    let client: PreflightClient;
    try {
      client = await pool.connect();
    } catch {
      throw blocked("Não foi possível abrir a conexão de pré-verificação do PostgreSQL dedicado.");
    }
    try {
      await verifyDatabase(client, expectedMigrations);
    } finally {
      client.release();
    }
  } catch (error) {
    try {
      await pool.end();
    } catch {
      throw new AggregateError([error, blocked("Falha ao encerrar o pool de pré-verificação.")],
        "[SEGURANÇA BLOQUEADA] Pré-verificação interrompida e encerramento do pool falhou.");
    }
    throw error;
  }
  return initialize();
}
