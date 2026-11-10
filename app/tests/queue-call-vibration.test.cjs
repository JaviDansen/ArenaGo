const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

function createSecureStoreMock(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    store,
    getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
    setItemAsync: async (key, value) => {
      store.set(key, String(value));
    },
    deleteItemAsync: async (key) => {
      store.delete(key);
    },
  };
}

function loadVibrationServiceEnv({
  secureStore = createSecureStoreMock(),
  vibrationImpl = () => {},
  platformOS = 'android',
} = {}) {
  const vibrationCalls = [];
  const registeredTasks = [];
  const definedTasks = new Map();
  let configuredHandler = null;
  let foregroundListener = null;

  const mockVibration = {
    vibrate: (pattern, repeat) => {
      vibrationImpl(pattern, repeat);
      vibrationCalls.push({ pattern: Array.from(pattern), repeat });
    },
  };

  const mockNotifications = {
    BackgroundNotificationTaskResult: {
      NewData: 0,
      NoData: 1,
      Failed: 2,
    },
    AndroidImportance: {
      MIN: 1,
      LOW: 2,
    },
    AndroidNotificationVisibility: {
      SECRET: -1,
    },
    setNotificationHandler: (handler) => {
      configuredHandler = handler;
    },
    registerTaskAsync: async (taskName) => {
      registeredTasks.push(taskName);
    },
    addNotificationReceivedListener: (listener) => {
      foregroundListener = listener;
      return {
        remove: () => {
          if (foregroundListener === listener) {
            foregroundListener = null;
          }
        },
      };
    },
  };

  const mockTaskManager = {
    defineTask: (taskName, executor) => {
      definedTasks.set(taskName, executor);
    },
    isTaskRegisteredAsync: async (taskName) => registeredTasks.includes(taskName),
  };

  const serviceModule = loadModule('services/queueCallVibrationService.js', (name) => {
    if (name === 'react-native') {
      return { Vibration: mockVibration, Platform: { OS: platformOS } };
    }
    if (name === 'expo-notifications') return mockNotifications;
    if (name === 'expo-task-manager') return mockTaskManager;
    if (name === 'expo-secure-store') return secureStore;
    return require(name);
  });

  return {
    exports: serviceModule.exports,
    vibrationCalls,
    registeredTasks,
    definedTasks,
    getConfiguredHandler: () => configuredHandler,
    getForegroundListener: () => foregroundListener,
    secureStore,
  };
}

test('Padrão de vibração e handler silencioso: 1,9s exato e shouldShowBanner/List/Sound/Badge = false', async () => {
  const env = loadVibrationServiceEnv();
  const {
    QUEUE_CALL_VIBRATION_PATTERN,
    QUEUE_CALL_VIBRATION_REPEAT,
    SILENT_NOTIFICATION_BEHAVIOR,
  } = env.exports;

  assert.deepEqual(Array.from(QUEUE_CALL_VIBRATION_PATTERN), [0, 500, 200, 500, 200, 500]);
  assert.equal(QUEUE_CALL_VIBRATION_REPEAT, false);

  const totalDurationMs = Array.from(QUEUE_CALL_VIBRATION_PATTERN).reduce((sum, val) => sum + val, 0);
  assert.equal(totalDurationMs, 1900);

  const handler = env.getConfiguredHandler();
  assert.ok(handler && typeof handler.handleNotification === 'function');
  const behavior = await handler.handleNotification();
  assert.deepEqual(
    { ...behavior },
    {
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(SILENT_NOTIFICATION_BEHAVIOR, 'shouldShowAlert'), false);
});

test('Validação de payload da chamada: aceita apenas metadados técnicos mínimos e rejeita campos visuais', () => {
  const env = loadVibrationServiceEnv();
  const { validateQueueCallPayload } = env.exports;

  const valid = {
    type: 'queue.called',
    serviceSessionId: 'session-uuid-1234',
    participationId: 'part-uuid-5678',
    eventId: 'event-uuid-9999',
    userId: 'user-uuid-1111',
    calledAt: '2026-11-10T15:00:00.000Z',
    version: 1,
  };

  const parsed = validateQueueCallPayload(valid);
  assert.ok(parsed);
  assert.equal(parsed.type, 'queue.called');
  assert.equal(parsed.serviceSessionId, 'session-uuid-1234');
  assert.equal(parsed.participationId, 'part-uuid-5678');
  assert.equal(parsed.eventId, 'event-uuid-9999');
  assert.equal(parsed.userId, 'user-uuid-1111');

  assert.equal(validateQueueCallPayload(null), null);
  assert.equal(validateQueueCallPayload({}), null);
  assert.equal(validateQueueCallPayload({ type: 'other.event', serviceSessionId: 's1' }), null);
  assert.equal(validateQueueCallPayload({ type: 'queue.called' }), null);
  assert.equal(validateQueueCallPayload({ type: 'queue.called', serviceSessionId: '   ' }), null);
  assert.equal(validateQueueCallPayload({ ...valid, title: 'Chamada!' }), null);
  assert.equal(validateQueueCallPayload({ ...valid, body: 'Sua vez!' }), null);
  assert.equal(validateQueueCallPayload({ ...valid, message: 'Vá à estação' }), null);
  assert.equal(validateQueueCallPayload({ ...valid, sound: 'default' }), null);
});

test('Background Task (Expo SDK 58 NotificationTaskPayload): define e registra no escopo do módulo e interpreta data.dataString', async () => {
  const env = loadVibrationServiceEnv();
  const {
    BACKGROUND_QUEUE_CALL_TASK,
    setActiveQueueCallUser,
  } = env.exports;

  // Verifica que a task foi definida e registrada na carga do módulo (sem precisar montar React)
  assert.equal(env.definedTasks.has(BACKGROUND_QUEUE_CALL_TASK), true);
  assert.equal(env.registeredTasks.includes(BACKGROUND_QUEUE_CALL_TASK), true);

  const taskCallback = env.definedTasks.get(BACKGROUND_QUEUE_CALL_TASK);
  assert.equal(typeof taskCallback, 'function');

  await setActiveQueueCallUser('user-bg-1');

  // 1. Formato real Android RemoteMessageSerializer: { data: { notification: null, data: { dataString: JSON } } }
  const res1 = await taskCallback({
    data: {
      notification: null,
      data: {
        dataString: JSON.stringify({
          type: 'queue.called',
          serviceSessionId: 'session-bg-real-1',
          participationId: 'part-bg-1',
          eventId: 'event-bg-1',
          userId: 'user-bg-1',
          version: 1,
        }),
      },
    },
    error: null,
    executionInfo: { taskName: BACKGROUND_QUEUE_CALL_TASK },
  });
  assert.equal(res1, 0); // NewData
  assert.equal(env.vibrationCalls.length, 1);
  assert.deepEqual(env.vibrationCalls[0].pattern, [0, 500, 200, 500, 200, 500]);

  // 2. Formato documentado direto data.dataString: { data: { dataString: JSON } }
  const res2 = await taskCallback({
    data: {
      dataString: JSON.stringify({
        type: 'queue.called',
        serviceSessionId: 'session-bg-real-2',
        userId: 'user-bg-1',
        version: 1,
      }),
    },
    error: null,
  });
  assert.equal(res2, 0);
  assert.equal(env.vibrationCalls.length, 2);

  // 3. Rejeita dataString com JSON malformado sem vibrar
  const resMalformed = await taskCallback({
    data: {
      notification: null,
      data: {
        dataString: '{malformed-json',
      },
    },
    error: null,
  });
  assert.equal(resMalformed, 1); // NoData
  assert.equal(env.vibrationCalls.length, 2);

  // 4. Rejeita NotificationResponse (toque em ação) e erros da task sem vibrar
  const resAction = await taskCallback({
    data: {
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: null,
    },
    error: null,
  });
  assert.equal(resAction, 1);
  assert.equal(env.vibrationCalls.length, 2);

  const resError = await taskCallback({
    data: null,
    error: new Error('Native task failure'),
  });
  assert.equal(resError, 2); // Failed
  assert.equal(env.vibrationCalls.length, 2);
});

test('Isolamento de sessão e deduplicação persistente (SecureStore): sobrevive ao reinício do processo sem AuthContext', async () => {
  const sharedSecureStore = createSecureStoreMock();

  // Processo 1: Usuário A autenticado recebe chamada e vibra
  const proc1 = loadVibrationServiceEnv({ secureStore: sharedSecureStore });
  await proc1.exports.setActiveQueueCallUser('user-A');

  const task1 = proc1.definedTasks.get(proc1.exports.BACKGROUND_QUEUE_CALL_TASK);
  const payloadSession1 = {
    type: 'queue.called',
    serviceSessionId: 'session-persisted-1',
    userId: 'user-A',
    version: 1,
  };

  await task1({
    data: { notification: null, data: { dataString: JSON.stringify(payloadSession1) } },
    error: null,
  });
  assert.equal(proc1.vibrationCalls.length, 1);

  // Processo 2 (reinício do processo em headless background, sem AuthContext montado):
  // Recebe retry da mesma chamada -> NÃO deve vibrar novamente
  const proc2 = loadVibrationServiceEnv({ secureStore: sharedSecureStore });
  const task2 = proc2.definedTasks.get(proc2.exports.BACKGROUND_QUEUE_CALL_TASK);

  await task2({
    data: { notification: null, data: { dataString: JSON.stringify(payloadSession1) } },
    error: null,
  });
  assert.equal(proc2.vibrationCalls.length, 0, 'Não deve vibrar novamente após reinício do processo');

  // Nova chamada para o mesmo usuário A em background após reinício -> DEVE vibrar
  const payloadSession2 = {
    type: 'queue.called',
    serviceSessionId: 'session-persisted-2',
    userId: 'user-A',
    version: 1,
  };
  await task2({
    data: { notification: null, data: { dataString: JSON.stringify(payloadSession2) } },
    error: null,
  });
  assert.equal(proc2.vibrationCalls.length, 1, 'Nova chamada deve vibrar normalmente');

  // Alerta atrasado de outra conta (user-B) enquanto user-A está autenticado -> BLOQUEADO
  const payloadOtherUser = {
    type: 'queue.called',
    serviceSessionId: 'session-other-user',
    userId: 'user-B',
    version: 1,
  };
  await task2({
    data: { notification: null, data: { dataString: JSON.stringify(payloadOtherUser) } },
    error: null,
  });
  assert.equal(proc2.vibrationCalls.length, 1, 'Alerta de outra conta nunca deve vibrar');

  // Após logout de user-A -> alertas de user-A são bloqueados
  await proc2.exports.clearActiveQueueCallUser();
  await task2({
    data: {
      notification: null,
      data: {
        dataString: JSON.stringify({
          type: 'queue.called',
          serviceSessionId: 'session-after-logout',
          userId: 'user-A',
          version: 1,
        }),
      },
    },
    error: null,
  });
  assert.equal(proc2.vibrationCalls.length, 1, 'Alerta após logout não deve vibrar');
});

test('Concorrência foreground + background, chamadas encerradas, atrasos e falha de hardware', async () => {
  const env = loadVibrationServiceEnv();
  const {
    processQueueCallAlertAsync,
    setActiveQueueCallUser,
    setQueueCallStateValidator,
    hasSessionBeenAlerted,
  } = env.exports;

  await setActiveQueueCallUser('user-1');

  // 1. Disparo simultâneo foreground + background para o mesmo serviceSessionId -> vibra apenas 1 vez
  const concurrentPayload = {
    type: 'queue.called',
    serviceSessionId: 'session-concurrent-1',
    userId: 'user-1',
    version: 1,
  };
  const [fgRes, bgRes] = await Promise.all([
    processQueueCallAlertAsync(concurrentPayload),
    processQueueCallAlertAsync(concurrentPayload),
  ]);
  assert.equal(Number(fgRes) + Number(bgRes), 1);
  assert.equal(env.vibrationCalls.length, 1);

  // 2. Chamada já encerrada (confirmada pelo validador de estado) -> NÃO vibra
  setQueueCallStateValidator(async () => 'ended');
  const endedRes = await processQueueCallAlertAsync({
    type: 'queue.called',
    serviceSessionId: 'session-already-ended',
    participationId: 'part-1',
    userId: 'user-1',
    version: 1,
  });
  assert.equal(endedRes, false);
  assert.equal(env.vibrationCalls.length, 1);
  setQueueCallStateValidator(null);

  // 3. Alerta atrasado além de 5 minutos -> NÃO vibra
  const nowMs = Date.parse('2026-11-10T15:10:00.000Z');
  const staleRes = await processQueueCallAlertAsync(
    {
      type: 'queue.called',
      serviceSessionId: 'session-stale-1',
      userId: 'user-1',
      calledAt: '2026-11-10T15:00:00.000Z', // 10 min atrás
      version: 1,
    },
    { nowMs }
  );
  assert.equal(staleRes, false);
  assert.equal(env.vibrationCalls.length, 1);

  // 4. Falha na execução de hardware -> NÃO marca como executada, permitindo retry posterior
  const failingVibrator = {
    vibrate: () => {
      throw new Error('Vibrator hardware unavailable');
    },
  };
  const failedAttempt = await processQueueCallAlertAsync(
    {
      type: 'queue.called',
      serviceSessionId: 'session-hw-fail-1',
      userId: 'user-1',
      version: 1,
    },
    { vibrationEngine: failingVibrator }
  );
  assert.equal(failedAttempt, false);
  assert.equal(hasSessionBeenAlerted('session-hw-fail-1', 'user-1'), false);

  // Retry com vibrador funcional agora executa e registra
  const retryAttempt = await processQueueCallAlertAsync({
    type: 'queue.called',
    serviceSessionId: 'session-hw-fail-1',
    userId: 'user-1',
    version: 1,
  });
  assert.equal(retryAttempt, true);
  assert.equal(hasSessionBeenAlerted('session-hw-fail-1', 'user-1'), true);
  assert.equal(env.vibrationCalls.length, 2);
});

test('devicePushService + httpClient: envia Authorization Bearer, body no DELETE, cria canal Android, valida projectId e bloqueia registro pós-logout', async () => {
  const secureStore = createSecureStoreMock();
  const channelCalls = [];
  const tokenFetchCalls = [];
  const httpRequests = [];

  let activeToken = 'jwt-token-user-A';
  let currentEpoch = 1;
  let isUserAuthenticated = true;

  const mockNotifications = {
    AndroidImportance: { LOW: 2 },
    AndroidNotificationVisibility: { SECRET: -1 },
    setNotificationChannelAsync: async (channelId, config) => {
      channelCalls.push({ channelId, config });
      return { id: channelId };
    },
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async (options) => {
      tokenFetchCalls.push(options);
      return { data: 'ExponentPushToken[real-device-token-123]' };
    },
  };

  // Carrega o httpClient real do projeto para validar método, headers (Authorization) e body reais
  const apiConfigModule = loadModule('config/apiConfig.js', (name) => require(name));
  const httpClientModule = loadModule('services/httpClient.js', (name) => {
    if (name === '../config/apiConfig') return apiConfigModule.exports;
    return require(name);
  });

  const client = httpClientModule.exports.createHttpClient({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    getAccessToken: () => activeToken,
    getSessionEpoch: () => currentEpoch,
    fetchImpl: async (url, init) => {
      httpRequests.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'registered', unlinked: true }),
      };
    },
  });

  const vibEnv = loadVibrationServiceEnv({ secureStore });
  const pushModule = loadModule('services/devicePushService.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-notifications') return mockNotifications;
    if (name === 'expo-secure-store') return secureStore;
    if (name === './queueCallVibrationService') return vibEnv.exports;
    if (name === 'expo-constants') {
      return {
        easConfig: { projectId: '11111111-2222-4333-8444-555555555555' },
      };
    }
    return require(name);
  });

  const {
    syncDevicePushToken,
    unregisterDevicePushToken,
    ANDROID_SILENT_CHANNEL_ID,
  } = pushModule.exports;

  // 1. Rejeita projectId inválido sem chamar getExpoPushTokenAsync nem POST
  const invalidProjResult = await syncDevicePushToken(client, {
    projectId: 'not-a-valid-uuid',
    constants: null,
    env: {},
  });
  assert.equal(invalidProjResult, null);
  assert.equal(tokenFetchCalls.length, 0);
  assert.equal(httpRequests.length, 0);

  // 2. Registro válido: cria canal Android silencioso, valida projectId e envia POST com Authorization Bearer
  const registeredToken = await syncDevicePushToken(client, {
    userId: 'user-A',
    getSessionEpoch: () => currentEpoch,
    isCurrent: () => isUserAuthenticated && currentEpoch === 1,
  });

  assert.equal(registeredToken, 'ExponentPushToken[real-device-token-123]');
  assert.equal(channelCalls.length, 1);
  assert.equal(channelCalls[0].channelId, ANDROID_SILENT_CHANNEL_ID);
  assert.equal(channelCalls[0].config.sound, null);
  assert.equal(channelCalls[0].config.enableVibrate, false);
  assert.equal(tokenFetchCalls.length, 1);
  assert.equal(tokenFetchCalls[0].projectId, '11111111-2222-4333-8444-555555555555');

  assert.equal(httpRequests.length, 1);
  assert.equal(httpRequests[0].method, 'POST');
  assert.equal(httpRequests[0].url, 'http://127.0.0.1:3000/api/v1/devices/push-token');
  assert.equal(httpRequests[0].headers.Authorization, 'Bearer jwt-token-user-A');
  assert.deepEqual(httpRequests[0].body, {
    pushToken: 'ExponentPushToken[real-device-token-123]',
    platform: 'android',
  });

  // 3. DELETE no logout: envia método DELETE, Authorization Bearer e body: { pushToken }
  const unlinked = await unregisterDevicePushToken(client);
  assert.equal(unlinked, true);
  assert.equal(httpRequests.length, 2);
  assert.equal(httpRequests[1].method, 'DELETE');
  assert.equal(httpRequests[1].url, 'http://127.0.0.1:3000/api/v1/devices/push-token');
  assert.equal(httpRequests[1].headers.Authorization, 'Bearer jwt-token-user-A');
  assert.deepEqual(httpRequests[1].body, {
    pushToken: 'ExponentPushToken[real-device-token-123]',
  });

  // 4. Operação iniciada antes do logout NÃO registra o dispositivo após troca de sessão/logout
  let resolveSlowToken;
  let notifyTokenFetchReached;
  const tokenFetchReachedPromise = new Promise((resolve) => {
    notifyTokenFetchReached = resolve;
  });

  const slowNotifications = {
    ...mockNotifications,
    getExpoPushTokenAsync: () => {
      notifyTokenFetchReached();
      return new Promise((resolve) => {
        resolveSlowToken = resolve;
      });
    },
  };

  const inFlightSyncPromise = syncDevicePushToken(client, {
    notifications: slowNotifications,
    userId: 'user-A',
    getSessionEpoch: () => currentEpoch,
    isCurrent: () => isUserAuthenticated && currentEpoch === 1,
  });

  await tokenFetchReachedPromise;

  // Usuário faz logout / troca de sessão enquanto getExpoPushTokenAsync estava pendente
  isUserAuthenticated = false;
  currentEpoch = 2;
  activeToken = null;
  await unregisterDevicePushToken(client);

  // Agora a promessa atrasada do Expo resolve
  resolveSlowToken({ data: 'ExponentPushToken[late-token-after-logout]' });
  const lateResult = await inFlightSyncPromise;

  assert.equal(lateResult, null);
  assert.equal(
    httpRequests.length,
    2,
    'Nenhuma requisição POST adicional deve ser enviada após o logout'
  );
  assert.equal(
    await secureStore.getItemAsync('arenago_device_push_token'),
    null,
    'Nenhum token deve ser persistido após o logout'
  );
});

test('devicePushService (P1): corrige condições de corrida determinísticas (1 a 5) e falha de rede no DELETE sem bloquear logout', async () => {
  const baseStore = createSecureStoreMock();
  let setItemInterceptor = null;

  const controlledSecureStore = {
    getItemAsync: (key) => baseStore.getItemAsync(key),
    deleteItemAsync: (key) => baseStore.deleteItemAsync(key),
    setItemAsync: async (key, value) => {
      if (typeof setItemInterceptor === 'function') {
        await setItemInterceptor(key, value);
      }
      return baseStore.setItemAsync(key, value);
    },
    dump: () => baseStore.dump(),
  };

  let postInterceptor = null;
  let deleteInterceptor = null;
  const httpLog = [];

  const mockClient = {
    post: async (path, body, options = {}) => {
      httpLog.push({
        method: 'POST',
        path,
        body: body ? JSON.parse(JSON.stringify(body)) : undefined,
        options: options ? JSON.parse(JSON.stringify(options)) : {},
      });
      if (typeof postInterceptor === 'function') {
        await postInterceptor(path, body, options);
      }
      return { status: 'registered' };
    },
    delete: async (path, options = {}) => {
      httpLog.push({
        method: 'DELETE',
        path,
        body: options?.body ? JSON.parse(JSON.stringify(options.body)) : undefined,
        options: options ? JSON.parse(JSON.stringify(options)) : {},
      });
      if (typeof deleteInterceptor === 'function') {
        await deleteInterceptor(path, options);
      }
      return { unlinked: true };
    },
  };

  let tokenFetchInterceptor = null;
  let nextExpoToken = 'ExponentPushToken[token-default]';

  const mockNotifications = {
    AndroidImportance: { LOW: 2 },
    AndroidNotificationVisibility: { SECRET: -1 },
    setNotificationChannelAsync: async () => ({ id: 'arenago-silent-queue-calls' }),
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async () => {
      const tokenToReturn = nextExpoToken;
      if (typeof tokenFetchInterceptor === 'function') {
        await tokenFetchInterceptor(tokenToReturn);
      }
      return { data: tokenToReturn };
    },
  };

  const vibEnv = loadVibrationServiceEnv({ secureStore: controlledSecureStore });
  const pushModule = loadModule('services/devicePushService.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-notifications') return mockNotifications;
    if (name === 'expo-secure-store') return controlledSecureStore;
    if (name === './queueCallVibrationService') return vibEnv.exports;
    if (name === 'expo-constants') {
      return {
        easConfig: { projectId: '11111111-2222-4333-8444-555555555555' },
      };
    }
    return require(name);
  });

  const {
    syncDevicePushToken,
    unregisterDevicePushToken,
    SECURE_STORE_PUSH_TOKEN_KEY,
  } = pushModule.exports;
  const {
    getActiveQueueCallUser,
    ACTIVE_PUSH_USER_STORAGE_KEY,
    processQueueCallAlertAsync,
  } = vibEnv.exports;

  // --- Cenário 1: Logout ANTES de obter o push token ---
  {
    httpLog.length = 0;
    let releaseTokenFetch;
    let notifyReached;
    const reached = new Promise((r) => {
      notifyReached = r;
    });
    tokenFetchInterceptor = () => {
      notifyReached();
      return new Promise((r) => {
        releaseTokenFetch = r;
      });
    };

    let epoch = 10;
    let loggedIn = true;
    nextExpoToken = 'ExponentPushToken[case-1]';

    const syncPromise = syncDevicePushToken(mockClient, {
      userId: 'user-1',
      accessToken: 'jwt-1',
      getSessionEpoch: () => epoch,
      isCurrent: () => loggedIn && epoch === 10,
    });

    await reached;
    loggedIn = false;
    epoch = 11;
    await unregisterDevicePushToken(mockClient, { accessToken: 'jwt-1' });

    releaseTokenFetch();
    const res = await syncPromise;
    tokenFetchInterceptor = null;

    assert.equal(res, null);
    assert.equal(httpLog.filter((r) => r.method === 'POST').length, 0);
    assert.equal(await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY), null);
    assert.equal(await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY), null);
    assert.equal(getActiveQueueCallUser(), null);
  }

  // --- Cenário 2: Logout DURANTE o POST de registro ---
  {
    httpLog.length = 0;
    let releasePost;
    let notifyPostReached;
    const postReached = new Promise((r) => {
      notifyPostReached = r;
    });
    postInterceptor = () => {
      notifyPostReached();
      return new Promise((r) => {
        releasePost = r;
      });
    };

    let epoch = 20;
    let loggedIn = true;
    nextExpoToken = 'ExponentPushToken[case-2]';

    const syncPromise = syncDevicePushToken(mockClient, {
      userId: 'user-2',
      accessToken: 'jwt-2',
      getSessionEpoch: () => epoch,
      isCurrent: () => loggedIn && epoch === 20,
    });

    await postReached;
    // Logout ocorre enquanto o POST está em andamento na rede
    loggedIn = false;
    epoch = 21;
    await unregisterDevicePushToken(mockClient, { accessToken: 'jwt-2' });

    releasePost();
    const res = await syncPromise;
    postInterceptor = null;

    assert.equal(res, null);
    const deleteCalls = httpLog.filter((r) => r.method === 'DELETE');
    assert.equal(deleteCalls.length, 1, 'Deve compensar o POST tardio com um DELETE');
    assert.equal(deleteCalls[0].options.accessToken, 'jwt-2');
    assert.deepEqual(deleteCalls[0].body, { pushToken: 'ExponentPushToken[case-2]' });
    assert.equal(await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY), null);
    assert.equal(await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY), null);
    assert.equal(getActiveQueueCallUser(), null);
  }

  // --- Cenário 3: Logout DURANTE a gravação do token no SecureStore ---
  {
    httpLog.length = 0;
    let releaseTokenStoreWrite;
    let notifyTokenStoreReached;
    const tokenStoreReached = new Promise((r) => {
      notifyTokenStoreReached = r;
    });
    setItemInterceptor = (key) => {
      if (key === SECURE_STORE_PUSH_TOKEN_KEY) {
        notifyTokenStoreReached();
        return new Promise((r) => {
          releaseTokenStoreWrite = r;
        });
      }
      return Promise.resolve();
    };

    let epoch = 30;
    let loggedIn = true;
    nextExpoToken = 'ExponentPushToken[case-3]';

    const syncPromise = syncDevicePushToken(mockClient, {
      userId: 'user-3',
      accessToken: 'jwt-3',
      getSessionEpoch: () => epoch,
      isCurrent: () => loggedIn && epoch === 30,
    });

    await tokenStoreReached;
    // Logout ocorre enquanto setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY) está pendente
    loggedIn = false;
    epoch = 31;
    setItemInterceptor = null;
    await unregisterDevicePushToken(mockClient, { accessToken: 'jwt-3' });

    // Agora a escrita atrasada do SecureStore conclui
    releaseTokenStoreWrite();
    const res = await syncPromise;

    assert.equal(res, null);
    assert.equal(
      await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY),
      null,
      'A escrita tardia no SecureStore deve ser limpa imediatamente'
    );
    assert.equal(await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY), null);
    assert.equal(getActiveQueueCallUser(), null);
    const deleteCalls = httpLog.filter((r) => r.method === 'DELETE');
    assert.equal(deleteCalls.length, 1);
    assert.deepEqual(deleteCalls[0].body, { pushToken: 'ExponentPushToken[case-3]' });
  }

  // --- Cenário 4A: Logout ANTES da atualização do usuário ativo ---
  {
    httpLog.length = 0;
    let epoch = 40;
    let loggedIn = true;
    nextExpoToken = 'ExponentPushToken[case-4a]';

    setItemInterceptor = async (key) => {
      if (key === SECURE_STORE_PUSH_TOKEN_KEY) {
        // Sessão encerra exatamente ao finalizar a escrita do token, antes de setActiveQueueCallUser
        loggedIn = false;
        epoch = 41;
      }
    };

    const res = await syncDevicePushToken(mockClient, {
      userId: 'user-4a',
      accessToken: 'jwt-4a',
      getSessionEpoch: () => epoch,
      isCurrent: () => loggedIn && epoch === 40,
    });
    setItemInterceptor = null;

    assert.equal(res, null);
    assert.equal(await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY), null);
    assert.equal(await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY), null);
    assert.equal(getActiveQueueCallUser(), null);
    const deleteCalls = httpLog.filter((r) => r.method === 'DELETE');
    assert.equal(deleteCalls.length, 1);
    assert.deepEqual(deleteCalls[0].body, { pushToken: 'ExponentPushToken[case-4a]' });
  }

  // --- Cenário 4B: Logout DURANTE a atualização do usuário ativo (setActiveQueueCallUser) ---
  {
    httpLog.length = 0;
    let releaseUserStoreWrite;
    let notifyUserStoreReached;
    const userStoreReached = new Promise((r) => {
      notifyUserStoreReached = r;
    });

    setItemInterceptor = (key) => {
      if (key === ACTIVE_PUSH_USER_STORAGE_KEY) {
        notifyUserStoreReached();
        return new Promise((r) => {
          releaseUserStoreWrite = r;
        });
      }
      return Promise.resolve();
    };

    let epoch = 45;
    let loggedIn = true;
    nextExpoToken = 'ExponentPushToken[case-4b]';

    const syncPromise = syncDevicePushToken(mockClient, {
      userId: 'user-4b',
      accessToken: 'jwt-4b',
      getSessionEpoch: () => epoch,
      isCurrent: () => loggedIn && epoch === 45,
    });

    await userStoreReached;
    // Logout ocorre enquanto setActiveQueueCallUser aguarda a escrita no SecureStore
    loggedIn = false;
    epoch = 46;
    setItemInterceptor = null;
    await unregisterDevicePushToken(mockClient, { accessToken: 'jwt-4b' });

    releaseUserStoreWrite();
    const res = await syncPromise;

    assert.equal(res, null);
    assert.equal(await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY), null);
    assert.equal(
      await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY),
      null,
      'Não deve deixar usuário ativo gravado no SecureStore após logout'
    );
    assert.equal(getActiveQueueCallUser(), null);

    // Confirma que uma notificação da conta deslogada não vibra
    const vibratedAfterLogout = await processQueueCallAlertAsync({
      type: 'queue.called',
      serviceSessionId: 'sess-after-4b-logout',
      participationId: 'part-4b',
      eventId: 'ev-4b',
      userId: 'user-4b',
      version: 1,
    });
    assert.equal(vibratedAfterLogout, false);
  }

  // --- Cenário 5: Troca direta de contas (User A -> User B) com concorrência ---
  {
    httpLog.length = 0;
    let releasePostA;
    let notifyPostAReached;
    const postAReached = new Promise((r) => {
      notifyPostAReached = r;
    });

    postInterceptor = (_path, _body, options) => {
      if (options.accessToken === 'jwt-user-A') {
        notifyPostAReached();
        return new Promise((r) => {
          releasePostA = r;
        });
      }
      return Promise.resolve();
    };

    let activeAccount = 'user-A';
    let epoch = 50;

    nextExpoToken = 'ExponentPushToken[device-token-A]';
    const syncAPromise = syncDevicePushToken(mockClient, {
      userId: 'user-A',
      accessToken: 'jwt-user-A',
      getSessionEpoch: () => epoch,
      isCurrent: () => activeAccount === 'user-A' && epoch === 50,
    });

    await postAReached;

    // Troca direta da conta A para a conta B enquanto o registro de A estava em trânsito
    activeAccount = 'user-B';
    epoch = 51;
    nextExpoToken = 'ExponentPushToken[device-token-B]';

    const resB = await syncDevicePushToken(mockClient, {
      userId: 'user-B',
      accessToken: 'jwt-user-B',
      getSessionEpoch: () => epoch,
      isCurrent: () => activeAccount === 'user-B' && epoch === 51,
    });
    assert.equal(resB, 'ExponentPushToken[device-token-B]');

    // Agora o POST atrasado da conta A termina
    postInterceptor = null;
    releasePostA();
    const resA = await syncAPromise;

    assert.equal(resA, null, 'O registro atrasado da conta A deve ser abortado');
    assert.equal(
      await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY),
      'ExponentPushToken[device-token-B]',
      'O token da conta B deve permanecer íntegro no SecureStore'
    );
    assert.equal(
      getActiveQueueCallUser(),
      'user-B',
      'O usuário ativo em memória deve continuar sendo user-B'
    );
    const persistedUserRaw = await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY);
    assert.equal(JSON.parse(persistedUserRaw).userId, 'user-B');

    const deleteCallsForA = httpLog.filter(
      (r) => r.method === 'DELETE' && r.options.accessToken === 'jwt-user-A'
    );
    assert.equal(deleteCallsForA.length, 1, 'A conta A deve compensar seu registro tardio com DELETE');
  }

  // --- Cenário 6: Falha de rede na desvinculação (DELETE) não bloqueia o logout e limpa o estado local ---
  {
    httpLog.length = 0;
    deleteInterceptor = async () => {
      throw new Error('Network request failed: timeout reaching backend');
    };

    const unlinkResult = await unregisterDevicePushToken(mockClient, {
      accessToken: 'jwt-user-B',
    });
    deleteInterceptor = null;

    assert.equal(unlinkResult, false, 'Deve indicar falha remota sem lançar exceção');
    assert.equal(
      await controlledSecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY),
      null,
      'Mesmo com falha de rede no DELETE, o token local deve ser removido do SecureStore'
    );
    assert.equal(
      await controlledSecureStore.getItemAsync(ACTIVE_PUSH_USER_STORAGE_KEY),
      null,
      'Mesmo com falha de rede no DELETE, o usuário ativo deve ser removido do SecureStore'
    );
    assert.equal(getActiveQueueCallUser(), null);
  }
});
