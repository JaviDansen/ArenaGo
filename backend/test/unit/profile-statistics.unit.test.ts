import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { ProfileController } from "../../src/profile/profile.controller";
import { ProfileService } from "../../src/profile/profile.service";

test("statistics uses only the authenticated user and a read-only aggregate", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { async query(sql: string, values: unknown[]) {
    calls.push({ sql, values });
    return { rows: [{ participation_count: values[0] === "A" ? "3" : "0", total_minutes: values[0] === "A" ? "135" : "0" }] };
  } } as unknown as Pool;
  const service = new ProfileService(pool);
  const controller = new ProfileController(service);
  assert.deepEqual(await controller.getStatistics("A"), { participationCount: 3, totalMinutes: 135 });
  assert.deepEqual(await controller.getStatistics("B"), { participationCount: 0, totalMinutes: 0 });
  assert.deepEqual(calls.map(call => call.values), [["A"], ["B"]]);
  const sql = calls[0].sql;
  assert.match(sql, /FROM participations WHERE user_id = \$1/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE arena_entered_at IS NOT NULL\)/);
  assert.match(sql, /status = 'finished'/);
  assert.match(sql, /isfinite\(arena_entered_at\).*isfinite\(finished_at\)/);
  assert.match(sql, /finished_at >= arena_entered_at/);
  assert.match(sql, /FLOOR\(COALESCE\(SUM\(EXTRACT\(EPOCH/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|TRUNCATE)\b/i);
});

test("simulated aggregate separates waiting, active, canceled and valid finished periods", async () => {
  const rows = [
    { user: "A", status: "waiting", entered: null, finished: null },
    { user: "A", status: "active", entered: 1000, finished: null },
    { user: "A", status: "canceled", entered: 1000, finished: 61000 },
    { user: "A", status: "finished", entered: 1000, finished: 91000 },
    { user: "A", status: "finished", entered: 1000, finished: 31000 },
    { user: "A", status: "finished", entered: null, finished: 61000 },
    { user: "A", status: "finished", entered: 61000, finished: 1000 },
    { user: "A", status: "finished", entered: Number.NEGATIVE_INFINITY, finished: 1000 },
    { user: "B", status: "finished", entered: 1000, finished: 601000 },
  ];
  const pool = { async query(sql: string, values: string[]) {
    assert.match(sql, /WHERE user_id = \$1/);
    assert.match(sql, /status = 'finished'/);
    assert.match(sql, /finished_at >= arena_entered_at/);
    const own = rows.filter(row => row.user === values[0]);
    const milliseconds = own.reduce((sum, row) => sum + (row.status === "finished" && row.entered !== null
      && row.finished !== null && Number.isFinite(row.entered) && Number.isFinite(row.finished)
      && row.finished >= row.entered ? row.finished - row.entered : 0), 0);
    return { rows: [{ participation_count: String(own.filter(row => row.entered !== null).length),
      total_minutes: String(Math.floor(milliseconds / 60000)) }] };
  } } as unknown as Pool;
  const service = new ProfileService(pool);
  assert.deepEqual(await service.getStatistics("A"), { participationCount: 6, totalMinutes: 2 });
  assert.deepEqual(await service.getStatistics("B"), { participationCount: 1, totalMinutes: 10 });
  assert.deepEqual(await service.getStatistics("C"), { participationCount: 0, totalMinutes: 0 });
});
