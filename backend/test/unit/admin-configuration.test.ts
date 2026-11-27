import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import * as schema from "../../src/database/schema";
import {
  configurationBodies, configurationEventParams, configurationExperienceParams, configurationName,
  configurationQuery, configurationStationParams, configurationTimezone, createEventBody,
  encodeConfigurationCursor, experienceBody, stationBody, updateEventBody,
} from "../../src/events/admin-configuration.dto";
import {
  configurationEventView, configurationProjection, readinessView, type ConfigurationRow,
} from "../../src/events/admin-configuration.projection";
import { AdminConfigurationQueryService } from "../../src/events/admin-configuration-query.service";
import { AdminConfigurationService, configurationFingerprint, CONFIGURATION_OPERATIONS, type ConfigurationInput } from "../../src/events/admin-configuration.service";
import { configurationMutation } from "../../src/events/admin-configuration.mutation";

const id=(n:number)=>`abcdef00-0000-4000-8000-${String(n).padStart(12,"0")}`;
const eventId=id(1),experienceId=id(2),stationId=id(3),userId=id(4),sessionId=id(5);
const at="2026-11-04T15:00:00.123456Z";
const eventPayload={name:"Arena de testes",accessCode:"ARENA-TEST",timezone:"America/Sao_Paulo",
  startsAt:"2026-11-05T17:00:00.000Z",officialEndsAt:"2026-11-05T23:00:00.000Z",
  operationalDeadlineAt:"2026-11-05T23:30:00.000Z",externalQueueEnabled:true};
function eventRow(overrides:Partial<ConfigurationRow>={}):ConfigurationRow{
  return {id:eventId,name:"Arena de testes",accessCode:"ARENA-TEST",timezone:"America/Sao_Paulo",statusStored:"scheduled",effectivePhase:"open",
    startsAt:at,officialEndsAt:at,operationalDeadlineAt:at,closureMode:null,closureRequestedAt:null,adminDeadlineAt:null,externalQueueEnabled:true,
    createdAt:at,updatedAt:at,observedAt:at,ready:true,acceptingNewParticipations:true,nameAndAccessCode:true,validScheduleAndTimezone:true,
    externalQueueConfigured:true,hasExperienceWithAvailableStation:true,hasVerifiedActiveStaff:true,...overrides};
}

test("E08.13 cadastro normaliza código, nome e timestamps pelo contrato compartilhado",()=>{
  const value=createEventBody.parse({...eventPayload,name:"  Arena de testes  ",accessCode:" \t arena-test \n",startsAt:"2026-11-05T14:00:00-03:00"});
  assert.equal(value.name,"Arena de testes");assert.equal(value.accessCode,"ARENA-TEST");assert.equal(value.startsAt,eventPayload.startsAt);
  assert.equal(Object.hasOwn(value,"reason"),false);assert.equal(value.externalQueueEnabled,true);
});
for(const margin of [0,60])test(`E08.13 margem operacional de ${margin} minutos é explícita e aceita`,()=>{
  const value=createEventBody.parse({...eventPayload,operationalDeadlineAt:new Date(Date.parse(eventPayload.officialEndsAt)+margin*60_000).toISOString()});
  assert.equal(Date.parse(value.operationalDeadlineAt)-Date.parse(value.officialEndsAt),margin*60_000);
});
test("E08.13 horários impossíveis, ambíguos ou silenciosamente arredondados são rejeitados",()=>{
  for(const startsAt of ["2026-02-29T00:00:00Z","2026-11-05","2026-11-05T17:00:00","2026-11-05T17:00:00-00:00",
    "2026-11-05T17:00:00.1234Z","2026-11-05T24:00:00Z","2026-11-05T17:00:00+24:00"]){
    assert.equal(createEventBody.safeParse({...eventPayload,startsAt}).success,false,startsAt);
  }
  for(const patch of [{startsAt:eventPayload.officialEndsAt},{startsAt:"2026-11-06T00:00:00Z"},
    {operationalDeadlineAt:"2026-11-05T22:59:59.999Z"},{operationalDeadlineAt:"2026-11-06T00:00:00.001Z"}]){
    assert.equal(createEventBody.safeParse({...eventPayload,...patch}).success,false);
  }
});
test("E08.13 cadastro exige configuração explícita e recusa controles internos",()=>{
  for(const field of Object.keys(eventPayload)){
    const value:Record<string,unknown>={...eventPayload};delete value[field];assert.equal(createEventBody.safeParse(value).success,false,field);
  }
  for(const extra of [{id:eventId},{status:"open"},{externalLastOrder:1},{closureMode:"controlled"},{createdAt:at},{isReady:true},{userId}]){
    assert.equal(createEventBody.safeParse({...eventPayload,...extra}).success,false);
  }
  assert.equal(createEventBody.safeParse({...eventPayload,externalQueueEnabled:false}).success,true);
  assert.equal(createEventBody.safeParse({...eventPayload,externalQueueEnabled:"false"}).success,false);
});
test("E08.13 criação compartilha o alfabeto ASCII canônico e não aceita expansão Unicode",()=>{
  for(const accessCode of ["A", "-ARENA", "ARENA-", "ARENA--TEST", "ARENA TEST", "ARENÁ", "STRAßE", "A".repeat(65)]){
    assert.equal(createEventBody.safeParse({...eventPayload,accessCode}).success,false,accessCode);
  }
  for(const accessCode of ["AB12", "a".repeat(64), " arena-2026 "])assert.equal(createEventBody.safeParse({...eventPayload,accessCode}).success,true);
});
test("E08.13 fuso IANA válido é aceito; offset fixo ou nome inventado é rejeitado",()=>{
  for(const zone of ["America/Sao_Paulo","UTC","Europe/Lisbon"])assert.equal(configurationTimezone.safeParse(zone).success,true,zone);
  for(const zone of ["","Mars/Olympus","+01:00","-03:00","x".repeat(81)])assert.equal(configurationTimezone.safeParse(zone).success,false,zone);
});
for(const [label,limit]of [["evento",180],["experiência",160],["estação",120]]as const)test(`E08.13 nome de ${label} respeita tamanho Unicode sem truncar`,()=>{
  const schema=configurationName(limit),value="😀".repeat(limit);assert.equal(schema.parse(` ${value} `),value);
  for(const name of [" ","😀".repeat(limit+1),"ab\0cd","ab\ncd","ab\u007fcd","ab\ud800cd"])assert.equal(schema.safeParse(name).success,false);
});
test("E08.13 PATCH genérico do evento só permite nome e justificativa opcional",()=>{
  assert.deepEqual(updateEventBody.parse({name:"  Nome  "}),{name:"Nome"});
  for(const field of ["accessCode","startsAt","officialEndsAt","operationalDeadlineAt","timezone","externalQueueEnabled","status","closureMode",
    "closureRequestedAt","adminDeadlineAt","externalLastOrder","id","createdAt","updatedAt"]){
    assert.equal(updateEventBody.safeParse({name:"Nome",[field]:"forged"}).success,false,field);
  }
  for(const body of [{},{reason:"Motivo"},null,[]])assert.equal(updateEventBody.safeParse(body).success,false);
});
test("E08.13 experiências e estações não aceitam reparent, FIFO ou alteração operacional",()=>{
  assert.deepEqual(experienceBody.parse({name:"Experiência"}),{name:"Experiência"});assert.deepEqual(stationBody.parse({label:"Estação"}),{label:"Estação"});
  for(const extra of [{eventId},{experienceId},{stationId},{lastQueueOrder:"0"},{queueAcceptingEntries:false},{availability:"unavailable"},{currentServiceSessionId:id(6)}]){
    assert.equal(experienceBody.safeParse({name:"Experiência",...extra}).success,false);
    assert.equal(stationBody.safeParse({label:"Estação",...extra}).success,false);
  }
});
test("E08.13 justificativa opcional é validada uniformemente em todas as operações",()=>{
  for(const [operation,schema]of Object.entries(configurationBodies)){
    const body=operation==="create_event"?eventPayload:operation.includes("station")?{label:"Estação"}:{name:"Nome"};
    assert.equal(schema.safeParse(body).success,true);
    assert.equal(schema.safeParse({...body,reason:"  Configuração autorizada  "}).success,true);
    for(const reason of [null," ","x".repeat(501),"secret\0value",false])assert.equal(schema.safeParse({...body,reason}).success,false);
  }
});
test("E08.13 parâmetros aninhados validam todos os UUIDs e rejeitam IDs extras",()=>{
  assert.deepEqual(configurationEventParams.parse({eventId}),{eventId});
  assert.deepEqual(configurationExperienceParams.parse({eventId,experienceId}),{eventId,experienceId});
  assert.deepEqual(configurationStationParams.parse({eventId,experienceId,stationId}),{eventId,experienceId,stationId});
  for(const field of ["eventId","experienceId","stationId"])assert.equal(configurationStationParams.safeParse({eventId,experienceId,stationId,[field]:"invalid"}).success,false);
  assert.equal(configurationEventParams.safeParse({eventId,userId}).success,false);
});
test("E08.13 paginação keyset preserva microssegundos, UUID e defaults",()=>{
  assert.deepEqual(configurationQuery.parse({}),{limit:20});
  const cursor=encodeConfigurationCursor(at,eventId),parsed=configurationQuery.parse({limit:"50",cursor,phase:"open",statusStored:"scheduled"});
  assert.deepEqual(parsed,{limit:50,cursor:{v:1,createdAt:at,id:eventId},phase:"open",statusStored:"scheduled"});
});
test("E08.13 cursores, filtros e limites inválidos não alteram o escopo administrativo",()=>{
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  for(const query of [{limit:"0"},{limit:"51"},{limit:"1e1"},{limit:["1","2"]},{cursor:"%%%"},{cursor:"x".repeat(513)},
    {cursor:encode({v:2,createdAt:at,id:eventId})},{cursor:encode({v:1,createdAt:at,id:eventId,userId})},
    {cursor:encode({v:1,createdAt:"2026-11-04T15:00:00.123Z",id:eventId})},{cursor:encode({v:1,createdAt:at,id:"invalid"})},
    {cursor:encodeConfigurationCursor(at,eventId)+"="},{phase:"reopened"},{statusStored:"not_ready"},{userId},{eventId}]){
    assert.equal(configurationQuery.safeParse(query).success,false);
  }
});
test("E08.13 projeção de prontidão mantém capacidade separada de ocupação e sessão Staff",()=>{
  const statement=new PgDialect().sqlToQuery(configurationProjection());
  assert.equal((statement.sql.match(/clock_timestamp\(\)/g)||[]).length,1);
  assert.ok(statement.sql.includes("s.availability='available'"));assert.ok(statement.sql.includes("r.revoked_at IS NULL AND u.is_active AND u.email_verified_at IS NOT NULL"));
  assert.equal(statement.sql.includes("service_sessions"),false);assert.equal(statement.sql.includes("FROM sessions"),false);
  assert.equal(/INSERT |UPDATE |DELETE |FOR UPDATE|FOR SHARE/.test(statement.sql),false);
});
test("E08.13 fase efetiva respeita prazo compartilhado, corte e estado Admin sem abrir artificialmente",()=>{
  const statement=new PgDialect().sqlToQuery(configurationProjection(sql`e.id=${eventId}`,sql`${at}::timestamptz`));
  for(const expected of ["LEAST(e.operational_deadline_at,e.admin_deadline_at)<=e.at","e.status='closed'","e.official_ends_at<=e.at",
    "e.closure_requested_at IS NULL","e.starts_at<=e.at AND e.at<e.official_ends_at"]){assert.ok(statement.sql.includes(expected),expected);}
  assert.equal(statement.sql.includes("clock_timestamp()"),false);assert.ok(statement.params.includes(eventId)&&statement.params.includes(at));
});
for(const [field,missing]of [["nameAndAccessCode","EVENT_NAME_OR_ACCESS_CODE_INVALID"],["validScheduleAndTimezone","EVENT_SCHEDULE_INVALID"],
  ["externalQueueConfigured","EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED"],["hasExperienceWithAvailableStation","EXPERIENCE_WITH_AVAILABLE_STATION"],
  ["hasVerifiedActiveStaff","VERIFIED_ACTIVE_STAFF"]]as const)test(`E08.13 prontidão explicita o critério ausente ${field}`,()=>{
  const value=readinessView(eventRow({[field]:false,ready:false}));assert.equal(value.ready,false);assert.deepEqual(value.missing,[missing]);assert.equal(value.checks[field],false);
});
test("E08.13 DTO administrativo omite campos internos e dados pessoais da projeção",()=>{
  const value=configurationEventView({...eventRow(),userId,email:"private@example.test",externalLastOrder:"999999999999999999",passwordHash:"PRIVATE",profile:{secret:true}});
  assert.equal(value.createdAt,at);assert.equal(value.updatedAt,at);assert.equal(value.readiness.ready,true);assert.deepEqual(value.readiness.missing,[]);
  for(const field of ["userId","email","passwordHash","profile","externalLastOrder","observedAt"])assert.equal(Object.hasOwn(value,field),false,field);
  assert.equal(JSON.stringify(value).includes("PRIVATE"),false);
});

const actor={userId,sessionId};
test('ADMIN-09 BI revalida Admin, sessão e TOTP antes dos agregados',async()=>{
  for(const [options,kind] of [[{admin:false},'admin_required'],[{valid:false},'invalid_session'],[{secondFactor:false},'admin_2fa_required'],[{revoked:true},'session_revoked']] as const){
    const f=readFixture(options);await assert.rejects(f.service.bi(actor,eventId),{kind});
    assert.equal(f.queries.some(q=>q.text.includes('WITH people AS')),false);
    assert.equal(f.queries.at(-1)?.text,'rollback');
  }
});
test('ADMIN-09 BI inclui evento vazio, fase oficial e snapshot de leitura consistente',async()=>{
  const bi={overview:{participations:0,arenaEntries:0,completed:0,absent:0},ranking:[],
    ratings:{count:0,mean:null,distribution:[1,2,3,4,5].map(stars=>({stars,count:0,percent:0}))},durationA:{meanSeconds:null,population:0},durationB:{meanSeconds:null,population:0}};
  const f=readFixture({bi});const result=await f.service.bi(actor,eventId);
  assert.equal(result.event.id,eventId);assert.equal(result.event.effectivePhase,'open');assert.equal(result.audience.available,false);
  assert.equal(f.queries[0].text,'begin isolation level repeatable read read only');
  assert.equal(f.queries.at(-1)?.text,'commit');assert.equal(f.queries.length,5);
  await assert.rejects(readFixture({absent:true}).service.bi(actor,eventId),{kind:'resource_not_found'});
});
const experience={id:experienceId,eventId,name:"Experiência",queueAcceptingEntries:true,lastQueueOrder:"9007199254740993",createdAt:at,updatedAt:at};
const station={id:stationId,experienceId,label:"Estação",availability:"available",pendingServiceSessionId:null,createdAt:at,updatedAt:at};
type ReadOptions={active?:boolean;admin?:boolean;valid?:boolean;revoked?:boolean;expired?:boolean;secondFactor?:boolean;emailVerified?:boolean;
  absent?:boolean;events?:ConfigurationRow[];experiences?:typeof experience[];stations?:typeof station[];staff?:object[];
  operation?:object; failOperation?:boolean; bi?:object};
function readFixture(options:ReadOptions={}){
  const queries:Array<{text:string;params:unknown[]}>=[];
  const database=drizzle({async query(config:{text:string},params:unknown[]=[]){
    const text=config.text;queries.push({text,params});
    if(/^(begin|commit|rollback)/.test(text))return {rows:[]};
    if(text.includes('SELECT u.is_active AS active'))return {rows:[{active:options.active??true,admin:options.admin??true,valid:options.valid??true,
      revoked:options.revoked??false,expired:options.expired??false,secondFactor:options.secondFactor??true,emailVerified:options.emailVerified??true}]};
    if (text.trimStart().startsWith('SELECT p.*, counts.*')) {
      if (options.failOperation) throw new Error('consulta interrompida');
      return { rows: options.absent ? [] : [options.operation] };
    }
    if(text.startsWith('SELECT id FROM events'))return {rows:options.absent?[]:[{id:eventId}]};
    if(text.startsWith('WITH observation')||text.startsWith('SELECT * FROM (WITH observation'))return {rows:options.absent?[]:options.events??[eventRow()]};
    if(text.startsWith('SELECT id,event_id'))return {rows:options.experiences??[experience]};
    if(text.startsWith('SELECT s.id,s.experience_id'))return {rows:options.stations??[station]};
    if(text.includes('FROM user_roles r JOIN users u'))return {rows:options.staff??[]};
    if(text.startsWith('WITH people AS'))return {rows:[{metrics:options.bi}]};
    throw Error('SQL unitário inesperado: '+text);
  }}as unknown as Client,{schema});
  return {service:new AdminConfigurationQueryService(database),queries};
}
for(const [option,kind]of [["active","account_inactive"],["admin","admin_required"],["valid","invalid_session"],
  ["revoked","session_revoked"],["expired","session_expired"],["secondFactor","admin_2fa_required"]]as const)test(`E08.13 GET revalida ${kind} sem consultar eventos`,async()=>{
  const f=readFixture({[option]:option==='revoked'||option==='expired'});
  await assert.rejects(f.service.events(actor,configurationQuery.parse({})),{kind});
  assert.equal(f.queries.length,3);assert.equal(f.queries[0].text,'begin isolation level repeatable read read only');assert.equal(f.queries.at(-1)?.text,'rollback');
  assert.equal(f.queries.some(q=>q.text.startsWith('WITH observation')||q.text.startsWith('SELECT * FROM')),false);
});
test("E08.13 listagem keyset usa ordenação estável, filtros e um snapshot sem N+1",async()=>{
  const rows=[eventRow({id:id(10)}),eventRow({id:id(9)}),eventRow({id:id(8)})],f=readFixture({events:rows});
  const cursor=encodeConfigurationCursor(at,id(11)),page=configurationQuery.parse({limit:"2",cursor,statusStored:"scheduled",phase:"open"});
  const result=await f.service.events(actor,page);assert.equal(result.items.length,2);assert.deepEqual(result.items.map(r=>r.id),[id(10),id(9)]);
  assert.equal(result.nextCursor,encodeConfigurationCursor(at,id(9)));assert.equal(f.queries.length,4);
  const query=f.queries[2];for(const p of [at,id(11),'scheduled','open',3])assert.ok(query.params.includes(p));
  assert.ok(query.text.includes('(e.created_at,e.id)<'));assert.ok(query.text.includes('ORDER BY "createdAt" DESC,id DESC'));
  assert.equal(f.queries.some(q=>/FOR UPDATE|FOR SHARE|INSERT |UPDATE |DELETE /.test(q.text)),false);assert.equal(f.queries.at(-1)?.text,'commit');
});
test("ADMIN-06 lê vínculos ativos do evento em ordem estável e devolve somente os campos públicos da lista", async () => {
  const item = { grantId: id(20), userId: id(21), name: "Staff", email: "staff@example.test", grantedAt: at, eligible: false };
  const f = readFixture({ staff: [{ ...item, passwordHash: "privado" }] });
  assert.deepEqual(await f.service.staff(actor, eventId), { eventId, items: [item] });
  const query = f.queries.find(q => q.text.includes("FROM user_roles r JOIN users u"));
  assert.ok(query);
  assert.deepEqual(query.params, [eventId]);
  assert.match(query.text, /r.event_id = .* AND r.role = 'staff' AND r.revoked_at IS NULL/);
  assert.match(query.text, /ORDER BY r.granted_at ASC, r.id ASC/);
  assert.equal(f.queries[0].text, "begin isolation level repeatable read read only");
  assert.equal(f.queries.at(-1)?.text, "commit");
});

test("ADMIN-06 bloqueia e-mail não verificado e TOTP ausente antes de ler o evento ou a equipe", async () => {
  for (const [options, kind] of [
    [{ emailVerified: false }, "actor_email_unverified"],
    [{ secondFactor: false }, "admin_2fa_required"],
    [{ admin: false }, "admin_required"],
  ] as const) {
    const f = readFixture(options);
    await assert.rejects(f.service.staff(actor, eventId), { kind });
    assert.equal(f.queries.length, 3);
    assert.equal(f.queries.at(-1)?.text, "rollback");
  }
  const absent = readFixture({ absent: true });
  await assert.rejects(absent.service.staff(actor, eventId), { kind: "resource_not_found" });
  assert.equal(absent.queries.length, 4);
  assert.deepEqual(await readFixture().service.staff(actor, eventId), { eventId, items: [] });
});

test("ADMIN-07 agrega ativa e espera externa no mesmo snapshot sem devolver dados pessoais", async () => {
  const f = readFixture({ operation: { ...eventRow(), activeParticipants: "2", externalWaitingParticipants: "0",
    email: "private@example.test", passwordHash: "fixture" } });
  const result = await f.service.operation(actor, eventId);
  assert.deepEqual(result, { eventId, name: "Arena de testes", timezone: "America/Sao_Paulo", effectivePhase: "open",
    observedAt: at, startsAt: at, officialEndsAt: at, operationalDeadlineAt: at,
    closureMode: null, closureRequestedAt: null, adminDeadlineAt: null, externalQueueEnabled: true,
    activeParticipants: 2, externalWaitingParticipants: 0, canSetExternalQueue: true, canClose: true });
  const query = f.queries[2];
  assert.ok(query.params.includes(eventId));
  assert.match(query.text, /e\.id=\$\d+::uuid/);
  assert.match(query.text, /a\.event_id=p\.id AND a\.status IN \('active','waiting'\)/);
  assert.match(query.text, /count\(\*\) FILTER \(WHERE a\.status='active'\)/);
  assert.match(query.text, /count\(\*\) FILTER \(WHERE a\.status='waiting'\)/);
  assert.equal(f.queries[0].text, "begin isolation level repeatable read read only");
  assert.equal(f.queries.at(-1)?.text, "commit");
});

test("ADMIN-07 verifica Admin e TOTP antes da consulta de evento, e reverte falhas", async () => {
  for (const [options, kind] of [[{ admin: false }, "admin_required"], [{ secondFactor: false }, "admin_2fa_required"]] as const) {
    const f = readFixture({ ...options, absent: true });
    await assert.rejects(f.service.operation(actor, eventId), { kind });
    assert.equal(f.queries.length, 3);
    assert.equal(f.queries.at(-1)?.text, "rollback");
  }
  const absent = readFixture({ absent: true });
  await assert.rejects(absent.service.operation(actor, eventId), { kind: "resource_not_found" });
  const invalid = readFixture({ operation: { ...eventRow(), activeParticipants: null, externalWaitingParticipants: "0" } });
  await assert.rejects(invalid.service.operation(actor, eventId));
  const broken = readFixture({ failOperation: true });
  await assert.rejects(broken.service.operation(actor, eventId));
  for (const f of [absent, invalid, broken]) assert.equal(f.queries.at(-1)?.text, "rollback");
});

test("ADMIN-07 permite fechamento inicial sem prontidão e bloqueia ações durante o fechamento", async () => {
  for (const [phase, canClose] of [["scheduled", true], ["not_ready", true], ["closing", false], ["closed", false]] as const) {
    const f = readFixture({ operation: { ...eventRow({ effectivePhase: phase, acceptingNewParticipations: false }),
      activeParticipants: "0", externalWaitingParticipants: "0" } });
    const result = await f.service.operation(actor, eventId);
    assert.equal(result.canSetExternalQueue, false);
    assert.equal(result.canClose, canClose);
  }
});

test("E08.13 página final vazia não inventa cursor ou eventos",async()=>{
  const f=readFixture({events:[]});assert.deepEqual(await f.service.events(actor,configurationQuery.parse({})),{items:[],nextCursor:null});
});
test('ADMIN-01 search normaliza espaços, mantém compatibilidade e valida novos parâmetros',()=>{
  assert.equal(configurationQuery.parse({search:'  Arena   Norte  '}).search,'Arena Norte');
  assert.equal(configurationQuery.parse({}).search,undefined);
  for(const search of ['\ud800','\udc00','x\ud800y','\ud800\ud800']) assert.equal(configurationQuery.safeParse({search}).success,false);
  assert.equal(configurationQuery.parse({search:'Arena 😀'}).search,'Arena 😀');
  assert.equal(configurationQuery.parse({excludeClosed:'false'}).excludeClosed,false);
  for(const query of [{search:'x'.repeat(181)},{search:[]},{excludeClosed:'1'},{excludeClosed:true}]){
    assert.equal(configurationQuery.safeParse(query).success,false);
  }
});
for(const search of ['Arena Norte','ARENA-TEST','100%_\\literal',"x' OR true --"]){
  test(`ADMIN-01 busca parametrizada ${search} antes do limite com cursor e fase`,async()=>{
    const f=readFixture({events:[eventRow({effectivePhase:'not_ready'})]});
    const result=await f.service.events(actor,configurationQuery.parse({search,excludeClosed:'true',phase:'not_ready',limit:'2',cursor:encodeConfigurationCursor(at,id(11))}));
    const query=f.queries[2];
    assert.ok(query.params.includes(search));assert.ok(!query.text.includes(search));
    assert.ok(query.text.includes('strpos(lower('));
    assert.ok(query.text.indexOf('p."effectivePhase"<>\'closed\'')<query.text.indexOf('LIMIT'));
    assert.ok(query.text.includes('(e.created_at,e.id)<'));
    assert.ok(query.text.includes('ORDER BY "createdAt" DESC,id DESC'));
    assert.equal(result.items[0].effectivePhase,'not_ready');
    assert.equal(result.nextCursor,null);
  });
}
test('ADMIN-01 chamada anterior não exclui encerrados por padrão',async()=>{
  const f=readFixture({events:[eventRow({effectivePhase:'closed'})]});
  assert.equal((await f.service.events(actor,configurationQuery.parse({}))).items[0].effectivePhase,'closed');
  assert.equal(f.queries[2].text.includes('p."effectivePhase"<>\'closed\''),false);
});
for(const mode of ["event","readiness","experiences"]as const)test(`E08.13 GET ${mode} inexistente falha sem detalhes de outro evento`,async()=>{
  const f=readFixture({absent:true});await assert.rejects(f.service[mode](actor,eventId),{kind:'resource_not_found'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test("E08.13 readiness é visão reduzida do mesmo snapshot e não publica configuração pessoal",async()=>{
  const f=readFixture({events:[eventRow({ready:false,hasVerifiedActiveStaff:false,acceptingNewParticipations:false,effectivePhase:'not_ready'})]});
  const result=await f.service.readiness(actor,eventId);assert.equal(result.eventId,eventId);assert.equal(result.ready,false);assert.deepEqual(result.missing,['VERIFIED_ACTIVE_STAFF']);assert.equal(result.observedAt,at);
  assert.equal(Object.hasOwn(result,'accessCode'),false);assert.equal(f.queries.length,4);
});
test("E08.13 experiências e estações são agrupadas em consultas constantes preservando bigint",async()=>{
  const second={...experience,id:id(20),name:'Outra'},otherStation={...station,id:id(21),experienceId:second.id};
  const f=readFixture({experiences:[experience,second],stations:[otherStation,station]}),r=await f.service.experiences(actor,eventId);
  assert.equal(r.eventId,eventId);assert.equal(r.items.length,2);assert.equal(r.items[0].lastQueueOrder,'9007199254740993');
  assert.deepEqual(r.items[0].stations,[station]);assert.deepEqual(r.items[1].stations,[otherStation]);assert.equal(f.queries.length,6);
  assert.equal(f.queries.filter(q=>q.text.includes('FROM stations')).length,1);assert.equal(f.queries.at(-1)?.text,'commit');
});
test("E08.13 fingerprint normaliza intenção e distingue operação, recursos e justificativa",()=>{
  const value={operation:'create_event' as const,payload:eventPayload},base=configurationFingerprint(value);
  assert.equal(base,configurationFingerprint({...value,payload:{...eventPayload,accessCode:'  arena-test  ',startsAt:'2026-11-05T14:00:00-03:00'}}));
  assert.equal(base,configurationFingerprint({...value,payload:{...eventPayload,reason:undefined}}));
  assert.notEqual(base,configurationFingerprint({...value,payload:{...eventPayload,reason:'Cadastro autorizado'}}));
  const edit={operation:'update_event' as const,eventId,payload:{name:'Nome'}};
  assert.notEqual(configurationFingerprint(edit),configurationFingerprint({...edit,eventId:id(30)}));
  assert.notEqual(configurationFingerprint(edit),configurationFingerprint({operation:'update_experience',eventId,experienceId,payload:{name:'Nome'}}));
  assert.equal(new Set(Object.values(CONFIGURATION_OPERATIONS)).size,6);
});

const operations=Object.keys(configurationBodies) as Array<keyof typeof configurationBodies>;
function writeInput(operation:keyof typeof configurationBodies):ConfigurationInput{
  return {operation,userId,sessionId,...(operation==='create_event'?{}:{eventId}),
    ...(operation==='update_experience'||operation.includes('station')?{experienceId}:{}),...(operation==='update_station'?{stationId}:{}),
    payload:operation==='create_event'?eventPayload:operation.includes('station')?{label:'Estação nova'}:{name:'Nome novo'},idempotencyKey:'intent',expiresAt:new Date('2099-01-01')};
}
type WriteOptions={absent?:boolean;experienceAbsent?:boolean;stationAbsent?:boolean;active?:boolean;admin?:boolean;session?:boolean;
  revoked?:boolean;secondFactor?:boolean;expiredAt?:number;same?:boolean;ended?:boolean;history?:boolean;codeUsed?:boolean;
  reservation?:'replay'|'request_conflict'|'in_progress';badReplay?:boolean;replayStatus?:number;wrongReference?:boolean;
  fail?:'reserve'|'object'|'response'|'audit'|'complete';auditCount?:number;badWrittenId?:boolean};
function writeFixture(operation:keyof typeof configurationBodies='update_event',options:WriteOptions={}){
  const input=writeInput(operation),queries:Array<{text:string;params:unknown[]}>=[];
  const creating=operation.startsWith('create_'),entity=operation.split('_')[1],httpStatus=creating?201:200;
  let currentId=entity==='event'?eventId:entity==='experience'?experienceId:stationId,sessionChecks=0;
  const eventValue=()=>configurationEventView(eventRow({id:currentId,name:operation==='create_event'?eventPayload.name:'Nome novo',
    ...(operation==='create_event'?{statusStored:'scheduled',effectivePhase:'scheduled',ready:false,acceptingNewParticipations:false,
      hasExperienceWithAvailableStation:false,hasVerifiedActiveStaff:false}:{})}));
  const resultBody=()=>entity==='event'?{event:eventValue()}:entity==='experience'?{experience:{...experience,id:currentId,name:'Nome novo',lastQueueOrder:creating?'0':experience.lastQueueOrder}}
    :{station:{...station,id:currentId,label:'Estação nova'}};
  const database=drizzle({async query(config:{text:string},params:unknown[]=[]){
    const text=config.text;queries.push({text,params});
    if(/^(begin|commit|rollback)/.test(text))return {rows:[]};
    if(text.startsWith('SELECT id FROM events'))return {rows:options.absent?[]:[{id:eventId}]};
    if(text.startsWith('SELECT id FROM experiences'))return {rows:options.experienceAbsent?[]:[{id:experienceId}]};
    if(text.startsWith('SELECT s.id FROM stations s JOIN'))return {rows:options.stationAbsent?[]:[{id:stationId}]};
    if(text.includes('SELECT is_active AS active FROM users'))return {rows:[{active:options.active??true}]};
    if(text.includes('SELECT id FROM user_roles'))return {rows:options.admin===false?[]:[{id:id(6)}]};
    if(text.includes('SELECT id FROM sessions'))return {rows:options.session===false?[]:[{id:sessionId}]};
    if(text.includes('AS "secondFactor"'))return {rows:[{revoked:options.revoked??false,expired:++sessionChecks>=(options.expiredAt??Infinity),secondFactor:options.secondFactor??true}]};
    if(text.includes('insert into "idempotency_operations"')){if(options.fail==='reserve')throw Error('PRIVATE_CONFIGURATION_SQL');return {rows:options.reservation?[]:[['reservation']]};}
    if(text.includes('from "idempotency_operations"'))return {rows:[['reservation',options.reservation==='request_conflict'?'other':configurationFingerprint(input),
      options.reservation==='in_progress'?'in_progress':'completed',options.replayStatus??httpStatus,options.wrongReference?id(99):currentId,options.badReplay?{}:resultBody()]]};
    if(text.startsWith('SELECT name AS value')||text.startsWith('SELECT label AS value'))return {rows:[{value:options.same?(entity==='station'?'Estação nova':'Nome novo'):'Nome anterior'}]};
    if(text.startsWith('WITH decision AS MATERIALIZED')){
      if(options.fail==='object')throw Error('PRIVATE_CONFIGURATION_SQL');
      if(operation==='create_event'){
        if(options.codeUsed)return {rows:[]};currentId=params[0] as string;return {rows:[{id:currentId,at}]};
      }
      if(creating)currentId=params.find(value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)&&![eventId,experienceId,stationId].includes(value)) as string;
      return {rows:[{ended:options.ended??false,history:options.history??false,at,
        writtenId:options.ended||(options.history&&operation!=='create_station')?null:options.badWrittenId?id(99):currentId}]};
    }
    if(text.startsWith('WITH observation')){if(options.fail==='response')throw Error('PRIVATE_CONFIGURATION_SQL');return {rows:[eventRow({id:currentId,name:operation==='create_event'?eventPayload.name:'Nome novo',
      ...(operation==='create_event'?{statusStored:'scheduled',effectivePhase:'scheduled',ready:false,acceptingNewParticipations:false,hasExperienceWithAvailableStation:false,hasVerifiedActiveStaff:false}:{})})]};}
    if(text.startsWith('SELECT id,event_id')){if(options.fail==='response')throw Error('PRIVATE_CONFIGURATION_SQL');return {rows:[{...experience,id:currentId,name:'Nome novo',lastQueueOrder:creating?'0':experience.lastQueueOrder}]};}
    if(text.startsWith('SELECT s.id,s.experience_id')){if(options.fail==='response')throw Error('PRIVATE_CONFIGURATION_SQL');return {rows:[{...station,id:currentId,label:'Estação nova'}]};}
    if(text.startsWith('INSERT INTO audit_logs')){if(options.fail==='audit')throw Error('PRIVATE_CONFIGURATION_SQL');return {rows:options.auditCount===0?[]:[{id:id(8)}]};}
    if(text.includes('update "idempotency_operations"')){if(options.fail==='complete')throw Error('PRIVATE_CONFIGURATION_SQL');return {rows:[['reservation',httpStatus,currentId,resultBody()]]};}
    throw Error('SQL unitário inesperado: '+text);
  }}as unknown as Client,{schema});
  return {input,queries,service:new AdminConfigurationService(database),resultBody};
}
for(const operation of operations){
  test(`E08.13 ${operation} efetiva objeto, auditoria e intenção no mesmo READ COMMITTED`,async()=>{
    const f=writeFixture(operation),result=await f.service.mutate(f.input);assert.equal(result.httpStatus,operation.startsWith('create_')?201:200);
    assert.equal(result.kind,operation.startsWith('create_')?'created':'changed');assert.deepEqual(result.body,f.resultBody());
    assert.equal(f.queries[0].text,'begin isolation level read committed');assert.equal(f.queries.at(-1)?.text,'commit');
    const effect=f.queries.findIndex(q=>q.text.startsWith('WITH decision')),audit=f.queries.findIndex(q=>q.text.startsWith('INSERT INTO audit_logs')),complete=f.queries.findIndex(q=>q.text.includes('update "idempotency_operations"'));
    assert.ok(effect>0&&audit>effect&&complete>audit);assert.equal(f.queries.filter(q=>q.text.startsWith('INSERT INTO audit_logs')).length,1);
    assert.equal(f.queries.filter(q=>q.text.includes('AS "secondFactor"')).length,4);
    const mutation=f.queries[effect];assert.equal((mutation.text.match(/clock_timestamp\(\)/g)||[]).length,1);
    const auditQuery=f.queries[audit];assert.ok(auditQuery.params.includes(CONFIGURATION_OPERATIONS[operation]));assert.ok(auditQuery.params.includes(at));
    if(operation==='create_event'){assert.ok(mutation.text.includes("'scheduled'"));assert.ok(mutation.text.includes('ON CONFLICT (access_code_normalized) DO NOTHING'));}
    if(operation==='create_experience')assert.ok(mutation.text.includes('true,0,f.at,f.at'));
    if(operation==='create_station')assert.ok(mutation.text.includes("'available',f.at,f.at"));
  });
  test(`E08.13 ${operation} replay histórico não repete objeto nem auditoria`,async()=>{
    const f=writeFixture(operation,{reservation:'replay'}),result=await f.service.mutate(f.input);
    assert.equal(result.kind,'replay');assert.deepEqual(result.body,f.resultBody());assert.equal(result.httpStatus,operation.startsWith('create_')?201:200);
    assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')||q.text.startsWith('INSERT INTO audit_logs')||q.text.includes('update "idempotency_operations"')),false);
    assert.equal(f.queries.at(-1)?.text,'commit');
  });
}
test("E08.13 locks estruturais seguem evento, experiência, estação, conta, concessão e sessão",async()=>{
  const f=writeFixture('update_station');await f.service.mutate(f.input);
  const ordered=['SELECT id FROM events','SELECT id FROM experiences','SELECT s.id FROM stations s JOIN','SELECT is_active AS active FROM users','SELECT id FROM user_roles','SELECT id FROM sessions','insert into "idempotency_operations"','WITH decision'];
  for(let i=1;i<ordered.length;i++)assert.ok(f.queries.findIndex(q=>q.text.includes(ordered[i-1]))<f.queries.findIndex(q=>q.text.includes(ordered[i])),ordered[i]);
  for(const query of f.queries.filter(q=>ordered.slice(0,3).some(text=>q.text.includes(text))))assert.ok(query.text.includes('FOR UPDATE'));
  const role=f.queries.find(q=>q.text.includes('SELECT id FROM user_roles'))!;assert.ok(role.text.includes("event_id IS NULL AND revoked_at IS NULL"));
});
for(const [option,kind]of [["active","account_inactive"],["admin","admin_required"],["session","invalid_session"],
  ["revoked","session_revoked"],["secondFactor","admin_2fa_required"]]as const)test(`E08.13 mutação sem ${option} válido retorna ${kind} sem reservar intenção`,async()=>{
  const f=writeFixture('update_event',{[option]:option==='revoked'});await assert.rejects(f.service.mutate(f.input),{kind});
  assert.equal(f.queries.some(q=>q.text.includes('idempotency_operations')),false);assert.equal(f.queries.at(-1)?.text,'rollback');
});
for(const expiredAt of [2,3,4])test(`E08.13 sessão expirada na revalidação ${expiredAt} reverte todas as escritas`,async()=>{
  const f=writeFixture('update_event',{expiredAt});await assert.rejects(f.service.mutate(f.input),{kind:'session_expired'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
for(const operation of ['update_event','update_experience','update_station']as const)test(`E08.13 ${operation} no-op autorizado não faz UPDATE nem auditoria mesmo com histórico`,async()=>{
  const f=writeFixture(operation,{same:true,history:true,ended:true}),r=await f.service.mutate(f.input);assert.equal(r.kind,'unchanged');
  assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')||q.text.startsWith('INSERT INTO audit_logs')),false);
  assert.ok(f.queries.some(q=>q.text.includes('update "idempotency_operations"')));
});
for(const operation of ['update_event','create_experience','update_experience','update_station']as const)test(`E08.13 ${operation} bloqueia qualquer histórico sem alterar objeto ou auditoria`,async()=>{
  const f=writeFixture(operation,{history:true});await assert.rejects(f.service.mutate(f.input),{kind:'configuration_locked'});
  assert.equal(f.queries.some(q=>q.text.startsWith('INSERT INTO audit_logs')||q.text.includes('update "idempotency_operations"')),false);assert.equal(f.queries.at(-1)?.text,'rollback');
});
test("E08.13 estação adicional continua permitida em experiência existente com histórico",async()=>{
  const f=writeFixture('create_station',{history:true});assert.equal((await f.service.mutate(f.input)).kind,'created');
});
for(const operation of operations.filter(op=>op!=='create_event'))test(`E08.13 ${operation} não produz efeito depois do corte definitivo`,async()=>{
  const f=writeFixture(operation,{ended:true});await assert.rejects(f.service.mutate(f.input),{kind:'event_ended'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test("E08.13 código já reservado conflita sem duplicar objeto, auditoria ou intenção concluída",async()=>{
  const f=writeFixture('create_event',{codeUsed:true});await assert.rejects(f.service.mutate(f.input),{kind:'access_code_used'});
  assert.equal(f.queries.some(q=>q.text.startsWith('INSERT INTO audit_logs')||q.text.includes('update "idempotency_operations"')),false);assert.equal(f.queries.at(-1)?.text,'rollback');
});
for(const reservation of ['request_conflict','in_progress']as const)test(`E08.13 intenção ${reservation} não executa nova configuração`,async()=>{
  const f=writeFixture('update_event',{reservation});await assert.rejects(f.service.mutate(f.input),{kind:reservation});assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')),false);assert.equal(f.queries.at(-1)?.text,'rollback');
});
test("E08.13 replay corrompido, status ou referência divergentes falham sem expor payload",async()=>{
  for(const options of [{badReplay:true},{replayStatus:201},{wrongReference:true}]){
    const f=writeFixture('update_event',{reservation:'replay',...options});await assert.rejects(f.service.mutate(f.input),{message:'ADMIN_CONFIGURATION_INTERNAL_ERROR'});assert.equal(f.queries.at(-1)?.text,'rollback');
  }
});
test("E08.13 TTL técnico vencido conserva replay histórico sem novo efeito ou auditoria",async()=>{
  const f=writeFixture('update_event',{reservation:'replay'}),expiredInput={...f.input,expiresAt:new Date('2000-01-01')};
  const r=await f.service.mutate(expiredInput);assert.equal(r.kind,'replay');assert.deepEqual(r.body,f.resultBody());assert.equal(r.httpStatus,200);
  assert.equal(f.queries.some(q=>q.text.startsWith('WITH decision')||q.text.startsWith('INSERT INTO audit_logs')||q.text.includes('update "idempotency_operations"')),false);
});
test("E08.13 recursos ausentes ou fora da cadeia não reservam intenção e exigem Admin atual",async()=>{
  for(const options of [{absent:true},{experienceAbsent:true},{stationAbsent:true}]){
    const f=writeFixture('update_station',options);await assert.rejects(f.service.mutate(f.input),{kind:'resource_not_found'});assert.equal(f.queries.some(q=>q.text.includes('idempotency_operations')),false);
  }
  const denied=writeFixture('update_event',{absent:true,admin:false});await assert.rejects(denied.service.mutate(denied.input),{kind:'admin_required'});
});
for(const fail of ['reserve','object','response','audit','complete']as const)test(`E08.13 falha ${fail} reverte intenção, objeto e auditoria`,async()=>{
  const f=writeFixture('update_event',{fail});await assert.rejects(f.service.mutate(f.input),{message:'ADMIN_CONFIGURATION_INTERNAL_ERROR'});assert.equal(f.queries.at(-1)?.text,'rollback');
});
test("E08.13 contagem de escrita ou auditoria divergente impede commit parcial",async()=>{
  for(const options of [{badWrittenId:true},{auditCount:0}]){
    const f=writeFixture('update_event',options);await assert.rejects(f.service.mutate(f.input),{message:'ADMIN_CONFIGURATION_INTERNAL_ERROR'});assert.equal(f.queries.at(-1)?.text,'rollback');
  }
});
test("E08.13 payload, chave e expiração inválidos são rejeitados antes da transação",async()=>{
  for(const patch of [{payload:{name:'Nome',accessCode:'FORGED'}},{idempotencyKey:''},{idempotencyKey:'x'.repeat(129)},{expiresAt:new Date(NaN)}]){
    const f=writeFixture('update_event');await assert.rejects(f.service.mutate({...f.input,...patch}),{message:'ADMIN_CONFIGURATION_INTERNAL_ERROR'});assert.equal(f.queries.length,0);
  }
});
test("E08.13 SQL decisório não confunde histórico atual com qualquer participação e copia o mesmo relógio",()=>{
  for(const operation of ['create_experience','create_station','update_event','update_experience','update_station']as const){
    const q=new PgDialect().sqlToQuery(configurationMutation(operation,eventId,stationId,experienceId,{name:'Nome',label:'Estação'}));
    assert.equal((q.sql.match(/clock_timestamp\(\)/g)||[]).length,1);assert.ok(q.sql.includes('EXISTS(SELECT 1 FROM participations p WHERE p.event_id=e.id)'));
    assert.equal(q.sql.includes("p.status IN ('waiting','active')"),false);assert.ok(q.sql.includes('NOT f.ended'));
    assert.ok(q.sql.includes('LEAST(e.operational_deadline_at,e.admin_deadline_at)<=d.at'));
    assert.ok(q.sql.includes('f.at'));assert.ok(q.sql.includes('LEFT JOIN written'));
  }
});
