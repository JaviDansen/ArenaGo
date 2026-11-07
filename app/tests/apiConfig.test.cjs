const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const { resolveApiBaseUrl } = loadModule('config/apiConfig.js', require).exports;
const { createHttpClient } = loadModule(
  'services/httpClient.js',
  (name) => name === '../config/apiConfig'
    ? { resolveApiBaseUrl, DEFAULT_HTTP_TIMEOUT_MS: 15000 }
    : require(name)
).exports;

test('Expo environment variable is referenced with static process.env dot notation', () => {
  const source = readFileSync(path.join(__dirname, '../config/apiConfig.js'), 'utf8');
  assert.match(source, /process\.env\.EXPO_PUBLIC_API_BASE_URL/);
  assert.match(source, /process\.env\.EXPO_PUBLIC_API_URL/);
});

test('reads the Expo variable and keeps the legacy alias when a test environment is injected', () => {
  assert.equal(resolveApiBaseUrl(undefined, {
    env: { EXPO_PUBLIC_API_BASE_URL: ' http://10.0.2.2:3000/ ' },
  }), 'http://10.0.2.2:3000/api/v1');
  assert.equal(resolveApiBaseUrl(undefined, {
    env: { EXPO_PUBLIC_API_URL: 'http://192.168.1.15:3000' },
  }), 'http://192.168.1.15:3000/api/v1');
});

test('reads EXPO_PUBLIC_API_BASE_URL from process.env without an injected environment', () => {
  const original = process.env.EXPO_PUBLIC_API_BASE_URL;
  try {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://10.0.2.2:3000';
    assert.equal(resolveApiBaseUrl(), 'http://10.0.2.2:3000/api/v1');
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = original;
  }
});

test('explicit base URL wins and /api/v1 is appended exactly once', () => {
  assert.equal(resolveApiBaseUrl('https://api.example.test/api/v1/', {
    env: { EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:3000' },
  }), 'https://api.example.test/api/v1');
  assert.equal(resolveApiBaseUrl('https://api.example.test', { env: {} }),
    'https://api.example.test/api/v1');
  assert.equal(resolveApiBaseUrl(undefined, { env: {} }),
    'http://127.0.0.1:3000/api/v1');
});

test('rejects malformed or unsafe configured URLs with an actionable configuration error', () => {
  for (const value of [
    'localhost:3000', 'ftp://api.example.test', 'http://example.test:bad',
    'http://user:pass@example.test', 'https://api.example.test?token=abc',
    'https://api.example.test/#fragment',
  ]) {
    assert.throws(() => resolveApiBaseUrl(undefined, {
      env: { EXPO_PUBLIC_API_BASE_URL: value },
    }), /URL base da API inválida.*EXPO_PUBLIC_API_BASE_URL/);
  }
});

test('rejects non-local plain HTTP in production', () => {
  assert.throws(() => resolveApiBaseUrl(undefined, {
    env: { NODE_ENV: 'production', EXPO_PUBLIC_API_BASE_URL: 'http://api.example.test' },
  }), /HTTPS/);
});

test('HTTP client sends relative and prefixed paths to the same single /api/v1 prefix', async () => {
  const urls = [];
  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:3000/api/v1/',
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, status: 204 };
    },
  });
  await client.get('/auth/me');
  await client.get('/api/v1/auth/me');
  assert.deepEqual(urls, [
    'http://127.0.0.1:3000/api/v1/auth/me',
    'http://127.0.0.1:3000/api/v1/auth/me',
  ]);
});
