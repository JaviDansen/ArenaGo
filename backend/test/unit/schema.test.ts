import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import * as schema from "../../src/database/schema";

test("schema exporta as tabelas existentes e a preparação de marcos uma única vez", () => {
  const tables = Object.values(schema);
  const names = tables.map((table) => getTableName(table));
  assert.equal(names.length, 25);
  assert.equal(new Set(names).size, 25);
  assert.equal(getTableName(schema.adminTwoFactorChallenges), "admin_2fa_challenges");
  assert.deepEqual(new Set(names), new Set([
    "users", "questionnaire_versions", "profiles", "games", "user_games",
    "sessions", "refresh_tokens", "password_reset_tokens", "email_verification_tokens",
    "user_roles", "user_totp_credentials", "user_backup_codes", "totp_activation_tokens", "audit_logs",
    "events", "experiences", "stations", "participations", "queue_entries", "service_sessions",
    "evaluations", "participation_profile_snapshots", "idempotency_operations", "admin_2fa_challenges", "staff_idempotency_epochs",
  ]));
});
