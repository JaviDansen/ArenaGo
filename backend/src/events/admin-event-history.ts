import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { operationUuid } from '../common/http/operation-validation';
import { isPreciseInstant } from '../evaluations/evaluation-read.dto';
import { normalizeEventAccessCode, EventAccessCodeValidationError } from './access-code';
import { eventBiSchema } from './admin-bi';
import { configurationQuery } from './admin-configuration.dto';
import { effectiveEventDeadline, eventIsEffectivelyClosed } from './event-closure.projection';

const instant = z.custom<string>(isPreciseInstant);
const cursorSchema = z.object({ v: z.literal(1), closedAt: instant, id: operationUuid }).strict();
export function encodeHistoryCursor(closedAt: string, id: string) {
  return Buffer.from(JSON.stringify(cursorSchema.parse({ v: 1, closedAt, id }))).toString('base64url');
}

export const historyQuery = configurationQuery.pick({ limit: true, search: true }).extend({
  period: z.enum(['all', '7', '30', '90']).default('all'),
  cursor: z.string().transform((value, ctx) => {
    if (/^[A-Za-z0-9_-]{1,512}$/.test(value)) {
      try {
        const bytes = Buffer.from(value, 'base64url');
        if (bytes.toString('base64url') === value) {
          const cursor = cursorSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
          if (cursor.success) return cursor.data;
        }
      } catch { /* Report malformed cursors without exposing their content. */ }
    }
    ctx.addIssue({ code: 'custom', message: 'Cursor inválido.' });
    return z.NEVER;
  }).optional(),
}).strict();
export type HistoryPage = z.infer<typeof historyQuery>;

const historyEvent = z.object({
  id: operationUuid, name: z.string(), timezone: z.string(), effectivePhase: z.literal('closed'),
  startsAt: instant, officialEndsAt: instant, closedAt: instant,
});
export const historyCard = historyEvent.extend({
  participations: eventBiSchema.shape.overview.shape.participations,
  evaluationCount: eventBiSchema.shape.ratings.shape.count,
  evaluationMean: eventBiSchema.shape.ratings.shape.mean,
});
export const historySummary = eventBiSchema.pick({ observedAt: true, ranking: true, ratings: true, durationA: true }).extend({
  event: historyEvent.extend({
    scheduledDurationSeconds: z.number().nonnegative().finite(),
    closedEarly: z.boolean(),
  }),
  overview: eventBiSchema.shape.overview.pick({ participations: true, completed: true }),
});

function utc(value: SQL) {
  return sql`to_char(${value} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
function eligibleEvents(condition: SQL, clock: SQL) {
  return sql`SELECT e.id,e.name,e.timezone,e.starts_at,e.official_ends_at,
      ${effectiveEventDeadline()} AS closed_at,d.at
    FROM events e CROSS JOIN (SELECT ${clock} AS at) d
    WHERE ${eventIsEffectivelyClosed(sql`d.at`)} AND ${effectiveEventDeadline()}<=d.at AND ${condition}`;
}
const eventColumns = sql`p.id,p.name,p.timezone,'closed' AS "effectivePhase",
  ${utc(sql`p.starts_at`)} AS "startsAt",${utc(sql`p.official_ends_at`)} AS "officialEndsAt",
  ${utc(sql`p.closed_at`)} AS "closedAt"`;
const databaseClock = sql`transaction_timestamp()`;

function matchesSearch(search: string | undefined) {
  if (!search) return sql`true`;
  let code: string | null = null;
  try {
    code = normalizeEventAccessCode(search);
  } catch (error) {
    if (!(error instanceof EventAccessCodeValidationError)) throw error;
    // A substring need not itself be a complete, valid entry code.
    if (/^[A-Za-z0-9-]{1,64}$/.test(search)) code = search.toUpperCase();
  }
  const codeMatch = code ? sql`strpos(e.access_code_normalized,${code})>0` : sql`false`;
  return sql`(strpos(lower(regexp_replace(btrim(e.name),'[[:space:]]+',' ','g')),lower(${search}))>0 OR ${codeMatch})`;
}

export function closedEventsPageQuery(page: HistoryPage, clock: SQL = databaseClock) {
  const period = page.period === 'all' ? sql`true` : sql`p.closed_at>=p.at-${Number(page.period) * 24}::integer*interval '1 hour'`;
  const after = page.cursor ? sql`(p.closed_at,p.id)<(${page.cursor.closedAt}::timestamptz,${page.cursor.id}::uuid)` : sql`true`;
  return sql`WITH page AS MATERIALIZED (
    SELECT p.* FROM (${eligibleEvents(matchesSearch(page.search),clock)}) p
    WHERE ${period} AND ${after}
    ORDER BY p.closed_at DESC,p.id DESC LIMIT ${page.limit + 1}
  ), participation_counts AS (
    SELECT a.event_id,count(*) AS total FROM participations a JOIN page p ON p.id=a.event_id GROUP BY a.event_id
  ), evaluation_counts AS (
    SELECT a.event_id,count(*) AS total,avg(v.rating) AS mean
    FROM evaluations v JOIN participations a ON a.id=v.participation_id JOIN page p ON p.id=a.event_id GROUP BY a.event_id
  )
  SELECT ${eventColumns},coalesce(a.total,0)::float8 AS participations,
    coalesce(v.total,0)::float8 AS "evaluationCount",v.mean::float8 AS "evaluationMean"
  FROM page p LEFT JOIN participation_counts a ON a.event_id=p.id
    LEFT JOIN evaluation_counts v ON v.event_id=p.id ORDER BY p.closed_at DESC,p.id DESC`;
}

export function closedEventIdentificationQuery(eventId: string, clock: SQL = databaseClock) {
  return sql`SELECT ${eventColumns},${utc(sql`p.at`)} AS "observedAt",
    extract(epoch FROM p.official_ends_at-p.starts_at)::float8 AS "scheduledDurationSeconds",
    p.closed_at<p.official_ends_at AS "closedEarly"
    FROM (${eligibleEvents(sql`e.id=${eventId}::uuid`,clock)}) p`;
}
