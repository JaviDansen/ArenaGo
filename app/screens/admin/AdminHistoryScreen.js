import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

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
import { ADMIN_CLOSURE_LABELS, listHistory } from './adminInsights';
import { adminBiPeriods } from '../../data/adminDemoData';
import { formatInstant } from './adminTime';

const PERIODS = adminBiPeriods.map((item) => ({
  value: item.id,
  label: item.label,
  accessibilityLabel: `Período: ${item.label}`,
}));

// Histórico (ADM03): eventos efetivamente encerrados no estado atual da
// demonstração (inclui os encerrados na própria sessão), com busca e período.
export default function AdminHistoryScreen({ navigation }) {
  const { session, simulateLoad } = useAdminDemo();
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('all');
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

  const items = status === 'ready' ? listHistory(session, { query, period }) : [];
  const hasAny = status === 'ready' && listHistory(session).length > 0;

  return (
    <AdminScreen
      title="Histórico"
      highlight="de Eventos"
      subtitle="Eventos encerrados e seus resultados agregados da demonstração."
      backLabel="Painel"
      onBack={() => navigation.goBack()}
    >
      <AdminNotice
        tone="warning"
        title="Resultados fictícios"
        message="Os números desta área são simulados para a demonstração. Não são resultados reais de nenhum evento."
      />

      <AdminField
        label="Buscar no histórico"
        hint="Por nome ou código de ingresso."
        value={query}
        onChangeText={setQuery}
        placeholder="Ex.: SUMMER"
        autoCapitalize="none"
      />
      <AdminOptions label="Período (início do evento)" options={PERIODS} value={period} onChange={setPeriod} />

      {status === 'loading' ? (
        <AdminNotice tone="neutral" title="Carregando histórico..." message="Carregamento simulado da demonstração." />
      ) : null}

      {status === 'error' ? (
        <AdminNotice tone="error" title="Não foi possível carregar" message={loadError}>
          <AdminButton compact variant="secondary" label="Tentar novamente" onPress={() => setAttempt((n) => n + 1)} />
        </AdminNotice>
      ) : null}

      {status === 'ready' && !hasAny ? (
        <AdminNotice tone="neutral" title="Nenhum evento encerrado" message="Quando um evento for encerrado, ele aparecerá aqui." />
      ) : null}

      {status === 'ready' && hasAny && items.length === 0 ? (
        <AdminNotice tone="neutral" title="Nenhum evento encontrado" message="Ajuste a busca ou o período." />
      ) : null}

      {items.map((item) => (
        <AdminCard
          key={item.event.id}
          onPress={() => navigation.navigate('AdminEventBi', { eventId: item.event.id })}
          accessibilityLabel={`Abrir BI de ${item.event.name}, código ${item.event.accessCode}`}
        >
          <Text style={styles.name}>{item.event.name}</Text>
          <Text style={styles.code}>Código: {item.event.accessCode}</Text>
          <AdminPhaseBadge phase={item.info.phase} />
          <Text style={styles.line}>{ADMIN_CLOSURE_LABELS[item.closureKind]}</Text>
          <Text style={styles.line}>
            {formatInstant(item.event.startsAt, item.event.timezone)} → encerrado em {formatInstant(item.closedAt, item.event.timezone)}
          </Text>
          <Text style={styles.line}>Fuso: {item.event.timezone}</Text>
          <Text style={styles.value}>
            {item.participations.finished} participação(ões) finalizada(s) (simulado)
          </Text>
          {item.participations.adminFinalized > 0 ? (
            <Text style={styles.note}>
              {item.participations.adminFinalized} delas finalizada(s) pelo encerramento administrativo.
            </Text>
          ) : null}
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
  value: { color: adminColors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  note: { color: adminColors.warning, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
