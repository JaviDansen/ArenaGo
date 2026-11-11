import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { StaffIdempotencyPolicy } from "../../src/events/staff-idempotency.policy";
import { StaffEntryController, StaffEntryNoStoreGuard } from "../../src/participations/staff-entry.controller";
import { StaffEntryService } from "../../src/participations/staff-entry.service";
import { entryFixture, actor, id } from "./helpers/staff-entry-fixture";

let fixture = entryFixture();
@Module({ controllers: [StaffEntryController], providers: [SessionAuthGuard, StaffEntryNoStoreGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== "valid") throw new ProblemException({ status: 401, code: "INVALID_SESSION", typeSlug: "invalid-session", title: "Sessão inválida", detail: "Sessão inválida." });
    return { userId: actor.userId, sessionId: actor.sessionId, roles: ["staff"] };
  } } }, { provide: StaffEntryService, useValue: { read: (...args: Parameters<StaffEntryService["read"]>) => fixture.service.read(...args),
    confirm: (...args: Parameters<StaffEntryService["confirm"]>) => fixture.service.confirm(...args),
    setEnabled: (...args: Parameters<StaffEntryService["setEnabled"]>) => fixture.service.setEnabled(...args) } },
  { provide: StaffIdempotencyPolicy, useValue: { expiresAt: () => new Date("2099-01-01") } },
] }) class EntryModule {}
let app: INestApplication;
before(async () => { app = await NestFactory.create(EntryModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, "127.0.0.1"); });
after(async () => { await app?.close(); });
const base = `/api/v1/staff/events/${actor.eventId}/entry-control`;
test("HTTP real do controller/serviço exige Bearer, UUID e chave, rejeitando identidade no corpo", async () => {
  fixture = entryFixture();
  for (const response of [await supertest(app.getHttpServer()).get(base), await supertest(app.getHttpServer()).patch(base).send({ enabled: false }),
    await supertest(app.getHttpServer()).post(`${base}/participants/${id(4)}/confirm`).send({})]) {
    assert.equal(response.status, 401); assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(fixture.queries.length, 0);
  assert.equal((await supertest(app.getHttpServer()).get(base.replace(actor.eventId, "bad")).set("Authorization", "Bearer valid")).status, 400);
  for (const body of [{ enabled: false, userId: id(90) }, { enabled: "false" }, {}]) {
    assert.equal((await supertest(app.getHttpServer()).patch(base).set("Authorization", "Bearer valid").set("Idempotency-Key", id(20)).send(body)).status, 400);
  }
  assert.equal((await supertest(app.getHttpServer()).post(`${base}/participants/${id(4)}/confirm`).set("Authorization", "Bearer valid").send({})).status, 400);
});
test("HTTP utiliza principal, identifica minimamente e confirma FIFO com resposta 200", async () => {
  fixture = entryFixture();
  const read = await supertest(app.getHttpServer()).get(base).query({ userId: id(99), sessionId: id(98) }).set("Authorization", "Bearer valid");
  assert.equal(read.status, 200); assert.equal(read.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(read.body.waiting[0]).sort(), ["displayName", "participationId", "position"]);
  const session = fixture.queries.find(q => q.text.includes("SELECT s.id FROM sessions"))!;
  assert.deepEqual(session.params, [actor.sessionId, actor.userId]);
  const denied = await supertest(app.getHttpServer()).post(`${base}/participants/${id(5)}/confirm`).set("Authorization", "Bearer valid").set("Idempotency-Key", id(20)).send({});
  assert.equal(denied.status, 409); assert.equal(denied.body.code, "ENTRY_NOT_FIRST");
  const confirmed = await supertest(app.getHttpServer()).post(`${base}/participants/${id(4)}/confirm`).set("Authorization", "Bearer valid").set("Idempotency-Key", id(21)).send({});
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.participation.status, "active");
  const off = await supertest(app.getHttpServer()).patch(base).set("Authorization", "Bearer valid").set("Idempotency-Key", id(22)).send({ enabled: false });
  assert.equal(off.status, 200); assert.equal(off.body.releasedCount, 1);
});
test("HTTP revalida Staff/sessão após guard e protege erro interno com no-store", async () => {
  fixture = entryFixture(); fixture.flags.staff = false;
  const denied = await supertest(app.getHttpServer()).get(base).set("Authorization", "Bearer valid"); assert.equal(denied.status, 404);
  fixture.flags.staff = true; fixture.flags.revoked = true;
  assert.equal((await supertest(app.getHttpServer()).get(base).set("Authorization", "Bearer valid")).status, 401);
  fixture = entryFixture(); fixture.flags.fail = true;
  const failed = await supertest(app.getHttpServer()).patch(base).set("Authorization", "Bearer valid").set("Idempotency-Key", id(20)).send({ enabled: false });
  assert.equal(failed.status, 500); assert.equal(failed.body.code, "INTERNAL_SERVER_ERROR");
  assert.equal(failed.headers["cache-control"], "no-store"); assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE|audit_logs|participations/);
  assert.deepEqual(fixture.state.people.map(p => p.status), ["waiting", "waiting"]);
});
