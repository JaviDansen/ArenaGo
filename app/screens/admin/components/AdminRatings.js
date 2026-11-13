import { StyleSheet, Text, View } from 'react-native';

import { ADMIN_MIN_GROUP_SIZE } from '../../../data/adminDemoData';
import { formatAverage } from '../adminInsights';
import { adminColors } from './adminTheme';

// Avaliações enviadas (D08: uma por participação, nota vigente). Abaixo do
// mínimo do grupo mostra "Dados insuficientes", sem média nem distribuição.
export default function AdminRatings({ summary }) {
  if (summary.total === 0) {
    return <Text style={styles.muted}>Avaliações: nenhuma avaliação enviada.</Text>;
  }
  if (summary.insufficient) {
    return (
      <Text style={styles.muted}>
        Avaliações: Dados insuficientes ({summary.total} enviada(s); mínimo de {ADMIN_MIN_GROUP_SIZE} para exibir a média).
      </Text>
    );
  }
  return (
    <View>
      <Text
        style={styles.average}
        accessibilityLabel={`Avaliações: média ${formatAverage(summary.average)} de 5, ${summary.total} avaliações enviadas`}
      >
        Avaliações: média {formatAverage(summary.average)} / 5 · {summary.total} enviada(s)
      </Text>
      {[...summary.distribution].reverse().map((item) => (
        <View key={item.score} style={styles.row} accessible accessibilityLabel={`Nota ${item.score}: ${item.count} (${item.percent}%)`}>
          <Text style={styles.score}>{item.score}★</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${item.percent}%` }]} />
          </View>
          <Text style={styles.count}>{item.count} ({item.percent}%)</Text>
        </View>
      ))}
    </View>
  );
}

// Métrica temporal: duração média ou "Dados insuficientes" (nunca zero).
export function AdminDuration({ label, summary, population }) {
  const value = summary.insufficient
    ? `Dados insuficientes (${summary.sampleSize} registro(s); mínimo de ${ADMIN_MIN_GROUP_SIZE})`
    : `${summary.averageMinutes} min em média · ${summary.sampleSize} ${population}`;
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={summary.insufficient ? styles.muted : styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  average: { color: adminColors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  row: { alignItems: 'center', flexDirection: 'row', marginTop: 4 },
  score: { color: adminColors.muted, fontSize: 12, width: 28 },
  track: { backgroundColor: adminColors.surfaceRaised, borderRadius: 4, flex: 1, height: 8, overflow: 'hidden' },
  fill: { backgroundColor: adminColors.accent, height: 8 },
  count: { color: adminColors.muted, fontSize: 12, marginLeft: 8, minWidth: 64, textAlign: 'right' },
  metric: { marginTop: 10 },
  metricLabel: { color: adminColors.text, fontSize: 13, fontWeight: '600' },
  metricValue: { color: adminColors.text, fontSize: 14, marginTop: 2 },
});
