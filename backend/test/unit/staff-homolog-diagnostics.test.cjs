'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prepareAccountHash, diagnosticMessage } = require('../../scripts/prepare-staff-homologation.cjs');

const account = { name: 'Conta ficticia', email: 'teste@arenago.invalid' };
const sample = 'Senha-Ficticia-42!';

function reader(...answers) {
  return async (_prompt, hidden) => {
    assert.equal(hidden, true);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

async function expectDiagnostic(read, passwordState, isAdmin, expected, hash = async () => {
  throw new Error('O hash não deveria ser chamado');
}) {
  await assert.rejects(prepareAccountHash(account, passwordState, isAdmin, read, hash), error => {
    assert.equal(diagnosticMessage(error), expected);
    assert.ok(!diagnosticMessage(error).includes(sample));
    assert.ok(!diagnosticMessage(error).includes('PRIVATE_MARKER'));
    return true;
  });
}

test('diagnóstico: confirmação divergente', async () => {
  await expectDiagnostic(reader(sample, 'outra entrada'), { adminSecret: undefined, nonAdminSecrets: new Set() }, false, 'Confirmação de senha divergente.');
});

test('diagnóstico: comprimento abaixo e acima dos limites', async () => {
  for (const value of ['Abc123!', 'A'.repeat(129)]) {
    await expectDiagnostic(reader(value, value), { adminSecret: undefined, nonAdminSecrets: new Set() }, false, 'Comprimento de senha inválido: use de 8 a 128 caracteres.');
  }
});

test('diagnóstico: senha recusada pela política real', async () => {
  await expectDiagnostic(reader('password123', 'password123'), { adminSecret: undefined, nonAdminSecrets: new Set() }, false, 'Senha recusada pela política de segurança existente.');
});

test('senha Admin não pode ser reutilizada por Staff ou participantes', async () => {
  const state = { adminSecret: undefined, nonAdminSecrets: new Set() };
  await prepareAccountHash({ ...account, email: 'admin@arenago.invalid' }, state, true, reader('Senha-Admin-Ficticia-42!', 'Senha-Admin-Ficticia-42!'), async () => 'hash-admin');
  await expectDiagnostic(reader('Senha-Admin-Ficticia-42!', 'Senha-Admin-Ficticia-42!'), state, false, 'A senha do Admin deve ser exclusiva das demais contas.');
});

test('diagnóstico: falha de hash é sanitizada', async () => {
  await expectDiagnostic(reader(sample, sample), { adminSecret: undefined, nonAdminSecrets: new Set() }, false, 'Falha na geração do hash da senha.', async () => {
    throw new Error(`PRIVATE_MARKER ${sample}`);
  });
});

test('diagnóstico: falha em qualquer leitura é sanitizada', async () => {
  for (const read of [reader(new Error('PRIVATE_MARKER')), reader(sample, new Error('PRIVATE_MARKER'))]) {
    await expectDiagnostic(read, { adminSecret: undefined, nonAdminSecrets: new Set() }, false, 'Falha na leitura interativa.');
  }
});

test('diagnóstico: sucesso usa hash simulado e erro inesperado permanece genérico', async () => {
  const state = { adminSecret: undefined, nonAdminSecrets: new Set() };
  const value = await prepareAccountHash(account, state, false, reader(sample, sample), async (_secret, options) => {
    assert.equal(options.memoryCost, 19456);
    assert.equal(options.timeCost, 2);
    assert.equal(options.parallelism, 1);
    return 'hash-simulado';
  });
  assert.equal(value, 'hash-simulado');
  assert.equal(state.nonAdminSecrets.has(sample), true);
  assert.ok(!diagnosticMessage(new Error('PRIVATE_MARKER')).includes('PRIVATE_MARKER'));
  assert.match(diagnosticMessage(new Error('PRIVATE_MARKER')), /^Preparação não confirmada\./);
});

test('Staff e os cinco participantes podem compartilhar senha sintética', async () => {
  const state = { adminSecret: 'Senha-Admin-Ficticia-42!', nonAdminSecrets: new Set() };
  const accounts = [
    { name: 'Staff fictício', email: 'staff@arenago.invalid' },
    ...Array.from({ length: 5 }, (_, index) => ({ name: `Participante ${index + 1}`, email: `p${index + 1}@arenago.invalid` })),
  ];
  for (const item of accounts) {
    const hash = await prepareAccountHash(item, state, false, reader(sample, sample), async () => 'hash-simulado');
    assert.equal(hash, 'hash-simulado');
  }
  assert.deepEqual([...state.nonAdminSecrets], [sample]);
});

test('Admin não pode repetir senha já informada antes na sequência', async () => {
  const state = { adminSecret: undefined, nonAdminSecrets: new Set([sample]) };
  await expectDiagnostic(reader(sample, sample), state, true, 'A senha do Admin deve ser exclusiva das demais contas.');
});
