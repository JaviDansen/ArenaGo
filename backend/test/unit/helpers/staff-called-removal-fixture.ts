import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../../src/database/schema";
import { CalledRemovalService, createCalledRemovalServiceFingerprint } from "../../../src/events/staff-called-removal.service";
import type { CalledRemovalServiceInput } from "../../../src/events/staff-called-removal.types";

const input: CalledRemovalServiceInput = { staffUserId: "00000000-0000-4000-8000-000000000001", eventId: "event", serviceSessionId: "session",
  idempotencyKey: "remove-called-intent", expiresAt: new Date("2099-01-01") };
const at = new Date("2026-11-02T18:00:00Z");
const payload = { serviceSession: { id: input.serviceSessionId, status: "canceled", cancelReason: "staff_queue_removed", resolvedAt: at.toISOString() },
  queueEntry: { status: "closed", closeReason: "staff_queue_removed" }, participation: { status: "active", currentQueueEntryId: null } };

function fixture(options: {
  missing?: "target" | "event" | "experience" | "station" | "staff" | "person" | "entry" | "session";
  status?: string; participantStatus?: string; pointer?: string | null; entryStatus?: string;
  ended?: boolean; clock?: number; closeCount?: number; clearCount?: number;
  reservation?: "replay" | "conflict" | "in_progress"; replayPayload?: unknown;
  fail?: "resolve" | "close" | "clear" | "complete" | "audit";
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const marker = new Error(`PRIVATE_CALLED_REMOVAL_${options.fail}`);
  const state = { session: options.status ?? 'pending', entry: options.entryStatus ?? 'called',
    currentId: options.pointer === undefined ? 'entry' : options.pointer, audit: 0, reservation: 0 };
  let snapshot = { ...state };
  const client = { async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (text.startsWith('begin')) snapshot = { ...state };
    if (text === 'rollback') Object.assign(state, snapshot);
    if (text.includes('SELECT s.experience_id AS "experienceId"')) return { rows: options.missing === "target" ? [] : [{ experienceId: "experience", stationId: "station", queueEntryId: "entry", participationId: "person" }] };
    if (text.includes('SELECT id, name, access_code_normalized AS "accessCodeNormalized"') && text.includes("FROM events WHERE id=")) {
      return { rows: options.missing === "event" ? [] : [{ id: input.eventId, name: "Synthetic event",
        accessCodeNormalized: "synthetic", timezone: "UTC", startsAtMs: at.getTime() - 3_600_000,
        officialEndsAtMs: at.getTime() + 3_600_000, operationalDeadlineAtMs: at.getTime() + 5_400_000,
        externalQueueEnabled: true }] };
    }
    if (text.includes("SELECT id FROM events")) return { rows: options.missing === "event" ? [] : [{ id: input.eventId }] };
    if (text.includes("SELECT id FROM experiences")) return { rows: options.missing === "experience" ? [] : [{ id: "experience" }] };
    if (text.includes("SELECT id FROM stations")) return { rows: options.missing === "station" ? [] : [{ id: "station" }] };
    if (text.includes("SELECT r.id FROM users")) return { rows: options.missing === "staff" ? [] : [{ id: "role" }] };
    if (text.includes('AS "currentId"')) return { rows: options.missing === "person" ? [] : [{ status: options.participantStatus ?? "active", currentId: state.currentId }] };
    if (text.includes("SELECT status FROM queue_entries")) return { rows: options.missing === "entry" ? [] : [{ status: state.entry }] };
    if (text.includes("SELECT status FROM service_sessions")) return { rows: options.missing === "session" ? [] : [{ status: state.session }] };
    if (text.includes('insert into "idempotency_operations"')) { if (!options.reservation) state.reservation++; return { rows: options.reservation ? [] : [["reservation"]] }; }
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
      options.reservation === "conflict" ? "other" : createCalledRemovalServiceFingerprint(input.eventId, input.serviceSessionId),
      options.reservation === "in_progress" ? "in_progress" : "completed", 200, input.serviceSessionId, options.replayPayload ?? payload]] };
    if (text.includes("UPDATE service_sessions s SET")) {
      if (options.fail === "resolve") throw marker;
      if (!options.ended) state.session = 'canceled';
      return { rows: options.ended ? [] : [{ resolvedAtMs: options.clock ?? at.getTime() }] };
    }
    if (text.includes("UPDATE queue_entries q SET")) {
      if (options.fail === "close") throw marker;
      state.entry = 'closed';
      return { rows: options.closeCount === 0 ? [] : [{ id: "entry" }] };
    }
    if (text.includes("UPDATE participations SET")) {
      if (options.fail === "clear") throw marker;
      state.currentId = null;
      return { rows: options.clearCount === 0 ? [] : [{ id: "person" }] };
    }
    if (text.includes('INSERT INTO audit_logs')) {
      if (options.fail === "audit") throw marker;
      state.audit++;
      return { rows: [{ id: "audit" }] };
    }
    if (text.includes('update "idempotency_operations"')) {
      if (options.fail === "complete") throw marker;
      return { rows: [["reservation", 200, input.serviceSessionId, payload]] };
    }
    return { rows: [] };
  } };
  const database = drizzle(client as unknown as Client, { schema });
  const transaction = database.transaction.bind(database);
  let tail: Promise<unknown> = Promise.resolve();
  // Serialização simulada do lock compartilhado da experiência; não comprova locks PostgreSQL.
  database.transaction = ((...args: Parameters<typeof database.transaction>) => {
    const result = tail.then(() => transaction(...args));
    tail = result.catch(() => undefined);
    return result;
  }) as typeof database.transaction;
  return { service: new CalledRemovalService(database), database, queries, marker, state };
}


export { fixture, input, at, payload };
