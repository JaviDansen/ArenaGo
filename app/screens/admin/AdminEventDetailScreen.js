import { StyleSheet, Text } from 'react-native';

import { adminReadinessLabels } from '../../data/adminDemoData';
import AdminButton from './components/AdminButton';
import AdminCard from './components/AdminCard';
import AdminDemoTools from './components/AdminDemoTools';
import AdminMissing from './components/AdminMissing';
import AdminNotice from './components/AdminNotice';
import AdminPhaseBadge from './components/AdminPhaseBadge';
import AdminScreen from './components/AdminScreen';
import { adminColors } from './components/adminTheme';
import { useAdminDemo } from './AdminDemoContext';
import {
  describeEvent,
  findEvent,
  getCapacityGaps,
  getCloseAvailability,
  getExternalQueueAvailability,
  getScheduleChangeAvailability,
  phaseText,
} from './adminDemoState';
import { formatInstantWithZone, minutesBetween } from './adminTime';

const ACTION_LABELS = {
  CREATE: 'Cadastro',
  SCHEDULE: 'Alteração de horários',
  EXTERNAL_QUEUE: 'Fila externa',
  CLOSE: 'Encerramento antecipado',
  CONTROLLED_DEADLINE: 'Prazo do encerramento controlado',
  EXPERIENCE_CREATE: 'Nova experiência',
  EXPERIENCE_RENAME: 'Experiência renomeada',
  STATION_CREATE: 'Nova estação',
  STATION_RENAME: 'Estação renomeada',
  STATION_AVAILABILITY: 'Disponibilidade de estação',
  STAFF_GRANT: 'Staff concedido',
  STAFF_REVOKE: 'Staff revogado',
};

const ownParam = (params, key) =>
  (params != null && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);

// Detalhe e gestão do evento (ADM01–ADM03): configuração, fase efetiva,
// prontidão calculada, capacidade operacional atual, estrutura e ações
// demonstrativas permitidas pela arquitetura. Não há "Abrir Evento" (abertura
// automática) nem exclusão física.
export default function AdminEventDetailScreen({ navigation, route }) {
  const { session } = useAdminDemo();
  const eventId = ownParam(route?.params, 'eventId');
  const event = session ? findEvent(session, eventId) : null;

  if (!event) {
    return (
      <AdminMissing
        title="Evento não encontrado"
        message="Este evento não existe nesta sessão de demonstração."
        actionLabel="VOLTAR AOS EVENTOS"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const now = session.clockNow;
  const info = describeEvent(event, now, session);
  const structure = info.readiness.structure;
  const tz = event.timezone;
  const margin = minutesBetween(event.officialEndsAt, event.operationalDeadlineAt);
  const schedule = getScheduleChangeAvailability(event, now);
  const queue = getExternalQueueAvailability(event, now);
  const close = getCloseAvailability(event, now);

  return (
    <AdminScreen
      title={event.name}
      subtitle={`Código de ingresso: ${event.accessCode} · imutável`}
      backLabel="Eventos"
      onBack={() => navigation.goBack()}
    >
      {ownParam(route?.params, 'created') === true ? (
        <AdminNotice
          tone="success"
          title="Evento criado na demonstração"
          message='Cadastrado como "Agendado" e ainda não pronto. Nada foi enviado ao servidor.'
        />
      ) : null}

      <AdminPhaseBadge phase={info.phase} waitingReadiness={info.waitingReadiness} />
      <Text style={styles.line}>
        Status armazenado: {phaseText(info.statusStored)} · fase efetiva: {phaseText(info.phase)}
      </Text>
      {info.statusStored !== info.phase ? (
        <Text style={styles.warning}>
          O status armazenado está defasado: horários e prontidão prevalecem sobre ele.
        </Text>
      ) : null}
      <Text style={info.acceptingNewParticipations ? styles.ok : styles.muted}>
        {info.acceptingNewParticipations
          ? 'Aceitando novas participações (simulado).'
          : 'Não aceita novas participações agora.'}
      </Text>
      {info.capacitySuspended ? (
        <AdminNotice
          tone="warning"
          title="Novas participações suspensas — o evento continua aberto"
          message={`Motivo: ${getCapacityGaps(info.readiness).join(' e ')}. Participações, esperas, posições e conclusões existentes foram preservadas: nada foi encerrado ou cancelado. A capacidade volta sozinha ao restaurar Staff ou estação, desde que antes do corte de novas entradas.`}
        />
      ) : null}

      <AdminCard>
        <Text style={styles.cardTitle}>Configuração</Text>
        <Text style={styles.line}>Fuso: {tz}</Text>
        <Text style={styles.line}>Início: {formatInstantWithZone(event.startsAt, tz)}</Text>
        <Text style={styles.line}>Encerramento oficial: {formatInstantWithZone(event.officialEndsAt, tz)}</Text>
        <Text style={styles.line}>
          Limite operacional: {formatInstantWithZone(event.operationalDeadlineAt, tz)} (margem de {margin} min)
        </Text>
        <Text style={styles.line}>Fila externa: {event.externalQueueEnabled ? 'habilitada' : 'desabilitada'}</Text>
        <Text style={styles.line}>Novas entradas até: {formatInstantWithZone(info.entriesCutAt, tz)}</Text>
        <Text style={styles.line}>Chamadas e conclusões até: {formatInstantWithZone(info.operationalCutAt, tz)}</Text>
        {info.openedAt ? (
          <Text style={styles.line}>Abertura automática registrada em: {formatInstantWithZone(info.openedAt, tz)}</Text>
        ) : null}
        {event.closureMode ? (
          <Text style={styles.warning}>
            Encerramento administrativo {event.closureMode === 'immediate' ? 'imediato' : 'controlado'} pedido em{' '}
            {formatInstantWithZone(event.closureRequestedAt, tz)}; prazo Admin: {formatInstantWithZone(event.adminDeadlineAt, tz)}.
          </Text>
        ) : null}
      </AdminCard>

      <AdminCard>
        <Text style={styles.cardTitle}>
          Prontidão: {info.readiness.ready ? 'pronto ✓' : 'não pronto ✗'}
        </Text>
        {Object.keys(adminReadinessLabels).map((key) => (
          <Text
            key={key}
            style={info.readiness.checks[key] ? styles.ok : styles.missing}
            accessibilityLabel={`${adminReadinessLabels[key]}: ${info.readiness.checks[key] ? 'atendido' : 'faltando'}`}
          >
            {info.readiness.checks[key] ? '✓' : '✗'} {adminReadinessLabels[key]}
          </Text>
        ))}
        <Text style={styles.muted}>
          O evento abre sozinho a partir do início quando estiver pronto e antes do corte de entradas. Não existe botão “Abrir Evento”.
        </Text>
        <Text style={styles.muted}>
          Prontidão calculada a partir das experiências, estações e vínculos Staff cadastrados abaixo (sem exigir Staff conectado).
        </Text>
      </AdminCard>

      <AdminCard>
        <Text style={styles.cardTitle}>Estrutura do evento</Text>
        <Text style={styles.line}>
          Experiências: {structure.experiences} · com estação disponível: {structure.experiencesWithAvailableStation}
        </Text>
        <Text style={styles.line}>Estações: {structure.stations} · disponíveis: {structure.availableStations}</Text>
        <Text style={styles.line}>
          Staff vigente: {structure.currentGrants} · apto (conta ativa e e-mail verificado): {structure.validStaff}
        </Text>
        {info.hasParticipationHistory ? (
          <Text style={styles.warning}>
            Este evento já teve participação: criar experiências e renomear experiências ou estações está bloqueado. Adicionar estações, alterar disponibilidade e gerir Staff continuam possíveis enquanto o evento não estiver encerrado.
          </Text>
        ) : (
          <Text style={styles.muted}>Ainda sem participação: experiências e estações podem ser criadas e renomeadas.</Text>
        )}
        <AdminButton
          label="Experiências e estações"
          variant="secondary"
          onPress={() => navigation.navigate('AdminEventExperiences', { eventId: event.id })}
        />
        <AdminButton
          label="Staff do evento"
          variant="secondary"
          onPress={() => navigation.navigate('AdminEventStaff', { eventId: event.id })}
        />
      </AdminCard>

      <AdminCard>
        <Text style={styles.cardTitle}>Participações (resumo fictício)</Text>
        <Text style={styles.line}>Aguardando na fila externa: {event.participants.externalWaiting}</Text>
        <Text style={styles.line}>Ativas na Arena: {event.participants.active}</Text>
        <Text style={styles.line}>Finalizadas: {event.participants.finished}</Text>
        {info.phase === 'closed' && !event.closureMode
          && (event.participants.externalWaiting > 0 || event.participants.active > 0) ? (
            <AdminNotice
              tone="warning"
              title="Não simulado nesta demonstração"
              message="A finalização automática das participações abertas no limite operacional (D07) não é simulada aqui; os números acima não foram alterados pelo relógio."
            />
          ) : null}
        {Object.prototype.hasOwnProperty.call(event, 'controlledDeadlineFinalized') ? (
          <AdminNotice
            tone="info"
            title="Prazo do encerramento controlado alcançado"
            message={`${event.controlledDeadlineFinalized} participação(ões) ainda aberta(s) foram finalizadas no prazo (simulado); as já finalizadas foram preservadas. O encerramento de filas internas e chamadas não é simulado nesta demonstração.`}
          />
        ) : null}
        <Text style={styles.muted}>
          O processamento de filas internas e chamadas não é simulado: a fila de cada experiência e as chamadas pendentes são dados fictícios fixos.
        </Text>
        <AdminButton
          label="Ver BI do evento"
          variant="secondary"
          onPress={() => navigation.navigate('AdminEventBi', { eventId: event.id })}
        />
      </AdminCard>

      <Text style={styles.sectionTitle} accessibilityRole="header">Gestão do evento</Text>

      <AdminButton
        label="Alterar horários"
        variant="secondary"
        disabled={!schedule.allowed}
        onPress={() => navigation.navigate('AdminEventSchedule', { eventId: event.id })}
      />
      {!schedule.allowed ? <AdminNotice tone="neutral" message={schedule.message} /> : null}

      <AdminButton
        label={event.externalQueueEnabled ? 'Desabilitar fila externa' : 'Habilitar fila externa'}
        variant="secondary"
        disabled={!queue.allowed}
        onPress={() => navigation.navigate('AdminEventQueue', { eventId: event.id })}
      />
      {!queue.allowed ? <AdminNotice tone="neutral" message={queue.message} /> : null}

      <AdminButton
        label="Encerrar antecipadamente"
        variant="danger"
        disabled={!close.allowed}
        onPress={() => navigation.navigate('AdminEventClose', { eventId: event.id })}
      />
      {!close.allowed ? <AdminNotice tone="neutral" message={close.message} /> : null}

      <AdminNotice
        tone="neutral"
        message="Não há exclusão de eventos: o histórico e a reserva do código são preservados. Para parar o funcionamento, use o encerramento antecipado."
      />

      {event.audit.length > 0 ? (
        <AdminCard>
          <Text style={styles.cardTitle}>Registro local da demonstração</Text>
          <Text style={styles.muted}>Não é a auditoria real (que será feita pelo backend).</Text>
          {event.audit.map((entry, index) => (
            <Text key={`${entry.action}-${index}`} style={styles.line}>
              • {ACTION_LABELS[entry.action] ?? entry.action} em {formatInstantWithZone(entry.at, tz)}
              {entry.reason ? ` — “${entry.reason}”` : entry.detail ? ` — ${entry.detail}` : ''}
            </Text>
          ))}
        </AdminCard>
      ) : null}

      <AdminButton label="Voltar ao painel" variant="ghost" onPress={() => navigation.popTo('AdminPanel')} />

      <AdminDemoTools />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: adminColors.text, fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  sectionTitle: { color: adminColors.text, fontSize: 18, fontWeight: 'bold', marginTop: 24 },
  line: { color: adminColors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: adminColors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  warning: { color: adminColors.warning, fontSize: 13, lineHeight: 19, marginTop: 6 },
  ok: { color: adminColors.success, fontSize: 13, lineHeight: 19, marginTop: 4 },
  missing: { color: adminColors.danger, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
