import { Controller, Get, HttpCode, HttpStatus, Inject, Param } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import { ProblemException } from "../common/errors/problem.exception";
import { operationUuid, validateOperationParams } from "../common/http/operation-validation";
import { ExperiencesService } from "./experiences.service";

const paramsSchema = z.object({ eventId: operationUuid }).strict();

@Controller("events/:eventId/experiences")
@RequireSessionAuth()
export class ExperiencesController {
  constructor(@Inject(ExperiencesService) private readonly experiences: ExperiencesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async get(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { eventId } = validateOperationParams(paramsSchema, params);
    const result = await this.experiences.getEventExperiences(userId, eventId);
    if (result.kind === "access_denied") {
      throw new ProblemException({ typeSlug: "resource-not-found", title: "Recurso não encontrado", status: HttpStatus.NOT_FOUND,
        code: "RESOURCE_NOT_FOUND", detail: "Recurso não encontrado." });
    }
    return { eventId: result.eventId, observedAt: result.observedAt, acceptingNewQueueEntries: result.acceptingNewQueueEntries,
      experiences: result.experiences.map(experience => ({ id: experience.id, name: experience.name,
        acceptingNewQueueEntries: experience.acceptingNewQueueEntries, waitingCount: experience.waitingCount,
        stations: experience.stations.map(station => ({ id: station.id, label: station.label, available: station.available })) })) };
  }
}
