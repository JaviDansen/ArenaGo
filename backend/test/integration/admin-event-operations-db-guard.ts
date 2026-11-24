import { devNull } from "node:os";
import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { eventClosureConfiguration } from "../../src/events/event-closure.policy";

const databaseName = "arenago_events_test";
const address = "127.0.0.1";
const port = 55432;
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const;
const fixtureTables = [
  "users", "sessions", "user_roles", "profiles", "user_games", "events", "experiences", "stations",
  "participations", "participation_profile_snapshots", "queue_entries", "service_sessions",
  "external_entry_calls", "evaluations", "audit_logs", "idempotency_operations",
];
const requiredTables = [...fixtureTables, "questionnaire_versions", "games", "staff_idempotency_epochs"];

interface PreflightClient {
  query(statement: string): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

interface PreflightPool {
  connect(): Promise<PreflightClient>;
  end(): Promise<void>;
}

function blocked(reason: string) {
  return new Error(`[SEGURANÇA BLOQUEADA] ${reason}`);
}

function declaredTarget(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "test") throw blocked("A integração D06/D09 exige NODE_ENV=test.");
  let schedulerEnabled: boolean;
  try {
    schedulerEnabled = eventClosureConfiguration(env).enabled;
  } catch {
    throw blocked("Configuração inválida do scheduler de encerramento.");
  }
  if (schedulerEnabled) throw blocked("O scheduler de encerramento deve estar desativado.");

  const connectionString = env.DATABASE_URL;
  if (!connectionString || connectionString.trim() !== connectionString ||
      urls.some(name => env[name] !== connectionString)) {
    throw blocked("As três URLs de banco devem estar presentes e ser textualmente idênticas.");
  }
  let target: URL;
  let role: string;
  try {
    target = new URL(connectionString);
    role = decodeURIComponent(target.username);
  } catch {
    throw blocked("URI ou role PostgreSQL inválida.");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== address ||
      target.port !== String(port) || target.pathname !== `/${databaseName}` || !role ||
      !target.password || /[?#\s]/u.test(connectionString)) {
    throw blocked("Use 127.0.0.1:55432/arenago_events_test, com credenciais explícitas e sem parâmetros.");
  }
  return { connectionString, role };
}

async function query(client: PreflightClient, statement: string, phase: string) {
  try {
    return (await client.query(statement)).rows;
  } catch {
    throw blocked(`Falha na consulta de ${phase} do PostgreSQL dedicado.`);
  }
}

function checkoutMigrations() {
  try {
    const migrations = readMigrationFiles({ migrationsFolder: resolve(__dirname, "../../drizzle") });
    if (migrations.length !== 8) throw new Error();
    return migrations;
  } catch {
    throw blocked("O checkout deve conter as oito migrations da campanha, de 0001 a 0008.");
  }
}

async function verify(client: PreflightClient, role: string, expected: ReturnType<typeof checkoutMigrations>) {
  const [identity] = await query(client, `SELECT current_database() AS database_name,
    current_user AS current_role, session_user AS session_role,
    pg_catalog.host(pg_catalog.inet_server_addr()) AS server_address,
    pg_catalog.inet_server_port() AS server_port,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
    EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS role_membership
    FROM pg_catalog.pg_roles r WHERE r.rolname = session_user`, "identidade");
  if (identity?.database_name !== databaseName || identity.server_address !== address || identity.server_port !== port) {
    throw blocked("Banco, endereço ou porta efetiva diverge do destino dedicado.");
  }
  if (identity.current_role !== role || identity.session_role !== role) {
    throw blocked("current_user e session_user devem corresponder à role declarada na URI.");
  }
  if ([identity.rolsuper, identity.rolcreatedb, identity.rolcreaterole, identity.rolreplication,
    identity.rolbypassrls, identity.role_membership].some(value => value !== false)) {
    throw blocked("A role dedicada deve estar sem privilégios administrativos ou vínculo com outras roles.");
  }

  const [schema] = await query(client, `SELECT count(*) = ${requiredTables.length} AS ready
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname IN (${requiredTables.map(table => `'${table}'`).join(", ")})`, "tabelas");
  if (schema?.ready !== true) throw blocked("Tabelas necessárias à integração ausentes.");

  const migrations = await query(client, `SELECT created_at::text AS migration, hash
    FROM drizzle.__drizzle_migrations ORDER BY created_at`, "histórico de migrations");
  if (migrations.length !== expected.length || migrations.some((row, index) =>
    row.migration !== String(expected[index].folderMillis) || row.hash !== expected[index].hash)) {
    throw blocked("Histórico ou hashes de migrations diferentes do checkout.");
  }

  const [initial] = await query(client, `SELECT (${fixtureTables.map(table =>
    `EXISTS (SELECT 1 FROM public.${table})`).join(" OR ")}) AS occupied`, "estado inicial");
  if (initial?.occupied !== false) throw blocked("Há dados operacionais preexistentes nas tabelas de fixtures.");
}

async function preflight(pool: PreflightPool, role: string, expected: ReturnType<typeof checkoutMigrations>) {
  try {
    let client: PreflightClient;
    try {
      client = await pool.connect();
    } catch {
      throw blocked("Não foi possível conectar para pré-verificar o PostgreSQL dedicado.");
    }
    try {
      await query(client, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "abertura da transação somente leitura");
      try {
        await verify(client, role, expected);
      } finally {
        await query(client, "ROLLBACK", "encerramento da transação somente leitura");
      }
    } finally {
      try {
        client.release();
      } catch {
        throw blocked("Falha ao liberar a conexão de pré-verificação.");
      }
    }
  } finally {
    try {
      await pool.end();
    } catch {
      throw blocked("Falha ao encerrar o pool de pré-verificação.");
    }
  }
}

export function adminEventOperationsTestHooks(
  initialize: (connectionString: string) => Promise<void>,
  cleanup: () => Promise<void>,
  createPreflightPool: (connectionString: string) => PreflightPool = connectionString => new Pool({
    connectionString, ssl: false, max: 1, connectionTimeoutMillis: 2000, statement_timeout: 5000,
  }),
  env: NodeJS.ProcessEnv = process.env,
) {
  let authorized = false;
  return {
    async start() {
      const { connectionString, role } = declaredTarget(env);
      const migrations = checkoutMigrations();
      let pool: PreflightPool;
      try {
        pool = createPreflightPool(connectionString);
      } catch {
        throw blocked("Não foi possível preparar o pool de pré-verificação.");
      }
      await preflight(pool, role, migrations);
      if (declaredTarget(env).connectionString !== connectionString) {
        throw blocked("O destino declarado mudou durante a pré-verificação.");
      }
      env.DOTENV_CONFIG_PATH = devNull;
      authorized = true;
      await initialize(connectionString);
    },
    async finish() {
      if (authorized) await cleanup();
    },
  };
}
