import { StyleSheet, Switch, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { adminEventPhases, formatAdminDate } from '../../../services/adminEventsService';
import { adminReadinessRequirements } from '../adminEventManagement';
import { creationDeadline, creationTimezone } from '../adminCreationForm';
import { resolveEventTime, scheduleFields } from '../adminScheduleForm';
import AdminButton from './AdminButton';
import AdminNotice from './AdminNotice';
import { ScheduleDateTime, SettingsField, SettingsSection } from './AdminScheduleFields';
import { AdminIcon, liveColors as c, liveStyles as s } from './AdminLiveUI';

export const stepTitles = ['Dados do evento', 'Datas e funcionamento', 'Experiências e estações', 'Equipe Staff', 'Revisão e prontidão'];

export function IdentityStep({ state, flow, locked }) {
  const { form, event } = state;
  const change = field => !locked && !event ? value => flow.editForm({ [field]: value }) : undefined;
  return <SettingsSection title={stepTitles[0]} icon="edit">
    <SettingsField label="Nome do evento" value={event?.name ?? form.name} onChangeText={change('name')} />
    <SettingsField label="Código de acesso" value={event?.accessCode ?? form.accessCode} onChangeText={change('accessCode')} />
    {!event && <AdminButton label="Gerar código" variant="secondary" disabled={locked}
      onPress={() => flow.editForm({ accessCode: 'ARENA-' + randomUUID().slice(0, 8).toUpperCase() })} />}
    <Text style={s.body}>{event ? 'Código definitivo deste evento.' : 'A disponibilidade do código é confirmada ao criar o evento. Depois disso, o código é definitivo.'}</Text>
  </SettingsSection>;
}

export function DatesStep({ state, flow, locked }) {
  const { form, event } = state;
  const zone = event?.timezone ?? form.timezone;
  let timezone;
  try { timezone = creationTimezone(zone); } catch { /* Keep the timezone field editable. */ }
  const change = field => !locked && !event ? value => flow.editForm({ [field]: value }) : undefined;
  const margin = event ? String((Date.parse(event.operationalDeadlineAt) - Date.parse(event.officialEndsAt)) / 60000) : form.margin;
  let deadline = event?.operationalDeadlineAt;
  if (!event && timezone) {
    try { deadline = creationDeadline(resolveEventTime(form.end, timezone), margin); } catch { /* Incomplete fields. */ }
  }
  return <SettingsSection title={stepTitles[1]} icon="calendar">
    <SettingsField label="Fuso horário IANA" value={zone} onChangeText={change('timezone')} />
    {timezone ? ['start', 'end'].map(field => {
      const start = field === 'start', instant = event?.[start ? 'startsAt' : 'officialEndsAt'];
      return <ScheduleDateTime key={field + timezone} label={start ? 'início' : 'término oficial'}
        value={event ? scheduleFields(instant, timezone) : form[field]} instant={instant ?? Date.now()}
        timezone={timezone} onChange={change(field)} />;
    }) : <Text style={s.body}>Informe um fuso IANA válido para selecionar os horários.</Text>}
    <SettingsField label="Margem operacional (minutos)" value={margin} keyboardType="number-pad" onChangeText={change('margin')} />
    {deadline && <Text style={s.body}>Prazo operacional: {formatAdminDate(deadline, timezone)}</Text>}
    <View style={s.row}><Text style={[s.body, s.grow]}>Fila externa</Text>
      <Switch accessibilityLabel="Fila externa" value={event?.externalQueueEnabled ?? form.externalQueueEnabled}
        disabled={Boolean(event || locked)} onValueChange={change('externalQueueEnabled')} /></View>
    <Text style={s.body}>{event ? 'Programação salva. Alterações de horário estão disponíveis no painel do evento.'
      : 'Ao continuar, o evento será criado. Você poderá concluir sua configuração depois.'}</Text>
  </SettingsSection>;
}

export function EventStructureStep({ state, flow, locked }) {
  return <>
    <SettingsSection title={stepTitles[2]} icon="folder">
      <Text style={s.title}>{state.event.name}</Text>
      <SettingsField label="Nome da experiência" value={state.experience}
        onChangeText={locked ? undefined : experience => flow.editSetup({ experience })} />
      <AdminButton label="Adicionar experiência" variant="secondary" disabled={locked} onPress={() => flow.run('experience')} />
      <AdminButton label="Catálogo de experiências · Em breve" variant="ghost" disabled />
    </SettingsSection>
    <Text style={s.body}>Se um cadastro anterior ficou sem confirmação, confira a estrutura salva antes de cadastrar novamente.</Text>
    {!state.items.length && <AdminNotice title="Nenhuma experiência cadastrada" />}
    {state.items.map(item => <SettingsSection key={item.id} title={item.name} icon="folder">
      <Text style={s.body}>{item.stations.length} {item.stations.length === 1 ? 'estação' : 'estações'}</Text>
      {item.stations.map(station => <View key={station.id} style={styles.summaryRow}>
        <AdminIcon name="folder" size={20} />
        <Text style={[styles.rowText, s.grow]}>{station.label}</Text>
        <Text style={styles.detail}>{station.availability === 'available' ? 'Disponível' : 'Indisponível'}</Text>
      </View>)}
      {state.parent === item.id ? <>
        <SettingsField label="Identificação da estação" value={state.station}
          onChangeText={locked ? undefined : station => flow.editSetup({ station })} />
        <AdminButton label="Salvar estação" disabled={locked} onPress={() => flow.run('station')} />
        <AdminButton label="Cancelar estação" variant="ghost" disabled={locked} onPress={() => flow.editSetup({ parent: null, station: '' })} />
      </> : <AdminButton label={`Adicionar estação a ${item.name}`} disabled={locked || Boolean(state.station)}
        variant="secondary" onPress={() => flow.editSetup({ parent: item.id, station: '' })} />}
    </SettingsSection>)}
  </>;
}

export function EventStaffStep({ state, flow, locked, confirmRevoke }) {
  return <SettingsSection title={stepTitles[3]} icon="users">
    <SettingsField label="E-mail do usuário" keyboardType="email-address" value={state.email}
      onChangeText={locked ? undefined : email => flow.editSetup({ email })} />
    <AdminButton label="Conceder Staff" disabled={locked} onPress={() => flow.run('grant')} variant="secondary" />
    <Text style={s.body}>O acesso vale apenas para este evento. A conta precisa estar ativa e ter e-mail verificado.</Text>
    <Text style={s.title}>Concessões nesta sessão</Text>
    {!state.grants.length && <Text style={s.body}>Nenhuma concessão registrada neste fluxo.</Text>}
    {state.grants.map(grant => <View key={grant.id}>
      <Text selectable style={s.body}>{grant.email}</Text>
      <AdminButton label={`Revogar acesso de ${grant.email}`} disabled={locked} variant="ghost" onPress={() => confirmRevoke(grant)} />
    </View>)}
    <Text style={s.body}>{state.readiness?.checks.hasVerifiedActiveStaff ? 'O evento tem Staff elegível.' : 'O evento ainda precisa de Staff elegível.'}</Text>
  </SettingsSection>;
}

export function EventReview({ state, goTo, finished }) {
  const { event, readiness, items } = state;
  const checks = readiness.checks;
  const checklist = [
    ['Dados do evento', checks.nameAndAccessCode], ['Datas e funcionamento', checks.validScheduleAndTimezone],
    ['Configuração da fila externa', checks.externalQueueConfigured], ['Experiência com estação disponível', checks.hasExperienceWithAvailableStation],
    ['Staff ativo e verificado', checks.hasVerifiedActiveStaff],
  ];
  return <>
    <SettingsSection title={event.name} icon={finished && readiness.ready ? 'check' : 'calendar'}>
      <Text style={s.body}>{formatAdminDate(event.startsAt, event.timezone)} — {formatAdminDate(event.officialEndsAt, event.timezone)}</Text>
      <Text style={s.body}>{event.timezone} · Prazo operacional: {formatAdminDate(event.operationalDeadlineAt, event.timezone)}</Text>
      {!finished && <Text style={s.body}>Margem operacional: {(Date.parse(event.operationalDeadlineAt) - Date.parse(event.officialEndsAt)) / 60000} min</Text>}
      <Text style={s.body}>Código: {event.accessCode} · Fila externa {event.externalQueueEnabled ? 'ativa' : 'desativada'}</Text>
      <Text style={s.body}>Fase: {adminEventPhases[readiness.effectivePhase]}</Text>
    </SettingsSection>
    {!finished && <SettingsSection title="Checklist" icon="info">
      {checklist.map(([label, ok]) => <View key={label} style={styles.summaryRow}>
        <AdminIcon name={ok ? 'check' : 'warning'} color={ok ? c.success : c.warning} size={20} />
        <Text style={[styles.rowText, s.grow]}>{label}</Text><Text style={styles.detail}>{ok ? 'Concluído' : 'Pendente'}</Text>
      </View>)}
      <Text style={s.body}>Experiências: {items.length} · Estações: {items.reduce((sum, item) => sum + item.stations.length, 0)}</Text>
    </SettingsSection>}
    <AdminNotice tone={readiness.ready ? 'success' : 'warning'} title={readiness.ready ? 'Pronto para operar' : 'Configuração pendente'}
      message={readiness.ready ? 'Os requisitos essenciais estão configurados.' : 'O evento está salvo. Você pode continuar a preparação depois.'} />
    {!finished && !readiness.ready && adminReadinessRequirements(readiness.missing).map(item =>
      <View key={item.message}><Text style={s.body}>{item.message}</Text>
        {item.area && <AdminButton variant="ghost" label={`Revisar: ${item.message}`}
          onPress={() => goTo(item.code === 'EVENT_NAME_OR_ACCESS_CODE_INVALID' ? 1 :
            ({ schedule: 2, operation: 2, experiences: 3, staff: 4 })[item.area])} />}
      </View>)}
  </>;
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44,
    backgroundColor: '#251a33', borderWidth: 1, borderColor: '#614475', borderRadius: 10, padding: 10 },
  rowText: { color: c.text, fontSize: 15, fontWeight: '600' }, detail: { color: c.muted, fontSize: 13 },
});
