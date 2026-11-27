import { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { formatAdminDate } from '../../services/adminEventsService';
import { getAdminHistorySummary } from '../../services/adminHistoryService';
import { AdminBiRanking, AdminBiRatings, formatBiRating } from './components/AdminBiResults';
import AdminButton from './components/AdminButton';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
import { HistoryBadge, HistoryHeading, HistoryMetric, historyStyles as hs } from './components/AdminHistoryUI';
import { AdminIcon, liveColors as c, liveStyles as s } from './components/AdminLiveUI';
import useAdminHistory from './useAdminHistory';

const number = new Intl.NumberFormat('pt-BR');
function duration(seconds) {
  if (seconds === null) return 'Sem dados';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  return hours ? `${hours} h ${minutes} min` : minutes ? `${minutes} min` : `${total} s`;
}

export function scheduledDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  if (!days) return duration(seconds);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = Math.floor(seconds % 60);
  return [`${days} ${days === 1 ? 'dia' : 'dias'}`, hours ? `${hours} h` : '',
    minutes ? `${minutes} min` : '', remainder ? `${remainder} s` : ''].filter(Boolean).join(' ');
}

export default function AdminHistorySummaryScreen({ navigation, route }) {
  const eventId = route?.params?.eventId;
  const read = useMemo(() => client => getAdminHistorySummary(client, eventId), [eventId]);
  const state = useAdminHistory(navigation, read);
  const data = state.data;
  const event = data?.event;
  const metrics = data && [
    ['users', 'Participações registradas', number.format(data.overview.participations)],
    ['star', 'Avaliações enviadas', number.format(data.ratings.count)],
    ['star', 'Nota média', formatBiRating(data.ratings.mean)],
    ['layers', 'Atendimentos concluídos', number.format(data.overview.completed)],
  ];
  return <AdminLiveScreen title={event?.name ?? 'Resumo do evento'} eyebrow={event ? 'EVENTO ENCERRADO' : 'HISTÓRICO'}
    subtitle={event ? 'Resumo do evento' : undefined} titleAccessory={event ? <HistoryBadge /> : undefined}
    navigation={navigation} backLabel="Voltar ao Histórico" onBack={() => navigation.goBack()} showTabs activeTab="Histórico" historyHeader
    refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={state.refresh} tintColor={c.accent} />}>
    {state.pending && <AdminNotice title="Carregando resumo..." />}
    {state.error && <AdminNotice tone="error" title={state.stale ? 'Dados desatualizados' : 'Resumo indisponível'} message={state.error}>
      <AdminButton label="Tentar novamente" onPress={state.retry} />
    </AdminNotice>}
    {data && <>
      <View style={[hs.panel, styles.timing]}>
        <View style={styles.timeItem}>
          <AdminIcon name="calendar" size={20} />
          <View style={s.grow}>
            <Text style={hs.copy}>Início: {formatAdminDate(event.startsAt, event.timezone)}</Text>
            <Text style={hs.copy}>Término oficial: {formatAdminDate(event.officialEndsAt, event.timezone)}</Text>
            <Text style={hs.copy}>Encerramento {event.closedEarly ? 'antecipado' : 'efetivo'}: {formatAdminDate(event.closedAt, event.timezone)}</Text>
          </View>
        </View>
        <View style={styles.scheduled}>
          <AdminIcon name="history" size={20} />
          <View style={s.grow}><Text style={hs.copy}>Duração programada</Text>
            <Text style={hs.title}>{scheduledDuration(event.scheduledDurationSeconds)}</Text></View>
        </View>
      </View>
      <View style={hs.panel}>
        <HistoryHeading icon="chart">Resumo geral</HistoryHeading>
        <View style={styles.grid}>{metrics.map(([icon, label, value, detail]) =>
          <HistoryMetric key={label} icon={icon} label={label} value={value} detail={detail} centered style={styles.summaryMetric} />)}
        </View>
        <View style={[hs.tile, styles.indicator]} accessible
          accessibilityLabel={`Tempo até a última experiência concluída: ${duration(data.durationA.meanSeconds)}. Indicador A, ${number.format(data.durationA.population)} participações elegíveis`}>
          <HistoryHeading icon="history">Tempo até a última experiência concluída</HistoryHeading>
          <Text style={styles.indicatorValue}>{duration(data.durationA.meanSeconds)}</Text>
          <Text style={hs.copy}>Indicador A · {number.format(data.durationA.population)} participações elegíveis</Text>
        </View>
        {data.overview.participations === 0 && <Text style={[hs.copy, styles.empty]}>Evento sem participações</Text>}
      </View>
      <AdminBiRanking ranking={data.ranking} title="Experiências concluídas" compact />
      <AdminBiRatings ratings={data.ratings} compact />
      <View style={hs.panel}>
        <HistoryHeading icon="comment">Comentários</HistoryHeading>
        <Text style={hs.copy}>Visualização pendente de aprovação da política de privacidade.</Text>
      </View>
      <View style={hs.panel}>
        <HistoryHeading icon="users">Perfil do público indisponível</HistoryHeading>
        <View style={styles.grid}>
          <View style={[hs.tile, styles.audience]}><Text style={hs.title}>Faixa etária</Text>
            <Text style={hs.copy}>Indisponível por falta de histórico adequado.</Text></View>
          <View style={[hs.tile, styles.audience]}><Text style={hs.title}>Gênero</Text>
            <Text style={hs.copy}>Divulgação pendente de aprovação da política de privacidade.</Text></View>
        </View>
      </View>
    </>}
    <AdminButton label={state.refreshing ? 'Atualizando resumo...' : 'Atualizar resumo'}
      variant="ghost" compact disabled={Boolean(state.pending || state.refreshing)} onPress={state.refresh} />
  </AdminLiveScreen>;
}

const styles = StyleSheet.create({
  timing: { gap: 12, marginTop: 0 },
  timeItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  scheduled: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, borderTopColor: '#503463', paddingTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryMetric: { flexBasis: '46%', minWidth: 130 },
  indicator: { marginTop: 8, padding: 12, gap: 6 },
  indicatorValue: { color: c.text, fontSize: 26, fontWeight: '700' },
  audience: { flexGrow: 1, flexBasis: '46%', minWidth: 126, gap: 4 },
  empty: { marginTop: 8 },
});
