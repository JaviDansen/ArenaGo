import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { adminReadOwner } from './useAdminEvents';
import { createEventSetup } from './adminCreationFlow';
import { AdminSetupIntents } from './adminSetupIntents';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminButton from './components/AdminButton';
import AdminNotice from './components/AdminNotice';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import { liveStyles as s } from './components/AdminLiveUI';
import { DatesStep, EventReview, EventStaffStep, EventStructureStep, IdentityStep, stepTitles } from './components/AdminSetupSteps';

function Progress({ step }) {
  return <View style={s.card} accessible accessibilityRole="progressbar" accessibilityLabel="Progresso do formulário"
    accessibilityValue={{ min: 0, max: 5, now: step, text: `Etapa ${step} de 5` }}>
    <View style={s.row}><Text style={[s.grow, styles.progressTitle]}>Etapa {step} de 5</Text>
      <Text style={styles.percent}>{step * 20}% do fluxo</Text></View>
    <View style={styles.track}><View style={[styles.fill, { width: `${step * 20}%` }]} /></View>
  </View>;
}

export default function AdminEventSetupScreen({ navigation, route }) {
  const auth = useAuth(), owner = adminReadOwner(auth), client = auth.httpClient;
  const selected = route.params?.eventId;
  const structureIntents = useContext(AdminSetupIntents);
  const live = useRef(null);
  live.current = { auth, selected };
  const flow = useMemo(() => createEventSetup({ client, eventId: selected, newKey: randomUUID, structureIntents,
    isCurrent: () => Boolean(owner && adminReadOwner(live.current.auth) === owner &&
      live.current.auth.httpClient === client && live.current.selected === selected),
  }), [client, owner, selected, structureIntents]);
  const mountedFlow = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [dialog, setDialog] = useState(null);
  const pendingDialog = useRef(null);
  const state = snapshot?.flow === flow ? snapshot.state : flow.snapshot();
  useEffect(() => {
    mountedFlow.current = flow;
    const dispose = flow.mount(value => setSnapshot({ flow, state: value }));
    const remove = navigation.addListener('focus', flow.refresh);
    return () => { mountedFlow.current = null; dispose(); remove(); };
  }, [flow, navigation]);

  const localSetup = Boolean(state.experience || state.station || state.email);
  const dirty = !state.blocked && (state.edited || localSetup || state.uncertain);
  const locked = state.busy || state.uncertain;
  const finished = state.step === 6;
  const persisted = Boolean(state.eventId);
  const structurePending = state.uncertain && flow.hasPendingStructure();
  const canConfirm = () => mountedFlow.current === flow && live.current.selected === selected &&
    live.current.auth.httpClient === client && adminReadOwner(live.current.auth) === owner && navigation.isFocused();
  function ask(title, message, confirmLabel, action) {
    const request = { flow, title, message, confirmLabel, action };
    pendingDialog.current = request;
    setDialog(request);
  }
  function closeDialog(confirm) {
    if (pendingDialog.current !== dialog) return;
    pendingDialog.current = null;
    setDialog(null);
    if (confirm && canConfirm()) dialog.action();
  }
  usePreventRemove(Boolean(owner && (dirty || state.busy)), ({ data }) => {
    if (!navigation.isFocused() || state.busy) return;
    ask('Sair da configuração?', structurePending
      ? 'O cadastro pode ter sido salvo. Ao reabrir este evento na mesma sessão, confira a estrutura e retome a solicitação pendente.'
      : state.uncertain ? 'A solicitação pode ter sido salva. Confira o evento em Gerenciar Eventos antes de iniciar outra ação.'
      : persisted ? 'Os campos não enviados serão descartados. Os dados já salvos permanecem no evento.'
        : 'O formulário está somente neste aparelho e será descartado ao sair.',
    'Sair do fluxo', () => navigation.dispatch(data.action));
  });
  function move(action) {
    if (locked || !canConfirm() || flow.snapshot().stepVersion !== state.stepVersion) return;
    if (!localSetup) { action(); return; }
    ask('Descartar campos não enviados?', 'Os dados já salvos permanecem no evento.', 'Descartar e continuar', () => {
      if (flow.snapshot().stepVersion !== state.stepVersion) return;
      flow.editSetup({ experience: '', station: '', parent: null, email: '' });
      action();
    });
  }
  const home = () => navigation.popTo('AdminTabs', { screen: 'Home' });
  const panel = () => navigation.popTo('AdminRealEvent', { eventId: state.eventId });
  const origin = () => selected ? panel() : route.params?.origin === 'home' ? home() : navigation.popTo('AdminEvents');
  const headerBack = finished || state.ended ? panel : state.uncertain || state.blocked ? origin : state.step > 1 ? () => move(flow.back) : origin;
  const headerLabel = finished || state.ended ? 'Voltar ao painel' : !state.uncertain && !state.blocked && state.step > 1 ? 'Voltar uma etapa' :
    selected ? 'Voltar ao painel' : route.params?.origin === 'home' ? 'Voltar para Home' : 'Voltar aos eventos';
  const needsData = persisted && !state.blocked && (state.loading || state.readError || !state.event || !state.readiness);
  const confirmRevoke = grant => ask('Revogar acesso Staff?', `${grant.email} perderá o acesso Staff a este evento. A prontidão pode mudar.`,
    'Revogar acesso', () => flow.run('revoke', grant.id));
  if (!owner) return null;
  return <AdminLiveScreen key={state.step} navigation={navigation} mode="wizard" bottomSafeArea
    title={finished || state.ended ? 'Evento criado' : 'Criar evento'}
    subtitle={finished ? 'Consulte a configuração salva e escolha a próxima ação.' : 'Fluxo guiado para cadastrar um novo evento.'}
    backLabel={headerLabel} backDisabled={state.busy} onBack={headerBack}>
    {!finished && !state.ended && <Progress step={state.step} />}
    {state.blocked ? <AdminNotice tone="error" title="Acesso indisponível" message="Sua sessão perdeu acesso a esta operação. Entre novamente." /> :
      state.ended ? <>
        <AdminNotice tone="warning" title="Evento salvo em encerramento"
          message="O evento foi salvo, mas está encerrando ou já encerrou. Você pode consultar os dados no painel do evento." />
        <AdminButton label="Abrir painel do evento" onPress={panel} />
      </> : <>
      {state.message && <AdminNotice tone={state.uncertain ? 'warning' : 'info'} title={state.message} />}
      {state.uncertain && <AdminButton label="Repetir a mesma solicitação" variant="secondary"
        disabled={state.loading || (structurePending && Boolean(state.readError))}
        onPress={() => flow.retry()} />}
      {state.uncertain && persisted && !state.readError &&
        <AdminButton label="Consultar dados salvos" variant="ghost" disabled={state.loading} onPress={() => flow.refresh()} />}
      {structurePending && !state.loading && !state.readError &&
        <AdminButton label="Encerrar a tentativa de confirmação" variant="ghost" onPress={() =>
          ask('Encerrar a tentativa de confirmação?', 'O cadastro anterior ainda pode ter sido salvo. Confira a estrutura do evento antes de fazer outro cadastro.',
            'Encerrar tentativa', () => flow.discardStructureIntent())} />}
      {state.busy && <AdminNotice title="Salvando..." />}
      {needsData ? <AdminNotice tone={state.readError ? 'error' : 'info'} title={state.readError || 'Consultando o evento...'}>
        {state.readError && <AdminButton label="Tentar consulta novamente" onPress={() => flow.refresh()} />}
      </AdminNotice> : <>
        {state.step === 1 && <IdentityStep state={state} flow={flow} locked={locked} />}
        {state.step === 2 && <DatesStep state={state} flow={flow} locked={locked} />}
        {state.step === 3 && <EventStructureStep state={state} flow={flow} locked={locked} />}
        {state.step === 4 && <EventStaffStep state={state} flow={flow} locked={locked} confirmRevoke={confirmRevoke} />}
        {state.step >= 5 && <>
          <Text accessibilityRole="header" style={[s.title, styles.heading]}>{finished
            ? state.readiness.ready ? 'Evento criado com sucesso' : 'Evento salvo com sucesso' : stepTitles[4]}</Text>
          <EventReview state={state} finished={finished} goTo={step => move(() => flow.step(step))} />
        </>}
        {finished ? <>
          <Text accessibilityRole="header" style={[s.title, styles.heading]}>Próximos passos</Text>
          <AdminButton label="Abrir painel do evento" onPress={panel} />
          <AdminButton label="Revisar equipe Staff" variant="secondary" onPress={() => flow.step(4)} />
          <AdminButton label="Acompanhar operação do evento" variant="secondary"
            onPress={() => navigation.replace('AdminEventManagementInfo', { eventId: state.eventId, area: 'operation' })} />
          <AdminButton label="Voltar para a Home Admin" variant="ghost" onPress={home} />
        </> : <>
          {persisted ? <AdminButton label="Salvar e revisar depois" variant="secondary" disabled={locked}
            onPress={() => move(() => flow.step(6))} /> :
            <Text style={s.body}>O formulário permanece em memória enquanto este fluxo estiver aberto.</Text>}
          <AdminButton label={state.step === 5 ? state.readiness.ready ? 'Concluir configuração' : 'Finalizar com pendências'
            : state.step === 2 && !persisted ? 'Criar evento e continuar' : 'Continuar'}
            disabled={locked} onPress={() => move(state.step === 2 && !persisted
              ? () => flow.confirmCreate(state.stepVersion) : () => flow.next(state.stepVersion))} />
        </>}
      </>}
    </>}
    {dialog?.flow === flow && !state.blocked && <AdminConfirmDialog visible title={dialog.title} message={dialog.message}
      confirmLabel={dialog.confirmLabel} cancelLabel="Cancelar"
      onCancel={() => closeDialog(false)} onConfirm={() => closeDialog(true)} />}
  </AdminLiveScreen>;
}

const styles = StyleSheet.create({
  heading: { marginTop: 20 }, progressTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  percent: { color: '#39e5bc', fontWeight: '600' }, track: { marginTop: 12, height: 10, borderRadius: 5, backgroundColor: '#443151' },
  fill: { height: 10, borderRadius: 5, backgroundColor: '#26dcb1' },
});
