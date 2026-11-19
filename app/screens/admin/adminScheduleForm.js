const minute = 60_000;
const hour = 60 * minute;
const preciseUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const partsFormatter = timezone => new Intl.DateTimeFormat('en-GB', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function partsAt(format, at) {
  return Object.fromEntries(format.formatToParts(at).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
function utc(year, month, day, hours, minutes, seconds = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hours, minutes, seconds, 0);
  return date;
}
export function scheduleFields(value, timezone) {
  const parts = partsAt(partsFormatter(timezone), new Date(value));
  return { date: `${parts.day}/${parts.month}/${parts.year.padStart(4, '0')}`, time: `${parts.hour}:${parts.minute}` };
}
export function resolveEventTime({ date, time }, timezone) {
  const dayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dayMatch || !timeMatch) throw new Error('Use data DD/MM/AAAA e hora HH:MM.');
  const [, day, month, year] = dayMatch.map(Number);
  const [, hours, minutes] = timeMatch.map(Number);
  const wall = utc(year, month, day, hours, minutes);
  if (year < 1 || hours > 23 || minutes > 59 || wall.getUTCDate() !== day ||
      wall.getUTCMonth() + 1 !== month || wall.getUTCFullYear() !== year) throw new Error('Confira a data e a hora informadas.');

  const format = partsFormatter(timezone);
  const offsets = new Set();
  // Sample both sides of a zone transition, then verify each candidate by round trip.
  for (let step = -36; step <= 36; step += 6) {
    const sample = wall.getTime() + step * hour;
    const p = partsAt(format, sample);
    offsets.add(utc(+p.year, +p.month, +p.day, +p.hour, +p.minute, +p.second).getTime() - sample);
  }
  const eligible = [...offsets].map(offset => new Date(wall.getTime() - offset)).filter(instant => {
    const p = partsAt(format, instant);
    return +p.year === year && +p.month === month && +p.day === day && +p.hour === hours && +p.minute === minutes && +p.second === 0;
  });
  if (eligible.length !== 1) throw new Error(eligible.length ? 'Hora ambígua neste fuso. Escolha outro horário.' :
    'Esta hora não existe nesta data no fuso do evento.');
  return eligible[0].toISOString();
}

function clockMicros(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Horário indisponível.');
  return BigInt(Date.parse(value)) * 1000n + BigInt(/\.\d{3}(\d{3})Z$/.exec(value)?.[1] ?? 0);
}
const sameFields = (a, b) => a.date === b.date && a.time === b.time;
export function eventScheduleDraft(event) {
  try {
    if (!event.timezone || !preciseUtc.test(event.updatedAt) || !Number.isFinite(Date.parse(event.updatedAt))) return null;
    const margin = clockMicros(event.operationalDeadlineAt) - clockMicros(event.officialEndsAt);
    if (margin < 0n || margin > 3_600_000_000n) return null;
    return { start: scheduleFields(event.startsAt, event.timezone), end: scheduleFields(event.officialEndsAt, event.timezone),
      margin: String(Number(margin) / 60_000_000), reason: '' };
  } catch { return null; }
}
export function scheduleChanged(draft, original) {
  return !sameFields(draft.start, original.start) || !sameFields(draft.end, original.end) || draft.margin !== original.margin;
}
function operationalDeadline(event, original, draft, end) {
  if (sameFields(draft.end, original.end) && draft.margin === original.margin) return event.operationalDeadlineAt;
  if (!/^\d{1,2}$/.test(draft.margin) || Number(draft.margin) > 60) throw new Error('Informe a margem em minutos inteiros, de 0 a 60.');
  const deadline = new Date(Date.parse(end) + Number(draft.margin) * minute).toISOString();
  const micros = /\.\d{3}(\d{3})Z$/.exec(end)?.[1];
  return micros ? deadline.replace(/Z$/, `${micros}Z`) : deadline;
}
export function previewOperationalDeadline(event, original, draft) {
  try {
    const end = sameFields(draft.end, original.end) ? event.officialEndsAt : resolveEventTime(draft.end, event.timezone);
    return operationalDeadline(event, original, draft, end);
  } catch { return null; }
}
export function prepareSchedule(event, original, draft, now) {
  const reason = draft.reason.trim();
  if (!reason || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) throw new Error('Informe uma justificativa válida de até 500 caracteres.');
  const changedStart = !sameFields(draft.start, original.start);
  const changedEnd = !sameFields(draft.end, original.end);
  const start = changedStart ? resolveEventTime(draft.start, event.timezone) : event.startsAt;
  const end = changedEnd ? resolveEventTime(draft.end, event.timezone) : event.officialEndsAt;
  if (changedStart && (now >= Date.parse(event.startsAt) || now >= Date.parse(start))) throw new Error('O início vigente e o novo início devem estar no futuro.');
  if (now >= Date.parse(event.officialEndsAt)) throw new Error('A janela para alterar os horários terminou.');
  if (now >= Date.parse(end) || clockMicros(end) <= clockMicros(start)) throw new Error('O término oficial deve ser futuro e posterior ao início.');

  return { ...(changedStart ? { startsAt: start } : {}), officialEndsAt: end,
    operationalDeadlineAt: operationalDeadline(event, original, draft, end),
    expectedUpdatedAt: event.updatedAt, reason };
}
