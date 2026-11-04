import { ProblemException } from "../common/errors/problem.exception";
import type { AdminAuthFailure } from "./admin-operation-auth";

export type ConfigurationFailure=AdminAuthFailure|'resource_not_found'|'configuration_locked'|'event_ended'|'access_code_used'|'request_conflict'|'in_progress';
export class AdminConfigurationError extends Error { constructor(readonly kind:ConfigurationFailure){super(kind);} }
export function failConfiguration(kind:ConfigurationFailure):never{throw new AdminConfigurationError(kind);}
const errors:Record<ConfigurationFailure,[number,string]>={account_inactive:[401,'ACCOUNT_DEACTIVATED'],admin_required:[403,'ADMIN_REQUIRED'],invalid_session:[401,'INVALID_SESSION'],
  session_revoked:[401,'SESSION_REVOKED'],session_expired:[401,'SESSION_EXPIRED'],admin_2fa_required:[401,'ADMIN_2FA_REQUIRED'],resource_not_found:[404,'RESOURCE_NOT_FOUND'],
  configuration_locked:[409,'EVENT_CONFIGURATION_LOCKED'],event_ended:[409,'EVENT_OPERATION_ENDED'],access_code_used:[409,'ACCESS_CODE_ALREADY_USED'],request_conflict:[409,'IDEMPOTENCY_KEY_REUSED'],in_progress:[409,'IDEMPOTENCY_IN_PROGRESS']};
export async function executeConfiguration<T>(action:()=>Promise<T>):Promise<T>{
  try{return await action();}catch(error){
    if(error instanceof AdminConfigurationError){const [status,code]=errors[error.kind];throw new ProblemException({status,code,typeSlug:code.toLowerCase().replaceAll('_','-'),
      title:status===404?'Recurso não encontrado':status===401?'Autenticação obrigatória':status===403?'Acesso negado':'Conflito de configuração',
      detail:status===404?'Recurso não encontrado.':'A operação administrativa não pode ser aplicada ao estado atual.'});}
    throw new Error('ADMIN_CONFIGURATION_INTERNAL_ERROR',{cause:error});
  }
}
