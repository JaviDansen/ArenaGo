import StaffButton from './StaffButton';
import StaffNotice from './StaffNotice';
import StaffScreen from './StaffScreen';

// Estado exibido quando a tela é aberta sem evento de demonstração selecionado
// ou com uma estação inexistente; oferece um caminho de volta seguro.
export default function StaffMissingSession({ title, message, actionLabel, onAction }) {
  return (
    <StaffScreen title="Área do Staff">
      <StaffNotice tone="warning" title={title} message={message} />
      <StaffButton label={actionLabel} variant="secondary" onPress={onAction} />
    </StaffScreen>
  );
}
