import { Modal, StyleSheet, Text, View } from 'react-native';

import AdminButton from './AdminButton';
import { adminColors, adminSpacing } from './adminTheme';

// Confirmação antes de qualquer ação simulada relevante.
export default function AdminConfirmDialog({
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
          <AdminButton label={confirmLabel} variant={variant} onPress={onConfirm} />
          <AdminButton label={cancelLabel} variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    padding: adminSpacing.gutter,
  },
  dialog: {
    backgroundColor: adminColors.surfaceRaised,
    borderColor: adminColors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  title: { color: adminColors.text, fontSize: 18, fontWeight: 'bold' },
  message: { color: adminColors.text, fontSize: 15, lineHeight: 21, marginTop: 8 },
  note: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
