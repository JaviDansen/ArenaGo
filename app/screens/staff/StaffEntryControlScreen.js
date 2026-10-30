import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import StaffButton from './components/StaffButton';
import StaffCard from './components/StaffCard';
import StaffConfirmDialog from './components/StaffConfirmDialog';
import StaffDemoTools from './components/StaffDemoTools';
import StaffMissingSession from './components/StaffMissingSession';
import StaffNotice from './components/StaffNotice';
import StaffScreen from './components/StaffScreen';
import { staffColors } from './components/staffTheme';
import { useStaffDemo } from './StaffDemoContext';
import { confirmEntry, disableEntryQueue, reactivateEntryQueue } from './staffDemoState';

// Controle de Entrada / fila externa (SV02, print 03). Toda mudança aqui é
// local: confirmar entrada individual ainda não tem contrato publicado na API.
export default function StaffEntryControlScreen({ navigation }) {
  const { session, run, failNextAction, toggleFailNextAction } = useStaffDemo();
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);

  if (!session) {
    return (
      <StaffMissingSession
        title="Nenhum evento selecionado"
        message="Volte à Área do Staff e informe um código de demonstração."
        actionLabel="IR PARA A ÁREA DO STAFF"
        onAction={() => navigation.replace('StaffAccess')}
      />
    );
  }

  const { entryQueue } = session;
  const next = entryQueue.waiting[0] ?? null;

  function apply(transition, ...args) {
    setDialog(null);
    const result = run(transition, ...args);
    // Repetição da mesma confirmação não sobrescreve o retorno da primeira.
    if (result.code === 'ENTRY_NOT_NEXT') return;
    setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
  }

  return (
    <StaffScreen title="Controle de Entrada" subtitle="Fila de acesso à Arena">
      <StaffCard accent>
        <View style={styles.statusRow}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Fila de acesso</Text>
            <Text style={styles.status}>{entryQueue.active ? 'ATIVA' : 'INATIVA'}</Text>
          </View>
          <Pressable
            style={[styles.pill, !entryQueue.active && styles.pillOff]}
            onPress={entryQueue.active ? () => setDialog({ type: 'disable' }) : undefined}
            accessibilityRole="button"
            accessibilityLabel="Fila de acesso: Não"
            accessibilityState={{ selected: !entryQueue.active }}
          >
            <Text style={styles.pillText}>Não</Text>
          </Pressable>
          <Pressable
            style={[styles.pill, entryQueue.active && styles.pillOn]}
            onPress={entryQueue.active ? undefined : () => apply(reactivateEntryQueue)}
            accessibilityRole="button"
            accessibilityLabel="Fila de acesso: Sim"
            accessibilityState={{ selected: entryQueue.active }}
          >
            <Text style={[styles.pillText, entryQueue.active && styles.pillTextOn]}>Sim</Text>
          </Pressable>
        </View>
        <Text style={styles.summary}>
          Aguardando: <Text style={styles.bold}>{entryQueue.waiting.length}</Text>
          {next ? ' · Próximo: ' : ''}
          {next ? <Text style={styles.bold}>{next.name}</Text> : null}
        </Text>
      </StaffCard>

      {feedback ? <StaffNotice tone={feedback.tone} message={feedback.message} /> : null}

      {!entryQueue.active ? (
        <StaffNotice
          tone="info"
          title="Fila de acesso desativada"
          message="Pela regra prevista, novos ingressos futuros entram direto na Arena enquanto a fila estiver desligada. Reativar a fila (Sim) não recoloca na fila quem já foi liberado."
        />
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">Fila</Text>

      {entryQueue.waiting.length === 0 ? (
        <StaffNotice
          tone="neutral"
          title="Fila vazia"
          message="Ninguém está aguardando na fila de acesso agora."
        />
      ) : (
        entryQueue.waiting.map((participant, index) => (
          <View
            key={participant.entryId}
            style={styles.queueRow}
            accessibilityLabel={`${index + 1}º ${participant.name}${index === 0 ? ', próximo' : ''}`}
          >
            <Text style={styles.queueName}>{index + 1}. {participant.name}</Text>
            {index === 0 && entryQueue.active ? (
              <StaffButton
                label="CONFIRMAR ENTRADA"
                compact
                onPress={() => setDialog({ type: 'confirm', participant })}
              />
            ) : null}
          </View>
        ))
      )}

      {entryQueue.active ? (
        <StaffButton
          label="DESATIVAR FILA (LIBERA TODOS)"
          variant="danger"
          onPress={() => setDialog({ type: 'disable' })}
          accessibilityHint="Abre uma confirmação. Na operação real, só Admin poderá executar."
        />
      ) : null}

      <Text style={styles.footnote}>
        A entrada normal é individual (“Confirmar entrada”). Desativar a fila libera todos de uma vez.
      </Text>

      <StaffButton label="↩ Painel" variant="secondary" onPress={() => navigation.popTo('StaffPanel')} />

      <StaffDemoTools failNextAction={failNextAction} onToggleFailure={toggleFailNextAction} />

      <StaffConfirmDialog
        visible={dialog?.type === 'confirm'}
        title="Confirmar entrada?"
        message={dialog?.participant ? `${dialog.participant.name} será marcado(a) como dentro da Arena.` : ''}
        note="Simulação local: nada é enviado ao servidor."
        confirmLabel="CONFIRMAR"
        onConfirm={() => apply(confirmEntry, dialog?.participant?.entryId)}
        onCancel={() => setDialog(null)}
      />

      <StaffConfirmDialog
        visible={dialog?.type === 'disable'}
        title="Desativar a fila de acesso?"
        message={`Todos os ${entryQueue.waiting.length} participante(s) aguardando seriam liberados para a Arena.`}
        note="Operação reservada a Admin na futura API. Aqui só a demonstração local muda; nenhum participante real é liberado."
        confirmLabel="DESATIVAR NA DEMONSTRAÇÃO"
        variant="danger"
        onConfirm={() => apply(disableEntryQueue)}
        onCancel={() => setDialog(null)}
      />
    </StaffScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  cardTitle: { color: staffColors.text, fontSize: 17, fontWeight: 'bold' },
  status: { color: staffColors.muted, fontSize: 12, marginTop: 2 },
  pill: {
    backgroundColor: staffColors.secondary,
    borderRadius: 999,
    minWidth: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillOff: { backgroundColor: '#d4d4d8' },
  pillOn: { backgroundColor: staffColors.successSurface },
  pillText: { color: staffColors.text, fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  pillTextOn: { color: staffColors.success },
  summary: { color: staffColors.muted, fontSize: 13, marginTop: 14 },
  bold: { color: staffColors.text, fontWeight: 'bold' },
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
