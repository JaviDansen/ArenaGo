const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, textOf } = require('./helpers/questionnaireHarness.cjs');

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
  password: 'abcdef',
  confirmPassword: 'abcdef',
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

test('registration button blocks invalid forms and displays the relevant validation error', () => {
  const cases = [
    [{ name: '   ' }, 'O nome é obrigatório.'],
    [{ email: '' }, 'O e-mail é obrigatório.'],
    [{ email: 'email-invalido' }, 'Informe um e-mail com formato válido.'],
    [{ password: '', confirmPassword: '' }, 'A senha é obrigatória.'],
    [{ password: 'abcde', confirmPassword: 'abcde' }, 'A senha deve possuir no mínimo 6 caracteres.'],
    [{ confirmPassword: '' }, 'A confirmação de senha é obrigatória.'],
    [{ confirmPassword: 'different' }, 'As senhas não coincidem.'],
  ];
  for (const [invalidFields, message] of cases) {
    const h = createHarness('screens/auth/RegisterScreen.js');
    fillForm(h, registrationInputs, { ...validRegistration, ...invalidFields });
    h.act(() => h.press('Criar minha conta'));
    assert.deepEqual(h.navigationCalls, [], message);
    assert.ok(hasText(h, message), `missing validation error: ${message}`);
  }
});

test('registration can be corrected and its button forwards only trimmed name and email', () => {
  const h = createHarness('screens/auth/RegisterScreen.js');
  h.act(() => h.press('Criar minha conta'));
  assert.deepEqual(h.navigationCalls, []);
  const messages = [
    'O nome é obrigatório.', 'O e-mail é obrigatório.',
    'A senha é obrigatória.', 'A confirmação de senha é obrigatória.',
  ];
  for (const message of messages) assert.ok(hasText(h, message));

  fillForm(h, registrationInputs, {
    name: '  Ana  Maria  ', email: '  Ana@example.com  ',
    password: 'abcdef', confirmPassword: 'abcdef',
  });
  for (const message of messages) assert.equal(hasText(h, message), false);
  assert.deepEqual(h.navigationCalls, []);

  h.act(() => h.press('Criar minha conta'));
  assert.deepEqual(structuredClone(h.navigationCalls), [{
    type: 'navigate',
    name: 'ProfileQuestionnaire',
    params: { user: { name: 'Ana  Maria', email: 'Ana@example.com' } },
  }]);
  for (const message of messages) assert.equal(hasText(h, message), false);
});

test('login button blocks invalid forms and displays the relevant validation error', () => {
  const cases = [
    [{ email: '   ', password: 'x' }, 'O e-mail é obrigatório.'],
    [{ email: 'email-invalido', password: 'x' }, 'Informe um e-mail com formato válido.'],
    [{ email: 'teste@example.com', password: '' }, 'A senha é obrigatória.'],
  ];
  for (const [values, message] of cases) {
    const h = createHarness('screens/auth/LoginScreen.js');
    fillForm(h, loginInputs, values);
    h.act(() => h.press('Entrar na conta'));
    assert.deepEqual(h.navigationCalls, [], message);
    assert.ok(hasText(h, message), `missing validation error: ${message}`);
  }
});

test('login can be corrected and its button accepts a one-character password without forwarding credentials', () => {
  const h = createHarness('screens/auth/LoginScreen.js');
  fillForm(h, loginInputs, { email: 'email-invalido', password: '' });
  h.act(() => h.press('Entrar na conta'));
  assert.deepEqual(h.navigationCalls, []);
  const messages = ['Informe um e-mail com formato válido.', 'A senha é obrigatória.'];
  for (const message of messages) assert.ok(hasText(h, message));

  fillForm(h, loginInputs, { email: '  teste@example.com  ', password: 'x' });
  for (const message of messages) assert.equal(hasText(h, message), false);
  assert.deepEqual(h.navigationCalls, []);

  h.act(() => h.press('Entrar na conta'));
  assert.deepEqual(h.navigationCalls, [{ type: 'navigate', name: 'MainTabs', params: undefined }]);
  for (const message of messages) assert.equal(hasText(h, message), false);
});
