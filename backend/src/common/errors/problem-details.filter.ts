import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ProblemDetails, ProblemException } from "./problem.exception";

interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): ExpressLikeResponse;
  json(body: unknown): void;
}

@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<ExpressLikeResponse>();

    if (exception instanceof ProblemException) {
      for (const [headerName, headerValue] of Object.entries(exception.responseHeaders)) {
        response.setHeader(headerName, headerValue);
      }
      response
        .status(exception.getStatus())
        .setHeader("Content-Type", "application/problem+json; charset=utf-8")
        .json(exception.problem);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const problem = this.mapHttpExceptionToProblem(status);
      response
        .status(status)
        .setHeader("Content-Type", "application/problem+json; charset=utf-8")
        .json(problem);
      return;
    }

    this.logger.error(
      "Unhandled internal exception",
      exception instanceof Error ? exception.message : "Unknown error",
    );

    const internalProblem: ProblemDetails = {
      type: "https://arenago.com.br/problems/internal-server-error",
      title: "Erro interno do servidor",
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_SERVER_ERROR",
      detail: "Ocorreu um erro inesperado ao processar a solicitação.",
    };

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .setHeader("Content-Type", "application/problem+json; charset=utf-8")
      .json(internalProblem);
  }

  private mapHttpExceptionToProblem(status: number): ProblemDetails {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return {
          type: "https://arenago.com.br/problems/bad-request",
          title: "Requisição inválida",
          status,
          code: "BAD_REQUEST",
          detail: "O corpo ou formato da requisição é inválido.",
        };
      case HttpStatus.UNAUTHORIZED:
        return {
          type: "https://arenago.com.br/problems/unauthorized",
          title: "Não autenticado",
          status,
          code: "UNAUTHORIZED",
          detail: "Autenticação válida é obrigatória para acessar este recurso.",
        };
      case HttpStatus.FORBIDDEN:
        return {
          type: "https://arenago.com.br/problems/forbidden",
          title: "Acesso negado",
          status,
          code: "FORBIDDEN",
          detail: "Você não possui permissão para realizar esta operação.",
        };
      case HttpStatus.NOT_FOUND:
        return {
          type: "https://arenago.com.br/problems/resource-not-found",
          title: "Recurso não encontrado",
          status,
          code: "RESOURCE_NOT_FOUND",
          detail: "O recurso solicitado não foi encontrado.",
        };
      case HttpStatus.TOO_MANY_REQUESTS:
        return {
          type: "https://arenago.com.br/problems/rate-limit-exceeded",
          title: "Muitas tentativas",
          status,
          code: "RATE_LIMIT_EXCEEDED",
          detail: "Muitas solicitações em sequência. Aguarde antes de tentar novamente.",
        };
      default:
        return {
          type: "https://arenago.com.br/problems/http-error",
          title: "Erro na requisição",
          status,
          code: "HTTP_ERROR",
          detail: "Não foi possível processar a requisição.",
        };
    }
  }
}
