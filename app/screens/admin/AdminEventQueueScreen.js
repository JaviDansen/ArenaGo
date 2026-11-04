import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { waitAdminDemoLatency } from './adminDemoLatency';
import { findEvent, getExternalQueueAvailability, setExternalQueue } from './adminDemoState';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

// Fila externa (§17.10): operação distinta das novas inscrições. Desligar
// libera quem espera; religar vale só para as próximas entradas.
export default function AdminEventQueueScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const event = session ? findEvent(session, eventId) : null;
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  // Alvo fixado ao abrir a tela: a ação nunca inverte de novo por um clique repetido.
  const [target] = useState(() => (event ? !event.externalQueueEnabled : null));
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

  const availability = getExternalQueueAvailability(event, session.clockNow);
  const done = message?.tone === 'success';
  const actionLabel = target ? 'HABILITAR FILA EXTERNA' : 'DESABILITAR FILA EXTERNA';
  const effect = target
    ? 'Habilitar vale apenas para as próximas participações. Quem já está ativo na Arena não volta para a fila externa.'
    : `Desabilitar libera agora os ${event.participants.externalWaiting} participante(s) que aguardam na fila externa para dentro da Arena (simulado). Não muda o horário de inscrições.`;

  async function handleConfirm() {
    setConfirming(false);
    setSaving(true);
    await waitAdminDemoLatency();
    if (!mountedRef.current) return;
    const result = run(setExternalQueue, event.id, { enabled: target, reason });
    setSaving(false);
    setErrors(result.errors ?? {});
    setMessage({ tone: result.ok ? 'success' : 'error', text: result.message });
  }

  return (
    <AdminScreen
      title="Fila"
      highlight="Externa"
      subtitle={`${event.name} · ${event.accessCode}`}
      backLabel="Evento"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={styles.line}>Situação atual: {event.externalQueueEnabled ? 'habilitada' : 'desabilitada'}</Text>
        <Text style={styles.line}>Aguardando na fila externa: {event.participants.externalWaiting}</Text>
        <Text style={styles.muted}>
          Esta ação é diferente de encerrar inscrições: ela não muda o horário oficial nem reabre entradas.
        </Text>
      </AdminCard>

      {!availability.allowed && !done ? (
        <AdminNotice tone="warning" title="Alteração indisponível" message={availability.message} />
      ) : null}

      {availability.allowed && !done ? (
        <>
          <AdminNotice tone="info" title="Efeito desta ação" message={effect} />
          <AdminField
            label="Justificativa *"
            value={reason}
            onChangeText={(value) => {
              setReason(value);
              if (errors.reason) setErrors({});
              if (message) setMessage(null);
            }}
            placeholder="Ex.: Fluxo de público reduzido"
            error={errors.reason}
            multiline
            editable={!saving}
          />
        </>
      ) : null}

      {message ? (
        <AdminNotice tone={message.tone} title={done ? 'Fila externa atualizada' : 'Não foi possível alterar'} message={message.text} />
      ) : null}

      {availability.allowed && !done ? (
        <AdminButton label={saving ? 'SALVANDO...' : actionLabel} loading={saving} onPress={() => setConfirming(true)} />
      ) : null}
      <AdminButton label={done ? 'Voltar ao evento' : 'Cancelar'} variant="secondary" disabled={saving} onPress={() => navigation.goBack()} />

      <AdminConfirmDialog
        visible={confirming}
        title={target ? 'Habilitar a fila externa?' : 'Desabilitar a fila externa?'}
        message={effect}
        confirmLabel={actionLabel}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
});
