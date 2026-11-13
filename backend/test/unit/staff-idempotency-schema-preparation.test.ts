import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { idempotencyOperations, staffIdempotencyEpochs } from "../../src/database/schema";

const dialect = new PgDialect();
const table = getTableConfig(idempotencyOperations);
const epochs = getTableConfig(staffIdempotencyEpochs);
const checkSql = (name: string) => {
  const item = [...table.checks, ...epochs.checks].find((entry) => entry.name === name);
  assert.ok(item, `Check ausente: ${name}`);
  return dialect.sqlToQuery(item.value).sql;
};

test("preparação expõe campos reservados com tipos e defaults conservadores", () => {
  for (const [column, expectedType] of [
    [idempotencyOperations.originSessionId, "uuid"],
    [idempotencyOperations.originEpochId, "uuid"],
    [idempotencyOperations.resultState, "varchar(20)"],
    [idempotencyOperations.completedAt, "timestamp with time zone"],
    [idempotencyOperations.resultRetainUntil, "timestamp with time zone"],
  ] as const) {
    assert.equal(column.getSQLType(), expectedType);
    assert.equal(column.notNull, false);
    assert.equal(column.hasDefault, false);
  }
  assert.equal(idempotencyOperations.originAssurance.getSQLType(), "varchar(20)");
  assert.equal(idempotencyOperations.originAssurance.notNull, true);
  assert.equal(idempotencyOperations.originAssurance.default, "legacy");
  assert.equal(staffIdempotencyEpochs.status.default, "pending");
  assert.equal(staffIdempotencyEpochs.id.getSQLType(), "uuid");
  assert.equal(staffIdempotencyEpochs.controlsVersion.getSQLType(), "varchar(80)");
  assert.equal(staffIdempotencyEpochs.activatedAt.notNull, false);
  assert.equal(staffIdempotencyEpochs.invalidatedAt.notNull, false);
});

test("constraints conservam unicidade e impedem declarar prova, resultado ou marco ativo na etapa A", () => {
  const unique = table.uniqueConstraints.find((item) => item.getName() === "uq_idempotency_actor_operation_key");
  assert.deepEqual(unique?.columns.map((column) => column.name), ["actor_user_id", "operation", "idempotency_key"]);
  assert.ok(table.checks.some((item) => item.name === "ck_idempotency_status"));
  assert.ok(table.checks.some((item) => item.name === "ck_idempotency_http_status"));
  const locked = checkSql("ck_idempotency_staff_preparation_disabled");
  assert.match(locked, /"origin_assurance"\s*=\s*'legacy'/);
  for (const column of ["origin_session_id", "origin_epoch_id", "result_state", "completed_at", "result_retain_until"]) {
    assert.match(locked, new RegExp(`"${column}"\\s+IS NULL`));
  }
  const pending = checkSql("ck_staff_idempotency_epoch_pending");
  assert.match(pending, /"status"\s*=\s*'pending'/);
  assert.match(pending, /"activated_at"\s+IS NULL/);
  assert.match(pending, /"invalidated_at"\s+IS NULL/);
  assert.match(checkSql("ck_staff_idempotency_epoch_version"), /length\(btrim\(/);
});

test("o INSERT Drizzle legado menciona os campos novos e exige expansão prévia do banco", () => {
  const query = drizzle.mock().insert(idempotencyOperations).values({
    id: "abcdef00-0000-4000-8000-000000000001", actorUserId: "abcdef00-0000-4000-8000-000000000002",
    operation: "call_next", idempotencyKey: "fixture", requestHash: "a".repeat(64),
    status: "in_progress", createdAt: new Date("2026-01-01T00:00:00.000Z"), expiresAt: new Date("2026-01-02T00:00:00.000Z"),
  }).toSQL();
  for (const column of ["origin_session_id", "origin_assurance", "origin_epoch_id", "result_state", "completed_at", "result_retain_until"]) {
    assert.match(query.sql, new RegExp(`"${column}"`));
  }
  assert.match(query.sql, /\bdefault\b/i);
});

test("migration preparatória registra somente schema aditivo e não ativa marcos", () => {
  const migration = readFileSync(join(process.cwd(), "drizzle/0007_staff_idempotency_preparation.sql"), "utf8");
  const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const current = journal.entries.find((entry) => entry.tag === "0007_staff_idempotency_preparation");
  const previous = journal.entries.find((entry) => entry.tag === "0006_admin_2fa_login");
  assert.ok(current && previous);
  assert.equal(current.idx, previous.idx + 1);
  assert.ok(current.when > previous.when);
  assert.match(migration, /origin_assurance"\s+varchar\(20\)\s+DEFAULT\s+'legacy'\s+NOT NULL/i);
  assert.equal((migration.match(/ALTER TABLE\s+"public"\."idempotency_operations"/gi) ?? []).length, 2);
  assert.match(migration, /CREATE TABLE\s+"public"\."staff_idempotency_epochs"/i);
  assert.doesNotMatch(migration, /(?:ALTER TABLE|CREATE TABLE)\s+"(?!public"\.)/i);
  assert.match(migration, /CREATE FUNCTION\s+"public"\."staff_idempotency_preparation_guard"/i);
  assert.match(migration, /CHECK\s*\("status"\s*=\s*'pending'/i);
  assert.match(migration, /SECURITY INVOKER\s+SET search_path\s*=\s*pg_catalog/i);
  assert.match(migration, /BEFORE UPDATE ON\s+"public"\."idempotency_operations"/i);
  assert.match(migration, /EXECUTE FUNCTION\s+"public"\."staff_idempotency_preparation_guard"/i);
  for (const column of ["id", "actor_user_id", "operation", "idempotency_key", "request_hash", "http_status", "result_reference", "result_payload"]) {
    assert.match(migration, new RegExp(`(?:OLD|NEW)\\."${column}"\\s+IS DISTINCT FROM\\s+(?:OLD|NEW)\\."${column}"`, "i"));
  }
  assert.match(migration, /OLD\."status"\s*=\s*'completed'/i);
  const executable = migration.replace(/--[^\r\n]*/g, "");
  assert.doesNotMatch(executable, /\b(INSERT|DELETE|TRUNCATE|GRANT|REVOKE|DROP|SECURITY\s+DEFINER)\b/i);
});

test("snapshot contempla o schema anterior da migration 0006 e a preparação da 0007", () => {
  const readSnapshot = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta", name), "utf8")) as {
    id: string; prevId: string; tables: Record<string, { columns: Record<string, { type: string; default?: unknown }>;
      uniqueConstraints: Record<string, { columns: string[] }>; checkConstraints: Record<string, unknown> }>;
  };
  const before = readSnapshot("0004_snapshot.json");
  const after = readSnapshot("0006_snapshot.json");
  assert.equal(after.prevId, before.id);
  assert.notEqual(after.id, before.id);
  assert.equal(after.tables["public.user_totp_credentials"].columns.last_totp_counter.type, "bigint");
  assert.ok(after.tables["public.admin_2fa_challenges"]);
  const operations = after.tables["public.idempotency_operations"];
  assert.deepEqual(operations.uniqueConstraints.uq_idempotency_actor_operation_key.columns,
    ["actor_user_id", "operation", "idempotency_key"]);
  assert.equal(operations.columns.origin_assurance.default, "'legacy'");
  assert.equal(operations.columns.origin_session_id.type, "uuid");
  assert.ok(operations.checkConstraints.ck_idempotency_staff_preparation_disabled);
  assert.equal(after.tables["public.staff_idempotency_epochs"].columns.status.default, "'pending'");
});
