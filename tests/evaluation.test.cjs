const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

function evaluationScreen() {
  const state = [];
  const events = [];
  let cursor = 0;
  let tree;
  const native = Object.fromEntries(
    ['Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name])
  );
  native.StyleSheet = { create: (styles) => styles };
  const screen = loadModule('screens/EvaluationScreen.js', (name) => {
    if (name === 'react') return {
      useContext: () => ({
        setParticipation: (value) => events.push({ type: 'participation', value }),
      }),
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (update) => {
          state[index] = typeof update === 'function' ? update(state[index]) : update;
        }];
      },
    };
    if (name === 'react-native') return native;
    if (name === '../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../context/ParticipationContext') return { ParticipationContext: {} };
    return require(name);
  }, ['setRating']);
  screen.context.console = {
    log: (...args) => events.push({ type: 'log', args: structuredClone(args) }),
  };
  const navigation = {
    reset: (payload) => events.push({ type: 'reset', payload: structuredClone(payload) }),
  };

  function render() {
    cursor = 0;
    tree = screen.exports.default({ navigation });
  }

  function button(label) {
    const found = nodes(tree).find((node) => node.type === 'Pressable' &&
      (node.props.accessibilityLabel === label || textOf(node) === label));
    assert.ok(found, `missing button: ${label}`);
    return found;
  }

  render();
  return {
    events,
    button,
    get stars() {
      return nodes(tree).filter((node) => node.type === 'Pressable' &&
        node.props.accessibilityRole === 'radio');
    },
    get input() { return nodes(tree).find((node) => node.type === 'TextInput'); },
    press(label) {
      const target = button(label);
      assert.notEqual(target.props.disabled, true);
      target.props.onPress();
      render();
    },
    setRating(value) {
      screen.context.__capture.setRating(value);
      render();
    },
    changeComment(value) {
      this.input.props.onChangeText(value);
      render();
    },
  };
}

const returnToMain = [
  { type: 'participation', value: null },
  { type: 'reset', payload: { index: 0, routes: [{ name: 'MainTabs' }] } },
];

function expectedSubmission(rating, comment) {
  return [
    {
      type: 'log',
      args: ['Envio simulado da avaliação (dados não persistidos):', { rating, comment }],
    },
    ...returnToMain,
  ];
}

test('evaluation starts empty with submission disabled and a guarded submit handler', () => {
  const h = evaluationScreen();
  const submit = h.button('Enviar avaliação');
  assert.equal(h.input.props.value, '');
  assert.equal(h.stars.map(textOf).join(''), '☆☆☆☆☆');
  assert.equal(submit.props.disabled, true);
  assert.equal(submit.props.accessibilityState.disabled, true);
  assert.equal(typeof submit.props.onPress, 'function');
  submit.props.onPress();
  assert.deepEqual(h.events, []);
});

test('selecting a lower rating updates stars and preserves the controlled comment', () => {
  const h = evaluationScreen();
  h.press('4 estrelas');
  assert.equal(h.stars.map(textOf).join(''), '★★★★☆');
  assert.equal(h.button('Enviar avaliação').props.disabled, false);
  assert.equal(h.button('Enviar avaliação').props.accessibilityState.disabled, false);
  h.changeComment('Minha experiência');
  h.press('2 estrelas');
  assert.equal(h.stars.map(textOf).join(''), '★★☆☆☆');
  assert.deepEqual(h.stars.map((star) => star.props.accessibilityState.selected),
    [false, true, false, false, false]);
  assert.equal(h.input.props.value, 'Minha experiência');
  assert.deepEqual(h.events, []);
});

test('invalid ratings do not log, clear participation, or navigate', () => {
  for (const rating of [0, -1, 6, 1.5, 4.9, '3', '', null, undefined, NaN,
    Infinity, -Infinity, true, false, {}, [], 2n]) {
    const h = evaluationScreen();
    h.setRating(rating);
    h.changeComment('Comentário não enviado');
    h.button('Enviar avaliação').props.onPress();
    assert.deepEqual(h.events, [], `unexpected side effect for rating ${String(rating)}`);
    assert.equal(h.input.props.value, 'Comentário não enviado');
  }
});

test('each valid rating logs the simulated payload before clearing and returning to MainTabs', () => {
  for (const rating of [1, 2, 3, 4, 5]) {
    const h = evaluationScreen();
    h.press(`${rating} ${rating === 1 ? 'estrela' : 'estrelas'}`);
    h.press('Enviar avaliação');
    assert.deepEqual(h.events, expectedSubmission(rating, ''));
  }
});

test('submission trims comment edges, accepts blank comments, and preserves internal whitespace', () => {
  const cases = [
    ['', ''],
    [' \t\n  ', ''],
    ['  Gostei muito! \n', 'Gostei muito!'],
    [' \tUma  experiência\ncom\t espaço interno  ', 'Uma  experiência\ncom\t espaço interno'],
  ];
  for (const [comment, expectedComment] of cases) {
    const h = evaluationScreen();
    h.press('5 estrelas');
    h.changeComment(comment);
    h.press('Enviar avaliação');
    assert.deepEqual(h.events, expectedSubmission(5, expectedComment));
  }
});

test('skipping returns without logging an evaluation, with or without a rating', () => {
  for (const rating of [0, 3]) {
    const h = evaluationScreen();
    if (rating) h.press('3 estrelas');
    h.changeComment('Comentário não enviado');
    h.press('Pular avaliação');
    assert.deepEqual(h.events, returnToMain);
  }
});
