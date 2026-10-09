function readCivilDate(iso) {
  if (typeof iso !== 'string') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return null;

  return { year, month, day };
}

export function maskBirthDate(text) {
  const digits = String(text ?? '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseBirthDate(display, todayISO = getTodayCivilDate()) {
  if (typeof display !== 'string') return null;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display.trim());
  if (!match) return null;

  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  if (!readCivilDate(iso) || !readCivilDate(todayISO) || iso > todayISO) return null;
  return iso;
}

export function formatBirthDate(iso) {
  if (!readCivilDate(iso)) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function getTodayCivilDate(now = new Date()) {
  return localDateToCivilDate(now);
}

export function civilDateToLocalDate(iso) {
  const parts = readCivilDate(iso);
  if (!parts) return null;

  // O ano explícito evita a conversão de 00–99 para 1900–1999 do construtor Date.
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

export function localDateToCivilDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  if (year < 1 || year > 9999) return null;

  // Apenas componentes locais: a conversão para UTC poderia mudar o dia escolhido.
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}
