import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import { ParticipationsService } from "../../src/participations/participations.service";
import { EventsService } from "../../src/events/events.service";
import { buildEventAvailabilityResult, evaluateEventConfigurationReadiness } from "../../src/events/event-availability";
import { evaluateEventEntryWindow } from "../../src/events/event-entry-window";
import { buildEventOperationalCapacityResult } from "../../src/events/event-operational-capacity";
import { ADMIN_EXTERNAL_QUEUE_OPERATION, AdminExternalQueueService, externalQueueFingerprint } from "../../src/events/admin-external-queue.service";
import type { AdminExternalQueueInput } from "../../src/events/admin-external-queue.types";

const at = new Date("2026-11-03T15:00:00Z");
const input: AdminExternalQueueInput = { userId: "admin", sessionId: "session", eventId: "event", enabled: false,
  reason: "Operação autorizada", idempotencyKey: "intent", expiresAt: new Date("2099-01-01") };
function fixture(options: { enabled?: boolean; absent?: boolean; active?: boolean; admin?: boolean; missingSession?: boolean;
  revoked?: boolean; expiredAtCheck?: number; secondFactor?: boolean; status?: string; capacity?: boolean;
  officialEndsAt?: Date; reservation?: "replay" | "request_conflict" | "in_progress";
  payload?: object | null; fail?: "event" | "release" | "audit" | "complete"; auditCount?: number } = {}) {
  const queries: Array<{ text: string; params: unknown[] }> = [], marker = new Error("E086_PRIVATE_FAILURE");
  let sessionChecks = 0;
  const database = drizzle({ async query(config: { text: string }, params: unknown[]) {
    const text = config.text; queries.push({ text, params });
    if (/^(begin|commit|rollback)/.test(text)) return { rows: [] };
    if (text.startsWith("select") && text.includes('from "events"')) return { rows: options.absent ? [] : [[options.enabled ?? true]] };
    if (text.startsWith("select") && text.includes('from "participations"')) return { rows: [] };
    if (text.includes("FROM users WHERE")) return { rows: [{ active: options.active ?? true }] };
    if (text.includes("SELECT id FROM user_roles")) return { rows: options.admin === false ? [] : [{ id: "role" }] };
    if (text.includes("SELECT id FROM sessions")) return { rows: options.missingSession ? [] : [{ id: "session" }] };
    if (text.includes('AS "secondFactor"')) return { rows: [{ revoked: options.revoked ?? false,
      expired: ++sessionChecks >= (options.expiredAtCheck ?? Infinity), secondFactor: options.secondFactor ?? true }] };
    if (text.includes('insert into "idempotency_operations"')) return { rows: options.reservation ? [] : [["reservation"]] };
    if (text.includes('from "idempotency_operations"')) return { rows: [["reservation",
      options.reservation === "request_conflict" ? "different" : externalQueueFingerprint(input.eventId, input.enabled, input.reason),
      options.reservation === "in_progress" ? "in_progress" : "completed", 200, input.eventId,
      options.payload === undefined ? { eventId: input.eventId, externalQueueEnabled: false, releasedCount: 3, changedAt: at.toISOString() } : options.payload]] };
    if (text.includes('AS "decisionAtMs"')) return { rows: [{ decisionAtMs: at.getTime() }] };
    if (text.startsWith('update "events"')) { if (options.fail === "event") throw marker; return { rows: [], rowCount: 1 }; }
    if (text.startsWith('update "participations"')) { if (options.fail === "release") throw marker; return { rows: [], rowCount: 3 }; }
    if (text.includes("INSERT INTO audit_logs")) { if (options.fail === "audit") throw marker; return { rows: options.auditCount === 0 ? [] : [{ id: "audit" }] }; }
    if (text.startsWith('update "idempotency_operations"')) { if (options.fail === "complete") throw marker; return { rows: [["reservation", 200, input.eventId, {}]] }; }
    throw new Error(`SQL não previsto E08.6: ${text}`);
  } } as unknown as Client, { schema });
  const events = new EventsService(database);
  events.evaluateEventAvailabilityById = async (eventId, observed, tx) => {
    assert.equal(eventId, input.eventId); assert.deepEqual(observed, at); assert.ok(tx && tx !== database);
    const officialEndsAt=options.officialEndsAt??new Date("2026-11-03T16:00:00Z");
    const event = { name: "E086", accessCodeNormalized: "E086-UNIT", timezone: "America/Sao_Paulo", externalQueueEnabled: options.enabled ?? true,
      startsAt: new Date("2026-11-03T14:00:00Z"), officialEndsAt,
      operationalDeadlineAt: new Date(officialEndsAt.getTime()+60*60_000), closureRequestedAt: null, adminDeadlineAt: null };
    const configuration=evaluateEventConfigurationReadiness(event);assert.equal(configuration.ready,true,"A fixture deve isolar o corte sem invalidar a configuração.");
    return buildEventAvailabilityResult({ eventId, eventStatus: options.status ?? "open", configuration,
      entryWindow: evaluateEventEntryWindow(event, observed), operationalCapacity: buildEventOperationalCapacityResult(true, options.capacity ?? true) });
  };
  return { service: new AdminExternalQueueService(database, new ParticipationsService(database, events)), queries, marker };
}
test("E08.6 compõe E05 real, auditoria e idempotência em um único tx READ COMMITTED", async () => {
  const f = fixture(); assert.deepEqual(await f.service.setExternalQueue(input), { kind: "completed", eventId: input.eventId,
    externalQueueEnabled: false, releasedCount: 3, changedAt: at });
  assert.equal(f.queries.filter(q => q.text.startsWith("begin")).length, 1); assert.equal(f.queries[0].text,"begin isolation level read committed");
  const order = ['from "events"','from "participations"',"FROM users WHERE","SELECT id FROM user_roles","SELECT id FROM sessions",
    'insert into "idempotency_operations"','AS "decisionAtMs"','update "events"','update "participations"',"INSERT INTO audit_logs",'update "idempotency_operations"'];
  for(let n=1;n<order.length;n++) assert.ok(f.queries.findIndex(q=>q.text.includes(order[n-1])) < f.queries.findIndex(q=>q.text.includes(order[n])),order[n]);
  assert.match(f.queries.find(q=>q.text.includes('from "events"'))!.text,/for update/);
  assert.match(f.queries.find(q=>q.text.includes('from "participations"'))!.text,/order by.*for update/);
  assert.equal(f.queries.at(-1)?.text,"commit");
  const audit=f.queries.find(q=>q.text.includes("INSERT INTO audit_logs"))!;
  assert.match(audit.text,/'user','event','external_queue_enabled_changed'/);assert.match(audit.text,/e.updated_at/);assert.ok(audit.params.includes(input.reason));
});
test("E08.6 fingerprint inclui evento, estado e justificativa em namespace próprio",()=>{
  const hash=externalQueueFingerprint("e",false,"reason");assert.equal(ADMIN_EXTERNAL_QUEUE_OPERATION,"admin_set_external_queue");
  for(const value of [externalQueueFingerprint("other",false,"reason"),externalQueueFingerprint("e",true,"reason"),externalQueueFingerprint("e",false,"other")]) assert.notEqual(hash,value);
});
test("E08.6 religa sem liberar participações e no-op não atualiza domínio nem audita",async()=>{
  const enabling=fixture({enabled:false});assert.equal((await enabling.service.setExternalQueue({...input,enabled:true})).kind,"completed");
  assert.equal(enabling.queries.some(q=>q.text.startsWith('update "participations"')),false);
  const same=fixture({enabled:false,status:"closed"}),r=await same.service.setExternalQueue(input);
  assert.deepEqual(r,{kind:"completed",eventId:input.eventId,externalQueueEnabled:false,releasedCount:0});
  assert.equal(same.queries.some(q=>/^(update "events"|update "participations"|.*INSERT INTO audit_logs)/.test(q.text)),false);
  assert.ok(same.queries.some(q=>q.text.startsWith('update "idempotency_operations"')));
});
test("E08.6 retry histórico não executa E05 após intenção oposta ou fechamento",async()=>{
  const f=fixture({reservation:"replay",status:"closed"}),r=await f.service.setExternalQueue(input);
  assert.deepEqual(r,{kind:"replay",eventId:input.eventId,externalQueueEnabled:false,releasedCount:3,changedAt:at});
  assert.equal(f.queries.some(q=>q.text.includes('AS "decisionAtMs"')||q.text.startsWith("update")||q.text.includes("INSERT INTO audit_logs")),false);
  assert.equal(f.queries.at(-1)?.text,"rollback");
});
test("E08.6 retry de no-op antigo preserva ausência de changedAt e não muda estado posterior",async()=>{
  const f=fixture({reservation:"replay",payload:{eventId:input.eventId,externalQueueEnabled:false,releasedCount:0}});
  assert.deepEqual(await f.service.setExternalQueue(input),{kind:"replay",eventId:input.eventId,externalQueueEnabled:false,releasedCount:0});
  assert.equal(f.queries.some(q=>q.text.startsWith("update")),false);
});
for(const [name,options,kind] of [
  ["conta inativa",{active:false},"account_inactive"], ["Staff ou Admin revogado",{admin:false},"admin_required"],
  ["sessão ausente",{missingSession:true},"invalid_session"], ["sessão revogada",{revoked:true},"session_revoked"],
  ["sessão expirada após locks",{expiredAtCheck:1},"session_expired"], ["Admin sem 2FA",{secondFactor:false},"admin_2fa_required"],
  ["sessão expirada após reserva",{expiredAtCheck:2},"session_expired"], ["sessão expirada após efeitos E05",{expiredAtCheck:3},"session_expired"],
  ["chave conflitante",{reservation:"request_conflict"},"request_conflict"], ["intenção em andamento",{reservation:"in_progress"},"in_progress"],
  ["evento ausente",{absent:true},"resource_not_found"], ["corte oficial",{officialEndsAt:at},"event_closed"],
  ["fechamento Admin",{status:"closing"},"event_closed"], ["falta de prontidão",{capacity:false},"event_unavailable"],
] as const) test(`E08.6 ${name} não confirma domínio, reserva ou auditoria`,async()=>{
  const f=fixture(options);assert.deepEqual(await f.service.setExternalQueue(input),{kind});
  assert.equal(f.queries.some(q=>q.text.includes("INSERT INTO audit_logs")||q.text.startsWith('update "idempotency_operations"')),false);
  assert.equal(f.queries.at(-1)?.text,"rollback");
});
test("E08.6 autorização exige Admin global no banco e sessão própria com locks retidos",async()=>{
  const f=fixture();await f.service.setExternalQueue(input);
  const role=f.queries.find(q=>q.text.includes("SELECT id FROM user_roles"))!;
  for(const part of ["role='admin'","event_id IS NULL","revoked_at IS NULL","FOR SHARE"])assert.ok(role.text.includes(part));
  const session=f.queries.find(q=>q.text.includes("SELECT id FROM sessions"))!;assert.deepEqual(session.params,[input.sessionId,input.userId]);
  assert.match(session.text,/FOR SHARE/);assert.equal(f.queries.filter(q=>q.text.includes('AS "secondFactor"')).length,3);
});
test("E08.6 falhas de evento/liberação/auditoria/conclusão revertem a transação e preservam causa",async()=>{
  for(const fail of ["event","release","audit","complete"] as const){
    const f=fixture({fail});await assert.rejects(f.service.setExternalQueue(input),error=>error instanceof Error&&error.cause===f.marker);
    assert.equal(f.queries.at(-1)?.text,"rollback");assert.equal(f.queries.some(q=>q.text==="commit"),false);
  }
  const f=fixture({auditCount:0});await assert.rejects(f.service.setExternalQueue(input),/exatamente uma auditoria/);assert.equal(f.queries.at(-1)?.text,"rollback");
});
test("E08.6 replay malformado não fabrica resposta válida nem executa mutação",async()=>{
  for(const payload of [null,{}, {eventId:"other",externalQueueEnabled:false,releasedCount:0},
    {eventId:input.eventId,externalQueueEnabled:false,releasedCount:1},
    {eventId:input.eventId,externalQueueEnabled:false,releasedCount:0,changedAt:"bad"}]){
    const f=fixture({reservation:"replay",payload});await assert.rejects(f.service.setExternalQueue(input),/inválid/);assert.equal(f.queries.at(-1)?.text,"rollback");
  }
});
test("E08.6 input interno inválido é recusado antes da transação",async()=>{
  for(const patch of [{reason:" "},{reason:"x".repeat(501)},{idempotencyKey:""},{expiresAt:new Date(NaN)}]){
    const f=fixture();await assert.rejects(f.service.setExternalQueue({...input,...patch}));assert.equal(f.queries.length,0);
  }
});
