import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ADMIN_STATION_LABEL_MAX_LENGTH } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminDemoTools from './components/AdminDemoTools';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import {
  ADMIN_PENDING_CALL_MESSAGE,
  describeEvent,
  describeStation,
  findEvent,
  findExperience,
  findStation,
  getStructureRules,
  renameStation,
  setStationAvailability,
} from './adminDemoState';
import { formatInstant } from './adminTime';
import { useAdminAction } from './useAdminAction';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

const AVAILABILITY_EFFECTS = {
  unavailable: 'A estação deixa de receber novas chamadas. A fila da experiência não fecha, ninguém é transferido e quem já aguarda continua na mesma posição. Se for a última estação disponível, novas entradas ficam suspensas, sem encerrar o evento.',
  available: 'A estação volta a receber chamadas e a contar para a capacidade. Isso não reabre um evento encerrado nem libera entradas depois do corte.',
};

// Estação (ADM02): disponibilidade é um comando OPERACIONAL (§16.7), separado
// da identificação estrutural (label). Não existe Staff fixo nem fila própria.
export default function AdminStationDetailScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const experienceId = ownParam(route?.params, 'experienceId');
  const stationId = ownParam(route?.params, 'stationId');
  const event = session ? findEvent(session, eventId) : null;
  const experience = event ? findExperience(session, event.id, experienceId) : null;
  // Cadeia estação → experiência → evento validada antes de mostrar qualquer ação.
  const station = experience ? findStation(session, event.id, experience.id, stationId) : null;
  const [label, setLabel] = useState(() => station?.label ?? '');
  const action = useAdminAction(run);

  if (!event || !experience || !station) {
    return (
      <AdminMissing
        title="Estação não encontrada"
        message="Esta estação não existe nesta experiência do evento."
        actionLabel="VOLTAR"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const info = describeEvent(event, session.clockNow, session);
  const rules = getStructureRules(session, event);
  const { available, pendingCall } = describeStation(session, station, info.phase);
  const target = available ? 'unavailable' : 'available';
  const deactivationBlocked = available && Boolean(pendingCall);
  const availabilityFeedback = action.feedbackFor('availability');
  const labelFeedback = action.feedbackFor('renameStation');
  const pendingKind = action.snapshot?.kind;

  function handleAvailability() {
    if (action.busy || deactivationBlocked) return;
    action.review({
      kind: 'availability',
      transition: setStationAvailability,
      args: [event.id, experience.id, station.id, { availability: target }],
      target,
    });
  }

  function handleRename() {
    if (action.busy) return;
    const trimmed = label.trim();
    if (!trimmed) {
      action.reject('renameStation', 'Revise a identificação da estação.', { label: 'Informe a identificação da estação.' });
      return;
    }
    if (trimmed === station.label) {
      action.reject('renameStation', 'A identificação informada é igual à atual.');
      return;
    }
    action.review({
      kind: 'renameStation',
      transition: renameStation,
      args: [event.id, experience.id, station.id, { label: trimmed }],
      summary: `${station.label} → ${trimmed}`,
    });
  }

  const dialogTitle = pendingKind === 'renameStation'
    ? 'Alterar a identificação da estação?'
    : action.snapshot?.target === 'unavailable' ? 'Tornar a estação indisponível?' : 'Tornar a estação disponível?';
  const dialogMessage = pendingKind === 'renameStation'
    ? action.snapshot.summary
    : action.snapshot ? AVAILABILITY_EFFECTS[action.snapshot.target] : '';

  return (
    <AdminScreen
      title={station.label}
      subtitle={`Estação de ${experience.name} · ${event.name}`}
      backLabel="Experiência"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={available ? styles.ok : styles.warning}>Disponibilidade: {available ? 'disponível' : 'indisponível'}</Text>
        <Text style={styles.line}>
          Ocupação: {rules.ended
            ? 'sem chamadas vigentes (evento encerrado)'
            : pendingCall
              ? `chamada pendente desde ${formatInstant(pendingCall.calledAt, event.timezone)} (fictícia)`
              : 'livre (sem chamada pendente)'}
        </Text>
        <Text style={styles.muted}>
          Disponível não quer dizer livre. A estação atende a fila única de {experience.name}; não tem Staff fixo nem fila própria.
        </Text>
      </AdminCard>

      <Text style={styles.sectionTitle} accessibilityRole="header">Disponibilidade</Text>
      {rules.setAvailability.allowed ? (
        <>
          {deactivationBlocked ? (
            <AdminNotice tone="warning" title="Desativação bloqueada" message={ADMIN_PENDING_CALL_MESSAGE} />
          ) : null}
          <AdminButton
            label={action.saving === 'availability'
              ? 'SALVANDO...'
              : available ? 'TORNAR INDISPONÍVEL' : 'TORNAR DISPONÍVEL'}
            variant={available ? 'danger' : 'primary'}
            loading={action.saving === 'availability'}
            disabled={action.busy || deactivationBlocked}
            onPress={handleAvailability}
          />
        </>
      ) : (
        <AdminNotice tone="warning" title="Disponibilidade indisponível" message={rules.setAvailability.message} />
      )}
      {availabilityFeedback ? (
        <AdminNotice
          tone={availabilityFeedback.tone}
          title={availabilityFeedback.tone === 'success' ? 'Disponibilidade atualizada' : 'Não foi possível alterar'}
          message={availabilityFeedback.text}
        />
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Identificação</Text>
      {rules.renameStation.allowed ? (
        <>
          <AdminField
            label="Identificação da estação *"
            hint={`Até ${ADMIN_STATION_LABEL_MAX_LENGTH} caracteres. A estação continua na mesma experiência.`}
            value={label}
            onChangeText={(value) => {
              setLabel(value);
              if (labelFeedback && labelFeedback.tone === 'error') action.clearFeedback();
            }}
            error={labelFeedback?.errors?.label}
            maxLength={ADMIN_STATION_LABEL_MAX_LENGTH}
            editable={!action.busy}
          />
          <AdminButton
            label={action.saving === 'renameStation' ? 'SALVANDO...' : 'SALVAR IDENTIFICAÇÃO'}
            variant="secondary"
            loading={action.saving === 'renameStation'}
            disabled={action.busy}
            onPress={handleRename}
          />
        </>
      ) : (
        <AdminNotice tone="warning" title="Alterar identificação indisponível" message={rules.renameStation.message} />
      )}
      {labelFeedback ? (
        <AdminNotice
          tone={labelFeedback.tone}
          title={labelFeedback.tone === 'success' ? 'Identificação atualizada' : 'Não foi possível alterar'}
          message={labelFeedback.text}
        />
      ) : null}

      <AdminButton label="Voltar à experiência" variant="secondary" disabled={action.busy} onPress={() => navigation.goBack()} />

      <AdminDemoTools disabled={action.busy} />

      <AdminConfirmDialog
        visible={action.dialog.visible}
        title={dialogTitle}
        message={dialogMessage}
        note="Simulação local: nada é enviado ao servidor."
        confirmLabel={pendingKind === 'renameStation' ? 'SALVAR IDENTIFICAÇÃO' : 'CONFIRMAR'}
        variant={action.snapshot?.target === 'unavailable' ? 'danger' : 'primary'}
        onConfirm={action.dialog.onConfirm}
        onCancel={action.dialog.onCancel}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  ok: { color: adminColors.success, fontSize: 13, lineHeight: 19, marginTop: 4 },
  warning: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
