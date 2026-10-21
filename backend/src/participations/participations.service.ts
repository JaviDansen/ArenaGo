import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import * as schema from "../database/schema";
import { EventsService } from "../events/events.service";
import type { JoinEligibilityResult } from "./join-eligibility";
import { combineJoinEligibility } from "./join-eligibility";

type ParticipationsDatabase = NodePgDatabase<typeof schema>;

/** Consultas informativas sobre pré-requisitos de ingresso, sem criar participação. */
@Injectable()
export class ParticipationsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: ParticipationsDatabase,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Avalia os pré-requisitos de um usuário para ingressar em um evento.
   *
   * @param userId ID interno fornecido por chamador confiável; não é obtido de request público.
   * @param eventId UUID do evento.
   * @param at Instante absoluto de referência para avaliar a janela do evento.
   * @returns Elegibilidade informativa e todos os códigos de impedimento encontrados.
   * @remarks Somente leitura. Não valida sessão/autenticação nem exige e-mail verificado para
   * participante comum. Perfil, versão publicada, jogo e participação podem mudar após a leitura;
   * a futura operação definitiva deve revalidar e gravar participação/snapshot em uma transação.
   */
  async evaluateJoinEligibility(
    userId: string,
    eventId: string,
    at: Date,
  ): Promise<JoinEligibilityResult> {
    const [eventAvailability, userRows, profileRows, gameRows, currentParticipationRows] = await Promise.all([
      this.eventsService.evaluateEventAvailabilityById(eventId, at),
      this.database
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1),
      this.database
        .select({
          userId: schema.profiles.userId,
          completedAt: schema.profiles.completedAt,
          questionnaireVersionId: schema.questionnaireVersions.id,
          questionnaireActivatedAt: schema.questionnaireVersions.activatedAt,
        })
        .from(schema.profiles)
        .leftJoin(
          schema.questionnaireVersions,
          eq(schema.profiles.questionnaireVersionId, schema.questionnaireVersions.id),
        )
        .where(eq(schema.profiles.userId, userId))
        .limit(1),
      this.database
        .select({ gameId: schema.userGames.gameId })
        .from(schema.userGames)
        .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
        .where(eq(schema.userGames.userId, userId))
        .limit(1),
      this.database
        .select({ id: schema.participations.id })
        .from(schema.participations)
        .where(and(
          eq(schema.participations.userId, userId),
          inArray(schema.participations.status, ["waiting", "active"]),
        ))
        .limit(1),
    ]);

    const profile = profileRows[0];
    const hasCompletedQuestionnaire = Boolean(profile?.completedAt);
    const questionnaireVersionValid = Boolean(
      profile?.questionnaireVersionId && profile.questionnaireActivatedAt,
    );

    return combineJoinEligibility({
      eventAvailability,
      userExists: userRows.length > 0,
      hasCompletedQuestionnaire,
      questionnaireVersionValid,
      hasSelectedGames: gameRows.length > 0,
      hasCurrentParticipation: currentParticipationRows.length > 0,
    });
  }
}
