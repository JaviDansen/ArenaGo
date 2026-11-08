import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";

export const evaluationParams = z.object({ participationId: operationUuid }).strict();

/** Date somente valida calendário/milissegundos; o cursor preserva a string com seis casas. */
export function isPreciseInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 23) === value.slice(0, 23);
}
const cursorValue = z.object({ v: z.literal(1), joinedAt: z.custom<string>(isPreciseInstant), id: operationUuid }).strict();
export type HistoryCursor = z.infer<typeof cursorValue>;
export function encodeHistoryCursor(joinedAt: string, id: string): string {
  return Buffer.from(JSON.stringify(cursorValue.parse({ v: 1, joinedAt, id })), "utf8").toString("base64url");
}
function decodeCursor(raw: string): HistoryCursor | undefined {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw) || raw.length > 512) return;
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) return;
    const parsed = cursorValue.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (parsed.success) return parsed.data;
  } catch { /* Apenas cursor inválido; nenhum dado arbitrário é refletido no erro. */ }
}
export const historyQuery = z.object({
  limit: z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(50)).optional().default(20),
  cursor: z.string().transform((value, ctx) => {
    const decoded = decodeCursor(value);
    if (!decoded) { ctx.addIssue({ code: "custom", message: "Cursor inválido." }); return z.NEVER; }
    return decoded;
  }).optional(),
}).strict();
export type HistoryPage = z.infer<typeof historyQuery>;
