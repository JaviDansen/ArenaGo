const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule, nodes, textOf, createParticipantUiStubs, createParticipantThemeStub } = require('./helpers/questionnaireHarness.cjs');
const ID = '22222222-2222-4222-8222-222222222222';
const item = {
  participationId: ID, event: { id: '11111111-1111-4111-8111-111111111111', name: 'Arena com um nome extenso que deve continuar legível' },
  status: 'finished', joinedAt: '2026-11-17T10:42:05Z', arenaEnteredAt: '2026-11-17T11:00:00Z',
  finishedAt: '2026-11-23T02:53:00Z', finishReason: 'voluntary', completedServicesCount: 7,
  evaluation: { eligible: true, submitted: true, pending: false },
};
function harness(historyItem = item, get = async () => ({ evaluation: {
  id: '33333333-3333-4333-8333-333333333333', participationId: ID, rating: 4, comment: null,
} })) {
  let currentState, effect;
  const calls = [];
  const service = loadModule('services/participationHistoryService.js', require).exports;
  const participation = loadModule('utils/participation.js', require).exports;
  const module = loadModule('screens/participation/ParticipationRealDetailsScreen.js', name => {
    if (name === 'react') return {
      useContext: () => ({ isAuthenticated: true, user: { id: 'A' }, httpClient: { get }, getSessionEpoch: () => 1 }),
      useEffect: fn => { effect = fn; },
      useState: initial => { if (currentState === undefined) currentState = initial; return [currentState, next => { currentState = next; }]; },
    };
    if (name === 'react-native') return { ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: s => s } };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../context/AuthContext') return { AuthContext: {} };
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../services/participationHistoryService') return service;
    if (name === '../../utils/participation') return participation;
    return require(name);
  }).exports;
  const render = () => {
    const tree = module.default({ route: { params: { historyItem, participationId: ID } },
      navigation: { goBack: () => calls.push('back'), navigate: (...args) => calls.push(args) } });
    const all = nodes(tree);
    return { all, texts: all.filter(n => n.type === 'Text').map(textOf),
      text: value => all.find(n => n.type === 'Text' && textOf(n) === value),
      byId: id => all.find(n => n.props?.testID === id),
      press: label => all.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label).props.onPress() };
  };
  return { render, calls, module, start: () => effect() };
}

test('05A: detalhes reais e indisponíveis oferecem retorno pela pilha atual', () => {
  // goBack preserva a origem: não substitui Home ou Eventos por uma rota fixa.
  for (const value of [item, null]) {
    const h = harness(value), view = h.render();
    assert.ok(view.text('Detalhes da participação'));
    view.press('Voltar'); assert.deepEqual(h.calls, ['back']);
    if (!value) assert.ok(view.texts.includes('DETALHES INDISPONÍVEIS'));
  }
});

test('05A: duração longa, contagem, datas completas e nome real não são ajustados para a captura', () => {
  const h = harness(), view = h.render();
  assert.ok(view.text(item.event.name));
  assert.ok(view.text('135h 53min'));
  assert.ok(view.text('7'));
  for (const instant of [item.joinedAt, item.arenaEnteredAt, item.finishedAt]) {
    const value = h.module.dateText(instant);
    assert.ok(view.texts.some(t => t.includes(value)));
    assert.match(value, /2026/); assert.match(value, /• \d{2}:\d{2}$/);
    assert.doesNotMatch(value, /:\d{2}:\d{2}/);
  }
  assert.notEqual(h.module.dateText(item.joinedAt), h.module.dateText(item.finishedAt));
  assert.ok(view.text('Horários no fuso do dispositivo.'));
  assert.ok(view.text('Saída voluntária'));
  assert.equal(view.text('finished'), undefined); assert.equal(view.text('voluntary'), undefined);
});

test('05A: todos os estados e motivos reais têm apresentação em português e fallback neutro', () => {
  const h = harness();
  for (const [status, label] of Object.entries({ finished: 'FINALIZADA', active: 'ATIVA', waiting: 'AGUARDANDO', canceled: 'CANCELADA' })) {
    const view = harness({ ...item, status }).render();
    assert.ok(view.text(`PARTICIPAÇÃO ${label}`));
    if (status === 'canceled') assert.equal(view.text('PARTICIPAÇÃO NA FILA'), undefined);
  }
  for (const reason of ['voluntary', 'external_wait_withdrawal', 'staff_external_wait_removed', 'external_absence_after_entry_cutoff',
    'admin_immediate', 'admin_controlled_external_wait_closed', 'automatic_operational_deadline', 'automatic_admin_deadline']) {
    assert.notEqual(h.module.finishReasonText(reason), reason);
    assert.notEqual(h.module.finishReasonText(reason), 'Motivo não informado');
  }
  assert.equal(h.module.finishReasonText('unknown'), 'Motivo não informado');
  assert.equal(h.module.participationStatusText('unknown'), 'Não informada');
});

test('05A: consulta real mantém carregamento, quatro estrelas e comentário opcional somente leitura', async () => {
  for (const comment of [null, 'Experiência muito boa']) {
    let resolve;
    const requests = [];
    const h = harness(item, (url, options) => { requests.push([url, options]); return new Promise(r => { resolve = r; }); });
    h.render(); h.start();
    assert.ok(h.render().text('Carregando avaliação...'));
    assert.equal(h.render().byId('participation-rating'), undefined);
    resolve({ evaluation: { id: '33333333-3333-4333-8333-333333333333', participationId: ID, rating: 4, comment } });
    await new Promise(r => setImmediate(r));
    const view = h.render();
    assert.deepEqual(structuredClone(requests), [[`/participations/${ID}/evaluation`, { auth: true }]]);
    assert.ok(view.text('4 de 5 estrelas'));
    for (let star = 1; star <= 5; star++) {
      const node = view.byId(`participation-star-${star}-${star <= 4 ? 'filled' : 'empty'}`);
      assert.ok(node); assert.equal(textOf(node), star <= 4 ? '★' : '☆'); assert.equal(node.props.onPress, undefined);
    }
    assert.ok(view.text('Avaliação registrada'));
    if (comment) assert.ok(view.text(comment));
    assert.equal(view.all.some(n => n.props?.title === 'Avaliar evento'), false);
  }
});

test('05A: falha de consulta não apresenta nota fictícia', async () => {
  const h = harness(item, async () => { throw new Error('offline'); });
  h.render(); h.start(); await new Promise(r => setImmediate(r));
  const view = h.render();
  assert.ok(view.text('Não foi possível carregar a avaliação registrada.'));
  assert.equal(view.byId('participation-rating'), undefined);
});

test('05A: pendência navega com a participação original; ausência de avaliação não oferece ação', () => {
  const pending = { ...item, evaluation: { eligible: true, submitted: false, pending: true } };
  const h = harness(pending), view = h.render(); view.press('Avaliar este evento');
  assert.equal(h.calls[0][0], 'RealEvaluation'); assert.equal(h.calls[0][1].participationId, ID);
  assert.equal(h.calls[0][1].historyItem, pending);
  const none = harness({ ...item, evaluation: { eligible: false, submitted: false, pending: false } }).render();
  assert.ok(none.text('Nenhuma avaliação pendente para esta participação.'));
  assert.equal(none.byId('participation-rating'), undefined);
});

test('05A: somente a rota de detalhes troca o header nativo pelo header do design system', () => {
  const source = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  assert.match(source, /name: 'ParticipationDetails',[\s\S]*?headerShown: false/);
  for (const origin of ['home/HomeScreen.js', 'participation/ParticipationsRealScreen.js']) {
    const body = fs.readFileSync(path.join(__dirname, '../screens', origin), 'utf8');
    assert.match(body, /ParticipationDetails/);
  }
});
