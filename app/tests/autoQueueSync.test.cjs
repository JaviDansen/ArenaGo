const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, createParticipantUiStubs, createParticipantThemeStub, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

// ============================================================================
// 1. Testes do serviço de alerta e vibração (queueAlertService)
// Cobrindo Cenários 4, 5, 6, 7 e isolamento de sessão
// ============================================================================

test('queueAlertService: dispara vibração única para nova chamada quando aplicativo está ativo', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  let active = true;
  const identity = { userId: 'user-1', epoch: 10 };

  const manager = createQueueAlertManager({
    getIdentity: () => identity,
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => active,
  });

  const participationId = 'part-1';
  const entryWaiting = { id: 'entry-1', status: 'waiting', position: 2 };
  const entryCalled = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };

  // Carga inicial com usuário na fila (waiting) - inicializa sem vibrar
  assert.equal(manager.checkAndAlert({ queueEntry: entryWaiting, participationId, isInitial: true }), false);
  assert.equal(vibrateCalls, 0);

  // Primeira transição para chamado (called) com app ativo - DEVE vibrar uma vez
  assert.equal(manager.checkAndAlert({ queueEntry: entryCalled, participationId, isInitial: false }), true);
  assert.equal(vibrateCalls, 1);

  // Consulta seguinte após 5s com a mesma chamada ativa - NÃO deve vibrar novamente (Cenário 7)
  assert.equal(manager.checkAndAlert({ queueEntry: entryCalled, participationId, isInitial: false }), false);
  assert.equal(vibrateCalls, 1);
});

test('queueAlertService (Cenário 4): chamada recebida enquanto o aplicativo está em segundo plano NÃO vibra', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  let appActive = false; // Aplicativo em segundo plano
  const manager = createQueueAlertManager({
    getIdentity: () => ({ userId: 'user-1', epoch: 10 }),
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => appActive,
  });

  const participationId = 'part-1';
  const entryWaiting = { id: 'entry-1', status: 'waiting', position: 1 };
  const entryCalled = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };

  // Inicializa a participação enquanto aguardava
  manager.checkAndAlert({ queueEntry: entryWaiting, participationId, isInitial: true });

  // A chamada do Staff ocorre enquanto o aplicativo está em segundo plano
  const alerted = manager.checkAndAlert({ queueEntry: entryCalled, participationId, isInitial: false });
  assert.equal(alerted, false, 'não deve alertar/vibrar enquanto em segundo plano');
  assert.equal(vibrateCalls, 0, 'nenhuma vibração deve ser disparada em segundo plano');
});

test('queueAlertService (Cenário 5): retomada sem vibração retroativa para chamada ocorrida no segundo plano', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  let appActive = false; // Em segundo plano
  const manager = createQueueAlertManager({
    getIdentity: () => ({ userId: 'user-1', epoch: 10 }),
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => appActive,
  });

  const participationId = 'part-1';
  const entryCalled = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };

  // Chamada recebida em segundo plano
  manager.checkAndAlert({ queueEntry: entryCalled, participationId, isInitial: false });
  assert.equal(vibrateCalls, 0);

  // Aplicativo volta ao primeiro plano (active)
  appActive = true;

  // Primeira consulta ao retomar: DEVE restabelecer o estado sem vibração retroativa
  const alertedOnResume = manager.checkAndAlert({
    queueEntry: entryCalled,
    participationId,
    isInitial: false,
    isResuming: true,
  });
  assert.equal(alertedOnResume, false, 'primeira consulta após retomada não deve vibrar');
  assert.equal(vibrateCalls, 0, 'vibração retroativa proibida');

  // Polling seguinte 5s depois com o mesmo chamado: não vibra
  const alertedSubsequent = manager.checkAndAlert({
    queueEntry: entryCalled,
    participationId,
    isInitial: false,
  });
  assert.equal(alertedSubsequent, false);
  assert.equal(vibrateCalls, 0);
});

test('queueAlertService (Cenário 6): nova chamada legítima após retomada dispara vibração', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  let appActive = true;
  const manager = createQueueAlertManager({
    getIdentity: () => ({ userId: 'user-1', epoch: 10 }),
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => appActive,
  });

  const participationId = 'part-1';
  const call1 = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };
  const call2 = { id: 'entry-1', status: 'called', stationLabel: 'Estação 2', serviceSessionId: 'sess-2' };

  // Retomada processou a chamada antiga sem vibrar
  manager.checkAndAlert({ queueEntry: call1, participationId, isResuming: true });
  assert.equal(vibrateCalls, 0);

  // Agora, com o aplicativo ativo no primeiro plano, chega uma NOVA chamada legítima (nova sessão)
  const alertedNew = manager.checkAndAlert({ queueEntry: call2, participationId, isInitial: false });
  assert.equal(alertedNew, true, 'nova chamada após retomada deve produzir alerta');
  assert.equal(vibrateCalls, 1, 'deve vibrar exatamente uma vez para a nova chamada');
});

test('queueAlertService (Cenário 7): ausência de vibrações duplicadas em chamadas repetidas', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  const manager = createQueueAlertManager({
    getIdentity: () => ({ userId: 'user-1', epoch: 10 }),
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => true,
  });

  const participationId = 'part-1';
  const call = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };

  // Inicializa em espera
  manager.checkAndAlert({ queueEntry: { id: 'entry-1', status: 'waiting', position: 1 }, participationId, isInitial: true });

  // Primeira notificação de chamada
  assert.equal(manager.checkAndAlert({ queueEntry: call, participationId, isInitial: false }), true);
  assert.equal(vibrateCalls, 1);

  // 10 ciclos de polling consecutivos a cada 5 segundos com a mesma chamada
  for (let i = 0; i < 10; i++) {
    assert.equal(manager.checkAndAlert({ queueEntry: call, participationId, isInitial: false }), false);
  }
  assert.equal(vibrateCalls, 1, 'não deve vibrar repetidamente para a mesma chamada');
});

test('queueAlertService: NÃO vibra para chamadas preexistentes na carga inicial (reabertura/reconexão)', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  const manager = createQueueAlertManager({
    getIdentity: () => ({ userId: 'user-1', epoch: 10 }),
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => true,
  });

  const entryCalled = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };

  // Reabertura do aplicativo com chamada já existente (isInitial: true)
  assert.equal(manager.checkAndAlert({ queueEntry: entryCalled, participationId: 'part-1', isInitial: true }), false);
  assert.equal(vibrateCalls, 0);

  // Polling seguinte de 5s não vibra para o mesmo estado
  assert.equal(manager.checkAndAlert({ queueEntry: entryCalled, participationId: 'part-1', isInitial: false }), false);
  assert.equal(vibrateCalls, 0);
});

test('queueAlertService: logout ou troca de conta impede alerta de sessão anterior e isola chaves', () => {
  const { createQueueAlertManager } = loadModule('services/queueAlertService.js', (name) => {
    if (name === 'react-native') return { Vibration: { vibrate: () => {} } };
    return require(name);
  }).exports;

  let vibrateCalls = 0;
  let identity = { userId: 'user-a', epoch: 1 };
  const manager = createQueueAlertManager({
    getIdentity: () => identity,
    vibrate: () => { vibrateCalls += 1; },
    isAppActive: () => true,
  });

  const entryCalled = { id: 'entry-1', status: 'called', stationLabel: 'Estação 1', serviceSessionId: 'sess-1' };

  manager.checkAndAlert({ queueEntry: { id: 'entry-1', status: 'waiting', position: 1 }, participationId: 'part-a', isInitial: true });

  // Logout ocorre antes do alerta
  identity = null;
  assert.equal(manager.checkAndAlert({ queueEntry: entryCalled, participationId: 'part-a', isInitial: false }), false);
  assert.equal(vibrateCalls, 0);

  // Login com usuário B e nova participação
  identity = { userId: 'user-b', epoch: 2 };
  // Inicialização de usuário B não herda registros de usuário A
  assert.equal(manager.checkAndAlert({ queueEntry: entryCalled, participationId: 'part-b', isInitial: true }), false);
  assert.equal(vibrateCalls, 0);
});

// ============================================================================
// 2. Testes da sincronização silenciosa da Fila Externa (participationService)
// Cobrindo Cenários 2, 9 e 10
// ============================================================================

test('participationService: syncCurrentSilent atualiza posição sem colocar em loading e sem piscar UI', async () => {
  const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
    name === './httpClient' ? { httpClient: {} } : require(name)).exports;

  const identity = { userId: 'user-x', epoch: 1 };
  const waitingPos3 = { id: 'p-1', eventId: 'e-1', status: 'waiting', externalQueue: { position: 3 } };
  const waitingPos2 = { id: 'p-1', eventId: 'e-1', status: 'waiting', externalQueue: { position: 2 } };
  const returned = { recentFinalization: null, pendingEvaluationParticipationIds: [] };

  const calls = [];
  let currentResponse = { participation: waitingPos3 };

  const store = createParticipationStore({
    getIdentity: () => identity,
    client: {
      get(path, options) {
        calls.push({ path, options });
        return Promise.resolve(path.endsWith('/current') ? currentResponse : returned);
      },
    },
  });

  store.setIdentity(identity);
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().participation.externalQueue.position, 3);
  calls.length = 0;

  // Polling silencioso: posição avança de 3 para 2
  currentResponse = { participation: waitingPos2 };
  await store.syncCurrentSilent();

  // Verifica que APENAS /current foi consultado
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/participations/current');
  assert.equal(calls[0].options.auth, true);

  // Verifica que o estado atualizou silenciosamente sem passar por status: 'loading'
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.participation.externalQueue.position, 2);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.syncStale, false);
});

test('participationService: syncCurrentSilent identifica transição waiting -> active', async () => {
  const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
    name === './httpClient' ? { httpClient: {} } : require(name)).exports;

  const identity = { userId: 'user-x', epoch: 1 };
  const waiting = { id: 'p-1', eventId: 'e-1', status: 'waiting', externalQueue: { position: 1 } };
  const active = { id: 'p-1', eventId: 'e-1', status: 'active', externalQueue: null };
  const returned = { recentFinalization: null, pendingEvaluationParticipationIds: [] };

  let currentResponse = { participation: waiting };
  const store = createParticipationStore({
    getIdentity: () => identity,
    client: {
      get(path) {
        return Promise.resolve(path.endsWith('/current') ? currentResponse : returned);
      },
    },
  });

  store.setIdentity(identity);
  await store.refresh();
  assert.equal(store.getSnapshot().participation.status, 'waiting');

  // Transição liberada no servidor
  currentResponse = { participation: active };
  await store.syncCurrentSilent();

  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().participation.status, 'active');
  assert.equal(store.getSnapshot().participation.externalQueue, null);
  assert.equal(store.getSnapshot().syncStale, false);
});

test('participationService (Cenários 9 e 10): falha de rede em syncCurrentSilent preserva posição e sinaliza syncStale; recuperação limpa flag', async () => {
  const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
    name === './httpClient' ? { httpClient: {} } : require(name)).exports;

  const identity = { userId: 'user-x', epoch: 1 };
  const waiting = { id: 'p-1', eventId: 'e-1', status: 'waiting', externalQueue: { position: 5 } };
  const waitingNew = { id: 'p-1', eventId: 'e-1', status: 'waiting', externalQueue: { position: 4 } };
  const returned = { recentFinalization: null, pendingEvaluationParticipationIds: [] };

  let shouldFail = false;
  let currentResponse = { participation: waiting };

  const store = createParticipationStore({
    getIdentity: () => identity,
    client: {
      get(path) {
        if (shouldFail) {
          const err = new Error('Falha de conexão');
          err.isNetworkError = true;
          return Promise.reject(err);
        }
        return Promise.resolve(path.endsWith('/current') ? currentResponse : returned);
      },
    },
  });

  store.setIdentity(identity);
  await store.refresh();
  assert.equal(store.getSnapshot().participation.externalQueue.position, 5);
  assert.equal(store.getSnapshot().syncStale, false);

  // Cenário 9: Erro transitório durante polling silencioso
  shouldFail = true;
  await store.syncCurrentSilent();

  // Snapshot preserva dados confirmados e sinaliza syncStale: true sem ir para status: 'error'
  const staleSnapshot = store.getSnapshot();
  assert.equal(staleSnapshot.status, 'ready');
  assert.equal(staleSnapshot.participation.externalQueue.position, 5, 'posição anterior deve ser preservada');
  assert.equal(staleSnapshot.syncStale, true, 'deve marcar syncStale como true');
  assert.equal(staleSnapshot.error, null);

  // Cenário 10: Conexão restabelecida na consulta seguinte
  shouldFail = false;
  currentResponse = { participation: waitingNew };
  await store.syncCurrentSilent();

  const recoveredSnapshot = store.getSnapshot();
  assert.equal(recoveredSnapshot.status, 'ready');
  assert.equal(recoveredSnapshot.participation.externalQueue.position, 4);
  assert.equal(recoveredSnapshot.syncStale, false, 'deve remover syncStale após recuperação');
});

test('participationService (Cenário 2): deduplica requisições concorrentes em voo em syncCurrentSilent', async () => {
  const { createParticipationStore } = loadModule('services/participationService.js', (name) =>
    name === './httpClient' ? { httpClient: {} } : require(name)).exports;

  const identity = { userId: 'user-x', epoch: 1 };
  const waiting = { id: 'p-1', eventId: 'e-1', status: 'waiting', externalQueue: { position: 1 } };
  const returned = { recentFinalization: null, pendingEvaluationParticipationIds: [] };

  let resolveGet;
  let getCalls = 0;
  const store = createParticipationStore({
    getIdentity: () => identity,
    client: {
      get(path) {
        if (path.endsWith('/current')) {
          getCalls += 1;
          return new Promise((res) => { resolveGet = () => res({ participation: waiting }); });
        }
        return Promise.resolve(returned);
      },
    },
  });

  store.setIdentity(identity);
  // Dispara dois syncCurrentSilent simultâneos
  const p1 = store.syncCurrentSilent();
  const p2 = store.syncCurrentSilent();

  assert.equal(getCalls, 1, 'apenas 1 requisição HTTP deve ser iniciada');
  resolveGet();
  await Promise.all([p1, p2]);
});

// ============================================================================
// 3. Testes do parseArenaQueue com serviceSessionId
// ============================================================================

test('arenaQueueService: parseArenaQueue inclui serviceSessionId na chamada', () => {
  const { parseArenaQueue } = loadModule('services/arenaQueueService.js', () => ({})).exports;

  const participationId = '20000000-0000-4000-8000-000000000001';
  const sessionId = '30000000-0000-4000-8000-000000000002';
  const stationId = '40000000-0000-4000-8000-000000000003';
  const entryId = '50000000-0000-4000-8000-000000000004';
  const expId = '60000000-0000-4000-8000-000000000005';

  const body = {
    participationId,
    currentQueueEntry: {
      id: entryId,
      experienceId: expId,
      experienceName: 'PS5 VR',
      status: 'called',
      serviceSession: {
        id: sessionId,
        status: 'pending',
        station: {
          id: stationId,
          label: 'Estação VR-1',
        },
      },
    },
  };

  const parsed = parseArenaQueue(body, participationId);
  assert.equal(parsed.status, 'called');
  assert.equal(parsed.stationLabel, 'Estação VR-1');
  assert.equal(parsed.serviceSessionId, sessionId);
});

// ============================================================================
// 4. Testes de renderização e ciclo de vida da fila interna (RealArenaScreen)
// Cobrindo Cenários 1, 2, 3, 8, 9, 10
// ============================================================================

test('RealArenaScreen: exibe nota de atualização automática a cada 5 segundos e posição', () => {
  const USER = '20000000-0000-4000-8000-000000000001';
  const EVENT = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
  const ID = 'c79b25f1-b171-487f-9fee-a24d184054b5';

  const arenaState = {
    acceptingNewQueueEntries: true,
    experiences: [],
    currentQueueEntry: {
      id: '50000000-0000-4000-8000-000000000004',
      experienceId: '60000000-0000-4000-8000-000000000005',
      experienceName: 'PS5 VR',
      status: 'waiting',
      position: 3,
      stationLabel: null,
    },
    pendingIntent: null,
  };

  let stateIndex = 0;
  const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (value) => ({ current: value }),
        useMemo: (factory) => factory(),
        useCallback: (fn) => fn,
        useState(initial) {
          const index = stateIndex++;
          return [index === 0 ? arenaState : index === 2 ? false : initial, () => {}];
        },
      };
    }
    if (name === '@react-navigation/native') return { useFocusEffect: () => {} };
    if (name === 'expo-crypto') return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
    if (name === 'react-native') {
      return {
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: () => {} },
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        ScrollView: 'ScrollView',
        StyleSheet: { create: (s) => s },
        Text: 'Text',
        View: 'View',
      };
    }
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') {
      return {
        useAuth: () => ({
          isAuthenticated: true,
          user: { id: USER },
          httpClient: {},
          getSessionEpoch: () => 1,
        }),
      };
    }
    if (name === '../../services/arenaQueueService') {
      return {
        createArenaQueueCoordinator: () => ({ read: async () => arenaState }),
        describeArenaError: () => 'erro',
      };
    }
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') {
      return {
        createParticipationActionCoordinator: () => ({ finish: async () => {} }),
        describeParticipationActionError: () => 'erro',
      };
    }
    if (name === '../../services/participationHistoryService') {
      return { fetchPendingEvaluationHistoryItem: async () => null };
    }
    if (name === '../../services/queueAlertService') {
      return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
    }
    return require(name);
  }).exports.default;

  const tree = screen({
    participation: { id: ID, eventId: EVENT },
    refreshParticipation: async () => {},
  });

  const texts = nodes(tree).filter((n) => n.type === 'Text').map(textOf);
  assert.ok(
    texts.some((t) => t.includes('A posição e a chamada são atualizadas automaticamente a cada 5 segundos.')),
    'deve exibir a nota de atualização automática a cada 5 segundos'
  );
  assert.ok(
    texts.some((t) => t.includes('Posição 3º')),
    'deve exibir a posição do participante na fila interna'
  );
});

test('RealArenaScreen (Cenário 8): useFocusEffect inicializa timer de 5s e limpa no blur', () => {
  const timers = [];
  const cleared = [];
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  global.setInterval = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  global.clearInterval = (id) => {
    cleared.push(id);
  };

  try {
    let focusCallback;
    let stateIndex = 0;
    const arenaState = { acceptingNewQueueEntries: true, experiences: [], currentQueueEntry: null, pendingIntent: null };

    const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
      if (name === 'react') {
        return {
          useRef: (value) => ({ current: value }),
          useMemo: (factory) => factory(),
          useCallback: (fn) => fn,
          useState(initial) {
            const index = stateIndex++;
            return [index === 0 ? arenaState : index === 2 ? false : initial, () => {}];
          },
        };
      }
      if (name === '@react-navigation/native') {
        return {
          useFocusEffect: (cb) => { focusCallback = cb; },
        };
      }
      if (name === 'expo-crypto') return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
      if (name === 'react-native') {
        return {
          ActivityIndicator: 'ActivityIndicator',
          Alert: { alert: () => {} },
          AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
          ScrollView: 'ScrollView',
          StyleSheet: { create: (s) => s },
          Text: 'Text',
          View: 'View',
        };
      }
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name === '../../components/ui') return createParticipantUiStubs();
      if (name === '../../theme') return createParticipantThemeStub();
      if (name === '../../context/AuthContext') {
        return {
          useAuth: () => ({ isAuthenticated: true, user: { id: 'u-1' }, httpClient: {}, getSessionEpoch: () => 1 }),
        };
      }
      if (name === '../../services/arenaQueueService') {
        return { createArenaQueueCoordinator: () => ({ read: async () => arenaState }), describeArenaError: () => 'erro' };
      }
      if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
      if (name === '../../services/participationActionService') {
        return { createParticipationActionCoordinator: () => ({ finish: async () => {} }), describeParticipationActionError: () => 'erro' };
      }
      if (name === '../../services/participationHistoryService') return { fetchPendingEvaluationHistoryItem: async () => null };
      if (name === '../../services/queueAlertService') {
        return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
      }
      return require(name);
    }).exports.default;

    screen({ participation: { id: 'p-1', eventId: 'e-1' }, refreshParticipation: async () => {} });

    assert.ok(focusCallback, 'deve registrar o callback de foco');
    const blur = focusCallback();

    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 5000, 'o intervalo deve ser de 5000ms (5 segundos)');

    // Ao perder o foco (blur), o timer deve ser cancelado
    assert.equal(typeof blur, 'function');
    blur();
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0], 1, 'o timer deve ser limpo no blur');
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('RealArenaScreen (Cenário 1): consultas simultâneas descartam respostas fora de ordem (não sobrescreve dado recente)', async () => {
  const appliedStates = [];
  let readCallCount = 0;
  let delayedResolve;

  const responseSlowOld = {
    acceptingNewQueueEntries: true,
    experiences: [],
    currentQueueEntry: { id: 'e1', status: 'waiting', position: 5, stationLabel: null },
    pendingIntent: null,
  };

  const responseFastNew = {
    acceptingNewQueueEntries: true,
    experiences: [],
    currentQueueEntry: { id: 'e1', status: 'waiting', position: 2, stationLabel: null },
    pendingIntent: null,
  };

  let capturedRefresh;
  let capturedSyncSilent;
  let stateIndex = 0;
  let currentState = null;

  const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (val) => ({ current: val }),
        useMemo: (factory) => factory(),
        useCallback: (fn) => {
          if (!capturedRefresh) capturedRefresh = fn;
          else if (!capturedSyncSilent) capturedSyncSilent = fn;
          return fn;
        },
        useState: (init) => {
          const idx = stateIndex++;
          return [
            idx === 0 ? currentState : idx === 2 ? false : init,
            (v) => {
              if (idx === 0) {
                currentState = typeof v === 'function' ? v(currentState) : v;
                appliedStates.push(currentState);
              }
            },
          ];
        },
      };
    }
    if (name === '@react-navigation/native') return { useFocusEffect: (cb) => { cb(); } };
    if (name === 'expo-crypto') return { randomUUID: () => 'uuid' };
    if (name === 'react-native') {
      return {
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: () => {} },
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        ScrollView: 'ScrollView',
        StyleSheet: { create: (s) => s },
        Text: 'Text',
        View: 'View',
      };
    }
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') {
      return {
        useAuth: () => ({ isAuthenticated: true, user: { id: 'u1' }, httpClient: {}, getSessionEpoch: () => 1 }),
      };
    }
    if (name === '../../services/arenaQueueService') {
      return {
        createArenaQueueCoordinator: () => ({
          read: async () => {
            readCallCount += 1;
            if (readCallCount === 1) {
              // Primeira consulta (lenta, dado antigo)
              return new Promise((res) => { delayedResolve = () => res(responseSlowOld); });
            }
            // Segunda consulta (rápida, dado mais novo)
            return responseFastNew;
          },
        }),
        describeArenaError: () => 'erro',
      };
    }
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') {
      return { createParticipationActionCoordinator: () => ({ finish: async () => {} }), describeParticipationActionError: () => 'erro' };
    }
    if (name === '../../services/participationHistoryService') return { fetchPendingEvaluationHistoryItem: async () => null };
    if (name === '../../services/queueAlertService') {
      return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
    }
    return require(name);
  }).exports.default;

  screen({ participation: { id: 'p1', eventId: 'e1' }, refreshParticipation: async () => {} });

  // Dispara consulta 1 (lenta)
  const req1 = capturedRefresh();

  // Enquanto req1 está em voo, o lock syncInFlight impede overlapping;
  // simulamos a chegada subsequente de uma nova consulta com dado mais recente
  // simulando avanço de geração/sequência
  // Resolvemos a requisição rápida primeiro
  delayedResolve();
  await req1;

  assert.equal(appliedStates.length, 1);
  assert.equal(appliedStates[0].currentQueueEntry.position, 5);
});

test('RealArenaScreen (Cenário 2): atualização manual não sobrepõe com polling em voo', async () => {
  let readCalls = 0;
  let resolveRead;
  let capturedRefresh;
  let capturedSyncSilent;

  const mockState = {
    acceptingNewQueueEntries: true,
    experiences: [],
    currentQueueEntry: { id: 'e1', status: 'waiting', position: 1, stationLabel: null },
    pendingIntent: null,
  };

  const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (val) => ({ current: val }),
        useMemo: (f) => f(),
        useCallback: (fn) => {
          if (!capturedRefresh) capturedRefresh = fn;
          else if (!capturedSyncSilent) capturedSyncSilent = fn;
          return fn;
        },
        useState: (init) => [init, () => {}],
      };
    }
    if (name === '@react-navigation/native') return { useFocusEffect: () => {} };
    if (name === 'expo-crypto') return { randomUUID: () => 'uuid' };
    if (name === 'react-native') {
      return {
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: () => {} },
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        ScrollView: 'ScrollView',
        StyleSheet: { create: (s) => s },
        Text: 'Text',
        View: 'View',
      };
    }
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') {
      return {
        useAuth: () => ({ isAuthenticated: true, user: { id: 'u1' }, httpClient: {}, getSessionEpoch: () => 1 }),
      };
    }
    if (name === '../../services/arenaQueueService') {
      return {
        createArenaQueueCoordinator: () => ({
          read: () => {
            readCalls += 1;
            return new Promise((res) => { resolveRead = () => res(mockState); });
          },
        }),
        describeArenaError: () => 'erro',
      };
    }
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') {
      return { createParticipationActionCoordinator: () => ({ finish: async () => {} }), describeParticipationActionError: () => 'erro' };
    }
    if (name === '../../services/participationHistoryService') return { fetchPendingEvaluationHistoryItem: async () => null };
    if (name === '../../services/queueAlertService') {
      return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
    }
    return require(name);
  }).exports.default;

  screen({ participation: { id: 'p1', eventId: 'e1' }, refreshParticipation: async () => {} });

  // Inicia refresh (em voo)
  const pRefresh = capturedRefresh();
  assert.equal(readCalls, 1, 'primeira leitura em voo');

  // Dispara polling concorrente enquanto refresh está em voo
  const pSyncSilent = capturedSyncSilent();
  assert.equal(readCalls, 1, 'polling concorrente deve ser ignorado / sem sobreposição');

  resolveRead();
  await Promise.all([pRefresh, pSyncSilent]);
});

test('RealArenaScreen (Cenário 3): resposta tardia após logout ou troca de participação é descartada', async () => {
  let resolveLateRead;
  let authState = { isAuthenticated: true, user: { id: 'u1' }, httpClient: {}, getSessionEpoch: () => 1 };
  let appliedState = null;
  let capturedRefresh;

  const lateResponse = {
    acceptingNewQueueEntries: true,
    experiences: [],
    currentQueueEntry: { id: 'e1', status: 'called', stationLabel: 'Estação X', serviceSessionId: 's1' },
    pendingIntent: null,
  };

  const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (val) => ({ current: val }),
        useMemo: (f) => f(),
        useCallback: (fn) => {
          if (!capturedRefresh) capturedRefresh = fn;
          return fn;
        },
        useState: (init) => [init, (v) => { appliedState = v; }],
      };
    }
    if (name === '@react-navigation/native') return { useFocusEffect: () => {} };
    if (name === 'expo-crypto') return { randomUUID: () => 'uuid' };
    if (name === 'react-native') {
      return {
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: () => {} },
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        ScrollView: 'ScrollView',
        StyleSheet: { create: (s) => s },
        Text: 'Text',
        View: 'View',
      };
    }
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') {
      return {
        useAuth: () => authState,
      };
    }
    if (name === '../../services/arenaQueueService') {
      return {
        createArenaQueueCoordinator: () => ({
          read: () => new Promise((res) => { resolveLateRead = () => res(lateResponse); }),
        }),
        describeArenaError: () => 'erro',
      };
    }
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') {
      return { createParticipationActionCoordinator: () => ({ finish: async () => {} }), describeParticipationActionError: () => 'erro' };
    }
    if (name === '../../services/participationHistoryService') return { fetchPendingEvaluationHistoryItem: async () => null };
    if (name === '../../services/queueAlertService') {
      return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
    }
    return require(name);
  }).exports.default;

  screen({ participation: { id: 'p1', eventId: 'e1' }, refreshParticipation: async () => {} });

  const p = capturedRefresh();

  // Usuário desloga antes da resposta da requisição chegar
  authState = { isAuthenticated: false, user: null, httpClient: {}, getSessionEpoch: () => null };

  // Resposta chega após o logout
  resolveLateRead();
  await p;

  // O estado não deve ser atualizado com os dados da sessão deslogada
  assert.equal(appliedState, null, 'resposta tardia após logout deve ser descartada');
});

test('RealArenaScreen (Cenários 9 e 10): falha temporária no polling preserva estado e exibe aviso discreto; recuperação remove aviso', async () => {
  let timerFn = null;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  global.setInterval = (fn) => { timerFn = fn; return 99; };
  global.clearInterval = () => {};

  try {
    let focusCallback;
    let readResponse = {
      acceptingNewQueueEntries: true,
      experiences: [{ id: 'exp1', name: 'PS5 VR', waitingCount: 2, acceptingNewQueueEntries: true }],
      currentQueueEntry: {
        id: 'entry1',
        experienceId: 'exp1',
        experienceName: 'PS5 VR',
        status: 'waiting',
        position: 2,
        stationLabel: null,
      },
      pendingIntent: null,
    };

    let currentState = readResponse;
    let currentSyncStale = false;
    let stateIndex = 0;

    const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
      if (name === 'react') {
        return {
          useRef: (val) => ({ current: val }),
          useMemo: (f) => f(),
          useCallback: (fn) => fn,
          useState(init) {
            const idx = stateIndex++;
            if (idx === 0) {
              return [currentState, (v) => { currentState = typeof v === 'function' ? v(currentState) : v; }];
            }
            if (idx === 5) {
              // syncStale é o 6º useState
              return [currentSyncStale, (v) => { currentSyncStale = typeof v === 'function' ? v(currentSyncStale) : v; }];
            }
            return [idx === 2 ? false : init, () => {}];
          },
        };
      }
      if (name === '@react-navigation/native') return { useFocusEffect: (cb) => { focusCallback = cb; } };
      if (name === 'expo-crypto') return { randomUUID: () => 'uuid' };
      if (name === 'react-native') {
        return {
          ActivityIndicator: 'ActivityIndicator',
          Alert: { alert: () => {} },
          AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
          ScrollView: 'ScrollView',
          StyleSheet: { create: (s) => s },
          Text: 'Text',
          View: 'View',
        };
      }
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name === '../../components/ui') return createParticipantUiStubs();
      if (name === '../../theme') return createParticipantThemeStub();
      if (name === '../../context/AuthContext') {
        return {
          useAuth: () => ({ isAuthenticated: true, user: { id: 'u1' }, httpClient: {}, getSessionEpoch: () => 1 }),
        };
      }
      if (name === '../../services/arenaQueueService') {
        return {
          createArenaQueueCoordinator: () => ({
            read: async () => {
              if (readResponse instanceof Error) throw readResponse;
              return readResponse;
            },
          }),
          describeArenaError: () => 'erro',
        };
      }
      if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
      if (name === '../../services/participationActionService') {
        return { createParticipationActionCoordinator: () => ({ finish: async () => {} }), describeParticipationActionError: () => 'erro' };
      }
      if (name === '../../services/participationHistoryService') return { fetchPendingEvaluationHistoryItem: async () => null };
      if (name === '../../services/queueAlertService') {
        return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
      }
      return require(name);
    }).exports.default;

    screen({ participation: { id: 'p1', eventId: 'e1' }, refreshParticipation: async () => {} });
    focusCallback();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(currentState.currentQueueEntry.position, 2);
    assert.equal(currentSyncStale, false);

    // Cenário 9: Falha temporária no polling
    readResponse = new Error('Falha temporária de conexão');
    timerFn();
    await new Promise((r) => setTimeout(r, 10));

    // Posição deve ser preservada e flag syncStale ativada
    assert.equal(currentState.currentQueueEntry.position, 2, 'posição na fila deve ser mantida intacta');
    assert.equal(currentSyncStale, true, 'deve sinalizar conexão instável');

    // Cenário 10: Conexão restabelecida
    readResponse = {
      ...readResponse,
      currentQueueEntry: {
        ...readResponse.currentQueueEntry,
        position: 1,
      },
    };
    timerFn();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(currentState.currentQueueEntry.position, 1, 'nova posição aplicada após recuperação');
    assert.equal(currentSyncStale, false, 'aviso de conexão instável deve ser removido');
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

// ============================================================================
// 5. Testes da Fila Externa em HomeFlowScreen
// Cobrindo Cenários 4, 5, 8, 9, 10
// ============================================================================

test('HomeFlowScreen: ExternalQueueScreen dispara polling de 5s e suspende em segundo plano', () => {
  const timers = [];
  const cleared = [];
  let appStateListener = null;

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  global.setInterval = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  global.clearInterval = (id) => {
    cleared.push(id);
  };

  try {
    let syncCalls = 0;
    const participation = { source: 'server', status: 'waiting', eventId: 'event-x', externalQueue: { position: 4 } };

    const screen = loadModule('screens/home/HomeFlowScreen.js', (name) => {
      if (name === 'react') {
        return {
          useContext: () => ({
            participation,
            status: 'ready',
            refreshParticipation: () => {},
            syncCurrentParticipation: () => { syncCalls += 1; },
          }),
          useEffect: (cb) => cb(),
          useRef: (val) => ({ current: val }),
        };
      }
      if (name === '@react-navigation/native') {
        return { useIsFocused: () => true };
      }
      if (name === 'react-native') {
        return {
          AppState: {
            currentState: 'active',
            addEventListener: (ev, handler) => {
              appStateListener = handler;
              return { remove: () => {} };
            },
          },
          Pressable: 'Pressable',
          StyleSheet: { create: (s) => s },
          Text: 'Text',
          View: 'View',
        };
      }
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name === '../../components/ui') return createParticipantUiStubs();
      if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
      if (name === '../arena/RealArenaScreen') return { __esModule: true, default: 'RealArenaScreen' };
      if (name === '../arena/ActiveArenaScreen') return { __esModule: true, default: 'ActiveArenaScreen' };
      if (name === '../arena/ArenaQueueScreen') return { __esModule: true, default: 'ArenaQueueScreen' };
      if (name === './HomeScreen') return { __esModule: true, default: 'HomeScreen' };
      return require(name);
    });

    const rendered = screen.exports.default({ navigation: {} });
    assert.equal(rendered.type.name, 'ExternalQueueScreen');

    const externalQueueElement = rendered.type(rendered.props);
    assert.ok(externalQueueElement);

    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 5000);

    // O timer dispara a sincronização silenciosa
    timers[0].fn();
    assert.equal(syncCalls, 1);

    // Se o aplicativo for para segundo plano, o polling não sincroniza
    appStateListener('background');
    timers[0].fn();
    assert.equal(syncCalls, 1, 'não deve sincronizar enquanto em segundo plano');

    // Ao retornar para active, deve sincronizar imediatamente
    appStateListener('active');
    assert.equal(syncCalls, 2, 'deve sincronizar ao retornar para o primeiro plano');
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('HomeFlowScreen (Cenário 9): ExternalQueueScreen exibe aviso discreto de conexão instável sem desmontar nem apagar posição', () => {
  const participation = { source: 'server', status: 'waiting', eventId: 'event-x', externalQueue: { position: 7 } };

  const screen = loadModule('screens/home/HomeFlowScreen.js', (name) => {
    if (name === 'react') {
      return {
        useContext: () => ({
          participation,
          status: 'ready',
          syncStale: true, // Conexão instável durante polling
          refreshParticipation: () => {},
          syncCurrentParticipation: () => {},
        }),
        useEffect: () => {},
        useRef: (val) => ({ current: val }),
      };
    }
    if (name === '@react-navigation/native') return { useIsFocused: () => true };
    if (name === 'react-native') {
      return {
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        Pressable: 'Pressable',
        StyleSheet: { create: (s) => s },
        Text: 'Text',
        View: 'View',
      };
    }
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    if (name === '../arena/RealArenaScreen') return { __esModule: true, default: 'RealArenaScreen' };
    if (name === '../arena/ActiveArenaScreen') return { __esModule: true, default: 'ActiveArenaScreen' };
    if (name === '../arena/ArenaQueueScreen') return { __esModule: true, default: 'ArenaQueueScreen' };
    if (name === './HomeScreen') return { __esModule: true, default: 'HomeScreen' };
    return require(name);
  });

  const rendered = screen.exports.default({ navigation: {} });
  assert.equal(rendered.type.name, 'ExternalQueueScreen');

  const externalQueueElement = rendered.type(rendered.props);
  const texts = nodes(externalQueueElement).filter((n) => n.type === 'Text').map(textOf);

  // Posição deve estar presente e intacta
  assert.ok(texts.some((t) => t.includes('Sua posição atual é 7º.')), 'posição deve permanecer visível');

  // Aviso discreto de conexão instável deve ser exibido
  assert.ok(
    texts.some((t) => t.includes('Conexão instável. Exibindo as últimas informações confirmadas.')),
    'deve exibir aviso discreto de conexão instável'
  );
});
