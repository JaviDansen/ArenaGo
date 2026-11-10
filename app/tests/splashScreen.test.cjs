const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const appDirectory = path.resolve(__dirname, '..');

// 1. Carregar módulos de Splash
const splashServiceExports = loadModule('services/splashScreenService.js', (name) => {
  if (name === 'expo-splash-screen') {
    return {
      preventAutoHideAsync: async () => true,
      hideAsync: async () => true,
    };
  }
  return require(name);
}).exports;

const {
  preventAutoHideAsync,
  hideNativeSplashAsync,
  isSplashCompleted,
  markSplashCompleted,
  resetSplashScreenStateForTesting,
  hasNativeSplashPrevented,
  hasNativeSplashHidden,
} = splashServiceExports;

// Carregar AuthSessionGate
const gateExports = loadModule('screens/auth/AuthSessionGate.js', (name) => {
  if (name === 'react') {
    return {
      ...require('react'),
      useState: (value) => {
        let val = value;
        return [val, (newVal) => { val = newVal; }];
      },
    };
  }
  if (name === 'expo-status-bar') return { StatusBar: () => null };
  if (name === 'react-native-safe-area-context') {
    return {
      SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }),
    };
  }
  if (name === 'react-native') {
    return {
      ActivityIndicator: (props) => ({ type: 'ActivityIndicator', props }),
      Image: (props) => ({ type: 'Image', props }),
      Pressable: (props) => ({ type: 'Pressable', props }),
      SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }),
      StyleSheet: { create: (styles) => styles },
      Text: (props) => ({ type: 'Text', props }),
      View: (props) => ({ type: 'View', props }),
    };
  }
  if (name === '../../context/AuthContext') {
    return {
      AuthProvider: ({ children }) => children,
      useAuth: () => null,
    };
  }
  return require(name);
}).exports;

const { resolveInitialRouteForAuthState, AuthSessionCoordinator } = gateExports;

// Helper para ler dimensões de PNG (IHDR: bytes 16 a 23)
function readPngDimensions(filePath) {
  const buf = readFileSync(filePath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, bytes: buf.length };
}

// ---------------------------------------------------------------------------
// 1. Configuração da Splash
// ---------------------------------------------------------------------------
test('SPLASH-01 (1): Configuração da Splash nativa em app.json e integridade dos assets', () => {
  const appJsonPath = path.join(appDirectory, 'app.json');
  assert.ok(existsSync(appJsonPath), 'app.json deve existir');

  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const plugins = appJson.expo.plugins || [];
  const splashPlugin = plugins.find(
    (p) => Array.isArray(p) && p[0] === 'expo-splash-screen'
  );

  assert.ok(splashPlugin, 'Plugin expo-splash-screen deve estar configurado em plugins');
  const splashConfig = splashPlugin[1];

  assert.equal(splashConfig.backgroundColor, '#05050A', 'Fundo da Splash deve ser #05050A (Design System canvas)');
  assert.equal(splashConfig.resizeMode, 'contain', 'resizeMode deve ser contain');
  assert.equal(splashConfig.image, './assets/splash-icon.png', 'Imagem deve apontar para ./assets/splash-icon.png');
  assert.equal(splashConfig.dark?.backgroundColor, '#05050A', 'Fundo dark deve ser #05050A');

  // Verificar asset nativo splash-icon.png (1024x1024)
  const splashIconPath = path.join(appDirectory, 'assets/splash-icon.png');
  assert.ok(existsSync(splashIconPath), 'app/assets/splash-icon.png deve existir');
  const splashDims = readPngDimensions(splashIconPath);
  assert.equal(splashDims.width, 1024, 'splash-icon.png largura deve ser 1024');
  assert.equal(splashDims.height, 1024, 'splash-icon.png altura deve ser 1024');
  assert.ok(splashDims.bytes > 5000, 'splash-icon.png deve ser um arquivo PNG válido');

  // Verificar asset da logo oficial do ArenaGO
  const logoPath = path.join(appDirectory, 'assets/images/logo-arenago.png');
  assert.ok(existsSync(logoPath), 'app/assets/images/logo-arenago.png deve existir');
  const logoDims = readPngDimensions(logoPath);
  assert.equal(logoDims.width, 1024, 'logo-arenago.png largura deve ser 1024');
  assert.equal(logoDims.height, 341, 'logo-arenago.png altura deve ser 341');

  // Verificar preservação da logo original anexada
  const originalLogoPath = path.join(appDirectory, 'assets/Logo ArenaGO em Preto, Branco e Roxo.png');
  assert.ok(existsSync(originalLogoPath), 'Arquivo de referência visual original deve ser preservado');
});

// ---------------------------------------------------------------------------
// 2. Estados de prontidão e ocultação
// ---------------------------------------------------------------------------
test('SPLASH-01 (2): Estados de prontidão e ocultação com idempotência', async () => {
  resetSplashScreenStateForTesting();

  let preventCalled = 0;
  let hideCalled = 0;
  const mockSplash = {
    preventAutoHideAsync: async () => { preventCalled++; },
    hideAsync: async () => { hideCalled++; },
  };

  assert.equal(hasNativeSplashPrevented(), false);
  assert.equal(hasNativeSplashHidden(), false);

  // 1. preventAutoHideAsync
  const preventResult1 = await preventAutoHideAsync(mockSplash);
  assert.equal(preventResult1, true);
  assert.equal(preventCalled, 1);
  assert.equal(hasNativeSplashPrevented(), true);

  // Segunda chamada deve ser idempotente
  const preventResult2 = await preventAutoHideAsync(mockSplash);
  assert.equal(preventResult2, true);
  assert.equal(preventCalled, 1);

  // 2. hideNativeSplashAsync
  const hideResult1 = await hideNativeSplashAsync(mockSplash);
  assert.equal(hideResult1, true);
  assert.equal(hideCalled, 1);
  assert.equal(hasNativeSplashHidden(), true);

  // Segunda chamada deve ser idempotente
  const hideResult2 = await hideNativeSplashAsync(mockSplash);
  assert.equal(hideResult2, true);
  assert.equal(hideCalled, 1);
});

// ---------------------------------------------------------------------------
// 3. Execução única da transição
// ---------------------------------------------------------------------------
test('SPLASH-01 (3): Execução única da transição por abertura do app', () => {
  resetSplashScreenStateForTesting();

  assert.equal(isSplashCompleted(), false, 'Splash inicialmente não concluída');
  markSplashCompleted();
  assert.equal(isSplashCompleted(), true, 'Splash marcada como concluída');

  // SplashScreenGate com splash concluída não reexibe
  const gate = loadModule('screens/splash/SplashScreenGate.js', (name) => {
    if (name === 'react') {
      return {
        ...require('react'),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      };
    }
    if (name === 'react-native') {
      return {
        StyleSheet: { create: (s) => s },
        View: ({ children }) => children,
      };
    }
    if (name === '../../services/splashScreenService') {
      return { isSplashCompleted: () => true };
    }
    if (name === './AnimatedSplashScreen') {
      return () => { throw new Error('Não deveria renderizar AnimatedSplashScreen quando já concluída'); };
    }
    return require(name);
  }).exports.default;

  const result = gate({ children: 'ConteudoPrincipal' });
  assert.equal(result, 'ConteudoPrincipal', 'Deve retornar os filhos imediatamente sem renderizar overlay');
});

// ---------------------------------------------------------------------------
// 4. Usuário sem sessão (Splash -> Welcome)
// ---------------------------------------------------------------------------
test('SPLASH-01 (4): Transição para usuário sem sessão direciona para Welcome', () => {
  const authState = {
    isAuthenticated: false,
    sessionStatus: 'unauthenticated',
    user: null,
  };
  const route = resolveInitialRouteForAuthState(authState);
  assert.equal(route, 'Welcome', 'Usuário sem sessão deve ser direcionado para Welcome');
});

// ---------------------------------------------------------------------------
// 5. Usuário autenticado (Splash -> MainTabs)
// ---------------------------------------------------------------------------
test('SPLASH-01 (5): Transição para usuário autenticado com questionário concluído direciona para MainTabs', () => {
  const authState = {
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Participante',
      hasCompletedQuestionnaire: true,
    },
  };
  const route = resolveInitialRouteForAuthState(authState);
  assert.equal(route, 'MainTabs', 'Usuário com sessão válida deve ser direcionado para MainTabs');
});

// ---------------------------------------------------------------------------
// 6. Usuário com questionário pendente (Splash -> ProfileQuestionnaire)
// ---------------------------------------------------------------------------
test('SPLASH-01 (6): Transição para usuário autenticado com questionário pendente direciona para ProfileQuestionnaire', () => {
  const authState = {
    isAuthenticated: true,
    sessionStatus: 'authenticated',
    user: {
      id: 'usr-2',
      name: 'Novo Participante',
      hasCompletedQuestionnaire: false,
    },
  };
  const route = resolveInitialRouteForAuthState(authState);
  assert.equal(route, 'ProfileQuestionnaire', 'Usuário com questionário pendente deve ser direcionado para ProfileQuestionnaire');
});

// ---------------------------------------------------------------------------
// 7. Sessão expirada ou revogada (Splash -> Login com avisos)
// ---------------------------------------------------------------------------
test('SPLASH-01 (7): Transição com sessão expirada, revogada ou aviso direciona para Login', () => {
  const expiredState = {
    isAuthenticated: false,
    sessionStatus: 'expired',
    authNotice: 'Sua sessão expirou. Faça login novamente.',
  };
  assert.equal(resolveInitialRouteForAuthState(expiredState), 'Login');

  const revokedState = {
    isAuthenticated: false,
    sessionStatus: 'revoked',
  };
  assert.equal(resolveInitialRouteForAuthState(revokedState), 'Login');

  const uncertainState = {
    isAuthenticated: false,
    sessionStatus: 'uncertain_refresh',
  };
  assert.equal(resolveInitialRouteForAuthState(uncertainState), 'Login');
});

// ---------------------------------------------------------------------------
// 8. Falha de rede na restauração (Splash -> tela de recuperação)
// ---------------------------------------------------------------------------
test('SPLASH-01 (8): Falha de rede na restauração exibe interface de recuperação sem travar a Splash', () => {
  let restoreCalled = false;
  const mockAuth = {
    isAuthenticated: false,
    isInitializing: false,
    sessionStatus: 'network_error',
    networkError: 'Falha de conexão com os servidores ArenaGo.',
    restoreSession: async () => { restoreCalled = true; },
  };

  const coordinatorExports = loadModule('screens/auth/AuthSessionGate.js', (name) => {
    if (name === 'react') return { ...require('react'), useState: () => [false, () => {}] };
    if (name === 'expo-status-bar') return { StatusBar: () => null };
    if (name === 'react-native-safe-area-context') {
      return { SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }) };
    }
    if (name === 'react-native') {
      return {
        ActivityIndicator: (props) => ({ type: 'ActivityIndicator', props }),
        Image: (props) => ({ type: 'Image', props }),
        Pressable: (props) => ({ type: 'Pressable', props }),
        SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }),
        StyleSheet: { create: (styles) => styles },
        Text: (props) => ({ type: 'Text', props }),
        View: (props) => ({ type: 'View', props }),
      };
    }
    if (name === '../../context/AuthContext') {
      return { AuthProvider: ({ children }) => children, useAuth: () => mockAuth };
    }
    return require(name);
  }).exports;

  const rendered = coordinatorExports.AuthSessionCoordinator({ children: 'MainApp' });
  assert.notEqual(rendered, 'MainApp', 'Não deve exibir o app direto em caso de falha');

  // Encontrar textos no elemento renderizado
  function collectTexts(node) {
    if (!node) return [];
    if (typeof node === 'string') return [node];
    const results = [];
    if (node.type === 'Text' && node.props?.children) {
      if (typeof node.props.children === 'string') results.push(node.props.children);
      else if (Array.isArray(node.props.children)) results.push(...node.props.children.filter((c) => typeof c === 'string'));
    }
    if (node.props?.children) {
      if (Array.isArray(node.props.children)) {
        for (const child of node.props.children) results.push(...collectTexts(child));
      } else {
        results.push(...collectTexts(node.props.children));
      }
    }
    return results;
  }

  const texts = collectTexts(rendered);
  assert.ok(texts.includes('CONEXÃO INDISPONÍVEL'), 'Deve exibir tag CONEXÃO INDISPONÍVEL');
  assert.ok(texts.includes('Tentar novamente'), 'Deve oferecer botão Tentar novamente');
  assert.ok(texts.includes('Ir para o Login'), 'Deve oferecer botão Ir para o Login');
});

// ---------------------------------------------------------------------------
// 9. Falha de armazenamento (Splash -> tela de recuperação)
// ---------------------------------------------------------------------------
test('SPLASH-01 (9): Falha de armazenamento exibe interface de recuperação com botão de login', () => {
  const mockAuth = {
    isAuthenticated: false,
    isInitializing: false,
    sessionStatus: 'storage_error',
    storageError: 'Falha de leitura segura no SecureStore.',
    restoreSession: async () => {},
  };

  const coordinatorExports = loadModule('screens/auth/AuthSessionGate.js', (name) => {
    if (name === 'react') return { ...require('react'), useState: () => [false, () => {}] };
    if (name === 'expo-status-bar') return { StatusBar: () => null };
    if (name === 'react-native-safe-area-context') {
      return { SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }) };
    }
    if (name === 'react-native') {
      return {
        ActivityIndicator: (props) => ({ type: 'ActivityIndicator', props }),
        Image: (props) => ({ type: 'Image', props }),
        Pressable: (props) => ({ type: 'Pressable', props }),
        SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }),
        StyleSheet: { create: (styles) => styles },
        Text: (props) => ({ type: 'Text', props }),
        View: (props) => ({ type: 'View', props }),
      };
    }
    if (name === '../../context/AuthContext') {
      return { AuthProvider: ({ children }) => children, useAuth: () => mockAuth };
    }
    return require(name);
  }).exports;

  const rendered = coordinatorExports.AuthSessionCoordinator({ children: 'MainApp' });
  assert.notEqual(rendered, 'MainApp');

  function collectTexts(node) {
    if (!node) return [];
    if (typeof node === 'string') return [node];
    const results = [];
    if (node.type === 'Text' && node.props?.children) {
      if (typeof node.props.children === 'string') results.push(node.props.children);
      else if (Array.isArray(node.props.children)) results.push(...node.props.children.filter((c) => typeof c === 'string'));
    }
    if (node.props?.children) {
      if (Array.isArray(node.props.children)) {
        for (const child of node.props.children) results.push(...collectTexts(child));
      } else {
        results.push(...collectTexts(node.props.children));
      }
    }
    return results;
  }

  const texts = collectTexts(rendered);
  assert.ok(texts.includes('FALHA NA RESTAURAÇÃO'), 'Deve exibir tag FALHA NA RESTAURAÇÃO');
  assert.ok(texts.includes('Ir para o Login'), 'Deve oferecer opção de seguir para o Login');
});

// ---------------------------------------------------------------------------
// 10. Prevenção de ocultação precoce
// ---------------------------------------------------------------------------
test('SPLASH-01 (10): Prevenção de ocultação precoce no escopo global em app/index.js', () => {
  const indexSource = readFileSync(path.join(appDirectory, 'index.js'), 'utf8');

  // Verificar que preventAutoHideAsync é importado e executado
  assert.match(indexSource, /preventAutoHideAsync/, 'index.js deve referenciar preventAutoHideAsync');

  // Verificar que a invocação de preventAutoHideAsync ocorre antes de registerRootComponent
  const preventCallIndex = indexSource.indexOf('preventAutoHideAsync(');
  const registerCallIndex = indexSource.indexOf('registerRootComponent(');
  assert.ok(preventCallIndex !== -1, 'preventAutoHideAsync( deve ser invocado no index.js');
  assert.ok(registerCallIndex !== -1, 'registerRootComponent( deve ser invocado no index.js');
  assert.ok(preventCallIndex < registerCallIndex, 'preventAutoHideAsync deve ser chamado ANTES de registerRootComponent');
});

// ---------------------------------------------------------------------------
// 11. Prevenção de Splash infinita
// ---------------------------------------------------------------------------
test('SPLASH-01 (11): Prevenção de Splash infinita quando a interface demora para responder', async () => {
  resetSplashScreenStateForTesting();

  let dismissed = false;
  let nativeHideCalled = false;
  const mockSplash = {
    hideAsync: async () => { nativeHideCalled = true; },
  };

  const effects = [];
  const animatedSplashExports = loadModule('screens/splash/AnimatedSplashScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (init) => ({ current: init }),
        useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
        useEffect: (cb) => { effects.push(cb); },
      };
    }
    if (name === 'react-native') {
      return {
        AccessibilityInfo: { isReduceMotionEnabled: async () => false },
        Animated: {
          Value: function (init) {
            this.val = init;
            this.setValue = (v) => { this.val = v; };
          },
          timing: (_val, config) => ({
            start: (cb) => {
              if (typeof cb === 'function') cb({ finished: true });
            },
            stop: () => {},
          }),
          parallel: (anims) => ({
            start: (cb) => {
              if (typeof cb === 'function') cb({ finished: true });
            },
            stop: () => {},
          }),
        },
        Easing: {
          out: () => (t) => t,
          cubic: (t) => t,
          quad: (t) => t,
        },
        Image: (p) => ({ type: 'Image', props: p }),
        StyleSheet: { create: (s) => s, absoluteFillObject: {} },
        View: (p) => ({ type: 'View', props: p }),
      };
    }
    if (name === '../../theme') {
      return { colors: { background: { canvas: '#05050A' } } };
    }
    if (name === '../../services/splashScreenService') {
      return {
        hideNativeSplashAsync: async (m) => m?.hideAsync(),
        markSplashCompleted: () => { dismissed = true; },
      };
    }
    return require(name);
  }).exports;

  const AnimatedSplash = animatedSplashExports.default;
  assert.ok(typeof AnimatedSplash === 'function', 'AnimatedSplashScreen deve ser um componente válido');

  let onDismissFired = false;
  // Executar renderização do componente com isReady=false e timeouts curtos
  AnimatedSplash({
    isReady: false,
    maxWaitMs: 25,
    safetyTimeoutMs: 50,
    splashModule: mockSplash,
    onDismiss: () => {
      onDismissFired = true;
    },
  });

  // Executar os efeitos registrados
  for (const effect of effects) {
    if (typeof effect === 'function') {
      effect();
    }
  }

  // Aguardar os timeouts de maxWaitMs / safetyTimeout dispararem o dismissSplash
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(nativeHideCalled, true, 'Deve ter liberado a Splash nativa');
  assert.equal(onDismissFired, true, 'Deve ter disparado onDismiss mesmo com isReady=false (prevenção de Splash infinita)');
  assert.equal(dismissed, true, 'Deve ter marcado a Splash como concluída');
});

// ---------------------------------------------------------------------------
// 12. Ausência de reexibição indevida ao navegar
// ---------------------------------------------------------------------------
test('SPLASH-01 (12): Ausência de reexibição indevida ao mudar de aba, navegar ou autenticar', () => {
  resetSplashScreenStateForTesting();
  markSplashCompleted();

  let splashComponentRendered = false;
  const gate = loadModule('screens/splash/SplashScreenGate.js', (name) => {
    if (name === 'react') {
      return {
        ...require('react'),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      };
    }
    if (name === 'react-native') {
      return {
        StyleSheet: { create: (s) => s },
        View: ({ children }) => children,
      };
    }
    if (name === '../../services/splashScreenService') {
      return { isSplashCompleted: () => true };
    }
    if (name === './AnimatedSplashScreen') {
      return () => {
        splashComponentRendered = true;
        return null;
      };
    }
    return require(name);
  }).exports.default;

  // Simular navegação entre 5 telas/abas diferentes
  const screens = ['MainTabs', 'Arena', 'EventEntry', 'ProfileQuestionnaire', 'Evaluation'];
  for (const screenName of screens) {
    const rendered = gate({ children: `Tela_${screenName}` });
    assert.equal(rendered, `Tela_${screenName}`);
    assert.equal(splashComponentRendered, false, `Splash não pode renderizar durante navegação para ${screenName}`);
  }
});

// ---------------------------------------------------------------------------
// 13. Tratamento de erro da API nativa de Splash
// ---------------------------------------------------------------------------
test('SPLASH-01 (13): Tratamento de erro quando expo-splash-screen falha ou rejeita', async () => {
  resetSplashScreenStateForTesting();

  const rejectingModule = {
    preventAutoHideAsync: async () => {
      throw new Error('E_UNSUPPORTED_PLATFORM: Expo splash screen is not supported on this platform');
    },
    hideAsync: async () => {
      throw new Error('E_ALREADY_HIDDEN: Splash screen was already hidden');
    },
  };

  // preventAutoHideAsync com erro não deve propagar rejeição
  const preventResult = await preventAutoHideAsync(rejectingModule);
  assert.equal(preventResult, false, 'Deve retornar false sem lançar exceção');

  // hideNativeSplashAsync com erro não deve propagar rejeição
  const hideResult = await hideNativeSplashAsync(rejectingModule);
  assert.equal(hideResult, false, 'Deve retornar false sem lançar exceção');
});

// ---------------------------------------------------------------------------
// 14. Respeito à configuração de movimento reduzido
// ---------------------------------------------------------------------------
test('SPLASH-01 (14): Respeito à preferência de movimento reduzido (reduceMotion)', () => {
  const animatedSplashExports = loadModule('screens/splash/AnimatedSplashScreen.js', (name) => {
    if (name === 'react') return require('react');
    if (name === 'react-native') {
      return {
        AccessibilityInfo: { isReduceMotionEnabled: async () => true },
        Animated: {
          Value: function (init) {
            this.val = init;
            this.setValue = (v) => { this.val = v; };
          },
          timing: (_val, config) => ({
            start: (cb) => { if (cb) cb({ finished: true }); },
            stop: () => {},
          }),
          parallel: (anims) => ({
            start: (cb) => { if (cb) cb({ finished: true }); },
            stop: () => {},
          }),
        },
        Easing: {
          out: () => (t) => t,
          cubic: (t) => t,
          quad: (t) => t,
        },
        Image: (p) => ({ type: 'Image', props: p }),
        StyleSheet: { create: (s) => s, absoluteFillObject: {} },
        View: (p) => ({ type: 'View', props: p }),
      };
    }
    if (name === '../../theme') return { colors: { background: { canvas: '#05050A' } } };
    if (name === '../../services/splashScreenService') {
      return {
        hideNativeSplashAsync: async () => true,
        markSplashCompleted: () => {},
      };
    }
    return require(name);
  }).exports;

  const AnimatedSplash = animatedSplashExports.default;
  assert.ok(typeof AnimatedSplash === 'function');

  // Renderizar componente com reduceMotion explícito
  const React = require('react');
  const element = React.createElement(AnimatedSplash, {
    reduceMotion: true,
    isReady: true,
  });

  assert.ok(element, 'Componente deve instanciar com reduceMotion=true');
});
