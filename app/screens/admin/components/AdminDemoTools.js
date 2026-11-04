import { StyleSheet, Text, View } from 'react-native';

import { formatInstantWithZone } from '../adminTime';
import { useAdminDemo } from '../AdminDemoContext';
import AdminButton from './AdminButton';
import { adminColors, adminSpacing } from './adminTheme';

// Ferramentas exclusivas da demonstração: relógio de teste controlado (as
// fases dependem dele) e erro simulado na próxima ação.
export default function AdminDemoTools({ showFailure = true }) {
  const { session, failNextAction, advanceClock, resetClock, toggleFailNextAction } = useAdminDemo();
  if (!session) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Ferramentas da demonstração</Text>
      <Text style={styles.text} accessibilityLabel={`Relógio da demonstração: ${formatInstantWithZone(session.clockNow, 'America/Sao_Paulo')}`}>
        Relógio de teste: {formatInstantWithZone(session.clockNow, 'America/Sao_Paulo')}
      </Text>
      <Text style={styles.text}>
        As fases são calculadas por este relógio simulado, não pelo relógio do aparelho.
      </Text>
      <View style={styles.row}>
        <View style={styles.item}>
          <AdminButton compact variant="secondary" label="+15 min" accessibilityLabel="Avançar relógio 15 minutos" onPress={() => advanceClock(15)} />
        </View>
        <View style={styles.item}>
          <AdminButton compact variant="secondary" label="+1 h" accessibilityLabel="Avançar relógio 1 hora" onPress={() => advanceClock(60)} />
        </View>
        <View style={styles.item}>
          <AdminButton compact variant="secondary" label="Reiniciar relógio" onPress={resetClock} />
        </View>
      </View>
      {showFailure ? (
        <>
          <Text style={[styles.text, styles.spaced]}>
            {failNextAction
              ? 'A próxima ação vai falhar de propósito para mostrar o estado de erro.'
              : 'Use para ver como a tela reage a uma falha de comunicação.'}
          </Text>
          <AdminButton
            compact
            variant="secondary"
            label={failNextAction ? 'Cancelar erro simulado' : 'Simular erro na próxima ação'}
            onPress={toggleFailNextAction}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderColor: adminColors.border,
    borderRadius: adminSpacing.radius,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: 28,
    padding: 12,
  },
  title: { color: adminColors.muted, fontSize: 13, fontWeight: 'bold' },
  text: { color: adminColors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  spaced: { marginTop: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  item: { paddingHorizontal: 4 },
});
