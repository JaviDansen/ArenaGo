import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsService } from "./events.service";
import { ExperiencesService } from "./experiences.service";
import { QueueEntryService } from "./queue-entry.service";

/** Agrupa os serviços de Events e reutiliza o acesso PostgreSQL compartilhado. */
@Module({
  imports: [DatabaseModule],
  providers: [EventsService, ExperiencesService, QueueEntryService],
  exports: [EventsService, ExperiencesService, QueueEntryService],
})
export class EventsModule {}
