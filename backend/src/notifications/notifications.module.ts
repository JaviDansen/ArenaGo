import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { DeviceTokensController } from "./device-tokens.controller";
import { DeviceTokensService } from "./device-tokens.service";
import { QueueCallPushService } from "./queue-call-push.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService, QueueCallPushService],
  exports: [DeviceTokensService, QueueCallPushService],
})
export class NotificationsModule {}
