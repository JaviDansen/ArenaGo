import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { adminEventWriteError, changeAdminSchedule, formatAdminDate, renameAdminEvent } from '../../services/adminEventsService';
import { adminReadOwner } from './useAdminEvents';
import useAdminEventPanel from './useAdminEventPanel';
import { eventScheduleDraft, prepareSchedule, previewOperationalDeadline, scheduleChanged } from './adminScheduleForm';
import { configurationName } from './adminCreationForm';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminSelectedEvent from './components/AdminSelectedEvent';
import AdminButton from './components/AdminButton';
import AdminNotice from './components/AdminNotice';
import AdminEventAccess from './components/AdminEventAccess';
import { ScheduleDateTime, SettingsField, SettingsSection } from './components/AdminScheduleFields';
import { liveStyles as s } from './components/AdminLiveUI';

export default function AdminEventSettingsScreen({ navigation, eventId }) {
  const auth = useAuth();
  const owner = adminReadOwner(auth);
  const client = auth.httpClient;
  const scope = useMemo(() => ({}), [owner, client, eventId]);
  const live = useRef(null);
  live.current = { auth, scope };
  const generation = useRef(0);
  const viewGeneration = generation.current;
  const inFlight = useRef(null);
  const mounted = useRef(false);
  const [model, setModel] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [leave, setLeave] = useState(null);
  const panel = useAdminEventPanel(navigation, eventId);
  const current = model?.scope === scope ? model : null;
  const event = current?.blocked ? null : panel.event;
  const original = useMemo(() => event && eventScheduleDraft(event), [event]);
  const draft = current?.draft;
  const busy = Boolean(current?.busy);
  const dirty = Boolean(draft && event && (draft.group === 'name' ? draft.name.trim() !== event.name :
    original && scheduleChanged(draft, original)));

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation.addListener('blur', () => {
      generation.current++;
      inFlight.current = null;
      setModel(null);
      setLeave(null);
      setExpanded(false);
    });
    return () => { mounted.current = false; generation.current++; inFlight.current = null; unsubscribe(); };
  }, [navigation, scope]);

  const isCurrent = () => mounted.current && Boolean(owner) && live.current.scope === scope &&
    viewGeneration === generation.current && adminReadOwner(live.current.auth) === owner && navigation.isFocused();
  usePreventRemove(Boolean(owner && (dirty || busy)), ({ data }) => {
    if (isCurrent() && !inFlight.current) setLeave({ scope, action: data.action });
  });

  function update(patch) {
    if (isCurrent()) setModel(previous => ({ ...(previous?.scope === scope ? previous : {}), ...patch, scope }));
  }
  function edit(group) {
    if (inFlight.current) return;
    update({ draft: group === 'name' ? { group, name: event.name } : { group, ...original }, notice: null });
  }
  function change(value) {
    if (!inFlight.current) update({ draft: { ...draft, ...value }, notice: null });
  }
  async function save() {
    if (!isCurrent() || inFlight.current || !dirty || !event) return;
    let payload;
    try { payload = draft.group === 'name' ? configurationName(draft.name) : prepareSchedule(event, original, draft, Date.now()); }
    catch (error) { update({ notice: { tone: 'error', message: error.message } }); return; }

    const ticket = { generation: generation.current };
    inFlight.current = ticket;
    update({ busy: true, notice: null });
    let notice, blocked, locks;
    try {
      const key = randomUUID();
      if (draft.group === 'name') await renameAdminEvent(client, eventId, payload, key);
      else await changeAdminSchedule(client, eventId, payload, key);
      notice = { tone: 'success', message: draft.group === 'name' ? 'Nome salvo.' : 'Programação salva.' };
    } catch (error) {
      notice = { tone: 'error', message: adminEventWriteError(error) };
      blocked = [401, 403, 404].includes(error?.status);
      if (error?.code === 'EVENT_CONFIGURATION_LOCKED') locks = { nameLocked: true, startLocked: true };
    } finally {
      if (isCurrent() && inFlight.current === ticket && ticket.generation === generation.current) {
        update({ draft: null, blocked, notice, ...locks });
        try { await panel.refresh(); }
        finally {
          if (inFlight.current === ticket) { inFlight.current = null; update({ busy: false }); }
        }
      }
    }
  }

  const now = Date.now();
  const ended = ['closing', 'closed'].includes(event?.effectivePhase);
  const canEditName = Boolean(event && !ended && !current?.nameLocked);
  const canEditEnd = Boolean(event && original && !ended && now < Date.parse(event.officialEndsAt));
  const canEditStart = canEditEnd && !current?.startLocked && now < Date.parse(event.startsAt);
  const nameEdit = draft?.group === 'name';
  const scheduleEdit = draft?.group === 'schedule';
  const schedule = scheduleEdit ? draft : original;
  const preview = scheduleEdit && previewOperationalDeadline(event, original, draft);
  const lockForm = busy || !event;
  return <AdminLiveScreen title="Informações e horários" subtitle="Dados gerais, datas, código e acesso deste evento."
    navigation={navigation} backLabel="Voltar ao painel" onBack={() => navigation.popTo('AdminRealEvent', { eventId })} showTabs>
    {current?.notice && <AdminNotice tone={current.notice.tone} title={current.notice.message} />}
    {busy && <AdminNotice title="Salvando e consultando o evento..." />}
    {panel.pending ? <AdminNotice title="Carregando evento..." /> : !event ?
      <AdminNotice tone="error" title="Evento indisponível" message={panel.blocked || panel.detailError}>
        <AdminButton label="Tentar novamente" onPress={() => { update({ blocked: false }); void panel.refresh(); }} disabled={busy} />
      </AdminNotice> : <>
      <AdminSelectedEvent event={event} readiness={panel.readiness} expanded={expanded} onToggle={() => setExpanded(value => !value)} />
      <Text style={s.body}>A possibilidade de edição será confirmada ao salvar.</Text>
      <SettingsSection title="Informações gerais" icon="edit">
        <SettingsField label="Nome do evento" value={nameEdit ? draft.name : event.name}
          onChangeText={nameEdit && !lockForm ? name => change({ name }) : undefined} />
        <Text style={s.body}>{canEditName ? 'A primeira participação registrada bloqueia a renomeação.' : 'Nome bloqueado para edição nesta fase.'}</Text>
        {canEditName && !draft && <AdminButton label="Editar nome" variant="ghost" disabled={busy} onPress={() => edit('name')} />}
        {nameEdit && <EditActions label="Salvar nome" dirty={dirty} busy={busy} save={save} discard={() => update({ draft: null, notice: null })} />}
      </SettingsSection>
      <SettingsSection title="Datas e horários" icon="calendar">
        {schedule ? <>
          <ScheduleDateTime label="início" value={schedule.start} instant={event.startsAt} timezone={event.timezone}
            onChange={scheduleEdit && canEditStart && !lockForm ? start => change({ start }) : undefined} />
          <ScheduleDateTime label="término oficial" value={schedule.end} instant={event.officialEndsAt} timezone={event.timezone}
            onChange={scheduleEdit && canEditEnd && !lockForm ? end => change({ end }) : undefined} />
          <SettingsField label="Margem operacional (minutos)" value={schedule.margin} keyboardType="number-pad"
            onChangeText={scheduleEdit && canEditEnd && !lockForm ? margin => change({ margin }) : undefined} />
          <SettingsField label={scheduleEdit ? 'Prazo operacional previsto' : 'Prazo operacional'}
            value={scheduleEdit && !preview ? 'Confira o término e a margem' :
              formatAdminDate(scheduleEdit ? preview : event.operationalDeadlineAt, event.timezone)} />
        </> : <Text style={s.body}>Programação indisponível para edição.</Text>}
        <SettingsField label="Fuso horário" value={event.timezone} />
        <Text style={s.body}>{canEditStart ? 'O início só pode ser ajustado antes do evento e sem participações registradas.' : 'Início bloqueado para edição.'}</Text>
        <Text style={s.body}>{canEditEnd ? 'A margem operacional pode ser de 0 a 60 minutos após o término oficial.' : 'A programação está bloqueada para edição.'}</Text>
        {canEditEnd && !draft && <AdminButton label="Editar horários" variant="ghost" disabled={busy} onPress={() => edit('schedule')} />}
        {scheduleEdit && <>
          <SettingsField label="Justificativa" value={draft.reason}
            onChangeText={lockForm ? undefined : reason => change({ reason })} />
          <EditActions label="Salvar horários" dirty={dirty} busy={busy} save={save} discard={() => update({ draft: null, notice: null })} />
        </>}
      </SettingsSection>
      <AdminEventAccess key={event.id} code={event.accessCode} isCurrent={isCurrent} />
    </>}
    {leave?.scope === scope && <Modal visible transparent onRequestClose={() => setLeave(null)}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#000c' }}>
        <View accessibilityViewIsModal style={s.card}>
          <Text accessibilityRole="header" style={s.title}>Alterações não salvas</Text>
          <AdminButton label="Permanecer editando" onPress={() => setLeave(null)} variant="secondary" />
          <AdminButton label="Descartar alterações" onPress={() => {
            if (!isCurrent()) return;
            update({ draft: null, notice: null });
            setLeave(null);
            navigation.dispatch(leave.action);
          }} />
        </View>
      </View>
    </Modal>}
  </AdminLiveScreen>;
}

function EditActions({ label, dirty, busy, save, discard }) {
  return <>
    <Text style={s.body}>{dirty ? 'Alterações não salvas' : 'Nenhuma alteração'}</Text>
    <AdminButton label={label} disabled={!dirty} loading={busy} onPress={save} />
    <AdminButton label="Descartar" disabled={busy} variant="ghost" onPress={discard} />
  </>;
}
