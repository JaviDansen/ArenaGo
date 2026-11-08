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
    now: options.now,
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

test('valid registration sends only { name, email, password } (never confirmPassword), creates session, and leaves routing to AuthSessionGate', async () => {
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

  assert.deepEqual(h.navigationCalls, []);
  assert.equal(rig.manager.getSnapshot().postAuthRoute, 'ProfileQuestionnaire');
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
    assert.deepEqual(h.navigationCalls, []);
    assert.equal(
      rig.manager.getSnapshot().postAuthRoute,
      hasCompletedQuestionnaire ? 'MainTabs' : 'ProfileQuestionnaire'
    );

    // Verifica o comportamento da HomeScreen conforme o estado do questionário.
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
  // 401: credenciais inválidas
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

  // Falha de rede
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

  // 429: limite de requisições excedido
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
// Login Admin: confirmação real de segundo fator, com rede e SecureStore simulados.
const adminUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Admin de teste', email: 'admin@example.test',
  emailVerified: true, roles: ['participante', 'admin'], hasCompletedQuestionnaire: true,
};
const adminSession = { user: adminUser, accessToken: 'admin-access-after-2fa',
  refreshToken: 'admin-refresh-after-2fa', expiresIn: 900 };
const adminChallengeBody = { requires2FA: true, isTotpConfigured: true,
  tempToken: 'temporary-challenge-only-in-memory', message: 'Informe o segundo fator para concluir o acesso.' };

function adminRig(verify = async () => jsonResponse(200, adminSession), options = {}) {
  return createAuthRig(async (request, init) => {
    if (request.url.endsWith('/auth/login')) return jsonResponse(200, { ...adminChallengeBody, ...options.challenge });
    if (request.url.endsWith('/auth/2fa/verify')) return verify(request, init);
    if (request.url.endsWith('/auth/me')) return jsonResponse(200, adminUser);
    throw new Error('Unexpected request in the Admin fixture');
  }, options);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function beginAdminChallenge(rig) {
  return rig.manager.login({ email: adminUser.email, password: 'ValidPassword#2026' });
}

test('TOTP: Participante e Staff continuam autenticando apenas pelo contrato de senha', async () => {
  for (const roles of [['participante'], ['participante', 'staff']]) {
    const user = { ...adminUser, roles };
    const rig = createAuthRig(async (request) => request.url.endsWith('/auth/login')
      ? jsonResponse(200, { ...adminSession, user }) : jsonResponse(200, user));
    assert.equal((await beginAdminChallenge(rig)).status, 'authenticated');
    assert.equal(rig.manager.getSnapshot().adminChallenge, null);
    assert.equal(rig.requests.some((request) => request.url.endsWith('/auth/2fa/verify')), false);
  }
});

test('TOTP: AuthContext disponibiliza verificação e cancelamento sem expor o token temporário', async () => {
  const rig = adminRig();
  await beginAdminChallenge(rig);
  const module = loadModule('context/AuthContext.js', (name) => {
    if (name === 'react') return {
      createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
      useRef: (value) => ({ current: value }), useEffect() {},
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    };
    if (name === '../services/authService') return { createAuthSessionManager: () => rig.manager };
    if (name === '../services/httpClient') return { httpClient: rig.httpClient };
    if (name === '../services/tokenStorage') return { defaultTokenStorage: rig.tokenStorage };
    return require(name);
  }).exports;
  const value = module.AuthProvider({ sessionManager: rig.manager, autoRestore: false }).props.value;
  assert.equal(value.verifyAdminTwoFactor, rig.manager.verifyAdminTwoFactor);
  assert.equal(value.cancelAdminTwoFactor, rig.manager.cancelAdminTwoFactor);
  assert.equal('tempToken' in value.adminChallenge, false);
  value.cancelAdminTwoFactor();
});

test('TOTP: código válido confirma pelo endpoint correto e publica sessão pelo fluxo existente', async () => {
  const rig = adminRig(async (request) => {
    assert.deepEqual(request.body, { tempToken: adminChallengeBody.tempToken, code: '012345' });
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.equal(rig.manager.getAccessToken(), null);
    assert.equal(rig.secureStore.store.size, 0);
    return jsonResponse(200, adminSession);
  });
  await beginAdminChallenge(rig);
  assert.equal(JSON.stringify(rig.manager.getSnapshot()).includes(adminChallengeBody.tempToken), false);
  const result = await rig.manager.verifyAdminTwoFactor('012345');
  assert.equal(result.status, 'authenticated');
  assert.equal(result.nextRoute, 'MainTabs');
  assert.equal(rig.manager.getSnapshot().user.id, adminUser.id);
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
  assert.equal(rig.manager.getAccessToken(), adminSession.accessToken);
  assert.equal(await rig.tokenStorage.getRefreshToken(), adminSession.refreshToken);
  assert.equal(rig.requests.filter((request) => request.url.endsWith('/auth/login')).length, 1);
  await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.code === 'ADMIN_2FA_CHALLENGE_EXPIRED');
  assert.equal(rig.requests.filter((request) => request.url.endsWith('/auth/2fa/verify')).length, 1);
});

test('TOTP: código inválido não autentica e permite informar outro código no mesmo desafio', async () => {
  let attempts = 0;
  const rig = adminRig(async () => ++attempts === 1
    ? problemResponse(401, { code: 'ADMIN_2FA_INVALID', detail: 'Segundo fator inválido.' })
    : jsonResponse(200, adminSession));
  await beginAdminChallenge(rig);
  await assert.rejects(rig.manager.verifyAdminTwoFactor('111111'), (error) => error.status === 401);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.manager.getAccessToken(), null);
  assert.equal(rig.secureStore.store.size, 0);
  assert.equal(rig.manager.getSnapshot().adminChallenge.isTotpConfigured, true);
  assert.equal((await rig.manager.verifyAdminTwoFactor('012345')).status, 'authenticated');
  assert.equal(rig.requests[1].body.tempToken, rig.requests[2].body.tempToken);
});

test('TOTP: formato inválido e desafio expirado são recusados antes da rede', async () => {
  let time = 1_000_000;
  const rig = adminRig(undefined, { now: () => time });
  await beginAdminChallenge(rig);
  await assert.rejects(rig.manager.verifyAdminTwoFactor('123'), (error) => error.code === 'VALIDATION_ERROR');
  time += 300_000;
  await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.code === 'ADMIN_2FA_CHALLENGE_EXPIRED');
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
});

test('TOTP: cancelamento, logout e invalidação eliminam o desafio sem persistir seu token', async () => {
  for (const terminate of [
    (manager) => manager.cancelAdminTwoFactor(),
    (manager) => manager.logout(),
    (manager) => manager.client.get('/protected', { auth: true }),
  ]) {
    const rig = createAuthRig(async (request) => request.url.endsWith('/auth/login')
      ? jsonResponse(200, adminChallengeBody)
      : problemResponse(401, { code: 'SESSION_REVOKED', detail: 'Sessão revogada.' }));
    await beginAdminChallenge(rig);
    try { await terminate(rig.manager); } catch (error) { assert.equal(error.code, 'SESSION_REVOKED'); }
    await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.code === 'ADMIN_2FA_CHALLENGE_EXPIRED');
    assert.equal(rig.manager.getSnapshot().adminChallenge, null);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.equal(rig.secureStore.store.size, 0);
    assert.equal(rig.requests.some((request) => request.url.endsWith('/auth/2fa/verify')), false);
  }
});

test('TOTP: confirmações concorrentes compartilham uma única requisição e sessão', async () => {
  const entered = deferred(), response = deferred();
  const rig = adminRig(() => { entered.resolve(); return response.promise; });
  await beginAdminChallenge(rig);
  const first = rig.manager.verifyAdminTwoFactor('012345');
  const second = rig.manager.verifyAdminTwoFactor('012345');
  assert.equal(first, second);
  await entered.promise;
  assert.equal(rig.requests.filter((request) => request.url.endsWith('/auth/2fa/verify')).length, 1);
  response.resolve(jsonResponse(200, adminSession));
  assert.equal((await first).status, 'authenticated');
  assert.equal((await second).status, 'authenticated');
  assert.equal(rig.secureStore.calls.set, 1);
});

test('TOTP: cancelamento e logout durante confirmação descartam a resposta atrasada', async () => {
  for (const terminate of [(manager) => manager.cancelAdminTwoFactor(), (manager) => manager.logout()]) {
    const entered = deferred(), response = deferred();
    const rig = adminRig(() => { entered.resolve(); return response.promise; });
    await beginAdminChallenge(rig);
    const pending = rig.manager.verifyAdminTwoFactor('012345');
    await entered.promise;
    await terminate(rig.manager);
    response.resolve(jsonResponse(200, adminSession));
    assert.equal((await pending).status, 'aborted');
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.equal(rig.manager.getSnapshot().adminChallenge, null);
    assert.equal(rig.secureStore.calls.set, 0);
  }
});

test('TOTP: novo login de outra conta vence uma confirmação antiga sem contaminar tokens', async () => {
  const entered = deferred(), response = deferred();
  const otherUser = { ...adminUser, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', roles: ['participante'] };
  const rig = createAuthRig(async (request) => {
    if (request.url.endsWith('/auth/login')) return jsonResponse(200, request.body.email === adminUser.email
      ? adminChallengeBody : { ...adminSession, user: otherUser, accessToken: 'other-access', refreshToken: 'other-refresh' });
    if (request.url.endsWith('/auth/2fa/verify')) { entered.resolve(); return response.promise; }
    if (request.url.endsWith('/auth/me')) return jsonResponse(200, otherUser);
    throw new Error('Unexpected request');
  });
  await beginAdminChallenge(rig);
  const old = rig.manager.verifyAdminTwoFactor('012345');
  await entered.promise;
  await rig.manager.login({ email: 'other@example.test', password: 'ValidPassword#2026' });
  response.resolve(jsonResponse(200, adminSession));
  assert.equal((await old).status, 'aborted');
  assert.equal(rig.manager.getSnapshot().user.id, otherUser.id);
  assert.equal(rig.manager.getAccessToken(), 'other-access');
  assert.equal(await rig.tokenStorage.getRefreshToken(), 'other-refresh');
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
});

test('TOTP: novo login substitui o token temporário e respostas de senha antigas são descartadas', async () => {
  const entered = deferred(), oldLogin = deferred();
  let calls = 0;
  const rig = createAuthRig(async (request) => {
    if (request.url.endsWith('/auth/login')) {
      calls++;
      if (calls === 1) { entered.resolve(); return oldLogin.promise; }
      return jsonResponse(200, { ...adminChallengeBody, tempToken: 'new-private-challenge' });
    }
    if (request.url.endsWith('/auth/2fa/verify')) {
      assert.equal(request.body.tempToken, 'new-private-challenge');
      return jsonResponse(200, adminSession);
    }
    return jsonResponse(200, adminUser);
  });
  const old = beginAdminChallenge(rig);
  await entered.promise;
  await beginAdminChallenge(rig);
  oldLogin.resolve(jsonResponse(200, adminChallengeBody));
  assert.equal((await old).status, 'aborted');
  assert.equal((await rig.manager.verifyAdminTwoFactor('012345')).status, 'authenticated');
});

test('TOTP: rede e timeout não repetem confirmação incerta e exigem novo login', async () => {
  for (const timeout of [false, true]) {
    const rig = adminRig(async (request, init) => {
      if (!timeout) throw new Error('Connection lost');
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Timeout'), { name: 'AbortError' })), { once: true });
      });
    }, { timeoutMs: 20 });
    await beginAdminChallenge(rig);
    await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.isNetworkError && (!timeout || error.isTimeout));
    assert.equal(rig.manager.getSnapshot().adminChallenge, null);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.code === 'ADMIN_2FA_CHALLENGE_EXPIRED');
    assert.equal(rig.requests.filter((request) => request.url.endsWith('/auth/2fa/verify')).length, 1);
  }
});

test('TOTP: respostas 503 e 429 mantêm suas políticas sem emitir sessão', async () => {
  for (const status of [503, 429]) {
    const rig = adminRig(async () => problemResponse(status, {
      code: status === 503 ? 'TOTP_CONFIGURATION_UNAVAILABLE' : 'ADMIN_2FA_RATE_LIMITED',
    }, status === 429 ? { 'Retry-After': '900' } : {}));
    await beginAdminChallenge(rig);
    await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.status === status);
    assert.equal(Boolean(rig.manager.getSnapshot().adminChallenge), status === 503);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.equal(rig.secureStore.calls.set, 0);
    rig.manager.cancelAdminTwoFactor();
  }
});

test('TOTP: resposta incompleta e falha do SecureStore não publicam sessão', async () => {
  for (const storageFailure of [false, true]) {
    const rig = adminRig(async () => jsonResponse(200, storageFailure ? adminSession : { user: adminUser }));
    await beginAdminChallenge(rig);
    if (storageFailure) rig.secureStore.setItemAsync = async () => { throw new Error('Keystore unavailable'); };
    await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'));
    assert.equal(rig.manager.getSnapshot().adminChallenge, null);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.equal(rig.manager.getAccessToken(), null);
    assert.equal(rig.secureStore.store.size, 0);
  }
});

test('TOTP: restauração e refresh não usam o desafio temporário como credencial', async () => {
  const rig = adminRig();
  await beginAdminChallenge(rig);
  assert.equal((await rig.manager.restoreSession()).status, 'admin_2fa_required');
  assert.equal(await rig.manager.refreshSession(), null);
  assert.equal(rig.requests.length, 1);
  rig.manager.cancelAdminTwoFactor();
});

test('TOTP: sessão confirmada usa a restauração e a renovação já existentes', async () => {
  const rig = adminRig();
  await beginAdminChallenge(rig);
  await rig.manager.verifyAdminTwoFactor('012345');
  const restored = createAuthRig(async (request) => {
    if (request.url.endsWith('/auth/refresh')) {
      assert.equal(request.body.refreshToken, adminSession.refreshToken);
      return jsonResponse(200, { accessToken: 'restored-admin-access',
        refreshToken: 'rotated-admin-refresh', expiresIn: 900 });
    }
    assert.ok(request.url.endsWith('/auth/me'));
    assert.equal(request.headers.Authorization, 'Bearer restored-admin-access');
    return jsonResponse(200, adminUser);
  }, { initialRefreshToken: await rig.tokenStorage.getRefreshToken() });
  await restored.manager.restoreSession();
  assert.equal(restored.manager.getSnapshot().isAuthenticated, true);
  assert.equal(restored.manager.getSnapshot().user.id, adminUser.id);
  assert.equal(restored.manager.getSnapshot().adminChallenge, null);
  assert.equal(await restored.tokenStorage.getRefreshToken(), 'rotated-admin-refresh');
});

test('TOTP: cancelamento ou logout durante gravação do refresh removem a credencial atrasada', async () => {
  for (const terminate of [(manager) => manager.logout(), (manager) => manager.cancelAdminTwoFactor()]) {
    const entered = deferred(), release = deferred();
    const rig = adminRig();
    await beginAdminChallenge(rig);
    const originalWrite = rig.secureStore.setItemAsync;
    rig.secureStore.setItemAsync = async (...args) => {
      entered.resolve();
      await release.promise;
      return originalWrite(...args);
    };
    const confirmation = rig.manager.verifyAdminTwoFactor('012345');
    await entered.promise;
    const terminated = terminate(rig.manager);
    release.resolve();
    assert.equal((await confirmation).status, 'aborted');
    await terminated;
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    assert.equal(rig.manager.getAccessToken(), null);
    assert.equal(rig.secureStore.store.size, 0);
  }
});

test('TOTP: cancelamento durante login descarta o desafio que chegar depois', async () => {
  const entered = deferred(), response = deferred();
  const rig = createAuthRig(() => { entered.resolve(); return response.promise; });
  const pending = beginAdminChallenge(rig);
  await entered.promise;
  rig.manager.cancelAdminTwoFactor();
  response.resolve(jsonResponse(200, adminChallengeBody));
  assert.equal((await pending).status, 'aborted');
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
});

test('TOTP: desafio sem tempToken é recusado e não autentica', async () => {
  const rig = adminRig(undefined, { challenge: { tempToken: undefined } });
  await assert.rejects(beginAdminChallenge(rig), (error) => error.code === 'INVALID_LOGIN_RESPONSE');
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.secureStore.calls.set, 0);
});

test('TOTP: resposta de confirmação recebida após o prazo local não restaura a sessão', async () => {
  let time = 1_000_000;
  const entered = deferred(), response = deferred();
  const rig = adminRig(() => { entered.resolve(); return response.promise; }, { now: () => time });
  await beginAdminChallenge(rig);
  const pending = rig.manager.verifyAdminTwoFactor('012345');
  await entered.promise;
  time += 300_000;
  response.resolve(jsonResponse(200, adminSession));
  assert.equal((await pending).status, 'aborted');
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
  assert.equal(rig.secureStore.calls.set, 0);
});

test('TOTP UI: campo numérico, loading e cancelamento preservam a navegação e evitam duplo toque', async () => {
  const entered = deferred(), response = deferred();
  const rig = adminRig(() => { entered.resolve(); return response.promise; });
  const h = createHarness('screens/auth/LoginScreen.js', { authContext: rig.manager });
  fillForm(h, loginInputs, { email: adminUser.email, password: 'ValidPassword#2026' });
  await h.actAsync(() => h.press('Entrar na conta'));
  const input = h.nodes.find((node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Código TOTP');
  assert.ok(input);
  assert.equal(input.props.keyboardType, 'number-pad');
  assert.equal(input.props.maxLength, 6);
  assert.equal(h.nodes.some((node) => node.props?.placeholder === loginInputs.password), false);
  h.act(() => input.props.onChangeText('01a2345'));
  let pending;
  h.act(() => {
    const button = h.nodes.find((node) => node.props?.accessibilityLabel === 'Verificar código');
    pending = button.props.onPress();
    button.props.onPress();
  });
  await entered.promise;
  assert.equal(rig.requests[1].body.code, '012345');
  assert.ok(hasText(h, 'Verificando...'));
  assert.equal(h.nodes.find((node) => node.props?.accessibilityLabel === 'Verificar código').props.disabled, true);
  h.act(() => h.press('Cancelar verificação'));
  response.resolve(jsonResponse(200, adminSession));
  await h.actAsync(() => pending);
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(h.nodes.some((node) => node.props?.accessibilityLabel === 'Código TOTP'), false);
  assert.ok(h.nodes.some((node) => node.props?.placeholder === loginInputs.password));
  assert.deepEqual(h.navigationCalls, []);
});

test('TOTP UI: código válido conclui, código inválido informa erro e não reenvia senha', async () => {
  for (const accepted of [false, true]) {
    const rig = adminRig(async () => accepted ? jsonResponse(200, adminSession)
      : problemResponse(401, { code: 'ADMIN_2FA_INVALID' }));
    const h = createHarness('screens/auth/LoginScreen.js', { authContext: rig.manager });
    fillForm(h, loginInputs, { email: adminUser.email, password: 'ValidPassword#2026' });
    await h.actAsync(() => h.press('Entrar na conta'));
    h.act(() => h.nodes.find((node) => node.props?.accessibilityLabel === 'Código TOTP').props.onChangeText('012345'));
    await h.actAsync(() => h.press('Verificar código'));
    assert.equal(rig.manager.getSnapshot().isAuthenticated, accepted);
    assert.equal(rig.requests.filter((request) => request.url.endsWith('/auth/login')).length, 1);
    assert.equal(Object.hasOwn(rig.requests[1].body, 'password'), false);
    assert.equal(Object.hasOwn(rig.requests[1].body, 'email'), false);
    if (!accepted) {
      assert.ok(hasText(h, 'Código inválido ou desafio expirado. Tente um código atual ou cancele e entre novamente.'));
      assert.equal(h.nodes.find((node) => node.props?.accessibilityLabel === 'Código TOTP').props.value, '');
    }
    assert.deepEqual(h.navigationCalls, []);
    h.unmount();
  }
});

test('TOTP UI: Admin sem configuração recebe orientação e nenhum atalho de autenticação', async () => {
  const rig = adminRig(undefined, { challenge: { isTotpConfigured: false } });
  const h = createHarness('screens/auth/LoginScreen.js', { authContext: rig.manager });
  fillForm(h, loginInputs, { email: adminUser.email, password: 'ValidPassword#2026' });
  await h.actAsync(() => h.press('Entrar na conta'));
  assert.equal(h.nodes.some((node) => node.props?.accessibilityLabel === 'Código TOTP'), false);
  assert.equal(h.nodes.some((node) => node.props?.accessibilityLabel === 'Verificar código'), false);
  assert.ok(h.nodes.some((node) => node.type === 'Text' && textOf(node).includes('procedimento administrativo existente')));
  await assert.rejects(rig.manager.verifyAdminTwoFactor('012345'), (error) => error.code === 'ADMIN_TOTP_NOT_CONFIGURED');
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.requests.length, 1);
  h.unmount();
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
});

test('TOTP UI: expiração e falha de rede retornam ao login com orientação segura', async () => {
  for (const expired of [true, false]) {
    let time = 1_000_000;
    const rig = adminRig(async () => { throw new Error('Connection lost'); }, { now: () => time });
    const h = createHarness('screens/auth/LoginScreen.js', { authContext: rig.manager });
    fillForm(h, loginInputs, { email: adminUser.email, password: 'ValidPassword#2026' });
    await h.actAsync(() => h.press('Entrar na conta'));
    h.act(() => h.nodes.find((node) => node.props?.accessibilityLabel === 'Código TOTP').props.onChangeText('012345'));
    if (expired) time += 300_000;
    await h.actAsync(() => h.press('Verificar código'));
    assert.equal(h.nodes.some((node) => node.props?.accessibilityLabel === 'Código TOTP'), false);
    assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
    const text = h.nodes.filter((node) => node.type === 'Text').map(textOf).join(' ');
    assert.match(text, expired ? /expirou ou foi cancelada/ : /entre novamente por segurança/);
    h.unmount();
  }
});

test('TOTP UI: sair da tela cancela o desafio e permite um novo login ao voltar', async () => {
  const rig = adminRig();
  const h = createHarness('screens/auth/LoginScreen.js', { authContext: rig.manager });
  fillForm(h, loginInputs, { email: adminUser.email, password: 'ValidPassword#2026' });
  await h.actAsync(() => h.press('Entrar na conta'));
  h.setFocused(false);
  assert.equal(rig.manager.getSnapshot().adminChallenge, null);
  h.setFocused(true);
  assert.ok(h.nodes.some((node) => node.props?.placeholder === loginInputs.password));
  assert.equal(h.nodes.find((node) => node.props?.accessibilityLabel === 'Entrar na conta').props.disabled, false);
  h.unmount();
});

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

test('startup network error on GET /auth/me preserves rotated refreshToken in SecureStore and reports network error', async () => {
  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: 'restored-access-jwt',
          expiresIn: 900,
          refreshToken: 'rotated-keep-me-on-offline-startup',
        });
      }
      if (req.url.endsWith('/api/v1/auth/me')) {
        throw new TypeError('Failed to fetch');
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'keep-me-on-offline-startup' }
  );

  const result = await rig.manager.restoreSession();
  assert.equal(result.status, 'network_error');
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'rotated-keep-me-on-offline-startup');
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

  // Uma tentativa automática posterior NÃO deve enviar outro POST /auth/refresh.
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
  // 1. Logout concluído no servidor (200 OK).
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

  // 2. Uma falha de rede no logout ainda limpa as credenciais locais e informa o resultado real.
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

  // O usuário encerra a sessão antes de o refresh terminar.
  await rig.manager.logout();
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);

  // A resposta atrasada do refresh chega neste momento.
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

test('401 session expiration invalidates authentication', async () => {
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
});

// ============================================================================
// 4. AUDITORIA K02 — CORRIDA REFRESH vs LOGOUT / NOVO LOGIN E FALHA SECURESTORE
// ============================================================================

test('logout during pending setRefreshToken() prevents rotated token from remaining in SecureStore or restoring session', async () => {
  let resolveSetItem;
  let setItemStarted = false;
  const rawMap = new Map([['arenago.auth.refresh_token', 'initial-refresh-token']]);

  const customSecureStore = {
    async getItemAsync(key) {
      return rawMap.has(key) ? rawMap.get(key) : null;
    },
    async setItemAsync(key, value) {
      setItemStarted = true;
      await new Promise((resolve) => {
        resolveSetItem = resolve;
      });
      rawMap.set(key, value);
    },
    async deleteItemAsync(key) {
      rawMap.delete(key);
    },
  };

  const { createTokenStorage } = loadTokenStorageModule('ios', customSecureStore);
  const tokenStorage = createTokenStorage({
    platformOS: 'ios',
    secureStore: customSecureStore,
  });
  const { createAuthSessionManager } = loadAuthServiceModule({
    tokenStorageModule: { defaultTokenStorage: tokenStorage, createTokenStorage },
  });

  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: 'rotated-access-token',
          expiresIn: 900,
          refreshToken: 'rotated-refresh-token',
        });
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const manager = createAuthSessionManager({ client, tokenStorage });

  const refreshPromise = manager.refreshSession();
  while (!setItemStarted) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  // O usuário inicia o logout enquanto setRefreshToken() está em andamento.
  const logoutPromise = manager.logout();

  // Conclui a gravação pendente no SecureStore após o início do logout.
  resolveSetItem();

  const [refreshResult, logoutResult] = await Promise.all([refreshPromise, logoutPromise]);

  assert.equal(refreshResult, null);
  assert.equal(logoutResult.localLoggedOut, true);
  assert.equal(manager.getSnapshot().isAuthenticated, false);
  assert.equal(manager.getAccessToken(), null);
  assert.equal(rawMap.has('arenago.auth.refresh_token'), false);
  assert.equal(await tokenStorage.getRefreshToken(), null);
});

test('token write finishing after logout start is cleaned up even when tokenStorage has unserialized async write', async () => {
  let finishDelayedWrite;
  let writeEntered = false;
  const rawStore = new Map([['arenago.auth.refresh_token', 'seed-refresh-token']]);

  // Simulação de tokenStorage sem fila: setRefreshToken grava somente quando finishDelayedWrite() é chamado.
  const unqueuedTokenStorage = {
    isPersistent: true,
    async getRefreshToken() {
      return rawStore.get('arenago.auth.refresh_token') ?? null;
    },
    async setRefreshToken(token) {
      writeEntered = true;
      await new Promise((resolve) => {
        finishDelayedWrite = resolve;
      });
      rawStore.set('arenago.auth.refresh_token', token);
    },
    async clearRefreshToken() {
      rawStore.delete('arenago.auth.refresh_token');
    },
  };

  const { createAuthSessionManager } = loadAuthServiceModule({
    tokenStorageModule: {
      defaultTokenStorage: unqueuedTokenStorage,
      createTokenStorage: () => unqueuedTokenStorage,
    },
  });

  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: 'late-access-token',
          expiresIn: 900,
          refreshToken: 'late-refresh-token',
        });
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const manager = createAuthSessionManager({
    client,
    tokenStorage: unqueuedTokenStorage,
  });

  const refreshPromise = manager.refreshSession();
  while (!writeEntered) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  const logoutPromise = manager.logout();
  finishDelayedWrite();

  const [refreshResult] = await Promise.all([refreshPromise, logoutPromise]);

  assert.equal(refreshResult, null);
  assert.equal(manager.getSnapshot().isAuthenticated, false);
  assert.equal(manager.getAccessToken(), null);
  assert.equal(rawStore.has('arenago.auth.refresh_token'), false);
});

test('protected request awaiting refresh while logout occurs does not receive stale token and does not retry', async () => {
  let resolveRefreshHttp;
  let protectedCallCount = 0;

  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/events/active')) {
        protectedCallCount += 1;
        return problemResponse(401, {
          code: 'INVALID_ACCESS_TOKEN',
          detail: 'Access token expirado.',
        });
      }
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        return new Promise((resolve) => {
          resolveRefreshHttp = resolve;
        });
      }
      if (req.url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'valid-refresh-before-logout' }
  );

  const protectedPromise = rig.httpClient.get('/events/active', { auth: true });
  while (!resolveRefreshHttp) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  // O logout ocorre enquanto a requisição protegida aguarda refreshSession().
  const logoutPromise = rig.manager.logout();

  resolveRefreshHttp(
    jsonResponse(200, {
      accessToken: 'obsolete-refreshed-access-token',
      expiresIn: 900,
      refreshToken: 'obsolete-refreshed-refresh-token',
    })
  );

  await logoutPromise;
  await assert.rejects(
    () => protectedPromise,
    (error) => error.status === 401 && error.code === 'INVALID_ACCESS_TOKEN'
  );

  assert.equal(protectedCallCount, 1, 'protected request must NOT be retried with obsolete token after logout');
  assert.equal(rig.manager.getSnapshot().isAuthenticated, false);
  assert.equal(rig.manager.getSnapshot().sessionStatus, 'unauthenticated');
  assert.equal(rig.manager.getAccessToken(), null);
  assert.equal(rig.secureStore.store.has('arenago.auth.refresh_token'), false);
});

test('logout followed immediately by a new login preserves the new session credentials even when old refresh/cleanup resolves late', async () => {
  let resolveOldRefreshWrite;
  let oldRefreshWriteEntered = false;
  let resolveLogoutDelete;
  let logoutDeleteEntered = false;
  const rawStore = new Map([['arenago.auth.refresh_token', 'session1-refresh-token']]);

  const controlledTokenStorage = {
    isPersistent: true,
    async getRefreshToken() {
      return rawStore.get('arenago.auth.refresh_token') ?? null;
    },
    async setRefreshToken(token) {
      if (token === 'session1-rotated-token') {
        oldRefreshWriteEntered = true;
        await new Promise((resolve) => {
          resolveOldRefreshWrite = resolve;
        });
      }
      rawStore.set('arenago.auth.refresh_token', token);
    },
    async clearRefreshToken() {
      if (!logoutDeleteEntered) {
        logoutDeleteEntered = true;
        await new Promise((resolve) => {
          resolveLogoutDelete = resolve;
        });
      }
      rawStore.delete('arenago.auth.refresh_token');
    },
  };

  const { createAuthSessionManager } = loadAuthServiceModule({
    tokenStorageModule: {
      defaultTokenStorage: controlledTokenStorage,
      createTokenStorage: () => controlledTokenStorage,
    },
  });

  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: 'session1-rotated-access',
          expiresIn: 900,
          refreshToken: 'session1-rotated-token',
        });
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
      }
      if (url.endsWith('/api/v1/auth/login')) {
        return jsonResponse(200, {
          user: {
            id: '99999999-9999-4999-8999-999999999999',
            name: 'Novo Login',
            email: 'novo@example.com',
            emailVerified: false,
            roles: ['participante'],
            hasCompletedQuestionnaire: true,
          },
          accessToken: 'session2-access-token',
          expiresIn: 900,
          refreshToken: 'session2-refresh-token',
        });
      }
      if (url.endsWith('/api/v1/auth/me')) {
        return jsonResponse(200, {
          id: '99999999-9999-4999-8999-999999999999',
          name: 'Novo Login',
          email: 'novo@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const manager = createAuthSessionManager({
    client,
    tokenStorage: controlledTokenStorage,
  });

  // 1. A sessão 1 inicia o refresh e pausa em setRefreshToken('session1-rotated-token').
  const refresh1Promise = manager.refreshSession();
  while (!oldRefreshWriteEntered) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  // 2. O usuário encerra a sessão e inicia outro login imediatamente.
  const logoutPromise = manager.logout();
  const login2Promise = manager.login({
    email: 'novo@example.com',
    password: 'StrongPassword#2026',
  });

  // 3. Libera a gravação antiga do refresh da sessão 1.
  resolveOldRefreshWrite();

  // Aguarda a entrada em clearRefreshToken do logout, se ocorrer, e então a libera.
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (resolveLogoutDelete) {
    resolveLogoutDelete();
  }

  const [refresh1Result, , login2Result] = await Promise.all([
    refresh1Promise,
    logoutPromise,
    login2Promise,
  ]);

  assert.equal(refresh1Result, null);
  assert.equal(login2Result.status, 'authenticated');
  assert.equal(manager.getSnapshot().isAuthenticated, true);
  assert.equal(manager.getSnapshot().user.email, 'novo@example.com');
  assert.equal(manager.getAccessToken(), 'session2-access-token');
  assert.equal(rawStore.get('arenago.auth.refresh_token'), 'session2-refresh-token');
});

test('SecureStore read failure is differentiated from missing token, preserves stored credentials, and allows retry recovery', async () => {
  let shouldFailRead = true;
  const rawStore = new Map([['arenago.auth.refresh_token', 'existing-valid-refresh-token']]);
  let deleteCalls = 0;

  const flakySecureStore = {
    async getItemAsync(key) {
      if (shouldFailRead) {
        throw new Error('Keystore temporarily locked');
      }
      return rawStore.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      rawStore.set(key, value);
    },
    async deleteItemAsync(key) {
      deleteCalls += 1;
      rawStore.delete(key);
    },
  };

  const { createTokenStorage } = loadTokenStorageModule('ios', flakySecureStore);
  const tokenStorage = createTokenStorage({
    platformOS: 'ios',
    secureStore: flakySecureStore,
  });

  // 1. Verifica a distinção explícita em tokenStorage.readRefreshToken().
  const failedRead = await tokenStorage.readRefreshToken();
  assert.equal(failedRead.status, 'error');
  assert.equal(failedRead.token, null);
  assert.equal(failedRead.error.isStorageError, true);

  const { createAuthSessionManager } = loadAuthServiceModule({
    tokenStorageModule: { defaultTokenStorage: tokenStorage, createTokenStorage },
  });

  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: 'recovered-access-jwt',
          expiresIn: 900,
          refreshToken: 'recovered-refresh-token',
        });
      }
      if (url.endsWith('/api/v1/auth/me')) {
        return jsonResponse(200, {
          id: '77777777-7777-4777-8777-777777777777',
          name: 'Recuperado',
          email: 'recuperado@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const manager = createAuthSessionManager({ client, tokenStorage });

  // 2. A primeira restoreSession() falha ao ler o SecureStore:
  //    - Não deve presumir que a sessão está encerrada.
  //    - Não deve excluir credenciais existentes.
  //    - Não deve conceder acesso autenticado.
  //    - Deve expor o estado recuperável 'storage_error'.
  const firstRestore = await manager.restoreSession();
  assert.equal(firstRestore.status, 'storage_error');
  assert.equal(manager.getSnapshot().isAuthenticated, false);
  assert.equal(manager.getSnapshot().isInitializing, false);
  assert.equal(manager.getSnapshot().sessionStatus, 'storage_error');
  assert.ok(manager.getSnapshot().storageError);
  assert.equal(manager.getAccessToken(), null);
  assert.equal(deleteCalls, 0);
  assert.equal(rawStore.get('arenago.auth.refresh_token'), 'existing-valid-refresh-token');

  // 3. A segunda tentativa funciona quando o SecureStore volta a responder.
  shouldFailRead = false;
  const secondRestore = await manager.restoreSession();
  assert.equal(secondRestore.status, 'authenticated');
  assert.equal(manager.getSnapshot().isAuthenticated, true);
  assert.equal(manager.getSnapshot().sessionStatus, 'authenticated');
  assert.equal(manager.getSnapshot().storageError, null);
  assert.equal(manager.getSnapshot().user.email, 'recuperado@example.com');
  assert.equal(rawStore.get('arenago.auth.refresh_token'), 'recovered-refresh-token');

  // 4. Verifica a distinção do estado vazio após a remoção da credencial.
  await tokenStorage.clearRefreshToken();
  const emptyRead = await tokenStorage.readRefreshToken();
  assert.equal(emptyRead.status, 'empty');
  assert.equal(emptyRead.token, null);
  assert.equal(emptyRead.error, null);
});

test('delayed session invalidation or stale 401 from previous session never clears credentials of a newly logged-in session', async () => {
  let resolveStaleProtectedRequest;
  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/events/active')) {
        return new Promise((resolve) => {
          resolveStaleProtectedRequest = resolve;
        });
      }
      if (req.url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse(200, { message: 'Sessão encerrada com sucesso.' });
      }
      if (req.url.endsWith('/api/v1/auth/login')) {
        return jsonResponse(200, {
          user: {
            id: '88888888-8888-4888-8888-888888888888',
            name: 'Sessão Nova',
            email: 'nova@example.com',
            emailVerified: false,
            roles: ['participante'],
            hasCompletedQuestionnaire: true,
          },
          accessToken: 'new-session-access-token',
          expiresIn: 900,
          refreshToken: 'new-session-refresh-token',
        });
      }
      if (req.url.endsWith('/api/v1/auth/me')) {
        return jsonResponse(200, {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Sessão Nova',
          email: 'nova@example.com',
          emailVerified: false,
          roles: ['participante'],
          hasCompletedQuestionnaire: true,
        });
      }
      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'old-session-refresh-token' }
  );

  // Inicia uma requisição protegida durante a sessão antiga.
  const staleRequestPromise = rig.httpClient.get('/events/active', { auth: true });
  while (!resolveStaleProtectedRequest) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  // Encerra a sessão antiga e inicia uma nova sessão imediatamente.
  await rig.manager.logout();
  await rig.manager.login({
    email: 'nova@example.com',
    password: 'StrongPassword#2026',
  });

  assert.equal(rig.manager.getSnapshot().isAuthenticated, true);
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'new-session-refresh-token');

  // A requisição antiga retorna 401 SESSION_REVOKED.
  resolveStaleProtectedRequest(
    problemResponse(401, {
      code: 'SESSION_REVOKED',
      detail: 'Sessão antiga revogada.',
    })
  );

  await assert.rejects(
    () => staleRequestPromise,
    (error) => error.status === 401 && error.code === 'SESSION_REVOKED'
  );

  // A nova sessão e seu refreshToken no SecureStore devem permanecer intactos.
  assert.equal(rig.manager.getSnapshot().isAuthenticated, true);
  assert.equal(rig.manager.getSnapshot().sessionStatus, 'authenticated');
  assert.equal(rig.manager.getAccessToken(), 'new-session-access-token');
  assert.equal(rig.secureStore.store.get('arenago.auth.refresh_token'), 'new-session-refresh-token');
});

test('generic network error during POST /auth/refresh after server consumes token treats outcome as inconclusive and never replays the old token', async () => {
  let refreshCalls = 0;
  let serverConsumedTokens = new Set();
  let sessionRevokedByReuse = false;

  const rig = createAuthRig(
    async (req) => {
      if (req.url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        const incomingToken = req.body.refreshToken;

        if (serverConsumedTokens.has(incomingToken)) {
          sessionRevokedByReuse = true;
          return problemResponse(401, {
            code: 'REFRESH_TOKEN_REUSED',
            detail: 'Reutilização de refresh token detectada. Sessão revogada.',
          });
        }

        // 1 e 2. O backend simulado recebe o refresh e marca o token como processado/consumido.
        serverConsumedTokens.add(incomingToken);

        // 3. fetch rejeita com um erro de rede genérico antes de entregar a resposta.
        throw new TypeError('Network request failed');
      }

      if (req.url.endsWith('/api/v1/events/active')) {
        return problemResponse(401, {
          code: 'INVALID_ACCESS_TOKEN',
          detail: 'Access token expirado.',
        });
      }

      throw new Error(`Unexpected URL: ${req.url}`);
    },
    { initialRefreshToken: 'refresh-token-consumed-before-drop' }
  );

  await assert.rejects(
    () => rig.manager.refreshSession(),
    (error) =>
      error.isNetworkError === true &&
      error.outcomeUnknown === true &&
      error.kind === 'network'
  );

  assert.equal(refreshCalls, 1);
  assert.equal(serverConsumedTokens.has('refresh-token-consumed-before-drop'), true);
  assert.equal(sessionRevokedByReuse, false);

  // O cliente deve limpar do SecureStore o token de resultado incerto e mudar para uncertain_refresh (distinto de revoked),
  // preservar os detalhes de networkError e orientar novo login por meio de authNotice.
  const snapshotAfterDrop = rig.manager.getSnapshot();
  assert.equal(snapshotAfterDrop.isAuthenticated, false);
  assert.equal(snapshotAfterDrop.sessionStatus, 'uncertain_refresh');
  assert.notEqual(snapshotAfterDrop.sessionStatus, 'revoked');
  assert.ok(snapshotAfterDrop.networkError);
  assert.ok(snapshotAfterDrop.authNotice);
  assert.equal(rig.secureStore.store.has('arenago.auth.refresh_token'), false);

  // 4a. Uma restoreSession() posterior não deve reenviar o token consumido.
  const restoreAttempt = await rig.manager.restoreSession();
  assert.equal(restoreAttempt.status, 'uncertain_refresh');
  assert.equal(refreshCalls, 1, 'must not replay consumed token during restoreSession()');
  assert.equal(sessionRevokedByReuse, false);

  // 4b. Mesmo que o token antigo ainda exista, restoreSession(), refreshSession() e requisições protegidas com 401 não devem reenviá-lo.
  rig.secureStore.store.set('arenago.auth.refresh_token', 'refresh-token-consumed-before-drop');

  const secondRestoreAttempt = await rig.manager.restoreSession();
  assert.equal(secondRestoreAttempt.status, 'uncertain_refresh');
  assert.equal(refreshCalls, 1, 'must block replay of known uncertain token on restoreSession()');
  assert.equal(rig.secureStore.store.has('arenago.auth.refresh_token'), false);

  rig.secureStore.store.set('arenago.auth.refresh_token', 'refresh-token-consumed-before-drop');
  await assert.rejects(
    () => rig.httpClient.get('/events/active', { auth: true }),
    (error) => error.code === 'UNCERTAIN_REFRESH_OUTCOME'
  );
  assert.equal(refreshCalls, 1, 'must not trigger POST /auth/refresh on protected 401 after uncertain refresh failure');
  assert.equal(sessionRevokedByReuse, false);
});
