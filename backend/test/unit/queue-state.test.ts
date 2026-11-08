import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { QueueStateIntegrityError, QueueStateService } from "../../src/events/queue-state.service";

const at = new Date("2026-10-30T15:00:00Z");
const owner = {
  id: "participation", eventId: "event", loadedEventId: "event", participationStatus: "active", currentId: "entry",
  eventStatus: "open", operationalDeadlineMs: at.getTime()+3600_000,
  closureMode: null, closureRequestedMs: null, adminDeadlineMs: null, observedAtMs: at.getTime(),
};
const waiting = {
  currentCount: "1", id: "entry", experienceId: "experience", loadedExperienceId: "experience", experienceName: "Just Dance",
  status: "waiting", queueOrder: "9007199254741001", position: "3",
  sessionId: null, sessionExperienceId: null, sessionStatus: null, calledAtMs: null,
  stationId: null, stationExperienceId: null, stationLabel: null,
};
const called = { ...waiting, status: "called", position: null,
  sessionId: "session", sessionExperienceId: "experience", sessionStatus: "pending", calledAtMs: at.getTime()-1000,
  stationId: "station", stationExperienceId: "experience", stationLabel: "Estação 2" };
const empty = { ...waiting, id: null, experienceId: null, loadedExperienceId: null, experienceName: null,
  currentCount: "0", queueOrder: null, status: null, position: null };

function fixture(access: Record<string, unknown> | false = {}, row: Record<string, unknown> = {}, duplicate = false) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const client = {
    async query(config: { text: string }, params: unknown[]) {
      queries.push({ text: config.text, params });
      if (config.text.includes("statement_timestamp()")) return { rows: access === false ? [] : [{ ...owner, ...access }] };
      if (config.text.includes('AS "currentCount"')) return { rows: duplicate ? [{ ...waiting, ...row }, { ...waiting, ...row }] : [{ ...waiting, ...row }] };
      return { rows: [] };
    },
  };
  return { service: new QueueStateService(drizzle(client as unknown as Client, { schema })), queries };
}
async function query(access: Record<string, unknown> = {}, row: Record<string, unknown> = {}) {
  return fixture(access, row).service.getParticipationQueue("user", "participation");
}

test("E07.2 acesso ausente/alheio é neutro e não consulta fila", async () => {
  const { service, queries } = fixture(false);
  assert.deepEqual(await service.getParticipationQueue("other", "missing"), { kind: "access_denied" });
  assert.equal(queries.length, 3); assert.equal(queries.at(-1)?.text, "commit");
  assert.deepEqual(queries[1].params, ["missing", "other"]);
  assert.equal(queries.some(q => q.text.includes("FROM queue_entries")), false);
});

test("E07.2 waiting tem contrato exato, posição positiva e ordem bigint sem perda", async () => {
  const result = await query();
  assert.deepEqual(result, { kind: "ok", participationId: "participation", observedAt: at,
    currentQueueEntry: { id: "entry", experienceId: "experience", experienceName: "Just Dance",
      status: "waiting", queueOrder: waiting.queueOrder, position: 3, serviceSession: null } });
  assert.equal(JSON.parse(JSON.stringify(result)).observedAt, at.toISOString());
});

test("E07.2 called apresenta somente atendimento pending e estação escolhida", async () => {
  assert.deepEqual(await query({}, called), { kind: "ok", participationId: "participation", observedAt: at,
    currentQueueEntry: { id: "entry", experienceId: "experience", experienceName: "Just Dance", queueOrder: waiting.queueOrder,
      status: "called", position: null, serviceSession: { id: "session", status: "pending",
        calledAt: new Date(called.calledAtMs), station: { id: "station", label: "Estação 2" } } } });
});

test("E07.2 titular ativo, externo ou terminal sem entrada corrente recebe null", async () => {
  for (const participationStatus of ["active", "waiting", "finished", "canceled"]) {
    assert.deepEqual(await query({ participationStatus, currentId: null }, empty),
      { kind: "ok", participationId: "participation", observedAt: at, currentQueueEntry: null });
  }
});

test("E07.2 posição SQL conta somente waiting da mesma experiência/evento até a própria ordem", async () => {
  const { service, queries } = fixture(); await service.getParticipationQueue("user", "participation");
  const sql = queries[2].text;
  assert.match(sql, /w.event_id=p.event_id AND w.experience_id=q.experience_id/);
  assert.match(sql, /w.status='waiting' AND w.queue_order <= q.queue_order/);
  assert.match(sql, /q.id=p.current_queue_entry_id AND q.participation_id=p.id AND q.event_id=p.event_id/);
  assert.doesNotMatch(sql, /ORDER BY.*DESC|external_queue_order/i);
});

test("E07.2 contagem máxima segura continua number e ordem permanece string", async () => {
  const result = await query({}, { position: String(Number.MAX_SAFE_INTEGER), queueOrder: "9223372036854775807" });
  assert.ok(result.kind === "ok" && result.currentQueueEntry?.status === "waiting");
  assert.equal(result.currentQueueEntry.position, Number.MAX_SAFE_INTEGER);
  assert.equal(result.currentQueueEntry.queueOrder, "9223372036854775807");
});

test("E07.2 rejeita posição zero, negativa, malformada ou insegura", async () => {
  for (const position of ["0", "-1", "01", "1.5", "9007199254740992", "NaN", null]) {
    await assert.rejects(query({}, { position }), QueueStateIntegrityError);
  }
});

test("E07.2 rejeita ordens históricas inválidas sem conversão silenciosa", async () => {
  for (const queueOrder of ["0", "-1", "1.5", " 1", "01", null, 9007199254741000]) {
    await assert.rejects(query({}, { queueOrder }), QueueStateIntegrityError);
  }
});

test("E07.2 relógio e prazos inválidos são falhas explícitas", async () => {
  for (const value of [NaN, Infinity, 9e15, null]) {
    await assert.rejects(query({ observedAtMs: value }), QueueStateIntegrityError);
    await assert.rejects(query({ operationalDeadlineMs: value }), QueueStateIntegrityError);
  }
});

test("E07.2 evento ausente, estados desconhecidos ou fechamento incoerente falham", async () => {
  for (const changes of [{ loadedEventId: null }, { loadedEventId: "other" }, { eventStatus: "unknown" },
    { participationStatus: "unknown" }, { adminDeadlineMs: at.getTime() },
    { closureMode: "controlled" }, { closureMode: "other" },
    { closureMode: "immediate", closureRequestedMs: at.getTime(), adminDeadlineMs: at.getTime()+1 }]) {
    await assert.rejects(query(changes), QueueStateIntegrityError);
  }
});

test("E07.2 ponteiro ausente/quebrado, entrada fechada ou multiplicidade não viram estado válido", async () => {
  await assert.rejects(query({ currentId: null }), QueueStateIntegrityError);
  for (const changes of [{ id: null }, { id: "other" }, { status: "closed", currentCount: "0" },
    { status: "unknown" }, { currentCount: "2" }, { currentCount: "9007199254740992" }]) {
    await assert.rejects(query({}, changes), QueueStateIntegrityError);
  }
  await assert.rejects(fixture({}, {}, true).service.getParticipationQueue("user", "participation"), QueueStateIntegrityError);
});

test("E07.2 vínculos de experiência, atendimento e estação são verificados", async () => {
  for (const changes of [{ loadedExperienceId: null }, { loadedExperienceId: "other" }, { experienceName: null }]) {
    await assert.rejects(query({}, changes), QueueStateIntegrityError);
  }
  for (const changes of [{ sessionExperienceId: "other" }, { stationExperienceId: "other" }, { stationId: null }, { stationLabel: null }]) {
    await assert.rejects(query({}, { ...called, ...changes }), QueueStateIntegrityError);
  }
});

test("E07.2 called exige pending, estação e horário válidos; waiting não pode ter atendimento", async () => {
  for (const changes of [{ sessionId: null }, { sessionStatus: "completed" }, { sessionStatus: "absent" },
    { sessionStatus: "canceled" }, { calledAtMs: NaN }, { calledAtMs: null }, { position: "1" }]) {
    await assert.rejects(query({}, { ...called, ...changes }), QueueStateIntegrityError);
  }
  await assert.rejects(query({}, { ...called, status: "waiting", position: "1" }), QueueStateIntegrityError);
});

test("E07.2 participação não ativa com fila vigente é incoerente", async () => {
  for (const participationStatus of ["waiting", "finished", "canceled"]) {
    await assert.rejects(query({ participationStatus }), QueueStateIntegrityError);
  }
});

test("E07.2 corte de novos ingressos e indisponibilidade não removem espera/chamada residual", async () => {
  for (const row of [waiting, called]) {
    const result = await query({ eventStatus: "closing", closureMode: "controlled",
      closureRequestedMs: at.getTime()-60_000, adminDeadlineMs: at.getTime()+60_000,
      officialEndsAt: at, available: false, staff: false }, row);
    assert.ok(result.kind === "ok"); assert.equal(result.currentQueueEntry?.status, row.status);
  }
});

test("E07.2 prazo definitivo inclusivo e fechamento imediato projetam null sem limpar linhas", async () => {
  for (const access of [{ operationalDeadlineMs: at.getTime() }, { eventStatus: "closed" },
    { closureMode: "controlled", closureRequestedMs: at.getTime()-60_000, adminDeadlineMs: at.getTime() },
    { closureMode: "immediate", closureRequestedMs: at.getTime(), adminDeadlineMs: at.getTime() }]) {
    for (const row of [waiting, called]) {
      const result = await query(access, row); assert.ok(result.kind === "ok"); assert.equal(result.currentQueueEntry, null);
    }
  }
});

test("E07.2 lista fechada de campos não expõe dados extras privados", async () => {
  const result = await query({ email: "private", userId: "private", profile: "private" },
    { ...called, calledByUserId: "private", passwordHash: "private", games: "private", answers: "private" });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.ok(result.kind === "ok"); assert.deepEqual(Object.keys(result).sort(), ["currentQueueEntry", "kind", "observedAt", "participationId"]);
});

test("E07.2 usa duas leituras na mesma transação READ ONLY; integridade aborta sem escrita", async () => {
  for (const invalid of [false, true]) {
    const { service, queries } = fixture({}, invalid ? { currentCount: "2" } : {});
    if (invalid) await assert.rejects(service.getParticipationQueue("user", "participation"), QueueStateIntegrityError);
    else await service.getParticipationQueue("user", "participation");
    assert.equal(queries[0].text, "begin isolation level repeatable read read only");
    assert.equal(queries.length, 4); assert.equal(queries.at(-1)?.text, invalid ? "rollback" : "commit");
    assert.deepEqual(queries[2].params, ["participation", "user", "event"]);
    assert.equal(queries.some(q => /\b(insert|update|delete|for share|for update)\b/i.test(q.text)), false);
  }
});
