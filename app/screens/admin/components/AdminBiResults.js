import { StyleSheet, Text, View } from 'react-native';
import { HistoryHeading, historyStyles as hs } from './AdminHistoryUI';
import { liveColors as c, liveStyles as s } from './AdminLiveUI';

const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatBiRating = mean => mean === null ? 'Sem avaliações' : `${decimal.format(mean)} / 5`;

function Bar({ label, percent, count, compact, showPercent = true }) {
  return <View style={compact ? styles.compactRow : styles.barRow}>
    <Text style={compact ? styles.compactLabel : s.body}>{label}</Text>
    <View style={[styles.track, compact && styles.compactTrack]}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
    <Text style={compact ? styles.compactValue : s.body}>
      {showPercent ? `${count} · ${decimal.format(percent)}%` : count}
    </Text>
  </View>;
}

export function AdminBiRanking({ ranking, title = 'Experiências mais utilizadas', compact = false }) {
  return <View style={compact ? hs.panel : s.card}>
    {compact ? <HistoryHeading icon="layers">{title}</HistoryHeading> :
      <><Text style={s.title}>{title}</Text><Text style={s.body}>Ranking por atendimentos concluídos</Text></>}
    {ranking.length === 0 ? <Text style={compact ? hs.copy : s.body}>Sem atendimentos concluídos.</Text> :
      ranking.map(row => <Bar key={row.id} label={row.name} percent={row.percent} count={row.completed}
        compact={compact} showPercent={!compact} />)}
  </View>;
}

export function AdminBiRatings({ ratings, compact = false }) {
  const rows = ratings.distribution.slice().reverse().map(row => <Bar key={row.stars}
    label={row.stars === 1 ? '1 estrela' : `${row.stars} estrelas`} percent={row.percent} count={row.count} compact={compact} />);
  const mean = <Text style={compact ? styles.mean : s.title}>{formatBiRating(ratings.mean)}</Text>;
  const count = <Text style={compact ? hs.copy : s.body}>{ratings.count} avaliações</Text>;
  return compact ? <View style={hs.panel}>
    <HistoryHeading icon="star">Avaliações</HistoryHeading>
    <View style={styles.ratingLayout}>
      <View style={styles.ratingTotal}>{mean}{count}</View>
      <View style={styles.distribution}>{rows}</View>
    </View>
  </View> : <View style={s.card}>
    <Text style={s.title}>☆ Avaliações</Text>{mean}{count}{rows}
  </View>;
}

const styles = StyleSheet.create({
  barRow: { gap: 6, marginTop: 14 },
  track: { backgroundColor: '#31233e', height: 10, borderRadius: 8, overflow: 'hidden' },
  fill: { backgroundColor: '#a337df', height: '100%', borderRadius: 8 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#503463' },
  compactLabel: { color: c.text, fontSize: 13, flexBasis: '34%', flexShrink: 1, minWidth: 0 },
  compactTrack: { flex: 1, minWidth: 18, height: 8 },
  compactValue: { color: c.muted, fontSize: 13, fontVariant: ['tabular-nums'],
    textAlign: 'right', maxWidth: '36%', flexShrink: 1 },
  ratingLayout: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  ratingTotal: { flexGrow: 1, flexBasis: '23%', minWidth: 102, gap: 4 },
  mean: { color: c.text, fontSize: 24, fontWeight: '700' },
  distribution: { flexGrow: 3, flexBasis: '64%', minWidth: 205 },
});
