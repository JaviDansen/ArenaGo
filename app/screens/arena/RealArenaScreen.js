import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { createArenaQueueCoordinator, describeArenaError } from '../../services/arenaQueueService';
import { defaultArenaQueueIntentStorage } from '../../services/arenaQueueIntentStorage';
import { createParticipationActionCoordinator, describeParticipationActionError } from '../../services/participationActionService';
import { fetchPendingEvaluationHistoryItem } from '../../services/participationHistoryService';
import { createQueueAlertManager } from '../../services/queueAlertService';
import { colors, spacing, typography } from '../../theme';

/** Tela real de participação ativa. Sem alterações de domínio feitas em estado React. */
export default function RealArenaScreen({ participation, refreshParticipation, onOpenEvaluation }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const userId = auth?.user?.id;
  const participationId = participation.id;
  const eventId = participation.eventId;
  const client = auth?.httpClient;
  const getEpoch = auth?.getSessionEpoch;
  const epoch = typeof getEpoch === 'function' ? getEpoch() : null;
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  const finishedRef = useRef(false);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [finished, setFinished] = useState(false);
  const busyRef = useRef(false);
  const alertManagerRef = useRef(null);
  if (!alertManagerRef.current) {
    alertManagerRef.current = createQueueAlertManager({
      getIdentity: () => {
        const a = authRef.current;
        return a?.isAuthenticated && a.user?.id
          ? { userId: a.user.id, epoch: typeof a.getSessionEpoch === 'function' ? a.getSessionEpoch() : null }
          : null;
      },
      isAppActive: () => (typeof AppState !== 'undefined' && AppState.currentState ? AppState.currentState === 'active' : true),
      vibrate: () => {
        try {
          Vibration?.vibrate?.(500);
        } catch {
          // Falha silenciosa caso vibração não seja suportada
        }
      },
    });
  }

  const context = useMemo(() => ({ userId, participationId, eventId }), [userId, participationId, eventId]);
  const coordinator = useMemo(() => createArenaQueueCoordinator({
    client,
    storage: defaultArenaQueueIntentStorage,
    createKey: () => Crypto.randomUUID(),
    isCurrent: () => focused.current && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [client, getEpoch, epoch]);
  const completion = useMemo(() => createParticipationActionCoordinator({
    client,
    isCurrent: () => authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
      && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [client, getEpoch, epoch, userId]);

  const refresh = useCallback(async () => {
    if (!focused.current || busyRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const next = await coordinator.read(context);
      if (focused.current) {
        setState(next);
        setNotice(null);
        alertManagerRef.current?.checkAndAlert({
          queueEntry: next.currentQueueEntry,
          participationId,
          isInitial: true,
        });
      }
    } catch (err) {
      if (focused.current) setError(describeArenaError(err));
    } finally {
      if (focused.current) setLoading(false);
    }
  }, [coordinator, context, participationId]);

  const syncSilent = useCallback(async () => {
    if (!focused.current || busyRef.current || finishedRef.current) return;
    try {
      const next = await coordinator.read(context);
      if (focused.current && !finishedRef.current) {
        setState(next);
        alertManagerRef.current?.checkAndAlert({
          queueEntry: next.currentQueueEntry,
          participationId,
          isInitial: false,
        });
      }
    } catch {
      // Preserva o último estado válido se a conexão falhar
    }
  }, [coordinator, context, participationId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    focusGeneration.current += 1;
    void refresh();

    const appState = { current: typeof AppState !== 'undefined' && AppState.currentState ? AppState.currentState : 'active' };
    let appStateSub = null;
    if (typeof AppState?.addEventListener === 'function') {
      appStateSub = AppState.addEventListener('change', (nextState) => {
        appState.current = nextState;
        if (nextState === 'active' && focused.current && !busyRef.current) {
          void syncSilent();
        }
      });
    }

    const timer = typeof setInterval === 'function' ? setInterval(() => {
      if (focused.current && appState.current === 'active' && !busyRef.current) {
        void syncSilent();
      }
    }, 5000) : null;
    timer?.unref?.();

    return () => {
      focused.current = false;
      focusGeneration.current += 1;
      if (timer && typeof clearInterval === 'function') clearInterval(timer);
      appStateSub?.remove?.();
    };
  }, [refresh, syncSilent]));

  const join = async (experienceId) => {
    if (busyRef.current || !focused.current || loading || !state) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await coordinator.join(context, experienceId);
      if (!focused.current) return;
      if (result.state) setState(result.state);
      if (result.kind === 'confirmed') setNotice('Entrada na fila confirmada pelo servidor.');
      else if (result.kind === 'already') setNotice('Você já possui uma entrada na fila.');
      else if (result.kind === 'pending_other') setError('Há outra tentativa de fila pendente nesta conta. Nenhuma nova entrada foi enviada.');
      else if (result.kind === 'closed') setError('Esta experiência não está mais aceitando entradas.');
      else setError(result.message || 'Entrada não confirmada. Atualize e repita somente com a mesma chave.');
    } catch (err) {
      if (focused.current) setError(describeArenaError(err));
    } finally {
      busyRef.current = false;
      if (focused.current) setBusy(false);
    }
  };

  const finish = () => {
    if (busyRef.current || finishedRef.current || loading || state?.pendingIntent) return;
    Alert.alert('Deseja sair da Arena?', 'Sua participação será encerrada e não poderá ser retomada.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair da Arena', style: 'destructive', onPress: async () => {
        if (busyRef.current || finishedRef.current || !focused.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        const generation = focusGeneration.current;
        const sameSession = () => authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
          && typeof getEpoch === 'function' && getEpoch() === epoch;
        const isCurrent = () => focused.current && focusGeneration.current === generation && sameSession();
        let confirmed = false;
        try {
          await completion.finish(userId, participationId);
          confirmed = true;
          if (sameSession()) {
            finishedRef.current = true;
            if (isCurrent()) setFinished(true);
          }
        } catch (err) {
          if (isCurrent()) setError(describeParticipationActionError(err, 'finish'));
        }
        try {
          if (confirmed && isCurrent()) {
            const historyItem = await fetchPendingEvaluationHistoryItem(client, participationId, { isCurrent });
            if (historyItem?.event?.id === eventId && isCurrent()) onOpenEvaluation?.(historyItem);
          }
        } catch {
          // O encerramento já foi confirmado; o histórico pode ser consultado depois.
        } finally {
          if (confirmed && sameSession()) {
            try { await refreshParticipation(); } catch { /* A atualização pode ser repetida sem reenviar a saída. */ }
          }
          busyRef.current = false;
          if (focused.current && sameSession()) setBusy(false);
        }
      } },
    ]);
  };

  const entry = state?.currentQueueEntry;
  const pending = state?.pendingIntent;
  const pendingHere = pending?.participationId === participationId;
  const hasOtherPending = Boolean(pending && !pendingHere);
  const lockActions = busy || loading || Boolean(entry) || Boolean(pending);

  return (
    <AuthBackground variant="login" overlayOpacity={0.7} testID="active-arena-background">
      <StatusBar style="light" />
      <ScreenHeader
        title="Minha Arena"
        subtitle="Participação ativa · informações do servidor"
        showBack={false}
        rightAction={<Badge label="ATIVA" variant="success" />}
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {loading && !state ? (
          <Card variant="elevated" style={styles.stateCard}>
            <ActivityIndicator accessibilityLabel="Consultando a Arena" color={colors.brand.primaryLight} />
            <Text style={styles.line}>Consultando a Arena...</Text>
          </Card>
        ) : null}
        {error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Badge label="ERRO" variant="danger" />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={styles.noticeCard}>
            <Badge label="ATUALIZADO" variant="success" />
            <Text style={styles.notice}>{notice}</Text>
          </View>
        ) : null}

        {entry ? (
          <Card variant="highlight" style={styles.highlight}>
            <Badge label={entry.status === 'waiting' ? 'NA FILA' : 'SUA VEZ'} variant="brand" />
            <Text style={styles.sectionTitle}>{entry.status === 'waiting' ? 'Você está na fila' : 'É a sua vez!'}</Text>
            <Text style={styles.line}>{entry.experienceName}</Text>
            {entry.status === 'waiting'
              ? <Text style={styles.position}>Posição {entry.position}º</Text>
              : <Text style={styles.position}>Dirija-se à estação: {entry.stationLabel}</Text>}
            <Text style={styles.note}>A posição e a chamada são atualizadas automaticamente a cada 5 segundos.</Text>
          </Card>
        ) : null}

        {!entry && pending ? (
          <Card variant="elevated" style={styles.highlight}>
            <Badge label="TENTATIVA PENDENTE" variant="warning" />
            <Text style={styles.sectionTitle}>Tentativa anterior não confirmada</Text>
            <Text style={styles.line}>
              {hasOtherPending
                ? 'Há uma solicitação pendente de outra participação nesta conta. Não será criada uma nova entrada.'
                : 'Atualize a fila antes de tentar novamente. A mesma chave de operação será reutilizada.'}
            </Text>
            {pendingHere ? (
              <Button
                title="Conferir / repetir a mesma tentativa"
                variant="outline"
                disabled={busy || loading}
                onPress={() => join(pending.experienceId)}
                style={styles.actionButton}
              />
            ) : null}
          </Card>
        ) : null}

        <Text style={styles.sectionTitle}>Experiências disponíveis</Text>
        {state?.experiences.length === 0 ? (
          <Card variant="default" style={styles.card}>
            <Text style={styles.line}>Nenhuma experiência cadastrada.</Text>
          </Card>
        ) : null}
        {state?.experiences.map((experience) => {
          const permitted = state.acceptingNewQueueEntries && experience.acceptingNewQueueEntries;
          return (
            <Card key={experience.id} variant="default" style={styles.card}>
              <View style={styles.experienceHeader}>
                <Text style={styles.cardTitle}>{experience.name}</Text>
                <Badge label={permitted ? 'ABERTA' : 'ENCERRADA'} variant={permitted ? 'success' : 'default'} size="sm" />
              </View>
              <Text style={styles.line}>{experience.waitingCount} pessoa(s) aguardando</Text>
              <Text style={styles.note}>{permitted ? 'Recebendo entradas' : 'Entrada na fila encerrada'}</Text>
              {!entry && !pending && permitted ? (
                <Button
                  title={busy ? 'Verificando...' : 'Entrar na fila'}
                  variant="primary"
                  disabled={lockActions}
                  onPress={() => join(experience.id)}
                  style={styles.actionButton}
                />
              ) : null}
            </Card>
          );
        })}
        <Button
          title={loading ? 'Consultando...' : 'Atualizar fila e experiências'}
          variant="secondary"
          disabled={busy}
          onPress={refresh}
          style={styles.actionButton}
        />
        <Button
          title="Atualizar situação da participação"
          variant="outline"
          onPress={refreshParticipation}
          style={styles.actionButton}
        />
        <Button
          title={busy ? 'Aguarde...' : 'Sair da Arena'}
          variant="dangerOutline"
          disabled={busy || loading || finished || Boolean(pending)}
          onPress={finish}
          style={styles.actionButton}
        />
        <Text style={styles.note}>
          Chamada e conclusão são realizadas pelo Staff. Este aplicativo não simula atendimento
          nem permite cancelar somente a fila.
        </Text>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.md, paddingBottom: 40 },
  stateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  sectionTitle: { ...typography.titleSmall, color: colors.text.primary, marginTop: spacing.lg },
  highlight: { marginBottom: spacing.lg, alignItems: 'flex-start' },
  card: { marginBottom: spacing.md, alignItems: 'stretch' },
  experienceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...typography.titleSmall, color: colors.text.primary, flex: 1 },
  line: { ...typography.body, color: colors.text.secondary, marginTop: spacing.sm },
  position: { ...typography.titleMedium, color: colors.brand.primaryLight, marginTop: spacing.md },
  note: { ...typography.bodySmall, color: colors.text.muted, marginTop: spacing.md, lineHeight: 20 },
  actionButton: { marginTop: spacing.md },
  errorCard: { borderColor: colors.semantic.danger, borderWidth: 1, backgroundColor: colors.semantic.dangerBg, borderRadius: 12, padding: spacing.lg, marginBottom: spacing.md },
  error: { ...typography.body, color: '#FF9AAE', marginTop: spacing.sm },
  noticeCard: { borderColor: colors.semantic.success, borderWidth: 1, backgroundColor: colors.semantic.successBg, borderRadius: 12, padding: spacing.lg, marginBottom: spacing.md },
  notice: { ...typography.body, color: colors.text.primary, marginTop: spacing.sm },
});
