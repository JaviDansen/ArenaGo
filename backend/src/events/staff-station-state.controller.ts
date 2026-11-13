import { Controller, Get, HttpStatus, Inject, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { StaffEntryNoStoreGuard } from '../participations/staff-entry.controller';
import { ProblemException } from '../common/errors/problem.exception';
import { operationUuid, validateOperationParams } from '../common/http/operation-validation';
import { StaffStationStateService } from './staff-station-state.service';

const paramsSchema = z.object({ eventId: operationUuid, experienceId: operationUuid, stationId: operationUuid }).strict();

@Controller('staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state')
@UseGuards(StaffEntryNoStoreGuard, SessionAuthGuard)
export class StaffStationStateController {
  constructor(@Inject(StaffStationStateService) private readonly states: StaffStationStateService) {}

  @Get()
  async read(@CurrentUser() principal: AuthenticatedPrincipal, @Param() params: unknown) {
    const ids = validateOperationParams(paramsSchema, params);
    const state = await this.states.read({ ...ids, userId: principal.userId, sessionId: principal.sessionId });
    if (!state) throw new ProblemException({ status: HttpStatus.NOT_FOUND, code: 'RESOURCE_NOT_FOUND',
      typeSlug: 'resource-not-found', title: 'Recurso não encontrado', detail: 'Recurso não encontrado.' });
    return state;
  }
}
