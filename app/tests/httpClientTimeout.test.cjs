const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(finish => { resolve = finish; });
  return { promise, resolve };
}

function fixture(fetchImpl) {
  const { exports: { createHttpClient }, context } = loadModule('services/httpClient.js', name => {
    assert.equal(name, '../config/apiConfig');
    return { DEFAULT_HTTP_TIMEOUT_MS: 1000, resolveApiBaseUrl: () => 'http://127.0.0.1/api/v1' };
  });
  const timers = new Map();
  let serial = 0;
  context.setTimeout = (work, delay) => {
    timers.set(++serial, { work, delay });
    return serial;
  };
  context.clearTimeout = id => { timers.delete(id); };
  const expire = () => {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    assert.equal(timer.delay, 1000);
    timers.delete(id);
    timer.work();
  };
  return { client: createHttpClient({ fetchImpl }), timers, expire };
}

for (const method of ['GET', 'POST']) {
  for (const finishLate of [false, true]) {
    test(method + ' expira com cabeçalhos entregues e corpo ' + (finishLate ? 'tardio' : 'sem conclusão'), async () => {
      const started = deferred(), body = deferred();
      let signal, settlements = 0, requests = 0;
      const h = fixture(async (_, options) => {
        signal = options.signal;
        requests++;
        return { ok: true, status: 200, text() { started.resolve(); return body.promise; } };
      });
      const response = h.client.request('/sample', { method }).finally(() => { settlements++; });
      const check = assert.rejects(response, error => error.isTimeout && error.status === null &&
        error.code === 'REQUEST_TIMEOUT' && error.outcomeUnknown === (method === 'POST'));
      await started.promise;
      h.expire();
      await check;
      assert.equal(signal.aborted, true);
      assert.equal(h.timers.size, 0);
      if (finishLate) {
        body.resolve('{"value":"tardio"}');
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(settlements, 1);
      assert.equal(requests, 1);
    });
  }
}

test('corpo antes do limite preserva status e limpa o temporizador', async () => {
  const started = deferred(), body = deferred();
  let signal;
  const h = fixture(async (_, options) => {
    signal = options.signal;
    return { ok: false, status: 409, text() { started.resolve(); return body.promise; } };
  });
  const received = assert.rejects(h.client.get('/sample'), error =>
    error.status === 409 && error.code === 'CONFLICT' && !error.isTimeout && !error.outcomeUnknown);
  await started.promise;
  body.resolve('{"code":"CONFLICT"}');
  await received;
  assert.equal(h.timers.size, 0);
  assert.equal(signal.aborted, false);
});

test('Abort durante leitura marca POST incerto e falha comprovada antes do envio não é incerta', async () => {
  for (const interrupted of [true, false]) {
    const marker = Object.assign(new Error(interrupted ? 'Body aborted' : 'Not sent'),
      interrupted ? { name: 'AbortError' } : { requestNotSent: true });
    const h = fixture(async () => {
      if (!interrupted) throw marker;
      return { ok: true, status: 200, text: async () => { throw marker; } };
    });
    await assert.rejects(h.client.post('/sample', {}, { outcomeUnknownOnNetworkError: true }),
      error => error.isTimeout === interrupted && error.outcomeUnknown === interrupted);
    assert.equal(h.timers.size, 0);
  }
});

test('status estrito recusa outro 2xx sem confirmar o resultado da escrita', async () => {
  const h = fixture(async () => ({ ok: true, status: 202, text: async () => '{"grant":{}}' }));
  await assert.rejects(h.client.post('/sample', {}, { expectedStatus: 200 }),
    error => error.status === 202 && error.code === 'UNEXPECTED_HTTP_STATUS' && error.outcomeUnknown);
  assert.equal(h.timers.size, 0);
});
