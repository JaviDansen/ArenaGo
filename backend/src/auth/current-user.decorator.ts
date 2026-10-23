import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";
import { AuthenticatedPrincipal } from "./auth.types";
import {
  AUTHENTICATED_PRINCIPAL_KEY,
  AuthenticatedRequest,
  SessionAuthGuard,
} from "./session-auth.guard";

/**
 * Decorator de rota/controller compartilhado para exigir sessão autenticada e ativa.
 * Reutilizável pelos módulos Identity/Auth, Profile/Games, Events, Participations, Queues e Evaluations.
 */
export function RequireSessionAuth(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseGuards(SessionAuthGuard));
}

export function extractAuthenticatedPrincipal(
  context: ExecutionContext,
): AuthenticatedPrincipal {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const principal = request[AUTHENTICATED_PRINCIPAL_KEY] ?? request.user;

  if (!principal) {
    throw new ProblemException({
      typeSlug: "unauthenticated-context",
      title: "Não autenticado",
      status: HttpStatus.UNAUTHORIZED,
      code: "UNAUTHENTICATED_CONTEXT",
      detail: "Contexto de sessão autenticada não encontrado na requisição.",
    });
  }

  return principal;
}

/**
 * Obtém o objeto completo da conta e sessão autenticadas (validado no PostgreSQL).
 * Se informado um nome de propriedade (ex.: `@CurrentUser('userId')`), retorna apenas o campo solicitado.
 */
export const CurrentUser = createParamDecorator(
  (
    property: keyof AuthenticatedPrincipal | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedPrincipal | AuthenticatedPrincipal[keyof AuthenticatedPrincipal] => {
    const principal = extractAuthenticatedPrincipal(ctx);
    return property ? principal[property] : principal;
  },
);

/**
 * Atalho explícito para obter diretamente o UUID real do usuário autenticado (`principal.userId`),
 * garantindo que endpoints de domínio (como Events e Participations) nunca dependam de `userId` do body.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return extractAuthenticatedPrincipal(ctx).userId;
  },
);
