import { Pool, PoolClient } from "pg";
import { environment } from "../config/environment";
import { GamesService } from "../games/games.service";
import { SeedCuratedGamesResult } from "../games/games.types";
import { ProfileQuestionnaireService } from "../profile/profile-questionnaire.service";

export interface DatabaseSeedResult {
  questionnaireVersion: { id: string; version: string };
  games: SeedCuratedGamesResult;
}

/**
 * Executa de forma reproduzível e idempotente o seed inicial:
 * 1. Versão publicada `1.0.0` em `questionnaire_versions`.
 * 2. Os 20 jogos curados em `games` (`is_curated = true`).
 */
export async function runDatabaseSeed(
  pool: Pool,
  dbClientOrPool: Pool | PoolClient = pool,
): Promise<DatabaseSeedResult> {
  const gamesService = new GamesService(pool);
  const questionnaireService = new ProfileQuestionnaireService(
    pool,
    gamesService,
  );

  const questionnaireVersion =
    await questionnaireService.seedPublishedQuestionnaireVersion(dbClientOrPool);
  const games = await gamesService.seedCuratedGames(dbClientOrPool);

  return {
    questionnaireVersion,
    games,
  };
}

if (require.main === module) {
  const pool = new Pool({ connectionString: environment.DATABASE_URL });
  runDatabaseSeed(pool)
    .then(async (res) => {
      console.log(
        `Seed concluído com sucesso: questionnaire_version=${res.questionnaireVersion.version} (${res.questionnaireVersion.id}), curatedGames=${res.games.totalCurated} (inseridos=${res.games.insertedCount}).`,
      );
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error("Erro ao executar seed:", err);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
