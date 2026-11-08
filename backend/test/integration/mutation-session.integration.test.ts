import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import supertest from "supertest";
import { setup, cleanup, app, pool, database, context, person, queued, called, state, blocked, type Context } from "./event-closure-fixture";
import { participant, service, evaluation, problem, type Actor } from "./evaluation-read-fixture";

// A guarda do fixture exige as três URLs locais explícitas antes de importar AppModule.
before(async () => { process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS = "60"; await setup(); });
after(cleanup);
const operations = ["call-next", "complete", "absent", "join", "withdraw", "submit", "edit", "cancel", "finish"] as const;
type Operation = typeof operations[number];
interface Fixture { c: Context; actor: Actor; participationId: string; path: string; body: object; status: number; operation: string; edit: boolean }
const namespaces: Record<Operation, string> = { "call-next": "call_next", complete: "complete_service_session", absent: "absent_service_session",
  join: "join_experience_queue", withdraw: "withdraw_experience_queue", submit: "submit_evaluation", edit: "edit_evaluation",
  cancel: "cancel_external_participation", finish: "finish_arena_participation" };
async function fixture(operation: Operation): Promise<Fixture> {
  const c = await context();
  let actor: Actor, participationId: string, path: string, body: object = {};
  if (operation === "call-next") {
    const a = await queued(c); actor = c.staff; participationId = a.p.participationId;
    path = `/staff/events/${c.eventId}/experiences/${c.experienceId}/stations/${c.stationId}/call-next`;
  } else if (operation === "complete" || operation === "absent") {
    const a = await called(c); actor = c.staff; participationId = a.p.participationId;
    path = `/staff/events/${c.eventId}/service-sessions/${a.session}/${operation}`;
  } else if (operation === "submit" || operation === "edit") {
    const p = await participant(c); await service(c, p.participationId); actor = p; participationId = p.participationId;
    path = operation === "submit" ? `/participations/${p.participationId}/evaluation` : `/evaluations/${await evaluation(p.participationId)}`;
    body = { rating: 5 };
  } else {
    const a = operation === "withdraw" || operation === "finish" ? await called(c) : null;
    const p = a?.p ?? await person(c, operation === "cancel" ? "waiting" : "active");
    actor = p; participationId = p.participationId;
    path = `/participations/${participationId}/${operation === "join" ? "queue-entries" : operation === "withdraw" ? `queue-entries/${a!.entry}/withdraw` : operation}`;
    if (operation === "join") body = { experienceId: c.experienceId };
  }
  return { c, actor, participationId, path, body, status: operation === "call-next" || operation === "join" || operation === "submit" ? 201 : 200,
    operation: namespaces[operation], edit: operation === "edit" };
}
const request = (f: Fixture, key: string) => (f.edit ? supertest(app.getHttpServer()).patch(`/api/v1${f.path}`)
  : supertest(app.getHttpServer()).post(`/api/v1${f.path}`)).set("Authorization", `Bearer ${f.actor.token}`).set("Idempotency-Key", key).send(f.body);
const logout = (actor: Actor) => supertest(app.getHttpServer()).post("/api/v1/auth/logout").set("Authorization", `Bearer ${actor.token}`).send({});
async function snapshot(f: Fixture) {
  return { domain: await state(f.c), extra: (await pool.query(`SELECT jsonb_build_object(
    'evaluations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM evaluations v JOIN participations p ON p.id=v.participation_id WHERE p.event_id=$1),
    'intents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=$2)) AS value`,
  [f.c.eventId, f.actor.userId])).rows[0].value };
}
async function expiry(actor: Actor) {
  return (await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE id=$1
    RETURNING to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`, [actor.sessionId])).rows[0].at as string;
}
async function expired(at: string, blocker: number) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if ((await pool.query("SELECT clock_timestamp()>=$1::timestamptz AS expired", [at])).rows[0].expired) { await blocked(blocker); return; }
    await new Promise(done => setTimeout(done, 25));
  }
  throw Error("O relógio PostgreSQL não atingiu a expiração.");
}
async function waiting(f: Fixture, operation: Operation, key: string, action: (pid: number) => Promise<void>) {
  const client = await pool.connect(); let pending: Promise<supertest.Response> | undefined;
  try {
    await client.query("BEGIN");
    if (operation === "submit" || operation === "edit") await client.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [f.participationId]);
    else await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [f.c.eventId]);
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = Promise.resolve(request(f, key)); pending.catch(() => undefined);
    await blocked(pid); await action(pid); await client.query("COMMIT"); return await pending;
  } finally { await client.query("ROLLBACK"); await Promise.allSettled([pending]); client.release(); }
}
async function revoke(actor: Actor) {
  // Revogador SQL concorrente real. Diferente de logout: não toma users FOR UPDATE.
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp(),revocation_reason='est01_test' WHERE id=$1", [actor.sessionId]);
}
for (const operation of operations) {
  for (const invalidation of ["inactive", "second-factor"] as const) {
    test(`E08-EST01 PostgreSQL ${operation} revalida ${invalidation} após espera`, async () => {
      const f = await fixture(operation);
      if (invalidation === "second-factor") {
        await pool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'admin',clock_timestamp())", [randomUUID(), f.actor.userId]);
        await pool.query("UPDATE sessions SET admin_2fa_verified_at=clock_timestamp() WHERE id=$1", [f.actor.sessionId]);
      }
      const before = await snapshot(f);
      const r = await waiting(f, operation, randomUUID(), async () => {
        if (invalidation === "inactive") await pool.query("UPDATE users SET is_active=false WHERE id=$1", [f.actor.userId]);
        else await pool.query("UPDATE sessions SET admin_2fa_verified_at=NULL WHERE id=$1", [f.actor.sessionId]);
      });
      problem(r, 401, invalidation === "inactive" ? "ACCOUNT_DEACTIVATED" : "ADMIN_2FA_REQUIRED");
      assert.deepEqual(await snapshot(f), before);
    });
  }
  test(`E08-EST01 PostgreSQL ${operation} sucesso e replay válidos preservam contratos`, async () => {
    const f = await fixture(operation), key = randomUUID(), a = await request(f, key);
    assert.equal(a.status, f.status, JSON.stringify(a.body)); const before = await snapshot(f), b = await request(f, key);
    assert.equal(b.status, f.status, JSON.stringify(b.body)); assert.deepEqual(b.body, a.body); assert.deepEqual(await snapshot(f), before);
  });
  for (const invalidation of ["revoke", "expire"] as const) {
    test(`E08-EST01 PostgreSQL ${operation} ${invalidation} durante lock de domínio recusa sem efeitos`, async () => {
      const f = await fixture(operation), before = await snapshot(f), at = invalidation === "expire" ? await expiry(f.actor) : null;
      const r = await waiting(f, operation, randomUUID(), async pid => { if (at) await expired(at, pid); else await revoke(f.actor); });
      problem(r, 401, at ? "SESSION_EXPIRED" : "SESSION_REVOKED"); assert.deepEqual(await snapshot(f), before);
    });
    test(`E08-EST01 PostgreSQL ${operation} replay com ${invalidation} durante lock não devolve histórico`, async () => {
      const f = await fixture(operation), key = randomUUID(); assert.equal((await request(f, key)).status, f.status);
      const before = await snapshot(f), at = invalidation === "expire" ? await expiry(f.actor) : null;
      const r = await waiting(f, operation, key, async pid => { if (at) await expired(at, pid); else await revoke(f.actor); });
      problem(r, 401, at ? "SESSION_EXPIRED" : "SESSION_REVOKED"); assert.deepEqual(await snapshot(f), before);
    });
  }
  test(`E08-EST01 PostgreSQL ${operation} expiração na reserva idempotente não consome intenção`, async () => {
    const f = await fixture(operation), key = randomUUID(), before = await snapshot(f), client = await pool.connect();
    let pending: Promise<supertest.Response> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,'in_progress',clock_timestamp(),clock_timestamp()+interval '1 hour')`, [randomUUID(), f.actor.userId, f.operation, key, "0".repeat(64)]);
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, at = await expiry(f.actor);
      pending = Promise.resolve(request(f, key)); pending.catch(() => undefined); await blocked(pid); await expired(at, pid);
      await client.query("ROLLBACK"); problem(await pending, 401, "SESSION_EXPIRED"); assert.deepEqual(await snapshot(f), before);
      await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [f.actor.sessionId]);
      assert.equal((await request(f, key)).status, f.status, "A tentativa recusada não pode inutilizar a chave.");
    } finally { await client.query("ROLLBACK"); await Promise.allSettled([pending]); client.release(); }
  });
  test(`E08-EST01 PostgreSQL ${operation} mutação protegida confirma antes do logout concorrente`, async () => {
    const f = await fixture(operation), original = database.transaction.bind(database) as typeof database.transaction;
    let reached!: (pid: number) => void, release!: () => void;
    const ready = new Promise<number>(yes => { reached = yes; }), gate = new Promise<void>(yes => { release = yes; });
    let a: Promise<supertest.Response> | undefined, b: Promise<supertest.Response> | undefined;
    database.transaction = (callback, config) => original(async tx => { const result = await callback(tx);
      reached((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid); await gate; return result; }, config);
    try {
      a = Promise.resolve(request(f, randomUUID())); a.catch(() => undefined);
      const pid = await Promise.race([ready, a.then(() => { throw Error("Transação não retida."); })]);
      database.transaction = original; b = Promise.resolve(logout(f.actor)); b.catch(() => undefined); await blocked(pid); release();
      assert.equal((await a).status, f.status); assert.equal((await b).status, 200);
      problem(await request(f, randomUUID()), 401, "SESSION_REVOKED");
    } finally { database.transaction = original; release(); await Promise.allSettled([a, b]); }
  });
  test(`E08-EST01 PostgreSQL ${operation} expiração após conclusão da intenção faz rollback integral`, async () => {
    const f = await fixture(operation), before = await snapshot(f), original = database.transaction.bind(database) as typeof database.transaction;
    const client = await pool.connect(), dialect = new PgDialect(), advisory = 8081501;
    let pending: Promise<supertest.Response> | undefined;
    try {
      await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [advisory]);
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, at = await expiry(f.actor);
      // Não simula resultados: todas as consultas/escritas continuam no PostgreSQL real.
      // A segunda aquisição da conta inicia a revalidação final, após concluir a intenção.
      database.transaction = (callback, config) => original(async tx => {
        const execute = tx.execute.bind(tx); let accountChecks = 0;
        tx.execute = (async (...args: Parameters<typeof tx.execute>) => {
          const query = args[0], text = typeof query === "string" ? query : dialect.sqlToQuery(query.getSQL()).sql;
          if (text.startsWith("SELECT id FROM users WHERE") && ++accountChecks === 2) await execute(sql`SELECT pg_advisory_xact_lock(${advisory})`);
          return execute(...args);
        }) as typeof tx.execute;
        return callback(tx);
      }, config);
      pending = Promise.resolve(request(f, randomUUID())); pending.catch(() => undefined);
      await blocked(pid); await expired(at, pid); await client.query("COMMIT");
      problem(await pending, 401, "SESSION_EXPIRED"); assert.deepEqual(await snapshot(f), before);
    } finally { database.transaction = original; await client.query("ROLLBACK"); await Promise.allSettled([pending]); client.release(); }
  });
}
for (const operation of ["call-next", "complete", "absent", "join", "withdraw"] as const) {
  test(`E08-EST01 PostgreSQL ${operation} logout confirma antes de liberar domínio`, async () => {
    const f = await fixture(operation), before = await snapshot(f);
    const r = await waiting(f, operation, randomUUID(), async () => { assert.equal((await logout(f.actor)).status, 200); });
    problem(r, 401, "SESSION_REVOKED"); assert.deepEqual(await snapshot(f), before);
  });
}
for (const operation of ["call-next", "complete", "absent"] as const) {
  test(`E08-EST01 PostgreSQL ${operation} concessão revogada não autoriza`, async () => {
    const f = await fixture(operation), before = await snapshot(f);
    const r = await waiting(f, operation, randomUUID(), async () => {
      await pool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE user_id=$1 AND event_id=$2 AND role='staff'", [f.actor.userId, f.c.eventId]);
    });
    problem(r, 403, "STAFF_EVENT_FORBIDDEN"); assert.deepEqual(await snapshot(f), before);
  });
}
