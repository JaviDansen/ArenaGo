import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  registerPushTokenSchema,
  unregisterPushTokenSchema,
  validateDto,
} from "../../src/notifications/device-tokens.dto";
import { DeviceTokensService } from "../../src/notifications/device-tokens.service";
import { ProblemException } from "../../src/common/errors/problem.exception";

const userId = "00000000-0000-4000-8000-000000000001";
const validToken = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

test("DeviceTokens DTO: valida limites de tamanho de pushToken e opções de plataforma", () => {
  // Válido
  const valid = validateDto(registerPushTokenSchema, { pushToken: validToken });
  assert.equal(valid.pushToken, validToken);
  assert.equal(valid.platform, "android");

  const validIos = validateDto(registerPushTokenSchema, { pushToken: validToken, platform: "ios" });
  assert.equal(validIos.platform, "ios");

  // Rejeita curto (<10)
  assert.throws(
    () => validateDto(registerPushTokenSchema, { pushToken: "short" }),
    (err: unknown) => err instanceof ProblemException && err.problem.code === "INVALID_REQUEST_BODY",
  );

  // Rejeita plataforma inválida
  assert.throws(
    () => validateDto(registerPushTokenSchema, { pushToken: validToken, platform: "windows" }),
    (err: unknown) => err instanceof ProblemException && err.problem.code === "INVALID_REQUEST_BODY",
  );

  // Unregister DTO valida token
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
        // Primeira busca: não existe
        return { rows: [] };
      }
      if (queryIndex === 3) {
        // Terceira busca: token já existe para outro usuário
        return { rows: [{ id: "token-id-1", userId: "other-user" }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const service = new DeviceTokensService(mockDb as any);

  // 1. Inserção
  const r1 = await service.registerToken(userId, { pushToken: validToken, platform: "android" });
  assert.equal(r1.status, "registered");

  // 2. Atualização / rotação de conta no mesmo aparelho
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
