const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, nodes, textOf, createParticipantUiStubs, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');
const history = loadModule('services/participationHistoryService.js', require).exports;
const P = '22222222-2222-4222-8222-222222222222', E = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const page = (name, eventId = E, participationId = P) => ({ items: [{ participationId, event: { id: eventId, name }, status: 'active',
  joinedAt: '2026-11-17T10:00:00Z', arenaEnteredAt: '2026-11-17T10:00:00Z', finishedAt: null,
  completedServicesCount: 0, evaluation: { eligible: false, submitted: false, pending: false } }], nextCursor: null });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function rig(get) {
  const hooks = [], effects = []; let cursor = 0, tree;
  let props = { participation: { id: P, eventId: E }, refreshParticipation() {} };
  const auth = { isAuthenticated: true, user: { id: 'A' }, getSessionEpoch: () => 1, httpClient: { get } };
  const memo = (factory, deps) => { const i = cursor++; if (!hooks[i] || deps.some((d,j) => !Object.is(d,hooks[i].deps[j]))) hooks[i] = { value: factory(), deps }; return hooks[i].value; };
  const screen = loadModule('screens/arena/RealArenaScreen.js', name => {
    if (name === 'react') return {
      useState: initial => { const i=cursor++; if (!(i in hooks)) hooks[i]={value:initial}; return [hooks[i].value, next => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }]; },
      useRef: initial => { const i=cursor++; if (!(i in hooks)) hooks[i]={current:initial}; return hooks[i]; },
      useCallback: (fn,deps) => memo(() => fn,deps), useMemo: memo,
      useEffect: (fn,deps) => { const i=cursor++; if (!hooks[i] || deps.some((d,j) => !Object.is(d,hooks[i].deps[j]))) effects.push(() => { hooks[i]?.cleanup?.(); hooks[i]={deps,cleanup:fn()}; }); },
    };
    if (name === '@react-navigation/native') return { useFocusEffect() {} };
    if (name === 'react-native') return { StyleSheet: { create: s => s }, View:'View',Text:'Text',ScrollView:'ScrollView', ActivityIndicator:'ActivityIndicator',AppState:{currentState:'active',addEventListener:()=>({remove(){}})} };
    if (name === 'expo-status-bar') return { StatusBar:'StatusBar' };
    if (name === 'expo-crypto') return {randomUUID:()=>B};
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') return {useAuth:()=>auth};
    if (name === '../../services/participationHistoryService') return history;
    if (name === '../../services/arenaQueueService') return {createArenaQueueCoordinator:()=>({}),describeArenaError:()=>''};
    if (name === '../../services/participationActionService') return {createParticipationActionCoordinator:()=>({})};
    if (name === '../../services/arenaQueueIntentStorage') return {defaultArenaQueueIntentStorage:{}};
    if (name === '../../services/queueAlertService') return {createQueueAlertManager:()=>({})};
    if (name === '../../utils/arenaQueuePresentation') return loadModule('utils/arenaQueuePresentation.js', require).exports;
    return require(name);
  }).exports.default;
  const render = () => { cursor=0; tree=screen(props); while(effects.length) effects.shift()(); return nodes(tree); };
  render();
  return { auth, render, title: () => textOf(render().find(n=>n.props?.testID==='arena-header')),
    setEvent: eventId => {props={...props,participation:{id:P,eventId}};render();},
    flush: async () => {await new Promise(r=>setImmediate(r));render();},
    unmount: () => hooks.forEach(h=>h?.cleanup?.()),
  };
}
test('02A-R01: nome oficial autenticado é consultado novamente após reabrir a tela', async () => {
  const requests=[];
  for(let restart=0;restart<2;restart++) {
    const h=rig(async (url,options)=>{requests.push([url,options]);return page('Evento oficial restaurado');});
    await h.flush(); assert.match(h.title(),/Evento oficial restaurado/); h.unmount();
  }
  assert.deepEqual(structuredClone(requests),Array.from({length:2},()=>['/participations/history?limit=50',{auth:true}]));
});
test('02A-R01: nome extenso completo e respostas atrasadas de conta/evento são isolados', async () => {
  const old=defer(), next=defer(); let count=0;
  const h=rig(()=>count++===0?old.promise:next.promise);
  assert.match(h.title(),/Carregando evento/);
  h.auth.user={id:'B'}; h.auth.getSessionEpoch=()=>2; h.setEvent(B);
  old.resolve(page('Nome antigo')); await h.flush(); assert.doesNotMatch(h.title(),/Nome antigo/);
  const long='Evento oficial com nome muito extenso para demonstrar a quebra natural do título';
  next.resolve(page(long,B)); await h.flush(); assert.ok(h.title().includes(long)); h.unmount();
});
test('02A-R01: indisponibilidade oferece recuperação contextual e preserva ações restantes', async () => {
  let failed=true;
  const h=rig(async()=>{if(failed)throw Error('offline');return page('Evento recuperado');});
  await h.flush(); assert.match(h.title(),/Evento indisponível/);
  const buttons=()=>h.render().filter(n=>n.props?.title);
  assert.equal(buttons().some(n=>n.props.title==='Atualizar fila e experiências'),false);
  assert.equal(buttons().some(n=>n.props.title==='Atualizar situação da participação'),false);
  assert.ok(buttons().some(n=>n.props.title==='Sair da Arena'));
  failed=false; buttons().find(n=>n.props.title==='Tentar novamente').props.onPress(); h.render(); await h.flush();
  assert.match(h.title(),/Evento recuperado/); h.unmount();
});
test('02A-R01: busca paginada valida participação/evento e descarta resposta invalidada', async () => {
  const requests=[];
  const client={get:async url=>{requests.push(url);return requests.length===1?{items:[],nextCursor:'next'}:page('Nome oficial');}};
  assert.equal(await history.fetchCurrentArenaEventName(client,P,E),'Nome oficial');
  assert.match(requests[1],/cursor=next/);
  await assert.rejects(history.fetchCurrentArenaEventName({get:async()=>page('Outro evento',B)},P,E),/não confirmado/);
  let current=true; const pending=defer(); const result=history.fetchCurrentArenaEventName({get:()=>pending.promise},P,E,{isCurrent:()=>current});
  current=false; pending.resolve(page('Atrasado')); assert.equal(await result,null);
});
