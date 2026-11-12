import AdminButton from './AdminButton';
import AdminNotice from './AdminNotice';
import AdminScreen from './AdminScreen';

// Estado seguro quando a tela é aberta sem sessão de demonstração ou com um
// evento inexistente; oferece um caminho de volta.
export default function AdminMissing({ title, message, actionLabel, onAction }) {
  return (
    <AdminScreen title="Área Admin">
      <AdminNotice tone="warning" title={title} message={message} />
      <AdminButton label={actionLabel} variant="secondary" onPress={onAction} />
    </AdminScreen>
  );
}
