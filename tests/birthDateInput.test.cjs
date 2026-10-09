const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./helpers/questionnaireHarness.cjs');

function input(platform, value = '') {
  const changes = [];
  const h = createHarness(`components/BirthDateInput.${platform === 'web' ? 'web' : 'native'}.js`, {
    platform,
    props: { value, onChangeText: (next) => changes.push(next),
      inputStyle: { color: '#ffffff', backgroundColor: '#141026' } },
  });
  return { h, changes };
}

test('both platforms have one masked numeric field and derive picker values from typing', () => {
  for (const platform of ['ios', 'web']) {
    const { h, changes } = input(platform);
    const fields = h.nodes.filter((n) => n.type === 'TextInput');
    assert.equal(fields.length, 1);
    assert.equal(fields[0].props.keyboardType, 'number-pad');
    assert.equal(fields[0].props.placeholder, 'DD/MM/AAAA');
    h.act(() => fields[0].props.onChangeText('29022024'));
    assert.deepEqual(changes, ['29/02/2024']);
    h.setProps({ value: changes[0] });
    if (platform === 'ios') {
      h.act(() => h.press('Abrir calendário de data de nascimento'));
      const picker = h.nodes.find((n) => n.type === 'DateTimePicker');
      assert.equal(h.birthDate.localDateToCivilDate(picker.props.value), '2024-02-29');
    } else {
      const picker = h.nodes.find((n) => n.type === 'input');
      assert.equal(picker.props.value, '2024-02-29');
      assert.equal(picker.props.max, h.birthDate.getTodayCivilDate());
    }
  }
});

test('iPhone selection fills the field and grouped confirmation does not replace it', () => {
  const { h, changes } = input('ios');
  h.act(() => h.press('Abrir calendário de data de nascimento'));
  const picker = h.nodes.find((n) => n.type === 'DateTimePicker');
  h.act(() => {
    picker.props.onValueChange({}, h.birthDate.civilDateToLocalDate('2024-02-29'));
    h.press('Usar data selecionada');
  });
  assert.deepEqual(changes, ['29/02/2024']);
  assert.equal(h.nodes.find((n) => n.type === 'Modal').props.visible, false);
  h.setProps({ value: changes[0] });
  h.act(() => h.press('Abrir calendário de data de nascimento'));
  assert.equal(h.birthDate.localDateToCivilDate(h.nodes.find((n) => n.type === 'DateTimePicker').props.value), '2024-02-29');
});

test('iPhone can confirm today without first changing the initial picker value', () => {
  const { h, changes } = input('ios');
  h.act(() => h.press('Abrir calendário de data de nascimento'));
  h.act(() => h.press('Usar data selecionada'));
  assert.deepEqual(changes, [h.birthDate.formatBirthDate(h.birthDate.getTodayCivilDate())]);
});

test('web native calendar selection fills display text and tolerates showPicker fallbacks', () => {
  const { h, changes } = input('web', '29/02/2024');
  const picker = h.nodes.find((n) => n.type === 'input');
  assert.equal(picker.props.type, 'date');
  h.act(() => picker.props.onChange({ currentTarget: { value: '2005-12-31' } }));
  assert.deepEqual(changes, ['31/12/2005']);
  h.setProps({ value: changes[0] });
  assert.equal(h.nodes.find((n) => n.type === 'input').props.value, '2005-12-31');
  let opened = 0;
  picker.props.onClick({ currentTarget: { showPicker() { opened++; } } });
  assert.equal(opened, 1);
  assert.doesNotThrow(() => picker.props.onClick({ currentTarget: {} }));
  assert.doesNotThrow(() => picker.props.onClick({ currentTarget: { showPicker() { throw new Error('blocked'); } } }));
});

test('Android native picker receives the same civil date and fills the masked display', () => {
  const { h, changes } = input('android', '29/02/2024');
  h.act(() => h.press('Abrir calendário de data de nascimento'));
  assert.equal(h.nativePickerCalls.length, 1);
  const picker = h.nativePickerCalls[0];
  assert.equal(picker.mode, 'date');
  assert.equal(h.birthDate.localDateToCivilDate(picker.value), '2024-02-29');
  assert.equal(h.birthDate.localDateToCivilDate(picker.maximumDate), h.birthDate.getTodayCivilDate());
  picker.onValueChange({}, h.birthDate.civilDateToLocalDate('2000-02-29'));
  assert.deepEqual(changes, ['29/02/2000']);
});
