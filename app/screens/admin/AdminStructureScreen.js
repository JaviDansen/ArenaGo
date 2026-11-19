import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { adminEventPhases } from '../../services/adminEventsService';
import { AdminSetupIntents } from './adminSetupIntents';
import { createStructureFlow } from './adminStructureFlow';
import { adminReadOwner } from './useAdminEvents';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminButton from './components/AdminButton';
import AdminNotice from './components/AdminNotice';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import { AdminIcon, AdminIconTile, liveStyles as s, liveColors as c } from './components/AdminLiveUI';
import { SettingsField } from './components/AdminScheduleFields';

const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const status = station => station.availability === 'available' ? 'Disponível' : 'Indisponível';
const titles = { addExperience: 'Adicionar experiência', renameExperience: 'Editar experiência',
  addStation: 'Adicionar estação', renameStation: 'Editar identificação', availability: 'Alterar disponibilidade' };

export default function AdminStructureScreen({ eventId, navigation, returnToSetup }) {
  const auth = useAuth(), owner = adminReadOwner(auth), client = auth.httpClient;
  const memory = useContext(AdminSetupIntents);
  const live = useRef();
  live.current = { auth, client, eventId };
  const flow = useMemo(() => createStructureFlow({ client, eventId, newKey: randomUUID, intents: memory ?? new Map(),
    isCurrent: () => Boolean(owner && adminReadOwner(live.current.auth) === owner &&
      live.current.client === client && live.current.eventId === eventId),
  }), [client, owner, eventId, memory]);
  return owner ? <StructurePage key={owner + '/' + eventId} flow={flow} eventId={eventId} navigation={navigation}
    returnToSetup={returnToSetup} /> : null;
}

function StructurePage({ flow, eventId, navigation, returnToSetup }) {
  const [model, setModel] = useState(null);
  const [selection, setSelection] = useState(null);
  const [editor, setEditor] = useState(null);
  const [dialog, setDialog] = useState(null);
  const confirmation = useRef(null);
  const submitted = useRef(null);
  const state = model?.flow === flow ? model.state : flow.snapshot();
  const draft = editor?.flow === flow ? editor : null;
  const chosen = selection?.flow === flow ? selection : null;
  useEffect(() => {
    const dispose = flow.mount(value => setModel({ flow, state: value }));
    const off = navigation.addListener('focus', flow.refresh);
    return () => { off(); dispose(); };
  }, [flow, navigation]);

  const data = state.data;
  const groups = data?.items ?? [];
  const group = groups.find(item => item.id === chosen?.experienceId);
  const station = group?.stations.find(item => item.id === chosen?.stationId);
  const closed = data?.readiness.effectivePhase === 'closed' || data?.event.effectivePhase === 'closed';
  const locked = state.busy || closed;
  const dirty = Boolean(!state.denied && draft && submitted.current !== draft && draft.value.trim() !== (draft.original ?? ''));
  const canAct = () => flow.isActive() && navigation.isFocused();
  const back = () => returnToSetup ? navigation.goBack() : navigation.popTo('AdminRealEvent', { eventId });
  const selectedGroup = !chosen?.stationId && group;
  function ask(request) {
    confirmation.current = request;
    setDialog(request);
  }
  function resolveDialog(request, confirm) {
    if (confirmation.current !== request) return;
    confirmation.current = null;
    setDialog(null);
    if (!confirm || !canAct() || flow.snapshot().busy || flow.snapshot().denied) return;
    if (request.leave) {
      setEditor(current => current === request.draft ? null : current);
      navigation.dispatch(request.leave);
    } else if (request.abandon) flow.discard(request.abandon);
    else void save(request);
  }
  usePreventRemove(dirty || state.busy, ({ data: action }) => {
    if (!canAct() || flow.snapshot().busy) return;
    ask({ flow, leave: action.action, draft });
  });
  function begin(kind, experience, row) {
    if (kind === 'addStation') setSelection({ flow, experienceId: experience.id });
    const original = kind === 'renameStation' ? row.label : kind === 'renameExperience' ? experience.name : undefined;
    setEditor({ flow, kind, experienceId: experience?.id, stationId: row?.id, original, value: original ?? '',
      context: [experience?.name, row?.label].filter(Boolean).join(' · ') });
  }

  async function save(action) {
    if (!canAct()) return;
    if (action === draft) submitted.current = draft;
    try {
      if (await flow.save(action, data)) setEditor(current => current === action ? null : current);
    } finally {
      if (submitted.current === action) submitted.current = null;
    }
  }
  return <AdminLiveScreen key={draft?.kind ?? chosen?.stationId ?? 'list'} title="Experiências e estações"
    subtitle="Gerencie as experiências e os pontos de atendimento do evento."
    backLabel={returnToSetup ? 'Voltar à configuração' : 'Voltar ao painel'}
    onBack={back} backDisabled={state.busy} bottomSafeArea>
    {state.message && !state.pending.some(record => flow.recoveryMessage(record) === state.message) ?
      <AdminNotice title={state.message} tone={state.denied || !data ? 'error' : 'info'} /> : null}
    {state.loading && <AdminNotice title="Consultando estrutura e prontidão..." />}
    {!state.denied && !state.loading && <AdminButton label={data ? 'Atualizar' : 'Tentar novamente'}
      compact variant="ghost" disabled={state.busy} onPress={flow.refresh} />}
    {data && <>
      <View style={[s.card, s.row]}><AdminIconTile name="calendar" /><View style={s.grow}>
        <Text style={s.title}>{data.event.name}</Text>
        <Text style={s.body}>{count(groups.length, 'experiência', 'experiências')} · {count(groups.reduce((n, item) => n + item.stations.length, 0), 'estação', 'estações')}</Text>
        <Text style={s.body}>{adminEventPhases[data.event.effectivePhase]} · {data.readiness.ready ? 'Pronto para operar' : 'Configuração pendente'}</Text>
      </View></View>
      {closed && <AdminNotice title="A operação do evento já terminou."
        message={state.pending.length ? 'Você ainda pode consultar a estrutura e encerrar o acompanhamento dos envios pendentes.' : undefined} />}
      {chosen?.stationId && !station && <AdminNotice title="Estação indisponível nesta estrutura"
        message="Consulte as estações atuais da experiência antes de continuar." />}
      {state.pending.map(record => {
        const parent = groups.find(item => item.id === (record.kind === 'addExperience' ? record.result?.id : record.experienceId));
        const row = parent?.stations.find(item => item.id === (record.kind === 'addStation' ? record.result?.id : record.stationId));
        const context = [parent?.name, row?.label].filter(Boolean).join(' · ');
        const suffix = state.pending.length > 1 ? ' · ' + [titles[record.kind], context, record.value].filter(Boolean).join(' · ') : '';
        return <View key={record.id} style={s.card}>
          <Text style={s.title}>{titles[record.kind]} · {record.kind === 'availability' ?
            status({ availability: record.value }) : record.value}</Text>
          {context ? <Text style={s.body}>{context}</Text> : null}
          <Text style={s.body}>{flow.recoveryMessage(record)}</Text>
          {parent && <AdminButton label="Consultar recurso" accessibilityLabel={'Consultar recurso' + suffix} variant="ghost"
            disabled={Boolean(draft)} onPress={() => setSelection({ flow, experienceId: parent.id, stationId: row?.id })} />}
          {!closed && record.kind !== 'availability' && <AdminButton label="Repetir a mesma solicitação"
            accessibilityLabel={'Repetir a mesma solicitação' + suffix} disabled={state.busy || !flow.canReview(record)}
            onPress={() => { if (canAct()) void flow.retry(record); }} />}
          {!record.flight && <AdminButton label="Encerrar tentativa" accessibilityLabel={'Encerrar tentativa' + suffix}
            variant="ghost" disabled={state.busy || !flow.canReview(record)} onPress={() => ask({ flow, abandon: record })} />}
        </View>;
      })}
      {draft ? <View style={s.card}>
        <Text accessibilityRole="header" style={s.title}>{titles[draft.kind]}</Text>
        {draft.context ? <Text style={s.body}>{draft.context}</Text> : null}
        <SettingsField label={draft.kind.endsWith('Station') ? 'Identificação da estação' : 'Nome da experiência'}
          value={draft.value} onChangeText={!locked ? value => setEditor({ ...draft, value }) : undefined} />
        <AdminButton label="Confirmar gravação" disabled={locked} onPress={() => save(draft)} />
        <AdminButton label="Cancelar" variant="ghost" disabled={state.busy} onPress={() => setEditor(null)} />
      </View> : station ? <View style={s.card}>
        <Text style={s.body}>{group.name}</Text><Text style={s.title}>{station.label}</Text>
        <Text style={station.availability === 'available' ? styles.available : s.body}>{status(station)}</Text>
        <Text style={s.body}>{station.pendingServiceSessionId ? 'Chamada pendente' : 'Sem chamada pendente'}</Text>
        <AdminButton label="Editar identificação" variant="secondary" disabled={locked} onPress={() => begin('renameStation', group, station)} />
        <AdminButton label={station.availability === 'available' ? 'Tornar indisponível' : 'Tornar disponível'} disabled={locked}
          onPress={() => ask({ flow, kind: 'availability', experienceId: group.id, stationId: station.id,
            original: station.availability, value: station.availability === 'available' ? 'unavailable' : 'available' })} />
        <AdminButton label="Voltar à estrutura" variant="ghost" onPress={() => setSelection(null)} />
      </View> : <>
        {selectedGroup ? <AdminButton label="Ver todas as experiências" variant="ghost" onPress={() => setSelection(null)} /> :
          <View style={styles.tools}><View style={styles.tool}><AdminButton label="Adicionar experiência" disabled={locked} onPress={() => begin('addExperience')} /></View>
            <View style={styles.tool}><AdminButton label="Catálogo · Em breve" variant="ghost" disabled /></View></View>}
        <Text accessibilityRole="header" style={[s.title, styles.heading]}>{selectedGroup ? 'Experiência selecionada' : 'Experiências do evento'}</Text>
        {!groups.length && <AdminNotice title="Nenhuma experiência cadastrada" />}
        {(selectedGroup ? [selectedGroup] : groups).map(item => <View key={item.id} style={s.card}>
          <View style={s.row}><AdminIconTile name="folder" /><View style={s.grow}><Text style={s.title}>{item.name}</Text>
            <Text style={s.body}>{count(item.stations.length, 'estação', 'estações')}</Text></View></View>
          <AdminButton label="Editar nome" accessibilityLabel={'Editar experiência ' + item.name} variant="ghost" compact disabled={locked}
            onPress={() => begin('renameExperience', item)} />
          {item.stations.map(row => <Pressable key={row.id} accessibilityRole="button"
            accessibilityLabel={row.label + ', ' + item.name + ', ' + status(row) + (row.pendingServiceSessionId ? ', chamada pendente' : '')}
            onPress={() => setSelection({ flow, experienceId: item.id, stationId: row.id })}
            style={({ pressed }) => [styles.station, s.row, pressed && styles.pressed]}>
            <View style={s.grow}><Text style={styles.label}>{row.label}</Text>
              {row.pendingServiceSessionId && <Text style={s.body}>Chamada pendente</Text>}</View>
            <Text style={row.availability === 'available' ? styles.available : styles.offline}>{status(row)}</Text>
            <AdminIcon name="chevron" size={18} />
          </Pressable>)}
          <AdminButton label="Adicionar estação" accessibilityLabel={'Adicionar estação em ' + item.name} disabled={locked}
            variant="secondary" onPress={() => begin('addStation', item)} />
        </View>)}
      </>}
    </>}
    {dialog?.flow === flow && !state.denied && <AdminConfirmDialog visible title={dialog.leave ? 'Alterações não salvas' :
      dialog.abandon ? 'Encerrar tentativa?' : 'Alterar disponibilidade?'}
        message={dialog.leave ? 'Os campos não enviados serão descartados. Os dados já salvos permanecem no evento.' :
          dialog.abandon ? 'O envio anterior pode ter sido salvo. Esta ação encerra apenas o acompanhamento neste aparelho.' : dialog.value === 'unavailable' ?
          'Esta estação ficará indisponível e poderá reduzir a capacidade de atendimento do evento.' : 'Esta estação ficará disponível para atendimento.'}
        confirmLabel={dialog.leave ? 'Descartar alterações' : 'Confirmar'} cancelLabel={dialog.leave ? 'Continuar editando' : 'Cancelar'}
        onCancel={() => resolveDialog(dialog, false)} onConfirm={() => resolveDialog(dialog, true)} />}
  </AdminLiveScreen>;
}

const styles = StyleSheet.create({
  heading: { marginTop: 22 }, tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tool: { flexGrow: 1, flexBasis: 140 }, available: { color: '#42e8b8', fontWeight: '600' },
  offline: { color: c.muted }, label: { color: c.text, fontWeight: '600' },
  station: { minHeight: 48, padding: 10, marginTop: 8, borderWidth: 1, borderRadius: 10, borderColor: c.border },
  pressed: { opacity: 0.7 },
});
