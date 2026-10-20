const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const birthDate = loadModule('utils/birthDate.js', require).exports;
const { validateRegisterForm, validateLoginForm } = loadModule(
  'utils/validation.js',
  (name) => name === './birthDate' ? birthDate : require(name)
).exports;

const validRegistration = {
  name: 'Participante',
  email: 'teste@example.com',
  password: 'secret1',
  confirmPassword: 'secret1',
};

function assertInvalid(result, fields) {
  assert.equal(result.isValid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [...fields].sort());
  for (const field of fields) {
    assert.equal(typeof result.errors[field], 'string');
    assert.ok(result.errors[field].trim().length > 0);
  }
}

function assertValid(result) {
  assert.equal(result.isValid, true);
  assert.deepEqual(Object.keys(result.errors), []);
}

test('registration requires a name that is not only whitespace', () => {
  for (const name of ['', ' \t ']) {
    assertInvalid(validateRegisterForm({ ...validRegistration, name }), ['name']);
  }
});

test('registration requires an email that is not only whitespace', () => {
  for (const email of ['', ' \t ']) {
    assertInvalid(validateRegisterForm({ ...validRegistration, email }), ['email']);
  }
});

test('registration rejects malformed email addresses', () => {
  for (const email of ['teste', 'teste@', '@example.com', 'teste@example', 'tes te@example.com']) {
    assertInvalid(validateRegisterForm({ ...validRegistration, email }), ['email']);
  }
});

test('registration requires both password fields', () => {
  assertInvalid(validateRegisterForm({
    ...validRegistration, password: '', confirmPassword: '',
  }), ['password', 'confirmPassword']);
});

test('registration rejects passwords shorter than six characters even when confirmation matches', () => {
  for (const password of ['a', 'abcde']) {
    assertInvalid(validateRegisterForm({
      ...validRegistration, password, confirmPassword: password,
    }), ['password']);
  }
});

test('registration accepts exactly six characters without extra password-strength rules', () => {
  assertValid(validateRegisterForm({
    ...validRegistration, password: 'abcdef', confirmPassword: 'abcdef',
  }));
});

test('registration rejects missing or different password confirmation', () => {
  for (const confirmPassword of ['', 'other1']) {
    assertInvalid(validateRegisterForm({ ...validRegistration, confirmPassword }), ['confirmPassword']);
  }
});

test('valid registration accepts outer whitespace in name and email without changing the input', () => {
  const data = Object.freeze({
    ...validRegistration, name: '  Ana  Maria  ', email: '  Ana@example.com  ',
  });
  assertValid(validateRegisterForm(data));
  assert.equal(data.name, '  Ana  Maria  ');
  assert.equal(data.email, '  Ana@example.com  ');
});

test('login rejects missing and malformed email addresses', () => {
  for (const email of ['', ' \t ', 'teste', 'teste@', '@example.com', 'teste@example', 'tes te@example.com']) {
    assertInvalid(validateLoginForm({ email, password: 'x' }), ['email']);
  }
});

test('login rejects an empty password', () => {
  assertInvalid(validateLoginForm({ email: 'teste@example.com', password: '' }), ['password']);
});

test('locally valid login accepts even a one-character password', () => {
  for (const password of ['x', 'abcde', 'secret1']) {
    assertValid(validateLoginForm({ email: '  teste@example.com  ', password }));
  }
});
