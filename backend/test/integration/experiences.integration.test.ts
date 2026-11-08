import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import { ExperiencesService } from "../../src/events/experiences.service";
import type { EventExperiencesResult } from "../../src/events/experiences.types";
import { assertSafeTestDatabase } from "./test-db-guard";

// Validar as três fontes, incluindo parâmetros de redirecionamento, antes de criar pools.
// Os imports do backend carregam a configuração existente; a barreira rejeita destinos
// de desenvolvimento/homologação antes de qualquer conexão. Exigir preflight do processo.
const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map((name) => {
  const value = assertSafeTestDatabase(process.env[name]);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test") {
    throw new Error(`${name} deve apontar exatamente a 127.0.0.1:55432/arenago_events_test.`);
  }
  return value;
});
const servicePool = new Pool({ connectionString: urls[2], application_name: `arena-e06-${randomUUID()}`, max: 3 });
const fixturePool = new Pool({ connectionString: urls[2], max: 3 });
const database = drizzle(servicePool, { schema });
const service = new ExperiencesService(database, new EventsService(database));
const ids = { events: [] as string[], users: [] as string[], versions: [] as string[] };
const personalNames = new Map<string, string>();
const orders = new Map<string, number>();

after(async () => {
  const errors: unknown[] = [];
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  } finally {
    const closed = await Promise.allSettled([servicePool.end(), fixturePool.end()]);
    for (const result of closed) if (result.status === "rejected") errors.push(result.reason);
  }
  if (errors.length) throw new AggregateError(errors, "Falha na limpeza/encerramento da suíte E06.");
});

/** Limpeza atômica limitada aos eventos/usuários próprios; nenhuma tabela global é esvaziada. */
async function cleanup(): Promise<void> {
  const client = await fixturePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[]) AND current_queue_entry_id IS NOT NULL", [ids.events]);
    await client.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM stations s USING experiences e WHERE s.experience_id=e.id AND e.event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM user_roles WHERE event_id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids.events]);
    await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
    await client.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [ids.versions]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createUser(name?: string): Promise<string> {
  const id = randomUUID();
  const personalName = name ?? `Pessoa privada E06 ${id}`;
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at)
    VALUES($1,$3,$2,'hash-privado',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [id, `${id}@example.test`, personalName]);
  ids.users.push(id);
  personalNames.set(id, personalName);
  return id;
}

async function createEvent(): Promise<string> {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,
    operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
    VALUES($1,'E06 fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',
      clock_timestamp()+interval '90 minutes','open',true,9007199254741000,clock_timestamp(),clock_timestamp())`,
  [id, `E06-${id.toUpperCase()}`]);
  ids.events.push(id);
  return id;
}

async function addParticipation(eventId: string, status: "active" | "waiting" | "finished" | "canceled" = "active", name?: string) {
  const userId = await createUser(name);
  const id = randomUUID();
  const terminal = status === "finished" || status === "canceled";
  await fixturePool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,arena_entered_at,finished_at,finish_reason)
    VALUES($1,$2,$3,$4,clock_timestamp(),CASE WHEN $4::varchar='active' THEN clock_timestamp() END,
      CASE WHEN $5 THEN clock_timestamp() END,CASE WHEN $5 THEN 'fixture_finished' END)`,
  [id, userId, eventId, status, terminal]);
  return { id, userId };
}

async function createContext(participantName?: string, staffName?: string) {
  const eventId = await createEvent();
  const participant = await addParticipation(eventId, "active", participantName);
  const staffId = await createUser(staffName);
  const roleId = randomUUID();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [roleId, staffId, eventId]);
  return { eventId, ...participant, staffId, roleId };
}

async function addExperience(eventId: string, id = randomUUID(), name = "Just Dance", accepting = true): Promise<string> {
  await fixturePool.query(`INSERT INTO experiences(id,event_id,name,queue_accepting_entries,last_queue_order,created_at,updated_at)
    VALUES($1,$2,$3,$4,9007199254741000,clock_timestamp(),clock_timestamp())`, [id, eventId, name, accepting]);
  return id;
}

async function addStation(experienceId: string, available = true, id = randomUUID(), label = "Estação"): Promise<string> {
  await fixturePool.query(`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())`, [id, experienceId, label, available ? "available" : "unavailable"]);
  return id;
}

async function addEntry(eventId: string, experienceId: string, status: "waiting" | "called" | "closed" = "waiting", name?: string) {
  const participation = await addParticipation(eventId, "active", name);
  const id = randomUUID();
  const order = (orders.get(experienceId) ?? 0) + 1;
  orders.set(experienceId, order);
  await fixturePool.query(`INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at,closed_at,close_reason)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),CASE WHEN $6::varchar='closed' THEN clock_timestamp() END,
      CASE WHEN $6::varchar='closed' THEN 'fixture_completed' END)`, [id, participation.id, eventId, experienceId, order, status]);
  if (status !== "closed") {
    await fixturePool.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1", [participation.id, id]);
  }
  return { id, participation };
}

function requireState(result: EventExperiencesResult) {
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") assert.fail("Participante ativo deve ter acesso à consulta.");
  return result;
}

async function persistedState(): Promise<string> {
  // Texto JSON preserva inclusive bigint acima de MAX_SAFE_INTEGER para comparação integral.
  const result = await fixturePool.query(`SELECT jsonb_build_object(
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM events e WHERE e.id=ANY($1::uuid[])),
    'experiences',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM experiences e WHERE e.event_id=ANY($1::uuid[])),
    'stations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stations s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=ANY($1::uuid[])),
    'participations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM participations p WHERE p.event_id=ANY($1::uuid[])),
    'queues',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM queue_entries q WHERE q.event_id=ANY($1::uuid[])),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM service_sessions s JOIN experiences e ON e.id=s.experience_id WHERE e.event_id=ANY($1::uuid[])),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM user_roles r WHERE r.event_id=ANY($1::uuid[])),
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM users u WHERE u.id=ANY($2::uuid[])),
    'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.participation_id) FROM participation_profile_snapshots s JOIN participations p ON p.id=s.participation_id WHERE p.event_id=ANY($1::uuid[]))
  )::text AS state`, [ids.events, ids.users]);
  return result.rows[0].state as string;
}

test("E06 somente active do evento solicitado acessa; ausente, waiting e terceiros são indistinguíveis", async () => {
  const a = await createContext();
  const b = await createContext();
  await addStation(await addExperience(a.eventId));
  const secretExperience = await addExperience(b.eventId, randomUUID(), "Experiência de outro evento");
  await addStation(secretExperience);
  assert.equal(requireState(await service.getEventExperiences(a.userId, a.eventId)).experiences.length, 1);
  const waiting = await addParticipation(a.eventId, "waiting");
  const finished = await addParticipation(a.eventId, "finished");
  const canceled = await addParticipation(a.eventId, "canceled");
  const noParticipation = await createUser();
  for (const [userId, eventId] of [
    [waiting.userId, a.eventId], [finished.userId, a.eventId], [canceled.userId, a.eventId],
    [noParticipation, a.eventId], [randomUUID(), a.eventId], [a.userId, b.eventId], [a.userId, randomUUID()],
  ]) {
    assert.deepEqual(await service.getEventExperiences(userId, eventId), { kind: "access_denied" });
  }
});

test("E06 múltiplas experiências, fila compartilhada, estados excluídos, ocupação e privacidade", async () => {
  const a = await createContext("Ana Participante Privada E06", "Bruno Staff Privado E06");
  // Inserção inversa ao UUID para comprovar que a ordenação não depende da ordem de criação.
  const experienceIds = [randomUUID(), randomUUID(), randomUUID()].sort();
  for (const id of [...experienceIds].reverse()) await addExperience(a.eventId, id, "Nome repetido");
  const stationIds = [randomUUID(), randomUUID()].sort();
  await addStation(experienceIds[0], true, stationIds[1], "Label repetido");
  await addStation(experienceIds[0], false, stationIds[0], "Label repetido");
  const completedStation = await addStation(experienceIds[1]);
  await addEntry(a.eventId, experienceIds[0], "waiting", "Carla Espera Privada E06");
  await addEntry(a.eventId, experienceIds[0], "waiting", "Diego Espera Privada E06");
  const called = await addEntry(a.eventId, experienceIds[0], "called", "Elisa Chamada Privada E06");
  const completed = await addEntry(a.eventId, experienceIds[1], "closed", "Fabio Concluido Privado E06");
  await fixturePool.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),'pending')`, [randomUUID(), called.id, experienceIds[0], stationIds[1], a.staffId]);
  await fixturePool.query(`INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_by_user_id,called_at,status,resolved_at,resolved_by_user_id)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),'completed',clock_timestamp(),$5)`, [randomUUID(), completed.id, experienceIds[1], completedStation, a.staffId]);
  await addParticipation(a.eventId, "waiting", "Gabriela Externa Privada E06");
  const versionId = randomUUID();
  await fixturePool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [versionId, `e06-${versionId}`]);
  ids.versions.push(versionId);
  await fixturePool.query(`INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at)
    VALUES($1,$2,'{"private":"resposta privada"}','[]',clock_timestamp())`, [called.participation.id, versionId]);
  const other = await createContext("Helena Outro Evento Privada E06", "Igor Outro Staff Privado E06");
  const otherExperience = await addExperience(other.eventId);
  await addStation(otherExperience);
  await addEntry(other.eventId, otherExperience, "waiting", "Julia Outra Espera Privada E06");

  const beforeClock = await fixturePool.query("SELECT clock_timestamp() AS at");
  const before = await persistedState();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = requireState(await service.getEventExperiences(a.userId, a.eventId));
    assert.equal(state.eventId, a.eventId);
    assert.deepEqual(state.experiences.map((e) => e.id), experienceIds);
    assert.deepEqual(state.experiences.map((e) => e.name), ["Nome repetido", "Nome repetido", "Nome repetido"]);
    assert.deepEqual(state.experiences.map((e) => e.waitingCount), [2, 0, 0]);
    assert.deepEqual(state.experiences.map((e) => e.acceptingNewQueueEntries), [true, true, false]);
    assert.deepEqual(state.experiences[0].stations.map((s) => s.id), stationIds);
    assert.deepEqual(state.experiences[0].stations.map((s) => s.label), ["Label repetido", "Label repetido"]);
    assert.deepEqual(state.experiences[0].stations.map((s) => s.available), [false, true]);
    assert.equal(state.experiences[1].stations[0].id, completedStation);
    assert.equal(state.experiences[1].stations[0].label, "Estação");
    assert.deepEqual(state.experiences[2].stations, []);
    assert.ok(state.observedAt.getTime() >= (beforeClock.rows[0].at as Date).getTime() - 1);
    const afterClock = await fixturePool.query("SELECT clock_timestamp() AS at");
    assert.ok(state.observedAt.getTime() <= (afterClock.rows[0].at as Date).getTime() + 1);
    assert.deepEqual(Object.keys(state).sort(), ["acceptingNewQueueEntries", "eventId", "experiences", "kind", "observedAt"]);
    for (const experience of state.experiences) {
      assert.deepEqual(Object.keys(experience).sort(), ["acceptingNewQueueEntries", "id", "name", "stations", "waitingCount"]);
      for (const station of experience.stations) assert.deepEqual(Object.keys(station).sort(), ["available", "id", "label"]);
    }
    const json = JSON.stringify(state);
    for (const secret of [a.userId, a.staffId, called.participation.userId, otherExperience, "example.test", "hash-privado", "resposta privada", ...personalNames.values()]) {
      assert.equal(json.includes(secret), false);
    }
  }
  assert.equal(await persistedState(), before, "Nenhum contador, timestamp, fila ou dado pessoal pode ser alterado.");
});

test("E06 capacidade individual e fila fechada preservam espera; outra experiência continua apta", async () => {
  const a = await createContext();
  const paused = await addExperience(a.eventId, randomUUID(), "Pausada", false);
  const unavailable = await addExperience(a.eventId, randomUUID(), "Indisponível");
  const ready = await addExperience(a.eventId, randomUUID(), "Apta");
  await addStation(paused);
  await addStation(unavailable, false);
  await addStation(ready);
  await addEntry(a.eventId, paused);
  await addEntry(a.eventId, unavailable);
  const state = requireState(await service.getEventExperiences(a.userId, a.eventId));
  assert.equal(state.acceptingNewQueueEntries, true);
  for (const experience of state.experiences) {
    assert.equal(experience.acceptingNewQueueEntries, experience.id === ready);
    assert.equal(experience.waitingCount, experience.id === ready ? 0 : 1);
  }
  await fixturePool.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [ready]);
  assert.equal(requireState(await service.getEventExperiences(a.userId, a.eventId)).acceptingNewQueueEntries, false);
});

test("E06 Staff revogado, inativo, não verificado ou de outro evento não habilita entradas", async () => {
  const a = await createContext();
  const other = await createContext();
  await addStation(await addExperience(a.eventId));
  const experienceId = (requireState(await service.getEventExperiences(a.userId, a.eventId))).experiences[0].id;
  await addEntry(a.eventId, experienceId);
  const blockAndCheck = async (sql: string, params: unknown[]) => {
    await fixturePool.query(sql, params);
    const state = requireState(await service.getEventExperiences(a.userId, a.eventId));
    assert.equal(state.acceptingNewQueueEntries, false);
    assert.equal(state.experiences[0].acceptingNewQueueEntries, false);
    assert.equal(state.experiences[0].waitingCount, 1);
  };
  await blockAndCheck("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [a.roleId]);
  await fixturePool.query("UPDATE user_roles SET revoked_at=NULL WHERE id=$1", [a.roleId]);
  await blockAndCheck("UPDATE users SET is_active=false WHERE id=$1", [a.staffId]);
  await fixturePool.query("UPDATE users SET is_active=true WHERE id=$1", [a.staffId]);
  await blockAndCheck("UPDATE users SET email_verified_at=NULL WHERE id=$1", [a.staffId]);
  await fixturePool.query("UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1", [a.staffId]);
  await blockAndCheck("UPDATE user_roles SET event_id=$2 WHERE id=$1", [a.roleId, other.eventId]);
  await fixturePool.query("UPDATE user_roles SET event_id=$2 WHERE id=$1", [a.roleId, a.eventId]);
  assert.equal(requireState(await service.getEventExperiences(a.userId, a.eventId)).acceptingNewQueueEntries, true);
});

test("E06 cortes oficial/Admin e estados administrativos mantêm consulta e filas durante margem residual", async () => {
  const a = await createContext();
  const experienceId = await addExperience(a.eventId);
  await addStation(experienceId);
  await addEntry(a.eventId, experienceId);
  const events = new EventsService(database);
  const cases = [
    { changes: "official_ends_at=statement_timestamp()-interval '10 minutes',operational_deadline_at=statement_timestamp()+interval '20 minutes'", missing: "EVENT_ENTRY_CLOSED", withinEntryWindow: false },
    { changes: "closure_mode='controlled',closure_requested_at=statement_timestamp()-interval '10 minutes',admin_deadline_at=statement_timestamp()+interval '20 minutes'", missing: "EVENT_ENTRY_CLOSED", withinEntryWindow: false },
    { changes: "status='closing'", missing: "EVENT_ADMIN_CLOSING", withinEntryWindow: true },
    { changes: "status='closed'", missing: "EVENT_CLOSED", withinEntryWindow: true },
  ];
  for (const { changes, missing, withinEntryWindow } of cases) {
    // Restaurar todos os campos alterados: nenhum cenário herda o impedimento anterior.
    await fixturePool.query(`UPDATE events SET status='open',
      starts_at=statement_timestamp()-interval '1 hour',
      official_ends_at=statement_timestamp()+interval '1 hour',
      operational_deadline_at=statement_timestamp()+interval '90 minutes',
      closure_mode=NULL,closure_requested_at=NULL,admin_deadline_at=NULL WHERE id=$1`, [a.eventId]);
    const baseline = requireState(await service.getEventExperiences(a.userId, a.eventId));
    assert.equal(baseline.acceptingNewQueueEntries, true);
    assert.equal(baseline.experiences[0].acceptingNewQueueEntries, true);
    assert.equal(baseline.experiences[0].waitingCount, 1);
    await fixturePool.query(`UPDATE events SET ${changes} WHERE id=$1`, [a.eventId]);
    const before = await persistedState();
    const state = requireState(await service.getEventExperiences(a.userId, a.eventId));
    assert.equal(state.acceptingNewQueueEntries, false);
    assert.equal(state.experiences[0].acceptingNewQueueEntries, false);
    assert.equal(state.experiences[0].waitingCount, 1);
    const availability = await events.evaluateEventAvailabilityById(a.eventId, state.observedAt);
    assert.ok(availability.eventExists);
    assert.equal(availability.ready, true, "Configuração, Staff e estação devem continuar aptos.");
    assert.equal(availability.withinEntryWindow, withinEntryWindow);
    assert.deepEqual(availability.missing, [missing], "Deve existir somente o impedimento específico do cenário.");
    const event = await events.findById(a.eventId);
    assert.ok(event);
    assert.ok(event.operationalDeadlineAt.getTime() > state.observedAt.getTime(), "A margem operacional ainda está vigente.");
    if (event.adminDeadlineAt) assert.ok(event.adminDeadlineAt.getTime() > state.observedAt.getTime());
    assert.equal(availability.cutoffAt.getTime(), (event.closureRequestedAt ?? event.officialEndsAt).getTime());
    assert.equal(await persistedState(), before);
  }
});

test("E06 evento ainda não iniciado, sem estações disponíveis ou sem experiências tem retorno válido", async () => {
  const a = await createContext();
  const empty = requireState(await service.getEventExperiences(a.userId, a.eventId));
  assert.deepEqual(empty.experiences, []);
  assert.equal(empty.acceptingNewQueueEntries, false);
  const experienceId = await addExperience(a.eventId);
  await addStation(experienceId, false);
  const unavailable = requireState(await service.getEventExperiences(a.userId, a.eventId));
  assert.equal(unavailable.experiences[0].acceptingNewQueueEntries, false);
  assert.equal(unavailable.acceptingNewQueueEntries, false);
  await fixturePool.query("UPDATE stations SET availability='available' WHERE experience_id=$1", [experienceId]);
  await fixturePool.query("UPDATE events SET starts_at=clock_timestamp()+interval '10 minutes',status='scheduled' WHERE id=$1", [a.eventId]);
  assert.equal(requireState(await service.getEventExperiences(a.userId, a.eventId)).acceptingNewQueueEntries, false);
});

test("E06 mudanças de fila e disponibilidade entre consultas são refletidas sem cache", async () => {
  const a = await createContext();
  const experienceId = await addExperience(a.eventId);
  const stationId = await addStation(experienceId);
  const entry = await addEntry(a.eventId, experienceId);
  const read = async () => requireState(await service.getEventExperiences(a.userId, a.eventId));
  assert.equal((await read()).experiences[0].waitingCount, 1);
  await fixturePool.query("UPDATE queue_entries SET status='called' WHERE id=$1", [entry.id]);
  assert.equal((await read()).experiences[0].waitingCount, 0);
  await addEntry(a.eventId, experienceId);
  await fixturePool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [stationId]);
  const unavailable = await read();
  assert.equal(unavailable.experiences[0].waitingCount, 1);
  assert.equal(unavailable.acceptingNewQueueEntries, false);
  await fixturePool.query("UPDATE stations SET availability='available' WHERE id=$1", [stationId]);
  assert.equal((await read()).acceptingNewQueueEntries, true);
});

test("E06 snapshot conserva disponibilidade, estações e fila apesar de commit entre as leituras", async () => {
  const a = await createContext();
  const experienceId = await addExperience(a.eventId);
  const stationId = await addStation(experienceId);
  const entry = await addEntry(a.eventId, experienceId);
  const events = new EventsService(database);
  const evaluate = events.evaluateEventAvailabilityById.bind(events);
  let changed = false;
  events.evaluateEventAvailabilityById = async (...args) => {
    const availability = await evaluate(...args);
    assert.ok(availability.eventExists && availability.eventAcceptingNewEntries);
    const client = await fixturePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [stationId]);
      await client.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [a.roleId]);
      await client.query("UPDATE queue_entries SET status='called' WHERE id=$1", [entry.id]);
      await client.query("UPDATE experiences SET queue_accepting_entries=false WHERE id=$1", [experienceId]);
      await client.query("COMMIT");
      changed = true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return availability;
  };
  const consistentService = new ExperiencesService(database, events);
  const during = requireState(await consistentService.getEventExperiences(a.userId, a.eventId));
  assert.equal(changed, true);
  assert.equal(during.acceptingNewQueueEntries, true);
  assert.equal(during.experiences[0].waitingCount, 1);
  assert.equal(during.experiences[0].stations[0].available, true);
  const afterCommit = requireState(await service.getEventExperiences(a.userId, a.eventId));
  assert.equal(afterCommit.acceptingNewQueueEntries, false);
  assert.equal(afterCommit.experiences[0].waitingCount, 0);
  assert.equal(afterCommit.experiences[0].stations[0].available, false);
});

test("E06 autorização e guardas compartilham snapshot; consulta seguinte observa perda do acesso", async () => {
  const a = await createContext();
  const experienceId = await addExperience(a.eventId);
  await addStation(experienceId);
  const events = new EventsService(database);
  const evaluate = events.evaluateEventAvailabilityById.bind(events);
  let changed = false;
  events.evaluateEventAvailabilityById = async (...args) => {
    // O serviço já verificou active. Confirmar em outra conexão antes de ler as guardas.
    await fixturePool.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='fixture_finished' WHERE id=$1", [a.id]);
    await fixturePool.query("UPDATE user_roles SET revoked_at=clock_timestamp() WHERE id=$1", [a.roleId]);
    changed = true;
    return evaluate(...args);
  };
  const during = requireState(await new ExperiencesService(database, events).getEventExperiences(a.userId, a.eventId));
  assert.equal(changed, true);
  assert.equal(during.acceptingNewQueueEntries, true);
  assert.equal(during.experiences[0].id, experienceId);
  assert.deepEqual(await service.getEventExperiences(a.userId, a.eventId), { kind: "access_denied" });
});
