import { StaffEntryCallService } from './staff-entry-call.service';
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { AuthModule } from "../auth/auth.module";
import { ParticipantQueueIdempotencyPolicy } from "../events/participant-queue-idempotency.policy";
import { ParticipantAdmissionController } from "./participant-admission.controller";
import { ParticipationsService } from "./participations.service";
import { StaffEntryController, StaffEntryNoStoreGuard } from "./staff-entry.controller";
import { StaffEntryService } from "./staff-entry.service";
import { StaffIdempotencyPolicy } from "../events/staff-idempotency.policy";

/** Prepara as consultas de participação e reutiliza Events e a conexão Drizzle compartilhada. */
@Module({
  imports: [DatabaseModule, EventsModule, AuthModule],
  controllers: [ParticipantAdmissionController, StaffEntryController],
  providers: [StaffEntryCallService, ParticipationsService, ParticipantQueueIdempotencyPolicy, StaffEntryService, StaffEntryNoStoreGuard, StaffIdempotencyPolicy],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
