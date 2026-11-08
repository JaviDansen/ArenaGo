import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/database/schema";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import type { QueueStateService } from "../../src/events/queue-state.service";
import type { QueueEntryService } from "../../src/events/queue-entry.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Antes de importar qualquer serviço/configuração. Sem fallback .env ou URL de outro banco.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map(name => {
  const value = assertSafeTestDatabase(process.env[name]);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test"
    || url.search || url.hash || !url.username) throw new Error(`${name}: destino local explícito obrigatório, sem parâmetros.`);
  return value;
});
if (urls.some(url => url !== urls[0])) throw new Error("As três URLs explícitas precisam ser idênticas.");
process.env.DOTENV_CONFIG_PATH = devNull;
const servicePool = new Pool({ connectionString: urls[2], ssl: false, max: 4, connectionTimeoutMillis: 2000, statement_timeout: 8000, lock_timeout: 5000 });
const fixturePool = new Pool({ connectionString: urls[2], ssl: false, max: 4, connectionTimeoutMillis: 2000, statement_timeout: 8000, lock_timeout: 5000 });
const database = drizzle(servicePool, { schema });
let service: QueueStateService;
let joinService: QueueEntryService;
let makeService: (db: NodePgDatabase<typeof schema>) => QueueStateService;
const ids = { events: [] as string[], users: [] as string[] };
const privateNames: string[] = [];
const baseOrder = 9007199254741000n;

before(async () => {
  assert.equal((await fixturePool.query("SELECT current_database() AS name")).rows[0].name, "arenago_events_test");
  const { QueueStateService } = await import("../../src/events/queue-state.service");
  const { QueueEntryService } = await import("../../src/events/queue-entry.service");
  const { EventsService } = await import("../../src/events/events.service");
  makeService = db => new QueueStateService(db);
  service = makeService(database); joinService = new QueueEntryService(database, new EventsService(database));
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
        await c.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])", [ids.events]);
        await c.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
        await c.query("DELETE FROM user_roles WHERE event_id=ANY($1::uuid[])", [ids.events]);
        await c.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
        await c.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
        await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
        await c.query("COMMIT");
      } catch (error) { await c.query("ROLLBACK").catch(() => undefined); errors.push(error); }
      finally { c.release(); }
    }
  } catch (error) { errors.push(error); }
  const closed = await Promise.allSettled([servicePool.end(), fixturePool.end()]);
  for (const result of closed) if (result.status === "rejected") errors.push(result.reason);
  if (errors.length) throw new AggregateError(errors, "Limpeza E07.2 falhou.");
});

async function user() {
  const id = randomUUID(); const name = `Nome privado E072 ${id}`; privateNames.push(name);
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,$2,$3,'private-password-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())`, [id, name, `${id}@example.test`]);
  ids.users.push(id); return id;
}
async function participant(eventId: string, status = "active") {
  const userId = await user(); const participationId = randomUUID(); const terminal = status === "finished" || status === "canceled";
  await fixturePool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4,clock_timestamp(),CASE WHEN $4::varchar='active' THEN clock_timestamp() END,
      CASE WHEN $5 THEN clock_timestamp() END,CASE WHEN $5 THEN 'fixture_terminal' END)`,
  [participationId, userId, eventId, status, terminal]);
  return { userId, participationId, eventId };
}
type Person = Awaited<ReturnType<typeof participant>>;
async function experience(eventId: string) {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO experiences(id,event_id,name,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'E072 Just Dance',$3,clock_timestamp(),clock_timestamp())`, [id, eventId, baseOrder.toString()]);
  return id;
}
async function station(experienceId: string, label = "E072 Estação 1") {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,$3,'available',clock_timestamp(),clock_timestamp())`, [id, experienceId, label]);
  return id;
}
async function context() {
  const eventId = randomUUID();
  await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,
    operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E072 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
      clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',false,clock_timestamp(),clock_timestamp())`,
  [eventId, `E072-${eventId.toUpperCase()}`]);
  ids.events.push(eventId);
  const p = await participant(eventId); const staffId = await user(); const roleId = randomUUID();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [roleId, staffId, eventId]);
  const experienceId = await experience(eventId);
  const stationIds = [await station(experienceId), await station(experienceId, "E072 Estação 2")];
  return { ...p, staffId, roleId, experienceId, stationIds };
}
async function enqueue(p: Person, experienceId: string) {
  const result = await joinService.joinExperienceQueue({ ...p, experienceId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01") });
  assert.equal(result.kind, "created"); if (result.kind !== "created") assert.fail();
  return result;
}
async function state(p: Person, reader = service) {
  const result = await reader.getParticipationQueue(p.userId, p.participationId);
  assert.equal(result.kind, "ok"); if (result.kind !== "ok") assert.fail(); return result;
}
async function waitingState(p: Person) {
  const result = await state(p); assert.equal(result.currentQueueEntry?.status, "waiting");
  if (result.currentQueueEntry?.status !== "waiting") assert.fail(); return result.currentQueueEntry;
}

/** Preparação de fixtures, não implementação dos comandos E08/E07.3. */
async function fixtureMutation(p: Person, experienceId: string, stationId: string | null, action: (c: PoolClient) => Promise<void>) {
  const c = await fixturePool.connect();
  try {
    await c.query("BEGIN"); await c.query("SELECT id FROM events WHERE id=$1 FOR SHARE", [p.eventId]);
    await c.query("SELECT id FROM experiences WHERE id=$1 FOR UPDATE", [experienceId]);
    if (stationId) await c.query("SELECT id FROM stations WHERE id=$1 FOR UPDATE", [stationId]);
    await c.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [p.participationId]);
    await action(c); await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}
async function call(p: Person, experienceId: string, entryId: string, stationId: string, staffId: string) {
  const sessionId = randomUUID();
  await fixtureMutation(p, experienceId, stationId, async c => {
    await c.query("UPDATE queue_entries SET status='called' WHERE id=$1", [entryId]);
    await c.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status)
      VALUES($1,$2,$3,$4,$5,clock_timestamp(),'pending')`, [sessionId, entryId, experienceId, stationId, staffId]);
  });
  return sessionId;
}
async function close(p: Person, experienceId: string, entryId: string, stationId: string | null = null) {
  await fixtureMutation(p, experienceId, stationId, async c => {
    await c.query("SELECT id FROM queue_entries WHERE id=$1 FOR UPDATE", [entryId]);
    await c.query("UPDATE service_sessions SET status='canceled',resolved_at=clock_timestamp(),cancel_reason='fixture_withdrawal' WHERE queue_entry_id=$1 AND status='pending'", [entryId]);
    await c.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_withdrawal' WHERE id=$1", [entryId]);
    await c.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [p.participationId]);
  });
}
async function snapshot() {
  const result = await fixturePool.query(`SELECT jsonb_build_object(
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM events e WHERE e.id=ANY($1::uuid[])),
    'experiences',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM experiences e WHERE e.event_id=ANY($1::uuid[])),
    'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=ANY($1::uuid[])),
    'participations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=ANY($1::uuid[])),
    'queues',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=ANY($1::uuid[])),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=ANY($1::uuid[])),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM user_roles r WHERE r.event_id=ANY($1::uuid[])),
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM users u WHERE u.id=ANY($2::uuid[])),
    'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM idempotency_operations i WHERE i.actor_user_id=ANY($2::uuid[]))
    )::text AS state`, [ids.events, ids.users]);
  return result.rows[0].state as string;
}

/** Pausa determinística após a primeira leitura REAL, sem trocar executor nem snapshot. */
function pauseAfterAccess() {
  let signal!: (pid: number) => void; let reject!: (error: unknown) => void; let release!: () => void;
  const reached = new Promise<number>((yes,no) => { signal=yes; reject=no; });
  const gate = new Promise<void>(yes => { release=yes; });
  const db = {
    transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) =>
      database.transaction(async tx => {
        let paused = false;
        const proxy = new Proxy(tx, { get(target, key) {
          if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
            const result = await target.execute(query);
            if (result.rows.some(row => "observedAtMs" in row)) {
              assert.equal(paused, false, "A barreira deve ser atingida uma única vez."); paused = true;
              const pid = await target.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
              signal(pid.rows[0].pid); await gate;
            }
            return result;
          };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        try {
          const result = await callback(proxy);
          if (!paused) reject(new Error("A primeira leitura não alcançou a barreira de snapshot."));
          return result;
        } catch (error) { reject(error); throw error; }
      }, config),
  } as typeof database;
  return { service: makeService(db), reached, release };
}

test("E07.2 ativa sem fila retorna null e relógio PostgreSQL", async () => {
  const c = await context();
  const before = (await fixturePool.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  const result = await state(c);
  const after = (await fixturePool.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
  assert.equal(result.currentQueueEntry, null);
  assert.ok(result.observedAt >= before && result.observedAt <= after);
});

test("E07.2 observa ingresso real E07.1 na posição 1 sem converter bigint em number", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId); const result = await waitingState(c);
  assert.equal(result.id, entry.queueEntryId); assert.equal(result.position, 1);
  assert.equal(result.queueOrder, (baseOrder+1n).toString()); assert.equal(result.experienceName, "E072 Just Dance");
});

test("E07.2 três participantes aguardam em posições 1, 2 e 3", async () => {
  const c = await context(); const people = [c, await participant(c.eventId), await participant(c.eventId)];
  for (const p of people) await enqueue(p, c.experienceId);
  for (let i=0;i<people.length;i++) assert.equal((await waitingState(people[i])).position, i+1);
});

test("E07.2 encerrar alguém à frente reduz posição sem renumerar ordens", async () => {
  const c = await context(); const p = await participant(c.eventId);
  const first = await enqueue(c, c.experienceId); const second = await enqueue(p, c.experienceId);
  assert.equal((await waitingState(p)).position, 2); await close(c, c.experienceId, first.queueEntryId);
  const result = await waitingState(p); assert.equal(result.position, 1); assert.equal(result.queueOrder, second.queueOrder);
  const order = await fixturePool.query("SELECT queue_order::text FROM queue_entries WHERE id=$1", [first.queueEntryId]);
  assert.equal(order.rows[0].queue_order, first.queueOrder);
});

test("E07.2 called não conta como waiting, mas mantém atendimento pending", async () => {
  const c = await context(); const p = await participant(c.eventId);
  const first = await enqueue(c, c.experienceId); await enqueue(p, c.experienceId);
  await call(c, c.experienceId, first.queueEntryId, c.stationIds[0], c.staffId);
  assert.equal((await waitingState(p)).position, 1); assert.equal((await state(c)).currentQueueEntry?.status, "called");
});

test("E07.2 experiências têm posições independentes", async () => {
  const c = await context(); const other = await experience(c.eventId); await station(other);
  await enqueue(c, c.experienceId);
  const p = await participant(c.eventId); await enqueue(p, other);
  assert.equal((await waitingState(p)).position, 1); assert.equal((await waitingState(c)).position, 1);
});

test("E07.2 estações múltiplas e estação adicionada compartilham a mesma posição", async () => {
  const c = await context(); const p = await participant(c.eventId);
  await enqueue(c, c.experienceId); const entry = await enqueue(p, c.experienceId);
  await station(c.experienceId, "E072 Estação 3");
  const result = await waitingState(p); assert.equal(result.position, 2); assert.equal(result.queueOrder, entry.queueOrder);
});

test("E07.2 called aponta para estação e atendimento corretos, com horário real", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId);
  const sessionId = await call(c, c.experienceId, entry.queueEntryId, c.stationIds[1], c.staffId);
  const result = (await state(c)).currentQueueEntry; assert.ok(result?.status === "called");
  assert.deepEqual(result.serviceSession.station, { id: c.stationIds[1], label: "E072 Estação 2" });
  assert.equal(result.position, null); assert.equal(result.serviceSession.id, sessionId); assert.equal(result.queueOrder, entry.queueOrder);
  const row = await fixturePool.query("SELECT called_at FROM service_sessions WHERE id=$1", [sessionId]);
  assert.deepEqual(result.serviceSession.calledAt, row.rows[0].called_at);
});

test("E07.2 indisponibilidade de estação/Staff não apaga chamada ou espera existente", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId); const p = await participant(c.eventId); await enqueue(p, c.experienceId);
  await call(c, c.experienceId, entry.queueEntryId, c.stationIds[1], c.staffId);
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE experience_id=$1", [c.experienceId]);
  await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [c.roleId]);
  assert.equal((await state(c)).currentQueueEntry?.status, "called"); assert.equal((await waitingState(p)).position, 1);
});

test("E07.2 titular externo, finished ou canceled sem fila continua com sucesso neutro", async () => {
  const c = await context();
  for (const status of ["waiting", "finished", "canceled"]) assert.equal((await state(await participant(c.eventId, status))).currentQueueEntry, null);
});

test("E07.2 histórico fechado não é fila atual e leitura é compatível com futura E07.3", async () => {
  for (const wasCalled of [false, true]) {
    const c = await context(); const entry = await enqueue(c, c.experienceId);
    if (wasCalled) await call(c, c.experienceId, entry.queueEntryId, c.stationIds[0], c.staffId);
    await close(c, c.experienceId, entry.queueEntryId, wasCalled ? c.stationIds[0] : null);
    assert.equal((await state(c)).currentQueueEntry, null);
    const next = await enqueue(c, c.experienceId); assert.equal((await waitingState(c)).id, next.queueEntryId);
  }
});

test("E07.2 participação inexistente e alheia são indistinguíveis", async () => {
  const c = await context(); await enqueue(c, c.experienceId); const other = await participant(c.eventId);
  assert.deepEqual(await service.getParticipationQueue(other.userId, c.participationId), { kind: "access_denied" });
  assert.deepEqual(await service.getParticipationQueue(other.userId, randomUUID()), { kind: "access_denied" });
});

test("E07.2 chamada concorrente confirma sem bloquear leitura, que conserva snapshot anterior", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId);
  const held = pauseAfterAccess(); const pending = state(c, held.service); pending.catch(() => undefined);
  let expectedSession!: string;
  try {
    const readerPid = await held.reached;
    // call usa outro cliente real e precisa COMITAR enquanto a leitura está pausada.
    const writer = await fixturePool.connect();
    try { assert.notEqual((await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, readerPid); }
    finally { writer.release(); }
    expectedSession = await call(c, c.experienceId, entry.queueEntryId, c.stationIds[1], c.staffId);
  } finally { held.release(); }
  const old = (await pending).currentQueueEntry; assert.ok(old?.status === "waiting"); assert.equal(old.position, 1);
  const fresh = (await state(c)).currentQueueEntry; assert.ok(fresh?.status === "called"); assert.equal(fresh.serviceSession.id, expectedSession);
});

test("E07.2 limpeza do ponteiro entre etapas não produz estado híbrido; nova consulta observa null", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId);
  const held = pauseAfterAccess(); const pending = state(c, held.service); pending.catch(() => undefined);
  try { await held.reached; await close(c, c.experienceId, entry.queueEntryId); }
  finally { held.release(); }
  assert.equal((await pending).currentQueueEntry?.status, "waiting"); assert.equal((await state(c)).currentQueueEntry, null);
});

test("E07.2 corte oficial mantém waiting e called na margem operacional", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId); const p = await participant(c.eventId); await enqueue(p, c.experienceId);
  await call(c, c.experienceId, entry.queueEntryId, c.stationIds[0], c.staffId);
  await fixturePool.query("UPDATE events SET official_ends_at=clock_timestamp()-interval '10 minutes',operational_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1", [c.eventId]);
  assert.equal((await state(c)).currentQueueEntry?.status, "called"); assert.equal((await waitingState(p)).position, 1);
});

test("E07.2 fechamento controlado mantém consulta até seu prazo residual", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId);
  await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',
    admin_deadline_at=clock_timestamp()+interval '20 minutes' WHERE id=$1`, [c.eventId]);
  assert.equal((await waitingState(c)).id, entry.queueEntryId);
});

test("E07.2 encerramento efetivo projeta null mesmo com job atrasado, sem limpar nada", async () => {
  for (const mode of ["operational", "closed", "immediate", "controlled"]) {
    const c = await context(); const entry = await enqueue(c, c.experienceId); const p = await participant(c.eventId); await enqueue(p, c.experienceId);
    await call(c, c.experienceId, entry.queueEntryId, c.stationIds[1], c.staffId);
    if (mode === "operational") await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '20 minutes',
      operational_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "closed") await fixturePool.query("UPDATE events SET status='closed' WHERE id=$1", [c.eventId]);
    if (mode === "immediate") await fixturePool.query(`UPDATE events SET closure_mode='immediate',
      closure_requested_at=statement_timestamp()-interval '1 minute',admin_deadline_at=statement_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    if (mode === "controlled") await fixturePool.query(`UPDATE events SET status='closing',closure_mode='controlled',
      closure_requested_at=clock_timestamp()-interval '20 minutes',admin_deadline_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [c.eventId]);
    const before = await snapshot(); assert.equal((await state(c)).currentQueueEntry, null); assert.equal((await state(p)).currentQueueEntry, null);
    assert.equal(await snapshot(), before);
  }
});

test("E07.2 consultas repetidas não alteram nenhuma linha, contador ou idempotência das fixtures", async () => {
  const c = await context(); const entry = await enqueue(c, c.experienceId); const p = await participant(c.eventId); await enqueue(p, c.experienceId);
  await call(c, c.experienceId, entry.queueEntryId, c.stationIds[0], c.staffId);
  const before = await snapshot();
  for (let i=0;i<3;i++) { await state(c); await state(p); }
  assert.equal(await snapshot(), before);
});

test("E07.2 contrato não expõe Staff, outras pessoas ou credenciais", async () => {
  const c = await context(); const p = await participant(c.eventId); await enqueue(p, c.experienceId);
  const entry = await enqueue(c, c.experienceId); await call(c, c.experienceId, entry.queueEntryId, c.stationIds[1], c.staffId);
  const result = await state(c); const json = JSON.stringify(result);
  for (const secret of [...privateNames, c.userId, c.staffId, p.userId, p.participationId, "private-password-hash", "example.test"]) assert.equal(json.includes(secret), false);
  assert.deepEqual(Object.keys(result).sort(), ["currentQueueEntry", "kind", "observedAt", "participationId"]);
  assert.ok(result.currentQueueEntry?.status === "called");
  assert.deepEqual(Object.keys(result.currentQueueEntry).sort(), ["experienceId", "experienceName", "id", "position", "queueOrder", "serviceSession", "status"]);
  assert.deepEqual(Object.keys(result.currentQueueEntry.serviceSession).sort(), ["calledAt", "id", "station", "status"]);
  assert.deepEqual(Object.keys(result.currentQueueEntry.serviceSession.station).sort(), ["id", "label"]);
});

test("E07.2 inconsistências permitidas pelo DDL são falhas explícitas, sem fabricação de estado", async () => {
  for (const mode of ["orphan", "closed_pointer", "missing_pending", "terminal_session", "external_with_queue"]) {
    const c = await context(); const entry = await enqueue(c, c.experienceId);
    if (mode === "orphan") await fixturePool.query("UPDATE participations SET current_queue_entry_id=NULL WHERE id=$1", [c.participationId]);
    if (mode === "closed_pointer") await fixturePool.query("UPDATE queue_entries SET status='closed',closed_at=clock_timestamp(),close_reason='fixture_inconsistent' WHERE id=$1", [entry.queueEntryId]);
    if (mode === "missing_pending") await fixturePool.query("UPDATE queue_entries SET status='called' WHERE id=$1", [entry.queueEntryId]);
    if (mode === "terminal_session") {
      const sessionId = await call(c, c.experienceId, entry.queueEntryId, c.stationIds[0], c.staffId);
      await fixturePool.query("UPDATE service_sessions SET status='completed',resolved_at=clock_timestamp(),resolved_by_user_id=$2 WHERE id=$1", [sessionId, c.staffId]);
    }
    if (mode === "external_with_queue") await fixturePool.query("UPDATE participations SET status='waiting',arena_entered_at=NULL WHERE id=$1", [c.participationId]);
    const before = await snapshot(); await assert.rejects(service.getParticipationQueue(c.userId, c.participationId), { name: "QueueStateIntegrityError" });
    assert.equal(await snapshot(), before);
  }
});
