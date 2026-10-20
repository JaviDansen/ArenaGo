import { useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  civilDateToLocalDate,
  formatBirthDate,
  getTodayCivilDate,
  localDateToCivilDate,
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
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const hasSelectedDate = useRef(false);
  const fieldStyle = StyleSheet.flatten(inputStyle) || {};
  const tintColor = fieldStyle.color || '#ffffff';
  const today = getTodayCivilDate();
  const pickerDate = civilDateToLocalDate(parseBirthDate(value) || today);

  function handleDateSelected(_event, selectedDate) {
    if (!selectedDate) return;

    const displayDate = formatBirthDate(localDateToCivilDate(selectedDate));
    if (parseBirthDate(displayDate)) {
      hasSelectedDate.current = true;
      onChangeText(displayDate);
    }
  }

  function openPicker() {
    Keyboard.dismiss();

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: pickerDate,
        maximumDate: civilDateToLocalDate(today),
        onValueChange: handleDateSelected,
      });
      return;
    }

    hasSelectedDate.current = Boolean(parseBirthDate(value));
    setIsPickerOpen(true);
  }

  function confirmPicker() {
    // O spinner não emite mudança ao confirmar a data inicial já destacada.
    if (!hasSelectedDate.current) {
      handleDateSelected(null, pickerDate);
    }
    setIsPickerOpen(false);
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
      <Pressable
        style={styles.calendarButton}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel="Abrir calendário de data de nascimento"
      >
        <View accessible={false} style={[styles.calendarIcon, { borderColor: tintColor }]}>
          <View style={[styles.calendarHeader, { borderColor: tintColor }]} />
          <View style={[styles.calendarDate, { backgroundColor: tintColor }]} />
        </View>
      </Pressable>

      {Platform.OS === 'ios' && (
        <Modal
          visible={isPickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setIsPickerOpen(false)}
        >
          <View style={styles.modalContainer}>
            <Pressable
              style={styles.backdrop}
              onPress={() => setIsPickerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Fechar calendário"
            />
            <SafeAreaView
              edges={['bottom']}
              accessibilityViewIsModal
              style={[
                styles.pickerPanel,
                { backgroundColor: fieldStyle.backgroundColor || '#141026' },
              ]}
            >
              <View style={styles.pickerHeader}>
                <Text style={[styles.pickerTitle, { color: tintColor }]}>Data de nascimento</Text>
                <Pressable
                  onPress={() => setIsPickerOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar calendário"
                  style={styles.closeButton}
                >
                  <Text style={{ color: tintColor }}>Fechar</Text>
                </Pressable>
              </View>
              {isPickerOpen && (
                <DateTimePicker
                  value={pickerDate}
                  mode="date"
                  display="spinner"
                  locale="pt-BR"
                  maximumDate={civilDateToLocalDate(today)}
                  onValueChange={handleDateSelected}
                  textColor={tintColor}
                  style={styles.picker}
                />
              )}
              <Pressable
                onPress={confirmPicker}
                accessibilityRole="button"
                accessibilityLabel="Usar data selecionada"
                style={[styles.confirmButton, { borderColor: tintColor }]}
              >
                <Text style={{ color: tintColor }}>Usar esta data</Text>
              </Pressable>
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </View>
  );
}

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
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  pickerPanel: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  picker: {
    alignSelf: 'stretch',
  },
  confirmButton: {
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 12,
  },
});
