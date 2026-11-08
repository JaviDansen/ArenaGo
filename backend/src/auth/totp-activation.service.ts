import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { POSTGRES_POOL } from "../database/database.module";
import { environment } from "../config/environment";
import { ProblemException } from "../common/errors/problem.exception";
import { verifyTotpChallenge } from "./totp-challenge";
import {
  decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret,
  hashActivationToken, readTotpKeys, totpUri, verifyTotpCode, type TotpKeys,
} from "./totp-activation.crypto";

export interface TotpActivationInput { tempToken: string; activationToken: string }
export interface ActivationConfirmed { activated: true; recoveryCodes: string[] }
interface Account { id: string; email: string; active: boolean; verified: boolean }
interface Credential { id: string; secret_encrypted: string; is_verified: boolean }
interface Authorization { id: string; expires_at: Date }

function problem(status: number, code: string): ProblemException {
  return new ProblemException({ status, code, typeSlug: "totp-activation", title: "Ativação TOTP",
    detail: "Não foi possível concluir a operação de ativação TOTP.",
    ...(status === 429 ? { headers: { "Retry-After": "900" } } : {}),
  });
}

@Injectable()
export class TotpActivationService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  private keys(): TotpKeys {
    try { return readTotpKeys({ ...process.env, JWT_SECRET: environment.JWT_SECRET, JWT_TEMP_SECRET: environment.JWT_TEMP_SECRET }); }
    catch { throw problem(503, "TOTP_CONFIGURATION_UNAVAILABLE"); }
  }

  /** Emissão restrita: nenhum controller expõe este método. */
  async issue(email: string): Promise<{ activationToken: string; expiresAt: string }> {
    if (typeof email !== "string" || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw problem(400, "VALIDATION_ERROR");
    }
    this.keys();
    return this.transaction(async client => {
      const user = await this.lockAccount(client, "email", email.trim().toLowerCase());
      await this.lockBootstrapRole(client, user.id);
      const credential = await this.lockCredential(client, user.id);
      await this.requireInitialActivation(client, user.id, credential);
      await client.query("UPDATE totp_activation_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL", [user.id]);
      // A autorização nova invalida também o segredo pendente vinculado à anterior.
      await client.query("DELETE FROM user_totp_credentials WHERE user_id=$1 AND is_verified=false", [user.id]);
      const raw = randomBytes(32).toString("base64url");
      const result = await client.query<{ expires_at: Date }>(`INSERT INTO totp_activation_tokens
        (id,user_id,token_hash,issued_by,expires_at,used_at,revoked_at,created_at)
        VALUES($1,$2,$3,NULL,clock_timestamp()+interval '30 minutes',NULL,NULL,clock_timestamp()) RETURNING expires_at`,
      [randomUUID(), user.id, hashActivationToken(raw)]);
      if (result.rowCount !== 1) throw new Error("Autorização não persistida.");
      await this.audit(client, user.id, "totp_initial_authorization_issued", "cli");
      return { activationToken: raw, expiresAt: new Date(result.rows[0].expires_at).toISOString() };
    });
  }

  async setup(input: TotpActivationInput): Promise<{ secret: string; otpauthUri: string }> {
    const claims = this.challenge(input.tempToken, Date.now());
    const keys = this.keys();
    return this.transaction(async client => {
      const user = await this.lockAccount(client, "id", claims.sub);
      await this.lockBootstrapRole(client, user.id);
      const credential = await this.lockCredential(client, user.id);
      await this.requireInitialActivation(client, user.id, credential);
      const authorization = await this.lockAuthorization(client, user.id, input.activationToken);
      await this.checkTime(client, input.tempToken, authorization);
      await this.limit(client, user.id, "totp_initial_setup");
      let secret: string;
      if (credential) {
        secret = this.decrypt(credential, keys, user.id, authorization.id);
      } else {
        secret = generateTotpSecret();
        await client.query(`INSERT INTO user_totp_credentials(id,user_id,secret_encrypted,is_verified,verified_at,created_at,updated_at)
          VALUES($1,$2,$3,false,NULL,clock_timestamp(),clock_timestamp())`,
        [randomUUID(), user.id, encryptTotpSecret(secret, keys.encryption, user.id, authorization.id)]);
      }
      await this.audit(client, user.id, "totp_initial_setup", "user");
      await this.checkTime(client, input.tempToken, authorization);
      return { secret, otpauthUri: totpUri(secret, user.email) };
    });
  }

  async confirm(input: TotpActivationInput & { code: string }): Promise<ActivationConfirmed> {
    const claims = this.challenge(input.tempToken, Date.now());
    const keys = this.keys();
    const result = await this.transaction<ActivationConfirmed | { error: ProblemException }>(async client => {
      const user = await this.lockAccount(client, "id", claims.sub);
      await this.lockBootstrapRole(client, user.id);
      const credential = await this.lockCredential(client, user.id);
      await this.requireInitialActivation(client, user.id, credential);
      const authorization = await this.lockAuthorization(client, user.id, input.activationToken);
      const now = await this.checkTime(client, input.tempToken, authorization);
      if (!credential) throw problem(409, "TOTP_SETUP_REQUIRED");
      await this.limit(client, user.id, "totp_initial_code_rejected");
      const secret = this.decrypt(credential, keys, user.id, authorization.id);
      if (!verifyTotpCode(secret, input.code, now)) {
        // Persistir a falha antes de responder 400: rollback não pode zerar o limite.
        await this.audit(client, user.id, "totp_initial_code_rejected", "user");
        return { error: problem(400, "TOTP_CODE_INVALID") };
      }
      const backups = await client.query("SELECT 1 FROM user_backup_codes WHERE user_id=$1 LIMIT 1", [user.id]);
      if (backups.rowCount) throw problem(409, "TOTP_ALREADY_ACTIVATED");
      const codes = generateRecoveryCodes(user.id, keys.recovery);
      await client.query("UPDATE user_totp_credentials SET is_verified=true,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", [credential.id]);
      await client.query("UPDATE totp_activation_tokens SET used_at=clock_timestamp() WHERE id=$1", [authorization.id]);
      for (const code of codes) {
        await client.query("INSERT INTO user_backup_codes(id,user_id,code_hash,used_at,created_at) VALUES($1,$2,$3,NULL,clock_timestamp())",
          [randomUUID(), user.id, code.hash]);
      }
      await this.audit(client, user.id, "totp_initial_activated", "user");
      await this.checkTime(client, input.tempToken, authorization);
      return { activated: true as const, recoveryCodes: codes.map(code => code.raw) };
    });
    if ("error" in result) throw result.error;
    return result;
  }

  private challenge(token: string, now: number) {
    const claims = verifyTotpChallenge(token, now);
    if (!claims) throw problem(401, "TOTP_CHALLENGE_INVALID");
    return claims;
  }

  private async lockAccount(client: PoolClient, by: "email" | "id", value: string): Promise<Account> {
    // A coluna vem somente da união interna acima, nunca de input HTTP.
    const result = await client.query<Account>(`SELECT id,email,is_active AS active,email_verified_at IS NOT NULL AS verified
      FROM users WHERE ${by}=$1 FOR UPDATE`, [value]);
    const user = result.rows[0];
    if (!user || !user.active || !user.verified) throw problem(403, "TOTP_ACTIVATION_FORBIDDEN");
    return user;
  }

  private async lockBootstrapRole(client: PoolClient, userId: string): Promise<void> {
    const role = await client.query(`SELECT r.id FROM user_roles r WHERE r.user_id=$1 AND r.role='admin'
      AND r.event_id IS NULL AND r.revoked_at IS NULL AND r.granted_by IS NULL
      AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.target_user_id=r.user_id AND a.actor_user_id IS NULL
        AND a.origin='cli' AND a.category='identity' AND a.action='first_admin_bootstrapped'
        AND a.event_id IS NULL AND a.occurred_at=r.granted_at)
      FOR UPDATE OF r`, [userId]);
    if (role.rowCount !== 1) throw problem(403, "TOTP_ACTIVATION_FORBIDDEN");
  }

  private async lockCredential(client: PoolClient, userId: string): Promise<Credential | undefined> {
    const result = await client.query<Credential>("SELECT id,secret_encrypted,is_verified FROM user_totp_credentials WHERE user_id=$1 FOR UPDATE", [userId]);
    return result.rows[0];
  }

  private async requireInitialActivation(client: PoolClient, userId: string, credential: Credential | undefined): Promise<void> {
    if (credential?.is_verified) throw problem(409, "TOTP_ALREADY_ACTIVATED");
    const history = await client.query("SELECT 1 FROM audit_logs WHERE target_user_id=$1 AND action='totp_initial_activated' AND category='identity' LIMIT 1", [userId]);
    if (history.rowCount) throw problem(409, "TOTP_ALREADY_ACTIVATED");
  }

  private async lockAuthorization(client: PoolClient, userId: string, raw: string): Promise<Authorization> {
    if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw problem(403, "TOTP_AUTHORIZATION_INVALID");
    const result = await client.query<Authorization>(`SELECT id,expires_at FROM totp_activation_tokens
      WHERE user_id=$1 AND token_hash=$2 AND issued_by IS NULL AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE`,
    [userId, hashActivationToken(raw)]);
    if (result.rowCount !== 1) throw problem(403, "TOTP_AUTHORIZATION_INVALID");
    return result.rows[0];
  }

  private async checkTime(client: PoolClient, token: string, authorization: Authorization): Promise<number> {
    const result = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = new Date(result.rows[0].now).getTime();
    if (!Number.isFinite(now)) throw new Error("Relógio indisponível.");
    this.challenge(token, now);
    const expiresAt = new Date(authorization.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw problem(403, "TOTP_AUTHORIZATION_INVALID");
    return now;
  }

  private async limit(client: PoolClient, userId: string, action: string): Promise<void> {
    const result = await client.query<{ count: number }>(`SELECT count(*)::integer AS count FROM audit_logs
      WHERE target_user_id=$1 AND category='identity' AND action=$2 AND occurred_at>clock_timestamp()-interval '15 minutes'`, [userId, action]);
    if (result.rows[0].count >= 5) throw problem(429, "TOTP_ACTIVATION_RATE_LIMITED");
  }

  private decrypt(credential: Credential, keys: TotpKeys, userId: string, authorizationId: string): string {
    try { return decryptTotpSecret(credential.secret_encrypted, keys.encryption, userId, authorizationId); }
    catch { throw problem(503, "TOTP_CONFIGURATION_UNAVAILABLE"); }
  }

  private async audit(client: PoolClient, userId: string, action: string, origin: "cli" | "user"): Promise<void> {
    const result = await client.query(`INSERT INTO audit_logs
      (id,actor_user_id,target_user_id,event_id,origin,category,action,metadata,occurred_at)
      VALUES($1,$2,$3,NULL,$4,'identity',$5,'{}'::jsonb,clock_timestamp())`,
    [randomUUID(), origin === "cli" ? null : userId, userId, origin, action]);
    if (result.rowCount !== 1) throw new Error("Auditoria não persistida.");
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof ProblemException) throw error;
      // O filtro global registra mensagens de erros inesperados: não encaminhar detalhes SQL/segredos.
      throw problem(500, "INTERNAL_SERVER_ERROR");
    } finally { client?.release(); }
  }
}
