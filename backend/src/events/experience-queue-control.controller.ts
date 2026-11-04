import { Body,Controller,HttpCode,Inject,Param,Patch,Req } from "@nestjs/common";
import { CurrentUser,CurrentUserId,RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { validateOperationBody,validateOperationIdempotencyKey,validateOperationParams } from "../common/http/operation-validation";
import { experienceQueueControlBody,experienceQueueControlParams } from "./experience-queue-control.dto";
import { ExperienceQueueControlService,type ExperienceQueueControlFailure } from "./experience-queue-control.service";
import { StaffIdempotencyPolicy } from "./staff-idempotency.policy";

const failures:Record<ExperienceQueueControlFailure,[number,string]>={access_denied:[404,'RESOURCE_NOT_FOUND'],account_inactive:[401,'ACCOUNT_DEACTIVATED'],
  invalid_session:[401,'INVALID_SESSION'],session_revoked:[401,'SESSION_REVOKED'],session_expired:[401,'SESSION_EXPIRED'],admin_2fa_required:[401,'ADMIN_2FA_REQUIRED'],
  event_operation_ended:[409,'EVENT_OPERATION_ENDED'],request_conflict:[409,'IDEMPOTENCY_KEY_REUSED'],in_progress:[409,'IDEMPOTENCY_IN_PROGRESS']};
@Controller('staff/events/:eventId/experiences/:experienceId/queue')
@RequireSessionAuth()
export class ExperienceQueueControlController {
  constructor(@Inject(ExperienceQueueControlService) private readonly queues:ExperienceQueueControlService,
    @Inject(StaffIdempotencyPolicy) private readonly policy:StaffIdempotencyPolicy){}
  @Patch()
  @HttpCode(200)
  async set(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){
    const ids=validateOperationParams(experienceQueueControlParams,params),payload=validateOperationBody(experienceQueueControlBody,body,request);
    const result=await this.queues.setAcceptance({...ids,...payload,userId,sessionId,idempotencyKey:validateOperationIdempotencyKey(request),expiresAt:this.policy.expiresAt()});
    if('state'in result)return result.state;
    const [status,code]=failures[result.kind];throw new ProblemException({status,code,typeSlug:code.toLowerCase().replaceAll('_','-'),
      title:status===404?'Recurso não encontrado':status===401?'Autenticação obrigatória':'Conflito operacional',
      detail:status===404?'Recurso não encontrado.':'A operação não pode ser aplicada ao estado atual.'});
  }
}
