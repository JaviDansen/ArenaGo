import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { GamesModule } from "../games/games.module";
import { ProfileQuestionnaireController } from "./profile-questionnaire.controller";
import { ProfileQuestionnaireService } from "./profile-questionnaire.service";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";

@Module({
  imports: [DatabaseModule, AuthModule, GamesModule],
  controllers: [ProfileController, ProfileQuestionnaireController],
  providers: [ProfileService, ProfileQuestionnaireService],
  exports: [ProfileService, ProfileQuestionnaireService],
})
export class ProfileModule {}
