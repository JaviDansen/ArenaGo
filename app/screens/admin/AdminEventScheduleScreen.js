import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ADMIN_MAX_MARGIN_MINUTES } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import MarginShortcuts from './components/MarginShortcuts';
import { useAdminDemo } from './AdminDemoContext';
import { waitAdminDemoLatency } from './adminDemoLatency';
import { changeSchedule, findEvent, getScheduleChangeAvailability } from './adminDemoState';
import { formatInstantWithZone, maskDateInput, maskTimeInput, splitInstant } from './adminTime';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

// Alterar horários (§17.9): ação própria, não um PATCH genérico. Muda o
// encerramento oficial e o limite operacional juntos, só antes do corte oficial.
export default function AdminEventScheduleScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const event = session ? findEvent(session, eventId) : null;
  const initial = event ? splitInstant(event.officialEndsAt, event.timezone) : null;
  const initialDeadline = event ? splitInstant(event.operationalDeadlineAt, event.timezone) : null;
  const [form, setForm] = useState(() => ({
    officialEndDate: initial?.date ?? '',
    officialEndTime: initial?.time ?? '',
    operationalDeadlineDate: initialDeadline?.date ?? '',
    operationalDeadlineTime: initialDeadline?.time ?? '',
    reason: '',
  }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [confirming, setConfirming] = useState(false);
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

  const availability = getScheduleChangeAvailability(event, session.clockNow);
  const done = message?.tone === 'success';

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (message && !done) setMessage(null);
  }

  async function handleConfirm() {
    setConfirming(false);
    setSaving(true);
    await waitAdminDemoLatency();
    if (!mountedRef.current) return;
    const result = run(changeSchedule, event.id, form);
    setSaving(false);
    setErrors(result.errors ?? {});
    setMessage({ tone: result.ok ? 'success' : 'error', text: result.message });
  }

  return (
    <AdminScreen
      title="Alterar"
      highlight="Horários"
      subtitle={`${event.name} · ${event.accessCode}`}
      backLabel="Evento"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={styles.line}>Fuso de interpretação: {event.timezone}</Text>
        <Text style={styles.line}>Início (não muda nesta ação): {formatInstantWithZone(event.startsAt, event.timezone)}</Text>
        <Text style={styles.line}>Encerramento oficial atual: {formatInstantWithZone(event.officialEndsAt, event.timezone)}</Text>
        <Text style={styles.line}>Limite operacional atual: {formatInstantWithZone(event.operationalDeadlineAt, event.timezone)}</Text>
      </AdminCard>

      {!availability.allowed && !done ? (
        <AdminNotice tone="warning" title="Alteração indisponível" message={availability.message} />
      ) : null}

      {availability.allowed && !done ? (
        <>
          <AdminField
            label="Nova data do encerramento oficial *"
            hint="DD/MM/AAAA, no fuso do evento."
            value={form.officialEndDate}
            onChangeText={(value) => update('officialEndDate', maskDateInput(value))}
            keyboardType="number-pad"
            error={errors.officialEndsAt}
            editable={!saving}
          />
          <AdminField
            label="Nova hora do encerramento oficial *"
            hint="HH:MM (24 h). Precisa ser depois do horário atual e do início."
            value={form.officialEndTime}
            onChangeText={(value) => update('officialEndTime', maskTimeInput(value))}
            keyboardType="number-pad"
            editable={!saving}
          />
          <AdminField
            label="Nova data do limite operacional *"
            hint={`Entre o novo encerramento oficial e no máximo ${ADMIN_MAX_MARGIN_MINUTES} min depois (igual é permitido).`}
            value={form.operationalDeadlineDate}
            onChangeText={(value) => update('operationalDeadlineDate', maskDateInput(value))}
            keyboardType="number-pad"
            error={errors.operationalDeadlineAt}
            editable={!saving}
          />
          <AdminField
            label="Nova hora do limite operacional *"
            hint="HH:MM (24 h)"
            value={form.operationalDeadlineTime}
            onChangeText={(value) => update('operationalDeadlineTime', maskTimeInput(value))}
            keyboardType="number-pad"
            editable={!saving}
          />
          <MarginShortcuts
            officialDate={form.officialEndDate}
            officialTime={form.officialEndTime}
            disabled={saving}
            onPick={(value) => {
              update('operationalDeadlineDate', value.date);
              update('operationalDeadlineTime', value.time);
            }}
          />
          <AdminField
            label="Justificativa *"
            value={form.reason}
            onChangeText={(value) => update('reason', value)}
            placeholder="Ex.: Ajuste solicitado pela organização"
            error={errors.reason}
            multiline
            editable={!saving}
          />
        </>
      ) : null}

      {message ? (
        <AdminNotice tone={message.tone} title={done ? 'Horários atualizados' : 'Não foi possível alterar'} message={message.text} />
      ) : null}

      {availability.allowed && !done ? (
        <AdminButton
          label={saving ? 'SALVANDO...' : 'SALVAR HORÁRIOS'}
          loading={saving}
          onPress={() => setConfirming(true)}
        />
      ) : null}
      <AdminButton label={done ? 'Voltar ao evento' : 'Cancelar'} variant="secondary" disabled={saving} onPress={() => navigation.goBack()} />

      <AdminConfirmDialog
        visible={confirming}
        title="Alterar os horários?"
        message="O encerramento oficial e o limite operacional serão atualizados juntos."
        note="Depois que o horário oficial for alcançado não será possível alterar nem reabrir o evento."
        confirmLabel="ALTERAR HORÁRIOS"
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
