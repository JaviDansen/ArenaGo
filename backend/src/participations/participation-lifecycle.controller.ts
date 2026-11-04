import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { CurrentUserId, RequireSessionAuth } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { emptyOperationBody, validateOperationBody, validateOperationIdempotencyKey, validateOperationParams } from "../common/http/operation-validation";
import { ParticipantQueueIdempotencyPolicy } from "../events/participant-queue-idempotency.policy";
import { lifecycleParams } from "./participation-lifecycle.dto";
import { ParticipationQueryService } from "./participation-query.service";
import { ParticipationLifecycleService, type LifecycleFailure, type LifecycleResult } from "./participation-lifecycle.service";

function missing(): never { throw new ProblemException({status:404,code:"RESOURCE_NOT_FOUND",typeSlug:"resource-not-found",title:"Recurso não encontrado",detail:"Recurso não encontrado."}); }
function response(result: LifecycleResult){
  if(result.kind==="changed"||result.kind==="replay")return {participation:result.participation};
  if(result.kind==="access_denied")missing();
  const codes:Record<Exclude<LifecycleFailure,"access_denied">,string>={not_waiting:"PARTICIPATION_NOT_WAITING",not_active:"PARTICIPATION_NOT_ACTIVE",
    event_ended:"EVENT_OPERATION_ENDED",request_conflict:"IDEMPOTENCY_KEY_REUSED",in_progress:"IDEMPOTENCY_IN_PROGRESS"};
  const code=codes[result.kind];
  throw new ProblemException({status:409,code,typeSlug:code.toLowerCase().replaceAll("_","-"),title:"Conflito de participação",
    detail:"A operação não pode ser aplicada ao estado atual da participação.",extensions:result.participation?{participation:result.participation}:undefined});
}
@Controller("participations")
@RequireSessionAuth()
export class ParticipationLifecycleController {
  constructor(@Inject(ParticipationQueryService) private readonly queries:ParticipationQueryService,
    @Inject(ParticipationLifecycleService) private readonly writes:ParticipationLifecycleService,
    @Inject(ParticipantQueueIdempotencyPolicy) private readonly policy:ParticipantQueueIdempotencyPolicy){}
  @Get("current")
  @HttpCode(200)
  async current(@CurrentUserId() userId:string){return {participation:await this.queries.current(userId)};}
  @Get(":participationId")
  @HttpCode(200)
  async byId(@CurrentUserId() userId:string,@Param() params:unknown){
    const {participationId}=validateOperationParams(lifecycleParams,params),participation=await this.queries.byId(userId,participationId);
    if(!participation)missing();return {participation};
  }
  @Post(":participationId/cancel")
  @HttpCode(200)
  async cancel(@CurrentUserId() userId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate("cancel",userId,params,body,request);}
  @Post(":participationId/finish")
  @HttpCode(200)
  async finish(@CurrentUserId() userId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate("finish",userId,params,body,request);}
  private async mutate(mode:"cancel"|"finish",userId:string,params:unknown,body:unknown,request:AuthenticatedRequest){
    const ids=validateOperationParams(lifecycleParams,params);validateOperationBody(emptyOperationBody,body,request,true);
    const input={...ids,userId,idempotencyKey:validateOperationIdempotencyKey(request),expiresAt:this.policy.expiresAt()};
    return response(await this.writes[mode](input));
  }
}
