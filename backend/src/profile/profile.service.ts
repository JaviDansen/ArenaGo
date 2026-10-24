import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { UserRoleName } from "../auth/auth.types";
import { ProblemException } from "../common/errors/problem.exception";
import { POSTGRES_POOL } from "../database/database.module";
import { validateUpdateProfileDto } from "./profile.dto";
import { ProfileUserDto, UpdateProfileResponseDto } from "./profile.types";

const ROLE_ORDER: Record<UserRoleName, number> = {
  participante: 1,
  staff: 2,
  admin: 3,
};

@Injectable()
export class ProfileService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  /**
   * Consulta os dados cadastrais da própria conta autenticada (`GET /api/v1/profile`).
   * Retorna estritamente: id, name, email, emailVerified, roles, hasCompletedQuestionnaire, createdAt, updatedAt.
   */
  async getProfile(authenticatedUserId: string): Promise<ProfileUserDto> {
    const userResult = await this.pool.query<{
      id: string;
      name: string;
      email: string;
      email_verified_at: Date | null;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, email, email_verified_at, is_active, created_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [authenticatedUserId],
    );

    if ((userResult.rowCount ?? 0) === 0 || !userResult.rows[0].is_active) {
      throw new ProblemException({
        typeSlug: "user-not-found",
        title: "Usuário não encontrado",
        status: HttpStatus.UNAUTHORIZED,
        code: "INVALID_SESSION",
        detail: "A conta associada à sessão não foi encontrada ou está desativada.",
      });
    }

    const row = userResult.rows[0];
    const accountState = await this.loadAccountRolesAndQuestionnaire(
      this.pool,
      authenticatedUserId,
    );

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.email_verified_at !== null,
      roles: accountState.roles,
      hasCompletedQuestionnaire: accountState.hasCompletedQuestionnaire,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  /**
   * Atualiza o nome da conta autenticada (`PATCH /api/v1/profile`).
   * Não permite alterar e-mail, papéis ou dados do questionário.
   */
  async updateProfile(
    authenticatedUserId: string,
    rawPayload: unknown,
  ): Promise<UpdateProfileResponseDto> {
    const dto = validateUpdateProfileDto(rawPayload);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Travar linha do usuário com FOR UPDATE
      const userLock = await client.query<{
        id: string;
        is_active: boolean;
      }>(
        `SELECT id, is_active
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [authenticatedUserId],
      );

      if ((userLock.rowCount ?? 0) === 0 || !userLock.rows[0].is_active) {
        throw new ProblemException({
          typeSlug: "user-not-found",
          title: "Usuário não encontrado",
          status: HttpStatus.UNAUTHORIZED,
          code: "INVALID_SESSION",
          detail: "A conta associada à sessão não foi encontrada ou está desativada.",
        });
      }

      const updateResult = await client.query<{
        id: string;
        name: string;
        email: string;
        email_verified_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE users
         SET name = $2,
             updated_at = clock_timestamp()
         WHERE id = $1
         RETURNING id, name, email, email_verified_at, created_at, updated_at`,
        [authenticatedUserId, dto.name],
      );

      await client.query("COMMIT");

      const row = updateResult.rows[0];
      const accountState = await this.loadAccountRolesAndQuestionnaire(
        this.pool,
        authenticatedUserId,
      );

      return {
        message: "Perfil atualizado com sucesso.",
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          emailVerified: row.email_verified_at !== null,
          roles: accountState.roles,
          hasCompletedQuestionnaire: accountState.hasCompletedQuestionnaire,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadAccountRolesAndQuestionnaire(
    db: Pool | PoolClient,
    userId: string,
  ): Promise<{
    roles: UserRoleName[];
    hasCompletedQuestionnaire: boolean;
  }> {
    const rolesResult = await db.query<{ role: UserRoleName }>(
      `SELECT role
       FROM user_roles
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    const roleSet = new Set<UserRoleName>();
    for (const r of rolesResult.rows) {
      roleSet.add(r.role);
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

    return {
      roles,
      hasCompletedQuestionnaire: profileResult.rows[0]?.completed === true,
    };
  }
}
