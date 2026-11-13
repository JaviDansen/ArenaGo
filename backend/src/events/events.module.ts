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
import { StaffQueriesController } from "./staff-queries.controller";
import { StaffQueriesService } from "./staff-queries.service";
import { StaffHistoryController, StaffHistoryNoStoreGuard } from "./staff-history.controller";
import { StaffHistoryService } from "./staff-history.service";
import { StationAvailabilityController } from "./station-availability.controller";
import { StationAvailabilityService } from "./station-availability.service";
import { EventClosureService } from "./event-closure.service";
import { EventClosurePolicy } from "./event-closure.policy";
import { EventClosureScheduler } from "./event-closure.scheduler";
import { EvaluationReadController } from "../evaluations/evaluation-read.controller";
import { EvaluationReadService } from "../evaluations/evaluation-read.service";
import { EvaluationWriteController, EvaluationWriteIdempotencyPolicy } from "../evaluations/evaluation-write.controller";
import { EvaluationWriteService } from "../evaluations/evaluation-write.service";
import { ParticipationLifecycleController } from "../participations/participation-lifecycle.controller";
import { ParticipationLifecycleService } from "../participations/participation-lifecycle.service";
import { ParticipationQueryService } from "../participations/participation-query.service";
import { ExperienceQueueControlController } from "./experience-queue-control.controller";
import { ExperienceQueueControlService } from "./experience-queue-control.service";
import { StaffStationStateController } from "./staff-station-state.controller";
import { StaffStationStateService } from "./staff-station-state.service";
import { StaffQueueRemovalController } from "./staff-queue-removal.controller";
import { StaffQueueRemovalService } from "./staff-queue-removal.service";
import { StaffCalledRemovalController } from "./staff-called-removal.controller";
import { CalledRemovalService } from "./staff-called-removal.service";
import { StaffEntryNoStoreGuard } from "../participations/staff-entry.controller";

/** Agrupa os serviços de Events e reutiliza o acesso PostgreSQL compartilhado. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StaffCalledRemovalController, EvaluationWriteController, EvaluationReadController, ParticipationLifecycleController, StaffOperationsController, StaffQueriesController, StaffHistoryController, StaffStationStateController, StaffQueueRemovalController, ExperienceQueueControlController, StationAvailabilityController, ParticipantQueueController, ExperiencesController],
  providers: [CalledRemovalService, EventsService, StaffQueriesService, StaffHistoryService, StaffStationStateService, StaffQueueRemovalService, StaffEntryNoStoreGuard, StaffHistoryNoStoreGuard, StationAvailabilityService, ExperienceQueueControlService, ExperiencesService, QueueEntryService, QueueStateService, QueueWithdrawalService, CallNextService, CompleteService, AbsentService, StaffIdempotencyPolicy, ParticipantQueueIdempotencyPolicy, EventClosureService, EventClosurePolicy, EventClosureScheduler, EvaluationReadService, EvaluationWriteService, EvaluationWriteIdempotencyPolicy, ParticipationLifecycleService, ParticipationQueryService],
  exports: [EventsService, StaffQueriesService, StationAvailabilityService, ExperienceQueueControlService, ExperiencesService, QueueEntryService, QueueStateService, QueueWithdrawalService, CallNextService, CompleteService, AbsentService, EventClosureService, EvaluationReadService, EvaluationWriteService, ParticipationLifecycleService, ParticipationQueryService],
})
export class EventsModule {}
