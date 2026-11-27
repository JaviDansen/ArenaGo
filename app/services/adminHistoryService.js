import { adminEventPath, adminIdentifier } from './adminEventsService';
import { validBiDuration, validBiRatings, validBiRanking } from './adminBiService';

const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = () => new Error('Resposta do Histórico inválida.');

function closedEvent(event) {
  if (event?.effectivePhase !== 'closed' || typeof event.name !== 'string' || !event.name.trim() ||
      typeof event.timezone !== 'string' || !event.timezone.trim() ||
      ![event.startsAt, event.officialEndsAt, event.closedAt].every(date)) throw invalid();
  const { id, name, timezone, effectivePhase, startsAt, officialEndsAt, closedAt } = event;
  return { id: adminIdentifier(id), name, timezone, effectivePhase, startsAt, officialEndsAt, closedAt };
}

export async function listAdminHistory(client, { search = '', period = 'all', cursor = null } = {}) {
  const params = [['period', period], ['search', search.trim()], ['cursor', cursor]]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const result = await client.get(`/admin/events/history?${params}`, { auth: true });
  if (!Array.isArray(result?.items) || !(result.nextCursor === null ||
      typeof result.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(result.nextCursor))) throw invalid();
  const items = result.items.map(item => {
    const { participations, evaluationCount, evaluationMean } = item;
    if (!count(participations) || !count(evaluationCount) ||
        (evaluationCount === 0 ? evaluationMean !== null :
          !Number.isFinite(evaluationMean) || evaluationMean < 1 || evaluationMean > 5)) throw invalid();
    return { ...closedEvent(item), participations, evaluationCount, evaluationMean };
  });
  return { items, nextCursor: result.nextCursor };
}

export async function getAdminHistorySummary(client, eventId) {
  const result = await client.get(`${adminEventPath(eventId)}/summary`, { auth: true });
  const event = closedEvent(result?.event);
  const { scheduledDurationSeconds, closedEarly } = result.event;
  const { observedAt, overview, ranking, ratings, durationA } = result;
  if (event.id !== eventId || !date(observedAt) || typeof closedEarly !== 'boolean' ||
      !Number.isFinite(scheduledDurationSeconds) || scheduledDurationSeconds < 0 ||
      !count(overview?.participations) || !count(overview?.completed) || !validBiRanking(ranking) ||
      ranking.reduce((sum, row) => sum + row.completed, 0) !== overview.completed ||
      !validBiRatings(ratings) || !validBiDuration(durationA)) throw invalid();
  return { event: { ...event, scheduledDurationSeconds, closedEarly }, observedAt, overview, ranking, ratings, durationA };
}
