import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
} from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import { ProfileQuestionnaireService } from "./profile-questionnaire.service";
import type {
  GetQuestionnaireResponseDto,
  SaveQuestionnaireResponseDto,
} from "./profile-questionnaire.types";

@Controller("profile")
@RequireSessionAuth()
export class ProfileQuestionnaireController {
  constructor(
    @Inject(ProfileQuestionnaireService)
    private readonly questionnaireService: ProfileQuestionnaireService,
  ) {}

  @Get("questionnaire")
  @HttpCode(HttpStatus.OK)
  async getQuestionnaire(
    @CurrentUserId() userId: string,
  ): Promise<GetQuestionnaireResponseDto> {
    return this.questionnaireService.getQuestionnaire(userId);
  }

  @Put("questionnaire")
  @HttpCode(HttpStatus.OK)
  async saveQuestionnaire(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ): Promise<SaveQuestionnaireResponseDto> {
    return this.questionnaireService.saveQuestionnaire(userId, body);
  }
}
