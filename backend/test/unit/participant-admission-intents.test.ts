// PARTICIPANTE-01 R02: consulta somente-leitura, abandono terminal e replay de chave abandonada.
// Usa o Drizzle real sobre um cliente pg simulado: o SQL verificado é o SQL gerado de fato.
import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { EventsService } from "../../src/events/events.service";
import {
  ABANDONED_JOIN_RESULT,
  ADMISSION_INTENT_ABANDONED,
  classifyCompletedJoin,
  createJoinRequestFingerprint,
} from "../../src/participations/join-idempotency";
import { ParticipationsService } from "../../src/participations/participations.service";

const userId = "550e8400-e29b-41d4-a716-446655440201";
const otherUser = "550e8400-e29b-41d4-a716-446655440202";
const eventId = "550e8400-e29b-41d4-a716-446655440203";
const otherEvent = "550e8400-e29b-41d4-a716-446655440204";
const participationId = "550e8400-e29b-41d4-a716-446655440205";
const key = "r02-intent-key";
const expiresAt = new Date("2030-01-02T00:00:00.000Z");

interface Row {
  id: string; actor: string; operation: string; key: string; hash: string;
  status: string; httpStatus: number | null; reference: string | null; payload: unknown;
}

/** Tabela idempotency_operations em memória, com BEGIN/COMMIT/ROLLBACK e transação READ ONLY. */
function fixture(initial: Row[] = [], { failUpdate = false } = {}) {
  let rows = initial.map(row => ({ ...row }));
  let snapshot: Row[] | null = null;
  let readOnly = false;
  let nextId = 1;
  const statements: string[] = [];
  const database = drizzle({
    async query({ text }: { text: string }, params: unknown[]) {
      statements.push(text);
      if (text.startsWith("begin")) {
        snapshot = rows.map(row => ({ ...row })); readOnly = text.includes("read only"); return { rows: [] };
      }
      if (text === "commit") { snapshot = null; readOnly = false; return { rows: [] }; }
      if (text === "rollback") { rows = snapshot ?? rows; snapshot = null; readOnly = false; return { rows: [] }; }
      if (readOnly && /^(insert|update|delete)/.test(text)) {
        throw new Error("cannot execute statement in a read-only transaction");
      }
      if (text.includes('from "events"') && text.includes("for update")) return { rows: [[params[0]]] };
      if (text.includes('from "users"') && text.includes("for update")) return { rows: [[params[0]]] };
      if (text.startsWith('insert into "idempotency_operations"')) {
        const [, actor, operation, idempotencyKey, hash, status] = params as string[];
        if (rows.some(row => row.actor === actor && row.operation === operation && row.key === idempotencyKey)) return { rows: [] };
        const id = `op-${nextId++}`;
        rows.push({ id, actor, operation, key: idempotencyKey, hash, status, httpStatus: null, reference: null, payload: null });
        return { rows: [[id]] };
      }
      if (text.includes('from "idempotency_operations"')) {
        const [actor, operation, idempotencyKey] = params as string[];
        const row = rows.find(item => item.actor === actor && item.operation === operation && item.key === idempotencyKey);
        if (!row) return { rows: [] };
        return { rows: [text.startsWith('select "id", "request_hash"')
          ? [row.id, row.hash, row.status, row.httpStatus, row.reference, row.payload]
          : [row.hash, row.status, row.httpStatus, row.reference, row.payload]] };
      }
      if (text.startsWith('update "idempotency_operations"')) {
        if (failUpdate) throw new Error("falha simulada ao persistir o resultado");
        const [status, httpStatus, reference, payload, id, expected] = params as [string, number, string | null, string, string, string];
        const row = rows.find(item => item.id === id && item.status === expected);
        if (!row) return { rows: [] };
        Object.assign(row, { status, httpStatus, reference, payload: JSON.parse(payload) });
        return { rows: [[row.id, row.httpStatus, row.reference, row.payload]] };
      }
      throw new Error(`SQL inesperado no fixture R02: ${text}`);
    },
  } as unknown as Client, { schema });
  const service = new ParticipationsService(database, new EventsService(database));
  return { service, statements, rows: () => rows };
}

const completedJoin = (overrides: Partial<Row> = {}): Row => ({
  id: "op-join", actor: userId, operation: "join", key, hash: createJoinRequestFingerprint(eventId),
  status: "completed", httpStatus: 201, reference: participationId, payload: { participationId }, ...overrides,
});
const writes = (statements: string[]) => statements.filter(text => /^(insert|update|delete)/.test(text));

// ---------------------------------------------------------------- consulta (somente leitura)

test("R02-T01/T11: consulta sem registro devolve not_found em transação READ ONLY e não escreve nada", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.lookupJoinIntent({ userId, eventId, idempotencyKey: key }), { state: "not_found" });
  assert.equal(f.statements[0], "begin isolation level read committed read only");
  assert.deepEqual(writes(f.statements), [], "nenhuma reserva, participação, fila ou snapshot");
  assert.equal(f.statements.some(text => text.includes("for update")), false, "consulta não trava evento nem usuário");
  assert.deepEqual(f.rows(), []);
});

test("R02-T02/T23: consulta recupera o resultado de ingresso gravado (formato anterior à R02)", async () => {
  const f = fixture([completedJoin()]);
  assert.deepEqual(await f.service.lookupJoinIntent({ userId, eventId, idempotencyKey: key }),
    { state: "completed", participationId });
  assert.deepEqual(writes(f.statements), []);
});

test("R02-T03: a chave é isolada pelo ator da sessão — outra conta não vê o resultado alheio", async () => {
  const f = fixture([completedJoin()]);
  assert.deepEqual(await f.service.lookupJoinIntent({ userId: otherUser, eventId, idempotencyKey: key }),
    { state: "not_found" });
});

test("R02-T04: mesma chave com outro evento (fingerprint diferente) é conflito, sem alterar o registro", async () => {
  const f = fixture([completedJoin()]);
  const before = structuredClone(f.rows());
  assert.deepEqual(await f.service.lookupJoinIntent({ userId, eventId: otherEvent, idempotencyKey: key }), { state: "conflict" });
  assert.deepEqual(await f.service.abandonJoinIntent({ userId, eventId: otherEvent, idempotencyKey: key, expiresAt }),
    { state: "conflict" });
  assert.deepEqual(f.rows(), before);
  assert.equal(writes(f.statements).filter(text => text.startsWith("update")).length, 0);
});

test("consulta distingue in_progress e abandoned", async () => {
  const f = fixture([completedJoin({ status: "in_progress", httpStatus: null, reference: null, payload: null })]);
  assert.deepEqual(await f.service.lookupJoinIntent({ userId, eventId, idempotencyKey: key }), { state: "in_progress" });
  const g = fixture([completedJoin({ ...ABANDONED_JOIN_RESULT, reference: null, payload: { code: ADMISSION_INTENT_ABANDONED } })]);
  assert.deepEqual(await g.service.lookupJoinIntent({ userId, eventId, idempotencyKey: key }), { state: "abandoned" });
});

// ---------------------------------------------------------------- abandono

test("R02-T07: abandono de chave livre usa a ordem evento → usuário → chave e grava resultado terminal", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.abandonJoinIntent({ userId, eventId, idempotencyKey: key, expiresAt }),
    { state: "abandoned", abandonedNow: true });
  const order = f.statements.filter(text => !/^(begin|commit)/.test(text)).map(text => text.split(" where")[0]);
  assert.match(order[0], /^select "id" from "events"/);
  assert.match(order[1], /^select "id" from "users"/);
  assert.match(order[2], /^insert into "idempotency_operations"/);
  assert.match(order[3], /^update "idempotency_operations"/);
  assert.ok(f.statements[f.statements.length - 1] === "commit");
  const [row] = f.rows();
  assert.equal(row.operation, "join");
  assert.equal(row.hash, createJoinRequestFingerprint(eventId), "mesmo fingerprint do ingresso original");
  assert.deepEqual({ status: row.status, httpStatus: row.httpStatus, reference: row.reference, payload: row.payload },
    { status: "completed", httpStatus: 409, reference: null, payload: { code: ADMISSION_INTENT_ABANDONED } });
  assert.equal(f.statements.some(text => /participations|participation_profile_snapshots|external_last_order/.test(text)), false,
    "abandono não toca participações, fila externa nem snapshots");
});

test("R02-T07: ingresso atrasado com a chave abandonada é replay terminal e não cria participação", async () => {
  const f = fixture();
  await f.service.abandonJoinIntent({ userId, eventId, idempotencyKey: key, expiresAt });
  const before = f.statements.length;
  const late = await f.service.createParticipation({ userId, eventId, idempotencyKey: key, expiresAt });
  assert.equal(late.kind, "replay");
  if (late.kind !== "replay") return;
  assert.equal(late.participationId, null);
  assert.equal(classifyCompletedJoin({ httpStatus: late.httpStatus, resultReference: late.participationId,
    resultPayload: late.idempotencyResult }).state, "abandoned");
  const after = f.statements.slice(before);
  assert.equal(after.some(text => /insert into "participations"|participation_profile_snapshots|update "events"/.test(text)), false);
  assert.equal(f.rows().length, 1);
});

test("R02-T08: ingresso concluído antes do abandono é preservado; abandono devolve o resultado original", async () => {
  const f = fixture([completedJoin()]);
  assert.deepEqual(await f.service.abandonJoinIntent({ userId, eventId, idempotencyKey: key, expiresAt }),
    { state: "completed", participationId });
  assert.deepEqual(f.rows()[0], completedJoin(), "resultado de sucesso não é sobrescrito");
  assert.equal(writes(f.statements).filter(text => text.startsWith("update")).length, 0);
});

test("R02-T09: abandono repetido devolve o mesmo resultado terminal sem nova escrita", async () => {
  const f = fixture();
  await f.service.abandonJoinIntent({ userId, eventId, idempotencyKey: key, expiresAt });
  const firstWrites = writes(f.statements).length;
  assert.deepEqual(await f.service.abandonJoinIntent({ userId, eventId, idempotencyKey: key, expiresAt }),
    { state: "abandoned" });
  assert.equal(writes(f.statements).length, firstWrites + 1, "só a tentativa de reserva (ON CONFLICT DO NOTHING)");
  assert.equal(f.rows().length, 1);
});

test("abandono não confirma reserva in_progress sem resultado: falha na persistência faz rollback", async () => {
  const f = fixture([], { failUpdate: true });
  await assert.rejects(f.service.abandonJoinIntent({ userId, eventId, idempotencyKey: key, expiresAt }), /Failed query: update "idempotency_operations"/);
  assert.equal(f.statements.at(-1), "rollback");
  assert.deepEqual(f.rows(), [], "nenhuma reserva in_progress confirmada");
});

test("resultado persistido de formato desconhecido nunca vira ingresso nem chave livre", () => {
  assert.throws(() => classifyCompletedJoin({ httpStatus: 409, resultReference: null, resultPayload: { code: "OUTRO" } }));
  assert.throws(() => classifyCompletedJoin({ httpStatus: 201, resultReference: participationId, resultPayload: {} }));
  assert.deepEqual(classifyCompletedJoin({ httpStatus: 201, resultReference: participationId, resultPayload: { participationId } }),
    { state: "completed", participationId });
});
