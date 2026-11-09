import { StatusBar } from 'expo-status-bar';
import { useContext, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AuthBackground, Badge, Button, Card, InputField, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, spacing, typography } from '../../theme';

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
    <AuthBackground variant="login" overlayOpacity={0.65} testID="event-entry-background">
      <StatusBar style="light" />
      <ScreenHeader title="Entrar em um evento" onBack={() => navigation.goBack()} testID="event-entry-header" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroSection}>
            <Badge label="CHECK-IN PRESENCIAL" variant="brand" />
            <Text style={styles.title}>Digite o código de acesso</Text>
            <Text style={styles.description}>
              Informe o código disponibilizado na recepção ou nas estações do evento para consultar sua entrada.
            </Text>
          </View>

          <Card variant="highlight" style={styles.formCard} testID="event-entry-form-card">
            <Badge label="CÓDIGO DO EVENTO" variant="default" />
            <InputField
              value={eventCode}
              onChangeText={(value) => { setEventCode(value); setLocalError(null); }}
              placeholder="Ex.: ARENA123"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!loading}
              error={localError || (admission?.status === 'error' ? admission.error : null)}
              testID="event-entry-code-input"
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              containerStyle={styles.codeInput}
            />
            <Text style={styles.helperText}>O código é fornecido presencialmente pela equipe do evento.</Text>
            <Button
              title={loading ? 'Consultando...' : 'Continuar'}
              variant="primary"
              onPress={handleContinue}
              disabled={loading}
              style={styles.continueButton}
              testID="event-entry-continue-button"
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  heroSection: {
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginTop: spacing.lg,
  },
  description: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  formCard: {
    alignItems: 'stretch',
  },
  codeInput: {
    marginTop: spacing.lg,
  },
  helperText: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  continueButton: {
    marginTop: spacing.xl,
  },
});
