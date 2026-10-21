import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import * as schema from "../database/schema";
import { events } from "../database/schema/events.schema";
import { normalizeEventAccessCode } from "./access-code";
import { evaluateEventEntryWindow } from "./event-entry-window";
import type { EventEntryWindowResult } from "./event-entry-window";
import { buildEventOperationalCapacityResult } from "./event-operational-capacity";

type EventsDatabase = NodePgDatabase<typeof schema>;
type Event = typeof events.$inferSelect;

/** Resultado da avaliação temporal de um evento consultado pelo UUID. */
export type EventEntryWindowLookupResult =
  | { eventExists: false }
  | { eventExists: true; eventId: string; entryWindow: EventEntryWindowResult };

/** Resultado da avaliação de capacidade operacional de um evento. */
export type EventOperationalCapacityLookupResult =
  | { eventExists: false }
  | ({ eventExists: true; eventId: string } & ReturnType<typeof buildEventOperationalCapacityResult>);

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

  /**
   * Busca um evento pelo código normalizado aprovado em C-10.
   *
   * @param accessCode Código digitado; whitespace externo é ignorado e letras não diferenciam caixa.
   * @returns O evento correspondente ou `null` se um código válido não existir.
   * @throws EventAccessCodeValidationError Se o código recebido for inválido.
   * @remarks Usa igualdade exata sobre a coluna canônica e não altera dados nem avalia prontidão.
   */
  async findByAccessCode(accessCode: string): Promise<Event | null> {
    const normalizedCode = normalizeEventAccessCode(accessCode);
    const [event] = await this.database
      .select()
      .from(events)
      .where(eq(events.accessCodeNormalized, normalizedCode))
      .limit(1);

    return event ?? null;
  }

  /**
   * Consulta um evento e avalia sua janela temporal de novos ingressos.
   *
   * @param eventId UUID do evento a consultar.
   * @param at Instante absoluto de referência, fornecido explicitamente pelo chamador.
   * @returns Resultado explícito para evento ausente ou janela temporal do evento encontrado.
   * @remarks É uma leitura informativa: não verifica prontidão, status administrativo nem
   * reserva vaga. Reutiliza `findById()` e não altera o banco.
   */
  async evaluateEntryWindowById(
    eventId: string,
    at: Date,
  ): Promise<EventEntryWindowLookupResult> {
    const event = await this.findById(eventId);

    if (!event) {
      return { eventExists: false };
    }

    return {
      eventExists: true,
      eventId: event.id,
      entryWindow: evaluateEventEntryWindow(event, at),
    };
  }

  /**
   * Verifica se o evento possui Staff apto e ao menos uma estação disponível.
   *
   * @param eventId UUID do evento consultado.
   * @returns Resultado explícito de inexistência ou os dois critérios e a capacidade combinada.
   * @remarks Staff revogado, inativo, não verificado ou vinculado a outro evento não conta.
   * Estação precisa pertencer a uma experiência deste evento, mas pode estar ocupada: disponibilidade
   * persistida é distinta de chamada pendente. As consultas são leituras independentes, sem snapshot
   * transacional compartilhado; este resultado informativo não autoriza ingresso nem altera dados.
   */
  async evaluateOperationalCapacityByEventId(
    eventId: string,
  ): Promise<EventOperationalCapacityLookupResult> {
    const event = await this.findById(eventId);

    if (!event) {
      return { eventExists: false };
    }

    const [staffRows, stationRows] = await Promise.all([
      this.database
        .select({ id: schema.userRoles.id })
        .from(schema.userRoles)
        .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
        .where(and(
          eq(schema.userRoles.role, "staff"),
          eq(schema.userRoles.eventId, eventId),
          isNull(schema.userRoles.revokedAt),
          eq(schema.users.isActive, true),
          isNotNull(schema.users.emailVerifiedAt),
        ))
        .limit(1),
      this.database
        .select({ id: schema.stations.id })
        .from(schema.stations)
        .innerJoin(schema.experiences, eq(schema.stations.experienceId, schema.experiences.id))
        .where(and(
          eq(schema.experiences.eventId, eventId),
          eq(schema.stations.availability, "available"),
        ))
        .limit(1),
    ]);

    return {
      eventExists: true,
      eventId: event.id,
      ...buildEventOperationalCapacityResult(staffRows.length > 0, stationRows.length > 0),
    };
  }
}
