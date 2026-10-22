import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseExecutor, DatabaseTransactionExecutor } from "../database/database-executor";
import * as schema from "../database/schema";
import { EventsService } from "../events/events.service";
import type { JoinEligibilityResult } from "./join-eligibility";
import { combineJoinEligibility } from "./join-eligibility";

type ParticipationsDatabase = NodePgDatabase<typeof schema>;
type ParticipationsTransaction = DatabaseTransactionExecutor;

/** Resultado da inspeção feita dentro de uma transação e no horário do PostgreSQL. */
export interface TransactionalJoinEligibilityEvaluation {
  eligibility: JoinEligibilityResult;
  evaluatedAt: Date;
}

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

  /**
   * Avalia pré-condições usando uma transação `READ COMMITTED` e locks na ordem evento → usuário.
   *
   * @param userId Identificador interno do participante, fornecido por chamador confiável.
   * @param eventId UUID do evento a avaliar.
   * @returns Elegibilidade e instante obtido do relógio PostgreSQL depois dos locks.
   * @remarks Somente leitura: não cria participação, snapshot, posição FIFO nem idempotência.
   * Para consistência com alterações do questionário, Kaled deverá travar `users FOR UPDATE`
   * antes de modificar `profiles` ou `user_games`. A transação, isoladamente, não coordena
   * escritores de Staff, estações ou eventos que não sigam o lock do evento.
   */
  async evaluateJoinEligibilityInTransaction(
    userId: string,
    eventId: string,
  ): Promise<TransactionalJoinEligibilityEvaluation> {
    return this.database.transaction(async (tx) => {
      return this.evaluateJoinEligibilityWithTx(tx, userId, eventId);
    }, { isolationLevel: "read committed" });
  }

  /**
   * Reavalia a elegibilidade em uma transação aberta pelo chamador e mantém seus locks ativos.
   *
   * @param tx Transação Drizzle PostgreSQL que permanece sob controle do chamador.
   * @param userId Identificador interno do participante.
   * @param eventId UUID do evento a avaliar.
   * @returns Elegibilidade e instante do PostgreSQL lido depois dos locks.
   * @remarks Não abre nem encerra transação e não usa a conexão raiz. A futura criação deve
   * revalidar o instante decisivo antes da mutação. Escritores de Staff, estações e perfil precisam
   * seguir seus protocolos de locks; uma avaliação favorável não reserva o ingresso.
   */
  async evaluateJoinEligibilityWithTx(
    tx: ParticipationsTransaction,
    userId: string,
    eventId: string,
  ): Promise<TransactionalJoinEligibilityEvaluation> {
    // A ordem evento → usuário serializa com edições do evento e alterações do perfil.
    await tx
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .for("update")
      .limit(1);

    const userRows = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update")
      .limit(1);

    // `now()` fica fixo desde BEGIN; clock_timestamp() observa o relógio depois das esperas.
    const clockRows = await tx.execute<{ observedAtMs: number }>(
      sql`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "observedAtMs"`,
    );
    const observedAtMs = clockRows.rows[0]?.observedAtMs;
    if (typeof observedAtMs !== "number" || !Number.isFinite(observedAtMs)) {
      throw new Error("PostgreSQL não retornou um epoch válido para avaliar o ingresso.");
    }

    const evaluatedAt = new Date(observedAtMs);
    if (!Number.isFinite(evaluatedAt.getTime())) {
      throw new Error("PostgreSQL retornou um epoch fora do intervalo de Date.");
    }

    const eventAvailability = await this.eventsService.evaluateEventAvailabilityById(
      eventId,
      evaluatedAt,
      tx satisfies DatabaseExecutor,
    );

    // node-postgres executa comandos em série por cliente; evite sobrepor consultas no tx.
    const profileRows = await tx
      .select({
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
      .limit(1);
    const gameRows = await tx
      .select({ gameId: schema.userGames.gameId })
      .from(schema.userGames)
      .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
      .where(eq(schema.userGames.userId, userId))
      .limit(1);
    const currentParticipationRows = await tx
      .select({ id: schema.participations.id })
      .from(schema.participations)
      .where(and(
        eq(schema.participations.userId, userId),
        inArray(schema.participations.status, ["waiting", "active"]),
      ))
      .limit(1);

    const profile = profileRows[0];
    const eligibility = combineJoinEligibility({
      eventAvailability,
      userExists: userRows.length > 0,
      hasCompletedQuestionnaire: Boolean(profile?.completedAt),
      questionnaireVersionValid: Boolean(
        profile?.questionnaireVersionId && profile.questionnaireActivatedAt,
      ),
      hasSelectedGames: gameRows.length > 0,
      hasCurrentParticipation: currentParticipationRows.length > 0,
    });

    return { eligibility, evaluatedAt };
  }
}
