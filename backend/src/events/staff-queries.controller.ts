import { Controller, Get, Header, HttpCode, HttpStatus, Inject, Param } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import { ProblemException } from "../common/errors/problem.exception";
import { operationUuid, validateOperationParams } from "../common/http/operation-validation";
import { StaffQueriesService } from "./staff-queries.service";

const eventParams = z.object({ eventId: operationUuid }).strict();
const queueParams = eventParams.extend({ experienceId: operationUuid });
function denied(): never {
  throw new ProblemException({ typeSlug: "resource-not-found", title: "Recurso não encontrado", status: HttpStatus.NOT_FOUND,
    code: "RESOURCE_NOT_FOUND", detail: "Recurso não encontrado." });
}

@Controller("staff/events")
@RequireSessionAuth()
export class StaffQueriesController {
  constructor(@Inject(StaffQueriesService) private readonly queries: StaffQueriesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async events(@CurrentUserId() userId: string) {
    const events = await this.queries.listEvents(userId);
    return { events: events.map(({ id, name, status, effectivePhase }) => ({ id, name, status, effectivePhase })) };
  }

  @Get(":eventId/experiences")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async experiences(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { eventId } = validateOperationParams(eventParams, params);
    const result = await this.queries.getExperiences(userId, eventId);
    if (result.kind === "access_denied") return denied();
    return { eventId: result.eventId, experiences: result.experiences.map(({ id, name }) => ({ id, name })) };
  }

  @Get(":eventId/stations")
  @HttpCode(HttpStatus.OK)
  async stations(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { eventId } = validateOperationParams(eventParams, params);
    const result = await this.queries.getStations(userId, eventId);
    if (result.kind === "access_denied") return denied();
    return { eventId: result.eventId, stations: result.stations.map(station => ({
      id: station.id, experienceId: station.experienceId, label: station.label, availability: station.availability,
      pendingServiceSessionId: station.pendingServiceSessionId, pendingCalledAt: station.pendingCalledAt,
    })) };
  }

  @Get(":eventId/experiences/:experienceId/queue")
  @HttpCode(HttpStatus.OK)
  async queue(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { eventId, experienceId } = validateOperationParams(queueParams, params);
    const result = await this.queries.getQueue(userId, eventId, experienceId);
    if (result.kind === "access_denied") return denied();
    return { eventId: result.eventId, experienceId: result.experienceId, observedAt: result.observedAt,
      waitingCount: result.waitingCount, acceptingNewEntries: result.acceptingNewEntries,
      canCallWaitingEntries: result.canCallWaitingEntries, firstWaitingQueueEntryId: result.firstWaitingQueueEntryId };
  }
}
