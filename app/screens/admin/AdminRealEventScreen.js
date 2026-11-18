import { useContext, useState } from 'react';
import { Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { adminEventAreas } from './adminEventManagement';
import { AdminSetupIntents } from './adminSetupIntents';
import useAdminEventPanel from './useAdminEventPanel';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminSelectedEvent from './components/AdminSelectedEvent';
import AdminNotice from './components/AdminNotice';
import AdminButton from './components/AdminButton';
import { AdminIcon, AdminIconTile, liveColors as c, liveStyles as s } from './components/AdminLiveUI';

export default function AdminRealEventScreen({ navigation, route }) {
  const eventId = route.params?.eventId;
  const structureIntents = useContext(AdminSetupIntents);
  const { event, readiness, pending, refreshing, blocked, detailError, readinessError, refresh } = useAdminEventPanel(navigation, eventId);
  const [expandedReadiness, setExpandedReadiness] = useState(null);
  const expanded = Boolean(readiness && expandedReadiness === readiness);
  const openArea = area => navigation.navigate('AdminEventManagementInfo', { eventId: event.id, area });

  return <AdminLiveScreen title="Painel do evento" subtitle="Gerencie as configurações e a operação deste evento."
    navigation={navigation} backLabel="Voltar aos eventos" onBack={() => navigation.popTo('AdminEvents')} showTabs
    refreshControl={<RefreshControl refreshing={Boolean(refreshing)} onRefresh={() => refresh(true)}
      tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
    {pending && <AdminNotice title="Carregando evento..." />}
    {(event || readiness) && <AdminSelectedEvent event={event} readiness={readiness} expanded={expanded}
      onToggle={() => setExpandedReadiness(expanded ? null : readiness)} onArea={event ? openArea : undefined} />}
    {(blocked || detailError || readinessError) && <AdminNotice tone="error"
      title={blocked || detailError ? 'Evento indisponível' : 'Prontidão indisponível'}
      message={[blocked || detailError, readinessError].filter(Boolean).join('\n')}>
      <AdminButton label="Tentar novamente" onPress={() => refresh()} />
    </AdminNotice>}
    {event && <>
      {((readiness && !readiness.ready) || structureIntents?.has?.(event.id)) &&
        !['closed', 'closing'].includes(readiness?.effectivePhase ?? event.effectivePhase) &&
        <AdminButton label="Continuar configuração" variant="secondary"
          onPress={() => navigation.navigate('AdminEventSetup', { eventId: event.id })} />}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>GERENCIAMENTO</Text>
        {Platform.OS === 'web' && <Pressable accessibilityRole="button" accessibilityLabel="Atualizar evento" onPress={() => refresh(true)} style={styles.refresh}>
          <Text style={styles.refreshText}>Atualizar</Text>
        </Pressable>}
      </View>
      {Object.entries(adminEventAreas).map(([key, area]) => <Pressable key={key} testID={`admin-event-area-${key}`}
        accessibilityRole="button" accessibilityLabel={area.title}
        accessibilityHint={key === 'schedule' ? 'Abre os dados e os horários do evento' : 'Abre uma visão informativa'}
        onPress={() => openArea(key)} style={({ pressed }) => [s.card, s.row, styles.area, pressed && styles.pressed]}>
        <AdminIconTile name={area.icon} />
        <View style={s.grow}><Text style={styles.areaTitle}>{area.title}</Text><Text style={s.body}>{area.description}</Text></View>
        <AdminIcon name="chevron" color={c.muted} size={18} />
      </Pressable>)}
    </>}
  </AdminLiveScreen>;
}

const styles = StyleSheet.create({
  section: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 24, marginBottom: 2 },
  sectionTitle: { color: c.muted, fontSize: 13, fontWeight: '700', letterSpacing: 1.3 },
  refresh: { minHeight: 44, justifyContent: 'center' },
  refreshText: { color: '#ddc4f2', fontWeight: '600' },
  area: { marginTop: 10 },
  areaTitle: { color: c.text, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.75 },
});
