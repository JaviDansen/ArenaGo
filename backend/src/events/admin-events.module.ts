import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ParticipationsModule } from "../participations/participations.module";
import { AdminExternalQueueController } from "./admin-external-queue.controller";
import { AdminExternalQueueService } from "./admin-external-queue.service";
import { AdminIdempotencyPolicy } from "./admin-idempotency.policy";
import { AdminScheduleController } from "./admin-schedule.controller";
import { AdminScheduleService } from "./admin-schedule.service";
import { AdminCloseController } from "./admin-close.controller";
import { AdminCloseService } from "./admin-close.service";

@Module({
  imports: [DatabaseModule, AuthModule, ParticipationsModule],
  controllers: [AdminExternalQueueController, AdminScheduleController, AdminCloseController],
  providers: [AdminExternalQueueService, AdminScheduleService, AdminCloseService, AdminIdempotencyPolicy],
  exports: [AdminExternalQueueService, AdminScheduleService, AdminCloseService],
})
export class AdminEventsModule {}
