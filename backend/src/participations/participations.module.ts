import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { AuthModule } from "../auth/auth.module";
import { ParticipantQueueIdempotencyPolicy } from "../events/participant-queue-idempotency.policy";
import { ParticipantAdmissionController } from "./participant-admission.controller";
import { ParticipationsService } from "./participations.service";

/** Prepara as consultas de participação e reutiliza Events e a conexão Drizzle compartilhada. */
@Module({
  imports: [DatabaseModule, EventsModule, AuthModule],
  controllers: [ParticipantAdmissionController],
  providers: [ParticipationsService, ParticipantQueueIdempotencyPolicy],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
