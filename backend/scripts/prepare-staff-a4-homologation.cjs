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

const DATABASE = 'arenago_staff_a4_20261112';
const ROLE = 'arenago_staff_a4';
const EXPECTED_TAGS = [
  '0001_identity_profile', '0002_events_base', '0003_credentials_roles',
  '0004_event_operations', '0005_idempotency', '0006_admin_2fa_login',
  '0007_staff_idempotency_preparation', '0008_external_entry_calls',
];
const ACCOUNTS = [
  { name: 'Homologacao Admin', email: 'staff-homolog-admin@arenago.invalid' },
  { name: 'Homologacao Staff', email: 'staff-homolog-staff@arenago.invalid' },
];
const CONFIRMATION = 'AUTORIZO CONTAS SINTETICAS';
const DIAGNOSTICS = Object.freeze({
  mismatch: 'Confirmação de senha divergente.',
  length: 'Comprimento de senha inválido: use de 8 a 128 caracteres.',
  policy: 'Senha recusada pela política de segurança existente.',
  adminConflict: 'A senha do Admin deve ser exclusiva das demais contas.',
  hash: 'Falha na geração do hash da senha.',
  input: 'Falha na leitura interativa.',
});

class FixtureDiagnosticError extends Error {
  constructor(code) {
    super(DIAGNOSTICS[code]);
    this.code = code;
  }
}

function diagnosticMessage(error) {
  if (error instanceof FixtureDiagnosticError && Object.hasOwn(DIAGNOSTICS, error.code)) {
    return DIAGNOSTICS[error.code];
  }
  return 'Preparação não confirmada. Confira identidade, migrations e estado do banco antes de qualquer nova tentativa.';
}

async function prepareAccountHash(account, passwordState, isAdmin, read = question, hash = argon2.hash) {
  let secret;
  let repeated;
  try {
    secret = await read(`Nova senha sintética para ${account.email} (oculta): `, true);
    repeated = await read('Repita a senha (oculta): ', true);
  } catch {
    throw new FixtureDiagnosticError('input');
  }
  if (secret !== repeated) throw new FixtureDiagnosticError('mismatch');
  if (secret.length < 8 || secret.length > 128) throw new FixtureDiagnosticError('length');
  if (evaluatePasswordSecurity(secret, account).compromised) throw new FixtureDiagnosticError('policy');
  if (isAdmin) {
    if (passwordState.adminSecret !== undefined || passwordState.nonAdminSecrets.has(secret)) {
      throw new FixtureDiagnosticError('adminConflict');
    }
    passwordState.adminSecret = secret;
  } else {
    if (secret === passwordState.adminSecret) throw new FixtureDiagnosticError('adminConflict');
    passwordState.nonAdminSecrets.add(secret);
  }
  try {
    return await hash(secret, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  } catch {
    throw new FixtureDiagnosticError('hash');
  }
}

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
    inet_server_port() AS port, pg_is_in_recovery() AS recovery,
    current_user AS db_role, session_user AS session_role`)).rows[0];
  if (!identity || identity.db !== DATABASE || identity.host !== '127.0.0.1'
      || identity.port !== 55432 || identity.recovery !== false
      || identity.db_role !== ROLE || identity.session_role !== ROLE) throw new Error('Identidade do servidor divergente.');
  const role = (await client.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication,
    rolbypassrls, rolinherit, rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = current_user`)).rows[0];
  if (!role || role.rolsuper !== false || role.rolcreatedb !== false || role.rolcreaterole !== false
      || role.rolreplication !== false || role.rolbypassrls !== false || role.rolinherit !== false
      || role.rolcanlogin !== true) throw new Error('Role PostgreSQL não é restrita.');
  const applied = (await client.query('SELECT hash, created_at::text AS at FROM drizzle.__drizzle_migrations ORDER BY created_at, id')).rows;
  if (applied.length !== migrations.length || applied.some((row, i) =>
    row.hash !== migrations[i].hash || row.at !== migrations[i].when)) throw new Error('Migrations divergentes.');
  const controls = (await client.query(`SELECT
    to_regclass('public.users') IS NOT NULL AND to_regclass('public.user_roles') IS NOT NULL
    AND to_regclass('public.events') IS NOT NULL AND to_regclass('public.idempotency_operations') IS NOT NULL
    AND to_regclass('public.staff_idempotency_epochs') IS NOT NULL
    AND to_regclass('public.external_entry_calls') IS NOT NULL AS tables_ok,
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
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.external_entry_calls'::regclass
      AND c.conname = 'ck_external_calls_resolution' AND c.convalidated) AS external_calls_check_ok,
    EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.external_entry_calls'::regclass
      AND t.tgname = 'protect_external_entry_call' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) AS external_calls_trigger_ok,
    EXISTS (SELECT 1 FROM public.questionnaire_versions WHERE activated_at IS NOT NULL) AS questionnaire_ok,
    EXISTS (SELECT 1 FROM public.games WHERE is_curated = true) AS games_ok`)).rows[0];
  if (!controls || Object.values(controls).some(value => value !== true)) throw new Error('Schema ou seed incompatível.');
}

function validateRole(user) {
  if (user !== ROLE) throw new Error('Role PostgreSQL dedicada divergente.');
}

function validateConfirmation(value) {
  if (value !== CONFIRMATION) throw new Error('Autorização não confirmada.');
}

async function verifyEmptyDatabase(client) {
  const empty = (await client.query(`SELECT NOT EXISTS (SELECT 1 FROM public.users)
    AND NOT EXISTS (SELECT 1 FROM public.user_roles) AND NOT EXISTS (SELECT 1 FROM public.events)
    AND NOT EXISTS (SELECT 1 FROM public.idempotency_operations)
    AND NOT EXISTS (SELECT 1 FROM public.external_entry_calls) AS empty`)).rows[0];
  if (empty?.empty !== true) throw new Error('Banco não está vazio para a fixture.');
}

async function main() {
  validateLaunch(process.env, process.argv.slice(2), process.stdin.isTTY, process.stdout.isTTY);
  const migrations = expectedMigrations();
  const user = (await question('Role PostgreSQL local dedicada: ')).trim();
  validateRole(user);
  let password = await question('Senha PostgreSQL local (oculta): ', true);
  if (!password) throw new Error('Senha ausente.');
  const client = new Client({ host: '127.0.0.1', port: 55432, database: DATABASE, user, password,
    ssl: false, options: '-c search_path=pg_catalog,public', application_name: 'arenago-staff-homolog-fixture', connectionTimeoutMillis: 5000 });
  password = '';
  let inTransaction = false;
  try {
    await client.connect();
    await verifyDatabase(client, migrations);
    console.log('Destino local e migrations conferidos. Serão criadas duas contas SINTÉTICAS; nenhuma concessão Staff ou Admin será criada.');
    const confirmation = await question(`Digite ${CONFIRMATION} para autorizar esta execução: `);
    validateConfirmation(confirmation);
    const hashes = [];
    const passwordState = { adminSecret: undefined, nonAdminSecrets: new Set() };
    for (let index = 0; index < ACCOUNTS.length; index += 1) {
      hashes.push(await prepareAccountHash(ACCOUNTS[index], passwordState, index === 0));
    }
    passwordState.adminSecret = undefined;
    passwordState.nonAdminSecrets.clear();
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    inTransaction = true;
    await client.query('LOCK TABLE drizzle.__drizzle_migrations IN SHARE MODE');
    await client.query('LOCK TABLE public.users, public.user_roles, public.events, public.idempotency_operations, public.external_entry_calls IN SHARE ROW EXCLUSIVE MODE');
    await verifyDatabase(client, migrations);
    await verifyEmptyDatabase(client);
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
    console.log('Duas contas sintéticas criadas. Conclua bootstrap/TOTP, concessão Staff e perfis pelos fluxos existentes.');
    for (const account of ACCOUNTS) console.log(account.email);
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(diagnosticMessage(error));
    process.exitCode = 1;
  });
}

module.exports = { validateLaunch, validateRole, validateConfirmation, expectedMigrations, verifyDatabase, verifyEmptyDatabase,
  prepareAccountHash, diagnosticMessage, EXPECTED_TAGS, ACCOUNTS, DATABASE, ROLE };
