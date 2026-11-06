import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import * as argon2 from "argon2";
import { Pool } from "pg";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { LoginRateLimiterService } from "../../src/auth/login-rate-limiter.service";
import { RegistrationRateLimiterService } from "../../src/auth/registration-rate-limiter.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import {
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashActivationToken,
  readTotpKeys,
  recoveryCodeHash,
  totpCode,
} from "../../src/auth/totp-activation.crypto";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateOpaqueRefreshToken,
  SESSION_ABSOLUTE_TTL_MS,
  signAccessToken,
  signTempTwoFactorToken,
} from "../../src/auth/token.util";
import { POSTGRES_POOL } from "../../src/database/database.module";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { assertFirstAdminBootstrapTestDatabaseUrls } from "./first-admin-bootstrap-db-guard";

// A guarda B1 exige três URLs idênticas para 127.0.0.1:55432/arenago_bootstrap_test.
const connectionString = assertFirstAdminBootstrapTestDatabaseUrls(process.env);
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64");
process.env.TOTP_RECOVERY_HMAC_KEY = Buffer.alloc(32, 47).toString("base64");
const keys = readTotpKeys(process.env);
const pool = new Pool({ connectionString, application_name: `t61c-${randomUUID()}`, max: 12 });
const fixtureUsers: string[] = [];
const fixtureEvents: string[] = [];
const password = "T6.1-C-fixture-only-password";
let passwordHash: string;
let app: INestApplication;
let baseUrl: string;

@Module({
  controllers: [AuthController],
  providers: [
    { provide: POSTGRES_POOL, useValue: pool },
    AuthService,
    LoginRateLimiterService,
    RegistrationRateLimiterService,
    SessionAuthGuard,
    { provide: EmailVerificationHttpService, useValue: { request: async () => ({}), confirm: async () => ({ verified: false }) } },
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
  ],
})
class AdminTwoFactorIntegrationModule {}

interface AccountFixture { id: string; email: string; secret: string; recoveryCode: string }
interface Reply { status: number; headers: Headers; body: Record<string, unknown> }

async function account(options?: { active?: boolean; verified?: boolean; totp?: boolean }): Promise<AccountFixture> {
  const id = randomUUID();
  const email = `${id}@example.test`;
  const authorizationId = randomUUID();
  const secret = generateTotpSecret();
  const activationToken = randomBytes(32).toString("base64url");
  const now = new Date();
  await pool.query(
    `INSERT INTO users(id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
     VALUES($1,'Admin C fixture',$2,$3,$4,$5,clock_timestamp(),clock_timestamp())`,
    [id, email, passwordHash, options?.verified === false ? null : now, options?.active === false ? false : true],
  );
  fixtureUsers.push(id);
  await pool.query(
    `INSERT INTO user_roles(id,user_id,role,event_id,granted_at)
     VALUES($1,$2,'admin',NULL,clock_timestamp())`,
    [randomUUID(), id],
  );
  await pool.query(
    `INSERT INTO totp_activation_tokens(id,user_id,token_hash,issued_by,expires_at,used_at,revoked_at,created_at)
     VALUES($1,$2,$3,NULL,clock_timestamp()+interval '1 day',clock_timestamp(),NULL,clock_timestamp())`,
    [authorizationId, id, hashActivationToken(activationToken)],
  );
  await pool.query(
    `INSERT INTO audit_logs(id,actor_user_id,target_user_id,event_id,origin,category,action,metadata,occurred_at)
     VALUES($1,$2,$2,NULL,'user','identity','totp_initial_activated','{}'::jsonb,clock_timestamp())`,
    [randomUUID(), id],
  );
  if (options?.totp !== false) {
    await pool.query(
      `INSERT INTO user_totp_credentials(id,user_id,secret_encrypted,is_verified,verified_at,created_at,updated_at)
       VALUES($1,$2,$3,true,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
      [randomUUID(), id, encryptTotpSecret(secret, keys.encryption, id, authorizationId)],
    );
    const recovery = generateRecoveryCodes(id, keys.recovery);
    for (const code of recovery) {
      await pool.query(
        `INSERT INTO user_backup_codes(id,user_id,code_hash,used_at,created_at)
         VALUES($1,$2,$3,NULL,clock_timestamp())`,
        [randomUUID(), id, code.hash],
      );
    }
    return { id, email, secret, recoveryCode: recovery[0].raw };
  }
  return { id, email, secret, recoveryCode: "" };
}

async function request(path: string, body: unknown, method = "POST"): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, headers: response.headers, body: await response.json() as Record<string, unknown> };
}

async function challenge(fixture: AccountFixture, configured = true): Promise<string> {
  const login = await request("/auth/login", { email: fixture.email, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.requires2FA, true);
  assert.equal(login.body.isTotpConfigured, configured);
  return login.body.tempToken as string;
}

async function currentCode(secret: string): Promise<string> {
  const result = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  return totpCode(secret, new Date(result.rows[0].now).getTime());
}

async function installFailureTrigger(kind: "audit" | "refresh" | "commit", userId: string): Promise<() => Promise<void>> {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `t6c_fail_${suffix}`;
  const triggerName = `t6c_trigger_${suffix}`;
  let table: string;
  let condition: string;
  if (kind === "audit") {
    table = "audit_logs";
    condition = `NEW.target_user_id = '${userId}' AND NEW.action = 'admin_2fa_login_succeeded'`;
  } else if (kind === "refresh") {
    table = "refresh_tokens";
    condition = `EXISTS (SELECT 1 FROM sessions s WHERE s.id = NEW.session_id AND s.user_id = '${userId}')`;
  } else {
    table = "sessions";
    condition = `NEW.user_id = '${userId}'`;
  }
  await pool.query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF ${condition} THEN RAISE EXCEPTION 'T6.1-C injected database failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
  if (kind === "commit") {
    await pool.query(`CREATE CONSTRAINT TRIGGER ${triggerName} AFTER INSERT ON ${table}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
  } else {
    await pool.query(`CREATE TRIGGER ${triggerName} AFTER INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
  }
  return async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
    await pool.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
  };
}

async function cleanFixture(id: string): Promise<void> {
  await pool.query("DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)", [id]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM admin_2fa_challenges WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM user_backup_codes WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM user_totp_credentials WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM totp_activation_tokens WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM audit_logs WHERE target_user_id=$1 OR actor_user_id=$1", [id]);
  await pool.query("DELETE FROM user_roles WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
}

async function staffAccount(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const eventId = randomUUID();
  const email = `${id}@example.test`;
  fixtureUsers.push(id);
  fixtureEvents.push(eventId);
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
    VALUES($1,'Staff C fixture',$2,$3,clock_timestamp(),true,clock_timestamp(),clock_timestamp())`, [id, email, passwordHash]);
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'Staff C fixture',$2,'America/Sao_Paulo',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 30 minutes','scheduled',false,clock_timestamp(),clock_timestamp())`, [eventId, `C${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`]);
  await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), id, eventId]);
  return { id, email };
}

before(async () => {
  const destination = await pool.query<{ name: string }>("SELECT current_database() AS name");
  assert.equal(destination.rows[0].name, "arenago_bootstrap_test", "T6.1-C exige o banco dedicado; nenhum fixture será criado em outro destino.");
  passwordHash = await argon2.hash(password);
  app = await NestFactory.create(AdminTwoFactorIntegrationModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
});

afterEach(async () => {
  for (const id of fixtureUsers.splice(0)) await cleanFixture(id);
  for (const id of fixtureEvents.splice(0)) await pool.query("DELETE FROM events WHERE id=$1", [id]);
});

after(async () => {
  if (app) await app.close();
  await pool.end();
});

test("T6.1-C PostgreSQL login Admin exige TOTP ou recovery code e emite sessão atômica", async (t) => {
  await t.test("primeiro login Admin sem desafios anteriores persiste exatamente o novo desafio", async () => {
    const fixture = await account();
    const before = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM admin_2fa_challenges WHERE user_id=$1",
      [fixture.id],
    );
    assert.equal(before.rows[0].count, 0);

    const tempToken = await challenge(fixture);
    const claims = JSON.parse(Buffer.from(tempToken.split(".")[1], "base64url").toString("utf8")) as { jti: string };
    const persisted = await pool.query<{ jti: string; consumed_at: Date | null; invalidated_at: Date | null }>(
      "SELECT jti,consumed_at,invalidated_at FROM admin_2fa_challenges WHERE user_id=$1",
      [fixture.id],
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].jti, claims.jti);
    assert.equal(persisted.rows[0].consumed_at, null);
    assert.equal(persisted.rows[0].invalidated_at, null);
    const sessions = await pool.query("SELECT id FROM sessions WHERE user_id=$1", [fixture.id]);
    assert.equal(sessions.rowCount, 0);
  });

  await t.test("TOTP válido cria uma única sessão verificada e o endpoint não armazena resposta", async () => {
    const fixture = await account();
    const beforeCounts = await pool.query<{ participations: number; entries: number }>(
      `SELECT (SELECT count(*)::int FROM participations WHERE user_id=$1) AS participations,
              (SELECT count(*)::int FROM queue_entries qe JOIN participations p ON p.id=qe.participation_id WHERE p.user_id=$1) AS entries`, [fixture.id]);
    const tempToken = await challenge(fixture);
    const result = await request("/auth/2fa/verify", { tempToken, code: await currentCode(fixture.secret) });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("pragma"), "no-cache");
    assert.equal(result.body.expiresIn, ACCESS_TOKEN_TTL_SECONDS);
    assert.equal("recoveryCodes" in result.body, false);
    const sessions = await pool.query<{ admin_2fa_verified_at: Date | null; n: number }>(
      `SELECT admin_2fa_verified_at,(SELECT count(*)::int FROM sessions WHERE user_id=$1 AND revoked_at IS NULL) AS n
       FROM sessions WHERE user_id=$1 AND revoked_at IS NULL`, [fixture.id]);
    assert.equal(sessions.rowCount, 1);
    assert.ok(sessions.rows[0].admin_2fa_verified_at instanceof Date);
    assert.equal(sessions.rows[0].n, 1);
    const afterCounts = await pool.query<{ participations: number; entries: number }>(
      `SELECT (SELECT count(*)::int FROM participations WHERE user_id=$1) AS participations,
              (SELECT count(*)::int FROM queue_entries qe JOIN participations p ON p.id=qe.participation_id WHERE p.user_id=$1) AS entries`, [fixture.id]);
    assert.deepEqual(afterCounts.rows[0], beforeCounts.rows[0]);
    const me = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${result.body.accessToken as string}` } });
    assert.equal(me.status, 200);
  });

  await t.test("recovery code é consumido junto à sessão e não pode ser reapresentado", async () => {
    const fixture = await account();
    const first = await request("/auth/2fa/verify", { tempToken: await challenge(fixture), code: fixture.recoveryCode });
    assert.equal(first.status, 200);
    const used = await pool.query("SELECT used_at FROM user_backup_codes WHERE user_id=$1 AND code_hash=$2", [fixture.id, recoveryCodeHash(fixture.recoveryCode, fixture.id, keys.recovery)]);
    assert.ok(used.rows[0].used_at instanceof Date);
    const second = await request("/auth/2fa/verify", { tempToken: await challenge(fixture), code: fixture.recoveryCode });
    assert.equal(second.status, 401);
    assert.equal(second.body.code, "ADMIN_2FA_INVALID");
  });

  await t.test("código incorreto registra tentativa persistente e não cria sessão", async () => {
    const fixture = await account();
    const valid = new Set([-30_000, 0, 30_000].map(offset => totpCode(fixture.secret, Date.now() + offset)));
    let wrong = "000000";
    while (valid.has(wrong)) wrong = String((Number(wrong) + 1) % 1_000_000).padStart(6, "0");
    const tempToken = await challenge(fixture);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await request("/auth/2fa/verify", { tempToken, code: wrong });
      assert.equal(result.status, 401);
      assert.equal(result.body.code, "ADMIN_2FA_INVALID");
    }
    const rateLimited = await request("/auth/2fa/verify", { tempToken, code: await currentCode(fixture.secret) });
    assert.equal(rateLimited.status, 429);
    assert.equal((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE target_user_id=$1 AND action='admin_2fa_login_rejected'", [fixture.id])).rows[0].n, 5);
  });

  await t.test("recovery code concorrente só cria uma sessão e só um consumo", async () => {
    const fixture = await account();
    const tempToken = await challenge(fixture);
    const body = { tempToken, code: fixture.recoveryCode };
    const outcomes = await Promise.all([request("/auth/2fa/verify", body), request("/auth/2fa/verify", body)]);
    assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 401]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_backup_codes WHERE user_id=$1 AND used_at IS NOT NULL", [fixture.id])).rows[0].n, 1);
  });

  await t.test("desafio expirado, adulterado e invalidado por nova senha não autentica", async () => {
    const fixture = await account();
    const issuedAtResult = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const issuedAt = new Date(issuedAtResult.rows[0].now.getTime() - 10 * 60_000);
    const expired = signTempTwoFactorToken(fixture.id, { nowMs: issuedAt.getTime() });
    const claims = JSON.parse(Buffer.from(expired.split(".")[1], "base64url").toString("utf8")) as {
      sub: string; type: string; jti: string; iat: number; exp: number;
    };
    assert.equal(claims.sub, fixture.id);
    assert.equal(claims.type, "2fa_challenge");
    assert.ok(claims.exp * 1_000 <= issuedAtResult.rows[0].now.getTime());
    await pool.query(
      `INSERT INTO admin_2fa_challenges(jti,user_id,issued_at,expires_at,consumed_at,invalidated_at,created_at)
       VALUES($1,$2,$3,$4,NULL,NULL,clock_timestamp())`,
      [claims.jti, fixture.id, new Date(claims.iat * 1_000), new Date(claims.exp * 1_000)],
    );
    const expiredResult = await request("/auth/2fa/verify", {
      tempToken: expired,
      code: await currentCode(fixture.secret),
    });
    assert.equal(expiredResult.status, 401);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [fixture.id])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_backup_codes WHERE user_id=$1 AND used_at IS NOT NULL", [fixture.id])).rows[0].n, 0);
    const previous = await challenge(fixture);
    const latest = await challenge(fixture);
    assert.notEqual(previous, latest);
    assert.equal((await request("/auth/2fa/verify", { tempToken: previous, code: await currentCode(fixture.secret) })).status, 401);
    const parts = latest.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${"A".repeat(parts[2].length)}`;
    assert.equal((await request("/auth/2fa/verify", { tempToken: tampered, code: await currentCode(fixture.secret) })).status, 401);
  });

  await t.test("segredo adulterado, chave AES incorreta e referência de autorização ambígua são rejeitados", async () => {
    const tampered = await account();
    await pool.query("UPDATE user_totp_credentials SET secret_encrypted='v1.invalid' WHERE user_id=$1", [tampered.id]);
    const tamperedResult = await request("/auth/2fa/verify", { tempToken: await challenge(tampered), code: await currentCode(tampered.secret) });
    assert.equal(tamperedResult.status, 503);
    assert.equal(tamperedResult.body.code, "TOTP_CONFIGURATION_UNAVAILABLE");

    const wrongKey = await account();
    const wrongKeyToken = await challenge(wrongKey);
    const originalKey = process.env.TOTP_ENCRYPTION_KEY;
    try {
      process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 99).toString("base64");
      const result = await request("/auth/2fa/verify", { tempToken: wrongKeyToken, code: await currentCode(wrongKey.secret) });
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "TOTP_CONFIGURATION_UNAVAILABLE");
    } finally {
      process.env.TOTP_ENCRYPTION_KEY = originalKey;
    }

    const ambiguous = await account();
    await pool.query(`INSERT INTO totp_activation_tokens(id,user_id,token_hash,issued_by,expires_at,used_at,revoked_at,created_at)
      VALUES($1,$2,$3,NULL,clock_timestamp()+interval '1 day',clock_timestamp(),NULL,clock_timestamp())`,
    [randomUUID(), ambiguous.id, hashActivationToken(randomBytes(32).toString("base64url"))]);
    const result = await request("/auth/2fa/verify", { tempToken: await challenge(ambiguous), code: await currentCode(ambiguous.secret) });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "TOTP_CONFIGURATION_UNAVAILABLE");

    const recoveryOnly = await account();
    const recoveryChallenge = await challenge(recoveryOnly);
    const configuredEncryptionKey = process.env.TOTP_ENCRYPTION_KEY;
    try {
      delete process.env.TOTP_ENCRYPTION_KEY;
      const recovered = await request("/auth/2fa/verify", { tempToken: recoveryChallenge, code: recoveryOnly.recoveryCode });
      assert.equal(recovered.status, 200);
    } finally {
      process.env.TOTP_ENCRYPTION_KEY = configuredEncryptionKey;
    }
  });

  await t.test("falha SQL após escritas de sessão/auditoria reverte fator e permite retry", async () => {
    const fixture = await account();
    const tempToken = await challenge(fixture);
    const code = await currentCode(fixture.secret);
    const removeRefreshFailure = await installFailureTrigger("refresh", fixture.id);
    try {
      const failedInsert = await request("/auth/2fa/verify", { tempToken, code });
      assert.equal(failedInsert.status, 500);
    } finally {
      await removeRefreshFailure();
    }
    assert.equal((await pool.query("SELECT consumed_at FROM admin_2fa_challenges WHERE user_id=$1", [fixture.id])).rows[0].consumed_at, null);
    assert.equal((await pool.query("SELECT last_totp_counter FROM user_totp_credentials WHERE user_id=$1", [fixture.id])).rows[0].last_totp_counter, null);
    assert.equal((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rowCount, 0);

    const removeAuditFailure = await installFailureTrigger("audit", fixture.id);
    try {
      const failedAudit = await request("/auth/2fa/verify", { tempToken, code });
      assert.equal(failedAudit.status, 500);
    } finally {
      await removeAuditFailure();
    }
    assert.equal((await pool.query("SELECT consumed_at FROM admin_2fa_challenges WHERE user_id=$1", [fixture.id])).rows[0].consumed_at, null);
    assert.equal((await pool.query("SELECT last_totp_counter FROM user_totp_credentials WHERE user_id=$1", [fixture.id])).rows[0].last_totp_counter, null);
    assert.equal((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rowCount, 0);
    assert.equal((await request("/auth/2fa/verify", { tempToken, code })).status, 200);
  });

  await t.test("erro deferred no COMMIT não devolve tokens nem persiste efeitos", async () => {
    const fixture = await account();
    const tempToken = await challenge(fixture);
    const recoveryCode = fixture.recoveryCode;
    const removeFailure = await installFailureTrigger("commit", fixture.id);
    let result: Reply;
    try {
      result = await request("/auth/2fa/verify", { tempToken, code: recoveryCode });
      assert.equal(result.status, 500);
      assert.equal("accessToken" in result.body, false);
      assert.equal("refreshToken" in result.body, false);
    } finally {
      await removeFailure();
    }
    assert.equal((await pool.query("SELECT consumed_at FROM admin_2fa_challenges WHERE user_id=$1", [fixture.id])).rows[0].consumed_at, null);
    assert.equal((await pool.query("SELECT used_at FROM user_backup_codes WHERE user_id=$1 AND code_hash=$2", [fixture.id, recoveryCodeHash(recoveryCode, fixture.id, keys.recovery)])).rows[0].used_at, null);
    assert.equal((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rowCount, 0);
  });

  await t.test("mesmo passo TOTP e mesmo desafio não podem concluir dois logins", async () => {
    const fixture = await account();
    const tempToken = await challenge(fixture);
    const code = await currentCode(fixture.secret);
    const [first, second] = await Promise.all([
      request("/auth/2fa/verify", { tempToken, code }),
      request("/auth/2fa/verify", { tempToken, code }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 401]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rows[0].n, 1);
    const latest = await challenge(fixture);
    const replay = await request("/auth/2fa/verify", { tempToken: latest, code });
    assert.equal(replay.status, 401);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [fixture.id])).rows[0].n, 1);
  });

  await t.test("sessão anterior permanece até o segundo fator e é então revogada com seu refresh", async () => {
    const fixture = await account();
    const sessionId = randomUUID();
    const { tokenHash } = generateOpaqueRefreshToken();
    const clock = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = new Date(clock.rows[0].now);
    await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,revoked_at,revocation_reason,admin_2fa_verified_at,ip_address,user_agent,created_at)
      VALUES($1,$2,$3,$4,NULL,NULL,$4,NULL,NULL,$4)`, [sessionId, fixture.id, new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS), now]);
    await pool.query(`INSERT INTO refresh_tokens(id,session_id,token_hash,consumed_at,is_revoked,expires_at,created_at)
      VALUES($1,$2,$3,NULL,false,$4,$5)`, [randomUUID(), sessionId, tokenHash, new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS), now]);
    const oldAccess = signAccessToken({ userId: fixture.id, sessionId }, { nowMs: now.getTime() });
    const tempToken = await challenge(fixture);
    const stillActive = await pool.query("SELECT revoked_at FROM sessions WHERE id=$1", [sessionId]);
    assert.equal(stillActive.rows[0].revoked_at, null);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${oldAccess}` } })).status, 200);
    const verified = await request("/auth/2fa/verify", { tempToken, code: await currentCode(fixture.secret) });
    assert.equal(verified.status, 200);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${oldAccess}` } })).status, 401);
    assert.equal((await pool.query("SELECT revoked_at FROM sessions WHERE id=$1", [sessionId])).rows[0].revoked_at instanceof Date, true);
    assert.equal((await pool.query("SELECT is_revoked FROM refresh_tokens WHERE session_id=$1", [sessionId])).rows[0].is_revoked, true);
  });

  await t.test("duas solicitações de login concorrentes deixam somente o desafio mais recente utilizável", async () => {
    const fixture = await account();
    const [a, b] = await Promise.all([
      request("/auth/login", { email: fixture.email, password }),
      request("/auth/login", { email: fixture.email, password }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const valid = await pool.query<{ jti: string }>("SELECT jti FROM admin_2fa_challenges WHERE user_id=$1 AND invalidated_at IS NULL AND consumed_at IS NULL", [fixture.id]);
    assert.equal(valid.rowCount, 1);
    const tokens = [a.body.tempToken as string, b.body.tempToken as string];
    const activeToken = tokens.find(token => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).jti === valid.rows[0].jti);
    assert.ok(activeToken);
    const success = await request("/auth/2fa/verify", { tempToken: activeToken, code: await currentCode(fixture.secret) });
    assert.equal(success.status, 200);
  });

  await t.test("Admin sem TOTP ativo, conta inativa, e-mail não verificado ou papel revogado não recebe sessão", async () => {
    const unconfigured = await account({ totp: false });
    const unconfiguredChallenge = await challenge(unconfigured, false);
    const notConfigured = await request("/auth/2fa/verify", { tempToken: unconfiguredChallenge, code: "000000" });
    assert.equal(notConfigured.status, 409);
    assert.equal(notConfigured.body.code, "ADMIN_TOTP_NOT_CONFIGURED");

    const inactive = await account({ active: false });
    const inactiveLogin = await request("/auth/login", { email: inactive.email, password });
    assert.equal(inactiveLogin.status, 401);

    const unverified = await account({ verified: false });
    const unverifiedLogin = await request("/auth/login", { email: unverified.email, password });
    assert.equal(unverifiedLogin.status, 200);
    assert.equal((await request("/auth/2fa/verify", { tempToken: unverifiedLogin.body.tempToken, code: await currentCode(unverified.secret) })).status, 401);

    const revoked = await account();
    const revokedChallenge = await challenge(revoked);
    await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='admin'", [revoked.id]);
    assert.equal((await request("/auth/2fa/verify", { tempToken: revokedChallenge, code: await currentCode(revoked.secret) })).status, 401);
  });

  await t.test("DTO rejeita identidade de cliente; login participante mantém fluxo sem TOTP", async () => {
    const fixture = await account();
    const token = await challenge(fixture);
    const injected = await request("/auth/2fa/verify", { tempToken: token, code: "123456", userId: fixture.id });
    assert.equal(injected.status, 400);
    const participantId = randomUUID();
    const participantEmail = `${participantId}@example.test`;
    await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
      VALUES($1,'Participante C',$2,$3,clock_timestamp(),true,clock_timestamp(),clock_timestamp())`, [participantId, participantEmail, passwordHash]);
    fixtureUsers.push(participantId);
    await pool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'participante',NULL,clock_timestamp())", [randomUUID(), participantId]);
    const participant = await request("/auth/login", { email: participantEmail, password });
    assert.equal(participant.status, 200);
    assert.equal(participant.body.requires2FA, undefined);
    assert.equal(typeof participant.body.accessToken, "string");

    const staff = await staffAccount();
    const staffLogin = await request("/auth/login", { email: staff.email, password });
    assert.equal(staffLogin.status, 200);
    assert.equal(staffLogin.body.requires2FA, undefined);
    assert.equal(typeof staffLogin.body.accessToken, "string");
  });

  await t.test("refresh e logout preservam os contratos da sessão emitida após TOTP", async () => {
    const fixture = await account();
    const login = await request("/auth/2fa/verify", { tempToken: await challenge(fixture), code: await currentCode(fixture.secret) });
    assert.equal(login.status, 200);
    const refreshed = await request("/auth/refresh", { refreshToken: login.body.refreshToken });
    assert.equal(refreshed.status, 200);
    const me = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${refreshed.body.accessToken as string}` } });
    assert.equal(me.status, 200);
    const logout = await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${refreshed.body.accessToken as string}` } });
    assert.equal(logout.status, 200);
    assert.equal((await pool.query("SELECT revoked_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [fixture.id])).rows[0].revoked_at instanceof Date, true);
  });
});
