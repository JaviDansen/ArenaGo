import { StyleSheet, Text, View } from 'react-native';

import { staffColors, staffSpacing } from './staffTheme';

const tones = {
  info: { background: staffColors.infoSurface, border: staffColors.infoBorder, text: staffColors.info },
  success: { background: staffColors.successSurface, border: staffColors.success, text: staffColors.success },
  warning: { background: staffColors.warningSurface, border: staffColors.warningBorder, text: staffColors.text },
  error: { background: staffColors.dangerSurface, border: staffColors.danger, text: staffColors.danger },
  neutral: { background: staffColors.surface, border: staffColors.divider, text: staffColors.muted },
};

// Caixa com faixa lateral para feedback e estados (chamado pendente, vazio,
// erro, indisponível).
export default function StaffNotice({ tone = 'info', title, message, children }) {
  const colors = tones[tone] ?? tones.info;
  return (
    <View
      style={[styles.box, { backgroundColor: colors.background, borderLeftColor: colors.border }]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      {title ? <Text style={[styles.title, { color: colors.text }]}>{title}</Text> : null}
      {message ? <Text style={[styles.message, { color: colors.text }]}>{message}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderLeftWidth: 4, borderRadius: 8, marginTop: staffSpacing.gap, padding: 12 },
  title: { fontSize: 14, fontWeight: 'bold' },
  message: { fontSize: 14, lineHeight: 20, marginTop: 2 },
});
