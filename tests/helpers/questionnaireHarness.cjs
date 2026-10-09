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
  const context = { module, exports: module.exports, require: requireModule, Date };
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
  return [element, ...nodes(element.props.children)];
}

function textOf(element) {
  if (element == null || typeof element === 'boolean') return '';
  if (Array.isArray(element)) return element.map(textOf).join('');
  if (typeof element !== 'object') return String(element);
  return textOf(element.props?.children);
}

function createHarness(relativePath, options = {}) {
  const state = [];
  const queue = [];
  const effects = [];
  const navigationCalls = [];
  let cursor = 0;
  let insideUpdater = false;
  let capture;
  let tree;
  let props = options.props || {};

  const react = {
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
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = state[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        state[index] = dependencies;
        effects.push(callback);
      }
    },
  };
  const native = Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView',
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
    navigate(name, params) { assert.equal(insideUpdater, false); navigationCalls.push({ type: 'navigate', name, params }); },
    goBack() { assert.equal(insideUpdater, false); navigationCalls.push({ type: 'back' }); },
    replace(name) { assert.equal(insideUpdater, false); navigationCalls.push({ type: 'replace', name }); },
  };
  if (!options.fallbackNavigation) navigation.reset = (payload) => {
    assert.equal(insideUpdater, false);
    navigationCalls.push({ type: 'reset', payload });
  };
  const screen = loadModule(relativePath, (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '@react-native-community/datetimepicker') return nativePicker;
    if (name === '../components/BirthDateInput') return { __esModule: true, default: 'BirthDateInput' };
    if (name === '../utils/birthDate') return birthDate;
    if (name === '../utils/validation') return validation;
    if (name === '../data/mockData') return data;
    return require(name);
  }, options.fields || [], options.source);

  function render() {
    cursor = 0;
    tree = screen.exports.default({ navigation, route: {}, ...props });
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
      for (const effect of effects.splice(0)) effect();
    }
  }

  render();
  flush();
  return {
    get capture() { return capture; },
    get nodes() { return nodes(tree); },
    exports: screen.exports,
    birthDate,
    navigationCalls,
    nativePickerCalls,
    act(callback) { callback(capture); flush(); },
    setProps(nextProps) { props = { ...props, ...nextProps }; render(); flush(); },
    inputBirthDate(value) {
      const input = nodes(tree).find((node) => node.type === 'BirthDateInput');
      assert.ok(input);
      input.props.onChangeText(value);
    },
    press(label) {
      const button = nodes(tree).find((node) => node.type === 'Pressable' &&
        (node.props.accessibilityLabel === label || textOf(node) === label));
      assert.ok(button, `missing button: ${label}`);
      assert.notEqual(button.props.disabled, true);
      button.props.onPress();
    },
  };
}

module.exports = { createHarness, nodes, textOf };
