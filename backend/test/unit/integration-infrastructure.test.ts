import assert from "node:assert/strict";
import { devNull } from "node:os";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { ReadStream } from "node:tty";
import { createHash } from "node:crypto";
import { CURATED_GAMES } from "../../src/games/games.types";
import { DEFAULT_QUESTIONNAIRE_DEFINITION, DEFAULT_QUESTIONNAIRE_VERSION } from "../../src/profile/profile-questionnaire.types";
import { attestIntegrationDatabase, type IntegrationPreflightPoolFactory } from "../infrastructure/integration-db-guard";
import { loadCampaignReference } from "../infrastructure/campaign-reference";
import { buildIntegrationEnvironment } from "../infrastructure/integration-environment";
import { discoverIntegrationFiles, validateIntegrationManifest } from "../infrastructure/integration-inventory";
import { integrationManifest } from "../infrastructure/integration-manifest";
import {
  confirmJournalDomain, measurePreparationClock, measureQuestionnaireClock, simulateIntegrationPreparation,
} from "../infrastructure/integration-preparation";
import { checkoutSchema } from "../infrastructure/integration-schema";
import { readTerminalPassword, validateStructuralApproval } from "../infrastructure/read-postgres-preparation";
import { structuralSnapshot, type StructuralObject, type StructuralReference } from "../infrastructure/integration-structural-reference";

const uri = "postgresql://arenago:fixture-only@127.0.0.1:55432/arenago_events_test";
const suite = "admin-close-http";
const urlKeys = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"];
const syntheticEnvironment = () => buildIntegrationEnvironment(suite, uri, {});
const setUrl = (value: string) => Object.fromEntries(urlKeys.map(key => [key, value]));

test("manifesto classifica os arquivos descobertos e preserva a contagem estática de referência", () => {
  const discovered = discoverIntegrationFiles();
  assert.ok(!discovered.includes("backend/test/infrastructure/pilot-executor.ts"));
  assert.equal(discovered.length, 43);
  assert.deepEqual(validateIntegrationManifest(integrationManifest, discovered), []);
  assert.equal(integrationManifest.reduce((total, row) => total + row.cases, 0), 1388);
  assert.deepEqual(["A", "B", "C", "D"].map(group => integrationManifest.filter(row => row.group === group).length), [2, 35, 2, 4]);
});

test("manifesto rejeita ausência, caminho inexistente, duplicidade, perfil inválido e contradição", () => {
  const [first, second, ...others] = integrationManifest;
  const paths = integrationManifest.map(row => row.file);
  assert.match(validateIntegrationManifest([second, ...others], paths).join("\n"), /sem classificação/u);
  assert.match(validateIntegrationManifest(integrationManifest, paths.slice(1)).join("\n"), /indisponível/u);
  assert.match(validateIntegrationManifest([...integrationManifest, first], paths).join("\n"), /duplicado/u);
  const invalid = { ...first, profile: "inventado" as typeof first.profile };
  assert.match(validateIntegrationManifest([invalid, second, ...others], paths).join("\n"), /Perfil inválido/u);
  assert.match(validateIntegrationManifest([{ ...first, seed: true }, second, ...others], paths).join("\n"), /inconsistentes/u);
});

test("ambiente filho mantém PATH e descarta configurações herdadas de banco, dotenv e e-mail", () => {
  const env = buildIntegrationEnvironment(suite, uri, {
    PATH: "synthetic-path", NODE_ENV: "production", PGHOST: "invalid.example",
    DOTENV_CONFIG_OVERRIDE: "false", DATABASE_URL: "not-a-url",
    DRIZZLE_SCHEMA: "other", RESEND_API_KEY: "fixture-should-not-be-copied", NODE_OPTIONS: "--require other",
  });
  assert.equal(env.PATH, "synthetic-path");
  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.DOTENV_CONFIG_PATH, devNull);
  assert.equal(env.EVENT_CLOSURE_JOB_TEST_ENABLED, "false");
  assert.deepEqual(urlKeys.map(key => env[key]), [uri, uri, uri]);
  for (const key of ["PGHOST", "DOTENV_CONFIG_OVERRIDE", "DRIZZLE_SCHEMA", "RESEND_API_KEY", "NODE_OPTIONS"]) {
    assert.equal(env[key], undefined);
  }
  assert.equal(new Set([env.JWT_SECRET, env.JWT_TEMP_SECRET, env.TOTP_ENCRYPTION_KEY, env.TOTP_RECOVERY_HMAC_KEY]).size, 4);
});

const invalidEnvironments: [string, NodeJS.ProcessEnv, RegExp][] = [
  ["URL ausente", { DATABASE_URL: undefined }, /obrigatórias/u],
  ["URL inválida", setUrl("invalid"), /URI inválida/u],
  ["URLs divergentes", { DATABASE_DIRECT_URL: uri.replace("fixture-only", "other") }, /idênticas/u],
  ["destino remoto", setUrl(uri.replace("127.0.0.1", "remote.example")), /política local/u],
  ["homologação", setUrl(uri.replace("arenago_events_test", "arenago_homologacao")), /política local/u],
  ["banco não autorizado", setUrl(uri.replace("arenago_events_test", "arenago_roles_test")), /política local/u],
  ["role incorreta", setUrl(uri.replace("//arenago:", "//admin:")), /Role PostgreSQL/u],
  ["porta incorreta", setUrl(uri.replace("55432", "5432")), /política local/u],
  ["parâmetros adicionais", setUrl(uri + "?sslmode=require"), /política local/u],
  ["fragmento", setUrl(uri + "#extra"), /política local/u],
  ["ambiente fora de teste", { NODE_ENV: "development" }, /NODE_ENV/u],
  ["caminho de dotenv", { DOTENV_CONFIG_PATH: ".env" }, /Dotenv/u],
  ["override de dotenv", { DOTENV_CONFIG_OVERRIDE: "false" }, /Dotenv/u],
  ["scheduler incompatível", { EVENT_CLOSURE_JOB_TEST_ENABLED: "true" }, /Scheduler/u],
  ["credencial ausente", setUrl(uri.replace(":fixture-only", ":")), /URI inválida/u],
  ["credencial inválida", setUrl(uri.replace("fixture-only", "%00")), /credenciais inválidas/u],
  ["host alternativo via ambiente", { PGHOST: "remote.example" }, /lista autorizada/u],
  ["TTL ausente", { EVALUATION_IDEMPOTENCY_TTL_SECONDS: undefined }, /TTLs/u],
  ["TOTP incompleto", { TOTP_RECOVERY_HMAC_KEY: undefined }, /autenticação/u],
];

for (const [name, override, error] of invalidEnvironments) {
  test("recusa " + name + " antes de criar o pool", async () => {
    let calls = 0;
    await assert.rejects(attestIntegrationDatabase(suite, { ...syntheticEnvironment(), ...override }, () => {
      calls++;
      throw new Error("pool indevido");
    }), error);
    assert.equal(calls, 0);
  });
}

test("recusa suite desconhecida e todos os perfis especializados antes de criar o pool", async () => {
  let calls = 0;
  const factory = () => {
    calls++;
    throw new Error("pool indevido");
  };
  await assert.rejects(attestIntegrationDatabase("unknown", syntheticEnvironment(), factory), /desconhecida/u);
  for (const row of integrationManifest.filter(item => item.specializedIsolation)) {
    await assert.rejects(attestIntegrationDatabase(row.id, syntheticEnvironment(), factory), /especializado/u);
  }
  assert.equal(calls, 0);
});

test("catálogo derivado do checkout inclui as proteções da migration de chamadas externas", () => {
  const schema = checkoutSchema();
  assert.ok(schema.tables.includes("external_entry_calls"));
  assert.ok(schema.tables.includes("staff_idempotency_epochs"));
  assert.ok(schema.objects.some(row => row.kind === "trigger" && row.name === "public.external_entry_calls.protect_external_entry_call"));
  assert.ok(schema.objects.some(row => row.kind === "function" && row.name === "public.protect_external_entry_call()"));
  assert.ok(schema.objects.some(row => row.kind === "index" && row.name === "public.uq_external_calls_pending_event"));
  assert.ok(schema.objects.some(row => row.kind === "constraint" && row.name === "public.external_entry_calls.ck_external_calls_resolution"));
  assert.ok(schema.objects.some(row => row.kind === "constraint" && row.name === "public.external_entry_calls.check_external_call_integrity"));
});

type Row = Record<string, unknown>;
type Overrides = Record<string, Row[]>;

const foreignKeyTriggers = ([
  ["fixture", "owners", "RI_FKey_check_ins", 5],
  ["fixture", "owners", "RI_FKey_check_upd", 17],
  ["owners", "fixture", "RI_FKey_noaction_del", 9],
  ["owners", "fixture", "RI_FKey_noaction_upd", 17],
] as const).map(([tableName, relatedName, functionName, eventsAndTiming]) => ({
  tableSchema: "public", tableName, relatedSchema: "public", relatedName,
  functionSchema: "pg_catalog", functionName, functionSignature: "", eventsAndTiming,
  enabled: "O", deferrable: false, initiallyDeferred: false,
}));

const fixtureObjects: readonly StructuralObject[] = [
  { kind: "table", schema: "public", name: "fixture", relation: null, signature: null,
    properties: { relationKind: "r", persistence: "p", rowSecurity: false, forceRowSecurity: false } },
  { kind: "column", schema: "public", name: "quantity", relation: "fixture", signature: null,
    properties: { position: 1, type: "integer", notNull: true, expression: "0", identity: "", generated: "", collation: null } },
  { kind: "constraint", schema: "public", name: "positive", relation: "fixture", signature: null,
    properties: { constraintType: "c", definition: "CHECK ((quantity >= 0))", validated: true, enforced: true,
      deferrable: false, initiallyDeferred: false, foreignKeyTriggers: null } },
  { kind: "constraint", schema: "public", name: "owner_fk", relation: "fixture", signature: null,
    properties: { constraintType: "f", definition: "FOREIGN KEY (owner) REFERENCES public.owners(id)",
      validated: true, enforced: true, deferrable: false, initiallyDeferred: false, foreignKeyTriggers } },
  { kind: "index", schema: "public", name: "only_positive", relation: null, signature: null,
    properties: { definition: "CREATE UNIQUE INDEX only_positive ON public.fixture USING btree (quantity)",
      unique: true, valid: true, ready: true, live: true, predicate: "(quantity > 0)" } },
  { kind: "function", schema: "public", name: "example", relation: null, signature: "integer",
    properties: { definition: "SELECT 1", language: "sql", volatility: "i", securityDefiner: false,
      leakproof: false, strict: false, parallel: "u", configuration: null } },
  { kind: "function", schema: "public", name: "example", relation: null, signature: "text",
    properties: { definition: "SELECT 2", language: "sql", volatility: "i", securityDefiner: false,
      leakproof: false, strict: false, parallel: "u", configuration: null } },
  { kind: "trigger", schema: "public", name: "protect", relation: "fixture", signature: null,
    properties: { definition: "CREATE TRIGGER protect BEFORE UPDATE ON public.fixture FOR EACH ROW EXECUTE FUNCTION public.protect()",
      enabled: "O", function: "public.protect()", eventsAndTiming: 19, deferrable: false, initiallyDeferred: false } },
  { kind: "sequence", schema: "drizzle", name: "__drizzle_migrations_id_seq", relation: null, signature: null,
    properties: { type: "integer", start: "1", min: "1", max: "2147483647", increment: "1", cache: "1",
      cycle: false, ownedBy: "drizzle.__drizzle_migrations.id" } },
];

function fixture(overrides: Overrides = {}, failAt?: string, interpret?: (sql: string, rows: Row[]) => Row[]) {
  const schema = checkoutSchema();
  const reference: StructuralReference = {
    formatVersion: 2, postgresVersionNum: 180006, schemas: ["drizzle", "public"],
    migrations: schema.migrations, objects: fixtureObjects,
  };
  const phases: string[] = [];
  const statements: string[] = [];
  const rows: Overrides = {
    identity: [{
      database_name: "arenago_events_test", server_address: "127.0.0.1", server_port: 55432,
      database_owner: "arenago", current_role: "arenago", session_role: "arenago",
      rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
      rolbypassrls: false, member_of_role: false, granted_to_role: false, replication_role: "origin",
      recovering: false, rolcanlogin: true, server_version_num: 180006,
    }],
    schemas: [{ name: "drizzle", owner: "arenago" }, { name: "public", owner: "pg_database_owner" }],
    acl: [{ compatible: true }],
    catalog: schema.objects.map(object => ({ ...object, owner: "arenago", valid: true })),
    migrations: schema.migrations,
    structure: structuredClone(fixtureObjects).map(object => ({ ...object })),
    admin: [{ occupied: false }],
    baseline: [{ occupied: false }],
    games: CURATED_GAMES.map(name => ({ name, curated: true })),
    questionnaires: [{ version: DEFAULT_QUESTIONNAIRE_VERSION, published: true, definition: DEFAULT_QUESTIONNAIRE_DEFINITION }],
    ...overrides,
  };
  const step = (phase: string) => {
    phases.push(phase);
    if (failAt === phase) throw new Error(uri + " fixture-only");
  };
  const factory: IntegrationPreflightPoolFactory = config => {
    step("pool");
    assert.equal(config.connectionString, uri);
    assert.equal(config.ssl, false);
    assert.equal(config.max, 1);
    assert.ok(config.connectionTimeoutMillis > 0 && config.statement_timeout > 0 && config.query_timeout > 0);
    assert.match(config.options, /default_transaction_read_only=on/u);
    assert.match(config.options, /search_path=pg_catalog /u);
    return {
      async connect() {
        step("connect");
        return {
          async query(sql) {
            statements.push(sql);
            let phase: string;
            if (sql.startsWith("BEGIN ")) phase = "begin";
            else if (sql === "ROLLBACK") phase = "rollback";
            else if (sql.includes("AS default_read_only")) phase = "session";
            else if (sql.includes("AS server_ms")) phase = "clock";
            else if (sql.includes("AS database_name")) phase = "identity";
            else if (sql.startsWith("SELECT nspname")) phase = "schemas";
            else if (sql.includes("aclexplode")) phase = "acl";
            else if (sql.includes("AS structural_catalog")) phase = "structure";
            else if (sql.includes("AS kind")) phase = "catalog";
            else if (sql.includes("drizzle.__drizzle_migrations")) phase = "migrations";
            else if (sql.includes("WHERE role = 'admin'")) phase = "admin";
            else if (sql.includes("AS occupied")) phase = "baseline";
            else if (sql.includes("FROM public.games")) phase = "games";
            else if (sql.includes("FROM public.questionnaire_versions")) phase = "questionnaires";
            else throw new Error("Consulta inesperada");
            step(phase);
            const result = rows[phase] ?? [];
            return { rows: interpret ? interpret(sql, result) : result };
          },
          release(destroy) { step(destroy ? "discard" : "release"); },
        };
      },
      async end() { step("end"); },
    };
  };
  return { rows, phases, statements, factory, reference };
}

test("atesta somente leitura com pool injetado e encerra a conexão e o pool", async () => {
  const { phases, statements, factory, reference } = fixture();
  await attestIntegrationDatabase("admin-role-management", syntheticEnvironment(), factory, reference);
  assert.deepEqual(phases, [
    "pool", "connect", "begin", "identity", "schemas", "acl", "catalog", "migrations",
    "structure", "admin", "baseline", "games", "questionnaires", "rollback", "release", "end",
  ]);
  assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(statements.at(-1), "ROLLBACK");
  for (const statement of statements.slice(1, -1)) {
    assert.match(statement, /^SELECT /u);
    assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|COMMIT)\b/u);
  }
  assert.match(statements.find(sql => sql.includes("WHERE role = 'admin'")) ?? "", /event_id IS NULL/u);
  assert.doesNotMatch(statements.find(sql => sql.includes("WHERE role = 'admin'")) ?? "", /revoked/u);
  const baseline = statements.find(sql => sql.includes('public."external_entry_calls"'));
  assert.match(baseline ?? "", /public\."staff_idempotency_epochs"/u);
  assert.match(baseline ?? "", /public\."audit_logs"/u);
});

const valid = fixture().rows;

const windowsIdentity = {
  address: "127.0.0.1", port: 55432, service: "postgresql-x64-18", listenerPid: 31, servicePid: 30,
  postgresVersionNum: 180006, instanceSha256: "a".repeat(64), clusterSha256: "c".repeat(64),
};
const clock = {
  wallMs: () => 10_000,
  monotonicMs: () => 0,
};

function preparationFixture(overrides: Overrides = {}) {
  const schema = checkoutSchema();
  const structure = schema.objects.flatMap(({ kind, name }): StructuralObject[] => {
    const [namespace, first, second] = name.split(".");
    const template = kind === "constraint"
      ? fixtureObjects.find(row => row.name === (schema.foreignKeys.includes(name) ? "owner_fk" : "positive"))!
      : fixtureObjects.find(row => row.kind === kind)!;
    const base = { ...template, schema: namespace, name: second ?? first.replace(/\(\)$/u, ""),
      relation: second ? first : null, signature: kind === "function" ? "" : null };
    if (kind !== "table") return [base];
    return [base, { ...fixtureObjects[1], schema: namespace, relation: first }];
  });
  const session = [{
    read_only: "on", default_read_only: "on", isolation: "repeatable read", search_path: "pg_catalog",
    timezone: "UTC", replication_role: "origin", quote_all: "off", standard_strings: "on",
    date_style: "ISO, YMD", interval_style: "postgres", float_digits: "3", bytea_output: "hex",
  }];
  const inspection = fixture({ structure, session, ...overrides }, undefined, (sql, rows) => {
    if (!sql.includes("AS server_ms")) return rows;
    assert.match(sql, /clock_timestamp\(\)[\s\S]+CURRENT_TIMESTAMP[\s\S]+activated_at/u);
    return overrides.clock ?? [{
      server_ms: 10_003, snapshot_ms: 10_002, activation_ms: 9_000,
    }];
  });
  return { ...inspection, options: {
    mode: "simulation" as const, env: syntheticEnvironment(), expectedIdentity: windowsIdentity, clock,
    observeIdentity: async () => windowsIdentity, createPool: inspection.factory,
  } };
}

function assertPreparationReadOnlyCycle(statements: readonly string[], phases: readonly string[]) {
  const operationalTables = checkoutSchema().tables.filter(name => name !== "games" && name !== "questionnaire_versions");
  const baseline = "SELECT (" + operationalTables.map(name => 'EXISTS (SELECT 1 FROM public."' + name + '")').join(" OR ")
    + ") AS occupied";
  // Pin the full text of the reviewed queries independently of the guard. Normalize only line endings.
  const clockDigest = "de2c0fb035dbf18ce455ff65ef2236b9480cbfbe0043dc1bd687e4c8de64ee8d";
  const expected = [
    ["session", "03cd5597a82269d6c30c59d91a380bc12fca3bd7fc0f9dd00fc7832f1f7166d2"],
    ["identity", "ce28e4991c49d34c24790d8982a95cf80a684fbccc76d1e47f87d743b0812a92"],
    ["schemas", "57f5240dd502be96f7d2dc706bf75b68f11c87806c6dff521ae5bf6fbdf2282e"],
    ["acl", "355593cb95d20387f3e0d959c865eb1303d12914db22e56d59aa134637d54152"],
    ["catalog", "5c687f0759f2efb7565a5ece9bb62855eae26e6f321eebfd57253dca9a5cf20a"],
    ["migrations", "2c97f7c9effe00860986bdec9c58d64bbf6c1465845dcc4a18b9f0c964f9fb42"],
    ["structure", "538ffecc52973b90384d0c8a544c1913729866d960bbbbb0afe388c54806784e"],
    ["admin", "37684920c7f2bb386e31c2140c264d3483d3289a142ceefd0d9c4cfdfdba69f7"],
    ["baseline", createHash("sha256").update(baseline).digest("hex")],
    ["games", "3e81e589895cadcdfa7bb431d129b5901bcf72e8a03e124ebdcd8a1bbcd9ba10"],
    ["questionnaires", "fa84e5006a7e2c750b69d5ce4777cafc71545484249cf4f495dc09657fbc01e1"],
    ["clock", clockDigest], ["clock", clockDigest], ["clock", clockDigest],
  ] as const;
  assert.equal(statements.length, expected.length + 2, "quantidade de instruções do ciclo");
  assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(statements.at(-1), "ROLLBACK");
  for (const [index, [phase, digest]] of expected.entries()) {
    const actual = createHash("sha256").update(statements[index + 1].replace(/\r\n/g, "\n")).digest("hex");
    assert.equal(actual, digest, "SQL inesperado na etapa " + phase);
  }
  assert.deepEqual(phases, [
    "pool", "connect", "begin", "session", "identity", "schemas", "acl", "catalog", "migrations", "structure",
    "admin", "baseline", "games", "questionnaires", "clock", "clock", "clock", "rollback", "release", "end",
  ]);
}

test("D1.1 extrai bytes v2 canônicos após a guarda e qualifica a mesma projeção em operação distinta", async () => {
  const { options, phases, statements } = preparationFixture();
  const run = await simulateIntegrationPreparation({ kind: "extract-candidate" }, options);
  assert.ok(run.candidate && run.structure && run.clock);
  assert.equal(run.clock.samples.length, 3);
  const { bytes, sha256 } = run.candidate;
  const observed: StructuralReference = JSON.parse(bytes);
  assert.equal(observed.formatVersion, 2);
  assert.equal(observed.migrations.length, 8);
  assert.deepEqual(observed.migrations, checkoutSchema().migrations);
  assert.equal(run.structure.kinds.table, 27);
  assert.equal(run.structure.foreignKeys, checkoutSchema().foreignKeys.length);
  assert.ok(observed.objects.some(object => object.properties.foreignKeyTriggers instanceof Array));
  assert.equal(sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.ok(!bytes.includes(uri) && !bytes.includes("activation_ms"));
  assertPreparationReadOnlyCycle(statements, phases);
  const unexpected = [...statements];
  unexpected[unexpected.length - 2] = "SELECT set_config('search_path', 'public', false)";
  assert.throws(() => assertPreparationReadOnlyCycle(unexpected, phases), /SQL inesperado na etapa clock/u);
  assert.deepEqual(run.statements, statements.map(sql => createHash("sha256").update(sql).digest("hex")));
  const reordered = preparationFixture({ structure: [...observed.objects].reverse() });
  const repeat = await simulateIntegrationPreparation({ kind: "extract-candidate" }, reordered.options);
  assert.deepEqual(repeat.candidate, run.candidate);
  assertPreparationReadOnlyCycle(reordered.statements, reordered.phases);
  const qualificationFixture = preparationFixture();
  const qualification = await simulateIntegrationPreparation(
    { kind: "qualify", expectedStructure: observed }, qualificationFixture.options,
  );
  assert.equal(qualification.candidate, undefined);
  assert.deepEqual(qualification.structure, run.structure);
  assertPreparationReadOnlyCycle(qualificationFixture.statements, qualificationFixture.phases);
  assert.deepEqual(qualification.statements, run.statements);
  const [column, ...remaining] = [...observed.objects].sort((a, b) => Number(b.kind === "column") - Number(a.kind === "column"));
  const different = { ...column, properties: { ...column.properties, type: "bigint" } };
  const divergence = preparationFixture();
  await assert.rejects(simulateIntegrationPreparation({
    kind: "qualify", expectedStructure: { ...observed, objects: [different, ...remaining] },
  }, divergence.options), /Divergência estrutural/u);
  assert.deepEqual(divergence.phases, [
    "pool", "connect", "begin", "session", "identity", "schemas", "acl", "catalog", "migrations", "structure",
    "rollback", "release", "end",
  ]);
  // BEGIN, session settings and catalog queries through the rejected structural projection.
  assert.deepEqual(divergence.statements, [...statements.slice(0, 8), "ROLLBACK"]);
});

test("D1.1 candidata não concede aprovação e precisa dos bytes fixados pela autoridade externa", async () => {
  const { options } = preparationFixture();
  const run = await simulateIntegrationPreparation({ kind: "extract-candidate" }, options);
  assert.ok(run.candidate);
  const { sha256, bytes } = run.candidate;
  const authority = {
    approval: () => ({ source: "fixture-candidate", sha256, kind: "synthetic" as const }),
    readApprovedSource: async () => Buffer.from(bytes),
  };
  await assert.rejects(loadCampaignReference({ ...authority, approval: () => undefined }, "real"), /sem aprovação/u);
  await assert.rejects(loadCampaignReference(authority, "real"), /sem aprovação/u);
  await assert.rejects(loadCampaignReference({
    ...authority, readApprovedSource: async () => Buffer.from(bytes + " "),
  }, "simulation"), /sem aprovação/u);
  const loaded = await loadCampaignReference(authority, "simulation");
  assert.ok(Object.isFrozen(loaded.reference));
});

test("D1.1 qualificação operacional recusa fonte da mesma instalação mesmo após reinício", () => {
  const approved = {
    kind: "homologated", sha256: "d".repeat(64),
    sourceInstanceSha256: "e".repeat(64), sourceClusterSha256: "f".repeat(64),
  };
  assert.equal(validateStructuralApproval(approved, windowsIdentity), approved.sha256);
  for (const invalid of [
    { ...approved, kind: "synthetic" },
    { ...approved, sourceClusterSha256: windowsIdentity.clusterSha256 },
    { ...approved, sourceInstanceSha256: windowsIdentity.instanceSha256 },
  ]) {
    assert.throws(() => validateStructuralApproval(invalid, windowsIdentity), /sem homologação válida/u);
  }
});

function passwordTerminal(isTTY = true) {
  return Object.assign(new PassThrough(), {
    isTTY,
    isRaw: false,
    setRawMode(raw: boolean) { this.isRaw = raw; },
  });
}

test("D1.1 lê senha sem eco, trata retrocesso UTF-8 e restaura o terminal", async () => {
  const terminal = passwordTerminal();
  const messages: string[] = [];
  const read = readTerminalPassword(terminal as unknown as ReadStream, message => messages.push(message));
  assert.equal(terminal.isRaw, true);
  terminal.write(Buffer.from("test-é"));
  terminal.write(Buffer.from([127]));
  terminal.write(Buffer.from("@\r"));
  assert.equal(await read, "test-%40");
  assert.deepEqual(messages, ["Senha da role PostgreSQL dedicada (sem eco): ", "\n"]);
  assert.equal(terminal.isRaw, false);
  assert.equal(terminal.listenerCount("data"), 0);
});

test("D1.1 cancela a entrada protegida com Ctrl+C e restaura o terminal", async () => {
  const terminal = passwordTerminal();
  const read = readTerminalPassword(terminal as unknown as ReadStream, () => {});
  terminal.write(Buffer.from([3]));
  await assert.rejects(read, /cancelada ou inválida/u);
  assert.equal(terminal.isRaw, false);
  assert.equal(terminal.listenerCount("data"), 0);
});

test("D1.1 trata BS e DEL com UTF-8 dividido e rejeita a sequência da tecla Delete", async () => {
  for (const erase of [8, 127]) {
    const terminal = passwordTerminal();
    const read = readTerminalPassword(terminal as unknown as ReadStream, () => {});
    terminal.write(Buffer.from("Demo-"));
    terminal.write(Buffer.from([0xc3]));
    terminal.write(Buffer.from([0xa9, erase, 0x40, 13]));
    assert.equal(await read, "Demo-%40");
    assert.equal(terminal.isRaw, false);
  }
  const terminal = passwordTerminal();
  const read = readTerminalPassword(terminal as unknown as ReadStream, () => {});
  terminal.write(Buffer.from([27, 91, 51, 126]));
  await assert.rejects(read, /cancelada ou inválida/u);
  assert.equal(terminal.isRaw, false);
});

test("D1.1 rejeita stdin redirecionado antes de solicitar a senha", async () => {
  const terminal = passwordTerminal(false);
  const messages: string[] = [];
  await assert.rejects(readTerminalPassword(terminal as unknown as ReadStream,
    message => messages.push(message)), /cancelada ou inválida/u);
  assert.deepEqual(messages, []);
  assert.equal(terminal.isRaw, false);
});

for (const identity of [
  undefined, { ...windowsIdentity, listenerPid: 0 }, { ...windowsIdentity, service: "other" },
  { ...windowsIdentity, instanceSha256: "invalid" }, { ...windowsIdentity, postgresVersionNum: 180005 },
]) {
  test("D1.1 recusa evidência Windows ausente ou incompatível antes do pool", async () => {
    const { options, phases } = preparationFixture();
    await assert.rejects(simulateIntegrationPreparation({ kind: "extract-candidate" }, {
      ...options, observeIdentity: async () => identity as typeof windowsIdentity,
    }), /Identidade operacional/u);
    assert.deepEqual(phases, []);
  });
}

for (const observation of [2, 3]) {
  test("D1.1 recusa identidade Windows alterada na observação " + observation, async () => {
    const { options, phases } = preparationFixture();
    let seen = 0;
    await assert.rejects(simulateIntegrationPreparation({ kind: "extract-candidate" }, {
      ...options, observeIdentity: async () => ++seen === observation
        ? (observation === 2 ? { ...windowsIdentity, instanceSha256: "b".repeat(64) }
          : { ...windowsIdentity, clusterSha256: "b".repeat(64) }) : windowsIdentity,
    }), /Falha ao conectar|Identidade operacional/u);
    if (observation === 2) assert.deepEqual(phases, ["pool", "end"]);
    else assert.deepEqual(phases.slice(-3), ["rollback", "release", "end"]);
  });
}

test("D1.1 bloqueia operação real, referência v1 e falha do observador sem expor credencial", async () => {
  const { options, phases } = preparationFixture();
  await assert.rejects(simulateIntegrationPreparation({ kind: "extract-candidate" }, {
    ...options, mode: "real" as "simulation",
  }), /real indisponível/u);
  await assert.rejects(simulateIntegrationPreparation({ kind: "qualify", expectedStructure: { formatVersion: 1 } }, options),
    /Formato ou versão/u);
  await assert.rejects(simulateIntegrationPreparation({ kind: "extract-candidate" }, {
    ...options, observeIdentity: async () => { throw new Error(uri); },
  }), (error: Error) => /indisponível/u.test(error.message) && !error.message.includes(uri));
  assert.deepEqual(phases, []);
});

const preparationFailures: [Overrides, RegExp][] = [
  [{ baseline: [{ occupied: true }] }, /Baseline operacional/u],
  [{ admin: [{ occupied: true }] }, /Admin global histórico/u],
  [{ structure: [] }, /Projeção estrutural incompleta/u],
];
for (const [overrides, reason] of preparationFailures) {
  test("D1.1 encerra o snapshot e não disponibiliza candidata com " + reason.source, async () => {
    const { options, phases } = preparationFixture(overrides);
    await assert.rejects(simulateIntegrationPreparation({ kind: "extract-candidate" }, options), reason);
    assert.deepEqual(phases.slice(-3), ["rollback", "release", "end"]);
  });
}

test("D1.1 recusa sessão incompatível imediatamente após BEGIN", async () => {
  const { options, phases } = preparationFixture({ session: [{ read_only: "off" }] });
  await assert.rejects(simulateIntegrationPreparation({ kind: "extract-candidate" }, options), /Configuração efetiva/u);
  assert.deepEqual(phases, ["pool", "connect", "begin", "session", "rollback", "release", "end"]);
});

test("D1.1 mede latência, limites de offset e margem até a ativação", async () => {
  const wall = [10_000, 10_020];
  const monotonic = [100, 120];
  const result = await measureQuestionnaireClock(async () => ({
    server_ms: 10_012, snapshot_ms: 9_995, activation_ms: 9_990,
  }), { wallMs: () => wall.shift()!, monotonicMs: () => monotonic.shift()! });
  assert.equal(result.elapsedMs, 20);
  assert.equal(result.offsetMinMs, -9);
  assert.equal(result.offsetMaxMs, 13);
  assert.equal(result.activationMarginMs, 5);
});

test("D1.1 rejeita salto de relógio e ativação cuja margem não é demonstrável", async () => {
  const wall = [10_000, 11_000];
  const sample = { server_ms: 10_010, snapshot_ms: 10_005, activation_ms: 10_000 };
  await assert.rejects(measureQuestionnaireClock(async () => sample, { ...clock, wallMs: () => wall.shift()! }), /inconclusiva/u);
  await assert.rejects(measureQuestionnaireClock(async () => sample, clock), /Vigência/u);
});

test("D1.1 rejeita ativação cujo microssegundo não cabe no corte Date da aplicação", async () => {
  const sample = { server_ms: 9_998.9, snapshot_ms: 9_998.8, activation_ms: 9_998.2 };
  await assert.rejects(measureQuestionnaireClock(async () => sample, clock), /Vigência/u);
});

test("D1.1 rejeita três amostras cujos intervalos de offset não se cruzam", async () => {
  const samples = [10_000, 10_010, 10_020];
  await assert.rejects(measurePreparationClock(async () => ({
    server_ms: samples.shift(), snapshot_ms: 9_995, activation_ms: 9_990,
  }), clock), /Amostras consecutivas/u);
  assert.equal(samples.length, 0);
});

test("D1.1 exige um único domínio de journal e conserva recuperação pendente", () => {
  const domain = { path: "C:\\ProgramData\\ArenaGO\\integration", directoryId: "volume-id:file-id", operatorSid: "S-1-5-21-123" };
  const observed = { ...domain, localNtfs: true, withoutReparsePoints: true, protectedAcl: true, residual: false };
  confirmJournalDomain(domain, observed);
  for (const difference of [
    { path: "C:\\checkout\\integration" }, { directoryId: "different-directory" }, { operatorSid: "S-1-5-21-321" },
    { localNtfs: false }, { withoutReparsePoints: false }, { protectedAcl: false }, { residual: true },
  ]) {
    assert.throws(() => confirmJournalDomain(domain, { ...observed, ...difference }), /Domínio do journal/u);
  }
});

const explicitMemberships = [
  ["sem vínculos explícitos", [], true],
  ["como membro", [{ member: 42, roleid: 71 }], false],
  ["concedida a outra role", [{ member: 71, roleid: 42 }], false],
  ["nas duas direções", [{ member: 42, roleid: 71 }, { member: 72, roleid: 42 }], false],
  ["sem opções de membership", [{ member: 71, roleid: 42, inherit_option: false, set_option: false, admin_option: false }], false],
] as const;

for (const [description, grants, accepted] of explicitMemberships) {
  test("BC-01 atesta role " + description + " usando os dois vínculos do catálogo", async () => {
    const { factory, phases, reference } = fixture({}, undefined, (sql, rows) => {
      if (!sql.includes("AS database_name")) return rows;
      const projections = [...sql.matchAll(
        /EXISTS\s*\(\s*SELECT 1 FROM pg_catalog\.pg_auth_members m WHERE m\.(member|roleid) = r\.oid\s*\) AS (\w+)/gu,
      )];
      assert.deepEqual(projections.map(match => match.slice(1)), [["member", "member_of_role"], ["roleid", "granted_to_role"]]);
      assert.match(sql, /JOIN pg_catalog\.pg_roles r ON r\.rolname = session_user/u);
      const memberships = Object.fromEntries(projections.map(match => {
        const field = match[1] as "member" | "roleid";
        return [match[2], grants.some(grant => grant[field] === 42)];
      }));
      return [{ ...rows[0], ...memberships }];
    });
    const run = attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
    if (accepted) {
      await run;
      assert.ok(phases.includes("structure"));
    } else {
      await assert.rejects(run, /Associação explícita/u);
      assert.deepEqual(phases, ["pool", "connect", "begin", "identity", "rollback", "release", "end"]);
    }
  });
}

const distinctSqlFailures: [string, Overrides, RegExp][] = [
  ["identidade", { identity: [{ ...valid.identity[0], server_port: 5432 }] }, /Identidade efetiva/u],
  ["role efetiva", { identity: [{ ...valid.identity[0], current_role: "owner" }] }, /Identidade efetiva/u],
  ...["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"].map(
    (key): [string, Overrides, RegExp] => [key, { identity: [{ ...valid.identity[0], [key]: true }] }, /Privilégio/u],
  ),
  ["membership", { identity: [{ ...valid.identity[0], member_of_role: true }] }, /Associação/u],
  ["proprietário do banco", { identity: [{ ...valid.identity[0], database_owner: "owner" }] }, /Proprietário/u],
  ["proprietário de objeto", { catalog: [{ ...valid.catalog[0], owner: "owner" }, ...valid.catalog.slice(1)] }, /proprietário/u],
  ["schema adicional", { schemas: [...valid.schemas, { name: "other", owner: "arenago" }] }, /Schemas/u],
  ["ACL", { acl: [{ compatible: false }] }, /ACL/u],
  ["migration ausente", { migrations: valid.migrations.slice(1) }, /Journal/u],
  ["hash divergente", { migrations: [{ ...valid.migrations[0], hash: "wrong" }, ...valid.migrations.slice(1)] }, /Hash/u],
  ["objeto ausente", { catalog: valid.catalog.slice(1) }, /objeto obrigatório/u],
  ["DDL inesperado", { catalog: [...valid.catalog, { kind: "function", name: "public.fixture_left_behind()" }] }, /DDL inesperado/u],
  ["trigger desativado", { catalog: valid.catalog.map(row => row.kind === "trigger" ? { ...row, valid: false } : row) }, /estado inválido/u],
  ["baseline operacional", { baseline: [{ occupied: true }] }, /Baseline operacional/u],
  ["catálogo vazio", { games: [], questionnaires: [] }, /Baseline canônico/u],
  ["jogos alterados com a mesma contagem", { games: [{ ...valid.games[0], curated: false }, ...valid.games.slice(1)] }, /Baseline canônico/u],
  ["questionário alterado com a mesma contagem", { questionnaires: [{ ...valid.questionnaires[0], definition: {} }] }, /Baseline canônico/u],
  ["Admin histórico", { admin: [{ occupied: true }] }, /Admin global histórico/u],
];

for (const [name, overrides, error] of distinctSqlFailures) {
  test("atesta e rejeita " + name + " com rollback e encerramento", async () => {
    const { phases, factory, reference } = fixture(overrides);
    await assert.rejects(attestIntegrationDatabase("admin-role-management", syntheticEnvironment(), factory, reference), error);
    assert.deepEqual(phases.slice(-3), ["rollback", "release", "end"]);
  });
}

const driverFailures = [
  ["pool", ["pool"]],
  ["connect", ["connect", "end"]],
  ["begin", ["begin", "discard", "end"]],
  ["identity", ["rollback", "release", "end"]],
  ["rollback", ["rollback", "discard", "end"]],
  ["release", ["rollback", "release", "end"]],
  ["end", ["rollback", "release", "end"]],
] as const;

for (const [failure, suffix] of driverFailures) {
  test("sanitiza erro do driver em " + failure + " e fecha os recursos disponíveis", async () => {
    const { phases, factory, reference } = fixture({}, failure);
    await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference), (error: Error) => {
      assert.match(error.message, /^\[SEGURANÇA BLOQUEADA\]/u);
      assert.doesNotMatch(error.message, /postgresql:|fixture-only/u);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(phases.slice(-suffix.length), [...suffix]);
  });
}

test("estrutura compatível é conferida na mesma transação somente leitura", async () => {
  const { phases, statements, factory, reference } = fixture();
  await attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
  const statement = statements.find(sql => sql.includes("AS structural_catalog")) ?? "";
  assert.match(statement, /^SELECT /u);
  assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|COMMIT)\b/u);
  for (const deparser of ["pg_get_constraintdef", "pg_get_indexdef", "pg_get_triggerdef", "pg_get_functiondef", "pg_get_expr"]) {
    assert.ok(statement.includes(deparser + "("), deparser);
  }
  assert.equal(phases.filter(phase => phase === "connect").length, 1);
  assert.deepEqual(phases.slice(-7), ["structure", "baseline", "games", "questionnaires", "rollback", "release", "end"]);
});

test("BC-02 vincula triggers internos à FK pelo catálogo e projeta identidades lógicas", async () => {
  const { statements, factory, reference } = fixture();
  await attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
  const statement = statements.find(sql => sql.includes("AS structural_catalog")) ?? "";
  const clauses = statement.match(/'foreignKeyTriggers', CASE WHEN k\.contype = 'f' THEN COALESCE\(\(([\s\S]+?)\), '\[\]'::jsonb\) END/u);
  assert.ok(clauses);
  assert.match(statement, /FROM relations r JOIN pg_catalog\.pg_constraint k ON k\.conrelid = r\.oid/u);
  const projection = clauses[1];
  assert.match(projection, /FROM pg_catalog\.pg_trigger ri[\s\S]+WHERE ri\.tgisinternal AND ri\.tgconstraint = k\.oid\s*$/u);
  assert.match(projection, /trigger_rel\.oid = ri\.tgrelid[\s\S]+related_rel\.oid = ri\.tgconstrrelid[\s\S]+fn\.oid = ri\.tgfoid/u);
  assert.match(projection, /trigger_ns\.oid = trigger_rel\.relnamespace[\s\S]+related_ns\.oid = related_rel\.relnamespace[\s\S]+fn_ns\.oid = fn\.pronamespace/u);
  const aggregate = projection.match(/SELECT jsonb_agg\(jsonb_build_object\(([\s\S]+?)\)\)\s+FROM/u);
  assert.ok(aggregate);
  assert.doesNotMatch(projection, /\b(?:DISTINCT|LIMIT|tgname|pg_get_triggerdef)\b/iu);
  assert.doesNotMatch(aggregate[1], /\.oid\b|\.tg(?:relid|constrrelid|constraint|foid)\b/u);
  assert.deepEqual([...aggregate[1].matchAll(/'(\w+)', ([^,\n]+)/gu)].map(match => match.slice(1)), [
    ["tableSchema", "trigger_ns.nspname"], ["tableName", "trigger_rel.relname"],
    ["relatedSchema", "related_ns.nspname"], ["relatedName", "related_rel.relname"],
    ["functionSchema", "fn_ns.nspname"], ["functionName", "fn.proname"],
    ["functionSignature", "oidvectortypes(fn.proargtypes)"], ["eventsAndTiming", "ri.tgtype"],
    ["enabled", "ri.tgenabled::text"], ["deferrable", "ri.tgdeferrable"], ["initiallyDeferred", "ri.tginitdeferred"],
  ]);
  assert.match(statement, /WHERE NOT t\.tgisinternal/u);
});

const fk = fixtureObjects.find(row => row.name === "owner_fk")!;
const secondFk = { ...fk, name: "backup_owner_fk" };
const [firstTrigger, ...remainingTriggers] = foreignKeyTriggers;
const foreignKeyChanges = [
  ["desativado", [{ ...firstTrigger, enabled: "D" }, ...remainingTriggers]],
  ["ausente", remainingTriggers],
  ["adicional incompatível", [...foreignKeyTriggers, { ...firstTrigger, eventsAndTiming: 33 }]],
  ["relação divergente", [{ ...firstTrigger, tableName: "owners" }, ...remainingTriggers]],
  ["função divergente", [{ ...firstTrigger, functionName: "RI_FKey_check_upd" }, ...remainingTriggers]],
  ["diferibilidade alterada", [{ ...firstTrigger, deferrable: true, initiallyDeferred: true }, ...remainingTriggers]],
  ["multiplicidade alterada com a mesma contagem", [firstTrigger, ...remainingTriggers.slice(0, 2), firstTrigger]],
] as const;

for (const [description, observed] of foreignKeyChanges) {
  test("BC-02 rejeita trigger interno " + description, async () => {
    const structure = fixtureObjects.map(row => row === fk ? { ...fk, properties: { ...fk.properties, foreignKeyTriggers: observed } } : row);
    const { factory, phases, reference } = fixture({ structure });
    await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference),
      /Divergência estrutural em constraint public\.fixture\.owner_fk \(foreignKeyTriggers\)/u);
    assert.deepEqual(phases.slice(-4), ["structure", "rollback", "release", "end"]);
  });
}

test("BC-02 rejeita trigger transferido entre FKs existentes", async () => {
  const structure = fixtureObjects.map(row => row === fk ? { ...fk, properties: { ...fk.properties, foreignKeyTriggers: remainingTriggers } } : row);
  structure.push({ ...secondFk, properties: { ...secondFk.properties, foreignKeyTriggers: [...foreignKeyTriggers, firstTrigger] } });
  const { factory, reference } = fixture({ structure });
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory,
    { ...reference, objects: [...reference.objects, secondFk] }), /Divergência estrutural.*foreignKeyTriggers/u);
});

test("BC-02 preserva a equivalência lógica sem ordem, OIDs ou nomes físicos", async () => {
  const structure = [...fixtureObjects].reverse().map((row, index) => ({
    ...row,
    oid: 44000 + index,
    internalTriggerNames: ["RI_ConstraintTrigger_c_46001", "RI_ConstraintTrigger_a_46002"],
    properties: row === fk ? { ...row.properties, foreignKeyTriggers: [...foreignKeyTriggers].reverse().map(trigger =>
      Object.fromEntries(Object.entries(trigger).reverse()) as typeof trigger) } : row.properties,
  }));
  assert.equal(structuralSnapshot(structure).sha256, structuralSnapshot(fixtureObjects).sha256);
  const { factory, reference } = fixture({ structure });
  await attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
});

test("BC-02 rejeita versão anterior e referência v2 com projeção incompleta antes do pool", async () => {
  const { factory, phases, reference } = fixture();
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, { ...reference, formatVersion: 1 }),
    /Formato ou versão/u);
  const { foreignKeyTriggers: ignored, ...withoutTriggers } = fk.properties;
  for (const properties of [withoutTriggers, { ...fk.properties, foreignKeyTriggers: [] }]) {
    const objects = reference.objects.map(row => row === fk ? { ...row, properties } : row);
    await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, { ...reference, objects }),
      /Projeção estrutural incompleta|Referência com triggers de chave estrangeira incompatíveis/u);
  }
  assert.deepEqual(phases, []);
});

test("BC-02 recusa a sessão em modo replica antes de consultar o catálogo", async () => {
  const { factory, phases, reference, statements } = fixture({ identity: [{ ...valid.identity[0], replication_role: "replica" }] });
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference), /Modo de replicação/u);
  assert.deepEqual(phases, ["pool", "connect", "begin", "identity", "rollback", "release", "end"]);
  assert.match(statements[1], /pg_catalog\.current_setting\('session_replication_role'\) AS replication_role/u);
});

const baselineInstant = Date.UTC(2026, 10, 25);
for (const [description, activatedAt, accepted, definition] of [
  ["anterior", baselineInstant - 1, true, DEFAULT_QUESTIONNAIRE_DEFINITION],
  ["igual", baselineInstant, true, DEFAULT_QUESTIONNAIRE_DEFINITION],
  ["futura apesar do conteúdo canônico", baselineInstant + 1, false, DEFAULT_QUESTIONNAIRE_DEFINITION],
  ["nula", null, false, DEFAULT_QUESTIONNAIRE_DEFINITION],
  ["vigente com conteúdo divergente", baselineInstant, false, {}],
] as const) {
  test("BC-03 verifica ativação " + description + " no snapshot do banco", async () => {
    const { factory, phases, reference } = fixture({}, undefined, (sql, rows) => {
      if (!sql.includes("FROM public.questionnaire_versions")) return rows;
      assert.match(sql, /^SELECT version, definition,\s+\(activated_at IS NOT NULL AND activated_at <= CURRENT_TIMESTAMP\) AS published\s+FROM public\.questionnaire_versions$/u);
      return [{ ...rows[0], definition, published: activatedAt !== null && activatedAt <= baselineInstant }];
    });
    const run = attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
    if (accepted) await run;
    else await assert.rejects(run, /Baseline canônico/u);
    assert.deepEqual(phases.slice(-4), ["questionnaires", "rollback", "release", "end"]);
  });
}

const invalidReferences: [string, (reference: StructuralReference) => unknown, RegExp][] = [
  ["ausente", () => undefined, /Referência estrutural confiável obrigatória/u],
  ["hash incompatível", reference => ({ ...reference, migrations: reference.migrations.map(row => ({ ...row, hash: "other" })) }),
    /incompatível com as migrations/u],
  ["ordem das migrations", reference => ({ ...reference, migrations: [...reference.migrations].reverse() }),
    /incompatível com as migrations/u],
  ["versão do formato", reference => ({ ...reference, formatVersion: 3 }), /Formato ou versão/u],
  ["versão principal não suportada", reference => ({ ...reference, postgresVersionNum: 170010 }), /Formato ou versão/u],
  ["escopo incompatível", reference => ({ ...reference, schemas: ["public"] }), /Escopo de schemas/u],
  ["sem objetos", reference => ({ ...reference, objects: [] }), /sem objetos/u],
  ["com identidade duplicada", reference => ({ ...reference, objects: [...reference.objects, reference.objects[0]] }),
    /Objeto estrutural duplicado/u],
];

for (const [description, change, error] of invalidReferences) {
  test("bloqueia referência " + description + " antes do pool", async () => {
    const { factory, phases, reference } = fixture();
    await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, change(reference)), error);
    assert.deepEqual(phases, []);
  });
}

test("bloqueia versão efetiva diferente da referência, mesmo na mesma versão principal", async () => {
  const { factory, phases, reference } = fixture({
    identity: [{ ...valid.identity[0], server_version_num: 180007 }],
  });
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference), /Versão PostgreSQL divergente/u);
  assert.deepEqual(phases, ["pool", "connect", "begin", "identity", "rollback", "release", "end"]);
});

const structuralChanges: [string, string, StructuralObject["properties"][string], string?][] = [
  ["quantity", "type", "bigint"],
  ["quantity", "notNull", false],
  ["quantity", "expression", "42"],
  ["quantity", "position", 2],
  ["quantity", "generated", "s"],
  ["positive", "definition", "CHECK ((quantity > 0))"],
  ["positive", "deferrable", true],
  ["positive", "validated", false],
  ["positive", "enforced", false],
  ["owner_fk", "definition", "FOREIGN KEY (owner) REFERENCES public.owners(id) ON DELETE CASCADE"],
  ["only_positive", "definition", "CREATE UNIQUE INDEX only_positive ON public.fixture USING btree ((quantity + 1))"],
  ["only_positive", "unique", false],
  ["only_positive", "predicate", "(quantity > 2)"],
  ["example", "definition", "SELECT 3", "text"],
  ["protect", "definition", "CREATE TRIGGER protect AFTER UPDATE ON public.fixture EXECUTE FUNCTION public.protect()"],
  ["protect", "function", "public.different()"],
  ["protect", "enabled", "D"],
  ["__drizzle_migrations_id_seq", "ownedBy", null],
];

for (const [name, property, value, signature] of structuralChanges) {
  test("detecta alteração de " + name + " em " + property + " preservando a identidade", async () => {
    const structure = fixtureObjects.map(object => object.name === name
        && (signature === undefined || object.signature === signature)
      ? { ...object, properties: { ...object.properties, [property]: value } }
      : { ...object });
    const { factory, phases, reference } = fixture({ structure });
    await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference), (error: Error) => {
      assert.match(error.message, /Divergência estrutural/u);
      assert.ok(error.message.includes(name));
      assert.ok(error.message.includes("(" + property + ")"));
      return true;
    });
    assert.deepEqual(phases.slice(-4), ["structure", "rollback", "release", "end"]);
  });
}

test("preserva a distinção entre sobrecargas com o mesmo nome", () => {
  const overloads = fixtureObjects.filter(object => object.kind === "function");
  assert.equal(structuralSnapshot(overloads).objects.size, 2);
  assert.notEqual(structuralSnapshot(overloads).sha256, structuralSnapshot(overloads.slice(1)).sha256);
});

test("bloqueia objeto estrutural obrigatório ausente", async () => {
  const structure = valid.structure.filter(row => row.name !== "quantity");
  const { factory, reference } = fixture({ structure });
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference),
    /Objeto estrutural obrigatório ausente: column public\.fixture\.quantity/u);
});

test("bloqueia objeto estrutural adicional fora da referência", async () => {
  const column = valid.structure.find(row => row.name === "quantity");
  const { factory, reference } = fixture({ structure: [...valid.structure, { ...column, name: "residue" }] });
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference),
    /Objeto estrutural inesperado: column public\.fixture\.residue/u);
});

test("bloqueia projeção estrutural sem uma propriedade obrigatória", async () => {
  const structure = fixtureObjects.map(object => object.name === "quantity" ? { ...object, properties: {} } : object);
  const { factory, reference } = fixture({ structure });
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference),
    /Projeção estrutural incompleta ou inválida/u);
});

test("ordem das linhas e das chaves JSON não altera a assinatura", async () => {
  const structure = [...fixtureObjects].reverse().map(object => ({
    ...object, properties: Object.fromEntries(Object.entries(object.properties).reverse()),
  }));
  assert.equal(structuralSnapshot(fixtureObjects).sha256, structuralSnapshot(structure).sha256);
  const { factory, reference } = fixture({ structure });
  await attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
});

test("OIDs arbitrários não integram a assinatura estrutural", async () => {
  const structure = fixtureObjects.map((object, index) => ({ ...object, oid: 18000 + index }));
  const { factory, reference } = fixture({ structure });
  assert.equal(structuralSnapshot(fixtureObjects).sha256, structuralSnapshot(structure).sha256);
  await attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference);
});

test("divergências omitem definições e identificadores com texto sensível", async () => {
  const hidden = "postgresql://fixture:secret@local/fixture";
  const fn = fixtureObjects.find(object => object.signature === "text")!;
  const cases: readonly StructuralObject[][] = [
    fixtureObjects.map(object => object === fn ? { ...fn, properties: { ...fn.properties, definition: hidden } } : object),
    [...fixtureObjects, { ...fn, name: hidden }],
  ];
  for (const structure of cases) {
    const { factory, reference } = fixture({ structure });
    await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference), (error: Error) => {
      assert.match(error.message, /estrutural.*function public\./u);
      assert.doesNotMatch(error.message, /postgresql:|secret/u);
      return true;
    });
  }
});

test("erro na introspecção estrutural é sanitizado e libera o pool", async () => {
  const { factory, reference, phases } = fixture({}, "structure");
  await assert.rejects(attestIntegrationDatabase(suite, syntheticEnvironment(), factory, reference),
    { message: "[SEGURANÇA BLOQUEADA] Falha na etapa estrutura do catálogo." });
  assert.deepEqual(phases.slice(-4), ["structure", "rollback", "release", "end"]);
});
