import { sql } from 'drizzle-orm';
import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const duration = z.object({ meanSeconds: z.number().nonnegative().finite().nullable(), population: count });
export const eventBiSchema = z.object({
  event: z.object({ id: z.string().uuid(), name: z.string(), timezone: z.string(), effectivePhase: z.enum(['scheduled','not_ready','open','closing','closed']) }),
  observedAt: z.string().datetime(),
  overview: z.object({ participations: count, arenaEntries: count, completed: count, absent: count }),
  ranking: z.array(z.object({ id: z.string().uuid(), name: z.string(), completed: count, percent: z.number().min(0).max(100) })),
  ratings: z.object({ count, mean: z.number().min(1).max(5).nullable(), distribution: z.array(z.object({ stars: z.number().int().min(1).max(5), count, percent: z.number().min(0).max(100) })).length(5) }),
  durationA: duration, durationB: duration,
  audience: z.object({ available: z.literal(false), reason: z.literal('PRIVACY_POLICY_PENDING') }),
});

/** Independent aggregates prevent fan-out across participations, sessions and evaluations. */
export function eventBiQuery(eventId: string) {
  return sql`WITH people AS (
    SELECT id,arena_entered_at,finished_at,status,finish_reason FROM participations WHERE event_id=${eventId}::uuid
  ), services AS (
    SELECT s.* FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=${eventId}::uuid
  ), ranked AS (
    SELECT x.id,x.name,count(*)::int AS completed FROM services s JOIN experiences x ON x.id=s.experience_id
    WHERE s.status='completed' GROUP BY x.id,x.name
  ), notes AS (
    SELECT v.rating FROM evaluations v JOIN people p ON p.id=v.participation_id
  ), a AS (
    SELECT extract(epoch FROM (max(s.resolved_at)-p.arena_entered_at)) AS seconds
    FROM people p JOIN queue_entries q ON q.participation_id=p.id JOIN services s ON s.queue_entry_id=q.id
    WHERE p.arena_entered_at IS NOT NULL AND s.status='completed' AND s.resolved_at IS NOT NULL
    GROUP BY p.id,p.arena_entered_at HAVING max(s.resolved_at)>=p.arena_entered_at
  ), b AS (
    SELECT extract(epoch FROM (finished_at-arena_entered_at)) AS seconds FROM people
    WHERE status='finished' AND finish_reason='voluntary' AND arena_entered_at IS NOT NULL AND finished_at>=arena_entered_at
  ) SELECT jsonb_build_object(
    'overview',jsonb_build_object('participations',(SELECT count(*) FROM people),'arenaEntries',(SELECT count(*) FROM people WHERE arena_entered_at IS NOT NULL),
      'completed',(SELECT count(*) FROM services WHERE status='completed'),'absent',(SELECT count(*) FROM services WHERE status='absent')),
    'ranking',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'completed',completed,
      'percent',100.0*completed/nullif((SELECT sum(completed) FROM ranked),0)) ORDER BY completed DESC,id ASC) FROM ranked),'[]'::jsonb),
    'ratings',jsonb_build_object('count',(SELECT count(*) FROM notes),'mean',(SELECT avg(rating) FROM notes),
      'distribution',(SELECT jsonb_agg(jsonb_build_object('stars',stars,'count',(SELECT count(*) FROM notes WHERE rating=stars),
        'percent',coalesce(100.0*(SELECT count(*) FROM notes WHERE rating=stars)/nullif((SELECT count(*) FROM notes),0),0)) ORDER BY stars) FROM generate_series(1,5) stars)),
    'durationA',jsonb_build_object('meanSeconds',(SELECT avg(seconds) FROM a),'population',(SELECT count(*) FROM a)),
    'durationB',jsonb_build_object('meanSeconds',(SELECT avg(seconds) FROM b),'population',(SELECT count(*) FROM b))
  ) AS metrics`;
}

/** Synthetic preparation only. Suppress the entire dimension if any cell/complement is small.
 * No denominator, suppressed category or partial breakdown leaves this boundary. */
export function suppressAudienceDimension(counts: ReadonlyMap<string, number>, denominator: number) {
  if (!Number.isSafeInteger(denominator) || denominator < 20 || !counts.size
      || [...counts.values()].some(n => !Number.isSafeInteger(n) || n < 10 || denominator - n < 10)) return null;
  return [...counts].map(([category, n]) => ({ category, percent: n * 100 / denominator }));
}

type AudienceSnapshot = { userId: string; participationId: string; enteredAt: string | null;
  questionnaireVersionId: string; answers: unknown; gamesSnapshot: unknown };
/** Synthetic-only preparation. The public endpoint never calls this or exposes these inputs. */
export function prepareAudience(snapshots: readonly AudienceSnapshot[]) {
  const first = new Map<string, AudienceSnapshot>();
  for (const row of snapshots.filter(r => r.enteredAt && Number.isFinite(Date.parse(r.enteredAt)))
    .slice().sort((a,b) => Date.parse(a.enteredAt!) - Date.parse(b.enteredAt!) || a.participationId.localeCompare(b.participationId))) {
    if (!first.has(row.userId)) first.set(row.userId,row);
  }
  const rows = [...first.values()];
  if (new Set(rows.map(r=>r.questionnaireVersionId)).size !== 1) return { age: null, gender: null, games: null };
  const genders = new Map<string,number>(), games = new Map<string,number>();
  let genderPopulation=0, gamePopulation=0;
  for (const row of rows) {
    const parsed=z.object({schemaVersion:z.literal(1),gender:z.enum(['Feminino','Masculino','Outro','Prefiro não informar'])}).safeParse(row.answers);
    if (parsed.success) { genderPopulation++; genders.set(parsed.data.gender,(genders.get(parsed.data.gender)??0)+1); }
    // Curated game IDs only: free text names are never disclosed.
    const selected=z.array(z.object({gameId:z.string().uuid(),isCurated:z.boolean()})).safeParse(row.gamesSnapshot);
    if (selected.success && selected.data.length) {
      gamePopulation++;
      for(const id of new Set(selected.data.filter(g=>g.isCurated).map(g=>g.gameId))) games.set(id,(games.get(id)??0)+1);
    }
  }
  return { age: null, gender: suppressAudienceDimension(genders,genderPopulation), games: suppressAudienceDimension(games,gamePopulation) };
}
