import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProblemException } from '../../src/common/errors/problem.exception';
import { entryFixture, intent, actor, id } from './helpers/staff-entry-fixture';
const code = (value: string) => (e: unknown) => e instanceof ProblemException && (e.getResponse() as {code:string}).code===value;

test('chamada FIFO persistida é visível a outro Staff e bloqueia chamada seguinte', async () => {
  const f=entryFixture();
  const result=await f.calls.execute('call',intent());
  assert.equal(result.call.participationId,id(4)); assert.equal(result.participation.status,'waiting');
  const view=await f.service.read({...actor,userId:id(88)});
  assert.equal(view.pendingCall?.id,result.call.id);assert.equal(view.waitingCount,1);assert.equal(view.waiting[0].participationId,id(5));
  await assert.rejects(f.calls.execute('call',intent(21)),code('ENTRY_CALL_PENDING'));
  assert.equal(f.state.calls.length,1);
  assert.deepEqual(await f.calls.execute('call',intent()),result);
});
for(const action of ['confirm','absent','remove'] as const) test(`resolução ${action} altera somente pessoa chamada; replay não repete`,async()=>{
  const f=entryFixture(), called=await f.calls.execute('call',intent());
  const input={...intent(21),callId:called.call.id};
  const result=await f.calls.execute(action,input);
  assert.equal(result.call.status,{confirm:'confirmed',absent:'absent',remove:'removed'}[action]);
  assert.equal(f.state.people[1].status,'waiting');
  assert.equal(result.participation.status,{confirm:'active',absent:'waiting',remove:'canceled'}[action]);
  assert.equal(result.requeued,action==='absent');
  if(action==='absent') assert.equal(result.participation.externalQueueOrder,'3');
  if(action==='remove') assert.equal(result.participation.finishReason,'staff_external_wait_removed');
  assert.deepEqual(await f.calls.execute(action,input),result);
  await assert.rejects(f.calls.execute(action,{...intent(22),callId:called.call.id}),code('ENTRY_CALL_NOT_PENDING'));
  await assert.rejects(f.calls.execute(action,{...input,callId:id(99)}),code('IDEMPOTENCY_REQUEST_CONFLICT'));
  assert.ok(!f.queries.some(q=>/UPDATE service_sessions|INSERT INTO queue_entries|INSERT INTO evaluations/.test(q.text)));
});
test('ausência após corte finaliza apenas a pessoa chamada sem reinserção',async()=>{
  const f=entryFixture(), called=await f.calls.execute('call',intent());f.flags.manage=false;
  const r=await f.calls.execute('absent',{...intent(21),callId:called.call.id});
  assert.equal(r.requeued,false);assert.equal(r.participation.status,'finished');
  assert.equal(r.participation.finishReason,'external_absence_after_entry_cutoff');
  assert.equal(f.state.people[1].status,'waiting');assert.equal(f.state.lastOrder,2);
});
test('ausência devolve ao final e callback da chamada anterior não resolve a ocorrência seguinte',async()=>{
  const f=entryFixture(), called=await f.calls.execute('call',intent());
  await f.calls.execute('absent',{...intent(21),callId:called.call.id});
  const view=await f.service.read(actor);
  assert.deepEqual(view.waiting.map(p=>p.participationId),[id(5),id(4)]);
  assert.deepEqual(view.waiting.map(p=>p.position),[1,2]);
  const next=await f.calls.execute('call',intent(22));assert.equal(next.call.participationId,id(5));
  await assert.rejects(f.calls.execute('confirm',{...intent(23),callId:called.call.id}),code('ENTRY_CALL_NOT_PENDING'));
  assert.equal(f.state.calls.find(c=>c.id===next.call.id)?.status,'pending');
});
test('ausência com uma única pessoa reutiliza a participação e mantém ordem crescente',async()=>{
  const f=entryFixture();f.state.people.splice(1);const called=await f.calls.execute('call',intent());
  await f.calls.execute('absent',{...intent(21),callId:called.call.id});
  assert.equal(f.state.people.length,1);assert.equal(f.state.people[0].order,'3');
  const again=await f.calls.execute('call',intent(22));assert.equal(again.call.participationId,called.call.participationId);
  assert.notEqual(again.call.id,called.call.id);
});
test('resolução inexistente reverte reserva; replay de outra ação não é aceito',async()=>{
  const f=entryFixture();await assert.rejects(f.calls.execute('remove',{...intent(),callId:id(99)}),code('RESOURCE_NOT_FOUND'));
  assert.equal(f.state.receipts.size,0);
});
test('duas chamadas e três resoluções concorrentes são serializadas na persistência simulada',async()=>{
  const f=entryFixture();const called=await Promise.allSettled([f.calls.execute('call',intent()),f.calls.execute('call',intent(21))]);
  assert.equal(called.filter(x=>x.status==='fulfilled').length,1);
  const callId=f.state.calls[0].id;
  const results=await Promise.allSettled(['confirm','absent','remove'].map((action,n)=>f.calls.execute(action as 'confirm'|'absent'|'remove',{...intent(30+n),callId})));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
});
test('falha da auditoria reverte chamada, participação e reserva',async()=>{
  const f=entryFixture(), called=await f.calls.execute('call',intent()); f.flags.fail=true;
  await assert.rejects(f.calls.execute('remove',{...intent(21),callId:called.call.id}));
  assert.equal(f.state.calls[0].status,'pending');assert.equal(f.state.people[0].status,'waiting');
  assert.equal(f.state.receipts.size,1);assert.equal(f.queries.at(-1)?.text,'rollback');
});
test('desativação com pending libera grupo e cancela chamada; reativação não restaura',async()=>{
  const f=entryFixture();await f.calls.execute('call',intent());
  assert.equal((await f.service.setEnabled({...intent(21),enabled:false})).releasedCount,2);
  assert.equal(f.state.calls[0].status,'canceled');
  await f.service.setEnabled({...intent(22),enabled:true});
  assert.deepEqual(f.state.people.map(p=>p.status),['active','active']);
});
for(const flags of [{revoked:true},{staff:false},{expired:true},{verified:false}]) test(`autorização ${JSON.stringify(flags)} vale também para replay`,async()=>{
  const f=entryFixture();await f.calls.execute('call',intent());Object.assign(f.flags,flags);
  await assert.rejects(f.calls.execute('call',intent()));assert.equal(f.state.calls.length,1);
});
test('corte decisivo impede criar ou confirmar; sem efeitos parciais',async()=>{
  const f=entryFixture();f.flags.cutoffAtDecision=true;
  await assert.rejects(f.calls.execute('call',intent()),code('EVENT_ENTRY_UNAVAILABLE'));assert.equal(f.state.calls.length,0);
  f.flags.cutoffAtDecision=false;const called=await f.calls.execute('call',intent());f.flags.cutoffAtDecision=true;
  await assert.rejects(f.calls.execute('confirm',{...intent(21),callId:called.call.id}),code('EVENT_ENTRY_UNAVAILABLE'));
  assert.equal(f.state.calls[0].status,'pending');assert.equal(f.state.people[0].status,'waiting');
});
test('DDL prepara unicidade, histórico imutável, integração lifecycle e integridade diferida',()=>{
  // Somente inspeção do artefato: não é prova física PostgreSQL.
  const ddl=readFileSync(join(process.cwd(),'drizzle/0008_external_entry_calls.sql'),'utf8');
  for(const fragment of ['WHERE status=\'pending\'','FOREIGN KEY(participation_id,event_id)',
    'DEFERRABLE INITIALLY DEFERRED','EXTERNAL_CALL_TERMINAL_IMMUTABLE','resolve_external_call_on_participation',
    'external_queue_disabled','p.finish_reason=NEW.resolution_reason','p.finished_at=NEW.resolved_at',
    "NEW.resolution_reason='external_queue_disabled'",'INSERT INTO public.audit_logs','BEFORE TRUNCATE']) assert.ok(ddl.includes(fragment));
});
