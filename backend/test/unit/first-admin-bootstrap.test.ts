import assert from "node:assert/strict";
import { test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import type { Pool } from "pg";
import supertest from "supertest";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { FirstAdminBootstrapService } from "../../src/auth/first-admin-bootstrap.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { POSTGRES_POOL } from "../../src/database/database.module";

const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-11-05 12:00:00.123456+00";
type Options = { exists?: boolean; missing?: boolean; inactive?: boolean; unverified?: boolean; fail?: string };

function fixture(options: Options = {}) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let released = 0;
  const query = async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    if (options.fail && text.includes(options.fail)) throw new Error("SQL_FAILURE_PRIVATE");
    let rows: unknown[] = [];
    if (text.includes("AS exists")) rows = [{ exists: !!options.exists }];
    else if (text.includes("FROM users WHERE email=")) rows = options.missing ? [] : [{ id, active: !options.inactive, verified: !options.unverified }];
    else if (text.includes("clock_timestamp()::text")) rows = [{ at }];
    else if (text.startsWith("INSERT INTO user_roles")) rows = [{ id: "role-id" }];
    else if (text.startsWith("INSERT INTO audit_logs")) rows = [{ id: "audit-id" }];
    return { rows, rowCount: rows.length };
  };
  const client = { query, release: () => { released++; } };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, service: new FirstAdminBootstrapService(pool), calls, released: () => released };
}

test("T6.1-B1 primeiro Admin e auditoria usam timestamp PostgreSQL na transação serializada", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.bootstrap(" Admin@Example.Test "), { kind: "created" });
  const sql = f.calls.map(call => call.text);
  assert.equal(sql[0], "BEGIN ISOLATION LEVEL READ COMMITTED");
  assert.ok(sql[1].includes("pg_advisory_xact_lock"));
  assert.ok(sql[2].includes("role='admin'") && !sql[2].includes("revoked_at IS NULL"));
  assert.ok(sql[3].includes("FROM users WHERE email=$1 FOR UPDATE"));
  assert.ok(sql[4].includes("clock_timestamp()"));
  const role = f.calls.find(call => call.text.startsWith("INSERT INTO user_roles"))!;
  assert.deepEqual(role.values.slice(1), [id, at]);
  assert.match(role.text, /'admin',NULL,NULL/);
  const audit = f.calls.find(call => call.text.startsWith("INSERT INTO audit_logs"))!;
  assert.deepEqual(audit.values.slice(1), [id, at]);
  assert.match(audit.text, /NULL,\$2::uuid,NULL,'cli','identity','first_admin_bootstrapped'/);
  assert.equal(sql.at(-1), "COMMIT");
  assert.equal(f.released(), 1);
  assert.ok(!sql.some(query => /sessions|totp|UPDATE users/.test(query)));
});

for (const [label, options, kind] of [
  ["conta inexistente", { missing: true }, "account_not_found"],
  ["conta inativa", { inactive: true }, "account_inactive"],
  ["e-mail não verificado", { unverified: true }, "email_unverified"],
] as const) {
  test(`T6.1-B1 recusa ${label} sem conceder papel ou auditar`, async () => {
    const f = fixture(options);
    assert.deepEqual(await f.service.bootstrap("admin@example.test"), { kind });
    assert.ok(!f.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.text)));
    assert.equal(f.calls.at(-1)?.text, "COMMIT");
  });
}

test("T6.1-B1 bootstrap repetido não consulta alvo nem altera papéis históricos", async () => {
  const f = fixture({ exists: true });
  assert.deepEqual(await f.service.bootstrap("admin@example.test"), { kind: "already_bootstrapped" });
  assert.ok(!f.calls.some(call => call.text.includes("FROM users") || /^(INSERT|UPDATE|DELETE)/.test(call.text)));
});

test("T6.1-B1 e-mail inválido não abre conexão", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.bootstrap("not-an-email"), { kind: "invalid_email" });
  assert.equal(f.calls.length, 0);
});

for (const phase of ["INSERT INTO user_roles", "INSERT INTO audit_logs", "COMMIT"]) {
  test(`T6.1-B1 erro em ${phase} reverte a transação e libera a conexão`, async () => {
    const f = fixture({ fail: phase });
    await assert.rejects(f.service.bootstrap("admin@example.test"), /SQL_FAILURE_PRIVATE/);
    assert.equal(f.calls.at(-1)?.text, "ROLLBACK");
    assert.equal(f.released(), 1);
  });
}

test("T6.1-B1 Nest resolve o serviço de bootstrap real pelo token POSTGRES_POOL", async () => {
  const f = fixture();
  @Module({ providers: [{ provide: POSTGRES_POOL, useValue: f.pool }, FirstAdminBootstrapService] })
  class BootstrapDiTestModule {}
  const app = await NestFactory.createApplicationContext(BootstrapDiTestModule, { logger: false });
  try {
    const service = app.get(FirstAdminBootstrapService);
    assert.ok(service instanceof FirstAdminBootstrapService);
    assert.deepEqual(await service.bootstrap("admin@example.test"), { kind: "created" });
  }
  finally { await app.close(); }
});

test("T6.1-B1 bootstrap não é exposto por rota HTTP", async () => {
  @Module({ controllers: [AuthController], providers: [
    { provide: AuthService, useValue: { authenticateBearerToken: async () => ({ userId: id }) } },
    { provide: EmailVerificationHttpService, useValue: { request: async () => ({}), confirm: async () => ({ verified: false }) } },
    SessionAuthGuard,
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
  ] })
  class AuthHttpTestModule {}
  const app: INestApplication = await NestFactory.create(AuthHttpTestModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  try {
    const response = await supertest(app.getHttpServer()).post("/api/v1/auth/bootstrap-first-admin").send({ email: "admin@example.test" });
    assert.equal(response.status, 404);
  } finally { await app.close(); }
});
