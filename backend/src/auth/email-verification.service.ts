import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { POSTGRES_POOL } from "../database/database.module";
import { EmailVerificationPolicy } from "./email-verification.policy";

export type IssueEmailVerificationResult =
  | { kind: "issued"; token: string; email: string; expiresAt: string }
  | { kind: "account_unavailable" | "already_verified" | "cooldown" | "rate_limited" };
export type ConfirmEmailVerificationResult = { kind: "verified" | "invalid_token" };

export function generateEmailVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashEmailVerificationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function isEmailVerificationToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
    && Buffer.from(token, "base64url").toString("base64url") === token;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Núcleo interno: nenhum endpoint, entrega de mensagem, sessão ou concessão. */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(EmailVerificationPolicy) private readonly policy: EmailVerificationPolicy,
  ) {}

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Usuário primeiro, tokens ordenados depois; relógio somente após todas as esperas. */
  private async lockAccount(client: PoolClient, userId: string) {
    const user = (await client.query<{ email: string; active: boolean; verified: boolean }>(
      `SELECT email, is_active AS active, email_verified_at IS NOT NULL AS verified
       FROM users WHERE id=$1::uuid FOR UPDATE`, [userId],
    )).rows[0];
    if (user) await client.query(
      "SELECT id FROM email_verification_tokens WHERE user_id=$1::uuid ORDER BY id FOR UPDATE", [userId],
    );
    return user;
  }

  /** Token bruto só sai após COMMIT, para o futuro distribuidor interno confiável. */
  async issue(userId: string): Promise<IssueEmailVerificationResult> {
    if (typeof userId !== "string" || !uuid.test(userId)) return { kind: "account_unavailable" };
    return this.transaction(async client => {
      const user = await this.lockAccount(client, userId);
      if (!user?.active) return { kind: "account_unavailable" };
      if (user.verified) return { kind: "already_verified" };
      const { ttlSeconds, cooldownSeconds, maxPerHour } = this.policy.limits;
      const decision = (await client.query<{ at: string; cooldown: boolean; limited: boolean }>(
        `WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
         SELECT d.at::text AS at,
           EXISTS(SELECT 1 FROM email_verification_tokens t WHERE t.user_id=$1::uuid
             AND t.created_at > d.at - $2::integer * interval '1 second') AS cooldown,
           (SELECT count(*) FROM email_verification_tokens t WHERE t.user_id=$1::uuid
             AND t.created_at > d.at - interval '1 hour') >= $3::integer AS limited
         FROM decision d`, [userId, cooldownSeconds, maxPerHour],
      )).rows[0];
      if (!decision) throw new Error("Decisão de emissão indisponível.");
      if (decision.cooldown) return { kind: "cooldown" };
      if (decision.limited) return { kind: "rate_limited" };
      await this.invalidate(client, userId, decision.at);
      const token = generateEmailVerificationToken();
      const inserted = await client.query<{ expiresAt: string }>(
        `INSERT INTO email_verification_tokens(id,user_id,email,token_hash,expires_at,created_at)
         VALUES($1::uuid,$2::uuid,$3,$4,$5::timestamptz + $6::integer * interval '1 second',$5::timestamptz)
         RETURNING expires_at::text AS "expiresAt"`,
        [randomUUID(), userId, user.email, hashEmailVerificationToken(token), decision.at, ttlSeconds],
      );
      if (inserted.rowCount !== 1) throw new Error("Emissão de verificação não persistida.");
      return { kind: "issued", token, email: user.email, expiresAt: inserted.rows[0].expiresAt };
    });
  }

  async confirm(token: unknown): Promise<ConfirmEmailVerificationResult> {
    if (!isEmailVerificationToken(token)) return { kind: "invalid_token" };
    const hash = hashEmailVerificationToken(token);
    // Descoberta sem lock: identidade, endereço e validade são reavaliados dentro da transação.
    const target = (await this.pool.query<{ userId: string }>(
      'SELECT user_id AS "userId" FROM email_verification_tokens WHERE token_hash=$1', [hash],
    )).rows[0];
    if (!target) return { kind: "invalid_token" };
    return this.transaction(async client => {
      const user = await this.lockAccount(client, target.userId);
      if (!user?.active || user.verified) return { kind: "invalid_token" };
      const consumed = await client.query<{ at: string }>(
        `WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
         UPDATE email_verification_tokens t SET verified_at=d.at
         FROM users u, decision d
         WHERE t.token_hash=$1 AND t.user_id=$2::uuid AND u.id=t.user_id
           AND t.email=u.email AND u.is_active AND u.email_verified_at IS NULL
           AND t.verified_at IS NULL AND t.expires_at>d.at
         RETURNING t.verified_at::text AS at`, [hash, target.userId],
      );
      if (!consumed.rowCount) return { kind: "invalid_token" };
      if (consumed.rowCount !== 1) throw new Error("Consumo de verificação inconsistente.");
      const at = consumed.rows[0].at;
      const updated = await client.query(
        `UPDATE users SET email_verified_at=$2::timestamptz, updated_at=$2::timestamptz
         WHERE id=$1::uuid AND is_active AND email_verified_at IS NULL RETURNING id`, [target.userId, at],
      );
      if (updated.rowCount !== 1) throw new Error("Confirmação de verificação não persistida.");
      await this.invalidate(client, target.userId, at);
      return { kind: "verified" };
    });
  }

  /** Expiração antecipada preserva created_at para a janela móvel; não finge consumo. */
  private async invalidate(client: PoolClient, userId: string, at: string): Promise<void> {
    await client.query(
      `UPDATE email_verification_tokens SET expires_at=$2::timestamptz
       WHERE user_id=$1::uuid AND verified_at IS NULL AND expires_at>$2::timestamptz`, [userId, at],
    );
  }
}
