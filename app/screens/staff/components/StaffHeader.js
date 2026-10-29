import { StyleSheet, Text, View } from 'react-native';

import { staffColors, staffSpacing } from './staffTheme';

// Cabeçalho fixo das telas Staff: ícone + título e subtítulo, com divisória.
export default function StaffHeader({ icon, title, subtitle }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {icon ? `${icon} ` : ''}{title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomColor: staffColors.divider,
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingHorizontal: staffSpacing.gutter,
    paddingTop: 14,
  },
  title: { color: staffColors.text, fontSize: 22, fontWeight: 'bold' },
  subtitle: { color: staffColors.muted, fontSize: 13, marginTop: 4 },
});
