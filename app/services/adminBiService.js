import { adminEventPath, adminEventPhases } from './adminEventsService';
const count = n => Number.isSafeInteger(n) && n >= 0;
const nullable = n => n === null || (Number.isFinite(n) && n >= 0);
export function parseAdminBi(v, eventId) {
  if (v?.event?.id !== eventId || typeof v.event.name !== 'string' || !Object.hasOwn(adminEventPhases,v.event.effectivePhase) ||
      typeof v.event.timezone !== 'string' || !Number.isFinite(Date.parse(v.observedAt)) ||
      !['participations','arenaEntries','completed','absent'].every(k => count(v.overview?.[k])) ||
      !Array.isArray(v.ranking) || v.ranking.some(r => typeof r.id !== 'string' || typeof r.name !== 'string' || !count(r.completed) || !Number.isFinite(r.percent) || r.percent<0 || r.percent>100) ||
      !count(v.ratings?.count) || !nullable(v.ratings.mean) || (v.ratings.mean!==null && (v.ratings.mean<1 || v.ratings.mean>5)) || !Array.isArray(v.ratings.distribution) || v.ratings.distribution.length!==5 ||
      v.ratings.distribution.some((r,i) => r.stars!==i+1 || !count(r.count) || !Number.isFinite(r.percent) || r.percent<0 || r.percent>100) ||
      ![v.durationA,v.durationB].every(d => d && count(d.population) && nullable(d.meanSeconds) && ((d.population===0)===(d.meanSeconds===null))) ||
      v.audience?.available!==false) throw new Error('Resposta de BI inválida.');
  if (v.ratings.distribution.reduce((n,r)=>n+r.count,0)!==v.ratings.count || ((v.ratings.count===0)!==(v.ratings.mean===null))) throw new Error('Distribuição inválida.');
  return v;
}
export async function getAdminBi(client,eventId) {
  return parseAdminBi(await client.get(`${adminEventPath(eventId)}/bi`,{auth:true}),eventId);
}
