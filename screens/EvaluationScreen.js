import { useContext } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { ParticipationContext } from '../context/ParticipationContext';

export default function EvaluationScreen({ navigation }) {
  const { setParticipation } = useContext(ParticipationContext);

  function handleSkipEvaluation() {
    setParticipation(null);
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>Participação Finalizada</Text>
      <Text style={styles.message}>Obrigado por participar!</Text>
      <Text style={styles.message}>Como foi sua experiência?</Text>
      {/* Botão temporário para testes; na versão final, as estrelas serão obrigatórias e só o comentário será opcional. */}
      <Pressable style={styles.button} onPress={handleSkipEvaluation}>
        <Text style={styles.buttonText}>Pular avaliação</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  message: {
    fontSize: 16,
    marginTop: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 4,
    marginTop: 24,
    padding: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
