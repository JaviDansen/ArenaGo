import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAdminRoleManagementTestDatabaseUrls,
  startAdminRoleManagementAfterPreflight,
} from "../integration/admin-role-management-db-guard";

function env(database = "arenago_roles_test") {
  const url = `postgresql://fixture:fixture@127.0.0.1:55432/${database}`;
  return { NODE_ENV: "test", DATABASE_URL: url, DATABASE_DIRECT_URL: url, EVENTS_TEST_DATABASE_URL: url };
}

test("T6.1-D guarda aceita exclusivamente as três URLs iguais do PostgreSQL dedicado", () => {
  assert.equal(assertAdminRoleManagementTestDatabaseUrls(env()),
    "postgresql://fixture:fixture@127.0.0.1:55432/arenago_roles_test");
});

test("T6.1-D guarda bloqueia banco compartilhado, host/porta remotos, query e fragmento", () => {
  for (const invalid of ["arenago_events_test", "arenago_bootstrap_test", "other_db"]) {
    assert.throws(() => assertAdminRoleManagementTestDatabaseUrls(env(invalid)), /SEGURANÇA BLOQUEADA/);
  }
  for (const change of [
    (url: string) => url.replace("127.0.0.1", "localhost"),
    (url: string) => url.replace("55432", "5432"),
    (url: string) => `${url}?sslmode=disable`,
    (url: string) => `${url}#fragment`,
  ]) {
    const value = env(), changed = change(value.DATABASE_URL!);
    value.DATABASE_URL = changed; value.DATABASE_DIRECT_URL = changed; value.EVENTS_TEST_DATABASE_URL = changed;
    assert.throws(() => assertAdminRoleManagementTestDatabaseUrls(value), /SEGURANÇA BLOQUEADA/);
  }
  const mismatched = env(); mismatched.DATABASE_DIRECT_URL = mismatched.DATABASE_URL.replace("fixture:fixture", "other:fixture");
  assert.throws(() => assertAdminRoleManagementTestDatabaseUrls(mismatched), /URLs devem ser idênticas/);
});

test("T6.1-D guarda exige NODE_ENV=test e todas as URLs explícitas", () => {
  for (const name of ["NODE_ENV", "DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const) {
    const value: Record<string, string | undefined> = env(); delete value[name];
    assert.throws(() => assertAdminRoleManagementTestDatabaseUrls(value), /SEGURANÇA BLOQUEADA/);
  }
  assert.throws(() => assertAdminRoleManagementTestDatabaseUrls({ ...env(), NODE_ENV: "production" }), /SEGURANÇA BLOQUEADA/);
});

test("T6.1-D guarda recusa credenciais ausentes, espaços e caminhos codificados", () => {
  for (const change of [
    (url: string) => url.replace("fixture:fixture@", ""),
    (url: string) => url.replace("fixture:fixture@", "fixture@"),
    (url: string) => ` ${url}`,
    (url: string) => url.replace("arenago_roles_test", "%61renago_roles_test"),
  ]) {
    const url = change(env().DATABASE_URL);
    assert.throws(() => assertAdminRoleManagementTestDatabaseUrls({ NODE_ENV: "test", DATABASE_URL: url,
      DATABASE_DIRECT_URL: url, EVENTS_TEST_DATABASE_URL: url }), /SEGURANÇA BLOQUEADA/);
  }
});

const identity = {
  database_name: "arenago_roles_test", current_role: "arenago_roles_test", session_role: "arenago_roles_test",
  server_address: "127.0.0.1", server_port: 55432,
  rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false,
};
const expectedMigrations = ["100", "200"];
const migrationRows = expectedMigrations.map(migration => ({ migration }));
const connectionError = new Error("postgresql://usuario-sintetico:segredo-sintetico@127.0.0.1:55432/arenago_roles_test");

function mockPreflight(results: (Record<string, unknown>[] | Error)[], failConnect = false) {
  const operations: string[] = [], statements: string[] = [];
  const pool = {
    async connect() {
      operations.push("connect");
      if (failConnect) throw connectionError;
      return {
        async query(statement: string) {
          operations.push("query");
          statements.push(statement);
          const response = results[statements.length - 1];
          if (response instanceof Error) throw response;
          assert.ok(response, "Consulta inesperada na pré-verificação");
          return { rows: response };
        },
        release() { operations.push("release"); },
      };
    },
    async end() { operations.push("end"); },
  };
  const start = () => startAdminRoleManagementAfterPreflight(pool, expectedMigrations, async () => {
    operations.push("initialize");
    return "started";
  });
  return { start, operations, statements };
}

test("T6.1-D pré-verificação confirma identidade e schema antes de inicializar a aplicação", async () => {
  const run = mockPreflight([[identity], [{ ready: true }], migrationRows, [{ present: false }]]);
  assert.equal(await run.start(), "started");
  assert.deepEqual(run.operations, ["connect", "query", "query", "query", "query", "release", "initialize"]);
  assert.match(run.statements[0], /^SELECT current_database\(\).*\bcurrent_user\b.*\bsession_user\b.*inet_server_addr\(\).*inet_server_port\(\).*pg_catalog\.pg_roles/s);
  assert.match(run.statements[1], /^SELECT .*to_regclass.*staff_idempotency_epochs.*external_entry_calls/s);
  assert.match(run.statements[2], /^SELECT .* FROM drizzle\.__drizzle_migrations ORDER BY created_at/s);
  assert.match(run.statements[3], /^SELECT EXISTS\s*\(\s*SELECT 1 FROM public\.user_roles WHERE role = 'admin'\s*\) AS present$/);
});

for (const [field, value, diagnostic] of [
  ["database_name", "other_db", /Banco conectado/],
  ["current_role", "outra_role", /current_user e session_user/],
  ["session_role", "outra_role", /current_user e session_user/],
  ["server_address", "192.0.2.10", /Endereço do servidor/],
  ["server_address", null, /Endereço do servidor/],
  ["server_port", 5432, /Porta do servidor/],
  ...(["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"] as const)
    .map(privilege => [privilege, true, /Role dedicada deve estar sem/] as const),
] as const) {
  test(`T6.1-D pré-verificação bloqueia ${field}=${value} antes de inicializar`, async () => {
    const run = mockPreflight([[{ ...identity, [field]: value }]]);
    await assert.rejects(run.start(), diagnostic);
    assert.deepEqual(run.operations, ["connect", "query", "release", "end"]);
  });
}

test("T6.1-D pré-verificação sanitiza falhas de conexão e de identificação e fecha o pool", async () => {
  for (const failConnect of [true, false]) {
    const run = mockPreflight([connectionError], failConnect);
    await assert.rejects(run.start(), (error: Error) => {
      assert.match(error.message, failConnect ? /abrir a conexão de pré-verificação/ : /consulta de identidade/);
      assert.doesNotMatch(String(error), /segredo-sintetico|postgresql:\/\//);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(run.operations, failConnect ? ["connect", "end"] : ["connect", "query", "release", "end"]);
  }
});

test("T6.1-D pré-verificação bloqueia tabelas ausentes, journal divergente e Admin histórico", async () => {
  const cases: [Record<string, unknown>[][], RegExp][] = [
    [[[{ ready: false }]], /Tabelas necessárias/],
    [[[{ ready: true }], [{ migration: "100" }]], /Histórico de migrations/],
    [[[{ ready: true }], [{ migration: "100" }, { migration: "300" }]], /Histórico de migrations/],
    [[[{ ready: true }], migrationRows, [{ present: true }]], /Admins preexistentes/],
  ];
  for (const [results, diagnostic] of cases) {
    const responses = [[identity], ...results];
    const run = mockPreflight(responses);
    await assert.rejects(run.start(), diagnostic);
    assert.deepEqual(run.operations, ["connect", ...responses.map(() => "query"), "release", "end"]);
  }
});
