import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { adminPhaseLabels } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminDemoTools from './components/AdminDemoTools';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminOptions from './components/AdminOptions';
import AdminPhaseBadge from './components/AdminPhaseBadge';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { waitAdminDemoLatency } from './adminDemoLatency';
import { listEvents, phaseText } from './adminDemoState';
import { formatInstant } from './adminTime';

const FILTERS = [
  { value: 'all', label: 'Todos' },
  ...['scheduled', 'open', 'closing', 'closed'].map((phase) => ({
    value: phase,
    label: adminPhaseLabels[phase],
    accessibilityLabel: `Filtrar por ${adminPhaseLabels[phase]} (${phase})`,
  })),
];

// Gerenciar Eventos (ADM01): carregamento simulado, busca, filtros pelas
// quatro fases efetivas e cartões que levam ao detalhe.
export default function AdminEventsScreen({ navigation }) {
  const { session, simulateLoad } = useAdminDemo();
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('all');
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    waitAdminDemoLatency().then(() => {
      if (!active || !mountedRef.current) return;
      const result = simulateLoad();
      setLoadError(result.ok ? '' : result.message);
      setStatus(result.ok ? 'ready' : 'error');
    });
    return () => { active = false; };
  }, [attempt]);

  if (!session) {
    return (
      <AdminMissing
        title="Sessão indisponível"
        message="Abra a Área Admin novamente a partir do aplicativo."
        actionLabel="VOLTAR"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const items = status === 'ready' ? listEvents(session, { query, phase }) : [];

  return (
    <AdminScreen
      title="Gerenciar"
      highlight="Eventos"
      subtitle="Visualize, crie e acompanhe os eventos da demonstração."
      backLabel="Painel"
      onBack={() => navigation.goBack()}
    >
      <AdminButton label="+ Criar novo evento" onPress={() => navigation.navigate('AdminCreateEvent')} />

      <AdminField
        label="Buscar evento"
        hint="Por nome ou código de ingresso."
        value={query}
        onChangeText={setQuery}
        placeholder="Ex.: BEAST ou ARENA-XP"
        autoCapitalize="none"
      />
      <AdminOptions label="Fase" options={FILTERS} value={phase} onChange={setPhase} />

      {status === 'loading' ? (
        <AdminNotice tone="neutral" title="Carregando eventos..." message="Carregamento simulado da demonstração." />
      ) : null}

      {status === 'error' ? (
        <AdminNotice tone="error" title="Não foi possível carregar" message={loadError}>
          <AdminButton compact variant="secondary" label="Tentar novamente" onPress={() => setAttempt((n) => n + 1)} />
        </AdminNotice>
      ) : null}

      {status === 'ready' && items.length === 0 ? (
        <AdminNotice tone="neutral" title="Nenhum evento encontrado" message="Ajuste a busca ou o filtro de fase." />
      ) : null}

      {items.map(({ event, info }) => (
        <AdminCard
          key={event.id}
          onPress={() => navigation.navigate('AdminEventDetail', { eventId: event.id })}
          accessibilityLabel={`Abrir ${event.name}, código ${event.accessCode}, ${adminPhaseLabels[info.phase]}`}
        >
          <Text style={styles.name}>{event.name}</Text>
          <Text style={styles.code}>Código: {event.accessCode}</Text>
          <AdminPhaseBadge phase={info.phase} waitingReadiness={info.waitingReadiness} />
          <Text style={styles.line}>
            {formatInstant(event.startsAt, event.timezone)} → {formatInstant(event.officialEndsAt, event.timezone)}
          </Text>
          <Text style={styles.line}>Fuso: {event.timezone}</Text>
          {info.statusStored !== info.phase ? (
            <Text style={styles.stale}>
              Status armazenado: {phaseText(info.statusStored)} · fase efetiva pelo relógio: {phaseText(info.phase)}
            </Text>
          ) : null}
          <Text style={info.readiness.ready ? styles.ready : styles.notReady}>
            {info.readiness.ready ? '✓ Pronto' : `✗ Não pronto (${info.readiness.missing.length} pendência(s))`}
          </Text>
        </AdminCard>
      ))}

      <AdminDemoTools />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  name: { color: adminColors.text, fontSize: 16, fontWeight: 'bold' },
  code: { color: adminColors.accent, fontSize: 13, fontWeight: '600', marginTop: 2 },
  line: { color: adminColors.muted, fontSize: 13, marginTop: 6 },
  stale: { color: adminColors.warning, fontSize: 12, lineHeight: 17, marginTop: 6 },
  ready: { color: adminColors.success, fontSize: 13, fontWeight: '600', marginTop: 6 },
  notReady: { color: adminColors.warning, fontSize: 13, fontWeight: '600', marginTop: 6 },
});
