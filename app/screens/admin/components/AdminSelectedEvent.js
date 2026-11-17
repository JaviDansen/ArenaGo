import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatAdminDate } from '../../../services/adminEventsService';
import { adminEventAreas, adminReadinessRequirements } from '../adminEventManagement';
import { AdminEventPhaseBadge } from './AdminEventSummary';
import { AdminIcon, AdminIconTile, liveColors as c, liveStyles as s } from './AdminLiveUI';

export default function AdminSelectedEvent({ event, readiness, expanded, onToggle, onArea }) {
  return <View style={s.card}>
    <View style={styles.heading}>
      <Text style={styles.caption}>EVENTO SELECIONADO</Text>
      <AdminEventPhaseBadge phase={readiness?.effectivePhase ?? event?.effectivePhase} />
    </View>
    {event && <View style={[s.row, styles.details]}>
      <AdminIconTile name="calendar" />
      <View style={s.grow}>
        <Text style={s.title}>{event.name}</Text>
        <Text style={s.body}>Início: {formatAdminDate(event.startsAt, event.timezone)}</Text>
        <Text style={s.body}>Término oficial: {formatAdminDate(event.officialEndsAt, event.timezone)}</Text>
      </View>
    </View>}
    <View style={styles.divider}>
      {readiness?.ready ? <View style={s.row}>
        <AdminIcon name="check" color={c.success} size={20} />
        <Text style={[styles.status, { color: c.success }]}>Pronto para operar</Text>
      </View> : readiness ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Configuração pendente"
          accessibilityHint="Exibe ou oculta os requisitos faltantes" accessibilityState={{ expanded }}
          onPress={onToggle} style={[s.row, styles.action]}>
          <AdminIcon name="warning" color={c.warning} size={20} />
          <Text style={[styles.status, { color: c.warning }]}>Configuração pendente</Text>
          <Text style={styles.link}>{expanded ? 'Ocultar' : 'Ver requisitos'}</Text>
        </Pressable>
        {expanded && adminReadinessRequirements(readiness.missing).map(({ message, area }) => <View key={message} style={styles.requirement}>
          <Text style={s.body}>{message}</Text>
          {area && (onArea ? <Pressable accessibilityRole="button" accessibilityLabel={`Consultar ${adminEventAreas[area].title}`}
            onPress={() => onArea(area)} style={styles.action}>
            <Text style={styles.link}>{adminEventAreas[area].title} · Visão informativa</Text>
          </Pressable> : <Text style={s.body}>{adminEventAreas[area].title}</Text>)}
        </View>)}
      </> : <Text style={s.body}>Prontidão indisponível</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  caption: { color: c.muted, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  details: { alignItems: 'flex-start', marginTop: 14 },
  divider: { borderTopWidth: 1, borderColor: c.border, marginTop: 14, paddingTop: 10 },
  status: { flex: 1, color: c.text, fontSize: 15, fontWeight: '700' },
  action: { minHeight: 44, justifyContent: 'center', paddingVertical: 6 },
  link: { color: '#ddc4f2', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  requirement: { borderTopWidth: 1, borderColor: '#42304f', paddingVertical: 6 },
});
