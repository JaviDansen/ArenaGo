import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsService } from "./events.service";
import { ExperiencesService } from "./experiences.service";
import { QueueEntryService } from "./queue-entry.service";
import { QueueStateService } from "./queue-state.service";
import { QueueWithdrawalService } from "./queue-withdrawal.service";
import { CallNextService } from "./call-next.service";
import { CompleteService } from "./complete.service";

/** Agrupa os serviços de Events e reutiliza o acesso PostgreSQL compartilhado. */
@Module({
  imports: [DatabaseModule],
  providers: [EventsService, ExperiencesService, QueueEntryService, QueueStateService, QueueWithdrawalService, CallNextService, CompleteService],
  exports: [EventsService, ExperiencesService, QueueEntryService, QueueStateService, QueueWithdrawalService, CallNextService, CompleteService],
})
export class EventsModule {}
