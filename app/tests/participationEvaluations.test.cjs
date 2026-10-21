const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const participationUtils = loadModule('utils/participation.js', require).exports;
const evaluationUtils = loadModule('utils/evaluation.js', require).exports;
const { exports: mockData } = loadModule('data/mockData.js', require);
const { EVALUATION_SITUATIONS: SITUATIONS } = evaluationUtils;

const reactNative = {
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles) => styles },
  Text: 'Text',
  View: 'View',
};

// Expande componentes de função (DetailRow, EvaluationSection...) para ler o que a tela exibe.
function renderTree(element) {
  if (element == null || typeof element === 'boolean') return element;
  if (Array.isArray(element)) return element.map(renderTree);
  if (typeof element !== 'object' || !element.props) return element;
  if (typeof element.type === 'function') return renderTree(element.type(element.props));
  return { ...element, props: { ...element.props, children: renderTree(element.props.children) } };
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

const texts = (element) => nodes(element).filter((node) => node.type === 'Text').map(textOf);

function requireStub(data) {
  return (name) => {
    if (name === 'react-native') return reactNative;
    if (name === '../components/ParticipationCard') return { __esModule: true, default: 'ParticipationCard' };
    if (name === '../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../data/mockData') return data;
    if (name === '../utils/participation') return participationUtils;
    if (name === '../utils/evaluation') return evaluationUtils;
    return require(name);
  };
}

function renderEventsScreen(participations, evaluations) {
  const screen = loadModule('screens/EventsScreen.js', requireStub({ mockParticipations: participations, mockEvaluations: evaluations }));
  const navigationCalls = [];
  const navigation = { navigate: (name, params) => navigationCalls.push({ name, params: { ...params } }) };
  const rendered = screen.exports.default({ navigation });
  const list = nodes(rendered).find((node) => node.type === 'FlatList');
  return { list, navigationCalls };
}

function pendingCards(list) {
  return nodes(list.props.ListHeaderComponent).filter((node) => node.type === 'ParticipationCard');
}

function renderDetails(participations, evaluations, participationId) {
  const screen = loadModule(
    'screens/ParticipationDetailsScreen.js',
    requireStub({ mockParticipations: participations, mockEvaluations: evaluations }),
  );
  return texts(renderTree(screen.exports.default({ route: { params: { participationId } } })));
}

function evaluationTexts(detailTexts) {
  const start = detailTexts.indexOf('Avaliação');
  return start === -1 ? [] : detailTexts.slice(start);
}

function renderCard(participation, evaluationSituation) {
  const card = loadModule('components/ParticipationCard.js', requireStub({}));
  return texts(card.exports.default({ participation, evaluationSituation, onPress: () => {} }));
}

const event = Object.freeze({ id: 'event-1', name: 'BEAST Arena — Teste', location: 'Teste' });
const base = Object.freeze({
  event,
  enteredAt: '2026-09-28T15:10:00-03:00',
  exitedAt: '2026-09-28T16:52:00-03:00',
  experiences: [],
});
const finished = (id, evaluation) => Object.freeze({ ...base, id, status: 'finished', evaluation });

const pending = finished('participation-pending', { eligible: true, submitted: false, pending: true });
const evaluated = finished('participation-evaluated', { eligible: true, submitted: true, pending: false });
const evaluatedWithoutComment = finished('participation-no-comment', { eligible: true, submitted: true, pending: false });
const expired = finished('participation-expired', { eligible: true, submitted: false, pending: false });
const notEligible = finished('participation-not-eligible', { eligible: false, submitted: false, pending: false });
const ongoing = Object.freeze({
  ...base,
  id: 'participation-ongoing',
  status: 'active',
  exitedAt: null,
  // Mesmo que dados incoerentes digam "pendente", em andamento nunca é pendente.
  evaluation: { eligible: true, submitted: false, pending: true },
});
const evaluations = Object.freeze([
  Object.freeze({ id: 'evaluation-1', participationId: 'participation-evaluated', rating: 5, comment: 'Muito bom' }),
  Object.freeze({ id: 'evaluation-2', participationId: 'participation-no-comment', rating: 3, comment: null }),
]);
const all = [ongoing, pending, evaluated, evaluatedWithoutComment, expired, notEligible];
const pendingIds = (participations) => [...evaluationUtils.getPendingEvaluationParticipations(participations)].map((item) => item.id);

test('1. participation with a pending evaluation is identified, listed and explained', () => {
  assert.equal(evaluationUtils.getEvaluationSituation(pending), SITUATIONS.PENDING);
  assert.deepEqual(pendingIds(all), ['participation-pending']);
  assert.deepEqual(renderCard(pending, SITUATIONS.PENDING).at(-1), 'Avaliação pendente');
  assert.deepEqual(evaluationTexts(renderDetails(all, evaluations, pending.id)), [
    'Avaliação',
    'Esta participação ainda não foi avaliada.',
  ]);
});

test('2. evaluated participation shows the registered rating', () => {
  assert.equal(evaluationUtils.getEvaluationSituation(evaluated), SITUATIONS.EVALUATED);
  assert.equal(renderCard(evaluated, SITUATIONS.EVALUATED).at(-1), 'Avaliada');
  assert.deepEqual(evaluationTexts(renderDetails(all, evaluations, evaluated.id)), [
    'Avaliação',
    'Nota', '5 de 5',
    'Comentário', 'Muito bom',
  ]);
  assert.equal(pendingIds([evaluated]).length, 0);
});

test('3. evaluation comment is shown when present and never invented when absent', () => {
  assert.deepEqual(evaluationTexts(renderDetails(all, evaluations, evaluatedWithoutComment.id)), [
    'Avaliação',
    'Nota', '3 de 5',
  ]);
  for (const comment of [undefined, null, '', '   ', 42, { text: 'x' }]) {
    const record = { id: 'evaluation-x', participationId: 'participation-x', rating: 4, comment };
    assert.deepEqual({ ...evaluationUtils.findEvaluationByParticipationId([record], 'participation-x') }, { rating: 4, comment: null }, String(comment));
    const evaluatedWithComment = finished('participation-x', { eligible: true, submitted: true, pending: false });
    assert.deepEqual(evaluationTexts(renderDetails([evaluatedWithComment], [record], evaluatedWithComment.id)), [
      'Avaliação', 'Nota', '4 de 5',
    ], String(comment));
  }
  const withoutCommentProperty = { id: 'evaluation-y', participationId: 'participation-y', rating: 2 };
  assert.equal(evaluationUtils.findEvaluationByParticipationId([withoutCommentProperty], 'participation-y').comment, null);
});

test('4. participation whose first-evaluation deadline ended', () => {
  assert.equal(evaluationUtils.getEvaluationSituation(expired), SITUATIONS.EXPIRED);
  assert.equal(renderCard(expired, SITUATIONS.EXPIRED).at(-1), 'Prazo de avaliação encerrado');
  assert.deepEqual(evaluationTexts(renderDetails(all, evaluations, expired.id)), [
    'Avaliação',
    'O prazo para a primeira avaliação desta participação terminou.',
  ]);
  assert.equal(pendingIds([expired]).length, 0);
});

test('5. participation still in progress is never shown as pending', () => {
  for (const status of ['waiting', 'active']) {
    const current = { ...ongoing, status };
    assert.equal(evaluationUtils.getEvaluationSituation(current), SITUATIONS.NOT_FINISHED, status);
    assert.equal(pendingIds([current]).length, 0, status);
  }
  assert.equal(renderCard(ongoing, SITUATIONS.NOT_FINISHED).at(-1), 'Em andamento · avaliação indisponível');
  assert.deepEqual(evaluationTexts(renderDetails(all, evaluations, ongoing.id)), [
    'Avaliação',
    'A participação ainda não foi finalizada. Não há avaliação disponível.',
  ]);
  const ongoingWithRecord = [...evaluations, { id: 'evaluation-z', participationId: ongoing.id, rating: 5, comment: 'x' }];
  assert.equal(evaluationTexts(renderDetails(all, ongoingWithRecord, ongoing.id)).includes('Nota'), false);
});

test('6. two participations of the same event keep independent situations', () => {
  const mocks = mockData.mockParticipations;
  const sameEvent = mocks.filter((participation) => participation.event.id === 'beast-arena-shopping-da-ilha');
  const situations = Object.fromEntries(sameEvent.map((participation) => [participation.id, evaluationUtils.getEvaluationSituation(participation)]));
  assert.equal(situations['participation-003'], SITUATIONS.EVALUATED);
  assert.equal(situations['participation-005'], SITUATIONS.PENDING);
  assert.deepEqual(pendingIds(mocks), ['participation-005']);

  const evaluatedTexts = evaluationTexts(renderDetails(mocks, mockData.mockEvaluations, 'participation-003'));
  const pendingTexts = evaluationTexts(renderDetails(mocks, mockData.mockEvaluations, 'participation-005'));
  assert.deepEqual(evaluatedTexts, ['Avaliação', 'Nota', '5 de 5', 'Comentário', 'Muito divertido!']);
  assert.deepEqual(pendingTexts, ['Avaliação', 'Esta participação ainda não foi avaliada.']);

  const sameEventPending = finished('participation-pending-2', { eligible: true, submitted: false, pending: true });
  assert.deepEqual(pendingIds([pending, sameEventPending]), ['participation-pending', 'participation-pending-2']);
});

test('7. no pending evaluations shows the empty state, and no participations keeps the Task 1 message', () => {
  const { list } = renderEventsScreen([evaluated, expired, ongoing], evaluations);
  assert.equal(pendingCards(list).length, 0);
  assert.ok(texts(list.props.ListHeaderComponent).includes('Você não possui avaliações pendentes.'));

  const empty = renderEventsScreen([], []).list;
  assert.equal(empty.props.ListHeaderComponent, null);
  assert.equal(textOf(empty.props.ListEmptyComponent), 'Você ainda não possui participações em eventos.');
});

test('8. evaluations are associated by their own participationId', () => {
  const { findEvaluationByParticipationId } = evaluationUtils;
  assert.deepEqual({ ...findEvaluationByParticipationId(evaluations, 'participation-evaluated') }, { rating: 5, comment: 'Muito bom' });
  assert.equal(findEvaluationByParticipationId(evaluations, 'participation-pending'), null);
  assert.equal(findEvaluationByParticipationId(evaluations, event.id), null);

  const inherited = Object.create({ participationId: 'participation-pending' });
  inherited.rating = 4;
  assert.equal(findEvaluationByParticipationId([inherited], 'participation-pending'), null);

  const duplicated = [...evaluations, { id: 'evaluation-3', participationId: 'participation-evaluated', rating: 1, comment: null }];
  assert.equal(findEvaluationByParticipationId(duplicated, 'participation-evaluated'), null);
  assert.deepEqual(evaluationTexts(renderDetails(all, duplicated, evaluated.id)), [
    'Avaliação',
    'Esta participação foi avaliada, mas os detalhes da avaliação estão indisponíveis.',
  ]);

  for (const id of [undefined, null, '', 3, {}]) {
    assert.equal(findEvaluationByParticipationId(evaluations, id), null, String(id));
  }
});

test('9. incomplete or invalid evaluation information never breaks rendering', () => {
  const { getEvaluationSituation, findEvaluationByParticipationId } = evaluationUtils;
  const unavailable = [
    null,
    undefined,
    'participation',
    { ...pending, id: '' },
    { ...base, id: 'sem-status', evaluation: { eligible: true, submitted: false, pending: true } },
    { ...pending, status: 'desconhecido' },
    { ...base, id: 'sem-projecao', status: 'finished' },
    { ...pending, evaluation: null },
  ];
  for (const participation of unavailable) {
    assert.equal(getEvaluationSituation(participation), SITUATIONS.UNAVAILABLE, JSON.stringify(participation));
  }
  const inheritedStatus = Object.create({ status: 'finished', evaluation: { eligible: true, submitted: false, pending: true } });
  inheritedStatus.id = 'participation-inherited';
  assert.equal(getEvaluationSituation(inheritedStatus), SITUATIONS.UNAVAILABLE);

  const invalid = [
    finished('incompleta', { eligible: true, submitted: false }),
    finished('tipos', { eligible: 'true', submitted: false, pending: true }),
    finished('enviada-e-pendente', { eligible: true, submitted: true, pending: true }),
    finished('pendente-sem-elegibilidade', { eligible: false, submitted: false, pending: true }),
    finished('enviada-sem-elegibilidade', { eligible: false, submitted: true, pending: false }),
    { ...expired, id: 'cancelada-elegivel', status: 'canceled' },
    finished('herdada', Object.create({ eligible: true, submitted: false, pending: true })),
  ];
  for (const participation of invalid) {
    assert.equal(getEvaluationSituation(participation), SITUATIONS.INVALID, participation.id);
  }
  assert.equal(getEvaluationSituation({ ...notEligible, status: 'canceled' }), SITUATIONS.NOT_ELIGIBLE);

  for (const rating of [0, 6, 4.5, '5', null, NaN]) {
    assert.equal(findEvaluationByParticipationId([{ id: 'e', participationId: 'p', rating }], 'p'), null, String(rating));
  }
  for (const list of [null, undefined, {}, 'x', [null, undefined, 1, 'x']]) {
    assert.equal(findEvaluationByParticipationId(list, 'p'), null);
    assert.deepEqual(pendingIds(list), []);
  }

  // Avaliada pela projeção, mas sem registro válido: não exibe nota inventada.
  assert.deepEqual(evaluationTexts(renderDetails([evaluated], [], evaluated.id)), [
    'Avaliação',
    'Esta participação foi avaliada, mas os detalhes da avaliação estão indisponíveis.',
  ]);
  // Sem informação de avaliação: a seção não aparece e a tela continua renderizando.
  const withoutInfo = { ...base, id: 'sem-informacao' };
  const detail = renderDetails([withoutInfo], evaluations, withoutInfo.id);
  assert.equal(detail[0], 'BEAST Arena — Teste');
  assert.deepEqual(evaluationTexts(detail), []);
  assert.equal(renderCard(withoutInfo, getEvaluationSituation(withoutInfo)).length, 3);
  assert.deepEqual(renderDetails(all, evaluations, 'participation-999'), ['Participação não encontrada.']);
});

test('10. Eventos navigation is preserved and pending items open their own participation', () => {
  const sameIdAgain = { ...pending };
  const sameEventPending = finished('participation-pending-2', { eligible: true, submitted: false, pending: true });
  const { list, navigationCalls } = renderEventsScreen([pending, sameIdAgain, sameEventPending, evaluated], evaluations);

  const cards = pendingCards(list);
  assert.deepEqual(cards.map((card) => card.props.participation.id), ['participation-pending', 'participation-pending-2']);
  cards.forEach((card) => card.props.onPress());
  list.props.renderItem({ item: evaluated }).props.onPress();
  assert.deepEqual(navigationCalls, [
    { name: 'ParticipationDetails', params: { participationId: 'participation-pending' } },
    { name: 'ParticipationDetails', params: { participationId: 'participation-pending-2' } },
    { name: 'ParticipationDetails', params: { participationId: 'participation-evaluated' } },
  ]);
  assert.equal(list.props.renderItem({ item: evaluated }).props.evaluationSituation, SITUATIONS.EVALUATED);
  assert.equal(list.props.renderItem({ item: ongoing }).props.evaluationSituation, SITUATIONS.NOT_FINISHED);
  assert.equal(list.props.data.length, 3);
});

test('Eventos list and card render identifiable records with incomplete optional fields safely', () => {
  const missingEvent = { id: 'participation-no-event', event: null, status: 'finished', enteredAt: null, exitedAt: null };
  const missingName = { id: 'participation-no-name', event: {}, status: 'finished', enteredAt: 'invalid', exitedAt: null };
  const valid = { ...pending };
  const invalidIds = [null, undefined, {}, { id: null }, { id: '' }, { id: '   ' }, { id: 7 }];
  const { list, navigationCalls } = renderEventsScreen([
    ...invalidIds, missingEvent, missingName, valid, { ...valid },
  ], evaluations);

  assert.deepEqual(list.props.data.map((item) => item.id), [missingEvent.id, missingName.id, valid.id]);
  assert.deepEqual(list.props.data.map((item) => list.props.keyExtractor(item)), [missingEvent.id, missingName.id, valid.id]);
  assert.deepEqual(pendingCards(list).map((card) => card.props.participation.id), [valid.id]);
  for (const item of list.props.data) {
    const cardProps = list.props.renderItem({ item }).props;
    const cardTexts = renderCard(cardProps.participation, cardProps.evaluationSituation);
    assert.equal(cardTexts[0], item === valid ? event.name : 'Evento indisponível');
    cardProps.onPress();
  }
  assert.deepEqual(navigationCalls.map((call) => call.params.participationId), [missingEvent.id, missingName.id, valid.id]);
  assert.equal(renderCard(null, SITUATIONS.PENDING).length, 0);
  assert.equal(renderCard({ event }, SITUATIONS.PENDING).length, 0);
  assert.deepEqual(renderCard(missingEvent, SITUATIONS.UNAVAILABLE), ['Evento indisponível', 'Permanência não registrada']);
});

test('submitted projection remains evaluated when its detail record is absent, invalid or ambiguous', () => {
  const missing = [];
  const invalidRating = [{ id: 'invalid-rating', participationId: evaluated.id, rating: 6, comment: 'Não exibir' }];
  const duplicated = [
    { id: 'first', participationId: evaluated.id, rating: 5, comment: 'Não exibir' },
    { id: 'second', participationId: evaluated.id, rating: 1, comment: 'Também não exibir' },
  ];
  for (const records of [missing, invalidRating, duplicated]) {
    assert.equal(evaluationUtils.getEvaluationSituation(evaluated), SITUATIONS.EVALUATED);
    assert.equal(renderCard(evaluated, SITUATIONS.EVALUATED).at(-1), 'Avaliada');
    assert.deepEqual(evaluationTexts(renderDetails([evaluated], records, evaluated.id)), [
      'Avaliação', 'Esta participação foi avaliada, mas os detalhes da avaliação estão indisponíveis.',
    ]);
  }
});

test('mocks show every situation consistently and link evaluations by participationId', () => {
  const participations = mockData.mockParticipations;
  const records = mockData.mockEvaluations;
  const situations = participations.map((participation) => evaluationUtils.getEvaluationSituation(participation));
  for (const situation of [SITUATIONS.PENDING, SITUATIONS.EVALUATED, SITUATIONS.EXPIRED, SITUATIONS.NOT_FINISHED]) {
    assert.ok(situations.includes(situation), situation);
  }
  assert.equal(situations.includes(SITUATIONS.INVALID), false);

  const linked = records.map((record) => record.participationId);
  assert.equal(new Set(linked).size, linked.length);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  for (const record of records) {
    const participation = participationUtils.findParticipationById(participations, record.participationId);
    assert.ok(participation, record.participationId);
    assert.equal(evaluationUtils.getEvaluationSituation(participation), SITUATIONS.EVALUATED, record.participationId);
    assert.ok(Number.isInteger(record.rating) && record.rating >= 1 && record.rating <= 5, record.id);
  }
  for (const participation of participations.filter((item) => evaluationUtils.getEvaluationSituation(item) === SITUATIONS.EVALUATED)) {
    assert.ok(evaluationUtils.findEvaluationByParticipationId(records, participation.id), participation.id);
    assert.equal('rating' in participation || 'comment' in participation, false, participation.id);
  }
  for (const participation of participations) {
    assert.equal(participation.completedServicesCount, participation.experiences.length, participation.id);
    const evaluation = participation.evaluation;
    if (!evaluation) continue;
    assert.equal(participation.status, 'finished', participation.id);
    assert.equal(evaluation.eligible, participation.completedServicesCount > 0, participation.id);
    if (!evaluation.eligible) {
      assert.equal(evaluation.submitted, false, participation.id);
      assert.equal(evaluation.pending, false, participation.id);
      assert.equal(evaluationUtils.findEvaluationByParticipationId(records, participation.id), null, participation.id);
    }
  }
  const comments = records.map((record) => evaluationUtils.findEvaluationByParticipationId(records, record.participationId).comment);
  assert.ok(comments.includes(null));
  assert.ok(comments.some((comment) => typeof comment === 'string'));
});

test('Eventos history stays separate from the current participation context', () => {
  for (const file of ['screens/EventsScreen.js', 'screens/ParticipationDetailsScreen.js', 'utils/evaluation.js', 'components/ParticipationCard.js']) {
    const source = readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(source.includes('ParticipationContext'), false, file);
  }
});
