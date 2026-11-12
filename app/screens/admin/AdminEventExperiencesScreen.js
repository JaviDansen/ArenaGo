import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ADMIN_EXPERIENCE_NAME_MAX_LENGTH, adminExperienceNameSuggestions } from '../../data/adminDemoData';
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
  createExperience,
  describeEvent,
  describeExperience,
  findEvent,
  getStructureRules,
  listExperiences,
  phaseText,
} from './adminDemoState';
import { useAdminAction } from './useAdminAction';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

// Experiências do evento (ADM02, §18.5): somente as deste evento, cada uma com
// UMA fila compartilhada por todas as suas estações. Não há catálogo global.
export default function AdminEventExperiencesScreen({ navigation, route }) {
  const { session, run } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const event = session ? findEvent(session, eventId) : null;
  const [name, setName] = useState('');
  const action = useAdminAction(run);

  if (!event) {
    return (
      <AdminMissing title="Evento não encontrado" message="Volte e escolha um evento." actionLabel="VOLTAR" onAction={() => navigation.goBack()} />
    );
  }

  const info = describeEvent(event, session.clockNow, session);
  const rules = getStructureRules(session, event);
  const items = listExperiences(session, event.id)
    .map((experience) => ({ experience, view: describeExperience(session, event, experience) }));
  const creating = action.saving === 'createExperience';
  const feedback = action.feedbackFor('createExperience');

  function handleReview() {
    if (action.busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      action.reject('createExperience', 'Revise o nome da experiência.', { name: 'Informe o nome da experiência.' });
      return;
    }
    action.review({
      kind: 'createExperience',
      transition: createExperience,
      args: [event.id, { name: trimmed }],
      name: trimmed,
      onSuccess: () => setName(''),
    });
  }

  return (
    <AdminScreen
      title="Experiências"
      highlight="e Estações"
      subtitle={`${event.name} · ${event.accessCode} · ${phaseText(info.phase)}`}
      backLabel="Evento"
      onBack={() => navigation.goBack()}
    >
      <AdminCard>
        <Text style={styles.line}>
          Cada experiência pertence somente a este evento e tem uma única fila, compartilhada por todas as suas estações.
        </Text>
        <Text style={styles.line}>
          Experiências com estação disponível: {info.readiness.structure.experiencesWithAvailableStation} de {info.readiness.structure.experiences}
        </Text>
        <Text style={info.acceptingNewParticipations ? styles.ok : styles.muted}>
          {info.acceptingNewParticipations
            ? 'Evento aceitando novas participações (simulado).'
            : 'Evento sem novas participações agora.'}
        </Text>
      </AdminCard>

      {items.length === 0 ? (
        <AdminNotice
          tone="neutral"
          title="Nenhuma experiência cadastrada"
          message="Cadastre a primeira experiência abaixo e depois adicione estações a ela. Sem experiência com estação disponível o evento não fica pronto."
        />
      ) : null}

      {items.map(({ experience, view }) => (
        <AdminCard
          key={experience.id}
          accent
          onPress={() => navigation.navigate('AdminExperienceDetail', { eventId: event.id, experienceId: experience.id })}
          accessibilityLabel={`Abrir experiência ${experience.name}`}
        >
          <Text style={styles.name}>{experience.name}  →</Text>
          <Text style={styles.line}>
            {view.stationsTotal} estação(ões) · {view.stationsAvailable} disponível(is) · {view.stationsOccupied} com chamada pendente
          </Text>
          <Text style={styles.line}>Fila única: {view.queueWaiting} aguardando (fictício)</Text>
          <Text style={view.acceptingNewEntries ? styles.ok : styles.warning}>
            {view.acceptingNewEntries
              ? 'Novas entradas nesta fila: aceitas (simulado)'
              : `Novas entradas nesta fila: suspensas — ${view.entriesBlockedReason}`}
          </Text>
        </AdminCard>
      ))}

      <Text style={styles.sectionTitle} accessibilityRole="header">Nova experiência</Text>
      {rules.createExperience.allowed ? (
        <>
          <AdminField
            label="Nome da nova experiência *"
            hint={`Até ${ADMIN_EXPERIENCE_NAME_MAX_LENGTH} caracteres. Ela nasce sem estações e com uma fila única.`}
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (feedback && feedback.tone === 'error') action.clearFeedback();
            }}
            placeholder="Ex.: Just Dance"
            error={feedback?.errors?.name}
            maxLength={ADMIN_EXPERIENCE_NAME_MAX_LENGTH}
            editable={!action.busy}
          />
          <AdminSuggestions
            label="Atalhos de preenchimento (não é um catálogo):"
            items={adminExperienceNameSuggestions}
            disabled={action.busy}
            onPick={(value) => {
              setName(value);
              if (feedback && feedback.tone === 'error') action.clearFeedback();
            }}
          />
          <AdminButton label={creating ? 'CRIANDO...' : 'CRIAR EXPERIÊNCIA'} loading={creating} onPress={handleReview} />
        </>
      ) : (
        <AdminNotice tone="warning" title="Criação de experiência indisponível" message={rules.createExperience.message} />
      )}

      {feedback ? (
        <AdminNotice
          tone={feedback.tone}
          title={feedback.tone === 'success' ? 'Experiência criada' : 'Não foi possível criar'}
          message={feedback.text}
        />
      ) : null}

      <AdminButton label="Voltar ao evento" variant="secondary" disabled={action.busy} onPress={() => navigation.goBack()} />

      <AdminDemoTools disabled={action.busy} />

      <AdminConfirmDialog
        visible={action.dialog.visible}
        title="Criar esta experiência?"
        message={action.snapshot ? `${action.snapshot.name}\nEvento: ${event.name}` : ''}
        note="Ela terá uma fila única, compartilhada pelas estações que você adicionar. Nada é enviado ao servidor."
        confirmLabel="CRIAR EXPERIÊNCIA"
        onConfirm={action.dialog.onConfirm}
        onCancel={action.dialog.onCancel}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  name: { color: adminColors.text, fontSize: 16, fontWeight: 'bold' },
  sectionTitle: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  ok: { color: adminColors.success, fontSize: 13, lineHeight: 19, marginTop: 6 },
  warning: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 6 },
});
