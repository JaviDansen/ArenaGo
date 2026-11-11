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
      Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView',
      Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { create: (styles) => styles, absoluteFillObject: {} },
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
    admission: { status: 'ready', event }, isCurrentAdmission: () => true,
    confirmEventEntry: async () => { count++; return { kind: 'complete' }; },
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context,
    { event, eligibility: { eligible: false, blockingReasons: ['PROFILE_INCOMPLETE'] } });
  assert.match(rig.text(), /PROFILE_INCOMPLETE/);
  assert.equal(rig.button('Confirmar entrada').props.disabled, true);
  await rig.button('Confirmar entrada').props.onPress?.();
  assert.equal(count, 0);
  assert.deepEqual(rig.calls, []);
});

test('ingresso confirmado navega uma vez; toque duplo não duplica POST', async () => {
  let resolve, count = 0;
  const context = {
    admission: { status: 'ready', event }, isCurrentAdmission: () => true,
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
    admission: { status: 'confirmed_unsynced', event, confirmedParticipationId: '22222222-2222-4222-8222-222222222222',
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
    admission: { status: 'ready', event }, isCurrentAdmission: () => true,
    confirmEventEntry: async () => ({ kind: 'error', message: 'Evento encerrado' }),
  };
  const rig = screenRig('screens/event-entry/EventConfirmationScreen.js', context, { event, eligibility: eligible });
  await rig.button('Confirmar entrada').props.onPress();
  assert.deepEqual(rig.calls, []);
  context.admission = { status: 'error', event, error: 'Evento encerrado' };
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
        Pressable: (props) => ({ type: 'Pressable', props }),
        View: (props) => ({ type: 'View', props }),
        StyleSheet: { create: (s) => s },
      };
    }
    if (name === '../../theme/colors.js') return { background: { surface: '#161626' }, border: { subtle: '#24243A' } };
    if (name === '../../theme/radii.js') return { xl: 18 };
    if (name === '../../theme/spacing.js') return { layout: { cardPadding: 16 } };
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
  assert.deepEqual(structuredClone(validateAndNormalizeQrCode('EVENT_2026-SP')), { ok: true, code: 'EVENT_2026-SP' });

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
