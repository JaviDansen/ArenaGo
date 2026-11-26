import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { createStaffEventsStore } from '../../services/staffEventsService';
import { createStaffDashboardStore } from '../../services/staffDashboardService';
import StaffEntryControlRealScreen from './StaffEntryControlRealScreen';
import StaffStationOperationalScreen from './StaffStationOperationalScreen';
import { useStaffPolling } from './useStaffPolling';
import { AdminIcon, AdminIconTile, liveColors as c, liveStyles as live } from '../admin/components/AdminLiveUI';
import StaffLiveScreen from './components/StaffLiveScreen';
import { resolveStaffPollingIndicator, StaffPollingStatusPill } from './components/StaffSyncFeedback';

const Stack = createNativeStackNavigator();
const StaffEventsContext = createContext(null);
const STATUS_LABELS = {
  scheduled: 'Agendado',
  open: 'Aberto',
  closing: 'Em encerramento',
  closed: 'Encerrado',
  not_ready: 'Não está pronto',
};

const phaseLabel = (event) => STATUS_LABELS[event?.effectivePhase] ?? 'Situação indisponível';

function getPhaseMeta(event) {
  switch (event?.effectivePhase) {
    case 'open':
      return { tone: 'success', operationalText: 'Disponível para operar' };
    case 'scheduled':
      return { tone: 'brand', operationalText: 'Aguardando horário de abertura' };
    case 'not_ready':
      return { tone: 'warning', operationalText: 'Aguardando prontidão operacional' };
    case 'closing':
      return { tone: 'warning', operationalText: 'Encerramento em curso' };
    case 'closed':
      return { tone: 'muted', operationalText: 'Operação encerrada' };
    default:
      return { tone: 'muted', operationalText: 'Situação indisponível' };
  }
}

const TONE_STYLES = {
  success: {
    pill: { backgroundColor: 'rgba(16, 185, 129, 0.14)', borderColor: '#10B981' },
    text: { color: '#34D399' },
  },
  brand: {
    pill: { backgroundColor: c.infoSurface, borderColor: c.info },
    text: { color: c.info },
  },
  warning: {
    pill: { backgroundColor: 'rgba(245, 158, 11, 0.14)', borderColor: '#F59E0B' },
    text: { color: '#FCD34D' },
  },
  danger: {
    pill: { backgroundColor: 'rgba(239, 68, 68, 0.14)', borderColor: '#EF4444' },
    text: { color: '#FCA5A5' },
  },
  muted: {
    pill: { backgroundColor: 'rgba(100, 116, 139, 0.18)', borderColor: '#475569' },
    text: { color: '#CBD5E1' },
  },
};

function StatusPill({ label, tone = 'muted', uppercase = false }) {
  const toneStyle = TONE_STYLES[tone] ?? TONE_STYLES.muted;
  return (
    <View style={[styles.statusPill, toneStyle.pill]}>
      <Text style={[styles.statusPillText, toneStyle.text, uppercase && styles.uppercase]}>
        {label}
      </Text>
    </View>
  );
}

function EntryScannerIcon() {
  return (
    <View style={live.iconTile} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.scannerFrame}>
        <View style={styles.scannerLine} />
      </View>
    </View>
  );
}

function GamepadIcon() {
  return (
    <View style={live.iconTile} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.gamepadBody}>
        <Text style={styles.gamepadPlus}>+</Text>
        <View style={styles.gamepadDots}>
          <View style={styles.gamepadDot} />
          <View style={styles.gamepadDot} />
        </View>
      </View>
    </View>
  );
}

function Button({ label, accessibilityLabel = label, onPress, disabled = false, variant = 'primary' }) {
  const isSecondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        isSecondary && styles.buttonSecondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, isSecondary && styles.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

function describeEntrySummary(snapshot) {
  if (snapshot.accessLocked || snapshot.entryError === 'denied' || snapshot.entryError === 'session') {
    return {
      subtitle: snapshot.accessStatus === 'revalidating'
        ? 'Revalidando acesso ao evento...'
        : 'Acesso ao evento indisponível',
      badgeLabel: 'SEM ACESSO',
      badgeTone: 'danger',
      waitingText: '—',
      hasPendingCall: false,
    };
  }
  if (snapshot.verifyingAccess) {
    return {
      subtitle: 'Verificando acesso ao evento...',
      badgeLabel: 'VERIFICANDO',
      badgeTone: 'muted',
      waitingText: '—',
      hasPendingCall: false,
    };
  }
  if (snapshot.accessUncertain) {
    return {
      subtitle: 'Estado da fila externa indisponível',
      badgeLabel: 'INDISPONÍVEL',
      badgeTone: 'danger',
      waitingText: '—',
      hasPendingCall: false,
    };
  }
  if (snapshot.entryStatus === 'loading' || snapshot.entryStatus === 'idle') {
    return {
      subtitle: 'Consultando fila externa...',
      badgeLabel: 'CONSULTANDO',
      badgeTone: 'muted',
      waitingText: '—',
      hasPendingCall: false,
    };
  }
  if (snapshot.entryStatus === 'error' || !snapshot.entry) {
    return {
      subtitle: 'Estado da fila externa indisponível',
      badgeLabel: 'INDISPONÍVEL',
      badgeTone: 'danger',
      waitingText: '—',
      hasPendingCall: false,
    };
  }
  const { entry } = snapshot;
  const waitingCount = entry.waitingCount;
  const waitingSuffix = waitingCount > 0 ? ` · ${waitingCount} aguardando` : '';

  if (entry.pendingCall) {
    return {
      subtitle: `Chamada pendente: ${entry.pendingCall.displayName}${waitingSuffix}`,
      badgeLabel: entry.externalQueueEnabled ? 'FILA ATIVA' : 'FILA INATIVA',
      badgeTone: entry.externalQueueEnabled ? 'success' : 'muted',
      waitingText: String(waitingCount),
      hasPendingCall: true,
    };
  }
  if (!entry.externalQueueEnabled) {
    return {
      subtitle: 'Fila externa desativada · entrada direta',
      badgeLabel: 'FILA INATIVA',
      badgeTone: 'muted',
      waitingText: String(waitingCount),
      hasPendingCall: false,
    };
  }
  if (waitingCount > 0) {
    return {
      subtitle: `${waitingCount} ${waitingCount === 1 ? 'pessoa aguardando na entrada' : 'pessoas aguardando na entrada'}`,
      badgeLabel: 'FILA ATIVA',
      badgeTone: 'success',
      waitingText: String(waitingCount),
      hasPendingCall: false,
    };
  }
  return {
    subtitle: 'Sem atendimento pendente',
    badgeLabel: 'FILA ATIVA',
    badgeTone: 'success',
    waitingText: '0',
    hasPendingCall: false,
  };
}

function StaffEventsProvider({ children }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const getIdentity = () => {
    const current = authRef.current;
    const roles = current?.user?.roles;
    if (!current?.isAuthenticated || !current.user?.id || !Array.isArray(roles) ||
        !roles.includes('staff') || roles.includes('admin') ||
        typeof current.isIdentityVerified !== 'function' || !current.isIdentityVerified() ||
        typeof current.getSessionEpoch !== 'function' || typeof current.getIdentityRevision !== 'function') return null;
    return { userId: current.user.id, epoch: current.getSessionEpoch(), revision: current.getIdentityRevision() };
  };
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStaffEventsStore({
      client: { get: (...args) => authRef.current.httpClient.get(...args) },
      getIdentity,
    });
  }
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const identity = getIdentity();
  const userId = identity?.userId ?? null;
  const epoch = identity?.epoch ?? null;
  const revision = identity?.revision ?? null;

  useEffect(() => store.subscribe(setSnapshot), [store]);
  useEffect(() => {
    const next = userId !== null ? { userId, epoch, revision } : null;
    store.setIdentity(next);
    if (next) void store.refresh();
    return () => store.setIdentity(null);
  }, [store, userId, epoch, revision]);

  const current = store.isCurrent(snapshot.identity);
  const value = {
    status: current ? snapshot.status : 'loading',
    events: current ? snapshot.events : [],
    selected: current ? snapshot.selected : null,
    error: current ? snapshot.error : null,
    refresh: store.refresh,
    refreshSilent: store.refreshSilent,
    select: store.select,
    clearSelection: store.clearSelection,
    isCurrent: store.isCurrent,
    getSelected: () => store.isCurrent() ? store.getSnapshot().selected : null,
    logout: () => { if (store.isCurrent(snapshot.identity)) void authRef.current.logout(); },
  };
  return <StaffEventsContext.Provider value={value}>{children}</StaffEventsContext.Provider>;
}

function StaffEventsScreen({ navigation }) {
  const staff = useContext(StaffEventsContext);
  const focused = useIsFocused();
  const [appState, setAppState] = useState(() => AppState?.currentState ?? 'active');
  useEffect(() => {
    const subscription = AppState?.addEventListener?.('change', setAppState);
    return () => subscription?.remove?.();
  }, []);
  const recoverableEventsError = staff.status === 'error'
    && (staff.error === 'network' || staff.error === 'unavailable');
  const canPollEvents = staff.status === 'ready' || recoverableEventsError;
  useStaffPolling(canPollEvents, staff.refreshSilent, 60000);
  const eventsPollingIndicator = resolveStaffPollingIndicator({
    hidden: staff.status === 'error' && (staff.error === 'session' || staff.error === 'denied'),
    loading: staff.status === 'loading' || staff.status === 'idle',
    pollingEnabled: canPollEvents,
    visible: focused && appState === 'active',
    stale: staff.error === 'stale',
    recoverableError: recoverableEventsError,
    intervalSeconds: 60,
  });
  const messages = {
    session: 'Não foi possível confirmar sua sessão. Entre novamente ou tente atualizar.',
    denied: 'Acesso Staff indisponível para esta conta. Atualize os eventos ou procure o responsável.',
    network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    unavailable: 'Não foi possível carregar os eventos autorizados. Tente novamente.',
  };

  return (
    <StaffLiveScreen testID="staff-events-background" actionLabel="Sair da conta" onAction={staff.logout} logout>
      <View style={styles.headerBlock}>
        <Text style={styles.eyebrow}>ÁREA OPERACIONAL</Text>
        <Text style={styles.screenTitle} accessibilityRole="header">Eventos Staff</Text>
        <Text style={styles.description}>
          Selecione um evento autorizado para começar a operação.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>SEUS EVENTOS</Text>

      {staff.status === 'loading' && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>Carregando eventos...</Text>
        </View>
      )}

      {staff.status === 'error' && (
        <View style={styles.errorCard}>
          <StatusPill label="Falha na consulta" tone="danger" uppercase />
          <Text accessibilityRole="alert" style={styles.alertMessage}>
            {messages[staff.error] ?? messages.unavailable}
          </Text>
        </View>
      )}

      {staff.error === 'stale' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            A lista pode estar desatualizada. Atualize os eventos.
          </Text>
        </View>
      )}

      {staff.status === 'ready' && staff.events.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.cardTitle}>Nenhum evento autorizado</Text>
          <Text style={styles.message}>Nenhum evento autorizado para esta conta.</Text>
        </View>
      )}

      {staff.status === 'ready' && staff.events.map((event) => {
        const meta = getPhaseMeta(event);
        return (
          <Pressable
            key={event.id}
            accessibilityRole="button"
            accessibilityLabel={`Selecionar evento ${event.name}`}
            style={({ pressed }) => [styles.listCard, live.row, pressed && styles.pressed]}
            onPress={() => {
              if (staff.select(event.id)) navigation.navigate('StaffEventHome');
            }}
          >
            <AdminIconTile name="calendar" />
            <View style={styles.cardBody}>
              <Text style={styles.eventName}>{event.name}</Text>
              {Number.isSafeInteger(event.stationCount) && (
                <Text style={styles.cardSubtitle}>
                  {event.stationCount} {event.stationCount === 1 ? 'Estação' : 'Estações'}
                </Text>
              )}
              {typeof event.periodLabel === 'string' && event.periodLabel.trim() ? (
                <Text style={styles.cardSubtitle}>{event.periodLabel}</Text>
              ) : null}
              {typeof event.location === 'string' && event.location.trim() ? (
                <Text style={styles.cardSubtitle}>{event.location}</Text>
              ) : null}
              <View style={styles.eventMetaRow}>
                <StatusPill label={phaseLabel(event)} tone={meta.tone} uppercase />
                <Text style={styles.eventStatusText}>{meta.operationalText}</Text>
              </View>
            </View>
            <AdminIcon name="chevron" color={c.muted} size={18} />
          </Pressable>
        );
      })}

      <Text style={styles.helperNote}>
        Aqui aparecem somente eventos em que sua conta possui autorização Staff.
      </Text>

      <StaffPollingStatusPill indicator={eventsPollingIndicator} />

      <Button
        label="Atualizar eventos"
        variant="secondary"
        disabled={staff.status === 'loading'}
        onPress={() => { void staff.refresh(); }}
      />
    </StaffLiveScreen>
  );
}

function StaffEventHomeScreen({ navigation }) {
  const staff = useContext(StaffEventsContext);
  useStaffPolling(Boolean(staff.selected && staff.status === 'ready'), staff.refreshSilent, 60000, staff.selected?.id);
  const [section, setSection] = useState('panel');
  const [stationId, setStationId] = useState(null);
  const stationVisitGenRef = useRef(0);
  const openStation = useCallback((nextStationId) => {
    stationVisitGenRef.current += 1;
    setStationId(nextStationId);
    setSection('station');
  }, []);
  const returnToPanel = useCallback(() => {
    stationVisitGenRef.current += 1;
    setStationId(null);
    setSection('panel');
  }, []);
  useEffect(() => navigation.addListener('beforeRemove', (action) => {
    if (staff.getSelected() && section !== 'panel') {
      action.preventDefault();
      returnToPanel();
    } else {
      stationVisitGenRef.current += 1;
      staff.clearSelection();
    }
  }), [navigation, staff.clearSelection, staff.getSelected, section, returnToPanel]);
  const selected = staff.isCurrent() ? staff.selected : null;
  const isSubsection = Boolean(selected && section !== 'panel');

  function goBack() {
    if (isSubsection && staff.getSelected()) {
      returnToPanel();
      return;
    }
    stationVisitGenRef.current += 1;
    staff.clearSelection();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('StaffEvents');
  }

  return (
    <StaffLiveScreen testID="staff-event-home-background"
      actionLabel={isSubsection ? 'Voltar ao painel' : 'Voltar aos eventos'} onAction={goBack}>
      {selected ? (
        <StaffEventDashboard
          event={selected}
          staff={staff}
          section={section}
          setSection={setSection}
          stationId={stationId}
          setStationId={setStationId}
          openStation={openStation}
          stationVisitGenRef={stationVisitGenRef}
        />
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.cardTitle}>Selecione um evento</Text>
          <Text style={styles.message}>Atualize a lista para confirmar os eventos autorizados.</Text>
        </View>
      )}
    </StaffLiveScreen>
  );
}

function StaffEventDashboard({ event, staff, section, setSection, stationId, setStationId, openStation, stationVisitGenRef }) {
  const auth = useAuth();
  const focused = useIsFocused();
  const [appState, setAppState] = useState(() => AppState?.currentState ?? 'active');
  useEffect(() => {
    const subscription = AppState?.addEventListener?.('change', setAppState);
    return () => subscription?.remove?.();
  }, []);
  const live = useRef({ auth, staff, section, stationId, stationExperienceId: null, eventId: event.id });
  const activeStationMetaRef = useRef(null);
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStaffDashboardStore({
      client: { get: (...args) => live.current.auth.httpClient.get(...args) },
      getContext: () => {
        const { auth: current, staff: area } = live.current;
        const selected = area.getSelected();
        if (!selected || !current?.isAuthenticated || !current.user?.id || !current.isIdentityVerified()) return null;
        return {
          eventId: selected.id,
          userId: current.user.id,
          epoch: current.getSessionEpoch(),
          revision: current.getIdentityRevision(),
        };
      },
    });
  }
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const prevSectionRef = useRef(section);
  const epoch = auth.getSessionEpoch();
  const revision = auth.getIdentityRevision();
  useEffect(() => store.subscribe(setSnapshot), [store]);
  useEffect(() => {
    stationVisitGenRef.current += 1;
    activeStationMetaRef.current = null;
    prevSectionRef.current = 'panel';
    store.setContext({ eventId: event.id, userId: auth.user.id, epoch, revision });
    void store.refreshPanel();
    setStationId(null);
    setSection('panel');
    return () => {
      stationVisitGenRef.current += 1;
      activeStationMetaRef.current = null;
      store.setContext(null);
    };
  }, [store, event.id, auth.user.id, epoch, revision, setSection, setStationId, stationVisitGenRef]);
  useEffect(() => {
    const prev = prevSectionRef.current;
    prevSectionRef.current = section;
    if (section !== 'station') {
      activeStationMetaRef.current = null;
      store.clearQueue();
    }
    if (prev !== 'panel' && section === 'panel') {
      void store.revalidateOnReturn();
    }
  }, [store, section]);
  useEffect(() => {
    if (section !== 'panel') return;
    const liveSnap = store.getSnapshot();
    if (
      store.isCurrent(liveSnap.context)
      && !liveSnap.accessLocked
      && !liveSnap.verifyingAccess
      && !liveSnap.accessUncertain
      && liveSnap.stationStatus === 'idle'
      && liveSnap.experienceStatus === 'idle'
      && liveSnap.entryStatus === 'idle'
    ) {
      void store.refreshPanel();
    }
  }, [
    section,
    snapshot.context,
    snapshot.accessLocked,
    snapshot.verifyingAccess,
    snapshot.accessUncertain,
    snapshot.stationStatus,
    snapshot.experienceStatus,
    snapshot.entryStatus,
    store,
  ]);
  const experiencesById = new Map(snapshot.experiences.map((experience) => [experience.id, experience]));
  const station = snapshot.stations.find((item) => item.id === stationId);
  const stationExperience = station && experiencesById.get(station.experienceId);
  const ready = !snapshot.accessLocked
    && !snapshot.verifyingAccess
    && !snapshot.accessUncertain
    && snapshot.stationStatus === 'ready'
    && snapshot.experienceStatus === 'ready';
  const accessLost = Boolean(snapshot.accessLocked)
    || [snapshot.stationError, snapshot.experienceError, snapshot.entryError]
      .some((err) => err === 'denied' || err === 'session');
  if (section !== 'station' || accessLost || !store.isCurrent(snapshot.context)) {
    activeStationMetaRef.current = null;
  } else if (ready && station && stationExperience) {
    activeStationMetaRef.current = { eventId: event.id, station, experience: stationExperience };
  }
  const activeStationMeta = (
    section === 'station'
    && !accessLost
    && store.isCurrent(snapshot.context)
    && activeStationMetaRef.current?.eventId === event.id
    && activeStationMetaRef.current?.station?.id === stationId
  ) ? activeStationMetaRef.current : null;
  const resolvedStation = ready && station && stationExperience
    ? { station, experience: stationExperience }
    : activeStationMeta;
  live.current = {
    auth,
    staff,
    section,
    stationId,
    stationExperienceId: resolvedStation?.station?.experienceId ?? null,
    eventId: event.id,
  };
  const orphanStations = ready
    ? snapshot.stations.filter((item) => !experiencesById.has(item.experienceId))
    : [];
  const missingExperienceIds = orphanStations.length > 0
    ? [...new Set(orphanStations.map((item) => item.experienceId))].sort()
    : [];
  const orphanSignature = missingExperienceIds.length > 0
    ? `${event.id}:${epoch}:${revision}:${missingExperienceIds.join(',')}`
    : null;
  useEffect(() => {
    if (section !== 'panel' || !ready || snapshot.accessLocked || !orphanSignature) return;
    void store.syncOrphanExperiences();
  }, [section, ready, snapshot.accessLocked, orphanSignature, snapshot.experiences, snapshot.experienceError, store]);
  const canPollStations = (section === 'panel' || section === 'station')
    && store.isCurrent(snapshot.context)
    && !snapshot.accessLocked
    && !snapshot.verifyingAccess
    && !snapshot.accessUncertain
    && (snapshot.stationStatus === 'ready'
      || (snapshot.stationStatus === 'error' && (snapshot.stationError === 'network' || snapshot.stationError === 'unavailable')));
  const canPollExperiences = section === 'panel'
    && store.isCurrent(snapshot.context)
    && !snapshot.accessLocked
    && !snapshot.verifyingAccess
    && !snapshot.accessUncertain
    && ((snapshot.experienceStatus === 'error' && (snapshot.experienceError === 'network' || snapshot.experienceError === 'unavailable'))
      || snapshot.experienceError === 'stale');
  const canPollEntry = section === 'panel'
    && store.isCurrent(snapshot.context)
    && !snapshot.accessLocked
    && !snapshot.verifyingAccess
    && !snapshot.accessUncertain
    && (snapshot.entryStatus === 'ready'
      || (snapshot.entryStatus === 'error' && (snapshot.entryError === 'network' || snapshot.entryError === 'unavailable')));
  useStaffPolling(
    canPollStations,
    () => store.pollStations(),
    5000,
    `${event.id}:${section}:stations:${epoch}:${revision}`,
  );
  useStaffPolling(
    canPollExperiences,
    () => store.pollExperiences(),
    5000,
    `${event.id}:experiences:${epoch}:${revision}`,
  );
  useStaffPolling(
    canPollEntry,
    () => store.pollEntryControl(),
    5000,
    `${event.id}:entry:${epoch}:${revision}`,
  );
  useStaffPolling(
    section === 'station'
      && store.isCurrent(snapshot.context)
      && !snapshot.accessLocked
      && !snapshot.verifyingAccess
      && !snapshot.accessUncertain
      && (snapshot.queueStatus === 'ready'
        || (snapshot.queueStatus === 'error' && (snapshot.queueError === 'network' || snapshot.queueError === 'unavailable'))),
    () => store.pollQueue(),
    5000,
    `${event.id}:${stationId}:${epoch}:${revision}`,
  );
  if (!store.isCurrent(snapshot.context)) return null;

  const messages = {
    session: 'Não foi possível confirmar sua sessão. Entre novamente ou tente atualizar.',
    denied: 'Acesso ao evento ou à experiência indisponível. Atualize seus eventos autorizados.',
    network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    unavailable: 'Não foi possível carregar os dados. Tente novamente.',
    stale: 'Dados operacionais possivelmente desatualizados. Atualize antes de operar.',
  };
  const entryBlocked = accessLost || Boolean(snapshot.verifyingAccess) || Boolean(snapshot.accessUncertain);
  const dashboardErrors = [...new Set([
    snapshot.accessLocked ? (snapshot.accessStatus === 'session' ? 'session' : 'denied') : null,
    snapshot.stationStatus === 'error' ? snapshot.stationError : null,
    snapshot.experienceStatus === 'error' ? snapshot.experienceError : null,
    (snapshot.entryError === 'denied' || snapshot.entryError === 'session') ? snapshot.entryError : null,
  ].filter(Boolean))];
  const refresh = () => {
    void store.refreshPanel();
  };

  const captureStationScope = (originStation) => {
    const curAuth = live.current.auth;
    return {
      visitGen: stationVisitGenRef.current,
      userId: curAuth?.user?.id ?? null,
      sessionId: curAuth?.sessionId ?? null,
      epoch: curAuth?.getSessionEpoch?.() ?? null,
      revision: curAuth?.getIdentityRevision?.() ?? null,
      eventId: event.id,
      stationId: originStation.id,
      experienceId: originStation.experienceId,
      dashboardContext: store.getSnapshot().context,
    };
  };

  const isSameStationScope = (origin) => {
    const cur = live.current;
    const curAuth = cur.auth;
    const roles = curAuth?.user?.roles;
    if (
      !curAuth?.isAuthenticated
      || typeof curAuth.isIdentityVerified !== 'function'
      || !curAuth.isIdentityVerified()
      || !Array.isArray(roles)
      || !roles.includes('staff')
      || roles.includes('admin')
    ) return false;
    const snap = store.getSnapshot();
    return (
      stationVisitGenRef.current === origin.visitGen
      && curAuth.user?.id === origin.userId
      && curAuth.sessionId === origin.sessionId
      && curAuth.getSessionEpoch?.() === origin.epoch
      && curAuth.getIdentityRevision?.() === origin.revision
      && cur.staff.getSelected()?.id === origin.eventId
      && cur.section === 'station'
      && cur.stationId === origin.stationId
      && cur.stationExperienceId === origin.experienceId
      && !store.isAccessLocked()
      && !snap.verifyingAccess
      && !snap.accessUncertain
      && store.isCurrent(origin.dashboardContext)
    );
  };

  const eventMeta = getPhaseMeta(event);
  const entrySummary = describeEntrySummary(snapshot);
  const availableStationsCount = snapshot.stations.filter((item) => item.availability === 'available').length;
  const pendingStationsCount = snapshot.stations.filter((item) => Boolean(item.pendingServiceSessionId)).length;
  const availableText = !snapshot.accessLocked && !snapshot.verifyingAccess && !snapshot.accessUncertain && snapshot.stationStatus === 'ready'
    ? `${availableStationsCount}/${snapshot.stations.length}`
    : '—';
  const pendingStationsText = !snapshot.accessLocked && !snapshot.verifyingAccess && !snapshot.accessUncertain && snapshot.stationStatus === 'ready'
    ? String(pendingStationsCount)
    : '—';
  const panelLoading = snapshot.stationStatus === 'loading'
    || snapshot.experienceStatus === 'loading'
    || snapshot.entryStatus === 'loading'
    || snapshot.stationStatus === 'idle'
    || snapshot.experienceStatus === 'idle'
    || snapshot.entryStatus === 'idle';
  const panelStale = snapshot.stationError === 'stale'
    || snapshot.experienceError === 'stale'
    || snapshot.entryError === 'stale'
    || staff.error === 'stale';
  const panelRecoverableError = !accessLost
    && !snapshot.verifyingAccess
    && !snapshot.accessUncertain
    && ((snapshot.stationStatus === 'error' && (snapshot.stationError === 'network' || snapshot.stationError === 'unavailable'))
      || (snapshot.experienceStatus === 'error' && (snapshot.experienceError === 'network' || snapshot.experienceError === 'unavailable'))
      || (snapshot.entryStatus === 'error' && (snapshot.entryError === 'network' || snapshot.entryError === 'unavailable')));
  const panelPollingEnabled = canPollStations || canPollExperiences || canPollEntry;
  const panelPollingIndicator = resolveStaffPollingIndicator({
    hidden: accessLost,
    verifying: Boolean(snapshot.verifyingAccess),
    loading: panelLoading,
    pollingEnabled: panelPollingEnabled,
    visible: focused && appState === 'active',
    stale: panelStale,
    recoverableError: panelRecoverableError,
    unavailableError: Boolean(snapshot.accessUncertain),
    intervalSeconds: 5,
  });

  return (
    <>
      {(section === 'panel' || section === 'station') && dashboardErrors.map((kind) => (
        <View key={kind} style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.alertMessage}>{messages[kind]}</Text>
        </View>
      ))}
      {section === 'panel' && snapshot.verifyingAccess && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>Verificando acesso ao evento...</Text>
        </View>
      )}
      {(snapshot.queueError === 'stale' || (section === 'panel' && panelStale)) && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>{messages.stale}</Text>
        </View>
      )}

      {section === 'panel' && (
        <>
          <View>
            <Text style={styles.eyebrow}>ÁREA OPERACIONAL</Text>
            <Text style={styles.screenTitle} accessibilityRole="header">Painel operacional</Text>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <AdminIconTile name="calendar" />
              <View style={styles.heroInfo}>
                <Text style={styles.heroEventName}>{event.name}</Text>
                <StatusPill label={`Status: ${phaseLabel(event)}`} tone={eventMeta.tone} />
                <Text style={styles.cardSubtitle}>{eventMeta.operationalText}</Text>
                {typeof event.periodLabel === 'string' && event.periodLabel.trim() ? (
                  <Text style={styles.cardSubtitle}>{event.periodLabel}</Text>
                ) : null}
                {typeof event.location === 'string' && event.location.trim() ? (
                  <Text style={styles.cardSubtitle}>{event.location}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.heroDivider} />

            <View style={styles.metricsGrid}>
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>{availableText}</Text>
                <Text style={styles.metricLabel}>Estações ativas</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>{pendingStationsText}</Text>
                <Text style={styles.metricLabel}>Em atendimento</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>{entrySummary.waitingText}</Text>
                <Text style={styles.metricLabel}>Fila externa</Text>
              </View>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Controle de Entrada"
            accessibilityState={{ disabled: entryBlocked }}
            disabled={entryBlocked}
            style={({ pressed }) => [styles.operationCard, entryBlocked && styles.disabled, pressed && styles.pressed]}
            onPress={entryBlocked ? undefined : () => setSection('entry')}
          >
            <View style={styles.operationRow}>
              <EntryScannerIcon />
              <View style={styles.cardBody}>
                <Text style={styles.eventName}>Controle de Entrada</Text>
                <Text style={styles.cardSubtitle}>{entrySummary.subtitle}</Text>
                <View style={styles.operationBadges}>
                  <StatusPill label={entrySummary.badgeLabel} tone={entrySummary.badgeTone} uppercase />
                  {entrySummary.hasPendingCall && (
                    <StatusPill label="Chamada pendente" tone="warning" uppercase />
                  )}
                </View>
              </View>
              <AdminIcon name="chevron" color={c.muted} size={18} />
            </View>
          </Pressable>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>ESTAÇÕES DO EVENTO</Text>
            {ready && (
              <Text style={styles.sectionCount}>
                {snapshot.stations.length} {snapshot.stations.length === 1 ? 'estação' : 'estações'}
              </Text>
            )}
          </View>

          {snapshot.stationStatus === 'loading' && (
            <View style={styles.stateCard}>
              <ActivityIndicator color={c.accent} />
              <Text style={styles.message}>Carregando estações...</Text>
            </View>
          )}
          {snapshot.experienceStatus === 'loading' && (
            <View style={styles.stateCard}>
              <ActivityIndicator color={c.accent} />
              <Text style={styles.message}>Carregando experiências...</Text>
            </View>
          )}
          {ready && snapshot.stations.length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.message}>Nenhuma estação encontrada neste evento.</Text>
            </View>
          )}
          {ready && snapshot.experiences.length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.message}>Nenhuma experiência encontrada neste evento.</Text>
            </View>
          )}

          {ready && snapshot.experiences.map((experience) => {
            const groupStations = snapshot.stations.filter((item) => item.experienceId === experience.id);
            return (
              <View key={experience.id} style={styles.experienceGroup}>
                <Text style={styles.experienceGroupTitle}>{experience.name}</Text>
                {groupStations.length === 0 && (
                  <View style={styles.emptyCard}>
                    <Text style={styles.message}>Nenhuma estação associada.</Text>
                  </View>
                )}
                {groupStations.map((item) => {
                  const isAvailable = item.availability === 'available';
                  const hasPending = Boolean(item.pendingServiceSessionId);
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Selecionar estação ${item.label} da experiência ${experience.name}`}
                      style={({ pressed }) => [styles.operationCard, pressed && styles.pressed]}
                      onPress={() => {
                        openStation(item.id);
                        void store.refreshQueue(item.experienceId);
                      }}
                    >
                      <View style={styles.operationRow}>
                        <GamepadIcon />
                        <View style={styles.cardBody}>
                          <Text style={styles.eventName}>{item.label}</Text>
                          <Text style={styles.cardSubtitle}>
                            {hasPending ? 'Atendimento pendente nesta estação' : 'Sem atendimento pendente'}
                          </Text>
                          <View style={styles.operationBadges}>
                            <StatusPill
                              label={isAvailable ? 'Disponível' : 'Indisponível'}
                              tone={isAvailable ? 'success' : 'danger'}
                              uppercase
                            />
                            {hasPending && <StatusPill label="Chamado" tone="warning" uppercase />}
                          </View>
                        </View>
                        <AdminIcon name="chevron" color={c.muted} size={18} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}

          {orphanStations.length > 0 && (
            <View style={styles.experienceGroup}>
              <Text style={styles.experienceGroupTitle}>Experiência não vinculada</Text>
              {orphanStations.map((item) => (
                <View key={item.id} style={[styles.listCard, live.row]}>
                  <GamepadIcon />
                  <View style={styles.cardBody}>
                    <Text style={styles.eventName}>{item.label}</Text>
                    <Text style={styles.cardSubtitle}>Dados da experiência indisponíveis</Text>
                    <StatusPill
                      label={item.availability === 'available' ? 'Disponível' : 'Indisponível'}
                      tone={item.availability === 'available' ? 'success' : 'danger'}
                      uppercase
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          <StaffPollingStatusPill indicator={panelPollingIndicator} />

          <Button
            label="Atualizar estações"
            variant="secondary"
            disabled={
              snapshot.stationStatus === 'loading'
              || snapshot.experienceStatus === 'loading'
              || snapshot.entryStatus === 'loading'
              || Boolean(snapshot.verifyingAccess)
            }
            onPress={refresh}
          />
        </>
      )}

      {section === 'entry' && (
        <StaffEntryControlRealScreen
          event={event}
          isEventCurrent={() => staff.getSelected()?.id === event.id && !store.isAccessLocked()}
          accessDenied={accessLost}
          accessDeniedKind={snapshot.accessStatus === 'session' ? 'session' : 'denied'}
          onAccessDenied={(kind) => store.reportAccessDenied(kind)}
        />
      )}

      {section === 'station' && (
        <>
          {!accessLost && !resolvedStation && (snapshot.stationStatus === 'loading' || snapshot.experienceStatus === 'loading') && (
            <View accessibilityRole="progressbar" style={styles.stateCard}>
              <ActivityIndicator color={c.accent} />
              <Text style={styles.message}>Carregando estação...</Text>
            </View>
          )}
          {ready && !resolvedStation && (
            <View style={styles.emptyCard}>
              <Text style={styles.cardTitle}>Estação indisponível</Text>
              <Text style={styles.message}>
                A estação selecionada não está disponível neste evento. Volte ao painel para atualizar.
              </Text>
            </View>
          )}
          {resolvedStation && (
            <>
              {snapshot.experienceId === resolvedStation.station.experienceId && snapshot.queueStatus === 'error' && (
                <View style={styles.errorCard}>
                  <Text accessibilityRole="alert" style={styles.alertMessage}>{messages[snapshot.queueError]}</Text>
                </View>
              )}
              <StaffStationOperationalScreen
                event={event}
                experience={resolvedStation.experience}
                station={resolvedStation.station}
                isEventCurrent={() => (
                  staff.getSelected()?.id === event.id
                  && live.current.section === 'station'
                  && live.current.stationId === resolvedStation.station.id
                  && !store.isAccessLocked()
                )}
                accessDenied={accessLost}
                accessDeniedKind={snapshot.accessStatus === 'session' ? 'session' : 'denied'}
                onAccessDenied={(kind) => store.reportAccessDenied(kind)}
                onStationNotFound={(info) => store.verifyStationAccess(info)}
                onRefresh={() => {
                  const origin = captureStationScope(resolvedStation.station);
                  if (!isSameStationScope(origin)) return Promise.resolve();
                  return store.refreshQueue(origin.experienceId);
                }}
                onChanged={() => {
                  const origin = captureStationScope(resolvedStation.station);
                  if (!isSameStationScope(origin)) return;
                  void (async () => {
                    if (store.getSnapshot().stationStatus === 'ready') await store.pollStations();
                    else await store.refreshStations();
                    if (!isSameStationScope(origin)) return;
                    if (store.getSnapshot().queueStatus === 'ready') await store.pollQueue(origin.experienceId);
                    else await store.refreshQueue(origin.experienceId);
                  })();
                }}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

export default function StaffEventsNavigator() {
  return (
    <StaffEventsProvider>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: styles.stackContent }}>
        <Stack.Screen name="StaffEvents" component={StaffEventsScreen} />
        <Stack.Screen name="StaffEventHome" component={StaffEventHomeScreen} />
      </Stack.Navigator>
    </StaffEventsProvider>
  );
}

const styles = StyleSheet.create({
  stackContent: { backgroundColor: c.background },
  headerBlock: { marginBottom: 8 },
  eyebrow: { color: c.muted, fontSize: 12, lineHeight: 18, fontWeight: '700', letterSpacing: 2, marginTop: 12 },
  screenTitle: { color: c.text, fontSize: 28, lineHeight: 35, fontWeight: '700', marginTop: 8 },
  description: { color: c.muted, fontSize: 16, lineHeight: 24, marginTop: 10 },
  sectionLabel: { color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.6, marginTop: 8 },
  sectionHeaderRow: { ...live.row, flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 4 },
  sectionCount: { color: c.muted, fontSize: 13, fontWeight: '600' },
  listCard: { ...live.card, marginTop: 0, minHeight: 64 },
  operationCard: { ...live.card, marginTop: 0, minHeight: 64, paddingVertical: 12 },
  operationRow: { ...live.row, gap: 10 },
  operationBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heroCard: { ...live.card, marginTop: 0, gap: 14 },
  heroTopRow: live.row,
  heroInfo: { ...live.grow, gap: 4 },
  heroEventName: live.title,
  heroDivider: { height: 1, backgroundColor: '#795395' },
  metricsGrid: { flexDirection: 'row', alignItems: 'center' },
  metricCell: { ...live.grow, alignItems: 'center', paddingHorizontal: 4, gap: 4 },
  metricDivider: { width: 1, height: 32, backgroundColor: '#795395' },
  metricValue: { color: c.text, fontSize: 20, fontWeight: '700' },
  metricLabel: { color: c.muted, fontSize: 12, textAlign: 'center' },
  cardBody: { ...live.grow, gap: 4 },
  cardTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  eventName: { color: c.text, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  cardSubtitle: { color: c.muted, fontSize: 14, lineHeight: 20 },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  eventStatusText: { color: c.muted, fontSize: 13, fontWeight: '500' },
  statusPill: { borderRadius: 24, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start', maxWidth: '100%' },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  uppercase: { textTransform: 'uppercase' },
  experienceGroup: { gap: 10 },
  experienceGroupTitle: { color: c.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  scannerFrame: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: c.accent,
    alignItems: 'center', justifyContent: 'center' },
  scannerLine: { width: 10, height: 2, backgroundColor: c.accent, borderRadius: 1 },
  gamepadBody: { width: 24, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: c.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  gamepadPlus: { color: c.accent, fontSize: 10, fontWeight: '800', lineHeight: 11 },
  gamepadDots: { flexDirection: 'row', gap: 2 },
  gamepadDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: c.accent },
  stateCard: { ...live.card, ...live.row, marginTop: 0 },
  emptyCard: { ...live.card, marginTop: 0, gap: 6 },
  errorCard: { ...live.card, marginTop: 0, backgroundColor: c.dangerSurface, borderColor: c.danger, gap: 8 },
  warningCard: { ...live.card, marginTop: 0, backgroundColor: c.warningSurface, borderColor: c.warning },
  message: { color: c.muted, fontSize: 15, lineHeight: 22 },
  alertMessage: { color: '#fecaca', fontSize: 14, lineHeight: 20 },
  warningMessage: { color: '#fde68a', fontSize: 13, lineHeight: 19 },
  helperNote: { color: c.muted, fontSize: 13, lineHeight: 19 },
  button: { backgroundColor: c.accentStrong, borderRadius: 12, minHeight: 48, paddingVertical: 12,
    paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: '#251a33', borderWidth: 1, borderColor: c.border },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
  buttonText: { color: c.onAccent, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  buttonSecondaryText: { color: c.text },
});
