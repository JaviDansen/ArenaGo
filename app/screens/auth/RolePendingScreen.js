import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';

// Esta entrada não concede acesso a operações nem armazena um evento selecionado.
export default function RolePendingScreen({ route }) {
  const auth = useAuth();
  const admin = route.name === 'AdminPending';
  const recovery = route.name === 'IdentityRecovery';
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{recovery ? 'Verificação da sessão' : admin ? 'Área administrativa' : 'Área Staff'}</Text>
        <Text style={styles.message}>
          {recovery ? 'Não foi possível confirmar os papéis da conta.' : admin
            ? 'Integração administrativa pendente.'
            : 'Integração Staff pendente. A seleção de eventos autorizados ainda não está disponível.'}
        </Text>
        {recovery && <Pressable accessibilityRole="button" onPress={() => { void auth?.restoreSession(); }} style={styles.button}>
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" onPress={() => { void auth?.logout(); }} style={styles.button}>
          <Text style={styles.buttonText}>Sair da conta</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0a17', justifyContent: 'center', padding: 24 },
  content: { alignItems: 'center', gap: 16 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  message: { color: '#cbd5e1', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { backgroundColor: '#7c3aed', borderRadius: 14, padding: 16 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
