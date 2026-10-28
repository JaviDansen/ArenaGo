const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs, backendRequire } = require('../helpers/source.cjs');

const { assertSafeTestDatabase } = loadTs(
  'backend/test/integration/test-db-guard.ts', { 'node:url': require('node:url') }
);
// This is the actual parser used by the installed pg driver. Never call
// Client.connect, Pool, DNS resolution or any integration setup.
const { parse } = backendRequire('pg-connection-string');

function expectRejected(t, url, expectedHost, expectedDatabase) {
  const parsed = new URL(url);
  const effective = parse(url);
  if (expectedHost) assert.equal(effective.host, expectedHost, 'driver-parser precondition');
  if (expectedDatabase) assert.equal(effective.database, expectedDatabase, 'database precondition');
  t.diagnostic(JSON.stringify({
    authorityCheckedByGuard: parsed.hostname,
    pathCheckedByGuard: parsed.pathname,
    effectiveDriverHost: effective.host,
    effectiveDriverDatabase: effective.database,
    effectiveDriverPort: effective.port,
  }));
  assert.throws(() => assertSafeTestDatabase(url),
    'Guard must reject destination without an explicit disposable/local allowlist match: ' + url);
}

for (const [id, label, url, host, database] of [
  ['A01', 'query host redirects loopback authority to remote host',
    'postgresql://u:p@localhost/arenago_test?host=remote.example', 'remote.example', 'arenago_test'],
  ['A02', 'percent-encoded host parameter redirects the driver',
    'postgresql://u:p@localhost/arenago_test?h%6fst=remote.example', 'remote.example'],
  ['A03', 'last repeated host parameter wins in driver',
    'postgresql://u:p@localhost/arenago_test?host=127.0.0.1&host=remote.example', 'remote.example'],
  ['A04', 'host and port parameters redirect together',
    'postgresql://u:p@localhost:55432/arenago_test?host=remote.example&port=443', 'remote.example'],
  ['A05', 'socket protocol changes both host and database interpretation',
    'socket://localhost/arenago_test?db=production', '/arenago_test', 'production'],
  ['A06', 'https protocol is incompatible with a PostgreSQL-only allowlist',
    'https://u:p@localhost/arenago_test', 'localhost'],
  ['A07', 'mysql protocol is incompatible with PostgreSQL',
    'mysql://u:p@localhost/arenago_test', 'localhost'],
  ['A08', 'k03 in a production database name is not disposable proof',
    'postgresql://u:p@localhost/arenago_k03_prod', 'localhost', 'arenago_k03_prod'],
  ['A09', 'test inside latest is not a disposable database name',
    'postgresql://u:p@localhost/latest', 'localhost', 'latest'],
  ['A10', 'test suffix in a production backup is not authorization',
    'postgresql://u:p@localhost/production_test_backup', 'localhost'],
  ['A11', 'descarta substring in production name is not authorization',
    'postgresql://u:p@localhost/arenago_descartavel_prod', 'localhost'],
  ['A12', 'postgres DNS alias has no verified local mapping in this fixture',
    'postgresql://u:p@postgres/arenago_test', 'postgres'],
  ['A13', 'arenago-local-pg DNS alias has no verified local mapping',
    'postgresql://u:p@arenago-local-pg/arenago_test', 'arenago-local-pg'],
  ['A14', 'host parameter may select an unapproved Unix socket directory',
    'postgresql://u:p@localhost/arenago_test?host=%2Fshared%2Fpostgres', '/shared/postgres'],
  ['A15', 'ordinary remote authority is rejected',
    'postgresql://u:p@remote.example/arenago_test', 'remote.example'],
  ['A16', 'ordinary production database on loopback is rejected',
    'postgresql://u:p@127.0.0.1/production', '127.0.0.1', 'production'],
]) {
  test(id + ' ' + label, (t) => expectRejected(t, url, host, database));
}

for (const [id, host] of [['A17', '127.0.0.1'], ['A18', 'localhost']]) {
  test(id + ' explicit disposable database on ' + host + ' remains usable', () => {
    const url = 'postgresql://u:p@' + host + ':55432/arenago_k03_test';
    const accepted = assertSafeTestDatabase(url);
    assert.equal(accepted, url);
    const effective = parse(accepted);
    assert.equal(effective.host, host);
    assert.equal(effective.database, 'arenago_k03_test');
    assert.equal(effective.port, '55432');
  });
}

test('A19 database query parameter alone does not override the pg database path', () => {
  const url = 'postgresql://u:p@127.0.0.1/arenago_test?database=production';
  // Negative control: do not invent a redirect that this driver does not perform.
  assert.equal(parse(assertSafeTestDatabase(url)).database, 'arenago_test');
});
