import { StyleSheet, Text, View } from 'react-native';

import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminDemoTools from './components/AdminDemoTools';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminPhaseBadge from './components/AdminPhaseBadge';
import AdminRatings, { AdminDuration } from './components/AdminRatings';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import { ADMIN_BI_STAGE_LABELS, ADMIN_CLOSURE_LABELS, getClosureReason, getEventBi } from './adminInsights';
import { formatInstantWithZone } from './adminTime';

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

function Row({ label, value }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// BI individual do evento (ADM03), em qualquer fase. Somente leitura e sempre
// agregado (D10). Aberto pelo Histórico, pelo detalhe do evento e pela Visão
// Geral com um único evento selecionado.
export default function AdminEventBiScreen({ navigation, route }) {
  const { session } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const bi = session && typeof eventId === 'string' ? getEventBi(session, eventId) : null;

  if (!bi) {
    return (
      <AdminMissing
        title="Evento não encontrado"
        message="Este evento não existe nesta sessão de demonstração."
        actionLabel="VOLTAR"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const { event, info, stage, participations, completions, usage, evaluations, time } = bi;
  const reason = getClosureReason(event);

  return (
    <AdminScreen
      title="BI do"
      highlight="Evento"
      subtitle={`${event.name} · código ${event.accessCode}`}
      backLabel="Voltar"
      onBack={() => navigation.goBack()}
    >
      <AdminNotice
        tone="warning"
        title="Indicadores fictícios"
        message="Calculados a partir dos dados simulados desta sessão. Não são resultados reais."
      />

      <AdminCard>
        <AdminPhaseBadge phase={info.phase} waitingReadiness={info.waitingReadiness} />
        <Text style={styles.stage}>{ADMIN_BI_STAGE_LABELS[stage]}</Text>
        <Text style={styles.line}>Início: {formatInstantWithZone(event.startsAt, event.timezone)}</Text>
        {bi.closedAt ? (
          <>
            <Text style={styles.line}>{ADMIN_CLOSURE_LABELS[bi.closureKind]}</Text>
            <Text style={styles.line}>Encerrado em: {formatInstantWithZone(bi.closedAt, event.timezone)}</Text>
            {bi.closureKind !== 'schedule' ? (
              <Text style={styles.line}>Justificativa: {reason ?? 'não registrada nesta demonstração.'}</Text>
            ) : null}
          </>
        ) : null}
      </AdminCard>

      {bi.insufficient ? (
        <AdminNotice
          tone="info"
          title="Dados insuficientes"
          message={stage === 'future'
            ? 'Evento futuro: ainda não há participações, atendimentos nem avaliações. Nenhum número é inventado.'
            : 'Este evento ainda não tem participações, atendimentos nem avaliações registrados.'}
        />
      ) : null}

      <Text style={styles.heading} accessibilityRole="header">Participações</Text>
      <AdminCard>
        <Row label="Registradas (estado atual)" value={participations.registered} />
        <Row label="Na fila externa" value={participations.externalWaiting} />
        <Row label="Ativas" value={participations.active} />
        <Row label="Finalizadas" value={participations.finished} />
        <Row label="Finalizadas pelo encerramento administrativo" value={participations.adminFinalized} />
        {info.phase === 'closed' && participations.active + participations.externalWaiting > 0 ? (
          <Text style={styles.warning}>
            A finalização automática no limite operacional (D07) não é simulada: as participações ainda abertas não
            foram alteradas pelo relógio.
          </Text>
        ) : null}
        <Text style={styles.note}>
          Fonte: contadores do evento na sessão. As finalizadas pelo encerramento administrativo não contam como
          experiência concluída nem como avaliação.
        </Text>
      </AdminCard>

      <Text style={styles.heading} accessibilityRole="header">Experiências e estações</Text>
      <AdminCard>
        <Row label="Atendimentos concluídos (Staff)" value={completions.completed} />
        <Row label="Ausências marcadas" value={completions.absences} />
        <Row label="Estações com atendimento" value={`${completions.stationsWithCompletions} de ${completions.stations}`} />
        <Text style={styles.note}>
          Fonte: atendimentos registrados por estação. Fila e número de estações não geram atendimentos; ausência
          não prova falta real.
        </Text>
      </AdminCard>
      {usage.length === 0 ? (
        <Text style={styles.line}>Nenhuma experiência cadastrada neste evento.</Text>
      ) : usage.map((item) => (
        <AdminCard key={item.experience.id}>
          <Text style={styles.name}>{item.experience.name}</Text>
          <Text style={styles.line}>
            {item.completed > 0
              ? `${item.completed} atendimento(s) concluído(s) · ${item.absences} ausência(s)`
              : 'Sem atendimentos registrados.'}
          </Text>
          {item.stations.map(({ station, completed, share }) => (
            <Text key={station.id} style={styles.station}>
              {station.label}: {completed > 0 ? `${completed} (${share}% da experiência)` : 'sem atendimentos registrados'}
            </Text>
          ))}
        </AdminCard>
      ))}

      <Text style={styles.heading} accessibilityRole="header">Avaliações</Text>
      <AdminCard>
        <Row label="Participações finalizadas fora do encerramento administrativo" value={participations.finishedOutsideAdmin} />
        <AdminRatings summary={evaluations} />
        <Text style={styles.note}>
          Uma avaliação por participação, com a nota mais recente (D08). Finalizar não é o mesmo que avaliar:
          nem toda participação finalizada envia avaliação.
        </Text>
      </AdminCard>

      <Text style={styles.heading} accessibilityRole="header">Tempo</Text>
      <AdminCard>
        <AdminDuration label="Entrada até a última experiência concluída" summary={time.lastCompletion} population="participação(ões) com experiência concluída" />
        <AdminDuration label="Entrada até a saída voluntária" summary={time.voluntaryExit} population="saída(s) voluntária(s)" />
        <Text style={styles.note}>
          Populações diferentes. Não é calculado a partir dos horários do evento nem da finalização administrativa.
        </Text>
      </AdminCard>

      <Text style={styles.heading} accessibilityRole="header">Perfil do público</Text>
      <AdminNotice
        tone="neutral"
        title="Indisponível"
        message="Segmentação do público sem política aprovada (D10). Nenhum participante é identificado nesta área."
      />

      <AdminButton
        variant="secondary"
        label="Ver configuração do evento"
        onPress={() => navigation.navigate('AdminEventDetail', { eventId: event.id })}
      />

      <AdminDemoTools showFailure={false} />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  heading: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  stage: { color: adminColors.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  name: { color: adminColors.text, fontSize: 15, fontWeight: 'bold' },
  line: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  station: { color: adminColors.muted, fontSize: 12, lineHeight: 18, marginTop: 4, paddingLeft: 8 },
  note: { color: adminColors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  warning: { color: adminColors.warning, fontSize: 12, lineHeight: 17, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  rowLabel: { color: adminColors.muted, flex: 1, fontSize: 13, paddingRight: 8 },
  rowValue: { color: adminColors.text, fontSize: 14, fontWeight: '600' },
});
