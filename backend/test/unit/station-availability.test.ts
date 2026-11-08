import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { StationAvailabilityService } from "../../src/events/station-availability.service";
import type { SetStationAvailabilityInput } from "../../src/events/station-availability.types";

const input: SetStationAvailabilityInput = { userId: "actor", sessionId: "session", eventId: "event", stationId: "station", availability: "unavailable" };
function fixture(options: { missing?: "event" | "discovery" | "experience" | "station" | "session";
  active?: boolean; verified?: boolean; roles?: readonly string[]; revoked?: boolean; expired?: boolean;
  secondFactor?: boolean; availability?: "available" | "unavailable"; pending?: boolean;
  ended?: boolean; expiredAtUpdate?: boolean; fail?: "update" | "audit"; auditCount?: number } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [], marker = new Error("E085_PRIVATE_FAILURE");
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.includes("SELECT id FROM events")) return { rows: options.missing === "event" ? [] : [{ id: "event" }] };
    if (text.includes('AS "experienceId"')) return { rows: options.missing === "discovery" ? [] : [{ experienceId: "experience" }] };
    if (text.includes("SELECT id FROM experiences")) return { rows: options.missing === "experience" ? [] : [{ id: "experience" }] };
    if (text.includes("SELECT availability FROM stations")) return { rows: options.missing === "station" ? [] : [{ availability: options.availability ?? "available" }] };
    if (text.includes("FROM users WHERE")) return { rows: [{ active: options.active ?? true, verified: options.verified ?? true }] };
    if (text.includes("SELECT role FROM user_roles")) return { rows: (options.roles ?? ["staff"]).map(role => ({ role })) };
    if (text.includes("SELECT id FROM sessions")) return { rows: options.missing === "session" ? [] : [{ id: "session" }] };
    if (text.includes('AS "secondFactor"')) return { rows: [{ revoked: options.revoked ?? false, expired: options.expired ?? false, secondFactor: options.secondFactor ?? false }] };
    if (text.includes("SELECT id FROM service_sessions")) return { rows: options.pending ? [{ id: "pending" }] : [] };
    if (text.includes("UPDATE stations s")) {
      if (options.fail === "update") throw marker;
      return { rows: options.ended || options.expiredAtUpdate ? [] : [{ id: "station" }] };
    }
    if (text.includes("SELECT expires_at <=")) return { rows: [{ expired: options.expiredAtUpdate ?? false }] };
    if (text.includes("INSERT INTO audit_logs")) {
      if (options.fail === "audit") throw marker;
      return { rows: options.auditCount === 0 ? [] : [{ id: "audit" }] };
    }
    throw new Error(`SQL não previsto na fixture E08.5: ${text}`);
  } } as unknown as Client, { schema });
  return { service: new StationAvailabilityService(database), queries, marker };
}
test("E08.5 desativa estação e audita na mesma transação READ COMMITTED", async () => {
  const f = fixture(); assert.deepEqual(await f.service.setAvailability(input), {
    kind: "changed", stationId: "station", availability: "unavailable", pendingServiceSessionId: null });
  assert.equal(f.queries[0].text, "begin isolation level read committed"); assert.equal(f.queries.at(-1)?.text, "commit");
  const update = f.queries.findIndex(q => q.text.includes("UPDATE stations s")), audit = f.queries.findIndex(q => q.text.includes("INSERT INTO audit_logs"));
  assert.ok(update > 0 && audit > update); assert.equal(f.queries.filter(q => q.text.includes("INSERT INTO audit_logs")).length, 1);
  assert.match(f.queries[audit].text, /'user','station','station_availability_changed'/); assert.match(f.queries[audit].text, /s.updated_at/);
  assert.ok(f.queries[audit].params.includes(input.userId)); assert.ok(f.queries[audit].params.includes("available")); assert.ok(f.queries[audit].params.includes("unavailable"));
});
test("E08.5 ordem evento exclusivo → experiência → estação → conta/papéis/sessão", async () => {
  const f = fixture(); await f.service.setAvailability(input);
  const order = ["SELECT id FROM events", 'AS "experienceId"', "SELECT id FROM experiences", "SELECT availability FROM stations", "FROM users WHERE", "SELECT role FROM user_roles", "SELECT id FROM sessions", 'AS "secondFactor"', "SELECT id FROM service_sessions", "UPDATE stations s"];
  for (let n=1;n<order.length;n++) assert.ok(f.queries.findIndex(q => q.text.includes(order[n-1])) < f.queries.findIndex(q => q.text.includes(order[n])), order[n]);
  for (const match of [order[0],order[2],order[3]]) assert.match(f.queries.find(q => q.text.includes(match))!.text, /FOR UPDATE/);
  for (const match of [order[4],order[5],order[6]]) assert.match(f.queries.find(q => q.text.includes(match))!.text, /FOR SHARE/);
  assert.equal(f.queries.some(q => /SKIP LOCKED|INSERT INTO idempotency|UPDATE experiences|UPDATE events|UPDATE queue_entries|UPDATE participations/.test(q.text)), false);
});
test("E08.5 Admin global com 2FA opera sem Staff; papel Staff exige e-mail verificado", async () => {
  const f = fixture({ roles: ["admin"], secondFactor: true, verified: false }); assert.equal((await f.service.setAvailability(input)).kind, "changed");
  const auth = f.queries.find(q => q.text.includes("SELECT role FROM user_roles"))!;
  assert.match(auth.text, /role='staff' AND event_id=/); assert.match(auth.text, /role='admin' AND event_id IS NULL/); assert.match(auth.text, /revoked_at IS NULL/);
});
for (const [name, options, kind] of [
  ["evento ausente", { missing: "event" }, "access_denied"],
  ["estação ausente/alheia", { missing: "discovery" }, "access_denied"],
  ["experiência alterada após descoberta", { missing: "experience" }, "access_denied"],
  ["estação alterada após espera", { missing: "station" }, "access_denied"],
  ["conta inativa", { active: false }, "account_inactive"],
  ["Staff revogado/alheio", { roles: [] }, "access_denied"],
  ["Staff não verificado", { verified: false }, "access_denied"],
  ["sessão ausente", { missing: "session" }, "invalid_session"],
  ["sessão revogada", { revoked: true }, "session_revoked"],
  ["sessão expirada após locks", { expired: true }, "session_expired"],
  ["Admin sem 2FA mesmo também Staff", { roles: ["admin", "staff"] }, "admin_2fa_required"],
  ["operação encerrada no UPDATE", { ended: true }, "event_operation_ended"],
  ["sessão expirada no UPDATE", { expiredAtUpdate: true }, "session_expired"],
] as const) test(`E08.5 recusa ${name} sem escrita ou auditoria`, async () => {
  const f = fixture(options); assert.deepEqual(await f.service.setAvailability(input), { kind });
  assert.equal(f.queries.some(q => q.text.includes("INSERT INTO audit_logs")), false);
  if (!options || !("ended" in options || "expiredAtUpdate" in options)) assert.equal(f.queries.some(q => q.text.includes("UPDATE stations s")), false);
});
test("E08.5 reativação altera somente configuração da estação e audita valores invertidos", async () => {
  const f = fixture({ availability: "unavailable" }); const r = await f.service.setAvailability({ ...input, availability: "available" });
  assert.deepEqual(r, { kind: "changed", stationId: "station", availability: "available", pendingServiceSessionId: null });
  const update = f.queries.find(q => q.text.includes("UPDATE stations s"))!;
  assert.match(update.text, /clock_timestamp\(\)/); assert.match(update.text, /d.at < e.operational_deadline_at/); assert.match(update.text, /d.at < e.admin_deadline_at/);
  assert.doesNotMatch(update.text, /official_ends_at|closure_requested_at|queue_accepting_entries/);
  assert.match(update.text, /d.at < a.expires_at/); assert.match(update.text, /e.status <> 'closed'/);
});
test("E08.5 no-op preserva estado inclusive pending e não executa UPDATE nem auditoria", async () => {
  for (const availability of ["available", "unavailable"] as const) {
    const f = fixture({ availability, pending: availability === "available", ended: true });
    const r = await f.service.setAvailability({ ...input, availability });
    assert.deepEqual(r, { kind: "unchanged", stationId: "station", availability, pendingServiceSessionId: availability === "available" ? "pending" : null });
    assert.equal(f.queries.some(q => /UPDATE stations|INSERT INTO audit_logs/.test(q.text)), false);
  }
});
test("E08.5 pending bloqueia desativação sem escrita e retorna estado atual mínimo", async () => {
  const f = fixture({ pending: true }); assert.deepEqual(await f.service.setAvailability(input), {
    kind: "station_has_pending_call", stationId: "station", availability: "available", pendingServiceSessionId: "pending" });
  assert.equal(f.queries.some(q => /UPDATE stations|INSERT INTO audit_logs/.test(q.text)), false);
});
test("E08.5 falha de UPDATE/auditoria propaga causa e solicita rollback integral", async () => {
  for (const fail of ["update", "audit"] as const) {
    const f = fixture({ fail }); await assert.rejects(f.service.setAvailability(input), error => error instanceof Error && error.cause === f.marker);
    assert.equal(f.queries.at(-1)?.text, "rollback"); assert.equal(f.queries.some(q => q.text === "commit"), false);
  }
  const f = fixture({ auditCount: 0 }); await assert.rejects(f.service.setAvailability(input), /exatamente um registro/);
  assert.equal(f.queries.at(-1)?.text, "rollback");
});
test("E08.5 serviço rejeita disponibilidade inválida antes de abrir transação", async () => {
  const f = fixture(); await assert.rejects(f.service.setAvailability({ ...input, availability: "occupied" as never }), /inválida/); assert.equal(f.queries.length, 0);
});
