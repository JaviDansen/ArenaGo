import { useEffect, useRef, useState } from 'react';
import { Clipboard, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import AdminButton from './AdminButton';
import { SettingsField, SettingsSection } from './AdminScheduleFields';
import { liveColors as c, liveStyles as s } from './AdminLiveUI';

export function eventQrPayload(code) {
  if (typeof code !== 'string' || code.length < 4 || code.length > 64 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) {
    throw new Error('Código de evento inválido.');
  }
  return code;
}
export function eventQrMatrix(code, encode = require('toqr').toQR) {
  const matrix = encode(eventQrPayload(code));
  const side = Math.sqrt(matrix.length);
  if (!Number.isInteger(side) || side < 21) throw new Error('Matriz QR inválida.');
  const quiet = 4;
  return Array.from({ length: side + 2 * quiet }, (_, row) =>
    Array.from({ length: side + 2 * quiet }, (_, col) => row >= quiet && col >= quiet && row < side + quiet &&
      col < side + quiet && matrix[(row - quiet) * side + col - quiet] === 1));
}

export default function AdminEventAccess({ code, isCurrent }) {
  const [feedback, setFeedback] = useState('');
  const [qr, setQr] = useState(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  let valid = false;
  try { valid = eventQrPayload(code) === code; } catch {}
  async function copy() {
    if (!valid || !isCurrent()) return;
    let message;
    try {
      if (Platform.OS === 'web') await globalThis.navigator.clipboard.writeText(code);
      else Clipboard.setString(code);
      message = 'Código copiado.';
    } catch { message = 'Não foi possível copiar. Selecione o código para copiar manualmente.'; }
    if (live.current && isCurrent()) setFeedback(message);
  }
  function openQr() {
    if (!valid || !isCurrent()) return;
    try { setQr({ matrix: eventQrMatrix(code) }); }
    catch { setQr({ error: 'Não foi possível gerar o QR Code. Use o código de acesso.' }); }
  }
  return <SettingsSection title="Acesso ao evento" icon="qr">
    <SettingsField label="Código de acesso" value={valid ? code : 'Código indisponível'} />
    <AdminButton label="Copiar" variant="secondary" compact disabled={!valid} onPress={copy} />
    <AdminButton label="Visualizar QR Code" variant="ghost" disabled={!valid} onPress={openQr} />
    <Text style={s.body}>O código de acesso é fixo após a criação do evento.</Text>
    {!!feedback && <Text accessibilityLiveRegion="polite" style={s.body}>{feedback}</Text>}
    {qr && <Modal visible transparent animationType="fade" onRequestClose={() => setQr(null)}>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={[s.card, styles.dialog]}>
          <Text accessibilityRole="header" style={s.title}>QR Code do evento</Text>
          {qr.error ? <Text accessibilityRole="alert" style={s.body}>{qr.error}</Text> : (
            <View accessible accessibilityRole="image" accessibilityLabel="QR Code com o código de acesso do evento" style={styles.matrix}>
              {qr.matrix.map((row, i) => <View key={i} style={styles.row}>
                {row.map((black, j) => <View key={j} style={black ? styles.blackCell : styles.cell} />)}
              </View>)}
            </View>
          )}
          <Text selectable style={s.title}>{code}</Text>
          <AdminButton label="Fechar QR Code" onPress={() => setQr(null)} />
        </View>
      </View>
    </Modal>}
  </SettingsSection>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#000c' },
  dialog: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 10 },
  matrix: { width: '100%', maxWidth: 288, aspectRatio: 1, backgroundColor: '#fff' },
  row: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1 },
  blackCell: { flex: 1, backgroundColor: '#000' },
});
