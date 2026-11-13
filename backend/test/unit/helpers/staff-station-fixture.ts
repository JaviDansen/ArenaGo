import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../../../src/database/schema';
import { StaffStationStateService } from '../../../src/events/staff-station-state.service';
import { StaffQueueRemovalService } from '../../../src/events/staff-queue-removal.service';

export const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const actor = { userId: id(1), sessionId: id(2), eventId: id(3), experienceId: id(4), stationId: id(5) };
export const queueEntryId = id(6), participationId = id(7), serviceSessionId = id(8);

export function fixture() {
  const state = { entry: 'waiting', current: queueEntryId as string | null,
    receipts: new Map<string, { id: string; hash: string; status: string; payload: unknown }>(), audit: 0 };
  const flags = { grant: true, session: true, pending: false, failRead: false,
    failAudit: false, hold: null as null | Promise<void> };
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let queue = Promise.resolve();
  class PoolStub {
    async connect() {
      let releaseLock: (() => void) | undefined;
      let snapshot: typeof state | undefined;
      return { release() {}, async query(config: { text: string }, params: unknown[] = []) {
        const text = config.text; queries.push({ text, params });
        if (text.startsWith('begin')) return { rows: [] };
        if (text === 'commit' || text === 'rollback') {
          if (text === 'rollback' && snapshot) Object.assign(state, snapshot);
          releaseLock?.(); return { rows: [] };
        }
        if (text.includes('SELECT s.id FROM sessions s JOIN users')) return { rows: flags.session ? [{ id: actor.sessionId }] : [] };
        if (text.includes('SELECT t.availability')) {
          if (flags.failRead) throw new Error('PRIVATE_STATION_DATABASE');
          return { rows: flags.grant && params.includes(actor.eventId)
            ? [{ availability: 'available', operating: true }] : [] };
        }
        if (text.includes('row_number() OVER')) return { rows: state.entry === 'waiting' ? [{ id: queueEntryId,
          displayName: 'Ana', order: '1', position: '1' }] : [] };
        if (text.includes('SELECT s.id, q.id AS "queueEntryId"')) return { rows: flags.pending ? [{ id: serviceSessionId,
          queueEntryId, displayName: 'Ana', calledAt: new Date('2026-11-10T15:00:00.000Z'),
          queueStatus: state.entry, participationStatus: 'active', currentId: state.current }] : [] };
        if (text.includes('SELECT id FROM events')) return { rows: [{ id: actor.eventId }] };
        if (text.includes('SELECT id FROM experiences')) {
          const prior = queue; queue = new Promise<void>(resolve => { releaseLock = resolve; });
          await prior; snapshot = structuredClone(state); return { rows: [{ id: actor.experienceId }] };
        }
        if (text.includes('SELECT participation_id AS "participationId"')) return { rows: [{ participationId }] };
        if (text.includes('SELECT status, current_queue_entry_id AS "currentId"'))
          return { rows: [{ status: 'active', currentId: state.current }] };
        if (text.includes('SELECT status FROM queue_entries')) return { rows: [{ status: state.entry }] };
        if (text.includes('SELECT id FROM service_sessions')) return { rows: flags.pending ? [{ id: serviceSessionId }] : [] };
        if (text.includes('SELECT id FROM users') || text.includes('SELECT id FROM user_roles') ||
            text.includes('SELECT id FROM sessions')) return { rows: [{ id: id(30) }] };
        if (text.includes('AS "secondFactor"')) return { rows: [{ revoked: false, expired: false,
          active: true, secondFactor: true, admin: false, staff: flags.grant }] };
        if (text.includes('insert into "idempotency_operations"')) {
          if (state.receipts.has(String(params[3]))) return { rows: [] };
          state.receipts.set(String(params[3]), { id: String(params[0]), hash: String(params[4]),
            status: 'in_progress', payload: null });
          return { rows: [[params[0]]] };
        }
        if (text.includes('from "idempotency_operations"')) {
          const receipt = state.receipts.get(String(params[2]));
          return { rows: receipt ? [[receipt.id, receipt.hash, receipt.status,
            receipt.status === 'completed' ? 200 : null, queueEntryId, receipt.payload]] : [] };
        }
        if (text.includes('UPDATE queue_entries q SET')) {
          if (flags.hold) await flags.hold;
          if (state.entry !== 'waiting') return { rows: [] };
          state.entry = 'closed'; return { rows: [{ id: queueEntryId }] };
        }
        if (text.includes('UPDATE participations SET current_queue_entry_id=NULL')) {
          if (state.current !== queueEntryId) return { rows: [] };
          state.current = null; return { rows: [{ id: participationId }] };
        }
        if (text.includes('INSERT INTO audit_logs')) {
          if (flags.failAudit) throw new Error('PRIVATE_AUDIT_FAILURE');
          state.audit++; return { rows: [{ id: id(31) }] };
        }
        if (text.startsWith('update "idempotency_operations"')) {
          const receipt = [...state.receipts.values()].find(r => params.includes(r.id));
          assert.ok(receipt); receipt.status = 'completed';
          receipt.payload = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
          return { rows: [[receipt.id, 200, queueEntryId, receipt.payload]] };
        }
        throw new Error(`SQL não simulado: ${text}`);
      } };
    }
  }
  const database = drizzle(new PoolStub() as unknown as Pool, { schema });
  return { state, flags, queries, reader: new StaffStationStateService(database), remover: new StaffQueueRemovalService(database) };
}
