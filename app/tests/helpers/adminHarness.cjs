// Harness das telas Admin (modo demonstração). Monta o AdminDemoProvider REAL
// e uma pilha de navegação mínima, sem React Native nem servidor.
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModule, textOf } = require('./questionnaireHarness.cjs');

const nativeNames = ['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView',
  'Text', 'TextInput', 'View'];

function createReactMock() {
  let current = null;
  const react = {
    createContext(defaultValue = null) {
      return { _value: defaultValue, Provider: 'ContextProvider' };
    },
    useContext(context) {
      return context?._value ?? null;
    },
    useState(initial) {
      const instance = current;
      const index = instance.cursor++;
      if (!(index in instance.slots)) {
        instance.slots[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [instance.slots[index], (value) => {
        instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value;
        instance.dirty = true;
      }];
    },
    useRef(initial) {
      const instance = current;
      const index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = { current: initial };
      return instance.slots[index];
    },
    useEffect(callback, dependencies) {
      const instance = current;
      const index = instance.cursor++;
      const previous = instance.slots[index];
      const changed = !previous || !dependencies
        || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]));
      if (!changed) return;
      const slot = { dependencies, cleanup: previous?.cleanup ?? null };
      instance.slots[index] = slot;
      instance.effects.push(() => {
        if (typeof slot.cleanup === 'function') slot.cleanup();
        const cleanup = callback();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : null;
      });
    },
  };

  function mount(Component, initialProps) {
    const instance = { slots: [], cursor: 0, effects: [], dirty: false, tree: null, props: initialProps };
    function render() {
      instance.cursor = 0;
      instance.dirty = false;
      const previous = current;
      current = instance;
      try {
        instance.tree = Component(instance.props);
      } finally {
        current = previous;
      }
      instance.effects.splice(0).forEach((run) => run());
    }
    render();
    return {
      instance,
      render,
      get tree() { return instance.tree; },
      unmount() {
        instance.slots.forEach((slot) => {
          if (slot && typeof slot.cleanup === 'function') slot.cleanup();
        });
      },
    };
  }

  return { react, mount };
}

// Percorre a árvore como o usuário a vê: Modal fechado não aparece e, com um
// Modal aberto, apenas o conteúdo dele é interativo.
function visibleNodes(element, acc = [], modals = []) {
  if (element == null || typeof element === 'boolean') return acc;
  if (Array.isArray(element)) {
    element.forEach((child) => visibleNodes(child, acc, modals));
    return acc;
  }
  if (typeof element !== 'object' || !element.props) return acc;
  if (typeof element.type === 'function') {
    return visibleNodes(element.type(element.props), acc, modals);
  }
  if (element.type === 'Modal') {
    if (element.props.visible) modals.push(element);
    return acc;
  }
  acc.push(element);
  visibleNodes(element.props.children, acc, modals);
  return acc;
}

function interactiveNodes(tree) {
  const modals = [];
  const base = visibleNodes(tree, [], modals);
  if (modals.length === 0) return { nodes: base, modalOpen: false };
  const inside = [];
  modals.forEach((modal) => visibleNodes(modal.props.children, inside, []));
  return { nodes: inside, modalOpen: true, background: base };
}

function allTexts(tree) {
  const { nodes, background = [] } = interactiveNodes(tree);
  return [...background, ...nodes]
    .filter((node) => node.type === 'Text')
    .map((node) => textOf(node));
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function createAdminApp({ auth, initialRoute = 'AdminPanel', initialParams, latency } = {}) {
  const { react, mount } = createReactMock();
  const cache = new Map();
  // Conta trocável durante o teste (troca direta A → B, sem logout).
  let authValue = auth ?? {
    isAuthenticated: true,
    user: { id: 'u-1', name: 'Conta Teste' },
    getSessionEpoch: () => 1,
  };
  const requested = [];

  function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const directory = path.posix.dirname(relativePath);
    const { exports } = loadModule(relativePath, (name) => {
      requested.push(name);
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name === 'react-native') {
        const native = Object.fromEntries(nativeNames.map((key) => [key, key]));
        native.StyleSheet = { create: (styles) => styles };
        native.Platform = { OS: 'ios' };
        return native;
      }
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (name.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(directory, name));
        if (target === 'context/AuthContext') return { AuthContext: {}, useAuth: () => authValue };
        if (target === 'screens/admin/adminDemoLatency') {
          return { waitAdminDemoLatency: latency ?? (() => Promise.resolve()) };
        }
        assert.ok(!/ParticipationContext|services\/|screens\/staff\//.test(target),
          `Área Admin não pode importar ${target}`);
        return load(`${target}.js`);
      }
      return require(name);
    });
    cache.set(relativePath, exports);
    return exports;
  }

  const context = load('screens/admin/AdminDemoContext.js');
  const screens = {
    AdminPanel: load('screens/admin/AdminPanelScreen.js').default,
    AdminEvents: load('screens/admin/AdminEventsScreen.js').default,
    AdminCreateEvent: load('screens/admin/AdminCreateEventScreen.js').default,
    AdminEventDetail: load('screens/admin/AdminEventDetailScreen.js').default,
    AdminEventSchedule: load('screens/admin/AdminEventScheduleScreen.js').default,
    AdminEventQueue: load('screens/admin/AdminEventQueueScreen.js').default,
    AdminEventClose: load('screens/admin/AdminEventCloseScreen.js').default,
    AdminEventExperiences: load('screens/admin/AdminEventExperiencesScreen.js').default,
    AdminExperienceDetail: load('screens/admin/AdminExperienceDetailScreen.js').default,
    AdminStationDetail: load('screens/admin/AdminStationDetailScreen.js').default,
    AdminEventStaff: load('screens/admin/AdminEventStaffScreen.js').default,
    AdminHistory: load('screens/admin/AdminHistoryScreen.js').default,
    AdminEventBi: load('screens/admin/AdminEventBiScreen.js').default,
    AdminOverview: load('screens/admin/AdminOverviewScreen.js').default,
  };

  const provider = mount(context.AdminDemoProvider, { children: null });
  const navigationCalls = [];
  const stack = [];
  let exitedToApp = false;

  function publishContext() {
    context.AdminDemoContext._value = provider.tree.props.value;
  }

  function sync() {
    if (exitedToApp) return;
    for (let i = 0; i < 30; i++) {
      if (provider.instance.dirty) provider.render();
      publishContext();
      const top = stack[stack.length - 1];
      top.mounted.render();
      if (!provider.instance.dirty && !top.mounted.instance.dirty) return;
    }
    assert.fail('loop de renderização');
  }

  function navigationFor() {
    return {
      navigate(name, params) {
        navigationCalls.push({ type: 'navigate', name, params });
        push(name, params);
      },
      replace(name, params) {
        navigationCalls.push({ type: 'replace', name, params });
        stack.pop().mounted.unmount();
        push(name, params);
      },
      popTo(name) {
        navigationCalls.push({ type: 'popTo', name });
        const index = stack.map((route) => route.name).lastIndexOf(name);
        assert.ok(index >= 0, `popTo para rota fora da pilha: ${name}`);
        while (stack.length > index + 1) stack.pop().mounted.unmount();
      },
      goBack() {
        navigationCalls.push({ type: 'back' });
        if (stack.length > 1) stack.pop().mounted.unmount();
      },
      // Pilha do app: goBack fecha a rota AdminDemo inteira (telas e provedor).
      getParent() {
        return {
          goBack() {
            navigationCalls.push({ type: 'parentBack' });
            exitedToApp = true;
            if (provider.instance.dirty) provider.render();
            while (stack.length) stack.pop().mounted.unmount();
            provider.unmount();
          },
        };
      },
    };
  }

  function push(name, params) {
    assert.ok(Object.prototype.hasOwnProperty.call(screens, name), `rota desconhecida: ${name}`);
    publishContext();
    const props = { navigation: navigationFor(), route: { name, params } };
    stack.push({ name, params, mounted: mount(screens[name], props) });
  }

  publishContext();
  push(initialRoute, initialParams);
  sync();

  const top = () => stack[stack.length - 1];
  const findPressable = (label) => interactiveNodes(top().mounted.tree).nodes.find((node) =>
    node.type === 'Pressable' && (node.props.accessibilityLabel === label || textOf(node) === label));
  const findInput = (label) => interactiveNodes(top().mounted.tree).nodes.find((node) =>
    node.type === 'TextInput' && node.props.accessibilityLabel === label);

  const api = {
    navigationCalls,
    requested,
    get exitedToApp() { return exitedToApp; },
    get route() { return top().name; },
    get routes() { return stack.map((route) => route.name); },
    get params() { return top().params; },
    get session() { return provider.tree.props.value.session; },
    get demo() { return provider.tree.props.value; },
    get modalOpen() { return interactiveNodes(top().mounted.tree).modalOpen; },
    texts() { return allTexts(top().mounted.tree); },
    hasText(fragment) { return api.texts().some((text) => text.includes(fragment)); },
    hasButton(label) { return Boolean(findPressable(label)); },
    hasLabel(label) {
      return interactiveNodes(top().mounted.tree).nodes.some((node) => node.props.accessibilityLabel === label);
    },
    button(label) { return findPressable(label); },
    isDisabled(label) {
      const button = findPressable(label);
      assert.ok(button, `botão ausente: ${label}`);
      return button.props.disabled === true;
    },
    press(label) {
      const button = findPressable(label);
      assert.ok(button, `botão ausente ou encoberto: ${label}`);
      assert.notEqual(button.props.disabled, true, `botão desabilitado: ${label}`);
      const result = button.props.onPress();
      sync();
      return result;
    },
    async pressAsync(label) {
      const pending = api.press(label);
      sync();
      await pending;
      await flushPromises();
      sync();
    },
    type(label, value) {
      const input = findInput(label);
      assert.ok(input, `campo ausente: ${label}`);
      input.props.onChangeText(value);
      sync();
    },
    input(label) { return findInput(label); },
    async flush() {
      await flushPromises();
      sync();
      await flushPromises();
      sync();
    },
    sync,
    // Troca a conta e re-renderiza (como faria o AuthContext).
    setAuth(next) { authValue = next; provider.render(); sync(); },
    // Troca a conta SEM re-renderizar: simula callback antigo antes da nova renderização.
    setAuthWithoutRender(next) { authValue = next; },
    handlerOf(label) {
      const button = findPressable(label);
      assert.ok(button, `botão ausente ou encoberto: ${label}`);
      return button.props.onPress;
    },
  };
  return api;
}

module.exports = { createAdminApp };
