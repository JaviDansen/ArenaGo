const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { parseStaffEvents, createStaffEventsStore } = loadModule('services/staffEventsService.js', require).exports;
const event = { id: '11111111-1111-4111-8111-111111111111', name: 'Evento real', status: 'open' };
const identity = (userId = 'a', epoch = 1, revision = 1) => ({ userId, epoch, revision });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };

test('lista Staff aceita somente o contrato conhecido e preserva o ID para seleção', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseStaffEvents({ events: [event] }))), [event]);
  assert.equal(parseStaffEvents({ events: [] }).length, 0);
  for (const body of [null, {}, { events: null }, { events: [{ ...event, id: 'outro' }] },
    { events: [{ ...event, name: '' }] }, { events: [{ ...event, status: 'unknown' }] },
    { events: [event, event] }]) assert.throws(() => parseStaffEvents(body));
});

test('fase efetiva é preservada separadamente e valores desconhecidos são recusados', () => {
  for (const effectivePhase of ['scheduled', 'open', 'not_ready', 'closing', 'closed']) {
    const parsed = parseStaffEvents({ events: [{ ...event, status: 'scheduled', effectivePhase }] });
    assert.equal(parsed[0].status, 'scheduled');
    assert.equal(parsed[0].effectivePhase, effectivePhase);
  }
  assert.throws(() => parseStaffEvents({ events: [{ ...event, effectivePhase: 'unknown' }] }));
});

test('consulta autenticada, seleção e atualização manual removem seleção anterior', async () => {
  let current = identity();
  const calls = [];
  let response = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async (...args) => { calls.push(args); return response; } },
    getIdentity: () => current });
  store.setIdentity(current);
  assert.equal(store.select(event.id), false, 'seleção aguarda resposta autorizada');
  await store.refresh();
  assert.equal(calls[0][0], '/staff/events');
  assert.equal(calls[0][1].auth, true);
  assert.equal(store.select('11111111-1111-4111-8111-111111111112'), false);
  assert.equal(store.select(event.id), true);
  assert.equal(store.getSnapshot().selected.id, event.id);
  response = { events: [] };
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().events.length, 0);
  assert.equal(store.getSnapshot().selected, null);
});

test('401 e falha de rede limpam dados e permitem atualização posterior', async () => {
  const current = identity();
  let outcome = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  } }, getIdentity: () => current });
  store.setIdentity(current);
  await store.refresh();
  store.select(event.id);
  outcome = Object.assign(new Error('unauthorized'), { status: 401 });
  await store.refresh();
  assert.equal(store.getSnapshot().error, 'session');
  assert.equal(store.getSnapshot().selected, null);
  assert.equal(store.getSnapshot().events.length, 0);
  outcome = Object.assign(new Error('offline'), { isNetworkError: true });
  await store.refresh();
  assert.equal(store.getSnapshot().error, 'network');
  outcome = { events: [event] };
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready');
});

test('troca de conta, geração, revisão e respostas fora de ordem descartam dados antigos', async () => {
  let current = identity();
  const requests = [];
  const store = createStaffEventsStore({ client: { get: () => { const pending = deferred(); requests.push(pending); return pending.promise; } },
    getIdentity: () => current });
  store.setIdentity(current);
  const first = store.refresh();
  const second = store.refresh();
  requests[1].resolve({ events: [] });
  await second;
  requests[0].resolve({ events: [event] });
  await first;
  assert.equal(store.getSnapshot().events.length, 0);

  const third = store.refresh();
  current = identity('b', 2, 2);
  store.setIdentity(current);
  requests[2].resolve({ events: [event] });
  await third;
  assert.equal(store.getSnapshot().events.length, 0);
  assert.equal(store.select(event.id), false);
  current = identity('b', 2, 3);
  assert.equal(store.isCurrent(), false, 'revalidação bloqueia imediatamente o estado anterior');
  store.setIdentity(null);
  assert.equal(store.getSnapshot().selected, null);
});

test('consulta silenciosa preserva seleção e descarta resposta após troca de identidade', async () => {
  let current = identity(), response = { events: [event] };
  const store = createStaffEventsStore({ client: { get: async () => response }, getIdentity: () => current });
  store.setIdentity(current); await store.refresh(); store.select(event.id);
  response = { events: [{ ...event, effectivePhase: 'closing' }] };
  await store.refreshSilent();
  assert.equal(store.getSnapshot().selected.effectivePhase, 'closing');
  const waiting = deferred();
  response = waiting.promise;
  const old = store.refreshSilent();
  current = identity('new', 2, 2); store.setIdentity(current);
  waiting.resolve({ events: [event] }); await old;
  assert.equal(store.getSnapshot().selected, null);
});

// ============================================================================
// Testes de interface e integração de navegação Staff (STAFF-01)
// Reconciliador autossuficiente (sem dependências opcionais ou skip)
// Cobre as seções 10.1, 10.2 e cenários da primeira revisão técnica
// ============================================================================

function createUiRuntime(jsxRuntime) {
  let typeSerial = 0;
  const typeIds = new WeakMap();
  const getTypeId = (fn) => {
    let id = typeIds.get(fn);
    if (!id) {
      id = ++typeSerial;
      typeIds.set(fn, id);
    }
    return id;
  };

  let activeInst = null;
  let activeCursor = 0;
  let currentNextInstances = null;
  let currentPendingEffects = null;
  let committedInstances = new Map();
  let renderedTree = null;
  let rootRenderFn = () => null;
  let renderingNow = false;
  let isFlushing = false;
  let dirty = false;
  let batchDepth = 0;

  function renderElement(node, path) {
    if (node == null || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) {
      return node.map((child, idx) => renderElement(child, `${path}[${child?.key ?? idx}]`));
    }
    if (typeof node !== 'object') return null;

    if (node.type?._isContextProvider) {
      const ctx = node.type._ctx;
      const previous = ctx._value;
      ctx._value = node.props?.value;
      try {
        return renderElement(node.props?.children, `${path}>P`);
      } finally {
        ctx._value = previous;
      }
    }

    if (node.type === jsxRuntime.Fragment) {
      return renderElement(node.props?.children, `${path}>F`);
    }

    if (typeof node.type === 'function') {
      const compKey = `${path}:${getTypeId(node.type)}${node.key != null ? `@${node.key}` : ''}`;
      let inst = committedInstances.get(compKey);
      if (!inst) {
        inst = { slots: [], cleanups: new Map(), mounted: false };
      }
      currentNextInstances.set(compKey, inst);

      const prevInst = activeInst;
      const prevCursor = activeCursor;
      const prevRendering = renderingNow;
      activeInst = inst;
      activeCursor = 0;
      renderingNow = true;
      let rendered;
      try {
        rendered = node.type(node.props);
      } finally {
        activeInst = prevInst;
        activeCursor = prevCursor;
        renderingNow = prevRendering;
      }
      return renderElement(rendered, `${compKey}>C`);
    }

    const renderedChildren = node.props?.children !== undefined
      ? renderElement(node.props.children, `${path}>${String(node.type)}`)
      : undefined;
    return { type: node.type, props: { ...node.props, children: renderedChildren } };
  }

  function flushWork() {
    if (isFlushing) return;
    isFlushing = true;
    try {
      let passes = 0;
      while (dirty) {
        passes += 1;
        if (passes > 50) throw new Error('Loop de renderização em StaffEventsNavigator');
        dirty = false;
        const nextInstances = new Map();
        const pendingEffects = [];
        currentNextInstances = nextInstances;
        currentPendingEffects = pendingEffects;
        const tree = renderElement(rootRenderFn(), 'root');
        for (const [key, oldInst] of committedInstances) {
          if (nextInstances.get(key) !== oldInst) {
            oldInst.mounted = false;
            for (const cleanup of oldInst.cleanups.values()) {
              if (typeof cleanup === 'function') cleanup();
            }
            oldInst.cleanups.clear();
          }
        }
        committedInstances = nextInstances;
        for (const inst of committedInstances.values()) inst.mounted = true;
        renderedTree = tree;
        for (const { inst, idx, cb } of pendingEffects) {
          if (!inst.mounted) continue;
          const prevCleanup = inst.cleanups.get(idx);
          if (typeof prevCleanup === 'function') prevCleanup();
          const nextCleanup = cb();
          inst.cleanups.set(idx, typeof nextCleanup === 'function' ? nextCleanup : null);
        }
      }
    } finally {
      isFlushing = false;
    }
  }

  const react = {
    createContext(defaultValue = null) {
      const ctx = { _value: defaultValue };
      const Provider = function ContextProvider() { return null; };
      Provider._isContextProvider = true;
      Provider._ctx = ctx;
      ctx.Provider = Provider;
      return ctx;
    },
    useContext(ctx) {
      return ctx ? ctx._value : null;
    },
    useState(initial) {
      const inst = activeInst;
      const idx = activeCursor++;
      if (!(idx in inst.slots)) {
        // O React mantém o mesmo setter durante toda a vida do hook.
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = (update) => {
          if (!inst.mounted && !renderingNow) return;
          const nextVal = typeof update === 'function' ? update(slot.value) : update;
          if (Object.is(slot.value, nextVal)) return;
          slot.value = nextVal;
          dirty = true;
          if (!renderingNow && batchDepth === 0) flushWork();
        };
        inst.slots[idx] = slot;
      }
      const { value, set } = inst.slots[idx];
      return [value, set];
    },
    useRef(initial) {
      const inst = activeInst;
      const idx = activeCursor++;
      if (!(idx in inst.slots)) inst.slots[idx] = { current: initial };
      return inst.slots[idx];
    },
    useCallback(fn, deps) {
      const inst = activeInst;
      const idx = activeCursor++;
      const prev = inst.slots[idx];
      const changed = !prev || !deps || deps.length !== prev.deps.length
        || deps.some((v, i) => !Object.is(v, prev.deps[i]));
      if (changed) inst.slots[idx] = { fn, deps };
      return inst.slots[idx].fn;
    },
    useMemo(fn, deps) {
      const inst = activeInst;
      const idx = activeCursor++;
      const prev = inst.slots[idx];
      const changed = !prev || !deps || deps.length !== prev.deps.length
        || deps.some((v, i) => !Object.is(v, prev.deps[i]));
      if (changed) inst.slots[idx] = { val: fn(), deps };
      return inst.slots[idx].val;
    },
    useEffect(cb, deps) {
      const inst = activeInst;
      const idx = activeCursor++;
      const prev = inst.slots[idx];
      const changed = !prev || !deps || deps.length !== prev.deps.length
        || deps.some((v, i) => !Object.is(v, prev.deps[i]));
      if (changed) {
        inst.slots[idx] = { deps };
        currentPendingEffects.push({ inst, idx, cb });
      }
    },
  };

  function createNativeStackNavigator() {
    const Screen = function StackScreen() { return null; };
    function Navigator({ initialRouteName, children }) {
      const screens = [].concat(children).filter(Boolean).map((el) => el.props);
      const [stack, setStack] = react.useState([initialRouteName ?? screens[0].name]);
      const listenersRef = react.useRef([]);
      const currentName = stack[stack.length - 1];
      const currentScreen = screens.find((s) => s.name === currentName) ?? screens[0];

      const navigation = {
        navigate(name) {
          setStack((prev) => (prev[prev.length - 1] === name ? prev : [...prev, name]));
        },
        canGoBack() {
          return stack.length > 1;
        },
        goBack() {
          let prevented = false;
          for (const listener of [...listenersRef.current]) {
            listener({ preventDefault() { prevented = true; } });
          }
          if (!prevented) {
            setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
          }
        },
        addListener(event, handler) {
          if (event !== 'beforeRemove') return () => {};
          listenersRef.current.push(handler);
          return () => {
            listenersRef.current = listenersRef.current.filter((item) => item !== handler);
          };
        },
      };

      return jsxRuntime.jsx(currentScreen.component, { navigation });
    }
    return { Navigator, Screen };
  }

  return {
    react,
    createNativeStackNavigator,
    mount(renderFn) {
      rootRenderFn = renderFn;
      dirty = true;
      flushWork();
    },
    update(renderFn) {
      rootRenderFn = renderFn;
      dirty = true;
      flushWork();
    },
    async act(fn) {
      batchDepth += 1;
      try {
        await fn();
      } finally {
        batchDepth -= 1;
      }
      dirty = true;
      flushWork();
      await new Promise((r) => setTimeout(r, 0));
      if (dirty) flushWork();
    },
    async settle() {
      await new Promise((r) => setTimeout(r, 0));
      if (dirty) flushWork();
    },
    getTree() {
      return renderedTree;
    },
    dispose() {
      for (const oldInst of committedInstances.values()) {
        oldInst.mounted = false;
        for (const cleanup of oldInst.cleanups.values()) {
          if (typeof cleanup === 'function') cleanup();
        }
        oldInst.cleanups.clear();
      }
      committedInstances.clear();
      renderedTree = null;
    },
  };
}

function createStaffUiHarness({ initialAuth, onGet, onLogout }) {
  const jsx = require('react/jsx-runtime');
  const runtime = createUiRuntime(jsx);
  const { react: React, createNativeStackNavigator } = runtime;
  const pollingRegistrations = [];
  let authState = initialAuth;

  const eventsSvc = loadModule('services/staffEventsService.js', require).exports;
  const entrySvc = loadModule('services/staffEntryService.js', require).exports;
  const opsSvc = loadModule('services/staffOperationsService.js', (name) => {
    if (name === './staffEntryService.js' || name === './staffEntryService') return entrySvc;
    return require(name);
  }).exports;
  const dashSvc = loadModule('services/staffDashboardService.js', (name) => {
    if (name === './staffOperationsService') return opsSvc;
    return require(name);
  }).exports;

  const native = Object.fromEntries(
    ['ActivityIndicator', 'Image', 'Modal', 'Pressable', 'SafeAreaView', 'ScrollView', 'Text', 'TextInput', 'View'].map((n) => [n, n]),
  );
  let focused = true;
  const focusListeners = new Set();
  const appStateListeners = new Set();
  native.StyleSheet = { create: (s) => s };
  native.AppState = {
    currentState: 'active',
    addEventListener: (_, listener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  };

  const client = {
    get: (url, opts) => onGet(url, opts),
  };

  const makeAuth = () => ({
    ...authState,
    httpClient: client,
    logout: async () => {
      await onLogout?.();
    },
  });

  const EntryStub = ({ event }) => jsx.jsx('Text', { children: `EntryControl:${event.id}` });

  const StationStub = ({ event, experience, station }) => jsx.jsx('View', {
    children: jsx.jsx('Text', { children: `StationOp:${event.id}:${experience.id}:${station.id}` }),
  });

  const AuthCtx = React.createContext(null);

  const staffLogo = { uri: 'assets/images/logo-arenago-staff.png' };
  const adminTheme = loadModule('screens/admin/components/adminTheme.js', require).exports;
  const resolveVisual = (name) => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: native.SafeAreaView };
    if (name === './adminTheme') return adminTheme;
    if (name === '../../../assets/images/logo-arenago-staff.png') return staffLogo;
    if (name.endsWith('/AdminLiveUI')) return liveUI;
    return require(name);
  };
  const liveUI = loadModule('screens/admin/components/AdminLiveUI.js', resolveVisual).exports;
  const staffLiveScreen = loadModule('screens/staff/components/StaffLiveScreen.js', resolveVisual).exports;
  const staffSyncFeedback = loadModule('screens/staff/components/StaffSyncFeedback.js', resolveVisual).exports;

  const { default: StaffEventsNavigator } = loadModule('screens/staff/StaffEventsNavigator.js', (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return native;
    if (name === '@react-navigation/native-stack') {
      return { createNativeStackNavigator };
    }
    if (name === '@react-navigation/native') {
      return {
        useIsFocused: () => {
          const [, bump] = React.useState(0);
          React.useEffect(() => {
            const fn = () => bump((n) => n + 1);
            focusListeners.add(fn);
            return () => focusListeners.delete(fn);
          }, []);
          return focused;
        },
      };
    }
    if (name === './components/StaffLiveScreen') return staffLiveScreen;
    if (name === './components/StaffSyncFeedback') return staffSyncFeedback;
    if (name === '../admin/components/AdminLiveUI') return liveUI;
    if (name === '../../context/AuthContext') {
      return { AuthContext: AuthCtx, useAuth: () => React.useContext(AuthCtx) };
    }
    if (name === '../../services/staffEventsService') return eventsSvc;
    if (name === '../../services/staffDashboardService') return dashSvc;
    if (name === './StaffEntryControlRealScreen') return { __esModule: true, default: EntryStub };
    if (name === './StaffStationOperationalScreen') return { __esModule: true, default: StationStub };
    if (name === './useStaffPolling') {
      return {
        useStaffPolling(enabled, read, intervalMs, scope) {
          pollingRegistrations.push({ enabled, read, intervalMs, scope });
        },
      };
    }
    return require(name);
  }).exports;

  const textOf = (node) => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (typeof node === 'object') return textOf(node.props?.children);
    return '';
  };

  function findAllByType(type) {
    const matches = [];
    (function walk(node) {
      if (node == null || typeof node === 'boolean' || typeof node === 'string') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'object') {
        if (node.type === type) matches.push(node);
        walk(node.props?.children);
      }
    })(runtime.getTree());
    return matches;
  }

  const wrapper = (currentAuth) => jsx.jsx(AuthCtx.Provider, {
    value: currentAuth,
    children: jsx.jsx(StaffEventsNavigator, {}),
  });

  return {
    pollingRegistrations,
    assertHeader(actionLabel) {
      const headers = findAllByType('View').filter((node) => node.props.testID === 'staff-live-header');
      assert.equal(headers.length, 1);
      const [action, logo] = headers[0].props.children;
      assert.equal(action.type, 'Pressable');
      assert.equal(action.props.accessibilityRole, 'button');
      assert.equal(action.props.accessibilityLabel, actionLabel);
      assert.equal(logo.type, 'Image');
      assert.equal(logo.props.accessibilityRole, 'image');
      assert.equal(logo.props.accessibilityLabel, 'ArenaGO');
      assert.equal(logo.props.resizeMode, 'contain');
      assert.equal(logo.props.source, staffLogo);
      const headerActions = findAllByType('Pressable').filter((node) =>
        ['Sair da conta', 'Voltar aos eventos', 'Voltar ao painel'].includes(node.props.accessibilityLabel));
      assert.deepEqual(headerActions.map((node) => node.props.accessibilityLabel), [actionLabel]);
      return action.props.onPress;
    },
    latestPolling(scopeFragment) {
      for (let i = pollingRegistrations.length - 1; i >= 0; i -= 1) {
        const reg = pollingRegistrations[i];
        if (String(reg.scope).includes(scopeFragment)) return reg;
      }
      return null;
    },
    latestEventsPolling() {
      for (let i = pollingRegistrations.length - 1; i >= 0; i -= 1) {
        const reg = pollingRegistrations[i];
        if (reg.intervalMs === 60000 && reg.scope === undefined) return reg;
      }
      return null;
    },
    async triggerEventsPolling() {
      const reg = this.latestEventsPolling();
      assert.ok(reg, 'polling de eventos esperado');
      assert.equal(reg.enabled, true, 'polling de eventos deve estar habilitado');
      await runtime.act(async () => {
        await reg.read();
      });
    },
    async triggerPolling(scopeFragment) {
      const reg = this.latestPolling(scopeFragment);
      assert.ok(reg, `polling esperado para "${scopeFragment}"`);
      assert.equal(reg.enabled, true, `polling "${scopeFragment}" deve estar habilitado`);
      await runtime.act(async () => {
        await reg.read();
      });
    },
    async setFocused(nextFocused) {
      focused = nextFocused;
      await runtime.act(async () => {
        for (const fn of [...focusListeners]) fn();
      });
    },
    async setAppState(nextState) {
      native.AppState.currentState = nextState;
      await runtime.act(async () => {
        for (const fn of [...appStateListeners]) fn(nextState);
      });
    },
    async mount() {
      await runtime.act(async () => {
        runtime.mount(() => wrapper(makeAuth()));
      });
    },
    async updateAuth(nextAuth) {
      authState = nextAuth;
      await runtime.act(async () => {
        runtime.update(() => wrapper(makeAuth()));
      });
    },
    allTexts() {
      return findAllByType('Text').map(textOf);
    },
    hasText(fragment) {
      return this.allTexts().some((t) => t.includes(fragment));
    },
    textOccurrences(exact) {
      return this.allTexts().filter((t) => t === exact).length;
    },
    metricValueFor(label) {
      const cell = findAllByType('View').find((v) => {
        const ch = [].concat(v.props?.children ?? [])
          .filter((c) => c && typeof c === 'object' && c.type === 'Text');
        return ch.length === 2 && textOf(ch[1]) === label;
      });
      assert.ok(cell, `célula do indicador "${label}" não encontrada`);
      const ch = [].concat(cell.props.children)
        .filter((c) => c && typeof c === 'object' && c.type === 'Text');
      return textOf(ch[0]);
    },
    isDisabled(label) {
      const matches = findAllByType('Pressable')
        .filter((n) => n.props.accessibilityLabel === label);
      assert.equal(matches.length, 1, `esperado exatamente 1 botão "${label}"`);
      return Boolean(matches[0].props.disabled);
    },
    async press(label) {
      const matches = findAllByType('Pressable')
        .filter((n) => n.props.accessibilityLabel === label);
      assert.equal(matches.length, 1, `esperado exatamente 1 botão "${label}"`);
      await runtime.act(async () => {
        await matches[0].props.onPress?.();
      });
    },
    async settle() {
      await runtime.settle();
    },
    dispose() {
      runtime.dispose();
    },
  };
}

const makeAuthIdentity = (userId = '10000000-0000-4000-8000-000000000001', epoch = 1, revision = 1) => ({
  isAuthenticated: true,
  user: { id: userId, roles: ['staff'] },
  isIdentityVerified: () => true,
  getSessionEpoch: () => epoch,
  getIdentityRevision: () => revision,
});

const EV_A = '11111111-1111-4111-8111-111111111111';
const EV_B = '22222222-2222-4222-8222-222222222222';
const EXP_1 = '33333333-3333-4333-8333-333333333333';
const EXP_2 = '44444444-4444-4444-8444-444444444444';
const EXP_EMPTY = '55555555-5555-4555-8555-555555555555';
const ST_1 = '66666666-6666-4666-8666-666666666666';
const ST_2 = '77777777-7777-4777-8777-777777777777';
const ST_3 = '88888888-8888-4888-8888-888888888888';
const SESS_1 = '99999999-9999-4999-8999-999999999999';
const CALL_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PART_CALLED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PART_WAIT_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PART_WAIT_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('STAFF-01 UI (10.1): Seleção de Eventos cobre carregamento, erro vs vazio, fases reais, resposta atrasada, troca de conta e logout', async () => {
  const eventsDeferreds = [];
  let logoutCalls = 0;
  let scenario = 'deferred';

  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onLogout: () => { logoutCalls += 1; },
    onGet: (url) => {
      if (url !== '/staff/events') return Promise.resolve({});
      if (scenario === 'deferred') {
        const d = deferred();
        eventsDeferreds.push(d);
        return d.promise;
      }
      if (scenario === 'network') return Promise.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
      if (scenario === 'empty') return Promise.resolve({ events: [] });
      if (scenario === 'ready') {
        return Promise.resolve({
          events: [
            { id: EV_A, name: 'Arena UNDB Real', status: 'open', effectivePhase: 'open' },
            { id: EV_B, name: 'Evento Em Preparo', status: 'scheduled', effectivePhase: 'not_ready' },
          ],
        });
      }
      return Promise.resolve({ events: [] });
    },
  });

  try {
    // 1. Cabeçalho com a imagem oficial e uma única ação de logout
    await rig.mount();
    const staleLogout = rig.assertHeader('Sair da conta');
    assert.equal(rig.textOccurrences('Arena'), 0);
    assert.equal(rig.textOccurrences('GO'), 0);
    assert.equal(rig.textOccurrences('STAFF'), 0);
    assert.ok(rig.hasText('Eventos Staff'));
    assert.ok(rig.hasText('Carregando eventos...'));
    assert.ok(!rig.hasText('Nenhum evento autorizado para esta conta.'));

    // Troca de conta enquanto requisição da conta u-1 estava pendente -> resposta atrasada descartada
    scenario = 'network';
    await rig.updateAuth(makeAuthIdentity('u-2', 2, 1));
    assert.equal(typeof staleLogout, 'function');
    staleLogout();
    assert.equal(logoutCalls, 0, 'logout de sessão antiga é descartado');
    eventsDeferreds[0].resolve({
      events: [{ id: EV_A, name: 'Evento Conta Antiga', status: 'open', effectivePhase: 'open' }],
    });
    await rig.settle();

    // 2. Falha de rede NÃO mostra estado vazio, exibe alerta específico de rede
    assert.ok(!rig.hasText('Evento Conta Antiga'));
    assert.ok(rig.hasText('Não foi possível conectar ao servidor'));
    assert.ok(!rig.hasText('Nenhum evento autorizado para esta conta.'));

    // 3. Lista realmente vazia após atualizar
    scenario = 'empty';
    await rig.press('Atualizar eventos');
    assert.ok(rig.hasText('Nenhum evento autorizado para esta conta.'));

    // 4. Lista autorizada com eventos reais e sem dados inventados de mockup
    scenario = 'ready';
    await rig.press('Atualizar eventos');
    assert.ok(rig.hasText('Arena UNDB Real'));
    assert.ok(rig.hasText('Aberto'));
    assert.ok(rig.hasText('Disponível para operar'));
    assert.ok(rig.hasText('Evento Em Preparo'));
    assert.ok(rig.hasText('Não está pronto'));
    assert.ok(!rig.hasText('4 Estações'), 'não exibe contagem fictícia quando contrato não informa');

    // 5. Polling de 60s configurado na seleção e logout funcionando no cabeçalho
    assert.ok(rig.pollingRegistrations.some((r) => r.intervalMs === 60000 && r.enabled === true));
    await rig.press('Sair da conta');
    assert.equal(logoutCalls, 1);
  } finally {
    rig.dispose();
  }
});

test('STAFF-01 UI (10.2): Painel Operacional exibe resumo real, Controle de Entrada, agrupamento de estações, falha parcial e navegação sem mistura de eventos', async () => {
  let failEntry = false;
  const initialReads = [];
  let entryPendingCall = {
    id: CALL_1,
    participationId: PART_CALLED,
    displayName: 'Carlos Eduardo',
    calledAt: '2026-11-17T15:00:00.000Z',
  };
  let externalQueueEnabled = true;
  let waitingCount = 2;

  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onGet: (url) => {
      const eventPrefix = `/staff/events/${EV_A}/`;
      if (url.startsWith(eventPrefix)) initialReads.push(url.slice(eventPrefix.length));
      if (url === '/staff/events') {
        return Promise.resolve({
          events: [
            { id: EV_A, name: 'Arena Neon UNDB', status: 'open', effectivePhase: 'open' },
            { id: EV_B, name: 'Torneio Fechado', status: 'closed', effectivePhase: 'closed' },
          ],
        });
      }
      if (url === `/staff/events/${EV_A}/experiences`) {
        return Promise.resolve({
          eventId: EV_A,
          experiences: [
            { id: EXP_1, name: 'Just Dance' },
            { id: EXP_2, name: 'Street Fighter' },
            { id: EXP_EMPTY, name: 'Simulador Sem Estação' },
          ],
        });
      }
      if (url === `/staff/events/${EV_A}/stations`) {
        return Promise.resolve({
          eventId: EV_A,
          stations: [
            { id: ST_1, experienceId: EXP_1, label: 'Estação 01', availability: 'available', pendingServiceSessionId: SESS_1 },
            { id: ST_2, experienceId: EXP_1, label: 'Estação 02', availability: 'unavailable', pendingServiceSessionId: null },
            { id: ST_3, experienceId: EXP_2, label: 'Estação 01', availability: 'available', pendingServiceSessionId: null },
          ],
        });
      }
      if (url === `/staff/events/${EV_A}/entry-control`) {
        if (failEntry) return Promise.reject(Object.assign(new Error('unavailable'), { status: 500 }));
        const hasCall = Boolean(entryPendingCall);
        return Promise.resolve({
          eventId: EV_A,
          externalQueueEnabled,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          canCall: externalQueueEnabled && !hasCall && waitingCount > 0,
          canConfirm: externalQueueEnabled && hasCall,
          canMarkAbsent: externalQueueEnabled && hasCall,
          canRemove: externalQueueEnabled && hasCall,
          waitingCount,
          waiting: waitingCount === 2
            ? [
                { participationId: PART_WAIT_1, displayName: 'Ana', position: 1 },
                { participationId: PART_WAIT_2, displayName: 'Bia', position: 2 },
              ]
            : [],
          pendingCall: entryPendingCall,
        });
      }
      if (url === `/staff/events/${EV_A}/experiences/${EXP_2}/queue`) {
        return Promise.resolve({
          eventId: EV_A,
          experienceId: EXP_2,
          waitingCount: 0,
          canCallWaitingEntries: false,
          firstWaitingQueueEntryId: null,
        });
      }
      if (url === `/staff/events/${EV_B}/experiences`) {
        return Promise.resolve({ eventId: EV_B, experiences: [] });
      }
      if (url === `/staff/events/${EV_B}/stations`) {
        return Promise.resolve({ eventId: EV_B, stations: [] });
      }
      if (url === `/staff/events/${EV_B}/entry-control`) {
        return Promise.resolve({
          eventId: EV_B,
          externalQueueEnabled: false,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          canCall: false,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
          waitingCount: 0,
          waiting: [],
          pendingCall: null,
        });
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    },
  });

  try {
    await rig.mount();
    await rig.press('Selecionar evento Arena Neon UNDB');
    await rig.settle();
    rig.assertHeader('Voltar aos eventos');
    assert.deepEqual(initialReads.sort(), ['entry-control', 'experiences', 'stations']);

    // 1. Nome do evento não repetido e ausência de dados fictícios dos mockups
    assert.equal(rig.textOccurrences('Arena Neon UNDB'), 1, 'nome do evento aparece uma única vez no painel');
    assert.ok(rig.hasText('Painel operacional'));
    assert.ok(rig.hasText('Status: Aberto'));
    assert.ok(!rig.hasText('128'), 'não exibe contagem fictícia do mockup');
    assert.ok(!rig.hasText('05 de dez'), 'não exibe data fictícia do mockup');

    // 2. Métricas reais verificadas diretamente no rótulo correspondente (AUD-05)
    assert.equal(rig.metricValueFor('Estações ativas'), '2/3', 'métrica real de estações ativas');
    assert.equal(rig.metricValueFor('Em atendimento'), '1', 'métrica real de estações em atendimento');
    assert.equal(rig.metricValueFor('Fila externa'), '2', 'métrica real da fila externa');
    assert.ok(rig.pollingRegistrations.some((r) => r.intervalMs === 5000 && r.enabled === true));

    // 3. Controle de Entrada diferencia chamada pendente e fila ativa
    assert.ok(rig.hasText('Controle de Entrada'));
    assert.ok(rig.hasText('Chamada pendente: Carlos Eduardo · 2 aguardando'));
    assert.ok(rig.hasText('FILA ATIVA'));
    assert.equal(rig.textOccurrences('Chamada pendente'), 1, 'badge específico de chamada pendente');

    // 4. Estações agrupadas por experiência + atendimento pendente vs disponível/indisponível
    assert.ok(rig.hasText('3 estações'));
    assert.ok(rig.hasText('Just Dance'));
    assert.ok(rig.hasText('Street Fighter'));
    assert.ok(rig.hasText('Simulador Sem Estação'));
    assert.ok(rig.hasText('Nenhuma estação associada.'));
    assert.ok(rig.hasText('Atendimento pendente nesta estação'));
    assert.ok(rig.hasText('Sem atendimento pendente'));
    assert.ok(rig.hasText('Disponível'));
    assert.ok(rig.hasText('Indisponível'));
    assert.ok(rig.hasText('Chamado'));

    // 5. Navegar ao Controle de Entrada e voltar atualizando o resumo para fila desativada sem chamada pendente
    await rig.press('Controle de Entrada');
    assert.ok(rig.hasText(`EntryControl:${EV_A}`));
    rig.assertHeader('Voltar ao painel');
    externalQueueEnabled = false;
    entryPendingCall = null;
    waitingCount = 0;
    await rig.press('Voltar ao painel');
    await rig.settle();
    assert.ok(rig.hasText('Fila externa desativada · entrada direta'));
    assert.ok(rig.hasText('FILA INATIVA'));
    assert.equal(rig.metricValueFor('Fila externa'), '0');

    // 6. Falha parcial em /entry-control mostra indisponível sem apagar experiências/estações e mantém card navegável
    failEntry = true;
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(rig.hasText('Estado da fila externa indisponível'));
    assert.ok(rig.hasText('INDISPONÍVEL'));
    assert.equal(rig.metricValueFor('Fila externa'), '—');
    assert.equal(rig.isDisabled('Controle de Entrada'), false);
    assert.ok(rig.hasText('Just Dance'), 'estações/experiências preservadas em falha parcial');

    // 7. Navegar para a estação correta de Street Fighter e retornar ao painel
    await rig.press('Selecionar estação Estação 01 da experiência Street Fighter');
    await rig.settle();
    rig.assertHeader('Voltar ao painel');
    assert.ok(rig.hasText(`StationOp:${EV_A}:${EXP_2}:${ST_3}`));
    await rig.press('Voltar ao painel');
    assert.ok(rig.hasText('Painel operacional'));

    // 8. Trocar para evento B sem misturar estações ou dados do evento A
    failEntry = false;
    await rig.press('Voltar aos eventos');
    rig.assertHeader('Sair da conta');
    await rig.press('Selecionar evento Torneio Fechado');
    await rig.settle();
    assert.ok(rig.hasText('Status: Encerrado'));
    assert.ok(rig.hasText('Nenhuma estação encontrada neste evento.'));
    assert.ok(!rig.hasText('Just Dance'));
    assert.ok(!rig.hasText('Arena Neon UNDB'));
  } finally {
    rig.dispose();
  }
});

test('STAFF-01 UI (10.3): Recuperação automática de /entry-control, rejeição de payload inválido e bloqueio persistente após 403/404', async () => {
  let stationsMode = 'error500';
  let entryMode = 'error500';
  let expCalls = 0;
  let expFailNextNetwork = false;
  let includeMissingExp = false;
  let stationsIncludeUnknownExp = false;
  const EXP_NEW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const entryPayload = (patch = {}) => ({
    eventId: EV_A,
    externalQueueEnabled: true,
    canManage: true,
    observedAt: '2026-11-17T15:00:00.000Z',
    canCall: true,
    canConfirm: false,
    canMarkAbsent: false,
    canRemove: false,
    waitingCount: 1,
    waiting: [{ participationId: PART_WAIT_1, displayName: 'Ana', position: 1 }],
    pendingCall: null,
    ...patch,
  });

  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onGet: (url) => {
      if (url === '/staff/events') {
        return Promise.resolve({
          events: [{ id: EV_A, name: 'Arena UNDB Revisão', status: 'open', effectivePhase: 'open' }],
        });
      }
      if (url === `/staff/events/${EV_A}/experiences`) {
        expCalls += 1;
        if (expFailNextNetwork) {
          expFailNextNetwork = false;
          return Promise.reject(Object.assign(new Error('exp-offline'), { isNetworkError: true }));
        }
        const list = [{ id: EXP_1, name: 'Just Dance' }];
        if (includeMissingExp) list.push({ id: EXP_NEW, name: 'Nova Arena VR' });
        return Promise.resolve({ eventId: EV_A, experiences: list });
      }
      if (url === `/staff/events/${EV_A}/stations`) {
        if (stationsMode === 'error500') return Promise.reject(Object.assign(new Error('stations-500'), { status: 500 }));
        const list = [{ id: ST_1, experienceId: EXP_1, label: 'Estação 01', availability: 'available', pendingServiceSessionId: null }];
        if (stationsIncludeUnknownExp) {
          list.push({ id: ST_2, experienceId: EXP_NEW, label: 'Estação VR', availability: 'available', pendingServiceSessionId: null });
        }
        return Promise.resolve({ eventId: EV_A, stations: list });
      }
      if (url === `/staff/events/${EV_A}/entry-control`) {
        if (entryMode === 'error500') return Promise.reject(Object.assign(new Error('entry-500'), { status: 500 }));
        if (entryMode === 'forbidden403') return Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
        if (entryMode === 'notfound404') return Promise.reject(Object.assign(new Error('not-found'), { status: 404 }));
        if (entryMode === 'missingPendingCall') {
          const invalid = entryPayload();
          delete invalid.pendingCall;
          return Promise.resolve(invalid);
        }
        if (entryMode === 'inconsistentCall') {
          return Promise.resolve(entryPayload({
            canCall: false,
            canConfirm: true,
            canMarkAbsent: true,
            canRemove: true,
            pendingCall: {
              id: CALL_1,
              participationId: PART_WAIT_1,
              displayName: 'Ana',
              calledAt: '2026-11-17T15:01:00.000Z',
            },
          }));
        }
        return Promise.resolve(entryPayload());
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    },
  });

  try {
    await rig.mount();
    await rig.press('Selecionar evento Arena UNDB Revisão');
    await rig.settle();

    // 1. Falha inicial 500 em /entry-control (e mesmo com /stations em erro 500) mantém polling independente de 5s ativo
    assert.ok(rig.hasText('Estado da fila externa indisponível'));
    assert.ok(rig.hasText('INDISPONÍVEL'));
    const entryPoll = rig.latestPolling(':entry:');
    assert.ok(entryPoll && entryPoll.intervalMs === 5000 && entryPoll.enabled === true);

    // Quando o endpoint /entry-control volta (sem voltar /stations), polling recupera automaticamente
    entryMode = 'ready';
    await rig.triggerPolling(':entry:');
    assert.ok(rig.hasText('1 pessoa aguardando na entrada'));
    assert.ok(rig.hasText('FILA ATIVA'));
    assert.equal(rig.metricValueFor('Fila externa'), '1');

    // 2. Respostas com pendingCall ausente ou inconsistente com waiting são rejeitadas como inválidas
    entryMode = 'missingPendingCall';
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(rig.hasText('Estado da fila externa indisponível'));
    assert.ok(!rig.hasText('FILA ATIVA'));

    entryMode = 'inconsistentCall';
    await rig.triggerPolling(':entry:');
    assert.ok(rig.hasText('Estado da fila externa indisponível'));

    // 3. Revalidação controlada de experiência desconhecida sem loop infinito e com recuperação após falha (AUD-04 + R3-04)
    stationsMode = 'ready';
    stationsIncludeUnknownExp = false;
    includeMissingExp = false;
    entryMode = 'ready';
    await rig.press('Atualizar estações');
    await rig.settle();

    // Estação órfã surge no polling de estações e a primeira tentativa de sincronizar /experiences falha por rede
    stationsIncludeUnknownExp = true;
    expCalls = 0;
    expFailNextNetwork = true;
    await rig.triggerPolling(':stations:');
    assert.equal(expCalls, 1, 'dispara 1 tentativa automática ao detectar experiência desconhecida');
    assert.equal(rig.latestPolling(':experiences:')?.enabled, true, 'R3-04: habilita polling de recuperação de experiências após falha transitória');

    // No ciclo de polling de 5s de :experiences: mantendo a mesma orphanSignature, a consulta é repetida; se ainda não existe (200 válido), para de consultar
    await rig.triggerPolling(':experiences:');
    assert.equal(expCalls, 2);
    assert.ok(rig.hasText('Experiência não vinculada'));
    assert.ok(rig.hasText('Estação VR'));

    // Novos ciclos de polling de estações com a mesma inconsistência já verificada por 200 NÃO disparam novas leituras de /experiences
    await rig.triggerPolling(':stations:');
    await rig.triggerPolling(':stations:');
    assert.equal(expCalls, 2, 'não entra em loop de consultas diante de inconsistência persistente');

    // Ao atualizar manualmente quando a nova experiência passa a existir, vínculo é confirmado
    includeMissingExp = true;
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(rig.hasText('Nova Arena VR'));
    assert.ok(!rig.hasText('Experiência não vinculada'));

    // 4. Perda de autorização (403 no polling) limpa dados protegidos da tela, bloqueia entrada e desliga polling
    entryMode = 'forbidden403';
    await rig.triggerPolling(':entry:');
    assert.ok(!rig.hasText('Just Dance'), 'experiências protegidas removidas após 403');
    assert.ok(!rig.hasText('Estação 01'), 'estações protegidas removidas após 403');
    assert.ok(rig.hasText('Acesso ao evento ou à experiência indisponível. Atualize seus eventos autorizados.'));
    assert.ok(rig.hasText('SEM ACESSO'));
    assert.equal(rig.isDisabled('Controle de Entrada'), true);
    assert.equal(rig.latestPolling(':entry:')?.enabled, false);

    // 5. Atualização manual recebendo 500 posterior NÃO reabilita acesso negado (AUD-02) e NÃO deixa botão Atualizar estações travado (R3-01)
    entryMode = 'error500';
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(!rig.hasText('Just Dance'));
    assert.ok(rig.hasText('SEM ACESSO'));
    assert.equal(rig.isDisabled('Controle de Entrada'), true);
    assert.equal(rig.isDisabled('Atualizar estações'), false, 'R3-01: Atualizar estações reabilita após revalidação parcial 200/200/500');

    // 404 na carga manual também mantém revogação e bloqueio
    entryMode = 'notfound404';
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(!rig.hasText('Just Dance'));
    assert.ok(rig.hasText('SEM ACESSO'));
    assert.equal(rig.isDisabled('Controle de Entrada'), true);

    // Confirmação positiva 200 restaura painel e card
    entryMode = 'ready';
    await rig.press('Atualizar estações');
    await rig.settle();
    assert.ok(rig.hasText('Just Dance'));
    assert.ok(rig.hasText('FILA ATIVA'));
    assert.equal(rig.isDisabled('Controle de Entrada'), false);
  } finally {
    rig.dispose();
  }
});

test('STAFF-04: staffEventsService distingue 403/timeout/503 e recupera automaticamente via refreshSilent após falha inicial transitória', async () => {
  const current = identity();
  let mode = 'timeout';
  let calls = 0;
  const store = createStaffEventsStore({
    client: {
      get: async () => {
        calls += 1;
        if (mode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
        if (mode === '503') throw Object.assign(new Error('503'), { status: 503 });
        if (mode === 'malformed') return { events: 'invalido' };
        if (mode === '403') throw Object.assign(new Error('forbidden'), { status: 403 });
        if (mode === '401') throw Object.assign(new Error('session'), { status: 401 });
        return { events: [event] };
      },
    },
    getIdentity: () => current,
  });

  store.setIdentity(current);
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'network', 'timeout classifica como network');

  mode = '503';
  await store.refreshSilent();
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'unavailable');

  mode = 'malformed';
  await store.refreshSilent();
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'unavailable');

  mode = 'ok';
  await store.refreshSilent();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().events.length, 1);

  // 403 classifica como denied e impede novas tentativas silenciosas
  mode = '403';
  await store.refreshSilent();
  const callsAfter403 = calls;
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'denied');
  assert.equal(store.getSnapshot().events.length, 0);
  await store.refreshSilent();
  assert.equal(calls, callsAfter403, 'refreshSilent não repete após 403');

  // 401 também classifica como session e impede novas tentativas silenciosas
  mode = '401';
  await store.refresh();
  const callsAfter401 = calls;
  assert.equal(store.getSnapshot().error, 'session');
  await store.refreshSilent();
  assert.equal(calls, callsAfter401, 'refreshSilent não repete após 401');
});

test('STAFF-04 UI: indicadores honestos de polling (60s/5s), recuperação automática na Seleção de Eventos e pausa por foco/segundo plano no Painel', async () => {
  let eventsMode = '503';
  let stationsMode = 'ok';
  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onGet: (url) => {
      if (url === '/staff/events') {
        if (eventsMode === '503') return Promise.reject(Object.assign(new Error('503'), { status: 503 }));
        if (eventsMode === '403') return Promise.reject(Object.assign(new Error('403'), { status: 403 }));
        return Promise.resolve({
          events: [{ id: EV_A, name: 'Arena STAFF-04', status: 'open', effectivePhase: 'open' }],
        });
      }
      if (url === `/staff/events/${EV_A}/stations`) {
        if (stationsMode === 'network') return Promise.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
        return Promise.resolve({
          eventId: EV_A,
          stations: [{ id: ST_1, experienceId: EXP_1, label: 'Estação 01', availability: 'available', pendingServiceSessionId: null }],
        });
      }
      if (url === `/staff/events/${EV_A}/experiences`) {
        return Promise.resolve({ eventId: EV_A, experiences: [{ id: EXP_1, name: 'Just Dance' }] });
      }
      if (url === `/staff/events/${EV_A}/entry-control`) {
        return Promise.resolve({
          eventId: EV_A,
          externalQueueEnabled: true,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          canCall: false,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
          waitingCount: 0,
          waiting: [],
          pendingCall: null,
        });
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    },
  });

  try {
    await rig.mount();
    assert.ok(rig.hasText('Atualização indisponível · aguardando recuperação (a cada 60s)'));
    const recoveryPoll = rig.latestEventsPolling();
    assert.ok(recoveryPoll && recoveryPoll.enabled === true);

    // Recuperação automática por GET na Seleção de Eventos sem clique manual
    eventsMode = 'ok';
    await rig.triggerEventsPolling();
    assert.ok(rig.hasText('Arena STAFF-04'));
    assert.ok(rig.hasText('Atualização automática ativa · a cada 60s'));

    await rig.setFocused(false);
    assert.ok(rig.hasText('Atualização temporariamente pausada'));
    await rig.setFocused(true);
    assert.ok(rig.hasText('Atualização automática ativa · a cada 60s'));

    // Painel operacional reflete 5s ativo, pausa em segundo plano e stale em falha transitória
    await rig.press('Selecionar evento Arena STAFF-04');
    await rig.settle();
    assert.ok(rig.hasText('Atualização automática ativa · a cada 5s'));

    await rig.setAppState('background');
    assert.ok(rig.hasText('Atualização temporariamente pausada'));
    assert.ok(!rig.hasText('Atualização automática ativa'));
    await rig.setAppState('active');
    assert.ok(rig.hasText('Atualização automática ativa · a cada 5s'));

    stationsMode = 'network';
    await rig.triggerPolling(':stations:');
    assert.ok(rig.hasText('Dados desatualizados · tentando atualizar a cada 5s'));
    stationsMode = 'ok';
    await rig.triggerPolling(':stations:');
    assert.ok(rig.hasText('Atualização automática ativa · a cada 5s'));

    // Voltar para eventos e receber 403 oculta indicador de polling e exibe mensagem de acesso negado
    await rig.press('Voltar aos eventos');
    eventsMode = '403';
    await rig.press('Atualizar eventos');
    await rig.settle();
    assert.ok(rig.hasText('Acesso Staff indisponível para esta conta.'));
    assert.ok(!rig.hasText('Atualização automática ativa'));
    assert.ok(!rig.hasText('Atualização indisponível'));
    assert.equal(rig.latestEventsPolling()?.enabled, false);
  } finally {
    rig.dispose();
  }
});

test('STAFF04-AUD-02: negativa 401/403 concorrente com refresh bloqueia 200 atrasado e 503 posterior, isola contas e limpa painel dependente', async () => {
  // Parte A: contrato da store createStaffEventsStore em corridas e troca de identidade
  for (const [httpStatus, expectedError] of [
    [403, 'denied'],
    [401, 'session'],
  ]) {
    let current = identity('u-1', 1, 1);
    let calls = 0;
    const queueResponses = [];
    const store = createStaffEventsStore({
      client: {
        get: async () => {
          calls += 1;
          const next = queueResponses.shift();
          return next();
        },
      },
      getIdentity: () => current,
    });

    store.setIdentity(current);
    queueResponses.push(async () => ({ events: [event] }));
    await store.refresh();
    assert.equal(store.select(event.id), true);
    assert.equal(store.getSnapshot().accessLocked, false);

    // Refresh B (mais novo) e RefreshSilent A (mais antigo) concorrem na mesma identidade
    const silentA = deferred();
    const refreshB = deferred();
    queueResponses.push(() => silentA.promise);
    queueResponses.push(() => refreshB.promise);

    const pSilentA = store.refreshSilent();
    const pRefreshB = store.refresh();

    // Polling A retorna 401/403 mesmo com generation avançada por Refresh B -> trava imediatamente
    silentA.reject(Object.assign(new Error('auth-lost'), { status: httpStatus }));
    await pSilentA;
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal(store.getSnapshot().accessLocked, true);
    assert.equal(store.getSnapshot().events.length, 0);
    assert.equal(store.getSnapshot().selected, null);
    assert.equal(store.select(event.id), false);

    // 200 atrasado de Refresh B NÃO reabilita nem restaura eventos
    refreshB.resolve({ events: [event] });
    await pRefreshB;
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal(store.getSnapshot().accessLocked, true);
    assert.equal(store.getSnapshot().events.length, 0);
    assert.equal(store.getSnapshot().selected, null);

    // Nova tentativa manual que recebe 503 NÃO desbloqueia refreshSilent nem seleção
    queueResponses.push(async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); });
    await store.refresh();
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, 'unavailable');
    assert.equal(store.getSnapshot().accessLocked, true);

    const callsBeforeSilent = calls;
    await store.refreshSilent();
    assert.equal(calls, callsBeforeSilent, 'refreshSilent permanece bloqueado enquanto accessLocked=true');

    // Somente nova confirmação 200 legítima desbloqueia e retoma refreshSilent
    queueResponses.push(async () => ({ events: [event] }));
    await store.refresh();
    assert.equal(store.getSnapshot().status, 'ready');
    assert.equal(store.getSnapshot().accessLocked, false);
    assert.equal(store.getSnapshot().events.length, 1);

    // Troca de conta limpa trava anterior e descarta 403 tardio da conta antiga
    const delayedOldAuth = deferred();
    queueResponses.push(() => delayedOldAuth.promise);
    const pOldAccount = store.refresh();
    current = identity('u-2', 2, 1);
    store.setIdentity(current);
    queueResponses.push(async () => ({ events: [event] }));
    await store.refresh();
    delayedOldAuth.reject(Object.assign(new Error('stale-403'), { status: 403 }));
    await pOldAccount;
    assert.equal(store.getSnapshot().status, 'ready');
    assert.equal(store.getSnapshot().accessLocked, false);
  }

  // Parte B: UI integrada do navegador Staff desmonta painel dependente ao receber 403 no polling de eventos
  let eventsMode = 'ok';
  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onGet: (url) => {
      if (url === '/staff/events') {
        if (eventsMode === '403') return Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
        if (eventsMode === '503') return Promise.reject(Object.assign(new Error('503'), { status: 503 }));
        return Promise.resolve({
          events: [{ id: EV_A, name: 'Arena STAFF-04 AUD02', status: 'open', effectivePhase: 'open' }],
        });
      }
      if (url === `/staff/events/${EV_A}/stations`) {
        return Promise.resolve({
          eventId: EV_A,
          stations: [{ id: ST_1, experienceId: EXP_1, label: 'Estação 01', availability: 'available', pendingServiceSessionId: null }],
        });
      }
      if (url === `/staff/events/${EV_A}/experiences`) {
        return Promise.resolve({ eventId: EV_A, experiences: [{ id: EXP_1, name: 'Just Dance' }] });
      }
      if (url === `/staff/events/${EV_A}/entry-control`) {
        return Promise.resolve({
          eventId: EV_A,
          externalQueueEnabled: true,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          canCall: false,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
          waitingCount: 0,
          waiting: [],
          pendingCall: null,
        });
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    },
  });

  try {
    await rig.mount();
    await rig.press('Selecionar evento Arena STAFF-04 AUD02');
    await rig.settle();
    assert.ok(rig.hasText('Just Dance'));
    assert.ok(rig.hasText('Estação 01'));

    // 403 em polling de eventos enquanto o StaffEventDashboard está aberto limpa seleção e telas filhas
    eventsMode = '403';
    await rig.triggerEventsPolling();
    assert.ok(!rig.hasText('Just Dance'), 'experiências protegidas removidas após perda de acesso aos eventos');
    assert.ok(!rig.hasText('Estação 01'), 'estações protegidas removidas após perda de acesso aos eventos');
    assert.ok(!rig.hasText('Controle de Entrada'));
    assert.ok(rig.hasText('Acesso Staff indisponível para esta conta. Volte aos eventos ou procure o responsável.'));
    assert.equal(rig.latestEventsPolling()?.enabled, false);

    // Ao voltar e tentar atualização manual com 503, indicador afirma recuperação manual (sem 60s automático)
    await rig.press('Voltar aos eventos');
    eventsMode = '503';
    await rig.press('Atualizar eventos');
    await rig.settle();
    assert.ok(rig.hasText('Atualização indisponível · aguardando recuperação manual'));
    assert.ok(!rig.hasText('a cada 60s'));
    assert.equal(rig.latestEventsPolling()?.enabled, false);

    // Confirmação 200 restaura normalmente
    eventsMode = 'ok';
    await rig.press('Atualizar eventos');
    await rig.settle();
    assert.ok(rig.hasText('Arena STAFF-04 AUD02'));
    assert.ok(rig.hasText('Atualização automática ativa · a cada 60s'));
  } finally {
    rig.dispose();
  }
});

test('STAFF04-AUD-05: Painel Operacional separa indicador de 5s do indicador de Eventos e fase (60s) em todos os estados de stale e pausa', async () => {
  let eventsMode = 'ok';
  let stationsMode = 'ok';
  const rig = createStaffUiHarness({
    initialAuth: makeAuthIdentity('u-1', 1, 1),
    onGet: (url) => {
      if (url === '/staff/events') {
        if (eventsMode === '503') return Promise.reject(Object.assign(new Error('503'), { status: 503 }));
        return Promise.resolve({
          events: [{ id: EV_A, name: 'Arena STAFF-04 AUD05', status: 'open', effectivePhase: 'open' }],
        });
      }
      if (url === `/staff/events/${EV_A}/stations`) {
        if (stationsMode === 'network') return Promise.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
        return Promise.resolve({
          eventId: EV_A,
          stations: [{ id: ST_1, experienceId: EXP_1, label: 'Estação 01', availability: 'available', pendingServiceSessionId: null }],
        });
      }
      if (url === `/staff/events/${EV_A}/experiences`) {
        return Promise.resolve({ eventId: EV_A, experiences: [{ id: EXP_1, name: 'Just Dance' }] });
      }
      if (url === `/staff/events/${EV_A}/entry-control`) {
        return Promise.resolve({
          eventId: EV_A,
          externalQueueEnabled: true,
          canManage: true,
          observedAt: '2026-11-17T15:00:00.000Z',
          canCall: false,
          canConfirm: false,
          canMarkAbsent: false,
          canRemove: false,
          waitingCount: 0,
          waiting: [],
          pendingCall: null,
        });
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    },
  });

  try {
    await rig.mount();
    await rig.press('Selecionar evento Arena STAFF-04 AUD05');
    await rig.settle();
    assert.ok(rig.hasText('Atualização automática ativa · a cada 5s'));
    assert.ok(rig.hasText('Eventos e fase: atualização automática ativa · a cada 60s'));

    // Somente Eventos e fase fica stale: indicador de 5s NÃO afirma que ops está desatualizado nem que Eventos tenta a cada 5s
    eventsMode = '503';
    await rig.triggerEventsPolling();
    assert.ok(rig.hasText('Atualização automática ativa · a cada 5s'));
    assert.ok(rig.hasText('Eventos e fase: dados desatualizados · tentando atualizar a cada 60s'));
    assert.ok(rig.hasText('Dados de eventos e fase possivelmente desatualizados. Volte aos eventos para atualizar antes de operar.'));
    assert.ok(!rig.hasText('Dados desatualizados · tentando atualizar a cada 5s'));
    assert.ok(!rig.hasText('Dados operacionais possivelmente desatualizados'));

    // Eventos recupera e apenas operações (estações) fica stale
    eventsMode = 'ok';
    await rig.triggerEventsPolling();
    stationsMode = 'network';
    await rig.triggerPolling(':stations:');
    assert.ok(rig.hasText('Dados desatualizados · tentando atualizar a cada 5s'));
    assert.ok(rig.hasText('Dados operacionais possivelmente desatualizados'));
    assert.ok(rig.hasText('Eventos e fase: atualização automática ativa · a cada 60s'));
    assert.ok(!rig.hasText('Eventos e fase: dados desatualizados'));

    // Ambos stale simultaneamente mantêm cadências honestas separadas e pausa coerente em segundo plano
    eventsMode = '503';
    await rig.triggerEventsPolling();
    assert.ok(rig.hasText('Dados desatualizados · tentando atualizar a cada 5s'));
    assert.ok(rig.hasText('Eventos e fase: dados desatualizados · tentando atualizar a cada 60s'));

    await rig.setAppState('background');
    assert.ok(rig.hasText('Dados desatualizados · atualização temporariamente pausada'));
    assert.ok(rig.hasText('Eventos e fase: dados desatualizados · atualização temporariamente pausada'));

    await rig.setAppState('active');
    assert.ok(rig.hasText('Dados desatualizados · tentando atualizar a cada 5s'));
    assert.ok(rig.hasText('Eventos e fase: dados desatualizados · tentando atualizar a cada 60s'));
  } finally {
    rig.dispose();
  }
});
