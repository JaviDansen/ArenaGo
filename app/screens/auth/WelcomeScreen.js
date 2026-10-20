import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function WelcomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.headerBrand}>BEAST MARAGAMES</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoBadgeText}>B</Text>
        </View>

        <Text style={styles.tag}>PRIMEIROS PASSOS</Text>
        <Text style={styles.title}>Viva a experiência BEAST.</Text>
        <Text style={styles.subtitle}>
          Conecte-se para participar de eventos, competições e acompanhar toda a arena em tempo real.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Register')}
        >
          <Text style={styles.primaryButtonText}>Criar minha conta</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.secondaryButtonText}>Já possuo uma conta</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a17',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  header: {
    paddingVertical: 12,
  },
  headerBrand: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  logoBadgeText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
  },
  tag: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
    marginBottom: 14,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#191330',
    borderWidth: 1,
    borderColor: '#34265a',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e2d9f3',
    fontSize: 16,
    fontWeight: '700',
  },
});
