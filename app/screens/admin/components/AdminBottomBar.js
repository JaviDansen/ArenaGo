import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdminIcon, liveColors as c } from './AdminLiveUI';

const tabs = [['Home', 'home'], ['Histórico', 'history'], ['BI', 'chart']];
export default function AdminBottomBar({ active, onSelect, onLongPress }) {
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
    <View style={styles.row}>{tabs.map(([label, icon]) => {
      const selected = active === label;
      return <Pressable key={label} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }}
        onPress={() => onSelect(label)} onLongPress={() => onLongPress?.(label)} style={styles.tab}>
        <View style={[styles.icon, selected && styles.active]}><AdminIcon name={icon} color={selected ? c.accent : c.muted} /></View>
        <Text style={[styles.label, { color: selected ? c.accent : c.muted }]}>{label}</Text>
      </Pressable>;
    })}</View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { backgroundColor: c.background, borderTopWidth: 1, borderColor: '#483452' },
  row: { flexDirection: 'row', paddingVertical: 8 }, tab: { flex: 1, alignItems: 'center', paddingVertical: 2, gap: 4 },
  icon: { width: 48, height: 36, borderRadius: 20, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  active: { borderColor: c.border, backgroundColor: '#2c1640' }, label: { fontSize: 13, lineHeight: 18 },
});
