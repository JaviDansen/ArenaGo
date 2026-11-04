import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import type { EventClosureService } from "../../src/events/event-closure.service";
import type { EventClosureScheduler } from "../../src/events/event-closure.scheduler";
import * as schema from "../../src/database/schema";
import { setup, cleanup, app, pool, database, context, person, readyEntrant, admit, join, state, audit, blocked, ordered, waitPast,
  close, immediate, controlled, call, resolve, withdraw, queued, called, rich, assertNoOpen, proposal, patch, external, station, bareEvent, type Context } from "./event-closure-fixture";

let closure: EventClosureService;
let Service: typeof import("../../src/events/event-closure.service").EventClosureService;
let Scheduler: typeof import("../../src/events/event-closure.scheduler").EventClosureScheduler;
before(async () => {
  await setup(); Service = (await import("../../src/events/event-closure.service")).EventClosureService;
  Scheduler = (await import("../../src/events/event-closure.scheduler")).EventClosureScheduler; closure = app.get(Service);
});
after(cleanup);

async function deadline(c: Context, seconds = -2, mode: "normal" | "controlled" = "normal") {
  const r = await pool.query(`WITH d AS (SELECT date_trunc('seconds',clock_timestamp())+$2::int*interval '1 second'+interval '0.123456 second' AS at)
    UPDATE events e SET starts_at=d.at-interval '1 hour',official_ends_at=d.at,
      operational_deadline_at=d.at+CASE WHEN $3::boolean THEN interval '30 minutes' ELSE interval '0' END,
      status=CASE WHEN $3::boolean THEN 'closing' ELSE 'open' END,
      closure_mode=CASE WHEN $3::boolean THEN 'controlled'::varchar(20) END,
      closure_requested_at=CASE WHEN $3::boolean THEN d.at-interval '10 minutes' END,
      admin_deadline_at=CASE WHEN $3::boolean THEN d.at END
    FROM d WHERE e.id=$1 RETURNING to_char(d.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
      (clock_timestamp()-d.at+interval '5 minutes')::text AS shift`, [c.eventId, seconds, mode === "controlled"]);
  const at = r.rows[0].at as string;
  if (seconds <= 0) {
    // Envelhece somente a preparação da fixture: nenhuma chamada/conclusão ou
    // entrada ocorre historicamente depois do limite que o job vai regularizar.
    const shift = r.rows[0].shift as string;
    // Mesmo intervalo em todas as linhas mantém a ordem histórica e a igualdade
    // entre resolved_at e closed_at das operações anteriores.
    await pool.query(`UPDATE participations SET joined_at=joined_at-$2::interval,
      arena_entered_at=arena_entered_at-$2::interval,finished_at=finished_at-$2::interval WHERE event_id=$1`, [c.eventId, shift]);
    await pool.query(`UPDATE queue_entries SET entered_at=entered_at-$2::interval,
      closed_at=closed_at-$2::interval WHERE event_id=$1`, [c.eventId, shift]);
    await pool.query(`UPDATE service_sessions s SET called_at=called_at-$2::interval,resolved_at=resolved_at-$2::interval
      FROM experiences x WHERE s.experience_id=x.id AND x.event_id=$1`, [c.eventId, shift]);
    await pool.query(`UPDATE participation_profile_snapshots s SET captured_at=captured_at-$2::interval
      FROM participations p WHERE s.participation_id=p.id AND p.event_id=$1`, [c.eventId, shift]);
    await pool.query(`UPDATE evaluations v SET submitted_at=v.submitted_at-$2::interval,updated_at=v.updated_at-$2::interval,
      first_comment_at=v.first_comment_at-$2::interval FROM participations p WHERE v.participation_id=p.id AND p.event_id=$1`, [c.eventId, shift]);
  }
  return at;
}
async function waitUntil(at: string) {
  const until = Date.now() + 14000;
  while (Date.now() < until) { if ((await pool.query("SELECT clock_timestamp()>=$1::timestamptz AS ended", [at])).rows[0].ended) return; await new Promise(done => setTimeout(done, 20)); }
  assert.fail("Prazo PostgreSQL não alcançado.");
}
function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return sqlState(error.cause);
}
function scheduler(): EventClosureScheduler { return new Scheduler(closure, { configuration: { enabled: true, intervalMs: 1000 } }); }
async function assertExact(c: Context, at: string) {
  const r = (await pool.query(`SELECT
    (SELECT status='closed' FROM events WHERE id=$1) AS closed,
    NOT EXISTS(SELECT 1 FROM participations WHERE event_id=$1 AND finish_reason LIKE 'automatic_%' AND finished_at<>$2::timestamptz) AS people,
    NOT EXISTS(SELECT 1 FROM queue_entries WHERE event_id=$1 AND close_reason LIKE 'automatic_%' AND closed_at<>$2::timestamptz) AS queues,
    NOT EXISTS(SELECT 1 FROM service_sessions s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=$1 AND s.cancel_reason LIKE 'automatic_%'
      AND (s.resolved_at<>$2::timestamptz OR s.resolved_by_user_id IS NOT NULL)) AS services`, [c.eventId, at])).rows[0];
  assert.deepEqual(r, { closed: true, people: true, queues: true, services: true });
}

for (const mode of ["normal", "controlled"] as const) test(`E08.9 PostgreSQL ${mode} encerra todos os correntes no prazo exato sem modificar histórico ou outro evento`, async () => {
  const c = await context(), other = await context();
  // Cria histórico real de absent e canceled em operações anteriores ao corte.
  const canceled = await called(c); assert.equal((await withdraw(c, canceled.p, canceled.entry)).status, 200);
  const absent = await called(c), absence = await resolve(c, absent.session, "absent"); assert.equal(absence.status, 200); assert.equal(absence.body.requeued, true);
  assert.equal((await withdraw(c, absent.p, absence.body.newQueueEntry.id)).status, 200);
  const data = await rich(c); await rich(other);
  const at = await deadline(c, -2, mode), before = await state(c), otherBefore = await state(other), result = await closure.regularizeEvent(c.eventId);
  assert.equal(result.kind, "closed"); if (result.kind !== "closed") assert.fail(); assert.equal(result.deadlineAt, at); assert.ok(result.executedAt > at);
  await assertNoOpen(c); await assertExact(c, at); const after = await state(c);
  for (const key of ["experiences", "stations", "snapshots", "audits", "idempotency"]) assert.deepEqual(after[key], before[key]);
  for (const p of before.people) { const next = after.people.find((x: { id: string }) => x.id === p.id); if (["finished", "canceled"].includes(p.status)) assert.deepEqual(next, p);
    else { assert.equal(next.status, "finished"); assert.equal(next.finish_reason, mode === "normal" ? "automatic_operational_deadline" : "automatic_admin_deadline"); assert.equal(next.current_queue_entry_id, null); assert.equal(next.external_queue_order, p.external_queue_order); } }
  for (const s of before.services) { const next = after.services.find((x: { id: string }) => x.id === s.id); if (s.status !== "pending") assert.deepEqual(next, s); else { assert.equal(next.status, "canceled"); assert.equal(next.resolved_by_user_id, null); } }
  for (const q of before.queues) if (q.status === "closed") assert.deepEqual(after.queues.find((x: { id: string }) => x.id === q.id), q);
  for (const key of ["closure_mode", "closure_requested_at", "admin_deadline_at", "operational_deadline_at", "official_ends_at", "external_last_order"]) assert.deepEqual(after.event[key], before.event[key]);
  assert.equal(after.services.find((s: { id: string }) => s.id === data.history.session).status, "completed"); assert.deepEqual(await state(other), otherBefore);
  const closedState = await state(c); assert.deepEqual(await closure.regularizeEvent(c.eventId), { kind: "already_closed" }); assert.deepEqual(await state(c), closedState);
});
test("E08.9 PostgreSQL controlado real preserva waiting externas finalizadas e auditoria E08.8", async () => {
  const c = await context(), data = await rich(c), body = await controlled(2); assert.equal((await close(c, body)).status, 200);
  const before = await state(c), outside = before.people.find((p: { id: string }) => p.id === data.outside.participationId); await waitUntil(body.controlledUntilAt);
  assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed"); const after = await state(c);
  assert.deepEqual(after.people.find((p: { id: string }) => p.id === outside.id), outside); assert.equal(outside.finish_reason, "admin_controlled_external_wait_closed");
  assert.deepEqual(after.audits, before.audits); assert.deepEqual(after.idempotency, before.idempotency); await assertNoOpen(c); await assertExact(c, body.controlledUntilAt);
});
test("E08.9 PostgreSQL imediato E08.8 concluído permanece byte a byte igual", async () => {
  const c = await context(); await rich(c); assert.equal((await close(c)).status, 200); const before = await state(c);
  assert.deepEqual(await closure.regularizeEvent(c.eventId), { kind: "already_closed" }); assert.deepEqual(await state(c), before);
});
test("E08.9 PostgreSQL prazo Admin maior que original é rejeitado pelo schema efetivo", async () => {
  const c = await context(), before = await state(c);
  await assert.rejects(pool.query(`UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp(),
    admin_deadline_at=operational_deadline_at+interval '1 second' WHERE id=$1`, [c.eventId]), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "23514");
  assert.deepEqual(await state(c), before);
});
for (const mode of ["normal", "controlled"] as const) test(`E08.9 PostgreSQL ${mode} antes do prazo não altera nada`, async () => {
  const c = await context(); await rich(c); await deadline(c, 600, mode); const before = await state(c);
  assert.deepEqual(await closure.regularizeEvent(c.eventId), { kind: "not_due" }); assert.deepEqual(await state(c), before);
});
test("E08.9 PostgreSQL instante exato tem comparação inclusiva no banco", async () => {
  const c = await context(); await person(c); const at = await deadline(c, 0); await waitUntil(at); assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed"); await assertExact(c, at);
  assert.equal((await pool.query("SELECT $1::timestamptz <= $1::timestamptz AS inclusive", [at])).rows[0].inclusive, true);
});
test("E08.9 PostgreSQL evento futuro sem participantes não é encerrado", async () => {
  const c = await context(); await pool.query("UPDATE events SET status='scheduled',starts_at=clock_timestamp()+interval '1 hour',official_ends_at=clock_timestamp()+interval '2 hours',operational_deadline_at=clock_timestamp()+interval '150 minutes' WHERE id=$1", [c.eventId]);
  const before = await state(c); assert.deepEqual(await closure.regularizeEvent(c.eventId), { kind: "not_due" }); assert.deepEqual(await state(c), before);
});
for (const resources of ["none", "unavailable", "no-staff"] as const) test(`E08.9 PostgreSQL vencido sem prontidão ${resources} fecha`, async () => {
  const c = await context();
  if (resources === "none") { await pool.query("DELETE FROM stations WHERE id=$1", [c.stationId]); await pool.query("DELETE FROM experiences WHERE id=$1", [c.experienceId]); }
  else if (resources === "unavailable") await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
  else await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE event_id=$1", [c.eventId]);
  const at = await deadline(c); assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed"); await assertExact(c, at); await assertNoOpen(c);
});
test("E08.9 PostgreSQL atraso de 40 dias não amplia os 30 dias de avaliação e preserva avaliação existente", async () => {
  const c = await context(), evaluated = await called(c); assert.equal((await resolve(c, evaluated.session, "complete")).status, 200);
  const terminal = evaluated.p;
  await pool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture_terminal' WHERE id=$1", [terminal.participationId]);
  await pool.query("INSERT INTO evaluations(id,participation_id,rating,comment,submitted_at,updated_at,first_comment_at) VALUES($1,$2,5,'histórico',statement_timestamp(),statement_timestamp(),statement_timestamp())", [randomUUID(), terminal.participationId]);
  const data = await rich(c), at = await deadline(c, -40 * 86400);
  const evaluation = (await pool.query("SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1", [terminal.participationId])).rows[0].value;
  assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed"); await assertExact(c, at);
  const eligible = (await pool.query(`SELECT p.finished_at+interval '30 days'<clock_timestamp() AS expired,
    EXISTS(SELECT 1 FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.participation_id=p.id AND s.status='completed') AS completed
    FROM participations p WHERE p.id=$1`, [data.history.p.participationId])).rows[0]; assert.deepEqual(eligible, { expired: true, completed: true });
  assert.deepEqual((await pool.query("SELECT to_jsonb(v) AS value FROM evaluations v WHERE participation_id=$1", [terminal.participationId])).rows[0].value, evaluation);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM evaluations v JOIN participations p ON p.id=v.participation_id WHERE p.event_id=$1", [c.eventId])).rows[0].n, 1);
});
test("E08.9 PostgreSQL inicialização e reinicialização tardias regularizam sem requisição", async () => {
  const c = await context(); await person(c); await deadline(c); const first = scheduler();
  try { await first.onApplicationBootstrap(); await assertNoOpen(c); } finally { await first.beforeApplicationShutdown(); }
  const next = await context(); await person(next); await deadline(next); const restarted = scheduler();
  try { await restarted.onApplicationBootstrap(); await assertNoOpen(next); const before = await state(c); await restarted.runCycle(); assert.deepEqual(await state(c), before); } finally { await restarted.beforeApplicationShutdown(); }
});
test("E08.9 PostgreSQL duas instâncias serializam o mesmo evento sem duplicar efeitos", async () => {
  const c = await context(); await rich(c); await deadline(c); const other = new Service(drizzle(pool, { schema }));
  const [a, b] = await ordered(() => closure.regularizeEvent(c.eventId), () => other.regularizeEvent(c.eventId)); assert.equal(a.kind, "closed"); assert.equal(b.kind, "already_closed"); await assertNoOpen(c);
  const before = await state(c); await Promise.all([closure.regularizeEvent(c.eventId), other.regularizeEvent(c.eventId)]); assert.deepEqual(await state(c), before);
});
test("E08.9 PostgreSQL evento bloqueado é pulado no ciclo e outro evento avança independentemente", async () => {
  const c = await context(), other = await context(); await person(c); await person(other); await deadline(c); await deadline(other); const lock = await pool.connect();
  try { await lock.query("BEGIN"); await lock.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [c.eventId]);
    assert.deepEqual(await closure.regularizeEvent(c.eventId, true), { kind: "unavailable" }); assert.equal((await closure.regularizeEvent(other.eventId, true)).kind, "closed"); await assertNoOpen(other);
    assert.equal((await state(c)).event.status, "open"); await lock.query("COMMIT"); assert.equal((await closure.regularizeEvent(c.eventId, true)).kind, "closed");
  } finally { await lock.query("ROLLBACK"); lock.release(); }
});
for (const lockName of ["event", "station", "participation"] as const) test(`E08.9 PostgreSQL prazo alcançado durante espera de ${lockName} é revalidado`, async () => {
  const c = await context(); await person(c); const at = await deadline(c, 4), lock = await pool.connect(); let pending: ReturnType<EventClosureService["regularizeEvent"]> | undefined;
  try { await lock.query("BEGIN");
    await lock.query(lockName === "event" ? "SELECT id FROM events WHERE id=$1 FOR UPDATE" : lockName === "station" ? "SELECT id FROM stations WHERE id=$1 FOR UPDATE" : "SELECT id FROM participations WHERE event_id=$1 FOR UPDATE", [lockName === "station" ? c.stationId : c.eventId]);
    const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; pending = closure.regularizeEvent(c.eventId); pending.catch(() => undefined);
    await blocked(pid); await waitPast(at, pid); await lock.query("COMMIT"); assert.equal((await pending).kind, "closed"); await assertExact(c, at);
  } finally { await lock.query("ROLLBACK"); await Promise.allSettled([pending]); lock.release(); }
});
for (const phase of ["event", "services", "queues", "people"] as const) test(`E08.9 PostgreSQL SQL real após ${phase} reverte integralmente e permite retry`, async () => {
  const c = await context(); await rich(c); await deadline(c); const before = await state(c), original = database.transaction.bind(database) as typeof database.transaction, dialect = new PgDialect(); let reached = false;
  database.transaction = (callback, config) => original(async tx => { const execute = tx.execute.bind(tx); tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
    const q = args[0], text = typeof q === "string" ? q : dialect.sqlToQuery(q.getSQL()).sql, result = await execute(...args);
    const current = text.includes("WITH decision") ? "event" : text.includes("WITH canceled") ? "services" : text.includes("WITH closed") ? "queues" : text.includes("WITH finished") ? "people" : "";
    if (current === phase) { assert.ok(result.rows.length > 0); if (phase !== "event") assert.ok(Number((result.rows[0] as { count: number }).count) > 0);
      const inside = (await execute<{ closed: boolean }>(sql`SELECT status='closed' AS closed FROM events WHERE id=${c.eventId}`)).rows[0]; assert.equal(inside.closed, true);
      reached = true; await execute(sql`SELECT 1/0`); } return result;
  }) as typeof tx.execute; return callback(tx); }, config);
  try { await assert.rejects(closure.regularizeEvent(c.eventId), error => sqlState(error) === "22012"); } finally { database.transaction = original; }
  assert.equal(reached, true); assert.deepEqual(await state(c), before); assert.equal((await audit(c)).length, 0);
  assert.equal((await closure.regularizeEvent(c.eventId)).kind, "closed"); await assertNoOpen(c);
});
for (const issue of ["pointer", "waiting-called", "closed-current"] as const) test(`E08.9 PostgreSQL inconsistência ${issue} aborta sem sucesso falso`, async () => {
  const c = await context(), p = await queued(c); await deadline(c);
  if (issue === "pointer") await pool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [p.p.participationId]);
  else if (issue === "waiting-called") await pool.query("UPDATE queue_entries SET status='called' WHERE id=$1", [p.entry]);
  else await pool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
  const before = await state(c); await assert.rejects(closure.regularizeEvent(c.eventId), /EVENT_CLOSURE_INTEGRITY/); assert.deepEqual(await state(c), before);
});
test("E08.9 PostgreSQL falha de integridade em um evento não impede ciclo recuperar os demais", async () => {
  const bad = await context(), good = await context(), p = await queued(bad); await person(good); await deadline(bad); await deadline(good);
  await pool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [p.p.participationId]); const before = await state(bad), job = scheduler();
  try { await job.runCycle(); await assertNoOpen(good); assert.deepEqual(await state(bad), before);
    await pool.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1", [p.p.participationId, p.entry]); await job.runCycle(); await assertNoOpen(bad);
  } finally { await job.beforeApplicationShutdown(); }
});

for (const reference of ["experience", "station"] as const) test(`E08.9 PostgreSQL FK rejeita referência cruzada de ${reference} sem desabilitar integridade`, async () => {
  const c = await context(), other = await context(), p = await called(c), before = await state(c);
  await assert.rejects(pool.query(reference === "experience" ? "UPDATE queue_entries SET experience_id=$2 WHERE id=$1" : "UPDATE service_sessions SET station_id=$2 WHERE id=$1",
    [reference === "experience" ? p.entry : p.session, reference === "experience" ? other.experienceId : other.stationId]),
  (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "23503");
  assert.deepEqual(await state(c), before);
});
test("E08.9 PostgreSQL descoberta keyset percorre mais de uma página sem omissões ou duplicações", async () => {
  const expected = new Set<string>(); for (let i = 0; i < 101; i++) expected.add(await bareEvent());
  let afterId: string | null = null; const seen = new Set<string>();
  for (;;) { const ids = await closure.findCandidates(afterId); assert.ok(ids.length <= 100);
    assert.deepEqual(ids, [...ids].sort()); for (const id of ids) { assert.equal(seen.has(id), false); seen.add(id); if (afterId) assert.ok(id > afterId); }
    if (ids.length < 100) break; afterId = ids[ids.length - 1];
  }
  for (const id of expected) assert.equal(seen.has(id), true);
});

for (const first of ["job", "operation"] as const) for (const name of ["E03", "E07.1", "E07.4", "E07.5", "E07.6", "E07.3", "E08.5", "E08.6", "E08.7", "E08.8"] as const)
  test(`E08.9 PostgreSQL ${name} versus job com ${first} primeiro observa lock e preserva vencedor`, async () => {
    const c = await context(), entrant = name === "E03" ? await readyEntrant() : undefined;
    const pending = name === "E07.5" || name === "E07.6" ? await called(c) : undefined;
    const waiting = name === "E07.4" || name === "E07.3" ? await queued(c) : undefined;
    const idle = name === "E07.1" ? await person(c) : undefined; if (name === "E08.6") await person(c, "waiting");
    const schedule = name === "E08.7" ? await proposal(c) : undefined;
    // Operação vencedora valida antes do prazo; seu COMMIT é retido até o prazo.
    const at = await deadline(c, first === "operation" ? 4 : -2);
    const operation = async (): Promise<string> => {
      if (name === "E03") { assert.ok(entrant); return (await admit(c, entrant)).kind; }
      if (name === "E07.1") { assert.ok(idle); return (await join(c, idle)).kind; }
      const r = name === "E07.4" ? await call(c) : name === "E07.5" || name === "E07.6" ? await resolve(c, pending!.session, name === "E07.5" ? "complete" : "absent")
        : name === "E07.3" ? await withdraw(c, waiting!.p, waiting!.entry) : name === "E08.5" ? await station(c) : name === "E08.6" ? await external(c)
          : name === "E08.7" ? await patch(c, schedule!) : await close(c, immediate());
      if (r.status >= 400) { assert.equal(r.status, 409, JSON.stringify(r.body)); return r.body.code as string; } return String(r.status);
    };
    let code: string, result: Awaited<ReturnType<EventClosureService["regularizeEvent"]>>;
    if (first === "job") [result, code] = await ordered(() => closure.regularizeEvent(c.eventId), operation);
    else [code, result] = await ordered(operation, () => closure.regularizeEvent(c.eventId), pid => waitPast(at, pid));
    const before = { E03: "created", "E07.1": "created", "E07.4": "201", "E07.5": "200", "E07.6": "200", "E07.3": "200", "E08.5": "200", "E08.6": "200", "E08.7": "200", "E08.8": "200" };
    const after = { E03: "blocked", "E07.1": "participation_not_active", "E07.4": "EVENT_OPERATION_ENDED", "E07.5": "SERVICE_NOT_PENDING", "E07.6": "SERVICE_NOT_PENDING", "E07.3": "PARTICIPATION_NOT_ACTIVE", "E08.5": "EVENT_OPERATION_ENDED", "E08.6": "EVENT_REGISTRATION_CLOSED", "E08.7": "EVENT_TIME_CHANGE_CLOSED", "E08.8": "EVENT_ALREADY_CLOSED" };
    assert.equal(code, first === "job" ? after[name] : before[name]);
    // E08.7 move o prazo para o futuro; E08.8 imediato já faz a limpeza.
    assert.equal(result.kind, first === "operation" && name === "E08.7" ? "not_due" : first === "operation" && name === "E08.8" ? "already_closed" : "closed");
    if (result.kind !== "not_due") await assertNoOpen(c);
    if (pending) assert.equal((await state(c)).services.find((s: { id: string }) => s.id === pending.session).status, first === "operation" ? name === "E07.5" ? "completed" : "absent" : "canceled");
  });
