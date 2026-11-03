import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";

export const participationQueueParamsSchema = z.object({ participationId: operationUuid }).strict();
export const queueWithdrawalParamsSchema = z.object({ participationId: operationUuid, queueEntryId: operationUuid }).strict();
export const queueJoinBodySchema = z.object({ experienceId: operationUuid }).strict();
