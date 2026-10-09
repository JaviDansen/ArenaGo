import { StyleSheet, TextInput, View } from 'react-native';

import {
  formatBirthDate,
  getTodayCivilDate,
  maskBirthDate,
  parseBirthDate,
} from '../utils/birthDate';

export default function BirthDateInput({
  value,
  onChangeText,
  error,
  inputStyle,
  errorStyle,
  placeholderTextColor,
}) {
  const fieldStyle = StyleSheet.flatten(inputStyle) || {};
  const tintColor = fieldStyle.color || '#ffffff';

  function handleCalendarChange(event) {
    const selectedDate = event.currentTarget.value;
    onChangeText(selectedDate ? formatBirthDate(selectedDate) : '');
  }

  function openPicker(event) {
    const input = event.currentTarget;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        // O clique continua no input nativo quando o navegador limita showPicker.
      }
    }
  }

  return (
    <View style={styles.fieldContainer}>
      <TextInput
        accessibilityLabel="Data de nascimento"
        style={[inputStyle, error ? errorStyle : null, styles.inputWithCalendar]}
        placeholder="DD/MM/AAAA"
        placeholderTextColor={placeholderTextColor}
        value={value}
        onChangeText={(text) => onChangeText(maskBirthDate(text))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={10}
        autoCorrect={false}
      />
      <View style={styles.calendarButton}>
        <View accessible={false} style={[styles.calendarIcon, { borderColor: tintColor }]}>
          <View style={[styles.calendarHeader, { borderColor: tintColor }]} />
          <View style={[styles.calendarDate, { backgroundColor: tintColor }]} />
        </View>
        <input
          className="arena-birth-date-picker"
          type="date"
          aria-label="Abrir calendário de data de nascimento"
          aria-haspopup="dialog"
          value={parseBirthDate(value) || ''}
          max={getTodayCivilDate()}
          onChange={handleCalendarChange}
          onClick={openPicker}
          style={nativePickerStyle}
        />
      </View>
      <style>{`
        .arena-birth-date-picker::-webkit-calendar-picker-indicator {
          position: absolute;
          top: 0;
          right: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          cursor: pointer;
        }
      `}</style>
    </View>
  );
}

const nativePickerStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
  boxSizing: 'border-box',
  padding: 0,
  border: 0,
};

const styles = StyleSheet.create({
  fieldContainer: {
    position: 'relative',
  },
  inputWithCalendar: {
    paddingRight: 56,
  },
  calendarButton: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 4,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarIcon: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 3,
  },
  calendarHeader: {
    height: 5,
    borderBottomWidth: 2,
  },
  calendarDate: {
    width: 4,
    height: 4,
    marginTop: 3,
    marginLeft: 3,
  },
});
