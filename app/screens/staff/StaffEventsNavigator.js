import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthBackground } from '../../components/ui/AuthBackground';

import { useAuth } from '../../context/AuthContext';
import { createStaffEventsStore } from '../../services/staffEventsService';
import { createStaffDashboardStore } from '../../services/staffDashboardService';
import StaffEntryControlRealScreen from './StaffEntryControlRealScreen';
import StaffStationOperationalScreen from './StaffStationOperationalScreen';
import { useStaffPolling } from './useStaffPolling';

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
    pill: { backgroundColor: 'rgba(139, 92, 246, 0.16)', borderColor: '#8B5CF6' },
    text: { color: '#C4B5FD' },
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

function StaffBrandHeader() {
  return (
    <View style={styles.brandHeader}>
      <View style={styles.brandRow}>
        <Text style={styles.brandArena}>Arena</Text>
        <Text style={styles.brandGo}>GO</Text>
      </View>
      <View style={styles.rolePill}>
        <Text style={styles.rolePillText}>STAFF</Text>
      </View>
    </View>
  );
}

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

function CalendarIcon() {
  return (
    <View style={styles.iconBox}>
      <View style={styles.calendarPins}>
        <View style={styles.calendarPin} />
        <View style={styles.calendarPin} />
      </View>
      <View style={styles.calendarFrame}>
        <View style={styles.calendarHeaderBar} />
        <View style={styles.calendarDotsRow}>
          <View style={styles.calendarDot} />
          <View style={styles.calendarDot} />
        </View>
      </View>
    </View>
  );
}

function EntryScannerIcon() {
  return (
    <View style={styles.iconBox}>
      <View style={styles.scannerFrame}>
        <View style={styles.scannerLine} />
      </View>
    </View>
  );
}

function GamepadIcon() {
  return (
    <View style={styles.stationIconBox}>
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
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.button,
        isSecondary && styles.buttonSecondary,
        disabled && styles.disabled,
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
  };
  return <StaffEventsContext.Provider value={value}>{children}</StaffEventsContext.Provider>;
}

function StaffEventsScreen({ navigation }) {
  const staff = useContext(StaffEventsContext);
  useStaffPolling(staff.status === 'ready', staff.refreshSilent, 60000);
  const auth = useAuth();
  const messages = {
    session: 'Não foi possível confirmar sua sessão. Entre novamente ou tente atualizar.',
    network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    unavailable: 'Não foi possível carregar os eventos autorizados. Tente novamente.',
  };

  return (
    <AuthBackground testID="staff-events-background" variant="login">
      <ScrollView contentContainerStyle={styles.content}>
        <StaffBrandHeader />

        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>ÁREA OPERACIONAL</Text>
          <Text style={styles.screenTitle}>Eventos Staff</Text>
          <Text style={styles.description}>
            Selecione um evento autorizado para começar a operação.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>SEUS EVENTOS</Text>

        {staff.status === 'loading' && (
          <View accessibilityRole="progressbar" style={styles.stateCard}>
            <ActivityIndicator color="#a78bfa" />
            <Text style={styles.message}>Carregando eventos...</Text>
          </View>
        )}

        {staff.status === 'error' && (
          <View style={styles.errorCard}>
            <StatusPill label="Falha na consulta" tone="danger" uppercase />
            <Text accessibilityRole="alert" style={styles.alertMessage}>
              {messages[staff.error]}
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
              style={styles.eventCard}
              onPress={() => {
                if (staff.select(event.id)) navigation.navigate('StaffEventHome');
              }}
            >
              <CalendarIcon />
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
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}

        <Text style={styles.helperNote}>
          Aqui aparecem somente eventos em que sua conta possui autorização Staff.
        </Text>

        <Button
          label="Atualizar eventos"
          variant="secondary"
          disabled={staff.status === 'loading'}
          onPress={() => { void staff.refresh(); }}
        />

        <View style={styles.footerSpacer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sair da conta"
            style={styles.logoutLink}
            onPress={() => { if (staff.isCurrent()) void auth.logout(); }}
          >
            <Text style={styles.logoutArrow}>↪</Text>
            <Text style={styles.logoutText}>Sair da conta</Text>
          </Pressable>
        </View>
      </ScrollView>
    </AuthBackground>
  );
}

function StaffEventHomeScreen({ navigation }) {
  const staff = useContext(StaffEventsContext);
  useStaffPolling(Boolean(staff.selected && staff.status === 'ready'), staff.refreshSilent, 60000, staff.selected?.id);
  const [section, setSection] = useState('panel');
  const [stationId, setStationId] = useState(null);
  useEffect(() => navigation.addListener('beforeRemove', (action) => {
    if (staff.getSelected() && section !== 'panel') {
      action.preventDefault();
      setStationId(null);
      setSection('panel');
    } else staff.clearSelection();
  }), [navigation, staff.clearSelection, staff.getSelected, section]);
  const selected = staff.isCurrent() ? staff.selected : null;

  return (
    <AuthBackground testID="staff-event-home-background" variant="login">
      <ScrollView contentContainerStyle={styles.content}>
        <StaffBrandHeader />

        {(!selected || section === 'panel') && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar aos eventos"
            style={styles.backLink}
            onPress={() => {
              staff.clearSelection();
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate('StaffEvents');
            }}
          >
            <Text style={styles.backLinkArrow}>←</Text>
            <Text style={styles.backLinkText}>Voltar aos eventos</Text>
          </Pressable>
        )}

        {selected ? (
          <StaffEventDashboard
            event={selected}
            staff={staff}
            section={section}
            setSection={setSection}
            stationId={stationId}
            setStationId={setStationId}
          />
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.cardTitle}>Selecione um evento</Text>
            <Text style={styles.message}>Atualize a lista para confirmar os eventos autorizados.</Text>
          </View>
        )}
      </ScrollView>
    </AuthBackground>
  );
}

function StaffEventDashboard({ event, staff, section, setSection, stationId, setStationId }) {
  const auth = useAuth();
  const live = useRef({ auth, staff });
  live.current = { auth, staff };
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
    prevSectionRef.current = 'panel';
    store.setContext({ eventId: event.id, userId: auth.user.id, epoch, revision });
    void store.refreshPanel();
    setStationId(null);
    setSection('panel');
    return () => store.setContext(null);
  }, [store, event.id, auth.user.id, epoch, revision, setSection, setStationId]);
  useEffect(() => {
    const prev = prevSectionRef.current;
    prevSectionRef.current = section;
    if (section !== 'station') store.clearQueue();
    if (prev !== 'panel' && section === 'panel') {
      void store.revalidateOnReturn();
    }
  }, [store, section]);
  const experiencesById = new Map(snapshot.experiences.map((experience) => [experience.id, experience]));
  const station = snapshot.stations.find((item) => item.id === stationId);
  const stationExperience = station && experiencesById.get(station.experienceId);
  const ready = !snapshot.accessLocked && snapshot.stationStatus === 'ready' && snapshot.experienceStatus === 'ready';
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
    && (snapshot.stationStatus === 'ready'
      || (snapshot.stationStatus === 'error' && (snapshot.stationError === 'network' || snapshot.stationError === 'unavailable')));
  const canPollExperiences = section === 'panel'
    && store.isCurrent(snapshot.context)
    && !snapshot.accessLocked
    && ((snapshot.experienceStatus === 'error' && (snapshot.experienceError === 'network' || snapshot.experienceError === 'unavailable'))
      || snapshot.experienceError === 'stale');
  const canPollEntry = section === 'panel'
    && store.isCurrent(snapshot.context)
    && !snapshot.accessLocked
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
    section === 'station' && store.isCurrent(snapshot.context) && !snapshot.accessLocked && snapshot.queueStatus === 'ready',
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
  const accessLost = Boolean(snapshot.accessLocked)
    || [snapshot.stationError, snapshot.experienceError, snapshot.entryError]
      .some((err) => err === 'denied' || err === 'session');
  const dashboardErrors = [...new Set([
    snapshot.accessLocked ? (snapshot.accessStatus === 'session' ? 'session' : 'denied') : null,
    snapshot.stationStatus === 'error' ? snapshot.stationError : null,
    snapshot.experienceStatus === 'error' ? snapshot.experienceError : null,
    (snapshot.entryError === 'denied' || snapshot.entryError === 'session') ? snapshot.entryError : null,
  ].filter(Boolean))];
  const refresh = () => {
    void store.refreshPanel();
  };

  const eventMeta = getPhaseMeta(event);
  const entrySummary = describeEntrySummary(snapshot);
  const availableStationsCount = snapshot.stations.filter((item) => item.availability === 'available').length;
  const pendingStationsCount = snapshot.stations.filter((item) => Boolean(item.pendingServiceSessionId)).length;
  const availableText = !snapshot.accessLocked && snapshot.stationStatus === 'ready'
    ? `${availableStationsCount}/${snapshot.stations.length}`
    : '—';
  const pendingStationsText = !snapshot.accessLocked && snapshot.stationStatus === 'ready'
    ? String(pendingStationsCount)
    : '—';

  return (
    <>
      {(section === 'panel' || section === 'station') && dashboardErrors.map((kind) => (
        <View key={kind} style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.alertMessage}>{messages[kind]}</Text>
        </View>
      ))}
      {(snapshot.queueError === 'stale' || (section === 'panel' && (snapshot.stationError === 'stale' || snapshot.entryError === 'stale'))) && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>{messages.stale}</Text>
        </View>
      )}

      {section === 'panel' && (
        <>
          <View style={styles.panelTitleRow}>
            <Text style={styles.screenTitle}>Painel operacional</Text>
            <StatusPill label={phaseLabel(event)} tone={eventMeta.tone} uppercase />
          </View>

          <Text style={styles.sectionLabel}>RESUMO DO EVENTO</Text>

          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <CalendarIcon />
              <View style={styles.heroInfo}>
                <Text style={styles.heroPhaseEyebrow}>Status: {phaseLabel(event)}</Text>
                <Text style={styles.heroEventName}>{event.name}</Text>
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
            <Text style={styles.metricsHeading}>Resumo operacional</Text>

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
            disabled={accessLost}
            style={[styles.entryCard, accessLost && styles.disabled]}
            onPress={accessLost ? undefined : () => setSection('entry')}
          >
            <EntryScannerIcon />
            <View style={styles.cardBody}>
              <Text style={styles.eventName}>Controle de Entrada</Text>
              <Text style={styles.cardSubtitle}>{entrySummary.subtitle}</Text>
            </View>
            <View style={styles.entryBadges}>
              <StatusPill label={entrySummary.badgeLabel} tone={entrySummary.badgeTone} uppercase />
              {entrySummary.hasPendingCall && (
                <StatusPill label="Chamada pendente" tone="warning" uppercase />
              )}
            </View>
            <Text style={styles.chevron}>›</Text>
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
              <ActivityIndicator color="#a78bfa" />
              <Text style={styles.message}>Carregando estações...</Text>
            </View>
          )}
          {snapshot.experienceStatus === 'loading' && (
            <View style={styles.stateCard}>
              <ActivityIndicator color="#a78bfa" />
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
                      style={styles.stationCard}
                      onPress={() => {
                        setStationId(item.id);
                        setSection('station');
                        void store.refreshQueue(item.experienceId);
                      }}
                    >
                      <GamepadIcon />
                      <View style={styles.cardBody}>
                        <Text style={styles.eventName}>{item.label}</Text>
                        <Text style={styles.cardSubtitle}>
                          {hasPending ? 'Atendimento pendente nesta estação' : 'Sem atendimento pendente'}
                        </Text>
                      </View>
                      <View style={styles.entryBadges}>
                        <StatusPill
                          label={isAvailable ? 'Disponível' : 'Indisponível'}
                          tone={isAvailable ? 'success' : 'danger'}
                          uppercase
                        />
                        {hasPending && <StatusPill label="Chamado" tone="warning" uppercase />}
                      </View>
                      <Text style={styles.chevron}>›</Text>
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
                <View key={item.id} style={styles.stationCard}>
                  <GamepadIcon />
                  <View style={styles.cardBody}>
                    <Text style={styles.eventName}>{item.label}</Text>
                    <Text style={styles.cardSubtitle}>Dados da experiência indisponíveis</Text>
                  </View>
                  <StatusPill
                    label={item.availability === 'available' ? 'Disponível' : 'Indisponível'}
                    tone={item.availability === 'available' ? 'success' : 'danger'}
                    uppercase
                  />
                </View>
              ))}
            </View>
          )}

          <Button
            label="Atualizar estações"
            variant="secondary"
            disabled={snapshot.stationStatus === 'loading' || snapshot.experienceStatus === 'loading' || snapshot.entryStatus === 'loading'}
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
          onBack={() => {
            setSection('panel');
          }}
        />
      )}

      {section === 'station' && (
        <>
          {ready && station && stationExperience && (
            <>
              <Text style={styles.eventName}>{station.label}</Text>
              <Text style={styles.message}>Experiência: {stationExperience.name}</Text>
              <Text style={styles.message}>Disponibilidade: {station.availability === 'available' ? 'Disponível' : 'Indisponível'}</Text>
              <Text style={styles.message}>Atendimento pendente: {station.pendingServiceSessionId ? 'Sim' : 'Não'}</Text>
              <Text style={styles.message}>Fila compartilhada da experiência</Text>
              {snapshot.experienceId === station.experienceId && snapshot.queueStatus === 'loading' && (
                <Text style={styles.message}>Carregando fila...</Text>
              )}
              {snapshot.experienceId === station.experienceId && snapshot.queueStatus === 'error' && (
                <Text accessibilityRole="alert" style={styles.alertMessage}>{messages[snapshot.queueError]}</Text>
              )}
              {snapshot.experienceId === station.experienceId && snapshot.queueStatus === 'ready' && (
                <View style={styles.emptyCard}>
                  <Text style={styles.eventName}>Fila de {stationExperience.name}</Text>
                  <Text style={styles.message}>Pessoas em espera: {snapshot.queue.waitingCount}</Text>
                  <Text style={styles.message}>
                    Janela operacional para chamadas: {snapshot.queue.canCallWaitingEntries ? 'Aberta' : 'Fechada'}
                  </Text>
                </View>
              )}
              {snapshot.experienceId === station.experienceId && snapshot.queueStatus !== 'loading' && (
                <Button label="Atualizar fila" onPress={() => { void store.refreshQueue(); }} />
              )}
              <StaffStationOperationalScreen
                event={event}
                experience={stationExperience}
                station={station}
                isEventCurrent={() => staff.getSelected()?.id === event.id && stationId === station.id && !store.isAccessLocked()}
                onChanged={() => {
                  void (async () => {
                    await store.refreshStations();
                    await store.refreshQueue(station.experienceId);
                  })();
                }}
              />
            </>
          )}
          <Button
            label="Voltar ao painel"
            variant="secondary"
            onPress={() => {
              setStationId(null);
              setSection('panel');
            }}
          />
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
  stackContent: { backgroundColor: '#0c0a17' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, gap: 14 },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandArena: { color: '#ffffff', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  brandGo: { color: '#8B5CF6', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  rolePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6D28D9',
    backgroundColor: 'rgba(124, 58, 237, 0.16)',
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  rolePillText: { color: '#C4B5FD', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  headerBlock: { gap: 6, marginTop: 4 },
  eyebrow: { color: '#C4B5FD', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  screenTitle: { color: '#ffffff', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  description: { color: '#A5A1C2', fontSize: 15, lineHeight: 22 },
  sectionLabel: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginTop: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionCount: { color: '#C4B5FD', fontSize: 13, fontWeight: '600' },
  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#130F24',
    borderColor: '#36275E',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  heroCard: {
    backgroundColor: '#130F24',
    borderColor: '#3D2B6B',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroInfo: { flex: 1, gap: 4 },
  heroPhaseEyebrow: { color: '#A5A1C2', fontSize: 13, fontWeight: '600' },
  heroEventName: { color: '#ffffff', fontSize: 19, fontWeight: '800' },
  heroDivider: { height: 1, backgroundColor: '#271E44' },
  metricsHeading: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', alignItems: 'center' },
  metricCell: { flex: 1, alignItems: 'center', gap: 4 },
  metricDivider: { width: 1, height: 32, backgroundColor: '#271E44' },
  metricValue: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  metricLabel: { color: '#A5A1C2', fontSize: 12, textAlign: 'center' },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#130F24',
    borderColor: '#36275E',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  entryBadges: { alignItems: 'flex-end', gap: 6 },
  stationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#110E20',
    borderColor: '#2B204A',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  eventName: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#A5A1C2', fontSize: 13, lineHeight: 18 },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  eventStatusText: { color: '#D1CDE8', fontSize: 13, fontWeight: '500' },
  chevron: { color: '#A78BFA', fontSize: 22, fontWeight: '600', paddingLeft: 2 },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  uppercase: { textTransform: 'uppercase' },
  experienceGroup: { gap: 10 },
  experienceGroupTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginTop: 2 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#241744',
    borderWidth: 1,
    borderColor: '#3F2A75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarPins: { flexDirection: 'row', gap: 8, marginBottom: 1 },
  calendarPin: { width: 2, height: 4, borderRadius: 1, backgroundColor: '#C4B5FD' },
  calendarFrame: {
    width: 18,
    height: 15,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#C4B5FD',
    overflow: 'hidden',
  },
  calendarHeaderBar: { height: 4, backgroundColor: '#C4B5FD' },
  calendarDotsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 2,
  },
  calendarDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#C4B5FD' },
  scannerFrame: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#C4B5FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerLine: { width: 10, height: 2, backgroundColor: '#C4B5FD', borderRadius: 1 },
  stationIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1B1433',
    borderWidth: 1,
    borderColor: '#322459',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gamepadBody: {
    width: 24,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#C4B5FD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  gamepadPlus: { color: '#C4B5FD', fontSize: 10, fontWeight: '800', lineHeight: 11 },
  gamepadDots: { flexDirection: 'row', gap: 2 },
  gamepadDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#C4B5FD' },
  stateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#130F24',
    borderColor: '#2D214C',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  emptyCard: {
    backgroundColor: '#130F24',
    borderColor: '#2D214C',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    borderColor: '#991B1B',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  warningCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: '#B45309',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  message: { color: '#CBD5E1', fontSize: 14, lineHeight: 20 },
  alertMessage: { color: '#FECACA', fontSize: 14, lineHeight: 20 },
  warningMessage: { color: '#FDE68A', fontSize: 13, lineHeight: 19 },
  helperNote: { color: '#94A3B8', fontSize: 13, lineHeight: 19 },
  button: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#17122B',
    borderWidth: 1,
    borderColor: '#4C3384',
  },
  disabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  buttonSecondaryText: { color: '#E9D5FF' },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  backLinkArrow: { color: '#E2E8F0', fontSize: 16, fontWeight: '700' },
  backLinkText: { color: '#E2E8F0', fontSize: 14, fontWeight: '600' },
  footerSpacer: { marginTop: 'auto', paddingTop: 16 },
  logoutLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingVertical: 8,
  },
  logoutArrow: { color: '#E2E8F0', fontSize: 16, fontWeight: '700' },
  logoutText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
