import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Query,
} from "@nestjs/common";
import { validateGamesQuery } from "./games.dto";
import { GamesService } from "./games.service";
import type { GamesCatalogResponseDto } from "./games.types";

@Controller("games")
export class GamesController {
  constructor(
    @Inject(GamesService) private readonly gamesService: GamesService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listGames(
    @Query() rawQuery: Record<string, unknown>,
  ): Promise<GamesCatalogResponseDto> {
    const dto = validateGamesQuery(rawQuery);
    return this.gamesService.listGames(dto);
  }
}
