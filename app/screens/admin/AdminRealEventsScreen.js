import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import useAdminEvents from './useAdminEvents';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminButton from './components/AdminButton';
import AdminNotice from './components/AdminNotice';
import AdminEventSummary from './components/AdminEventSummary';
import { AdminIcon, AdminEventActions, liveColors as c, liveStyles as s } from './components/AdminLiveUI';
const filters = [{ value: 'all', label: 'Todos' }, { value: 'scheduled', label: 'Agendados' }, { value: 'open', label: 'Abertos' }, { value: 'closing', label: 'Encerrando' }];

export default function AdminRealEventsScreen({ navigation }) {
  const [search, setSearch] = useState(''), [phase, setPhase] = useState('all');
  const { items, status, error, nextCursor, loader } = useAdminEvents(search, phase);
  useEffect(() => navigation.addListener('focus', () => { void loader.setFilters({ search, phase }); }),
    [navigation, loader, search, phase]);
  return <AdminLiveScreen title="Gerenciar Eventos" subtitle="Consulte, busque e gerencie os eventos da plataforma."
    navigation={navigation} backLabel="Voltar para Home" onBack={() => navigation.popTo('AdminTabs', { screen: 'Home' })} showTabs>
    <AdminEventActions onCreate={() => navigation.navigate('AdminEventSetup', { origin: 'events' })} />
    <View style={styles.search}>
      <AdminIcon name="search" color={c.muted} />
      <TextInput accessibilityLabel="Pesquisar por nome ou código" placeholder="Pesquisar por nome ou código"
        placeholderTextColor={c.muted} value={search} onChangeText={value => setSearch(value.slice(0, 180))}
        autoCapitalize="none" autoCorrect={false} maxLength={180} returnKeyType="search" style={styles.input} />
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
      {filters.map(filter => <Pressable key={filter.value} accessibilityRole="button" accessibilityLabel={filter.label}
        accessibilityState={{ selected: phase === filter.value }} onPress={() => setPhase(filter.value)}
        style={({ pressed }) => [styles.chip, phase === filter.value && styles.selected, pressed && { opacity: 0.75 }]}>
        <Text style={styles.chipText}>{filter.label}</Text>
      </Pressable>)}
    </ScrollView>
    <Text style={styles.section}>EVENTOS CADASTRADOS</Text>
    {status === 'loading' ? <AdminNotice title="Carregando eventos..." /> : null}
    {error ? <AdminNotice tone="error" title="Não foi possível carregar" message={error}>
      <AdminButton label="Tentar novamente" onPress={() => { void loader.retry(); }} />
    </AdminNotice> : null}
    {status === 'ready' && !items.length ? <AdminNotice title="Nenhum evento encontrado" message="Ajuste a busca ou o filtro." /> : null}
    {items.map(event => <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`Acessar evento ${event.name}`}
      onPress={() => navigation.navigate('AdminRealEvent', { eventId: event.id })}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.75 }]}>
      <AdminEventSummary event={event} compact />
    </Pressable>)}
    {nextCursor ? <AdminButton label="Carregar mais" loading={status === 'loadingMore'} disabled={status === 'error'} onPress={() => { void loader.more(); }} /> : null}
  </AdminLiveScreen>;
}
const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.border, borderRadius: 16, backgroundColor: c.surface, paddingHorizontal: 14, marginVertical: 14 },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 12, color: c.text, fontSize: 15 },
  filters: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
  chip: { borderRadius: 24, borderWidth: 1, borderColor: c.border, paddingHorizontal: 18, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  selected: { backgroundColor: c.accentStrong }, chipText: { color: c.text, fontSize: 14, fontWeight: '600' },
  section: { color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.6, marginTop: 20, marginBottom: 2 },
});
