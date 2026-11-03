import { HttpStatus } from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";
import type { JoinExperienceQueueResult } from "./queue-entry.types";
import type { ParticipationQueueResult } from "./queue-state.types";
import type { WithdrawExperienceQueueResult } from "./queue-withdrawal.types";

type FailureKind = Exclude<(JoinExperienceQueueResult | ParticipationQueueResult | WithdrawExperienceQueueResult)["kind"], "created" | "ok" | "withdrawn" | "replay">;
const problems: Record<FailureKind, { status: HttpStatus; code: string; detail: string }> = {
  access_denied: { status: HttpStatus.NOT_FOUND, code: "RESOURCE_NOT_FOUND", detail: "Recurso não encontrado." },
  participation_not_active: { status: HttpStatus.CONFLICT, code: "PARTICIPATION_NOT_ACTIVE", detail: "A participação não está ativa." },
  queue_occupied: { status: HttpStatus.CONFLICT, code: "ALREADY_IN_INTERNAL_QUEUE", detail: "A participação já possui uma fila interna atual." },
  queue_closed: { status: HttpStatus.CONFLICT, code: "EXPERIENCE_QUEUE_CLOSED", detail: "A fila não aceita novas entradas." },
  experience_unavailable: { status: HttpStatus.CONFLICT, code: "EXPERIENCE_UNAVAILABLE", detail: "A experiência não está disponível para ingresso." },
  event_closed: { status: HttpStatus.CONFLICT, code: "EVENT_REGISTRATION_CLOSED", detail: "O evento não aceita novas entradas." },
  event_unavailable: { status: HttpStatus.CONFLICT, code: "EVENT_UNAVAILABLE", detail: "O evento não está disponível para ingresso." },
  entry_not_current: { status: HttpStatus.CONFLICT, code: "QUEUE_ENTRY_NOT_CURRENT", detail: "A tentativa informada já foi encerrada." },
  event_ended: { status: HttpStatus.CONFLICT, code: "EVENT_OPERATION_ENDED", detail: "O prazo operacional do evento terminou." },
  request_conflict: { status: HttpStatus.CONFLICT, code: "IDEMPOTENCY_REQUEST_CONFLICT", detail: "A chave de idempotência já identifica outra intenção." },
  in_progress: { status: HttpStatus.CONFLICT, code: "IDEMPOTENCY_IN_PROGRESS", detail: "A intenção informada está em processamento." },
};

export function rejectParticipantQueueOperation(kind: FailureKind): never {
  const problem = problems[kind];
  throw new ProblemException({ ...problem, typeSlug: problem.code.toLowerCase().replaceAll("_", "-"),
    title: problem.status === HttpStatus.NOT_FOUND ? "Recurso não encontrado" : "Conflito operacional" });
}
