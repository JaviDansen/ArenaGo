import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { ParticipationsService } from "./participations.service";

/** Prepara as consultas de participação e reutiliza Events e a conexão Drizzle compartilhada. */
@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [ParticipationsService],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
