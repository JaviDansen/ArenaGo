import assert from "node:assert/strict";
import { test } from "node:test";
import { grantAdminRoleBody, managedRoleResponse, revokeAdminRoleBody } from "../../src/auth/admin-role-management.dto";
import { shouldBlockLastAdminRevocation } from "../../src/auth/admin-role-management.service";

const uuid = "abcdef00-0000-4000-8000-000000000001";

test("T6.1-D DTO concede Admin global ou Staff com evento e normaliza e-mail", () => {
  assert.deepEqual(grantAdminRoleBody.parse({ role: "admin", email: "  USER@Example.Test " }),
    { role: "admin", email: "user@example.test" });
  assert.deepEqual(grantAdminRoleBody.parse({ role: "admin", email: "user@example.test", eventId: null }),
    { role: "admin", email: "user@example.test", eventId: null });
  assert.deepEqual(grantAdminRoleBody.parse({ role: "staff", email: " STAFF@Example.Test ", eventId: uuid }),
    { role: "staff", email: "staff@example.test", eventId: uuid });
});

test("T6.1-D DTO estrito recusa escopos, papéis, identificadores e propriedades extras inválidos", () => {
  for (const body of [
    { role: "admin", email: "a@example.test", eventId: uuid },
    { role: "staff", email: "a@example.test" },
    { role: "participante", email: "a@example.test" },
    { role: "staff", email: "a@example.test", eventId: "invalid" },
    { role: "admin", email: "invalid" },
    { role: "admin", email: "a@example.test", userId: uuid },
  ]) assert.equal(grantAdminRoleBody.safeParse(body).success, false);
  for (const body of [{}, { grantId: "invalid" }, { grantId: uuid, role: "admin" }]) {
    assert.equal(revokeAdminRoleBody.safeParse(body).success, false);
  }
});

test("T6.1-D resposta administrativa contém somente dados mínimos da concessão", () => {
  const value = { grant: { id: uuid, userId: uuid, role: "staff", eventId: uuid,
    grantedAt: "2026-11-06T12:00:00.000Z", revokedAt: null } };
  assert.deepEqual(managedRoleResponse.parse(value), value);
  for (const extra of [{ password: "secret" }, { email: "person@example.test" }, { secret: "totp" }, { recoveryCodes: ["code"] }]) {
    assert.equal(managedRoleResponse.safeParse({ grant: { ...value.grant, ...extra } }).success, false);
  }
});

test("T6.1-D impede somente a revogação que removeria o último Admin viável", () => {
  assert.equal(shouldBlockLastAdminRevocation(true, 0), true);
  assert.equal(shouldBlockLastAdminRevocation(true, 1), false);
  assert.equal(shouldBlockLastAdminRevocation(false, 0), false);
});
