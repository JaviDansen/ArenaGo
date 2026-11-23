/**
 * Formatação de instantes do servidor para exibição em pt-BR.
 * Com fuso IANA informado, a data/hora é mostrada nesse fuso; sem fuso, no do aparelho.
 * Nunca decide disponibilidade: isso é sempre do backend.
 */

const DATE_OPTIONS = { day: '2-digit', month: '2-digit', year: 'numeric' };
const TIME_OPTIONS = { hour: '2-digit', minute: '2-digit', hour12: false };

const ZONE_NAMES = {
  'America/Sao_Paulo': 'Horário de Brasília',
};

function toDate(iso) {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Retorna o fuso utilizável ou null quando o ambiente não o reconhece. */
export function resolveTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return null;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone }).format(0);
    return timeZone;
  } catch {
    return null;
  }
}

function format(date, options, timeZone) {
  // Alguns motores devolvem "24:00" para meia-noite com hour12:false.
  return new Intl.DateTimeFormat('pt-BR', timeZone ? { ...options, timeZone } : options)
    .format(date).replace(/^24:/, '00:');
}

/**
 * @param {string} iso instante do servidor
 * @param {string} [timeZone] fuso IANA do evento; ausente = fuso do aparelho
 * @returns {{ date: string, time: string, zone: string|null }|null}
 */
export function formatInstantParts(iso, timeZone) {
  const date = toDate(iso);
  if (!date) return null;
  if (timeZone === undefined) {
    return { date: format(date, DATE_OPTIONS), time: format(date, TIME_OPTIONS), zone: null };
  }
  // Fuso informado mas desconhecido: UTC explícito, nunca o fuso do aparelho.
  const zone = resolveTimeZone(timeZone) ?? 'UTC';
  return { date: format(date, DATE_OPTIONS, zone), time: format(date, TIME_OPTIONS, zone), zone };
}

export function describeTimeZone(timeZone) {
  const zone = resolveTimeZone(timeZone);
  if (!zone) return 'UTC';
  return ZONE_NAMES[zone] ? `${ZONE_NAMES[zone]} (${zone})` : zone;
}

/**
 * Horários do evento no fuso do evento. Um horário em dia diferente do anterior
 * mostra a data completa (eventos que atravessam a meia-noite).
 */
export function describeEventSchedule(event) {
  const zone = event?.timezone;
  const start = formatInstantParts(event?.startsAt, zone);
  const official = formatInstantParts(event?.officialEndsAt, zone);
  const deadline = formatInstantParts(event?.operationalDeadlineAt, zone);
  const relative = (part, reference) => {
    if (!part) return null;
    return reference && reference.date === part.date ? part.time : `${part.date} às ${part.time}`;
  };
  return {
    date: start?.date ?? null,
    start: start ? start.time : null,
    entriesUntil: relative(official, start),
    finalDeadline: relative(deadline, official ?? start),
    zoneLabel: describeTimeZone(zone),
  };
}
