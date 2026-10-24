import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { ParticipationsService } from "../../src/participations/participations.service";

const databaseUrlValue = process.env.DATABASE_URL;
const testDatabaseUrlValue = process.env.EVENTS_TEST_DATABASE_URL;
if (!databaseUrlValue || !testDatabaseUrlValue) {
  throw new Error("DATABASE_URL e EVENTS_TEST_DATABASE_URL devem apontar ao banco descartável local.");
}
const databaseUrl = new URL(databaseUrlValue);
const testDatabaseUrl = new URL(testDatabaseUrlValue);
const authorizedTarget = (url: URL) => url.hostname === "127.0.0.1"
  && url.port === "55432"
  && url.pathname.replace(/^\//, "") === "arenago_events_test";
if (!authorizedTarget(databaseUrl) || !authorizedTarget(testDatabaseUrl)
  || databaseUrl.hostname !== testDatabaseUrl.hostname
  || databaseUrl.port !== testDatabaseUrl.port
  || databaseUrl.pathname !== testDatabaseUrl.pathname) {
  throw new Error("As duas URLs devem apontar exatamente para 127.0.0.1:55432/arenago_events_test.");
}

const servicePool = new Pool({
  connectionString: testDatabaseUrlValue,
  application_name: `arena-e04-read-${randomUUID()}`,
  max: 6,
});
const fixturePool = new Pool({ connectionString: testDatabaseUrlValue, max: 4 });
const database = drizzle(servicePool, { schema });
const service = new ParticipationsService(database, new EventsService(database));
const fixtureTime = new Date();

interface FixtureIds {
  users: string[];
  events: string[];
  participations: string[];
  versions: string[];
}
const ids: FixtureIds = { users: [], events: [], participations: [], versions: [] };

after(async () => {
  await cleanup();
  await Promise.all([servicePool.end(), fixturePool.end()]);
});

async function createUser(): Promise<string> {
  const id = randomUUID();
  await fixturePool.query(
    "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES($1,'E04 read fixture',$2,'placeholder',$3,$3)",
    [id, `${id}@example.test`, fixtureTime],
  );
  ids.users.push(id);
  return id;
}

async function createEvent(externalLastOrder = "0"): Promise<string> {
  const id = randomUUID();
  const startsAt = new Date(Date.now() - 60_000);
  const officialEnd = new Date(Date.now() + 60 * 60_000);
  await fixturePool.query(
    `INSERT INTO events(
       id,name,access_code_normalized,timezone,starts_at,official_ends_at,
       operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at
     ) VALUES($1,'E04 read fixture',$2,'America/Sao_Paulo',$3,$4,$5,'open',true,$6,$7,$7)`,
    [id, `E04-${id.slice(0, 8).toUpperCase()}`, startsAt, officialEnd, new Date(officialEnd.getTime() + 30 * 60_000), externalLastOrder, fixtureTime],
  );
  ids.events.push(id);
  return id;
}

async function insertParticipation(
  userId: string,
  eventId: string,
  status: "waiting" | "active" | "finished" | "canceled",
  order: string | null = null,
): Promise<string> {
  const id = randomUUID();
  const terminal = status === "finished" || status === "canceled";
  const enteredAt = status === "active" ? fixtureTime : null;
  const finishedAt = terminal ? fixtureTime : null;
  const finishReason = status === "finished" ? "fixture_finished" : status === "canceled" ? "fixture_canceled" : null;
  await fixturePool.query(
    `INSERT INTO participations(
       id,user_id,event_id,status,joined_at,external_queue_order,arena_entered_at,
       finished_at,finish_reason,current_queue_entry_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)`,
    [id, userId, eventId, status, fixtureTime, order, enteredAt, finishedAt, finishReason],
  );
  ids.participations.push(id);
  return id;
}

async function cleanup(): Promise<void> {
  if (ids.participations.length) {
    await fixturePool.query(
      "DELETE FROM participation_profile_snapshots WHERE participation_id=ANY($1::uuid[])",
      [ids.participations],
    );
    await fixturePool.query("DELETE FROM participations WHERE id=ANY($1::uuid[])", [ids.participations]);
  }
  if (ids.users.length) {
    await fixturePool.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [ids.users]);
  }
  if (ids.events.length) await fixturePool.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
  if (ids.users.length) await fixturePool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
  if (ids.versions.length) await fixturePool.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [ids.versions]);
  ids.users.length = 0;
  ids.events.length = 0;
  ids.participations.length = 0;
  ids.versions.length = 0;
}

test("usuário sem participação corrente recebe null; participação waiting sozinha fica na posição 1", async () => {
  const userWithoutParticipation = await createUser();
  assert.equal(await service.getCurrentParticipation(userWithoutParticipation), null);

  const eventId = await createEvent();
  const waitingUser = await createUser();
  const participationId = await insertParticipation(waitingUser, eventId, "waiting", "9007199254741000");
  const before = Date.now();
  const state = await service.getCurrentParticipation(waitingUser);
  const afterRead = Date.now();

  assert.equal(state?.id, participationId);
  assert.equal(state?.status, "waiting");
  assert.deepEqual(state?.externalQueue && { position: state.externalQueue.position }, { position: 1 });
  assert.ok(state?.externalQueue?.observedAt instanceof Date);
  assert.ok(state!.externalQueue!.observedAt.getTime() >= before - 2_000);
  assert.ok(state!.externalQueue!.observedAt.getTime() <= afterRead + 2_000);
});

test("três posições contam waiting do mesmo evento e ignoram outras filas e estados", async () => {
  const eventId = await createEvent("77");
  const otherEventId = await createEvent();
  const users = [await createUser(), await createUser(), await createUser()];
  const waitingIds = [
    await insertParticipation(users[0], eventId, "waiting", "10"),
    await insertParticipation(users[1], eventId, "waiting", "20"),
    await insertParticipation(users[2], eventId, "waiting", "30"),
  ];
  const otherEventUser = await createUser();
  await insertParticipation(otherEventUser, otherEventId, "waiting", "1");
  const activeUser = await createUser();
  await insertParticipation(activeUser, eventId, "active", "2");
  const finishedUser = await createUser();
  await insertParticipation(finishedUser, eventId, "finished", "3");
  const canceledUser = await createUser();
  await insertParticipation(canceledUser, eventId, "canceled", "4");

  const positions = await Promise.all(users.map(async (userId) => {
    const state = await service.getCurrentParticipation(userId);
    assert.equal(state?.status, "waiting");
    return state?.externalQueue?.position;
  }));
  assert.deepEqual(positions, [1, 2, 3]);
  for (let index = 0; index < users.length; index += 1) {
    const history = await fixturePool.query("SELECT external_queue_order::text FROM participations WHERE id=$1", [waitingIds[index]]);
    assert.equal(history.rows[0].external_queue_order, String((index + 1) * 10));
  }
});

test("saída da fila reduz posições sem reescrever ordens históricas", async () => {
  const eventId = await createEvent();
  const leavingUser = await createUser();
  const nextUser = await createUser();
  const leavingId = await insertParticipation(leavingUser, eventId, "waiting", "101");
  await insertParticipation(nextUser, eventId, "waiting", "202");
  assert.equal((await service.getCurrentParticipation(nextUser))?.externalQueue?.position, 2);

  await fixturePool.query(
    "UPDATE participations SET status='canceled',finished_at=clock_timestamp(),finish_reason='fixture_canceled' WHERE id=$1",
    [leavingId],
  );
  assert.equal((await service.getCurrentParticipation(nextUser))?.externalQueue?.position, 1);
  const order = await fixturePool.query("SELECT external_queue_order::text FROM participations WHERE id=$1", [leavingId]);
  assert.equal(order.rows[0].external_queue_order, "101");
});

test("consulta por titular preserva active, finished e canceled sem posição externa", async () => {
  const eventId = await createEvent();
  const cases = ["active", "finished", "canceled"] as const;
  for (const status of cases) {
    const userId = await createUser();
    const order = status === "finished" ? "40" : status === "canceled" ? "41" : null;
    const participationId = await insertParticipation(userId, eventId, status, order);
    const result = await service.getParticipationById(userId, participationId);
    assert.equal(result?.id, participationId);
    assert.equal(result?.status, status);
    assert.equal(result?.externalQueue, null);
    if (status === "active") assert.equal((await service.getCurrentParticipation(userId))?.id, participationId);
    else assert.equal(await service.getCurrentParticipation(userId), null);
  }
});

test("ID inexistente e ID de outro usuário são indistinguíveis", async () => {
  const eventId = await createEvent();
  const ownerId = await createUser();
  const strangerId = await createUser();
  const participationId = await insertParticipation(ownerId, eventId, "waiting", "12");
  assert.equal(await service.getParticipationById(strangerId, participationId), null);
  assert.equal(await service.getParticipationById(strangerId, randomUUID()), null);

  const ownRead = await service.getParticipationById(ownerId, participationId);
  assert.equal(ownRead?.id, participationId);
  assert.deepEqual(Object.keys(ownRead ?? {}).sort(), [
    "arenaEnteredAt", "eventId", "externalQueue", "finishReason", "finishedAt", "id", "joinedAt", "status",
  ]);
});

test("consultas repetidas não alteram participação, contador, snapshots ou idempotência", async () => {
  const eventId = await createEvent("888");
  const userId = await createUser();
  const participationId = await insertParticipation(userId, eventId, "waiting", "8");
  const versionId = randomUUID();
  await fixturePool.query(
    "INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}'::jsonb,$3,$3)",
    [versionId, `e04-${versionId.replaceAll("-", "")}`, fixtureTime],
  );
  ids.versions.push(versionId);
  await fixturePool.query(
    "INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at) VALUES($1,$2,'{}'::jsonb,'[]'::jsonb,$3)",
    [participationId, versionId, fixtureTime],
  );
  await fixturePool.query(
    `INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,http_status,result_reference,result_payload,created_at,expires_at)
     VALUES($1,$2,'join',$3,$4,'completed',201,$5,$6,$7,$8)`,
    [randomUUID(), userId, randomUUID(), "a".repeat(64), participationId, JSON.stringify({ participationId }), fixtureTime, new Date("2099-01-01T00:00:00.000Z")],
  );

  const before = await fixturePool.query(
    `SELECT e.external_last_order::text,
       (SELECT count(*)::int FROM participations WHERE id=$2) AS participations,
       (SELECT count(*)::int FROM participation_profile_snapshots WHERE participation_id=$2) AS snapshots,
       (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=$3) AS operations
     FROM events e WHERE e.id=$1`,
    [eventId, participationId, userId],
  );
  await service.getCurrentParticipation(userId);
  await service.getParticipationById(userId, participationId);
  await service.getCurrentParticipation(userId);
  const afterRead = await fixturePool.query(
    `SELECT e.external_last_order::text,
       (SELECT count(*)::int FROM participations WHERE id=$2) AS participations,
       (SELECT count(*)::int FROM participation_profile_snapshots WHERE participation_id=$2) AS snapshots,
       (SELECT count(*)::int FROM idempotency_operations WHERE actor_user_id=$3) AS operations
     FROM events e WHERE e.id=$1`,
    [eventId, participationId, userId],
  );
  assert.deepEqual(afterRead.rows, before.rows);
});

test("leitura concorrente vê estado e posição no mesmo snapshot do PostgreSQL", async () => {
  const eventId = await createEvent();
  const firstUser = await createUser();
  const subjectUser = await createUser();
  await insertParticipation(firstUser, eventId, "waiting", "1");
  const subjectId = await insertParticipation(subjectUser, eventId, "waiting", "2");
  const locker = await fixturePool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("UPDATE participations SET status='active',arena_entered_at=clock_timestamp() WHERE id=$1", [subjectId]);
    const duringUncommittedChange = await service.getParticipationById(subjectUser, subjectId);
    assert.equal(duringUncommittedChange?.status, "waiting");
    assert.deepEqual(duringUncommittedChange?.externalQueue && { position: duringUncommittedChange.externalQueue.position }, { position: 2 });
    await locker.query("COMMIT");
    const afterCommit = await service.getParticipationById(subjectUser, subjectId);
    assert.equal(afterCommit?.status, "active");
    assert.equal(afterCommit?.externalQueue, null);
  } catch (error) {
    await locker.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    locker.release();
  }
});
