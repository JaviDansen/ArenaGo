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

async function expectDiagnostic(read, used, expected, hash = async () => {
  throw new Error('O hash não deveria ser chamado');
}) {
  await assert.rejects(prepareAccountHash(account, used, read, hash), error => {
    assert.equal(diagnosticMessage(error), expected);
    assert.ok(!diagnosticMessage(error).includes(sample));
    assert.ok(!diagnosticMessage(error).includes('PRIVATE_MARKER'));
    return true;
  });
}

test('diagnóstico: confirmação divergente', async () => {
  await expectDiagnostic(reader(sample, 'outra entrada'), new Set(), 'Confirmação de senha divergente.');
});

test('diagnóstico: comprimento abaixo e acima dos limites', async () => {
  for (const value of ['Abc123!', 'A'.repeat(129)]) {
    await expectDiagnostic(reader(value, value), new Set(), 'Comprimento de senha inválido: use de 8 a 128 caracteres.');
  }
});

test('diagnóstico: senha recusada pela política real', async () => {
  await expectDiagnostic(reader('password123', 'password123'), new Set(), 'Senha recusada pela política de segurança existente.');
});

test('diagnóstico: senha já usada nesta execução', async () => {
  await expectDiagnostic(reader(sample, sample), new Set([sample]), 'Senha já utilizada nesta execução.');
});

test('diagnóstico: falha de hash é sanitizada', async () => {
  await expectDiagnostic(reader(sample, sample), new Set(), 'Falha na geração do hash da senha.', async () => {
    throw new Error(`PRIVATE_MARKER ${sample}`);
  });
});

test('diagnóstico: falha em qualquer leitura é sanitizada', async () => {
  for (const read of [reader(new Error('PRIVATE_MARKER')), reader(sample, new Error('PRIVATE_MARKER'))]) {
    await expectDiagnostic(read, new Set(), 'Falha na leitura interativa.');
  }
});

test('diagnóstico: sucesso usa hash simulado e erro inesperado permanece genérico', async () => {
  const used = new Set();
  const value = await prepareAccountHash(account, used, reader(sample, sample), async (_secret, options) => {
    assert.equal(options.memoryCost, 19456);
    assert.equal(options.timeCost, 2);
    assert.equal(options.parallelism, 1);
    return 'hash-simulado';
  });
  assert.equal(value, 'hash-simulado');
  assert.equal(used.has(sample), true);
  assert.ok(!diagnosticMessage(new Error('PRIVATE_MARKER')).includes('PRIVATE_MARKER'));
  assert.match(diagnosticMessage(new Error('PRIVATE_MARKER')), /^Preparação não confirmada\./);
});
