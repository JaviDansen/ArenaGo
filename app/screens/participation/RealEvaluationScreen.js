import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';

import { AuthBackground, Badge, Card } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { ParticipationContext } from '../../context/ParticipationContext';
import { createParticipationActionCoordinator, describeParticipationActionError } from '../../services/participationActionService';
import { validateHistoryItem } from '../../services/participationHistoryService';
import { colors, spacing, typography } from '../../theme';
import EvaluationScreen from './EvaluationScreen';

export default function RealEvaluationScreen({ navigation, route }) {
  const auth = useAuth();
  const { refreshParticipation } = useContext(ParticipationContext);
  const userId = auth?.isAuthenticated ? auth.user?.id : null;
  const getEpoch = auth?.getSessionEpoch;
  const epoch = typeof getEpoch === 'function' ? getEpoch() : null;
  const item = route?.params?.historyItem;
  const participationId = route?.params?.participationId;
  const valid = validateHistoryItem(item) && item.participationId === participationId
    && item.status === 'finished' && item.evaluation.eligible && item.evaluation.pending
    && !item.evaluation.submitted;
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const coordinator = useMemo(() => createParticipationActionCoordinator({
    client: auth?.httpClient,
    createKey: () => Crypto.randomUUID(),
    isCurrent: () => mounted.current && auth?.isAuthenticated && auth?.user?.id === userId
      && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [auth, epoch, getEpoch, userId]);

  useEffect(() => {
    mounted.current = true;
    if (valid && userId) {
      coordinator.pending(userId, 'evaluation').then(intent => {
        if (mounted.current) setPending(Boolean(intent));
      }).catch(err => { if (mounted.current) setError(describeParticipationActionError(err, 'evaluation')); });
    }
    return () => { mounted.current = false; };
  }, [coordinator, userId, valid]);

  const submit = useCallback(async payload => {
    if (busyRef.current || !mounted.current || !valid || !userId) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await coordinator.submit(userId, participationId, payload);
      if (!mounted.current) return;
      await refreshParticipation();
      if (mounted.current) navigation.navigate('MainTabs', { screen: 'Eventos' });
    } catch (err) {
      if (mounted.current) {
        setError(describeParticipationActionError(err, 'evaluation'));
        try { setPending(Boolean(await coordinator.pending(userId, 'evaluation'))); }
        catch (storageError) { setError(describeParticipationActionError(storageError, 'evaluation')); }
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [coordinator, navigation, participationId, refreshParticipation, userId, valid]);

  if (!valid || !userId) {
    return (
      <AuthBackground variant="login" overlayOpacity={0.68} testID="evaluation-unavailable-background">
        <StatusBar style="light" />
        <View style={styles.unavailable}>
          <Card variant="elevated">
            <Badge label="AVALIAÇÃO INDISPONÍVEL" variant="warning" />
            <Text style={styles.message} accessibilityRole="alert">
              A avaliação não está disponível para esta participação. Atualize o histórico.
            </Text>
          </Card>
        </View>
      </AuthBackground>
    );
  }

  return <EvaluationScreen navigation={navigation} real onSubmit={submit} onRetry={() => submit(null)}
    onLater={() => navigation.goBack()} submitting={busy} error={error} pendingIntent={pending} />;
}

const styles = StyleSheet.create({
  unavailable: { flex: 1, padding: spacing.layout.screenPaddingHorizontal, justifyContent: 'center' },
  message: { ...typography.body, color: colors.text.primary, marginTop: spacing.md },
});
