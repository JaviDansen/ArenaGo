const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const mockVibration = {
  vibrate: () => {},
};
const mockNotifications = {
  setNotificationHandler: () => {},
  registerTaskAsync: async () => {},
  addNotificationReceivedListener: () => ({ remove: () => {} }),
};
const mockTaskManager = {
  defineTask: () => {},
  isTaskRegisteredAsync: async () => false,
};

const serviceModule = loadModule('services/queueCallVibrationService.js', (name) => {
  if (name === 'react-native') {
    return { Vibration: mockVibration, Platform: { OS: 'android' } };
  }
  if (name === 'expo-notifications') return mockNotifications;
  if (name === 'expo-task-manager') return mockTaskManager;
  return require(name);
});

const {
  QUEUE_CALL_VIBRATION_PATTERN,
  QUEUE_CALL_VIBRATION_REPEAT,
  validateQueueCallPayload,
  processQueueCallAlert,
  resetQueueCallAlerts,
  hasSessionBeenAlerted,
  addQueueCallListener,
} = serviceModule.exports;

test('Padrão de vibração: dura 1,9 segundo, 3 pulsos de 500ms com pausas de 200ms, sem repetição', () => {
  // Padrão exato: [0, 500, 200, 500, 200, 500]
  assert.deepEqual(Array.from(QUEUE_CALL_VIBRATION_PATTERN), [0, 500, 200, 500, 200, 500]);
  assert.equal(QUEUE_CALL_VIBRATION_REPEAT, false);

  // Calcula a duração total
  const totalDurationMs = Array.from(QUEUE_CALL_VIBRATION_PATTERN).reduce((sum, val) => sum + val, 0);
  assert.equal(totalDurationMs, 1900); // 1,9 segundo exato
});

test('Validação de payload da chamada: aceita apenas metadados técnicos mínimos e rejeita campos visuais', () => {
  const valid = {
    type: 'queue.called',
    serviceSessionId: 'session-uuid-1234',
    participationId: 'part-uuid-5678',
    eventId: 'event-uuid-9999',
    version: 1,
  };

  const parsed = validateQueueCallPayload(valid);
  assert.ok(parsed);
  assert.equal(parsed.type, 'queue.called');
  assert.equal(parsed.serviceSessionId, 'session-uuid-1234');
  assert.equal(parsed.participationId, 'part-uuid-5678');
  assert.equal(parsed.eventId, 'event-uuid-9999');

  // Rejeita payloads inválidos
  assert.equal(validateQueueCallPayload(null), null);
  assert.equal(validateQueueCallPayload({}), null);
  assert.equal(validateQueueCallPayload({ type: 'other.event' }), null);
  assert.equal(validateQueueCallPayload({ type: 'queue.called' }), null); // sem serviceSessionId
  assert.equal(validateQueueCallPayload({ type: 'queue.called', serviceSessionId: '   ' }), null);
});

test('Deduplicação de vibração: vibra uma única vez por atendimento e ignora retries/replays', () => {
  resetQueueCallAlerts();

  const vibrationCalls = [];
  const customVibrator = {
    vibrate: (pattern, repeat) => {
      vibrationCalls.push({ pattern, repeat });
    },
  };

  const payload1 = {
    type: 'queue.called',
    serviceSessionId: 'session-unique-1',
    participationId: 'part-1',
    eventId: 'event-1',
    version: 1,
  };

  // 1ª vez: deve vibrar
  const executed1 = processQueueCallAlert(payload1, { vibrationEngine: customVibrator });
  assert.equal(executed1, true);
  assert.equal(vibrationCalls.length, 1);
  assert.deepEqual(Array.from(vibrationCalls[0].pattern), [0, 500, 200, 500, 200, 500]);
  assert.equal(vibrationCalls[0].repeat, false);
  assert.equal(hasSessionBeenAlerted('session-unique-1'), true);

  // 2ª vez (mesmo serviceSessionId): NÃO deve vibrar
  const executed2 = processQueueCallAlert(payload1, { vibrationEngine: customVibrator });
  assert.equal(executed2, false);
  assert.equal(vibrationCalls.length, 1); // continua 1, sem duplicar

  // Novo serviceSessionId: deve vibrar
  const payload2 = {
    type: 'queue.called',
    serviceSessionId: 'session-unique-2',
  };
  const executed3 = processQueueCallAlert(payload2, { vibrationEngine: customVibrator });
  assert.equal(executed3, true);
  assert.equal(vibrationCalls.length, 2);

  // Limpeza de deduplicação (logout / troca de usuário)
  resetQueueCallAlerts();
  assert.equal(hasSessionBeenAlerted('session-unique-1'), false);
});

test('Notificação aos ouvintes da tela: propaga evento para atualização imediata da Arena', () => {
  resetQueueCallAlerts();

  const receivedCalls = [];
  const unsubscribe = addQueueCallListener((call) => {
    receivedCalls.push(call);
  });

  const payload = {
    type: 'queue.called',
    serviceSessionId: 'session-listener-test',
    participationId: 'part-xyz',
    eventId: 'event-xyz',
  };

  const customVibrator = { vibrate: () => {} };
  processQueueCallAlert(payload, { vibrationEngine: customVibrator });

  assert.equal(receivedCalls.length, 1);
  assert.equal(receivedCalls[0].serviceSessionId, 'session-listener-test');

  unsubscribe();
  // Após cancelar a assinatura, novos chamados não chamam o listener removido
  processQueueCallAlert({ type: 'queue.called', serviceSessionId: 'session-listener-test-2' }, { vibrationEngine: customVibrator });
  assert.equal(receivedCalls.length, 1);
});
