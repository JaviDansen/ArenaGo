import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import AdminButton from './AdminButton';
import { AdminIcon, AdminIconTile, liveColors as c, liveStyles as s } from './AdminLiveUI';
import { resolveEventTime, scheduleFields } from '../adminScheduleForm';

export function SettingsSection({ title, icon, children }) {
  return <View style={s.card}>
    <View style={s.row}><AdminIconTile name={icon} /><Text accessibilityRole="header" style={[s.grow, s.title]}>{title}</Text></View>
    <View style={styles.fields}>{children}</View>
  </View>;
}

export function SettingsField({ label, value, onChangeText, children, placeholder, keyboardType, paired }) {
  return <View style={[styles.field, paired && styles.pairItem]}>
    <Text style={styles.label}>{label}</Text>
    {onChangeText ? <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      style={styles.input} placeholder={placeholder} placeholderTextColor={c.muted} keyboardType={keyboardType} /> :
      children ?? <View style={[styles.input, styles.readOnly]} accessibilityLabel={`${label}: ${value}. Somente leitura.`}>
        <Text selectable style={styles.label}>{value}</Text>
      </View>}
  </View>;
}

export function ScheduleDateTime({ label, value, instant, timezone, onChange }) {
  const [picker, setPicker] = useState(null);
  function choose(mode) {
    let at;
    try { at = new Date(resolveEventTime(value, timezone)); } catch { at = new Date(instant); }
    const options = { mode, value: at, timeZoneName: timezone, is24Hour: true };
    const apply = date => {
      const next = scheduleFields(date, timezone);
      const field = mode === 'date' ? 'date' : 'time';
      onChange({ ...value, [field]: next[field] });
    };
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ ...options, onValueChange: (_, date) => { if (date) apply(date); } });
    } else setPicker({ options, apply, date: at });
  }
  return <>
    <View style={styles.pair}>
      {['date', 'time'].map(field => {
        const isDate = field === 'date';
        const fieldLabel = `${isDate ? 'Data' : 'Hora'} de ${label}`;
        const nativeControl = onChange && Platform.OS !== 'web';
        return <SettingsField key={field} label={fieldLabel} value={value[field]} paired
          onChangeText={onChange && !nativeControl ? text => onChange({ ...value, [field]: text }) : undefined}
          placeholder={isDate ? 'DD/MM/AAAA' : 'HH:MM'} keyboardType={isDate ? undefined : 'numbers-and-punctuation'}>
          {nativeControl ? <Pressable accessibilityRole="button" accessibilityLabel={fieldLabel} onPress={() => choose(field)}
            style={[styles.input, styles.pickerButton]}>
            <Text style={styles.label}>{value[field]}</Text>
            <AdminIcon name={isDate ? 'calendar' : 'history'} size={20} />
          </Pressable> : null}
        </SettingsField>;
      })}
    </View>
    {picker && onChange ? <View>
      <DateTimePicker {...picker.options} value={picker.date} display="spinner" themeVariant="dark"
        onValueChange={(_, date) => { if (date) setPicker(current => current && { ...current, date }); }} />
      <AdminButton label="Confirmar seleção" onPress={() => { picker.apply(picker.date); setPicker(null); }} compact />
      <AdminButton label="Cancelar seleção" onPress={() => setPicker(null)} variant="ghost" compact />
    </View> : null}
  </>;
}

const styles = StyleSheet.create({
  fields: { marginTop: 12, gap: 10 },
  field: { minWidth: 0, gap: 5 },
  pairItem: { flexGrow: 1, flexBasis: 120 },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  label: { color: c.text, fontSize: 15 },
  input: { minHeight: 44, justifyContent: 'center', color: c.text, fontSize: 16, backgroundColor: c.background,
    borderRadius: 9, borderWidth: 1, borderColor: '#a189ba', paddingHorizontal: 12, paddingVertical: 8 },
  readOnly: { backgroundColor: '#252033', borderColor: '#54465f' },
  pickerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
});
