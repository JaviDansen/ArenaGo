const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path').posix;
const {loadModule,createHarness,textOf}=require('./helpers/questionnaireHarness.cjs');
const {verifiedAdminAuth}=require('./helpers/adminAuthFixture.cjs');
const modules=new Map();
function load(file){if(!modules.has(file))modules.set(file,loadModule(file,name=>name.startsWith('.')?load(path.join(path.dirname(file),name+'.js')):require(name)).exports);return modules.get(file);}
const {getAdminBi,parseAdminBi}=load('services/adminBiService.js');
const id='abcdef00-0000-4000-8000-000000000001';
const view=()=>({event:{id,name:'Arena teste',timezone:'UTC',effectivePhase:'open'},observedAt:'2026-11-26T12:00:00.000Z',
  overview:{participations:0,arenaEntries:0,completed:0,absent:0},ranking:[],ratings:{count:0,mean:null,distribution:[1,2,3,4,5].map(stars=>({stars,count:0,percent:0}))},
  durationA:{population:0,meanSeconds:null},durationB:{population:0,meanSeconds:null},audience:{available:false}});
test('ADMIN-09 consulta UUID autenticado e rejeita dados divergentes ou ausentes',async()=>{
  await getAdminBi({get:async(url,options)=>{assert.equal(url,`/admin/events/${id}/bi`);assert.equal(options.auth,true);return view();}},id);
  assert.throws(()=>parseAdminBi({...view(),event:{...view().event,id:'outro'}},id));
  assert.throws(()=>parseAdminBi({...view(),overview:{}},id));
  assert.throws(()=>parseAdminBi({...view(),durationA:{population:0,meanSeconds:0}},id));
});
test('ADMIN-09 tela real apresenta zeros, médias ausentes, perfil bloqueado e retorno ao UUID',async()=>{
  const h=createHarness('screens/admin/AdminRealEventBiScreen.js',{props:{route:{params:{eventId:id}}},
    authContext:verifiedAdminAuth({httpClient:{get:async()=>view()}})});
  try{
    for(let n=0;n<20&&!h.nodes.some(node=>textOf(node).includes('Evento sem participações'));n++)await h.actAsync(()=>new Promise(resolve=>setImmediate(resolve)));
    for(const text of ['Evento sem participações','Sem atendimentos concluídos.','Sem avaliações','Sem população elegível','Perfil do público indisponível'])
      assert.ok(h.nodes.some(node=>textOf(node).includes(text)),text);
    assert.ok(!h.nodes.some(node=>textOf(node).includes('Exportar')));
    h.press('Voltar ao evento');
    assert.equal(h.navigationCalls.at(-1).name,'AdminRealEvent');
    assert.equal(h.navigationCalls.at(-1).params.eventId,id);
  }finally{h.unmount();}
});
test('ADMIN-09 foco e foreground invalidam resposta antiga e leitura não sobrepõe',async()=>{
  let resolve, calls=0;
  const waiting=new Promise(done=>{resolve=done;});
  const h=createHarness('screens/admin/AdminRealEventBiScreen.js',{props:{route:{params:{eventId:id}}},authContext:verifiedAdminAuth({httpClient:{get:()=>{calls++;return calls===1?waiting:Promise.resolve(view());}}})});
  const settle=()=>h.actAsync(()=>new Promise(done=>setImmediate(done)));
  try{
    h.setFocused(false);h.setFocused(true);assert.equal(calls,1);
    resolve({...view(),event:{...view().event,name:'Resposta antiga'}});
    for(let n=0;n<10;n++)await settle();
    assert.equal(calls,2);assert.ok(!h.nodes.some(node=>textOf(node).includes('Resposta antiga')));
    h.setAppState('background');h.setAppState('active');
    for(let n=0;n<10;n++)await settle();assert.equal(calls,3);
  }finally{h.unmount();}
});
test('ADMIN-09 atualiza a cada 30 segundos somente com foco e encerra timer ao desmontar',async t=>{
  t.mock.timers.enable({apis:['setInterval']});let calls=0;
  const h=createHarness('screens/admin/AdminRealEventBiScreen.js',{props:{route:{params:{eventId:id}}},authContext:verifiedAdminAuth({httpClient:{get:async()=>{calls++;return view();}}})});
  const settle=()=>h.actAsync(()=>new Promise(done=>setImmediate(done)));
  try{
    for(let n=0;n<10;n++)await settle();assert.equal(calls,1);
    t.mock.timers.tick(30000);for(let n=0;n<10;n++)await settle();assert.equal(calls,2);
    h.setFocused(false);t.mock.timers.tick(60000);assert.equal(calls,2);
  }finally{h.unmount();t.mock.timers.reset();}
});
test('ADMIN-09 atualização manual conserva dados em falha de rede e apaga em negação',async()=>{
  let failure=null;
  const h=createHarness('screens/admin/AdminRealEventBiScreen.js',{props:{route:{params:{eventId:id}}},authContext:verifiedAdminAuth({httpClient:{get:async()=>{if(failure)throw failure;return view();}}})});
  const settle=async()=>{for(let n=0;n<12;n++)await h.actAsync(()=>new Promise(done=>setImmediate(done)));};
  try{
    await settle();failure=new Error('rede indisponível');h.press('Atualizar indicadores');await settle();
    assert.ok(h.nodes.some(node=>textOf(node).includes('Dados desatualizados')));
    assert.ok(h.nodes.some(node=>textOf(node).includes('Arena teste')));
    failure={status:403};h.press('Atualizar indicadores');await settle();
    assert.ok(!h.nodes.some(node=>textOf(node).includes('Arena teste')));
  }finally{h.unmount();}
});
for(const change of ['event','account','unmount'])test(`ADMIN-09 resposta pendente não vaza após ${change}`,async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});
  let calls=0;const client={get:()=>++calls===1?pending:new Promise(()=>{})};
  const h=createHarness('screens/admin/AdminRealEventBiScreen.js',{props:{route:{params:{eventId:id}}},authContext:verifiedAdminAuth({httpClient:client})});
  try{
    if(change==='event')h.setProps({route:{params:{eventId:'abcdef00-0000-4000-8000-000000000002'}}});
    if(change==='account')h.setAuthContext(verifiedAdminAuth({httpClient:client,user:{id:'abcdef00-0000-4000-8000-000000000099',sessionId:'another'}}));
    if(change==='unmount')h.unmount();
    resolve(view());for(let n=0;n<12;n++)await h.actAsync(()=>new Promise(done=>setImmediate(done)));
    assert.ok(!h.nodes.some(node=>textOf(node).includes('Arena teste')));
  }finally{h.unmount();}
});
