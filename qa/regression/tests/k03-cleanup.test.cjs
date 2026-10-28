const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { integrationCallback } = require('../helpers/source.cjs');

function fixture({ activatedAt = null, curated = false, mainFailure, cleanupFailure } = {}) {
  const db = { activatedAt, curated, custom: new Map() };
  const calls = [];
  const primary = new Error('PRIMARY: simulated failure after data mutation');
  const cleanup = new Error('CLEANUP: simulated restoration failure');
  let inCleanup = false;
  const pool = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: q, params });
      if (q.startsWith('SELECT activated_at')) {
        return { rowCount: 1, rows: [{ activated_at: db.activatedAt }] };
      }
      if (q.startsWith('UPDATE questionnaire_versions SET activated_at = NULL')) {
        db.activatedAt = null;
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('UPDATE questionnaire_versions SET activated_at = $1')) {
        inCleanup = true;
        if (cleanupFailure) throw cleanup;
        db.activatedAt = params[0];
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('UPDATE games SET is_curated = false')) {
        db.curated = false;
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('UPDATE games SET is_curated = true')) {
        inCleanup = true;
        if (cleanupFailure) throw cleanup;
        db.curated = true;
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('UPDATE games SET is_curated = $1')) {
        inCleanup = true;
        if (cleanupFailure) throw cleanup;
        db.curated = params[0];
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('INSERT INTO games')) {
        db.custom.set(params[0], { id: params[0], name: params[1], is_curated: true });
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('SELECT is_curated FROM games WHERE lower')) {
        return { rowCount: 1, rows: [{ is_curated: db.curated }] };
      }
      if (q.startsWith('SELECT is_curated FROM games WHERE name')) {
        return { rows: [...db.custom.values()].filter(g => g.name === params[0]) };
      }
      if (q.startsWith('DELETE FROM games WHERE id')) {
        db.custom.delete(params[0]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error('Fixture does not support this SQL; extend it explicitly: ' + q);
    },
  };
  class ProfileQuestionnaireService {}
  class GamesService {}
  const app = {
    get(service) {
      if (service === ProfileQuestionnaireService) return { async onModuleInit() {} };
      if (service === GamesService) return {
        async seedCuratedGames() { if (mainFailure) throw primary; },
      };
      throw new Error('Unexpected service');
    },
  };
  const globals = {
    assert, randomUUID, pool, app, GamesService, ProfileQuestionnaireService,
    async registerTestParticipant() { return { accessToken: 'fixture-token' }; },
    async apiRequest() {
      if (mainFailure) throw primary;
      return db.activatedAt === null
        ? { status: 422, body: { code: 'QUESTIONNAIRE_VERSION_UNAVAILABLE' } }
        : { status: 200, body: {} };
    },
  };
  return { db, calls, primary, cleanup, globals, get inCleanup() { return inCleanup; } };
}

function errorContains(error, target, seen = new Set()) {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return errorContains(error.cause, target, seen) ||
    (Array.isArray(error.errors) && error.errors.some(e => errorContains(e, target, seen)));
}

test('F01 K03-F.1 restores an originally NULL activated_at as NULL', async (t) => {
  const f = fixture();
  await integrationCallback('K03-F.1:', f.globals)();
  assert.ok(f.inCleanup, 'existing finally must actually execute');
  t.diagnostic('Restored activated_at: ' + String(f.db.activatedAt));
  assert.equal(f.db.activatedAt, null, 'inactive version must not be activated by test cleanup');
});

test('F02 K03-F.1 preserves an existing activation timestamp exactly', async () => {
  const original = new Date('2024-01-02T03:04:05.000Z');
  const f = fixture({ activatedAt: original });
  await integrationCallback('K03-F.1:', f.globals)();
  assert.equal(f.db.activatedAt.getTime(), original.getTime());
});

test('F03 K03-F.2 preserves originally FALSE is_curated', async (t) => {
  const f = fixture({ curated: false });
  await integrationCallback('K03-F.2:', f.globals)();
  assert.equal(f.db.custom.size, 0, 'temporary promoted game must be deleted');
  t.diagnostic('Restored Apex Legends is_curated: ' + f.db.curated);
  assert.equal(f.db.curated, false, 'administrative demotion must survive test cleanup');
});

test('F04 K03-F.2 preserves originally TRUE is_curated and deletes its fixture', async () => {
  const f = fixture({ curated: true });
  await integrationCallback('K03-F.2:', f.globals)();
  assert.equal(f.db.curated, true);
  assert.equal(f.db.custom.size, 0);
});

for (const [id, prefix] of [['F05', 'K03-F.1:'], ['F06', 'K03-F.2:']]) {
  test(id + ' ' + prefix + ' cleanup failure preserves the primary failure', async (t) => {
    const f = fixture({ mainFailure: true, cleanupFailure: true });
    let caught;
    try { await integrationCallback(prefix, f.globals)(); } catch (error) { caught = error; }
    assert.ok(f.inCleanup, 'fault injection must reach the real finally block');
    assert.ok(caught, 'a failed body must not pass');
    t.diagnostic('Observed exception: ' + caught.message);
    assert.ok(errorContains(caught, f.primary),
      'primary error must remain observable as the thrown error, cause, or AggregateError member');
  });
}

test('F07 K03-F.1 cleanup still runs after failure in the test body', async () => {
  const original = new Date('2024-01-02T03:04:05.000Z');
  const f = fixture({ activatedAt: original, mainFailure: true });
  await assert.rejects(integrationCallback('K03-F.1:', f.globals)(), e => e === f.primary);
  assert.ok(f.inCleanup);
  assert.equal(f.db.activatedAt.getTime(), original.getTime());
});

test('F08 K03-F.2 removes its custom game after failure in the test body', async () => {
  const f = fixture({ curated: true, mainFailure: true });
  await assert.rejects(integrationCallback('K03-F.2:', f.globals)(), e => e === f.primary);
  assert.ok(f.inCleanup);
  assert.equal(f.db.curated, true);
  assert.equal(f.db.custom.size, 0);
});
