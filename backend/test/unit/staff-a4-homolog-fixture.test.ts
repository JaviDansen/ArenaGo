import assert from "node:assert/strict";
import { test } from "node:test";

const fixture = require("../../scripts/prepare-staff-a4-homologation.cjs");

test("fixture A4 limita as contas e mantém Admin separado do Staff", async () => {
  assert.deepEqual(fixture.ACCOUNTS.map((account: { email: string }) => account.email), [
    "staff-homolog-admin@arenago.invalid", "staff-homolog-staff@arenago.invalid",
  ]);
  const state = { adminSecret: undefined as string | undefined, nonAdminSecrets: new Set<string>() };
  const hash = async (_secret: string, options: { memoryCost: number; timeCost: number; parallelism: number }) => {
    assert.equal(options.memoryCost, 19456);
    assert.equal(options.timeCost, 2);
    assert.equal(options.parallelism, 1);
    return "simulated-hash";
  };
  const readAdmin = async () => "Teste!Seguro39#Roxo";
  assert.equal(await fixture.prepareAccountHash(fixture.ACCOUNTS[0], state, true, readAdmin, hash), "simulated-hash");
  await assert.rejects(fixture.prepareAccountHash(fixture.ACCOUNTS[1], state, false, readAdmin, hash));
});

test("fixture exige test, --execute, terminal e ausência de redirecionadores", () => {
  assert.doesNotThrow(() => fixture.validateLaunch({ NODE_ENV: "test" }, ["--execute"], true, true));
  for (const args of [
    [{ NODE_ENV: "development" }, ["--execute"], true, true],
    [{ NODE_ENV: "test" }, [], true, true],
    [{ NODE_ENV: "test" }, ["--execute"], false, true],
    [{ NODE_ENV: "test", PGHOST: "remote" }, ["--execute"], true, true],
    [{ NODE_ENV: "test", DATABASE_DIRECT_URL: "present" }, ["--execute"], true, true],
    [{ NODE_ENV: "test", NODE_OPTIONS: "present" }, ["--execute"], true, true],
  ]) assert.throws(() => fixture.validateLaunch(...args));
  assert.equal(fixture.DATABASE, "arenago_staff_a4_20261112");
  assert.equal(fixture.ROLE, "arenago_staff_a4");
  assert.doesNotThrow(() => fixture.validateRole(fixture.ROLE));
  assert.doesNotThrow(() => fixture.validateConfirmation("AUTORIZO CONTAS SINTETICAS"));
  for (const value of ["", "AUTORIZO", "autorizo contas sinteticas"]) {
    assert.throws(() => fixture.validateConfirmation(value));
  }
  for (const other of ["arenago_staff_homolog", "postgres", "", "arenago_staff_a4 "]) {
    assert.throws(() => fixture.validateRole(other));
  }
});

test("verificação de destino e migrations usa somente consultas e falha fechada", async () => {
  const migrations = fixture.expectedMigrations();
  assert.equal(migrations.length, 8);
  assert.equal(fixture.EXPECTED_TAGS[7], "0008_external_entry_calls");
  assert.ok(migrations.every((entry: { hash: string; when: string }) => /^[0-9a-f]{64}$/.test(entry.hash) && /^\d+$/.test(entry.when)));
  const identity = { db: fixture.DATABASE, host: "127.0.0.1", port: 55432, recovery: false,
    db_role: fixture.ROLE, session_role: fixture.ROLE };
  const role = { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
    rolbypassrls: false, rolinherit: false, rolcanlogin: true };
  const applied = migrations.map((entry: { hash: string; when: string }) => ({ hash: entry.hash, at: entry.when }));
  const controls = { tables_ok: true, check_ok: true, trigger_ok: true, external_calls_check_ok: true,
    external_calls_trigger_ok: true, questionnaire_ok: true, games_ok: true };
  const calls: string[] = [];
  const client = { async query(sql: string) {
    calls.push(sql);
    if (sql.includes("current_database")) return { rows: [identity] };
    if (sql.includes("pg_catalog.pg_roles")) return { rows: [role] };
    if (sql.includes("__drizzle_migrations")) return { rows: applied };
    return { rows: [controls] };
  } };
  await fixture.verifyDatabase(client, migrations);
  assert.ok(calls.every(sql => /^\s*SELECT\b/i.test(sql)));
  assert.ok(calls.some(sql => sql.includes("public.external_entry_calls")));
  identity.db = "arenago_events_test";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  identity.db = fixture.DATABASE;
  identity.host = "127.0.0.2";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  identity.host = "127.0.0.1";
  identity.port = 5432;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  identity.port = 55432;
  identity.db_role = "postgres";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  identity.db_role = fixture.ROLE;
  role.rolsuper = true;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  role.rolsuper = false;
  applied[0].hash = "divergente";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  applied[0].hash = migrations[0].hash;
  applied[7].at = "0";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  applied[7].at = migrations[7].when;
  applied.pop();
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  applied.push({ hash: migrations[7].hash, at: migrations[7].when });
  controls.trigger_ok = false;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  controls.trigger_ok = true;
  controls.external_calls_check_ok = false;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  controls.external_calls_check_ok = true;
  controls.external_calls_trigger_ok = false;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  controls.external_calls_trigger_ok = true;
  controls.games_ok = false;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  controls.games_ok = true;
  controls.questionnaire_ok = false;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
});

test("fixture exige banco vazio e não executa escrita na verificação", async () => {
  const result = { empty: true };
  const calls: string[] = [];
  const client = { async query(sql: string) { calls.push(sql); return { rows: [result] }; } };
  await fixture.verifyEmptyDatabase(client);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /public\.external_entry_calls/);
  assert.match(calls[0], /^\s*SELECT\b/i);
  result.empty = false;
  await assert.rejects(fixture.verifyEmptyDatabase(client));
});
