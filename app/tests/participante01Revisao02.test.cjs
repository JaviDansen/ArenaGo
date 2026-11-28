// PARTICIPANTE-01 — Revisão 02: consulta/repetição/abandono de intenção, armazenamento condicional,
// revalidação complementar e invalidação da Home no render (R02-01..05).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule } = require('./helpers/questionnaireHarness.cjs');
const {
  backend, createApp, USER_A, USER_B, EVENT_A, EVENT_B, tick, uuid, deferred,
} = require('./helpers/admissionBackend.cjs');

const service = loadModule('services/eventAdmissionService.js', (name) => {
  if (name === 'react-native') return { Platform: { OS: 'web' } };
  if (name === 'expo-crypto') return { randomUUID: () => assert.fail('chave criada só pelo createKey do teste') };
  if (name === 'expo-secure-store') return {};
  if (name === './httpClient') return { httpClient: {} };
  return require(name);
}).exports;
const app = createApp(service);

/** Cenário 3.2: a primeira tentativa em A falha antes de chegar ao servidor (nada gravado). */
async function lostBeforeServer(a = app()) {
  await a.store.lookup('ABC');
  a.server.failNext({ isNetworkError: true });
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'uncertain');
  return { a, intent: await a.storage.get(USER_A) };
}

// ---------------------------------------------------------------- R02-01 consulta sem efeitos

test('R02-T01 (cenário 3.2): verificar tentativa sem registro com A aberto cria zero participações', async () => {
  const { a, intent } = await lostBeforeServer();
  await a.store.lookup('XYZ'); // participante decide ingressar em B
  assert.equal(a.store.getSnapshot().pendingIntent.eventId, EVENT_A);
  const verified = await a.store.reconcile();
  assert.equal(verified.kind, 'unconfirmed');
  assert.equal(a.server.db.creations, 0, 'consulta não ingressa no evento anterior');
  assert.equal(a.server.db.joinPosts.length, 1, 'somente o POST original perdido');
  assert.deepEqual(a.intentRequests().map(({ kind, key, eventId }) => ({ kind, key, eventId })),
    [{ kind: 'lookup', key: intent.key, eventId: EVENT_A }]);
  assert.deepEqual(await a.storage.get(USER_A), intent, 'R02-T11: not_found não apaga a intenção');
  assert.equal(a.store.getSnapshot().recovery.status, 'unconfirmed');
  // Sem resolução, B continua bloqueado (sem nova chave).
  assert.equal((await a.store.confirm(EVENT_B)).kind, 'error');
  assert.equal(a.server.db.joinPosts.length, 1);
});

test('R02-T02: verificar intenção concluída recupera o resultado original sem repetir o POST', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.server.dropNextJoinResponse();
  await a.store.confirm(EVENT_A);
  const result = await a.store.reconcile();
  assert.equal(result.outcome, 'current');
  assert.equal(result.participation.id, a.server.db.participations[0].id);
  assert.equal(a.server.db.joinPosts.length, 1);
  assert.equal(await a.storage.get(USER_A), null);
});

test('R02-T03/T16: intenções são isoladas por conta; troca de conta durante a recuperação é descartada', async () => {
  const storage = service.createAdmissionIntentStorage({ platformOS: 'web' });
  const { a } = await lostBeforeServer(app(backend(), { storage }));
  const gate = a.server.holdIntent();
  const pending = a.store.abandonPrevious();
  await tick();
  a.switchTo(USER_B);
  gate.resolve();
  assert.equal((await pending).kind, 'stale');
  assert.equal(a.store.getSnapshot().userId, USER_B);
  assert.equal(a.store.getSnapshot().recovery.status, 'idle');
  assert.equal(await storage.get(USER_B), null, 'B não herda intenção de A');
  assert.ok(await storage.get(USER_A), 'intenção de A preservada (o servidor decidirá na próxima consulta)');
  await a.store.lookup('XYZ');
  assert.equal(a.store.getSnapshot().pendingIntent, null);
});

test('R02-T04: chave que o servidor associa a outro evento fica bloqueada, sem alterar nada', async () => {
  const { a, intent } = await lostBeforeServer();
  // O servidor já tem essa chave ligada a B (cenário de integridade): consulta → conflict.
  a.server.db.keys.set(`${USER_A}#${intent.key}`, { eventId: EVENT_B, participationId: uuid('9', 2) });
  assert.equal((await a.store.reconcile()).kind, 'blocked');
  assert.equal((await a.store.abandonPrevious()).kind, 'blocked', '409 IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await a.storage.get(USER_A), intent);
  assert.equal(a.server.db.creations, 0);
});

// ---------------------------------------------------------------- repetir (ação explícita)

test('R02-T05: repetição explícita de tentativa não aplicada ingressa conforme o backend, com a mesma chave', async () => {
  const { a, intent } = await lostBeforeServer();
  const repeated = await a.store.repeatPrevious();
  assert.equal(repeated.kind, 'resolved');
  assert.equal(repeated.outcome, 'current');
  assert.equal(a.server.db.creations, 1);
  assert.deepEqual(a.keysUsed(), [intent.key, intent.key]);
  assert.equal(await a.storage.get(USER_A), null);
});

test('R02-T06: repetição de tentativa já concluída é replay, sem duplicação', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.server.dropNextJoinResponse();
  await a.store.confirm(EVENT_A);
  a.server.finish(a.server.db.participations[0].id);
  const repeated = await a.store.repeatPrevious();
  assert.equal(repeated.outcome, 'historical');
  assert.equal(a.server.db.creations, 1);
});

test('R02-T12: recusa de elegibilidade durante a recuperação não libera a intenção', async () => {
  const { a, intent } = await lostBeforeServer();
  a.server.db.events.ABC.state = 'closed';
  const repeated = await a.store.repeatPrevious();
  assert.equal(repeated.kind, 'unconfirmed');
  assert.match(repeated.message, /entradas neste evento foram encerradas/i);
  const kept = await a.storage.get(USER_A);
  assert.equal(kept.key, intent.key);
  assert.equal(kept.attempts, 2, 'a tentativa original pode estar em trânsito');
  assert.equal(a.server.db.creations, 0);
});

test('R02-04/R02-T12: só a primeira e única tentativa recusada libera a intenção; legado nunca', async () => {
  const a = app();
  await a.store.lookup('ABC');
  a.server.db.events.ABC.state = 'closed'; // fechou entre a consulta e o toque
  const refused = await a.store.confirm(EVENT_A);
  assert.equal(refused.kind, 'error');
  assert.equal(refused.revalidate, true);
  assert.equal(await a.storage.get(USER_A), null, 'única requisição com a chave foi recusada pelo servidor');

  // Intenção gravada antes da R02 (sem contador): recusa nunca prova resolução.
  const b = app();
  await b.storage.set({ userId: USER_A, eventId: EVENT_A, key: uuid('4', 1), confirmedParticipationId: null });
  b.server.db.events.ABC.state = 'closed';
  await b.store.lookup('XYZ');
  assert.equal((await b.store.repeatPrevious()).kind, 'unconfirmed');
  assert.ok(await b.storage.get(USER_A));
});

// ---------------------------------------------------------------- R02-02 abandono

test('R02-T07: abandono antes do POST original atrasado — a requisição atrasada não cria participação', async () => {
  const storage = service.createAdmissionIntentStorage({ platformOS: 'web' });
  const server = backend();
  const first = app(server, { storage });
  await first.store.lookup('ABC');
  const inTransit = server.holdJoin(); // POST ainda não chegou ao servidor
  const original = first.store.confirm(EVENT_A);
  await tick();
  const second = first.reopen(); // app reaberto enquanto o POST estava em trânsito
  await second.store.lookup('XYZ');
  const abandoned = await second.store.abandonPrevious();
  assert.equal(abandoned.outcome, 'abandoned');
  assert.equal(await storage.get(USER_A), null);
  inTransit.resolve();
  const late = await original;
  assert.equal(server.db.creations, 0, 'chave abandonada nunca cria participação');
  assert.equal(late.kind, 'error');
  assert.match(late.message, /cancelada definitivamente/);
  // R02-T13: depois do abandono, B usa nova chave independente.
  await second.store.revalidate();
  assert.equal((await second.store.confirm(EVENT_B)).kind, 'complete');
  const keys = server.db.joinPosts.map(post => post.key);
  assert.notEqual(keys[1], keys[0]);
  assert.equal(server.db.creations, 1);
});

test('R02-T08: ingresso original concluído antes do abandono é preservado e recuperado', async () => {
  const { a } = await (async () => {
    const x = app();
    await x.store.lookup('ABC');
    x.server.dropNextJoinResponse();
    await x.store.confirm(EVENT_A);
    return { a: x };
  })();
  const result = await a.store.abandonPrevious();
  assert.equal(result.kind, 'resolved');
  assert.equal(result.outcome, 'current', 'abandono não cancela participação existente');
  assert.equal(a.server.participationsOf(USER_A)[0].status, 'waiting');
  assert.equal(await a.storage.get(USER_A), null);
});

test('R02-T09/T10: resposta do abandono perdida preserva a intenção; nova consulta recupera o terminal', async () => {
  const { a, intent } = await lostBeforeServer();
  a.server.dropNextIntentResponse();
  const lost = await a.store.abandonPrevious();
  assert.equal(lost.kind, 'uncertain');
  assert.deepEqual(await a.storage.get(USER_A), intent, 'sem resposta, nada é presumido');
  const verified = await a.store.reconcile();
  assert.equal(verified.outcome, 'abandoned');
  assert.equal(await a.storage.get(USER_A), null);
  assert.equal(a.server.db.creations, 0);
  // Abandono repetido no servidor devolve o mesmo terminal.
  const again = await a.server.clientFor(() => USER_A).post('/participations/admission-intents/abandon',
    { eventId: EVENT_A }, { headers: { 'Idempotency-Key': intent.key } });
  assert.deepEqual(again, { intent: { state: 'abandoned' } });
});

test('R02-T24 (app): ações de recuperação concorrentes compartilham um único voo; outra ação aguarda', async () => {
  const { a } = await lostBeforeServer();
  const gate = a.server.holdIntent();
  const verifies = [a.store.reconcile(), a.store.reconcile()];
  const repeat = await a.store.repeatPrevious();
  assert.equal(repeat.kind, 'error', 'repetir não corre em paralelo com verificar');
  const revalidate = await a.store.revalidate();
  assert.equal(revalidate.kind, 'busy', 'revalidação não interfere na resolução em curso');
  await tick();
  gate.resolve();
  await Promise.all(verifies);
  assert.equal(a.intentRequests('lookup').length, 1);
  assert.equal(a.server.db.joinPosts.length, 1);
});

// ---------------------------------------------------------------- R02-03 armazenamento condicional

test('R02-03: create/update/clear são condicionais e serializados na mesma seção crítica', async () => {
  const storage = service.createAdmissionIntentStorage({ platformOS: 'web' });
  const intentA = { userId: USER_A, eventId: EVENT_A, key: uuid('5', 1), confirmedParticipationId: null, attempts: 0 };
  const intentB = { userId: USER_A, eventId: EVENT_B, key: uuid('5', 2), confirmedParticipationId: null, attempts: 0 };
  const [createdA, createdB] = await Promise.all([storage.create(intentA), storage.create(intentB)]);
  assert.equal(createdA.created, true);
  assert.equal(createdB.created, false, 'segunda criação não sobrescreve a primeira');
  assert.equal(createdB.intent.key, intentA.key);
  assert.equal(await storage.update(USER_A, intentB.key, { confirmedParticipationId: uuid('6', 1) }), null);
  assert.equal((await storage.get(USER_A)).confirmedParticipationId, null);
  const bumps = await Promise.all([1, 2, 3].map(() => storage.update(USER_A, intentA.key, current => ({ attempts: current.attempts + 1 }))));
  assert.deepEqual(bumps.map(intent => intent.attempts), [1, 2, 3], 'transições atômicas, sem leitura perdida');
  const updated = await storage.update(USER_A, intentA.key, { key: 'outra', eventId: EVENT_B, attempts: 9 });
  assert.equal(updated.key, intentA.key, 'identidade da intenção nunca muda');
  assert.equal(updated.eventId, EVENT_A);
  assert.equal(await storage.clear(USER_A, intentA.key, { attempts: 1 }), false, 'expectativa divergente');
  assert.equal(await storage.clear(USER_A, intentB.key), false, 'outra chave');
  assert.equal(await storage.clear(USER_A, intentA.key, { attempts: 9 }), true);
  assert.equal(await storage.get(USER_A), null);
});

test('R02-T14: resposta tardia de A recebida após a criação da intenção B não substitui a chave de B', async () => {
  const storage = service.createAdmissionIntentStorage({ platformOS: 'web' });
  const server = backend();
  const first = app(server, { storage });
  await first.store.lookup('ABC');
  const lateResponse = server.holdJoinResponse(); // A gravado no servidor, resposta atrasada
  const confirmA = first.store.confirm(EVENT_A);
  await tick(); await tick();
  const second = first.reopen();
  await second.store.lookup('XYZ');
  const recovered = await second.store.reconcile();
  assert.equal(recovered.outcome, 'current');
  server.finish(recovered.participation.id);
  await second.store.revalidate();
  assert.equal((await second.store.confirm(EVENT_B)).kind, 'complete');
  // Uma nova intenção B pendente para observar a sobrescrita.
  const intentB = { userId: USER_A, eventId: EVENT_B, key: uuid('7', 1), confirmedParticipationId: null, attempts: 1 };
  await storage.create(intentB);
  lateResponse.resolve();
  await confirmA;
  const stored = await storage.get(USER_A);
  assert.equal(stored.key, intentB.key, 'chave de B preservada');
  assert.equal(stored.confirmedParticipationId, null, 'prova de A não foi gravada em B');
});

test('R02-T15: logout e novo login na mesma conta — operação anterior não sobrescreve a nova sessão', async () => {
  const a = app();
  await a.store.lookup('ABC');
  const lateResponse = a.server.holdJoinResponse();
  const old = a.store.confirm(EVENT_A);
  await tick(); await tick();
  a.relogin();
  const intent = await a.storage.get(USER_A);
  lateResponse.resolve();
  assert.equal((await old).kind, 'stale');
  assert.equal(a.store.getSnapshot().status, 'idle', 'nova sessão não recebe o resultado da anterior');
  const stored = await a.storage.get(USER_A);
  assert.equal(stored.key, intent.key, 'mesma intenção; prova do servidor preservada nela');
  assert.equal(stored.confirmedParticipationId, a.server.db.participations[0].id);
  await a.store.lookup('ABC');
  assert.equal(a.store.getSnapshot().pendingIntent.confirmed, true);
  assert.equal((await a.store.reconcile()).outcome, 'current');
  assert.equal(a.server.db.creations, 1);
});

// ---------------------------------------------------------------- R02-04 revalidação complementar

test('R02-T17: atualização manual com evento aberto reconsulta e reflete o encerramento', async () => {
  const a = app();
  await a.store.lookup('ABC');
  assert.equal(a.store.getSnapshot().eligibility.eligible, true);
  a.server.db.events.ABC.state = 'closed';
  const gate = a.server.holdLookup();
  const pending = a.store.revalidate();
  await tick();
  assert.equal(a.store.getSnapshot().eligibilityStatus, 'revalidating', 'autorização anterior invalidada');
  assert.equal((await a.store.confirm(EVENT_A)).kind, 'error');
  const before = a.server.db.lookups;
  void a.store.revalidate();
  assert.equal(a.server.db.lookups, before, 'sem requisição redundante');
  gate.resolve();
  await pending;
  assert.deepEqual(structuredClone(a.store.getSnapshot().eligibility.blockingReasons), ['EVENT_REGISTRATION_CLOSED']);
  assert.equal(a.server.db.joinPosts.length, 0);
});

test('R02-04: recuperação independe da elegibilidade — evento encerrado ainda resolve a tentativa anterior', async () => {
  const { a } = await lostBeforeServer();
  a.server.db.events.ABC.state = 'closed';
  await a.store.lookup('ABC');
  assert.equal(a.store.getSnapshot().eligibility.eligible, false);
  assert.equal((await a.store.reconcile()).kind, 'unconfirmed');
  assert.equal((await a.store.abandonPrevious()).outcome, 'abandoned');
  assert.equal(a.server.db.creations, 0);
});

/** Backend de perfil: incompleto até o PUT do questionário. */
function profileBackend({ answers = null } = {}) {
  const state = { complete: false, puts: 0, fetchedUser: 0 };
  const client = {
    async get(path) {
      if (path.startsWith('/games')) return { games: [{ name: 'Minecraft' }] };
      if (path === '/profile/questionnaire') return answers ?? { hasCompleted: false, aboutYou: null, yourGames: [], gamesMarket: null };
      return assert.fail(`GET inesperado ${path}`);
    },
    async put(path) { assert.equal(path, '/profile/questionnaire'); state.puts++; state.complete = true; return { message: 'ok' }; },
    async post(path, body) {
      assert.equal(path, '/events/lookup');
      const blocking = state.complete ? [] : ['PROFILE_INCOMPLETE'];
      return { event: { id: EVENT_A, name: 'A', timezone: 'America/Sao_Paulo', startsAt: '2026-11-08T10:00:00.000Z',
        officialEndsAt: '2026-11-08T20:00:00.000Z', operationalDeadlineAt: '2026-11-08T21:00:00.000Z', externalQueueEnabled: true },
      eligibility: { eligible: blocking.length === 0, blockingReasons: blocking }, accessCode: body.accessCode };
    },
  };
  return { state, client };
}

async function fillAndSave(h) {
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  h.act(() => h.inputBirthDate('01/01/1995'));
  h.act(() => h.press('Feminino'));
  h.act(() => h.press('Superior'));
  h.act(() => h.press('Avançar para a próxima etapa'));
  h.act(c => c.handleAddGame('Minecraft'));
  h.act(() => h.press('Avançar para a Etapa 3'));
  h.act(c => { c.handleSelectMarketKnowledge('Conheço um pouco.'); c.handleSelectMarketInterest('Sim, tenho interesse.'); });
  h.act(c => c.handleFinishQuestionnaire());
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
}

const questionnaireFields = ['handleFinishQuestionnaire', 'handleAddGame', 'handleSelectMarketKnowledge',
  'handleSelectMarketInterest', 'currentStepIndex', 'saveError'];

test('R02-T18: perfil efetivamente incompleto → questionário salvo → retorno à jornada → elegibilidade atualizada', async () => {
  const profile = profileBackend();
  const store = service.createEventAdmissionStore({
    client: profile.client, getIdentity: () => ({ userId: USER_A, epoch: 1 }),
    refreshParticipation: async () => {}, getParticipationSnapshot: () => ({}),
    intentStorage: service.createAdmissionIntentStorage({ platformOS: 'web' }),
  });
  store.setIdentity({ userId: USER_A, epoch: 1 });
  await store.lookup('ABC');
  assert.deepEqual(structuredClone(store.getSnapshot().eligibility.blockingReasons), ['PROFILE_INCOMPLETE']);

  let marked = 0;
  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    authContext: { isAuthenticated: true, user: { id: USER_A, name: 'Ana', hasCompletedQuestionnaire: true },
      httpClient: profile.client, markQuestionnaireCompleted() { marked++; },
      async fetchCurrentUser() { profile.state.fetchedUser++; } },
    fields: questionnaireFields, props: { route: { params: { returnTo: 'EventConfirmation' } } }, canGoBack: true,
  });
  await fillAndSave(h);
  assert.equal(profile.state.puts, 1);
  assert.equal(marked, 1);
  assert.equal(profile.state.fetchedUser, 1, 'estado da conta reconsultado após salvar');
  assert.deepEqual(h.navigationCalls.map(call => call.type), ['back'], 'volta para a confirmação do evento');
  h.unmount();
  // A confirmação revalida ao recuperar o foco (ver eventEntry R01-12/23): consulta oficial.
  await store.revalidate();
  assert.equal(store.getSnapshot().eligibility.eligible, true);
  assert.equal(store.getSnapshot().event.id, EVENT_A);
});

test('R02-T18: questionário que deixou de atender aos requisitos é pré-preenchido e volta à jornada', async () => {
  const profile = profileBackend({ answers: { hasCompleted: true,
    aboutYou: { birthDate: '1995-01-01', gender: 'Feminino', otherGender: null, education: 'Superior' },
    yourGames: ['Minecraft'], gamesMarket: { marketKnowledge: 'Conheço um pouco.', marketInterest: 'Sim, tenho interesse.' } } });
  const h = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    authContext: { isAuthenticated: true, user: { id: USER_A, name: 'Ana', hasCompletedQuestionnaire: true },
      httpClient: profile.client, markQuestionnaireCompleted() {}, async fetchCurrentUser() {} },
    fields: questionnaireFields, props: { route: { params: { returnTo: 'EventConfirmation' } } }, canGoBack: true,
  });
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  h.act(() => h.press('Avançar para a próxima etapa'));
  h.act(() => h.press('Avançar para a Etapa 3'));
  h.act(c => c.handleFinishQuestionnaire());
  await h.actAsync(() => new Promise(resolve => setImmediate(resolve)));
  assert.equal(profile.state.puts, 1, 'respostas anteriores reaproveitadas');
  assert.deepEqual(h.navigationCalls.map(call => call.type), ['back']);
  h.unmount();
});

test('R02-T18: fluxo obrigatório de novo usuário e edição pelo Perfil continuam com seus destinos', async () => {
  const fresh = profileBackend();
  const newcomer = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    authContext: { isAuthenticated: true, user: { id: USER_A, name: 'Ana', hasCompletedQuestionnaire: false },
      httpClient: fresh.client, markQuestionnaireCompleted() {}, async fetchCurrentUser() {} },
    fields: questionnaireFields, props: { route: { params: {} } }, canGoBack: false,
  });
  await fillAndSave(newcomer);
  assert.equal(newcomer.navigationCalls[0].type, 'reset', 'novo usuário segue para MainTabs');
  newcomer.unmount();
  // Mesmo com returnTo, sem tela anterior (raiz da pilha obrigatória) mantém o reset.
  const rooted = createHarness('screens/profile/ProfileQuestionnaireScreen.js', {
    authContext: { isAuthenticated: true, user: { id: USER_A, name: 'Ana', hasCompletedQuestionnaire: false },
      httpClient: profileBackend().client, markQuestionnaireCompleted() {}, async fetchCurrentUser() {} },
    fields: questionnaireFields, props: { route: { params: { returnTo: 'EventConfirmation' } } }, canGoBack: false,
  });
  await fillAndSave(rooted);
  assert.equal(rooted.navigationCalls[0].type, 'reset');
  rooted.unmount();
});

// ---------------------------------------------------------------- R02-05 Home: seleção no render

const eventTime = loadModule('utils/eventTime.js', require).exports;
const overviewUtils = loadModule('utils/homeOverview.js', name => name === './eventTime.js' ? eventTime : require(name)).exports;
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const historyItem = (id = P1) => ({ participationId: id, event: { id: EVENT_A, name: 'Evento' }, status: 'finished',
  joinedAt: '2026-11-08T13:00:00.000000Z', arenaEnteredAt: null, finishedAt: '2026-11-08T15:00:00.000000Z',
  completedServicesCount: 1, evaluation: { eligible: true, submitted: false, pending: true } });

/** Hook real com React simulado; `peek` devolve o resultado do render ANTES de qualquer efeito. */
function hookRig(services) {
  const slots = [], cleanups = [];
  let cursor = 0, effects = [];
  const react = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useEffect(callback, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, k) => !Object.is(value, previous[k]))) { slots[i] = deps; effects.push({ i, callback }); }
    },
  };
  const module = loadModule('screens/home/useHomeOverview.js', name => {
    if (name === 'react') return react;
    if (name === '../../services/participationHistoryService.js') return services;
    if (name === '../../utils/homeOverview.js') return overviewUtils;
    return require(name);
  }).exports;
  const flush = () => {
    for (const { i, callback } of effects.splice(0)) {
      if (typeof cleanups[i] === 'function') cleanups[i]();
      const cleanup = callback();
      cleanups[i] = typeof cleanup === 'function' ? cleanup : null;
    }
  };
  return {
    peek(params) { cursor = 0; const result = module.useHomeOverview(params); return result; },
    commit() { flush(); },
    render(params) { cursor = 0; module.useHomeOverview(params); flush(); cursor = 0; const result = module.useHomeOverview(params); effects = []; return result; },
  };
}
const clients = new Map();
const authFor = (userId, epoch = 1, clientId = 'main') => {
  const k = `${userId}#${epoch}#${clientId}`;
  if (!clients.has(k)) clients.set(k, { id: k });
  return { isAuthenticated: true, user: { id: userId }, httpClient: clients.get(k), getSessionEpoch: () => epoch, isIdentityVerified: () => true };
};
const returned = ids => ({ pendingEvaluationParticipationIds: ids, recentFinalization: null });
const settled = async rig => { await tick(); await tick(); };

test('R02-T19: mudança da versão de retorno — vazio antigo e avaliação antiga não aparecem antes dos efeitos', async () => {
  let items = [];
  const rig = hookRig({
    fetchParticipationHistory: async () => ({ items, nextCursor: null }),
    fetchPendingEvaluationHistoryItem: async () => historyItem(),
  });
  const params = (v, ids = []) => ({ auth: authFor(USER_A), enabled: true, focused: true, returnState: returned(ids), returnStateVersion: v });
  rig.render(params(1));
  await settled(rig);
  assert.equal(rig.render(params(1)).status, 'empty');
  const firstRender = rig.peek(params(2)); // render do novo contexto, efeitos ainda não executados
  assert.equal(firstRender.status, 'loading', 'vazio anterior não é conclusão atual');

  items = [historyItem()];
  rig.commit(); await settled(rig);
  assert.equal(rig.render(params(2, [P1])).pending.status, 'checking');
  await settled(rig);
  assert.equal(rig.render(params(2, [P1])).pending.status, 'single');
  const nextVersion = rig.peek(params(3, [P1]));
  assert.equal(nextVersion.pending.status, 'checking', 'avaliação antiga não fica clicável');
  assert.equal(nextVersion.pending.item, null);
  assert.equal(nextVersion.status, 'history');
  assert.equal(nextVersion.refreshing, true, 'histórico confirmado da mesma conta fica visível como atualização');
});

test('R02-T20: mudança do cliente HTTP invalida histórico e pendência antes dos efeitos', async () => {
  const rig = hookRig({
    fetchParticipationHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingEvaluationHistoryItem: async () => historyItem(),
  });
  const base = { enabled: true, focused: true, returnState: returned([P1]), returnStateVersion: 1 };
  rig.render({ ...base, auth: authFor(USER_A, 1, 'main') });
  await settled(rig);
  const confirmed = rig.render({ ...base, auth: authFor(USER_A, 1, 'main') });
  assert.equal(confirmed.status, 'history'); assert.equal(confirmed.pending.status, 'single');
  const otherClient = rig.peek({ ...base, auth: authFor(USER_A, 1, 'reissued') });
  assert.equal(otherClient.status, 'loading', 'dados de outro cliente não são exibidos');
  assert.equal(otherClient.recent, null);
  assert.equal(otherClient.pending.status, 'checking');
});

test('R02-T19: perda e recuperação de foco e mudança de pendências invalidam ações no render', async () => {
  const rig = hookRig({
    fetchParticipationHistory: async () => ({ items: [historyItem()], nextCursor: null }),
    fetchPendingEvaluationHistoryItem: async () => historyItem(),
  });
  const params = (focused, ids = [P1]) => ({ auth: authFor(USER_A), enabled: true, focused, returnState: returned(ids), returnStateVersion: 1 });
  rig.render(params(true)); await settled(rig);
  assert.equal(rig.render(params(true)).pending.status, 'single');
  rig.render(params(false));
  const regained = rig.peek(params(true));
  assert.equal(regained.pending.status, 'checking', 'ação revalidada a cada retorno de foco');
  assert.equal(regained.refreshing, true);
  rig.commit(); await settled(rig);
  assert.equal(rig.render(params(true)).pending.status, 'single');
  const changed = rig.peek(params(true, [P2]));
  assert.equal(changed.pending.status, 'checking');
  assert.equal(changed.pending.item, null, 'pendência de outra participação não herda a ação');
  assert.equal(rig.peek(params(true, [P1, P2])).pending.status, 'multiple');
});

test('R02-T19: respostas fora de ordem continuam descartadas com a seleção no render', async () => {
  const pages = [deferred(), deferred()];
  let n = 0;
  const rig = hookRig({
    fetchParticipationHistory: () => pages[n++].promise,
    fetchPendingEvaluationHistoryItem: async () => null,
  });
  const params = v => ({ auth: authFor(USER_A), enabled: true, focused: true, returnState: returned([]), returnStateVersion: v });
  rig.render(params(1));
  rig.render(params(2));
  pages[1].resolve({ items: [historyItem(P2)], nextCursor: null }); await tick();
  pages[0].resolve({ items: [], nextCursor: null }); await tick();
  const result = rig.render(params(2));
  assert.equal(result.status, 'history');
  assert.equal(result.recent.participationId, P2);
});
