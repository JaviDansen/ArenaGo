// Datas e fusos da Área Admin (demonstração). Funções puras e determinísticas:
// nenhuma usa o fuso do aparelho (nada de getHours/getTimezoneOffset). Os
// horários digitados são interpretados no fuso IANA escolhido para o evento e
// convertidos para instantes UTC, como no contrato §18.3.
import { adminTimezones } from '../../data/adminDemoData';

const MINUTE_MS = 60 * 1000;
const MIN_YEAR = 2020;
const MAX_YEAR = 2099;

const hasOwn = (object, key) =>
  object != null && Object.prototype.hasOwnProperty.call(object, key);

const timezoneById = adminTimezones.reduce((map, zone) => {
  map[zone.id] = zone;
  return map;
}, Object.create(null));

export function findTimezone(id) {
  if (typeof id !== 'string' || !hasOwn(timezoneById, id)) return null;
  return timezoneById[id];
}

export function isSupportedTimezone(id) {
  return findTimezone(id) !== null;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// "DD/MM/AAAA" → { year, month, day } apenas se for uma data real.
export function parseLocalDate(text) {
  if (typeof text !== 'string') return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return { year, month, day };
}

// "HH:MM" (24 h) → { hour, minute }.
export function parseLocalTime(text) {
  if (typeof text !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// Data/hora local do evento → instante UTC em ISO. Retorna null se algo for inválido.
export function localToInstant(dateText, timeText, timezoneId) {
  const zone = findTimezone(timezoneId);
  const date = parseLocalDate(dateText);
  const time = parseLocalTime(timeText);
  if (!zone || !date || !time) return null;
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  return new Date(localAsUtc - zone.offsetMinutes * MINUTE_MS).toISOString();
}

// Instante UTC → { date: "DD/MM/AAAA", time: "HH:MM" } no fuso do evento.
export function splitInstant(iso, timezoneId) {
  const zone = findTimezone(timezoneId);
  const ms = toMs(iso);
  if (!zone || ms === null) return null;
  const local = new Date(ms + zone.offsetMinutes * MINUTE_MS);
  return {
    date: `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

export function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes ? `:${pad(minutes)}` : ''}`;
}

// "05/11/2026 10:00" no fuso do evento.
export function formatInstant(iso, timezoneId) {
  const parts = splitInstant(iso, timezoneId);
  return parts ? `${parts.date} ${parts.time}` : '—';
}

// "05/11/2026 10:00 (America/Sao_Paulo, UTC−3)".
export function formatInstantWithZone(iso, timezoneId) {
  const zone = findTimezone(timezoneId);
  if (!zone) return '—';
  return `${formatInstant(iso, timezoneId)} (${zone.id}, ${formatUtcOffset(zone.offsetMinutes)})`;
}

export function toMs(iso) {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function addMinutes(iso, minutes) {
  const ms = toMs(iso);
  return ms === null ? null : new Date(ms + minutes * MINUTE_MS).toISOString();
}

export function minutesBetween(fromIso, toIso) {
  const from = toMs(fromIso);
  const to = toMs(toIso);
  if (from === null || to === null) return null;
  return Math.round((to - from) / MINUTE_MS);
}

export function earliest(...isoValues) {
  const valid = isoValues.filter((value) => toMs(value) !== null);
  if (valid.length === 0) return null;
  return valid.reduce((min, value) => (toMs(value) < toMs(min) ? value : min));
}

// Soma minutos a uma data/hora LOCAL digitada ("05/11/2026", "18:00" + 30 →
// "05/11/2026", "18:30"). Aritmética de relógio de parede, sem fuso do aparelho
// (os fusos aceitos não têm horário de verão). Usada nos atalhos de margem.
export function shiftLocal(dateText, timeText, minutes) {
  const date = parseLocalDate(dateText);
  const time = parseLocalTime(timeText);
  if (!date || !time || !Number.isInteger(minutes)) return null;
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute)
    + minutes * MINUTE_MS);
  return {
    date: `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

// Máscara de digitação: "05112026" → "05/11/2026"; "1030" → "10:30".
export function maskDateInput(text) {
  const digits = String(text ?? '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function maskTimeInput(text) {
  const digits = String(text ?? '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
