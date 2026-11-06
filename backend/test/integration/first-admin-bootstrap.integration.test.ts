import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { Pool, type QueryResult } from "pg";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { FirstAdminBootstrapService } from "../../src/auth/first-admin-bootstrap.service";
import { LoginRateLimiterService } from "../../src/auth/login-rate-limiter.service";
import { RegistrationRateLimiterService } from "../../src/auth/registration-rate-limiter.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { signAccessToken } from "../../src/auth/token.util";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { POSTGRES_POOL } from "../../src/database/database.module";
import { assertFirstAdminBootstrapTestDatabaseUrls } from "./first-admin-bootstrap-db-guard";

const connectionString = assertFirstAdminBootstrapTestDatabaseUrls(process.env);
const applicationName = `b1-bootstrap-${randomUUID()}`;
const pool = new Pool({ connectionString, application_name: applicationName, max: 8 });
const userIds: string[] = [];
const bootstrap = new FirstAdminBootstrapService(pool);
let app: INestApplication;
let baseUrl: string;
let current: { userId: string; email: string; sessionId: string; accessToken: string };

@Module({ controllers: [AuthController], providers: [
  { provide: POSTGRES_POOL, useValue: pool },
  LoginRateLimiterService,
  RegistrationRateLimiterService,
  AuthService,
  { provide: EmailVerificationHttpService, useValue: { request: async () => ({}), confirm: async () => ({ verified: false }) } },
  SessionAuthGuard,
  { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
] })
class FirstAdminAuthIntegrationModule {}

async function account(withSession = false, state: { active?: boolean; verified?: boolean } = {}) {
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
    VALUES($1,'B1 fixture',$2,'test-placeholder',CASE WHEN $3::boolean THEN clock_timestamp() ELSE NULL END,$4::boolean,clock_timestamp(),clock_timestamp())`,
  [userId, email, state.verified ?? true, state.active ?? true]);
  userIds.push(userId);
  await pool.query(`INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at)
    VALUES($1,$2,'participante',NULL,NULL,clock_timestamp())`, [randomUUID(), userId]);
  if (!withSession) return { userId, email };
  const sessionId = randomUUID();
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,revoked_at,revocation_reason,
      admin_2fa_verified_at,ip_address,user_agent,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 day',clock_timestamp(),NULL,NULL,NULL,NULL,NULL,clock_timestamp())`, [sessionId, userId]);
  return { userId, email, sessionId, accessToken: signAccessToken({ userId, sessionId }) };
}

async function waitForBlockedBootstrap(count: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: number }>(`SELECT count(*)::integer AS count FROM pg_stat_activity
      WHERE application_name=$1 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`, [applicationName]);
    if (blocked.rows[0].count >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Não foi observada a espera simultânea pelo lock global de bootstrap.");
}

before(async () => {
  const database = await pool.query<{ name: string }>("SELECT current_database() AS name");
  if (database.rows[0]?.name !== "arenago_bootstrap_test") {
    throw new Error("[SEGURANÇA BLOQUEADA] A integração B1 conectou a um banco diferente do dedicado.");
  }
  const historicalAdmins = await pool.query<{ count: number }>(`SELECT count(*)::integer AS count FROM user_roles
    WHERE role='admin' AND event_id IS NULL`);
  if (historicalAdmins.rows[0]?.count !== 0) {
    throw new Error("[SEGURANÇA BLOQUEADA] O banco dedicado já contém Admin global histórico; use um banco novo, sem apagar registros.");
  }

  app = await NestFactory.create(FirstAdminAuthIntegrationModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

beforeEach(async () => {
  const created = await account(true);

  if (
    typeof created.sessionId !== "string" ||
    typeof created.accessToken !== "string"
  ) {
    throw new Error("Fixture de sessão indisponível.");
  }

  current = {
    userId: created.userId,
    email: created.email,
    sessionId: created.sessionId,
    accessToken: created.accessToken,
  };
});

afterEach(async () => {
  if (!userIds.length) return;
  await pool.query("DELETE FROM audit_logs WHERE target_user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
  userIds.length = 0;
});

after(async () => {
  if (app) await app.close();
  await pool.end();
});

test("T6.1-B1 PostgreSQL concede primeiro Admin atomicamente, preserva sessão e exige TOTP", async () => {
  const before = await pool.query("SELECT id,admin_2fa_verified_at,revoked_at FROM sessions WHERE user_id=$1", [current.userId]);
  const participantAccess = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${current.accessToken}` } });
  assert.equal(participantAccess.status, 200);

  assert.deepEqual(await bootstrap.bootstrap(current.email), { kind: "created" });
  const granted = await pool.query<{ granted_at: string; audit_at: string }>(`SELECT to_char(r.granted_at,'YYYY-MM-DD HH24:MI:SS.USOF') AS granted_at,
      to_char(a.occurred_at,'YYYY-MM-DD HH24:MI:SS.USOF') AS audit_at
    FROM user_roles r JOIN audit_logs a ON a.target_user_id=r.user_id
    WHERE r.user_id=$1 AND r.role='admin' AND r.event_id IS NULL AND r.granted_by IS NULL
      AND a.actor_user_id IS NULL AND a.origin='cli' AND a.category='identity' AND a.action='first_admin_bootstrapped'`, [current.userId]);
  assert.equal(granted.rowCount, 1);
  assert.equal(granted.rows[0].granted_at, granted.rows[0].audit_at);
  assert.equal((await pool.query("SELECT 1 FROM user_totp_credentials WHERE user_id=$1", [current.userId])).rowCount, 0);
  assert.deepEqual((await pool.query("SELECT id,admin_2fa_verified_at,revoked_at FROM sessions WHERE user_id=$1", [current.userId])).rows, before.rows);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM user_roles WHERE user_id=$1", [current.userId])).rows[0].n, 2);

  const adminAccess = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${current.accessToken}` } });
  assert.equal(adminAccess.status, 401);
  assert.equal((await adminAccess.json() as { code: string }).code, "ADMIN_2FA_REQUIRED");
  const exposedBootstrap = await fetch(`${baseUrl}/auth/bootstrap-first-admin`, { method: "POST" });
  assert.equal(exposedBootstrap.status, 404);
  assert.deepEqual(await bootstrap.bootstrap(current.email), { kind: "already_bootstrapped" });
});

test("T6.1-B1 PostgreSQL lock global permite somente um bootstrap concorrente", async () => {
  const second = await account();
  const blocker = await pool.connect();
  let attempts: Promise<Awaited<ReturnType<FirstAdminBootstrapService["bootstrap"]>>>[] = [];
  let completed = false;
  let results: Awaited<ReturnType<FirstAdminBootstrapService["bootstrap"]>>[];
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(1095919439,1)");
    attempts = [bootstrap.bootstrap(current.email), bootstrap.bootstrap(second.email)];
    const joined = Promise.all(attempts);
    void joined.catch(() => undefined);
    await waitForBlockedBootstrap(2);
    await blocker.query("COMMIT");
    completed = true;
    results = await joined;
  } finally {
    if (!completed) await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await Promise.allSettled(attempts);
  }
  assert.deepEqual(results.map(result => result.kind).sort(), ["already_bootstrapped", "created"]);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM user_roles WHERE user_id=ANY($1::uuid[]) AND role='admin' AND event_id IS NULL", [userIds])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM audit_logs WHERE target_user_id=ANY($1::uuid[]) AND action='first_admin_bootstrapped'", [userIds])).rows[0].n, 1);
});

test("T6.1-B1 PostgreSQL recusa conta ausente, inativa ou sem e-mail confirmado", async () => {
  const inactive = await account(false, { active: false });
  const unverified = await account(false, { verified: false });
  assert.deepEqual(await bootstrap.bootstrap(`${randomUUID()}@example.test`), { kind: "account_not_found" });
  assert.deepEqual(await bootstrap.bootstrap(inactive.email), { kind: "account_inactive" });
  assert.deepEqual(await bootstrap.bootstrap(unverified.email), { kind: "email_unverified" });
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM user_roles WHERE user_id=ANY($1::uuid[]) AND role='admin'", [userIds])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM audit_logs WHERE target_user_id=ANY($1::uuid[]) AND action='first_admin_bootstrapped'", [userIds])).rows[0].n, 0);
});

test("T6.1-B1 PostgreSQL rollback remove concessão se a auditoria falhar", async () => {
  const marker = new Error("AUDIT_FAILURE_PRIVATE");
  const wrappedPool = {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<QueryResult>;
      return {
        query: async (text: string, values?: unknown[]) => {
          const result = await query(text, values);
          if (text.startsWith("INSERT INTO audit_logs")) throw marker;
          return result;
        },
        release: () => client.release(),
      };
    },
  } as unknown as Pool;
  await assert.rejects(new FirstAdminBootstrapService(wrappedPool).bootstrap(current.email), error => error === marker);
  assert.equal((await pool.query("SELECT 1 FROM user_roles WHERE user_id=$1 AND role='admin'", [current.userId])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE target_user_id=$1 AND action='first_admin_bootstrapped'", [current.userId])).rowCount, 0);
});
