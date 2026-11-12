import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ADMIN_EXPERIENCE_NAME_MAX_LENGTH, ADMIN_STATION_LABEL_MAX_LENGTH, adminStationLabelPrefixes } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import AdminDemoTools from './components/AdminDemoTools';
import AdminField from './components/AdminField';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminScreen from './components/AdminScreen';
import AdminSuggestions from './components/AdminSuggestions';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import {
  addStation,
  describeExperience,
  findEvent,
  findExperience,
  getStructureRules,
  renameExperience,
} from './adminDemoState';
import { formatInstant } from './adminTime';
import { useAdminAction } from './useAdminAction';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

const DIALOGS = {
  renameExperience: {
    title: 'Renomear a experiência?',
    note: 'A fila e as estações continuam as mesmas. Depois da primeira participação do evento não será mais possível renomear.',
    confirmLabel: 'SALVAR NOME',
  },
  addStation: {
    title: 'Adicionar esta estação?',
    note: 'Ela começa disponível e atende a MESMA fila da experiência (não cria fila nova). Nada é enviado ao servidor.',
    confirmLabel: 'ADICIONAR ESTAÇÃO',
  },
};

// Detalhe da experiência (ADM02): nome, fila única e as estações que a
// atendem. Disponibilidade e ocupação aparecem como conceitos separados.
export default function AdminExperienceDetailScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const experienceId = ownParam(route?.params, 'experienceId');
  const event = session ? findEvent(session, eventId) : null;
  // A experiência só é encontrada pela cadeia deste evento (§18.1).
  const experience = event ? findExperience(session, event.id, experienceId) : null;
  const [name, setName] = useState(() => experience?.name ?? '');
  const [label, setLabel] = useState('');
  const action = useAdminAction(run);

  if (!event || !experience) {
    return (
      <AdminMissing
        title="Experiência não encontrada"
        message="Esta experiência não existe neste evento da demonstração."
        actionLabel="VOLTAR"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const rules = getStructureRules(session, event);
  const view = describeExperience(session, event, experience);
  const renameFeedback = action.feedbackFor('renameExperience');
  const stationFeedback = action.feedbackFor('addStation');
  const nextNumber = view.stationsTotal + 1;
  const labelSuggestions = adminStationLabelPrefixes.map((prefix) => `${prefix} ${nextNumber}`);
  const dialog = action.snapshot ? DIALOGS[action.snapshot.kind] : null;

  function handleRename() {
    if (action.busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      action.reject('renameExperience', 'Revise o nome da experiência.', { name: 'Informe o nome da experiência.' });
      return;
    }
    if (trimmed === experience.name) {
      action.reject('renameExperience', 'O nome informado é igual ao atual.');
      return;
    }
    action.review({
      kind: 'renameExperience',
      transition: renameExperience,
      args: [event.id, experience.id, { name: trimmed }],
      summary: `${experience.name} → ${trimmed}`,
    });
  }

  function handleAddStation() {
    if (action.busy) return;
    const trimmed = label.trim();
    if (!trimmed) {
      action.reject('addStation', 'Revise a identificação da estação.', { label: 'Informe a identificação da estação.' });
      return;
    }
    action.review({
      kind: 'addStation',
      transition: addStation,
      args: [event.id, experience.id, { label: trimmed }],
      summary: `${trimmed}\nExperiência: ${experience.name}`,
      onSuccess: () => setLabel(''),
    });
  }

  return (
    <AdminScreen
      title={experience.name}
      subtitle={`Experiência de ${event.name} · ${event.accessCode}`}
      backLabel="Experiências"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={styles.cardTitle}>Fila única da experiência</Text>
        <Text style={styles.line}>Aguardando: {view.queueWaiting} (fictício)</Text>
        <Text style={styles.line}>
          Atendida por {view.stationsTotal} estação(ões): todas chamam desta mesma fila. Não existe fila por estação.
        </Text>
        <Text style={view.acceptingNewEntries ? styles.ok : styles.warning}>
          {view.acceptingNewEntries
            ? 'Novas entradas nesta fila: aceitas (simulado).'
            : `Novas entradas nesta fila: suspensas — ${view.entriesBlockedReason}.`}
        </Text>
      </AdminCard>

      <Text style={styles.sectionTitle} accessibilityRole="header">Nome da experiência</Text>
      {rules.renameExperience.allowed ? (
        <>
          <AdminField
            label="Nome da experiência *"
            hint={`Até ${ADMIN_EXPERIENCE_NAME_MAX_LENGTH} caracteres.`}
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (renameFeedback && renameFeedback.tone === 'error') action.clearFeedback();
            }}
            error={renameFeedback?.errors?.name}
            maxLength={ADMIN_EXPERIENCE_NAME_MAX_LENGTH}
            editable={!action.busy}
          />
          <AdminButton
            label={action.saving === 'renameExperience' ? 'SALVANDO...' : 'SALVAR NOME'}
            variant="secondary"
            loading={action.saving === 'renameExperience'}
            disabled={action.busy}
            onPress={handleRename}
          />
        </>
      ) : (
        <AdminNotice tone="warning" title="Renomear indisponível" message={rules.renameExperience.message} />
      )}
      {renameFeedback ? (
        <AdminNotice
          tone={renameFeedback.tone}
          title={renameFeedback.tone === 'success' ? 'Nome atualizado' : 'Não foi possível renomear'}
          message={renameFeedback.text}
        />
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Estações</Text>
      <Text style={styles.muted}>
        Disponível não quer dizer livre: uma estação disponível pode estar ocupada por uma chamada pendente.
      </Text>
      {view.stations.length === 0 ? (
        <AdminNotice
          tone="neutral"
          title="Nenhuma estação nesta experiência"
          message="Sem estação disponível, esta experiência não conta para a prontidão e não aceita novas entradas."
        />
      ) : null}
      {view.stations.map(({ station, available, pendingCall }) => (
        <AdminCard
          key={station.id}
          onPress={() => navigation.navigate('AdminStationDetail', {
            eventId: event.id,
            experienceId: experience.id,
            stationId: station.id,
          })}
          accessibilityLabel={`Abrir estação ${station.label}`}
        >
          <Text style={styles.name}>{station.label}  →</Text>
          <Text style={available ? styles.ok : styles.warning}>
            Disponibilidade: {available ? 'disponível' : 'indisponível'}
          </Text>
          <Text style={styles.line}>
            Ocupação: {rules.ended
              ? 'sem chamadas vigentes (evento encerrado)'
              : pendingCall
                ? `chamada pendente desde ${formatInstant(pendingCall.calledAt, event.timezone)} (fictícia)`
                : 'livre (sem chamada pendente)'}
          </Text>
        </AdminCard>
      ))}

      <Text style={styles.sectionTitle} accessibilityRole="header">Adicionar estação</Text>
      {rules.addStation.allowed ? (
        <>
          {rules.history ? (
            <Text style={styles.muted}>
              O evento já teve participação, mas adicionar estação a uma experiência existente continua permitido: ela entra na mesma fila.
            </Text>
          ) : null}
          <AdminField
            label="Identificação da nova estação *"
            hint={`Até ${ADMIN_STATION_LABEL_MAX_LENGTH} caracteres.`}
            value={label}
            onChangeText={(value) => {
              setLabel(value);
              if (stationFeedback && stationFeedback.tone === 'error') action.clearFeedback();
            }}
            placeholder={`Ex.: Estação ${nextNumber}`}
            error={stationFeedback?.errors?.label}
            maxLength={ADMIN_STATION_LABEL_MAX_LENGTH}
            editable={!action.busy}
          />
          <AdminSuggestions
            label="Atalhos de preenchimento (não é um catálogo de estações):"
            items={labelSuggestions}
            disabled={action.busy}
            onPick={(value) => {
              setLabel(value);
              if (stationFeedback && stationFeedback.tone === 'error') action.clearFeedback();
            }}
          />
          <AdminButton
            label={action.saving === 'addStation' ? 'ADICIONANDO...' : 'ADICIONAR ESTAÇÃO'}
            loading={action.saving === 'addStation'}
            disabled={action.busy}
            onPress={handleAddStation}
          />
        </>
      ) : (
        <AdminNotice tone="warning" title="Adicionar estação indisponível" message={rules.addStation.message} />
      )}
      {stationFeedback ? (
        <AdminNotice
          tone={stationFeedback.tone}
          title={stationFeedback.tone === 'success' ? 'Estação adicionada' : 'Não foi possível adicionar'}
          message={stationFeedback.text}
        />
      ) : null}

      <AdminButton label="Voltar às experiências" variant="secondary" disabled={action.busy} onPress={() => navigation.goBack()} />

      <AdminDemoTools disabled={action.busy} />

      <AdminConfirmDialog
        visible={action.dialog.visible}
        title={dialog?.title ?? ''}
        message={action.snapshot?.summary ?? ''}
        note={dialog?.note}
        confirmLabel={dialog?.confirmLabel}
        onConfirm={action.dialog.onConfirm}
        onCancel={action.dialog.onCancel}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: adminColors.text, fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  name: { color: adminColors.text, fontSize: 16, fontWeight: 'bold' },
  sectionTitle: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  ok: { color: adminColors.success, fontSize: 13, lineHeight: 19, marginTop: 6 },
  warning: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 6 },
});
