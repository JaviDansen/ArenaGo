import { IncomingMessage } from "node:http";
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";
import { AuthService } from "./auth.service";
import { AuthenticatedPrincipal } from "./auth.types";

export const AUTHENTICATED_PRINCIPAL_KEY = "authPrincipal";

export interface AuthenticatedRequest extends IncomingMessage {
  ip?: string;
  [AUTHENTICATED_PRINCIPAL_KEY]?: AuthenticatedPrincipal;
  user?: AuthenticatedPrincipal;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawAuthorization = request.headers.authorization;

    if (!rawAuthorization || typeof rawAuthorization !== "string") {
      throw new ProblemException({
        typeSlug: "missing-access-token",
        title: "Autenticação obrigatória",
        status: HttpStatus.UNAUTHORIZED,
        code: "MISSING_ACCESS_TOKEN",
        detail: "O cabeçalho Authorization: Bearer <token> é obrigatório.",
      });
    }

    const trimmed = rawAuthorization.trim();
    const match = /^Bearer\s+(\S+)$/i.exec(trimmed);
    if (!match || !match[1]) {
      throw new ProblemException({
        typeSlug: "invalid-authorization-header",
        title: "Cabeçalho de autenticação inválido",
        status: HttpStatus.UNAUTHORIZED,
        code: "INVALID_AUTHORIZATION_HEADER",
        detail: "Utilize o formato 'Authorization: Bearer <accessToken>'.",
      });
    }

    const token = match[1];
    const principal = await this.authService.authenticateBearerToken(token);

    request[AUTHENTICATED_PRINCIPAL_KEY] = principal;
    request.user = principal;

    return true;
  }
}
