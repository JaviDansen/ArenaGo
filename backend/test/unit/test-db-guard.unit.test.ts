
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
    const urls = [
      "postgresql://user:pass@db.supabase.co/arenago_test",
      "postgresql://user:pass@192.168.1.100/arenago_test",
      "postgresql://user:pass@postgres/arenago_test",
      "postgresql://user:pass@arenago-local-pg/arenago_test",
    ];

    for (const url of urls) {
      assert.throws(
        () => assertSafeTestDatabase(url),
        /SEGURANÇA BLOQUEADA/,
      );
    }
  });

  await t.test("Bloqueia bancos de produção e desenvolvimento", () => {
    const databases = [
      "arenago_prod",
      "arenago_development",
      "arenago_dev",
      "arenago_homologacao",
    ];

    for (const database of databases) {
      assert.throws(
        () =>
          assertSafeTestDatabase(
            `postgresql://postgres:postgres@127.0.0.1:55432/${database}`,
          ),
        /SEGURANÇA BLOQUEADA/,
      );
    }
  });

  await t.test("Bloqueia portas não autorizadas na autoridade da URL", () => {
    const ports = ["8080", "5433", "443"];

    for (const port of ports) {
      assert.throws(
        () =>
          assertSafeTestDatabase(
            `postgresql://postgres:postgres@localhost:${port}/arenago_test`,
          ),
        new RegExp(
          `porta efetiva "${port}" não pertence à allowlist`,
        ),
      );
    }
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

  await t.test("Bloqueia parâmetros duplicados de host e porta", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:5432/arenago_test?host=localhost&host=localhost",
        ),
      /Parâmetro host duplicado/,
    );

    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://postgres:postgres@localhost:5432/arenago_test?port=5432&port=5432",
        ),
      /Parâmetro port duplicado/,
    );
  });

  await t.test("Bloqueia redirecionamento do banco por parâmetros da URL", () => {
    const queries = [
      "?database=production",
      "?database=arenago_homologacao",
      "?dbname=arenago_homologacao",
      "?data%62ase=arenago_homologacao",
      "?DATABASE=arenago_homologacao",
    ];

    for (const query of queries) {
      assert.throws(
        () =>
          assertSafeTestDatabase(
            `postgresql://arenago:senha@127.0.0.1:55432/arenago_events_test${query}`,
          ),
        /Redirecionamento de banco pela URL não permitido/,
      );
    }
  });

  await t.test("Aprova URLs locais de bancos de teste descartáveis autorizados", () => {
    const valid1 =
      "postgresql://postgres:postgres@localhost:55432/arenago_k03_test";
    assert.equal(assertSafeTestDatabase(valid1), valid1);

    const valid2 =
      "postgresql://postgres:postgres@127.0.0.1:5432/arenago_test";
    assert.equal(assertSafeTestDatabase(valid2), valid2);

    const valid3 =
      "postgresql://postgres:postgres@localhost/arenago_test";
    assert.equal(assertSafeTestDatabase(valid3), valid3);

    const valid4 =
      "postgresql://postgres:postgres@localhost:5432/arenago_test?port=5432";
    assert.equal(assertSafeTestDatabase(valid4), valid4);
  });

  await t.test("Permite arenago_events_test na porta 55432", () => {
    const url =
      "postgresql://arenago:senha@127.0.0.1:55432/arenago_events_test";

    assert.equal(assertSafeTestDatabase(url), url);
  });

  await t.test("Bloqueia arenago_events_test na porta 5432", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://arenago:senha@localhost:5432/arenago_events_test",
        ),
      /arenago_events_test exige a porta 55432/,
    );
  });

  await t.test("Bloqueia arenago_events_test em host remoto", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          "postgresql://arenago:senha@192.168.1.100:55432/arenago_events_test",
        ),
      /SEGURANÇA BLOQUEADA/,
    );
  });
});
