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
import { AdminConfigurationController } from "./admin-configuration.controller";
import { AdminConfigurationService } from "./admin-configuration.service";
import { AdminConfigurationQueryService } from "./admin-configuration-query.service";

@Module({
  imports: [DatabaseModule, AuthModule, ParticipationsModule],
  controllers: [AdminExternalQueueController, AdminScheduleController, AdminCloseController, AdminConfigurationController],
  providers: [AdminExternalQueueService, AdminScheduleService, AdminCloseService, AdminIdempotencyPolicy, AdminConfigurationService, AdminConfigurationQueryService],
  exports: [AdminExternalQueueService, AdminScheduleService, AdminCloseService, AdminConfigurationService, AdminConfigurationQueryService],
})
export class AdminEventsModule {}
