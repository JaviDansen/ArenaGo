import { resolveEventTime } from './adminScheduleForm';

export function configurationName(value, limit = 180) {
  const name = value.trim();
  if (!name || Array.from(name).length > limit || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(name)) {
    throw new Error(limit === 180 ? 'Informe um nome válido de até 180 caracteres.' :
      'Informe uma identificação válida de até ' + limit + ' caracteres.');
  }
  return name;
}

export function eventIdentity(form) {
  const name = configurationName(form.name);
  const code = form.accessCode.trim();
  if (code.length < 4 || code.length > 64 || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(code)) {
    throw new Error('Use de 4 a 64 letras ou números ASCII, com hífens apenas entre grupos.');
  }
  return { name, accessCode: code.toUpperCase() };
}

export function creationTimezone(value) {
  const zone = value.trim();
  if (zone && zone.length <= 80 && !/^[+-]/.test(zone)) {
    try { return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone; }
    catch { /* show the field error below */ }
  }
  throw new Error('Informe um fuso IANA válido, como America/Fortaleza.');
}

export function creationDeadline(end, margin) {
  if (!/^\d{1,2}$/.test(margin) || Number(margin) > 60) throw new Error('Informe uma margem de 0 a 60 minutos.');
  return new Date(Date.parse(end) + Number(margin) * 60_000).toISOString();
}

export function creationBody(form) {
  const timezone = creationTimezone(form.timezone);
  const startsAt = resolveEventTime(form.start, timezone);
  const officialEndsAt = resolveEventTime(form.end, timezone);
  if (startsAt >= officialEndsAt) throw new Error('O término oficial deve ser posterior ao início.');
  return { ...eventIdentity(form), timezone, startsAt, officialEndsAt,
    operationalDeadlineAt: creationDeadline(officialEndsAt, form.margin), externalQueueEnabled: form.externalQueueEnabled };
}

export function confirmOfficialEnd(officialEndsAt, now) {
  if (Date.parse(officialEndsAt) <= now) throw new Error('O término oficial deve ser futuro para criar o evento neste fluxo.');
}

export function staffEmail(value) {
  const email = value.trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  return email;
}
