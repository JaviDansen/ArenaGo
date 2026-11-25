import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../src/database/schema";
import { participationProjection, publicParticipation, type ParticipationProjectionRow } from "../../src/participations/participation-query.service";
import { assertSafeStaffEntryCallsSchemaDatabase } from "./test-db-guard";

// Suíte física PostgreSQL (SQL, projeção read-only e triggers da migration 0008).
// Não substitui testes HTTP de controllers/serviços; exige autorização explícita e executa integralmente sob ROLLBACK.
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

test("STAFF-03 PostgreSQL: projeção externalEntryCall integra ciclo de chamadas, triggers 0008, corte, D06 e encerramentos sem persistir fixtures", async () => {
  const connectionString = authorizedDatabaseUrl();
  const client = new Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
  const observer = new Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 5000 });

  const staffId = randomUUID();
  const user1Id = randomUUID();
  const user2Id = randomUUID();
  const user3Id = randomUUID();
  const event1Id = randomUUID();
  const event2Id = randomUUID();
  const p1Id = randomUUID();
  const p1HistoricalId = randomUUID();
  const p2Id = randomUUID();
  const p3OtherEventId = randomUUID();
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
    const projectById = async (userId: string, participationId: string, at?: ReturnType<typeof sql>) => {
      const rows = (await db.execute<ParticipationProjectionRow>(participationProjection(userId, participationId, at))).rows;
      return rows.map((row) => publicParticipation(row));
    };
    const projectCurrent = async (userId: string, at?: ReturnType<typeof sql>) => {
      const rows = (await db.execute<ParticipationProjectionRow>(participationProjection(userId, undefined, at))).rows;
      assert.ok(rows.length <= 1, "Cada usuário deve ter no máximo uma participação corrente.");
      if (!rows.length) return null;
      const value = publicParticipation(rows[0]);
      return value.status !== "waiting" && value.status !== "active" ? null : value;
    };

    const withScenario = async (savepoint: string, work: () => Promise<void>) => {
      await client.query(`SAVEPOINT ${savepoint}`);
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      try {
        await work();
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        await client.query("SET CONSTRAINTS ALL DEFERRED");
      }
    };

    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    try {
      for (const uid of [staffId, user1Id, user2Id, user3Id]) {
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
      await client.query(
        "INSERT INTO user_roles(id,user_id,role,event_id,granted_at) VALUES($1,$2,'staff',$3,clock_timestamp())",
        [randomUUID(), staffId, event1Id],
      );

      // Respeita uq_participations_one_current_user: cada usuário possui no máximo uma participação waiting/active.
      await client.query(
        "INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),1)",
        [p1Id, user1Id, event1Id],
      );
      await client.query(
        "INSERT INTO participations(id,user_id,event_id,status,joined_at,finished_at,finish_reason) VALUES($1,$2,$3,'finished',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day','voluntary')",
        [p1HistoricalId, user1Id, event2Id],
      );
      await client.query(
        "INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),2)",
        [p2Id, user2Id, event1Id],
      );
      await client.query(
        "INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),1)",
        [p3OtherEventId, user3Id, event2Id],
      );

      // 1. Sem chamada externa pendente -> current e byId retornam externalEntryCall: null
      const initialCurrent = await projectCurrent(user1Id);
      assert.equal(initialCurrent?.id, p1Id);
      assert.equal(initialCurrent?.status, "waiting");
      assert.equal(initialCurrent?.externalQueue?.position, 1);
      assert.equal(initialCurrent?.externalEntryCall, null);

      // 2. Staff chama p1 -> p1 recebe externalEntryCall; user2 (mesmo evento), user3 (outro evento) e histórico de user1 ficam isolados
      await client.query(
        "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
        [call1Id, event1Id, p1Id, staffId],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("SET CONSTRAINTS ALL DEFERRED");

      const calledCurrent = await projectCurrent(user1Id);
      const calledDetail = (await projectById(user1Id, p1Id))[0];
      assert.deepEqual(calledCurrent, calledDetail);
      assert.equal(calledDetail.externalEntryCall?.callId, call1Id);
      assert.equal(calledDetail.externalEntryCall?.participationId, p1Id);
      assert.equal(calledDetail.externalEntryCall?.eventId, event1Id);
      assert.equal(calledDetail.externalEntryCall?.kind, "external_entry");
      assert.equal(calledDetail.externalEntryCall?.status, "pending");
      assert.match(calledDetail.externalEntryCall?.calledAt ?? "", /\.\d{6}Z$/);
      assert.equal(JSON.stringify(calledDetail).includes(staffId), false);
      assert.equal(JSON.stringify(calledDetail).includes(user1Id), false);

      assert.equal((await projectCurrent(user2Id))?.externalEntryCall, null);
      assert.equal((await projectCurrent(user3Id))?.externalEntryCall, null);
      assert.equal((await projectById(user1Id, p1HistoricalId))[0].externalEntryCall, null);
      assert.equal((await projectById(user2Id, p1Id)).length, 0);
      assert.equal((await projectById(user3Id, p1Id)).length, 0);

      // 3. Confirmação (ordem do StaffEntryCallService: external_entry_calls -> participations)
      await withScenario("sp_confirm", async () => {
        await client.query(
          "UPDATE external_entry_calls SET status='confirmed', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_entry_confirmed' WHERE id=$2",
          [staffId, call1Id],
        );
        await client.query(
          "UPDATE participations p SET status='active', arena_entered_at=c.resolved_at FROM external_entry_calls c WHERE p.id=c.participation_id AND c.id=$1",
          [call1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const activeCurrent = await projectCurrent(user1Id);
        assert.equal(activeCurrent?.status, "active");
        assert.equal(activeCurrent?.externalQueue, null);
        assert.equal(activeCurrent?.externalEntryCall, null);
      });

      // 4. Ausência com reinserção + nova chamada -> limpa call1 e entrega call2 distinta
      await withScenario("sp_absent_requeue", async () => {
        await client.query(
          "UPDATE external_entry_calls SET status='absent', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_external_absent' WHERE id=$2",
          [staffId, call1Id],
        );
        await client.query("UPDATE participations SET external_queue_order=3 WHERE id=$1", [p1Id]);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("SET CONSTRAINTS ALL DEFERRED");

        const requeued = await projectCurrent(user1Id);
        assert.equal(requeued?.status, "waiting");
        assert.equal(requeued?.externalQueue?.position, 2);
        assert.equal(requeued?.externalEntryCall, null);

        await client.query(
          "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
          [call2Id, event1Id, p1Id, staffId],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const secondCall = await projectCurrent(user1Id);
        assert.equal(secondCall?.externalEntryCall?.callId, call2Id);
        assert.notEqual(secondCall?.externalEntryCall?.callId, call1Id);
      });

      // 5. Ausência após o corte (ordem do StaffEntryCallService: external_entry_calls -> participations)
      await withScenario("sp_absent_cutoff", async () => {
        await client.query(
          "UPDATE external_entry_calls SET status='absent', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_external_absent' WHERE id=$2",
          [staffId, call1Id],
        );
        await client.query(
          "UPDATE participations p SET status='finished', finished_at=c.resolved_at, finish_reason='external_absence_after_entry_cutoff' FROM external_entry_calls c WHERE p.id=c.participation_id AND c.id=$1",
          [call1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        assert.equal(await projectCurrent(user1Id), null);
        const cutoffDetail = (await projectById(user1Id, p1Id))[0];
        assert.equal(cutoffDetail.status, "finished");
        assert.equal(cutoffDetail.finishReason, "external_absence_after_entry_cutoff");
        assert.equal(cutoffDetail.externalEntryCall, null);
      });

      // 6. Remoção pelo Staff (ordem do StaffEntryCallService: external_entry_calls -> participations)
      await withScenario("sp_removed", async () => {
        await client.query(
          "UPDATE external_entry_calls SET status='removed', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_external_wait_removed' WHERE id=$2",
          [staffId, call1Id],
        );
        await client.query(
          "UPDATE participations p SET status='canceled', finished_at=c.resolved_at, finish_reason='staff_external_wait_removed' FROM external_entry_calls c WHERE p.id=c.participation_id AND c.id=$1",
          [call1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        assert.equal(await projectCurrent(user1Id), null);
        const removedDetail = (await projectById(user1Id, p1Id))[0];
        assert.equal(removedDetail.status, "canceled");
        assert.equal(removedDetail.finishReason, "staff_external_wait_removed");
        assert.equal(removedDetail.externalEntryCall, null);
      });

      // 7. Desistência voluntária -> trigger resolve_external_call_on_participation cancela chamada
      await withScenario("sp_voluntary_cancel", async () => {
        await client.query(
          "UPDATE participations SET status='canceled', finished_at=clock_timestamp(), finish_reason='external_wait_withdrawal' WHERE id=$1",
          [p1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "external_wait_withdrawal" });
        assert.equal(await projectCurrent(user1Id), null);
        assert.equal((await projectById(user1Id, p1Id))[0].externalEntryCall, null);
      });

      // 8. Desativação D06 -> trigger cancela chamada com external_queue_disabled e projeção vira active
      await withScenario("sp_d06", async () => {
        await client.query("UPDATE events SET external_queue_enabled=false WHERE id=$1", [event1Id]);
        await client.query("UPDATE participations SET status='active', arena_entered_at=clock_timestamp() WHERE id=$1", [p1Id]);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "external_queue_disabled" });
        const d06Current = await projectCurrent(user1Id);
        assert.equal(d06Current?.status, "active");
        assert.equal(d06Current?.externalEntryCall, null);
      });

      // 9. Encerramento efetivo antes da regularização física (somente leitura)
      const futureAt = sql`clock_timestamp() + interval '3 hours'`;
      assert.equal(await projectCurrent(user1Id, futureAt), null);
      const endedProjection = (await projectById(user1Id, p1Id, futureAt))[0];
      assert.equal(endedProjection.status, "finished");
      assert.equal(endedProjection.externalQueue, null);
      assert.equal(endedProjection.externalEntryCall, null);

      // 10. Encerramento administrativo controlado -> trigger cancela chamada pendente e projeção oculta externalEntryCall
      await withScenario("sp_controlled_closure", async () => {
        await client.query(
          "UPDATE events SET status='closing', closure_mode='controlled', closure_requested_at=clock_timestamp(), admin_deadline_at=clock_timestamp()+interval '15 minutes' WHERE id=$1",
          [event1Id],
        );
        await client.query(
          "UPDATE participations p SET status='finished', finished_at=e.closure_requested_at, finish_reason='admin_controlled_external_wait_closed' FROM events e WHERE p.event_id=e.id AND p.id=$1",
          [p1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "admin_controlled_external_wait_closed" });
        assert.equal(await projectCurrent(user1Id), null);
        const detail = (await projectById(user1Id, p1Id))[0];
        assert.equal(detail.status, "finished");
        assert.equal(detail.finishReason, "admin_controlled_external_wait_closed");
        assert.equal(detail.externalEntryCall, null);
      });

      // 11. Encerramento administrativo imediato -> trigger cancela chamada pendente e projeção oculta externalEntryCall
      await withScenario("sp_immediate_closure", async () => {
        await client.query(
          "WITH now_at AS (SELECT clock_timestamp() AS at) UPDATE events e SET status='closed', closure_mode='immediate', closure_requested_at=now_at.at, admin_deadline_at=now_at.at FROM now_at WHERE e.id=$1",
          [event1Id],
        );
        await client.query(
          "UPDATE participations p SET status='finished', finished_at=e.admin_deadline_at, finish_reason='admin_immediate' FROM events e WHERE p.event_id=e.id AND p.id=$1",
          [p1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "admin_immediate" });
        assert.equal(await projectCurrent(user1Id), null);
        const detail = (await projectById(user1Id, p1Id))[0];
        assert.equal(detail.status, "finished");
        assert.equal(detail.finishReason, "admin_immediate");
        assert.equal(detail.externalEntryCall, null);
      });
    } finally {
      await client.query("ROLLBACK");
    }

    assert.equal((await observer.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [[staffId, user1Id, user2Id, user3Id]])).rows.length, 0);
    assert.equal((await observer.query("SELECT id FROM events WHERE id=ANY($1::uuid[])", [[event1Id, event2Id]])).rows.length, 0);
    assert.equal((await observer.query("SELECT id FROM external_entry_calls WHERE id=ANY($1::uuid[])", [[call1Id, call2Id]])).rows.length, 0);
  } finally {
    await Promise.allSettled([observer.end(), client.end()]);
  }
});
