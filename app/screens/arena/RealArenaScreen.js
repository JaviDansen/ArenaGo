import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, LineIcon, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { createArenaQueueCoordinator, describeArenaError } from '../../services/arenaQueueService';
import { defaultArenaQueueIntentStorage } from '../../services/arenaQueueIntentStorage';
import { createParticipationActionCoordinator, describeParticipationActionError } from '../../services/participationActionService';
import { fetchPendingEvaluationHistoryItem } from '../../services/participationHistoryService';
import { createQueueAlertManager } from '../../services/queueAlertService';
import { colors, radii, spacing, typography } from '../../theme';
import { formatExperienceCount, formatQueuePosition, formatWaitingCount } from '../../utils/arenaQueuePresentation';

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
  // PARTICIPANTE-02A: derivações somente de apresentação; os dados continuam vindo do servidor.
  const waiting = entry?.status === 'waiting';
  const positionText = waiting ? formatQueuePosition(entry.position) : null;
  const positionLabel = syncStale ? 'Última posição confirmada' : 'Posição';
  const experienceCount = state ? formatExperienceCount(state.experiences.length) : null;

  return (
    <AuthBackground variant="login" overlayOpacity={0.7} testID="active-arena-background">
      <StatusBar style="light" />
      <ScreenHeader
        title="Minha Arena"
        subtitle="Participação ativa · dados do servidor"
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
          <View style={styles.noticeRow} accessibilityLiveRegion="polite" testID="arena-queue-notice">
            <View style={styles.noticeIcon}>
              <LineIcon name="check" color={colors.semantic.success} size={14} />
            </View>
            <Text style={styles.noticeText}>{notice}</Text>
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
          <Card variant="highlight" style={styles.queueCard} testID="arena-queue-entry-card">
            <View style={styles.cardTopRow}>
              <Badge label={waiting ? 'NA FILA' : 'SUA VEZ'} variant={waiting ? 'brand' : 'success'} />
              <LineIcon
                name={waiting ? 'queue' : 'door'}
                color={waiting ? colors.brand.primaryLight : colors.semantic.success}
                size={22}
              />
            </View>
            <Text style={styles.queueTitle} accessibilityRole="header">
              {waiting ? 'Você está na fila' : 'É a sua vez!'}
            </Text>
            <View style={styles.queueExperienceRow}>
              <LineIcon name="gamepad" color={colors.text.secondary} size={18} />
              <Text style={styles.queueExperience} numberOfLines={2}>{entry.experienceName}</Text>
            </View>
            {waiting ? (
              <View
                style={[styles.positionPanel, syncStale && styles.positionPanelStale]}
                accessible
                accessibilityLabel={`${positionLabel} na fila: ${positionText}`}
                testID="arena-queue-position"
              >
                <Text style={styles.positionLine}>
                  <Text style={styles.positionLabel}>{`${positionLabel} `}</Text>
                  <Text style={[styles.positionNumber, syncStale && styles.positionNumberStale]}>{positionText}</Text>
                </Text>
              </View>
            ) : (
              <View style={styles.stationPanel} testID="arena-queue-station">
                <Text style={styles.stationText}>Dirija-se à estação: {entry.stationLabel}</Text>
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.autoUpdateRow}>
              <LineIcon
                name={syncStale ? 'alert' : 'refresh'}
                color={syncStale ? colors.semantic.warning : colors.text.muted}
                size={14}
              />
              <Text style={[styles.autoUpdateText, syncStale && styles.autoUpdateTextStale]}>
                {syncStale
                  ? 'A conexão com o servidor oscilou. Exibindo as últimas informações confirmadas; reconectando automaticamente...'
                  : 'A posição e a chamada são atualizadas automaticamente a cada 5 segundos.'}
              </Text>
            </View>
          </Card>
        ) : null}

        {!entry && pending ? (
          <Card variant="elevated" style={styles.queueCard}>
            <View style={styles.cardTopRow}>
              <Badge label="TENTATIVA PENDENTE" variant="warning" />
              <LineIcon name="alert" color={colors.semantic.warning} size={20} />
            </View>
            <Text style={styles.queueTitle}>Tentativa anterior não confirmada</Text>
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Experiências disponíveis</Text>
          {experienceCount ? <Text style={styles.sectionMeta}>{experienceCount}</Text> : null}
        </View>
        {state?.experiences.length === 0 ? (
          <Card variant="default" style={styles.card}>
            <Text style={styles.line}>Nenhuma experiência cadastrada.</Text>
          </Card>
        ) : null}
        {state?.experiences.map((experience) => {
          const permitted = state.acceptingNewQueueEntries && experience.acceptingNewQueueEntries;
          const mine = entry?.experienceId === experience.id;
          return (
            <Card
              key={experience.id}
              variant="default"
              style={[styles.card, mine && styles.cardMine]}
              testID={`arena-experience-${experience.id}`}
            >
              <View style={styles.experienceHeader}>
                <View style={[styles.experienceIcon, !permitted && styles.experienceIconClosed]}>
                  <LineIcon name="gamepad" color={permitted ? colors.brand.primaryLight : colors.text.muted} size={22} />
                </View>
                <View style={styles.experienceInfo}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{experience.name}</Text>
                  <View style={styles.waitingRow}>
                    <LineIcon name="queue" color={colors.text.secondary} size={14} />
                    <Text style={styles.waitingText}>{formatWaitingCount(experience.waitingCount)}</Text>
                  </View>
                </View>
                <Badge label={permitted ? 'ABERTA' : 'ENCERRADA'} variant={permitted ? 'success' : 'default'} size="sm" />
              </View>
              <View style={styles.divider} />
              <View style={styles.experienceFooter}>
                <View style={[styles.statusDot, permitted ? styles.statusDotOpen : styles.statusDotClosed]} />
                <Text style={styles.experienceStatus}>{permitted ? 'Recebendo entradas' : 'Entrada na fila encerrada'}</Text>
                {mine ? <Badge label="SUA FILA" variant="brand" size="sm" /> : null}
              </View>
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

        <View style={styles.actionsSection}>
          <Button
            title={loading ? 'Consultando...' : 'Atualizar fila e experiências'}
            variant="secondary"
            size="md"
            disabled={busy || loading}
            onPress={refresh}
            style={styles.actionButton}
          />
          <Button
            title="Atualizar situação da participação"
            variant="outline"
            size="md"
            onPress={refreshParticipation}
            style={styles.actionButton}
          />
          <View style={styles.actionsDivider} />
          <Button
            title={busy ? 'Aguarde...' : 'Sair da Arena'}
            variant="dangerOutline"
            size="md"
            disabled={busy || loading || finished || Boolean(pending)}
            onPress={finish}
            style={styles.actionButton}
          />
          <View style={styles.staffNoteRow}>
            <LineIcon name="alert" color={colors.text.muted} size={14} />
            <Text style={styles.staffNote}>
              Chamada e conclusão são realizadas pelo Staff. Este aplicativo não simula atendimento
              nem permite cancelar somente a fila.
            </Text>
          </View>
        </View>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.md, paddingBottom: 40 },
  stateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  line: { ...typography.body, color: colors.text.secondary, marginTop: spacing.sm },
  actionButton: { marginTop: spacing.md },
  divider: { height: 1, alignSelf: 'stretch', backgroundColor: colors.border.subtle, marginTop: spacing.md },

  // Avisos
  errorCard: { borderColor: colors.semantic.danger, borderWidth: 1, backgroundColor: colors.semantic.dangerBg, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  error: { ...typography.body, color: '#FF9AAE', marginTop: spacing.sm },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: colors.semantic.success,
    borderWidth: 1,
    backgroundColor: colors.semantic.successBg,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  noticeIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.semantic.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeText: { ...typography.bodySmall, color: colors.text.primary, flex: 1, lineHeight: 20 },
  syncWarningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: colors.semantic.warning,
    borderWidth: 1,
    backgroundColor: colors.semantic.warningBg,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  syncWarningText: { ...typography.bodySmall, color: colors.semantic.warning, flex: 1 },

  // Card principal da fila
  queueCard: { marginBottom: spacing.lg, alignItems: 'stretch' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  queueTitle: { ...typography.titleMedium, color: colors.text.primary, marginTop: spacing.md },
  queueExperienceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  queueExperience: { ...typography.bodyLarge, color: colors.text.primary, flex: 1 },
  positionPanel: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primaryDim,
  },
  positionPanelStale: { borderColor: colors.semantic.warning, backgroundColor: colors.semantic.warningBg },
  positionLine: { color: colors.text.primary },
  positionLabel: { ...typography.bodyLarge, color: colors.text.secondary },
  positionNumber: { fontFamily: typography.fontFamily, fontSize: 44, lineHeight: 52, fontWeight: '800', letterSpacing: -0.5, color: colors.text.primary },
  positionNumberStale: { color: colors.text.secondary },
  stationPanel: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.semantic.success,
    backgroundColor: colors.semantic.successBg,
  },
  stationText: { ...typography.titleSmall, color: colors.text.primary },
  autoUpdateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  autoUpdateText: { ...typography.bodySmall, color: colors.text.muted, flex: 1, lineHeight: 20 },
  autoUpdateTextStale: { color: colors.semantic.warning },

  // Experiências
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...typography.titleSmall, color: colors.text.primary, flexShrink: 1 },
  sectionMeta: { ...typography.bodySmall, color: colors.text.muted },
  card: { marginBottom: spacing.md, alignItems: 'stretch' },
  cardMine: { borderColor: colors.brand.primary },
  experienceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  experienceIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.primaryDim,
  },
  experienceIconClosed: { backgroundColor: colors.background.elevated },
  experienceInfo: { flex: 1, minWidth: 0 },
  cardTitle: { ...typography.titleSmall, color: colors.text.primary },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  waitingText: { ...typography.bodySmall, color: colors.text.secondary },
  experienceFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOpen: { backgroundColor: colors.semantic.success },
  statusDotClosed: { backgroundColor: colors.text.disabled },
  experienceStatus: { ...typography.bodySmall, color: colors.text.secondary, flex: 1 },

  // Ações
  actionsSection: { marginTop: spacing.sm },
  actionsDivider: { height: 1, backgroundColor: colors.border.subtle, marginTop: spacing.lg },
  staffNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  staffNote: { ...typography.bodySmall, color: colors.text.muted, flex: 1, lineHeight: 20 },
});
