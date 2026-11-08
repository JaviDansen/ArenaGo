import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { EmailVerificationService, generateEmailVerificationToken } from "../../src/auth/email-verification.service";
import { EmailVerificationPolicy, parseEmailVerificationLimits } from "../../src/auth/email-verification.policy";
import { assertParticipationsReadTestDatabaseUrls } from "./participations-read-db-guard";

// A04: valida as três URLs, credenciais presentes, host/porta/banco exatos e ausência
// de query/fragmentos ANTES de qualquer Pool. Nunca lê/imprime credenciais.
const url = assertParticipationsReadTestDatabaseUrls(process.env);
const applicationName = `a1-email-${randomUUID()}`;
const pool = new Pool({ connectionString: url, application_name: applicationName, max: 8 });
const fixturePool = new Pool({ connectionString: url, max: 4 });
const users: string[] = [];
const policy = { limits: parseEmailVerificationLimits({}) } as EmailVerificationPolicy;
const service = new EmailVerificationService(pool, policy);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

after(async () => {
  try {
    await fixturePool.query("DELETE FROM email_verification_tokens WHERE user_id=ANY($1::uuid[])", [users]);
    await fixturePool.query("DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id=ANY($1::uuid[]))", [users]);
    await fixturePool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [users]);
    await fixturePool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [users]);
    await fixturePool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  } finally {
    await Promise.all([pool.end(), fixturePool.end()]);
  }
});
async function account() {
  const id = randomUUID();
  await fixturePool.query(`INSERT INTO users(id,name,email,password_hash,is_active,created_at,updated_at)
    VALUES($1,'A1 fixture',$2,'test-placeholder',true,clock_timestamp(),clock_timestamp())`, [id, `${id}@example.test`]);
  users.push(id);
  return id;
}
async function issued(userId: string, instance = service) {
  const result = await instance.issue(userId);
  assert.equal(result.kind, "issued");
  if (result.kind !== "issued") throw Error("Emissão esperada");
  return result;
}
async function age(userId: string, seconds = 121) {
  await fixturePool.query(`UPDATE email_verification_tokens SET created_at=clock_timestamp()-$2::integer*interval '1 second'
    WHERE user_id=$1`, [userId, seconds]);
}
async function seedToken(userId: string, options: { age?: number; expires?: number; used?: boolean; email?: string } = {}) {
  const token = generateEmailVerificationToken();
  await fixturePool.query(`INSERT INTO email_verification_tokens(id,user_id,email,token_hash,created_at,expires_at,verified_at)
    SELECT $1,u.id,COALESCE($3::text,u.email),$4,clock_timestamp()-$5::integer*interval '1 second',
      clock_timestamp()+$6::integer*interval '1 second',CASE WHEN $7::boolean THEN clock_timestamp() ELSE NULL END
    FROM users u WHERE u.id=$2`,
  [randomUUID(), userId, options.email ?? null, hash(token), options.age ?? 121, options.expires ?? 86400, options.used ?? false]);
  return token;
}
async function snapshot(userId: string) {
  return (await fixturePool.query(`SELECT to_jsonb(u) AS account,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM email_verification_tokens t WHERE user_id=u.id) AS tokens,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM sessions s WHERE user_id=u.id) AS sessions,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM user_roles r WHERE user_id=u.id) AS roles,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id WHERE s.user_id=u.id) AS refresh
    FROM users u WHERE id=$1`, [userId])).rows[0];
}
function intercept(afterQuery: (client: PoolClient, sql: string) => Promise<void>) {
  const wrapped = {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          const result = await client.query(sql, values);
          await afterQuery(client, sql);
          return result;
        },
        release: () => client.release(),
      };
    },
  } as unknown as Pool;
  return new EmailVerificationService(wrapped, policy);
}
async function waitBlocked(count: number) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const n = (await fixturePool.query(`SELECT count(*)::integer AS n FROM pg_stat_activity
      WHERE application_name=$1 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`, [applicationName])).rows[0].n;
    if (n >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("Sobreposição real de transações não foi observada.");
}
async function competing<T>(userId: string, first: () => Promise<T>, second: () => Promise<T>) {
  const blocker = await fixturePool.connect();
  let running: Promise<T>[] = [];
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    running = [first(), second()];
    // Handlers instalados antes de aguardar locks para evitar rejeições sem tratamento.
    const joined = Promise.all(running);
    void joined.catch(() => undefined);
    await waitBlocked(2);
    await blocker.query("COMMIT");
    return await joined;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(running);
  }
}

test("T6.1-A1 PostgreSQL emissão guarda hash, expira em 24h e preserva conta", async () => {
  const id = await account(), before = await snapshot(id), result = await issued(id);
  const rows = (await fixturePool.query(`SELECT token_hash,email,verified_at,
    expires_at-created_at=interval '24 hours' AS exact FROM email_verification_tokens WHERE user_id=$1`, [id])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, hash(result.token));
  assert.equal(rows[0].email, result.email);
  assert.equal(rows[0].verified_at, null);
  assert.equal(rows[0].exact, true);
  assert.deepEqual((await snapshot(id)).account, before.account);
  assert.ok(!JSON.stringify(await snapshot(id)).includes(result.token));
});
test("T6.1-A1 PostgreSQL TTL customizado usa relógio do banco", async () => {
  const id = await account();
  await issued(id, new EmailVerificationService(pool, { limits: { ttlSeconds: 600, cooldownSeconds: 120, maxPerHour: 5 } }));
  assert.equal((await fixturePool.query("SELECT expires_at-created_at=interval '600 seconds' AS exact FROM email_verification_tokens WHERE user_id=$1", [id])).rows[0].exact, true);
});
test("T6.1-A1 PostgreSQL cooldown recusa sem invalidar token vigente", async () => {
  const id = await account(), old = await issued(id), before = await snapshot(id);
  assert.deepEqual(await service.issue(id), { kind: "cooldown" });
  assert.deepEqual(await snapshot(id), before);
  assert.deepEqual(await service.confirm(old.token), { kind: "verified" });
});
test("T6.1-A1 PostgreSQL reemissão após cooldown invalida anterior sem apagar histórico", async () => {
  const id = await account(), old = await issued(id);
  await age(id);
  const fresh = await issued(id);
  assert.deepEqual(await service.confirm(old.token), { kind: "invalid_token" });
  const rows = (await fixturePool.query("SELECT verified_at,expires_at<=clock_timestamp() AS expired FROM email_verification_tokens WHERE token_hash=$1", [hash(old.token)])).rows;
  assert.equal(rows[0].expired, true);
  assert.equal(rows[0].verified_at, null);
  assert.equal((await snapshot(id)).tokens.length, 2);
  assert.deepEqual(await service.confirm(fresh.token), { kind: "verified" });
});
test("T6.1-A1 PostgreSQL sexta emissão conta anteriores substituídos", async () => {
  const id = await account();
  for (let i = 0; i < 5; i++) { await issued(id); await age(id); }
  const before = await snapshot(id);
  assert.equal(before.tokens.length, 5);
  assert.deepEqual(await service.issue(id), { kind: "rate_limited" });
  assert.deepEqual(await snapshot(id), before);
});
test("T6.1-A1 PostgreSQL janela móvel inclui consumidos e expirados", async () => {
  const id = await account();
  for (let i = 0; i < 5; i++) await seedToken(id, { used: i % 2 === 0, expires: i % 2 ? -1 : 86400 });
  assert.deepEqual(await service.issue(id), { kind: "rate_limited" });
  await age(id, 3601);
  await issued(id);
  assert.equal((await snapshot(id)).tokens.length, 6);
});
test("T6.1-A1 PostgreSQL duas emissões simultâneas serializam e emitem uma vez", async () => {
  const id = await account();
  const results = await competing(id, () => service.issue(id), () => service.issue(id));
  assert.deepEqual(results.map(r => r.kind).sort(), ["cooldown", "issued"]);
  assert.equal((await snapshot(id)).tokens.length, 1);
});
test("T6.1-A1 PostgreSQL concorrência na quinta emissão não ultrapassa limite", async () => {
  const id = await account();
  for (let i = 0; i < 4; i++) await seedToken(id);
  const results = await competing(id, () => service.issue(id), () => service.issue(id));
  assert.deepEqual(results.map(r => r.kind).sort(), ["cooldown", "issued"]);
  assert.equal((await snapshot(id)).tokens.length, 5);
  await age(id);
  assert.deepEqual(await service.issue(id), { kind: "rate_limited" });
});
test("T6.1-A1 PostgreSQL confirmação é única, mantém microssegundos e invalida demais", async () => {
  const id = await account(), token = await seedToken(id), other = await seedToken(id);
  assert.deepEqual(await service.confirm(token), { kind: "verified" });
  const exact = (await fixturePool.query(`SELECT u.email_verified_at=t.verified_at AS exact
    FROM users u JOIN email_verification_tokens t ON t.user_id=u.id WHERE t.token_hash=$1`, [hash(token)])).rows[0];
  assert.equal(exact.exact, true);
  const before = await snapshot(id);
  assert.deepEqual(await service.confirm(token), { kind: "invalid_token" });
  assert.deepEqual(await service.confirm(other), { kind: "invalid_token" });
  assert.deepEqual(await snapshot(id), before);
  assert.ok(before.tokens.find((t: { token_hash: string; verified_at: string | null }) => t.token_hash === hash(other)).verified_at === null);
});
test("T6.1-A1 PostgreSQL confirmações simultâneas consomem uma vez", async () => {
  const id = await account(), token = (await issued(id)).token;
  const results = await competing(id, () => service.confirm(token), () => service.confirm(token));
  assert.deepEqual(results.map(r => r.kind).sort(), ["invalid_token", "verified"]);
});
for (const first of ["issue", "confirm"] as const) {
  test(`T6.1-A1 PostgreSQL ${first} primeiro versus concorrente preserva ordem de commit`, async () => {
    const id = await account(), token = await seedToken(id);
    let entered!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const marker = first === "issue" ? "INSERT INTO email_verification_tokens" : "UPDATE users";
    const instrumented = intercept(async (_client, sql) => {
      if (sql.startsWith(marker)) { entered(); await gate; }
    });
    const one = first === "issue" ? instrumented.issue(id) : instrumented.confirm(token);
    void one.catch(() => undefined);
    let two: Promise<unknown> | undefined;
    try {
      await Promise.race([reached, one.then(() => { throw Error("Ponto de sincronização não atingido."); })]);
      two = first === "issue" ? service.confirm(token) : service.issue(id);
      void two.catch(() => undefined);
      await waitBlocked(1);
      resume();
      const a = await one, b = await two;
      assert.equal(a.kind, first === "issue" ? "issued" : "verified");
      assert.deepEqual(b, { kind: first === "issue" ? "invalid_token" : "already_verified" });
      const state = await snapshot(id);
      assert.equal(state.account.email_verified_at !== null, first === "confirm");
      assert.equal(state.tokens.length, first === "issue" ? 2 : 1);
    } finally {
      resume();
      await Promise.allSettled(two ? [one, two] : [one]);
    }
  });
}
for (const defect of ["expired", "used", "old-email", "inactive"] as const) {
  test(`T6.1-A1 PostgreSQL token ${defect} não confirma nem altera estado`, async () => {
    const id = await account();
    const token = await seedToken(id, { expires: defect === "expired" ? -1 : 86400, used: defect === "used" });
    if (defect === "old-email") await fixturePool.query("UPDATE users SET email=$2 WHERE id=$1", [id, `new-${id}@example.test`]);
    if (defect === "inactive") await fixturePool.query("UPDATE users SET is_active=false WHERE id=$1", [id]);
    const before = await snapshot(id);
    assert.deepEqual(await service.confirm(token), { kind: "invalid_token" });
    assert.deepEqual(await snapshot(id), before);
  });
}
test("T6.1-A1 PostgreSQL token malformado/inexistente e conta inexistente", async () => {
  assert.deepEqual(await service.confirm("invalid"), { kind: "invalid_token" });
  assert.deepEqual(await service.confirm(generateEmailVerificationToken()), { kind: "invalid_token" });
  assert.deepEqual(await service.issue(randomUUID()), { kind: "account_unavailable" });
});
test("T6.1-A1 PostgreSQL conta inativa/verificada não recebe token", async () => {
  const id = await account();
  await fixturePool.query("UPDATE users SET is_active=false WHERE id=$1", [id]);
  assert.deepEqual(await service.issue(id), { kind: "account_unavailable" });
  await fixturePool.query("UPDATE users SET is_active=true,email_verified_at=clock_timestamp() WHERE id=$1", [id]);
  assert.deepEqual(await service.issue(id), { kind: "already_verified" });
  assert.equal((await snapshot(id)).tokens, null);
});
test("T6.1-A1 PostgreSQL isolamento: lock de outra conta não bloqueia emissão", async () => {
  const a = await account(), b = await account(), blocker = await fixturePool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a]);
    const boundedPool = new Pool({ connectionString: url, statement_timeout: 1500 });
    try { await issued(b, new EmailVerificationService(boundedPool, policy)); }
    finally { await boundedPool.end(); }
    assert.equal((await snapshot(a)).tokens, null);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
});

test("T6.1-A1 PostgreSQL confirmação revalida expiração depois de aguardar token", async () => {
  const id = await account(), token = await seedToken(id), blocker = await fixturePool.connect();
  let pending: ReturnType<typeof service.confirm> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("UPDATE email_verification_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [hash(token)]);
    pending = service.confirm(token);
    void pending.catch(() => undefined);
    await waitBlocked(1);
    await blocker.query("COMMIT");
    assert.deepEqual(await pending, { kind: "invalid_token" });
    assert.equal((await snapshot(id)).account.email_verified_at, null);
  } finally {
    await blocker.query("ROLLBACK"); blocker.release();
    if (pending) await Promise.allSettled([pending]);
  }
});

test("T6.1-A1 PostgreSQL emissão revalida inatividade depois de aguardar usuário", async () => {
  const id = await account(), blocker = await fixturePool.connect();
  let pending: ReturnType<typeof service.issue> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("UPDATE users SET is_active=false WHERE id=$1", [id]);
    pending = service.issue(id);
    void pending.catch(() => undefined);
    await waitBlocked(1);
    await blocker.query("COMMIT");
    assert.deepEqual(await pending, { kind: "account_unavailable" });
    assert.equal((await snapshot(id)).tokens, null);
  } finally {
    await blocker.query("ROLLBACK"); blocker.release();
    if (pending) await Promise.allSettled([pending]);
  }
});
for (const phase of ["INSERT INTO email_verification_tokens", "UPDATE users", "UPDATE email_verification_tokens SET expires_at"]) {
  test(`T6.1-A1 PostgreSQL falha SQL real após ${phase} reverte tudo e permite retry`, async () => {
    const id = await account(), token = await seedToken(id), before = await snapshot(id);
    let injected = false;
    const failing = intercept(async (client, sql) => {
      if (sql.startsWith(phase)) { injected = true; await client.query("SELECT 1/0"); }
    });
    const operation = phase.startsWith("INSERT") ? failing.issue(id) : failing.confirm(token);
    await assert.rejects(operation, (error: unknown) => {
      assert.equal((error as { code: string }).code, "22012");
      return true;
    });
    assert.equal(injected, true);
    assert.deepEqual(await snapshot(id), before);
    if (phase.startsWith("INSERT")) await issued(id);
    else assert.deepEqual(await service.confirm(token), { kind: "verified" });
  });
}
test("T6.1-A1 PostgreSQL emissão e confirmação preservam sessões, refresh e papéis", async () => {
  const id = await account(), sid = randomUUID();
  await fixturePool.query("INSERT INTO user_roles(id,user_id,role,granted_at) VALUES($1,$2,'participante',clock_timestamp())", [randomUUID(), id]);
  await fixturePool.query(`INSERT INTO sessions(id,user_id,expires_at,last_activity_at,created_at)
    VALUES($1,$2,clock_timestamp()+interval '1 day',clock_timestamp(),clock_timestamp())`, [sid, id]);
  await fixturePool.query(`INSERT INTO refresh_tokens(id,session_id,token_hash,expires_at,created_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '1 day',clock_timestamp())`, [randomUUID(), sid, hash(randomUUID())]);
  const before = await snapshot(id), result = await issued(id);
  assert.deepEqual(await service.confirm(result.token), { kind: "verified" });
  const afterState = await snapshot(id);
  for (const key of ["sessions", "roles", "refresh"]) assert.deepEqual(afterState[key], before[key]);
  assert.equal(afterState.roles.length, 1);
  assert.equal(afterState.roles[0].role, "participante");
});
