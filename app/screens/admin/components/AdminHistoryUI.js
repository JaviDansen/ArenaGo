import { StyleSheet, Text, View } from 'react-native';
import { AdminIcon, liveColors as c } from './AdminLiveUI';

export function HistoryBadge() {
  return <Text style={historyStyles.badge}>Encerrado</Text>;
}

export function HistoryHeading({ icon, children }) {
  return <View style={historyStyles.heading}>
    <AdminIcon name={icon} size={22} />
    <Text accessibilityRole="header" style={historyStyles.title}>{children}</Text>
  </View>;
}

export function HistoryMetric({ icon, label, value, detail, centered = false, accessibilityLabel, style }) {
  return <View accessible accessibilityLabel={accessibilityLabel ?? `${label}: ${value}${detail ? `, ${detail}` : ''}`}
    style={[historyStyles.tile, centered ? styles.centered : styles.inline, style]}>
    <AdminIcon name={icon} size={centered ? 23 : 19} />
    <Text style={[historyStyles.copy, centered ? styles.centeredText : styles.inlineText]}>
      <Text style={styles.value}>{value}</Text>{'\n'}{label}
      {detail ? `\n${detail}` : ''}
    </Text>
  </View>;
}

export const historyStyles = StyleSheet.create({
  panel: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 12 },
  tile: { backgroundColor: '#241832', borderColor: '#795395', borderWidth: 1, borderRadius: 12, padding: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { color: c.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
  copy: { color: c.muted, fontSize: 13, lineHeight: 18 },
  badge: { color: '#f1dbff', backgroundColor: '#36224c', borderWidth: 1, borderColor: '#a779bd',
    borderRadius: 14, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4,
    alignSelf: 'flex-start', fontSize: 12, fontWeight: '600' },
});

const styles = StyleSheet.create({
  centered: { alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: '28%', minWidth: 110 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5, flexGrow: 1, flexBasis: '28%', minWidth: 86 },
  centeredText: { textAlign: 'center' },
  inlineText: { flex: 1 },
  value: { color: c.text, fontSize: 20, lineHeight: 25, fontWeight: '700' },
});
