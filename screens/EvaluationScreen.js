import { useContext, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { ParticipationContext } from '../context/ParticipationContext';

export default function EvaluationScreen({ navigation }) {
  const { setParticipation } = useContext(ParticipationContext);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  function handleSkipEvaluation() {
    setParticipation(null);
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  }

  function handleSubmitEvaluation() {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return;
    }

    const evaluation = {
      rating,
      comment: comment.trim(),
    };

    console.log('Envio simulado da avaliação (dados não persistidos):', evaluation);
    handleSkipEvaluation();
  }

  return (
    <ScreenContainer>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Participação Finalizada</Text>
        <Text style={styles.message}>Obrigado por participar!</Text>
        <Text style={styles.message}>Como foi sua experiência?</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              key={value}
              style={styles.starButton}
              onPress={() => setRating(value)}
              accessibilityRole="radio"
              accessibilityLabel={`${value} ${value === 1 ? 'estrela' : 'estrelas'}`}
              accessibilityState={{ selected: rating === value }}
            >
              <Text style={[styles.star, value <= rating && styles.selectedStar]}>
                {value <= rating ? '★' : '☆'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.message}>Comentário (opcional)</Text>
        <TextInput
          style={styles.commentInput}
          value={comment}
          onChangeText={setComment}
          placeholder="Conte como foi sua experiência"
          accessibilityLabel="Comentário (opcional)"
          multiline
        />
        <Pressable
          style={[styles.button, rating === 0 && styles.buttonDisabled]}
          onPress={handleSubmitEvaluation}
          disabled={rating === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: rating === 0 }}
        >
          <Text style={styles.buttonText}>Enviar avaliação</Text>
        </Pressable>
        {/* Botão temporário para testes; na versão final, as estrelas serão obrigatórias e só o comentário será opcional. */}
        <Pressable style={styles.button} onPress={handleSkipEvaluation}>
          <Text style={styles.buttonText}>Pular avaliação</Text>
        </Pressable>
      </ScrollView>
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
  stars: {
    flexDirection: 'row',
    marginTop: 16,
  },
  starButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 48,
  },
  star: {
    color: '#767676',
    fontSize: 36,
  },
  selectedStar: {
    color: '#b8860b',
  },
  commentInput: {
    borderColor: '#999',
    borderRadius: 4,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 8,
    minHeight: 96,
    padding: 12,
    textAlignVertical: 'top',
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
  buttonDisabled: {
    opacity: 0.4,
  },
});
