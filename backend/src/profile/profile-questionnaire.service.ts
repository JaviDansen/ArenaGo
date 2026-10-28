import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { ProblemException } from "../common/errors/problem.exception";
import { POSTGRES_POOL } from "../database/database.module";
import { GamesService } from "../games/games.service";
import {
  getReferenceCivilTimezone,
  UpsertQuestionnaireDto,
  validateUpsertQuestionnaireDto,
} from "./profile-questionnaire.dto";
import {
  DEFAULT_QUESTIONNAIRE_DEFINITION,
  DEFAULT_QUESTIONNAIRE_VERSION,
  GetQuestionnaireResponseDto,
  ProfileEducation,
  ProfileGender,
  ProfileMarketInterest,
  ProfileMarketKnowledge,
  SaveQuestionnaireResponseDto,
} from "./profile-questionnaire.types";

@Injectable()
export class ProfileQuestionnaireService implements OnModuleInit {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(GamesService) private readonly gamesService: GamesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedPublishedQuestionnaireVersion();
  }

  /**
   * Garante de maneira idempotente que a versão publicada inicial (`1.0.0`)
   * do questionário exista em `questionnaire_versions` sem sobrescrever
   * retroativamente definições já existentes e sem reativar uma versão
   * inativada administrativamente (respeitando escolhas de publicação).
   */
  async seedPublishedQuestionnaireVersion(
    db: Pool | PoolClient = this.pool,
  ): Promise<{ id: string; version: string } | null> {
    const insertRes = await db.query<{ id: string; version: string }>(
      `INSERT INTO questionnaire_versions (id, version, definition, activated_at, created_at)
       VALUES ($1, $2, $3::jsonb, clock_timestamp(), clock_timestamp())
       ON CONFLICT (version) DO NOTHING
       RETURNING id, version`,
      [
        randomUUID(),
        DEFAULT_QUESTIONNAIRE_VERSION,
        JSON.stringify(DEFAULT_QUESTIONNAIRE_DEFINITION),
      ],
    );

    if ((insertRes.rowCount ?? 0) > 0) {
      return insertRes.rows[0];
    }

    // Se já existia, não altera seu activated_at (preserva estado inativo/ativo)
    const existing = await db.query<{ id: string; version: string }>(
      `SELECT id, version FROM questionnaire_versions WHERE version = $1`,
      [DEFAULT_QUESTIONNAIRE_VERSION],
    );
    return existing.rows[0] ?? null;
  }

  /**
   * Consulta o questionário do próprio usuário autenticado (`GET /api/v1/profile/questionnaire`).
   *
   * Regras:
   * - Ausência de perfil ou perfil sem jogos retorna HTTP 200 com `hasCompleted: false`.
   * - `birthDate` é extraída como texto civil `YYYY-MM-DD` (`birth_date::text`), sem conversão por fuso.
   * - `yourGames` devolve os nomes canônicos do catálogo ordenados de forma determinística.
   */
  async getQuestionnaire(
    authenticatedUserId: string,
  ): Promise<GetQuestionnaireResponseDto> {
    const result = await this.pool.query<{
      birth_date: string;
      gender: ProfileGender;
      other_gender: string | null;
      education: ProfileEducation;
      market_knowledge: ProfileMarketKnowledge;
      market_interest: ProfileMarketInterest;
      completed_at: Date;
      games: string[];
    }>(
      `SELECT
         p.birth_date::text AS birth_date,
         p.gender,
         p.other_gender,
         p.education,
         p.market_knowledge,
         p.market_interest,
         p.completed_at,
         COALESCE(
           ARRAY(
             SELECT g.name
             FROM user_games ug
             INNER JOIN games g ON g.id = ug.game_id
             WHERE ug.user_id = p.user_id
             ORDER BY lower(btrim(g.name)) ASC, g.name ASC, g.id ASC
           ),
           ARRAY[]::varchar[]
         ) AS games
       FROM profiles p
       WHERE p.user_id = $1 AND p.completed_at IS NOT NULL
       LIMIT 1`,
      [authenticatedUserId],
    );

    if (
      (result.rowCount ?? 0) === 0 ||
      !Array.isArray(result.rows[0].games) ||
      result.rows[0].games.length === 0
    ) {
      return {
        hasCompleted: false,
        aboutYou: null,
        yourGames: [],
        gamesMarket: null,
        completedAt: null,
      };
    }

    const row = result.rows[0];
    return {
      hasCompleted: true,
      aboutYou: {
        birthDate: row.birth_date,
        gender: row.gender,
        otherGender: row.other_gender,
        education: row.education,
      },
      yourGames: row.games,
      gamesMarket: {
        marketKnowledge: row.market_knowledge,
        marketInterest: row.market_interest,
      },
      completedAt: new Date(row.completed_at).toISOString(),
    };
  }

  /**
   * Salva ou atualiza o questionário completo de forma atômica (`PUT /api/v1/profile/questionnaire`).
   *
   * Ordem canônica de bloqueio (Seção 4 da Arquitetura):
   * `users FOR UPDATE -> profiles -> user_games`
   * Compatível com a criação de snapshots em participações (`events FOR UPDATE -> users FOR UPDATE -> profiles/user_games -> participations/snapshots`).
   */
  async saveQuestionnaire(
    authenticatedUserId: string,
    rawPayload: unknown,
  ): Promise<SaveQuestionnaireResponseDto> {
    const dto: UpsertQuestionnaireDto = validateUpsertQuestionnaireDto(rawPayload);
    const referenceTimezone = getReferenceCivilTimezone();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Bloquear a linha do usuário autenticado primeiro (users FOR UPDATE)
      // e obter o relógio autoritativo do PostgreSQL + data civil no fuso de referência.
      const userLockResult = await client.query<{
        id: string;
        is_active: boolean;
        now: Date;
        today_civil: string;
      }>(
        `SELECT
           u.id,
           u.is_active,
           clock_timestamp() AS now,
           (clock_timestamp() AT TIME ZONE $2)::date::text AS today_civil
         FROM users u
         WHERE u.id = $1
         FOR UPDATE`,
        [authenticatedUserId, referenceTimezone],
      );

      if ((userLockResult.rowCount ?? 0) === 0) {
        throw new ProblemException({
          typeSlug: "user-not-found",
          title: "Usuário não encontrado",
          status: HttpStatus.UNAUTHORIZED,
          code: "INVALID_SESSION",
          detail: "A conta associada à sessão não foi encontrada.",
        });
      }

      const lockedUser = userLockResult.rows[0];
      if (!lockedUser.is_active) {
        throw new ProblemException({
          typeSlug: "account-deactivated",
          title: "Conta desativada",
          status: HttpStatus.UNAUTHORIZED,
          code: "ACCOUNT_DEACTIVATED",
          detail: "Esta conta encontra-se desativada.",
        });
      }

      const now = new Date(lockedUser.now);
      const todayCivil = lockedUser.today_civil;

      // Revalidação temporal contra o relógio do PostgreSQL após obter o lock
      if (dto.birthDate > todayCivil) {
        throw new ProblemException({
          typeSlug: "validation-error",
          title: "Dados inválidos",
          status: HttpStatus.BAD_REQUEST,
          code: "VALIDATION_ERROR",
          detail: "Confira as informações enviadas.",
          invalidParams: [
            {
              name: "birthDate",
              reason: "A data de nascimento não pode estar no futuro.",
            },
          ],
        });
      }

      // 2. Resolver versão ativa e publicada de questionnaire_versions
      const versionId = await this.resolvePublishedQuestionnaireVersionId(
        client,
        now,
      );

      // 3. Criar ou atualizar profiles (users FOR UPDATE -> profiles)
      await client.query(
        `INSERT INTO profiles (
           user_id,
           birth_date,
           gender,
           other_gender,
           education,
           market_knowledge,
           market_interest,
           questionnaire_version_id,
           completed_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $9, $9)
         ON CONFLICT (user_id) DO UPDATE SET
           birth_date = EXCLUDED.birth_date,
           gender = EXCLUDED.gender,
           other_gender = EXCLUDED.other_gender,
           education = EXCLUDED.education,
           market_knowledge = EXCLUDED.market_knowledge,
           market_interest = EXCLUDED.market_interest,
           questionnaire_version_id = EXCLUDED.questionnaire_version_id,
           completed_at = EXCLUDED.completed_at,
           updated_at = EXCLUDED.updated_at`,
        [
          authenticatedUserId,
          dto.birthDate,
          dto.gender,
          dto.otherGender,
          dto.education,
          dto.marketKnowledge,
          dto.marketInterest,
          versionId,
          now,
        ],
      );

      // 4. Resolver os IDs dos jogos existentes ou novos no catálogo (games)
      const resolvedGames =
        await this.gamesService.resolveOrCreateGamesInTransaction(
          client,
          dto.selectedGames,
          authenticatedUserId,
          now,
        );

      const uniqueGameIds = Array.from(
        new Set(resolvedGames.map((g) => g.id)),
      ).sort();

      if (uniqueGameIds.length === 0) {
        throw new ProblemException({
          typeSlug: "validation-error",
          title: "Dados inválidos",
          status: HttpStatus.BAD_REQUEST,
          code: "VALIDATION_ERROR",
          detail: "É necessário selecionar ao menos um jogo válido.",
          invalidParams: [
            {
              name: "selectedGames",
              reason: "É necessário selecionar ao menos um jogo.",
            },
          ],
        });
      }

      // 5. Substituir os vínculos em user_games (users FOR UPDATE -> profiles -> user_games)
      await client.query(
        `DELETE FROM user_games
         WHERE user_id = $1`,
        [authenticatedUserId],
      );

      const insertedUserGames = await client.query(
        `INSERT INTO user_games (user_id, game_id, created_at)
         SELECT $1, unnest($2::uuid[]), $3`,
        [authenticatedUserId, uniqueGameIds, now],
      );

      if ((insertedUserGames.rowCount ?? 0) < 1) {
        throw new ProblemException({
          typeSlug: "questionnaire-games-empty",
          title: "Jogos obrigatórios",
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: "QUESTIONNAIRE_GAMES_REQUIRED",
          detail:
            "Não é permitido salvar um perfil completo sem ao menos um jogo vinculado.",
        });
      }

      await client.query("COMMIT");

      return {
        message: "Questionário salvo com sucesso.",
        hasCompleted: true,
        updatedAt: now.toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolvePublishedQuestionnaireVersionId(
    client: PoolClient,
    now: Date,
  ): Promise<string> {
    const publishedRes = await client.query<{ id: string }>(
      `SELECT id
       FROM questionnaire_versions
       WHERE activated_at IS NOT NULL AND activated_at <= $1
       ORDER BY activated_at DESC, created_at DESC, id ASC
       LIMIT 1`,
      [now],
    );

    if ((publishedRes.rowCount ?? 0) > 0) {
      return publishedRes.rows[0].id;
    }

    const anyVersionRes = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM questionnaire_versions`,
    );

    if ((anyVersionRes.rows[0]?.count ?? 0) === 0) {
      const seeded = await this.seedPublishedQuestionnaireVersion(client);
      if (seeded) {
        return seeded.id;
      }
    }

    throw new ProblemException({
      typeSlug: "questionnaire-version-unavailable",
      title: "Versão do questionário indisponível",
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: "QUESTIONNAIRE_VERSION_UNAVAILABLE",
      detail:
        "Não há uma versão publicada e ativa do questionário disponível para associação.",
    });
  }
}
