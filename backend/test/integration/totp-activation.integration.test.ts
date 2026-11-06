import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import * as argon2 from "argon2";
import { Pool, type QueryResult } from "pg";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { FirstAdminBootstrapService } from "../../src/auth/first-admin-bootstrap.service";
import { LoginRateLimiterService } from "../../src/auth/login-rate-limiter.service";
import { RegistrationRateLimiterService } from "../../src/auth/registration-rate-limiter.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { signAccessToken, signTempTwoFactorToken } from "../../src/auth/token.util";
import { TotpActivationController } from "../../src/auth/totp-activation.controller";
import { TotpActivationService } from "../../src/auth/totp-activation.service";
import { hashActivationToken, readTotpKeys, recoveryCodeHash, totpCode } from "../../src/auth/totp-activation.crypto";
import { POSTGRES_POOL } from "../../src/database/database.module";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { assertFirstAdminBootstrapTestDatabaseUrls } from "./first-admin-bootstrap-db-guard";

// Mesma guarda exclusiva da B1, antes de criar qualquer pool. Sem seeds ou limpeza global.
const connectionString = assertFirstAdminBootstrapTestDatabaseUrls(process.env);
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
process.env.TOTP_RECOVERY_HMAC_KEY = Buffer.alloc(32, 22).toString("base64");
const keys = readTotpKeys(process.env);
const applicationName = `b2-${randomUUID()}`;
const pool = new Pool({ connectionString, application_name: applicationName, max: 12 });
const bootstrap = new FirstAdminBootstrapService(pool);
const activation = new TotpActivationService(pool);
const userIds: string[] = [];
let app: INestApplication;
let baseUrl: string;
let passwordHash: string;
const password = "B2-fixture-only-passphrase";
let current: { id: string; email: string; tempToken: string };

@Module({ controllers: [AuthController, TotpActivationController], providers: [
  { provide: POSTGRES_POOL, useValue: pool }, { provide: TotpActivationService, useValue: activation },
  AuthService, LoginRateLimiterService, RegistrationRateLimiterService, SessionAuthGuard,
  { provide: EmailVerificationHttpService, useValue: { request: async () => ({}), confirm: async () => ({ verified: false }) } },
  { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
] })
class TotpIntegrationModule {}

async function account() {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
    VALUES($1,'B2 fixture',$2,$3,clock_timestamp(),true,clock_timestamp(),clock_timestamp())`, [id, email, passwordHash]);
  userIds.push(id);
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'participante',NULL,clock_timestamp())", [randomUUID(), id]);
  return { id, email };
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: await response.json() as Record<string, unknown> };
}

async function prepare() {
  const authorization = await activation.issue(current.email);
  const input = { tempToken: current.tempToken, activationToken: authorization.activationToken };
  const response = await post("/auth/2fa/setup", input);
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.secret, "string");
  return { input, secret: response.body.secret as string, authorization };
}

async function codeNow(secret: string) {
  const result = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  return totpCode(secret, new Date(result.rows[0].now).getTime());
}

async function pendingState() {
  const credential = await pool.query("SELECT is_verified,verified_at FROM user_totp_credentials WHERE user_id=$1", [current.id]);
  const tokens = await pool.query("SELECT used_at FROM totp_activation_tokens WHERE user_id=$1 AND revoked_at IS NULL", [current.id]);
  assert.deepEqual(credential.rows, [{ is_verified: false, verified_at: null }]);
  assert.deepEqual(tokens.rows, [{ used_at: null }]);
  assert.equal((await pool.query("SELECT 1 FROM user_backup_codes WHERE user_id=$1", [current.id])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE target_user_id=$1 AND action='totp_initial_activated'", [current.id])).rowCount, 0);
}

before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "arenago_bootstrap_test");
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM user_roles WHERE role='admin' AND event_id IS NULL")).rows[0].n, 0,
    "Banco dedicado contém Admin histórico; não apagar registros. Preparar banco exclusivo vazio manualmente.");
  passwordHash = await argon2.hash(password);
  app = await NestFactory.create(TotpIntegrationModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
});

beforeEach(async () => {
  const user = await account();
  assert.deepEqual(await bootstrap.bootstrap(user.email), { kind: "created" });
  const login = await post("/auth/login", { email: user.email, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.requires2FA, true);
  assert.equal(login.body.isTotpConfigured, false);
  assert.equal(typeof login.body.tempToken, "string");
  current = { ...user, tempToken: login.body.tempToken as string };
});

afterEach(async () => {
  if (!userIds.length) return;
  await pool.query("DELETE FROM user_backup_codes WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM totp_activation_tokens WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM user_totp_credentials WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM audit_logs WHERE target_user_id=ANY($1::uuid[]) OR actor_user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id=ANY($1::uuid[]))", [userIds]);
  await pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [userIds]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
  userIds.length = 0;
});
after(async () => { if (app) await app.close(); await pool.end(); });

test("B2 PostgreSQL fluxo HTTP real ativa uma vez, cifra segredo e conserva ausência de sessão", async () => {
  const { input, secret, authorization } = await prepare();
  const token = (await pool.query("SELECT token_hash,issued_by,extract(epoch FROM(expires_at-created_at)) AS ttl FROM totp_activation_tokens WHERE user_id=$1", [current.id])).rows[0];
  assert.equal(token.token_hash, hashActivationToken(input.activationToken));
  assert.equal(token.issued_by, null);
  assert.ok(Math.abs(Number(token.ttl) - 1800) < 1);
  assert.ok(Date.parse(authorization.expiresAt) > Date.now());
  const encrypted = (await pool.query("SELECT secret_encrypted FROM user_totp_credentials WHERE user_id=$1", [current.id])).rows[0].secret_encrypted as string;
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes(secret), false);
  await pendingState();
  const response = await post("/auth/2fa/confirm", { ...input, code: await codeNow(secret) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(response.body).sort(), ["activated", "recoveryCodes"]);
  const codes = response.body.recoveryCodes as string[];
  assert.equal(codes.length, 10);
  const stored = await pool.query("SELECT code_hash,used_at FROM user_backup_codes WHERE user_id=$1", [current.id]);
  assert.deepEqual(stored.rows.map(row => row.code_hash).sort(), codes.map(code => recoveryCodeHash(code, current.id, keys.recovery)).sort());
  assert.ok(stored.rows.every(row => row.used_at === null));
  assert.equal((await pool.query("SELECT is_verified FROM user_totp_credentials WHERE user_id=$1", [current.id])).rows[0].is_verified, true);
  assert.equal((await pool.query("SELECT 1 FROM totp_activation_tokens WHERE user_id=$1 AND used_at IS NOT NULL", [current.id])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1", [current.id])).rowCount, 0);
  const audit = JSON.stringify((await pool.query("SELECT * FROM audit_logs WHERE target_user_id=$1", [current.id])).rows);
  for (const sensitive of [secret, input.activationToken, input.tempToken, ...codes]) assert.equal(audit.includes(sensitive), false);
  const login = await post("/auth/login", { email: current.email, password });
  assert.equal(login.body.isTotpConfigured, true);
  assert.equal(login.body.requires2FA, true);
  assert.equal("accessToken" in login.body, false);
  assert.equal("refreshToken" in login.body, false);
  const me = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${current.tempToken}` } });
  assert.equal(me.status, 401);
  assert.equal((await post("/auth/2fa/confirm", { ...input, code: await codeNow(secret) })).status, 409);
  assert.equal((await post("/auth/2fa/setup", input)).status, 409);
  await assert.rejects(activation.issue(current.email), error => error instanceof ProblemException && error.problem.code === "TOTP_ALREADY_ACTIVATED");
  assert.equal((await pool.query("SELECT 1 FROM user_backup_codes WHERE user_id=$1", [current.id])).rowCount, 10);
});

test("B2 PostgreSQL setup repetido mantém segredo e nova emissão invalida a pendência anterior", async () => {
  const first = await prepare();
  assert.equal((await post("/auth/2fa/setup", first.input)).body.secret, first.secret);
  const second = await activation.issue(current.email);
  assert.equal((await post("/auth/2fa/setup", first.input)).status, 403);
  assert.equal((await pool.query("SELECT 1 FROM user_totp_credentials WHERE user_id=$1", [current.id])).rowCount, 0);
  const setup = await post("/auth/2fa/setup", { ...first.input, activationToken: second.activationToken });
  assert.equal(setup.status, 200);
  assert.notEqual(setup.body.secret, first.secret);
  assert.equal((await pool.query("SELECT 1 FROM totp_activation_tokens WHERE user_id=$1 AND revoked_at IS NOT NULL", [current.id])).rowCount, 1);
});

test("B2 PostgreSQL ativação não promove nem modifica sessão preexistente", async () => {
  const f = await prepare();
  const sessionId = randomUUID();
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,admin_2fa_verified_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 day',clock_timestamp(),NULL,clock_timestamp())`, [sessionId, current.id]);
  const snapshot = await pool.query("SELECT * FROM sessions WHERE id=$1", [sessionId]);
  assert.equal((await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) })).status, 200);
  assert.deepEqual((await pool.query("SELECT * FROM sessions WHERE id=$1", [sessionId])).rows, snapshot.rows);
  assert.equal((await pool.query("SELECT 1 FROM refresh_tokens WHERE session_id=$1", [sessionId])).rowCount, 0);
  const access = signAccessToken({ userId: current.id, sessionId });
  const me = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
  assert.equal(me.status, 401);
  assert.equal((await me.json() as { code: string }).code, "ADMIN_2FA_REQUIRED");
});

for (const state of ["expired", "revoked", "consumed", "other-user"] as const) {
  test(`B2 PostgreSQL autorização ${state} é rejeitada sem ativação`, async () => {
    const f = await prepare();
    if (state === "other-user") {
      const other = await account();
      await pool.query("UPDATE totp_activation_tokens SET user_id=$1 WHERE token_hash=$2", [other.id, hashActivationToken(f.input.activationToken)]);
    } else {
      const changes = { expired: "expires_at=clock_timestamp()-interval '1 second'", revoked: "revoked_at=clock_timestamp()", consumed: "used_at=clock_timestamp()" };
      await pool.query(`UPDATE totp_activation_tokens SET ${changes[state]} WHERE user_id=$1`, [current.id]);
    }
    const response = await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "TOTP_AUTHORIZATION_INVALID");
    assert.equal((await pool.query("SELECT is_verified FROM user_totp_credentials WHERE user_id=$1", [current.id])).rows[0].is_verified, false);
    assert.equal((await pool.query("SELECT 1 FROM user_backup_codes WHERE user_id=$1", [current.id])).rowCount, 0);
  });
}

for (const state of ["expired", "forged", "access"] as const) {
  test(`B2 PostgreSQL desafio ${state} não configura credencial`, async () => {
    const authorization = await activation.issue(current.email);
    const token = state === "expired" ? signTempTwoFactorToken(current.id, { nowMs: Date.now() - 301_000 })
      : state === "access" ? signAccessToken({ userId: current.id, sessionId: randomUUID() })
        : signTempTwoFactorToken(current.id, { secret: "wrong-secret-for-test-only-at-least-32-chars" });
    const response = await post("/auth/2fa/setup", { tempToken: token, activationToken: authorization.activationToken });
    assert.equal(response.status, 401);
    assert.equal((await pool.query("SELECT 1 FROM user_totp_credentials WHERE user_id=$1", [current.id])).rowCount, 0);
  });
}

for (const state of ["inactive", "unverified", "revoked-role"] as const) {
  test(`B2 PostgreSQL estado ${state} é revalidado depois do setup`, async () => {
    const f = await prepare();
    if (state === "revoked-role") await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='admin'", [current.id]);
    else await pool.query(`UPDATE users SET ${state === "inactive" ? "is_active=false" : "email_verified_at=NULL"} WHERE id=$1`, [current.id]);
    const response = await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) });
    assert.equal(response.status, 403);
    await pendingState();
    await assert.rejects(activation.issue(current.email), error => error instanceof ProblemException && error.problem.code === "TOTP_ACTIVATION_FORBIDDEN");
  });
}

test("B2 PostgreSQL Admin sem proveniência B1 não recebe autorização", async () => {
  const other = await account();
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at) VALUES($1,$2,'admin',NULL,NULL,clock_timestamp())", [randomUUID(), other.id]);
  await assert.rejects(activation.issue(other.email), error => error instanceof ProblemException && error.problem.code === "TOTP_ACTIVATION_FORBIDDEN");
  assert.equal((await pool.query("SELECT 1 FROM totp_activation_tokens WHERE user_id=$1", [other.id])).rowCount, 0);
});

test("B2 PostgreSQL cinco erros inclusive malformados limitam tentativas e reemissão não zera contador", async () => {
  const f = await prepare();
  const clock = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
  const nearby = new Set([-60_000, -30_000, 0, 30_000, 60_000].map(offset => totpCode(f.secret, new Date(clock).getTime() + offset)));
  const wrong = Array.from({ length: 6 }, (_, i) => i.toString().padStart(6, "0")).find(code => !nearby.has(code));
  assert.ok(wrong);
  assert.equal((await post("/auth/2fa/confirm", { ...f.input, code: wrong })).status, 400);
  for (let i = 0; i < 4; i++) assert.equal((await post("/auth/2fa/confirm", { ...f.input, code: "invalid" })).status, 400);
  assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE target_user_id=$1 AND action='totp_initial_code_rejected'", [current.id])).rowCount, 5);
  const limited = await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "900");
  await pendingState();
  const again = await prepare();
  const restarted = new TotpActivationService(pool);
  await assert.rejects(restarted.confirm({ ...again.input, code: await codeNow(again.secret) }), error => error instanceof ProblemException && error.problem.code === "TOTP_ACTIVATION_RATE_LIMITED");
});

test("B2 PostgreSQL limite de setup impede rotações/revelações ilimitadas", async () => {
  const f = await prepare();
  for (let i = 0; i < 4; i++) assert.equal((await post("/auth/2fa/setup", f.input)).status, 200);
  assert.equal((await post("/auth/2fa/setup", f.input)).status, 429);
  assert.equal((await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) })).status, 200);
});

test("B2 PostgreSQL confirmação sem setup não consome autorização", async () => {
  const authorization = await activation.issue(current.email);
  const response = await post("/auth/2fa/confirm", { tempToken: current.tempToken, activationToken: authorization.activationToken, code: "123456" });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TOTP_SETUP_REQUIRED");
  assert.equal((await pool.query("SELECT used_at FROM totp_activation_tokens WHERE user_id=$1", [current.id])).rows[0].used_at, null);
});

async function waitForLocks(count: number) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0", [applicationName]);
    if (blocked.rows[0].n >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Concorrência real não observada.");
}

test("B2 PostgreSQL confirmações simultâneas publicam somente um conjunto de códigos", async () => {
  const f = await prepare();
  const blocker = await pool.connect();
  let attempts: Array<Promise<Awaited<ReturnType<TotpActivationService["confirm"]>>>> = [];
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [current.id]);
    const input = { ...f.input, code: await codeNow(f.secret) };
    attempts = [activation.confirm(input), activation.confirm(input)];
    const all = Promise.allSettled(attempts);
    await waitForLocks(2);
    await blocker.query("COMMIT");
    const results = await all;
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ProblemException && rejected.reason.problem.code === "TOTP_ALREADY_ACTIVATED");
    assert.equal((await pool.query("SELECT 1 FROM user_backup_codes WHERE user_id=$1", [current.id])).rowCount, 10);
    assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE target_user_id=$1 AND action='totp_initial_activated'", [current.id])).rowCount, 1);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await Promise.allSettled(attempts);
  }
});

test("B2 PostgreSQL emissões concorrentes deixam uma única autorização vigente", async () => {
  const issued = await Promise.all([activation.issue(current.email), activation.issue(current.email)]);
  assert.notEqual(issued[0].activationToken, issued[1].activationToken);
  const rows = await pool.query("SELECT token_hash,revoked_at FROM totp_activation_tokens WHERE user_id=$1", [current.id]);
  assert.equal(rows.rowCount, 2);
  assert.equal(rows.rows.filter(row => row.revoked_at === null).length, 1);
});

test("B2 PostgreSQL desafio que expira aguardando conta não confirma", async () => {
  const f = await prepare();
  const blocker = await pool.connect();
  let attempt: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [current.id]);
    const tempToken = signTempTwoFactorToken(current.id, { ttlSeconds: 3 });
    attempt = activation.confirm({ ...f.input, tempToken, code: await codeNow(f.secret) });
    const result = Promise.allSettled([attempt]);
    await waitForLocks(1);
    await blocker.query("SELECT pg_sleep(3.1)");
    await blocker.query("COMMIT");
    const [outcome] = await result;
    assert.ok(outcome.status === "rejected" && outcome.reason instanceof ProblemException && outcome.reason.problem.code === "TOTP_CHALLENGE_INVALID");
    await pendingState();
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    if (attempt) await Promise.allSettled([attempt]);
  }
});

test("B2 PostgreSQL autorização expirada após escritas reais provoca rollback antes do COMMIT", async () => {
  const f = await prepare();
  await pool.query("UPDATE totp_activation_tokens SET expires_at=clock_timestamp()+interval '3 seconds' WHERE user_id=$1", [current.id]);
  let reachedAudit = false;
  const wrapped = { connect: async () => {
    const client = await pool.connect();
    const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<QueryResult>;
    return { release: () => client.release(), query: async (text: string, values?: unknown[]) => {
      const result = await query(text, values);
      if (text.startsWith("INSERT INTO audit_logs")) { reachedAudit = true; await query("SELECT pg_sleep(3.1)"); }
      return result;
    } };
  } } as unknown as Pool;
  await assert.rejects(new TotpActivationService(wrapped).confirm({ ...f.input, code: await codeNow(f.secret) }),
    error => error instanceof ProblemException && error.problem.code === "TOTP_AUTHORIZATION_INVALID");
  assert.equal(reachedAudit, true);
  await pendingState();
});

test("B2 PostgreSQL falha de auditoria da reemissão conserva autorização e segredo anteriores", async () => {
  const f = await prepare();
  let injected = false;
  const wrapped = { connect: async () => {
    const client = await pool.connect();
    const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<QueryResult>;
    return { release: () => client.release(), query: async (text: string, values?: unknown[]) => {
      const result = await query(text, values);
      if (text.startsWith("INSERT INTO audit_logs")) { injected = true; throw new Error("ISSUE_AUDIT_PRIVATE"); }
      return result;
    } };
  } } as unknown as Pool;
  await assert.rejects(new TotpActivationService(wrapped).issue(current.email), error => error instanceof ProblemException && error.getStatus() === 500);
  assert.equal(injected, true);
  assert.equal((await post("/auth/2fa/setup", f.input)).body.secret, f.secret);
  assert.equal((await pool.query("SELECT 1 FROM totp_activation_tokens WHERE user_id=$1", [current.id])).rowCount, 1);
});

for (const mutation of ["expiry", "role", "account"] as const) {
  test(`B2 PostgreSQL revalida ${mutation} após espera em lock`, async () => {
    const f = await prepare();
    const blocker = await pool.connect();
    let attempt: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [current.id]);
      attempt = activation.confirm({ ...f.input, code: await codeNow(f.secret) });
      const result = Promise.allSettled([attempt]);
      await waitForLocks(1);
      if (mutation === "expiry") await blocker.query("UPDATE totp_activation_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [current.id]);
      else if (mutation === "role") await blocker.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='admin'", [current.id]);
      else await blocker.query("UPDATE users SET is_active=false WHERE id=$1", [current.id]);
      await blocker.query("COMMIT");
      const [outcome] = await result;
      assert.equal(outcome.status, "rejected");
      if (outcome.status === "rejected") assert.ok(outcome.reason instanceof ProblemException && outcome.reason.getStatus() === 403);
      await pendingState();
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      if (attempt) await Promise.allSettled([attempt]);
    }
  });
}

for (const phase of ["UPDATE user_totp_credentials", "UPDATE totp_activation_tokens", "INSERT INTO user_backup_codes", "INSERT INTO audit_logs"]) {
  test(`B2 PostgreSQL erro após SQL real ${phase} reverte tudo e permite retry`, async () => {
    const f = await prepare();
    let injected = false;
    const wrapped = { connect: async () => {
      const client = await pool.connect();
      const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<QueryResult>;
      return { release: () => client.release(), query: async (text: string, values?: unknown[]) => {
        const result = await query(text, values);
        if (text.startsWith(phase)) { injected = true; throw new Error("PRIVATE_SQL_FAILURE"); }
        return result;
      } };
    } } as unknown as Pool;
    const failing = new TotpActivationService(wrapped);
    const original = activation.confirm.bind(activation);
    activation.confirm = input => failing.confirm(input);
    try {
      const response = await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) });
      assert.equal(response.status, 500);
      assert.equal(response.body.code, "INTERNAL_SERVER_ERROR");
      assert.equal(JSON.stringify(response.body).includes("PRIVATE_SQL_FAILURE"), false);
    } finally { activation.confirm = original; }
    assert.equal(injected, true);
    await pendingState();
    assert.equal((await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) })).status, 200);
  });
}

for (const state of ["missing", "wrong", "tampered"] as const) {
  test(`B2 PostgreSQL configuração ${state} não expõe nem ativa segredo`, async () => {
    const f = await prepare();
    const original = process.env.TOTP_ENCRYPTION_KEY;
    try {
      if (state === "missing") delete process.env.TOTP_ENCRYPTION_KEY;
      else if (state === "wrong") process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
      else await pool.query("UPDATE user_totp_credentials SET secret_encrypted='corrupted' WHERE user_id=$1", [current.id]);
      const response = await post("/auth/2fa/confirm", { ...f.input, code: await codeNow(f.secret) });
      assert.equal(response.status, 503);
      assert.equal(response.body.code, "TOTP_CONFIGURATION_UNAVAILABLE");
      assert.equal("secret" in response.body, false);
      await pendingState();
    } finally { process.env.TOTP_ENCRYPTION_KEY = original; }
  });
}
