import { StatusBar } from 'expo-status-bar';
import { useContext, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, InputField } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, spacing, typography } from '../../theme';

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
    <AuthBackground variant="login" overlayOpacity={0.68} testID="evaluation-background">
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Badge label={real ? 'AVALIAÇÃO DE EVENTO' : 'MODO DEMONSTRAÇÃO'} variant={real ? 'brand' : 'default'} />
        <Text style={styles.title}>Participação Finalizada</Text>
        {real ? <Text style={styles.description}>Esta avaliação será enviada ao ArenaGo.</Text>
          : <Text style={styles.description}>Esta avaliação de demonstração não será enviada ao servidor.</Text>}
        {error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Badge label="NÃO FOI POSSÍVEL ENVIAR" variant="danger" />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <Card variant="highlight" style={styles.formCard}>
          <Text style={styles.message}>Obrigado por participar!</Text>
          <Text style={styles.prompt}>Como foi sua experiência?</Text>
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
          <InputField
            label="Comentário (opcional)"
            value={comment}
            onChangeText={setComment}
            placeholder="Conte como foi sua experiência"
            accessibilityLabel="Comentário (opcional)"
            multiline
            inputStyle={styles.commentInput}
            containerStyle={styles.commentField}
            testID="evaluation-comment"
          />
          <Button
            title={submitting ? 'Enviando...' : 'Enviar avaliação'}
            variant="primary"
            onPress={handleSubmitEvaluation}
            disabled={rating === 0 || submitting || pendingIntent}
            style={styles.actionButton}
            testID="evaluation-submit"
          />
          {real && pendingIntent ? (
            <Button
              title="Conferir tentativa anterior"
              variant="outline"
              onPress={onRetry}
              disabled={submitting}
              style={styles.actionButton}
            />
          ) : null}
          <Button
            title="Avaliar mais tarde"
            variant="ghost"
            onPress={handleReturnHome}
            disabled={submitting}
            style={styles.actionButton}
          />
        </Card>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
  title: { ...typography.titleLarge, color: colors.text.primary, marginTop: spacing.md },
  description: { ...typography.body, color: colors.text.secondary, marginTop: spacing.sm },
  errorCard: { borderColor: colors.semantic.danger, borderWidth: 1, backgroundColor: colors.semantic.dangerBg, borderRadius: 12, padding: spacing.lg, marginTop: spacing.lg },
  error: { ...typography.body, color: '#FF9AAE', marginTop: spacing.sm },
  formCard: { alignItems: 'stretch', marginTop: spacing.xl },
  message: { ...typography.titleSmall, color: colors.text.primary },
  prompt: { ...typography.bodyLarge, color: colors.text.secondary, marginTop: spacing.md },
  stars: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  starButton: { alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 48 },
  star: { color: colors.text.muted, fontSize: 36 },
  selectedStar: { color: colors.semantic.warning },
  commentField: { marginTop: spacing.lg },
  commentInput: { minHeight: 104, textAlignVertical: 'top' },
  actionButton: { marginTop: spacing.md },
});
