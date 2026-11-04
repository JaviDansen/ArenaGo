import { StyleSheet, Text, View } from 'react-native';

import { adminColors, adminSpacing } from './adminTheme';

const tones = {
  info: { background: adminColors.infoSurface, border: adminColors.info, text: adminColors.info },
  success: { background: adminColors.successSurface, border: adminColors.success, text: adminColors.success },
  warning: { background: adminColors.warningSurface, border: adminColors.warning, text: adminColors.warning },
  error: { background: adminColors.dangerSurface, border: adminColors.danger, text: adminColors.danger },
  neutral: { background: adminColors.surface, border: adminColors.border, text: adminColors.muted },
};

// Caixa de feedback e estados (vazio, erro, bloqueio, pendência, sucesso).
export default function AdminNotice({ tone = 'info', title, message, children }) {
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
  box: { borderLeftWidth: 4, borderRadius: 8, marginTop: adminSpacing.gap, padding: 12 },
  title: { fontSize: 14, fontWeight: 'bold' },
  message: { fontSize: 14, lineHeight: 20, marginTop: 2 },
});
