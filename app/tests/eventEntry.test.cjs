const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadModule, nodes, textOf, createParticipantUiStubs, createParticipantThemeStub,
} = require('./helpers/questionnaireHarness.cjs');

const event = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Arena real', timezone: 'America/Sao_Paulo',
  startsAt: '2026-11-08T10:00:00.000Z', officialEndsAt: '2026-11-08T20:00:00.000Z',
  operationalDeadlineAt: '2026-11-08T21:00:00.000Z', externalQueueEnabled: true,
};
const eligible = { eligible: true, blockingReasons: [] };
// R01: a confirmação só considera a elegibilidade publicada pelo store (consulta/revalidação oficial).
const official = (eligibility = eligible, extra = {}) => ({
  status: 'ready', event, eligibility, eligibilityStatus: 'fresh', pendingIntent: null,
  recovery: { status: 'idle', message: null }, error: null, ...extra,
});

function screenRig(path, context, params = {}, options = {}) {
  const state = [], calls = [], cleanups = [];
  const baseUi = createParticipantUiStubs();
  const ui = {
    ...baseUi,
    Card: ({ children, onPress, disabled, accessibilityRole, accessibilityLabel, accessibilityHint, testID, ...props }) => {
      if (onPress) {
        return {
          type: 'Pressable',
          props: {
            ...props,
            onPress: disabled ? undefined : onPress,
            disabled,
            accessibilityRole: accessibilityRole || props.accessibilityRole || 'button',
            accessibilityLabel,
            accessibilityHint,
            testID,
            children,
          },
        };
      }
      return baseUi.Card({ children, disabled, accessibilityRole, accessibilityLabel, accessibilityHint, testID, ...props });
    },
  };

  let cursor = 0, tree;
  let settingsOpened = 0;

  const react = {
    useContext: () => context,
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(effect) {
      const cleanup = effect?.();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
  };

  const module = loadModule(path, (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView', AppState: options.appState,
      Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { create: (styles) => styles, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
      Linking: {
        openSettings: async () => { settingsOpened++; return true; },
      },
    };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === 'expo-camera') return {
      CameraView: (props) => ({ type: 'CameraView', props }),
      useCameraPermissions: () => [
        options.cameraPermission !== undefined ? options.cameraPermission : { granted: true, canAskAgain: true },
        options.requestPermission ?? (async () => ({ granted: true })),
      ],
    };
    if (name === '@react-navigation/native') return {
      useIsFocused: () => (options.isFocused !== undefined ? options.isFocused : true),
    };
    if (name === '../../components/ui') return ui;
    if (name === '../../theme') return createParticipantThemeStub();
    if (name === '../../components/ScreenContainer') return { __esModule: true, default: 'ScreenContainer' };
    if (name === '../../context/ParticipationContext') return { ParticipationContext: {} };
    return require(name);
  }).exports;

  function render() {
    cursor = 0;
    tree = module.default({
      route: { params },
      navigation: {
        navigate: (name, value) => calls.push({ name, value }),
        reset: (value) => calls.push({ reset: value }),
        goBack: () => calls.push({ back: true }),
      },
    });
  }

  function button(label) {
    let result = nodes(tree).find((node) => node.type === 'Pressable' && (
      textOf(node) === label ||
      node.props?.accessibilityLabel === label ||
      (typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(label)) ||
      (label === 'Ler QR Code' && node.props?.testID === 'event-entry-choose-qr') ||
      (label === 'Digitar código' && node.props?.testID === 'event-entry-choose-manual')
    ));
    // Para manter compatibilidade com testes manuais legados que buscavam diretamente 'Continuar'
    if (!result && (label === 'Continuar' || label === 'Consultando...')) {
      const manualCard = nodes(tree).find((node) => node.props?.testID === 'event-entry-choose-manual');
      if (manualCard) {
        manualCard.props.onPress();
        render();
        result = nodes(tree).find((node) => node.type === 'Pressable' && textOf(node) === label);
      }
    }
    assert.ok(result, `Botão ou card ausente: ${label}`);
    return result;
  }

  render();
  return {
    calls,
    render,
    button,
    findButton: (label) => nodes(tree).find((node) => node.type === 'Pressable' && (
      textOf(node) === label ||
      node.props?.accessibilityLabel === label ||
      (typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(label)) ||
      (label === 'Ler QR Code' && node.props?.testID === 'event-entry-choose-qr') ||
      (label === 'Digitar código' && node.props?.testID === 'event-entry-choose-manual')
    )),
    card: (testID) => nodes(tree).find((node) => node.props?.testID === testID),
    text: () => nodes(tree).map(textOf).join(' '),
    inputError: () => nodes(tree).find((node) => node.type === ui.InputField)?.props.error,
    input(value) {
      let textInput = nodes(tree).find((node) => node.type === 'TextInput');
      if (!textInput) {
        const manualCard = nodes(tree).find((node) => node.props?.testID === 'event-entry-choose-manual');
        if (manualCard) {
          manualCard.props.onPress();
          render();
          textInput = nodes(tree).find((node) => node.type === 'TextInput');
        }
      }
      assert.ok(textInput, 'Campo de texto não encontrado');
      textInput.props.onChangeText(value);
      render();
    },
    camera: () => nodes(tree).find((node) => node.type === 'CameraView'),
    reticle: () => nodes(tree).find((node) => node.props?.testID === 'event-entry-scanner-reticle'),
    async simulateScan(data) {
      const cam = nodes(tree).find((node) => node.type === 'CameraView');
      assert.ok(cam, 'Câmera não está montada na tela');
      const handler = cam.props.onBarcodeScanned;
      if (typeof handler === 'function') {
        await handler({ data });
        render();
      }
    },
    setFocused(focused) {
      options.isFocused = focused;
      render();
    },
    unmount() {
      while (cleanups.length) {
        const fn = cleanups.pop();
        fn?.();
      }
    },
    getSettingsOpenedCount: () => settingsOpened,
    exports: module,
  };
}

// -------------------------------------------------------------
// Testes preexistentes do fluxo manual e confirmação
// -------------------------------------------------------------

test('consulta real envia o código sem mudar sua caixa e navega somente após resposta válida', async () => {
  const requests = [];
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => true,
    lookupEvent: async (code) => { requests.push(code); return { kind: 'found', event, eligibility: eligible }; },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  rig.input('  AbC-42  ');
  await rig.button('Continuar').props.onPress();
  assert.deepEqual(requests, ['AbC-42']);
  assert.deepEqual(structuredClone(rig.calls), [{ name: 'EventConfirmation', value: { event, eligibility: eligible } }]);
});

test('código vazio não consulta o backend nem navega', async () => {
  let count = 0;
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => true,
    lookupEvent: async () => { count++; return { kind: 'error', message: 'Evento inexistente' }; },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  await rig.button('Continuar').props.onPress();
  assert.equal(count, 0);
  rig.render();
  assert.equal(rig.inputError(), 'Digite o código do evento.');
  assert.deepEqual(rig.calls, []);
});

test('consulta inexistente e resposta tardia após logout não navegam', async () => {
  let resolve, current = true;
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => current,
    lookupEvent: () => new Promise((done) => { resolve = done; }),
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  rig.input('ABC');
  const pending = rig.button('Continuar').props.onPress();
  current = false;
  resolve({ kind: 'found', event, eligibility: eligible });
  await pending;
  assert.deepEqual(rig.calls, []);
  context.lookupEvent = async () => ({ kind: 'error', message: 'Evento inexistente' });
  rig.render();
  await rig.button('Continuar').props.onPress();
  assert.deepEqual(rig.calls, []);
});

test('ineligibilidade mostra motivo real e impede POST', async () => {
  let count = 0;
  const context = {
    admission: official({ eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] }), isCurrentAdmission: () => true,
    confirmEventEntry: async () => { count++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event, eligibility: { eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] } });
  // PARTICIPANTE-01: o motivo real aparece traduzido, sem o código técnico.
  assert.match(rig.text(), /Complete o questionário de perfil antes de entrar no evento/);
  assert.doesNotMatch(rig.text(), /PROFILE_INCOMPLETE/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Confirmar entrada').props.onPress?.();
  assert.equal(count, 0);
  assert.deepEqual(rig.calls, []);
});

test('ingresso confirmado navega uma vez; toque duplo não duplica POST', async () => {
  let resolve, count = 0;
  const context = {
    admission: official(), isCurrentAdmission: () => true,
    confirmEventEntry: () => { count++; return new Promise((done) => { resolve = done; }); },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  const button = rig.button('Confirmar entrada');
  const first = button.props.onPress();
  await button.props.onPress();
  assert.equal(count, 1);
  resolve({ kind: 'complete' });
  await first;
  assert.deepEqual(structuredClone(rig.calls), [{ reset: { index: 0, routes: [{ name: 'MainTabs' }] } }]);
  assert.doesNotMatch(rig.text(), /Demonstração|queuePosition|Local A/);
});

test('ingresso confirmado sem sincronização só repete GET', async () => {
  let posts = 0, reads = 0;
  const context = {
    admission: { ...official(), status: 'confirmed_unsynced', confirmedParticipationId: '22222222-2222-4222-8222-222222222222',
      error: 'Atualize sem repetir o ingresso.' }, isCurrentAdmission: () => true,
    confirmEventEntry: async () => { posts++; return { kind: 'complete' }; },
    retryEntrySync: async () => { reads++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  assert.match(rig.text(), /Atualize sem repetir/);
  await rig.button('Atualizar participação').props.onPress();
  assert.equal(posts, 0);
  assert.equal(reads, 1);
  assert.equal(rig.calls.length, 1);
});

test('erro HTTP na confirmação preserva a tela e informa o problema', async () => {
  const context = {
    admission: official(), isCurrentAdmission: () => true,
    confirmEventEntry: async () => ({ kind: 'error', message: 'Evento encerrado' }),
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  await rig.button('Confirmar entrada').props.onPress();
  assert.deepEqual(rig.calls, []);
  context.admission = official(eligible, { status: 'error', error: 'Evento encerrado' });
  rig.render();
  assert.match(rig.text(), /Evento encerrado/);
});

// -------------------------------------------------------------
// Testes específicos da TASK ENTRY-QR-01
// -------------------------------------------------------------

test('ENTRY-QR-01: tela inicial apresenta as duas opções visíveis e independentes', () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  // Deve exibir o cabeçalho e as duas opções com títulos claros
  assert.match(rig.text(), /Entrar em um evento/);
  assert.match(rig.text(), /Como deseja entrar\?/);
  assert.match(rig.text(), /Ler QR Code/);
  assert.match(rig.text(), /Digitar código/);

  // Ambas as opções devem possuir cards acionáveis
  assert.ok(rig.button('Ler QR Code'));
  assert.ok(rig.button('Digitar código'));
});

test('ENTRY-QR-01: navegação por cada card com apenas uma ação e ausência de botões aninhados', async () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  const cardQr = rig.card('event-entry-choose-qr');
  const cardManual = rig.card('event-entry-choose-manual');

  assert.ok(cardQr, 'Card de QR Code deve existir');
  assert.ok(cardManual, 'Card de código manual deve existir');

  // Cada card é um elemento com acessibilidade e role button
  const isPressableOrHasRole = (node) =>
    node.type === 'Pressable' || node.props?.accessibilityRole === 'button';

  assert.ok(isPressableOrHasRole(cardQr), 'Card QR deve ser acessível como botão');
  assert.ok(isPressableOrHasRole(cardManual), 'Card Manual deve ser acessível como botão');
  assert.equal(cardQr.props.accessibilityHint, 'Toque para abrir o leitor de QR Code');
  assert.equal(cardManual.props.accessibilityHint, 'Toque para abrir a digitação manual de código');

  // Ausência de botões interativos aninhados dentro de cada card
  // O card em si é a única área interativa; seus filhos não podem conter botões/pressables
  const qrInnerPressables = (Array.isArray(cardQr.props?.children) ? cardQr.props.children : [cardQr.props?.children])
    .flatMap(nodes)
    .filter((n) => n.type === 'Pressable' || n.props?.accessibilityRole === 'button');

  const manualInnerPressables = (Array.isArray(cardManual.props?.children) ? cardManual.props.children : [cardManual.props?.children])
    .flatMap(nodes)
    .filter((n) => n.type === 'Pressable' || n.props?.accessibilityRole === 'button');

  assert.equal(qrInnerPressables.length, 0, 'Card de QR Code não deve conter botões ou Pressables aninhados');
  assert.equal(manualInnerPressables.length, 0, 'Card de código manual não deve conter botões ou Pressables aninhados');

  // Card possui indicador visual não interativo
  assert.ok(nodes(cardQr).find((n) => n.props?.testID === 'event-entry-qr-action-indicator'));
  assert.ok(nodes(cardManual).find((n) => n.props?.testID === 'event-entry-manual-action-indicator'));

  // Navegação direta com um único toque no card de QR Code
  await cardQr.props.onPress();
  rig.render();
  assert.match(rig.text(), /Aponte a câmera para o QR Code do evento/);

  // Retorna para a seleção
  await rig.button('Voltar para opções').props.onPress();
  rig.render();
  assert.match(rig.text(), /Como deseja entrar\?/);

  // Navegação direta com um único toque no card de código manual
  const newCardManual = rig.card('event-entry-choose-manual');
  await newCardManual.props.onPress();
  rig.render();
  assert.match(rig.text(), /Digite o código de acesso/);
});

test('ENTRY-QR-01: componente compartilhado Card encaminha accessibilityHint ao Pressable quando interativo', () => {
  const cardModule = loadModule('components/ui/Card.js', (name) => {
    if (name === 'react-native') {
      return {
        Pressable: 'Pressable',
        View: 'View',
        StyleSheet: { create: (s) => s },
      };
    }
    if (name === '../../theme/colors.js') return createParticipantThemeStub().colors;
    if (name === '../../theme/radii.js') return createParticipantThemeStub().radii;
    if (name === '../../theme/spacing.js') return createParticipantThemeStub().spacing;
    return require(name);
  }).exports;

  const { Card } = cardModule;

  // 1. Card interativo com accessibilityHint encaminhado ao Pressable
  const elementWithHint = Card({
    onPress: () => {},
    accessibilityRole: 'button',
    accessibilityLabel: 'Ler QR Code',
    accessibilityHint: 'Toque para abrir o leitor de QR Code',
    children: 'Conteúdo',
  });
  assert.equal(elementWithHint.type, 'Pressable');
  assert.equal(elementWithHint.props.accessibilityHint, 'Toque para abrir o leitor de QR Code');
  assert.equal(elementWithHint.props.accessibilityRole, 'button');
  assert.equal(elementWithHint.props.accessibilityLabel, 'Ler QR Code');

  // 2. Card interativo sem accessibilityHint (permanece undefined sem erro)
  const elementWithoutHint = Card({
    onPress: () => {},
    accessibilityRole: 'button',
    accessibilityLabel: 'Sem dica',
    children: 'Conteúdo',
  });
  assert.equal(elementWithoutHint.type, 'Pressable');
  assert.equal(elementWithoutHint.props.accessibilityHint, undefined);

  // 3. Card estático (não interativo) renderiza View sem erros
  const staticCard = Card({
    children: 'Texto estático',
  });
  assert.equal(staticCard.type, 'View');
});

test('ENTRY-QR-01: selecionar Digitar código exibe formulário manual e permite voltar para seleção', async () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  await rig.button('Digitar código').props.onPress();
  rig.render();

  // Agora exibe o formulário manual
  assert.match(rig.text(), /Digite o código de acesso/);
  assert.ok(rig.button('Continuar'));
  assert.ok(rig.button('Ler QR Code'));
  assert.ok(rig.button('Voltar para opções'));

  // Voltar para opções retorna ao menu de seleção
  await rig.button('Voltar para opções').props.onPress();
  rig.render();
  assert.match(rig.text(), /Como deseja entrar\?/);
});

test('ENTRY-QR-01: selecionar Ler QR Code ativa a câmera com enquadramento e instruções', async () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, {}, {
    cameraPermission: { granted: true, canAskAgain: true },
    isFocused: true,
  });

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  // Verifica elementos da câmera e enquadramento
  assert.match(rig.text(), /Aponte a câmera para o QR Code do evento/);
  assert.ok(rig.camera(), 'CameraView deve estar montada');
  assert.equal(rig.camera().props.facing, 'back', 'Deve utilizar a câmera traseira');
  assert.deepEqual(structuredClone(rig.camera().props.style), { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 });
  assert.equal(rig.card('event-entry-scanner-overlay').props.style.position, 'absolute');
  assert.equal(rig.card('event-entry-scanner-overlay').props.style.bottom, 0);
  assert.deepEqual(structuredClone(rig.camera().props.barcodeScannerSettings), { barcodeTypes: ['qr'] });
  assert.ok(rig.reticle(), 'Retículo de enquadramento deve estar presente');
  assert.ok(rig.button('Digitar código manualmente'));
  assert.ok(rig.button('Voltar para opções'));
});

test('ENTRY-QR-01: permissão de câmera negada exibe aviso e botão para solicitar permissão', async () => {
  let requested = 0;
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, {}, {
    cameraPermission: { granted: false, canAskAgain: true },
    requestPermission: async () => { requested++; return { granted: true }; },
  });

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  assert.match(rig.text(), /Permissão de câmera necessária/);
  assert.equal(rig.camera(), undefined, 'CameraView não deve ser montada sem permissão');

  await rig.button('Permitir acesso à câmera').props.onPress();
  assert.equal(requested, 1);
});

test('ENTRY-QR-01: permissão bloqueada permanentemente orienta a abrir configurações', async () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, {}, {
    cameraPermission: { granted: false, canAskAgain: false },
  });

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  assert.match(rig.text(), /Permissão de câmera bloqueada/);
  assert.match(rig.text(), /habilite o acesso à câmera nas configurações/);

  await rig.button('Abrir configurações').props.onPress();
  assert.equal(rig.getSettingsOpenedCount(), 1);
});

test('ENTRY-QR-01: validação e normalização de QR Code rejeita códigos inválidos ou perigosos', () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);
  const { validateAndNormalizeQrCode } = rig.exports;

  // Códigos válidos
  assert.deepEqual(structuredClone(validateAndNormalizeQrCode('ARENA123')), { ok: true, code: 'ARENA123' });
  assert.deepEqual(structuredClone(validateAndNormalizeQrCode('  AbC-42  ')), { ok: true, code: 'AbC-42' });
  assert.equal(validateAndNormalizeQrCode('EVENT_2026-SP').ok, false);
  assert.equal(validateAndNormalizeQrCode('ABC').ok, false);
  assert.equal(validateAndNormalizeQrCode('ABCD').ok, true);
  assert.equal(validateAndNormalizeQrCode('A'.repeat(64)).ok, true);
  for (const code of ['-ABCD', 'ABCD-', 'AB--CD', 'AB_1', 'ÁBCD']) {
    assert.equal(validateAndNormalizeQrCode(code).ok, false);
  }

  // Rejeição de vazios
  assert.equal(validateAndNormalizeQrCode('').ok, false);
  assert.equal(validateAndNormalizeQrCode('   ').ok, false);
  assert.equal(validateAndNormalizeQrCode(null).ok, false);

  // Rejeição de URLs e esquemas arbitrários
  assert.equal(validateAndNormalizeQrCode('https://malicious.site').ok, false);
  assert.equal(validateAndNormalizeQrCode('http://arenago.com').ok, false);
  assert.equal(validateAndNormalizeQrCode('javascript:alert(1)').ok, false);

  // Rejeição de quebras de linha ou injeções
  assert.equal(validateAndNormalizeQrCode('ARENA\n123').ok, false);
  assert.equal(validateAndNormalizeQrCode('CODE\r\n456').ok, false);

  // Rejeição de código excessivamente longo (> 64 caracteres)
  assert.equal(validateAndNormalizeQrCode('A'.repeat(65)).ok, false);

  // Rejeição de caracteres especiais proibidos
  assert.equal(validateAndNormalizeQrCode('ARENA@123!').ok, false);
  assert.equal(validateAndNormalizeQrCode('ARENA 123').ok, false);
});

test('ENTRY-QR-01: leitura de QR Code executa lookupEvent e navega para EventConfirmation sem confirmar automaticamente', async () => {
  const lookups = [], confirms = [];
  const context = {
    admission: { status: 'idle' },
    isCurrentAdmission: () => true,
    lookupEvent: async (code) => {
      lookups.push(code);
      return { kind: 'found', event, eligibility: eligible };
    },
    confirmEventEntry: async (id) => {
      confirms.push(id);
      return { kind: 'complete' };
    },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  await rig.simulateScan('  ARENA-2026  ');

  // Verifica que lookupEvent foi chamado com o código normalizado
  assert.deepEqual(lookups, ['ARENA-2026']);
  // Não deve confirmar automaticamente a participação
  assert.deepEqual(confirms, []);
  // Navega para EventConfirmation com event e eligibility
  assert.deepEqual(structuredClone(rig.calls), [
    { name: 'EventConfirmation', value: { event, eligibility: eligible } },
  ]);
});

test('ENTRY-QR-01: proteção contra leitura duplicada ignora detecções múltiplas durante consulta em andamento', async () => {
  let resolve;
  const lookups = [];
  const context = {
    admission: { status: 'idle' },
    isCurrentAdmission: () => true,
    lookupEvent: (code) => {
      lookups.push(code);
      return new Promise((done) => { resolve = done; });
    },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  // Dispara primeira leitura
  const scanPromise = rig.simulateScan('ARENA123');

  // Dispara leituras simultâneas/rápidas enquanto a primeira está pendente
  await rig.simulateScan('ARENA123');
  await rig.simulateScan('ARENA123');
  await rig.simulateScan('ARENA456');

  // Apenas uma consulta foi disparada
  assert.equal(lookups.length, 1);

  // Conclui a consulta
  resolve({ kind: 'found', event, eligibility: eligible });
  await scanPromise;

  // Navegou apenas uma vez
  assert.equal(rig.calls.length, 1);
});

test('ENTRY-QR-01: erro na consulta por QR Code exibe mensagem de erro e permite nova leitura', async () => {
  const lookups = [];
  const context = {
    admission: { status: 'idle' },
    isCurrentAdmission: () => true,
    lookupEvent: async (code) => {
      lookups.push(code);
      if (lookups.length === 1) {
        return { kind: 'error', message: 'Código de evento não encontrado.' };
      }
      return { kind: 'found', event, eligibility: eligible };
    },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  // Primeira leitura falha
  await rig.simulateScan('INVALID-CODE');
  assert.match(rig.text(), /Código de evento não encontrado/);
  assert.deepEqual(rig.calls, []);

  // Botão de nova tentativa está disponível
  const retryBtn = rig.button('Escanear novamente');
  assert.ok(retryBtn);

  await retryBtn.props.onPress();
  rig.render();

  // Segunda leitura tem sucesso
  await rig.simulateScan('VALID-CODE');
  assert.equal(lookups.length, 2);
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.calls[0].name, 'EventConfirmation');
});

test('ENTRY-QR-01: resposta tardia após troca de modo ou desmontagem é descartada', async () => {
  let resolve;
  const context = {
    admission: { status: 'idle' },
    isCurrentAdmission: () => true,
    lookupEvent: () => new Promise((done) => { resolve = done; }),
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  await rig.button('Ler QR Code').props.onPress();
  rig.render();

  const pending = rig.simulateScan('ARENA123');

  // Usuário clica para alternar para digitação manual durante a consulta
  await rig.button('Digitar código manualmente').props.onPress();
  rig.render();

  // Resposta da consulta antiga chega
  resolve({ kind: 'found', event, eligibility: eligible });
  await pending;

  // Não deve navegar pois o modo foi alterado
  assert.deepEqual(rig.calls, []);
  assert.match(rig.text(), /Digite o código de acesso/);
});

test('ENTRY-QR-01: comportamento do leitor ao perder e recuperar o foco', async () => {
  const lookups = [];
  const context = {
    admission: { status: 'idle' },
    isCurrentAdmission: () => true,
    lookupEvent: async (code) => {
      lookups.push(code);
      return { kind: 'found', event, eligibility: eligible };
    },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, { initialMethod: 'qr' }, {
    isFocused: true,
  });

  // Em foco: câmera montada e ativa
  assert.ok(rig.camera(), 'CameraView deve estar montada quando em foco');

  // Perde o foco: câmera é desativada
  rig.setFocused(false);
  assert.equal(rig.camera(), undefined, 'CameraView não deve estar montada fora de foco');
  assert.match(rig.text(), /Leitor inativo fora de foco/);

  // Recupera o foco: câmera volta a ficar montada e pronta para nova leitura
  rig.setFocused(true);
  assert.ok(rig.camera(), 'CameraView deve ser remontada ao recuperar o foco');

  // Lê código após recuperar o foco
  await rig.simulateScan('ARENA-RECOVER');
  assert.deepEqual(lookups, ['ARENA-RECOVER']);
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.calls[0].name, 'EventConfirmation');
});

test('ENTRY-QR-01: resposta pendente ao perder o foco não provoca navegação indevida', async () => {
  let resolve;
  const context = {
    admission: { status: 'idle' },
    isCurrentAdmission: () => true,
    lookupEvent: () => new Promise((done) => { resolve = done; }),
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, { initialMethod: 'qr' }, {
    isFocused: true,
  });

  const pending = rig.simulateScan('ARENA-PENDING');

  // A tela perde o foco enquanto a requisição HTTP está em voo
  rig.setFocused(false);

  // A resposta chega tardiamente
  resolve({ kind: 'found', event, eligibility: eligible });
  await pending;

  // Não deve navegar pois a tela estava fora de foco
  assert.deepEqual(rig.calls, []);
});

test('ENTRY-QR-01: consulta manual pendente não navega após perda de foco nem duplica submissões', async () => {
  let resolve, count = 0;
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => true,
    lookupEvent: () => { count++; return new Promise((done) => { resolve = done; }); },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, { initialMethod: 'manual' });
  rig.input('ARENA123');
  const pending = rig.button('Continuar').props.onPress();
  await rig.button('Continuar').props.onPress();
  assert.equal(count, 1);
  rig.setFocused(false);
  resolve({ kind: 'found', event, eligibility: eligible });
  await pending;
  assert.deepEqual(rig.calls, []);
});

test('ENTRY-QR-01: rejeição de leitura antiga não libera consulta QR mais recente', async () => {
  let rejectOld, resolveNew, count = 0;
  const context = {
    admission: { status: 'idle' }, isCurrentAdmission: () => true,
    lookupEvent: () => {
      count++;
      return count === 1 ? new Promise((_, reject) => { rejectOld = reject; }) :
        new Promise((resolve) => { resolveNew = resolve; });
    },
  };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, { initialMethod: 'qr' });
  const oldScan = rig.simulateScan('CODE-OLD');
  await rig.button('Digitar código manualmente').props.onPress();
  rig.render();
  await rig.button('Ler QR Code').props.onPress();
  rig.render();
  const newScan = rig.simulateScan('CODE-NEW');
  rejectOld(new Error('falha tardia'));
  await oldScan;
  await rig.simulateScan('CODE-EXTRA');
  assert.equal(count, 2);
  resolveNew({ kind: 'found', event, eligibility: eligible });
  await newScan;
  assert.equal(rig.calls.length, 1);
});

test('ENTRY-QR-01: HomeScreen exibe texto atualizado com menção a QR Code e digitação manual', () => {
  const calls = [];
  const navigation = { navigate: (name) => calls.push(name) };
  const auth = { user: { name: 'Kaled', hasCompletedQuestionnaire: true } };
  const screen = loadModule('screens/home/HomeScreen.js', (name) => {
    if (name === 'react') return { useContext: () => auth, useState: () => [null, () => {}] };
    if (name === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView',
      Text: 'Text', View: 'View', StyleSheet: { create: (s) => s },
    };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === '../../components/ui') return createParticipantUiStubs();
    if (name === '../../context/AuthContext') return { AuthContext: {} };
    if (name === '../../theme') return createParticipantThemeStub();
    return require(name);
  }).exports.default;

  const tree = screen({ navigation });
  const allText = nodes(tree).map(textOf).join(' ');
  assert.match(
    allText,
    /Escaneie o QR Code ou digite o código de acesso disponibilizado pela equipe do evento para iniciar sua participação\./
  );

  const entryButton = nodes(tree).find((n) => n.type === 'Pressable' && textOf(n) === 'Entrar em um evento');
  assert.ok(entryButton, 'Botão Entrar em um evento deve estar presente');
  entryButton.props.onPress();
  assert.deepEqual(calls, ['EventEntry']);
});

// -------------------------------------------------------------
// PARTICIPANTE-01 — apresentação do evento encontrado
// -------------------------------------------------------------

test('P01-14/22: evento encontrado mostra horários formatados no fuso do evento, sem ISO cru', () => {
  const context = { admission: official(), isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  const text = rig.text();
  assert.match(text, /Arena real/);
  assert.match(text, /ENTRADAS ABERTAS/);
  assert.match(text, /08\/11\/2026/);
  assert.match(text, /07:00/); // 10:00Z em America/Sao_Paulo
  assert.match(text, /17:00/); // término oficial
  assert.match(text, /Horário de Brasília \(America\/Sao_Paulo\)/);
  assert.doesNotMatch(text, /2026-11-08T/);
});

test('P01-19/20: informação da fila externa segue a configuração real do evento', () => {
  const context = { admission: official(), isCurrentAdmission: () => true };
  const withQueue = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  assert.match(withQueue.text(), /Fila de entrada ativa/);
  const direct = { ...event, externalQueueEnabled: false };
  const directRig = screenRig('screens/event-entry/EventConfirmationScreen.js',
    { admission: { ...official(), event: direct }, isCurrentAdmission: () => true }, { event: direct, eligibility: eligible });
  assert.match(directRig.text(), /Entrada direta na Arena/);
});

test('P01-16: evento ainda não iniciado é recusado sem POST e sem usar o relógio do aparelho', async () => {
  let posts = 0;
  const context = {
    admission: official({ eligible: false, blockingReasons: ['EVENT_NOT_STARTED'] }), isCurrentAdmission: () => true,
    confirmEventEntry: async () => { posts++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event, eligibility: { eligible: false, blockingReasons: ['EVENT_NOT_STARTED'] } });
  assert.match(rig.text(), /AINDA NÃO INICIADO/);
  assert.match(rig.text(), /O evento ainda não começou/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Confirmar entrada').props.onPress?.();
  assert.equal(posts, 0);
});

test('P01-18: participação já existente oferece voltar ao início sem criar outra', async () => {
  let posts = 0, refreshes = 0;
  const context = {
    admission: official({ eligible: false, blockingReasons: ['PARTICIPATION_ALREADY_CURRENT'] }), isCurrentAdmission: () => true,
    confirmEventEntry: async () => { posts++; return { kind: 'complete' }; },
    refreshParticipation: async () => { refreshes++; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event, eligibility: { eligible: false, blockingReasons: ['PARTICIPATION_ALREADY_CURRENT'] } });
  assert.match(rig.text(), /Você já está participando de um evento/);
  await rig.button('Voltar ao início').props.onPress();
  assert.equal(posts, 0);
  assert.equal(refreshes, 1);
  assert.deepEqual(structuredClone(rig.calls), [{ reset: { index: 0, routes: [{ name: 'MainTabs' }] } }]);
});

test('P01-17: questionário incompleto leva ao questionário sem tentar o ingresso', async () => {
  let posts = 0;
  const context = {
    admission: official({ eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] }), isCurrentAdmission: () => true,
    confirmEventEntry: async () => { posts++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event, eligibility: { eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] } });
  await rig.button('Completar questionário').props.onPress();
  assert.equal(posts, 0);
  // R01-12: o questionário volta para esta jornada; o parâmetro só define o destino da navegação.
  assert.deepEqual(structuredClone(rig.calls),
    [{ name: 'ProfileQuestionnaire', value: { mode: 'edit', returnTo: 'EventConfirmation' } }]);
});

test('P01-21: resultado incerto oferece verificar o mesmo ingresso, sem nova intenção na tela', async () => {
  const confirmations = [];
  const context = {
    admission: { ...official(), status: 'uncertain', error: 'O tempo de resposta terminou. O resultado pode ter sido confirmado; tente novamente com segurança.' },
    isCurrentAdmission: () => true,
    confirmEventEntry: async (eventId) => { confirmations.push(eventId); return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  assert.match(rig.text(), /O resultado pode ter sido confirmado/);
  await rig.button('Verificar ingresso').props.onPress();
  // A mesma chave persistida é reutilizada pelo store (ver eventAdmissionService.test).
  assert.deepEqual(confirmations, [event.id]);
  assert.deepEqual(structuredClone(rig.calls), [{ reset: { index: 0, routes: [{ name: 'MainTabs' }] } }]);
});


// -------------------------------------------------------------
// PARTICIPANTE-01 R01 — revalidação, recuperação, fila e horários
// -------------------------------------------------------------

function confirmationRig(admission, extra = {}, options = {}) {
  const log = { revalidations: 0, reconciles: 0, posts: 0, refreshes: 0 };
  const context = {
    admission, isCurrentAdmission: () => true,
    confirmEventEntry: async () => { log.posts++; return extra.confirmResult ?? { kind: 'complete' }; },
    retryEntrySync: async () => ({ kind: 'complete' }),
    revalidateEventEntry: async () => { log.revalidations++; return extra.revalidateResult ?? { kind: 'found' }; },
    reconcileEntryIntent: async () => { log.reconciles++; return extra.reconcileResult ?? { kind: 'resolved', outcome: 'none' }; },
    refreshParticipation: async () => { log.refreshes++; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event: admission.event ?? event, eligibility: eligible }, options);
  return { rig, context, log };
}

test('R01-09/10: parâmetros da rota não liberam o ingresso; só a elegibilidade oficial publicada', async () => {
  // Rota diz "elegível", mas o store revalidou e o evento fechou.
  const closed = confirmationRig(official({ eligible: false, blockingReasons: ['EVENT_REGISTRATION_CLOSED'] }));
  assert.match(closed.rig.text(), /ENTRADAS ENCERRADAS/);
  assert.equal(closed.rig.button('Confirmar entrada').props.disabled, true);
  await closed.rig.button('Confirmar entrada').props.onPress?.();
  assert.equal(closed.log.posts, 0);
  // Store sem elegibilidade confirmada (outra operação / sem consulta): nada é liberado.
  const unknown = confirmationRig({ status: 'ready', event, eligibilityStatus: 'none', eligibility: null });
  assert.match(unknown.rig.text(), /SITUAÇÃO NÃO CONFIRMADA/);
  assert.equal(unknown.rig.button('Confirmar entrada').props.disabled, true);
  // Evento abriu após a consulta: a revalidação oficial libera.
  const opened = confirmationRig(official());
  assert.equal(opened.rig.button('Confirmar entrada').props.disabled, false);
});

test('R01-09/23: durante a revalidação a autorização antiga não é apresentada nem usada', async () => {
  const { rig, log } = confirmationRig(official(eligible, { eligibilityStatus: 'revalidating' }));
  assert.match(rig.text(), /ATUALIZANDO SITUAÇÃO/);
  assert.doesNotMatch(rig.text(), /ENTRADAS ABERTAS/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Confirmar entrada').props.onPress?.();
  assert.equal(log.posts, 0);
  assert.equal(rig.button('Atualizando situação...').props.disabled, true);
});

test('R01-11: falha na revalidação mantém o botão bloqueado e oferece atualização manual', async () => {
  const { rig, log } = confirmationRig(official(eligible, {
    eligibilityStatus: 'error', error: 'Não foi possível atualizar a situação do evento. Tente novamente antes de confirmar.' }));
  assert.match(rig.text(), /SITUAÇÃO NÃO CONFIRMADA/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Atualizar situação do evento').props.onPress();
  assert.equal(log.revalidations, 1);
});

test('R01-12/23: retorno de foco e ao primeiro plano revalidam no servidor; a montagem inicial não repete a consulta', async () => {
  let appListener = null, removed = 0;
  const appState = { currentState: 'active', addEventListener(_, listener) {
    appListener = listener; return { remove() { removed++; } }; } };
  const { rig, log } = confirmationRig(official({ eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] }), {}, { appState });
  assert.equal(log.revalidations, 0, 'montagem usa a consulta recém-feita');
  rig.setFocused(false); // abriu o questionário
  assert.equal(log.revalidations, 0);
  rig.setFocused(true); // voltou do questionário
  assert.equal(log.revalidations, 1);
  rig.render();
  assert.equal(log.revalidations, 1, 'sem consultas redundantes por renderização');
  appListener('background');
  appListener('active');
  assert.equal(log.revalidations, 2);
  rig.unmount();
  assert.ok(removed >= 1);
});

test('R01-10: recusa definitiva no POST revalida a apresentação', async () => {
  const { rig, log } = confirmationRig(official(), {
    confirmResult: { kind: 'error', message: 'As entradas neste evento foram encerradas.', revalidate: true } });
  await rig.button('Confirmar entrada').props.onPress();
  assert.equal(log.posts, 1);
  assert.equal(log.revalidations, 1);
  assert.deepEqual(rig.calls, []);
});

test('R01-05/08: tentativa anterior de outro evento bloqueia novo ingresso e oferece verificação sem criar outra', async () => {
  const { rig, log } = confirmationRig(official(eligible, {
    pendingIntent: { eventId: '99999999-9999-4999-8999-999999999999', sameEvent: false, confirmed: false } }), {
    reconcileResult: { kind: 'resolved', outcome: 'historical' } });
  assert.ok(rig.card('event-confirmation-recovery'));
  assert.match(rig.text(), /em outro evento/);
  assert.match(rig.text(), /não cria um novo ingresso/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Confirmar entrada').props.onPress?.();
  assert.equal(log.posts, 0);
  await rig.button('Verificar tentativa anterior').props.onPress();
  assert.equal(log.reconciles, 1);
  assert.equal(log.revalidations, 1, 'após resolver, a elegibilidade é reconsultada');
  assert.deepEqual(rig.calls, []);
});

test('R01-05: mesma tentativa com participação corrente (ALREADY_CURRENT) é recuperada e leva à participação', async () => {
  const { rig, log } = confirmationRig(official({ eligible: false, blockingReasons: ['PARTICIPATION_ALREADY_CURRENT'] }, {
    pendingIntent: { eventId: event.id, sameEvent: true, confirmed: false } }), {
    reconcileResult: { kind: 'resolved', outcome: 'current' } });
  assert.match(rig.text(), /neste evento cujo resultado ainda não foi confirmado/);
  await rig.button('Verificar tentativa anterior').props.onPress();
  assert.equal(log.reconciles, 1);
  assert.equal(log.refreshes, 1);
  assert.equal(log.posts, 0);
  assert.deepEqual(structuredClone(rig.calls), [{ reset: { index: 0, routes: [{ name: 'MainTabs' }] } }]);
});

test('R01-07/08: verificação em andamento ou bloqueada não libera ingresso nem mostra sucesso', async () => {
  const pendingIntent = { eventId: event.id, sameEvent: true, confirmed: true };
  const checking = confirmationRig(official(eligible, { pendingIntent, recovery: { status: 'checking', message: null } }));
  assert.equal(checking.rig.button('Verificando...').props.disabled, true);
  assert.equal(checking.rig.button('Confirmar entrada').props.disabled, true);
  const blocked = confirmationRig(official(eligible, { pendingIntent,
    recovery: { status: 'blocked', message: 'O servidor não confirmou a participação da tentativa anterior.' } }));
  assert.match(blocked.rig.text(), /não confirmou a participação/);
  assert.equal(blocked.rig.button('Confirmar entrada').props.disabled, true);
});

test('R01-02: intenção incerta do mesmo evento com entradas abertas usa o próprio botão (mesma chave)', async () => {
  const { rig, log } = confirmationRig(official(eligible, {
    pendingIntent: { eventId: event.id, sameEvent: true, confirmed: false } }));
  assert.ok(!rig.card('event-confirmation-recovery'));
  await rig.button('Verificar ingresso').props.onPress();
  assert.equal(log.posts, 1);
});

test('R01-20: fila externa aparece também com evento indisponível, sem sugerir ingresso possível', () => {
  const notStarted = confirmationRig(official({ eligible: false, blockingReasons: ['EVENT_NOT_STARTED'] }));
  assert.ok(notStarted.rig.card('event-confirmation-queue-info'));
  assert.match(notStarted.rig.text(), /Evento com fila de entrada/);
  assert.match(notStarted.rig.text(), /Ainda não é possível ingressar/);
  assert.doesNotMatch(notStarted.rig.text(), /Ao confirmar, você entra na fila/);

  const direct = { ...event, externalQueueEnabled: false };
  const directBlocked = confirmationRig({ ...official({ eligible: false, blockingReasons: ['EVENT_NOT_READY'] }), event: direct });
  assert.match(directBlocked.rig.text(), /Entrada direta na Arena/);
  assert.match(directBlocked.rig.text(), /não usa fila de entrada/);
  assert.match(directBlocked.rig.text(), /Ainda não é possível ingressar/);

  const directOpen = confirmationRig({ ...official(), event: direct });
  assert.match(directOpen.rig.text(), /Ao confirmar, sua entrada na Arena é liberada/);

  const queueClosed = confirmationRig(official({ eligible: false, blockingReasons: ['EVENT_REGISTRATION_CLOSED'] }));
  assert.match(queueClosed.rig.text(), /Não é mais possível entrar na fila/);
});

test('R01-21: encerramento antecipado — horários aparecem como programação, nunca como prazo vigente', () => {
  // Admin encerrou às 12:00 BRT, antes do horário programado (17:00): o servidor só informa o estado.
  const { rig } = confirmationRig(official({ eligible: false, blockingReasons: ['EVENT_REGISTRATION_CLOSED'] }));
  const text = rig.text();
  assert.ok(rig.card('event-confirmation-schedule-notice'));
  assert.match(text, /programação original e não valem mais como prazo/);
  assert.match(text, /Encerramento programado das entradas/);
  assert.match(text, /Limite operacional programado/);
  assert.doesNotMatch(text, /Entradas até/);
  // O estado oficial tem destaque próprio (situação + cartão de indisponibilidade).
  assert.ok(rig.card('event-confirmation-blocked'));
  assert.match(rig.card('event-confirmation-status').props.accessibilityLabel, /ENTRADAS ENCERRADAS/);
  // Evento aberto não recebe o aviso.
  assert.ok(!confirmationRig(official()).rig.card('event-confirmation-schedule-notice'));
});

test('R01-21: datas em fusos diferentes e virada de meia-noite seguem o fuso do evento', () => {
  const manaus = { ...event, timezone: 'America/Manaus',
    startsAt: '2026-11-09T02:00:00.000Z', officialEndsAt: '2026-11-09T05:00:00.000Z',
    operationalDeadlineAt: '2026-11-09T06:00:00.000Z' };
  const { rig } = confirmationRig({ ...official(), event: manaus });
  const text = rig.text();
  assert.match(text, /08\/11\/2026/); // 22:00 de 08/11 em Manaus (UTC-4)
  assert.match(text, /22:00/);
  assert.match(text, /09\/11\/2026 às 01:00/);
  assert.match(text, /America\/Manaus/);
});

test('R01-22: toques repetidos na verificação da tentativa anterior geram uma única chamada', async () => {
  let release, count = 0;
  const admission = official(eligible, { pendingIntent: { eventId: event.id, sameEvent: false, confirmed: false } });
  const context = { admission, isCurrentAdmission: () => true,
    reconcileEntryIntent: () => { count++; return new Promise(done => { release = done; }); },
    revalidateEventEntry: async () => ({ kind: 'found' }) };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  const button = rig.button('Verificar tentativa anterior');
  const first = button.props.onPress();
  await button.props.onPress();
  await button.props.onPress();
  assert.equal(count, 1);
  release({ kind: 'uncertain', message: 'x' });
  await first;
});

test('R01: ícones da confirmação são de linha, sem emojis permanentes', () => {
  const { rig } = confirmationRig(official());
  assert.doesNotMatch(rig.text(), /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u);
});
