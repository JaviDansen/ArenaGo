import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminOptions from './components/AdminOptions';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { waitAdminDemoLatency } from './adminDemoLatency';
import { closeEvent, findEvent, getCloseAvailability } from './adminDemoState';
import { formatInstantWithZone } from './adminTime';
import { useAdminConfirmation } from './useAdminConfirmation';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

const MODE_OPTIONS = [
  { value: 'immediate', label: 'Imediato', accessibilityLabel: 'Modo imediato' },
  { value: 'controlled', label: 'Controlado', accessibilityLabel: 'Modo controlado' },
];

const EFFECTS = {
  immediate: 'Bloqueia agora novas entradas e chamadas, cancela esperas e chamadas pendentes e finaliza todas as participações abertas. Conclusões anteriores são preservadas; quem for elegível poderá avaliar ao voltar ao app.',
  controlled: 'Bloqueia agora novas entradas e inscrições em filas. Quem aguarda na fila externa é finalizado agora, sem avaliação. Filas e atendimentos internos já existentes continuam até o prazo escolhido.',
};

// Encerramento antecipado (§17.8, D09): modos imediato e controlado, com
// justificativa obrigatória e janela válida. Não existe reabertura.
export default function AdminEventCloseScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const event = session ? findEvent(session, eventId) : null;
  const [mode, setMode] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const confirmation = useAdminConfirmation();
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  if (!event) {
    return (
      <AdminMissing title="Evento não encontrado" message="Volte e escolha um evento." actionLabel="VOLTAR" onAction={() => navigation.goBack()} />
    );
  }

  const availability = getCloseAvailability(event, session.clockNow);
  const done = message?.tone === 'success';

  function clearFeedback() {
    if (Object.keys(errors).length) setErrors({});
    if (message && !done) setMessage(null);
  }

  function handleReview() {
    if (saving) return;
    if (!mode) {
      setErrors({ mode: 'Escolha o modo de encerramento.' });
      return;
    }
    if (mode === 'controlled' && availability.controlledBlocked) {
      setErrors({ mode: availability.controlledBlocked });
      return;
    }
    confirmation.open({ eventId: event.id, input: { mode, controlledMinutes: minutes, reason } });
  }

  // Executa no máximo uma vez por confirmação válida, com o snapshot revisado.
  async function handleConfirm(token) {
    const snapshot = confirmation.claim(token);
    if (!snapshot) return;
    setSaving(true);
    await waitAdminDemoLatency();
    if (!mountedRef.current) return;
    const result = run(closeEvent, snapshot.eventId, snapshot.input);
    confirmation.release();
    setSaving(false);
    setErrors(result.errors ?? {});
    setMessage({ tone: result.ok ? 'success' : 'error', text: result.message });
  }

  return (
    <AdminScreen
      title="Encerrar"
      highlight="Evento"
      subtitle={`${event.name} · ${event.accessCode}`}
      backLabel="Evento"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={styles.line}>Limite operacional autorizado: {formatInstantWithZone(event.operationalDeadlineAt, event.timezone)}</Text>
        <Text style={styles.line}>Aguardando na fila externa: {event.participants.externalWaiting}</Text>
        <Text style={styles.line}>Ativas na Arena: {event.participants.active}</Text>
        <Text style={styles.muted}>O encerramento não pode ser desfeito: não há reabertura.</Text>
      </AdminCard>

      {!availability.allowed && !done ? (
        <AdminNotice tone="warning" title="Encerramento indisponível" message={availability.message} />
      ) : null}

      {availability.allowed && !done ? (
        <>
          <AdminOptions
            label="Modo de encerramento *"
            options={MODE_OPTIONS}
            value={mode}
            onChange={(value) => { setMode(value); clearFeedback(); }}
            error={errors.mode}
            disabled={saving}
          />
          {mode ? <AdminNotice tone="warning" title="Efeitos" message={EFFECTS[mode]} /> : null}
          {mode === 'controlled' && availability.controlledBlocked ? (
            <AdminNotice tone="neutral" message={availability.controlledBlocked} />
          ) : null}
          {mode === 'controlled' && !availability.controlledBlocked ? (
            <AdminField
              label="Prazo controlado (minutos a partir de agora) *"
              hint={`De 1 a ${availability.maxControlledMinutes} min: no máximo 60 e nunca além do limite operacional autorizado.`}
              value={minutes}
              onChangeText={(value) => { setMinutes(value.replace(/\D/g, '').slice(0, 3)); clearFeedback(); }}
              keyboardType="number-pad"
              error={errors.controlledMinutes}
              editable={!saving}
            />
          ) : null}
          <AdminField
            label="Justificativa *"
            hint="Registrada para auditoria; não é mostrada ao participante."
            value={reason}
            onChangeText={(value) => { setReason(value); clearFeedback(); }}
            placeholder="Ex.: Interrupção operacional registrada pela organização"
            error={errors.reason}
            multiline
            editable={!saving}
          />
        </>
      ) : null}

      {message ? (
        <AdminNotice tone={message.tone} title={done ? 'Encerramento registrado' : 'Não foi possível encerrar'} message={message.text} />
      ) : null}

      {availability.allowed && !done ? (
        <AdminButton label={saving ? 'ENCERRANDO...' : 'REVISAR ENCERRAMENTO'} variant="danger" loading={saving} onPress={handleReview} />
      ) : null}
      <AdminButton label={done ? 'Voltar ao evento' : 'Cancelar'} variant="secondary" disabled={saving} onPress={() => navigation.goBack()} />

      <AdminConfirmDialog
        visible={confirmation.visible}
        title={confirmation.snapshot?.input.mode === 'immediate' ? 'Encerrar imediatamente?' : 'Iniciar encerramento controlado?'}
        message={confirmation.snapshot ? EFFECTS[confirmation.snapshot.input.mode] : ''}
        note="Esta ação é simulada e não pode ser desfeita nesta demonstração."
        confirmLabel="ENCERRAR EVENTO"
        variant="danger"
        onConfirm={() => handleConfirm(confirmation.pending)}
        onCancel={confirmation.cancel}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
});
