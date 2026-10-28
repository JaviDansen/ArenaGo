export const CURATED_GAMES: readonly string[] = [
  "Apex Legends",
  "Call of Duty: Warzone",
  "Counter-Strike 2",
  "Cyberpunk 2077",
  "Dota 2",
  "EA Sports FC 24",
  "Elden Ring",
  "Fortnite",
  "Free Fire",
  "Genshin Impact",
  "Grand Theft Auto V",
  "League of Legends",
  "Minecraft",
  "Overwatch 2",
  "PUBG: Battlegrounds",
  "Rainbow Six Siege",
  "Roblox",
  "Rocket League",
  "The Witcher 3",
  "Valorant",
];

export interface GameCatalogItemDto {
  id: string;
  name: string;
  isCurated: boolean;
}

/**
 * Resposta de GET /api/v1/games.
 *
 * Semântica documentada de `total`:
 * Representa o total de jogos persistidos no catálogo que atendem ao filtro `query`
 * (contagem total antes da aplicação de `limit`), enquanto `games` contém até `limit`
 * itens ordenados de forma estável (`is_curated DESC, lower(btrim(name)) ASC, name ASC, id ASC`).
 */
export interface GamesCatalogResponseDto {
  games: GameCatalogItemDto[];
  total: number;
}

export interface ResolvedGameRecord {
  id: string;
  name: string;
}

export interface SeedCuratedGamesResult {
  insertedCount: number;
  totalCurated: number;
}
