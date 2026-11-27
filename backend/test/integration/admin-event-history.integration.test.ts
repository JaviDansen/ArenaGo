import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { closedEventIdentificationQuery, closedEventsPageQuery, encodeHistoryCursor, historyCard, historyQuery, historySummary } from '../../src/events/admin-event-history';
import { eventBiQuery } from '../../src/events/admin-bi';
import { assertAdminRoleManagementTestDatabaseUrls, startAdminRoleManagementAfterPreflight } from './admin-role-management-db-guard';

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-04-15T12:00:00.000000Z';
const clock = sql`${at}::timestamptz`;
const hoursFromClock = (hours: number) => new Date(Date.parse(at) + hours * 3600_000).toISOString();

test('ADMIN-10 PostgreSQL: prazo efetivo, períodos, keyset, busca e métricas da ADMIN-09', async () => {
  const connectionString = assertAdminRoleManagementTestDatabaseUrls(process.env);
  const pool = new Pool({ connectionString, ssl: false, max: 1, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
  try {
    const migrations = readMigrationFiles({ migrationsFolder: resolve(__dirname, '../../drizzle') }).map(m => String(m.folderMillis));
    await startAdminRoleManagementAfterPreflight(pool, migrations, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const table of ['events', 'participations', 'evaluations', 'experiences', 'service_sessions', 'queue_entries']) {
          await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
        }
        const addEvent = (n: number, deadlineHours: number, status: string, mode: string | null = null,
          adminHours: number | null = null, name = `Arena ${n}`, code = `CODE-${n}`) =>
          client.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,
            status,closure_mode,closure_requested_at,admin_deadline_at) VALUES
            ($1,$2,$3,'UTC',$4,$5,$6,$7,$8,$9,$10)`, [id(n), name, code, hoursFromClock(deadlineHours - 2),
            hoursFromClock(deadlineHours - 0.5), hoursFromClock(deadlineHours), status, mode,
            adminHours === null ? null : hoursFromClock(mode === 'immediate' ? adminHours : adminHours - 0.25),
            adminHours === null ? null : hoursFromClock(adminHours)]);
        await addEvent(1, -168, 'open', null, null, 'Arena   Norte %_');
        await addEvent(2, -168, 'closed', null, null, 'Arena Norte Dois');
        await addEvent(3, -169, 'closed');
        await addEvent(4, -720, 'closed');
        await addEvent(5, -721, 'closed');
        await addEvent(6, -2160, 'closed');
        await addEvent(7, -2161, 'closed');
        await addEvent(8, 1, 'closed', 'immediate', -0.5, 'Admin imediato', 'ADMIN-IMEDIATO');
        await addEvent(9, 1, 'closing', 'controlled', 0, 'Admin controlado', 'ADMIN-CONTROLADO');
        await addEvent(10, 1, 'closing', 'controlled', 0.25);
        await addEvent(11, 4, 'scheduled');
        await addEvent(12, 1, 'closed'); // Inconsistent future deadline must never enter the history.
        await addEvent(13, 1, 'open');

        const dialect = new PgDialect();
        const query = async (statement: SQL) => {
          const { sql: text, params } = dialect.sqlToQuery(statement);
          return (await client.query(text, params)).rows;
        };
        const list = async (params = {}) => (await query(closedEventsPageQuery(historyQuery.parse(params), clock)))
          .map(row => historyCard.parse(row));
        const eventIds = (rows: Awaited<ReturnType<typeof list>>) => rows.map(row => row.id);
        for (const [period, expected] of [['7', [9,8,2,1]], ['30', [9,8,2,1,3,4]],
          ['90', [9,8,2,1,3,4,5,6]], ['all', [9,8,2,1,3,4,5,6,7]]] as const) {
          assert.deepEqual(eventIds(await list({ period })), expected.map(id));
        }
        assert.deepEqual(eventIds(await list({ search: '  arena norte %_ ' })), [id(1)]);
        assert.deepEqual(eventIds(await list({ search: ' admin-imediato ' })), [id(8)]);
        assert.deepEqual(eventIds(await list({ search: 'controlado' })), [id(9)]);
        const first = await list({ period: '7', search: 'arena norte', limit: '1' });
        assert.deepEqual(eventIds(first), [id(2),id(1)]); // SQL returns one lookahead row.
        const cursor = encodeHistoryCursor(first[0].closedAt, first[0].id);
        assert.deepEqual(eventIds(await list({ period: '7', search: 'arena norte', limit: '1', cursor })), [id(1)]);
        const identify = (n: number) => query(closedEventIdentificationQuery(id(n), clock));
        for (const n of [10,11,12,13,999]) assert.deepEqual(await identify(n), []);
        assert.equal((await identify(8))[0].closedEarly, true);
        assert.equal((await identify(9))[0].scheduledDurationSeconds, 5400);

        let card = (await list({ search: '%_' }))[0];
        assert.deepEqual([card.participations, card.evaluationCount, card.evaluationMean], [0,0,null]);
        for (const [p, event] of [[20,1],[21,1],[22,2]]) {
          await client.query("INSERT INTO participations(id,event_id,user_id,arena_entered_at,status) VALUES($1,$2,$3,$4,'active')",
            [id(p), id(event), id(50), hoursFromClock(-170)]);
        }
        await client.query("INSERT INTO evaluations(id,participation_id,rating,comment) VALUES($1,$2,2,'PRIVADO'),($3,$4,1,NULL)",
          [id(30),id(20),id(31),id(22)]);
        await client.query('UPDATE evaluations SET rating=5 WHERE id=$1', [id(30)]);
        await client.query("INSERT INTO experiences(id,event_id,name) VALUES($1,$2,'Experiência')", [id(40),id(1)]);
        await client.query('INSERT INTO queue_entries(id,participation_id) VALUES($1,$2)', [id(41),id(20)]);
        await client.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,status,resolved_at) VALUES($1,$2,$3,'completed',$4)",
          [id(42),id(41),id(40),hoursFromClock(-169)]);
        card = (await list({ search: '%_' }))[0];
        assert.deepEqual([card.participations,card.evaluationCount,card.evaluationMean],[2,1,5]);
        const [event] = await identify(1);
        const [{ metrics }] = await query(eventBiQuery(id(1)));
        const summary = historySummary.parse({ ...metrics, event, observedAt: event.observedAt });
        assert.equal(summary.overview.participations,card.participations);
        assert.equal(summary.ratings.mean,card.evaluationMean);
        assert.equal(summary.ratings.count,card.evaluationCount);
        assert.equal(summary.ratings.distribution[4].count,1);
        assert.equal(summary.ranking.reduce((total,row)=>total+row.completed,0),summary.overview.completed);
        assert.deepEqual(summary.durationA,{ population:1,meanSeconds:3600 });
        assert.doesNotMatch(JSON.stringify(summary), /PRIVADO|audience|durationB/);
      } finally {
        try { await client.query('ROLLBACK'); } finally { client.release(); }
      }
    });
  } finally { await pool.end(); }
});
