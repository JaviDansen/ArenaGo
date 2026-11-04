import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../context/AuthContext';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminDemoTools from './components/AdminDemoTools';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { getPanelSummary } from './adminDemoState';

// Atalhos que só serão completados no ADM03: mostram a pendência explicada.
const PENDING_SHORTCUTS = {
  history: {
    title: 'Histórico',
    message: 'O histórico de eventos encerrados será completado na etapa ADM03. Por enquanto, os eventos encerrados aparecem em Gerenciar Eventos com o filtro "Encerrado".',
  },
  overview: {
    title: 'Visão Geral',
    message: 'Os indicadores consolidados (BI) serão completados na etapa ADM03. Nenhum resultado real é exibido nesta demonstração.',
  },
};

// Painel Administrativo (ADM01): atalhos e contadores da demonstração.
export default function AdminPanelScreen({ navigation }) {
  const auth = useAuth();
  const { session, discard } = useAdminDemo();
  const [pending, setPending] = useState(null);

  if (!session) {
    return (
      <AdminMissing
        title="Sessão indisponível"
        message="Entre com sua conta para abrir a Área Admin (demonstração)."
        actionLabel="VOLTAR AO APLICATIVO"
        onAction={() => navigation.getParent()?.goBack()}
      />
    );
  }

  const summary = getPanelSummary(session);
  const accountName = auth?.user?.name || auth?.user?.email || 'Conta conectada';

  // Sai da Área Admin: descarta a demonstração e fecha a rota AdminDemo na
  // pilha do app (o provedor desmonta). A sessão autenticada não é tocada.
  function handleExitToApp() {
    discard();
    navigation.getParent()?.goBack();
  }

  const counters = [
    ['Eventos', summary.total],
    ['Agendados', summary.scheduled],
    ['Abertos', summary.open],
    ['Encerrando', summary.closing],
    ['Encerrados', summary.closed],
    ['Não prontos', summary.notReady],
  ];

  return (
    <AdminScreen
      title="Painel"
      highlight="Administrativo"
      subtitle="Gerencie eventos e acompanhe a demonstração da plataforma."
      backLabel="Voltar ao aplicativo"
      onBack={handleExitToApp}
    >
      <AdminCard>
        <Text style={styles.account}>Conectado como: {accountName}</Text>
        <Text style={styles.warning}>
          Modo demonstração: esta conta NÃO recebeu permissão Admin nem verificação TOTP. A
          autorização real dependerá da API futura; nada aqui é salvo no servidor.
        </Text>
      </AdminCard>

      <AdminCard
        accent
        onPress={() => navigation.navigate('AdminEvents')}
        accessibilityLabel={`Gerenciar Eventos, ${summary.total} eventos na demonstração`}
      >
        <Text style={styles.cardTitle}>📅 Gerenciar Eventos  →</Text>
        <Text style={styles.cardText}>Crie, consulte e gerencie eventos da demonstração.</Text>
      </AdminCard>

      <AdminCard
        accent
        onPress={() => setPending('history')}
        accessibilityLabel="Histórico, pendente da etapa ADM03"
      >
        <Text style={styles.cardTitle}>📊 Histórico</Text>
        <Text style={styles.cardText}>Eventos finalizados e seus resultados · pendente (ADM03).</Text>
      </AdminCard>

      <AdminCard
        accent
        onPress={() => setPending('overview')}
        accessibilityLabel="Visão Geral, pendente da etapa ADM03"
      >
        <Text style={styles.cardTitle}>🧭 Visão Geral</Text>
        <Text style={styles.cardText}>Indicadores gerais da plataforma · pendente (ADM03).</Text>
      </AdminCard>

      {pending ? (
        <AdminNotice tone="info" title={`${PENDING_SHORTCUTS[pending].title}: em construção`} message={PENDING_SHORTCUTS[pending].message}>
          <AdminButton compact variant="secondary" label="Entendi" onPress={() => setPending(null)} />
        </AdminNotice>
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Resumo da demonstração</Text>
      <Text style={styles.cardText}>Contadores fictícios, calculados a partir dos eventos simulados e do relógio de teste.</Text>
      <View style={styles.grid}>
        {counters.map(([label, value]) => (
          <View key={label} style={styles.counter} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text style={styles.counterValue}>{value}</Text>
            <Text style={styles.counterLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <AdminDemoTools />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  account: { color: adminColors.text, fontSize: 14, fontWeight: '600' },
  warning: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 6 },
  cardTitle: { color: adminColors.text, fontSize: 17, fontWeight: 'bold' },
  cardText: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  sectionTitle: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 6 },
  counter: {
    backgroundColor: adminColors.surface,
    borderColor: adminColors.border,
    borderRadius: 12,
    borderWidth: 1,
    margin: 6,
    padding: 12,
    width: '45%',
  },
  counterValue: { color: adminColors.text, fontSize: 22, fontWeight: 'bold' },
  counterLabel: { color: adminColors.muted, fontSize: 12, marginTop: 2 },
});
