import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsService } from "./events.service";
import { ExperiencesService } from "./experiences.service";
import { QueueEntryService } from "./queue-entry.service";
import { QueueStateService } from "./queue-state.service";
import { QueueWithdrawalService } from "./queue-withdrawal.service";
import { CallNextService } from "./call-next.service";
import { CompleteService } from "./complete.service";
import { AbsentService } from "./absent.service";
import { AuthModule } from "../auth/auth.module";
import { StaffOperationsController } from "./staff-operations.controller";
import { StaffIdempotencyPolicy } from "./staff-idempotency.policy";
import { ParticipantQueueController } from "./participant-queue.controller";
import { ParticipantQueueIdempotencyPolicy } from "./participant-queue-idempotency.policy";
import { ExperiencesController } from "./experiences.controller";

/** Agrupa os serviços de Events e reutiliza o acesso PostgreSQL compartilhado. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StaffOperationsController, ParticipantQueueController, ExperiencesController],
  providers: [EventsService, ExperiencesService, QueueEntryService, QueueStateService, QueueWithdrawalService, CallNextService, CompleteService, AbsentService, StaffIdempotencyPolicy, ParticipantQueueIdempotencyPolicy],
  exports: [EventsService, ExperiencesService, QueueEntryService, QueueStateService, QueueWithdrawalService, CallNextService, CompleteService, AbsentService],
})
export class EventsModule {}
