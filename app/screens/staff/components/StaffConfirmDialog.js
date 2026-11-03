import { Modal, StyleSheet, Text, View } from 'react-native';

import StaffButton from './StaffButton';
import { staffColors, staffSpacing } from './staffTheme';

// Diálogo de confirmação usado antes de qualquer ação simulada relevante.
export default function StaffConfirmDialog({
  visible,
  title,
  message,
  note,
  confirmLabel = 'CONFIRMAR',
  cancelLabel = 'CANCELAR',
  variant = 'primary',
  onConfirm,
  onCancel,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <StaffButton label={confirmLabel} variant={variant} onPress={onConfirm} />
          <StaffButton label={cancelLabel} variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: staffSpacing.gutter,
  },
  dialog: { backgroundColor: staffColors.background, borderRadius: 12, padding: 20 },
  title: { color: staffColors.text, fontSize: 18, fontWeight: 'bold' },
  message: { color: staffColors.text, fontSize: 15, lineHeight: 21, marginTop: 8 },
  note: { color: staffColors.warning, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
