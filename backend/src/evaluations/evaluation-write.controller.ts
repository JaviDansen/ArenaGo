import { Body, Controller, HttpCode, Inject, Injectable, Param, Patch, Post, Req } from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { parseOperationIdempotencyTtl } from "../common/http/idempotency-ttl";
import { validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from "../common/http/operation-validation";
import { evaluationParams } from "./evaluation-read.dto";
import { editEvaluationBody, submitEvaluationBody, writeEvaluationParams } from "./evaluation-write.dto";
import { EvaluationWriteService } from "./evaluation-write.service";
import type { EvaluationWriteFailure, EvaluationWriteResult } from "./evaluation-write.types";

@Injectable()
export class EvaluationWriteIdempotencyPolicy {
  private readonly ttl = parseOperationIdempotencyTtl(process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS, "EVALUATION_IDEMPOTENCY_TTL_SECONDS");
  expiresAt() { const value = new Date(Date.now() + this.ttl); if (!Number.isFinite(value.getTime())) throw new Error("EVALUATION_TTL_INVALID"); return value; }
}
const codes: Record<EvaluationWriteFailure, string> = { access_denied: "RESOURCE_NOT_FOUND", not_eligible: "EVALUATION_NOT_ELIGIBLE",
  submission_expired: "EVALUATION_SUBMISSION_EXPIRED", already_submitted: "EVALUATION_ALREADY_SUBMITTED", edit_window_closed: "EVALUATION_EDIT_WINDOW_CLOSED",
  comment_already_added: "COMMENT_ALREADY_ADDED", request_conflict: "IDEMPOTENCY_KEY_REUSED", in_progress: "IDEMPOTENCY_IN_PROGRESS" };
function response(result: EvaluationWriteResult) {
  if ("evaluation" in result) return { evaluation: result.evaluation };
  const status = result.kind === "access_denied" ? 404 : 409, code = codes[result.kind];
  throw new ProblemException({ status, code, typeSlug: code.toLowerCase().replaceAll("_", "-"),
    title: status === 404 ? "Recurso não encontrado" : "Conflito de avaliação", detail: status === 404 ? "Recurso não encontrado." : "A intenção não pode ser aplicada ao estado atual da avaliação." });
}
@Controller()
@RequireSessionAuth()
export class EvaluationWriteController {
  constructor(@Inject(EvaluationWriteService) private readonly writes: EvaluationWriteService,
    @Inject(EvaluationWriteIdempotencyPolicy) private readonly policy: EvaluationWriteIdempotencyPolicy) {}
  @Post("participations/:participationId/evaluation")
  @HttpCode(201)
  async submit(@CurrentUserId() userId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { participationId } = validateOperationParams(evaluationParams, params), payload = validateOperationBody(submitEvaluationBody, body, request);
    return response(await this.writes.submit({ userId, participationId, payload, idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() }));
  }
  @Patch("evaluations/:evaluationId")
  @HttpCode(200)
  async edit(@CurrentUserId() userId: string, @Param() params: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { evaluationId } = validateOperationParams(writeEvaluationParams, params), payload = validateOperationBody(editEvaluationBody, body, request);
    return response(await this.writes.edit({ userId, evaluationId, payload, idempotencyKey: validateOperationIdempotencyKey(request), expiresAt: this.policy.expiresAt() }));
  }
}
