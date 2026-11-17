import { StyleSheet, Text, View } from 'react-native';
import { adminEventPhases, formatAdminDate } from '../../../services/adminEventsService';
import { adminColors as c } from './adminTheme';
import { AdminIcon, AdminIconTile, liveColors, liveStyles as s } from './AdminLiveUI';
export default function AdminEventSummary({ event, compact = false }) {
  if (compact) {
    const phaseColor = { open: '#00e5aa', scheduled: '#77d3ff', closing: '#ffe44c', not_ready: '#dac0ef' }[event.effectivePhase] || liveColors.muted;
    const ready = event.readiness.ready;
    return <>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <AdminIconTile name="calendar" />
        <View style={s.grow}>
          <View style={styles.heading}><Text style={[s.title, styles.eventName]}>{event.name}</Text>
            <Text style={[styles.badge, { borderColor: phaseColor, color: phaseColor }]}>{adminEventPhases[event.effectivePhase]}</Text></View>
          <Text style={styles.date}>Início: {formatAdminDate(event.startsAt, event.timezone)}</Text>
          <Text style={styles.date}>Até: {formatAdminDate(event.officialEndsAt, event.timezone)}</Text>
        </View>
      </View>
      <View style={styles.readiness}>
        <AdminIcon name={ready ? 'check' : 'warning'} color={ready ? '#00e5aa' : liveColors.warning} size={20} />
        <Text style={styles.readyText}>{ready ? 'Pronto para operar' : 'Configuração pendente'}</Text>
        <AdminIcon name="chevron" color={liveColors.muted} size={18} />
      </View>
    </>;
  }
  return <>
    <Text style={styles.name}>{event.name}</Text>
    <Text style={styles.phase}>{adminEventPhases[event.effectivePhase]}</Text>
    <Text style={styles.line}>Início: {formatAdminDate(event.startsAt, event.timezone)}</Text>
    <Text style={styles.line}>Término oficial: {formatAdminDate(event.officialEndsAt, event.timezone)}</Text>
    <Text style={styles.line}>{event.readiness.ready ? 'Pronto' : 'Prontidão pendente'}</Text>
  </>;
}
const styles = StyleSheet.create({ name: { color: c.text, fontSize: 19, fontWeight: 'bold' }, phase: { color: c.accent, marginTop: 8, fontWeight: 'bold' }, line: { color: c.muted, marginTop: 8, lineHeight: 20 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 },
  eventName: { flexGrow: 1, flexBasis: 150, minWidth: 0, fontSize: 18, lineHeight: 24 },
  badge: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 3, fontSize: 11, lineHeight: 16, fontWeight: '700', flexShrink: 1, textTransform: 'uppercase' },
  date: { color: liveColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  readiness: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: '#42304f', marginTop: 14, paddingTop: 12 },
  readyText: { flex: 1, color: liveColors.text, fontSize: 14, lineHeight: 20 },
});
