import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
export default function AdminPendingScreen({ route, navigation }) {
  return <AdminLiveScreen title={route.name === 'BI' ? 'Visão geral' : 'Histórico de eventos'}
    backLabel="Voltar para Home" onBack={() => navigation.navigate('Home')}>
    <AdminNotice title="Em implementação" message="Esta área estará disponível em uma próxima atualização." />
  </AdminLiveScreen>;
}
