import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../src/database/schema";
import { participationProjection, publicParticipation, type ParticipationProjectionRow } from "../../src/participations/participation-query.service";
import { assertSafeStaffEntryCallsSchemaDatabase } from "./test-db-guard";

// Executa apenas em campanha PostgreSQL explícita; nunca persiste fixtures nem apaga dados históricos.
function authorizedDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.STAFF03_POSTGRES_PROJECTION_TEST !== "authorized-local") {
    throw new Error("Campanha PostgreSQL da STAFF-03 exige autorização explícita e NODE_ENV=test.");
  }
  const urls = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"].map((name) =>
    assertSafeStaffEntryCallsSchemaDatabase(process.env[name]),
  );
  const parsed = new URL(urls[0]);
  if (
    urls.some((value) => value !== urls[0])
    || parsed.hostname !== "127.0.0.1"
    || parsed.port !== "55432"
    || parsed.pathname !== "/arenago_staff_homolog_20261111"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Configuração PostgreSQL da STAFF-03 exige 127.0.0.1:55432/arenago_staff_homolog_20261111.");
  }
  return urls[0];
}

test("STAFF-03 PostgreSQL: projeção externalEntryCall integra ciclo de chamadas, triggers 0008, corte, D06 e encerramento sem persistir fixtures", async () => {
  const connectionString = authorizedDatabaseUrl();
  const client = new Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
  const observer = new Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 5000 });

  const staffId = randomUUID();
  const user1Id = randomUUID();
  const user2Id = randomUUID();
  const event1Id = randomUUID();
  const event2Id = randomUUID();
  const p1Id = randomUUID();
  const p2Id = randomUUID();
  const pOtherId = randomUUID();
  const call1Id = randomUUID();
  const call2Id = randomUUID();

  await client.connect();
  try {
    await observer.connect();
    assert.deepEqual(
      (await client.query("SELECT current_database() AS name, inet_server_port() AS port")).rows[0],
      { name: "arenago_staff_homolog_20261111", port: 55432 },
    );
    assert.ok(
      (await client.query("SELECT to_regclass('public.external_entry_calls') AS name")).rows[0].name,
      "Migration 0008_external_entry_calls precisa estar aplicada no banco de validação.",
    );

    const db = drizzle(client as unknown as ConstructorParameters<typeof drizzle>[0], { schema });
    const project = async (userId: string, participationId?: string, at?: ReturnType<typeof sql>) => {
      const rows = (await db.execute<ParticipationProjectionRow>(participationProjection(userId, participationId, at))).rows;
      return rows.map((row) => publicParticipation(row));
    };

    await client.query("BEGIN");
    try {
      for (const uid of [staffId, user1Id, user2Id]) {
        await client.query(
          "INSERT INTO users(id,name,email,password_hash,email_verified_at,created_at,updated_at) VALUES($1,'STAFF-03 PG',$2,'non-auth-hash',clock_timestamp(),clock_timestamp(),clock_timestamp())",
          [uid, `${uid}@example.test`],
        );
      }
      for (const eid of [event1Id, event2Id]) {
        await client.query(
          `INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
           VALUES($1,'Evento STAFF-03 PG',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',true,10,clock_timestamp(),clock_timestamp())`,
          [eid, eid.toUpperCase()],
        );
      }
      await client.query("INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())", [randomUUID(), staffId, event1Id]);

      await client.query("INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),1)", [p1Id, user1Id, event1Id]);
      await client.query("INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),2)", [p2Id, user2Id, event1Id]);
      await client.query("INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),1)", [pOtherId, user1Id, event2Id]);

      // 1. Sem chamada externa pendente -> externalEntryCall null
      const initial = await project(user1Id, p1Id);
      assert.equal(initial.length, 1);
      assert.equal(initial[0].status, "waiting");
      assert.equal(initial[0].externalQueue?.position, 1);
      assert.equal(initial[0].externalEntryCall, null);

      // 2. Staff chama p1 -> p1 recebe externalEntryCall; p2 e outro evento permanecem isolados
      await client.query(
        "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
        [call1Id, event1Id, p1Id, staffId],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");

      const calledView = await project(user1Id, p1Id);
      assert.equal(calledView[0].externalEntryCall?.callId, call1Id);
      assert.equal(calledView[0].externalEntryCall?.participationId, p1Id);
      assert.equal(calledView[0].externalEntryCall?.eventId, event1Id);
      assert.equal(calledView[0].externalEntryCall?.kind, "external_entry");
      assert.equal(calledView[0].externalEntryCall?.status, "pending");
      assert.match(calledView[0].externalEntryCall?.calledAt ?? "", /\.\d{6}Z$/);
      assert.equal(JSON.stringify(calledView[0]).includes(staffId), false);
      assert.equal(JSON.stringify(calledView[0]).includes(user1Id), false);

      assert.equal((await project(user2Id, p2Id))[0].externalEntryCall, null);
      assert.equal((await project(user1Id, pOtherId))[0].externalEntryCall, null);
      assert.equal((await project(user2Id, p1Id)).length, 0);

      // 3. Confirmação -> active sem chamada pendente
      await client.query("SAVEPOINT sp_confirm");
      await client.query("UPDATE participations SET status='active', arena_entered_at=clock_timestamp() WHERE id=$1", [p1Id]);
      await client.query("UPDATE external_entry_calls SET status='confirmed', resolved_by_user_id=$1, resolved_at=(SELECT arena_entered_at FROM participations WHERE id=$2), resolution_reason='staff_entry_confirmed' WHERE id=$3", [staffId, p1Id, call1Id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const activeView = await project(user1Id, p1Id);
      assert.equal(activeView[0].status, "active");
      assert.equal(activeView[0].externalQueue, null);
      assert.equal(activeView[0].externalEntryCall, null);
      await client.query("ROLLBACK TO SAVEPOINT sp_confirm");
      await client.query("RELEASE SAVEPOINT sp_confirm");

      // 4. Ausência com reinserção + segunda chamada -> limpa call1 e gera call2 distinta
      await client.query("SAVEPOINT sp_absent_requeue");
      await client.query("UPDATE participations SET external_queue_order=3 WHERE id=$1", [p1Id]);
      await client.query("UPDATE external_entry_calls SET status='absent', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_entry_absent_requeued' WHERE id=$2", [staffId, call1Id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const requeuedView = await project(user1Id, p1Id);
      assert.equal(requeuedView[0].status, "waiting");
      assert.equal(requeuedView[0].externalQueue?.position, 2);
      assert.equal(requeuedView[0].externalEntryCall, null);

      await client.query(
        "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
        [call2Id, event1Id, p1Id, staffId],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const secondCallView = await project(user1Id, p1Id);
      assert.equal(secondCallView[0].externalEntryCall?.callId, call2Id);
      assert.notEqual(secondCallView[0].externalEntryCall?.callId, call1Id);
      await client.query("ROLLBACK TO SAVEPOINT sp_absent_requeue");
      await client.query("RELEASE SAVEPOINT sp_absent_requeue");

      // 5. Ausência após corte -> finished sem externalEntryCall
      await client.query("SAVEPOINT sp_absent_cutoff");
      await client.query("UPDATE participations SET status='finished', finished_at=clock_timestamp(), finish_reason='external_absence_after_entry_cutoff' WHERE id=$1", [p1Id]);
      await client.query("UPDATE external_entry_calls SET status='absent', resolved_by_user_id=$1, resolved_at=(SELECT finished_at FROM participations WHERE id=$2), resolution_reason='external_absence_after_entry_cutoff' WHERE id=$3", [staffId, p1Id, call1Id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const cutoffView = await project(user1Id, p1Id);
      assert.equal(cutoffView[0].status, "finished");
      assert.equal(cutoffView[0].externalEntryCall, null);
      await client.query("ROLLBACK TO SAVEPOINT sp_absent_cutoff");
      await client.query("RELEASE SAVEPOINT sp_absent_cutoff");

      // 6. Remoção pelo Staff -> canceled sem externalEntryCall
      await client.query("SAVEPOINT sp_removed");
      await client.query("UPDATE participations SET status='canceled', finished_at=clock_timestamp(), finish_reason='staff_external_wait_removed' WHERE id=$1", [p1Id]);
      await client.query("UPDATE external_entry_calls SET status='removed', resolved_by_user_id=$1, resolved_at=(SELECT finished_at FROM participations WHERE id=$2), resolution_reason='staff_external_wait_removed' WHERE id=$3", [staffId, p1Id, call1Id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const removedView = await project(user1Id, p1Id);
      assert.equal(removedView[0].status, "canceled");
      assert.equal(removedView[0].externalEntryCall, null);
      await client.query("ROLLBACK TO SAVEPOINT sp_removed");
      await client.query("RELEASE SAVEPOINT sp_removed");

      // 7. Desativação da fila D06 -> trigger resolve chamada pendente e projeção vira active sem externalEntryCall
      await client.query("SAVEPOINT sp_d06");
      await client.query("UPDATE events SET external_queue_enabled=false WHERE id=$1", [event1Id]);
      await client.query("UPDATE participations SET status='active', arena_entered_at=clock_timestamp() WHERE id=$1", [p1Id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const d06View = await project(user1Id, p1Id);
      assert.equal(d06View[0].status, "active");
      assert.equal(d06View[0].externalEntryCall, null);
      await client.query("ROLLBACK TO SAVEPOINT sp_d06");
      await client.query("RELEASE SAVEPOINT sp_d06");

      // 8. Cancelamento voluntário -> trigger resolve chamada pendente e detalhe retorna canceled sem externalEntryCall
      await client.query("SAVEPOINT sp_cancel");
      await client.query("UPDATE participations SET status='canceled', finished_at=clock_timestamp(), finish_reason='external_wait_withdrawal' WHERE id=$1", [p1Id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const canceledView = await project(user1Id, p1Id);
      assert.equal(canceledView[0].status, "canceled");
      assert.equal(canceledView[0].externalEntryCall, null);
      await client.query("ROLLBACK TO SAVEPOINT sp_cancel");
      await client.query("RELEASE SAVEPOINT sp_cancel");

      // 9. Prazo operacional vencido antes da finalização física -> projeção read-only oculta externalEntryCall
      const futureAt = sql`clock_timestamp() + interval '3 hours'`;
      const endedProjection = await project(user1Id, p1Id, futureAt);
      assert.equal(endedProjection[0].status, "finished");
      assert.equal(endedProjection[0].externalQueue, null);
      assert.equal(endedProjection[0].externalEntryCall, null);
    } finally {
      await client.query("ROLLBACK");
    }

    assert.equal((await observer.query("SELECT id FROM events WHERE id=$1", [event1Id])).rows.length, 0);
    assert.equal((await observer.query("SELECT id FROM external_entry_calls WHERE id=$1", [call1Id])).rows.length, 0);
  } finally {
    await Promise.allSettled([observer.end(), client.end()]);
  }
});
