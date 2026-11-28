// PARTICIPANTE-02A — aprimoramento visual da fila virtual (RealArenaScreen).
// Somente apresentação: os testes conferem que tudo exibido vem do estado do servidor e que
// as ações existentes continuam presentes e ligadas aos mesmos handlers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, createParticipantUiStubs, createParticipantThemeStub, nodes, textOf } = require('./helpers/questionnaireHarness.cjs');

const presentation = loadModule('utils/arenaQueuePresentation.js', require).exports;

const USER = '20000000-0000-4000-8000-000000000001';
const EVENT = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const PARTICIPATION = 'c79b25f1-b171-487f-9fee-a24d184054b5';
const EXP_A = '60000000-0000-4000-8000-00000000000a';
const EXP_B = '60000000-0000-4000-8000-00000000000b';
const EXP_C = '60000000-0000-4000-8000-00000000000c';

const experiences = (overrides = {}) => [
  { id: EXP_A, name: 'Street Fighter', waitingCount: 1, acceptingNewQueueEntries: true },
  { id: EXP_B, name: 'PS5 VR', waitingCount: 0, acceptingNewQueueEntries: true },
  { id: EXP_C, name: 'Simulador de corrida', waitingCount: 2, acceptingNewQueueEntries: false },
].map((item) => ({ ...item, ...(overrides[item.id] || {}) }));

const waitingEntry = (position = 1, extra = {}) => ({
  id: '50000000-0000-4000-8000-000000000004', experienceId: EXP_A, experienceName: 'Street Fighter',
  status: 'waiting', position, stationLabel: null, serviceSessionId: null, ...extra,
});

const arena = (extra = {}) => ({ acceptingNewQueueEntries: true, experiences: experiences(), currentQueueEntry: null, pendingIntent: null, ...extra });

/**
 * Renderiza a tela real com o mesmo harness dos testes existentes (autoQueueSync).
 * Ordem dos `useState` da tela: state, busy, loading, error, notice, syncStale, finished, readError.
 */
function render(arenaState, { notice = null, syncStale = false, busy = false, readError = null, eventName = 'Evento oficial', eventNameError = false } = {}) {
  const values = [arenaState, busy, false, null, notice, syncStale, false, readError, { key: `${USER}:1:${PARTICIPATION}:${EVENT}`, name: eventName, error: eventNameError }];
  const calls = { participation: 0, alerts: [] };
  let index = 0;
  const screen = loadModule('screens/arena/RealArenaScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (value) => ({ current: value }),
        useEffect: (effect) => effect(),
        useMemo: (factory) => factory(),
        useCallback: (fn) => fn,
        useState(initial) { const i = index++; return [i < values.length ? values[i] : initial, () => {}]; },
      };
    }
    if (name === '@react-navigation/native') return { useFocusEffect: () => {} };
    if (name === 'expo-crypto') return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
    if (name === 'react-native') {
      return {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image',
        Alert: { alert: (...args) => { calls.alerts.push(args); } },
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        ScrollView: 'ScrollView', StyleSheet: { create: (s) => s }, Text: 'Text', View: 'View', Vibration: { vibrate() {} },
      };
    }
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../context/AuthContext') {
      return { useAuth: () => ({ isAuthenticated: true, user: { id: USER }, httpClient: {}, getSessionEpoch: () => 1 }) };
    }
    if (name === '../../services/arenaQueueService') {
      return { createArenaQueueCoordinator: () => ({ read: async () => arenaState, join: async () => ({}) }), describeArenaError: () => 'erro' };
    }
    if (name === '../../services/arenaQueueIntentStorage') return { defaultArenaQueueIntentStorage: {} };
    if (name === '../../services/participationActionService') {
      return { createParticipationActionCoordinator: () => ({ finish: async () => {} }), describeParticipationActionError: () => 'erro' };
    }
    if (name === '../../services/participationHistoryService') return { fetchCurrentArenaEventName: async () => eventName, fetchPendingEvaluationHistoryItem: async () => null };
    if (name === '../../services/queueAlertService') return { createQueueAlertManager: () => ({ checkAndAlert: () => false, reset: () => {} }) };
    return require(name);
  }).exports.default;
  const refreshParticipation = async () => { calls.participation += 1; };
  const tree = screen({ participation: { id: PARTICIPATION, eventId: EVENT }, refreshParticipation });
  const all = nodes(tree);
  const texts = all.filter((n) => n.type === 'Text').map(textOf);
  return {
    all, texts, calls, refreshParticipation,
    has: (text) => texts.some((t) => t.includes(text)) || all.some(n => n.props?.testID === 'arena-position-text' && textOf(n).includes(text)),
    exact: (text) => all.find((n) => n.type === 'Text' && textOf(n) === text),
    button: (title) => all.find((n) => n.props?.title === title && typeof n.type === 'function'),
    buttons: (title) => all.filter((n) => n.props?.title === title && typeof n.type === 'function'),
    byTestID: (id) => all.find((n) => n.props?.testID === id),
    icons: () => all.filter((n) => n.props?.iconName).map((n) => n.props.iconName),
  };
}

const flatStyle = (style) => (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatStyle)) : style || {});

test('02A-01: plural e posição usam só os números do servidor', () => {
  assert.equal(presentation.formatWaitingCount(0), '0 pessoas aguardando');
  assert.equal(presentation.formatWaitingCount(1), '1 pessoa aguardando');
  assert.equal(presentation.formatWaitingCount(2), '2 pessoas aguardando');
  assert.equal(presentation.formatWaitingCount(-1), null);
  assert.equal(presentation.formatWaitingCount(1.5), null);
  assert.equal(presentation.formatQueuePosition(1), '1º');
  assert.equal(presentation.formatQueuePosition(1234), '1234º');
  assert.equal(presentation.formatQueuePosition(0), null);
  assert.equal(presentation.formatExperienceCount(1), '1 experiência');
  assert.equal(presentation.formatExperienceCount(3), '3 experiências');
});

test('02A-02 (§10 ativo sem fila): experiências, entrada e ações continuam disponíveis', () => {
  const h = render(arena());
  assert.equal(h.byTestID('arena-queue-entry-card'), undefined, 'sem card de fila');
  const header = h.byTestID('arena-header');
  assert.ok(header, 'cabeçalho do evento corrente');
  assert.ok(nodes(header).some(n => n.type === 'Text' && textOf(n) === 'Evento oficial'));
  const active = nodes(header).find(n => n.props?.label === 'ATIVA');
  assert.equal(active, undefined, 'selo ATIVA removido apenas da apresentação');
  const logo = h.byTestID('arena-header-logo');
  assert.equal(logo.type, 'Image');
  assert.equal(logo.props.resizeMode, 'contain');
  assert.equal(logo.props.accessibilityLabel, 'ArenaGO');
  assert.ok(h.exact('3 experiências'));
  for (const name of ['Street Fighter', 'PS5 VR', 'Simulador de corrida']) assert.ok(h.exact(name), name);
  // Ordem preservada (a do servidor).
  const order = h.texts.filter((t) => ['Street Fighter', 'PS5 VR', 'Simulador de corrida'].includes(t));
  assert.deepEqual(order, ['Street Fighter', 'PS5 VR', 'Simulador de corrida']);
  const joins = h.buttons('Entrar na fila');
  assert.equal(joins.length, 2, 'só as experiências abertas oferecem entrada');
  assert.ok(joins.every((b) => b.props.disabled === false && typeof b.props.onPress === 'function'));
  assert.equal(h.button('Atualizar fila e experiências'), undefined);
  assert.equal(h.button('Atualizar situação da participação'), undefined);
  assert.ok(h.button('Sair da Arena'));
  assert.equal(h.button('Sair da Arena').props.disabled, false);
});

test('02A-03 (§10 aguardando): card da fila com a posição do servidor em destaque', () => {
  const h = render(arena({ currentQueueEntry: waitingEntry(1) }));
  const card = h.byTestID('arena-queue-entry-card');
  assert.ok(card);
  assert.ok(h.exact('NA FILA') && h.exact('Você está na fila'));
  assert.ok(h.texts.filter((t) => t === 'Street Fighter').length >= 1, 'nome da experiência');
  assert.ok(h.has('Posição 1º'), 'rótulo e ordinal continuam compondo a posição oficial');
  const panel = h.byTestID('arena-queue-position');
  assert.equal(panel.props.accessibilityLabel, 'Posição na fila: 1º');
  const number = h.exact('1º');
  assert.ok(number, 'número em texto próprio');
  const style = flatStyle(number.props.style);
  assert.ok(style.fontSize >= 32 && style.fontWeight === '800', 'posição compacta mantém destaque tipográfico');
  const others = h.all.filter((n) => n.type === 'Text' && n !== number)
    .map((n) => flatStyle(n.props.style).fontSize).filter((size) => typeof size === 'number');
  assert.ok(others.every((size) => size < style.fontSize), 'nenhum outro texto com tipografia maior');
  assert.ok(h.has('A posição e a chamada são atualizadas automaticamente a cada 5 segundos.'));
  assert.ok(h.icons().includes('queue') && h.icons().includes('refresh'));
  // A experiência da entrada atual é marcada e ninguém pode entrar em outra fila.
  assert.ok(h.exact('SUA FILA'));
  assert.equal(h.buttons('Entrar na fila').length, 0);
});

test('02A-04 (§10 posição alterada): a nova posição recebida é apresentada', () => {
  assert.ok(render(arena({ currentQueueEntry: waitingEntry(3) })).has('Posição 3º'));
  const after = render(arena({ currentQueueEntry: waitingEntry(2) }));
  assert.ok(after.has('Posição 2º'));
  assert.equal(after.has('Posição 3º'), false);
});

test('02A-05 (§10 chamado): estado de espera substituído pela chamada, sem posição', () => {
  const h = render(arena({ currentQueueEntry: waitingEntry(1, { status: 'called', position: null, stationLabel: 'Estação 2', serviceSessionId: '70000000-0000-4000-8000-000000000007' }) }));
  assert.ok(h.exact('SUA VEZ') && h.exact('É a sua vez!'));
  assert.ok(h.exact('Dirija-se à estação'));
  assert.ok(h.exact('Estação 2'));
  assert.equal(h.byTestID('arena-queue-station').props.accessibilityLabel, 'Dirija-se à estação: Estação 2');
  assert.ok(h.exact('O Staff está aguardando você.'));
  assert.ok(h.exact('Apresente-se ao Staff para iniciar sua experiência.'));
  assert.ok(h.exact('CHAMADO'));
  assert.equal(h.exact('SUA FILA'), undefined);
  assert.ok(h.icons().includes('bell') && h.icons().includes('location'));
  assert.equal(flatStyle(h.byTestID('arena-queue-entry-card').props.style).borderColor, '#A855F7');
  assert.equal(flatStyle(h.byTestID('arena-queue-entry-card').props.style).backgroundColor, '#191326');
  assert.equal(h.byTestID('arena-queue-position'), undefined);
  assert.equal(h.texts.some((t) => /Posição|NA FILA|Você está na fila/.test(t)), false);
  assert.ok(h.byTestID('arena-queue-station'));
  assert.equal(h.has('atualizadas automaticamente a cada 5 segundos'), false);
});

test('02A-06 (§10 abertas e encerradas): indicadores coerentes com o servidor', () => {
  const h = render(arena());
  const card = (id) => nodes(h.byTestID(`arena-experience-${id}`)).filter((n) => n.type === 'Text').map(textOf);
  assert.ok(card(EXP_A).includes('ABERTA') && card(EXP_A).includes('Recebendo entradas') && card(EXP_A).includes('1 pessoa aguardando'));
  assert.ok(card(EXP_B).includes('0 pessoas aguardando'));
  assert.ok(card(EXP_C).includes('ENCERRADA') && card(EXP_C).includes('Entrada na fila encerrada') && card(EXP_C).includes('2 pessoas aguardando'));
  assert.equal(nodes(h.byTestID(`arena-experience-${EXP_C}`)).some((n) => n.props?.title === 'Entrar na fila'), false);
  // Entradas globalmente encerradas: nenhuma experiência aparece como aberta.
  const closed = render(arena({ acceptingNewQueueEntries: false }));
  assert.equal(closed.texts.filter((t) => t === 'ABERTA').length, 0);
  assert.equal(closed.texts.filter((t) => t === 'ENCERRADA').length, 3);
  assert.equal(closed.buttons('Entrar na fila').length, 0);
  assert.equal(h.texts.some((t) => t.includes('pessoa(s)')), false);
});

test('02A-07 (§10 conexão instável): a posição exibida é identificada como a última confirmada', () => {
  const h = render(arena({ currentQueueEntry: waitingEntry(4) }), { syncStale: true });
  assert.ok(h.has('Conexão instável. Exibindo as últimas informações confirmadas.'));
  assert.ok(h.has('Última posição confirmada 4º'));
  assert.equal(h.has('Posição 4º'), false, 'posição antiga não parece recém-confirmada');
  assert.equal(h.byTestID('arena-queue-position').props.accessibilityLabel, 'Última posição confirmada na fila: 4º');
  assert.ok(h.has('Exibindo as últimas informações confirmadas; reconectando automaticamente'));
  assert.equal(h.has('atualizadas automaticamente a cada 5 segundos'), false);
});

test('02A-08 (§10 tentativa pendente): recuperação preservada e ações bloqueadas como antes', () => {
  const h = render(arena({ pendingIntent: { participationId: PARTICIPATION, experienceId: EXP_A } }));
  assert.ok(h.exact('TENTATIVA PENDENTE'));
  const repeat = h.button('Conferir / repetir a mesma tentativa');
  assert.ok(repeat && repeat.props.disabled === false && typeof repeat.props.onPress === 'function');
  assert.equal(h.buttons('Entrar na fila').length, 0);
  assert.equal(h.button('Sair da Arena').props.disabled, true);
  const other = render(arena({ pendingIntent: { participationId: '99999999-9999-4999-8999-999999999999', experienceId: EXP_A } }));
  assert.ok(other.has('Há uma solicitação pendente de outra participação nesta conta.'));
  assert.equal(other.button('Conferir / repetir a mesma tentativa'), undefined);
});

test('02A-09 (§10 atualização manual e saída): ações ligadas aos mesmos handlers', async () => {
  const h = render(arena({ currentQueueEntry: waitingEntry(1) }));
  assert.equal(h.button('Atualizar situação da participação'), undefined);
  assert.equal(h.button('Atualizar fila e experiências'), undefined);
  const failed = render(arena(), { syncStale: true });
  const retry = failed.button('Tentar novamente');
  assert.ok(retry && retry.props.disabled === false && typeof retry.props.onPress === 'function');
  const leave = h.button('Sair da Arena');
  assert.equal(leave.props.disabled, false);
  leave.props.onPress();
  assert.equal(h.calls.alerts.length, 1);
  assert.equal(h.calls.alerts[0][0], 'Deseja sair da Arena?');
});

test('02A-10 (§10 nome longo e posição extensa): posição e nomes completos sem truncamento', () => {
  const longName = 'Experiência de realidade virtual com nome muito longo para testar o layout da Arena';
  const h = render(arena({
    currentQueueEntry: waitingEntry(1234, { experienceName: longName }),
    experiences: experiences({ [EXP_A]: { name: longName } }),
  }));
  const number = h.exact('1234º');
  assert.ok(number && number.props.numberOfLines === undefined, 'posição nunca é truncada');
  const names = h.all.filter((n) => n.type === 'Text' && textOf(n) === longName);
  assert.equal(names.length, 2);
  assert.ok(names.every((n) => n.props.numberOfLines === undefined));
});

test('02A-11 (§6.2): aviso de entrada confirmada é compacto, com indicador de sucesso, e só aparece com o aviso real', () => {
  const h = render(arena({ currentQueueEntry: waitingEntry(1) }), { notice: 'Entrada na fila confirmada pelo servidor.' });
  const row = h.byTestID('arena-queue-notice');
  assert.ok(row);
  assert.ok(nodes(row).some((n) => n.props?.iconName === 'check'));
  assert.ok(nodes(row).some((n) => n.type === 'Text' && textOf(n) === 'Entrada na fila confirmada pelo servidor.'));
  assert.equal(render(arena({ currentQueueEntry: waitingEntry(1) })).byTestID('arena-queue-notice'), undefined);
});

test('02A-12 (§6.6/§6.7): sem contadores fictícios, sem emojis e só ícones existentes', () => {
  const lineIcon = loadModule('components/ui/LineIcon.js', (name) => (name === 'react-native'
    ? { StyleSheet: { create: (s) => s }, View: 'View' } : require(name))).exports;
  assert.ok(lineIcon.LINE_ICON_NAMES.includes('check'));
  assert.ok(lineIcon.LineIcon({ name: 'check', color: '#00E676', size: 14 }), 'desenho de sucesso existe');
  for (const h of [render(arena()), render(arena({ currentQueueEntry: waitingEntry(2) }), { notice: 'Entrada na fila confirmada pelo servidor.', syncStale: true })]) {
    assert.equal(h.texts.some((t) => /conclu[ií]d/i.test(t)), false, 'sem "Concluídas"');
    assert.equal(h.texts.some((t) => /\p{Extended_Pictographic}/u.test(t)), false, 'sem emojis');
    assert.ok(h.icons().every((icon) => lineIcon.LINE_ICON_NAMES.includes(icon)), 'ícones do LineIcon');
  }
});

test('02A-R01: cabeçalho local, cards compactos e recuperação com menor ênfase', () => {
  const noQueue = render(arena());
  assert.ok(noQueue.byTestID('arena-header'));
  assert.equal(noQueue.button('Atualizar fila e experiências'), undefined);
  assert.equal(noQueue.button('Atualizar situação da participação'), undefined);
  assert.equal(noQueue.button('Sair da Arena').props.variant, 'dangerOutline');
  assert.ok(noQueue.buttons('Entrar na fila').every(b => b.props.size === 'sm'));
  const waiting = render(arena({ currentQueueEntry: waitingEntry(2) }));
  assert.ok(flatStyle(waiting.byTestID(`arena-experience-${EXP_A}`).props.style).paddingVertical < 12);
  assert.ok(waiting.exact('SUA FILA'));
  assert.equal(waiting.exact('Recebendo entradas'), undefined, 'disponibilidade não é repetida durante espera');
});

test('02A-R01 visual: posição usa Texts irmãos com métricas independentes para um e múltiplos dígitos', () => {
  for (const position of [1, 12, 1234]) {
    const h = render(arena({ currentQueueEntry: waitingEntry(position) }));
    const line = h.byTestID('arena-position-text');
    assert.equal(line.type, 'View', 'não herdar métricas de linha de um Text pai');
    const children = line.props.children.filter(Boolean);
    assert.equal(children.length, 2);
    assert.ok(children.every(child => child.type === 'Text'));
    assert.equal(textOf(children[0]), 'Posição ');
    assert.equal(textOf(children[1]), `${position}º`);
    assert.ok(children.every(child => child.props.numberOfLines === undefined));
    assert.equal(flatStyle(children[1].props.style).lineHeight, undefined, 'fonte nativa calcula a altura própria');
    assert.equal(h.byTestID('arena-queue-position').props.accessibilityLabel, `Posição na fila: ${position}º`);
  }
});

test('02A-R01 visual: superfícies violeta, ícones de jogo/fila e rolagem limitada ao viewport', () => {
  const h = render(arena({ currentQueueEntry: waitingEntry(1) }));
  assert.equal(flatStyle(h.byTestID('arena-queue-entry-card').props.style).backgroundColor, '#191326');
  assert.equal(flatStyle(h.byTestID('arena-queue-position').props.style).backgroundColor, '#503078');
  const queue = nodes(h.byTestID('arena-queue-entry-card'));
  assert.equal(queue.filter(n => n.props?.iconName === 'queue').length, 1, 'sem ícone duplicado no canto');
  assert.ok(h.icons().includes('gamepad'));
  assert.equal(h.icons().includes('flag'), false);
  const scroll = h.all.find(n => n.type === 'ScrollView');
  assert.equal(flatStyle(scroll.props.style).flex, 1);
  assert.ok(flatStyle(scroll.props.contentContainerStyle).paddingBottom >= 24);
  assert.equal(h.button('Atualizar fila e experiências'), undefined);
  assert.equal(typeof h.button('Sair da Arena').props.onPress, 'function');
});
