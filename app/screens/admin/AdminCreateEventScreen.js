import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ADMIN_MAX_MARGIN_MINUTES, adminTimezones } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminDemoTools from './components/AdminDemoTools';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminOptions from './components/AdminOptions';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { waitAdminDemoLatency } from './adminDemoLatency';
import { createEvent, validateEventDraft } from './adminDemoState';
import MarginShortcuts from './components/MarginShortcuts';
import { formatInstantWithZone, formatUtcOffset, maskDateInput, maskTimeInput, minutesBetween } from './adminTime';
import { useAdminConfirmation } from './useAdminConfirmation';

const EMPTY_DRAFT = {
  name: '',
  accessCode: '',
  timezone: null,
  startDate: '',
  startTime: '',
  officialEndDate: '',
  officialEndTime: '',
  operationalDeadlineDate: '',
  operationalDeadlineTime: '',
  externalQueueEnabled: null,
  reason: '',
};

const TIMEZONE_OPTIONS = adminTimezones.map((zone) => ({
  value: zone.id,
  label: `${zone.label} (${formatUtcOffset(zone.offsetMinutes)})`,
  accessibilityLabel: `${zone.id}, ${zone.label}, ${formatUtcOffset(zone.offsetMinutes)}`,
}));

const QUEUE_OPTIONS = [
  { value: true, label: 'Habilitada', accessibilityLabel: 'Fila externa habilitada' },
  { value: false, label: 'Desabilitada', accessibilityLabel: 'Fila externa desabilitada' },
];

// Criar Evento (ADM01, §18.3): somente os campos do DTO aprovado. Não há
// local, tipo, descrição nem seleção de catálogo/estações.
export default function AdminCreateEventScreen({ navigation }) {
  const { session, run } = useAdminDemo();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const confirmation = useAdminConfirmation();
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  if (!session) {
    return (
      <AdminMissing
        title="Sessão indisponível"
        message="Abra a Área Admin novamente a partir do aplicativo."
        actionLabel="VOLTAR"
        onAction={() => navigation.goBack()}
      />
    );
  }

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (errors[field] || formError) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
      setFormError('');
    }
  }

  // Prévia ao vivo: mostra como os horários serão interpretados no fuso escolhido.
  const preview = validateEventDraft(draft, session.events);

  function handleSubmit() {
    if (saving) return;
    const validation = validateEventDraft(draft, session.events);
    if (!validation.ok) {
      setErrors(validation.errors);
      setFormError('Revise os campos destacados.');
      return;
    }
    setErrors({});
    setFormError('');
    // Snapshot único: o diálogo mostra e a criação grava exatamente este rascunho.
    confirmation.open({ draft: { ...draft }, payload: validation.payload });
  }

  // Executa no máximo uma vez por confirmação válida, com o snapshot revisado.
  async function handleConfirm(token) {
    const snapshot = confirmation.claim(token);
    if (!snapshot) return;
    setSaving(true);
    await waitAdminDemoLatency();
    if (!mountedRef.current) return;
    const result = run(createEvent, snapshot.draft);
    confirmation.release();
    setSaving(false);
    if (!result.ok) {
      if (result.errors) setErrors(result.errors);
      setFormError(result.message);
      return;
    }
    navigation.replace('AdminEventDetail', { eventId: result.eventId, created: true });
  }

  return (
    <AdminScreen
      title="Criar"
      highlight="Evento"
      subtitle="Cadastre o evento. Ele nasce Agendado e ainda não pronto; experiências, estações e Staff são configurados depois."
      backLabel="Voltar"
      onBack={() => navigation.goBack()}
    >
      <AdminField
        label="Nome do evento *"
        value={draft.name}
        onChangeText={(value) => update('name', value)}
        placeholder="Ex.: BEAST MARAGAMES — Dia 3"
        error={errors.name}
        maxLength={180}
        editable={!saving}
      />
      <AdminField
        label="Código de ingresso *"
        hint="Único em todo o histórico (inclusive eventos encerrados) e imutável depois de criado. Espaços externos e maiúsculas/minúsculas são ignorados."
        value={draft.accessCode}
        onChangeText={(value) => update('accessCode', value)}
        placeholder="Ex.: BEAST-D3"
        autoCapitalize="characters"
        error={errors.accessCode}
        maxLength={64}
        editable={!saving}
      />
      <AdminOptions
        label="Fuso horário do evento (IANA) *"
        hint="Os horários abaixo são interpretados neste fuso, não no fuso do celular."
        options={TIMEZONE_OPTIONS}
        value={draft.timezone}
        onChange={(value) => update('timezone', value)}
        error={errors.timezone}
        disabled={saving}
      />

      <AdminField
        label="Data de início *"
        hint="DD/MM/AAAA"
        value={draft.startDate}
        onChangeText={(value) => update('startDate', maskDateInput(value))}
        placeholder="05/11/2026"
        keyboardType="number-pad"
        error={errors.startsAt}
        editable={!saving}
      />
      <AdminField
        label="Hora de início *"
        hint="HH:MM (24 h)"
        value={draft.startTime}
        onChangeText={(value) => update('startTime', maskTimeInput(value))}
        placeholder="10:00"
        keyboardType="number-pad"
        editable={!saving}
      />
      <AdminField
        label="Data do encerramento oficial *"
        hint="A partir deste horário não entram novas participações."
        value={draft.officialEndDate}
        onChangeText={(value) => update('officialEndDate', maskDateInput(value))}
        placeholder="05/11/2026"
        keyboardType="number-pad"
        error={errors.officialEndsAt}
        editable={!saving}
      />
      <AdminField
        label="Hora do encerramento oficial *"
        hint="HH:MM (24 h)"
        value={draft.officialEndTime}
        onChangeText={(value) => update('officialEndTime', maskTimeInput(value))}
        placeholder="18:00"
        keyboardType="number-pad"
        editable={!saving}
      />
      <AdminField
        label="Data do limite operacional *"
        hint={`Entre o encerramento oficial e no máximo ${ADMIN_MAX_MARGIN_MINUTES} min depois (igual ao oficial é permitido). Serve só para atender quem já aguardava.`}
        value={draft.operationalDeadlineDate}
        onChangeText={(value) => update('operationalDeadlineDate', maskDateInput(value))}
        placeholder="05/11/2026"
        keyboardType="number-pad"
        error={errors.operationalDeadlineAt}
        editable={!saving}
      />
      <AdminField
        label="Hora do limite operacional *"
        hint="HH:MM (24 h)"
        value={draft.operationalDeadlineTime}
        onChangeText={(value) => update('operationalDeadlineTime', maskTimeInput(value))}
        placeholder="18:30"
        keyboardType="number-pad"
        editable={!saving}
      />
      <MarginShortcuts
        officialDate={draft.officialEndDate}
        officialTime={draft.officialEndTime}
        disabled={saving}
        onPick={(value) => {
          update('operationalDeadlineDate', value.date);
          update('operationalDeadlineTime', value.time);
        }}
      />

      {preview.ok ? (
        <AdminCard>
          <Text style={styles.previewTitle}>Como os horários serão gravados</Text>
          <Text style={styles.previewLine}>Início: {formatInstantWithZone(preview.payload.startsAt, preview.payload.timezone)}</Text>
          <Text style={styles.previewLine}>Encerramento oficial: {formatInstantWithZone(preview.payload.officialEndsAt, preview.payload.timezone)}</Text>
          <Text style={styles.previewLine}>
            Limite operacional: {formatInstantWithZone(preview.payload.operationalDeadlineAt, preview.payload.timezone)}
            {' '}(+{minutesBetween(preview.payload.officialEndsAt, preview.payload.operationalDeadlineAt)} min)
          </Text>
          <Text style={styles.previewUtc}>Em UTC: {preview.payload.startsAt} · {preview.payload.officialEndsAt} · {preview.payload.operationalDeadlineAt}</Text>
        </AdminCard>
      ) : null}

      <AdminOptions
        label="Fila externa *"
        hint="Habilitada: novos participantes aguardam na fila externa antes de entrar na Arena."
        options={QUEUE_OPTIONS}
        value={draft.externalQueueEnabled}
        onChange={(value) => update('externalQueueEnabled', value)}
        error={errors.externalQueueEnabled}
        disabled={saving}
      />

      <AdminField
        label="Justificativa do cadastro *"
        hint="Fica no registro local da demonstração (a auditoria real será do backend)."
        value={draft.reason}
        onChangeText={(value) => update('reason', value)}
        placeholder="Ex.: Cadastro e preparação do evento"
        error={errors.reason}
        multiline
        editable={!saving}
      />

      <AdminNotice
        tone="info"
        message="Depois de criado, o evento aparece em Gerenciar Eventos como Agendado e não pronto: faltarão uma experiência com estação disponível e um Staff autorizado. Ele abre sozinho no horário de início quando estiver pronto."
      />

      {formError ? <AdminNotice tone="error" title="Não foi possível criar" message={formError} /> : null}

      <AdminButton
        label={saving ? 'CRIANDO...' : 'CRIAR EVENTO'}
        loading={saving}
        onPress={handleSubmit}
      />
      <AdminButton label="Cancelar" variant="secondary" onPress={() => navigation.goBack()} disabled={saving} />

      <AdminDemoTools disabled={saving} />

      <AdminConfirmDialog
        visible={confirmation.visible}
        title="Criar este evento na demonstração?"
        message={confirmation.snapshot
          ? `${confirmation.snapshot.payload.name} · código ${confirmation.snapshot.payload.accessCode}\nInício: ${formatInstantWithZone(confirmation.snapshot.payload.startsAt, confirmation.snapshot.payload.timezone)}\nFila externa: ${confirmation.snapshot.payload.externalQueueEnabled ? 'habilitada' : 'desabilitada'}`
          : ''}
        note="O código não poderá ser alterado depois. Nada será enviado ao servidor."
        confirmLabel="CRIAR EVENTO"
        onConfirm={() => handleConfirm(confirmation.pending)}
        onCancel={confirmation.cancel}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  previewTitle: { color: adminColors.text, fontSize: 14, fontWeight: 'bold' },
  previewLine: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  previewUtc: { color: adminColors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
});
