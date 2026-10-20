const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const birthDateSource = readFileSync(path.join(__dirname, '../utils/birthDate.js'), 'utf8');
const birthDateURL = `data:text/javascript;base64,${Buffer.from(birthDateSource).toString('base64')}`;
const birthDateModule = import(birthDateURL);
const validationSource = readFileSync(path.join(__dirname, '../utils/validation.js'), 'utf8')
  .replace("'./birthDate'", JSON.stringify(birthDateURL));
const validationModule = import(
  `data:text/javascript;base64,${Buffer.from(validationSource).toString('base64')}`
);
const today = '2026-10-09';

test('birth-date mask supports partial typing, formatted input and deletion', async () => {
  const { maskBirthDate } = await birthDateModule;
  const expected = ['', '2', '29', '29/0', '29/02', '29/02/2', '29/02/20', '29/02/202', '29/02/2024'];
  for (let length = 0; length <= 8; length += 1) {
    assert.equal(maskBirthDate('29022024'.slice(0, length)), expected[length]);
  }
  assert.equal(maskBirthDate('29/02/2024'), '29/02/2024');
  assert.equal(maskBirthDate('29/02/202'), '29/02/202');
  assert.equal(maskBirthDate('29/02/'), '29/02');
  assert.equal(maskBirthDate('abc29022024999'), '29/02/2024');
  assert.equal(maskBirthDate(null), '');
});

test('parsing rejects empty, incomplete and non-display formats', async () => {
  const { parseBirthDate } = await birthDateModule;
  for (const display of ['', ' ', '09/10/202', '9/10/2026', '09/1/2026', '09102026', '2026-10-09', null, 2026]) {
    assert.equal(parseBirthDate(display, today), null, String(display));
  }
});

test('parsing rejects impossible dates without relying on Date rollover', async () => {
  const { parseBirthDate } = await birthDateModule;
  for (const display of ['31/02/2005', '31/04/2005', '00/01/2005', '01/00/2005', '01/13/2005', '01/01/0000']) {
    assert.equal(parseBirthDate(display, today), null, display);
  }
});

test('Gregorian leap years include 2024 and 2000 but exclude 2025 and 1900', async () => {
  const { parseBirthDate } = await birthDateModule;
  const cases = [
    ['29/02/2024', '2024-02-29'],
    ['29/02/2025', null],
    ['29/02/1900', null],
    ['29/02/2000', '2000-02-29'],
    ['29/02/0004', '0004-02-29'],
    ['29/02/0001', null],
  ];
  for (const [display, expected] of cases) assert.equal(parseBirthDate(display, today), expected);
});

test('parsing accepts today and ancient birth dates and rejects the future', async () => {
  const { parseBirthDate } = await birthDateModule;
  assert.equal(parseBirthDate('09/10/2026', today), today);
  assert.equal(parseBirthDate('08/10/2026', today), '2026-10-08');
  assert.equal(parseBirthDate('10/10/2026', today), null);
  assert.equal(parseBirthDate('01/01/0001', today), '0001-01-01');
  assert.equal(parseBirthDate('31/12/9999', '9999-12-31'), '9999-12-31');
  assert.equal(parseBirthDate(' 09/10/2026 ', today), today);
});

test('civil formatting preserves all four year digits and rejects invalid ISO dates', async () => {
  const { formatBirthDate, parseBirthDate } = await birthDateModule;
  for (const [iso, display] of [
    ['0001-01-01', '01/01/0001'],
    ['0099-12-31', '31/12/0099'],
    ['2000-02-29', '29/02/2000'],
    ['2026-10-09', '09/10/2026'],
  ]) {
    assert.equal(formatBirthDate(iso), display);
    assert.equal(parseBirthDate(display, today), iso);
  }
  for (const iso of ['', null, '2026-2-01', '2025-02-29', '0000-01-01']) {
    assert.equal(formatBirthDate(iso), '');
  }
});

test('calendar conversion uses local noon and preserves years below 100', async () => {
  const { civilDateToLocalDate, localDateToCivilDate } = await birthDateModule;
  for (const iso of ['0001-01-01', '0099-12-31', '1900-03-01', '2000-02-29', today]) {
    const date = civilDateToLocalDate(iso);
    assert.equal(date.getFullYear(), Number(iso.slice(0, 4)));
    assert.equal(date.getHours(), 12);
    assert.equal(localDateToCivilDate(date), iso);
  }
  assert.equal(civilDateToLocalDate('2025-02-29'), null);
  assert.equal(civilDateToLocalDate('0000-01-01'), null);
  assert.equal(localDateToCivilDate(new Date(NaN)), null);
  assert.equal(localDateToCivilDate(null), null);
});

test('today is obtained from local calendar components at either end of the day', async () => {
  const { civilDateToLocalDate, getTodayCivilDate } = await birthDateModule;
  const date = civilDateToLocalDate(today);
  date.setHours(0, 1, 0, 0);
  assert.equal(getTodayCivilDate(date), today);
  date.setHours(23, 59, 0, 0);
  assert.equal(getTodayCivilDate(date), today);
});

test('birth-date validation distinguishes required, incomplete, impossible and future dates', async () => {
  const { validateAboutYouStep } = await validationModule;
  const answers = { gender: 'Masculino', education: 'Superior' };
  const cases = [
    ['', 'A data de nascimento é obrigatória.'],
    ['09/10/202', 'Informe a data completa no formato DD/MM/AAAA.'],
    ['31/02/2005', 'Informe uma data de nascimento válida.'],
    ['29/02/2025', 'Informe uma data de nascimento válida.'],
    ['10/10/2026', 'A data de nascimento não pode estar no futuro.'],
  ];
  for (const [birthDate, message] of cases) {
    const result = validateAboutYouStep({ ...answers, birthDate }, today);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, { birthDate: message });
  }
  for (const birthDate of ['29/02/2024', '09/10/2026', '01/01/0001']) {
    assert.deepEqual(validateAboutYouStep({ ...answers, birthDate }, today), { isValid: true, errors: {} });
  }
  const oldAgeOnly = validateAboutYouStep({ ...answers, age: '22' }, today);
  assert.deepEqual(oldAgeOnly.errors, { birthDate: 'A data de nascimento é obrigatória.' });
});

test('gender, Other specification and education rules remain mandatory', async () => {
  const { validateAboutYouStep } = await validationModule;
  const birthDate = '29/02/2024';
  assert.deepEqual(validateAboutYouStep({ birthDate }, today).errors, {
    gender: 'Selecione uma opção de gênero.',
    education: 'Selecione seu nível de escolaridade.',
  });
  assert.deepEqual(validateAboutYouStep({ birthDate, gender: 'Outro', otherGender: ' ', education: 'Superior' }, today).errors, {
    otherGender: 'Por favor, especifique o seu gênero.',
  });
  for (const gender of ['Feminino', 'Masculino', 'Prefiro não informar']) {
    assert.equal(validateAboutYouStep({ birthDate, gender, education: 'Superior' }, today).isValid, true);
  }
  assert.equal(validateAboutYouStep({ birthDate, gender: 'Outro', otherGender: 'Resposta', education: 'Superior' }, today).isValid, true);
});

test('civil dates and local today stay correct across time zones and DST boundaries', () => {
  const zones = [
    ['UTC', '2026-10-09'],
    ['America/Sao_Paulo', '2026-10-08'],
    ['America/New_York', '2026-10-08'],
    ['Europe/London', '2026-10-09'],
    ['Pacific/Kiritimati', '2026-10-09'],
    ['Pacific/Honolulu', '2026-10-08'],
  ];
  for (const [zone, expectedToday] of zones) {
    const script = `
      import assert from 'node:assert/strict';
      import { civilDateToLocalDate, localDateToCivilDate, getTodayCivilDate, parseBirthDate } from ${JSON.stringify(birthDateURL)};
      for (const iso of ['0001-01-01', '0099-12-31', '1900-03-01', '2000-02-29', '2018-11-04', '2024-03-10', '2024-11-03', '${today}']) {
        const localDate = civilDateToLocalDate(iso);
        assert.equal(localDate.getHours(), 12);
        assert.equal(localDateToCivilDate(localDate), iso);
      }
      const fixedInstant = new Date(Date.UTC(2026, 9, 9, 0, 30));
      const localToday = getTodayCivilDate(fixedInstant);
      assert.equal(localToday, '${expectedToday}');
      const displayToday = localToday.slice(8, 10) + '/' + localToday.slice(5, 7) + '/' + localToday.slice(0, 4);
      assert.equal(parseBirthDate(displayToday, localToday), localToday);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${zone}: ${result.stderr || result.error || result.stdout}`);
  }
});
