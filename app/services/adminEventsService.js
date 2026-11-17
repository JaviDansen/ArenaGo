const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const adminEventPhases = { scheduled: 'Agendado', not_ready: 'Não pronto', open: 'Aberto', closing: 'Encerrando', closed: 'Encerrado' };
const readinessChecks = ['nameAndAccessCode', 'validScheduleAndTimezone', 'externalQueueConfigured',
  'hasExperienceWithAvailableStation', 'hasVerifiedActiveStaff'];

class InvalidAdminEventResponse extends Error {}

function adminEventPath(eventId) {
  if (typeof eventId !== 'string' || !UUID.test(eventId)) throw new Error('Identificador de evento inválido.');
  return `/admin/events/${encodeURIComponent(eventId)}`;
}

export function parseAdminEvent(event) {
  if (!event || typeof event.id !== 'string' || !UUID.test(event.id) || typeof event.name !== 'string' || !event.name.trim() ||
      !Object.hasOwn(adminEventPhases, event.effectivePhase) || typeof event.timezone !== 'string' ||
      !Number.isFinite(Date.parse(event.startsAt)) || !Number.isFinite(Date.parse(event.officialEndsAt)) ||
      typeof event.readiness?.ready !== 'boolean') throw new InvalidAdminEventResponse('Resposta de evento inválida.');
  return event;
}
export function formatAdminDate(value, timezone) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Data indisponível';
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch { return 'Data indisponível'; }
}
export async function listAdminEvents(client, { search = '', phase = 'all', cursor = null, limit = 20 } = {}) {
  const params = [['limit', String(limit)], ['excludeClosed', 'true']];
  if (search.trim()) params.push(['search', search.trim().replace(/\s+/gu, ' ')]);
  if (phase !== 'all') params.push(['phase', phase]);
  if (cursor) params.push(['cursor', cursor]);
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const body = await client.get(`/admin/events?${query}`, { auth: true });
  if (!Array.isArray(body?.items) || !(body.nextCursor === null || typeof body.nextCursor === 'string')) throw new Error('Resposta de listagem inválida.');
  const items = body.items.map(parseAdminEvent);
  if (items.some(event => event.effectivePhase === 'closed')) throw new Error('A listagem retornou um evento encerrado.');
  return { items, nextCursor: body.nextCursor };
}
export async function getAdminEvent(client, eventId) {
  const event = parseAdminEvent((await client.get(adminEventPath(eventId), { auth: true }))?.event);
  if (typeof event.effectivePhase !== 'string' || !event.timezone.trim() || typeof event.startsAt !== 'string' ||
      typeof event.officialEndsAt !== 'string') throw new InvalidAdminEventResponse('Resposta de evento inválida.');
  if (event.id !== eventId) throw new InvalidAdminEventResponse('Evento retornado não corresponde à seleção.');
  return event;
}
export async function getAdminEventReadiness(client, eventId) {
  const result = await client.get(`${adminEventPath(eventId)}/readiness`, { auth: true });
  if (result?.eventId !== eventId || typeof result.effectivePhase !== 'string' || !Object.hasOwn(adminEventPhases, result.effectivePhase) ||
      !['scheduled', 'open', 'closing', 'closed'].includes(result.statusStored) ||
      typeof result.ready !== 'boolean' || typeof result.acceptingNewParticipations !== 'boolean' ||
      !Array.isArray(result.missing) || result.missing.some(code => typeof code !== 'string' || !code.trim()) ||
      !readinessChecks.every(check => typeof result.checks?.[check] === 'boolean') ||
      (result.ready && (result.missing.length > 0 || readinessChecks.some(check => !result.checks[check]))) ||
      (result.observedAt !== undefined && (typeof result.observedAt !== 'string' || !Number.isFinite(Date.parse(result.observedAt))))) {
    throw new InvalidAdminEventResponse('Resposta de prontidão inválida ou divergente da seleção.');
  }
  return result;
}
export function adminEventPanelError(error) {
  if (error instanceof InvalidAdminEventResponse) return 'A resposta da API não pôde ser confirmada para este evento.';
  return adminReadError(error);
}
export function adminReadError(error) {
  if (error?.status === 404) return 'Evento não encontrado ou indisponível.';
  if ([401, 403].includes(error?.status)) return 'Sua sessão não permite esta consulta. Entre novamente.';
  return 'Não foi possível consultar os eventos. Verifique a conexão e tente novamente.';
}

// One controller per mounted account/session. Invalidate immediately on query changes
// or disposal; a transport without abort support can never publish obsolete results.
export function createAdminEventsLoader(client, { isCurrent = () => true } = {}) {
  let generation = 0, pending = false, disposed = false;
  let filters = {}, state = { items: [], nextCursor: null, status: 'idle', error: null };
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
  async function load(reset = false) {
    if (disposed || !isCurrent() || pending || (!reset && !state.nextCursor)) return;
    const ticket = generation, cursor = reset ? null : state.nextCursor;
    pending = true;
    publish({ status: reset ? 'loading' : 'loadingMore', error: null });
    try {
      const result = await listAdminEvents(client, { ...filters, cursor });
      if (disposed || ticket !== generation || !isCurrent()) return;
      if (result.nextCursor && result.nextCursor === cursor) throw new Error('Cursor repetido.');
      const unique = new Map((reset ? [] : state.items).map(event => [event.id, event]));
      result.items.forEach(event => unique.set(event.id, event));
      publish({ items: [...unique.values()], nextCursor: result.nextCursor, status: 'ready' });
    } catch (error) {
      if (disposed || ticket !== generation || !isCurrent()) return;
      publish({ status: 'error', error: adminReadError(error),
        ...([401, 403].includes(error?.status) ? { items: [], nextCursor: null } : {}) });
    } finally { if (ticket === generation) pending = false; }
  }
  return {
    // React may replay mount effects in development; old requests stay invalid
    // because dispose advanced the generation before activation.
    activate() { disposed = false; },
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setFilters(next) {
      generation += 1; pending = false; filters = next;
      publish({ items: [], nextCursor: null, status: 'idle', error: null, queryKey: JSON.stringify(next) });
      return load(true);
    },
    more: () => load(false),
    retry: () => load(state.items.length === 0),
    dispose() { disposed = true; generation += 1; pending = false; listeners.clear(); state = { items: [], nextCursor: null, status: 'idle', error: null }; },
  };
}
