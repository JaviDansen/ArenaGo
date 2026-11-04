import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { isPreciseInstant } from "../evaluations/evaluation-read.dto";

export const experienceQueueControlParams=z.object({eventId:operationUuid,experienceId:operationUuid}).strict();
export const experienceQueueControlBody=z.object({acceptingEntries:z.boolean()}).strict();
/** DTO fechado também valida respostas históricas antes de realizar replay. */
export const experienceQueueControlState=z.object({eventId:operationUuid,experienceId:operationUuid,queueAcceptingEntries:z.boolean(),
  changedAt:z.custom<string>(isPreciseInstant).optional()}).strict();
export type ExperienceQueueControlState=z.infer<typeof experienceQueueControlState>;
