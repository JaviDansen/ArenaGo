import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
export default function AdminPendingScreen({ route }) {
  return <AdminLiveScreen title={route.name === 'BI' ? 'Visão geral' : 'Histórico de eventos'}>
    <AdminNotice title="Em implementação" message="Esta área estará disponível em uma próxima atualização." />
  </AdminLiveScreen>;
}
