import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeTestDatabase } from "../integration/test-db-guard";

test("Segurança de banco de dados para testes de integração", async (t) => {
  await t.test("Rejeita DATABASE_URL indefinido ou vazio", () => {
    assert.throws(
      () => assertSafeTestDatabase(undefined),
      /DATABASE_URL local descartável é obrigatório/,
    );
    assert.throws(
      () => assertSafeTestDatabase(""),
      /DATABASE_URL local descartável é obrigatório/,
    );
  });

  await t.test("Bloqueia categoricamente URLs remotas da Neon", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://user:pass@ep-cool-fog-12345.us-east-2.aws.neon.tech/arenago_test?sslmode=require",
        ),
      /SEGURANÇA BLOQUEADA.*host compartilhado/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://user:pass@main.neon.tech/arenago_test",
        ),
      /SEGURANÇA BLOQUEADA.*host compartilhado/,
    );
  });

  await t.test("Bloqueia hosts remotos ou compartilhados não locais", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://user:pass@db.supabase.co/arenago_test",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://user:pass@192.168.1.100/arenago_test",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://user:pass@postgres/arenago_test",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://user:pass@arenago-local-pg/arenago_test",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
  });

  await t.test("Bloqueia banco de dados local que não contém 'test' no nome", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:55432/arenago_prod",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@127.0.0.1:55432/arenago_development",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
  });

  await t.test("Aprova URLs locais de bancos de teste descartáveis autorizados", () => {
    const valid1 =
      "postgresql://postgres:postgres@localhost:55432/arenago_k03_test";
    assert.equal(assertSafeTestDatabase(valid1), valid1);

    const valid2 =
      "postgresql://postgres:postgres@127.0.0.1:5432/arenago_test";
    assert.equal(assertSafeTestDatabase(valid2), valid2);

    const valid3 =
      "postgresql://postgres:postgres@localhost:5432/arenago_test?database=production";
    assert.equal(assertSafeTestDatabase(valid3), valid3);
  });
});
