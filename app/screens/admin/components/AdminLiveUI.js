import { Pressable, StyleSheet, Text, View } from 'react-native';
import { adminColors } from './adminTheme';

// Scoped to real Admin screens, without changing the demo theme.
export const liveColors = { ...adminColors, background: '#090412', surface: '#151020',
  border: '#c476ed', accent: '#b960f5', muted: '#c7b9d9', iconFill: '#38204f' };
const c = liveColors;

// Native line icons: no font download or additional native dependency.
export function AdminIcon({ name, color = c.accent, size = 24 }) {
  const line = { position: 'absolute', borderColor: color, borderWidth: 1.6 };
  const part = (key, style) => <View key={key} style={[line, style]} />;
  let shapes;
  switch (name) {
    case 'edit': shapes = [part('pencil', { left: 5, top: 4, width: 7, height: 17, borderRadius: 2, transform: [{ rotate: '43deg' }] }),
      part('tip', { left: 3, top: 17, width: 4, height: 4, borderTopWidth: 0, borderRightWidth: 0 })]; break;
    case 'qr': shapes = [[3, 3], [14, 3], [3, 14], [15, 15]].map(([left, top], index) =>
      part(`qr${index}`, { left, top, width: index === 3 ? 6 : 7, height: index === 3 ? 6 : 7, borderRadius: 1 })); break;
    case 'calendar': shapes = [part('box', { left: 3, top: 5, width: 18, height: 17, borderRadius: 3 }),
      part('divider', { left: 3, top: 10, width: 18, borderWidth: 0, borderTopWidth: 1.6 }),
      ...[7, 16].map(left => part(`ring${left}`, { left, top: 2, height: 6, borderWidth: 0, borderLeftWidth: 1.6 })),
      part('day', { left: 8, top: 15, width: 4, height: 2, borderWidth: 0, backgroundColor: color })]; break;
    case 'folder': shapes = [part('tab', { left: 2, top: 4, width: 10, height: 7, borderRadius: 2 }),
      part('box', { left: 2, top: 8, width: 20, height: 14, borderRadius: 2, backgroundColor: c.surface })]; break;
    case 'plus': shapes = [part('h', { left: 2, top: 12, width: 20, borderWidth: 0, borderTopWidth: 1.6 }),
      part('v', { left: 12, top: 2, height: 20, borderWidth: 0, borderLeftWidth: 1.6 })]; break;
    case 'home': shapes = [part('roof', { left: 4, top: 3, width: 16, height: 16, borderRightWidth: 0, borderBottomWidth: 0, transform: [{ rotate: '45deg' }] }),
      part('house', { left: 5, top: 10, width: 14, height: 12, borderTopWidth: 0 }), part('door', { left: 10, top: 15, width: 4, height: 7 })]; break;
    case 'chart': shapes = [6, 12, 19].map((height, i) => part(`bar${i}`, { left: 2 + i * 8, bottom: 2, width: 5, height, borderRadius: 1 })); break;
    case 'layers': shapes = [
      part('top', { left: 5, top: 2, width: 14, height: 14, transform: [{ scaleY: 0.65 }, { rotate: '45deg' }] }),
      ...[6, 10].map(top => part(`layer${top}`, { left: 5, top, width: 14, height: 14, borderTopWidth: 0, borderLeftWidth: 0,
        transform: [{ scaleY: 0.65 }, { rotate: '45deg' }] })),
    ]; break;
    case 'pause': shapes = [8, 15].map(left => part(`bar${left}`, { left, top: 4, height: 16, borderWidth: 0, borderLeftWidth: 2 })); break;
    case 'play': shapes = [<View key="triangle" style={{ position: 'absolute', left: 8, top: 4, width: 0, height: 0,
      borderLeftWidth: 12, borderTopWidth: 8, borderBottomWidth: 8, borderLeftColor: color,
      borderTopColor: 'transparent', borderBottomColor: 'transparent' }} />]; break;
    case 'stop': shapes = [part('square', { left: 4, top: 4, width: 16, height: 16, borderRadius: 2 })]; break;
    case 'power': shapes = [
      part('ring', { left: 3, top: 4, width: 18, height: 18, borderRadius: 10, borderTopColor: 'transparent' }),
      part('stem', { left: 11, top: 1, height: 10, borderWidth: 0, borderLeftWidth: 2 }),
    ]; break;
    case 'history': case 'gauge': shapes = [part('circle', { left: 2, top: 2, width: 20, height: 20, borderRadius: 12 }),
      part('hand', { left: 12, top: 6, height: 7, borderWidth: 0, borderLeftWidth: 1.6 }),
      part('minute', { left: 12, top: 12, width: 6, borderWidth: 0, borderTopWidth: 1.6, transform: [{ rotate: name === 'gauge' ? '-45deg' : '25deg' }] })]; break;
    case 'users': shapes = [part('head', { left: 5, top: 2, width: 9, height: 9, borderRadius: 6 }),
      part('body', { left: 2, top: 14, width: 17, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 }),
      part('other', { left: 17, top: 4, width: 5, height: 7, borderLeftWidth: 0, borderTopRightRadius: 5, borderBottomRightRadius: 5 })]; break;
    case 'search': shapes = [part('lens', { left: 1, top: 1, width: 16, height: 16, borderRadius: 10 }),
      part('handle', { left: 18, top: 15, height: 10, borderWidth: 0, borderLeftWidth: 1.6, transform: [{ rotate: '-45deg' }] })]; break;
    case 'logout': shapes = [part('door', { left: 1, top: 3, width: 12, height: 18 }),
      part('shaft', { left: 8, top: 12, width: 14, borderWidth: 0, borderTopWidth: 1.6 }),
      part('arrow', { left: 17, top: 8, width: 7, height: 7, borderLeftWidth: 0, borderBottomWidth: 0, transform: [{ rotate: '45deg' }] })]; break;
    case 'back': shapes = [part('shaft', { left: 2, top: 12, width: 20, borderWidth: 0, borderTopWidth: 1.6 }),
      part('arrow', { left: 3, top: 7, width: 10, height: 10, borderRightWidth: 0, borderBottomWidth: 0, transform: [{ rotate: '-45deg' }] })]; break;
    case 'chevron': shapes = [part('arrow', { left: 7, top: 6, width: 11, height: 11, borderLeftWidth: 0, borderBottomWidth: 0, transform: [{ rotate: '45deg' }] })]; break;
    default: shapes = [part('circle', { left: 1, top: 1, width: 22, height: 22, borderRadius: 12 }),
      name === 'check' ? part('check', { left: 6, top: 7, width: 12, height: 7, borderTopWidth: 0, borderRightWidth: 0, transform: [{ rotate: '-45deg' }] }) :
        <Text key="symbol" style={{ color, textAlign: 'center', fontSize: 17, fontWeight: '600', lineHeight: 24 }}>{name === 'warning' ? '!' : 'i'}</Text>];
  }
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, flexShrink: 0 }}>
    <View style={{ width: 24, height: 24, transform: [{ scale: size / 24 }], transformOrigin: 'top left' }}>{shapes}</View>
  </View>;
}
export function AdminIconTile({ name, color }) {
  return <View style={liveStyles.iconTile}><AdminIcon name={name} color={color} size={28} /></View>;
}
export function AdminEventActions({ onCreate }) {
  return <View style={liveStyles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Criar evento" onPress={onCreate} style={liveStyles.pendingAction}>
      <View style={liveStyles.row}><AdminIcon name="plus" /><Text style={liveStyles.actionLabel}>Criar evento</Text></View>
    </Pressable>
    <Pressable disabled accessibilityRole="button" accessibilityLabel="Catálogo de experiências · Em implementação"
      accessibilityState={{ disabled: true }} style={liveStyles.pendingAction}>
      <View style={liveStyles.row}><AdminIcon name="folder" /><Text style={liveStyles.actionLabel}>Catálogo de experiências</Text></View>
      <Text style={liveStyles.pending}>Em breve</Text>
    </Pressable>
  </View>;
}
export const liveStyles = StyleSheet.create({
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 16, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1, minWidth: 0 },
  title: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '700' }, body: { color: c.muted, fontSize: 15, lineHeight: 22, marginTop: 6 },
  iconTile: { width: 48, height: 48, borderRadius: 13, backgroundColor: c.iconFill, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginVertical: 8 },
  pendingAction: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#795395', borderRadius: 12, backgroundColor: '#251a33', paddingHorizontal: 10, paddingVertical: 12, justifyContent: 'center' },
  actionLabel: { flex: 1, color: c.text, fontWeight: '600', fontSize: 13, lineHeight: 18 }, pending: { color: c.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
});
