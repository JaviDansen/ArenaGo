import { useContext, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { ParticipationContext } from '../../context/ParticipationContext';

export default function EvaluationScreen({ navigation, real = false, onSubmit, onLater,
  submitting = false, error = null, pendingIntent = false, onRetry }) {
  const { setParticipation } = useContext(ParticipationContext);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  function handleReturnHome() {
    if (real) { onLater?.(); return; }
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
    if (real) return onSubmit?.(evaluation);
    handleReturnHome();
    return evaluation;
  }

  return (
    <ScreenContainer>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Participação Finalizada</Text>
        {real ? <Text>Esta avaliação será enviada ao ArenaGo.</Text>
          : <Text>Modo demonstração: esta avaliação não será enviada ao servidor.</Text>}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
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
          style={[styles.button, (rating === 0 || submitting || pendingIntent) && styles.buttonDisabled]}
          onPress={handleSubmitEvaluation}
          disabled={rating === 0 || submitting || pendingIntent}
          accessibilityRole="button"
          accessibilityState={{ disabled: rating === 0 || submitting || pendingIntent }}
        >
          <Text style={styles.buttonText}>{submitting ? 'Enviando...' : 'Enviar avaliação'}</Text>
        </Pressable>
        {real && pendingIntent ? (
          <Pressable style={styles.button} onPress={onRetry} disabled={submitting} accessibilityRole="button">
            <Text style={styles.buttonText}>Conferir tentativa anterior</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.button, styles.secondaryButton]}
          onPress={handleReturnHome}
          disabled={submitting}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>
            Avaliar mais tarde
          </Text>
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
  secondaryButton: {
    backgroundColor: '#fff',
    borderColor: '#767676',
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: '#333',
  },
  error: { color: '#9b1c1c', marginTop: 16 },
});
