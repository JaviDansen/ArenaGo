import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { createRequestFingerprint } from "../../src/participations/join-idempotency";
import { createQueueWithdrawalFingerprint, QUEUE_WITHDRAWAL_OPERATION, QUEUE_WITHDRAWAL_REASON,
  QueueWithdrawalIntegrityError, QueueWithdrawalService } from "../../src/events/queue-withdrawal.service";
import type { WithdrawExperienceQueueInput } from "../../src/events/queue-withdrawal.types";

const input: WithdrawExperienceQueueInput = {
  userId: "00000000-0000-4000-8000-000000000001", participationId: "00000000-0000-4000-8000-000000000002",
  queueEntryId: "00000000-0000-4000-8000-000000000003", idempotencyKey: "withdraw-intention", expiresAt: new Date("2099-01-01"),
};
const eventId = "00000000-0000-4000-8000-000000000004";
const experienceId = "00000000-0000-4000-8000-000000000005";
const sessionId = "00000000-0000-4000-8000-000000000006";
const stationId = "00000000-0000-4000-8000-000000000007";
const at = new Date("2026-10-30T18:00:00Z");

function fixture(options: {
  access?: boolean; revalidated?: boolean; eventStatus?: string; experience?: boolean; station?: boolean;
  status?: string; lockedStatus?: string; participantStatus?: string; pointer?: string | null;
  called?: boolean; sessionStatus?: string; missingSession?: boolean; sessionExperience?: string; stationExperienceValid?: boolean;
  changedSession?: boolean; ended?: boolean; clock?: number; cancelCount?: number; clearCount?: number;
  reservation?: "new" | "replay" | "conflict" | "in_progress"; fail?: "entry" | "session" | "pointer" | "complete";
  invalidReplay?: boolean;
} = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const status = options.status ?? (options.called ? "called" : "waiting");
  const hasSession = (options.called ?? false) && !options.missingSession;
  const payload = { participationId: input.participationId, queueEntryId: input.queueEntryId, experienceId,
    status: "closed", closedAt: at.toISOString(), serviceSession: options.called
      ? { id: sessionId, status: "canceled", resolvedAt: at.toISOString() } : null };
  const marker = new Error(`E073_UNIT_${options.fail}`);
  const client = {
    async query(config: { text: string }, params: unknown[]) {
      const text = config.text; queries.push({ text, params });
      if (text.includes('SELECT p.event_id AS "eventId"')) return { rows: options.access === false ? [] : [{ eventId, experienceId, queueEntryId: input.queueEntryId }] };
      if (text.includes("SELECT status FROM events")) return { rows: [{ status: options.eventStatus ?? "open" }] };
      if (text.includes("SELECT id FROM experiences")) return { rows: options.experience === false ? [] : [{ id: experienceId }] };
      if (text.includes("SELECT q.status, s.id")) return { rows: [{ status, sessionId: hasSession ? sessionId : null,
        stationId: hasSession ? stationId : null, sessionExperienceId: hasSession ? (options.sessionExperience ?? experienceId) : null }] };
      if (text.includes("SELECT id FROM stations")) return { rows: options.station === false || options.stationExperienceValid === false ? [] : [{ id: stationId }] };
      if (text.includes('AS "currentId"')) return { rows: options.revalidated === false ? [] : [{ status: options.participantStatus ?? "active", currentId: options.pointer === undefined ? input.queueEntryId : options.pointer }] };
      if (text.includes("SELECT status FROM queue_entries")) return { rows: [{ status: options.lockedStatus ?? status }] };
      if (text.includes('FROM service_sessions WHERE queue_entry_id=')) return { rows: hasSession ? [{ id: options.changedSession ? "changed" : sessionId,
        status: options.sessionStatus ?? "pending", stationId, experienceId: options.sessionExperience ?? experienceId }] : [] };
      if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation && options.reservation !== "new" ? [] : [["reservation"]] };
      if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
        options.reservation === "conflict" ? "different" : createQueueWithdrawalFingerprint(input.participationId, input.queueEntryId),
        options.reservation === "in_progress" ? "in_progress" : "completed", 200, input.queueEntryId,
        options.invalidReplay ? {} : payload]] };
      if (text.includes("WITH decision AS MATERIALIZED")) {
        if (options.fail === "entry") throw marker;
        return { rows: options.ended ? [] : [{ closedAtMs: options.clock ?? at.getTime() }] };
      }
      if (text.includes("UPDATE service_sessions s SET")) {
        if (options.fail === "session") throw marker;
        return { rows: options.cancelCount === 0 ? [] : [{ id: sessionId }] };
      }
      if (text.includes("UPDATE participations SET")) {
        if (options.fail === "pointer") throw marker;
        return { rows: options.clearCount === 0 ? [] : [{ id: input.participationId }] };
      }
      if (text.includes('update "idempotency_operations"')) {
        if (options.fail === "complete") throw marker;
        return { rows: [["reservation", 200, input.queueEntryId, payload]] };
      }
      return { rows: [] };
    },
  };
  return { service: new QueueWithdrawalService(drizzle(client as unknown as Client, { schema })), queries, marker };
}

test("E07.3 fingerprint fixa participação/tentativa e namespace separado do ingresso", () => {
  const hash = createQueueWithdrawalFingerprint("p", "q");
  assert.equal(hash, createQueueWithdrawalFingerprint("p", "q"));
  assert.notEqual(hash, createQueueWithdrawalFingerprint("p2", "q"));
  assert.notEqual(hash, createQueueWithdrawalFingerprint("p", "q2"));
  assert.notEqual(hash, createRequestFingerprint("join_experience_queue", { participationId: "p", queueEntryId: "q" }));
  assert.match(hash, /^[a-f0-9]{64}$/); assert.ok(QUEUE_WITHDRAWAL_REASON.length <= 40);
});

test("E07.3 waiting fecha só a tentativa e libera ponteiro no mesmo tx", async () => {
  const { service, queries } = fixture(); const result = await service.withdrawExperienceQueue(input);
  assert.deepEqual(result, { kind: "withdrawn", participationId: input.participationId, queueEntryId: input.queueEntryId,
    experienceId, status: "closed", closedAt: at, serviceSession: null });
  assert.equal(queries[0].text, "begin isolation level read committed"); assert.equal(queries.at(-1)?.text, "commit");
  assert.equal(queries.some(q => q.text.includes("UPDATE service_sessions")), false);
  assert.equal(queries.some(q => /last_queue_order\s*=|external_last_order\s*=|INSERT INTO queue_entries/i.test(q.text)), false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("E07.3 called cancela pending, preserva estação e usa o mesmo timestamp persistido", async () => {
  const { service, queries } = fixture({ called: true }); const result = await service.withdrawExperienceQueue(input);
  assert.ok(result.kind === "withdrawn"); assert.deepEqual(result.serviceSession, { id: sessionId, status: "canceled", resolvedAt: at });
  const cancel = queries.find(q => q.text.includes("UPDATE service_sessions s SET"))!;
  assert.match(cancel.text, /resolved_at=q.closed_at/); assert.match(cancel.text, /s.status='pending'/);
  assert.ok(cancel.params.includes(input.userId)); assert.ok(cancel.params.includes(QUEUE_WITHDRAWAL_REASON));
  assert.equal(queries.some(q => /UPDATE stations|SET availability/i.test(q.text)), false);
});

test("E07.3 ordem de locks inclui descoberta pós-experiência antes de estação/pessoa", async () => {
  const { service, queries } = fixture({ called: true }); await service.withdrawExperienceQueue(input);
  const index = (part: string) => queries.findIndex(q => q.text.includes(part));
  const order = ["SELECT status FROM events", "SELECT id FROM experiences", "SELECT q.status, s.id", "SELECT id FROM stations",
    'AS "currentId"', "SELECT status FROM queue_entries", "FROM service_sessions WHERE queue_entry_id=", 'insert into "idempotency_operations"', "WITH decision AS MATERIALIZED"];
  for (let i=1;i<order.length;i++) assert.ok(index(order[i-1]) < index(order[i]), order[i]);
  assert.match(queries[index("SELECT status FROM events")].text, /FOR SHARE/);
  for (const part of order.slice(1,7).filter(p => p !== "SELECT q.status, s.id")) assert.match(queries[index(part)].text, /FOR UPDATE/);
});

test("E07.3 chamada que venceu antes do mutex é re-resolvida e cancelada corretamente", async () => {
  const { service, queries } = fixture({ called: true }); await service.withdrawExperienceQueue(input);
  assert.equal(queries[1].text.includes("current_queue_entry_id"), false, "Lookup não escolhe a última tentativa do participante.");
  assert.ok(queries.find(q => q.text.includes("SELECT id FROM stations"))?.params.includes(stationId));
});

test("E07.3 corte decisivo usa clock_timestamp e prazo operacional, sem exigir novas inscrições", async () => {
  const { service, queries } = fixture({ eventStatus: "closing" }); assert.equal((await service.withdrawExperienceQueue(input)).kind, "withdrawn");
  const decisive = queries.find(q => q.text.includes("WITH decision AS MATERIALIZED"))!.text;
  assert.match(decisive, /clock_timestamp\(\)/); assert.match(decisive, /d.at < e.operational_deadline_at/);
  assert.match(decisive, /d.at < e.admin_deadline_at/); assert.match(decisive, /e.status <> 'closed'/);
  assert.doesNotMatch(decisive, /official_ends_at|queue_accepting_entries|availability|user_roles/);
});

for (const [name, options, expected] of [
  ["titularidade ausente/alheia", { access: false }, "access_denied"],
  ["titularidade revalidada", { revalidated: false }, "access_denied"],
  ["participação externa", { participantStatus: "waiting" }, "participation_not_active"],
  ["participação finalizada", { participantStatus: "finished" }, "participation_not_active"],
  ["participação cancelada", { participantStatus: "canceled" }, "participation_not_active"],
  ["tentativa histórica", { status: "closed", pointer: "new-entry" }, "entry_not_current"],
  ["corte atingido", { ended: true }, "event_ended"],
] as const) {
  test(`E07.3 bloqueia ${name} e reverte reserva sem alterar domínio`, async () => {
    const { service, queries } = fixture(options);
    assert.deepEqual(await service.withdrawExperienceQueue(input), { kind: expected });
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes("UPDATE service_sessions") || q.text.includes("UPDATE participations SET")), false);
  });
}

test("E07.3 replay histórico não toca ponteiro posterior ou participação terminal", async () => {
  const { service, queries } = fixture({ reservation: "replay", status: "closed", participantStatus: "finished", pointer: "new-entry" });
  assert.equal((await service.withdrawExperienceQueue(input)).kind, "replay");
  assert.equal(queries.some(q => q.text.includes("WITH decision") || q.text.includes("UPDATE participations")), false);
});

test("E07.3 replay called conserva cancelamento e conflito/in_progress não escrevem domínio", async () => {
  const calledReplay = fixture({ called: true, status: "closed", sessionStatus: "canceled", reservation: "replay" });
  const result = await calledReplay.service.withdrawExperienceQueue(input); assert.ok(result.kind === "replay");
  assert.deepEqual(result.serviceSession, { id: sessionId, status: "canceled", resolvedAt: at });
  for (const reservation of ["conflict", "in_progress"] as const) {
    const { service, queries } = fixture({ reservation });
    assert.equal((await service.withdrawExperienceQueue(input)).kind, reservation === "conflict" ? "request_conflict" : "in_progress");
    assert.equal(queries.some(q => q.text.includes("WITH decision")), false);
  }
});

test("E07.3 inconsistências não viram cancelamentos aparentes", async () => {
  for (const options of [{ experience: false }, { eventStatus: "unknown" }, { participantStatus: "unknown" }, { pointer: null }, { status: "unknown" },
    { lockedStatus: "called" }, { called: true, missingSession: true }, { called: true, station: false },
    { called: true, sessionExperience: "other" }, { called: true, stationExperienceValid: false },
    { called: true, changedSession: true }, { called: true, sessionStatus: "completed" }, { called: true, sessionStatus: "absent" },
    { called: true, sessionStatus: "canceled" }, { called: true, status: "waiting" }, { invalidReplay: true, reservation: "replay" as const }]) {
    const { service, queries } = fixture(options);
    await assert.rejects(service.withdrawExperienceQueue(input), QueueWithdrawalIntegrityError);
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});

test("E07.3 conferir linhas afetadas impede concluir idempotência com efeito parcial", async () => {
  for (const options of [{ called: true, cancelCount: 0 }, { clearCount: 0 }, { clock: NaN }]) {
    const { service, queries } = fixture(options);
    await assert.rejects(service.withdrawExperienceQueue(input), QueueWithdrawalIntegrityError);
    assert.equal(queries.at(-1)?.text, "rollback");
    assert.equal(queries.some(q => q.text.includes('update "idempotency_operations"')), false);
  }
});

test("E07.3 falha em cada escrita propaga causa e solicita rollback", async () => {
  for (const fail of ["entry", "session", "pointer", "complete"] as const) {
    const { service, queries, marker } = fixture({ called: true, fail });
    await assert.rejects(service.withdrawExperienceQueue(input), (error: Error) => {
      let cause: unknown = error; while (cause instanceof Error && cause.cause) cause=cause.cause;
      assert.equal(cause, marker); return true;
    });
    assert.equal(queries.at(-1)?.text, "rollback");
  }
});

test("E07.3 input inválido falha antes da transação e respostas não expõem dados privados", async () => {
  const f = fixture();
  for (const changes of [{ idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }, { expiresAt: new Date(NaN) }]) {
    await assert.rejects(f.service.withdrawExperienceQueue({ ...input, ...changes }), /inválida/);
  }
  assert.equal(f.queries.length, 0);
  const result = await f.service.withdrawExperienceQueue(input);
  assert.equal(JSON.stringify(result).includes(input.userId), false);
  assert.deepEqual(Object.keys(result).sort(), ["closedAt", "experienceId", "kind", "participationId", "queueEntryId", "serviceSession", "status"]);
  assert.equal(QUEUE_WITHDRAWAL_OPERATION, "withdraw_experience_queue");
});
