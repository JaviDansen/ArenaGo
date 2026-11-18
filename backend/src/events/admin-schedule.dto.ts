import { z } from "zod";
import { operationUuid } from "../common/http/operation-validation";
import { adminExternalQueueBody } from "./admin-external-queue.dto";

/** RFC 3339 com fuso explícito e precisão exata de milissegundos, sem normalizar datas impossíveis. */
export function normalizeScheduleInstant(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return;
  const [, yy, mm, dd, hh, mi, ss, , zone] = match;
  const year = Number(yy), month = Number(mm), day = Number(dd);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) return;
  if (zone === "-00:00" || (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return;
  const iso = at.toISOString();
  if (!/^\d{4}-/.test(iso) || iso.startsWith("0000-")) return;
  return iso;
}

const instant = z.string().transform((value, ctx) => {
  const iso = normalizeScheduleInstant(value);
  if (iso === undefined) { ctx.addIssue({ code: "custom", message: "Instante ISO com fuso explícito e até três casas decimais obrigatório." }); return z.NEVER; }
  return iso;
});
const preciseUtc = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
  && normalizeScheduleInstant(value.replace(/(\.\d{3})\d{3}Z$/, "$1Z")) !== undefined);
function micros(value: string) {
  const at = Date.parse(value);
  return Number.isFinite(at) ? BigInt(at) * 1000n + BigInt(/\.\d{3}(\d{3})Z$/.exec(value)?.[1] ?? 0) : null;
}
export const adminScheduleParams = z.object({ eventId: operationUuid }).strict();
export const adminScheduleBody = z.object({
  officialEndsAt: z.union([instant, preciseUtc]),
  operationalDeadlineAt: z.union([instant, preciseUtc]),
  startsAt: instant.optional(),
  expectedUpdatedAt: preciseUtc.optional(),
  reason: adminExternalQueueBody.shape.reason,
}).strict()
  .refine(value => value.expectedUpdatedAt !== undefined || (value.startsAt === undefined
    && !value.officialEndsAt.match(/\.\d{6}Z$/) && !value.operationalDeadlineAt.match(/\.\d{6}Z$/)),
  { message: "A versão do evento é obrigatória para a correção de início ou programação com precisão estendida." })
  .refine(value => {
    const end = micros(value.officialEndsAt), deadline = micros(value.operationalDeadlineAt);
    if (end === null || deadline === null) return false;
    const margin = deadline - end;
    return margin >= 0n && margin <= 3_600_000_000n;
  }, { message: "A margem operacional deve ser de zero a 60 minutos." });
