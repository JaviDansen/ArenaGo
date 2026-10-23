import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { GamesModule } from "../games/games.module";
import { ProfileQuestionnaireController } from "./profile-questionnaire.controller";
import { ProfileQuestionnaireService } from "./profile-questionnaire.service";

@Module({
  imports: [DatabaseModule, AuthModule, GamesModule],
  controllers: [ProfileQuestionnaireController],
  providers: [ProfileQuestionnaireService],
  exports: [ProfileQuestionnaireService],
})
export class ProfileModule {}
