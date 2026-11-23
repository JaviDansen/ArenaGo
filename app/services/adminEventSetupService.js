import { adminEventPath, adminIdentifier, mutationOptions, parseAdminEvent } from './adminEventsService';

function confirm(condition) {
  if (!condition) throw new Error('Resposta administrativa divergente.');
}

export async function createAdminEvent(client, body, key) {
  const response = await client.post('/admin/events', body, mutationOptions(key));
  const event = parseAdminEvent(response?.event);
  confirm(event.accessCode === body.accessCode && event.name === body.name &&
    new Intl.DateTimeFormat('en', { timeZone: event.timezone }).resolvedOptions().timeZone === body.timezone &&
    event.externalQueueEnabled === body.externalQueueEnabled &&
    ['startsAt', 'officialEndsAt', 'operationalDeadlineAt'].every(field => Date.parse(event[field]) === Date.parse(body[field])));
  return event;
}

function experienceOf(value, eventId) {
  adminIdentifier(value?.id);
  confirm(value.eventId === eventId && typeof value.name === 'string' && value.name.trim());
  return value;
}

function stationOf(value, experienceId) {
  adminIdentifier(value?.id);
  confirm(value.experienceId === experienceId && typeof value.label === 'string' && value.label.trim() &&
    ['available', 'unavailable'].includes(value.availability));
  return value;
}

export async function readEventStructure(client, eventId) {
  const result = await client.get(`${adminEventPath(eventId)}/experiences`, { auth: true });
  confirm(result?.eventId === eventId && Array.isArray(result.items));
  for (const item of result.items) {
    experienceOf(item, eventId);
    confirm(Array.isArray(item.stations));
    for (const station of item.stations) stationOf(station, item.id);
  }
  return result.items;
}

export async function addEventExperience(client, eventId, name, key) {
  const result = await client.post(`${adminEventPath(eventId)}/experiences`, { name }, mutationOptions(key));
  const experience = experienceOf(result?.experience, eventId);
  confirm(experience.name === name);
  return experience;
}

export async function addEventStation(client, eventId, experienceId, label, key) {
  const path = `${adminEventPath(eventId)}/experiences/${adminIdentifier(experienceId)}/stations`;
  const result = await client.post(path, { label }, mutationOptions(key));
  const station = stationOf(result?.station, experienceId);
  confirm(station.label === label);
  return station;
}

function grantTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function eventGrant(value, eventId) {
  adminIdentifier(value?.id);
  adminIdentifier(value.userId);
  confirm(value.role === 'staff' && value.eventId === eventId && grantTimestamp(value.grantedAt));
  return value;
}

export async function readEventStaff(client, eventId) {
  const result = await client.get(`${adminEventPath(eventId)}/staff`, { auth: true });
  confirm(result?.eventId === eventId && Array.isArray(result.items));
  const grants = new Set(), users = new Set();
  return result.items.map(member => {
    const { grantId, userId, name, email, grantedAt, eligible } = member;
    const grant = eventGrant({ id: grantId, userId, role: 'staff', eventId, grantedAt, revokedAt: null }, eventId);
    confirm(typeof name === 'string' && typeof email === 'string' && typeof eligible === 'boolean' &&
      !grants.has(grantId.toLowerCase()) && !users.has(userId.toLowerCase()));
    grants.add(grantId.toLowerCase());
    users.add(userId.toLowerCase());
    return { ...grant, name, email, eligible };
  });
}

export async function renameExperience(client, eventId, experienceId, name, key) {
  const path = `${adminEventPath(eventId)}/experiences/${adminIdentifier(experienceId)}`;
  const result = await client.patch(path, { name }, mutationOptions(key));
  const experience = experienceOf(result?.experience, eventId);
  confirm(experience.id === experienceId && experience.name === name);
  return experience;
}

export async function renameStation(client, eventId, experienceId, stationId, label, key) {
  const path = `${adminEventPath(eventId)}/experiences/${adminIdentifier(experienceId)}/stations/${adminIdentifier(stationId)}`;
  const result = await client.patch(path, { label }, mutationOptions(key));
  const station = stationOf(result?.station, experienceId);
  confirm(station.id === stationId && station.label === label);
  return station;
}

export async function setStationAvailability(client, eventId, stationId, availability) {
  confirm(['available', 'unavailable'].includes(availability));
  const path = `/staff/events/${adminIdentifier(eventId)}/stations/${adminIdentifier(stationId)}/availability`;
  const station = await client.patch(path, { availability }, {
    auth: true, retryOnUnauthorized: false, outcomeUnknownOnNetworkError: true,
  });
  confirm(station?.stationId === stationId && station.availability === availability);
  if (station.pendingServiceSessionId !== null) adminIdentifier(station.pendingServiceSessionId);
  return station;
}

export async function grantEventStaff(client, eventId, email, key) {
  const result = await client.post('/admin/roles/grant', { role: 'staff', eventId: adminIdentifier(eventId), email },
    { ...mutationOptions(key), expectedStatus: 201 });
  const grant = eventGrant(result?.grant, eventId);
  confirm(grant.revokedAt === null);
  return grant;
}

export async function revokeEventStaff(client, eventId, grant, key) {
  eventGrant(grant, eventId);
  confirm(grant.revokedAt === null);
  const result = await client.post('/admin/roles/revoke', { grantId: grant.id }, { ...mutationOptions(key), expectedStatus: 200 });
  const revoked = eventGrant(result?.grant, eventId);
  confirm(revoked.id === grant.id && revoked.userId === grant.userId && grantTimestamp(revoked.revokedAt));
  return revoked;
}
