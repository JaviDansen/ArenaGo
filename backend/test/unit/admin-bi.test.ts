import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eventBiQuery, eventBiSchema, prepareAudience, suppressAudienceDimension } from '../../src/events/admin-bi';
const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('ADMIN-09 query isola evento, agrega fontes independentes e usa última conclusão e saída voluntária',()=>{
  const q=new PgDialect().sqlToQuery(eventBiQuery(id(1)));
  assert.deepEqual(q.params,[id(1),id(1)]);
  for(const part of ["event_id=", "s.status='completed'", "status='absent'", "max(s.resolved_at)-p.arena_entered_at", "finish_reason='voluntary'", "finished_at>=arena_entered_at", "ORDER BY completed DESC,id ASC", 'generate_series(1,5)'])assert.ok(q.sql.includes(part),part);
  assert.doesNotMatch(q.sql,/INSERT|UPDATE|DELETE|comment|birth_date|email/);
});
test('ADMIN-09 contrato distingue médias nulas de zero e mantém cinco notas',()=>{
  const value={event:{id:id(1),name:'Teste',timezone:'UTC',effectivePhase:'closed'},observedAt:'2026-11-26T12:00:00.000Z',
    overview:{participations:0,arenaEntries:0,completed:0,absent:0},ranking:[],ratings:{count:0,mean:null,distribution:[1,2,3,4,5].map(stars=>({stars,count:0,percent:0}))},
    durationA:{meanSeconds:null,population:0},durationB:{meanSeconds:null,population:0},audience:{available:false,reason:'PRIVACY_POLICY_PENDING'}};
  assert.deepEqual(eventBiSchema.parse(value),value);
  assert.equal(eventBiSchema.safeParse({...value,audience:{available:true}}).success,false);
});
test('ADMIN-09 supressão impede divulgar células pequenas e complementos',()=>{
  assert.equal(suppressAudienceDimension(new Map([['a',9],['b',21]]),30),null);
  assert.equal(suppressAudienceDimension(new Map([['a',21]]),30),null);
  assert.deepEqual(suppressAudienceDimension(new Map([['a',10],['b',10]]),20),[{category:'a',percent:50},{category:'b',percent:50}]);
});
test('ADMIN-09 usa primeiro snapshot efetivamente entrado, deduplica usuário e jogos, não usa perfil atual',()=>{
  const rows=Array.from({length:20},(_,i)=>({userId:id(i+1),participationId:id(i+101),enteredAt:'2026-11-01T10:00:00Z',questionnaireVersionId:id(1000),
    answers:{schemaVersion:1,gender:i<10?'Feminino':'Masculino'},gamesSnapshot:[{gameId:id(i<10?500:501),isCurated:true}]}));
  const result=prepareAudience([...rows,...rows.map(r=>({...r,participationId:id(2000),enteredAt:'2026-11-02T10:00:00Z',answers:{schemaVersion:1,gender:'Outro'}}))]);
  assert.equal(result.age,null);assert.equal(result.gender?.length,2);assert.equal(result.games?.length,2);
  assert.equal(prepareAudience([...rows,{...rows[0],userId:id(5000),questionnaireVersionId:id(9000)}]).gender,null);
});
