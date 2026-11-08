import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAdminRoleManagementTestDatabaseUrls } from "../integration/admin-role-management-db-guard";

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
