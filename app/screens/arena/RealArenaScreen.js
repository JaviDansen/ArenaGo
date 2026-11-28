import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { ActivityIndicator, Alert, AppState, Image, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, LineIcon } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { createArenaQueueCoordinator, describeArenaError } from '../../services/arenaQueueService';
import { defaultArenaQueueIntentStorage } from '../../services/arenaQueueIntentStorage';
import { createParticipationActionCoordinator, describeParticipationActionError } from '../../services/participationActionService';
import { fetchCurrentArenaEventName, fetchPendingEvaluationHistoryItem } from '../../services/participationHistoryService';
import { createQueueAlertManager } from '../../services/queueAlertService';
import { colors, radii, spacing, typography } from '../../theme';
import { formatExperienceCount, formatQueuePosition, formatWaitingCount } from '../../utils/arenaQueuePresentation';

// Variações locais violeta da R01; não alteram o tema dos demais módulos.
const arenaPalette = { surface: '#191326', secondary: '#181626', selected: '#241632',
  position: '#503078', border: '#A855F7', accent: '#B56CFF', support: '#C4BBD2' };

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
  const [eventNameState, setEventNameState] = useState(null);
  const [eventNameAttempt, setEventNameAttempt] = useState(0);
  const eventNameKey = `${userId ?? ''}:${epoch ?? ''}:${participationId}:${eventId}`;
  const eventNameKeyRef = useRef(eventNameKey);
  eventNameKeyRef.current = eventNameKey;
  const busyRef = useRef(false);
  const alertManagerRef = useRef(null);
  const mountedRef = useRef(false);
  const operationRef = useRef(null);
  const appStateRef = useRef(AppState?.currentState || 'active');

  const sessionKey = `${userId ?? ''}:${epoch ?? ''}:${participationId}`;
  useEffect(() => {
    let current = true;
    const isCurrent = () => current && eventNameKeyRef.current === eventNameKey
      && authRef.current?.isAuthenticated === true && authRef.current?.user?.id === userId
      && typeof getEpoch === 'function' && getEpoch() === epoch;
    setEventNameState({ key: eventNameKey, loading: true, name: null, error: false });
    (async () => {
      try {
        const name = await fetchCurrentArenaEventName(client, participationId, eventId, { isCurrent });
        if (isCurrent()) setEventNameState({ key: eventNameKey, loading: false, name, error: !name });
      } catch {
        if (isCurrent()) setEventNameState({ key: eventNameKey, loading: false, name: null, error: true });
      }
    })();
    return () => { current = false; };
  }, [client, userId, getEpoch, epoch, participationId, eventId, eventNameKey, eventNameAttempt]);
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
  const called = entry?.status === 'called';
  const positionText = waiting ? formatQueuePosition(entry.position) : null;
  const positionLabel = syncStale ? 'Última posição confirmada' : 'Posição';
  const experienceCount = state ? formatExperienceCount(state.experiences.length) : null;
  const currentEventName = eventNameState?.key === eventNameKey ? eventNameState : null;

  return (
    <AuthBackground variant="login" overlayOpacity={0.7} testID="active-arena-background">
      <StatusBar style="light" />
      <View style={styles.header} testID="arena-header">
        <View style={styles.headerRow}>
          <Text style={[styles.heading, styles.headerTitle]} accessibilityRole="header">{currentEventName?.name || (currentEventName?.error ? 'Evento indisponível' : 'Carregando evento...')}</Text>
          <Image source={require('../../assets/images/Logo ArenaGO render (admin-staff).png')}
            resizeMode="contain" style={styles.headerLogo} accessible accessibilityRole="image"
            accessibilityLabel="ArenaGO" testID="arena-header-logo" />
        </View>
        <Text style={styles.headerSubtitle}>Sua participação em tempo real</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
          <Card variant="highlight" style={[styles.queueCard, called && styles.calledCard]} testID="arena-queue-entry-card">
            <View style={styles.cardTopRow}>
              <Badge label={waiting ? 'NA FILA' : 'SUA VEZ'} variant={waiting ? 'brand' : 'success'} />
              {called ? <LineIcon name="bell" color={arenaPalette.accent} size={22} /> : null}
            </View>
            <Text style={styles.queueTitle} accessibilityRole="header">
              {waiting ? 'Você está na fila' : 'É a sua vez!'}
            </Text>
            {called ? <Text style={styles.calledMessage}>O Staff está aguardando você.</Text> : null}
            <View style={styles.queueExperienceRow}>
              <LineIcon name="gamepad" color={arenaPalette.accent} size={22} />
              <Text style={styles.queueExperience}>{entry.experienceName}</Text>
            </View>
            {waiting ? (
              <View
                style={[styles.positionPanel, syncStale && styles.positionPanelStale]}
                accessible
                accessibilityLabel={`${positionLabel} na fila: ${positionText}`}
                testID="arena-queue-position"
              >
                <LineIcon name="queue" color={colors.text.primary} size={22} />
                <View style={styles.positionDivider} />
                <View style={styles.positionLine} testID="arena-position-text">
                  <Text style={styles.positionLabel}>{`${positionLabel} `}</Text>
                  <Text style={[styles.positionNumber, syncStale && styles.positionNumberStale]} testID="arena-position-number">{positionText}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.stationPanel} testID="arena-queue-station" accessible accessibilityLabel={`Dirija-se à estação: ${entry.stationLabel}`}>
                <LineIcon name="location" color={arenaPalette.accent} size={24} />
                <View style={styles.stationDivider} />
                <View style={styles.stationInfo}>
                  <Text style={styles.stationLabel}>Dirija-se à estação</Text>
                  <Text style={styles.stationText}>{entry.stationLabel}</Text>
                </View>
              </View>
            )}
            <View style={styles.autoUpdateRow}>
              <LineIcon
                name={called ? 'door' : syncStale ? 'alert' : 'refresh'}
                color={called ? arenaPalette.support : syncStale ? colors.semantic.warning : arenaPalette.support}
                size={14}
              />
              <Text style={[styles.autoUpdateText, !called && syncStale && styles.autoUpdateTextStale]}>
                {called ? 'Apresente-se ao Staff para iniciar sua experiência.' : syncStale
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
                textStyle={styles.secondaryActionText}
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
              padding={spacing.md}
              style={[styles.card, Boolean(entry) && styles.cardCompact, mine && styles.cardMine]}
              testID={`arena-experience-${experience.id}`}
            >
              <View style={styles.experienceHeader}>
                <View style={[styles.experienceIcon, !permitted && styles.experienceIconClosed]}>
                  <LineIcon name="gamepad" color={permitted ? arenaPalette.accent : colors.text.secondary} size={24} />
                </View>
                <View style={styles.experienceInfo}>
                  <Text style={styles.cardTitle}>{experience.name}</Text>
                  <View style={styles.waitingRow}>
                    <LineIcon name="queue" color={colors.text.secondary} size={14} />
                    <Text style={styles.waitingText}>{formatWaitingCount(experience.waitingCount)}</Text>
                  </View>
                  {mine ? <View style={styles.mineLabel}><Badge label={called ? 'CHAMADO' : 'SUA FILA'} variant="brand" size="sm" /></View> : null}
                </View>
                <Badge label={permitted ? 'ABERTA' : 'ENCERRADA'} variant={permitted ? 'success' : 'default'} size="sm" style={!permitted ? styles.closedBadge : undefined} />
              </View>
              {!entry ? <View style={styles.experienceFooter}>
                {!entry ? <Text style={styles.experienceStatus}>{permitted ? 'Recebendo entradas' : 'Entrada na fila encerrada'}</Text> : null}
              </View> : null}
              {!entry && !pending && permitted ? (
                <Button
                  title={busy ? 'Verificando...' : 'Entrar na fila'}
                  variant="primary"
                  size="sm"
                  disabled={lockActions}
                  onPress={() => join(experience.id)}
                  style={styles.actionButton}
                />
              ) : null}
            </Card>
          );
        })}

        <View style={styles.actionsSection}>
          {error || readError || syncStale || currentEventName?.error ? <Button
            title="Tentar novamente"
            variant="ghost"
            size="sm"
            textStyle={styles.secondaryActionText}
            disabled={busy || loading}
            onPress={() => { void refresh(); setEventNameAttempt(value => value + 1); }}
            style={styles.actionButton}
          /> : null}
          <Button
            title={busy ? 'Aguarde...' : 'Sair da Arena'}
            variant="dangerOutline"
            size="md"
            disabled={busy || loading || finished || Boolean(pending)}
            onPress={finish}
            style={styles.leaveAction}
            textStyle={styles.leaveActionText}
          />
          <View style={styles.staffNoteRow}>
            <LineIcon name="alert" color={colors.text.muted} size={14} />
            <Text style={styles.staffNote}>
              O Staff realiza a chamada e o atendimento. A saída encerra sua participação na Arena.
            </Text>
          </View>
        </View>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingVertical: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerTitle: { flex: 1, minWidth: 0 },
  headerLogo: { width: 96, height: 32, flexShrink: 0 },
  heading: { ...typography.titleLarge, color: colors.text.primary },
  headerSubtitle: { ...typography.bodySmall, color: arenaPalette.support, marginTop: spacing.xxs },
  scroll: { flex: 1, minHeight: 0 },
  body: { paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  stateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.background.base, borderColor: `${colors.brand.primaryLight}40` },
  line: { ...typography.body, color: colors.text.secondary, marginTop: spacing.sm },
  actionButton: { marginTop: spacing.md },
  secondaryActionText: { color: colors.brand.primaryLight },
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
  queueCard: { marginBottom: spacing.sm, alignItems: 'stretch', padding: spacing.lg, backgroundColor: arenaPalette.surface, borderColor: arenaPalette.border },
  calledCard: { borderColor: arenaPalette.border },
  calledMessage: { ...typography.bodySmall, color: arenaPalette.support, marginTop: spacing.xs },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  queueTitle: { ...typography.titleMedium, color: colors.text.primary, marginTop: spacing.sm },
  queueExperienceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  queueExperience: { ...typography.bodyLarge, color: colors.text.primary, flex: 1 },
  positionPanel: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: arenaPalette.accent,
    backgroundColor: arenaPalette.position,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56,
  },
  positionPanelStale: { borderColor: colors.semantic.warning, backgroundColor: colors.semantic.warningBg },
  positionDivider: { width: 1, height: 28, backgroundColor: arenaPalette.accent },
  positionLine: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xs },
  positionLabel: { fontFamily: typography.fontFamily, fontSize: 22, fontWeight: '700', color: colors.text.primary, flexShrink: 1 },
  // Text nativo independente: métricas próprias, sem herdar a linha pequena de um Text pai.
  positionNumber: { fontFamily: typography.fontFamily, fontSize: 34, fontWeight: '800', color: colors.text.primary, flexShrink: 1 },
  positionNumberStale: { color: colors.semantic.warning },
  stationPanel: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: `${arenaPalette.border}80`,
    backgroundColor: arenaPalette.selected,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
  },
  stationDivider: { width: 1, height: 28, backgroundColor: arenaPalette.accent },
  stationInfo: { flex: 1, minWidth: 0 },
  stationLabel: { ...typography.bodySmall, color: colors.text.secondary },
  stationText: { ...typography.titleMedium, color: colors.text.primary, marginTop: spacing.xxs },
  autoUpdateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  autoUpdateText: { ...typography.bodySmall, color: arenaPalette.support, flex: 1 },
  autoUpdateTextStale: { color: colors.semantic.warning },

  // Experiências
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { ...typography.titleSmall, color: colors.text.primary, flexShrink: 1 },
  sectionMeta: { ...typography.bodySmall, color: colors.text.secondary },
  card: { marginBottom: spacing.sm, alignItems: 'stretch', backgroundColor: arenaPalette.secondary, borderColor: `${arenaPalette.border}80` },
  cardCompact: { paddingVertical: spacing.sm },
  cardMine: { borderColor: arenaPalette.border, backgroundColor: arenaPalette.selected },
  mineLabel: { alignSelf: 'flex-start', marginTop: spacing.xs },
  experienceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  experienceIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${arenaPalette.border}20`,
  },
  experienceIconClosed: { backgroundColor: colors.background.base },
  closedBadge: { backgroundColor: colors.background.base },
  experienceInfo: { flex: 1, minWidth: 0 },
  cardTitle: { ...typography.titleSmall, color: colors.text.primary },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  waitingText: { ...typography.bodySmall, color: colors.text.secondary },
  experienceFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOpen: { backgroundColor: colors.semantic.success },
  statusDotClosed: { backgroundColor: colors.text.disabled },
  experienceStatus: { ...typography.bodySmall, color: colors.text.secondary, flex: 1 },

  // Ações
  actionsSection: { marginTop: spacing.sm },
  leaveAction: { marginTop: 0, borderColor: '#A84E66' },
  leaveActionText: { color: '#E58A9D' },
  staffNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  staffNote: { ...typography.bodySmall, color: colors.text.muted, flex: 1, lineHeight: 20 },
});
