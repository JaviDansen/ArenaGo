import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput } from 'react-native';

import { mockEvents } from '../data/mockData';

export default function EventEntryScreen({ navigation }) {
  const [eventCode, setEventCode] = useState('');

  function handleContinue() {
    const trimmedCode = eventCode.trim();

    if (trimmedCode === '') {
      return;
    }

    const event = mockEvents[trimmedCode];

    if (!event) {
      return;
    }

    console.log(trimmedCode);
    navigation.navigate('EventConfirmation', { event });
  }

  return (
    <SafeAreaView style={styles.container}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
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
