import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ParticipationsModule } from "../participations/participations.module";
import { AdminExternalQueueController } from "./admin-external-queue.controller";
import { AdminExternalQueueService } from "./admin-external-queue.service";
import { AdminIdempotencyPolicy } from "./admin-idempotency.policy";

@Module({
  imports: [DatabaseModule, AuthModule, ParticipationsModule],
  controllers: [AdminExternalQueueController],
  providers: [AdminExternalQueueService, AdminIdempotencyPolicy],
  exports: [AdminExternalQueueService],
})
export class AdminEventsModule {}
