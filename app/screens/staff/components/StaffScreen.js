import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { STAFF_DEMO_LABEL } from '../../../data/staffDemoData';
import StaffHeader from './StaffHeader';
import { staffColors, staffSpacing } from './staffTheme';

// Estrutura comum das telas Staff: área segura, cabeçalho, faixa fixa de
// MODO DEMONSTRAÇÃO (nunca pode ser omitida), teclado e rolagem.
export default function StaffScreen({ icon, title, subtitle, children }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      {title ? <StaffHeader icon={icon} title={title} subtitle={subtitle} /> : null}
      <View
        style={styles.demoBanner}
        accessibilityRole="alert"
        accessibilityLabel="Modo demonstração: dados fictícios, nada é salvo no servidor"
      >
        <Text style={styles.demoBannerText}>
          <Text style={styles.demoBannerTitle}>{STAFF_DEMO_LABEL}</Text>
          {' · dados fictícios, nada é enviado ao servidor'}
        </Text>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: staffColors.background },
  flex: { flex: 1 },
  demoBanner: {
    backgroundColor: staffColors.warningSurface,
    paddingHorizontal: staffSpacing.gutter,
    paddingVertical: 6,
  },
  demoBannerTitle: { fontWeight: 'bold', letterSpacing: 0.5 },
  demoBannerText: { color: staffColors.warning, fontSize: 12 },
  content: { paddingHorizontal: staffSpacing.gutter, paddingTop: 8, paddingBottom: 32 },
});
