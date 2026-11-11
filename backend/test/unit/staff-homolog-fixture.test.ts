import assert from "node:assert/strict";
import { test } from "node:test";

const fixture = require("../../scripts/prepare-staff-homologation.cjs");

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
  assert.equal(fixture.DATABASE, "arenago_staff_homolog_20261111");
});

test("verificação de destino e migrations usa somente consultas e falha fechada", async () => {
  const migrations = fixture.expectedMigrations();
  assert.equal(migrations.length, 7);
  const identity = { db: fixture.DATABASE, host: "127.0.0.1", port: 55432, recovery: false };
  const applied = migrations.map((entry: { hash: string; when: string }) => ({ hash: entry.hash, at: entry.when }));
  const controls = { tables_ok: true, check_ok: true, trigger_ok: true, questionnaire_ok: true, games_ok: true };
  const calls: string[] = [];
  const client = { async query(sql: string) {
    calls.push(sql);
    if (sql.includes("current_database")) return { rows: [identity] };
    if (sql.includes("__drizzle_migrations")) return { rows: applied };
    return { rows: [controls] };
  } };
  await fixture.verifyDatabase(client, migrations);
  assert.ok(calls.every(sql => /^\s*SELECT\b/i.test(sql)));
  identity.db = "arenago_events_test";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  identity.db = fixture.DATABASE;
  applied[0].hash = "divergente";
  await assert.rejects(fixture.verifyDatabase(client, migrations));
  applied[0].hash = migrations[0].hash;
  controls.trigger_ok = false;
  await assert.rejects(fixture.verifyDatabase(client, migrations));
});
