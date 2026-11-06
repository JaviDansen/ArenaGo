import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFirstAdminBootstrapTestDatabaseUrls } from "../integration/first-admin-bootstrap-db-guard";

const url = "postgresql://fixture:placeholder@127.0.0.1:55432/arenago_bootstrap_test";
const valid = {
  NODE_ENV: "test",
  DATABASE_URL: url,
  DATABASE_DIRECT_URL: url,
  EVENTS_TEST_DATABASE_URL: url,
};

test("T6.1-B1 aceita apenas as três URLs idênticas do banco dedicado", () => {
  assert.equal(assertFirstAdminBootstrapTestDatabaseUrls(valid), url);
});

for (const [label, changes] of [
  ["ambiente diferente", { NODE_ENV: "development" }],
  ["URL ausente", { DATABASE_DIRECT_URL: undefined }],
  ["URL divergente", { EVENTS_TEST_DATABASE_URL: url.replace("fixture", "other") }],
  ["banco compartilhado", { DATABASE_URL: url.replace("arenago_bootstrap_test", "arenago_events_test") }],
  ["host alternativo", { DATABASE_URL: url.replace("127.0.0.1", "localhost") }],
  ["porta alternativa", { DATABASE_URL: url.replace("55432", "5432") }],
  ["usuário ausente", { DATABASE_URL: "postgresql://:placeholder@127.0.0.1:55432/arenago_bootstrap_test" }],
  ["senha ausente", { DATABASE_URL: "postgresql://fixture@127.0.0.1:55432/arenago_bootstrap_test" }],
  ["query de redirecionamento", { DATABASE_URL: `${url}?host=outro` }],
  ["query vazia", { DATABASE_URL: `${url}?` }],
  ["fragmento", { DATABASE_URL: `${url}#fragmento` }],
  ["protocolo alternativo", { DATABASE_URL: url.replace("postgresql:", "https:") }],
] as const) {
  test(`T6.1-B1 guarda rejeita ${label}`, () => {
    assert.throws(() => assertFirstAdminBootstrapTestDatabaseUrls({ ...valid, ...changes }), /SEGURANÇA BLOQUEADA/);
  });
}
