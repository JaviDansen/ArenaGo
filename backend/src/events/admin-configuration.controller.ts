import { Body,Controller,Get,HttpCode,Inject,Param,Patch,Post,Query,Req } from "@nestjs/common";
import { CurrentUserId,RequireSessionAuth } from "../auth/current-user.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedRequest } from "../auth/session-auth.guard";
import { ProblemException } from "../common/errors/problem.exception";
import { validateOperationBody,validateOperationIdempotencyKey,validateOperationParams } from "../common/http/operation-validation";
import { configurationBodies,configurationEventParams,configurationExperienceParams,configurationStationParams,configurationQuery,type ConfigOperation } from "./admin-configuration.dto";
import { AdminConfigurationQueryService } from "./admin-configuration-query.service";
import { AdminConfigurationService } from "./admin-configuration.service";
import { executeConfiguration } from "./admin-configuration.problem";
import { AdminIdempotencyPolicy } from "./admin-idempotency.policy";

@Controller('admin/events')
@RequireSessionAuth()
export class AdminConfigurationController {
  constructor(@Inject(AdminConfigurationQueryService) private readonly queries:AdminConfigurationQueryService,
    @Inject(AdminConfigurationService) private readonly writes:AdminConfigurationService,@Inject(AdminIdempotencyPolicy) private readonly policy:AdminIdempotencyPolicy){}
  @Get()
  @HttpCode(200)
  list(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Query() query:unknown){
    const parsed=configurationQuery.safeParse(query);if(!parsed.success)throw new ProblemException({status:400,code:'VALIDATION_ERROR',typeSlug:'validation-error',title:'Requisição inválida',detail:'Confira filtros e cursor.'});
    return executeConfiguration(()=>this.queries.events({userId,sessionId},parsed.data));
  }
  @Post()
  @HttpCode(201)
  create(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate('create_event',userId,sessionId,{},body,request);}
  @Get(':eventId/readiness')
  @HttpCode(200)
  readiness(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown){const {eventId}=validateOperationParams(configurationEventParams,params);return executeConfiguration(()=>this.queries.readiness({userId,sessionId},eventId));}
  @Get(':eventId/experiences')
  @HttpCode(200)
  experiences(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown){const {eventId}=validateOperationParams(configurationEventParams,params);return executeConfiguration(()=>this.queries.experiences({userId,sessionId},eventId));}
  @Get(':eventId')
  @HttpCode(200)
  event(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown){const {eventId}=validateOperationParams(configurationEventParams,params);return executeConfiguration(()=>this.queries.event({userId,sessionId},eventId));}
  @Patch(':eventId')
  @HttpCode(200)
  update(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate('update_event',userId,sessionId,params,body,request);}
  @Post(':eventId/experiences')
  @HttpCode(201)
  createExperience(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate('create_experience',userId,sessionId,params,body,request);}
  @Patch(':eventId/experiences/:experienceId')
  @HttpCode(200)
  updateExperience(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate('update_experience',userId,sessionId,params,body,request);}
  @Post(':eventId/experiences/:experienceId/stations')
  @HttpCode(201)
  createStation(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate('create_station',userId,sessionId,params,body,request);}
  @Patch(':eventId/experiences/:experienceId/stations/:stationId')
  @HttpCode(200)
  updateStation(@CurrentUserId() userId:string,@CurrentUser('sessionId') sessionId:string,@Param() params:unknown,@Body() body:unknown,@Req() request:AuthenticatedRequest){return this.mutate('update_station',userId,sessionId,params,body,request);}
  private mutate(operation:ConfigOperation,userId:string,sessionId:string,params:unknown,body:unknown,request:AuthenticatedRequest){
    const ids=operation==='create_event'?{}:validateOperationParams(operation==='update_station'?configurationStationParams:
      operation==='create_station'||operation==='update_experience'?configurationExperienceParams:configurationEventParams,params);
    const payload=validateOperationBody<unknown>(configurationBodies[operation],body,request),idempotencyKey=validateOperationIdempotencyKey(request);
    return executeConfiguration(async()=>{const result=await this.writes.mutate({operation,userId,sessionId,...ids,payload,idempotencyKey,expiresAt:this.policy.expiresAt()});return result.body;});
  }
}
