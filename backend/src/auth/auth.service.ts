import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { Pool, PoolClient } from "pg";
import { ProblemException } from "../common/errors/problem.exception";
import { POSTGRES_POOL } from "../database/database.module";
import { LoginDto, RefreshDto, RegisterDto } from "./auth.dto";
import {
  AdminTwoFactorChallengeResponseDto,
  AuthenticatedPrincipal,
  AuthSessionResponseDto,
  ClientMetadata,
  LoginResponseDto,
  LogoutResponseDto,
  PublicUserDto,
  RefreshResponseDto,
  UserRoleName,
} from "./auth.types";
import { sanitizeIpAddress, sanitizeUserAgent } from "./client-metadata.util";
import { LoginRateLimiterService } from "./login-rate-limiter.service";
import { evaluatePasswordSecurity } from "./password-policy";
import { RegistrationRateLimiterService } from "./registration-rate-limiter.service";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateOpaqueRefreshToken,
  hashRefreshToken,
  SESSION_ABSOLUTE_TTL_MS,
  signAccessToken,
  signTempTwoFactorToken,
  verifyAccessToken,
} from "./token.util";

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456, // ~19 MiB (OWASP minimum recommendation for Argon2id)
  timeCost: 2,
  parallelism: 1,
};

// Hash pré-computado para mitigar enumeração por tempo quando o e-mail não existe
let dummyPasswordHashPromise: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  // Narrowing explícito em variável local: a variável de módulo é mutável e não é
  // estreitada de forma confiável pelo compilador após a atribuição.
  const cached = dummyPasswordHashPromise;
  if (cached !== null) {
    return cached;
  }
  const created: Promise<string> = argon2.hash(
    "dummy-arenago-mitigation-secret-password",
    { ...ARGON2_OPTIONS, raw: false },
  );
  dummyPasswordHashPromise = created;
  return created;
}

const ROLE_ORDER: Record<UserRoleName, number> = {
  participante: 1,
  staff: 2,
  admin: 3,
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(LoginRateLimiterService)
    private readonly rateLimiter: LoginRateLimiterService,
    @Inject(RegistrationRateLimiterService)
    private readonly registrationRateLimiter: RegistrationRateLimiterService,
  ) {}

  async register(
    dto: RegisterDto,
    metadata?: ClientMetadata,
  ): Promise<AuthSessionResponseDto> {
    // Limite aplicado antes de qualquer custo de Argon2 ou acesso ao banco.
    this.registrationRateLimiter.consume(
      dto.email,
      sanitizeIpAddress(metadata?.ipAddress),
    );

    const strength = evaluatePasswordSecurity(dto.password, {
      email: dto.email,
      name: dto.name,
    });

    if (strength.compromised) {
      throw new ProblemException({
        typeSlug: "weak-or-compromised-password",
        title: "Senha não permitida",
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: "PASSWORD_COMPROMISED_OR_COMMON",
        detail:
          strength.reason ??
          "A senha informada é muito comum ou consta em listas de senhas comprometidas.",
        invalidParams: [
          {
            name: "password",
            reason:
              strength.reason ??
              "Escolha uma senha menos previsível e que não seja de uso comum.",
          },
        ],
      });
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const clockResult = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const now = new Date(clockResult.rows[0].now);
      const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);

      const userId = randomUUID();
      try {
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, email_verified_at, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NULL, true, $5, $5)`,
          [userId, dto.name, dto.email, passwordHash, now],
        );
      } catch (error: unknown) {
        if (this.isPostgresUniqueViolation(error)) {
          throw new ProblemException({
            typeSlug: "email-already-registered",
            title: "E-mail já cadastrado",
            status: HttpStatus.CONFLICT,
            code: "EMAIL_ALREADY_REGISTERED",
            detail: "Já existe uma conta cadastrada com este endereço de e-mail.",
          });
        }
        throw error;
      }

      const roleId = randomUUID();
      await client.query(
        `INSERT INTO user_roles (id, user_id, role, event_id, granted_by, granted_at, revoked_at, revoked_by)
         VALUES ($1, $2, 'participante', NULL, NULL, $3, NULL, NULL)`,
        [roleId, userId, now],
      );

      const sessionId = randomUUID();
      const ipAddress = sanitizeIpAddress(metadata?.ipAddress);
      const userAgent = sanitizeUserAgent(metadata?.userAgent);

      await client.query(
        `INSERT INTO sessions (id, user_id, expires_at, last_activity_at, revoked_at, revocation_reason, admin_2fa_verified_at, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $4)`,
        [sessionId, userId, expiresAt, now, ipAddress, userAgent],
      );

      const { rawToken: refreshToken, tokenHash } = generateOpaqueRefreshToken();
      await client.query(
        `INSERT INTO refresh_tokens (id, session_id, token_hash, consumed_at, is_revoked, expires_at, created_at)
         VALUES ($1, $2, $3, NULL, false, $4, $5)`,
        [randomUUID(), sessionId, tokenHash, expiresAt, now],
      );

      await client.query("COMMIT");

      const accessToken = signAccessToken(
        { userId, sessionId },
        { nowMs: now.getTime() },
      );

      return {
        user: {
          id: userId,
          name: dto.name,
          email: dto.email,
          emailVerified: false,
          roles: ["participante"],
          hasCompletedQuestionnaire: false,
        },
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async login(
    dto: LoginDto,
    metadata?: ClientMetadata,
  ): Promise<LoginResponseDto> {
    const ipAddress = sanitizeIpAddress(metadata?.ipAddress);
    this.rateLimiter.checkAllowed(dto.email, ipAddress);

    const userLookup = await this.pool.query<{
      id: string;
      password_hash: string;
      is_active: boolean;
    }>(
      `SELECT id, password_hash, is_active
       FROM users
       WHERE lower(btrim(email)) = $1
       LIMIT 1`,
      [dto.email],
    );

    if (userLookup.rowCount === 0) {
      const dummyHash = await getDummyPasswordHash();
      await argon2.verify(dummyHash, dto.password).catch(() => false);
      this.rateLimiter.recordFailure(dto.email, ipAddress);
      throw this.buildInvalidCredentialsException();
    }

    const candidateUser = userLookup.rows[0];
    const passwordMatches = await argon2
      .verify(candidateUser.password_hash, dto.password)
      .catch(() => false);

    if (!passwordMatches || !candidateUser.is_active) {
      this.rateLimiter.recordFailure(dto.email, ipAddress);
      throw this.buildInvalidCredentialsException();
    }

    // Ordem canônica de bloqueio da Seção 4 da arquitetura:
    // users FOR UPDATE -> sessões anteriores -> nova sessão / refresh token
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const lockedUserResult = await client.query<{
        id: string;
        name: string;
        email: string;
        email_verified_at: Date | null;
        is_active: boolean;
      }>(
        `SELECT id, name, email, email_verified_at, is_active
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [candidateUser.id],
      );

      if (lockedUserResult.rowCount === 0 || !lockedUserResult.rows[0].is_active) {
        await client.query("ROLLBACK");
        this.rateLimiter.recordFailure(dto.email, ipAddress);
        throw this.buildInvalidCredentialsException();
      }

      const lockedUser = lockedUserResult.rows[0];
      const clockResult = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const now = new Date(clockResult.rows[0].now);

      const accountState = await this.loadAccountRolesAndQuestionnaire(
        client,
        lockedUser.id,
      );

      // Revogar qualquer sessão anterior não revogada (inclusive expirada) antes de nova emissão ou desafio 2FA
      await this.revokeActiveSessionsForUser(
        client,
        lockedUser.id,
        now,
        "replaced_by_new_login",
      );

      // Comportamento transitório seguro para contas Admin (Seção 10 da K01 e Seção 14.4 da Arquitetura):
      // O login apenas com senha NUNCA emite sessão privilegiada nem refresh token para Admin.
      if (accountState.roles.includes("admin")) {
        const totpResult = await client.query<{ is_verified: boolean }>(
          `SELECT is_verified
           FROM user_totp_credentials
           WHERE user_id = $1
           LIMIT 1`,
          [lockedUser.id],
        );

        const isTotpConfigured =
          (totpResult.rowCount ?? 0) > 0 && totpResult.rows[0].is_verified === true;

        await client.query("COMMIT");
        this.rateLimiter.reset(dto.email, ipAddress);

        const tempToken = signTempTwoFactorToken(lockedUser.id, {
          nowMs: now.getTime(),
        });

        const adminChallenge: AdminTwoFactorChallengeResponseDto = {
          requires2FA: true,
          isTotpConfigured,
          tempToken,
          message: "Informe o segundo fator para concluir o acesso.",
        };
        return adminChallenge;
      }

      const sessionId = randomUUID();
      const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
      const userAgent = sanitizeUserAgent(metadata?.userAgent);

      await client.query(
        `INSERT INTO sessions (id, user_id, expires_at, last_activity_at, revoked_at, revocation_reason, admin_2fa_verified_at, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $4)`,
        [sessionId, lockedUser.id, expiresAt, now, ipAddress, userAgent],
      );

      const { rawToken: refreshToken, tokenHash } = generateOpaqueRefreshToken();
      await client.query(
        `INSERT INTO refresh_tokens (id, session_id, token_hash, consumed_at, is_revoked, expires_at, created_at)
         VALUES ($1, $2, $3, NULL, false, $4, $5)`,
        [randomUUID(), sessionId, tokenHash, expiresAt, now],
      );

      await client.query("COMMIT");
      this.rateLimiter.reset(dto.email, ipAddress);

      const accessToken = signAccessToken(
        { userId: lockedUser.id, sessionId },
        { nowMs: now.getTime() },
      );

      return {
        user: {
          id: lockedUser.id,
          name: lockedUser.name,
          email: lockedUser.email,
          emailVerified: lockedUser.email_verified_at !== null,
          roles: accountState.roles,
          hasCompletedQuestionnaire: accountState.hasCompletedQuestionnaire,
        },
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async refresh(dto: RefreshDto): Promise<RefreshResponseDto> {
    const tokenHash = hashRefreshToken(dto.refreshToken);

    // Passo 1 (Seção 4 da arquitetura): identificar user_id / session_id sem lock pelo hash
    const initialLookup = await this.pool.query<{
      token_id: string;
      session_id: string;
      user_id: string;
    }>(
      `SELECT rt.id AS token_id, rt.session_id, s.user_id
       FROM refresh_tokens rt
       INNER JOIN sessions s ON s.id = rt.session_id
       WHERE rt.token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    if (initialLookup.rowCount === 0) {
      throw this.buildInvalidRefreshTokenException();
    }

    const { session_id: targetSessionId, user_id: targetUserId } = initialLookup.rows[0];

    // Passo 2 (Seção 4 da arquitetura):
    // users FOR UPDATE -> sessions FOR UPDATE -> refresh_tokens FOR UPDATE, revalidando tudo após os locks
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const userLock = await client.query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [targetUserId],
      );

      const sessionLock = await client.query<{
        id: string;
        user_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        admin_2fa_verified_at: Date | null;
      }>(
        `SELECT id, user_id, expires_at, revoked_at, admin_2fa_verified_at
         FROM sessions
         WHERE id = $1
         FOR UPDATE`,
        [targetSessionId],
      );

      const tokenLock = await client.query<{
        id: string;
        session_id: string;
        consumed_at: Date | null;
        is_revoked: boolean;
        expires_at: Date;
      }>(
        `SELECT id, session_id, consumed_at, is_revoked, expires_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );

      const clockResult = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const now = new Date(clockResult.rows[0].now);

      if (
        userLock.rowCount === 0 ||
        sessionLock.rowCount === 0 ||
        tokenLock.rowCount === 0
      ) {
        await client.query("ROLLBACK");
        throw this.buildInvalidRefreshTokenException();
      }

      const user = userLock.rows[0];
      const session = sessionLock.rows[0];
      const refreshRecord = tokenLock.rows[0];

      if (
        session.user_id !== user.id ||
        refreshRecord.session_id !== session.id
      ) {
        await client.query("ROLLBACK");
        throw this.buildInvalidRefreshTokenException();
      }

      // Regra de segurança aprovada (Seção 6 da K01 / C-11 / D-Auth):
      // Reapresentar um refresh token já consumido revoga imediatamente a sessão correspondente.
      if (refreshRecord.consumed_at !== null) {
        await this.revokeSessionAndTokens(
          client,
          session.id,
          now,
          "refresh_token_reuse_detected",
        );
        await client.query("COMMIT");

        throw new ProblemException({
          typeSlug: "refresh-token-reused",
          title: "Sessão revogada por segurança",
          status: HttpStatus.UNAUTHORIZED,
          code: "REFRESH_TOKEN_REUSED",
          detail:
            "Este refresh token já foi utilizado anteriormente. Por segurança, a sessão foi encerrada.",
        });
      }

      if (refreshRecord.is_revoked || session.revoked_at !== null) {
        await client.query("ROLLBACK");
        throw new ProblemException({
          typeSlug: "session-revoked",
          title: "Sessão revogada",
          status: HttpStatus.UNAUTHORIZED,
          code: "SESSION_REVOKED",
          detail: "A sessão informada encontra-se revogada. Faça login novamente.",
        });
      }

      if (!user.is_active) {
        await this.revokeSessionAndTokens(
          client,
          session.id,
          now,
          "account_deactivated",
        );
        await client.query("COMMIT");

        throw new ProblemException({
          typeSlug: "account-deactivated",
          title: "Conta desativada",
          status: HttpStatus.UNAUTHORIZED,
          code: "ACCOUNT_DEACTIVATED",
          detail: "Esta conta está desativada.",
        });
      }

      const sessionExpiresAt = new Date(session.expires_at);
      const tokenExpiresAt = new Date(refreshRecord.expires_at);

      if (now >= sessionExpiresAt || now >= tokenExpiresAt) {
        await this.revokeSessionAndTokens(
          client,
          session.id,
          now,
          "session_expired",
        );
        await client.query("COMMIT");

        throw new ProblemException({
          typeSlug: "session-expired",
          title: "Sessão expirada",
          status: HttpStatus.UNAUTHORIZED,
          code: "SESSION_EXPIRED",
          detail: "O prazo máximo da sessão expirou. Faça login novamente.",
        });
      }

      // Proteção extra para contas Admin: sessão nunca pode operar sem 2FA verificado se conta for Admin
      const accountState = await this.loadAccountRolesAndQuestionnaire(client, user.id);
      if (accountState.roles.includes("admin") && session.admin_2fa_verified_at === null) {
        await this.revokeSessionAndTokens(
          client,
          session.id,
          now,
          "admin_2fa_missing",
        );
        await client.query("COMMIT");

        throw new ProblemException({
          typeSlug: "admin-2fa-required",
          title: "Segundo fator obrigatório",
          status: HttpStatus.UNAUTHORIZED,
          code: "ADMIN_2FA_REQUIRED",
          detail: "Contas administrativas exigem verificação de segundo fator (TOTP).",
        });
      }

      // 4. Consumo definitivo do refresh token anterior
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $2
         WHERE id = $1`,
        [refreshRecord.id, now],
      );

      // 5 & 6. Geração de novo token opaco e persistência apenas do hash
      // Mantendo o prazo absoluto original da sessão (sem prorrogar expires_at)
      const { rawToken: newRefreshToken, tokenHash: newTokenHash } =
        generateOpaqueRefreshToken();

      await client.query(
        `INSERT INTO refresh_tokens (id, session_id, token_hash, consumed_at, is_revoked, expires_at, created_at)
         VALUES ($1, $2, $3, NULL, false, $4, $5)`,
        [randomUUID(), session.id, newTokenHash, sessionExpiresAt, now],
      );

      // 8. Atualização de last_activity_at sem prorrogar expires_at da sessão
      await client.query(
        `UPDATE sessions
         SET last_activity_at = $2
         WHERE id = $1`,
        [session.id, now],
      );

      await client.query("COMMIT");

      // 7. Emissão do novo access token (respeitando o teto da sessão se faltarem menos de 15 min)
      const remainingSessionSeconds = Math.max(
        1,
        Math.floor((sessionExpiresAt.getTime() - now.getTime()) / 1_000),
      );
      const effectiveAccessTtlSeconds = Math.min(
        ACCESS_TOKEN_TTL_SECONDS,
        remainingSessionSeconds,
      );

      const accessToken = signAccessToken(
        { userId: user.id, sessionId: session.id },
        { nowMs: now.getTime(), ttlSeconds: effectiveAccessTtlSeconds },
      );

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: effectiveAccessTtlSeconds,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(principal: AuthenticatedPrincipal): Promise<LogoutResponseDto> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
        [principal.userId],
      );

      const sessionResult = await client.query<{
        id: string;
        user_id: string;
        revoked_at: Date | null;
      }>(
        `SELECT id, user_id, revoked_at
         FROM sessions
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [principal.sessionId, principal.userId],
      );

      if (sessionResult.rowCount === 0) {
        await client.query("ROLLBACK");
        throw new ProblemException({
          typeSlug: "invalid-session",
          title: "Sessão inválida",
          status: HttpStatus.UNAUTHORIZED,
          code: "INVALID_SESSION",
          detail: "A sessão informada não pertence à conta autenticada.",
        });
      }

      const clockResult = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const now = new Date(clockResult.rows[0].now);

      await this.revokeSessionAndTokens(
        client,
        principal.sessionId,
        now,
        "user_logout",
      );

      await client.query("COMMIT");

      return {
        message: "Sessão encerrada com sucesso.",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  getMe(principal: AuthenticatedPrincipal): PublicUserDto {
    return {
      id: principal.userId,
      name: principal.name,
      email: principal.email,
      emailVerified: principal.emailVerified,
      roles: principal.roles,
      hasCompletedQuestionnaire: principal.hasCompletedQuestionnaire,
    };
  }

  async authenticateBearerToken(rawToken: string): Promise<AuthenticatedPrincipal> {
    const verification = verifyAccessToken(rawToken);
    if (!verification.valid) {
      const code =
        verification.reason === "EXPIRED"
          ? "ACCESS_TOKEN_EXPIRED"
          : "INVALID_ACCESS_TOKEN";
      const detail =
        verification.reason === "EXPIRED"
          ? "O token de acesso expirou."
          : "O token de acesso é inválido ou foi adulterado.";

      throw new ProblemException({
        typeSlug: "invalid-access-token",
        title: "Token de acesso inválido",
        status: HttpStatus.UNAUTHORIZED,
        code,
        detail,
      });
    }

    const { sub: userId, sid: sessionId } = verification.claims;

    const sessionQuery = await this.pool.query<{
      session_id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      admin_2fa_verified_at: Date | null;
      name: string;
      email: string;
      email_verified_at: Date | null;
      is_active: boolean;
      now: Date;
    }>(
      `SELECT
         s.id AS session_id,
         s.user_id,
         s.expires_at,
         s.revoked_at,
         s.admin_2fa_verified_at,
         u.name,
         u.email,
         u.email_verified_at,
         u.is_active,
         clock_timestamp() AS now
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2
       LIMIT 1`,
      [sessionId, userId],
    );

    if (sessionQuery.rowCount === 0) {
      throw new ProblemException({
        typeSlug: "session-not-found",
        title: "Sessão inválida",
        status: HttpStatus.UNAUTHORIZED,
        code: "INVALID_SESSION",
        detail: "A sessão associada ao token não foi encontrada.",
      });
    }

    const row = sessionQuery.rows[0];
    const now = new Date(row.now);
    const expiresAt = new Date(row.expires_at);

    if (row.revoked_at !== null) {
      throw new ProblemException({
        typeSlug: "session-revoked",
        title: "Sessão revogada",
        status: HttpStatus.UNAUTHORIZED,
        code: "SESSION_REVOKED",
        detail: "Esta sessão foi revogada. Faça login novamente.",
      });
    }

    if (now >= expiresAt) {
      throw new ProblemException({
        typeSlug: "session-expired",
        title: "Sessão expirada",
        status: HttpStatus.UNAUTHORIZED,
        code: "SESSION_EXPIRED",
        detail: "O prazo da sessão expirou. Faça login novamente.",
      });
    }

    if (!row.is_active) {
      throw new ProblemException({
        typeSlug: "account-deactivated",
        title: "Conta desativada",
        status: HttpStatus.UNAUTHORIZED,
        code: "ACCOUNT_DEACTIVATED",
        detail: "Esta conta encontra-se desativada.",
      });
    }

    const accountState = await this.loadAccountRolesAndQuestionnaire(
      this.pool,
      row.user_id,
    );

    // Regra de segurança da Seção 10: Admin sem TOTP verificado nunca pode usar sessão como acesso autenticado
    if (accountState.roles.includes("admin") && row.admin_2fa_verified_at === null) {
      throw new ProblemException({
        typeSlug: "admin-2fa-required",
        title: "Segundo fator obrigatório",
        status: HttpStatus.UNAUTHORIZED,
        code: "ADMIN_2FA_REQUIRED",
        detail: "Sessão administrativa exige verificação de segundo fator (TOTP).",
      });
    }

    return {
      userId: row.user_id,
      sessionId: row.session_id,
      name: row.name,
      email: row.email,
      emailVerified: row.email_verified_at !== null,
      roles: accountState.roles,
      staffEventIds: accountState.staffEventIds,
      hasCompletedQuestionnaire: accountState.hasCompletedQuestionnaire,
      admin2faVerifiedAt: row.admin_2fa_verified_at
        ? new Date(row.admin_2fa_verified_at)
        : null,
    };
  }

  private async loadAccountRolesAndQuestionnaire(
    db: Pool | PoolClient,
    userId: string,
  ): Promise<{
    roles: UserRoleName[];
    staffEventIds: string[];
    hasCompletedQuestionnaire: boolean;
  }> {
    const rolesResult = await db.query<{
      role: UserRoleName;
      event_id: string | null;
    }>(
      `SELECT role, event_id
       FROM user_roles
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    const roleSet = new Set<UserRoleName>();
    const staffEventIds: string[] = [];

    for (const row of rolesResult.rows) {
      roleSet.add(row.role);
      if (row.role === "staff" && row.event_id) {
        staffEventIds.push(row.event_id);
      }
    }

    const roles = Array.from(roleSet).sort(
      (a, b) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99),
    );

    const profileResult = await db.query<{ completed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM profiles p
         INNER JOIN user_games ug ON ug.user_id = p.user_id
         WHERE p.user_id = $1 AND p.completed_at IS NOT NULL
       ) AS completed`,
      [userId],
    );

    const hasCompletedQuestionnaire =
      profileResult.rows[0]?.completed === true;

    return {
      roles,
      staffEventIds,
      hasCompletedQuestionnaire,
    };
  }

  private async revokeActiveSessionsForUser(
    client: PoolClient,
    userId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    const activeSessions = await client.query<{ id: string }>(
      `SELECT id
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL
       FOR UPDATE`,
      [userId],
    );

    if ((activeSessions.rowCount ?? 0) === 0) {
      return;
    }

    const sessionIds = activeSessions.rows.map((s) => s.id);

    await client.query(
      `UPDATE sessions
       SET revoked_at = $2,
           revocation_reason = $3
       WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [sessionIds, now, reason],
    );

    await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = true
       WHERE session_id = ANY($1::uuid[]) AND is_revoked = false`,
      [sessionIds],
    );
  }

  private async revokeSessionAndTokens(
    client: PoolClient,
    sessionId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, $2),
           revocation_reason = COALESCE(revocation_reason, $3)
       WHERE id = $1`,
      [sessionId, now, reason],
    );

    await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = true
       WHERE session_id = $1 AND is_revoked = false`,
      [sessionId],
    );
  }

  private buildInvalidCredentialsException(): ProblemException {
    return new ProblemException({
      typeSlug: "invalid-credentials",
      title: "Credenciais inválidas",
      status: HttpStatus.UNAUTHORIZED,
      code: "INVALID_CREDENTIALS",
      detail: "E-mail ou senha inválidos.",
    });
  }

  private buildInvalidRefreshTokenException(): ProblemException {
    return new ProblemException({
      typeSlug: "invalid-refresh-token",
      title: "Refresh token inválido",
      status: HttpStatus.UNAUTHORIZED,
      code: "INVALID_REFRESH_TOKEN",
      detail: "O refresh token informado é inválido ou não foi reconhecido.",
    });
  }

  private isPostgresUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
    );
  }
}
