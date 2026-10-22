import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { Body, Controller, Get, INestApplication, Module, Post } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { AppModule } from "../../src/app.module";
import {
  AuthenticatedPrincipal,
  AuthModule,
  AuthService,
  CurrentUser,
  CurrentUserId,
  RequireSessionAuth,
} from "../../src/auth";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  SESSION_ABSOLUTE_TTL_MS,
  signAccessToken,
  verifyAccessToken,
} from "../../src/auth/token.util";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL local descartável é obrigatório para os testes de integração.",
  );
}

/**
 * Controller auxiliar para validar o contrato compartilhado de autenticação
 * que será reutilizado pelo módulo Events (Seção 9 da K01).
 */
@Controller("events-auth-probe")
class EventsAuthProbeController {
  @Get("me-id")
  @RequireSessionAuth()
  getAuthenticatedId(
    @CurrentUserId() userId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return {
      userId,
      sessionId: principal.sessionId,
      roles: principal.roles,
      hasCompletedQuestionnaire: principal.hasCompletedQuestionnaire,
    };
  }

  @Post("join-probe")
  @RequireSessionAuth()
  probeJoinIgnoringBodyUserId(
    @CurrentUserId() authenticatedUserId: string,
    @Body() body: { userId?: string; eventId?: string },
  ) {
    // Demonstra que o módulo Events obtém o ID real autenticado pelo decorator
    // e jamais confia em userId enviado livremente no body.
    return {
      effectiveUserId: authenticatedUserId,
      ignoredBodyUserId: body?.userId ?? null,
      eventId: body?.eventId ?? null,
    };
  }
}

@Module({
  imports: [AppModule, AuthModule],
  controllers: [EventsAuthProbeController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemDetailsExceptionFilter,
    },
  ],
})
class TestRootModule {}

let app: INestApplication;
let baseUrl: string;
let pool: Pool;

before(async () => {
  pool = new Pool({ connectionString, max: 10 });
  app = await NestFactory.create(TestRootModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  if (app) {
    await app.close();
  }
  if (pool) {
    await pool.end();
  }
});

interface HttpResult<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  },
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {
    ...(options?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options?.headers ?? {}),
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const body = (await response.json()) as T;
  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

test("K01 Auth & Sessions — Integração HTTP + PostgreSQL Real", async (t) => {
  // =========================================================================
  // 1. CADASTRO REAL (POST /api/v1/auth/register)
  // =========================================================================
  await t.test("Cadastro válido cria usuário, papel participante, sessão única, hash Argon2id e hasCompletedQuestionnaire=false", async () => {
    const rawEmail = `  Kaled.User.${randomUUID().slice(0, 8)}@Example.TEST  `;
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const password = `S3nha!Forte#${randomUUID().slice(0, 8)}`;

    const res = await apiRequest<{
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        roles: string[];
        hasCompletedQuestionnaire: boolean;
      };
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>("/auth/register", {
      method: "POST",
      body: {
        name: "  Kaled Barreto  ",
        email: rawEmail,
        password,
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.name, "Kaled Barreto");
    assert.equal(res.body.user.email, normalizedEmail);
    assert.equal(res.body.user.emailVerified, false);
    assert.deepEqual(res.body.user.roles, ["participante"]);
    assert.equal(res.body.user.hasCompletedQuestionnaire, false);
    assert.equal(res.body.expiresIn, ACCESS_TOKEN_TTL_SECONDS);
    assert.ok(res.body.accessToken.length > 20);
    assert.ok(res.body.refreshToken.length > 20);

    // Verificar persistência real no PostgreSQL
    const dbUser = await pool.query<{
      id: string;
      email: string;
      password_hash: string;
      is_active: boolean;
    }>("SELECT id, email, password_hash, is_active FROM users WHERE id = $1", [
      res.body.user.id,
    ]);
    assert.equal(dbUser.rowCount, 1);
    assert.equal(dbUser.rows[0].email, normalizedEmail);
    assert.equal(dbUser.rows[0].is_active, true);
    assert.ok(
      dbUser.rows[0].password_hash.startsWith("$argon2id$"),
      "O hash salvo deve ser Argon2id",
    );
    assert.notEqual(dbUser.rows[0].password_hash, password);

    // Nenhum perfil falso criado
    const dbProfile = await pool.query(
      "SELECT 1 FROM profiles WHERE user_id = $1",
      [res.body.user.id],
    );
    assert.equal(dbProfile.rowCount, 0);

    // Papel inicial participante atribuído
    const dbRoles = await pool.query<{ role: string; event_id: string | null }>(
      "SELECT role, event_id FROM user_roles WHERE user_id = $1 AND revoked_at IS NULL",
      [res.body.user.id],
    );
    assert.equal(dbRoles.rowCount, 1);
    assert.deepEqual(dbRoles.rows[0], { role: "participante", event_id: null });

    // Sessão e refresh token por hash (sem guardar o token puro)
    const dbSessions = await pool.query<{
      id: string;
      expires_at: Date;
      created_at: Date;
      revoked_at: Date | null;
    }>("SELECT id, expires_at, created_at, revoked_at FROM sessions WHERE user_id = $1", [
      res.body.user.id,
    ]);
    assert.equal(dbSessions.rowCount, 1);
    assert.equal(dbSessions.rows[0].revoked_at, null);

    const ttlDiff =
      new Date(dbSessions.rows[0].expires_at).getTime() -
      new Date(dbSessions.rows[0].created_at).getTime();
    assert.equal(ttlDiff, SESSION_ABSOLUTE_TTL_MS);

    const dbRefresh = await pool.query<{ token_hash: string; consumed_at: Date | null; is_revoked: boolean }>(
      "SELECT token_hash, consumed_at, is_revoked FROM refresh_tokens WHERE session_id = $1",
      [dbSessions.rows[0].id],
    );
    assert.equal(dbRefresh.rowCount, 1);
    assert.equal(dbRefresh.rows[0].token_hash, hashRefreshToken(res.body.refreshToken));
    assert.notEqual(dbRefresh.rows[0].token_hash, res.body.refreshToken);
  });

  await t.test("Cadastro rejeita nome inválido, e-mail inválido, senha curta e confirmPassword no body (RFC 7807)", async () => {
    const badName = await apiRequest("/auth/register", {
      method: "POST",
      body: { name: "A", email: "ok@example.test", password: "Valid#Password99" },
    });
    assert.equal(badName.status, 400);
    assert.ok(badName.headers.get("content-type")?.includes("application/problem+json"));
    assert.equal(badName.body.code, "VALIDATION_ERROR");

    const badEmail = await apiRequest("/auth/register", {
      method: "POST",
      body: { name: "Nome Valido", email: "email-invalido", password: "Valid#Password99" },
    });
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.body.code, "VALIDATION_ERROR");

    const shortPassword = await apiRequest("/auth/register", {
      method: "POST",
      body: { name: "Nome Valido", email: "ok2@example.test", password: "1234567" },
    });
    assert.equal(shortPassword.status, 400);
    assert.equal(shortPassword.body.code, "VALIDATION_ERROR");

    const withConfirmPassword = await apiRequest("/auth/register", {
      method: "POST",
      body: {
        name: "Nome Valido",
        email: "ok3@example.test",
        password: "Valid#Password99",
        confirmPassword: "Valid#Password99",
      },
    });
    assert.equal(withConfirmPassword.status, 400);
    assert.equal(withConfirmPassword.body.code, "VALIDATION_ERROR");
  });

  await t.test("Cadastro rejeita senhas comuns ou comprometidas com 422 RFC 7807", async () => {
    const res = await apiRequest("/auth/register", {
      method: "POST",
      body: {
        name: "Teste Senha Comum",
        email: `weak-${randomUUID()}@example.test`,
        password: "password123",
      },
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.code, "PASSWORD_COMPROMISED_OR_COMMON");
    assert.ok(res.headers.get("content-type")?.includes("application/problem+json"));
  });

  await t.test("Cadastro impede e-mail duplicado após normalização e preserva atomicidade", async () => {
    const baseEmail = `dup-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Segura#${randomUUID().slice(0, 8)}`;

    const first = await apiRequest<{ user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { name: "Primeiro Usuario", email: baseEmail, password },
    });
    assert.equal(first.status, 201);

    const duplicate = await apiRequest("/auth/register", {
      method: "POST",
      body: {
        name: "Segundo Usuario",
        email: `   ${baseEmail.toUpperCase()}  `,
        password,
      },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "EMAIL_ALREADY_REGISTERED");

    const countResult = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE lower(btrim(email)) = $1",
      [baseEmail.toLowerCase()],
    );
    assert.equal(countResult.rows[0].n, 1);
  });

  await t.test("Atomicidade do cadastro: falha intermediária na transação reverte criação de usuário", async () => {
    const atomicEmail = `atomic-${randomUUID()}@example.test`;
    const brokenPool = {
      connect: async () => {
        const realClient = await pool.connect();
        return {
          query: async (sqlText: string, params?: unknown[]) => {
            if (sqlText.includes("INSERT INTO refresh_tokens")) {
              throw new Error("Simulated failure before commit");
            }
            return realClient.query(sqlText, params);
          },
          release: () => realClient.release(),
        };
      },
    } as unknown as Pool;

    const directService = new AuthService(brokenPool, {
      checkAllowed: () => undefined,
      recordFailure: () => undefined,
      reset: () => undefined,
      clearAll: () => undefined,
    } as never);

    await assert.rejects(() =>
      directService.register({
        name: "Teste Atomico",
        email: atomicEmail,
        password: "S3nha!MuitoForte#2026",
      }),
    );

    const checkUser = await pool.query(
      "SELECT 1 FROM users WHERE lower(btrim(email)) = $1",
      [atomicEmail],
    );
    assert.equal(checkUser.rowCount, 0);
  });

  // =========================================================================
  // 2. LOGIN, SESSÃO ÚNICA E ADMIN SEM TOTP (POST /api/v1/auth/login)
  // =========================================================================
  await t.test("Login autentica credenciais válidas, emite JWT de 15min e sessão de 30 dias", async () => {
    const email = `login-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Login#${randomUUID().slice(0, 8)}`;

    await apiRequest("/auth/register", {
      method: "POST",
      body: { name: "Usuario Login", email, password },
    });

    const loginRes = await apiRequest<{
      user: { id: string; email: string };
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>("/auth/login", {
      method: "POST",
      body: { email: `  ${email.toUpperCase()} `, password },
    });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.email, email);
    assert.equal(loginRes.body.expiresIn, 900);

    const verifiedJwt = verifyAccessToken(loginRes.body.accessToken);
    assert.equal(verifiedJwt.valid, true);
    if (verifiedJwt.valid) {
      assert.equal(
        verifiedJwt.claims.exp - verifiedJwt.claims.iat,
        ACCESS_TOKEN_TTL_SECONDS,
      );
    }
  });

  await t.test("Login com credenciais inválidas ou conta desativada retorna mesma mensagem 401 sem enumerar conta", async () => {
    const email = `inactive-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Valida#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{ user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { name: "Conta Desativada", email, password },
    });
    assert.equal(reg.status, 201);

    const wrongPass = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password: "SenhaErrada#12345" },
    });
    const unknownEmail = await apiRequest("/auth/login", {
      method: "POST",
      body: { email: `naoexiste-${randomUUID()}@example.test`, password },
    });

    assert.equal(wrongPass.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPass.body.code, "INVALID_CREDENTIALS");
    assert.equal(unknownEmail.body.code, "INVALID_CREDENTIALS");
    assert.equal(wrongPass.body.detail, unknownEmail.body.detail);

    // Desativar conta no banco
    await pool.query("UPDATE users SET is_active = false WHERE id = $1", [
      reg.body.user.id,
    ]);

    const deactivatedLogin = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(deactivatedLogin.status, 401);
    assert.equal(deactivatedLogin.body.code, "INVALID_CREDENTIALS");
    assert.equal(deactivatedLogin.body.detail, wrongPass.body.detail);
  });

  await t.test("Sessão única: novo login revoga sessão anterior, invalida access/refresh antigos e preserva participação/fila", async () => {
    const email = `single-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Unica#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Sessao Unica", email, password },
    });
    assert.equal(reg.status, 201);
    const userId = reg.body.user.id;

    // Criar evento e participação em fila externa para provar que novo login não altera participação/fila
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO events (id, name, access_code_normalized, timezone, starts_at, official_ends_at, operational_deadline_at, status, external_queue_enabled, external_last_order, created_at, updated_at)
       VALUES ($1, 'Evento Teste Sessao', $2, 'America/Sao_Paulo', now() - interval '1 hour', now() + interval '2 hours', now() + interval '3 hours', 'open', true, 5, now(), now())`,
      [eventId, `EVT-${eventId.slice(0, 8).toUpperCase()}`],
    );
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, user_id, event_id, status, joined_at, external_queue_order)
       VALUES ($1, $2, $3, 'waiting', now(), 5)`,
      [participationId, userId, eventId],
    );

    // Novo login em outro aparelho
    const secondLogin = await apiRequest<{
      accessToken: string;
      refreshToken: string;
    }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(secondLogin.status, 200);

    // Access token antigo deve ser rejeitado imediatamente em /auth/me
    const oldMe = await apiRequest("/auth/me", {
      token: reg.body.accessToken,
    });
    assert.equal(oldMe.status, 401);
    assert.equal(oldMe.body.code, "SESSION_REVOKED");

    // Refresh token antigo deve ser rejeitado
    const oldRefresh = await apiRequest("/auth/refresh", {
      method: "POST",
      body: { refreshToken: reg.body.refreshToken },
    });
    assert.equal(oldRefresh.status, 401);

    // Novo access token funciona normalmente
    const newMe = await apiRequest<{ id: string }>("/auth/me", {
      token: secondLogin.body.accessToken,
    });
    assert.equal(newMe.status, 200);
    assert.equal(newMe.body.id, userId);

    // Apenas 1 sessão não revogada no PostgreSQL
    const activeSessions = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
    assert.equal(activeSessions.rows[0].n, 1);

    // Participação e ordem na fila permanecem intactas
    const checkPart = await pool.query<{
      status: string;
      external_queue_order: string;
    }>(
      "SELECT status, external_queue_order::text FROM participations WHERE id = $1",
      [participationId],
    );
    assert.deepEqual(checkPart.rows[0], {
      status: "waiting",
      external_queue_order: "5",
    });
  });

  await t.test("C12 / T10: Dois logins concorrentes da mesma conta serializam sem erro 500 e deixam exatamente uma sessão ativa", async () => {
    const email = `concurrent-login-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Concorrente#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{ user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { name: "Concorrencia Login", email, password },
    });
    assert.equal(reg.status, 201);
    const userId = reg.body.user.id;

    const [loginA, loginB] = await Promise.all([
      apiRequest<{ accessToken: string; refreshToken: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      }),
      apiRequest<{ accessToken: string; refreshToken: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      }),
    ]);

    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);

    const activeSessions = await pool.query<{ id: string }>(
      "SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
    assert.equal(activeSessions.rowCount, 1);

    // Apenas um dos dois accessTokens emitidos permanece vinculado à sessão sobrevivente
    const [meA, meB] = await Promise.all([
      apiRequest("/auth/me", { token: loginA.body.accessToken }),
      apiRequest("/auth/me", { token: loginB.body.accessToken }),
    ]);

    const statuses = [meA.status, meB.status].sort();
    assert.deepEqual(statuses, [200, 401]);
  });

  await t.test("C15: Login de conta Admin retorna requires2FA=true + tempToken, não cria sessão ativa e bloqueia tempToken como Bearer", async () => {
    const email = `admin-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!AdminForte#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{ user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { name: "Admin User", email, password },
    });
    assert.equal(reg.status, 201);
    const adminUserId = reg.body.user.id;

    // Conceder papel admin no banco e configurar credencial TOTP verificada
    await pool.query(
      `INSERT INTO user_roles (id, user_id, role, event_id, granted_at)
       VALUES ($1, $2, 'admin', NULL, now())`,
      [randomUUID(), adminUserId],
    );
    await pool.query(
      `INSERT INTO user_totp_credentials (id, user_id, secret_encrypted, is_verified, verified_at, created_at, updated_at)
       VALUES ($1, $2, 'encrypted-secret-placeholder', true, now(), now(), now())`,
      [randomUUID(), adminUserId],
    );

    const adminLogin = await apiRequest<{
      requires2FA: boolean;
      isTotpConfigured: boolean;
      tempToken: string;
      message: string;
      accessToken?: string;
      refreshToken?: string;
    }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });

    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.requires2FA, true);
    assert.equal(adminLogin.body.isTotpConfigured, true);
    assert.ok(typeof adminLogin.body.tempToken === "string" && adminLogin.body.tempToken.length > 20);
    assert.equal(adminLogin.body.accessToken, undefined);
    assert.equal(adminLogin.body.refreshToken, undefined);

    // Nenhuma sessão ativa para o Admin antes do TOTP
    const activeSessions = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
      [adminUserId],
    );
    assert.equal(activeSessions.rows[0].n, 0);

    // tempToken jamais pode ser usado como accessToken normal em /auth/me ou rotas protegidas
    const meWithTemp = await apiRequest("/auth/me", {
      token: adminLogin.body.tempToken,
    });
    assert.equal(meWithTemp.status, 401);

    const probeWithTemp = await apiRequest("/events-auth-probe/me-id", {
      token: adminLogin.body.tempToken,
    });
    assert.equal(probeWithTemp.status, 401);
  });

  // =========================================================================
  // 3. RENOVAÇÃO SEGURA (POST /api/v1/auth/refresh)
  // =========================================================================
  await t.test("Refresh rotaciona token opaco, consome o anterior e mantém o prazo absoluto de 30 dias inalterado", async () => {
    const email = `refresh-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Refresh#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Usuario Refresh", email, password },
    });
    assert.equal(reg.status, 201);

    const beforeSession = await pool.query<{
      id: string;
      expires_at: Date;
      last_activity_at: Date;
    }>("SELECT id, expires_at, last_activity_at FROM sessions WHERE user_id = $1", [
      reg.body.user.id,
    ]);
    const originalExpiresAt = new Date(beforeSession.rows[0].expires_at).getTime();
    const originalActivityAt = new Date(beforeSession.rows[0].last_activity_at).getTime();

    const refreshRes = await apiRequest<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken: reg.body.refreshToken },
    });

    assert.equal(refreshRes.status, 200);
    assert.notEqual(refreshRes.body.refreshToken, reg.body.refreshToken);
    assert.notEqual(refreshRes.body.accessToken, reg.body.accessToken);
    assert.equal(refreshRes.body.expiresIn, ACCESS_TOKEN_TTL_SECONDS);

    // Verificar no banco que o token antigo foi marcado como consumido e o novo está ativo
    const oldTokenRow = await pool.query<{ consumed_at: Date | null }>(
      "SELECT consumed_at FROM refresh_tokens WHERE token_hash = $1",
      [hashRefreshToken(reg.body.refreshToken)],
    );
    assert.notEqual(oldTokenRow.rows[0].consumed_at, null);

    const newTokenRow = await pool.query<{ consumed_at: Date | null; is_revoked: boolean }>(
      "SELECT consumed_at, is_revoked FROM refresh_tokens WHERE token_hash = $1",
      [hashRefreshToken(refreshRes.body.refreshToken)],
    );
    assert.equal(newTokenRow.rows[0].consumed_at, null);
    assert.equal(newTokenRow.rows[0].is_revoked, false);

    // Verificar que expires_at da sessão não foi prorrogado e last_activity_at avançou
    const afterSession = await pool.query<{
      expires_at: Date;
      last_activity_at: Date;
    }>("SELECT expires_at, last_activity_at FROM sessions WHERE id = $1", [
      beforeSession.rows[0].id,
    ]);
    assert.equal(
      new Date(afterSession.rows[0].expires_at).getTime(),
      originalExpiresAt,
    );
    assert.ok(
      new Date(afterSession.rows[0].last_activity_at).getTime() >= originalActivityAt,
    );
  });

  await t.test("Reutilização de refresh token consumido revoga imediatamente a sessão e invalida o token novo", async () => {
    const email = `reuse-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Reuse#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Usuario Reuso", email, password },
    });
    assert.equal(reg.status, 201);

    const rotated = await apiRequest<{
      accessToken: string;
      refreshToken: string;
    }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken: reg.body.refreshToken },
    });
    assert.equal(rotated.status, 200);

    // Reapresentar o refresh token antigo já consumido
    const reuseAttempt = await apiRequest("/auth/refresh", {
      method: "POST",
      body: { refreshToken: reg.body.refreshToken },
    });
    assert.equal(reuseAttempt.status, 401);
    assert.equal(reuseAttempt.body.code, "REFRESH_TOKEN_REUSED");

    // A sessão deve estar revogada no PostgreSQL
    const sessionCheck = await pool.query<{
      revoked_at: Date | null;
      revocation_reason: string | null;
    }>("SELECT revoked_at, revocation_reason FROM sessions WHERE user_id = $1", [
      reg.body.user.id,
    ]);
    assert.notEqual(sessionCheck.rows[0].revoked_at, null);
    assert.equal(
      sessionCheck.rows[0].revocation_reason,
      "refresh_token_reuse_detected",
    );

    // O access token recém-emitido e o novo refresh token também ficam bloqueados
    const meWithRotated = await apiRequest("/auth/me", {
      token: rotated.body.accessToken,
    });
    assert.equal(meWithRotated.status, 401);
    assert.equal(meWithRotated.body.code, "SESSION_REVOKED");

    const refreshWithRotated = await apiRequest("/auth/refresh", {
      method: "POST",
      body: { refreshToken: rotated.body.refreshToken },
    });
    assert.equal(refreshWithRotated.status, 401);
  });

  await t.test("C13 / T10: Duas renovações simultâneas com o mesmo refresh token usando conexões reais independentes ao PostgreSQL detectam reuso e revogam a sessão", async () => {
    const email = `conc-refresh-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!ConcRefresh#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Refresh Concorrente", email, password },
    });
    assert.equal(reg.status, 201);

    // Criar dois pools independentes ao PostgreSQL para garantir duas conexões reais distintas disputando o lock
    const poolA = new Pool({ connectionString, max: 2 });
    const poolB = new Pool({ connectionString, max: 2 });
    const noOpLimiter = {
      checkAllowed: () => undefined,
      recordFailure: () => undefined,
      reset: () => undefined,
      clearAll: () => undefined,
    } as never;

    const serviceA = new AuthService(poolA, noOpLimiter);
    const serviceB = new AuthService(poolB, noOpLimiter);

    try {
      const results = await Promise.allSettled([
        serviceA.refresh({ refreshToken: reg.body.refreshToken }),
        serviceB.refresh({ refreshToken: reg.body.refreshToken }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exatamente uma chamada vence o lock e rotaciona; a segunda enxerga consumed_at preenchido após o lock e revoga a sessão!
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);

      const sessionState = await pool.query<{
        revoked_at: Date | null;
        revocation_reason: string | null;
      }>("SELECT revoked_at, revocation_reason FROM sessions WHERE user_id = $1", [
        reg.body.user.id,
      ]);
      assert.notEqual(sessionState.rows[0].revoked_at, null);
      assert.equal(
        sessionState.rows[0].revocation_reason,
        "refresh_token_reuse_detected",
      );
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });

  await t.test("Refresh rejeita sessão expirada após o prazo de 30 dias", async () => {
    const email = `exp-refresh-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!ExpRefresh#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Sessao Expirada", email, password },
    });
    assert.equal(reg.status, 201);

    // Simular expiração da sessão no banco
    await pool.query(
      "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [reg.body.user.id],
    );

    const res = await apiRequest("/auth/refresh", {
      method: "POST",
      body: { refreshToken: reg.body.refreshToken },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "SESSION_EXPIRED");
  });

  // =========================================================================
  // 4. GUARDS, /auth/me, LOGOUT E INTERFACE COMPARTILHADA PARA EVENTS
  // =========================================================================
  await t.test("GET /auth/me retorna dados vivos do PostgreSQL (incluindo atualização de papéis e questionário)", async () => {
    const email = `me-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!MeCheck#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      accessToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Usuario Me", email, password },
    });
    assert.equal(reg.status, 201);
    const userId = reg.body.user.id;

    // Completar questionário e conceder papel staff no banco depois que o JWT já foi emitido
    const qVersionId = randomUUID();
    await pool.query(
      "INSERT INTO questionnaire_versions (id, version, definition, created_at) VALUES ($1, $2, '{}', now())",
      [qVersionId, `v-${randomUUID().slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, birth_date, gender, other_gender, education, market_knowledge, market_interest, questionnaire_version_id, completed_at, created_at, updated_at)
       VALUES ($1, '2001-04-10', 'Masculino', NULL, 'Superior', 'Sim, conheço.', 'Sim, tenho interesse.', $2, now(), now(), now())`,
      [userId, qVersionId],
    );
    const gameId = randomUUID();
    await pool.query(
      "INSERT INTO games (id, name, is_curated, created_at) VALUES ($1, $2, true, now())",
      [gameId, `Game-${gameId.slice(0, 8)}`],
    );
    await pool.query(
      "INSERT INTO user_games (user_id, game_id, created_at) VALUES ($1, $2, now())",
      [userId, gameId],
    );

    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO events (id, name, access_code_normalized, timezone, starts_at, official_ends_at, operational_deadline_at, status, external_queue_enabled, created_at, updated_at)
       VALUES ($1, 'Evento Staff', $2, 'America/Sao_Paulo', now() - interval '1 hour', now() + interval '2 hours', now() + interval '3 hours', 'open', true, now(), now())`,
      [eventId, `STF-${eventId.slice(0, 8).toUpperCase()}`],
    );
    await pool.query(
      `INSERT INTO user_roles (id, user_id, role, event_id, granted_at)
       VALUES ($1, $2, 'staff', $3, now())`,
      [randomUUID(), userId, eventId],
    );

    const meRes = await apiRequest<{
      id: string;
      roles: string[];
      hasCompletedQuestionnaire: boolean;
    }>("/auth/me", {
      token: reg.body.accessToken,
    });

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.id, userId);
    assert.deepEqual(meRes.body.roles, ["participante", "staff"]);
    assert.equal(meRes.body.hasCompletedQuestionnaire, true);
  });

  await t.test("Guard rejeita access token ausente, malformado, adulterado ou expirado", async () => {
    const missing = await apiRequest("/auth/me");
    assert.equal(missing.status, 401);
    assert.equal(missing.body.code, "MISSING_ACCESS_TOKEN");

    const tampered = await apiRequest("/auth/me", {
      token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.assinaturaInvalida",
    });
    assert.equal(tampered.status, 401);
    assert.equal(tampered.body.code, "INVALID_ACCESS_TOKEN");

    const expiredJwt = signAccessToken(
      { userId: randomUUID(), sessionId: randomUUID() },
      { nowMs: Date.now() - 20 * 60_000, ttlSeconds: 60 },
    );
    const expiredRes = await apiRequest("/auth/me", { token: expiredJwt });
    assert.equal(expiredRes.status, 401);
    assert.equal(expiredRes.body.code, "ACCESS_TOKEN_EXPIRED");
  });

  await t.test("POST /auth/logout revoga sessão atual, invalida refresh tokens e bloqueia novos acessos sem afetar outras contas", async () => {
    const emailA = `logout-a-${randomUUID().slice(0, 8)}@example.test`;
    const emailB = `logout-b-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Logout#${randomUUID().slice(0, 8)}`;

    const userA = await apiRequest<{
      user: { id: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Usuario A", email: emailA, password },
    });
    const userB = await apiRequest<{
      user: { id: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Usuario B", email: emailB, password },
    });

    const logoutRes = await apiRequest<{ message: string }>("/auth/logout", {
      method: "POST",
      token: userA.body.accessToken,
    });
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.message, "Sessão encerrada com sucesso.");

    // A não consegue mais acessar /auth/me nem renovar com /auth/refresh
    const meAfterLogout = await apiRequest("/auth/me", {
      token: userA.body.accessToken,
    });
    assert.equal(meAfterLogout.status, 401);
    assert.equal(meAfterLogout.body.code, "SESSION_REVOKED");

    const refreshAfterLogout = await apiRequest("/auth/refresh", {
      method: "POST",
      body: { refreshToken: userA.body.refreshToken },
    });
    assert.equal(refreshAfterLogout.status, 401);

    // B permanece autenticado e intocado
    const meB = await apiRequest<{ id: string }>("/auth/me", {
      token: userB.body.accessToken,
    });
    assert.equal(meB.status, 200);
    assert.equal(meB.body.id, userB.body.user.id);
  });

  await t.test("Interface compartilhada para Events (@RequireSessionAuth e @CurrentUserId) obtém o userId autenticado real e ignora userId arbitrário no body", async () => {
    const email = `events-guard-${randomUUID().slice(0, 8)}@example.test`;
    const password = `S3nha!Events#${randomUUID().slice(0, 8)}`;

    const reg = await apiRequest<{
      user: { id: string };
      accessToken: string;
    }>("/auth/register", {
      method: "POST",
      body: { name: "Participante Evento", email, password },
    });
    assert.equal(reg.status, 201);

    const fakeOtherUserId = randomUUID();
    const eventId = randomUUID();

    const probe = await apiRequest<{
      effectiveUserId: string;
      ignoredBodyUserId: string;
      eventId: string;
    }>("/events-auth-probe/join-probe", {
      method: "POST",
      token: reg.body.accessToken,
      body: {
        userId: fakeOtherUserId,
        eventId,
      },
    });

    assert.equal(probe.status, 201);
    assert.equal(probe.body.effectiveUserId, reg.body.user.id);
    assert.notEqual(probe.body.effectiveUserId, fakeOtherUserId);
  });
});
