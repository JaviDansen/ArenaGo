import { z } from "zod";
export const emailVerificationConfirmSchema = z.object({ token: z.string().min(1).max(256) }).strict();
export const emailVerificationRequestSchema = z.object({}).strict();
