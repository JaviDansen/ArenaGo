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
  password: 'StrongPassword#2026',
  confirmPassword: 'StrongPassword#2026',
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

test('registration requires a name that is not only whitespace and has 2 to 150 characters after trim', () => {
  for (const name of ['', ' \t ', 'A', ' A ', 'x'.repeat(151)]) {
    assertInvalid(validateRegisterForm({ ...validRegistration, name }), ['name']);
  }
  assertValid(validateRegisterForm({ ...validRegistration, name: 'Li' }));
  assertValid(validateRegisterForm({ ...validRegistration, name: 'x'.repeat(150) }));
});

test('registration requires an email that is not only whitespace and has at most 255 characters', () => {
  for (const email of ['', ' \t ']) {
    assertInvalid(validateRegisterForm({ ...validRegistration, email }), ['email']);
  }
  const overlyLongEmail = `${'a'.repeat(245)}@example.com`;
  assertInvalid(validateRegisterForm({ ...validRegistration, email: overlyLongEmail }), ['email']);
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

test('registration rejects passwords with 6 or 7 characters even when confirmation matches', () => {
  for (const password of ['a', 'abcde', 'abcdef', 'abcdefg']) {
    assertInvalid(validateRegisterForm({
      ...validRegistration, password, confirmPassword: password,
    }), ['password']);
  }
});

test('registration rejects passwords longer than 128 characters', () => {
  const longPassword = 'A'.repeat(129);
  assertInvalid(validateRegisterForm({
    ...validRegistration, password: longPassword, confirmPassword: longPassword,
  }), ['password']);
});

test('registration accepts passwords between 8 and 128 characters', () => {
  for (const password of ['abcdefgh', 'A'.repeat(128)]) {
    assertValid(validateRegisterForm({
      ...validRegistration, password, confirmPassword: password,
    }));
  }
});

test('registration rejects missing or different password confirmation', () => {
  for (const confirmPassword of ['', 'other123']) {
    assertInvalid(validateRegisterForm({ ...validRegistration, confirmPassword }), ['confirmPassword']);
  }
});

test('valid registration accepts outer whitespace in name and email without mutating the input object', () => {
  const data = Object.freeze({
    ...validRegistration, name: '  Ana  Maria  ', email: '  Ana@example.com  ',
  });
  assertValid(validateRegisterForm(data));
  assert.equal(data.name, '  Ana  Maria  ');
  assert.equal(data.email, '  Ana@example.com  ');
});

test('login rejects missing, malformed and overly long email addresses', () => {
  for (const email of [
    '',
    ' \t ',
    'teste',
    'teste@',
    '@example.com',
    'teste@example',
    'tes te@example.com',
    `${'a'.repeat(245)}@example.com`,
  ]) {
    assertInvalid(validateLoginForm({ email, password: 'x' }), ['email']);
  }
});

test('login rejects an empty password and passwords longer than 128 characters', () => {
  assertInvalid(validateLoginForm({ email: 'teste@example.com', password: '' }), ['password']);
  assertInvalid(validateLoginForm({ email: 'teste@example.com', password: 'x'.repeat(129) }), ['password']);
});

test('locally valid login accepts passwords between 1 and 128 characters', () => {
  for (const password of ['x', 'abcde', 'secret12', 'x'.repeat(128)]) {
    assertValid(validateLoginForm({ email: '  teste@example.com  ', password }));
  }
});
