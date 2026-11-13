const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const appDirectory = path.resolve(__dirname, '..');

// Helper para ler dimensões de PNG (IHDR: bytes 16 a 23)
function readPngDimensions(filePath) {
  const buf = readFileSync(filePath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, bytes: buf.length };
}

// 1. Carregar módulo splashScreenService
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

// Função fábrica de resolvedores de módulo com suporte robusto a caminhos relativos
function createResolver(overrides = {}) {
  const baseResolver = (name) => {
    if (overrides[name]) {
      return overrides[name];
    }
    if (name.includes('splashScreenService')) {
      return splashServiceExports;
    }
    if (name.includes('AnimatedSplashScreen')) {
      return loadModule('screens/splash/AnimatedSplashScreen.js', baseResolver).exports;
    }
    if (name.includes('SplashScreenGate')) {
      return loadModule('screens/splash/SplashScreenGate.js', baseResolver).exports;
    }
    if (name.includes('theme')) {
      return {
        colors: {
          background: { canvas: '#05050A', base: '#0B0B12', surface: '#161626', elevated: '#1F1F35' },
          brand: { primary: '#5F33FA', primaryLight: '#8A68FF', primaryHover: '#724CFB' },
          text: { primary: '#FFFFFF', secondary: '#A0A0B8', muted: '#6C6C8A', disabled: '#43435B' },
          border: { subtle: '#24243A', input: '#2E2E48' },
        },
      };
    }
    if (name === 'react') {
      const actualReact = require('react');
      return {
        ...actualReact,
        useState: (initial) => {
          let val = typeof initial === 'function' ? initial() : initial;
          return [val, (newVal) => { val = typeof newVal === 'function' ? newVal(val) : newVal; }];
        },
        useEffect: (cb) => {
          if (typeof cb === 'function') {
            try {
              cb();
            } catch {
              // noop
            }
          }
        },
        useCallback: (fn) => fn,
        useRef: (init) => ({ current: init }),
      };
    }
    if (name === 'react-native') {
      return {
        AccessibilityInfo: { isReduceMotionEnabled: async () => false },
        ActivityIndicator: (props) => ({ type: 'ActivityIndicator', props }),
        Animated: {
          Value: function (init) {
            this.val = init;
            this.setValue = (v) => { this.val = v; };
          },
          timing: (val, config) => ({
            start: (cb) => {
              if (val && typeof val.setValue === 'function' && config && config.toValue !== undefined) {
                val.setValue(config.toValue);
              }
              if (cb) cb({ finished: true });
            },
            stop: () => {},
          }),
          parallel: (anims) => ({
            start: (cb) => { if (cb) cb({ finished: true }); },
            stop: () => {},
          }),
          View: (props) => ({ type: 'Animated.View', props }),
        },
        Easing: {
          out: () => (t) => t,
          cubic: (t) => t,
          quad: (t) => t,
        },
        Image: (props) => ({ type: 'Image', props }),
        Pressable: (props) => ({ type: 'Pressable', props }),
        SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }),
        StyleSheet: {
          create: (styles) => styles,
          absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
        },
        Text: (props) => ({ type: 'Text', props }),
        View: (props) => ({ type: 'View', props }),
      };
    }
    if (name === 'expo-status-bar') {
      return { StatusBar: () => null };
    }
    if (name === 'react-native-safe-area-context') {
      return {
        SafeAreaView: ({ children, style }) => ({ type: 'SafeAreaView', props: { children, style } }),
        SafeAreaProvider: ({ children }) => children,
      };
    }
    if (name === '../../context/AuthContext') {
      return {
        AuthProvider: ({ children }) => children,
        useAuth: () => null,
      };
    }
    if (name.endsWith('.png')) {
      return 1;
    }
    return require(name);
  };
  return baseResolver;
}

// Carregar AuthSessionGate
const gateExports = loadModule(
  'screens/auth/AuthSessionGate.js',
  createResolver({
    '../../context/AuthContext': {
      AuthProvider: ({ children }) => children,
      useAuth: () => null,
    },
  })
).exports;

const { resolveInitialRouteForAuthState, AuthSessionCoordinator } = gateExports;

// ---------------------------------------------------------------------------
// 1. Configuração da Splash nativa em app.json e integridade dos assets
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

  assert.equal(splashConfig.backgroundColor, '#1C0A35', 'Fundo da Splash deve ser #1C0A35');
  assert.equal(splashConfig.resizeMode, 'contain', 'resizeMode deve ser contain');
  assert.equal(splashConfig.image, './assets/splash-icon.png', 'Imagem deve apontar para ./assets/splash-icon.png');
  assert.equal(splashConfig.dark?.backgroundColor, '#1C0A35', 'Fundo dark deve ser #1C0A35');

  // Verificar asset nativo splash-icon.png (1024x1024)
  const splashIconPath = path.join(appDirectory, 'assets/splash-icon.png');
  assert.ok(existsSync(splashIconPath), 'app/assets/splash-icon.png deve existir');
  const splashDims = readPngDimensions(splashIconPath);
  assert.equal(splashDims.width, 1024, 'splash-icon.png largura deve ser 1024');
  assert.equal(splashDims.height, 1024, 'splash-icon.png altura deve ser 1024');
  assert.ok(splashDims.bytes > 5000, 'splash-icon.png deve ser um arquivo PNG válido');

  // Verificar asset da logo oficial do ArenaGO (1024x341)
  const logoPath = path.join(appDirectory, 'assets/images/logo-arenago.png');
  assert.ok(existsSync(logoPath), 'app/assets/images/logo-arenago.png deve existir');
  const logoDims = readPngDimensions(logoPath);
  assert.equal(logoDims.width, 1024, 'logo-arenago.png largura deve ser 1024');
  assert.equal(logoDims.height, 341, 'logo-arenago.png altura deve ser 341');

  // Verificar preservação do arquivo de referência visual original
  const originalLogoPath = path.join(appDirectory, 'assets/Logo ArenaGO em Preto, Branco e Roxo.png');
  assert.ok(existsSync(originalLogoPath), 'Arquivo de referência visual original deve ser preservado');
});

// ---------------------------------------------------------------------------
// 2. Estados de prontidão e ocultação com idempotência
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
// 3. Splash animada ocupa integralmente a área disponível (absoluteFill, zIndex)
// ---------------------------------------------------------------------------
test('SPLASH-01 (3): Splash animada ocupa integralmente a área disponível (absoluteFill, 100% largura/altura, zIndex elevado)', () => {
  const animatedSplashExports = loadModule(
    'screens/splash/AnimatedSplashScreen.js',
    createResolver()
  ).exports;

  const { styles: animatedStyles } = animatedSplashExports;
  assert.ok(animatedStyles, 'AnimatedSplashScreen deve exportar estilos');
  assert.ok(animatedStyles.container, 'AnimatedSplashScreen deve ter styles.container');

  // Verificar preenchimento absoluto
  assert.equal(animatedStyles.container.position, 'absolute', 'Splash deve ter position absolute');
  assert.equal(animatedStyles.container.top, 0, 'Splash container deve ter top: 0');
  assert.equal(animatedStyles.container.left, 0, 'Splash container deve ter left: 0');
  assert.equal(animatedStyles.container.right, 0, 'Splash container deve ter right: 0');
  assert.equal(animatedStyles.container.bottom, 0, 'Splash container deve ter bottom: 0');
  assert.equal(animatedStyles.container.width, '100%', 'Splash container deve ter width: 100%');
  assert.equal(animatedStyles.container.height, '100%', 'Splash container deve ter height: 100%');
  assert.equal(animatedStyles.container.backgroundColor, '#1C0A35', 'Fundo deve ser #1C0A35');

  // Verificar zIndex e elevation elevados para ficar sobre a navegação no iOS e Android
  assert.ok(Number(animatedStyles.container.zIndex) >= 9999, 'zIndex deve ser >= 9999');
  assert.ok(Number(animatedStyles.container.elevation) >= 9999, 'elevation deve ser >= 9999');

  // Verificar também o splashOverlayContainer no SplashScreenGate
  const gateMod = loadModule('screens/splash/SplashScreenGate.js', createResolver()).exports;
  const { styles: gateStyles } = gateMod;
  assert.equal(gateStyles.rootContainer.backgroundColor, '#1C0A35', 'Fundo raiz deve acompanhar a Splash');
  assert.ok(gateStyles.splashOverlayContainer, 'SplashScreenGate deve ter styles.splashOverlayContainer');
  assert.equal(gateStyles.splashOverlayContainer.backgroundColor, 'transparent', 'Overlay deve preservar o cross-fade');
  assert.equal(gateStyles.splashOverlayContainer.position, 'absolute', 'Overlay no gate deve ser absolute');
  assert.equal(gateStyles.splashOverlayContainer.width, '100%', 'Overlay deve ter width 100%');
  assert.equal(gateStyles.splashOverlayContainer.height, '100%', 'Overlay deve ter height 100%');
  assert.ok(Number(gateStyles.splashOverlayContainer.zIndex) >= 9999, 'Overlay zIndex deve ser >= 9999');
});

// ---------------------------------------------------------------------------
// 4. Tela de destino permanece oculta (opacity: 0) sob a Splash durante a exibição
// ---------------------------------------------------------------------------
test('SPLASH-01 (4): Tela de destino permanece oculta (opacity: 0) sob a Splash durante a exibição', () => {
  resetSplashScreenStateForTesting();

  const gateMod = loadModule('screens/splash/SplashScreenGate.js', createResolver()).exports;
  const SplashScreenGate = gateMod.default;

  // 1. Com Splash ativa (forceShow=true):
  const elementActive = SplashScreenGate({
    children: { type: 'WelcomeScreen', props: {} },
    forceShow: true,
  });

  assert.ok(elementActive, 'Elemento deve ser retornado');
  assert.equal(elementActive.props.testID, 'splash-screen-gate-root');

  // Primeiro filho é appContainer
  const [appContainerActive, overlayActive] = elementActive.props.children;
  assert.ok(appContainerActive, 'appContainer deve estar presente');
  assert.equal(appContainerActive.props.pointerEvents, 'none', 'Enquanto a Splash está visível, pointerEvents dos filhos deve ser none');

  // Opacidade inicial controlada por appOpacity deve ser 0
  const activeOpacity = Array.isArray(appContainerActive.props.style)
    ? appContainerActive.props.style.find((s) => s && s.opacity !== undefined)?.opacity?.val
    : appContainerActive.props.style?.opacity?.val;
  assert.equal(activeOpacity, 0, 'Filhos subjacentes devem iniciar com opacity 0');
  assert.ok(overlayActive, 'Overlay da Splash deve estar presente');

  // 2. Com Splash concluída:
  markSplashCompleted();
  const elementDone = SplashScreenGate({
    children: { type: 'WelcomeScreen', props: {} },
    forceShow: false,
  });

  const [appContainerDone, overlayDone] = elementDone.props.children;
  assert.equal(appContainerDone.props.pointerEvents, 'auto', 'Após a Splash, pointerEvents deve ser auto');
  const doneOpacity = Array.isArray(appContainerDone.props.style)
    ? appContainerDone.props.style.find((s) => s && s.opacity !== undefined)?.opacity?.val
    : appContainerDone.props.style?.opacity?.val;
  assert.equal(doneOpacity, 1, 'Filhos subjacentes devem ter opacity 1 após encerramento');
  assert.equal(overlayDone, false, 'Overlay da Splash deve ser removido após encerramento');
});

// ---------------------------------------------------------------------------
// 5. Desaparecimento da Splash NÃO remonta AuthProvider ou NavigationContainer
// ---------------------------------------------------------------------------
test('SPLASH-01 (5): Desaparecimento da Splash NÃO remonta AuthProvider ou NavigationContainer (mesma árvore de elementos)', () => {
  resetSplashScreenStateForTesting();

  const gateMod = loadModule('screens/splash/SplashScreenGate.js', createResolver()).exports;
  const SplashScreenGate = gateMod.default;

  // Estado 1: Splash visível
  const rendered1 = SplashScreenGate({
    children: { type: 'NavigationContainer', props: { id: 'nav-test' } },
    forceShow: true,
  });

  // Estado 2: Splash concluída
  markSplashCompleted();
  const rendered2 = SplashScreenGate({
    children: { type: 'NavigationContainer', props: { id: 'nav-test' } },
    forceShow: false,
  });

  // Em ambos os estados, o elemento raiz mantém o mesmo tipo e identificador
  assert.equal(rendered1.type, rendered2.type, 'Root deve manter exatamente o mesmo tipo de elemento');
  assert.equal(rendered1.props.testID, rendered2.props.testID, 'Root deve manter mesmo testID splash-screen-gate-root');

  // Em ambos os estados, o primeiro filho é a mesma View (appContainer) envolvendo children
  const appContainer1 = rendered1.props.children[0];
  const appContainer2 = rendered2.props.children[0];
  assert.equal(appContainer1.type, appContainer2.type, 'appContainer deve manter exatamente o mesmo tipo');
  assert.equal(appContainer1.props.children.type, 'NavigationContainer');
  assert.equal(appContainer2.props.children.type, 'NavigationContainer');
  assert.equal(appContainer1.props.children.props.id, appContainer2.props.children.props.id);
});

// ---------------------------------------------------------------------------
// 6. Restauração de sessão executada apenas uma vez durante todo o ciclo de vida inicial
// ---------------------------------------------------------------------------
test('SPLASH-01 (6): Restauração de sessão executada apenas uma vez durante todo o ciclo inicial', () => {
  let restoreSessionCallCount = 0;

  const mockAuthContext = {
    useAuth: () => ({
      isAuthenticated: false,
      isInitializing: false,
      sessionStatus: 'unauthenticated',
      restoreSession: async () => {
        restoreSessionCallCount++;
      },
    }),
    AuthProvider: ({ children, autoRestore }) => {
      if (autoRestore) {
        restoreSessionCallCount++;
      }
      return children;
    },
  };

  const gateWithAuth = loadModule(
    'screens/auth/AuthSessionGate.js',
    createResolver({
      '../../context/AuthContext': mockAuthContext,
    })
  ).exports.default;

  // Montar AuthSessionGate uma vez (como ocorre em App.js)
  const element = gateWithAuth({
    children: { type: 'AppNavigation', props: {} },
    autoRestore: true,
  });
  if (typeof element.type === 'function') {
    element.type(element.props);
  }

  // A contagem deve ser exatamente 1
  assert.equal(
    restoreSessionCallCount,
    1,
    'restoreSession/autoRestore deve rodar apenas 1 vez na montagem da aplicação'
  );
});

// ---------------------------------------------------------------------------
// 7. Estado de prontidão sincronizado com inicialização real da autenticação
// ---------------------------------------------------------------------------
test('SPLASH-01 (7): Sincronização do estado de prontidão com inicialização real da autenticação (isInitializing)', () => {
  let capturedInitializing = null;

  const mockAuth = {
    isAuthenticated: true,
    isInitializing: true,
    identityStatus: 'checking',
    user: { id: 'u1', name: 'Tester', roles: ['participante'], hasCompletedQuestionnaire: true },
  };

  const coordMod = loadModule(
    'screens/auth/AuthSessionGate.js',
    createResolver({
      '../../context/AuthContext': {
        useAuth: () => mockAuth,
      },
    })
  ).exports;

  // Executar AuthSessionCoordinator com callback onInitializingChange
  const restoring = coordMod.AuthSessionCoordinator({
    children: 'MainContent',
    onInitializingChange: (initializing) => {
      capturedInitializing = initializing;
    },
  });
  assert.equal(restoring.props.children[1].props.style.backgroundColor, '#1C0A35',
    'Restauração deve acompanhar a Splash');
  assert.equal(restoring.props.children[0].props.style.display, 'none',
    'conteúdo autenticado fica oculto durante a checagem');
  assert.equal(restoring.props.children[0].props.pointerEvents, 'none',
    'conteúdo oculto não recebe interação');
  assert.equal(restoring.props.children[0].props.children, 'MainContent',
    'a pilha da mesma sessão permanece montada');

  // auth.isInitializing = true -> capturedInitializing = true -> isReady = false
  assert.equal(capturedInitializing, true, 'Deve sincronizar isInitializing=true com o callback');

  // O fim da restauração não libera a Splash enquanto a identidade é checada.
  mockAuth.isInitializing = false;
  coordMod.AuthSessionCoordinator({
    children: 'MainContent',
    onInitializingChange: (initializing) => {
      capturedInitializing = initializing;
    },
  });
  assert.equal(capturedInitializing, true, 'checagem de identidade ainda bloqueia a revelação');

  mockAuth.identityStatus = 'verified';
  const verified = coordMod.AuthSessionCoordinator({
    children: 'MainContent',
    onInitializingChange: (initializing) => {
      capturedInitializing = initializing;
    },
  });
  assert.equal(capturedInitializing, false, 'Splash liberada somente após identidade confirmada');
  assert.equal(verified.props.children[0].props.children, 'MainContent');
  assert.equal(verified.props.children[0].props.pointerEvents, 'auto');

  mockAuth.identityStatus = 'error';
  const failed = coordMod.AuthSessionCoordinator({
    children: 'MainContent',
    onInitializingChange: (initializing) => {
      capturedInitializing = initializing;
    },
  });
  assert.equal(capturedInitializing, false, 'erro libera o splash inicial para mostrar recuperação');
  assert.equal(failed.props.children[0].props.style.display, 'none',
    'erro de identidade mantém o conteúdo autenticado oculto');
  assert.equal(failed.props.children[0].props.pointerEvents, 'none');
  assert.ok(failed.props.children[1], 'recuperação permanece visível');
});

// ---------------------------------------------------------------------------
// 8. Duração total de 2.500 ms no cenário padrão (700ms entrada, 1500ms sustentação, 300ms saída)
// ---------------------------------------------------------------------------
test('SPLASH-01 (8): Duração total de 2.500 ms no cenário padrão (700ms entrada, 1500ms sustentação, 300ms saída)', () => {
  const animatedSplashExports = loadModule(
    'screens/splash/AnimatedSplashScreen.js',
    createResolver()
  ).exports;

  const { ANIMATION_DEFAULTS } = animatedSplashExports;
  assert.ok(ANIMATION_DEFAULTS, 'ANIMATION_DEFAULTS deve ser exportado');

  assert.equal(ANIMATION_DEFAULTS.INTRO_DURATION_MS, 700, 'Entrada deve ter 700 ms');
  assert.equal(ANIMATION_DEFAULTS.HOLD_DURATION_MS, 1500, 'Sustentação estável deve ter 1.500 ms');
  assert.equal(ANIMATION_DEFAULTS.FADE_DURATION_MS, 300, 'Saída suave deve ter 300 ms');

  // Soma exata: 700 + 1500 + 300 = 2500 ms
  assert.equal(
    ANIMATION_DEFAULTS.INTRO_DURATION_MS +
      ANIMATION_DEFAULTS.HOLD_DURATION_MS +
      ANIMATION_DEFAULTS.FADE_DURATION_MS,
    2500,
    'Soma dos tempos das três etapas deve ser exatamente 2.500 ms'
  );
  assert.equal(ANIMATION_DEFAULTS.TARGET_TOTAL_DURATION_MS, 2500, 'TARGET_TOTAL_DURATION_MS deve ser 2500 ms');
  assert.equal(ANIMATION_DEFAULTS.MIN_DISPLAY_TIME_MS, 2200, 'MIN_DISPLAY_TIME_MS deve ser 2200 ms (700 + 1500)');
});

// ---------------------------------------------------------------------------
// 9. Nenhuma saída antes do tempo mínimo (2.200 ms)
// ---------------------------------------------------------------------------
test('SPLASH-01 (9): Nenhuma saída antes do tempo mínimo (2.200 ms)', () => {
  const animatedSplashExports = loadModule(
    'screens/splash/AnimatedSplashScreen.js',
    createResolver()
  ).exports;

  const { ANIMATION_DEFAULTS } = animatedSplashExports;

  // Tempo mínimo antes de iniciar a transição de saída (700ms intro + 1500ms hold)
  const minTime = ANIMATION_DEFAULTS.INTRO_DURATION_MS + ANIMATION_DEFAULTS.HOLD_DURATION_MS;
  assert.equal(minTime, 2200, 'Tempo mínimo de exibição antes da saída deve ser 2.200 ms');

  // O intervalo aceito de tolerância total é entre 2.0s e 3.0s
  assert.ok(ANIMATION_DEFAULTS.TARGET_TOTAL_DURATION_MS >= 2000, 'Duração total deve ser >= 2,0s');
  assert.ok(ANIMATION_DEFAULTS.TARGET_TOTAL_DURATION_MS <= 3000, 'Duração total deve ser <= 3,0s');
});

// ---------------------------------------------------------------------------
// 10. Prevenção de Splash infinita quando a inicialização excede o timeout de segurança
// ---------------------------------------------------------------------------
test('SPLASH-01 (10): Prevenção de Splash infinita quando a inicialização excede o timeout de segurança', async () => {
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
        useCallback: (fn) => fn,
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
    if (name.includes('theme')) {
      return { colors: { background: { canvas: '#05050A' } } };
    }
    if (name.includes('splashScreenService')) {
      return {
        hideNativeSplashAsync: async (m) => m?.hideAsync(),
        markSplashCompleted: () => { dismissed = true; },
      };
    }
    if (name.endsWith('.png')) {
      return 1;
    }
    return require(name);
  }).exports;

  const AnimatedSplash = animatedSplashExports.default;

  let onDismissFired = false;
  // Executar renderização do componente com isReady=false e timeouts ultra curtos para teste
  AnimatedSplash({
    isReady: false,
    animationDurationMs: 5,
    holdDurationMs: 5,
    fadeDurationMs: 5,
    maxWaitMs: 20,
    safetyTimeoutMs: 30,
    preparationTimeoutMs: 10,
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

  // Aguardar os timeouts dispararem o dismissSplash
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(nativeHideCalled, true, 'Deve ter liberado a Splash nativa');
  assert.equal(onDismissFired, true, 'Deve ter disparado onDismiss mesmo com isReady=false');
  assert.equal(dismissed, true, 'Deve ter marcado a Splash como concluída');
});

// ---------------------------------------------------------------------------
// 11. Nenhuma apresentação de logo duplicada na transição normal da Splash para a tela inicial
// ---------------------------------------------------------------------------
test('SPLASH-01 (11): Nenhuma apresentação de logo duplicada na transição normal da Splash para a tela inicial', () => {
  const mockCompletedAuth = {
    isAuthenticated: false,
    isInitializing: false, // Inicialização concluída dentro do tempo de Splash
    sessionStatus: 'unauthenticated',
    user: null,
  };

  const coordMod = loadModule(
    'screens/auth/AuthSessionGate.js',
    createResolver({
      '../../context/AuthContext': {
        useAuth: () => mockCompletedAuth,
      },
    })
  ).exports;

  const rendered = coordMod.AuthSessionCoordinator({
    children: { type: 'WelcomeScreen', props: { testID: 'welcome-screen' } },
  });

  // O contêiner do gate mantém a tela montada, sem apresentar outro logo.
  assert.equal(rendered.props.children[0].props.children.type, 'WelcomeScreen');
  assert.equal(rendered.props.children[0].props.children.props.testID, 'welcome-screen');
  assert.equal(rendered.props.children[1], null, 'sem segunda tela de restauração');
});

// ---------------------------------------------------------------------------
// 12. Proporção oficial preservada (1024/341) e responsividade da logo no container
// ---------------------------------------------------------------------------
test('SPLASH-01 (12): Proporção oficial preservada (1024/341) e responsividade da logo no container', () => {
  const animatedSplashExports = loadModule(
    'screens/splash/AnimatedSplashScreen.js',
    createResolver()
  ).exports;

  const { styles } = animatedSplashExports;
  assert.ok(styles.logo, 'styles.logo deve existir');

  // Proporção oficial 1024 / 341 = ~3.0029
  const expectedRatio = 1024 / 341;
  assert.ok(
    Math.abs(styles.logo.aspectRatio - expectedRatio) < 0.001,
    'aspectRatio da logo deve ser 1024 / 341'
  );

  // Responsividade: porcentagem da largura com limite máximo
  assert.equal(styles.logo.width, '72%', 'Logo deve ocupar 72% da largura');
  assert.equal(styles.logo.maxWidth, 320, 'Logo maxWidth deve ser 320');
});

// ---------------------------------------------------------------------------
// 13. Respeito à preferência de movimento reduzido (reduceMotion)
// ---------------------------------------------------------------------------
test('SPLASH-01 (13): Respeito à preferência de movimento reduzido (reduceMotion)', () => {
  const animatedSplashExports = loadModule(
    'screens/splash/AnimatedSplashScreen.js',
    createResolver()
  ).exports;

  const AnimatedSplash = animatedSplashExports.default;
  assert.ok(typeof AnimatedSplash === 'function');

  const React = require('react');
  const element = React.createElement(AnimatedSplash, {
    reduceMotion: true,
    isReady: true,
  });

  assert.ok(element, 'Componente deve instanciar com reduceMotion=true');
});

// ---------------------------------------------------------------------------
// 14. Erros de rede ou armazenamento na autenticação mantêm interface de recuperação utilizável
// ---------------------------------------------------------------------------
test('SPLASH-01 (14): Erros de rede ou armazenamento na autenticação mantêm tela de recuperação utilizável após a Splash', () => {
  const mockNetworkAuth = {
    isAuthenticated: false,
    isInitializing: false,
    sessionStatus: 'network_error',
    networkError: 'Falha de conexão com os servidores ArenaGo.',
    restoreSession: async () => {},
  };

  const coordMod = loadModule(
    'screens/auth/AuthSessionGate.js',
    createResolver({
      '../../context/AuthContext': {
        useAuth: () => mockNetworkAuth,
      },
    })
  ).exports;

  const rendered = coordMod.AuthSessionCoordinator({ children: 'MainApp' });
  assert.notEqual(rendered, 'MainApp');
  assert.equal(rendered.props.children[1].props.style.backgroundColor, '#1C0A35',
    'Recuperação deve acompanhar a Splash');

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
// 15. Splash não reaparece durante navegação entre telas ou abas
// ---------------------------------------------------------------------------
test('SPLASH-01 (15): Splash não reaparece durante navegação entre telas ou abas', () => {
  resetSplashScreenStateForTesting();
  markSplashCompleted();

  let splashComponentRendered = false;
  const mockAnimatedSplash = () => {
    splashComponentRendered = true;
    return null;
  };
  mockAnimatedSplash.ANIMATION_DEFAULTS = {
    INTRO_DURATION_MS: 700,
    HOLD_DURATION_MS: 1500,
    FADE_DURATION_MS: 300,
    TARGET_TOTAL_DURATION_MS: 2500,
    MIN_DISPLAY_TIME_MS: 2200,
    MAX_WAIT_MS: 3500,
    SAFETY_TIMEOUT_MS: 5000,
    PREPARATION_TIMEOUT_MS: 250,
  };

  const gate = loadModule('screens/splash/SplashScreenGate.js', (name) => {
    if (name.includes('AnimatedSplashScreen')) {
      return {
        default: mockAnimatedSplash,
        ANIMATION_DEFAULTS: mockAnimatedSplash.ANIMATION_DEFAULTS,
      };
    }
    return createResolver()(name);
  }).exports.default;

  // Simular navegação entre 5 telas/abas diferentes
  const screens = ['MainTabs', 'Arena', 'EventEntry', 'ProfileQuestionnaire', 'Evaluation'];
  for (const screenName of screens) {
    const rendered = gate({ children: `Tela_${screenName}` });
    assert.equal(splashComponentRendered, false, `Splash não pode renderizar durante navegação para ${screenName}`);
    assert.ok(rendered, 'Deve retornar a estrutura do container com os filhos');
  }
});

// ---------------------------------------------------------------------------
// 16. Transições de rota baseadas no estado de autenticação (Welcome, MainTabs, ProfileQuestionnaire, Login)
// ---------------------------------------------------------------------------
test('SPLASH-01 (16): Transições de rota baseadas no estado de autenticação', () => {
  // 1. Não autenticado -> Welcome
  assert.equal(
    resolveInitialRouteForAuthState({ isAuthenticated: false }),
    'Welcome'
  );

  // 2. Autenticado com questionário concluído -> MainTabs
  assert.equal(
    resolveInitialRouteForAuthState({
      isAuthenticated: true,
      user: { roles: ['participante'], hasCompletedQuestionnaire: true },
    }),
    'MainTabs'
  );

  // 3. Autenticado com questionário pendente -> ProfileQuestionnaire
  assert.equal(
    resolveInitialRouteForAuthState({
      isAuthenticated: true,
      user: { roles: ['participante'], hasCompletedQuestionnaire: false },
    }),
    'ProfileQuestionnaire'
  );

  assert.equal(resolveInitialRouteForAuthState({ isAuthenticated: true,
    user: { roles: ['staff'], hasCompletedQuestionnaire: false } }), 'StaffPending');
  assert.equal(resolveInitialRouteForAuthState({ isAuthenticated: true,
    user: { roles: ['admin'], hasCompletedQuestionnaire: false } }), 'AdminPending');
  assert.equal(resolveInitialRouteForAuthState({ isAuthenticated: true,
    user: { roles: [] } }), 'IdentityRecovery');

  // 4. Sessão expirada ou revogada -> Login
  assert.equal(
    resolveInitialRouteForAuthState({ isAuthenticated: false, sessionStatus: 'expired' }),
    'Login'
  );
  assert.equal(
    resolveInitialRouteForAuthState({ isAuthenticated: false, sessionStatus: 'revoked' }),
    'Login'
  );
  assert.equal(
    resolveInitialRouteForAuthState({ isAuthenticated: false, sessionStatus: 'uncertain_refresh' }),
    'Login'
  );
});

// ---------------------------------------------------------------------------
// 17. Prevenção de ocultação precoce no escopo global em app/index.js
// ---------------------------------------------------------------------------
test('SPLASH-01 (17): Prevenção de ocultação precoce no escopo global em app/index.js', () => {
  const indexSource = readFileSync(path.join(appDirectory, 'index.js'), 'utf8');

  assert.match(indexSource, /preventAutoHideAsync/, 'index.js deve referenciar preventAutoHideAsync');
  const preventCallIndex = indexSource.indexOf('preventAutoHideAsync(');
  const registerCallIndex = indexSource.indexOf('registerRootComponent(');
  assert.ok(preventCallIndex !== -1, 'preventAutoHideAsync( deve ser invocado no index.js');
  assert.ok(registerCallIndex !== -1, 'registerRootComponent( deve ser invocado no index.js');
  assert.ok(preventCallIndex < registerCallIndex, 'preventAutoHideAsync deve ser chamado ANTES de registerRootComponent');
});

// ---------------------------------------------------------------------------
// 18. Tratamento de erro quando expo-splash-screen falha ou rejeita
// ---------------------------------------------------------------------------
test('SPLASH-01 (18): Tratamento de erro quando expo-splash-screen falha ou rejeita', async () => {
  resetSplashScreenStateForTesting();

  const rejectingModule = {
    preventAutoHideAsync: async () => {
      throw new Error('E_UNSUPPORTED_PLATFORM: Expo splash screen is not supported on this platform');
    },
    hideAsync: async () => {
      throw new Error('E_ALREADY_HIDDEN: Splash screen was already hidden');
    },
  };

  const preventResult = await preventAutoHideAsync(rejectingModule);
  assert.equal(preventResult, false, 'Deve retornar false sem lançar exceção');

  const hideResult = await hideNativeSplashAsync(rejectingModule);
  assert.equal(hideResult, false, 'Deve retornar false sem lançar exceção');
});

// ---------------------------------------------------------------------------
// 19. Transição de saída com cross-fade suave (revelação gradual da tela de destino e bloqueio de toques)
// ---------------------------------------------------------------------------
test('SPLASH-01 (19): Transição de saída com cross-fade suave (revelação gradual da tela de destino e bloqueio de toques)', () => {
  resetSplashScreenStateForTesting();

  let dismissStartFired = false;
  let dismissFinishedFired = false;

  const gateMod = loadModule('screens/splash/SplashScreenGate.js', (name) => {
    if (name.includes('AnimatedSplashScreen')) {
      return {
        default: function MockAnimatedSplash(props) {
          if (props.onDismissStart) {
            props.onDismissStart();
            dismissStartFired = true;
          }
          if (props.onDismiss) {
            props.onDismiss();
            dismissFinishedFired = true;
          }
          return { type: 'AnimatedSplashScreen', props };
        },
        ANIMATION_DEFAULTS: {
          INTRO_DURATION_MS: 700,
          HOLD_DURATION_MS: 1500,
          FADE_DURATION_MS: 300,
          TARGET_TOTAL_DURATION_MS: 2500,
          MIN_DISPLAY_TIME_MS: 2200,
          MAX_WAIT_MS: 3500,
          SAFETY_TIMEOUT_MS: 5000,
          PREPARATION_TIMEOUT_MS: 250,
        },
      };
    }
    return createResolver()(name);
  }).exports;

  const SplashScreenGate = gateMod.default;

  const rendered = SplashScreenGate({
    children: { type: 'WelcomeScreen', props: { testID: 'welcome' } },
    forceShow: true,
  });

  assert.ok(rendered, 'Deve retornar contêiner estruturado');
  const [appContainer, overlay] = rendered.props.children;
  assert.ok(overlay, 'Overlay da Splash deve estar presente');

  const splashElement = overlay.props.children;
  assert.equal(typeof splashElement.props.onDismissStart, 'function', 'onDismissStart deve ser repassado');
  assert.equal(typeof splashElement.props.onDismiss, 'function', 'onDismiss deve ser repassado');

  // Executar componente de Splash mockado para disparar os callbacks
  const Component = typeof splashElement.type === 'function' ? splashElement.type : splashElement.type.default;
  Component(splashElement.props);

  assert.equal(dismissStartFired, true, 'onDismissStart deve ser acionado no início do fade-out');
  assert.equal(dismissFinishedFired, true, 'onDismiss deve ser acionado na conclusão do fade-out');
});

// ---------------------------------------------------------------------------
// 20. Preparação estrita da Splash animada (ocultação nativa e início da animação condicionados ao layout pronto)
// ---------------------------------------------------------------------------
test('SPLASH-01 (20): Preparação estrita da Splash animada (ocultação nativa e início da animação condicionados ao layout pronto)', async () => {
  resetSplashScreenStateForTesting();

  let nativeHideCalls = 0;
  const mockSplash = {
    hideAsync: async () => {
      nativeHideCalls++;
    },
  };

  const effects = [];

  const animatedSplashExports = loadModule('screens/splash/AnimatedSplashScreen.js', (name) => {
    if (name === 'react') {
      return {
        useRef: (init) => ({ current: init }),
        useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
        useEffect: (cb) => { effects.push(cb); },
        useCallback: (fn) => fn,
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
            start: (cb) => { if (cb) cb({ finished: true }); },
            stop: () => {},
          }),
          parallel: (anims) => ({
            start: (cb) => { if (cb) cb({ finished: true }); },
            stop: () => {},
          }),
          View: (props) => ({ type: 'Animated.View', props }),
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
    if (name.includes('theme')) {
      return { colors: { background: { canvas: '#05050A' } } };
    }
    if (name.includes('splashScreenService')) {
      return {
        hideNativeSplashAsync: async (m) => m?.hideAsync(),
        markSplashCompleted: () => {},
      };
    }
    if (name.endsWith('.png')) {
      return 1;
    }
    return require(name);
  }).exports;

  const AnimatedSplash = animatedSplashExports.default;

  const element = AnimatedSplash({
    isReady: true,
    animationDurationMs: 10,
    holdDurationMs: 10,
    fadeDurationMs: 10,
    preparationTimeoutMs: 500, // Timeout defensivo longo para garantir que não dispare antes do onLayout
    splashModule: mockSplash,
  });

  // Antes de onLayout: nativeHideCalls deve ser 0
  assert.equal(nativeHideCalls, 0, 'Splash nativa NÃO deve ser ocultada antes da medição de layout');

  // Disparar onLayout com medição válida da tela
  if (typeof element.props?.onLayout === 'function') {
    element.props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } });
  }

  // Agora a chamada deve ter sido realizada
  assert.equal(nativeHideCalls, 1, 'Splash nativa deve ser ocultada após onLayout com medição válida');
});
