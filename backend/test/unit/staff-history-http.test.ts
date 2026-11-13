import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { DRIZZLE_DATABASE } from "../../src/database/database.module";
import * as schema from "../../src/database/schema";
import { createCallNextFingerprint } from "../../src/events/call-next.service";
import { StaffHistoryController, StaffHistoryNoStoreGuard } from "../../src/events/staff-history.controller";
import { StaffHistoryService } from "../../src/events/staff-history.service";

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(1), sessionId = id(2), eventId = id(3), experienceId = id(4), stationId = id(5), serviceSessionId = id(6), key = id(7);
const base = `/api/v1/staff/events/${eventId}`;
const paths = [`${base}/experiences/${experienceId}/stations/${stationId}/history/call-next`,
  `${base}/service-sessions/${serviceSessionId}/history/complete`, `${base}/service-sessions/${serviceSessionId}/history/absent`];
let calls: unknown[][] = [], result: Record<string, unknown> = { kind: "unknown", originSession: "unavailable", automaticReconciliation: false };
@Module({ controllers: [StaffHistoryController], providers: [StaffHistoryNoStoreGuard, SessionAuthGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "valid") throw new ProblemException({ typeSlug: "invalid-session", title: "Inválida", status: 401, code: "INVALID_SESSION", detail: "Inválida." });
    return { userId, sessionId, roles: ["staff"] };
  } } },
  { provide: StaffHistoryService, useValue: { find: async (...args: unknown[]) => { calls.push(args); return result; } } },
] }) class HistoryModule {}
let app: INestApplication;
before(async () => { app = await NestFactory.create(HistoryModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1"); });
after(async () => { await app?.close(); });
const get = (path: string) => supertest(app.getHttpServer()).get(path).set("Authorization", "Bearer valid").set("Idempotency-Key", key);

test("histórico HTTP exige Bearer, sessão válida, chave e UUIDs", async () => {
  calls = [];
  const noBearer = await supertest(app.getHttpServer()).get(paths[0]).set("Idempotency-Key", key);
  assert.equal(noBearer.status, 401); assert.equal(noBearer.headers["cache-control"], "no-store");
  assert.equal((await get(paths[0]).set("Authorization", "Bearer revoked")).status, 401);
  assert.equal((await supertest(app.getHttpServer()).get(paths[0]).set("Authorization", "Bearer valid")).status, 400);
  assert.equal((await get(paths[0]).set("Idempotency-Key", "a".repeat(129))).status, 400);
  assert.equal((await get(paths[0].replace(eventId, "invalid"))).status, 400);
  assert.equal(calls.length, 0);
});

test("histórico HTTP utiliza principal autenticado, escopos de rota e no-store", async () => {
  calls = []; result = { kind: "unknown", originSession: "unavailable", automaticReconciliation: false };
  for (const path of paths) {
    const response = await get(path).query({ userId: id(9), sessionId: id(10) });
    assert.equal(response.status, 200); assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.body, result);
  }
  assert.deepEqual(calls, [
    [userId, sessionId, key, { kind: "call-next", eventId, experienceId, stationId }],
    [userId, sessionId, key, { kind: "complete", eventId, serviceSessionId }],
    [userId, sessionId, key, { kind: "absent", eventId, serviceSessionId }],
  ]);
});

test("histórico HTTP diferencia registro terminal, acesso negado e sessão invalidada", async () => {
  result = { kind: "recorded", originSession: "unavailable", automaticReconciliation: false, result: { serviceSession: { id: serviceSessionId } } };
  assert.deepEqual((await get(paths[0])).body, result);
  result = { kind: "access_denied" }; assert.equal((await get(paths[0])).status, 404);
  result = { kind: "session_invalid" }; assert.equal((await get(paths[0])).status, 401);
});

test("HTTP com controller e serviço reais revalida sessão e concessão e trata falha da consulta histórica", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let sessionAllowed = true, staffAllowed = true, failHistory = false, guardCalls = 0;
  const database = drizzle({ async query(config: { text: string }, params: unknown[] = []) {
    const text = config.text; queries.push({ text, params });
    if (text.includes("FROM sessions s JOIN users")) return { rows: sessionAllowed ? [{ id: sessionId }] : [] };
    if (text.includes("FROM events e")) return { rows: staffAllowed ? [{ id: eventId }] : [] };
    if (text.includes("FROM idempotency_operations")) {
      if (failHistory) throw new Error("PRIVATE_DATABASE_MARKER");
      return { rows: [{ status: "completed", httpStatus: 201, resultReference: serviceSessionId,
        resultPayload: { serviceSession: { id: serviceSessionId, queueEntryId: id(8), experienceId,
          station: { id: stationId, label: "Estação" }, status: "pending", calledAt: "2026-11-03T15:00:00.000Z" },
        privateValue: "PRIVATE_PAYLOAD_MARKER" } }] };
    }
    return { rows: [] };
  } } as unknown as Client, { schema });
  @Module({ controllers: [StaffHistoryController], providers: [StaffHistoryNoStoreGuard, SessionAuthGuard, StaffHistoryService,
    { provide: DRIZZLE_DATABASE, useValue: database },
    { provide: AuthService, useValue: { authenticateBearerToken: async () => { guardCalls++; return { userId, sessionId, roles: ["staff"] }; } } },
  ] }) class RealHistoryModule {}
  const real = await NestFactory.create(RealHistoryModule, { logger: false });
  real.setGlobalPrefix("api/v1"); real.useGlobalFilters(new ProblemDetailsExceptionFilter());
  await real.listen(0, "127.0.0.1");
  const request = () => supertest(real.getHttpServer()).get(paths[0]).set("Authorization", "Bearer valid").set("Idempotency-Key", key);
  try {
    sessionAllowed = false;
    const revoked = await request(); assert.equal(revoked.status, 401); assert.equal(revoked.headers["cache-control"], "no-store");
    assert.deepEqual(queries[1].params, [sessionId, userId]);
    assert.equal(queries.some(q => q.text.includes("FROM events e")), false);
    queries.length = 0; sessionAllowed = true; staffAllowed = false;
    const denied = await request(); assert.equal(denied.status, 404); assert.equal(denied.headers["cache-control"], "no-store");
    assert.deepEqual(queries[2].params, [eventId, userId]);
    assert.equal(queries.some(q => q.text.includes("FROM idempotency_operations")), false);
    queries.length = 0; staffAllowed = true;
    const found = await request(); assert.equal(found.status, 200); assert.equal(found.body.kind, "recorded");
    assert.equal(found.body.originSession, "unavailable"); assert.equal(found.body.automaticReconciliation, false);
    assert.doesNotMatch(JSON.stringify(found.body), /PRIVATE_PAYLOAD_MARKER/);
    assert.deepEqual(queries[3].params, [userId, "call_next", key, createCallNextFingerprint(eventId, experienceId, stationId)]);
    queries.length = 0; failHistory = true;
    const failure = await request(); assert.equal(failure.status, 500); assert.equal(failure.body.code, "INTERNAL_SERVER_ERROR");
    assert.equal(failure.headers["cache-control"], "no-store"); assert.doesNotMatch(JSON.stringify(failure.body), /PRIVATE_DATABASE_MARKER|idempotency_operations/);
    assert.equal(queries[0].text, "begin isolation level repeatable read read only");
    assert.equal(queries.at(-1)?.text, "rollback"); assert.equal(queries.some(q => q.text === "commit"), false);
    assert.equal(queries.some(q => /\b(insert|update|delete|for update|for share)\b/i.test(q.text)), false);
    assert.equal(guardCalls, 4);
  } finally { await real.close(); }
});
