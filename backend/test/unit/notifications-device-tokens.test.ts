import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import supertest from "supertest";
import { AuthService } from "../../src/auth/auth.service";
import { SessionAuthGuard } from "../../src/auth/session-auth.guard";
import { ProblemDetailsExceptionFilter } from "../../src/common/errors/problem-details.filter";
import { ProblemException } from "../../src/common/errors/problem.exception";
import { DeviceTokensController } from "../../src/notifications/device-tokens.controller";
import {
  registerPushTokenSchema,
  unregisterPushTokenSchema,
  validateDto,
} from "../../src/notifications/device-tokens.dto";
import { DeviceTokensService } from "../../src/notifications/device-tokens.service";

const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000099";
const validToken = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

const capturedCalls: Array<{ op: string; userId: string; dto: unknown }> = [];

@Module({
  controllers: [DeviceTokensController],
  providers: [
    SessionAuthGuard,
    {
      provide: AuthService,
      useValue: {
        authenticateBearerToken: async (token: string) => {
          if (token !== "valid-bearer-token") {
            throw new ProblemException({
              typeSlug: "invalid-access-token",
              title: "Token inválido",
              status: 401,
              code: "INVALID_ACCESS_TOKEN",
              detail: "O token de acesso informado é inválido.",
            });
          }
          return { userId, sessionId, roles: ["participante"] };
        },
      },
    },
    {
      provide: DeviceTokensService,
      useValue: {
        registerToken: async (uid: string, dto: unknown) => {
          capturedCalls.push({ op: "register", userId: uid, dto });
          return { status: "registered" as const };
        },
        unregisterToken: async (uid: string, dto: unknown) => {
          capturedCalls.push({ op: "unregister", userId: uid, dto });
          return { unlinked: true };
        },
      },
    },
  ],
})
class DeviceTokensHttpTestModule {}

let app: INestApplication;

before(async () => {
  app = await NestFactory.create(DeviceTokensHttpTestModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemDetailsExceptionFilter());
  await app.listen(0, "127.0.0.1");
});

after(async () => {
  await app?.close();
});

test("DeviceTokens DTO: valida limites de tamanho de pushToken e opções de plataforma", () => {
  const valid = validateDto(registerPushTokenSchema, { pushToken: validToken });
  assert.equal(valid.pushToken, validToken);
  assert.equal(valid.platform, "android");

  const validIos = validateDto(registerPushTokenSchema, { pushToken: validToken, platform: "ios" });
  assert.equal(validIos.platform, "ios");

  assert.throws(
    () => validateDto(registerPushTokenSchema, { pushToken: "short" }),
    (err: unknown) => err instanceof ProblemException && err.problem.code === "INVALID_REQUEST_BODY",
  );

  assert.throws(
    () => validateDto(registerPushTokenSchema, { pushToken: validToken, platform: "windows" }),
    (err: unknown) => err instanceof ProblemException && err.problem.code === "INVALID_REQUEST_BODY",
  );

  const unreg = validateDto(unregisterPushTokenSchema, { pushToken: validToken });
  assert.equal(unreg.pushToken, validToken);
});

test("DeviceTokensService: registra novo token e atualiza token existente em caso de troca de usuário", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  let queryIndex = 0;
  const mockDb = {
    execute: async (_query: unknown) => {
      queries.push({ sql: String(_query), params: [] });
      queryIndex++;
      if (queryIndex === 1) {
        return { rows: [] };
      }
      if (queryIndex === 3) {
        return { rows: [{ id: "token-id-1", userId: "other-user" }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const service = new DeviceTokensService(mockDb as any);

  const r1 = await service.registerToken(userId, { pushToken: validToken, platform: "android" });
  assert.equal(r1.status, "registered");

  const r2 = await service.registerToken(userId, { pushToken: validToken, platform: "android" });
  assert.equal(r2.status, "updated");
});

test("DeviceTokensService: unregisterToken e revogação de tokens inválidos", async () => {
  const executed: string[] = [];
  const mockDb = {
    execute: async (q: unknown) => {
      executed.push(String(q));
      return { rows: [], rowCount: 1 };
    },
  };

  const service = new DeviceTokensService(mockDb as any);

  const unreg = await service.unregisterToken(userId, { pushToken: validToken });
  assert.equal(unreg.unlinked, true);

  await service.revokeAllUserTokens(userId);
  await service.revokeInvalidToken(validToken);

  assert.equal(executed.length, 3);
});

test("DeviceTokensController HTTP: exige Bearer Token em POST e DELETE /api/v1/devices/push-token", async () => {
  capturedCalls.length = 0;

  // Sem Authorization -> 401
  const postNoAuth = await supertest(app.getHttpServer())
    .post("/api/v1/devices/push-token")
    .send({ pushToken: validToken, platform: "android" });
  assert.equal(postNoAuth.status, 401);

  const delNoAuth = await supertest(app.getHttpServer())
    .delete("/api/v1/devices/push-token")
    .send({ pushToken: validToken });
  assert.equal(delNoAuth.status, 401);
  assert.equal(capturedCalls.length, 0);

  // Com Authorization válido -> 200 OK
  const postOk = await supertest(app.getHttpServer())
    .post("/api/v1/devices/push-token")
    .set("Authorization", "Bearer valid-bearer-token")
    .send({ pushToken: validToken, platform: "android" });
  assert.equal(postOk.status, 200);
  assert.deepEqual(postOk.body, { status: "registered" });
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].op, "register");
  assert.equal(capturedCalls[0].userId, userId);

  const delOk = await supertest(app.getHttpServer())
    .delete("/api/v1/devices/push-token")
    .set("Authorization", "Bearer valid-bearer-token")
    .send({ pushToken: validToken });
  assert.equal(delOk.status, 200);
  assert.deepEqual(delOk.body, { unlinked: true });
  assert.equal(capturedCalls.length, 2);
  assert.equal(capturedCalls[1].op, "unregister");
  assert.equal(capturedCalls[1].userId, userId);
});
