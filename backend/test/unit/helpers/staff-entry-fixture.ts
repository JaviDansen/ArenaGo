import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "../../../src/database/schema";
import { EventsService } from "../../../src/events/events.service";
import type { EventAvailabilityResult } from "../../../src/events/event-availability";
import { ParticipationsService } from "../../../src/participations/participations.service";
import { StaffEntryService } from "../../../src/participations/staff-entry.service";

export const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const actor = { userId: id(1), sessionId: id(2), eventId: id(3) };
export const at = "2026-11-10T15:00:00.000Z";
export const intent = (n = 20) => ({ ...actor, idempotencyKey: id(n), expiresAt: new Date("2099-01-01") });
export function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
type Receipt = { id: string; hash: string; status: string; httpStatus: number | null; reference: string | null; payload: unknown };
type State = { enabled: boolean; people: Array<{ id: string; name: string; status: string }>; receipts: Map<string, Receipt> };
export function entryFixture() {
  const flags = { exists: true, staff: true, active: true, verified: true, revoked: false, expired: false,
    admin: false, secondFactor: true, manage: true, fail: false, hold: null as null | { entered: () => void; until: Promise<void> } };
  const state: State = { enabled: true, people: [{ id: id(4), name: "Ana", status: "waiting" },
    { id: id(5), name: "Bia", status: "waiting" }], receipts: new Map() };
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let eventQueue = Promise.resolve();
  // Simula a exclusão solicitada pelo SQL. Não prova locks físicos PostgreSQL.
  class EntryFixturePool {
    async connect() {
      let unlock: (() => void) | undefined, snapshot: State | undefined;
      const lock = async () => {
        if (unlock) return;
        const previous = eventQueue;
        eventQueue = new Promise<void>(yes => { unlock = yes; });
        await previous;
        snapshot = { enabled: state.enabled, people: structuredClone(state.people), receipts: structuredClone(state.receipts) };
      };
      return { release() {}, async query(config: { text: string }, params: unknown[] = []) {
        const text = config.text; queries.push({ text, params });
        if (text.startsWith("begin")) return { rows: [] };
        if (text === "commit" || text === "rollback") {
          if (text === "rollback" && snapshot) Object.assign(state, snapshot);
          unlock?.(); unlock = undefined; return { rows: [] };
        }
        if ((text.includes("FROM events WHERE") || text.includes('from "events"')) && /for update/i.test(text)) {
          await lock();
          return { rows: !flags.exists ? [] : text.includes('from "events"') ? [[state.enabled]] : [{ id: actor.eventId }] };
        }
        if (text.includes('from "participations"') && /for update/i.test(text)) return { rows: state.people.filter(p => p.status === "waiting").map(p => [p.id]) };
        if (text.includes('SELECT id, external_queue_order::text')) return { rows: state.people.filter(p => p.status === "waiting").slice(0, 1).map(p => ({ id: p.id, order: "1" })) };
        if (text.includes("SELECT id FROM users") || text.includes("SELECT id FROM user_roles") || text.includes("SELECT id FROM sessions")) return { rows: [{ id: id(9) }] };
        if (text.includes('AS "secondFactor"')) return { rows: [{ revoked: flags.revoked, expired: flags.expired,
          active: flags.active, secondFactor: flags.secondFactor, admin: flags.admin, staff: flags.staff && flags.verified }] };
        if (text.includes("SELECT s.id FROM sessions")) return { rows: flags.revoked || flags.expired || !flags.active ||
          (flags.admin && !flags.secondFactor) ? [] : [{ id: actor.sessionId }] };
        if (text.includes('AS "observedAt" FROM events')) return { rows: flags.exists && flags.staff && flags.verified
          ? [{ enabled: state.enabled, observedAt: at }] : [] };
        if (text.includes("row_number() OVER")) return { rows: state.people.filter(p => p.status === "waiting")
          .map((p, i) => ({ participationId: p.id, displayName: p.name, position: String(i + 1), order: String(i + 1) })) };
        if (text.includes('insert into "idempotency_operations"')) {
          const slot = `${params[1]}:${params[2]}:${params[3]}`;
          if (state.receipts.has(slot)) return { rows: [] };
          state.receipts.set(slot, { id: String(params[0]), hash: String(params[4]), status: "in_progress", httpStatus: null, reference: null, payload: null });
          return { rows: [[params[0]]] };
        }
        if (text.includes('from "idempotency_operations"')) {
          const found = state.receipts.get(`${params[0]}:${params[1]}:${params[2]}`);
          return { rows: found ? [[found.id, found.hash, found.status, found.httpStatus, found.reference, found.payload]] : [] };
        }
        if (text.includes("UPDATE participations p SET")) {
          if (flags.hold) { flags.hold.entered(); await flags.hold.until; }
          if (!state.enabled || !flags.manage) return { rows: [] };
          const target = state.people.find(p => p.id === params[0] && p.status === "waiting");
          if (!target) return { rows: [] };
          target.status = "active"; return { rows: [{ id: target.id, at }] };
        }
        if (text.startsWith('update "events"')) { state.enabled = params[0] as boolean; return { rows: [], rowCount: 1 }; }
        if (text.startsWith('update "participations"')) {
          const waiting = state.people.filter(p => p.status === "waiting"); waiting.forEach(p => { p.status = "active"; });
          return { rows: [], rowCount: waiting.length };
        }
        if (text.includes('AS "decisionAtMs"')) return { rows: [{ decisionAtMs: Date.parse(at) }] };
        if (text.includes("SELECT clock_timestamp() AS at")) return { rows: [{ at }] };
        if (text.includes("INSERT INTO audit_logs")) { if (flags.fail) throw new Error("PRIVATE_ENTRY_DATABASE"); return { rows: [{ id: id(70) }], rowCount: 1 }; }
        if (text.startsWith('update "idempotency_operations"')) {
          const found = [...state.receipts.values()].find(r => params.includes(r.id))!;
          found.status = "completed"; found.httpStatus = Number(params[1]); found.reference = String(params[2]);
          found.payload = typeof params[3] === "string" ? JSON.parse(params[3]) : params[3];
          return { rows: [[found.id, found.httpStatus, found.reference, found.payload]] };
        }
        throw new Error(`SQL de teste não previsto: ${text}`);
      } };
    }
  }
  const database = drizzle(new EntryFixturePool() as unknown as Pool, { schema });
  const events = new EventsService(database);
  events.evaluateEventAvailabilityById = async () => ({ eventExists: true, eventAcceptingNewEntries: flags.manage } as EventAvailabilityResult);
  const participations = new ParticipationsService(database, events);
  return { database, events, participations, service: new StaffEntryService(database, events, participations), flags, state, queries };
}
