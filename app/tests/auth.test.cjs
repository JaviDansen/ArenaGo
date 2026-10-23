const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

const apiConfigModule = loadModule('config/apiConfig.js', require).exports;
const { ApiError, createHttpClient } = loadModule(
  'services/httpClient.js',
  (name) => (name === '../config/apiConfig' ? apiConfigModule : require(name))
).exports;

function loadTokenStorageModule(platformOS = 'ios', secureStoreMock = null) {
  const defaultSecureStore = secureStoreMock || createSecureStoreDouble();
  const exportsObj = loadModule('services/tokenStorage.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: platformOS } };
    if (name === 'expo-secure-store') return defaultSecureStore;
    return require(name);
  }).exports;
  return { ...exportsObj, secureStore: defaultSecureStore };
}

function loadAuthServiceModule(overrides = {}) {
  const tokenStorageExports = overrides.tokenStorageModule || loadTokenStorageModule('ios');
  const httpClientExports = {
    ApiError,
    createHttpClient,
    httpClient: overrides.httpClient || createHttpClient({ fetchImpl: async () => { throw new Error('unconfigured fetch'); } }),
  };
  return loadModule('services/authService.js', (name) => {
    if (name === './httpClient') return httpClientExports;
    if (name === './tokenStorage') return tokenStorageExports;
    return require(name);
  }).exports;
}

function createSecureStoreDouble(initialToken = null) {
  const store = new Map();
  if (initialToken) {
    store.set('arenago.auth.refresh_token', initialToken);
  }
  const calls = { get: 0, set: 0, delete: 0 };
  return {
    store,
    calls,
    async getItemAsync(key) {
      calls.get += 1;
      return store.has(key) ? store.get(key) : null;
    },
    async setItemAsync(key, value) {
      calls.set += 1;
      store.set(key, value);
    },
    async deleteItemAsync(key) {
      calls.delete += 1;
      store.delete(key);
    },
  };
}

function jsonResponse(status, body, headers = {}) {
  const normalizedHeaders = new Map(
    Object.entries({ 'content-type': 'application/json', ...headers }).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) ?? null;
      },
    },
    async text() {
      return body === null || body === undefined ? '' : JSON.stringify(body);
    },
  };
}

function problemResponse(status, problem, headers = {}) {
  return jsonResponse(
    status,
    {
      type: `https://arenago.app/problems/${(problem.code || 'error').toLowerCase().replace(/_/g, '-')}`,
      title: problem.title || 'Erro',
      status,
      ...problem,
    },
    { 'content-type': 'application/problem+json', ...headers }
  );
}

const registrationInputs = {
  name: 'Como quer ser chamado?',
  email: 'seu.email@exemplo.com',
  password: 'Crie uma senha de acesso',
  confirmPassword: 'Digite a mesma senha novamente',
};

const loginInputs = {
  email: 'seu.email@exemplo.com',
  password: 'Digite sua senha',
};

const validRegistration = {
  name: 'Participante',
  email: 'teste@example.com',
  password: 'StrongPassword#2026',
  confirmPassword: 'StrongPassword#2026',
};

function fillForm(h, inputs, values) {
  for (const [field, value] of Object.entries(values)) {
    h.act(() => {
      const input = h.nodes.find((node) => node.type === 'TextInput' &&
        node.props.placeholder === inputs[field]);
      assert.ok(input, `missing input: ${field}`);
      input.props.onChangeText(value);
    });
  }
}

function hasText(h, text) {
  return h.nodes.some((node) => node.type === 'Text' && textOf(node) === text);
}

function createAuthRig(fetchHandler, options = {}) {
  const requests = [];
  const secureStore = createSecureStoreDouble(options.initialRefreshToken || null);
  const { createTokenStorage } = loadTokenStorageModule(options.platform || 'ios', secureStore);
  const tokenStorage = createTokenStorage({
    platformOS: options.platform || 'ios',
    secureStore,
  });

  const { createAuthSessionManager } = loadAuthServiceModule({
    tokenStorageModule: { defaultTokenStorage: tokenStorage, createTokenStorage },
  });

  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:3000',
    timeoutMs: options.timeoutMs || 200,
    fetchImpl: async (url, init = {}) => {
      const parsedBody = init.body ? JSON.parse(init.body) : undefined;
      const record = {
        url,
        method: init.method || 'GET',
        headers: init.headers || {},
        body: parsedBody,
      };
      requests.push(record);
      return fetchHandler(record, init);
    },
  });

  const manager = createAuthSessionManager({
    client,
    tokenStorage,
  });

  return { manager, httpClient: client, tokenStorage, secureStore, requests };
}

// ============================================================================
// 1. CADASTRO (RegisterScreen + AuthSessionManager.register)
// ============================================================================

test('registration button blocks invalid forms (name, email, 6/7-char or >128-char password, confirmation mismatch)', async () => {
  const cases = [
    [{ name: '   ' }, 'O nome é obrigatório.'],
    [{ name: 'A' }, 'O nome deve possuir entre 2 e 150 caracteres.'],
    [{ name: 'A'.repeat(151) }, 'O nome deve possuir entre 2 e 150 caracteres.'],
    [{ email: '' }, 'O e-mail é obrigatório.'],
    [{ email: 'email-invalido' }, 'Informe um e-mail com formato válido.'],
    [{ password: '', confirmPassword: '' }, 'A senha é obrigatória.'],
    [{ password: 'abcdef', confirmPassword: 'abcdef' }, 'A senha deve possuir no mínimo 8 caracteres.'],
    [{ password: 'abcdefg', confirmPassword: 'abcdefg' }, 'A senha deve possuir no mínimo 8 caracteres.'],
    [{ password: 'A'.repeat(129), confirmPassword: 'A'.repeat(129) }, 'A senha deve possuir no máximo 128 caracteres.'],
    [{ confirmPassword: '' }, 'A confirmação de senha é obrigatória.'],
    [{ confirmPassword: 'differentPassword123' }, 'As senhas não coincidem.'],
  ];

  for (const [invalidFields, message] of cases) {
    let apiCalled = false;
    const h = createHarness('screens/auth/RegisterScreen.js', {
      authContext: {
        register: async () => {
          apiCalled = true;
        },
      },
    });
    fillForm(h, registrationInputs, { ...validRegistration, ...invalidFields });
    await h.actAsync(() => h.press('Criar minha conta'));
    assert.equal(apiCalled, false);
    assert.deepEqual(h.navigationCalls, [], message);
    assert.ok(hasText(h, message), `missing validation error: ${message}`);
  }
});

test('valid registration sends only { name, email, password } (never confirmPassword), creates session, and navigates immediately to ProfileQuestionnaire', async () => {
  const rig = createAuthRig(async (req) => {
    if (req.url.endsWith('/api/v1/auth/register')) {
      assert.equal(req.method, 'POST');
      assert.deepEqual(Object.keys(req.body).sort(), ['email', 'name', 'password']);
      assert.equal('confirmPassword' in req.body, false);
      return jsonResponse(201, {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          name: req.body.name,
          email: req.body.email.toLowerCase(),
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: false,
        },
        accessToken: 'jwt-access-register',
        expiresIn: 900,
        refreshToken: 'opaque-refresh-register',
      });
    }
    if (req.url.endsWith('/api/v1/auth/me')) {
      assert.equal(req.headers.Authorization, 'Bearer jwt-access-register');
      return jsonResponse(200, {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ana  Maria',
        email: 'ana@example.com',
        emailVerified: false,
        roles: ['participante'],
        hasCompletedQuestionnaire: false,
      });
    }
    throw new Error(`Unexpected request: ${req.url}`);
  });

  const h = createHarness('screens/auth/RegisterScreen.js', {
    authContext: rig.manager,
  });

  fillForm(h, registrationInputs, {
    name: '  Ana  Maria  ',
    email: '  Ana@Example.com  ',
    password: 'StrongPassword#2026',
    confirmPassword: 'StrongPassword#2026',
  });

  await h.actAsync(() => h.press('Criar minha conta'));

  assert.equal(rig.requests[0].method, 'POST');
  assert.deepEqual(rig.requests[0].body, {
    name: 'Ana  Maria',
    email: 'Ana@Example.com',
    password: 'StrongPassword#2026',
  });
  assert.equal(rig.manager.getSnapshot().isAuthenticated, true);
  assert.equal(rig.manager.getAccessToken(), 'jwt-access-register');
  assert.equal(rig.manager.getSnapshot().user.hasCompletedQuestionnaire, false);
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'opaque-refresh-register');

  assert.deepEqual(structuredClone(h.navigationCalls), [{
    type: 'navigate',
    name: 'ProfileQuestionnaire',
    params: {
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ana  Maria',
        email: 'ana@example.com',
        emailVerified: false,
        roles: ['participante'],
        hasCompletedQuestionnaire: false,
      },
    },
  }]);
});

test('registration handles 409 EMAIL_ALREADY_REGISTERED, 422 PASSWORD_COMPROMISED_OR_COMMON, and 429 rate limit without navigating', async () => {
  const errorScenarios = [
    {
      response: problemResponse(409, {
        code: 'EMAIL_ALREADY_REGISTERED',
        detail: 'Já existe uma conta cadastrada com este e-mail.',
      }),
      expectedText: 'Já existe uma conta cadastrada com este e-mail.',
    },
    {
      response: problemResponse(422, {
        code: 'PASSWORD_COMPROMISED_OR_COMMON',
        detail: 'Esta senha é muito comum ou já apareceu em vazamentos. Escolha outra senha.',
      }),
      expectedText: 'Esta senha é muito comum ou já apareceu em vazamentos. Escolha outra senha.',
    },
    {
      response: problemResponse(
        429,
        {
          code: 'TOO_MANY_REGISTRATION_ATTEMPTS',
          detail: 'Muitas tentativas de cadastro.',
          retryAfterSeconds: 45,
        },
        { 'retry-after': '45' }
      ),
      expectedText: 'Muitas tentativas de cadastro. Aguarde cerca de 45s antes de tentar novamente.',
    },
  ];

  for (const scenario of errorScenarios) {
    const rig = createAuthRig(async () => scenario.response);
    const h = createHarness('screens/auth/RegisterScreen.js', {
      authContext: rig.manager,
    });
    fillForm(h, registrationInputs, validRegistration);
    await h.actAsync(() => h.press('Criar minha conta'));

    assert.deepEqual(h.navigationCalls, []);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.ok(hasText(h, scenario.expectedText), `expected message: ${scenario.expectedText}`);
  }
});

test('registration timeout informs uncertain state and offers Login verification without claiming account was not created', async () => {
  const rig = createAuthRig(
    async (_req, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      }),
    { timeoutMs: 20 }
  );

  const h = createHarness('screens/auth/RegisterScreen.js', {
    authContext: rig.manager,
  });
  fillForm(h, registrationInputs, validRegistration);
  await h.actAsync(() => h.press('Criar minha conta'));

  assert.deepEqual(h.navigationCalls, []);
  assert.ok(
    hasText(
      h,
      'O servidor demorou para responder e não foi possível confirmar se o seu cadastro foi concluído. Antes de tentar criar novamente, acesse a tela de Login para verificar se sua conta já foi criada.'
    )
  );

  h.act(() => h.press('Verificar fazendo Login'));
  assert.deepEqual(structuredClone(h.navigationCalls), [
    { type: 'navigate', name: 'Login', params: { email: 'teste@example.com' } },
  ]);
});

// ============================================================================
// 2. LOGIN (LoginScreen + AuthSessionManager.login)
// ============================================================================

test('login button blocks locally invalid forms and displays validation errors', async () => {
  const cases = [
    [{ email: '   ', password: 'x' }, 'O e-mail é obrigatório.'],
    [{ email: 'email-invalido', password: 'x' }, 'Informe um e-mail com formato válido.'],
    [{ email: 'teste@example.com', password: '' }, 'A senha é obrigatória.'],
  ];
  for (const [values, message] of cases) {
    const h = createHarness('screens/auth/LoginScreen.js', {
      authContext: { login: async () => {} },
    });
    fillForm(h, loginInputs, values);
    await h.actAsync(() => h.press('Entrar na conta'));
    assert.deepEqual(h.navigationCalls, [], message);
    assert.ok(hasText(h, message), `missing validation error: ${message}`);
  }
});

test('login succeeds with completed questionnaire and with pending questionnaire (allowing resumption from HomeScreen)', async () => {
  for (const hasCompletedQuestionnaire of [true, false]) {
    const rig = createAuthRig(async (req) => {
      if (req.url.endsWith('/api/v1/auth/login')) {
        assert.equal(req.method, 'POST');
        return jsonResponse(200, {
          user: {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Participante',
            email: req.body.email,
            emailVerified: false,
            roles: ['participante'],
            hasCompletedQuestionnaire,
          },
          accessToken: 'jwt-login-token',
          expiresIn: 900,
          refreshToken: 'opaque-login-refresh',
        });
      }
      if (req.url.endsWith('/api/v1/auth/me')) {
        assert.equal(req.headers.Authorization, 'Bearer jwt-login-token');
        return jsonResponse(200, {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Participante',
          email: 'teste@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire,
        });
      }
      throw new Error(`Unexpected request: ${req.url}`);
    });

    const h = createHarness('screens/auth/LoginScreen.js', {
      authContext: rig.manager,
    });
    fillForm(h, loginInputs, {
      email: '  teste@example.com  ',
      password: 'StrongPassword#2026',
    });
    await h.actAsync(() => h.press('Entrar na conta'));

    assert.equal(rig.manager.getSnapshot().isAuthenticated, true);
    assert.equal(
      rig.manager.getSnapshot().user.hasCompletedQuestionnaire,
      hasCompletedQuestionnaire
    );
    assert.deepEqual(h.navigationCalls, [
      { type: 'navigate', name: 'MainTabs', params: undefined },
    ]);

    // Verify HomeScreen behavior for questionnaire status
    const home = createHarness('screens/home/HomeScreen.js', {
      authContext: {
        ...rig.manager.getSnapshot(),
        logout: () => rig.manager.logout(),
      },
    });
    assert.equal(
      hasText(home, 'Completar questionário de perfil'),
      !hasCompletedQuestionnaire
    );
    if (!hasCompletedQuestionnaire) {
      home.act(() => home.press('Completar questionário de perfil'));
      assert.equal(home.navigationCalls[0].name, 'ProfileQuestionnaire');
    }
  }
});

test('login handles 401 invalid credentials, network failure, and 429 rate limit without simulated login fallback', async () => {
  // 401 Invalid credentials
  const rig401 = createAuthRig(async () =>
    problemResponse(401, {
      code: 'INVALID_CREDENTIALS',
      detail: 'E-mail ou senha inválidos.',
    })
  );
  const h401 = createHarness('screens/auth/LoginScreen.js', {
    authContext: rig401.manager,
  });
  fillForm(h401, loginInputs, { email: 'teste@example.com', password: 'wrong' });
  await h401.actAsync(() => h401.press('Entrar na conta'));
  assert.deepEqual(h401.navigationCalls, []);
  assert.equal(rig401.manager.getSnapshot().isAuthenticated, false);
  assert.ok(hasText(h401, 'E-mail ou senha inválidos.'));

  // Network error
  const rigNet = createAuthRig(async () => {
    throw new TypeError('Network request failed');
  });
  const hNet = createHarness('screens/auth/LoginScreen.js', {
    authContext: rigNet.manager,
  });
  fillForm(hNet, loginInputs, { email: 'teste@example.com', password: 'secret' });
  await hNet.actAsync(() => hNet.press('Entrar na conta'));
  assert.deepEqual(hNet.navigationCalls, []);
  assert.equal(rigNet.manager.getSnapshot().isAuthenticated, false);
  assert.ok(
    hasText(
      hNet,
      'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.'
    )
  );

  // 429 Rate limit
  const rig429 = createAuthRig(async () =>
    problemResponse(
      429,
      {
        code: 'TOO_MANY_LOGIN_ATTEMPTS',
        detail: 'Muitas tentativas de login.',
        retryAfterSeconds: 60,
      },
      { 'retry-after': '60' }
    )
  );
  const h429 = createHarness('screens/auth/LoginScreen.js', {
    authContext: rig429.manager,
  });
  fillForm(h429, loginInputs, { email: 'teste@example.com', password: 'secret' });
  await h429.actAsync(() => h429.press('Entrar na conta'));
  assert.deepEqual(h429.navigationCalls, []);
  assert.equal(rig429.manager.getSnapshot().isAuthenticated, false);
  assert.ok(
    hasText(
      h429,
      'Muitas tentativas de login. Aguarde cerca de 60s antes de tentar novamente.'
    )
  );
});

test('Admin login with requires2FA: true does not grant authenticated access or store tempToken as accessToken/refreshToken', async () => {
  const rig = createAuthRig(
    async () =>
      jsonResponse(200, {
        requires2FA: true,
        isTotpConfigured: true,
        tempToken: 'temp-admin-challenge-jwt',
        message: 'Confirmação de segundo fator obrigatória.',
      }),
    { initialRefreshToken: 'stale-previous-refresh-token' }
  );

  const h = createHarness('screens/auth/LoginScreen.js', {
    authContext: rig.manager,
  });
  fillForm(h, loginInputs, { email: 'admin@arenago.app', password: 'AdminPassword#2026' });
  await h.actAsync(() => h.press('Entrar na conta'));

  assert.deepEqual(h.navigationCalls, []);
  const snapshot = rig.manager.getSnapshot();
  assert.equal(snapshot.isAuthenticated, false);
  assert.equal(rig.manager.getAccessToken(), null);
  assert.equal(snapshot.user, null);
  assert.equal(rig.secureStore.store.has('arenago.auth.refresh_token'), false);
  assert.equal(snapshot.adminChallenge.requires2FA, true);
  assert.equal('tempToken' in snapshot.adminChallenge, false);
  assert.ok(
    hasText(
      h,
      'Confirmação de segundo fator obrigatória. Informe o código do segundo fator (TOTP) para concluir o acesso administrativo.'
    )
  );
});

// ============================================================================
// 3. AUTH CONTEXT, RESTAURAÇÃO, SINGLE-FLIGHT REFRESH, LOGOUT E SEGURANÇA
// ============================================================================

test('startup without refresh token transitions cleanly to unauthenticated without calling backend', async () => {
  const rig = createAuthRig(async () => {
    throw new Error('should not call backend when no refresh token is stored');
  });

  const result = await rig.manager.restoreSession();
  assert.equal(result.status, 'unauthenticated');
  assert.equal(rig.requests.length, 0);
  assert.equal(rig.manager.getSnapshot().isInitializing, false);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.manager.getSnapshot().sessionStatus, 'unauthenticated');
});

test('startup with valid refresh token rotates token in SecureStore and loads /auth/me', async () => {
  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        assert.equal(req.body.refreshToken, 'stored-refresh-v1');
        return jsonResponse(200, {
          accessToken: 'restored-access-jwt',
          expiresIn: 900,
          refreshToken: 'stored-refresh-v2',
        });
      }
      if (req.url.endsWith('/api/v1/auth/me')) {
        assert.equal(req.headers.Authorization, 'Bearer restored-access-jwt');
        return jsonResponse(200, {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Restaurado',
          email: 'restaurado@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        });
      }
      throw new Error(`Unexpected request: ${req.url}`);
    },
    { initialRefreshToken: 'stored-refresh-v1' }
  );

  const result = await rig.manager.restoreSession();
  assert.equal(result.status, 'authenticated');
  assert.equal(rig.manager.getSnapshot().isAuthenticated, true);
  assert.equal(rig.manager.getAccessToken(), 'restored-access-jwt');
  assert.equal(rig.manager.getSnapshot().user.email, 'restaurado@example.com');
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'stored-refresh-v2');
});

test('startup network error preserves refreshToken in SecureStore and reports network error', async () => {
  const rig = createAuthRig(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    { initialRefreshToken: 'keep-me-on-offline-startup' }
  );

  const result = await rig.manager.restoreSession();
  assert.equal(result.status, 'network_error');
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'keep-me-on-offline-startup');
  assert.ok(rig.manager.getSnapshot().networkError);
});

test('two concurrent 401 responses on protected endpoints trigger only ONE single-flight POST /auth/refresh and retry once', async () => {
  let refreshCount = 0;
  let resourceACount = 0;
  let resourceBCount = 0;

  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        refreshCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        assert.equal(req.body.refreshToken, 'refresh-before-401');
        return jsonResponse(200, {
          accessToken: 'fresh-access-jwt',
          expiresIn: 900,
          refreshToken: 'refresh-after-401',
        });
      }
      if (req.url.endsWith('/api/v1/events/active')) {
        resourceACount += 1;
        if (req.headers.Authorization !== 'Bearer fresh-access-jwt') {
          return problemResponse(401, {
            code: 'INVALID_ACCESS_TOKEN',
            detail: 'Access token expirado.',
          });
        }
        return jsonResponse(200, { eventId: 'evt-1' });
      }
      if (req.url.endsWith('/api/v1/auth/me')) {
        resourceBCount += 1;
        if (req.headers.Authorization !== 'Bearer fresh-access-jwt') {
          return problemResponse(401, {
            code: 'INVALID_ACCESS_TOKEN',
            detail: 'Access token expirado.',
          });
        }
        return jsonResponse(200, {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Participante',
          email: 'p@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        });
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'refresh-before-401' }
  );

  await rig.tokenStorage.setRefreshToken('refresh-before-401');

  const [resA, resB] = await Promise.all([
    rig.httpClient.get('/events/active', { auth: true }),
    rig.httpClient.get('/auth/me', { auth: true }),
  ]);

  assert.equal(refreshCount, 1, 'must execute only one POST /auth/refresh for concurrent 401s');
  assert.equal(resourceACount, 2);
  assert.equal(resourceBCount, 2);
  assert.deepEqual(structuredClone(resA), { eventId: 'evt-1' });
  assert.equal(resB.email, 'p@example.com');
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'refresh-after-401');
});

test('refresh timeout prevents automatic replay of the uncertain refreshToken', async () => {
  let refreshCalls = 0;
  const rig = createAuthRig(
    async (req, init) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'token-with-timeout', timeoutMs: 20 }
  );

  await assert.rejects(
    () => rig.manager.refreshSession(),
    (error) => error.kind === 'timeout' && error.outcomeUnknown === true
  );
  assert.equal(refreshCalls, 1);

  // Subsequent automatic attempt must NOT send another POST /auth/refresh
  await assert.rejects(
    () => rig.manager.refreshSession(),
    (error) => error.code === 'UNCERTAIN_REFRESH_OUTCOME'
  );
  assert.equal(refreshCalls, 1, 'must not replay refresh token after uncertain timeout');
});

test('session revoked by new login (SESSION_REVOKED) or invalid refresh token clears storage and sets friendly notice', async () => {
  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        return problemResponse(401, {
          code: 'SESSION_REVOKED',
          detail: 'Sessão encerrada porque sua conta foi acessada em outro dispositivo.',
        });
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'revoked-refresh-token' }
  );

  const result = await rig.manager.restoreSession();
  assert.equal(result.status, 'revoked');
  assert.equal(rig.secureStore.store.has('arenago.auth.refresh_token'), false);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.manager.getSnapshot().sessionStatus, 'revoked');
  assert.equal(
    rig.manager.getSnapshot().authNotice,
    'Sua sessão foi encerrada (por exemplo, após um novo acesso em outro dispositivo). Faça login novamente.'
  );
});

test('logout revokes session on backend via POST /auth/logout with Bearer accessToken and clears local state; network failure still clears local state with warning', async () => {
  // 1. Clean server logout (200 OK)
  const rigOk = createAuthRig(async (req) => {
    if (req.url.endsWith('/api/v1/auth/login')) {
      return jsonResponse(200, {
        user: {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Participante',
          email: 'p@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        },
        accessToken: 'jwt-active',
        expiresIn: 900,
        refreshToken: 'refresh-active',
      });
    }
    if (req.url.endsWith('/api/v1/auth/me')) {
      return jsonResponse(200, {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Participante',
        email: 'p@example.com',
        emailVerified: false,
        roles: ['participante'],
        hasCompletedQuestionnaire: true,
      });
    }
    if (req.url.endsWith('/api/v1/auth/logout')) {
      assert.equal(req.headers.Authorization, 'Bearer jwt-active');
      return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
    }
    throw new Error(`Unexpected URL: ${req.url}`);
  });

  await rigOk.manager.login({ email: 'p@example.com', password: 'StrongPassword#2026' });
  assert.equal(rigOk.manager.getSnapshot().isAuthenticated, true);

  const logoutRes = await rigOk.manager.logout();
  assert.equal(logoutRes.localLoggedOut, true);
  assert.equal(logoutRes.remoteRevoked, true);
  assert.equal(rigOk.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rigOk.manager.getAccessToken(), null);
  assert.equal(rigOk.manager.getSnapshot().user, null);
  assert.equal(rigOk.secureStore.store.has('arenago.auth.refresh_token'), false);

  // 2. Network error during logout still clears local credentials and sets honest warning
  let failLogout = false;
  const rigNet = createAuthRig(async (req) => {
    if (req.url.endsWith('/api/v1/auth/login')) {
      return jsonResponse(200, {
        user: {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Participante',
          email: 'p@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        },
        accessToken: 'jwt-before-offline-logout',
        expiresIn: 900,
        refreshToken: 'refresh-before-offline-logout',
      });
    }
    if (req.url.endsWith('/api/v1/auth/me')) {
      return jsonResponse(200, {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Participante',
        email: 'p@example.com',
        emailVerified: false,
        roles: ['participante'],
        hasCompletedQuestionnaire: true,
      });
    }
    if (req.url.endsWith('/api/v1/auth/logout') && failLogout) {
      throw new TypeError('Network down');
    }
    throw new Error(`Unexpected URL: ${req.url}`);
  });

  await rigNet.manager.login({ email: 'p@example.com', password: 'StrongPassword#2026' });
  failLogout = true;

  const offlineLogout = await rigNet.manager.logout();
  assert.equal(offlineLogout.localLoggedOut, true);
  assert.equal(offlineLogout.remoteRevoked, false);
  assert.equal(rigNet.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rigNet.secureStore.store.has('arenago.auth.refresh_token'), false);
  assert.match(
    rigNet.manager.getSnapshot().authNotice,
    /Sua sessão foi encerrada neste dispositivo, mas não foi possível confirmar a revogação no servidor/
  );
});

test('stale in-flight refresh response does not restore session after logout (sessionEpoch guard)', async () => {
  let resolveRefresh;
  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      }
      if (req.url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'in-flight-refresh-token' }
  );

  const pendingRefresh = rig.manager.refreshSession();
  await new Promise((resolve) => setTimeout(resolve, 5));

  // User logs out before refresh finishes
  await rig.manager.logout();
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);

  // Now the delayed refresh response arrives
  resolveRefresh(
    jsonResponse(200, {
      accessToken: 'stale-access-token',
      expiresIn: 900,
      refreshToken: 'stale-refresh-token',
    })
  );

  const refreshResult = await pendingRefresh;
  assert.equal(refreshResult, null);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.manager.getAccessToken(), null);
  assert.equal(rig.secureStore.store.has('arenago.auth.refresh_token'), false);
});

test('web platform keeps refresh token only in memory and never calls SecureStore, localStorage, or sessionStorage', async () => {
  const secureStore = createSecureStoreDouble();
  const { createTokenStorage } = loadTokenStorageModule('web', secureStore);
  const webStorage = createTokenStorage({
    platformOS: 'web',
    secureStore,
  });

  assert.equal(webStorage.isPersistent, false);
  await webStorage.setRefreshToken('web-memory-only-token');
  assert.equal(await webStorage.getRefreshToken(), 'web-memory-only-token');
  assert.equal(secureStore.calls.set, 0);
  assert.equal(secureStore.calls.get, 0);

  await webStorage.clearRefreshToken();
  assert.equal(await webStorage.getRefreshToken(), null);
  assert.equal(secureStore.calls.delete, 0);
});

test('401 session expiration does not clear or mutate ParticipationContext state', async () => {
  let capturedParticipation = { id: 'part-1', status: 'active' };
  const participationModule = loadModule('context/ParticipationContext.js', (name) => {
    if (name === 'react') {
      return {
        createContext: (defaultValue) => ({ _defaultValue: defaultValue, Provider: 'Provider' }),
        useState: () => [
          capturedParticipation,
          (next) => {
            capturedParticipation = typeof next === 'function' ? next(capturedParticipation) : next;
          },
        ],
      };
    }
    return require(name);
  }).exports;

  const tree = participationModule.ParticipationProvider({ children: 'child' });
  assert.deepEqual(structuredClone(tree.props.value.participation), {
    id: 'part-1',
    status: 'active',
  });

  const rig = createAuthRig(
    async () =>
      problemResponse(401, {
        code: 'SESSION_REVOKED',
        detail: 'Sessão revogada.',
      }),
    { initialRefreshToken: 'revoked-token' }
  );

  await rig.manager.restoreSession();
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(typeof participationModule.ParticipationProvider, 'function');
  assert.deepEqual(capturedParticipation, { id: 'part-1', status: 'active' });
});
