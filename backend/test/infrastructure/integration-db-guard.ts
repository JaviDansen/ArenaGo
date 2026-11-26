import { integrationBlocked, integrationDestination, validateIntegrationEnvironment, campaignFailure } from "./integration-environment";
import { canonicalCatalogMatches, checkoutSchema } from "./integration-schema";
import { compareStructuralCatalog, prepareStructuralReference } from "./integration-structural-reference";
import { structuralCatalogSql } from "./integration-structural-sql";

export interface IntegrationPreflightClient {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}

export interface IntegrationPreflightPool {
  connect(): Promise<IntegrationPreflightClient>;
  end(): Promise<void>;
}

export type IntegrationPreflightPoolFactory = (config: {
  connectionString: string;
  ssl: false;
  max: 1;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  query_timeout: number;
  idle_in_transaction_session_timeout: number;
  options: string;
}) => IntegrationPreflightPool;

const identitySql = `SELECT current_database() AS database_name, current_user AS current_role,
    session_user AS session_role, pg_catalog.host(inet_server_addr()) AS server_address,
    inet_server_port() AS server_port, pg_get_userbyid(d.datdba) AS database_owner,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolcanlogin,
    EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS member_of_role,
    EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid = r.oid) AS granted_to_role,
    pg_catalog.current_setting('session_replication_role') AS replication_role,
    pg_is_in_recovery() AS recovering,
    current_setting('server_version_num')::integer AS server_version_num
  FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.rolname = session_user
  WHERE d.datname = current_database()`;

const schemaSql = `SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner
  FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema')
  AND nspname !~ '^pg_'`;

const catalogSql = `SELECT CASE c.relkind
    WHEN 'r' THEN 'table' WHEN 'i' THEN 'index' WHEN 'S' THEN 'sequence' ELSE 'other' END AS kind,
    n.nspname || '.' || c.relname AS name, pg_get_userbyid(c.relowner) AS owner,
    CASE WHEN c.relkind = 'i' THEN i.indisvalid AND i.indisready AND i.indislive
         WHEN c.relkind = 'r' THEN NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relpersistence = 'p'
         ELSE true END AS valid
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname IN ('public', 'drizzle')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_userbyid(p.proowner), NOT p.prosecdef AND p.prokind = 'f'
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'drizzle')
  UNION ALL
  SELECT 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, pg_get_userbyid(c.relowner), t.tgenabled = 'O'
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle') AND NOT t.tgisinternal
  UNION ALL
  SELECT 'constraint', n.nspname || '.' || c.relname || '.' || k.conname, pg_get_userbyid(c.relowner), k.convalidated
  FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle') AND k.contype <> 'n'
  UNION ALL
  SELECT 'type', n.nspname || '.' || t.typname, pg_get_userbyid(t.typowner), true
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname IN ('public', 'drizzle') AND t.typrelid = 0 AND t.typelem = 0
  UNION ALL
  SELECT 'rule', n.nspname || '.' || c.relname || '.' || r.rulename, pg_get_userbyid(c.relowner), true
  FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle')
  UNION ALL
  SELECT 'event_trigger', e.evtname, pg_get_userbyid(e.evtowner), true FROM pg_catalog.pg_event_trigger e`;

const aclSql = `SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee <> d.datdba
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname IN ('public', 'drizzle') AND a.grantee <> n.nspowner
    AND NOT (n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'USAGE' AND NOT a.is_grantable)
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname IN ('public', 'drizzle') AND a.grantee <> c.relowner
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid = col.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
    WHERE n.nspname IN ('public', 'drizzle') AND a.grantee <> c.relowner
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname IN ('public', 'drizzle') AND a.grantee <> p.proowner
    AND NOT (a.grantee = 0 AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable)
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl a LEFT JOIN pg_catalog.pg_namespace n ON n.oid = a.defaclnamespace
    WHERE a.defaclnamespace = 0 OR n.nspname IN ('public', 'drizzle')
  ) AS compatible`;

async function read(client: Pick<IntegrationPreflightClient, "query">, sql: string, phase: string) {
  try {
    return (await client.query(sql)).rows;
  } catch (error) {
    // Driver errors can carry the URI or credentials. Do not retain a cause.
    throw Object.assign(integrationBlocked("Falha na etapa " + phase + "."), { code: campaignFailure('preflight', error).code });
  }
}

export async function attestIntegrationIdentity(client: Pick<IntegrationPreflightClient, "query">, postgresVersionNum: number) {
  const { database, address, port, role } = integrationDestination;
  const [id] = await read(client, identitySql, "identidade");
  if (id?.database_name !== database || id.server_address !== address || id.server_port !== port
      || id.current_role !== role || id.session_role !== role || id.recovering !== false || id.rolcanlogin !== true) {
    throw integrationBlocked("Identidade efetiva do PostgreSQL divergente.");
  }
  if (id.database_owner !== role) throw integrationBlocked("Proprietário do banco divergente.");
  if ([id.rolsuper, id.rolcreatedb, id.rolcreaterole, id.rolreplication, id.rolbypassrls].some(flag => flag !== false)) {
    throw integrationBlocked("Privilégio elevado na role.");
  }
  if (id.member_of_role !== false || id.granted_to_role !== false) {
    throw integrationBlocked("Associação explícita envolvendo a role dedicada.");
  }
  if (id.replication_role !== "origin") throw integrationBlocked("Modo de replicação da sessão incompatível.");
  if (id.server_version_num !== postgresVersionNum) {
    throw integrationBlocked("Versão PostgreSQL divergente da referência estrutural.");
  }
}

async function attest(
  client: IntegrationPreflightClient,
  schema: ReturnType<typeof checkoutSchema>,
  noHistoricalAdmin: boolean,
  postgresVersionNum: number,
  verifyStructure: (rows: unknown) => void,
) {
  const { role } = integrationDestination;
  await attestIntegrationIdentity(client, postgresVersionNum);
  const schemas = await read(client, schemaSql, "schemas");
  if (schemas.length !== 2 || !schemas.some(row => row.name === "drizzle" && row.owner === role)
      || !schemas.some(row => row.name === "public" && [role, "pg_database_owner"].includes(String(row.owner)))) {
    throw integrationBlocked("Schemas ou proprietários divergentes.");
  }
  const [acl] = await read(client, aclSql, "ACLs");
  if (acl?.compatible !== true) throw integrationBlocked("ACL incompatível com banco dedicado.");

  const pending = new Set(schema.objects.map(object => object.kind + ":" + object.name));
  for (const object of await read(client, catalogSql, "catálogo")) {
    if (!pending.delete(String(object.kind) + ":" + String(object.name))) {
      throw integrationBlocked("Objeto DDL inesperado no catálogo.");
    }
    if (object.owner !== role || object.valid !== true) throw integrationBlocked("Objeto com proprietário ou estado inválido.");
  }
  if (pending.size) throw integrationBlocked("Tabela ou objeto obrigatório ausente.");

  const migrations = await read(client, "SELECT created_at::text AS migration, hash FROM drizzle.__drizzle_migrations ORDER BY created_at", "migrations");
  if (migrations.length !== schema.migrations.length || migrations.some((item, index) => item.migration !== schema.migrations[index].migration)) {
    throw integrationBlocked("Journal de migrations divergente.");
  }
  if (migrations.some((item, index) => item.hash !== schema.migrations[index].hash)) {
    throw integrationBlocked("Hash de migration divergente.");
  }

  verifyStructure(await read(client, structuralCatalogSql, "estrutura do catálogo"));

  if (noHistoricalAdmin) {
    const [history] = await read(client, "SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin' AND event_id IS NULL) AS occupied", "histórico Admin");
    if (history?.occupied !== false) throw integrationBlocked("O perfil exige ausência de Admin global histórico.");
  }
  const operationalTables = schema.tables.filter(name => name !== "games" && name !== "questionnaire_versions");
  const occupiedSql = operationalTables.map(name => 'EXISTS (SELECT 1 FROM public."' + name + '")').join(" OR ");
  const [occupied] = await read(client, "SELECT (" + occupiedSql + ") AS occupied", "baseline operacional");
  if (occupied?.occupied !== false) throw integrationBlocked("Baseline operacional incompatível.");
  const games = await read(client, "SELECT name, is_curated AS curated FROM public.games", "baseline de jogos");
  const questionnaires = await read(client, `SELECT version, definition,
    (activated_at IS NOT NULL AND activated_at <= CURRENT_TIMESTAMP) AS published
    FROM public.questionnaire_versions`, "baseline de questionário");
  if (!canonicalCatalogMatches(games, questionnaires)) throw integrationBlocked("Baseline canônico incompatível.");
}

// The factory is deliberately injected. This module does not import pg or start an application.
function preparation(
  suiteId: string,
  env: NodeJS.ProcessEnv,
) {
  const { suite, connectionString } = validateIntegrationEnvironment(suiteId, env);
  let schema: ReturnType<typeof checkoutSchema>;
  try {
    schema = checkoutSchema();
    const required = suite.schema.specificMigration;
    if (required && !schema.migrationTags.includes(required)) throw new Error();
  } catch {
    throw integrationBlocked("Artefatos de migrations indisponíveis ou incompatíveis.");
  }
  return { suite, connectionString, schema };
}

async function readOnlySnapshot<T>(
  connectionString: string,
  createPool: IntegrationPreflightPoolFactory,
  inspect: (client: IntegrationPreflightClient) => Promise<T>,
): Promise<T> {
  let pool: IntegrationPreflightPool;
  try {
    pool = createPool({
      connectionString, ssl: false, max: 1, connectionTimeoutMillis: 2_000,
      statement_timeout: 5_000, query_timeout: 6_000, idle_in_transaction_session_timeout: 10_000,
      options: "-c search_path=pg_catalog -c default_transaction_read_only=on -c quote_all_identifiers=off"
        + " -c standard_conforming_strings=on -c DateStyle=ISO,YMD -c IntervalStyle=postgres"
        + " -c TimeZone=UTC -c extra_float_digits=3 -c bytea_output=hex",
    });
  } catch {
    throw integrationBlocked("Falha ao preparar o pool de pré-verificação.");
  }

  try {
    let client: IntegrationPreflightClient;
    try {
      client = await pool.connect();
    } catch {
      throw integrationBlocked("Falha ao conectar para pré-verificação.");
    }
    let destroy = true;
    try {
      await read(client, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "abertura somente leitura");
      try {
        return await inspect(client);
      } finally {
        await read(client, "ROLLBACK", "encerramento somente leitura");
        destroy = false;
      }
    } finally {
      try {
        client.release(destroy);
      } catch {
        throw integrationBlocked("Falha ao liberar a conexão de pré-verificação.");
      }
    }
  } finally {
    try {
      await pool.end();
    } catch {
      throw integrationBlocked("Falha ao encerrar o pool de pré-verificação.");
    }
  }
}

export async function attestIntegrationDatabase(
  suiteId: string,
  env: NodeJS.ProcessEnv,
  createPool: IntegrationPreflightPoolFactory,
  trustedReference?: unknown,
): Promise<void> {
  const { suite, schema, connectionString } = preparation(suiteId, env);
  const reference = prepareStructuralReference(trustedReference, schema.migrations);
  return readOnlySnapshot(connectionString, createPool, client =>
    attest(client, schema, suite.preconditions.noHistoricalAdmin, reference.postgresVersionNum,
      rows => compareStructuralCatalog(reference.expected, rows)));
}

// This collector only runs the fixed read protocol. The adapter owns authorization and connection.
export async function inspectPreparationSnapshot(
  env: NodeJS.ProcessEnv,
  createPool: IntegrationPreflightPoolFactory,
  postgresVersionNum: number,
  inspectStructure: (rows: unknown, schema: ReturnType<typeof checkoutSchema>) => void,
  inspectClock: (readClock: () => Promise<unknown>) => Promise<void>,
  qualification?: { reference: unknown },
) {
  const { schema, connectionString } = preparation("admin-external-queue-http", env);
  const expected = qualification && prepareStructuralReference(qualification.reference, schema.migrations);
  if (expected && expected.postgresVersionNum !== postgresVersionNum) {
    throw integrationBlocked("Versão da referência divergente.");
  }
  return readOnlySnapshot(connectionString, createPool, async client => {
    const [session] = await read(client, `SELECT
      current_setting('transaction_read_only') AS read_only,
      current_setting('default_transaction_read_only') AS default_read_only,
      current_setting('transaction_isolation') AS isolation,
      current_setting('search_path') AS search_path,
      current_setting('TimeZone') AS timezone,
      current_setting('session_replication_role') AS replication_role,
      current_setting('quote_all_identifiers') AS quote_all,
      current_setting('standard_conforming_strings') AS standard_strings,
      current_setting('DateStyle') AS date_style,
      current_setting('IntervalStyle') AS interval_style,
      current_setting('extra_float_digits') AS float_digits,
      current_setting('bytea_output') AS bytea_output`, "configuração efetiva");
    if (session?.read_only !== "on" || session.default_read_only !== "on"
        || session.isolation !== "repeatable read" || session.search_path !== "pg_catalog"
        || session.timezone !== "UTC" || session.replication_role !== "origin" || session.quote_all !== "off"
        || session.standard_strings !== "on" || session.date_style !== "ISO, YMD" || session.interval_style !== "postgres"
        || session.float_digits !== "3" || session.bytea_output !== "hex") {
      throw integrationBlocked("Configuração efetiva da sessão de atestação incompatível.");
    }
    await attest(client, schema, true, postgresVersionNum, rows => {
      if (expected) compareStructuralCatalog(expected.expected, rows);
      inspectStructure(rows, schema);
    });
    await inspectClock(async () => (await read(client, `SELECT
      (extract(epoch FROM clock_timestamp()) * 1000)::double precision AS server_ms,
      (extract(epoch FROM CURRENT_TIMESTAMP) * 1000)::double precision AS snapshot_ms,
      (extract(epoch FROM activated_at) * 1000)::double precision AS activation_ms
      FROM public.questionnaire_versions`, "relógio e vigência"))[0]);
  });
}
