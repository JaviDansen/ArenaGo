import { adminEventPath, adminEventPhases } from './adminEventsService';
const count = n => Number.isSafeInteger(n) && n >= 0;
const nullable = n => n === null || (Number.isFinite(n) && n >= 0);
export const validBiRanking = ranking => Array.isArray(ranking) && ranking.every(r =>
  r && typeof r.id === 'string' && typeof r.name === 'string' && count(r.completed) &&
  Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100);
export const validBiRatings = ratings => count(ratings?.count) && nullable(ratings.mean) &&
  (ratings.mean === null || ratings.mean >= 1 && ratings.mean <= 5) &&
  Array.isArray(ratings.distribution) && ratings.distribution.length === 5 &&
  ratings.distribution.every((r, i) => r && r.stars === i + 1 && count(r.count) &&
    Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100) &&
  ratings.distribution.reduce((total, r) => total + r.count, 0) === ratings.count &&
  ((ratings.count === 0) === (ratings.mean === null));
export const validBiDuration = d => d && count(d.population) && nullable(d.meanSeconds) &&
  ((d.population === 0) === (d.meanSeconds === null));
export function parseAdminBi(v, eventId) {
  if (v?.event?.id !== eventId || typeof v.event.name !== 'string' || !Object.hasOwn(adminEventPhases,v.event.effectivePhase) ||
      typeof v.event.timezone !== 'string' || !Number.isFinite(Date.parse(v.observedAt)) ||
      !['participations','arenaEntries','completed','absent'].every(k => count(v.overview?.[k])) ||
      !validBiRanking(v.ranking) || !validBiRatings(v.ratings) || ![v.durationA,v.durationB].every(validBiDuration) ||
      v.audience?.available!==false) throw new Error('Resposta de BI inválida.');
  return v;
}
export async function getAdminBi(client,eventId) {
  return parseAdminBi(await client.get(`${adminEventPath(eventId)}/bi`,{auth:true}),eventId);
}
