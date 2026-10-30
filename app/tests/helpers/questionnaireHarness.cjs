const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const types = require('@babel/types');

const appDirectory = path.resolve(__dirname, '../..');

function loadModule(relativePath, requireModule, exposeFields = [], sourceOverride) {
  const filename = path.join(appDirectory, relativePath);
  const capturePlugin = () => ({
    visitor: {
      ExportDefaultDeclaration(nodePath) {
        if (!exposeFields.length || !types.isFunctionDeclaration(nodePath.node.declaration)) return;
        const body = nodePath.node.declaration.body.body;
        body.splice(body.findIndex((node) => types.isReturnStatement(node)), 0,
          types.expressionStatement(types.assignmentExpression('=',
            types.memberExpression(types.identifier('globalThis'), types.identifier('__capture')),
            types.objectExpression(exposeFields.map((name) =>
              types.objectProperty(types.identifier(name), types.identifier(name), false, true))))));
      },
    },
  });
  const { code } = babel.transformSync(sourceOverride ?? readFileSync(filename, 'utf8'), {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [capturePlugin, ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
      '@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: requireModule,
    Date,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    process,
  };
  vm.runInNewContext(code, context, { filename });
  return { exports: module.exports, context };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function nodes(element) {
  if (element == null || typeof element === 'boolean') return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== 'object' || !element.props) return [];
  if (typeof element.type === 'function') {
    return [element, ...nodes(element.type(element.props))];
  }
  return [element, ...nodes(element.props.children)];
}

function textOf(element) {
  if (element == null || typeof element === 'boolean') return '';
  if (Array.isArray(element)) return element.map(textOf).join('');
  if (typeof element !== 'object') return String(element);
  return textOf(element.props?.children);
}

function syncResolve(value) {
  return {
    then(onFulfilled) {
      try {
        const next = onFulfilled ? onFulfilled(value) : value;
        if (next && typeof next.then === 'function') return next;
        return syncResolve(next);
      } catch (err) {
        return syncReject(err);
      }
    },
    catch() { return this; },
    finally(onFinally) {
      try {
        if (onFinally) onFinally();
        return this;
      } catch (err) {
        return syncReject(err);
      }
    },
  };
}

function syncReject(reason) {
  return {
    then(onFulfilled, onRejected) {
      if (!onRejected) return this;
      try {
        const next = onRejected(reason);
        if (next && typeof next.then === 'function') return next;
        return syncResolve(next);
      } catch (err) {
        return syncReject(err);
      }
    },
    catch(onRejected) {
      return this.then(null, onRejected);
    },
    finally(onFinally) {
      try {
        if (onFinally) onFinally();
        return this;
      } catch (err) {
        return syncReject(err);
      }
    },
  };
}

function createHarness(relativePath, options = {}) {
  const state = [];
  const queue = [];
  const effects = [];
  const cleanups = [];
  const navigationCalls = [];
  const navigationListeners = new Map();
  let focused = options.focused !== false;
  let cursor = 0;
  let insideUpdater = false;
  let capture;
  let tree;
  let props = options.props || {};

  const defaultCatalog = [
    'Minecraft',
    'Roblox',
    'Valorant',
    'Fortnite',
    'League of Legends',
    'Counter-Strike 2',
    'EA Sports FC 24',
    'Free Fire',
  ];

  let authContextValue;
  if (options.authContext !== undefined) {
    authContextValue = options.authContext;
  } else {
    authContextValue = {
      isAuthenticated: true,
      user: { id: 'default-user', name: 'Default User', hasCompletedQuestionnaire: false },
      httpClient: {
        get: (url) => {
          if (url.startsWith('/games')) {
            const parsedUrl = new URL(url, 'http://localhost');
            const queryParam = parsedUrl.searchParams.get('query')?.toLowerCase();
            const filtered = queryParam
              ? defaultCatalog.filter((g) => g.toLowerCase().includes(queryParam))
              : defaultCatalog;
            return syncResolve({
              games: filtered.map((name, i) => ({ id: `game-${i}`, name })),
              total: filtered.length,
            });
          }
          if (url === '/profile/questionnaire') {
            return syncResolve({ hasCompleted: false });
          }
          return syncResolve({});
        },
        put: (url, payload) => syncResolve({ message: 'OK' }),
      },
      fetchCurrentUser: () => syncResolve({ id: 'default-user', hasCompletedQuestionnaire: true }),
      markQuestionnaireCompleted: () => {},
    };
  }

  const AuthContextToken = { _defaultValue: null, Provider: 'AuthContextProvider' };

  const react = {
    createContext(defaultValue = null) {
      return { _defaultValue: defaultValue, Provider: 'ContextProvider' };
    },
    useContext(contextObj) {
      if (contextObj === AuthContextToken) {
        return authContextValue;
      }
      return contextObj?._defaultValue ?? authContextValue;
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = freeze(initial);
      return [state[index], (update) => {
        assert.equal(insideUpdater, false, 'state setters must stay outside updaters');
        queue.push([index, update]);
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useCallback(fn, dependencies) {
      const index = cursor++;
      const previous = state[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        state[index] = { fn, dependencies };
        return fn;
      }
      return previous.fn;
    },
    useMemo(fn, dependencies) {
      const index = cursor++;
      const previous = state[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        const val = fn();
        state[index] = { val, dependencies };
        return val;
      }
      return previous.val;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = state[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        state[index] = dependencies;
        effects.push({ index, callback });
      }
    },
  };
  const native = Object.fromEntries(['ActivityIndicator', 'Image', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView',
    'Text', 'TextInput', 'View', 'SafeAreaView'].map((name) => [name, name]));
  native.Platform = { OS: options.platform || 'ios' };
  native.Keyboard = { dismiss() {} };
  native.StyleSheet = {
    create: (value) => value,
    flatten: (value) => Array.isArray(value) ? Object.assign({}, ...value) : value,
    absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  };
  const birthDate = loadModule('utils/birthDate.js', require).exports;
  const validation = loadModule('utils/validation.js', (name) =>
    name === './birthDate' ? birthDate : require(name), [], options.validationSource).exports;
  const data = loadModule('data/mockData.js', require).exports;
  const nativePickerCalls = [];
  const nativePicker = {
    __esModule: true,
    default: 'DateTimePicker',
    DateTimePickerAndroid: { open: (value) => nativePickerCalls.push(value) },
  };
  const navigation = {
    isFocused() { return focused; },
    addListener(event, listener) {
      if (!navigationListeners.has(event)) navigationListeners.set(event, new Set());
      navigationListeners.get(event).add(listener);
      return () => navigationListeners.get(event).delete(listener);
    },
    popTo(name, params) { navigationCalls.push({ type: 'popTo', name, params }); },
    navigate(name, params) { assert.equal(insideUpdater, false); navigationCalls.push({ type: 'navigate', name, params }); },
    goBack() { assert.equal(insideUpdater, false); navigationCalls.push({ type: 'back' }); },
    replace(name) { assert.equal(insideUpdater, false); navigationCalls.push({ type: 'replace', name }); },
  };
  if (!options.fallbackNavigation) navigation.reset = (payload) => {
    assert.equal(insideUpdater, false);
    navigationCalls.push({ type: 'reset', payload });
  };

  const internalModules = new Map();
  function resolveInternalModule(fromRelativePath, name) {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '@react-native-community/datetimepicker') return nativePicker;
    if (name === '../components/BirthDateInput' || name === '../../components/BirthDateInput') return { __esModule: true, default: 'BirthDateInput' };
    if (name === '../components/ScreenContainer' || name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../context/AuthContext' || name === '../../context/AuthContext') {
      return {
        AuthContext: AuthContextToken,
        useAuth: () => authContextValue,
      };
    }
    if (name === '../utils/birthDate' || name === '../../utils/birthDate') return birthDate;
    if (name === '../../utils/profile') {
      return loadModule('utils/profile.js', (dependency) =>
        dependency === './birthDate' ? birthDate : require(dependency)).exports;
    }
    if (name === '../utils/validation' || name === '../../utils/validation') return validation;
    if (name === '../data/mockData' || name === '../../data/mockData') return data;
    if (name.startsWith('.') && /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(name)) {
      return { uri: name };
    }
    if (name.startsWith('.')) {
      const fromDir = path.dirname(path.join(appDirectory, fromRelativePath));
      let resolvedAbs = path.resolve(fromDir, name);
      if (!resolvedAbs.endsWith('.js')) {
        const asFile = `${resolvedAbs}.js`;
        try {
          readFileSync(asFile);
          resolvedAbs = asFile;
        } catch {
          resolvedAbs = path.join(resolvedAbs, 'index.js');
        }
      }
      const targetRelative = path.relative(appDirectory, resolvedAbs);
      if (internalModules.has(targetRelative)) {
        return internalModules.get(targetRelative);
      }
      const loaded = loadModule(targetRelative, (dep) => resolveInternalModule(targetRelative, dep)).exports;
      internalModules.set(targetRelative, loaded);
      return loaded;
    }
    return require(name);
  }

  const screen = loadModule(
    relativePath,
    (name) => resolveInternalModule(relativePath, name),
    options.fields || [],
    options.source
  );

  let renderedNodes = [];

  function render() {
    cursor = 0;
    tree = screen.exports.default({ navigation, route: {}, ...props });
    renderedNodes = nodes(tree);
    capture = screen.context.__capture;
  }

  function flush() {
    let iterations = 0;
    while (queue.length || effects.length) {
      assert.ok(iterations++ < 30, 'render/effect loop');
      while (queue.length) {
        const [index, update] = queue.shift();
        const previous = freeze(state[index]);
        if (typeof update === 'function') {
          insideUpdater = true;
          try {
            const first = update(previous);
            const second = update(previous);
            assert.equal(JSON.stringify(first), JSON.stringify(second), 'repeatable updater');
            state[index] = freeze(second);
          } finally { insideUpdater = false; }
        } else state[index] = freeze(update);
      }
      render();
      for (const item of effects.splice(0)) {
        const { index, callback } = item;
        if (typeof cleanups[index] === 'function') {
          cleanups[index]();
        }
        const cleanup = callback();
        cleanups[index] = typeof cleanup === 'function' ? cleanup : null;
      }
    }
  }

  render();
  flush();
  return {
    get capture() { return capture; },
    get nodes() { return renderedNodes; },
    exports: screen.exports,
    birthDate,
    navigationCalls,
    nativePickerCalls,
    act(callback) { callback(capture); flush(); },
    async actAsync(callback) {
      await callback(capture);
      flush();
    },
    unmount() {
      for (let i = 0; i < cleanups.length; i++) {
        if (typeof cleanups[i] === 'function') {
          cleanups[i]();
          cleanups[i] = null;
        }
      }
      tree = null;
      renderedNodes = [];
    },
    setAuthContext(nextAuthContext) {
      authContextValue = nextAuthContext;
      render();
      flush();
    },
    setProps(nextProps) { props = { ...props, ...nextProps }; render(); flush(); },
    setFocused(value) {
      focused = value;
      for (const listener of navigationListeners.get(value ? 'focus' : 'blur') || []) listener();
      flush();
    },
    inputBirthDate(value) {
      const input = renderedNodes.find((node) => node.type === 'BirthDateInput');
      assert.ok(input);
      input.props.onChangeText(value);
    },
    press(label) {
      const button = renderedNodes.find((node) => node.type === 'Pressable' &&
        (node.props.accessibilityLabel === label || textOf(node) === label));
      assert.ok(button, `missing button: ${label}`);
      assert.notEqual(button.props.disabled, true);
      const wrapper = renderedNodes.find((node) =>
        typeof node.type === 'function' &&
        typeof node.props?.onPress === 'function' &&
        !node.props?.disabled &&
        !node.props?.loading &&
        (node.props.accessibilityLabel === label || node.props.title === label || textOf(node) === label)
      );
      if (wrapper) {
        return wrapper.props.onPress();
      }
      return button.props.onPress();
    },
  };
}

module.exports = { createHarness, loadModule, nodes, textOf };
