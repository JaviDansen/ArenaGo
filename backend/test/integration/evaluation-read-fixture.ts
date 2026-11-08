import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { app, pool, account, type Context } from "./event-closure-fixture";
export { setup, cleanup, app, pool, database, account, context, person, rich, state, close, controlled, immediate } from "./event-closure-fixture";
export type { Context } from "./event-closure-fixture";
export type Actor = Awaited<ReturnType<typeof account>>;
export const routes = (id: string) => [`/participations/${id}/evaluation-eligibility`, "/evaluations/pending", `/participations/${id}/evaluation`, "/participations/history", "/participations/return-state"];
export const get = (actor: Actor, route: string) => supertest(app.getHttpServer()).get(`/api/v1${route}`).set("Authorization", `Bearer ${actor.token}`);
export function problem(response: supertest.Response, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.body)); assert.equal(response.body.code, code); assert.equal(response.body.status, status);
  assert.match(response.headers["content-type"], /application\/problem\+json/);
}
export async function participant(c: Context, options: { actor?: Actor; status?: "waiting" | "active" | "finished" | "canceled"; days?: number; reason?: string } = {}) {
  const actor = options.actor ?? await account(), id = randomUUID(), status = options.status ?? "finished", terminal = status === "finished" || status === "canceled";
  const result = await pool.query(`WITH t AS (SELECT clock_timestamp()-$5::int*interval '24 hours' AS at)
    INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at,finished_at,finish_reason)
    SELECT $1,$2,$3,$4::varchar(20),t.at-interval '40 minutes',CASE WHEN $4::varchar(20) IN ('active','finished') THEN t.at-interval '35 minutes' END,
      CASE WHEN $6::boolean THEN t.at END,CASE WHEN $6::boolean THEN $7::varchar(40) END FROM t RETURNING id`,
  [id, actor.userId, c.eventId, status, options.days ?? 0, terminal, options.reason ?? "voluntary"]);
  assert.equal(result.rowCount, 1); return { ...actor, participationId: id };
}
export async function service(c: Context, participationId: string, status: "completed" | "absent" | "canceled" | "pending" = "completed") {
  const entryId = randomUUID(), sessionId = randomUUID(), pending = status === "pending";
  const order = (await pool.query("UPDATE experiences SET last_queue_order=last_queue_order+1 WHERE id=$1 RETURNING last_queue_order::text AS n", [c.experienceId])).rows[0].n;
  await pool.query(`INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at,closed_at,close_reason)
    SELECT $1,p.id,p.event_id,$3,$4::bigint,CASE WHEN $5::boolean THEN 'called' ELSE 'closed' END,p.joined_at+interval '10 minutes',
      CASE WHEN NOT $5::boolean THEN p.joined_at+interval '12 minutes' END,CASE WHEN NOT $5::boolean THEN $6::varchar(40) END
    FROM participations p WHERE p.id=$2`, [entryId, participationId, c.experienceId, order, pending, status]);
  await pool.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status,resolved_at,resolved_by_user_id,cancel_reason)
    SELECT $1,$2,$3,$4,$5,p.joined_at+interval '11 minutes',$6::varchar(20),
      CASE WHEN NOT $7::boolean THEN p.joined_at+interval '12 minutes' END,CASE WHEN NOT $7::boolean THEN $5::uuid END,
      CASE WHEN $6::varchar(20)='canceled' THEN 'fixture_canceled' END FROM participations p WHERE p.id=$8`,
  [sessionId, entryId, c.experienceId, c.stationId, c.staff.userId, status, pending, participationId]);
  if (pending) await pool.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1 AND status='active'", [participationId, entryId]);
  return { entryId, sessionId };
}
export async function evaluation(participationId: string, options: { days?: number; usedComment?: boolean; comment?: string | null } = {}) {
  const id = randomUUID(), comment = options.comment ?? null;
  await pool.query(`INSERT INTO evaluations(id,participation_id,rating,comment,submitted_at,updated_at,first_comment_at)
    VALUES($1,$2,4,$3,clock_timestamp()-$4::int*interval '24 hours',clock_timestamp(),
      CASE WHEN $5::boolean THEN clock_timestamp()-$4::int*interval '24 hours' END)`,
  [id, participationId, comment, options.days ?? 0, options.usedComment ?? comment !== null]);
  return id;
}
export async function expire(c: Context, days = 0) {
  return (await pool.query(`WITH t AS (SELECT clock_timestamp()-$2::int*interval '24 hours'-interval '1 second' AS at)
    UPDATE events e SET starts_at=t.at-interval '2 hours',official_ends_at=t.at-interval '30 minutes',operational_deadline_at=t.at
    FROM t WHERE e.id=$1 RETURNING to_char(t.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`, [c.eventId, days])).rows[0].at as string;
}
export async function ownState(c: Context, actor: Actor) {
  const r = (await pool.query(`SELECT jsonb_build_object(
    'participations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.user_id=$1),
    'evaluations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM evaluations v JOIN participations p ON p.id=v.participation_id WHERE p.user_id=$1),
    'queues',(SELECT jsonb_agg(to_jsonb(q)||jsonb_build_object('queue_order',q.queue_order::text) ORDER BY q.id) FROM queue_entries q JOIN participations p ON p.id=q.participation_id WHERE p.user_id=$1),
    'services',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id JOIN participations p ON p.id=q.participation_id WHERE p.user_id=$1),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM sessions s WHERE s.user_id=$1),
    'intents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=$1),
    'event',(SELECT to_jsonb(e)||jsonb_build_object('external_last_order',e.external_last_order::text) FROM events e WHERE e.id=$2)) AS value`, [actor.userId, c.eventId])).rows[0].value;
  return r;
}
