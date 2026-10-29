import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { staffDemoCodes } from '../../data/staffDemoData';
import StaffButton from './components/StaffButton';
import StaffCard from './components/StaffCard';
import StaffNotice from './components/StaffNotice';
import StaffScreen from './components/StaffScreen';
import { staffColors, staffSpacing } from './components/staffTheme';
import { useStaffDemo } from './StaffDemoContext';
import { waitStaffDemoLatency } from './staffDemoLatency';
import { resolveStaffDemoAccess } from './staffDemoState';

// Área do Staff (SV01, print 01). Não é um novo login: a conta vem do
// AuthContext e a permissão Staff por evento só poderá ser verificada pela API futura.
export default function StaffAccessScreen({ navigation }) {
  const auth = useAuth();
  const staffDemo = useStaffDemo();
  const [eventCode, setEventCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const accountName = auth?.user?.name || auth?.user?.email || 'Conta conectada';

  async function handleEnter() {
    if (isLoading) return;
    const access = resolveStaffDemoAccess(eventCode);

    if (access.code === 'EMPTY') {
      setError(access.message);
      return;
    }

    setError('');
    setIsLoading(true);
    await waitStaffDemoLatency();
    if (!mountedRef.current) return;
    setIsLoading(false);

    if (!access.ok) {
      setError(access.message);
      return;
    }

    staffDemo.enterEvent(access.eventCode);
    navigation.replace('StaffPanel');
  }

  function handleChangeCode(value) {
    setEventCode(value);
    if (error) setError('');
  }

  return (
    <StaffScreen icon="🔐" title="Área do Staff" subtitle="Operação de um evento">
      <StaffCard accent>
        <Text style={styles.cardTitle}>Login</Text>
        <Text style={styles.cardText}>
          Participante, Staff e Admin usam o mesmo login; após autenticar, o sistema direciona
          pelo perfil da conta.
        </Text>
        <Text style={styles.account}>Conectado como: {accountName}</Text>
        <Text style={styles.demoNote}>
          Modo demonstração: esta conta NÃO recebeu permissão Staff. A checagem do papel Staff
          por evento dependerá da API futura.
        </Text>
      </StaffCard>

      <Text style={styles.label} nativeID="staffEventCodeLabel">Código do evento</Text>
      <TextInput
        accessibilityLabel="Código do evento"
        accessibilityLabelledBy="staffEventCodeLabel"
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!isLoading}
        onChangeText={handleChangeCode}
        onSubmitEditing={handleEnter}
        placeholder="Ex: STAFFDEMO"
        placeholderTextColor={staffColors.muted}
        returnKeyType="go"
        style={[styles.input, error ? styles.inputError : null]}
        value={eventCode}
      />

      {error ? <StaffNotice tone="error" message={error} /> : null}

      <StaffButton
        label={isLoading ? 'VERIFICANDO...' : 'ENTRAR NO EVENTO'}
        loading={isLoading}
        onPress={handleEnter}
      />

      <Text style={styles.footnote}>
        É o mesmo código usado pelo Participante. Ele identifica o evento; o comportamento
        depende do perfil autenticado.
      </Text>

      <StaffNotice
        tone="neutral"
        title="Códigos de demonstração"
        message={`${staffDemoCodes.join(' · ')} — ou STAFFERRO para ver uma falha simulada.`}
      />

      <StaffButton label="Voltar ao app" variant="secondary" onPress={() => navigation.goBack()} />
    </StaffScreen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: staffColors.text, fontSize: 17, fontWeight: 'bold' },
  cardText: { color: staffColors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  account: { color: staffColors.text, fontSize: 13, fontWeight: '600', marginTop: 10 },
  demoNote: { color: staffColors.warning, fontSize: 13, lineHeight: 19, marginTop: 6 },
  label: { color: staffColors.text, fontSize: 16, fontWeight: 'bold', marginTop: 20 },
  input: {
    borderColor: staffColors.divider,
    borderRadius: staffSpacing.buttonRadius,
    borderWidth: 1,
    color: staffColors.text,
    fontSize: 16,
    marginTop: 8,
    padding: 14,
  },
  inputError: { borderColor: staffColors.danger },
  footnote: { color: staffColors.muted, fontSize: 12, lineHeight: 17, marginTop: 14 },
});
