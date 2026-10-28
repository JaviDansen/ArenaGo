import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { ProblemException } from "../common/errors/problem.exception";
import { POSTGRES_POOL } from "../database/database.module";
import { ListGamesQueryDto } from "./games.dto";
import {
  CURATED_GAMES,
  GameCatalogItemDto,
  GamesCatalogResponseDto,
  ResolvedGameRecord,
  SeedCuratedGamesResult,
} from "./games.types";

export function normalizeGameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function deduplicateGameNames(names: string[]): string[] {
  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const raw of names) {
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(trimmed);
    }
  }

  return deduplicated;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

@Injectable()
export class GamesService implements OnModuleInit {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    await this.seedCuratedGames();
  }

  /**
   * Rotina de seed/bootstrap reproduzível e idempotente para os 20 jogos do catálogo inicial.
   * Insere exclusivamente os jogos que ainda não existirem (ON CONFLICT DO NOTHING).
   * Não sobrescreve decisões administrativas legítimas sobre `is_curated` (não força `true`
   * em jogos desmarcados por administradores nem desmarca jogos promovidos pela administração).
   */
  async seedCuratedGames(
    db: Pool | PoolClient = this.pool,
  ): Promise<SeedCuratedGamesResult> {
    let insertedCount = 0;

    for (const canonicalName of CURATED_GAMES) {
      const insertRes = await db.query<{ id: string }>(
        `INSERT INTO games (id, name, is_curated, created_by_user_id, created_at)
         VALUES ($1, $2, true, NULL, clock_timestamp())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [randomUUID(), canonicalName],
      );

      if ((insertRes.rowCount ?? 0) > 0) {
        insertedCount += 1;
      }
    }

    const totalRes = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM games
       WHERE is_curated = true`,
    );

    return {
      insertedCount,
      totalCurated: totalRes.rows[0]?.count ?? 0,
    };
  }

  /**
   * Consulta o catálogo persistido de jogos com filtro opcional case-insensitive (`query`)
   * e limite (`limit` de 1 a 50, padrão 20).
   *
   * Ordenação estável:
   * 1. `is_curated DESC` (jogos curados primeiro)
   * 2. `lower(btrim(name)) ASC` (ordem alfabética insensível a caixa)
   * 3. `name ASC`
   * 4. `id ASC` (desempate determinístico)
   *
   * Semântica de `total`:
   * Quantidade total de registros no catálogo que satisfazem o filtro `query`
   * (antes da aplicação de `LIMIT`), sem expor metadados privados de usuários.
   */
  async listGames(dto: ListGamesQueryDto): Promise<GamesCatalogResponseDto> {
    const hasQuery = typeof dto.query === "string" && dto.query.trim().length > 0;
    const likePattern = hasQuery
      ? `%${escapeLikePattern(dto.query!.trim().toLowerCase())}%`
      : null;

    const countQuery = hasQuery
      ? await this.pool.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM games
           WHERE lower(btrim(name)) LIKE $1 ESCAPE '\\'`,
          [likePattern],
        )
      : await this.pool.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM games`,
        );

    const rowsQuery = hasQuery
      ? await this.pool.query<{
          id: string;
          name: string;
          is_curated: boolean;
        }>(
          `SELECT id, name, is_curated
           FROM games
           WHERE lower(btrim(name)) LIKE $1 ESCAPE '\\'
           ORDER BY is_curated DESC, lower(btrim(name)) ASC, name ASC, id ASC
           LIMIT $2`,
          [likePattern, dto.limit],
        )
      : await this.pool.query<{
          id: string;
          name: string;
          is_curated: boolean;
        }>(
          `SELECT id, name, is_curated
           FROM games
           ORDER BY is_curated DESC, lower(btrim(name)) ASC, name ASC, id ASC
           LIMIT $1`,
          [dto.limit],
        );

    const games: GameCatalogItemDto[] = rowsQuery.rows.map((row) => ({
      id: row.id,
      name: row.name,
      isCurated: row.is_curated,
    }));

    return {
      games,
      total: countQuery.rows[0]?.total ?? 0,
    };
  }

  /**
   * Resolve ou insere jogos personalizados dentro de uma transação em `READ COMMITTED`.
   *
   * Estratégia de concorrência e deduplicação (Seção 2.1.04 e Seção 14.10 da Arquitetura):
   * 1. Deduplica nomes por `lower(btrim(name))` preservando a primeira grafia informada.
   * 2. Ordena as chaves normalizadas em ordem ascendente para adquirir locks de índice
   *    em ordem determinística, prevenindo deadlocks entre transações simultâneas.
   * 3. Executa `INSERT INTO games ... ON CONFLICT DO NOTHING RETURNING id, name`.
   * 4. Caso `RETURNING` venha vazio (jogo já existente ou inserido concorrentemente),
   *    executa `SELECT id, name FROM games WHERE lower(btrim(name)) = lower(btrim($1))`
   *    em **comando SQL separado** (novo snapshot de statement em `READ COMMITTED`),
   *    preservando sempre a grafia canônica já cadastrada.
   */
  async resolveOrCreateGamesInTransaction(
    client: PoolClient,
    gameNames: string[],
    createdByUserId: string,
    now: Date,
  ): Promise<ResolvedGameRecord[]> {
    const deduplicated = deduplicateGameNames(gameNames);
    const sortedByNormalized = [...deduplicated].sort((a, b) => {
      const keyA = normalizeGameKey(a);
      const keyB = normalizeGameKey(b);
      if (keyA < keyB) return -1;
      if (keyA > keyB) return 1;
      return 0;
    });

    const resolvedByKey = new Map<string, ResolvedGameRecord>();

    for (const candidateName of sortedByNormalized) {
      const normalizedKey = normalizeGameKey(candidateName);
      let resolved: ResolvedGameRecord | null = null;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const insertRes = await client.query<{ id: string; name: string }>(
          `INSERT INTO games (id, name, is_curated, created_by_user_id, created_at)
           VALUES ($1, $2, false, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING id, name`,
          [randomUUID(), candidateName, createdByUserId, now],
        );

        if ((insertRes.rowCount ?? 0) > 0) {
          resolved = {
            id: insertRes.rows[0].id,
            name: insertRes.rows[0].name,
          };
          break;
        }

        // Comando SQL separado em READ COMMITTED para enxergar linha recém-confirmada
        const selectRes = await client.query<{ id: string; name: string }>(
          `SELECT id, name
           FROM games
           WHERE lower(btrim(name)) = lower(btrim($1))
           LIMIT 1`,
          [candidateName],
        );

        if ((selectRes.rowCount ?? 0) > 0) {
          resolved = {
            id: selectRes.rows[0].id,
            name: selectRes.rows[0].name,
          };
          break;
        }
      }

      if (!resolved) {
        throw new ProblemException({
          typeSlug: "game-resolution-conflict",
          title: "Conflito ao registrar jogo",
          status: HttpStatus.CONFLICT,
          code: "GAME_RESOLUTION_CONFLICT",
          detail: `Não foi possível resolver o registro canônico do jogo "${candidateName}".`,
        });
      }

      resolvedByKey.set(normalizedKey, resolved);
    }

    // Preservar a ordem original deduplicada ou retornar os registros resolvidos únicos
    return deduplicated.map((name) => resolvedByKey.get(normalizeGameKey(name))!);
  }
}
