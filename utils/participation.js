/**
 * Utilitários de exibição das participações (Minhas Participações).
 */

// Instante registrado em ISO 8601 com fuso explícito, ex.: 2026-09-28T15:10:00-03:00.
const REGISTERED_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isValidCalendarDate(year, month, day) {
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

/**
 * Lê um instante registrado sem depender do Date.parse, que aceita datas
 * impossíveis (ex.: 31/02 vira 03/03).
 *
 * @param {string} value
 * @returns {{ time: string, timestamp: number }|null} null quando inválido
 */
function parseRegisteredInstant(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(REGISTERED_INSTANT);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second = '00', sign, offsetHour, offsetMinute] = match;
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber, secondNumber] = [
    year, month, day, hour, minute, second,
  ].map(Number);

  if (
    !isValidCalendarDate(yearNumber, monthNumber, dayNumber)
    || hourNumber > 23
    || minuteNumber > 59
    || secondNumber > 59
  ) {
    return null;
  }

  let offsetInMinutes = 0;
  if (sign) {
    if (Number(offsetHour) > 14 || Number(offsetMinute) > 59) {
      return null;
    }
    offsetInMinutes = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '-' ? -1 : 1);
  }

  return {
    time: `${hour}:${minute}`,
    timestamp: Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber)
      - offsetInMinutes * 60000,
  };
}

/**
 * Formata a data de uma participação como DD/MM/AAAA, a partir da data de
 * entrada (ISO 8601). Usa a própria data registrada, sem conversão de fuso.
 *
 * @param {string} isoDate
 * @returns {string|null} null quando a data não é válida
 */
export function formatParticipationDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') {
    return null;
  }
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;

  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) {
    return null;
  }

  return `${day}/${month}/${year}`;
}

/**
 * Tempo de permanência em minutos, calculado SOMENTE a partir da entrada e
 * da saída registradas. Sem saída registrada (ou com datas inválidas) não há
 * permanência válida: retorna null, sem estimar um valor.
 *
 * @param {{ enteredAt?: string|null, exitedAt?: string|null }} participation
 * @returns {number|null}
 */
export function getStayDurationInMinutes(participation) {
  const enteredAt = parseRegisteredInstant(participation?.enteredAt);
  const exitedAt = parseRegisteredInstant(participation?.exitedAt);

  if (!enteredAt || !exitedAt || exitedAt.timestamp <= enteredAt.timestamp) {
    return null;
  }
  return Math.round((exitedAt.timestamp - enteredAt.timestamp) / 60000);
}

/**
 * Busca uma participação pelo seu ID (e não pelo nome do evento, que se
 * repete quando a mesma pessoa participa mais de uma vez do mesmo evento).
 *
 * @param {Array<{ id: string }>} participations
 * @param {string} participationId
 * @returns {object|null} null quando o ID não existe ou é inválido
 */
export function findParticipationById(participations, participationId) {
  if (!Array.isArray(participations) || typeof participationId !== 'string' || participationId === '') {
    return null;
  }
  return participations.find((participation) => participation?.id === participationId) ?? null;
}

function getRegisteredTime(value) {
  if (value === null || value === undefined || value === '') {
    return { status: 'missing', time: null };
  }
  const instant = parseRegisteredInstant(value);
  return instant ? { status: 'registered', time: instant.time } : { status: 'invalid', time: null };
}

/**
 * Horários de entrada e saída (HH:MM, no fuso em que foram registrados) e o
 * tempo de permanência. Cada horário vem com a situação do registro:
 * 'registered', 'missing' (não registrado) ou 'invalid'. A saída também é
 * inválida quando não é posterior à entrada. Nada é estimado.
 *
 * @param {{ enteredAt?: string|null, exitedAt?: string|null }} participation
 * @returns {{
 *   entry: { status: string, time: string|null },
 *   exit: { status: string, time: string|null },
 *   stayDurationInMinutes: number|null,
 * }}
 */
export function getParticipationTimes(participation) {
  const entry = getRegisteredTime(participation?.enteredAt);
  let exit = getRegisteredTime(participation?.exitedAt);

  if (entry.status === 'registered' && exit.status === 'registered') {
    const enteredAt = parseRegisteredInstant(participation.enteredAt);
    const exitedAt = parseRegisteredInstant(participation.exitedAt);
    if (exitedAt.timestamp <= enteredAt.timestamp) {
      exit = { status: 'invalid', time: null };
    }
  }

  return { entry, exit, stayDurationInMinutes: getStayDurationInMinutes(participation) };
}

/**
 * Formata minutos como "1h 42min", "45min" ou "2h".
 *
 * @param {number|null} minutes
 * @returns {string|null} null quando não há valor válido
 */
export function formatStayDuration(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}min`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}min`;
}
