import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatAdminDate } from '../../services/adminEventsService';
import { listAdminHistory } from '../../services/adminHistoryService';
import AdminButton from './components/AdminButton';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
import { HistoryBadge, HistoryMetric, historyStyles as hs } from './components/AdminHistoryUI';
import { AdminIcon, AdminIconTile, liveColors as c, liveStyles as s } from './components/AdminLiveUI';
import useAdminHistory from './useAdminHistory';

const periods = [['all', 'Todo o período'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']];
const number = new Intl.NumberFormat('pt-BR');
const rating = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function AdminRealHistoryScreen({ navigation }) {
  const [search, setSearch] = useState('');
  const [settled, setSettled] = useState('');
  const [period, setPeriod] = useState('all');
  const [filterWidth, setFilterWidth] = useState(0);
  const term = search.trim();
  const waiting = settled !== term;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setSettled(term), 300);
    return () => clearTimeout(timer);
  }, [term, waiting]);
  const read = useMemo(() => waiting ? null :
    (client, cursor) => listAdminHistory(client, { search: settled, period, cursor }), [settled, period, waiting]);
  const state = useAdminHistory(navigation, read, true);
  const items = waiting ? null : state.data;

  return <AdminLiveScreen title="Histórico de eventos" subtitle="Consulte eventos encerrados e seus resultados agregados."
    navigation={navigation} mode="tab" historyHeader
    refreshControl={<RefreshControl refreshing={!waiting && Boolean(state.refreshing)} onRefresh={() => !waiting && state.refresh()} tintColor={c.accent} />}>
    <View style={styles.notice}><AdminIcon name="info" size={20} />
      <Text style={[hs.copy, s.grow]}>Somente eventos encerrados aparecem aqui.</Text>
    </View>
    <View style={styles.search}>
      <AdminIcon name="search" color={c.muted} />
      <TextInput accessibilityLabel="Pesquisar por nome ou código" placeholder="Nome ou código do evento"
        placeholderTextColor={c.muted} value={search} onChangeText={setSearch} maxLength={180}
        autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.input} />
    </View>
    <View style={styles.filters} onLayout={event => setFilterWidth(event.nativeEvent.layout.width)}>{periods.map(([value, label]) =>
      <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: period === value }}
        onPress={() => setPeriod(value)} style={[styles.filter, filterWidth >= 640 && styles.wideFilter, value === period && styles.selected]}>
        <Text style={[styles.filterText, value === period && styles.selectedText]}>{label}</Text>
      </Pressable>)}</View>
    <AdminButton label={state.refreshing && !waiting ? 'Atualizando histórico...' : 'Atualizar histórico'}
      variant="ghost" compact disabled={waiting || Boolean(state.pending || state.refreshing || state.loadingMore)} onPress={state.refresh} />
    {(waiting || state.pending) && <AdminNotice title="Carregando histórico..." />}
    {!waiting && state.error && <AdminNotice tone="error" title={state.stale ? 'Dados desatualizados' : 'Histórico indisponível'} message={state.error}>
      <AdminButton label="Tentar novamente" onPress={state.retry} />
    </AdminNotice>}
    {items?.length === 0 && !state.error && !state.refreshing && <AdminNotice title={settled ? 'Nenhum resultado para a pesquisa' :
      period === 'all' ? 'Nenhum evento encerrado' : 'Nenhum evento encerrado no período'} />}
    {items?.map(event => <HistoryCard key={event.id} event={event}
      onOpen={() => navigation.navigate('AdminHistorySummary', { eventId: event.id })} />)}
    {!waiting && state.nextCursor && <AdminButton label="Carregar mais" loading={Boolean(state.loadingMore)}
      disabled={Boolean(state.error || state.refreshing)} onPress={state.more} />}
  </AdminLiveScreen>;
}

function HistoryCard({ event, onOpen }) {
  const date = value => formatAdminDate(value, event.timezone);
  return <View style={hs.panel}>
    <View style={styles.cardHeader}>
      <AdminIconTile name="calendar" />
      <View style={s.grow}>
        <View style={styles.cardTitle}>
          <Text style={hs.title}>{event.name}</Text><HistoryBadge />
        </View>
        <Text style={hs.copy}>Início: {date(event.startsAt)}</Text>
        <Text style={hs.copy}>Término oficial: {date(event.officialEndsAt)}</Text>
        <Text style={hs.copy}>Encerrado em {date(event.closedAt)}</Text>
      </View>
    </View>
    <View style={styles.metrics}>
      <HistoryMetric centered icon="users" label="Participações" value={number.format(event.participations)} />
      <HistoryMetric centered icon="star" label="Avaliações" value={number.format(event.evaluationCount)} />
      <HistoryMetric centered icon="star" label="Nota média"
        accessibilityLabel={event.evaluationMean === null ? 'Nota média indisponível: sem avaliações' : `Nota média: ${rating.format(event.evaluationMean)}`}
        value={event.evaluationMean === null ? '—' : rating.format(event.evaluationMean)} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Ver resumo" onPress={onOpen}
      style={({ pressed }) => [hs.tile, styles.open, pressed && styles.pressed]}>
      <Text style={styles.openText}>Ver resumo</Text><AdminIcon name="chevron" size={18} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1c1030',
    borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 11 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.border,
    borderRadius: 16, backgroundColor: c.surface, paddingHorizontal: 14, marginVertical: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 52, color: c.text, fontSize: 15 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  filter: { flexGrow: 1, flexBasis: '46%', minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 14,
    borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6, borderColor: '#795395', backgroundColor: c.surface },
  filterText: { color: c.muted, fontSize: 13, textAlign: 'center' },
  wideFilter: { flexBasis: '22%' },
  selected: { backgroundColor: c.accentStrong, borderColor: c.border },
  selectedText: { color: c.text, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginBottom: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 10 },
  open: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  openText: { color: c.text, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
