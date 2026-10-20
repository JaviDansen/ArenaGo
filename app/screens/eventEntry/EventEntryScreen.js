import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { mockEvents } from '../../data/mockData';

export default function EventEntryScreen({ navigation }) {
  const [eventCode, setEventCode] = useState('');

  function handleContinue() {
    const normalizedCode = eventCode.trim().toUpperCase();

    if (normalizedCode === '') {
      return;
    }

    const event = Object.prototype.hasOwnProperty.call(mockEvents, normalizedCode)
      ? mockEvents[normalizedCode]
      : null;

    if (!event) {
      return;
    }

    console.log(normalizedCode);
    navigation.navigate('EventConfirmation', { event });
  }

  return (
    <ScreenContainer>
      <Text style={styles.description}>
        Escaneie o QR Code do evento ou digite o código de acesso.
      </Text>
      <TextInput
        placeholder="Código do evento"
        style={styles.input}
        value={eventCode}
        onChangeText={setEventCode}
      />
      <Pressable style={styles.button} onPress={handleContinue}>
        <Text style={styles.buttonText}>Continuar</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  description: {
    fontSize: 16,
    marginTop: 16,
  },
  input: {
    borderColor: '#000',
    borderRadius: 4,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 4,
    marginTop: 16,
    padding: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
