import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DatabaseTransactionExecutor } from "../../src/database/database-executor";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { ParticipationsService, type SetExternalQueueEnabledResult } from "../../src/participations/participations.service";
import { assertSafeTestDatabase } from "./test-db-guard";

// Validar todas as fontes antes de criar qualquer conexão. Não imprimir URLs/credenciais.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map((name) => {
  const value = assertSafeTestDatabase(process.env[name]);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test") {
    throw new Error(`${name} deve apontar exatamente a 127.0.0.1:55432/arenago_events_test.`);
  }
  return value;
});
const appName = `arena-e05-${randomUUID()}`;
const servicePool = new Pool({ connectionString: urls[2], application_name: appName, max: 6 });
const fixturePool = new Pool({ connectionString: urls[2], max: 4 });
const database = drizzle(servicePool, { schema });
const service = new ParticipationsService(database, new EventsService(database));
function fixtureIds() {
  return { users: [] as string[], events: [] as string[], participations: [] as string[], versions: [] as string[], games: [] as string[] };
}
type FixtureIds = ReturnType<typeof fixtureIds>;
const ids = fixtureIds();
const fixtureScopes = [ids];

after(async () => {
  const errors: unknown[] = [];
  try {
    for (const tracked of fixtureScopes) {
      try {
        await cleanupFixtures(tracked);
      } catch (error) {
        errors.push(error);
      }
    }
  } catch (error) {
    errors.push(error);
  } finally {
    const closed = await Promise.allSettled([servicePool.end(), fixturePool.end()]);
    for (const result of closed) if (result.status === "rejected") errors.push(result.reason);
  }
  if (errors.length) throw new AggregateError(errors, "Falha na limpeza/encerramento da suíte E05.");
});

/** Remove apenas o grafo das fixtures indicadas; qualquer falha reverte a limpeza inteira. */
async function cleanupFixtures(tracked: FixtureIds): Promise<void> {
  const client = await fixturePool.connect();
  try {
    await client.query("BEGIN");
    const scope = [tracked.events, tracked.participations];
    const participationScope = "SELECT id FROM participations WHERE event_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])";
    // Romper a FK circular antes de excluir entradas ou participações.
    await client.query(`UPDATE participations SET current_queue_entry_id=NULL
      WHERE (event_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])) AND current_queue_entry_id IS NOT NULL`, scope);
    await client.query(`DELETE FROM service_sessions s USING queue_entries q
      WHERE s.queue_entry_id=q.id AND (q.event_id=ANY($1::uuid[]) OR q.participation_id=ANY($2::uuid[]))`, scope);
    await client.query(`DELETE FROM evaluations WHERE participation_id IN (${participationScope})`, scope);
    await client.query(`DELETE FROM queue_entries
      WHERE event_id=ANY($1::uuid[]) OR participation_id=ANY($2::uuid[])`, scope);
    await client.query(`DELETE FROM participation_profile_snapshots WHERE participation_id IN (${participationScope})`, scope);
    await client.query(`DELETE FROM participations WHERE event_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])`, scope);
    await client.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [tracked.users]);
    await client.query("DELETE FROM user_games WHERE user_id=ANY($1::uuid[])", [tracked.users]);
    await client.query("DELETE FROM profiles WHERE user_id=ANY($1::uuid[])", [tracked.users]);
    await client.query(`DELETE FROM stations s USING experiences e
      WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])`, [tracked.events]);
    await client.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [tracked.events]);
    await client.query("DELETE FROM user_roles WHERE event_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])", [tracked.events, tracked.users]);
    await client.query("DELETE FROM audit_logs WHERE event_id=ANY($1::uuid[])", [tracked.events]);
    await client.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [tracked.events]);
    await client.query("DELETE FROM games WHERE id=ANY($1::uuid[])", [tracked.games]);
    await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [tracked.users]);
    await client.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [tracked.versions]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createUser(tracked = ids): Promise<string> {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,'E05 fixture',$2,'placeholder',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [id, `${id}@example.test`]);
  tracked.users.push(id);
  return id;
}

async function createEvent(enabled = true, tracked = ids): Promise<string> {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,
      operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
    VALUES($1,'E05 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',
      clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',$3,clock_timestamp(),clock_timestamp())`,
  [id, `E05-${id.toUpperCase()}`, enabled]);
  tracked.events.push(id);
  const staffId = await createUser(tracked);
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), staffId, id]);
  const experienceId = randomUUID();
  await fixturePool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'E05 experience',clock_timestamp(),clock_timestamp())", [experienceId, id]);
  await fixturePool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'E05 station','available',clock_timestamp(),clock_timestamp())", [randomUUID(), experienceId]);
  return id;
}

async function createParticipant(tracked = ids): Promise<string> {
  const userId = await createUser(tracked);
  const versionId = randomUUID();
  await fixturePool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [versionId, `e05-${versionId.replaceAll("-", "")}`]);
  tracked.versions.push(versionId);
  await fixturePool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,
      questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'1990-02-03','Masculino','Superior','Conheço um pouco.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [userId, versionId]);
  const gameId = randomUUID();
  await fixturePool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [gameId, `E05 ${gameId}`]);
  tracked.games.push(gameId);
  await fixturePool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())", [userId, gameId]);
  return userId;
}

async function join(eventId: string, userId: string, joiningService = service, tracked = ids): Promise<string> {
  const result = await joiningService.createParticipation({
    eventId, userId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01T00:00:00Z"),
  });
  assert.equal(result.kind, "created");
  if (result.kind !== "created") throw new Error("O ingresso de fixture foi impedido.");
  tracked.participations.push(result.participationId);
  return result.participationId;
}

async function snapshot(eventId: string) {
  return (await fixturePool.query(`SELECT to_jsonb(e) AS event,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM participations p WHERE p.event_id=e.id) AS participations,
    (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.participation_id),'[]')
      FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.event_id=e.id) AS snapshots
    FROM events e WHERE e.id=$1`, [eventId])).rows[0];
}

async function waitUntilBlocked(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await fixturePool.query(`SELECT 1 FROM pg_stat_activity
      WHERE application_name=$1 AND state='active' AND wait_event_type='Lock' LIMIT 1`, [appName]);
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("A operação concorrente não ficou bloqueada no PostgreSQL.");
}

/** Mantém a transação real aberta após executar o domínio, antes de COMMIT. */
function holdBeforeCommit() {
  let signalReached!: () => void;
  let rejectReached!: (error: unknown) => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve, reject) => { signalReached = resolve; rejectReached = reject; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const heldDatabase = {
    transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) =>
      database.transaction(async (tx) => {
        try {
          const result = await callback(tx);
          signalReached();
          await gate;
          return result;
        } catch (error) {
          rejectReached(error);
          throw error;
        }
      }, config),
  } as typeof database;
  return {
    service: new ParticipationsService(heldDatabase, new EventsService(database)),
    reached, release,
  };
}

test("E05 libera três waiting, preserva histórico, estados restantes, outro evento e leituras E04", async () => {
  const eventId = await createEvent();
  const waitingUsers = [await createParticipant(), await createParticipant(), await createParticipant()];
  const waitingIds = [];
  for (const userId of waitingUsers) waitingIds.push(await join(eventId, userId));
  const unchangedIds = [];
  for (const status of ["active", "finished", "canceled"]) {
    const id = await join(eventId, await createParticipant());
    await fixturePool.query(`UPDATE participations SET status=$2::varchar(20),
      arena_entered_at=CASE WHEN $2::varchar(20)='active' THEN clock_timestamp() ELSE NULL END,
      finished_at=CASE WHEN $2::varchar(20)='active' THEN NULL ELSE clock_timestamp() END,
      finish_reason=CASE WHEN $2::varchar(20)='active' THEN NULL ELSE 'e05_fixture' END WHERE id=$1`, [id, status]);
    unchangedIds.push(id);
  }
  const otherEvent = await createEvent();
  await join(otherEvent, await createParticipant());
  const otherBefore = await snapshot(otherEvent);
  const before = await snapshot(eventId);
  const beforeClock = await fixturePool.query("SELECT clock_timestamp() AS at");
  const result = await service.setExternalQueueEnabled(eventId, false);
  const afterClock = await fixturePool.query("SELECT clock_timestamp() AS at");
  assert.equal(result.kind, "changed");
  if (result.kind !== "changed") return;
  assert.equal(result.releasedCount, 3);
  assert.ok(result.changedAt.getTime() >= beforeClock.rows[0].at.getTime());
  assert.ok(result.changedAt.getTime() <= afterClock.rows[0].at.getTime());
  const afterRelease = await snapshot(eventId);
  assert.deepEqual(afterRelease.snapshots, before.snapshots);
  assert.equal(afterRelease.event.external_last_order, before.event.external_last_order);
  assert.equal(afterRelease.event.external_queue_enabled, false);
  for (const old of before.participations) {
    const current = afterRelease.participations.find((p: { id: string }) => p.id === old.id);
    if (unchangedIds.includes(old.id)) assert.deepEqual(current, old);
    else {
      assert.ok(waitingIds.includes(old.id));
      assert.equal(new Date(current.arena_entered_at).getTime(), result.changedAt.getTime());
      assert.deepEqual(current, { ...old, status: "active", arena_entered_at: current.arena_entered_at });
    }
  }
  assert.equal(afterRelease.participations.length, before.participations.length);
  assert.deepEqual(await snapshot(otherEvent), otherBefore);
  for (let index = 0; index < waitingUsers.length; index++) {
    const current = await service.getCurrentParticipation(waitingUsers[index]);
    assert.equal(current?.id, waitingIds[index]);
    assert.equal(current?.status, "active");
    assert.equal(current?.externalQueue, null);
    assert.deepEqual(current?.arenaEnteredAt, result.changedAt);
    assert.deepEqual(await service.getParticipationById(waitingUsers[index], waitingIds[index]), current);
  }
  const domainRecords = await fixturePool.query(`SELECT
    (SELECT count(*)::int FROM queue_entries WHERE event_id=$1) AS queues,
    (SELECT count(*)::int FROM service_sessions s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1) AS services,
    (SELECT count(*)::int FROM evaluations v JOIN participations p ON p.id=v.participation_id WHERE p.event_id=$1) AS evaluations`, [eventId]);
  assert.deepEqual(domainRecords.rows[0], { queues: 0, services: 0, evaluations: 0 });
  assert.equal((await service.setExternalQueueEnabled(eventId, false)).kind, "unchanged");
  assert.deepEqual(await snapshot(eventId), afterRelease);
});

test("E05 ingresso direto usa E03; religar afeta só próximos ingressos e mantém contador", async () => {
  const eventId = await createEvent();
  const oldId = await join(eventId, await createParticipant());
  await service.setExternalQueueEnabled(eventId, false);
  const directId = await join(eventId, await createParticipant());
  const before = await snapshot(eventId);
  const direct = before.participations.find((p: { id: string }) => p.id === directId);
  assert.equal(direct.status, "active");
  assert.equal(direct.external_queue_order, null);
  assert.equal(direct.arena_entered_at, direct.joined_at);
  const enabled = await service.setExternalQueueEnabled(eventId, true);
  assert.equal(enabled.kind, "changed");
  if (enabled.kind === "changed") assert.equal(enabled.releasedCount, 0);
  const afterEnable = await snapshot(eventId);
  assert.deepEqual(afterEnable.participations, before.participations);
  assert.deepEqual(afterEnable.snapshots, before.snapshots);
  assert.equal(afterEnable.event.external_last_order, 1);
  assert.equal((await service.setExternalQueueEnabled(eventId, true)).kind, "unchanged");
  assert.deepEqual(await snapshot(eventId), afterEnable);
  const nextId = await join(eventId, await createParticipant());
  const afterJoin = await snapshot(eventId);
  const next = afterJoin.participations.find((p: { id: string }) => p.id === nextId);
  assert.equal(next.status, "waiting");
  assert.equal(next.arena_entered_at, null);
  assert.equal(next.external_queue_order, 2);
  assert.equal(afterJoin.event.external_last_order, 2);
  const previous = afterJoin.participations.find((p: { id: string }) => p.id === oldId);
  assert.equal(previous.status, "active");
  assert.equal(previous.external_queue_order, 1);
});

test("E05 falha após alterar flag e participantes faz rollback completo", async () => {
  const eventId = await createEvent();
  const waitingIds: string[] = [];
  for (let index = 0; index < 3; index++) waitingIds.push(await join(eventId, await createParticipant()));
  const before = await snapshot(eventId);
  assert.ok(before.participations.every((p: { status: string; arena_entered_at: null }) =>
    p.status === "waiting" && p.arena_entered_at === null));
  const failingDatabase = {
    transaction: <T>(callback: (tx: DatabaseTransactionExecutor) => Promise<T>, config?: Parameters<typeof database.transaction>[1]) =>
      database.transaction(async (tx) => {
        const result = await callback(tx) as unknown as SetExternalQueueEnabledResult;
        assert.equal(result.kind, "changed");
        if (result.kind !== "changed") throw new Error("A fixture de rollback precisa executar a liberação.");
        assert.equal(result.releasedCount, waitingIds.length);
        const [insideEvent] = await tx.select({ enabled: schema.events.externalQueueEnabled })
          .from(schema.events).where(eq(schema.events.id, eventId));
        assert.equal(insideEvent.enabled, false);
        const insideParticipations = await tx.select({
          id: schema.participations.id,
          status: schema.participations.status,
          enteredAt: schema.participations.arenaEnteredAt,
        }).from(schema.participations).where(inArray(schema.participations.id, waitingIds));
        assert.deepEqual(insideParticipations.map((p) => p.id).sort(), [...waitingIds].sort());
        for (const participation of insideParticipations) {
          assert.equal(participation.status, "active");
          assert.ok(participation.enteredAt instanceof Date);
          assert.deepEqual(participation.enteredAt, result.changedAt);
        }
        // A própria transação vê as duas mutações; a conexão independente ainda vê o estado anterior.
        assert.deepEqual(await snapshot(eventId), before);
        throw new Error("falha injetada antes do commit E05");
      }, config),
  } as unknown as typeof database;
  const failingService = new ParticipationsService(failingDatabase, new EventsService(database));
  await assert.rejects(failingService.setExternalQueueEnabled(eventId, false), /falha injetada/);
  assert.deepEqual(await snapshot(eventId), before);
});

test("E05 ingresso concorrente serializa nas duas ordens e não deixa waiting com fila desligada", async () => {
  for (const joinFirst of [true, false]) {
    const eventId = await createEvent();
    const userId = await createParticipant();
    const held = holdBeforeCommit();
    const first = joinFirst ? join(eventId, userId, held.service) : held.service.setExternalQueueEnabled(eventId, false);
    let second: Promise<unknown> | undefined;
    try {
      await held.reached;
      second = joinFirst ? service.setExternalQueueEnabled(eventId, false) : join(eventId, userId);
      await waitUntilBlocked();
    } finally {
      held.release();
      await Promise.all([first, second]);
    }
    const state = await service.getCurrentParticipation(userId);
    assert.equal(state?.status, "active");
    assert.equal(state?.externalQueue, null);
    assert.ok(state?.arenaEnteredAt);
    const afterJoin = await snapshot(eventId);
    assert.equal(afterJoin.event.external_queue_enabled, false);
    assert.equal(afterJoin.participations[0].external_queue_order, joinFirst ? 1 : null);
  }
});

test("E05 alternâncias administrativas concorrentes respeitam a ordem serializada e não retrocedem participantes", async () => {
  for (const firstEnabled of [false, true]) {
    const eventId = await createEvent(!firstEnabled);
    await join(eventId, await createParticipant());
    const held = holdBeforeCommit();
    const first = held.service.setExternalQueueEnabled(eventId, firstEnabled);
    let second: ReturnType<ParticipationsService["setExternalQueueEnabled"]> | undefined;
    try {
      await held.reached;
      second = service.setExternalQueueEnabled(eventId, !firstEnabled);
      await waitUntilBlocked();
    } finally {
      held.release();
      await Promise.all([first, second]);
    }
    assert.equal((await first).kind, "changed");
    assert.equal((await second)?.kind, "changed");
    const state = await snapshot(eventId);
    assert.equal(state.event.external_queue_enabled, !firstEnabled);
    assert.equal(state.participations[0].status, "active");
  }
});

test("E05 duas desativações concorrentes liberam uma única vez", async () => {
  const eventId = await createEvent();
  await join(eventId, await createParticipant());
  const held = holdBeforeCommit();
  const first = held.service.setExternalQueueEnabled(eventId, false);
  let second: ReturnType<ParticipationsService["setExternalQueueEnabled"]> | undefined;
  try {
    await held.reached;
    second = service.setExternalQueueEnabled(eventId, false);
    await waitUntilBlocked();
  } finally {
    held.release();
    await Promise.all([first, second]);
  }
  const result = await first;
  assert.equal(result.kind, "changed");
  assert.equal((await second)?.kind, "unchanged");
  if (result.kind === "changed") {
    assert.equal(result.releasedCount, 1);
    const state = await snapshot(eventId);
    assert.equal(new Date(state.participations[0].arena_entered_at).getTime(), result.changedAt.getTime());
  }
});

test("E05 antes do início, corte oficial/Admin e closing/closed impedem ambas as mudanças e novos ingressos", async () => {
  for (const guard of ["not_started", "official_cutoff", "admin_cutoff", "closing", "closed"] as const) {
    for (const enabled of [true, false]) {
      const eventId = await createEvent(enabled);
      await join(eventId, await createParticipant());
      if (guard === "not_started") {
        await fixturePool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes' WHERE id=$1", [eventId]);
      } else if (guard === "official_cutoff") {
        // Ainda na hora operacional adicional, sem permissão para liberar novas entradas externas.
        await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()-interval '1 minute',
          operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [eventId]);
      } else if (guard === "admin_cutoff") {
        await fixturePool.query(`UPDATE events SET closure_mode='controlled',closure_requested_at=clock_timestamp()-interval '1 minute',
          admin_deadline_at=clock_timestamp()+interval '10 minutes' WHERE id=$1`, [eventId]);
      } else {
        await fixturePool.query("UPDATE events SET status=$2 WHERE id=$1", [eventId, guard]);
      }
      const before = await snapshot(eventId);
      const result = await service.setExternalQueueEnabled(eventId, !enabled);
      assert.equal(result.kind, "blocked", guard);
      assert.deepEqual(await snapshot(eventId), before);
      const newcomer = await createParticipant();
      const rejectedJoin = await service.createParticipation({
        userId: newcomer, eventId, idempotencyKey: randomUUID(), expiresAt: new Date("2099-01-01T00:00:00Z"),
      });
      assert.equal(rejectedJoin.kind, "blocked");
      assert.deepEqual(await snapshot(eventId), before);
    }
  }
});

test("E05 revalida fechamento após esperar por lock do evento", async () => {
  const eventId = await createEvent();
  await join(eventId, await createParticipant());
  const locker = await fixturePool.connect();
  let attempt: ReturnType<ParticipationsService["setExternalQueueEnabled"]> | undefined;
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
    attempt = service.setExternalQueueEnabled(eventId, false);
    await waitUntilBlocked();
    await locker.query("UPDATE events SET status='closing' WHERE id=$1", [eventId]);
    await locker.query("COMMIT");
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
    await attempt;
  }
  assert.equal((await attempt)?.kind, "blocked");
  const state = await snapshot(eventId);
  assert.equal(state.event.external_queue_enabled, true);
  assert.equal(state.participations[0].status, "waiting");
  assert.equal(state.participations[0].arena_entered_at, null);
});

test("E05 relógio decisivo é posterior também à espera por lock de participação", async () => {
  const eventId = await createEvent();
  const participationId = await join(eventId, await createParticipant());
  const before = await snapshot(eventId);
  const locker = await fixturePool.connect();
  const availabilityService = new EventsService(database);
  const evaluateAvailability = availabilityService.evaluateEventAvailabilityById.bind(availabilityService);
  let decisionAt: Date | undefined;
  // Observa o instante passado à guarda real, sem substituir a decisão nem alterar o serviço.
  availabilityService.evaluateEventAvailabilityById = async (...args) => {
    decisionAt = args[1];
    return evaluateAvailability(...args);
  };
  const observedService = new ParticipationsService(database, availabilityService);
  let attempt: ReturnType<ParticipationsService["setExternalQueueEnabled"]> | undefined;
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM participations WHERE id=$1 FOR UPDATE", [participationId]);
    const blocker = await locker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    // Margem maior que o timeout de observação; uma máquina atrasada falha na precondição, nunca passa sem exercitá-la.
    await fixturePool.query(`UPDATE events SET official_ends_at=clock_timestamp()+interval '15 seconds',
      operational_deadline_at=clock_timestamp()+interval '30 minutes' WHERE id=$1`, [eventId]);
    const scheduled = await snapshot(eventId);
    attempt = observedService.setExternalQueueEnabled(eventId, false);
    const deadline = Date.now() + 10_000;
    let observedBeforeCutoff = false;
    while (Date.now() < deadline) {
      const observation = await fixturePool.query<{ before_cutoff: boolean }>(`SELECT clock_timestamp() < e.official_ends_at AS before_cutoff
        FROM pg_stat_activity a CROSS JOIN events e
        WHERE a.application_name=$1 AND a.state='active' AND a.wait_event_type='Lock'
          AND $2::int=ANY(pg_blocking_pids(a.pid)) AND e.id=$3`, [appName, blocker.rows[0].pid, eventId]);
      if (observation.rowCount) {
        assert.equal(observation.rows[0].before_cutoff, true, "A espera deve ser observada antes do corte no relógio PostgreSQL.");
        observedBeforeCutoff = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(observedBeforeCutoff, true, "Não foi comprovada a espera pela conexão bloqueadora antes do corte.");
    // Espera calculada pelo corte do banco, mantendo o lock da participação.
    await fixturePool.query(`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM official_ends_at-clock_timestamp()))::double precision)
      FROM events WHERE id=$1`, [eventId]);
    const release = await fixturePool.query<{ at: Date; past_cutoff: boolean; still_blocked: boolean }>(`SELECT clock_timestamp() AS at,
      clock_timestamp() > official_ends_at AS past_cutoff,
      EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name=$2 AND a.state='active'
        AND a.wait_event_type='Lock' AND $3::int=ANY(pg_blocking_pids(a.pid))) AS still_blocked
      FROM events WHERE id=$1`, [eventId, appName, blocker.rows[0].pid]);
    assert.equal(release.rows[0].past_cutoff, true);
    assert.equal(release.rows[0].still_blocked, true);
    const beforeUnlock = release.rows[0].at;
    await locker.query("COMMIT");
    const result = await attempt;
    assert.equal(result.kind, "blocked");
    if (result.kind !== "blocked") throw new Error("A liberação após o corte deveria ser bloqueada.");
    assert.equal(result.availability.eventExists, true);
    if (!result.availability.eventExists) throw new Error("O evento da fixture deve continuar existindo.");
    assert.ok(result.availability.missing.includes("EVENT_ENTRY_CLOSED"));
    assert.ok(decisionAt instanceof Date);
    assert.ok(decisionAt.getTime() >= beforeUnlock.getTime(), "A decisão deve usar horário posterior à espera.");
    assert.deepEqual(await snapshot(eventId), scheduled);
  } finally {
    try {
      await locker.query("ROLLBACK");
    } finally {
      locker.release();
      await attempt;
    }
  }
  const state = await snapshot(eventId);
  assert.equal(state.event.external_queue_enabled, true);
  assert.equal(state.participations[0].status, "waiting");
  assert.equal(state.participations[0].arena_entered_at, null);
  assert.deepEqual(state.participations, before.participations);
  assert.deepEqual(state.snapshots, before.snapshots);
});

test("E05 evento inexistente retorna resultado explícito", async () => {
  assert.deepEqual(await service.setExternalQueueEnabled(randomUUID(), false), { kind: "event_not_found" });
});

test("E05 cleanup remove dependências operacionais e ponteiro circular sem alterar sentinela externa", async () => {
  const target = fixtureIds();
  const sentinel = fixtureIds();
  // O hook final também tenta estes escopos se a preparação ou alguma asserção falhar.
  fixtureScopes.push(target, sentinel);

  async function prepareOperationalFixture(tracked: FixtureIds) {
    const eventId = await createEvent(false, tracked);
    const userId = await createParticipant(tracked);
    const participationId = await join(eventId, userId, service, tracked);
    const resources = await fixturePool.query(`SELECT e.id AS experience_id,s.id AS station_id,r.user_id AS staff_id
      FROM experiences e JOIN stations s ON s.experience_id=e.id
      JOIN user_roles r ON r.event_id=e.event_id AND r.role='staff' WHERE e.event_id=$1`, [eventId]);
    const { experience_id: experienceId, station_id: stationId, staff_id: staffId } = resources.rows[0];
    const completedQueueId = randomUUID();
    const pendingQueueId = randomUUID();
    await fixturePool.query(`INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at,closed_at,close_reason)
      VALUES($1,$3,$4,$5,1,'closed',clock_timestamp(),clock_timestamp(),'completed'),
        ($2,$3,$4,$5,2,'called',clock_timestamp(),NULL,NULL)`,
    [completedQueueId, pendingQueueId, participationId, eventId, experienceId]);
    await fixturePool.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status,resolved_by_user_id,resolved_at)
      VALUES($1,$3,$5,$6,$7,clock_timestamp(),'completed',$7,clock_timestamp()),
        ($2,$4,$5,$6,$7,clock_timestamp(),'pending',NULL,NULL)`,
    [randomUUID(), randomUUID(), completedQueueId, pendingQueueId, experienceId, stationId, staffId]);
    await fixturePool.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1", [participationId, pendingQueueId]);
    await fixturePool.query("UPDATE experiences SET last_queue_order=2 WHERE id=$1", [experienceId]);
    await fixturePool.query(`INSERT INTO evaluations(id,participation_id,rating,submitted_at,updated_at)
      VALUES($1,$2,5,clock_timestamp(),clock_timestamp())`, [randomUUID(), participationId]);
    await fixturePool.query(`INSERT INTO audit_logs(id,event_id,origin,category,action,occurred_at)
      VALUES($1,$2,'system','e05_fixture','cleanup_probe',clock_timestamp())`, [randomUUID(), eventId]);
    return eventId;
  }

  async function operationalState(eventId: string) {
    const event = await snapshot(eventId);
    const related = await fixturePool.query(`SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') FROM queue_entries q WHERE q.event_id=$1) AS queues,
      (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM service_sessions s
        JOIN queue_entries q ON q.id=s.queue_entry_id WHERE q.event_id=$1) AS services,
      (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') FROM evaluations v
        JOIN participations p ON p.id=v.participation_id WHERE p.event_id=$1) AS evaluations,
      (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM experiences e WHERE e.event_id=$1) AS experiences,
      (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM stations s
        JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=$1) AS stations,
      (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM user_roles r WHERE r.event_id=$1) AS roles,
      (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM audit_logs a WHERE a.event_id=$1) AS audits`, [eventId]);
    return { event, ...related.rows[0] };
  }

  const targetEvent = await prepareOperationalFixture(target);
  const sentinelEvent = await prepareOperationalFixture(sentinel);
  const targetBefore = await operationalState(targetEvent);
  const sentinelBefore = await operationalState(sentinelEvent);
  assert.equal(targetBefore.queues.length, 2);
  assert.equal(targetBefore.services.length, 2);
  assert.equal(targetBefore.evaluations.length, 1);
  assert.ok(targetBefore.event.participations[0].current_queue_entry_id);
  await cleanupFixtures(target);
  assert.deepEqual(await operationalState(targetEvent), {
    event: undefined, queues: [], services: [], evaluations: [], experiences: [], stations: [], roles: [], audits: [],
  });
  assert.deepEqual(await operationalState(sentinelEvent), sentinelBefore);
  const remaining = await fixturePool.query(`SELECT
    (SELECT count(*)::int FROM users WHERE id=ANY($1::uuid[])) AS users,
    (SELECT count(*)::int FROM profiles WHERE user_id=ANY($1::uuid[])) AS profiles,
    (SELECT count(*)::int FROM user_games WHERE user_id=ANY($1::uuid[])) AS user_games,
    (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])) AS operations,
    (SELECT count(*)::int FROM games WHERE id=ANY($2::uuid[])) AS games,
    (SELECT count(*)::int FROM questionnaire_versions WHERE id=ANY($3::uuid[])) AS versions`,
  [target.users, target.games, target.versions]);
  assert.deepEqual(remaining.rows[0], { users: 0, profiles: 0, user_games: 0, operations: 0, games: 0, versions: 0 });
  const sentinelParticipant = sentinelBefore.event.participations[0];
  assert.equal((await service.getCurrentParticipation(sentinelParticipant.user_id))?.id, sentinelParticipant.id);
});
