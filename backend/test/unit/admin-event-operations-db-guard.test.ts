import assert from "node:assert/strict";
import { devNull } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { adminEventOperationsTestHooks } from "../integration/admin-event-operations-db-guard";

const secret = "mock-secret-never-echo";
const uri = `postgresql://event_runner:${secret}@127.0.0.1:55432/arenago_events_test`;
const migrationRows = readMigrationFiles({ migrationsFolder: resolve(__dirname, "../../drizzle") })
  .map(migration => ({ migration: String(migration.folderMillis), hash: migration.hash }));
const identity = {
  database_name: "arenago_events_test", current_role: "event_runner", session_role: "event_runner",
  server_address: "127.0.0.1", server_port: 55432, rolsuper: false, rolcreatedb: false,
  rolcreaterole: false, rolreplication: false, rolbypassrls: false, role_membership: false,
};

function harness({
  envOverrides = {}, identityOverrides = {}, migrations = migrationRows,
  ready = true, occupied = false, failAt,
}: {
  envOverrides?: NodeJS.ProcessEnv;
  identityOverrides?: Partial<typeof identity>;
  migrations?: typeof migrationRows;
  ready?: boolean;
  occupied?: boolean;
  failAt?: string;
} = {}) {
  const env = { NODE_ENV: "test", DATABASE_URL: uri, DATABASE_DIRECT_URL: uri,
    EVENTS_TEST_DATABASE_URL: uri, DOTENV_CONFIG_PATH: "development.env", ...envOverrides };
  const calls: string[] = [];
  const fail = (step: string) => {
    calls.push(step);
    if (step === failAt) throw new Error(`Driver interno: ${uri}`);
  };
  const hooks = adminEventOperationsTestHooks(async target => {
    assert.equal(target, uri);
    assert.equal(env.DOTENV_CONFIG_PATH, devNull);
    fail("bootstrap");
  }, async () => fail("cleanup"), target => {
    assert.equal(target, uri);
    fail("pool");
    return {
      async connect() {
        fail("connect");
        return {
          async query(sql) {
            if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" || sql === "ROLLBACK") {
              fail(sql);
              return { rows: [] };
            }
            assert.match(sql, /^SELECT /);
            if (sql.includes("current_database()")) {
              fail("identity");
              return { rows: [{ ...identity, ...identityOverrides }] };
            }
            if (sql.includes("pg_catalog.pg_class")) {
              fail("tables");
              return { rows: [{ ready }] };
            }
            if (sql.includes("drizzle.__drizzle_migrations")) {
              fail("migrations");
              return { rows: migrations };
            }
            assert.match(sql, /FROM public\.external_entry_calls/);
            fail("initial");
            return { rows: [{ occupied }] };
          },
          release() { fail("release"); },
        };
      },
      async end() { fail("end"); },
    };
  }, env);
  return { hooks, calls, env };
}

const alternate = (url: string) => ({
  DATABASE_URL: url, DATABASE_DIRECT_URL: url, EVENTS_TEST_DATABASE_URL: url,
});
for (const [name, envOverrides, reason] of [
  ["rejeita ambiente de produção", { NODE_ENV: "production" }, /NODE_ENV=test/],
  ["rejeita scheduler habilitado", { EVENT_CLOSURE_JOB_TEST_ENABLED: "true" }, /scheduler.*desativado/],
  ["rejeita política inválida", { EVENT_CLOSURE_JOB_TEST_ENABLED: "1" }, /Configuração inválida/],
  ["rejeita URL ausente", { EVENTS_TEST_DATABASE_URL: undefined }, /textualmente idênticas/],
  ["rejeita URLs divergentes", { DATABASE_DIRECT_URL: uri + "?host=other" }, /textualmente idênticas/],
  ["rejeita banco ADMIN-06", alternate(uri.replace("arenago_events_test", "arenago_roles_test")), /destino|127\.0\.0\.1/],
  ["rejeita porta diferente", alternate(uri.replace(":55432", ":5432")), /127\.0\.0\.1/],
  ["rejeita host remoto", alternate(uri.replace("127.0.0.1", "remote.example.test")), /127\.0\.0\.1/],
] as const) {
  test(`ADMIN-07 guarda ${name} antes de abrir o pool`, async () => {
    const { hooks, calls, env } = harness({ envOverrides });
    await assert.rejects(hooks.start, reason);
    await hooks.finish();
    assert.deepEqual(calls, []);
    assert.equal(env.DOTENV_CONFIG_PATH, "development.env");
  });
}

for (const [name, options, reason] of [
  ["banco efetivo", { identityOverrides: { database_name: "other" } }, /destino dedicado/],
  ["porta efetiva", { identityOverrides: { server_port: 5432 } }, /destino dedicado/],
  ["endereço efetivo", { identityOverrides: { server_address: "::1" } }, /destino dedicado/],
  ["usuário efetivo", { identityOverrides: { current_role: "other" } }, /current_user e session_user/],
  ["usuário da sessão", { identityOverrides: { session_role: "other" } }, /current_user e session_user/],
  ["superusuário", { identityOverrides: { rolsuper: true } }, /privilégios administrativos/],
  ["membro de outra role", { identityOverrides: { role_membership: true } }, /vínculo com outras roles/],
  ["tabela ausente", { ready: false }, /Tabelas necessárias/],
  ["migration ausente", { migrations: migrationRows.slice(0, 7) }, /Histórico ou hashes/],
  ["migration divergente", { migrations: migrationRows.map(row => ({ ...row, hash: "other" })) }, /Histórico ou hashes/],
  ["dados preexistentes", { occupied: true }, /dados operacionais preexistentes/],
] as const) {
  test(`ADMIN-07 guarda rejeita ${name} antes do bootstrap`, async () => {
    const { hooks, calls } = harness(options);
    await assert.rejects(hooks.start, reason);
    await hooks.finish();
    assert.deepEqual(calls.slice(-3), ["ROLLBACK", "release", "end"]);
    assert.equal(calls.includes("bootstrap") || calls.includes("cleanup"), false);
  });
}

for (const failAt of ["pool", "connect", "identity", "ROLLBACK", "release", "end"]) {
  test(`ADMIN-07 guarda sanitiza falha em ${failAt} e impede bootstrap e limpeza`, async () => {
    const { hooks, calls } = harness({ failAt });
    await assert.rejects(hooks.start, error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SEGURANÇA BLOQUEADA/);
      assert.equal(String(error).includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    await hooks.finish();
    if (failAt !== "pool") assert.equal(calls.at(-1), "end");
    if (!["pool", "connect"].includes(failAt)) assert.deepEqual(calls.slice(-2), ["release", "end"]);
    assert.equal(calls.includes("bootstrap") || calls.includes("cleanup"), false);
  });
}

for (const enabled of [undefined, "false"]) {
  test(`ADMIN-07 guarda encerra a pré-verificação antes do bootstrap com scheduler ${enabled ?? "omitido"}`, async () => {
    const { hooks, calls } = harness({ envOverrides: { EVENT_CLOSURE_JOB_TEST_ENABLED: enabled } });
    await hooks.start();
    await hooks.finish();
    assert.deepEqual(calls, ["pool", "connect", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "identity", "tables", "migrations", "initial", "ROLLBACK", "release", "end", "bootstrap", "cleanup"]);
  });
}
