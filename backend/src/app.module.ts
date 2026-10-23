import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { ProblemDetailsExceptionFilter } from "./common/errors/problem-details.filter";
import { DatabaseModule } from "./database/database.module";
import { GamesModule } from "./games/games.module";
import { ProfileModule } from "./profile/profile.module";

@Module({
  imports: [DatabaseModule, AuthModule, GamesModule, ProfileModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemDetailsExceptionFilter,
    },
  ],
})
export class AppModule {}
