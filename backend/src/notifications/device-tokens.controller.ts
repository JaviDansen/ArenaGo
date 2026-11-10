import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import {
  registerPushTokenSchema,
  unregisterPushTokenSchema,
  validateDto,
} from "./device-tokens.dto";
import { DeviceTokensService } from "./device-tokens.service";

@Controller("devices")
@RequireSessionAuth()
export class DeviceTokensController {
  constructor(
    @Inject(DeviceTokensService)
    private readonly deviceTokensService: DeviceTokensService,
  ) {}

  @Post("push-token")
  @HttpCode(HttpStatus.OK)
  async registerPushToken(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    const dto = validateDto(registerPushTokenSchema, body);
    return this.deviceTokensService.registerToken(userId, dto);
  }

  @Delete("push-token")
  @HttpCode(HttpStatus.OK)
  async unregisterPushToken(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    const dto = validateDto(unregisterPushTokenSchema, body);
    return this.deviceTokensService.unregisterToken(userId, dto);
  }
}
