import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Query } from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import { ProblemException } from "../common/errors/problem.exception";
import { validateOperationParams } from "../common/http/operation-validation";
import { evaluationParams, historyQuery } from "./evaluation-read.dto";
import { EvaluationReadService } from "./evaluation-read.service";

function required<T>(value: T | null): T {
  if (value === null) throw new ProblemException({ typeSlug: "resource-not-found", title: "Recurso não encontrado", status: HttpStatus.NOT_FOUND,
    code: "RESOURCE_NOT_FOUND", detail: "Recurso não encontrado." });
  return value;
}
/** Caminhos literais declarados antes dos parametrizados; nenhuma rota genérica :id. */
@Controller()
@RequireSessionAuth()
export class EvaluationReadController {
  constructor(@Inject(EvaluationReadService) private readonly reads: EvaluationReadService) {}

  @Get("participations/history")
  @HttpCode(HttpStatus.OK)
  history(@CurrentUserId() userId: string, @Query() query: unknown) {
    const parsed = historyQuery.safeParse(query);
    if (!parsed.success) throw new ProblemException({ typeSlug: "validation-error", title: "Requisição inválida", status: HttpStatus.BAD_REQUEST,
      code: "VALIDATION_ERROR", detail: "Confira limit e cursor do histórico." });
    return this.reads.getHistory(userId, parsed.data);
  }

  @Get("participations/return-state")
  @HttpCode(HttpStatus.OK)
  returnState(@CurrentUserId() userId: string) { return this.reads.getReturnState(userId); }

  @Get("evaluations/pending")
  @HttpCode(HttpStatus.OK)
  pending(@CurrentUserId() userId: string) { return this.reads.getPending(userId); }

  @Get("participations/:participationId/evaluation-eligibility")
  @HttpCode(HttpStatus.OK)
  async eligibility(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { participationId } = validateOperationParams(evaluationParams, params);
    return required(await this.reads.getEligibility(userId, participationId));
  }

  @Get("participations/:participationId/evaluation")
  @HttpCode(HttpStatus.OK)
  async evaluation(@CurrentUserId() userId: string, @Param() params: unknown) {
    const { participationId } = validateOperationParams(evaluationParams, params);
    return required(await this.reads.getEvaluation(userId, participationId));
  }
}
