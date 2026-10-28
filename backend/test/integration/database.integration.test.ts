import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import { Client, Pool } from "pg";
import { assertSafeTestDatabase } from "./test-db-guard";

const connectionString = assertSafeTestDatabase(process.env.DATABASE_URL);
const pool = new Pool({ connectionString, max: 8 });
after(async () => pool.end());

const plusMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const expectCode = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === code);
};

async function makeUser(email = `db-${randomUUID()}@example.test`): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES($1,'DB Test',$2,'placeholder',now(),now())",
    [id, email],
  );
  return id;
}

async function makeEvent(code = `DB-${randomUUID().slice(0, 10)}`): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at)
     VALUES($1,'DB Test Event',$2,'America/Sao_Paulo',$3,$4,$5,'open',true,now(),now())`,
    [id, code.toUpperCase(), plusMinutes(-60), plusMinutes(30), plusMinutes(90)],
  );
  return id;
}

async function makeExperience(eventId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,$3,now(),now())",
    [id, eventId, `Experience ${id.slice(0, 6)}`],
  );
  return id;
}

async function makeStation(experienceId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,$3,'available',now(),now())",
    [id, experienceId, `Station ${id.slice(0, 6)}`],
  );
  return id;
}

async function makeParticipation(userId: string, eventId: string, status = "active"): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,$4,now())",
    [id, userId, eventId, status],
  );
  return id;
}

async function makeQueue(participationId: string, eventId: string, experienceId: string, order = 1): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at) VALUES($1,$2,$3,$4,$5,'waiting',now())",
    [id, participationId, eventId, experienceId, order],
  );
  return id;
}

test("DB-01..DB-16: constraints e concorrência no PostgreSQL", async (t) => {
  await t.test("DB-01: email funcional case/trim-insensitive é único", async () => {
    const email = `email-${randomUUID()}@example.test`;
    await makeUser(email);
    await expectCode(pool.query(
      "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES($1,'duplicate',$2,'x',now(),now())",
      [randomUUID(), ` ${email.toUpperCase()} `],
    ), "23505");
  });

  await t.test("DB-02: participações correntes serializam por usuário", async () => {
    const userId = await makeUser();
    const eventA = await makeEvent();
    const eventB = await makeEvent();
    const a = new Client({ connectionString });
    const b = new Client({ connectionString });
    await a.connect(); await b.connect();
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      await a.query("INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,'waiting',now())", [randomUUID(), userId, eventA]);
      const competing = b.query("INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,'active',now())", [randomUUID(), userId, eventB]);
      await delay(100);
      await a.query("COMMIT");
      await assert.rejects(competing, (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505");
      await b.query("ROLLBACK");
    } finally { await a.end(); await b.end(); }
  });

  await t.test("DB-03: FKs compostas rejeitam fila cruzando eventos", async () => {
    const eventA = await makeEvent(); const eventB = await makeEvent();
    const userId = await makeUser(); const participationId = await makeParticipation(userId, eventA);
    const experienceB = await makeExperience(eventB);
    await expectCode(pool.query(
      "INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at) VALUES($1,$2,$3,$4,1,'waiting',now())",
      [randomUUID(), participationId, eventB, experienceB],
    ), "23503");
  });

  await t.test("DB-04: uma chamada por queue_entry, inclusive após terminal", async () => {
    const eventId = await makeEvent(); const experienceId = await makeExperience(eventId);
    const stationId = await makeStation(experienceId); const participationId = await makeParticipation(await makeUser(), eventId);
    const queueId = await makeQueue(participationId, eventId, experienceId);
    await pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status) VALUES($1,$2,$3,$4,now(),'pending')", [randomUUID(), queueId, experienceId, stationId]);
    await pool.query("UPDATE service_sessions SET status='completed',resolved_at=now() WHERE queue_entry_id=$1", [queueId]);
    await expectCode(pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status,resolved_at) VALUES($1,$2,$3,$4,now(),'absent',now())", [randomUUID(), queueId, experienceId, stationId]), "23505");
  });

  await t.test("DB-05: estação aceita somente uma chamada pendente", async () => {
    const eventId = await makeEvent(); const experienceId = await makeExperience(eventId); const stationId = await makeStation(experienceId);
    const q1 = await makeQueue(await makeParticipation(await makeUser(), eventId), eventId, experienceId, 1);
    const q2 = await makeQueue(await makeParticipation(await makeUser(), eventId), eventId, experienceId, 2);
    await pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status) VALUES($1,$2,$3,$4,now(),'pending')", [randomUUID(), q1, experienceId, stationId]);
    await expectCode(pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status) VALUES($1,$2,$3,$4,now(),'pending')", [randomUUID(), q2, experienceId, stationId]), "23505");
  });

  await t.test("DB-06: CHECK de atendimento rejeita estado estático inválido", async () => {
    const eventId = await makeEvent(); const experienceId = await makeExperience(eventId); const stationId = await makeStation(experienceId);
    const queueId = await makeQueue(await makeParticipation(await makeUser(), eventId), eventId, experienceId);
    await expectCode(pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status) VALUES($1,$2,$3,$4,now(),'unknown')", [randomUUID(), queueId, experienceId, stationId]), "23514");
  });

  await t.test("DB-07: refresh token vivo é único por sessão", async () => {
    const userId = await makeUser(); const sessionId = randomUUID();
    await pool.query("INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at) VALUES($1,$2,$3,now(),now())", [sessionId, userId, plusMinutes(30)]);
    await pool.query("INSERT INTO refresh_tokens(id,session_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,now())", [randomUUID(), sessionId, randomUUID().replaceAll("-", "").repeat(2), plusMinutes(30)]);
    await expectCode(pool.query("INSERT INTO refresh_tokens(id,session_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,now())", [randomUUID(), sessionId, randomUUID().replaceAll("-", "").repeat(2), plusMinutes(30)]), "23505");
  });

  await t.test("DB-08: idempotency key é única por ator/operação", async () => {
    const actor = await makeUser(); const key = randomUUID();
    const values = [randomUUID(), actor, key, "a".repeat(64), plusMinutes(60)];
    const statement = "INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,http_status,created_at,expires_at) VALUES($1,$2,'join',$3,$4,'completed',201,now(),$5)";
    await pool.query(statement, values);
    await expectCode(pool.query(statement, [randomUUID(), actor, key, "b".repeat(64), plusMinutes(60)]), "23505");
  });

  await t.test("DB-09: ordens bigint mantêm FIFO estável", async () => {
    const eventId = await makeEvent(); const experienceId = await makeExperience(eventId); const userId = await makeUser();
    const p1 = await makeParticipation(userId, eventId);
    const p2 = await makeParticipation(await makeUser(), eventId);
    const q2 = await makeQueue(p2, eventId, experienceId, 2); const q1 = await makeQueue(p1, eventId, experienceId, 1);
    const rows = await pool.query("SELECT id FROM queue_entries WHERE experience_id=$1 AND status='waiting' ORDER BY queue_order,id", [experienceId]);
    assert.deepEqual(rows.rows.map((row: { id: string }) => row.id), [q1, q2]);
  });

  await t.test("DB-10: FK bloqueia exclusão isolada de conta com sessão", async () => {
    const userId = await makeUser();
    await pool.query("INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at) VALUES($1,$2,$3,now(),now())", [randomUUID(), userId, plusMinutes(30)]);
    await expectCode(pool.query("DELETE FROM users WHERE id=$1", [userId]), "23503");
  });

  await t.test("DB-11: cutoff é relido após espera pelo lock do evento", async () => {
    const id = randomUUID(); const starts = plusMinutes(-10); const cutoff = new Date(Date.now() + 900); const operational = new Date(cutoff.getTime() + 60_000);
    await pool.query("INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,created_at,updated_at) VALUES($1,'Cutoff',$2,'America/Sao_Paulo',$3,$4,$5,'open',true,now(),now())", [id, `CUT-${id.slice(0, 8).toUpperCase()}`, starts, cutoff, operational]);
    const locker = await pool.connect(); const waiter = await pool.connect();
    try {
      await locker.query("BEGIN"); await locker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [id]);
      const queued = (async () => {
        await waiter.query("BEGIN"); await waiter.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [id]);
        const result = await waiter.query("SELECT clock_timestamp() < official_ends_at AS allowed FROM events WHERE id=$1", [id]);
        await waiter.query("ROLLBACK"); return result.rows[0].allowed;
      })();
      await delay(1_100); await locker.query("COMMIT");
      assert.equal(await queued, false);
    } finally { locker.release(); waiter.release(); }
  });

  await t.test("DB-12: ingresso e mudança estrutural usam FOR UPDATE no evento", async () => {
    const eventId = await makeEvent(); const userId = await makeUser();
    const a = await pool.connect(); const b = await pool.connect();
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      await a.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
      await a.query("INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,'waiting',now())", [randomUUID(), userId, eventId]);
      const structural = (async () => {
        await b.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
        const count = await b.query("SELECT count(*)::int AS n FROM participations WHERE event_id=$1", [eventId]);
        await b.query("ROLLBACK"); return count.rows[0].n;
      })();
      await delay(100); await a.query("COMMIT"); assert.equal(await structural, 1);
    } finally { a.release(); b.release(); }
  });

  await t.test("DB-13: indisponibilidade não apaga entradas da fila", async () => {
    const eventId = await makeEvent(); const experienceId = await makeExperience(eventId); const stationId = await makeStation(experienceId);
    const queueId = await makeQueue(await makeParticipation(await makeUser(), eventId), eventId, experienceId);
    await pool.query("UPDATE stations SET availability='unavailable' WHERE id=$1", [stationId]);
    const result = await pool.query("SELECT count(*)::int AS n FROM queue_entries WHERE id=$1", [queueId]);
    assert.equal(result.rows[0].n, 1);
  });

  await t.test("DB-14: chamada terminal continua ocupando UNIQUE da tentativa", async () => {
    const eventId = await makeEvent(); const experienceId = await makeExperience(eventId); const stationId = await makeStation(experienceId);
    const queueId = await makeQueue(await makeParticipation(await makeUser(), eventId), eventId, experienceId);
    await pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status,resolved_at) VALUES($1,$2,$3,$4,now(),'completed',now())", [randomUUID(), queueId, experienceId, stationId]);
    await expectCode(pool.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,station_id,called_at,status,resolved_at) VALUES($1,$2,$3,$4,now(),'absent',now())", [randomUUID(), queueId, experienceId, stationId]), "23505");
  });

  await t.test("DB-15: sessão expirada mas não revogada ainda ocupa a unicidade", async () => {
    const userId = await makeUser(); const sessionId = randomUUID();
    await pool.query("INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at) VALUES($1,$2,$3,now(),now())", [sessionId, userId, plusMinutes(-10)]);
    await expectCode(pool.query("INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at) VALUES($1,$2,$3,now(),now())", [randomUUID(), userId, plusMinutes(30)]), "23505");
    await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [sessionId]);
    await pool.query("INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at) VALUES($1,$2,$3,now(),now())", [randomUUID(), userId, plusMinutes(30)]);
  });

  await t.test("DB-16: snapshot pode ser removido no procedimento controlado", async () => {
    const userId = await makeUser(); const eventId = await makeEvent(); const questionnaireId = randomUUID(); const participationId = await makeParticipation(userId, eventId);
    await pool.query("INSERT INTO questionnaire_versions(id,version,definition,created_at) VALUES($1,$2,'{}',now())", [questionnaireId, `db-${randomUUID()}`]);
    await pool.query("INSERT INTO participation_profile_snapshots(participation_id,questionnaire_version_id,answers,games_snapshot,captured_at) VALUES($1,$2,'{}','[]',now())", [participationId, questionnaireId]);
    await pool.query("DELETE FROM participation_profile_snapshots WHERE participation_id=$1", [participationId]);
    const result = await pool.query("SELECT count(*)::int AS n FROM participation_profile_snapshots WHERE participation_id=$1", [participationId]);
    assert.equal(result.rows[0].n, 0);
  });

  await t.test("V11-01: perfil completo exige versão do questionário", async () => {
    const userId = await makeUser();
    await expectCode(pool.query(
      "INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at) VALUES($1,'1990-01-01','x','x','x','x',NULL,now(),now(),now())",
      [userId],
    ), "23502");
  });

  await t.test("DB-17: opções do questionário e gênero 'Outro' são restritos", async () => {
    const questionnaireId = randomUUID();
    await pool.query("INSERT INTO questionnaire_versions(id,version,definition,created_at) VALUES($1,$2,'{}',now())", [questionnaireId, `db-${randomUUID()}`]);
    const insertProfile = async (gender: string, otherGender: string | null, education = "Médio") => {
      const userId = await makeUser();
      return pool.query(
        "INSERT INTO profiles(user_id,birth_date,gender,other_gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at) VALUES($1,'1990-01-01',$2,$3,$4,'Sim, conheço.','Sim, tenho interesse.',$5,now(),now(),now())",
        [userId, gender, otherGender, education, questionnaireId],
      );
    };
    await insertProfile("Feminino", null);
    await insertProfile("Outro", "Resposta informada");
    await expectCode(insertProfile("Desconhecido", null), "23514");
    await expectCode(insertProfile("Feminino", "valor indevido"), "23514");
    await expectCode(insertProfile("Masculino", null, "Ensino médio"), "23514");
  });

  await t.test("V11-05: reserva idempotente, efeito e resposta commitam juntos", async () => {
    const actor = await makeUser(); const subject = await makeUser(); const eventId = await makeEvent();
    const key = randomUUID(); const opId = randomUUID(); const participationId = randomUUID(); const hash = "a".repeat(64);
    const a = new Client({ connectionString }); const b = new Client({ connectionString });
    await a.connect(); await b.connect();
    try {
      await a.query("BEGIN");
      await a.query("INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at) VALUES($1,$2,'join',$3,$4,'in_progress',now(),$5)", [opId, actor, key, hash, plusMinutes(60)]);
      await b.query("BEGIN");
      const duplicate = b.query("INSERT INTO idempotency_operations(id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at) VALUES($1,$2,'join',$3,$4,'in_progress',now(),$5)", [randomUUID(), actor, key, hash, plusMinutes(60)]);
      await a.query("INSERT INTO participations(id,user_id,event_id,status,joined_at) VALUES($1,$2,$3,'waiting',now())", [participationId, subject, eventId]);
      await a.query("UPDATE idempotency_operations SET status='completed',http_status=201,result_reference=$2,result_payload=$3 WHERE id=$1", [opId, participationId, JSON.stringify({ participationId })]);
      await a.query("COMMIT");
      await assert.rejects(duplicate, (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505");
      await b.query("ROLLBACK");
      const stored = await pool.query("SELECT status,http_status,request_hash FROM idempotency_operations WHERE id=$1", [opId]);
      assert.deepEqual(stored.rows[0], { status: "completed", http_status: 201, request_hash: hash });
      const effect = await pool.query("SELECT count(*)::int AS n FROM participations WHERE id=$1", [participationId]);
      assert.equal(effect.rows[0].n, 1);
    } finally { await a.end(); await b.end(); }
  });

  await t.test("V11-09: ingressos concorrentes serializam no evento e geram ordens bigint", async () => {
    const eventId = await makeEvent(); const users = [await makeUser(), await makeUser()];
    async function enter(userId: string): Promise<bigint> {
      const client = new Client({ connectionString }); await client.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
        const allocated = await client.query("UPDATE events SET external_last_order=external_last_order+1 WHERE id=$1 RETURNING external_last_order", [eventId]);
        await client.query("INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',now(),$4)", [randomUUID(), userId, eventId, allocated.rows[0].external_last_order]);
        await client.query("COMMIT");
        return BigInt(allocated.rows[0].external_last_order);
      } finally { await client.end(); }
    }
    const orders = await Promise.all(users.map(enter));
    assert.deepEqual(orders.sort((a, b) => a < b ? -1 : 1), [1n, 2n]);
  });

  await t.test("V12: código de ingresso permanece imutável após criar o evento", async () => {
    const eventId = await makeEvent();
    await expectCode(pool.query("UPDATE events SET access_code_normalized='CHANGED' WHERE id=$1", [eventId]), "23514");
  });
});
