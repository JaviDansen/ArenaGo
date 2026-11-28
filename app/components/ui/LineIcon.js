import { StyleSheet, View } from 'react-native';

/**
 * Ícones de linha desenhados com Views nativas (mesmo padrão de `navigation/MainTabs.js`).
 * Sem dependência de fonte de ícones ou SVG; aparência idêntica em Android e iOS.
 * Desenho em grade de 20dp com traço de 1.8dp; `size` escala o conjunto.
 */
const BASE = 20;
const STROKE = 1.8;

const DRAWINGS = {
  qr: (color) => (
    <>
      {[[1, 1], [11, 1], [1, 11]].map(([left, top]) => (
        <View key={`${left}-${top}`} style={[styles.qrFinder, { left, top, borderColor: color }]}>
          <View style={[styles.qrDot, { backgroundColor: color }]} />
        </View>
      ))}
      <View style={[styles.qrCell, { left: 12, top: 12, backgroundColor: color }]} />
      <View style={[styles.qrCell, { left: 16, top: 16, backgroundColor: color }]} />
      <View style={[styles.qrCell, { left: 16, top: 12, backgroundColor: color }]} />
    </>
  ),
  gamepad: (color) => (
    <View style={[styles.padBody, { borderColor: color }]}>
      <View style={[styles.padCrossH, { backgroundColor: color }]} />
      <View style={[styles.padCrossV, { backgroundColor: color }]} />
      <View style={[styles.padButton, { right: 3.5, top: 3, backgroundColor: color }]} />
      <View style={[styles.padButton, { right: 1.5, top: 6, backgroundColor: color }]} />
    </View>
  ),
  // Estrela de 5 pontas com três triângulos de borda (sem glifo de fonte: igual em Android e iOS).
  star: (color) => (
    <View style={[styles.starMain, { borderBottomColor: color }]}>
      <View style={[styles.starTop, { borderBottomColor: color }]} />
      <View style={[styles.starSide, { borderBottomColor: color }]} />
    </View>
  ),
  calendar: (color) => (
    <>
      <View style={[styles.calendarPin, { left: 5, backgroundColor: color }]} />
      <View style={[styles.calendarPin, { right: 5, backgroundColor: color }]} />
      <View style={[styles.calendarBody, { borderColor: color }]}>
        <View style={[styles.calendarLine, { backgroundColor: color }]} />
      </View>
    </>
  ),
  clock: (color) => (
    <View style={[styles.ring, { borderColor: color }]}>
      <View style={[styles.clockHour, { backgroundColor: color }]} />
      <View style={[styles.clockMinute, { backgroundColor: color }]} />
    </View>
  ),
  door: (color) => (
    <View style={[styles.door, { borderColor: color }]}>
      <View style={[styles.doorKnob, { backgroundColor: color }]} />
    </View>
  ),
  flag: (color) => (
    <>
      <View style={[styles.flagPole, { backgroundColor: color }]} />
      <View style={[styles.flagCloth, { borderColor: color }]} />
    </>
  ),
  globe: (color) => (
    <View style={[styles.ring, { borderColor: color }]}>
      <View style={[styles.globeMeridian, { borderColor: color }]} />
      <View style={[styles.globeEquator, { backgroundColor: color }]} />
    </View>
  ),
  queue: (color) => (
    <>
      {[3, 9, 15].map((left) => (
        <View key={left} style={[styles.queuePerson, { left }]}>
          <View style={[styles.queueHead, { borderColor: color }]} />
          <View style={[styles.queueBody, { borderColor: color }]} />
        </View>
      ))}
    </>
  ),
  alert: (color) => (
    <View style={[styles.ring, { borderColor: color }]}>
      <View style={[styles.alertBar, { backgroundColor: color }]} />
      <View style={[styles.alertDot, { backgroundColor: color }]} />
    </View>
  ),
  refresh: (color) => (
    <View style={[styles.refreshArc, { borderColor: color }]}>
      <View style={[styles.refreshHead, { borderLeftColor: color }]} />
    </View>
  ),
  // PARTICIPANTE-02A: indicador de sucesso (L de bordas girado 45°).
  check: (color) => (
    <View style={[styles.checkMark, { borderColor: color }]} />
  ),
};

export const LINE_ICON_NAMES = Object.keys(DRAWINGS);

export function LineIcon({ name, color = '#FFFFFF', size = BASE, style, testID }) {
  const draw = DRAWINGS[name];
  if (!draw) return null;
  const scale = size / BASE;
  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <View style={[styles.canvas, scale !== 1 && { transform: [{ scale }] },
        scale !== 1 && { left: (size - BASE) / 2, top: (size - BASE) / 2 }]}>
        {draw(color)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BASE,
    height: BASE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starMain: {
    width: 0,
    height: 0,
    marginTop: 4,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 6.3,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    transform: [{ rotate: '35deg' }],
  },
  starTop: {
    position: 'absolute',
    top: -4.05,
    left: -5.85,
    width: 0,
    height: 0,
    borderLeftWidth: 2.7,
    borderRightWidth: 2.7,
    borderBottomWidth: 7.2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    transform: [{ rotate: '-35deg' }],
  },
  starSide: {
    position: 'absolute',
    top: 0.27,
    left: -9.45,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 6.3,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    transform: [{ rotate: '-70deg' }],
  },
  qrFinder: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderWidth: STROKE,
    borderRadius: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrDot: { width: 2, height: 2 },
  qrCell: { position: 'absolute', width: 3, height: 3 },
  padBody: {
    width: 19,
    height: 12,
    borderWidth: STROKE,
    borderRadius: 6,
  },
  padCrossH: { position: 'absolute', left: 2.5, top: 3.6, width: 6, height: STROKE, borderRadius: 1 },
  padCrossV: { position: 'absolute', left: 4.6, top: 1.5, width: STROKE, height: 6, borderRadius: 1 },
  padButton: { position: 'absolute', width: 2.4, height: 2.4, borderRadius: 1.2 },
  calendarPin: { position: 'absolute', top: 1, width: 2, height: 4, borderRadius: 1, zIndex: 2 },
  calendarBody: {
    position: 'absolute',
    bottom: 1.5,
    width: 17,
    height: 15,
    borderWidth: STROKE,
    borderRadius: 3,
  },
  calendarLine: { position: 'absolute', top: 3, left: 0, right: 0, height: STROKE },
  ring: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    borderWidth: STROKE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHour: { position: 'absolute', left: 6.8, top: 3, width: STROKE, height: 5.5, borderRadius: 1 },
  clockMinute: { position: 'absolute', left: 6.8, top: 6.8, width: 4.5, height: STROKE, borderRadius: 1 },
  door: {
    width: 12,
    height: 17,
    borderWidth: STROKE,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  doorKnob: { position: 'absolute', right: 1.5, top: 7, width: 2.2, height: 2.2, borderRadius: 1.1 },
  flagPole: { position: 'absolute', left: 3, top: 1.5, width: STROKE, height: 17, borderRadius: 1 },
  flagCloth: {
    position: 'absolute',
    left: 4.5,
    top: 2,
    width: 12,
    height: 8,
    borderWidth: STROKE,
    borderLeftWidth: 0,
    borderTopRightRadius: 1.5,
    borderBottomRightRadius: 1.5,
  },
  globeMeridian: { width: 7, height: 15, borderRadius: 3.5, borderWidth: STROKE - 0.4 },
  globeEquator: { position: 'absolute', left: 0, right: 0, top: 6.8, height: STROKE - 0.4 },
  queuePerson: { position: 'absolute', top: 3, width: 3, alignItems: 'center' },
  queueHead: { width: 4.6, height: 4.6, borderRadius: 2.3, borderWidth: STROKE - 0.3 },
  queueBody: {
    marginTop: 1.5,
    width: 5.5,
    height: 6,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderWidth: STROKE - 0.3,
    borderBottomWidth: 0,
  },
  alertBar: { width: STROKE, height: 6, borderRadius: 1, marginTop: -2 },
  alertDot: { width: STROKE + 0.2, height: STROKE + 0.2, borderRadius: 1, marginTop: 1.5 },
  refreshArc: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: STROKE,
    borderRightColor: 'transparent',
  },
  refreshHead: {
    position: 'absolute',
    right: -3,
    top: 0.5,
    width: 0,
    height: 0,
    borderTopWidth: 3.5,
    borderBottomWidth: 3.5,
    borderLeftWidth: 4.5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    transform: [{ rotate: '90deg' }],
  },
  checkMark: {
    width: 6.5,
    height: 12,
    marginTop: -2.5,
    borderRightWidth: STROKE + 0.2,
    borderBottomWidth: STROKE + 0.2,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
});

export default LineIcon;
