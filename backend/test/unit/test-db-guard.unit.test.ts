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

  await t.test("Bloqueia portas não autorizadas na autoridade da URL", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:8080/arenago_test",
        ),
      /porta efetiva "8080" não pertence à allowlist/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@127.0.0.1:5433/arenago_test",
        ),
      /porta efetiva "5433" não pertence à allowlist/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:443/arenago_test",
        ),
      /porta efetiva "443" não pertence à allowlist/,
    );
  });

  await t.test("Bloqueia portas não autorizadas ou divergentes via query string", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:5432/arenago_test?port=8080",
        ),
      /Redirecionamento de porta divergente detectado/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:55432/arenago_test?port=5432",
        ),
      /Redirecionamento de porta divergente detectado/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost/arenago_test?port=443",
        ),
      /Redirecionamento de porta divergente detectado/,
    );
  });

  await t.test("Bloqueia redirecionamento divergente de host via query string", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:5432/arenago_test?host=remote.example.com",
        ),
      /Redirecionamento de host divergente detectado/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:5432/arenago_test?host=127.0.0.1",
        ),
      /Redirecionamento de host divergente detectado/,
    );
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@127.0.0.1:5432/arenago_test?h%6fst=db.neon.tech",
        ),
      /Redirecionamento de host divergente detectado/,
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

    const valid4 =
      "postgresql://postgres:postgres@localhost/arenago_test"; // porta padrão 5432 omitida
    assert.equal(assertSafeTestDatabase(valid4), valid4);

    const valid5 =
      "postgresql://postgres:postgres@localhost:5432/arenago_test?port=5432"; // porta idêntica
    assert.equal(assertSafeTestDatabase(valid5), valid5);
  });
});
