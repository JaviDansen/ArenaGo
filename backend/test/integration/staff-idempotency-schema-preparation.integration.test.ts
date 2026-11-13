import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../src/database/schema";
import { completeIdempotencyOperationWithTx, createRequestFingerprint, reserveIdempotencyOperationWithTx } from "../../src/participations/join-idempotency";
import { assertSafeTestDatabase } from "./test-db-guard";

// Campanha separada e autorizada: banco local dedicado, migration já aplicada por responsável.
function dedicatedDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test") throw new Error("NODE_ENV=test é obrigatório.");
  const urls = [process.env.DATABASE_URL, process.env.DATABASE_DIRECT_URL, process.env.EVENTS_TEST_DATABASE_URL]
    .map((value) => assertSafeTestDatabase(value));
  if (!urls.every((value) => value === urls[0])) throw new Error("As três URLs de teste devem identificar o mesmo banco dedicado.");
  const parsed = new URL(urls[0]);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.port !== "55432" ||
      parsed.pathname !== "/arenago_events_test" || parsed.search || parsed.hash) {
    throw new Error("É exigido exclusivamente localhost:55432/arenago_events_test sem parâmetros de conexão.");
  }
  return urls[0];
}

test("preparação PostgreSQL mantém legado e rejeita prova ou compactação prematuras", async () => {
  const client = new Client({ connectionString: dedicatedDatabaseUrl() });
  await client.connect();
  try {
    const identity = await client.query<{ database_name: string; server_port: number }>(
      "SELECT pg_catalog.current_database() AS database_name, pg_catalog.inet_server_port() AS server_port",
    );
    assert.deepEqual(identity.rows[0], { database_name: "arenago_events_test", server_port: 55432 });
    const prepared = await client.query<{ present: boolean }>(
      "SELECT pg_catalog.to_regclass('public.staff_idempotency_epochs') IS NOT NULL AS present",
    );
    assert.equal(prepared.rows[0].present, true, "A migration deve estar previamente aplicada pelo responsável.");
    const rollbackFixture = new Error("ROLLBACK_FIXTURE_ONLY");
    try {
      await drizzle(client, { schema }).transaction(async (tx) => {
        await client.query("SET LOCAL search_path = pg_catalog, public");
        const actor = randomUUID();
        await client.query(
          "INSERT INTO public.users(id,name,email,password_hash,created_at,updated_at) VALUES($1,'Fixture schema',$2,'fixture',now(),now())",
          [actor, `${actor}@example.test`],
        );
        const insert = `INSERT INTO public.idempotency_operations
          (id,actor_user_id,operation,idempotency_key,request_hash,status,created_at,expires_at)
          VALUES($1,$2,$3,$4,$5,'in_progress',now(),now()+interval '1 day')`;
        const ids: string[] = [];
        const operations = ["call_next", "complete_service_session", "absent_service_session", "admin_grant_role", "join"];
        const key = "fixture-shared";
        for (const operation of operations) {
          const requestHash = createRequestFingerprint(operation, { resource: "fixture" });
          const input = { actorUserId: actor, operation, idempotencyKey: key, requestHash, expiresAt: new Date(Date.now() + 86_400_000) };
          const reserved = await reserveIdempotencyOperationWithTx(tx, input);
          assert.equal(reserved.kind, "reserved");
          if (reserved.kind !== "reserved") throw new Error("Reserva da fixture não criada.");
          ids.push(reserved.operationId);
          assert.equal((await reserveIdempotencyOperationWithTx(tx, input)).kind, "in_progress");
          assert.equal((await reserveIdempotencyOperationWithTx(tx, { ...input,
            requestHash: createRequestFingerprint(operation, { resource: "different" }) })).kind, "request_conflict");
          const httpStatus = operation === "call_next" ? 201 : 200;
          const resultReference = randomUUID();
          const resultPayload = { operation, marker: "fixture" };
          const completed = await completeIdempotencyOperationWithTx(tx, reserved.operationId, { httpStatus, resultReference, resultPayload });
          assert.equal(completed.httpStatus, httpStatus);
          assert.deepEqual(completed.resultPayload, resultPayload);
          const replay = await reserveIdempotencyOperationWithTx(tx, input);
          assert.equal(replay.kind, "replay");
          if (replay.kind !== "replay") throw new Error("Replay da fixture ausente.");
          assert.equal(replay.httpStatus, httpStatus);
          assert.equal(replay.resultReference, resultReference);
          assert.deepEqual(replay.resultPayload, resultPayload);
        }
        const legacy = await client.query<{
          origin_assurance: string; origin_session_id: string | null; origin_epoch_id: string | null;
          result_state: string | null; completed_at: Date | null; result_retain_until: Date | null;
        }>(`SELECT origin_assurance,origin_session_id,origin_epoch_id,result_state,completed_at,result_retain_until
            FROM public.idempotency_operations WHERE id=ANY($1::uuid[]) ORDER BY operation`, [ids]);
        assert.equal(legacy.rowCount, operations.length);
        for (const row of legacy.rows) assert.deepEqual(row, { origin_assurance: "legacy", origin_session_id: null,
          origin_epoch_id: null, result_state: null, completed_at: null, result_retain_until: null });

        async function expectDatabaseError(statement: string, params: unknown[], expectedCode: string) {
          await client.query("SAVEPOINT rejected_case");
          try {
            await assert.rejects(client.query(statement, params), (error: unknown) =>
              typeof error === "object" && error !== null && "code" in error && error.code === expectedCode);
          } finally {
            await client.query("ROLLBACK TO SAVEPOINT rejected_case");
            await client.query("RELEASE SAVEPOINT rejected_case");
          }
        }
        await expectDatabaseError(insert, [randomUUID(), actor, operations[0], key, "b".repeat(64)], "23505");
        for (const id of ids.slice(0, 3)) {
          for (const change of [
            "origin_assurance='verified_v1'", "origin_session_id='abcdef00-0000-4000-8000-000000000001'::uuid",
            "origin_epoch_id='abcdef00-0000-4000-8000-000000000002'::uuid", "result_state='tombstone'",
            "completed_at=now()", "result_retain_until=now()",
          ]) await expectDatabaseError(`UPDATE public.idempotency_operations SET ${change} WHERE id=$1`, [id], "23514");
          for (const change of [
            "id='abcdef00-0000-4000-8000-000000000003'::uuid",
            "actor_user_id='abcdef00-0000-4000-8000-000000000004'::uuid", "operation='join'",
            "idempotency_key='alterada'", "request_hash=repeat('b',64)",
            "status='in_progress',http_status=NULL", "http_status=299", "result_reference='abcdef00-0000-4000-8000-000000000005'::uuid",
            "result_payload='{\"alterado\":true}'::jsonb",
          ]) await expectDatabaseError(`UPDATE public.idempotency_operations SET ${change} WHERE id=$1`, [id], "23514");
        }
        await expectDatabaseError("UPDATE public.idempotency_operations SET operation='call_next' WHERE id=$1", [ids[3]], "23514");
        assert.equal((await client.query("UPDATE public.idempotency_operations SET expires_at=now() WHERE id=$1", [ids[0]])).rowCount, 1);
        assert.equal((await client.query("UPDATE public.idempotency_operations SET idempotency_key='admin-alterada' WHERE id=$1", [ids[3]])).rowCount, 1);

        const epoch = randomUUID();
        const pending = await client.query<{ status: string; activated_at: Date | null; invalidated_at: Date | null }>(
          "INSERT INTO public.staff_idempotency_epochs(id,controls_version) VALUES($1,'fixture-v1') RETURNING status,activated_at,invalidated_at", [epoch],
        );
        assert.deepEqual(pending.rows[0], { status: "pending", activated_at: null, invalidated_at: null });
        await expectDatabaseError("UPDATE public.staff_idempotency_epochs SET status='active',activated_at=now() WHERE id=$1", [epoch], "23514");
        await expectDatabaseError("INSERT INTO public.staff_idempotency_epochs(id,controls_version) VALUES($1,'  ')", [randomUUID()], "23514");
        const active = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM public.staff_idempotency_epochs WHERE status <> 'pending' OR activated_at IS NOT NULL OR invalidated_at IS NOT NULL");
        assert.equal(active.rows[0].count, "0");
        throw rollbackFixture;
      }, { isolationLevel: "read committed" });
      assert.fail("A transação da fixture deveria terminar em rollback.");
    } catch (error) {
      if (error !== rollbackFixture) throw error;
    }
  } finally {
    await client.end();
  }
});
