import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const readSeqRef = useRef(0);
  const activeReadSeqRef = useRef(0);
  const activeReadFocusGenRef = useRef(0);
  const initialReadDoneRef = useRef(false);
  const lastSessionKeyRef = useRef(null);
  const resumingFromBackgroundRef = useRef(false);
  const [state, setState] = useState(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // Erros de ações não são apagados por leituras.
  const [notice, setNotice] = useState(null);
  const [syncStale, setSyncStale] = useState(false);
  const [finished, setFinished] = useState(false);
  const [readError, setReadError] = useState(null);
  const busyRef = useRef(false);
  const alertManagerRef = useRef(null);
  const mountedRef = useRef(false);
  const operationRef = useRef(null);
  const appStateRef = useRef(AppState?.currentState || 'active');

  const sessionKey = `${userId ?? ''}:${epoch ?? ''}:${participationId}`;
  if (lastSessionKeyRef.current !== sessionKey) {
    lastSessionKeyRef.current = sessionKey;
    initialReadDoneRef.current = false;
    activeReadSeqRef.current = 0;
    activeReadFocusGenRef.current = 0;
    readSeqRef.current += 1;
  }

  useEffect(() => {
    mountedRef.current = true;
    busyRef.current = false;
    operationRef.current = null;
    setBusy(false);
    return () => {
      mountedRef.current = false;
      operationRef.current = null;
      busyRef.current = false;
      readSeqRef.current += 1;
    };
  }, [sessionKey]);

  const sameSession = () => mountedRef.current && lastSessionKeyRef.current === sessionKey
    && authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
    && typeof getEpoch === 'function' && getEpoch() === epoch;

  const releaseOperation = (operation) => {
    if (operationRef.current !== operation) return false;
    operationRef.current = null;
    busyRef.current = false;
    if (!sameSession()) return false;
    setBusy(false); // Blur invalida resultados, mas não a limpeza da mesma operação montada.
    return true;
  };
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
    isCurrent: () => mountedRef.current && focused.current && lastSessionKeyRef.current === sessionKey
      && authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
      && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [client, getEpoch, epoch, userId, sessionKey]);
  const completion = useMemo(() => createParticipationActionCoordinator({
    client,
    isCurrent: () => authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
      && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [client, getEpoch, epoch, userId]);

  const refresh = useCallback(async () => {
    if (
      !focused.current ||
      appStateRef.current !== 'active' ||
      busyRef.current ||
      finishedRef.current ||
      (activeReadSeqRef.current !== 0 && activeReadFocusGenRef.current === focusGeneration.current)
    ) {
      return;
    }
    const currentSeq = ++readSeqRef.current;
    const currentFocusGen = focusGeneration.current;
    activeReadSeqRef.current = currentSeq;
    activeReadFocusGenRef.current = currentFocusGen;
    setLoading(true);
    setReadError(null);
    try {
      const next = await coordinator.read(context);
      if (
        focused.current &&
        !busyRef.current &&
        !finishedRef.current &&
        focusGeneration.current === currentFocusGen &&
        currentSeq === readSeqRef.current &&
        authRef.current?.isAuthenticated === true &&
        authRef.current?.user?.id === userId &&
        (typeof getEpoch !== 'function' || getEpoch() === epoch)
      ) {
        stateRef.current = next;
        setState(next);
        setReadError(null);
        setNotice(null);
        setSyncStale(false);
        const isInitial = !initialReadDoneRef.current;
        initialReadDoneRef.current = true;
        const isResuming = resumingFromBackgroundRef.current;
        resumingFromBackgroundRef.current = false;
        alertManagerRef.current?.checkAndAlert({
          queueEntry: next.currentQueueEntry,
          participationId,
          isInitial,
          isResuming,
        });
      }
    } catch (err) {
      if (
        focused.current &&
        !busyRef.current &&
        !finishedRef.current &&
        focusGeneration.current === currentFocusGen &&
        currentSeq === readSeqRef.current
      ) {
        if (stateRef.current) {
          setSyncStale(true);
        } else {
          setReadError(describeArenaError(err));
        }
      }
    } finally {
      if (activeReadSeqRef.current === currentSeq) {
        activeReadSeqRef.current = 0;
        activeReadFocusGenRef.current = 0;
      }
      if (
        focused.current &&
        focusGeneration.current === currentFocusGen &&
        currentSeq === readSeqRef.current
      ) {
        setLoading(false);
      }
    }
  }, [coordinator, context, participationId, userId, epoch, getEpoch]);

  const syncSilent = useCallback(async () => {
    if (
      !focused.current ||
      appStateRef.current !== 'active' ||
      busyRef.current ||
      finishedRef.current ||
      (activeReadSeqRef.current !== 0 && activeReadFocusGenRef.current === focusGeneration.current)
    ) {
      return;
    }
    const currentSeq = ++readSeqRef.current;
    const currentFocusGen = focusGeneration.current;
    activeReadSeqRef.current = currentSeq;
    activeReadFocusGenRef.current = currentFocusGen;
    try {
      const next = await coordinator.read(context);
      if (
        focused.current &&
        !busyRef.current &&
        !finishedRef.current &&
        focusGeneration.current === currentFocusGen &&
        currentSeq === readSeqRef.current &&
        authRef.current?.isAuthenticated === true &&
        authRef.current?.user?.id === userId &&
        (typeof getEpoch !== 'function' || getEpoch() === epoch)
      ) {
        stateRef.current = next;
        setState(next);
        setReadError(null);
        setLoading(false);
        setSyncStale(false);
        const isInitial = !initialReadDoneRef.current;
        initialReadDoneRef.current = true;
        const isResuming = resumingFromBackgroundRef.current;
        resumingFromBackgroundRef.current = false;
        alertManagerRef.current?.checkAndAlert({
          queueEntry: next.currentQueueEntry,
          participationId,
          isInitial,
          isResuming,
        });
      }
    } catch {
      // Preserva o último estado válido se a conexão falhar e exibe aviso discreto
      if (
        focused.current &&
        !busyRef.current &&
        !finishedRef.current &&
        focusGeneration.current === currentFocusGen &&
        currentSeq === readSeqRef.current
      ) {
        setSyncStale(true);
      }
    } finally {
      if (activeReadSeqRef.current === currentSeq) {
        activeReadSeqRef.current = 0;
        activeReadFocusGenRef.current = 0;
      }
    }
  }, [coordinator, context, participationId, userId, epoch, getEpoch]);

  // Continua observando suspensão mesmo quando outra aba está focada.
  useEffect(() => {
    const subscription = AppState?.addEventListener?.('change', (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState !== 'active') {
        resumingFromBackgroundRef.current = true;
        readSeqRef.current += 1; // Uma leitura anterior não pode consumir a referência de retomada.
        activeReadSeqRef.current = 0;
        activeReadFocusGenRef.current = 0;
        if (mountedRef.current) setLoading(false);
      } else if (previous !== 'active') {
        resumingFromBackgroundRef.current = true;
        if (focused.current) void syncSilent();
      }
    });
    return () => subscription?.remove?.();
  }, [syncSilent]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    focusGeneration.current += 1;
    void refresh();

    const isCurrentReadInFlight = () =>
      activeReadSeqRef.current !== 0 && activeReadFocusGenRef.current === focusGeneration.current;

    const timer = typeof setInterval === 'function' ? setInterval(() => {
      if (focused.current && appStateRef.current === 'active' && !busyRef.current && !isCurrentReadInFlight()) {
        void syncSilent();
      }
    }, 5000) : null;
    timer?.unref?.();

    return () => {
      focused.current = false;
      focusGeneration.current += 1;
      activeReadSeqRef.current = 0;
      activeReadFocusGenRef.current = 0;
      if (timer && typeof clearInterval === 'function') clearInterval(timer);
    };
  }, [refresh, syncSilent]));

  const join = async (experienceId) => {
    if (busyRef.current || !focused.current || !sameSession() || loading || !state) return;
    // Invalida leituras automáticas (polling) anteriores que ainda estejam pendentes
    readSeqRef.current += 1;
    activeReadSeqRef.current = 0;
    activeReadFocusGenRef.current = 0;
    busyRef.current = true;
    const operation = {};
    operationRef.current = operation;
    setBusy(true);
    setError(null);
    setNotice(null);
    const joinFocusGen = focusGeneration.current;
    try {
      const result = await coordinator.join(context, experienceId);
      if (
        !focused.current ||
        operationRef.current !== operation || !sameSession() ||
        focusGeneration.current !== joinFocusGen ||
        finishedRef.current
      ) {
        return;
      }
      if (result.state) {
        readSeqRef.current += 1;
        stateRef.current = result.state;
        setState(result.state);
        setSyncStale(false);
        const isInitial = !initialReadDoneRef.current;
        initialReadDoneRef.current = true;
        alertManagerRef.current?.checkAndAlert({
          queueEntry: result.state.currentQueueEntry,
          participationId,
          isInitial,
          // O resultado pode vir de uma escrita iniciada antes da suspensão.
          isResuming: resumingFromBackgroundRef.current,
        });
      }
      if (result.kind === 'confirmed') setNotice('Entrada na fila confirmada pelo servidor.');
      else if (result.kind === 'already') setNotice('Você já possui uma entrada na fila.');
      else if (result.kind === 'pending_other') setError('Há outra tentativa de fila pendente nesta conta. Nenhuma nova entrada foi enviada.');
      else if (result.kind === 'closed') setError('Esta experiência não está mais aceitando entradas.');
      else setError(result.message || 'Entrada não confirmada. Atualize e repita somente com a mesma chave.');
    } catch (err) {
      if (sameSession() && operationRef.current === operation && focused.current
        && focusGeneration.current === joinFocusGen) setError(describeArenaError(err));
    } finally {
      if (releaseOperation(operation) && focused.current && focusGeneration.current !== joinFocusGen) {
        void refresh();
      }
    }
  };

  const finish = () => {
    if (busyRef.current || finishedRef.current || loading || state?.pendingIntent) return;
    Alert.alert('Deseja sair da Arena?', 'Sua participação será encerrada e não poderá ser retomada.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair da Arena', style: 'destructive', onPress: async () => {
        if (busyRef.current || finishedRef.current || !focused.current || !sameSession()) return;
        readSeqRef.current += 1;
        activeReadSeqRef.current = 0;
        activeReadFocusGenRef.current = 0;
        busyRef.current = true;
        const operation = {};
        operationRef.current = operation;
        setBusy(true);
        setError(null);
        const generation = focusGeneration.current;
        const sameIdentity = () => lastSessionKeyRef.current === sessionKey
          && authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
          && typeof getEpoch === 'function' && getEpoch() === epoch;
        const isCurrent = () => sameSession() && operationRef.current === operation
          && focused.current && focusGeneration.current === generation;
        let confirmed = false;
        try {
          await completion.finish(userId, participationId);
          confirmed = true;
          if (sameSession() && operationRef.current === operation) {
            finishedRef.current = true;
            setFinished(true);
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
          if (confirmed && sameIdentity()) {
            try { await refreshParticipation(); } catch { /* A atualização pode ser repetida sem reenviar a saída. */ }
          }
          if (releaseOperation(operation) && !confirmed && focused.current
            && focusGeneration.current !== generation) void refresh();
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
        {error || readError ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Badge label="ERRO" variant="danger" />
            <Text style={styles.error}>{error || readError}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={styles.noticeCard}>
            <Badge label="ATUALIZADO" variant="success" />
            <Text style={styles.notice}>{notice}</Text>
          </View>
        ) : null}
        {syncStale ? (
          <View style={styles.syncWarningCard} accessibilityRole="alert">
            <Badge label="INSTÁVEL" variant="warning" size="sm" />
            <Text style={styles.syncWarningText}>
              Conexão instável. Exibindo as últimas informações confirmadas.
            </Text>
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
            <Text style={styles.note}>
              {syncStale
                ? 'A conexão com o servidor oscilou. Tentando reconectar automaticamente...'
                : 'A posição e a chamada são atualizadas automaticamente a cada 5 segundos.'}
            </Text>
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
          disabled={busy || loading}
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
  syncWarningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: '#F59E0B',
    borderWidth: 1,
    backgroundColor: '#2D2013',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  syncWarningText: {
    ...typography.bodySmall,
    color: '#FCD34D',
    flex: 1,
  },
});
