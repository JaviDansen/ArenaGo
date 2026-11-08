import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import type { QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import type { QueueStateService } from "../../src/events/queue-state.service";
import type { WithdrawExperienceQueueInput, WithdrawExperienceQueueResult } from "../../src/events/queue-withdrawal.types";
import { assertSafeTestDatabase } from "./test-db-guard";
// Nenhum import de configuração/serviço antes deste preflight. Sem fallback .env.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
    const value = assertSafeTestDatabase(process.env[name]);
    const u = new URL(value);
    if (u.hostname !== "127.0.0.1" || u.port !== "55432" || u.pathname !== "/arenago_events_test"
        || u.search || u.hash || !u.username)
        throw new Error(`${name}: destino local explícito obrigatório, sem parâmetros.`);
    return value;
});
if (urls.some(value => value !== urls[0]))
    throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
const poolConfig = { connectionString: urls[2], ssl: false, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 10000, lock_timeout: 8000 };
const servicePool = new Pool(poolConfig);
const fixturePool = new Pool(poolConfig);
const database = drizzle(servicePool, { schema });
let service: QueueWithdrawalService;
let joinService: QueueEntryService;
let reader: QueueStateService;
let makeService: (db: NodePgDatabase<typeof schema>) => QueueWithdrawalService;
let makeJoin: (db: NodePgDatabase<typeof schema>) => QueueEntryService;
const ids = { events: [] as string[], users: [] as string[] };
const reason = "participant_queue_withdrawal";
const operation = "withdraw_experience_queue";
const baseOrder = 9007199254741000n;
before(async () => {
    assert.equal((await fixturePool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
    const { QueueWithdrawalService } = await import("../../src/events/queue-withdrawal.service");
    const { QueueEntryService } = await import("../../src/events/queue-entry.service");
    const { QueueStateService } = await import("../../src/events/queue-state.service");
    const { EventsService } = await import("../../src/events/events.service");
    makeService = db => new QueueWithdrawalService(db);
    makeJoin = db => new QueueEntryService(db, new EventsService(db));
    service = makeService(database);
    joinService = makeJoin(database);
    reader = new QueueStateService(database);
});
after(async () => {
    const errors: unknown[] = [];
    try {
        if (ids.events.length || ids.users.length) {
            const c = await fixturePool.connect();
            try {
                await c.query("BEGIN");
                await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM stations s USING experiences x WHERE s.experience_id=x.id AND x.event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM user_roles WHERE event_id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
                await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
                await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
                await c.query("COMMIT");
            }
            catch (error) {
                await c.query("ROLLBACK").catch(() => undefined);
                throw error;
            }
            finally {
                c.release();
            }
        }
    }
    catch (error) {
        errors.push(error);
    }
    for (const result of await Promise.allSettled([servicePool.end(), fixturePool.end()]))
        if (result.status === "rejected")
            errors.push(result.reason);
    if (errors.length)
        throw new AggregateError(errors, "Falha na limpeza E07.3.");
});
async function user() {
    const id = randomUUID();
    await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,$2,$3,'private-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, `Nome privado ${id}`, `${id}@example.test`]);
    ids.users.push(id);
    return id;
}
async function person(eventId: string, status = "active") {
    const userId = await user();
    const participationId = randomUUID();
    const terminal = status === "finished" || status === "canceled";
    await fixturePool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4,clock_timestamp(),CASE WHEN $4::varchar='active' THEN clock_timestamp() END,
      CASE WHEN $5 THEN clock_timestamp() END,CASE WHEN $5 THEN 'fixture_terminal' END)`, [participationId, userId, eventId, status, terminal]);
    return { userId, participationId, eventId };
}
type Person = Awaited<ReturnType<typeof person>>;
async function experience(eventId: string) {
    const id = randomUUID();
    await fixturePool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E073 experiência',$3,clock_timestamp(),clock_timestamp())`, [id, eventId, baseOrder.toString()]);
    const stationId = randomUUID();
    await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,'E073 estação','available',clock_timestamp(),clock_timestamp())`, [stationId, id]);
    return { experienceId: id, stationId };
}
type Context = Person & {
    experienceId: string;
    stationId: string;
    staffId: string;
    entryId: string;
    order: string;
};
async function context(called = false): Promise<Context> {
    const eventId = randomUUID();
    await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,
    status,external_queue_enabled,created_at,updated_at) VALUES($1,'E073 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
    clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`, [eventId, `E073-${eventId.toUpperCase()}`]);
    ids.events.push(eventId);
    const p = await person(eventId);
    const staffId = await user();
    await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), staffId, eventId]);
    const x = await experience(eventId);
    const entry = await enter(p, x.experienceId);
    const c = { ...p, ...x, staffId, entryId: entry.queueEntryId, order: entry.queueOrder };
    if (called)
        await fixtureAction(c, "call");
    return c;
}
async function enter(p: Person, experienceId: string, joining = joinService) {
    const result = await joining.joinExperienceQueue({ userId: p.userId, participationId: p.participationId, experienceId,
        idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
    assert.equal(result.kind, "created");
    if (result.kind !== "created")
        assert.fail();
    return result;
}
function intent(c: Pick<Context, "userId" | "participationId" | "entryId">): WithdrawExperienceQueueInput {
    return { userId: c.userId, participationId: c.participationId, queueEntryId: c.entryId,
        idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") };
}
function withdrawn(result: WithdrawExperienceQueueResult) {
    assert.equal(result.kind, "withdrawn");
    if (result.kind !== "withdrawn")
        assert.fail(JSON.stringify(result));
    return result;
}
async function snapshot() {
    return (await fixturePool.query(`SELECT jsonb_build_object(
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM events e WHERE e.id=ANY($1::uuid[])),
    'experiences',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM experiences x WHERE x.event_id=ANY($1::uuid[])),
    'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences x ON x.id=s.experience_id WHERE x.event_id=ANY($1::uuid[])),
    'people',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=ANY($1::uuid[])),
    'entries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=ANY($1::uuid[])),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=ANY($1::uuid[])),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=ANY($2::uuid[])),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM user_roles r WHERE r.event_id=ANY($1::uuid[])),
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM users u WHERE u.id=ANY($2::uuid[])))::text AS state`, [ids.events, ids.users])).rows[0].state as string;
}
async function checkWithdrawal(c: Context, input: WithdrawExperienceQueueInput, called: boolean) {
    const result = await fixturePool.query(`SELECT p.status AS participation,p.current_queue_entry_id AS pointer,
    q.status,q.queue_order::text,q.close_reason,(q.closed_at IS NOT NULL) AS closed,
    x.last_queue_order::text,t.availability,s.status AS service_status,s.cancel_reason,s.resolved_by_user_id,
    (s.resolved_at=q.closed_at) AS same_time,
    (SELECT count(*)::int FROM queue_entries WHERE participation_id=p.id) AS entries,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=p.user_id AND i.operation=$3) AS intentions,
    (SELECT count(*)::int FROM idempotency_operations i WHERE i.actor_user_id=p.user_id AND i.operation=$3
      AND i.idempotency_key=$4 AND i.status='completed' AND i.result_reference=q.id) AS completed
    FROM participations p JOIN queue_entries q ON q.id=$2 JOIN experiences x ON x.id=q.experience_id
    JOIN stations t ON t.id=$5 LEFT JOIN service_sessions s ON s.queue_entry_id=q.id WHERE p.id=$1`, [c.participationId, c.entryId, operation, input.idempotencyKey, c.stationId]);
    const row = result.rows[0];
    assert.equal(row.participation, "active");
    assert.equal(row.pointer, null);
    assert.equal(row.status, "closed");
    assert.equal(row.queue_order, c.order);
    assert.equal(row.last_queue_order, c.order);
    assert.equal(row.close_reason, reason);
    assert.equal(row.closed, true);
    assert.equal(row.entries, 1);
    assert.equal(row.intentions, 1);
    assert.equal(row.completed, 1);
    assert.equal(row.service_status, called ? "canceled" : null);
    if (called) {
        assert.equal(row.cancel_reason, reason);
        assert.equal(row.same_time, true);
        assert.equal(row.resolved_by_user_id, c.userId);
    }
    const state = await reader.getParticipationQueue(c.userId, c.participationId);
    assert.ok(state.kind === "ok");
    assert.equal(state.currentQueueEntry, null);
}
type Action = "call" | "complete" | "absent" | "finish" | "immediate" | "controlled";
/** Emulação SQL de escritores FUTUROS apenas nas fixtures, com condições e locks reais. */
async function mutate(c: PoolClient, p: Context, action: Action): Promise<{
    changed: boolean;
    newEntryId?: string;
}> {
    await c.query(`SELECT id FROM events WHERE id=$1 FOR ${action === "immediate" || action === "controlled" ? "UPDATE" : "SHARE"}`, [p.eventId]);
    await c.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [p.experienceId]);
    const discovery = await c.query("SELECT id,station_id FROM service_sessions WHERE queue_entry_id=$1", [p.entryId]);
    const stationId = discovery.rows[0]?.station_id ?? (action === "call" ? p.stationId : null);
    if (stationId)
        await c.query("SELECT id FROM stations WHERE id=$1 FOR UPDATE", [stationId]);
    const owned = (await c.query("SELECT status,current_queue_entry_id FROM participations WHERE id=$1 FOR UPDATE", [p.participationId])).rows[0];
    const q = (await c.query("SELECT status FROM queue_entries WHERE id=$1 FOR UPDATE", [p.entryId])).rows[0];
    const s = (await c.query("SELECT id,status FROM service_sessions WHERE queue_entry_id=$1 FOR UPDATE", [p.entryId])).rows[0];
    if (action === "immediate" || action === "controlled") {
        await c.query(`UPDATE events SET status=$2::varchar,closure_mode=$3::varchar,closure_requested_at=statement_timestamp(),
      admin_deadline_at=statement_timestamp()+CASE WHEN $3::varchar='controlled' THEN interval '20 minutes' ELSE interval '0 seconds' END
      WHERE id=$1`, [p.eventId, action === "immediate" ? "closed" : "closing", action]);
        return { changed: true };
    }
    if (owned.status !== "active")
        return { changed: false };
    if (action === "finish") {
        assert.ok(owned.current_queue_entry_id === p.entryId || owned.current_queue_entry_id === null);
        if (s?.status === "pending")
            await c.query("UPDATE service_sessions SET status='canceled',resolved_at=clock_timestamp(),cancel_reason='fixture_finish' WHERE id=$1 AND status='pending'", [s.id]);
        if (q.status !== "closed")
            await c.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_finish' WHERE id=$1 AND status IN ('waiting','called')", [p.entryId]);
        await c.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture_finish',current_queue_entry_id=NULL WHERE id=$1 AND status='active'", [p.participationId]);
        return { changed: true };
    }
    if (owned.current_queue_entry_id !== p.entryId)
        return { changed: false };
    if (action === "call") {
        if (q.status !== "waiting" || s)
            return { changed: false };
        await c.query("UPDATE queue_entries SET status='called' WHERE id=$1 AND status='waiting'", [p.entryId]);
        await c.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status)
      VALUES($1,$2,$3,$4,$5,clock_timestamp(),'pending')`, [randomUUID(), p.entryId, p.experienceId, p.stationId, p.staffId]);
        return { changed: true };
    }
    if (q.status !== "called" || s?.status !== "pending")
        return { changed: false };
    await c.query("UPDATE service_sessions SET status=$2,resolved_at=clock_timestamp(),resolved_by_user_id=$3 WHERE id=$1 AND status='pending'", [s.id, action === "complete" ? "completed" : "absent", p.staffId]);
    await c.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason=$2 WHERE id=$1 AND status='called'", [p.entryId, action === "complete" ? "completed" : "absent"]);
    await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1 AND current_queue_entry_id=$2", [p.participationId, p.entryId]);
    if (action === "absent") {
        const window = (await c.query(`SELECT clock_timestamp()<official_ends_at AND
      (closure_requested_at IS NULL OR clock_timestamp()<closure_requested_at) AS open FROM events WHERE id=$1`, [p.eventId])).rows[0].open;
        if (window) {
            const order = (await c.query("UPDATE experiences SET last_queue_order=last_queue_order+1 WHERE id=$1 RETURNING last_queue_order::text", [p.experienceId])).rows[0].last_queue_order;
            const id = randomUUID();
            await c.query(`INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at)
        VALUES($1,$2,$3,$4,$5,'waiting',clock_timestamp())`, [id, p.participationId, p.eventId, p.experienceId, order]);
            await c.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1", [p.participationId, id]);
            return { changed: true, newEntryId: id };
        }
    }
    return { changed: true };
}
async function fixtureTransaction<T>(c: PoolClient, action: (c: PoolClient) => Promise<T>): Promise<T> {
    try {
        await c.query("BEGIN");
        const result = await action(c);
        await c.query("COMMIT");
        return result;
    }
    catch (error) {
        await c.query("ROLLBACK");
        throw error;
    }
}
async function fixtureAction(p: Context, action: Action) {
    const c = await fixturePool.connect();
    try {
        return await fixtureTransaction(c, c => mutate(c, p, action));
    }
    finally {
        c.release();
    }
}
function holdDatabase() {
    let signal!: (pid: number) => void, reject!: (e: unknown) => void, release!: () => void;
    const reached = new Promise<number>((yes, no) => { signal = yes; reject = no; });
    const gate = new Promise<void>(yes => { release = yes; });
    const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) => {
            const pending = database.transaction(async (tx) => {
                try {
                    const result = await callback(tx);
                    signal((await tx.execute<{
                        pid: number;
                    }>(sql `SELECT pg_backend_pid() AS pid`)).rows[0].pid);
                    await gate;
                    return result;
                }
                catch (e) {
                    reject(e);
                    throw e;
                }
            }, config);
            pending.catch(reject);
            return pending;
        } } as typeof database;
    return { db, reached, release };
}
async function holdFixture(p: Context, action: Action) {
    const c = await fixturePool.connect();
    let signal!: (pid: number) => void, reject!: (e: unknown) => void, release!: () => void;
    const reached = new Promise<number>((yes, no) => { signal = yes; reject = no; });
    const gate = new Promise<void>(yes => { release = yes; });
    const promise = fixtureTransaction(c, async (c) => {
        try {
            const result = await mutate(c, p, action);
            signal((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
            await gate;
            return result;
        }
        catch (e) {
            reject(e);
            throw e;
        }
    }).finally(() => c.release());
    promise.catch(reject);
    return { promise, reached, release };
}
async function waitBlocked(waiter: number, blocker: number) {
    assert.notEqual(waiter, blocker);
    const until = Date.now() + 5000;
    while (Date.now() < until) {
        const row = await fixturePool.query(`SELECT 1 FROM pg_stat_activity
    WHERE pid=$1 AND state='active' AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))`, [waiter, blocker]);
        if (row.rowCount)
            return;
        await new Promise(yes => setTimeout(yes, 20));
    }
    throw new Error("Não foi observada a relação de bloqueio entre os dois PIDs.");
}
async function race<T, U>(first: {
    promise: Promise<T>;
    reached: Promise<number>;
    release: () => void;
}, second: (db: NodePgDatabase<typeof schema>, c: PoolClient) => Promise<U>) {
    let c: PoolClient | undefined;
    let pending: Promise<U> | undefined;
    try {
        c = await servicePool.connect();
        const blocker = await first.reached;
        const waiter = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        pending = second(drizzle(c, { schema }), c);
        pending.catch(() => undefined);
        await waitBlocked(waiter, blocker);
        first.release();
        return await Promise.all([first.promise, pending]);
    }
    finally {
        first.release();
        await Promise.allSettled([first.promise, pending]);
        c?.release();
    }
}
function heldWithdrawal(input: WithdrawExperienceQueueInput) { const hold = holdDatabase(); const promise = makeService(hold.db).withdrawExperienceQueue(input); promise.catch(() => undefined); return { ...hold, promise }; }
function heldOccupiedJoin(c: Context) {
    let signal!: (pid: number) => void, reject!: (e: unknown) => void, release!: () => void;
    const reached = new Promise<number>((yes, no) => { signal = yes; reject = no; });
    const gate = new Promise<void>(yes => { release = yes; });
    const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) => {
            const pending = database.transaction(async (tx) => {
                const proxy = new Proxy(tx, { get(target, key) {
                        if (key === "execute")
                            return async (query: Parameters<typeof tx.execute>[0]) => {
                                const result = await target.execute(query);
                                if (result.rows.some(row => row.id === c.entryId)) {
                                    signal((await target.execute<{
                                        pid: number;
                                    }>(sql `SELECT pg_backend_pid() AS pid`)).rows[0].pid);
                                    await gate;
                                }
                                return result;
                            };
                        const value = Reflect.get(target, key);
                        return typeof value === "function" ? value.bind(target) : value;
                    } });
                return callback(proxy);
            }, config);
            pending.catch(reject);
            return pending;
        } } as typeof database;
    const promise = makeJoin(db).joinExperienceQueue({ userId: c.userId, participationId: c.participationId, experienceId: c.experienceId,
        idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
    promise.catch(reject);
    return { promise, reached, release };
}
test("E07.3 waiting encerra tentativa e mantém participação active, ordem e leitura null", async () => {
    const c = await context();
    const request = intent(c);
    const result = withdrawn(await service.withdrawExperienceQueue(request));
    assert.equal(result.queueEntryId, c.entryId);
    assert.equal(result.serviceSession, null);
    await checkWithdrawal(c, request, false);
});
test("E07.3 called cancela pending com timestamp único e sem modificar disponibilidade", async () => {
    const c = await context(true);
    await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [c.stationId]);
    const request = intent(c);
    const result = withdrawn(await service.withdrawExperienceQueue(request));
    assert.equal(result.serviceSession?.status, "canceled");
    await checkWithdrawal(c, request, true);
    assert.equal((await fixturePool.query("SELECT availability FROM stations WHERE id=$1", [c.stationId])).rows[0].availability, "unavailable");
});
test("E07.3 desistência preserva conclusões anteriores e demais experiências/participantes", async () => {
    const c = await context(true);
    await fixtureAction(c, "complete");
    const old = (await fixturePool.query("SELECT to_jsonb(s)::text AS state FROM service_sessions s WHERE queue_entry_id=$1", [c.entryId])).rows[0].state;
    const next = await enter(c, c.experienceId);
    const current = { ...c, entryId: next.queueEntryId, order: next.queueOrder };
    const other = await context();
    const untouched = (await fixturePool.query("SELECT to_jsonb(q)::text AS state FROM queue_entries q WHERE id=$1", [other.entryId])).rows[0].state;
    withdrawn(await service.withdrawExperienceQueue(intent(current)));
    assert.equal((await fixturePool.query("SELECT to_jsonb(s)::text AS state FROM service_sessions s WHERE queue_entry_id=$1", [c.entryId])).rows[0].state, old);
    assert.equal((await fixturePool.query("SELECT to_jsonb(q)::text AS state FROM queue_entries q WHERE id=$1", [other.entryId])).rows[0].state, untouched);
});
test("E07.3 libera nova intenção E07.1 com novo ID/ordem e recalcula posição E07.2", async () => {
    const c = await context();
    const p = await person(c.eventId);
    await enter(p, c.experienceId);
    const before = await reader.getParticipationQueue(p.userId, p.participationId);
    assert.ok(before.kind === "ok" && before.currentQueueEntry?.status === "waiting");
    assert.equal(before.currentQueueEntry.position, 2);
    withdrawn(await service.withdrawExperienceQueue(intent(c)));
    const after = await reader.getParticipationQueue(p.userId, p.participationId);
    assert.ok(after.kind === "ok" && after.currentQueueEntry?.status === "waiting");
    assert.equal(after.currentQueueEntry.position, 1);
    const next = await enter(c, c.experienceId);
    assert.notEqual(next.queueEntryId, c.entryId);
    assert.equal(BigInt(next.queueOrder), BigInt(c.order) + 2n);
});
test("E07.3 titularidade ausente/alheia e tentativa de outra participação são neutras", async () => {
    const c = await context();
    const other = await context();
    const before = await snapshot();
    for (const changes of [{ userId: other.userId }, { participationId: randomUUID() }, { queueEntryId: randomUUID() }, { queueEntryId: other.entryId }]) {
        assert.deepEqual(await service.withdrawExperienceQueue({ ...intent(c), ...changes }), { kind: "access_denied" });
    }
    assert.equal(await snapshot(), before);
});
test("E07.3 participação externa/terminal não é reativada e não deixa reserva", async () => {
    for (const status of ["waiting", "finished", "canceled"]) {
        const c = await context();
        await fixturePool.query(`UPDATE participations SET status=$2::varchar,arena_entered_at=CASE WHEN $2::varchar='waiting' THEN NULL ELSE arena_entered_at END,
      finished_at=CASE WHEN $2::varchar IN ('finished','canceled') THEN clock_timestamp() ELSE NULL END,
      finish_reason=CASE WHEN $2::varchar IN ('finished','canceled') THEN 'fixture_terminal' ELSE NULL END WHERE id=$1`, [c.participationId, status]);
        const before = await snapshot();
        assert.deepEqual(await service.withdrawExperienceQueue(intent(c)), { kind: "participation_not_active" });
        assert.equal(await snapshot(), before);
    }
});
test("E07.3 retry sequencial retorna resposta histórica, sem novos efeitos", async () => {
    for (const called of [false, true]) {
        const c = await context(called);
        const request = intent(c);
        const first = withdrawn(await service.withdrawExperienceQueue(request));
        const before = await snapshot();
        assert.deepEqual(await service.withdrawExperienceQueue(request), { ...first, kind: "replay" });
        assert.equal(await snapshot(), before);
    }
});
test("E07.3 desistência antiga e conflito de chave nunca atingem tentativa posterior", async () => {
    const c = await context(true);
    const request = intent(c);
    const original = withdrawn(await service.withdrawExperienceQueue(request));
    const next = await enter(c, c.experienceId);
    const before = await snapshot();
    assert.deepEqual(await service.withdrawExperienceQueue(request), { ...original, kind: "replay" });
    assert.deepEqual(await service.withdrawExperienceQueue({ ...intent(c), queueEntryId: next.queueEntryId, idempotencyKey: request.idempotencyKey }), { kind: "request_conflict" });
    assert.deepEqual(await service.withdrawExperienceQueue(intent(c)), { kind: "entry_not_current" });
    assert.equal(await snapshot(), before);
    const state = await reader.getParticipationQueue(c.userId, c.participationId);
    assert.ok(state.kind === "ok");
    assert.equal(state.currentQueueEntry?.id, next.queueEntryId);
});
test("E07.3 mesma intenção concorrente sobrepõe PIDs e produz uma saída e replay", async () => {
    const c = await context(true);
    const request = intent(c);
    const [first, second] = await race(heldWithdrawal(request), (db) => makeService(db).withdrawExperienceQueue(request));
    const result = withdrawn(first);
    assert.deepEqual(second, { ...result, kind: "replay" });
    await checkWithdrawal(c, request, true);
});
test("E07.3 chaves diferentes concorrentes produzem uma saída sem reserva residual", async () => {
    const c = await context();
    const request = intent(c);
    const rejected = intent(c);
    const [first, second] = await race(heldWithdrawal(request), db => makeService(db).withdrawExperienceQueue(rejected));
    withdrawn(first);
    assert.deepEqual(second, { kind: "entry_not_current" });
    await checkWithdrawal(c, request, false);
    assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND operation=$2 AND idempotency_key=$3", [c.userId, operation, rejected.idempotencyKey])).rows[0].n, 0);
});
test("E07.3 chamada Staff que vence a corrida é redescoberta e cancelada atomicamente", async () => {
    const c = await context();
    const request = intent(c);
    const first = await holdFixture(c, "call");
    const [call, exit] = await race(first, db => makeService(db).withdrawExperienceQueue(request));
    assert.equal(call.changed, true);
    withdrawn(exit);
    await checkWithdrawal(c, request, true);
});
test("E07.3 saída que vence impede chamada tardia na tentativa encerrada", async () => {
    const c = await context();
    const request = intent(c);
    const [exit, call] = await race(heldWithdrawal(request), (_db, client) => fixtureTransaction(client, cx => mutate(cx, c, "call")));
    withdrawn(exit);
    assert.equal(call.changed, false);
    await checkWithdrawal(c, request, false);
});
test("E07.3 conclusão Staff vencedora não vira cancelamento retroativo", async () => {
    const c = await context(true);
    const first = await holdFixture(c, "complete");
    const [complete, exit] = await race(first, db => makeService(db).withdrawExperienceQueue(intent(c)));
    assert.equal(complete.changed, true);
    assert.deepEqual(exit, { kind: "entry_not_current" });
    assert.equal((await fixturePool.query("SELECT status,cancel_reason FROM service_sessions WHERE queue_entry_id=$1", [c.entryId])).rows[0].status, "completed");
});
test("E07.3 saída vencedora impede conclusão tardia do pending cancelado", async () => {
    const c = await context(true);
    const request = intent(c);
    const [exit, complete] = await race(heldWithdrawal(request), (_db, client) => fixtureTransaction(client, cx => mutate(cx, c, "complete")));
    withdrawn(exit);
    assert.equal(complete.changed, false);
    await checkWithdrawal(c, request, true);
});
test("E07.3 ausência vencedora cria outra entrada que a intenção antiga não pode abandonar", async () => {
    const c = await context(true);
    const request = intent(c);
    const first = await holdFixture(c, "absent");
    const [absent, exit] = await race(first, db => makeService(db).withdrawExperienceQueue(request));
    assert.equal(absent.changed, true);
    assert.ok(absent.newEntryId);
    assert.deepEqual(exit, { kind: "entry_not_current" });
    const before = await snapshot();
    assert.deepEqual(await service.withdrawExperienceQueue(request), { kind: "entry_not_current" });
    assert.equal(await snapshot(), before);
    const state = await reader.getParticipationQueue(c.userId, c.participationId);
    assert.ok(state.kind === "ok");
    assert.equal(state.currentQueueEntry?.id, absent.newEntryId);
});
test("E07.3 saída vencedora não registra ausência nem cria reentrada", async () => {
    const c = await context(true);
    const request = intent(c);
    const [exit, absent] = await race(heldWithdrawal(request), (_db, client) => fixtureTransaction(client, cx => mutate(cx, c, "absent")));
    withdrawn(exit);
    assert.equal(absent.changed, false);
    await checkWithdrawal(c, request, true);
});
test("E07.3 finalização vencedora é preservada e não reativa participação", async () => {
    const c = await context(true);
    const first = await holdFixture(c, "finish");
    const [finish, exit] = await race(first, db => makeService(db).withdrawExperienceQueue(intent(c)));
    assert.equal(finish.changed, true);
    assert.deepEqual(exit, { kind: "participation_not_active" });
    const row = (await fixturePool.query("SELECT status,finish_reason FROM participations WHERE id=$1", [c.participationId])).rows[0];
    assert.deepEqual(row, { status: "finished", finish_reason: "fixture_finish" });
});
test("E07.3 finalização posterior à saída continua válida sem duplicar resolução", async () => {
    const c = await context(true);
    const [exit, finish] = await race(heldWithdrawal(intent(c)), (_db, client) => fixtureTransaction(client, cx => mutate(cx, c, "finish")));
    withdrawn(exit);
    assert.equal(finish.changed, true);
    const row = (await fixturePool.query("SELECT status FROM participations WHERE id=$1", [c.participationId])).rows[0];
    assert.equal(row.status, "finished");
    assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE queue_entry_id=$1", [c.entryId])).rows[0].status, "canceled");
});
test("E07.3 ingresso concorrente após saída usa outra tentativa e não recupera FIFO antigo", async () => {
    for (const sameExperience of [false, true]) {
        const c = await context();
        const other = await experience(c.eventId);
        const chosen = sameExperience ? c.experienceId : other.experienceId;
        const [exit, joined] = await race(heldWithdrawal(intent(c)), db => makeJoin(db).joinExperienceQueue({ userId: c.userId, participationId: c.participationId,
            experienceId: chosen, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") }));
        withdrawn(exit);
        assert.ok(joined.kind === "created");
        assert.notEqual(joined.queueEntryId, c.entryId);
        assert.equal(joined.queueOrder, (baseOrder + (sameExperience ? 2n : 1n)).toString());
    }
});
test("E07.3 ingresso que vê fila ocupada primeiro não impede saída posterior", async () => {
    const c = await context();
    const request = intent(c);
    const [blocked, exit] = await race(heldOccupiedJoin(c), db => makeService(db).withdrawExperienceQueue(request));
    assert.equal(blocked.kind, "queue_occupied");
    withdrawn(exit);
    await checkWithdrawal(c, request, false);
});
test("E07.3 corte oficial preserva saída residual mas impede novo ingresso", async () => {
    const c = await context(true);
    await fixturePool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',operational_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
    withdrawn(await service.withdrawExperienceQueue(intent(c)));
    const result = await joinService.joinExperienceQueue({ userId: c.userId, participationId: c.participationId, experienceId: c.experienceId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
    assert.equal(result.kind, "event_closed");
});
test("E07.3 fechamento controlado vencedor permite apenas saída residual", async () => {
    const c = await context(true);
    const request = intent(c);
    const first = await holdFixture(c, "controlled");
    const [closing, exit] = await race(first, db => makeService(db).withdrawExperienceQueue(request));
    assert.equal(closing.changed, true);
    withdrawn(exit);
    await checkWithdrawal(c, request, true);
    const join = await joinService.joinExperienceQueue({ userId: c.userId, participationId: c.participationId, experienceId: c.experienceId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
    assert.equal(join.kind, "event_closed");
});
test("E07.3 fechamento imediato vencedor bloqueia saída sem fabricar resultado ou limpar job atrasado", async () => {
    const c = await context(true);
    const first = await holdFixture(c, "immediate");
    const request = intent(c);
    const [closed, exit] = await race(first, db => makeService(db).withdrawExperienceQueue(request));
    assert.equal(closed.changed, true);
    assert.deepEqual(exit, { kind: "event_ended" });
    const before = await snapshot();
    assert.deepEqual(await service.withdrawExperienceQueue(request), { kind: "event_ended" });
    assert.equal(await snapshot(), before);
    assert.equal((await fixturePool.query("SELECT status FROM service_sessions WHERE queue_entry_id=$1", [c.entryId])).rows[0].status, "pending");
});
test("E07.3 fechamento imediato após saída não desfaz sua resolução", async () => {
    const c = await context(true);
    const request = intent(c);
    const [exit, closed] = await race(heldWithdrawal(request), (_db, client) => fixtureTransaction(client, cx => mutate(cx, c, "immediate")));
    withdrawn(exit);
    assert.equal(closed.changed, true);
    const before = await snapshot();
    assert.equal((await service.withdrawExperienceQueue(request)).kind, "replay");
    assert.equal(await snapshot(), before);
});
test("E07.3 limite operacional/admin atingido durante espera real reverte toda reserva", async () => {
    for (const administrative of [false, true]) {
        const c = await context(true);
        const lock = await fixturePool.connect();
        let second: PoolClient | undefined;
        let pending: Promise<WithdrawExperienceQueueResult> | undefined;
        try {
            await lock.query("BEGIN");
            await lock.query(`UPDATE events SET official_ends_at=statement_timestamp()-interval '1 minute',operational_deadline_at=statement_timestamp()+interval '3 seconds',
      closure_mode=CASE WHEN $2 THEN 'controlled' END,closure_requested_at=CASE WHEN $2 THEN statement_timestamp()-interval '1 minute' END,
      admin_deadline_at=CASE WHEN $2 THEN statement_timestamp()+interval '2 seconds' END WHERE id=$1`, [c.eventId, administrative]);
            await lock.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
            await lock.query("COMMIT");
            await lock.query("BEGIN");
            await lock.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [c.experienceId]);
            const blocker = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
            second = await servicePool.connect();
            const waiter = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
            pending = makeService(drizzle(second, { schema })).withdrawExperienceQueue(intent(c));
            pending.catch(() => undefined);
            await waitBlocked(waiter, blocker);
            const started = await fixturePool.query(`SELECT a.xact_start < LEAST(e.operational_deadline_at,COALESCE(e.admin_deadline_at,e.operational_deadline_at)) AS before_cut
        FROM pg_stat_activity a CROSS JOIN events e WHERE a.pid=$1 AND e.id=$2`, [waiter, c.eventId]);
            assert.equal(started.rows[0].before_cut, true);
            await fixturePool.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM LEAST(operational_deadline_at,COALESCE(admin_deadline_at,operational_deadline_at))-clock_timestamp()))::double precision+0.001) FROM events WHERE id=$1`, [c.eventId]);
            await lock.query("ROLLBACK");
            assert.deepEqual(await pending, { kind: "event_ended" });
            assert.equal((await fixturePool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND operation=$2", [c.userId, operation])).rows[0].n, 0);
        }
        finally {
            await lock.query("ROLLBACK").catch(() => undefined);
            lock.release();
            if (pending)
                await Promise.allSettled([pending]);
            second?.release();
        }
    }
});
test("E07.3 integridade inválida não cancela nem deixa efeito parcial", async () => {
    for (const mode of ["pointer", "missing_pending", "terminal_pending"]) {
        const c = await context(mode === "terminal_pending");
        if (mode === "pointer")
            await fixturePool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [c.participationId]);
        if (mode === "missing_pending")
            await fixturePool.query("UPDATE queue_entries SET status='called' WHERE id=$1", [c.entryId]);
        if (mode === "terminal_pending")
            await fixturePool.query("UPDATE service_sessions SET status='completed',resolved_at=clock_timestamp() WHERE queue_entry_id=$1", [c.entryId]);
        const before = await snapshot();
        await assert.rejects(service.withdrawExperienceQueue(intent(c)), { name: "QueueWithdrawalIntegrityError" });
        assert.equal(await snapshot(), before);
    }
});
test("E07.3 falhas em quatro fases reais revertem entrada, pending, ponteiro e idempotência", async () => {
    for (const stage of ["entry", "session", "pointer", "complete"] as const) {
        const c = await context(true);
        const request = intent(c);
        const before = await snapshot();
        let reached: typeof stage | undefined;
        const marker = new Error(`E073_FAILURE_${stage}`);
        async function inject(tx: DatabaseTransactionExecutor) {
            const row = (await tx.execute<{
                q: string;
                s: string;
                pointer: string | null;
                idem: string;
                order: string;
            }>(sql `
      SELECT q.status AS q,s.status AS s,p.current_queue_entry_id AS pointer,i.status AS idem,x.last_queue_order::text AS "order"
      FROM queue_entries q JOIN participations p ON p.id=q.participation_id JOIN service_sessions s ON s.queue_entry_id=q.id
      JOIN experiences x ON x.id=q.experience_id JOIN idempotency_operations i ON i.actor_user_id=p.user_id
        AND i.operation=${operation} AND i.idempotency_key=${request.idempotencyKey} WHERE q.id=${c.entryId}`)).rows[0];
            assert.equal(row.q, "closed");
            assert.equal(row.s, stage === "entry" ? "pending" : "canceled");
            assert.equal(row.pointer, stage === "entry" || stage === "session" ? c.entryId : null);
            assert.equal(row.idem, stage === "complete" ? "completed" : "in_progress");
            assert.equal(row.order, c.order);
            reached = stage;
            throw marker;
        }
        const db = { transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) => database.transaction(async (tx) => {
                const proxy = new Proxy(tx, { get(target, key) {
                        if (key === "execute")
                            return async (query: Parameters<typeof tx.execute>[0]) => {
                                const result = await target.execute(query);
                                if (stage === "entry" && result.rows.some(r => "closedAtMs" in r))
                                    await inject(target);
                                if (stage === "session" && result.rows.some(r => r.id !== undefined && r.id !== c.participationId) && result.command === "UPDATE")
                                    await inject(target);
                                if (stage === "pointer" && result.rows.some(r => r.id === c.participationId) && result.command === "UPDATE")
                                    await inject(target);
                                return result;
                            };
                        const value = Reflect.get(target, key);
                        return typeof value === "function" ? value.bind(target) : value;
                    } });
                await callback(proxy);
                if (stage === "complete")
                    await inject(tx);
                throw new Error(`Fase não alcançada: ${stage}`);
            }, config) } as unknown as typeof database;
        await assert.rejects(makeService(db).withdrawExperienceQueue(request), (e: Error) => { let cause: unknown = e; while (cause instanceof Error && cause.cause)
            cause = cause.cause; assert.equal(reached, stage); assert.equal(cause, marker); return true; });
        assert.equal(await snapshot(), before);
        withdrawn(await service.withdrawExperienceQueue(request));
        await checkWithdrawal(c, request, true);
    }
});
