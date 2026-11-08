import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { after, afterEach, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import supertest from "supertest";
import type * as schema from "../../src/database/schema";
import { assertAdminRoleManagementTestDatabaseUrls } from "./admin-role-management-db-guard";

// A guarda é avaliada antes de importar o módulo da aplicação e de abrir escritas.
const connectionString = assertAdminRoleManagementTestDatabaseUrls(process.env);
process.env.DOTENV_CONFIG_PATH = devNull;
process.env.STAFF_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVALUATION_IDEMPOTENCY_TTL_SECONDS = "60";
process.env.EVENT_CLOSURE_JOB_TEST_ENABLED = "false";

const pool = new Pool({ connectionString, application_name: `t61d-roles-${randomUUID()}`, max: 8 });
const ownedUsers = new Set<string>(), ownedEvents = new Set<string>(), ownedExperiences = new Set<string>();
const ownedVersions = new Set<string>(), ownedGames = new Set<string>();
let app: INestApplication;
let signAccessToken: (claims: { userId: string; sessionId: string }) => string;
let participationWriter: import("../../src/participations/participations.service").ParticipationsService;

interface Account { id: string; email: string; sessionId: string; token: string; adminRoleId?: string; staffRoleIds: string[] }
interface AccountOptions { active?: boolean; verified?: boolean; admin?: boolean; admin2fa?: boolean; staffEventId?: string; totp?: boolean }

async function account(options: AccountOptions = {}): Promise<Account> {
  const id = randomUUID(), email = `${id}@example.test`, sessionId = randomUUID();
  await pool.query(`INSERT INTO users(id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
    VALUES($1,'T6.1-D fixture',$2,'fixture-only',CASE WHEN $3::boolean THEN clock_timestamp() ELSE NULL END,$4::boolean,clock_timestamp(),clock_timestamp())`,
  [id, email, options.verified !== false, options.active !== false]);
  ownedUsers.add(id);
  await pool.query(`INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at)
    VALUES($1,$2,'participante',NULL,NULL,clock_timestamp())`, [randomUUID(), id]);
  let adminRoleId: string | undefined;
  if (options.admin) {
    adminRoleId = randomUUID();
    await pool.query(`INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at)
      VALUES($1,$2,'admin',NULL,NULL,clock_timestamp())`, [adminRoleId, id]);
    if (options.totp !== false) await pool.query(`INSERT INTO user_totp_credentials(id,user_id,secret_encrypted,is_verified,verified_at,created_at,updated_at)
      VALUES($1,$2,'integration-fixture-placeholder',true,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [randomUUID(), id]);
  }
  const staffRoleIds: string[] = [];
  if (options.staffEventId) {
    const roleId = randomUUID(); staffRoleIds.push(roleId);
    await pool.query(`INSERT INTO user_roles(id,user_id,role,event_id,granted_by,granted_at)
      VALUES($1,$2,'staff',$3,NULL,clock_timestamp())`, [roleId, id, options.staffEventId]);
  }
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,revoked_at,revocation_reason,admin_2fa_verified_at,created_at)
    VALUES($1,$2,CASE WHEN $3::boolean THEN clock_timestamp()-interval '1 minute' ELSE clock_timestamp()+interval '1 day' END,
      clock_timestamp(),NULL,NULL,CASE WHEN $4::boolean THEN clock_timestamp() ELSE NULL END,clock_timestamp())`,
  [sessionId, id, false, options.admin === true && options.admin2fa !== false]);
  return { id, email, sessionId, token: signAccessToken({ userId: id, sessionId }), adminRoleId, staffRoleIds };
}

async function event(status = "scheduled"): Promise<string> {
  const id = randomUUID(), code = `D-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  await pool.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,
    external_queue_enabled,external_last_order,created_at,updated_at)
    VALUES($1,'T6.1-D fixture',$2,'America/Sao_Paulo',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '4 hours',
    clock_timestamp()+interval '4 hours 30 minutes',$3,true,0,clock_timestamp(),clock_timestamp())`, [id, code, status]);
  ownedEvents.add(id); return id;
}

async function waitingQueue(eventId: string, userId: string): Promise<{ experienceId: string; participationId: string; queueEntryId: string }> {
  const experienceId = randomUUID(), participationId = randomUUID(), queueEntryId = randomUUID();
  await pool.query(`INSERT INTO experiences(id,event_id,name,queue_accepting_entries,last_queue_order,created_at,updated_at)
    VALUES($1,$2,'T6.1-D fixture',true,1,clock_timestamp(),clock_timestamp())`, [experienceId, eventId]);
  ownedExperiences.add(experienceId);
  await pool.query(`INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order,arena_entered_at,finished_at,finish_reason,current_queue_entry_id)
    VALUES($1,$2,$3,'active',clock_timestamp(),1,clock_timestamp(),NULL,NULL,NULL)`, [participationId, userId, eventId]);
  await pool.query(`INSERT INTO queue_entries(id,participation_id,event_id,experience_id,queue_order,status,entered_at,closed_at,close_reason)
    VALUES($1,$2,$3,$4,1,'waiting',clock_timestamp(),NULL,NULL)`, [queueEntryId, participationId, eventId, experienceId]);
  await pool.query("UPDATE participations SET current_queue_entry_id=$2 WHERE id=$1", [participationId, queueEntryId]);
  return { experienceId, participationId, queueEntryId };
}

function send(actor: Account | undefined, path: string, body: object, key: string = randomUUID()) {
  const request = supertest(app.getHttpServer()).post(`/api/v1${path}`).set("Idempotency-Key", key).send(body);
  if (actor) request.set("Authorization", `Bearer ${actor.token}`);
  return request;
}
function grant(actor: Account, body: object, key?: string) { return send(actor, "/admin/roles/grant", body, key); }
function revoke(actor: Account, grantId: string, key?: string) { return send(actor, "/admin/roles/revoke", { grantId }, key); }
function problem(response: { status: number; body: Record<string, unknown> }, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.body)); assert.equal(response.body.code, code);
}

async function simultaneousRoleRequests<T>(start: () => [Promise<T>, Promise<T>]): Promise<[T, T]> {
  const client = await pool.connect();
  let transactionOpen = false;
  let pending: [Promise<T>, Promise<T>] | undefined;
  try {
    await client.query("BEGIN"); transactionOpen = true;
    // Mesmo advisory transaction lock usado pelo serviço: ambas as requisições devem chegar até ele.
    await client.query("SELECT pg_advisory_xact_lock($1::integer,$2::integer)", [0x41524e47, 0x524f4c45]);
    const blocker = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = start();
    const deadline = Date.now() + 8_000;
    let observed = false;
    while (Date.now() < deadline) {
      const blocked = await pool.query<{ count: number }>(`SELECT count(DISTINCT pid)::int AS count FROM pg_stat_activity
        WHERE state='active' AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`, [blocker]);
      if (blocked.rows[0].count === 2) { observed = true; break; }
      if (blocked.rows[0].count > 2) throw new Error("Mais de duas requisições aguardaram o mutex da fixture.");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(observed, true, "As duas requisições não aguardaram simultaneamente o mutex de papéis.");
    await client.query("COMMIT"); transactionOpen = false;
    return await Promise.all(pending);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(rollbackError => { throw new AggregateError([error, rollbackError], "Rollback da sincronização idempotente falhou."); });
    throw error;
  } finally { client.release(); if (pending) await Promise.allSettled(pending); }
}

before(async () => {
  const dbName = await pool.query<{ name: string }>("SELECT current_database() AS name");
  if (dbName.rows[0]?.name !== "arenago_roles_test") throw new Error("[SEGURANÇA BLOQUEADA] Banco de destino incorreto.");
  const required = await pool.query<{ ready: boolean }>(`SELECT bool_and(to_regclass('public.' || name) IS NOT NULL) AS ready
    FROM unnest(ARRAY['users','user_roles','sessions','refresh_tokens','user_totp_credentials','user_backup_codes',
      'totp_activation_tokens','email_verification_tokens','password_reset_tokens','admin_2fa_challenges','audit_logs',
      'idempotency_operations','events','experiences','stations','participations','queue_entries','service_sessions',
      'evaluations','participation_profile_snapshots','profiles','questionnaire_versions','games','user_games']) AS required(name)`);
  if (!required.rows[0]?.ready) throw new Error("[SEGURANÇA BLOQUEADA] Schema/migrations da autenticação e idempotência ausentes.");
  const historicalAdmins = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM user_roles WHERE role='admin'");
  if (historicalAdmins.rows[0]?.count !== 0) throw new Error("[SEGURANÇA BLOQUEADA] A prova do último Admin exige banco dedicado sem Admins preexistentes; nenhum registro será removido.");
  const { AppModule } = await import("../../src/app.module");
  const token = await import("../../src/auth/token.util"); signAccessToken = token.signAccessToken;
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1");
  const { ParticipationsService } = await import("../../src/participations/participations.service");
  participationWriter = app.get(ParticipationsService);
});

afterEach(async () => {
  const users = [...ownedUsers], events = [...ownedEvents];
  if (!users.length && !events.length) return;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN"); transactionOpen = true;
    await client.query(`DELETE FROM audit_logs WHERE actor_user_id=ANY($1::uuid[]) OR target_user_id=ANY($1::uuid[]) OR event_id=ANY($2::uuid[])`, [users, events]);
    await client.query("DELETE FROM idempotency_operations WHERE actor_user_id=ANY($1::uuid[])", [users]);
    await client.query("UPDATE participations SET current_queue_entry_id=NULL WHERE event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM service_sessions s USING queue_entries q WHERE s.queue_entry_id=q.id AND q.event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM queue_entries WHERE event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM evaluations v USING participations p WHERE v.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM participation_profile_snapshots s USING participations p WHERE s.participation_id=p.id AND p.event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM participations WHERE event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM stations s USING experiences x WHERE s.experience_id=x.id AND x.event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM experiences WHERE event_id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[]) OR granted_by=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id=ANY($1::uuid[]))", [users]);
    await client.query("DELETE FROM user_backup_codes WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM user_totp_credentials WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM totp_activation_tokens WHERE user_id=ANY($1::uuid[]) OR issued_by=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM admin_2fa_challenges WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM email_verification_tokens WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM user_games WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM profiles WHERE user_id=ANY($1::uuid[])", [users]);
    await client.query("DELETE FROM events WHERE id=ANY($1::uuid[])", [events]);
    await client.query("DELETE FROM games WHERE id=ANY($1::uuid[])", [[...ownedGames]]);
    await client.query("DELETE FROM questionnaire_versions WHERE id=ANY($1::uuid[])", [[...ownedVersions]]);
    await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await client.query("COMMIT"); transactionOpen = false;
    ownedUsers.clear(); ownedEvents.clear(); ownedExperiences.clear(); ownedVersions.clear(); ownedGames.clear();
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(cleanupError => { throw new AggregateError([error, cleanupError], "Rollback da limpeza falhou."); });
    throw error;
  } finally { client.release(); }
});

after(async () => {
  const errors: unknown[] = [];
  try { await app?.close(); } catch (error) { errors.push(error); }
  try { await pool.end(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, "Encerramento da integração T6.1-D falhou.");
});

test("T6.1-D PostgreSQL concede Admin global com email normalizado sem remover papel participante", async () => {
  const admin = await account({ admin: true }), target = await account();
  const sessionsBefore = (await pool.query("SELECT * FROM sessions WHERE user_id=$1 ORDER BY id", [target.id])).rows;
  const response = await grant(admin, { role: "admin", email: ` ${target.email.toUpperCase()} ` });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.grant.role, "admin"); assert.equal(response.body.grant.eventId, null);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='participante' AND revoked_at IS NULL", [target.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_totp_credentials WHERE user_id=$1", [target.id])).rows[0].n, 0);
  assert.deepEqual((await pool.query("SELECT * FROM sessions WHERE user_id=$1 ORDER BY id", [target.id])).rows, sessionsBefore);
});

test("T6.1-D PostgreSQL concede Staff ao evento e registra autor e instante na mesma operação", async () => {
  const admin = await account({ admin: true }), target = await account(), eventId = await event();
  const response = await grant(admin, { role: "staff", email: target.email, eventId });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const stored = await pool.query(`SELECT r.granted_by=r2.user_id AS actor_ok,r.granted_at=a.occurred_at AS same_time,
      a.target_user_id=r.user_id AND a.event_id=r.event_id AS target_ok,a.action,a.metadata
    FROM user_roles r JOIN user_roles r2 ON r2.user_id=$2 AND r2.role='admin' AND r2.revoked_at IS NULL
    JOIN audit_logs a ON a.actor_user_id=r.granted_by AND a.target_user_id=r.user_id AND a.event_id=r.event_id AND a.action='admin_role_granted'
    WHERE r.id=$1`, [response.body.grant.id, admin.id]);
  assert.equal(stored.rowCount, 1); assert.equal(stored.rows[0].actor_ok, true); assert.equal(stored.rows[0].same_time, true); assert.equal(stored.rows[0].target_ok, true);
  assert.deepEqual(stored.rows[0].metadata, { grantId: response.body.grant.id, role: "staff" });
});

test("T6.1-D PostgreSQL recusa destinatário inexistente", async () => {
  problem(await grant(await account({ admin: true }), { role: "admin", email: `${randomUUID()}@example.test` }), 404, "RESOURCE_NOT_FOUND");
});
test("T6.1-D PostgreSQL recusa conta destinatária inativa", async () => {
  const admin = await account({ admin: true }), target = await account({ active: false });
  problem(await grant(admin, { role: "admin", email: target.email }), 422, "ROLE_TARGET_INELIGIBLE");
});
test("T6.1-D PostgreSQL recusa e-mail destinatário não verificado", async () => {
  const admin = await account({ admin: true }), target = await account({ verified: false });
  problem(await grant(admin, { role: "staff", email: target.email, eventId: await event() }), 422, "ROLE_TARGET_INELIGIBLE");
});
test("T6.1-D PostgreSQL recusa evento inexistente sem gravar concessão", async () => {
  const admin = await account({ admin: true }), target = await account(), eventId = randomUUID();
  problem(await grant(admin, { role: "staff", email: target.email, eventId }), 404, "RESOURCE_NOT_FOUND");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='staff'", [target.id])).rows[0].n, 0);
});
test("T6.1-D PostgreSQL rejeita payload, escopo e campos extras inválidos", async () => {
  const admin = await account({ admin: true }), eventId = await event();
  for (const body of [{ role: "admin", email: "person@example.test", eventId }, { role: "staff", email: "person@example.test" },
    { role: "participante", email: "person@example.test" }, { role: "staff", email: "person@example.test", eventId, grantedBy: admin.id }]) {
    assert.equal((await grant(admin, body)).status, 400);
  }
});
test("T6.1-D PostgreSQL exige Admin global e recusa Staff", async () => {
  const eventId = await event(), staff = await account({ staffEventId: eventId }), target = await account();
  problem(await grant(staff, { role: "admin", email: target.email }), 403, "ADMIN_REQUIRED");
});
test("T6.1-D PostgreSQL exige autenticação", async () => {
  problem(await send(undefined, "/admin/roles/grant", { role: "admin", email: "person@example.test" }), 401, "MISSING_ACCESS_TOKEN");
});
test("T6.1-D PostgreSQL exige segundo fator persistido na sessão Admin", async () => {
  const admin = await account({ admin: true, admin2fa: false }), target = await account();
  problem(await grant(admin, { role: "admin", email: target.email }), 401, "ADMIN_2FA_REQUIRED");
});
test("T6.1-D PostgreSQL revalida sessão revogada", async () => {
  const admin = await account({ admin: true }), target = await account();
  await pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [admin.sessionId]);
  problem(await grant(admin, { role: "admin", email: target.email }), 401, "SESSION_REVOKED");
});
test("T6.1-D PostgreSQL revalida sessão expirada", async () => {
  const admin = await account({ admin: true }), target = await account();
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [admin.sessionId]);
  problem(await grant(admin, { role: "admin", email: target.email }), 401, "SESSION_EXPIRED");
});
test("T6.1-D PostgreSQL revalida conta Admin inativa", async () => {
  const admin = await account({ admin: true }), target = await account();
  await pool.query("UPDATE users SET is_active=false WHERE id=$1", [admin.id]);
  problem(await grant(admin, { role: "admin", email: target.email }), 401, "ACCOUNT_DEACTIVATED");
});
test("T6.1-D PostgreSQL revalida e-mail do ator Admin", async () => {
  const admin = await account({ admin: true }), target = await account();
  await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [admin.id]);
  problem(await grant(admin, { role: "admin", email: target.email }), 403, "ADMIN_EMAIL_UNVERIFIED");
});
test("T6.1-D PostgreSQL evita concessão duplicada", async () => {
  const admin = await account({ admin: true }), target = await account();
  const body = { role: "admin", email: target.email };
  assert.equal((await grant(admin, body)).status, 201); problem(await grant(admin, body), 409, "ROLE_ALREADY_GRANTED");
});
test("T6.1-D PostgreSQL replay não duplica papel nem auditoria", async () => {
  const admin = await account({ admin: true }), target = await account(), key = randomUUID(), body = { role: "admin", email: target.email };
  const first = await grant(admin, body, key), second = await grant(admin, body, key);
  assert.equal(first.status, 201); assert.deepEqual(second.body, first.body);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin' AND revoked_at IS NULL", [target.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='admin_role_granted' AND target_user_id=$1", [target.id])).rows[0].n, 1);
});
test("T6.1-D PostgreSQL concessões simultâneas com a mesma chave têm um único efeito", async () => {
  const admin = await account({ admin: true }), target = await account(), key = randomUUID();
  const body = { role: "admin", email: target.email };
  const responses = await simultaneousRoleRequests(() => [
    Promise.resolve(grant(admin, body, key).timeout({ response: 12_000, deadline: 20_000 })),
    Promise.resolve(grant(admin, body, key).timeout({ response: 12_000, deadline: 20_000 })),
  ]);
  for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.deepEqual(responses[0].body, responses[1].body);
  const grantId = responses[0].body.grant.id;
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM user_roles
    WHERE user_id=$1 AND role='admin' AND event_id IS NULL AND revoked_at IS NULL AND id=$2`, [target.id, grantId])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin'", [target.id])).rows[0].n, 1);
  const audits = await pool.query<{ n: number; linked: boolean }>(`SELECT count(*)::int AS n,
    bool_and(metadata->>'grantId'=$2) AS linked FROM audit_logs
    WHERE action='admin_role_granted' AND target_user_id=$1`, [target.id, grantId]);
  assert.equal(audits.rows[0].n, 1); assert.equal(audits.rows[0].linked, true);
  const intents = await pool.query<{ n: number; completed: boolean }>(`SELECT count(*)::int AS n,
    bool_and(status='completed' AND result_reference=$3) AS completed FROM idempotency_operations
    WHERE actor_user_id=$1 AND operation='admin_grant_role' AND idempotency_key=$2`, [admin.id, key, grantId]);
  assert.equal(intents.rows[0].n, 1); assert.equal(intents.rows[0].completed, true);
});

test("T6.1-D PostgreSQL falha após SQL atômico de concessão/auditoria faz rollback integral e permite retry", async () => {
  const admin = await account({ admin: true }), target = await account(), key = randomUUID();
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { AdminRoleManagementService } = await import("../../src/auth/admin-role-management.service");
  const database = app.get(DRIZZLE_DATABASE) as NodePgDatabase<typeof schema>;
  const transaction = database.transaction.bind(database);
  const faulted = new Proxy(database, {
    get(targetDatabase, property, receiver) {
      if (property === "transaction") {
        return (work: (tx: unknown) => Promise<unknown>, config?: unknown) => transaction(async tx => {
          const wrapped = new Proxy(tx, {
            get(targetTx, txProperty, txReceiver) {
              if (txProperty === "execute") return async (statement: SQL) => {
                const result = await targetTx.execute(statement);
                if (new PgDialect().sqlToQuery(statement).sql.includes("admin_role_granted")) {
                  throw new Error("injected failure after role and audit SQL");
                }
                return result;
              };
              const value = Reflect.get(targetTx, txProperty, txReceiver);
              return typeof value === "function" ? value.bind(targetTx) : value;
            },
          });
          return work(wrapped);
        }, config as never);
      }
      const value = Reflect.get(targetDatabase, property, receiver);
      return typeof value === "function" ? value.bind(targetDatabase) : value;
    },
  }) as unknown as NodePgDatabase<typeof schema>;
  const service = new AdminRoleManagementService(faulted);
  await assert.rejects(service.grant({ userId: admin.id, sessionId: admin.sessionId,
    body: { role: "admin", email: target.email }, idempotencyKey: key, expiresAt: new Date(Date.now() + 60_000) }),
  /injected failure/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin'", [target.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='admin_role_granted' AND target_user_id=$1", [target.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [admin.id, key])).rows[0].n, 0);
  assert.equal((await grant(admin, { role: "admin", email: target.email }, key)).status, 201);
});

test("T6.1-D PostgreSQL resposta incerta após COMMIT é recuperada pelo replay idempotente", async () => {
  const admin = await account({ admin: true }), target = await account(), key = randomUUID();
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { AdminRoleManagementService } = await import("../../src/auth/admin-role-management.service");
  const database = app.get(DRIZZLE_DATABASE) as NodePgDatabase<typeof schema>;
  const committedThenLost = new Proxy(database, {
    get(targetDatabase, property, receiver) {
      if (property === "transaction") {
        const run = Reflect.get(targetDatabase, property, targetDatabase).bind(targetDatabase) as (...args: unknown[]) => Promise<unknown>;
        return (...args: unknown[]) => run(...args).then(() => { throw new Error("injected lost COMMIT acknowledgement"); });
      }
      const value = Reflect.get(targetDatabase, property, receiver);
      return typeof value === "function" ? value.bind(targetDatabase) : value;
    },
  }) as unknown as NodePgDatabase<typeof schema>;
  const service = new AdminRoleManagementService(committedThenLost);
  await assert.rejects(service.grant({ userId: admin.id, sessionId: admin.sessionId,
    body: { role: "admin", email: target.email }, idempotencyKey: key, expiresAt: new Date(Date.now() + 60_000) }), /lost COMMIT acknowledgement/);
  const stored = await pool.query(`SELECT r.id,a.id AS audit_id,i.id AS intent_id FROM user_roles r
    JOIN audit_logs a ON a.action='admin_role_granted' AND a.target_user_id=r.user_id
    JOIN idempotency_operations i ON i.actor_user_id=$2 AND i.operation='admin_grant_role' AND i.idempotency_key=$3
    WHERE r.user_id=$1 AND r.role='admin' AND r.revoked_at IS NULL`, [target.id, admin.id, key]);
  assert.equal(stored.rowCount, 1);
  const replay = await grant(admin, { role: "admin", email: target.email }, key);
  assert.equal(replay.status, 201); assert.equal(replay.body.grant.id, stored.rows[0].id);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='admin_role_granted' AND target_user_id=$1", [target.id])).rows[0].n, 1);
});

test("T6.1-D PostgreSQL falha no limite transacional antes de COMMIT reverte todas as escritas", async () => {
  const admin = await account({ admin: true }), target = await account(), key = randomUUID();
  const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
  const { AdminRoleManagementService } = await import("../../src/auth/admin-role-management.service");
  const database = app.get(DRIZZLE_DATABASE) as NodePgDatabase<typeof schema>;
  const transaction = database.transaction.bind(database);
  const failingBeforeCommit = new Proxy(database, {
    get(databaseTarget, property, receiver) {
      if (property === "transaction") return (work: (tx: unknown) => Promise<unknown>, config?: unknown) => transaction(async tx => {
        await work(tx);
        throw new Error("injected failure before COMMIT");
      }, config as never);
      const value = Reflect.get(databaseTarget, property, receiver);
      return typeof value === "function" ? value.bind(databaseTarget) : value;
    },
  }) as unknown as NodePgDatabase<typeof schema>;
  const service = new AdminRoleManagementService(failingBeforeCommit);
  await assert.rejects(service.grant({ userId: admin.id, sessionId: admin.sessionId, body: { role: "admin", email: target.email },
    idempotencyKey: key, expiresAt: new Date(Date.now() + 60_000) }), /failure before COMMIT/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin'", [target.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE target_user_id=$1", [target.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [admin.id, key])).rows[0].n, 0);
  assert.equal((await grant(admin, { role: "admin", email: target.email }, key)).status, 201);
});

for (const operation of ["grant", "revoke"] as const) {
  for (const fault of ["audit", "sql-after-write"] as const) {
    test(`T6.1-D PostgreSQL ${operation}: erro PostgreSQL real em ${fault} reverte papel, auditoria e intenção e permite retry`, async () => {
      const admin = await account({ admin: true }), target = await account(), eventId = await event(), key = randomUUID();
      const body = { role: "staff" as const, email: target.email, eventId };
      const previous = operation === "revoke" ? await grant(admin, body) : undefined;
      if (previous) assert.equal(previous.status, 201);
      const { DRIZZLE_DATABASE } = await import("../../src/database/database.module");
      const { AdminRoleManagementService } = await import("../../src/auth/admin-role-management.service");
      const database = app.get(DRIZZLE_DATABASE) as NodePgDatabase<typeof schema>;
      const transaction = database.transaction.bind(database);
      const instrumented = new Proxy(database, {
        get(databaseTarget, property, receiver) {
          if (property === "transaction") return (work: (tx: unknown) => Promise<unknown>, config?: unknown) => transaction(async tx => {
            const wrapped = new Proxy(tx, {
              get(txTarget, txProperty, txReceiver) {
                if (txProperty === "execute") return async (statement: SQL) => {
                  const query = new PgDialect().sqlToQuery(statement);
                  const action = operation === "grant" ? "admin_role_granted" : "admin_role_revoked";
                  if (!query.sql.includes(action)) return txTarget.execute(statement);
                  if (fault === "audit") {
                    // Mantém o CTE real de papel e seus parâmetros; apenas o id obrigatório da auditoria vira NULL.
                    // O INSERT/UPDATE de papel alimenta a auditoria, cuja constraint provoca 23502 e rollback.
                    const invalidAudit = query.sql.replace(/(INSERT INTO audit_logs[\s\S]*?SELECT )\$\d+::uuid/, "$1NULL::uuid");
                    assert.notEqual(invalidAudit, query.sql, "A instrumentação deve interceptar o INSERT de auditoria real.");
                    const chunks = invalidAudit.split(/(\$\d+)/).map(chunk => /^\$\d+$/.test(chunk)
                      ? sql`${query.params[Number(chunk.slice(1)) - 1]}` : sql.raw(chunk));
                    return txTarget.execute(sql.join(chunks, sql.raw("")));
                  }
                  const result = await txTarget.execute(statement);
                  await txTarget.execute(sql`SELECT 1 / 0`);
                  return result;
                };
                const value = Reflect.get(txTarget, txProperty, txReceiver);
                return typeof value === "function" ? value.bind(txTarget) : value;
              },
            });
            return work(wrapped);
          }, config as never);
          const value = Reflect.get(databaseTarget, property, receiver);
          return typeof value === "function" ? value.bind(databaseTarget) : value;
        },
      }) as unknown as NodePgDatabase<typeof schema>;
      const service = new AdminRoleManagementService(instrumented);
      const actorInput = { userId: admin.id, sessionId: admin.sessionId, idempotencyKey: key, expiresAt: new Date(Date.now() + 60_000) };
      const mutation = operation === "grant" ? service.grant({ ...actorInput, body }) : service.revoke({ ...actorInput, grantId: previous!.body.grant.id });
      await assert.rejects(mutation, (error: unknown) => {
        let current = error;
        while (current && typeof current === "object") {
          if ("code" in current && current.code === (fault === "audit" ? "23502" : "22012")) return true;
          current = "cause" in current ? current.cause : undefined;
        }
        return false;
      });
      const roles = await pool.query("SELECT revoked_at FROM user_roles WHERE user_id=$1 AND role='staff' AND event_id=$2", [target.id, eventId]);
      assert.equal(roles.rowCount, operation === "grant" ? 0 : 1);
      if (operation === "revoke") assert.equal(roles.rows[0].revoked_at, null);
      const action = operation === "grant" ? "admin_role_granted" : "admin_role_revoked";
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action=$1 AND target_user_id=$2", [action, target.id])).rows[0].n, 0);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM idempotency_operations WHERE actor_user_id=$1 AND idempotency_key=$2", [admin.id, key])).rows[0].n, 0);
      const retry = operation === "grant" ? await grant(admin, body, key) : await revoke(admin, previous!.body.grant.id, key);
      assert.equal(retry.status, operation === "grant" ? 201 : 200);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action=$1 AND target_user_id=$2", [action, target.id])).rows[0].n, 1);
    });
  }
}
test("T6.1-D PostgreSQL conflito de chave idempotente não aplica outra operação", async () => {
  const admin = await account({ admin: true }), first = await account(), second = await account(), key = randomUUID();
  assert.equal((await grant(admin, { role: "admin", email: first.email }, key)).status, 201);
  problem(await grant(admin, { role: "admin", email: second.email }, key), 409, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin' AND revoked_at IS NULL", [second.id])).rows[0].n, 0);
});
test("T6.1-D PostgreSQL serializa concessões concorrentes iguais", async () => {
  const admin = await account({ admin: true }), target = await account(), body = { role: "admin", email: target.email };
  const responses = await Promise.all([grant(admin, body), grant(admin, body)]);
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin' AND revoked_at IS NULL", [target.id])).rows[0].n, 1);
});
test("T6.1-D PostgreSQL revoga Staff logicamente, audita e preserva sessão", async () => {
  const admin = await account({ admin: true }), target = await account(), eventId = await event();
  const created = await grant(admin, { role: "staff", email: target.email, eventId }); assert.equal(created.status, 201);
  const response = await revoke(admin, created.body.grant.id); assert.equal(response.status, 200, JSON.stringify(response.body));
  const row = await pool.query(`SELECT r.revoked_at IS NOT NULL AS revoked,r.revoked_by=$2 AS actor_ok,
      a.occurred_at=r.revoked_at AS audit_time,a.target_user_id=r.user_id AS target_ok
    FROM user_roles r JOIN audit_logs a ON a.action='admin_role_revoked' AND a.actor_user_id=$2 AND a.target_user_id=r.user_id AND a.event_id=r.event_id
    WHERE r.id=$1`, [created.body.grant.id, admin.id]);
  assert.equal(row.rowCount, 1); assert.equal(row.rows[0].revoked, true); assert.equal(row.rows[0].actor_ok, true);
  assert.equal(row.rows[0].audit_time, true); assert.equal(row.rows[0].target_ok, true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [target.id])).rows[0].n, 1);
});
test("T6.1-D PostgreSQL replay de revogação não duplica auditoria", async () => {
  const admin = await account({ admin: true }), target = await account(), eventId = await event();
  const created = await grant(admin, { role: "staff", email: target.email, eventId }); const key = randomUUID();
  const first = await revoke(admin, created.body.grant.id, key), second = await revoke(admin, created.body.grant.id, key);
  assert.equal(first.status, 200); assert.deepEqual(second.body, first.body);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='admin_role_revoked' AND target_user_id=$1", [target.id])).rows[0].n, 1);
});
test("T6.1-D PostgreSQL revogações simultâneas com a mesma chave têm um único efeito", async () => {
  const admin = await account({ admin: true }), target = await account(), key = randomUUID();
  const created = await grant(admin, { role: "admin", email: target.email });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const grantId = created.body.grant.id;
  const responses = await simultaneousRoleRequests(() => [
    Promise.resolve(revoke(admin, grantId, key).timeout({ response: 12_000, deadline: 20_000 })),
    Promise.resolve(revoke(admin, grantId, key).timeout({ response: 12_000, deadline: 20_000 })),
  ]);
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(responses[0].body, responses[1].body);
  assert.equal(responses[0].body.grant.id, grantId);
  assert.notEqual(responses[0].body.grant.revokedAt, null);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM user_roles
    WHERE id=$1 AND user_id=$2 AND role='admin' AND event_id IS NULL AND revoked_at IS NOT NULL`, [grantId, target.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role='admin'", [target.id])).rows[0].n, 1);
  const audits = await pool.query<{ n: number; linked: boolean }>(`SELECT count(*)::int AS n,
    bool_and(metadata->>'grantId'=$2) AS linked FROM audit_logs
    WHERE action='admin_role_revoked' AND target_user_id=$1`, [target.id, grantId]);
  assert.equal(audits.rows[0].n, 1); assert.equal(audits.rows[0].linked, true);
  const intents = await pool.query<{ n: number; completed: boolean }>(`SELECT count(*)::int AS n,
    bool_and(status='completed' AND result_reference=$3) AS completed FROM idempotency_operations
    WHERE actor_user_id=$1 AND operation='admin_revoke_role' AND idempotency_key=$2`, [admin.id, key, grantId]);
  assert.equal(intents.rows[0].n, 1); assert.equal(intents.rows[0].completed, true);
});
test("T6.1-D PostgreSQL revogação repetida com nova chave não duplica efeitos", async () => {
  const admin = await account({ admin: true }), target = await account(), created = await grant(admin, { role: "admin", email: target.email });
  await pool.query("INSERT INTO user_totp_credentials(id,user_id,secret_encrypted,is_verified,verified_at,created_at,updated_at) VALUES($1,$2,'fixture',true,clock_timestamp(),clock_timestamp(),clock_timestamp())", [randomUUID(), target.id]);
  assert.equal((await revoke(admin, created.body.grant.id)).status, 200);
  problem(await revoke(admin, created.body.grant.id), 404, "RESOURCE_NOT_FOUND");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='admin_role_revoked' AND target_user_id=$1", [target.id])).rows[0].n, 1);
});
test("T6.1-D PostgreSQL não revoga papel participante", async () => {
  const admin = await account({ admin: true }), target = await account();
  const participantRole = await pool.query<{ id: string }>("SELECT id FROM user_roles WHERE user_id=$1 AND role='participante'", [target.id]);
  problem(await revoke(admin, participantRole.rows[0].id), 404, "RESOURCE_NOT_FOUND");
  assert.equal((await pool.query("SELECT revoked_at FROM user_roles WHERE id=$1", [participantRole.rows[0].id])).rows[0].revoked_at, null);
});
test("T6.1-D PostgreSQL recusa concessão ausente", async () => {
  problem(await revoke(await account({ admin: true }), randomUUID()), 404, "RESOURCE_NOT_FOUND");
});
test("T6.1-D PostgreSQL protege a revogação do último Admin com TOTP", async () => {
  const admin = await account({ admin: true });
  problem(await revoke(admin, admin.adminRoleId!), 409, "LAST_ADMIN_REQUIRED");
  assert.equal((await pool.query("SELECT revoked_at FROM user_roles WHERE id=$1", [admin.adminRoleId])).rows[0].revoked_at, null);
});
test("T6.1-D PostgreSQL permite autorrevogação quando outro Admin viável permanece", async () => {
  const admin = await account({ admin: true }), second = await account({ admin: true });
  assert.equal((await revoke(admin, admin.adminRoleId!)).status, 200);
  assert.equal((await pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM user_roles WHERE id=$1", [admin.adminRoleId])).rows[0].revoked, true);
  assert.equal((await pool.query("SELECT revoked_at FROM user_roles WHERE id=$1", [second.adminRoleId])).rows[0].revoked_at, null);
});
test("T6.1-D PostgreSQL revogações concorrentes de Admin não removem a última autoridade viável", async () => {
  const first = await account({ admin: true }), second = await account({ admin: true });
  const responses = await Promise.all([revoke(first, first.adminRoleId!), revoke(second, second.adminRoleId!)]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 1);
  problem(responses.find(response => response.status === 409)!, 409, "LAST_ADMIN_REQUIRED");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM user_roles r JOIN users u ON u.id=r.user_id
    JOIN user_totp_credentials t ON t.user_id=u.id WHERE r.role='admin' AND r.event_id IS NULL AND r.revoked_at IS NULL
      AND u.is_active AND u.email_verified_at IS NOT NULL AND t.is_verified`)).rows[0].n, 1);
});
test("T6.1-D PostgreSQL permite revogar Admin já sem TOTP sem retirar o último Admin viável", async () => {
  const admin = await account({ admin: true }), target = await account({ admin: true, totp: false });
  assert.equal((await revoke(admin, target.adminRoleId!)).status, 200);
});
test("T6.1-D PostgreSQL efeito da revogação Admin é imediato no endpoint protegido", async () => {
  const admin = await account({ admin: true }), second = await account({ admin: true }), target = await account();
  assert.equal((await revoke(admin, admin.adminRoleId!)).status, 200);
  problem(await grant(admin, { role: "admin", email: target.email }), 403, "ADMIN_REQUIRED");
  assert.equal((await pool.query("SELECT revoked_at FROM user_roles WHERE id=$1", [second.adminRoleId])).rows[0].revoked_at, null);
});
test("T6.1-D PostgreSQL permite revogar o último Staff sem encerrar evento", async () => {
  const admin = await account({ admin: true }), eventId = await event("open"), staff = await account();
  const experienceId = randomUUID(); ownedExperiences.add(experienceId);
  await pool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'Prontidão T6.1-D',clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Estação T6.1-D','available',clock_timestamp(),clock_timestamp())", [randomUUID(), experienceId]);
  const { EventsService } = await import("../../src/events/events.service");
  const eventsService = app.get(EventsService);
  const created = await grant(admin, { role: "staff", email: staff.email, eventId });
  const ready = await eventsService.evaluateEventAvailabilityById(eventId, new Date());
  assert.ok(ready.eventExists); assert.equal(ready.eventAcceptingNewEntries, true);
  assert.equal((await revoke(admin, created.body.grant.id)).status, 200);
  assert.equal((await pool.query("SELECT status FROM events WHERE id=$1", [eventId])).rows[0].status, "open");
  const unavailable = await eventsService.evaluateEventAvailabilityById(eventId, new Date());
  assert.ok(unavailable.eventExists); assert.equal(unavailable.eventAcceptingNewEntries, false);
  assert.deepEqual(unavailable.missing, ["EVENT_HAS_NO_AUTHORIZED_STAFF"]);
  const admission = await participationWriter.createParticipation({ userId: staff.id, eventId,
    idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });
  assert.equal(admission.kind, "blocked");
  if (admission.kind !== "blocked") assert.fail("Nenhuma admissão é permitida sem Staff apto.");
  assert.ok(admission.eligibility.blockingReasons.includes("EVENT_NOT_READY"));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM participations WHERE event_id=$1", [eventId])).rows[0].n, 0);
  assert.equal((await grant(admin, { role: "staff", email: staff.email, eventId })).status, 201);
  const restored = await eventsService.evaluateEventAvailabilityById(eventId, new Date());
  assert.ok(restored.eventExists); assert.equal(restored.eventAcceptingNewEntries, true);
});
test("T6.1-D PostgreSQL revogar Staff preserva participação e entrada waiting", async () => {
  const admin = await account({ admin: true }), staff = await account(), eventId = await event("open");
  const queue = await waitingQueue(eventId, staff.id);
  const created = await grant(admin, { role: "staff", email: staff.email, eventId });
  assert.equal((await revoke(admin, created.body.grant.id)).status, 200);
  const state = await pool.query(`SELECT p.status AS participation_status,p.current_queue_entry_id=q.id AS pointer_ok,
      q.status AS queue_status,q.event_id=p.event_id AS event_ok FROM participations p JOIN queue_entries q ON q.id=$2
    WHERE p.id=$1`, [queue.participationId, queue.queueEntryId]);
  assert.deepEqual(state.rows[0], { participation_status: "active", pointer_ok: true, queue_status: "waiting", event_ok: true });
});

async function prepareStaffAdmissionRace() {
  const admin = await account({ admin: true }), staff = await account(), entrant = await account(), eventId = await event("open");
  const experienceId = randomUUID(), stationId = randomUUID(), versionId = randomUUID(), gameId = randomUUID();
  ownedExperiences.add(experienceId); ownedVersions.add(versionId); ownedGames.add(gameId);
  await pool.query("INSERT INTO experiences(id,event_id,name,created_at,updated_at) VALUES($1,$2,'Concor. T6.1-D',clock_timestamp(),clock_timestamp())", [experienceId, eventId]);
  await pool.query("INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at) VALUES($1,$2,'Estação T6.1-D','available',clock_timestamp(),clock_timestamp())", [stationId, experienceId]);
  await pool.query("INSERT INTO questionnaire_versions(id,version,definition,activated_at,created_at) VALUES($1,$2,'{}',clock_timestamp(),clock_timestamp())", [versionId, `d-${versionId}`]);
  await pool.query(`INSERT INTO profiles(user_id,birth_date,gender,education,market_knowledge,market_interest,questionnaire_version_id,completed_at,created_at,updated_at)
    VALUES($1,'2000-01-01','Prefiro não informar','Superior','Sim, conheço.','Sim, tenho interesse.',$2,clock_timestamp(),clock_timestamp(),clock_timestamp())`, [entrant.id, versionId]);
  await pool.query("INSERT INTO games(id,name,is_curated,created_at) VALUES($1,$2,false,clock_timestamp())", [gameId, `T61D-${gameId}`]);
  await pool.query("INSERT INTO user_games(user_id,game_id,created_at) VALUES($1,$2,clock_timestamp())", [entrant.id, gameId]);
  const created = await grant(admin, { role: "staff", email: staff.email, eventId });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { admin, entrant, eventId, grantId: created.body.grant.id as string };
}

async function waitForEventLockWaiter(blockerPid: number): Promise<number> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
      WHERE state='active' AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`, [blockerPid]);
    if (blocked.rows.length === 1) return blocked.rows[0].pid;
    if (blocked.rows.length > 1) throw new Error("Mais de uma transação aguardou o mesmo bloqueador na prova de ordem.");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("A ordem de espera pelo lock do evento não foi observada no prazo.");
}

async function orderedStaffAdmissionRace(first: "revoke" | "admission") {
  const { admin, entrant, eventId, grantId } = await prepareStaffAdmissionRace();
  const client = await pool.connect();
  let transactionOpen = false;
  const pending: Promise<unknown>[] = [];
  try {
    await client.query("BEGIN"); transactionOpen = true;
    await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
    const blocker = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const startAdmission = () => {
      const joining = participationWriter.createParticipation({ userId: entrant.id, eventId,
        idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });
      pending.push(joining); joining.catch(() => undefined);
      return joining;
    };
    const startRevocation = () => {
      const revoking = Promise.resolve(revoke(admin, grantId).timeout({ response: 12_000, deadline: 20_000 }));
      pending.push(revoking); revoking.catch(() => undefined);
      return revoking;
    };
    let joining: ReturnType<typeof startAdmission>;
    let revoking: ReturnType<typeof startRevocation>;
    if (first === "revoke") {
      revoking = startRevocation();
      const revokePid = await waitForEventLockWaiter(blocker);
      joining = startAdmission();
      const admissionPid = await waitForEventLockWaiter(revokePid);
      assert.notEqual(admissionPid, blocker);
    } else {
      joining = startAdmission();
      const admissionPid = await waitForEventLockWaiter(blocker);
      revoking = startRevocation();
      const revokePid = await waitForEventLockWaiter(admissionPid);
      assert.notEqual(revokePid, blocker);
    }
    await client.query("COMMIT"); transactionOpen = false;
    const [admission, response] = await Promise.all([joining, revoking]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal((await pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM user_roles WHERE id=$1", [grantId])).rows[0].revoked, true);
    return { admission, entrant, eventId, grantId };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(rollbackError => { throw new AggregateError([error, rollbackError], "Rollback da fixture concorrente falhou."); });
    throw error;
  } finally { client.release(); await Promise.allSettled(pending); }
}

test("T6.1-D PostgreSQL revogação Staff confirmada primeiro bloqueia admissão posterior", async () => {
  const { admission, entrant, eventId } = await orderedStaffAdmissionRace("revoke");
  assert.equal(admission.kind, "blocked");
  if (admission.kind !== "blocked") assert.fail("A admissão posterior à revogação não pode ser criada.");
  assert.ok(admission.eligibility.blockingReasons.includes("EVENT_NOT_READY"));
  const { EventsService } = await import("../../src/events/events.service");
  const availability = await app.get(EventsService).evaluateEventAvailabilityById(eventId, new Date());
  if (!availability.eventExists) assert.fail("O evento da fixture deve existir ao verificar a causa da indisponibilidade.");
  assert.deepEqual(availability.missing, ["EVENT_HAS_NO_AUTHORIZED_STAFF"]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM participations WHERE user_id=$1 AND event_id=$2", [entrant.id, eventId])).rows[0].n, 0);
});

test("T6.1-D PostgreSQL ingresso decidido primeiro é preservado após revogação Staff", async () => {
  const { admission, entrant, eventId, grantId } = await orderedStaffAdmissionRace("admission");
  assert.equal(admission.kind, "created");
  if (admission.kind !== "created") assert.fail("A admissão anterior à revogação deve ser criada.");
  const persisted = await pool.query<{ count: number; ordered: boolean }>(`SELECT count(*)::int AS count,
    bool_and(p.joined_at <= r.revoked_at) AS ordered FROM participations p CROSS JOIN user_roles r
    WHERE p.id=$1 AND p.user_id=$2 AND p.event_id=$3 AND r.id=$4`,
  [admission.participationId, entrant.id, eventId, grantId]);
  assert.equal(persisted.rows[0].count, 1);
  assert.equal(persisted.rows[0].ordered, true);
});
test("T6.1-D PostgreSQL revogação Staff tem efeito imediato nas consultas Staff", async () => {
  const admin = await account({ admin: true }), eventId = await event("open"), staff = await account();
  const created = await grant(admin, { role: "staff", email: staff.email, eventId });
  assert.equal((await supertest(app.getHttpServer()).get(`/api/v1/staff/events/${eventId}/stations`).set("Authorization", `Bearer ${staff.token}`)).status, 200);
  assert.equal((await revoke(admin, created.body.grant.id)).status, 200);
  const denied = await supertest(app.getHttpServer()).get(`/api/v1/staff/events/${eventId}/stations`).set("Authorization", `Bearer ${staff.token}`);
  problem(denied, 404, "RESOURCE_NOT_FOUND");
});
test("T6.1-D PostgreSQL Staff posterior não reabre evento encerrado", async () => {
  const admin = await account({ admin: true }), target = await account(), eventId = await event("closed");
  const response = await grant(admin, { role: "staff", email: target.email, eventId });
  assert.equal(response.status, 201); assert.equal((await pool.query("SELECT status FROM events WHERE id=$1", [eventId])).rows[0].status, "closed");
});
test("T6.1-D PostgreSQL duas revogações concorrentes da mesma concessão têm um único efeito", async () => {
  const admin = await account({ admin: true }), second = await account({ admin: true }), target = await account(), eventId = await event();
  const created = await grant(admin, { role: "staff", email: target.email, eventId });
  const responses = await Promise.all([revoke(admin, created.body.grant.id), revoke(second, created.body.grant.id)]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 404).length, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='admin_role_revoked' AND target_user_id=$1", [target.id])).rows[0].n, 1);
});
test("T6.1-D PostgreSQL concessão concorrente com revogação mantém histórico único e estado válido", async () => {
  const admin = await account({ admin: true }), target = await account(), eventId = await event();
  const created = await grant(admin, { role: "staff", email: target.email, eventId });
  const key = randomUUID(), body = { role: "staff", email: target.email, eventId };
  const responses = await Promise.all([revoke(admin, created.body.grant.id), grant(admin, body, key)]);
  assert.equal(responses[0].status, 200);
  if (responses[1].status === 409) {
    problem(responses[1], 409, "ROLE_ALREADY_GRANTED");
    assert.equal((await grant(admin, body, key)).status, 201);
  } else assert.equal(responses[1].status, 201);
  const roles = await pool.query("SELECT revoked_at FROM user_roles WHERE user_id=$1 AND role='staff' AND event_id=$2 ORDER BY granted_at", [target.id, eventId]);
  assert.equal(roles.rowCount, 2); assert.notEqual(roles.rows[0].revoked_at, null); assert.equal(roles.rows[1].revoked_at, null);
});
test("T6.1-D PostgreSQL revogar Staff preserva papel participante e os demais escopos Staff", async () => {
  const admin = await account({ admin: true }), target = await account(), firstEvent = await event(), secondEvent = await event();
  const first = await grant(admin, { role: "staff", email: target.email, eventId: firstEvent });
  assert.equal((await grant(admin, { role: "staff", email: target.email, eventId: secondEvent })).status, 201);
  assert.equal((await revoke(admin, first.body.grant.id)).status, 200);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND revoked_at IS NULL AND (role='participante' OR (role='staff' AND event_id=$2))", [target.id, secondEvent])).rows[0].n, 2);
});
