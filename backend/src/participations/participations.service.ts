import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type { DatabaseExecutor, DatabaseTransactionExecutor } from "../database/database-executor";
import * as schema from "../database/schema";
import { EventsService } from "../events/events.service";
import type { JoinEligibilityResult } from "./join-eligibility";
import { combineJoinEligibility, recombineJoinEligibilityWithAvailability } from "./join-eligibility";
import type { JsonValue } from "./join-idempotency";
import {
  completeIdempotencyOperationWithTx,
  reserveJoinIntentWithTx,
} from "./join-idempotency";

type ParticipationsDatabase = NodePgDatabase<typeof schema>;
type ParticipationsTransaction = DatabaseTransactionExecutor;

/** Resultado da inspeção feita dentro de uma transação e no horário do PostgreSQL. */
export interface TransactionalJoinEligibilityEvaluation {
  eligibility: JoinEligibilityResult;
  evaluatedAt: Date;
}

export interface CreateParticipationInput {
  userId: string;
  eventId: string;
  idempotencyKey: string;
  expiresAt: Date;
}

export type CreateParticipationResult =
  | { kind: "created"; httpStatus: 201; participationId: string; idempotencyResult: JsonValue | null }
  | { kind: "replay"; httpStatus: number; participationId: string | null; idempotencyResult: JsonValue | null }
  | { kind: "request_conflict"; operationId: string }
  | { kind: "in_progress"; operationId: string }
  | { kind: "blocked"; eligibility: JoinEligibilityResult };

export type ParticipationStatus = "waiting" | "active" | "finished" | "canceled";

export interface ParticipationState {
  id: string;
  eventId: string;
  status: ParticipationStatus;
  joinedAt: Date;
  arenaEnteredAt: Date | null;
  finishedAt: Date | null;
  finishReason: string | null;
  externalQueue: { position: number; observedAt: Date } | null;
}

class JoinEligibilityRollback extends Error {
  constructor(readonly eligibility: JoinEligibilityResult) {
    super("Elegibilidade de ingresso não atendida.");
  }
}

/** Consultas informativas sobre pré-requisitos de ingresso, sem criar participação. */
@Injectable()
export class ParticipationsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: ParticipationsDatabase,
    private readonly eventsService: EventsService,
  ) {}

  /** Consulta a única participação corrente do usuário e sua posição externa observada. */
  async getCurrentParticipation(userId: string): Promise<ParticipationState | null> {
    return this.findParticipationState(userId);
  }

  /** Consulta uma participação apenas quando ela pertence ao usuário informado. */
  async getParticipationById(
    userId: string,
    participationId: string,
  ): Promise<ParticipationState | null> {
    return this.findParticipationState(userId, participationId);
  }

  /** Uma única instrução fornece estado, posição e relógio sob o mesmo snapshot READ COMMITTED. */
  private async findParticipationState(
    userId: string,
    participationId?: string,
  ): Promise<ParticipationState | null> {
    const selection = {
      id: schema.participations.id,
      eventId: schema.participations.eventId,
      status: schema.participations.status,
      joinedAt: schema.participations.joinedAt,
      arenaEnteredAt: schema.participations.arenaEnteredAt,
      finishedAt: schema.participations.finishedAt,
      finishReason: schema.participations.finishReason,
      // Referências literais mantêm a correlação com a linha externa: o Drizzle
      // pode remover o qualificador da tabela ao interpolar colunas nesta seleção.
      externalPosition: sql<string | null>`CASE WHEN "participations"."status" = 'waiting' THEN (
        SELECT COUNT(*)::text
        FROM "participations" AS queue_row
        WHERE queue_row."event_id" = "participations"."event_id"
          AND queue_row."status" = 'waiting'
          AND queue_row."external_queue_order" <= "participations"."external_queue_order"
      ) ELSE NULL END`,
      observedAtMs: sql<number>`(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision`,
    };
    const query = this.database.select(selection).from(schema.participations);
    const [row] = participationId
      ? await query.where(and(
        eq(schema.participations.userId, userId),
        eq(schema.participations.id, participationId),
      )).limit(1)
      : await query.where(and(
        eq(schema.participations.userId, userId),
        inArray(schema.participations.status, ["waiting", "active"]),
      )).limit(1);

    if (!row) return null;
    if (row.status !== "waiting" && row.status !== "active"
      && row.status !== "finished" && row.status !== "canceled") {
      throw new Error("A participação persistida possui um estado desconhecido.");
    }

    let externalQueue: ParticipationState["externalQueue"] = null;
    if (row.status === "waiting") {
      if (!row.externalPosition || !/^[1-9]\d*$/.test(row.externalPosition)) {
        throw new Error("Participação waiting sem posição externa válida no mesmo evento.");
      }
      const exactPosition = BigInt(row.externalPosition);
      if (exactPosition > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("A posição externa excede o intervalo seguro do contrato numérico.");
      }
      if (!Number.isFinite(row.observedAtMs)) {
        throw new Error("PostgreSQL não retornou um instante válido para observar a fila externa.");
      }
      const observedAt = new Date(row.observedAtMs);
      if (!Number.isFinite(observedAt.getTime())) {
        throw new Error("PostgreSQL retornou um instante de fila fora do intervalo de Date.");
      }
      externalQueue = { position: Number(exactPosition), observedAt };
    }

    return {
      id: row.id,
      eventId: row.eventId,
      status: row.status,
      joinedAt: row.joinedAt,
      arenaEnteredAt: row.arenaEnteredAt,
      finishedAt: row.finishedAt,
      finishReason: row.finishReason,
      externalQueue,
    };
  }

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
        .select({ id: schema.users.id, isActive: schema.users.isActive })
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
      userActive: userRows[0]?.isActive ?? false,
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
      .select({ id: schema.users.id, isActive: schema.users.isActive })
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
      userActive: userRows[0]?.isActive ?? false,
      hasCompletedQuestionnaire: Boolean(profile?.completedAt),
      questionnaireVersionValid: Boolean(
        profile?.questionnaireVersionId && profile.questionnaireActivatedAt,
      ),
      hasSelectedGames: gameRows.length > 0,
      hasCurrentParticipation: currentParticipationRows.length > 0,
    });

    return { eligibility, evaluatedAt };
  }

  /** Cria participação, snapshot e resposta idempotente em uma única transação READ COMMITTED. */
  async createParticipation(input: CreateParticipationInput): Promise<CreateParticipationResult> {
    try {
      return await this.database.transaction(async (tx): Promise<CreateParticipationResult> => {
        const reservation = await reserveJoinIntentWithTx(tx, {
          actorUserId: input.userId,
          eventId: input.eventId,
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
        });

        if (reservation.kind === "replay") {
          return {
            kind: "replay",
            httpStatus: reservation.httpStatus,
            participationId: reservation.resultReference,
            idempotencyResult: reservation.resultPayload,
          };
        }
        if (reservation.kind === "request_conflict" || reservation.kind === "in_progress") {
          return reservation;
        }

        const evaluated = await this.evaluateJoinEligibilityWithTx(tx, input.userId, input.eventId);
        if (!evaluated.eligibility.eligible) throw new JoinEligibilityRollback(evaluated.eligibility);

        const [profile] = await tx
          .select({
            gender: schema.profiles.gender,
            otherGender: schema.profiles.otherGender,
            education: schema.profiles.education,
            marketKnowledge: schema.profiles.marketKnowledge,
            marketInterest: schema.profiles.marketInterest,
            questionnaireVersionId: schema.profiles.questionnaireVersionId,
          })
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, input.userId))
          .limit(1);
        if (!profile) throw new JoinEligibilityRollback(evaluated.eligibility);

        // Critério estável: nome canônico em collation C e UUID como desempate.
        const gameRows = await tx
          .select({ gameId: schema.games.id, name: schema.games.name, isCurated: schema.games.isCurated })
          .from(schema.userGames)
          .innerJoin(schema.games, eq(schema.userGames.gameId, schema.games.id))
          .where(eq(schema.userGames.userId, input.userId))
          .orderBy(sql`${schema.games.name} COLLATE "C"`, asc(schema.games.id));

        const [decision] = await tx.execute<{ decisionAtMs: number }>(
          sql`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "decisionAtMs"`,
        ).then((result) => result.rows);
        const decisionAtMs = decision?.decisionAtMs;
        if (typeof decisionAtMs !== "number" || !Number.isFinite(decisionAtMs)) {
          throw new Error("PostgreSQL não retornou o instante decisivo do ingresso.");
        }
        const decisionAt = new Date(decisionAtMs);
        if (!Number.isFinite(decisionAt.getTime())) {
          throw new Error("PostgreSQL retornou um instante decisivo fora do intervalo de Date.");
        }

        // Revalida estado e corte oficial após as leituras que podem aguardar locks.
        const finalAvailability = await this.eventsService.evaluateEventAvailabilityById(
          input.eventId,
          decisionAt,
          tx satisfies DatabaseExecutor,
        );
        if (!finalAvailability.eventExists || !finalAvailability.eventAcceptingNewEntries) {
          throw new JoinEligibilityRollback(
            recombineJoinEligibilityWithAvailability(evaluated.eligibility, finalAvailability),
          );
        }

        const [event] = await tx
          .select({ externalQueueEnabled: schema.events.externalQueueEnabled })
          .from(schema.events)
          .where(eq(schema.events.id, input.eventId))
          .limit(1);
        if (!event) throw new JoinEligibilityRollback(evaluated.eligibility);

        let externalQueueOrder: bigint | null = null;
        if (event.externalQueueEnabled) {
          const [updatedEvent] = await tx
            .update(schema.events)
            .set({ externalLastOrder: sql`${schema.events.externalLastOrder} + 1` })
            .where(eq(schema.events.id, input.eventId))
            .returning({ externalLastOrder: schema.events.externalLastOrder });
          if (!updatedEvent) throw new Error("O evento bloqueado desapareceu durante o ingresso.");
          externalQueueOrder = updatedEvent.externalLastOrder;
        }

        const participationId = randomUUID();
        const status = event.externalQueueEnabled ? "waiting" : "active";
        await tx.insert(schema.participations).values({
          id: participationId,
          userId: input.userId,
          eventId: input.eventId,
          status,
          joinedAt: decisionAt,
          externalQueueOrder,
          arenaEnteredAt: event.externalQueueEnabled ? null : decisionAt,
          finishedAt: null,
          finishReason: null,
          currentQueueEntryId: null,
        });

        const answers: JsonValue = {
          schemaVersion: 1,
          gender: profile.gender,
          otherGender: profile.otherGender,
          education: profile.education,
          marketKnowledge: profile.marketKnowledge,
          marketInterest: profile.marketInterest,
        };
        const gamesSnapshot: JsonValue = gameRows.map((game) => ({
          gameId: game.gameId,
          name: game.name,
          isCurated: game.isCurated,
        }));
        await tx.insert(schema.participationProfileSnapshots).values({
          participationId,
          questionnaireVersionId: profile.questionnaireVersionId,
          answers,
          gamesSnapshot,
          ageBandAtEvent: null,
          capturedAt: decisionAt,
        });

        const completed = await completeIdempotencyOperationWithTx(tx, reservation.operationId, {
          httpStatus: 201,
          resultReference: participationId,
          resultPayload: { participationId },
        });
        return {
          kind: "created",
          httpStatus: completed.httpStatus as 201,
          participationId,
          idempotencyResult: completed.resultPayload,
        };
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof JoinEligibilityRollback) {
        return { kind: "blocked", eligibility: error.eligibility };
      }
      throw error;
    }
  }
}