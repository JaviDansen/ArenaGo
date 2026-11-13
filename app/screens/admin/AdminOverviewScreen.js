import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { adminBiPeriods } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminDemoTools from './components/AdminDemoTools';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminOptions from './components/AdminOptions';
import AdminRatings, { AdminDuration } from './components/AdminRatings';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { waitAdminDemoLatency } from './adminDemoLatency';
import { getOverview, listPeriodEvents } from './adminInsights';

const PERIODS = adminBiPeriods.map((item) => ({
  value: item.id,
  label: item.label,
  accessibilityLabel: `Período: ${item.label}`,
}));

function Tile({ label, value }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

// Visão Geral / BI consolidado (ADM03). Mesma sessão das ADM01–ADM02:
// período (início do evento até o relógio de teste) e seleção de eventos
// (nenhum marcado = todos do período). Só agregados (D10).
export default function AdminOverviewScreen({ navigation }) {
  const { session, simulateLoad } = useAdminDemo();
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState('all');
  const [selected, setSelected] = useState([]);
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

  const periodEvents = listPeriodEvents(session, period);
  // Seleção fora do período é ignorada (sem estado paralelo de eventos).
  const activeSelection = selected.filter((id) => periodEvents.some((event) => event.id === id));
  const overview = status === 'ready' ? getOverview(session, { period, eventIds: activeSelection }) : null;

  function toggle(eventId) {
    setSelected((current) => (current.includes(eventId)
      ? current.filter((id) => id !== eventId)
      : [...current, eventId]));
  }

  return (
    <AdminScreen
      title="Visão"
      highlight="Geral"
      subtitle="BI consolidado da demonstração da plataforma."
      backLabel="Painel"
      onBack={() => navigation.goBack()}
    >
      <AdminNotice
        tone="warning"
        title="Indicadores fictícios"
        message="Calculados a partir dos dados simulados desta sessão e do relógio de teste. Nenhum resultado real é exibido."
      />

      <AdminOptions
        label="Período"
        hint="Considera a data de início do evento até o relógio da demonstração. Todo o período inclui eventos futuros."
        options={PERIODS}
        value={period}
        onChange={setPeriod}
      />

      <Text style={styles.label}>Eventos</Text>
      <Text style={styles.hint}>Nenhum marcado = todos os eventos do período.</Text>
      <View style={styles.wrap}>
        {periodEvents.map((event) => (
          <View key={event.id} style={styles.item}>
            <AdminButton
              compact
              multiple
              variant="secondary"
              label={event.accessCode}
              accessibilityLabel={`Selecionar ${event.name}`}
              selected={activeSelection.includes(event.id)}
              onPress={() => toggle(event.id)}
            />
          </View>
        ))}
      </View>
      {activeSelection.length > 0 ? (
        <AdminButton compact variant="ghost" label="Limpar seleção (todos)" onPress={() => setSelected([])} />
      ) : null}
      {activeSelection.length === 1 ? (
        <AdminButton
          label="Abrir BI do evento selecionado"
          onPress={() => navigation.navigate('AdminEventBi', { eventId: activeSelection[0] })}
        />
      ) : null}

      {status === 'loading' ? (
        <AdminNotice tone="neutral" title="Carregando indicadores..." message="Carregamento simulado da demonstração." />
      ) : null}

      {status === 'error' ? (
        <AdminNotice tone="error" title="Não foi possível carregar" message={loadError}>
          <AdminButton compact variant="secondary" label="Tentar novamente" onPress={() => setAttempt((n) => n + 1)} />
        </AdminNotice>
      ) : null}

      {overview && overview.empty ? (
        <AdminNotice tone="neutral" title="Nenhum evento no período" message="Escolha outro período para ver indicadores." />
      ) : null}

      {overview && overview.insufficient ? (
        <AdminNotice
          tone="info"
          title="Dados insuficientes"
          message="Os eventos escolhidos ainda não têm participações, atendimentos nem avaliações."
        />
      ) : null}

      {overview && !overview.empty ? (
        <>
          <Text style={styles.scope}>
            {overview.period.label} · {overview.events.length} evento(s) {activeSelection.length > 0 ? 'selecionado(s)' : 'no período'}
          </Text>

          <Text style={styles.heading} accessibilityRole="header">Eventos por fase</Text>
          <View style={styles.grid}>
            <Tile label="Eventos" value={overview.phases.total} />
            <Tile label="Agendados" value={overview.phases.scheduled} />
            <Tile label="Abertos" value={overview.phases.open} />
            <Tile label="Encerrando" value={overview.phases.closing} />
            <Tile label="Encerrados" value={overview.phases.closed} />
            <Tile label="Não prontos" value={overview.phases.notReady} />
          </View>

          <Text style={styles.heading} accessibilityRole="header">Participações (estado atual)</Text>
          <View style={styles.grid}>
            <Tile label="Registradas" value={overview.participations.registered} />
            <Tile label="Ativas" value={overview.participations.active} />
            <Tile label="Na fila externa" value={overview.participations.externalWaiting} />
            <Tile label="Finalizadas" value={overview.participations.finished} />
          </View>
          <Text style={styles.note}>
            {overview.participations.adminFinalized} das finalizadas foram finalizadas pelo encerramento administrativo
            (não contam como experiência concluída nem avaliação).
          </Text>

          <Text style={styles.heading} accessibilityRole="header">Experiências e estações</Text>
          <View style={styles.grid}>
            <Tile label="Atendimentos concluídos" value={overview.completions.completed} />
            <Tile label="Ausências marcadas" value={overview.completions.absences} />
            <Tile label="Estações com atendimento" value={`${overview.completions.stationsWithCompletions}/${overview.completions.stations}`} />
          </View>
          <AdminCard>
            <Text style={styles.cardTitle}>Experiências mais utilizadas</Text>
            {overview.topExperiences.length === 0 ? (
              <Text style={styles.line}>Sem atendimentos registrados nos eventos escolhidos.</Text>
            ) : overview.topExperiences.map((item, index) => (
              <Text key={item.id} style={styles.line}>
                {index + 1}. {item.name} ({item.eventName}): {item.completed} atendimento(s)
              </Text>
            ))}
          </AdminCard>

          <Text style={styles.heading} accessibilityRole="header">Avaliações</Text>
          <AdminCard>
            <Text style={styles.line}>
              Participações finalizadas fora do encerramento administrativo: {overview.participations.finishedOutsideAdmin}
            </Text>
            <AdminRatings summary={overview.evaluations} />
          </AdminCard>

          <Text style={styles.heading} accessibilityRole="header">Tempo</Text>
          <AdminCard>
            <AdminDuration label="Entrada até a última experiência concluída" summary={overview.time.lastCompletion} population="participação(ões) com experiência concluída" />
            <AdminDuration label="Entrada até a saída voluntária" summary={overview.time.voluntaryExit} population="saída(s) voluntária(s)" />
          </AdminCard>
        </>
      ) : null}

      <Text style={styles.heading} accessibilityRole="header">Exportação</Text>
      <AdminButton
        variant="secondary"
        label="Exportar CSV/XLSX (indisponível)"
        disabled
        onPress={() => {}}
        accessibilityHint="Exportação ainda não especificada"
      />
      <Text style={styles.note}>
        A exportação manual por download está prevista (RA-01), mas formatos, filtros e permissões ainda não foram
        aprovados. Nenhum arquivo é gerado nesta demonstração.
      </Text>

      <AdminNotice
        tone="neutral"
        title="Privacidade (D10)"
        message="Só números agregados: nenhum participante é identificado. Perfil do público indisponível até haver política aprovada."
      />

      <AdminDemoTools />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  heading: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  label: { color: adminColors.text, fontSize: 14, fontWeight: 'bold', marginTop: 16 },
  hint: { color: adminColors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  item: { paddingHorizontal: 4 },
  scope: { color: adminColors.accent, fontSize: 13, fontWeight: '600', marginTop: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 6 },
  tile: {
    backgroundColor: adminColors.surface,
    borderColor: adminColors.border,
    borderRadius: 12,
    borderWidth: 1,
    margin: 6,
    padding: 12,
    width: '45%',
  },
  tileValue: { color: adminColors.text, fontSize: 22, fontWeight: 'bold' },
  tileLabel: { color: adminColors.muted, fontSize: 12, marginTop: 2 },
  cardTitle: { color: adminColors.text, fontSize: 15, fontWeight: 'bold' },
  line: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  note: { color: adminColors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
});
