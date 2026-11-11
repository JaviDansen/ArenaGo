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
  const ui = createParticipantUiStubs();
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
    let result = nodes(tree).find((node) => node.type === 'Pressable' && textOf(node) === label);
    // Para manter compatibilidade com testes manuais legados que buscavam diretamente 'Continuar'
    if (!result && (label === 'Continuar' || label === 'Consultando...')) {
      const manualBtn = nodes(tree).find((node) => node.type === 'Pressable' && textOf(node).includes('Digitar código'));
      if (manualBtn) {
        manualBtn.props.onPress();
        render();
        result = nodes(tree).find((node) => node.type === 'Pressable' && textOf(node) === label);
      }
    }
    assert.ok(result, `Botão ausente: ${label}`);
    return result;
  }

  render();
  return {
    calls,
    render,
    button,
    findButton: (label) => nodes(tree).find((node) => node.type === 'Pressable' && textOf(node) === label),
    text: () => nodes(tree).map(textOf).join(' '),
    inputError: () => nodes(tree).find((node) => node.type === ui.InputField)?.props.error,
    input(value) {
      let textInput = nodes(tree).find((node) => node.type === 'TextInput');
      if (!textInput) {
        const manualBtn = nodes(tree).find((node) => node.type === 'Pressable' && textOf(node).includes('Digitar código'));
        if (manualBtn) {
          manualBtn.props.onPress();
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
// Novos testes específicos da TASK ENTRY-QR-01
// -------------------------------------------------------------

test('ENTRY-QR-01: tela inicial apresenta as duas opções visíveis e independentes', () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context);

  // Deve exibir o cabeçalho e as duas opções com títulos claros
  assert.match(rig.text(), /Entrar em um evento/);
  assert.match(rig.text(), /Como deseja entrar\?/);
  assert.match(rig.text(), /Ler QR Code/);
  assert.match(rig.text(), /Digitar código/);

  // Ambas as opções devem possuir botões acionáveis
  assert.ok(rig.button('Ler QR Code'));
  assert.ok(rig.button('Digitar código'));
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

test('ENTRY-QR-01: câmera é desativada quando a tela não está em foco', () => {
  const context = { admission: { status: 'idle' }, isCurrentAdmission: () => true };
  const rig = screenRig('screens/event-entry/EventEntryScreen.js', context, { initialMethod: 'qr' }, {
    isFocused: false,
  });

  assert.equal(rig.camera(), undefined, 'CameraView não deve ser montada quando isFocused for false');
  assert.match(rig.text(), /Leitor inativo fora de foco/);
});
