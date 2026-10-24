import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
} from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import { ProfileService } from "./profile.service";
import type { ProfileUserDto, UpdateProfileResponseDto } from "./profile.types";

@Controller("profile")
@RequireSessionAuth()
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profileService: ProfileService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getProfile(@CurrentUserId() userId: string): Promise<ProfileUserDto> {
    return this.profileService.getProfile(userId);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ): Promise<UpdateProfileResponseDto> {
    return this.profileService.updateProfile(userId, body);
  }
}
