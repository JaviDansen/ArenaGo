import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import * as schema from "../database/schema";
import { events } from "../database/schema/events.schema";

type EventsDatabase = NodePgDatabase<typeof schema>;
type Event = typeof events.$inferSelect;

/** Fornece consultas de leitura de eventos persistidos no PostgreSQL. */
@Injectable()
export class EventsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: EventsDatabase,
  ) {}

  /**
   * Busca um evento pela chave UUID primária.
   *
   * @param eventId UUID recebido pelo serviço; a sintaxe não é validada aqui.
   * @returns O evento correspondente ou `null` se o UUID não existir.
   * @remarks A consulta não altera dados nem avalia se o evento aceita ingressos.
   */
  async findById(eventId: string): Promise<Event | null> {
    const [event] = await this.database
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    return event ?? null;
  }
}
