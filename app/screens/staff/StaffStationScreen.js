import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import StaffButton from './components/StaffButton';
import StaffConfirmDialog from './components/StaffConfirmDialog';
import StaffDemoTools from './components/StaffDemoTools';
import StaffMissingSession from './components/StaffMissingSession';
import StaffNotice from './components/StaffNotice';
import StaffScreen from './components/StaffScreen';
import { staffColors } from './components/staffTheme';
import { useStaffDemo } from './StaffDemoContext';
import {
  callNext,
  completeCall,
  findExperience,
  getCallBlocker,
  markAbsent,
} from './staffDemoState';

function stationStatus(station) {
  if (!station.available) return 'indisponível';
  return station.call ? 'ocupada' : 'livre';
}

// Tela ÚNICA de operação de estação (SV03, prints 04–05), reutilizada por
// PlayStation, Realidade Virtual e Simulador de Corrida. A fila pertence à
// experiência e é compartilhada por todas as estações dela.
export default function StaffStationScreen({ navigation, route }) {
  const { session, run, failNextAction, toggleFailNextAction } = useStaffDemo();
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const params = route?.params ?? {};
  const experience = findExperience(session, params.experienceId);
  const station = experience?.stations.find((item) => item.id === params.stationId) ?? null;

  if (!session || !experience || !station) {
    return (
      <StaffMissingSession
        title="Estação não encontrada"
        message="A estação não existe no evento de demonstração selecionado."
        actionLabel="↩ Painel"
        onAction={() => (session ? navigation.popTo('StaffPanel') : navigation.replace('StaffAccess'))}
      />
    );
  }

  const callBlocker = getCallBlocker(session, station.id);

  function apply(transition) {
    setDialog(null);
    const result = run(transition, station.id);
    setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
  }

  function selectStation(stationId) {
    setFeedback(null);
    navigation.setParams({ stationId });
  }

  function confirmRemoval() {
    const participant = dialog?.participant;
    setDialog(null);
    setFeedback({
      tone: 'warning',
      message: `Remoção não executada: o comportamento de "Remover" ainda depende de contrato da API. ${participant?.name ?? 'O participante'} continua na fila.`,
    });
  }

  return (
    <StaffScreen icon={experience.icon} title={experience.name} subtitle={`${station.name} · ${session.name}`}>
      {experience.stations.length > 1 ? (
        <View style={styles.stationTabs} accessibilityRole="tablist">
          {experience.stations.map((item) => {
            const selected = item.id === station.id;
            return (
              <Pressable
                key={item.id}
                style={[styles.stationTab, selected && styles.stationTabSelected]}
                onPress={() => selectStation(item.id)}
                accessibilityRole="tab"
                accessibilityLabel={`Estação ${item.name}, ${stationStatus(item)}`}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.stationTabName, selected && styles.stationTabNameSelected]}>
                  {item.name}
                </Text>
                <Text style={styles.stationTabStatus}>{stationStatus(item)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {!station.available ? (
        <StaffNotice
          tone="neutral"
          title="Estação indisponível"
          message="Esta estação não chama participantes agora. A fila da experiência continua sendo atendida pelas estações disponíveis."
        />
      ) : null}

      {station.call ? (
        <>
          <StaffNotice tone="warning" title="⚠️ Check pendente">
            <Text style={styles.callText}>
              {station.call.name} foi chamado(a). Ao terminar a experiência, confirme a conclusão.
            </Text>
          </StaffNotice>
          <StaffButton label="CONCLUIR EXPERIÊNCIA" onPress={() => setDialog({ type: 'complete' })} />
          <StaffButton
            label="AUSENTE → FINAL DA FILA"
            variant="secondary"
            onPress={() => setDialog({ type: 'absent' })}
          />
        </>
      ) : null}

      {!station.call && station.available ? (
        <>
          <StaffNotice
            tone="neutral"
            title="Nenhum chamado nesta estação"
            message={callBlocker ? callBlocker.message : 'Chame o próximo da fila da experiência.'}
          />
          <StaffButton
            label="CHAMAR PRÓXIMO"
            disabled={Boolean(callBlocker)}
            onPress={() => apply(callNext)}
          />
        </>
      ) : null}

      {feedback ? <StaffNotice tone={feedback.tone} message={feedback.message} /> : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">
        Fila ({experience.queue.length})
      </Text>

      {experience.queue.length === 0 ? (
        <StaffNotice tone="neutral" title="Fila vazia" message="Ninguém aguardando nesta experiência." />
      ) : (
        experience.queue.map((participant, index) => (
          <View key={participant.entryId} style={styles.queueRow}>
            <Text style={styles.queueName}>{index + 1}. {participant.name}</Text>
            <StaffButton
              label="Remover"
              variant="secondary"
              compact
              accessibilityLabel={`Remover ${participant.name}`}
              onPress={() => setDialog({ type: 'remove', participant })}
            />
          </View>
        ))
      )}

      <Text style={styles.footnote}>
        Chama-se apenas o próximo (sem furar a ordem). “Ausente” volta ao fim da fila; “Remover” é
        uma ação manual diferente.
      </Text>

      <StaffButton label="↩ Painel" variant="secondary" onPress={() => navigation.popTo('StaffPanel')} />

      <StaffDemoTools failNextAction={failNextAction} onToggleFailure={toggleFailNextAction} />

      <StaffConfirmDialog
        visible={dialog?.type === 'complete'}
        title="Concluir experiência?"
        message={station.call ? `Confirma que ${station.call.name} concluiu a experiência?` : ''}
        note="Simulação local: a conclusão não é registrada no servidor."
        confirmLabel="CONCLUIR"
        onConfirm={() => apply(completeCall)}
        onCancel={() => setDialog(null)}
      />

      <StaffConfirmDialog
        visible={dialog?.type === 'absent'}
        title="Registrar ausência?"
        message={session.queueEntriesOpen
          ? `${station.call?.name ?? 'O participante'} volta para o final da fila. Ausência não conta como conclusão.`
          : `Novas inscrições já foram encerradas: ${station.call?.name ?? 'o participante'} NÃO volta para a fila.`}
        note="Simulação local: nada é enviado ao servidor."
        confirmLabel="MARCAR AUSENTE"
        variant="danger"
        onConfirm={() => apply(markAbsent)}
        onCancel={() => setDialog(null)}
      />

      <StaffConfirmDialog
        visible={dialog?.type === 'remove'}
        title={`Remover ${dialog?.participant?.name ?? ''}?`}
        message="Remover não é o mesmo que Ausente."
        note="Comportamento pendente de contrato da API: nesta demonstração ninguém é removido."
        confirmLabel="CONFIRMAR (SEM EFEITO)"
        variant="danger"
        onConfirm={confirmRemoval}
        onCancel={() => setDialog(null)}
      />
    </StaffScreen>
  );
}

const styles = StyleSheet.create({
  stationTabs: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stationTab: {
    backgroundColor: staffColors.surface,
    borderColor: staffColors.divider,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  stationTabSelected: { borderColor: staffColors.accent, borderWidth: 2 },
  stationTabName: { color: staffColors.text, fontSize: 13, fontWeight: '600' },
  stationTabNameSelected: { color: staffColors.accent },
  stationTabStatus: { color: staffColors.muted, fontSize: 12, marginTop: 2 },
  callText: { color: staffColors.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
  sectionTitle: { color: staffColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 22 },
  queueRow: {
    alignItems: 'center',
    backgroundColor: staffColors.surface,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  queueName: { color: staffColors.text, flex: 1, fontSize: 16 },
  footnote: { color: staffColors.muted, fontSize: 12, lineHeight: 17, marginTop: 12 },
});
