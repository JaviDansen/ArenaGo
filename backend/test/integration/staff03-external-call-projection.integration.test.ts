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
// Valida a projeção e a integridade física do estado persistido no banco; não substitui testes HTTP
// de controllers nem testes de decisão temporal de StaffEntryCallService. Exige autorização explícita
// e executa integralmente sob ROLLBACK.
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

test("STAFF-03 PostgreSQL: projeção externalEntryCall integra ciclo FIFO, triggers 0008, corte, D06 e encerramentos sem persistir fixtures", async () => {
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
  const callBId = randomUUID();
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

    const db = drizzle(client, { schema });
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
    const captureObservedInstant = async () => {
      const at = (await client.query<{ at: string }>(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )).rows[0].at;
      return { iso: at, expr: sql`${at}::timestamptz` };
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
      // external_last_order coerente com as ordens atribuídas às participações iniciais de cada evento.
      for (const [eid, lastOrder] of [[event1Id, 2], [event2Id, 1]] as const) {
        await client.query(
          `INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
           VALUES($1,'Evento STAFF-03 PG',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',true,$3,clock_timestamp(),clock_timestamp())`,
          [eid, eid.toUpperCase(), lastOrder],
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
      const initialRef = await captureObservedInstant();
      const initialCurrent = await projectCurrent(user1Id, initialRef.expr);
      const initialDetail = (await projectById(user1Id, p1Id, initialRef.expr))[0];
      assert.deepEqual(initialCurrent, initialDetail);
      assert.equal(initialCurrent?.id, p1Id);
      assert.equal(initialCurrent?.status, "waiting");
      assert.equal(initialCurrent?.externalQueue?.position, 1);
      assert.equal(initialCurrent?.externalQueue?.observedAt, initialRef.iso);
      assert.equal(initialCurrent?.externalEntryCall, null);

      // 2. Staff chama p1 -> comparação determinística com instante único (AUD-06.1) + isolamento por conta/evento
      await client.query(
        "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
        [call1Id, event1Id, p1Id, staffId],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("SET CONSTRAINTS ALL DEFERRED");

      const calledRef = await captureObservedInstant();
      const calledCurrent = await projectCurrent(user1Id, calledRef.expr);
      const calledDetail = (await projectById(user1Id, p1Id, calledRef.expr))[0];
      assert.deepEqual(calledCurrent, calledDetail);
      assert.equal(calledDetail.status, "waiting");
      assert.equal(calledDetail.externalQueue?.position, 1);
      assert.equal(calledDetail.externalQueue?.observedAt, calledRef.iso);
      assert.equal(calledDetail.externalEntryCall?.callId, call1Id);
      assert.equal(calledDetail.externalEntryCall?.participationId, p1Id);
      assert.equal(calledDetail.externalEntryCall?.eventId, event1Id);
      assert.equal(calledDetail.externalEntryCall?.kind, "external_entry");
      assert.equal(calledDetail.externalEntryCall?.status, "pending");
      assert.match(calledDetail.externalEntryCall?.calledAt ?? "", /\.\d{6}Z$/);
      assert.equal(JSON.stringify(calledDetail).includes(staffId), false);
      assert.equal(JSON.stringify(calledDetail).includes(user1Id), false);

      // Valida também o caminho padrão de produção (clock_timestamp() próprio da projeção) sem comparar observedAt entre consultas separadas
      const liveCalledCurrent = await projectCurrent(user1Id);
      assert.equal(liveCalledCurrent?.id, p1Id);
      assert.equal(liveCalledCurrent?.status, "waiting");
      assert.equal(liveCalledCurrent?.externalQueue?.position, 1);
      assert.match(liveCalledCurrent?.externalQueue?.observedAt ?? "", /\.\d{6}Z$/);
      assert.deepEqual(liveCalledCurrent?.externalEntryCall, calledDetail.externalEntryCall);

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

      // 4. Ausência com reinserção + avanço legítimo da fila FIFO (AUD-06.2) -> nova chamada gera call2 distinta
      await withScenario("sp_absent_requeue", async () => {
        await client.query(
          "UPDATE external_entry_calls SET status='absent', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_external_absent' WHERE id=$2",
          [staffId, call1Id],
        );
        const nextOrder = (await client.query<{ order: string }>(
          "UPDATE events SET external_last_order=external_last_order+1 WHERE id=$1 RETURNING external_last_order::text AS \"order\"",
          [event1Id],
        )).rows[0].order;
        assert.equal(nextOrder, "3");
        await client.query(
          "UPDATE participations SET external_queue_order=$1::bigint WHERE id=$2",
          [nextOrder, p1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("SET CONSTRAINTS ALL DEFERRED");

        // Participante A (p1Id) passou legitimamente para o fim da fila (posição 2); participante B (p2Id) assumiu posição 1
        const requeuedA = await projectCurrent(user1Id);
        assert.equal(requeuedA?.status, "waiting");
        assert.equal(requeuedA?.externalQueue?.position, 2);
        assert.equal(requeuedA?.externalEntryCall, null);
        const firstB = await projectCurrent(user2Id);
        assert.equal(firstB?.status, "waiting");
        assert.equal(firstB?.externalQueue?.position, 1);
        assert.equal(firstB?.externalEntryCall, null);

        // Resolver participante B (posição 1) seguindo a ordem operacional FIFO antes de chamar A novamente
        await client.query(
          "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
          [callBId, event1Id, p2Id, staffId],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("SET CONSTRAINTS ALL DEFERRED");
        assert.equal((await projectCurrent(user2Id))?.externalEntryCall?.callId, callBId);

        await client.query(
          "UPDATE external_entry_calls SET status='confirmed', resolved_by_user_id=$1, resolved_at=clock_timestamp(), resolution_reason='staff_entry_confirmed' WHERE id=$2",
          [staffId, callBId],
        );
        await client.query(
          "UPDATE participations p SET status='active', arena_entered_at=c.resolved_at FROM external_entry_calls c WHERE p.id=c.participation_id AND c.id=$1",
          [callBId],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("SET CONSTRAINTS ALL DEFERRED");

        assert.equal((await projectCurrent(user2Id))?.status, "active");
        const backToFirstA = await projectCurrent(user1Id);
        assert.equal(backToFirstA?.status, "waiting");
        assert.equal(backToFirstA?.externalQueue?.position, 1);
        assert.equal(backToFirstA?.externalEntryCall, null);

        // Agora A é legitimamente o primeiro da fila FIFO e recebe a nova ocorrência call2Id
        await client.query(
          "INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",
          [call2Id, event1Id, p1Id, staffId],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");

        const secondRef = await captureObservedInstant();
        const secondCurrent = await projectCurrent(user1Id, secondRef.expr);
        const secondDetail = (await projectById(user1Id, p1Id, secondRef.expr))[0];
        assert.deepEqual(secondCurrent, secondDetail);
        assert.equal(secondDetail.externalQueue?.position, 1);
        assert.equal(secondDetail.externalEntryCall?.callId, call2Id);
        assert.notEqual(secondDetail.externalEntryCall?.callId, call1Id);

        // Ocorrência anterior permanece terminal e não reaparece
        const oldCall = (await client.query<{ status: string; resolution_reason: string }>(
          "SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1",
          [call1Id],
        )).rows[0];
        assert.deepEqual(oldCall, { status: "absent", resolution_reason: "staff_external_absent" });
      });

      // 5. Ausência após o corte oficial e antes do prazo operacional (AUD-06.3)
      // Nota explícita: este bloco prepara o estado temporal diretamente em SQL para validar a projeção
      // e a integridade das constraints/triggers da migration 0008; a decisão temporal de StaffEntryCallService
      // (requeued: false após corte) é coberta pela suíte unitária em backend/test/unit/staff-entry-call.test.ts.
      await withScenario("sp_absent_cutoff", async () => {
        // Ajusta janela do evento de forma determinística ancorada em call1.called_at:
        // starts_at <= called_at < official_ends_at (+1s) <= resolved_at (+5m) < operational_deadline_at (+30m)
        await client.query(
          `UPDATE events e
           SET official_ends_at = c.called_at + interval '1 second',
               operational_deadline_at = c.called_at + interval '30 minutes'
           FROM external_entry_calls c
           WHERE e.id = c.event_id AND c.id = $1`,
          [call1Id],
        );
        await client.query(
          `UPDATE external_entry_calls
           SET status='absent',
               resolved_by_user_id=$1,
               resolved_at=called_at + interval '5 minutes',
               resolution_reason='staff_external_absent'
           WHERE id=$2`,
          [staffId, call1Id],
        );
        await client.query(
          `UPDATE participations p
           SET status='finished',
               finished_at=c.resolved_at,
               finish_reason='external_absence_after_entry_cutoff'
           FROM external_entry_calls c
           WHERE p.id=c.participation_id AND c.id=$1`,
          [call1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");

        const windowCheck = (await client.query<{ valid_window: boolean; last_order: string }>(
          `SELECT (e.starts_at <= c.called_at
            AND c.called_at < e.official_ends_at
            AND e.official_ends_at <= c.resolved_at
            AND c.resolved_at < e.operational_deadline_at) AS valid_window,
            e.external_last_order::text AS last_order
           FROM events e JOIN external_entry_calls c ON c.event_id = e.id
           WHERE c.id = $1`,
          [call1Id],
        )).rows[0];
        assert.equal(windowCheck.valid_window, true);
        assert.equal(windowCheck.last_order, "2", "Ausência após corte não reinseriu nem incrementou external_last_order.");

        // Projeta em instante posterior ao corte e ainda anterior ao prazo operacional (+5m01s < +30m)
        const afterCutoffAt = sql`(SELECT resolved_at + interval '1 second' FROM external_entry_calls WHERE id=${call1Id}::uuid)`;
        assert.equal(await projectCurrent(user1Id, afterCutoffAt), null);
        const cutoffDetail = (await projectById(user1Id, p1Id, afterCutoffAt))[0];
        assert.equal(cutoffDetail.status, "finished");
        assert.equal(cutoffDetail.finishReason, "external_absence_after_entry_cutoff");
        assert.equal(cutoffDetail.externalQueue, null);
        assert.equal(cutoffDetail.externalEntryCall, null);

        // Evento ainda está na janela residual: p2Id segue aguardando sem ter sido expirado por operational_deadline_at
        const remainingB = await projectCurrent(user2Id, afterCutoffAt);
        assert.equal(remainingB?.status, "waiting");
        assert.equal(remainingB?.externalQueue?.position, 1);
        assert.equal(remainingB?.externalEntryCall, null);
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

      // 8. Desativação D06 -> libera toda a fila externa do evento e trigger cancela chamada pendente
      await withScenario("sp_d06", async () => {
        await client.query("UPDATE events SET external_queue_enabled=false WHERE id=$1", [event1Id]);
        await client.query(
          "UPDATE participations SET status='active', arena_entered_at=clock_timestamp() WHERE event_id=$1 AND status='waiting'",
          [event1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "external_queue_disabled" });
        const d06User1 = await projectCurrent(user1Id);
        const d06User2 = await projectCurrent(user2Id);
        assert.equal(d06User1?.status, "active");
        assert.equal(d06User1?.externalEntryCall, null);
        assert.equal(d06User2?.status, "active");
        assert.equal(d06User2?.externalEntryCall, null);
      });

      // 9. Encerramento efetivo por prazo operacional vencido antes da regularização física (somente leitura)
      const futureAt = sql`clock_timestamp() + interval '3 hours'`;
      assert.equal(await projectCurrent(user1Id, futureAt), null);
      const endedProjection = (await projectById(user1Id, p1Id, futureAt))[0];
      assert.equal(endedProjection.status, "finished");
      assert.equal(endedProjection.externalQueue, null);
      assert.equal(endedProjection.externalEntryCall, null);

      // 10. Encerramento administrativo controlado -> instante único + trigger cancela chamada pendente e oculta externalEntryCall
      await withScenario("sp_controlled_closure", async () => {
        await client.query(
          `WITH now_at AS (SELECT clock_timestamp() AS at)
           UPDATE events e
           SET status='closing',
               closure_mode='controlled',
               closure_requested_at=now_at.at,
               admin_deadline_at=now_at.at + interval '15 minutes'
           FROM now_at
           WHERE e.id=$1`,
          [event1Id],
        );
        await client.query(
          "UPDATE participations p SET status='finished', finished_at=e.closure_requested_at, finish_reason='admin_controlled_external_wait_closed' FROM events e WHERE p.event_id=e.id AND e.id=$1 AND p.status='waiting'",
          [event1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "admin_controlled_external_wait_closed" });
        assert.equal(await projectCurrent(user1Id), null);
        assert.equal(await projectCurrent(user2Id), null);
        const detail = (await projectById(user1Id, p1Id))[0];
        assert.equal(detail.status, "finished");
        assert.equal(detail.finishReason, "admin_controlled_external_wait_closed");
        assert.equal(detail.externalEntryCall, null);
      });

      // 11. Encerramento administrativo imediato -> instante único + trigger cancela chamada pendente e oculta externalEntryCall
      await withScenario("sp_immediate_closure", async () => {
        await client.query(
          `WITH now_at AS (SELECT clock_timestamp() AS at)
           UPDATE events e
           SET status='closed',
               closure_mode='immediate',
               closure_requested_at=now_at.at,
               admin_deadline_at=now_at.at
           FROM now_at
           WHERE e.id=$1`,
          [event1Id],
        );
        await client.query(
          "UPDATE participations p SET status='finished', finished_at=e.admin_deadline_at, finish_reason='admin_immediate' FROM events e WHERE p.event_id=e.id AND e.id=$1 AND p.status='waiting'",
          [event1Id],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const callRow = (await client.query("SELECT status, resolution_reason FROM external_entry_calls WHERE id=$1", [call1Id])).rows[0];
        assert.deepEqual(callRow, { status: "canceled", resolution_reason: "admin_immediate" });
        assert.equal(await projectCurrent(user1Id), null);
        assert.equal(await projectCurrent(user2Id), null);
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
    assert.equal((await observer.query("SELECT id FROM external_entry_calls WHERE id=ANY($1::uuid[])", [[call1Id, callBId, call2Id]])).rows.length, 0);
  } finally {
    await Promise.allSettled([observer.end(), client.end()]);
  }
});
