import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ParticipationsModule } from "../participations/participations.module";
import { AdminExternalQueueController } from "./admin-external-queue.controller";
import { AdminExternalQueueService } from "./admin-external-queue.service";
import { AdminIdempotencyPolicy } from "./admin-idempotency.policy";
import { AdminScheduleController } from "./admin-schedule.controller";
import { AdminScheduleService } from "./admin-schedule.service";

@Module({
  imports: [DatabaseModule, AuthModule, ParticipationsModule],
  controllers: [AdminExternalQueueController, AdminScheduleController],
  providers: [AdminExternalQueueService, AdminScheduleService, AdminIdempotencyPolicy],
  exports: [AdminExternalQueueService, AdminScheduleService],
})
export class AdminEventsModule {}
