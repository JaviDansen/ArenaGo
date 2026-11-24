import { adminEventPath, adminEventPhases, mutationOptions } from './adminEventsService';

const explicitInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const instant = value => typeof value === 'string' && explicitInstant.test(value) && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0;

function instantMicros(value) {
  const remainder = /\.\d{3}(\d{1,3})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1];
  return BigInt(Date.parse(value)) * 1000n + BigInt(remainder?.padEnd(3, '0') ?? 0);
}

function validTimezone(value) {
  if (typeof value !== 'string' || !value.trim() || /^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }); return true; }
  catch { return false; }
}

export async function readAdminEventOperation(client, eventId) {
  const result = await client.get(`${adminEventPath(eventId)}/operation`, { auth: true });
  if (result?.eventId !== eventId || typeof result.name !== 'string' || !result.name.trim() ||
      !validTimezone(result.timezone) || typeof result.effectivePhase !== 'string' ||
      !Object.hasOwn(adminEventPhases, result.effectivePhase) ||
      !['observedAt', 'startsAt', 'officialEndsAt', 'operationalDeadlineAt'].every(field => instant(result[field])) ||
      ![null, 'immediate', 'controlled'].includes(result.closureMode) ||
      !['closureRequestedAt', 'adminDeadlineAt'].every(field => result[field] === null || instant(result[field])) ||
      !['externalQueueEnabled', 'canSetExternalQueue', 'canClose'].every(field => typeof result[field] === 'boolean')) {
    throw new Error('A resposta de operação não pôde ser confirmada para este evento.');
  }
  return {
    ...result,
    activeParticipants: count(result.activeParticipants) ? result.activeParticipants : null,
    externalWaitingParticipants: count(result.externalWaitingParticipants) ? result.externalWaitingParticipants : null,
  };
}

export async function sendAdminEventOperation(client, { eventId, kind, body, key }) {
  const path = adminEventPath(eventId), options = { ...mutationOptions(key), expectedStatus: 200 };
  if (kind === 'queue') {
    const result = await client.patch(`${path}/external-queue`, body, options);
    if (result?.eventId !== eventId || result.externalQueueEnabled !== body.enabled || !count(result.releasedCount) ||
        (body.enabled && result.releasedCount !== 0) ||
        (result.changedAt === undefined ? result.releasedCount !== 0 : !instant(result.changedAt))) {
      throw new Error('O resultado da alteração da fila não pôde ser confirmado.');
    }
    return result;
  }
  if (kind !== 'close') throw new Error('Operação desconhecida.');
  const result = await client.post(`${path}/close`, body, options);
  const immediate = body.mode === 'immediate';
  if (result?.eventId !== eventId || result.closureMode !== body.mode || result.status !== (immediate ? 'closed' : 'closing') ||
      !instant(result.newEntriesClosedAt) || !instant(result.effectiveOperationalDeadlineAt) ||
      !count(result.externalWaitingFinalized) ||
      (immediate ? instantMicros(result.effectiveOperationalDeadlineAt) > instantMicros(result.newEntriesClosedAt) :
        !instant(body.controlledUntilAt) || instantMicros(result.effectiveOperationalDeadlineAt) !== instantMicros(body.controlledUntilAt) ||
        instantMicros(result.newEntriesClosedAt) >= instantMicros(result.effectiveOperationalDeadlineAt))) {
    throw new Error('O resultado do encerramento não pôde ser confirmado.');
  }
  return result;
}
