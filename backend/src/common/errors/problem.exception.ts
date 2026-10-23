import { HttpException, HttpStatus } from "@nestjs/common";

export interface InvalidParam {
  name: string;
  reason: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  invalidParams?: InvalidParam[];
  [key: string]: unknown;
}

export interface ProblemExceptionOptions {
  typeSlug: string;
  title: string;
  status: HttpStatus;
  code: string;
  detail: string;
  invalidParams?: InvalidParam[];
  extensions?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ProblemException extends HttpException {
  public readonly problem: ProblemDetails;
  public readonly responseHeaders: Record<string, string>;

  constructor(options: ProblemExceptionOptions) {
    const problem: ProblemDetails = {
      type: `https://arenago.com.br/problems/${options.typeSlug}`,
      title: options.title,
      status: options.status,
      code: options.code,
      detail: options.detail,
      ...(options.invalidParams && options.invalidParams.length > 0
        ? { invalidParams: options.invalidParams }
        : {}),
      ...(options.extensions ?? {}),
    };
    super(problem, options.status);
    this.problem = problem;
    this.responseHeaders = options.headers ?? {};
  }
}
