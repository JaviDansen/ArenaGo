import assert from "node:assert/strict";
import type { MutationSession } from "../../src/auth/mutation-session";

export type SessionScenario = "valid" | "revoked" | "expired" | "foreign" | "inactive" | "admin" | "late" | "wait" | "intent-wait";
/** Simulação unitária do relógio/locks: não constitui evidência de concorrência PostgreSQL. */
export function sessionScenario(service: object, userId: string, scenario: SessionScenario = "valid") {
  const database = Reflect.get(service, "database") as { $client: { query: (config: { text: string }, params: unknown[]) => Promise<unknown> } };
  const client = database.$client, original = client.query.bind(client), queries: string[] = [];
  let checks = 0, invalidated = false;
  client.query = async (config, params) => {
    const text = config.text; queries.push(text);
    if (text.includes("SELECT s.revoked_at IS NOT NULL AS revoked")) {
      checks++;
      return { rows: scenario === "foreign" ? [] : [{ revoked: scenario === "revoked" || invalidated,
        expired: scenario === "expired" || scenario === "late" && checks > 1,
        active: scenario !== "inactive", admin: scenario === "admin", secondFactor: false, staff: true }] };
    }
    if (/SELECT id FROM (users|user_roles|sessions) WHERE/.test(text)) return { rows: [{ id: "auth-lock" }] };
    const result = await original(config, params);
    if (scenario === "wait" && /FOR (UPDATE|SHARE)/.test(text)) invalidated = true;
    if (scenario === "intent-wait" && text.includes('insert into "idempotency_operations"')) invalidated = true;
    return result;
  };
  const context: MutationSession = { userId, sessionId: "00000000-0000-4000-8000-000000000099" };
  return { context, queries, checks: () => checks };
}
export function assertSessionRefusal(error: unknown, code: string): boolean {
  assert.equal(Reflect.get(error as object, "problem").code, code); return true;
}
export function assertSessionTransaction(queries: string[], committed: boolean) {
  assert.equal(queries.at(-1), committed ? "commit" : "rollback");
  if (committed) assert.match(queries.at(-2)!, /SELECT s.revoked_at IS NOT NULL AS revoked/);
  const locks = ["SELECT id FROM users WHERE", "SELECT id FROM user_roles WHERE", "SELECT id FROM sessions WHERE"];
  for (let i = 1; i < locks.length; i++) assert.ok(queries.findIndex(q => q.includes(locks[i-1])) < queries.findIndex(q => q.includes(locks[i])));
}
