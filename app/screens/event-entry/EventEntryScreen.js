import { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { ParticipationContext } from '../../context/ParticipationContext';

export default function EventEntryScreen({ navigation }) {
  const { admission, lookupEvent, isCurrentAdmission } = useContext(ParticipationContext);
  const [eventCode, setEventCode] = useState('');
  const [localError, setLocalError] = useState(null);
  const loading = admission?.status === 'looking_up';

  async function handleContinue() {
    if (loading) return;
    const code = eventCode.trim();
    if (!code) {
      setLocalError('Digite o código do evento.');
      return;
    }
    setLocalError(null);
    const result = await lookupEvent(code);
    if (result?.kind === 'found' && isCurrentAdmission()) {
      navigation.navigate('EventConfirmation', { event: result.event, eligibility: result.eligibility });
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.description}>
        Digite o código de acesso do evento.
      </Text>
      <TextInput
        placeholder="Código do evento"
        style={styles.input}
        value={eventCode}
        onChangeText={(value) => { setEventCode(value); setLocalError(null); }}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {localError || admission?.status === 'error' ? (
        <Text style={styles.error}>{localError ?? admission?.error}</Text>
      ) : null}
      <Pressable style={styles.button} onPress={handleContinue} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Consultando...' : 'Continuar'}</Text>
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
  error: {
    color: '#9b1c1c',
    marginTop: 12,
  },
});
