'use strict';

// Utilitário de preparação exclusivamente local. Não carrega dotenv nem aceita URL.
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const { Client } = require('pg');
const argon2 = require('argon2');
const { evaluatePasswordSecurity } = require('../src/auth/password-policy.ts');

const DATABASE = 'arenago_staff_homolog_20261111';
const EXPECTED_TAGS = [
  '0001_identity_profile', '0002_events_base', '0003_credentials_roles',
  '0004_event_operations', '0005_idempotency', '0006_admin_2fa_login',
  '0007_staff_idempotency_preparation',
];
const ACCOUNTS = [
  { name: 'Homologacao Admin', email: 'staff-homolog-admin@arenago.invalid' },
  { name: 'Homologacao Staff', email: 'staff-homolog-staff@arenago.invalid' },
  ...Array.from({ length: 5 }, (_, i) => ({
    name: `Homologacao Participante ${i + 1}`,
    email: `staff-homolog-participante${i + 1}@arenago.invalid`,
  })),
];
const CONFIRMATION = 'AUTORIZO CONTAS SINTETICAS';

function validateLaunch(env, args, stdinIsTTY, stdoutIsTTY) {
  if (env.NODE_ENV !== 'test' || args.length !== 1 || args[0] !== '--execute' || !stdinIsTTY || !stdoutIsTTY) {
    throw new Error('Execução exige NODE_ENV=test, --execute e terminal interativo.');
  }
  for (const key of ['NODE_OPTIONS', 'DATABASE_URL', 'DATABASE_DIRECT_URL', 'PGHOST', 'PGHOSTADDR',
    'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) {
    if (env[key]) throw new Error(`Remova ${key} do processo antes de iniciar.`);
  }
}

function expectedMigrations() {
  const folder = path.resolve(__dirname, '../drizzle');
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'));
  if (journal.version !== '7' || journal.dialect !== 'postgresql' || !Array.isArray(journal.entries)
      || journal.entries.length !== EXPECTED_TAGS.length) throw new Error('Journal incompatível.');
  return journal.entries.map((entry, index) => {
    if (entry.idx !== index || entry.tag !== EXPECTED_TAGS[index] || !Number.isSafeInteger(entry.when)
        || (index > 0 && entry.when <= journal.entries[index - 1].when)) throw new Error('Journal incompatível.');
    const sql = readFileSync(path.join(folder, `${entry.tag}.sql`), 'utf8');
    return { when: String(entry.when), hash: createHash('sha256').update(sql).digest('hex') };
  });
}

async function question(prompt, hidden = false) {
  const sink = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const rl = readline.createInterface({ input: process.stdin, output: sink, terminal: true });
  try {
    if (hidden) process.stderr.write(prompt);
    return await rl.question(hidden ? '' : prompt);
  } finally {
    rl.close();
    if (hidden) process.stderr.write('\n');
  }
}

async function verifyDatabase(client, migrations) {
  const identity = (await client.query(`SELECT current_database() AS db, host(inet_server_addr()) AS host,
    inet_server_port() AS port, pg_is_in_recovery() AS recovery`)).rows[0];
  if (!identity || identity.db !== DATABASE || identity.host !== '127.0.0.1'
      || identity.port !== 55432 || identity.recovery !== false) throw new Error('Identidade do servidor divergente.');
  const applied = (await client.query('SELECT hash, created_at::text AS at FROM drizzle.__drizzle_migrations ORDER BY created_at, id')).rows;
  if (applied.length !== migrations.length || applied.some((row, i) =>
    row.hash !== migrations[i].hash || row.at !== migrations[i].when)) throw new Error('Migrations divergentes.');
  const controls = (await client.query(`SELECT
    to_regclass('public.users') IS NOT NULL AND to_regclass('public.user_roles') IS NOT NULL
    AND to_regclass('public.events') IS NOT NULL AND to_regclass('public.idempotency_operations') IS NOT NULL
    AND to_regclass('public.staff_idempotency_epochs') IS NOT NULL AS tables_ok,
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.idempotency_operations'::regclass
      AND c.conname = 'ck_idempotency_staff_preparation_disabled' AND c.convalidated
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%origin_assurance%legacy%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%origin_session_id%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%origin_epoch_id%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%result_state%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%completed_at%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%result_retain_until%') AS check_ok,
    EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid = 'public.idempotency_operations'::regclass
      AND t.tgname = 'tr_staff_idempotency_preparation_guard' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
      AND t.tgtype=19 AND n.nspname='public' AND p.proname='staff_idempotency_preparation_guard'
      AND NOT p.prosecdef) AS trigger_ok,
    EXISTS (SELECT 1 FROM public.questionnaire_versions WHERE activated_at IS NOT NULL) AS questionnaire_ok,
    EXISTS (SELECT 1 FROM public.games WHERE is_curated = true) AS games_ok`)).rows[0];
  if (!controls || Object.values(controls).some(value => value !== true)) throw new Error('Schema ou seed incompatível.');
}

async function main() {
  validateLaunch(process.env, process.argv.slice(2), process.stdin.isTTY, process.stdout.isTTY);
  const migrations = expectedMigrations();
  const user = (await question('Role PostgreSQL local dedicada: ')).trim();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) throw new Error('Role inválida.');
  let password = await question('Senha PostgreSQL local (oculta): ', true);
  if (!password) throw new Error('Senha ausente.');
  const client = new Client({ host: '127.0.0.1', port: 55432, database: DATABASE, user, password,
    ssl: false, options: '-c search_path=pg_catalog,public', application_name: 'arenago-staff-homolog-fixture', connectionTimeoutMillis: 5000 });
  password = '';
  let inTransaction = false;
  try {
    await client.connect();
    await verifyDatabase(client, migrations);
    console.log('Destino local e migrations conferidos. Serão criadas sete contas SINTÉTICAS; nenhuma concessão Staff ou Admin será criada.');
    const confirmation = await question(`Digite ${CONFIRMATION} para autorizar esta execução: `);
    if (confirmation !== CONFIRMATION) throw new Error('Autorização não confirmada.');
    const hashes = [];
    const used = new Set();
    for (const account of ACCOUNTS) {
      let secret = await question(`Nova senha sintética para ${account.email} (oculta): `, true);
      const repeated = await question('Repita a senha (oculta): ', true);
      if (secret !== repeated || secret.length < 8 || secret.length > 128 || used.has(secret)
          || evaluatePasswordSecurity(secret, account).compromised) throw new Error('Senha inválida, repetida ou recusada pela política.');
      used.add(secret);
      hashes.push(await argon2.hash(secret, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }));
      secret = '';
    }
    used.clear();
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    inTransaction = true;
    await client.query('LOCK TABLE drizzle.__drizzle_migrations IN SHARE MODE');
    await client.query('LOCK TABLE public.users, public.user_roles, public.events, public.idempotency_operations IN SHARE ROW EXCLUSIVE MODE');
    await verifyDatabase(client, migrations);
    const empty = (await client.query(`SELECT NOT EXISTS (SELECT 1 FROM public.users)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles) AND NOT EXISTS (SELECT 1 FROM public.events)
      AND NOT EXISTS (SELECT 1 FROM public.idempotency_operations) AS empty`)).rows[0];
    if (empty?.empty !== true) throw new Error('Banco não está vazio para a fixture.');
    for (let i = 0; i < ACCOUNTS.length; i += 1) {
      const id = randomUUID();
      await client.query(`INSERT INTO public.users (id,name,email,password_hash,email_verified_at,is_active,created_at,updated_at)
        VALUES ($1,$2,$3,$4,clock_timestamp(),true,clock_timestamp(),clock_timestamp())`,
      [id, ACCOUNTS[i].name, ACCOUNTS[i].email, hashes[i]]);
      await client.query(`INSERT INTO public.user_roles (id,user_id,role,event_id,granted_by,granted_at,revoked_at,revoked_by)
        VALUES ($1,$2,'participante',NULL,NULL,clock_timestamp(),NULL,NULL)`, [randomUUID(), id]);
    }
    await client.query('COMMIT');
    inTransaction = false;
    console.log('Sete contas sintéticas criadas. Conclua bootstrap/TOTP, concessão Staff e perfis pelos fluxos existentes.');
    for (const account of ACCOUNTS) console.log(account.email);
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Preparação não confirmada. Confira identidade, migrations e estado do banco antes de qualquer nova tentativa.');
    process.exitCode = 1;
  });
}

module.exports = { validateLaunch, expectedMigrations, verifyDatabase, EXPECTED_TAGS, DATABASE };
