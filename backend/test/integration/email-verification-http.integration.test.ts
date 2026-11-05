import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { EmailVerificationHttpService } from "../../src/auth/email-verification-http.service";
import { EMAIL_DELIVERY } from "../../src/auth/email-verification-mailer";
import { EmailVerificationPolicy, parseEmailVerificationLimits } from "../../src/auth/email-verification.policy";
import { EmailVerificationService } from "../../src/auth/email-verification.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { POSTGRES_POOL } from "../../src/database/database.module";
import { assertParticipationsReadTestDatabaseUrls } from "./participations-read-db-guard";

const connectionString = assertParticipationsReadTestDatabaseUrls(process.env);
const userId = randomUUID();
const email = `${userId}@example.test`;
const principal = { userId, sessionId: "test-session", email, name: "A2 fixture", emailVerified: false,
  roles: ["participante"], staffEventIds: [], hasCompletedQuestionnaire: false, admin2faVerifiedAt: null };
const pool = new Pool({ connectionString, max: 4 });
const sent: Array<{ email: string; token: string }> = [];
let app: INestApplication;
let baseUrl: string;

@Module({ controllers: [AuthController], providers: [
  { provide: POSTGRES_POOL, useValue: pool },
  { provide: EmailVerificationPolicy, useValue: { limits: parseEmailVerificationLimits({}) } },
  EmailVerificationService,
  EmailVerificationHttpService,
  { provide: EMAIL_DELIVERY, useValue: { isAvailable: () => true, sendVerification: async (recipient: string, token: string) => { sent.push({ email: recipient, token }); } } },
  { provide: AuthService, useValue: { authenticateBearerToken: async () => principal } },
  SessionAuthGuard,
  { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
] })
class EmailVerificationHttpIntegrationModule {}

before(async () => {
  await pool.query(`INSERT INTO users(id,name,email,password_hash,is_active,created_at,updated_at)
    VALUES($1,'A2 fixture',$2,'test-placeholder',true,clock_timestamp(),clock_timestamp())`, [userId, email]);
  app = await NestFactory.create(EmailVerificationHttpIntegrationModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  if (app) await app.close();
  try {
    await pool.query("DELETE FROM email_verification_tokens WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  } finally { await pool.end(); }
});

test("T6.1-A2 HTTP + PostgreSQL usa identidade da sessão, envia por fake e confirma sem sessão", async () => {
  const request = await fetch(`${baseUrl}/auth/verify-email/request`, { method: "POST",
    headers: { Authorization: "Bearer simulated-session", "Content-Type": "application/json", Host: "spoof.invalid", Origin: "https://spoof.invalid" },
    body: "{}" });
  assert.equal(request.status, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, email);

  const stored = await pool.query<{ token_hash: string; verified_at: Date | null }>(
    "SELECT token_hash,verified_at FROM email_verification_tokens WHERE user_id=$1", [userId]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].token_hash, createHash("sha256").update(sent[0].token).digest("hex"));
  assert.equal(stored.rows[0].verified_at, null);

  const confirmation = await fetch(`${baseUrl}/auth/verify-email/confirm`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: sent[0].token }) });
  assert.equal(confirmation.status, 200);
  assert.deepEqual(await confirmation.json(), { verified: true });

  const account = await pool.query<{ email_verified_at: Date | null }>("SELECT email_verified_at FROM users WHERE id=$1", [userId]);
  assert.ok(account.rows[0].email_verified_at);
  assert.equal((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1", [userId])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM user_roles WHERE user_id=$1", [userId])).rowCount, 0);
});
