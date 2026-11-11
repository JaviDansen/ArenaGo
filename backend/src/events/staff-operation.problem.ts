import { HttpStatus } from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";
import { CallNextIntegrityError } from "./call-next.service";
import type { CallNextResult } from "./call-next.types";
import { CompleteServiceIntegrityError } from "./complete.service";
import type { CompleteServiceResult } from "./complete.types";
import { AbsentServiceIntegrityError } from "./absent.service";
import { CalledRemovalServiceIntegrityError } from "./staff-called-removal.service";
import type { AbsentServiceResult } from "./absent.types";

type FailureKind = Exclude<(CallNextResult | CompleteServiceResult | AbsentServiceResult)["kind"], "created" | "completed" | "absent" | "replay">;
const problems: Record<FailureKind, { status: HttpStatus; code: string; detail: string }> = {
  staff_event_forbidden: { status: HttpStatus.FORBIDDEN, code: "STAFF_EVENT_FORBIDDEN", detail: "Staff autorizado para este evento é obrigatório." },
  service_not_found: { status: HttpStatus.NOT_FOUND, code: "SERVICE_NOT_FOUND", detail: "Atendimento não encontrado neste evento." },
  service_not_pending: { status: HttpStatus.CONFLICT, code: "SERVICE_NOT_PENDING", detail: "O atendimento não está pendente." },
  station_unavailable: { status: HttpStatus.CONFLICT, code: "STATION_UNAVAILABLE", detail: "A estação está indisponível." },
  station_has_pending_call: { status: HttpStatus.CONFLICT, code: "STATION_HAS_PENDING_CALL", detail: "A estação já possui chamada pendente." },
  queue_empty: { status: HttpStatus.CONFLICT, code: "QUEUE_EMPTY", detail: "Não há participante aguardando nesta fila." },
  event_operation_ended: { status: HttpStatus.CONFLICT, code: "EVENT_OPERATION_ENDED", detail: "O evento não permite esta operação neste instante." },
  request_conflict: { status: HttpStatus.CONFLICT, code: "IDEMPOTENCY_REQUEST_CONFLICT", detail: "A chave de idempotência já identifica outra intenção." },
  in_progress: { status: HttpStatus.CONFLICT, code: "IDEMPOTENCY_IN_PROGRESS", detail: "A intenção informada está em processamento." },
};

export function rejectStaffOperation(kind: FailureKind): never {
  const problem = problems[kind];
  throw new ProblemException({ ...problem, typeSlug: problem.code.toLowerCase().replaceAll("_", "-"),
    title: problem.status === HttpStatus.FORBIDDEN ? "Acesso negado" : problem.status === HttpStatus.NOT_FOUND ? "Recurso não encontrado" : "Conflito operacional" });
}

/** Erros de integridade reais nunca viram conflito de negócio ou resposta com IDs/SQL. */
export async function executeStaffOperation<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof CallNextIntegrityError || error instanceof CompleteServiceIntegrityError || error instanceof AbsentServiceIntegrityError || error instanceof CalledRemovalServiceIntegrityError) {
      throw new ProblemException({ typeSlug: "internal-server-error", title: "Erro interno do servidor", status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "INTERNAL_SERVER_ERROR", detail: "Não foi possível processar a operação." });
    }
    throw error;
  }
}
