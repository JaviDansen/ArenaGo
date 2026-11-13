import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ADMIN_DEMO_LABEL } from '../../../data/adminDemoData';
import AdminButton from './AdminButton';
import { adminColors, adminSpacing } from './adminTheme';

// Estrutura comum das telas Admin: área segura, botão de voltar, título,
// faixa fixa de MODO DEMONSTRAÇÃO (nunca omitida), teclado e rolagem.
export default function AdminScreen({ title, highlight, subtitle, backLabel, onBack, children }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.brand}>ARENAGO · ÁREA ADMIN (DEMONSTRAÇÃO)</Text>
        {onBack ? (
          <AdminButton label={`← ${backLabel ?? 'Voltar'}`} variant="ghost" compact onPress={onBack} />
        ) : null}
      </View>
      <View
        style={styles.demoBanner}
        accessibilityRole="alert"
        accessibilityLabel="Operações demonstrativas: dados fictícios, nada é salvo no servidor. Acesso por sessão Admin autenticada."
      >
        <Text style={styles.demoBannerText}>
          <Text style={styles.demoBannerTitle}>{ADMIN_DEMO_LABEL}</Text>
          {' · dados fictícios, nada é enviado ao servidor'}
        </Text>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {title ? (
            <Text style={styles.title} accessibilityRole="header">
              {title}
              {highlight ? <Text style={styles.highlight}>{` ${highlight}`}</Text> : null}
            </Text>
          ) : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: adminColors.background },
  flex: { flex: 1 },
  header: { alignItems: 'flex-start', paddingHorizontal: adminSpacing.gutter, paddingTop: 8 },
  brand: { color: adminColors.muted, fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },
  demoBanner: {
    backgroundColor: adminColors.warningSurface,
    marginTop: 8,
    paddingHorizontal: adminSpacing.gutter,
    paddingVertical: 6,
  },
  demoBannerTitle: { fontWeight: 'bold', letterSpacing: 0.5 },
  demoBannerText: { color: adminColors.warning, fontSize: 12 },
  content: { paddingHorizontal: adminSpacing.gutter, paddingTop: 12, paddingBottom: 40 },
  title: { color: adminColors.text, fontSize: 26, fontWeight: 'bold' },
  highlight: { color: adminColors.accent },
  subtitle: { color: adminColors.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
});
