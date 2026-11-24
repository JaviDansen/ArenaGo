import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatAdminDate } from '../../../services/adminEventsService';
import AdminButton from './AdminButton';
import { AdminEventPhaseBadge } from './AdminEventSummary';
import { AdminIcon, AdminIconTile, liveColors as c, liveStyles as s } from './AdminLiveUI';

export function OperationEventCard({ view, onRefresh }) {
  const ready = view.effectivePhase === 'open';
  const pending = view.effectivePhase === 'not_ready';
  return <View style={[s.card, styles.card]}>
    <View style={s.row}>
      <AdminIconTile name="calendar" />
      <View style={[s.grow, styles.eventIdentity]}>
        <View style={styles.wrap}>
          <Text style={[s.title, styles.eventName]}>{view.name}</Text>
          <View testID="operation-phase" style={styles.fit}>
            <AdminEventPhaseBadge phase={view.effectivePhase} />
          </View>
        </View>
        {(ready || pending) && <View style={styles.statusRow}>
          <AdminIcon name={ready ? 'check' : 'warning'} color={ready ? c.success : c.warning} size={18} />
          <Text style={[styles.detail, s.grow]}>{ready ? 'Pronto para operar' : 'Configuração pendente'}</Text>
        </View>}
      </View>
    </View>
    <View style={styles.eventFoot}>
      <View style={styles.deadlines}>
        <Text style={styles.detail}>Limite operacional original: {formatAdminDate(view.operationalDeadlineAt, view.timezone)}</Text>
        {view.closureMode === 'controlled' && view.adminDeadlineAt && <Text style={styles.detail}>
          Prazo do encerramento controlado: {formatAdminDate(view.adminDeadlineAt, view.timezone)}
        </Text>}
      </View>
      <View style={styles.fit}>
        <AdminButton label="Atualizar operação" onPress={onRefresh} variant="ghost" compact />
      </View>
    </View>
  </View>;
}

function OperationMetric({ id, label, value, icon }) {
  return <View testID={id} style={styles.metric}>
    <View style={styles.metricTile}><AdminIcon name={icon} size={24} /></View>
    <View style={s.grow}>
      <Text style={value == null ? styles.detail : styles.metricValue}>{value ?? 'Indisponível'}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  </View>;
}

export function OperationMetrics({ view }) {
  return <View style={[s.card, styles.card]}>
    <Text accessibilityRole="header" style={s.title}>Resumo operacional</Text>
    <View style={styles.metrics}>
      <OperationMetric id="operation-active" label="Participantes ativos" value={view.activeParticipants} icon="users" />
      <OperationMetric id="operation-waiting" label="Na fila externa" value={view.externalWaitingParticipants} icon="layers" />
    </View>
    {view.effectivePhase === 'closed' && (view.activeParticipants > 0 || view.externalWaitingParticipants > 0) &&
      <Text style={s.body}>O evento está encerrado. A contagem ainda reflete registros abertos no último snapshot.</Text>}
  </View>;
}

export function OperationQueueCard({ enabled, onToggle, unavailable }) {
  const color = enabled ? c.success : c.muted;
  const label = enabled ? 'Desativar fila externa' : 'Ativar fila externa';
  return <View style={[s.card, styles.card]}>
    <View style={styles.sectionLead}>
      <AdminIcon name="layers" size={26} />
      <View style={s.grow}>
        <View style={styles.wrap}>
          <Text accessibilityRole="header" style={[s.title, styles.sectionTitle]}>Fila externa</Text>
          <View testID="operation-queue-state" style={styles.fit}>
            <Text style={[styles.badge, { color, borderColor: color }]}>{enabled ? 'ATIVA' : 'INATIVA'}</Text>
          </View>
        </View>
        <Text style={styles.detail}>Organiza a espera de novos participantes para entrar na Arena.</Text>
      </View>
    </View>
    {onToggle && <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onToggle}
      style={({ pressed }) => [styles.queueAction, pressed && styles.pressed]}>
      <AdminIcon name={enabled ? 'pause' : 'play'} color={c.onAccent} size={22} />
      <Text style={styles.queueLabel}>{label}</Text>
    </Pressable>}
    {unavailable && <Text style={s.body}>A alteração da fila está indisponível nesta situação.</Text>}
  </View>;
}

function ClosureAction({ title, description, icon, critical, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={description} onPress={onPress}
    style={({ pressed }) => [styles.closureAction, pressed && styles.pressed]}>
    <View style={[s.iconTile, critical && styles.criticalTile]}>
      <AdminIcon name={icon} color={critical ? c.danger : c.accent} size={26} />
    </View>
    <View style={s.grow}>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.detail}>{description}</Text>
    </View>
    <AdminIcon name="chevron" color={c.muted} size={18} />
  </Pressable>;
}

export function OperationCloseCard({ onSelect, unavailableMessage }) {
  return <>
    <View style={[s.card, styles.card]}>
      <View style={styles.sectionLead}>
        <AdminIcon name="power" color={c.danger} size={26} />
        <View style={s.grow}>
          <Text accessibilityRole="header" style={s.title}>Encerramento do evento</Text>
          <Text style={styles.detail}>Finalize a operação agora ou defina um prazo para concluir os atendimentos permitidos.</Text>
        </View>
      </View>
      {onSelect && <View style={styles.closureActions}>
        <ClosureAction title="Encerrar imediatamente" icon="stop" critical onPress={() => onSelect('immediate')}
          description="Interrompe a operação, resolve filas e chamadas pendentes e finaliza as participações." />
        <ClosureAction title="Encerramento controlado" icon="history" onPress={() => onSelect('controlled')}
          description="Bloqueia novas entradas e permite concluir operações admissíveis até o horário definido, dentro do prazo operacional." />
      </View>}
      {unavailableMessage && <Text style={s.body}>{unavailableMessage}</Text>}
    </View>
    <View style={[s.row, styles.notice]}>
      <AdminIcon name="info" color={c.accent} size={21} />
      <Text style={[styles.detail, s.grow]}>Ambas as opções de encerramento exigem justificativa e confirmação.</Text>
    </View>
  </>;
}

const styles = StyleSheet.create({
  card: { marginTop: 12, padding: 14 },
  eventIdentity: { borderLeftWidth: 1, borderLeftColor: c.muted, paddingLeft: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  eventName: { flexGrow: 1, flexBasis: 118, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  eventFoot: { borderTopWidth: 1, borderColor: c.border, marginTop: 10, paddingTop: 4, flexDirection: 'row',
    flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', columnGap: 8 },
  deadlines: { flexGrow: 1, flexBasis: 136, minWidth: 0 },
  fit: { maxWidth: '100%' },
  detail: { color: c.muted, fontSize: 13, lineHeight: 18 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 10 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexBasis: 138, minWidth: 0,
    minHeight: 68, padding: 9, backgroundColor: c.surfaceRaised, borderColor: c.border, borderWidth: 1, borderRadius: 12 },
  metricTile: { width: 34, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: c.iconFill },
  metricValue: { color: c.text, fontSize: 26, lineHeight: 31, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricLabel: { color: c.text, fontSize: 12, lineHeight: 16 },
  sectionLead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sectionTitle: { flexGrow: 1, flexBasis: 106, minWidth: 0 },
  badge: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 3, fontSize: 11, lineHeight: 16,
    fontWeight: '700', flexShrink: 1 },
  queueAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginTop: 12,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: '#7124b0' },
  queueLabel: { color: c.onAccent, flexShrink: 1, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  closureActions: { marginTop: 12, gap: 8 },
  closureAction: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, padding: 10,
    borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised },
  criticalTile: { backgroundColor: c.dangerSurface },
  actionTitle: { color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 2 },
  pressed: { opacity: 0.74 },
  notice: { marginTop: 12, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: c.accent, backgroundColor: c.surfaceRaised },
});
