import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { readEventStaff } from '../../services/adminEventSetupService';
import { adminReadOwner } from './useAdminEvents';
import useAdminEventPanel from './useAdminEventPanel';
import { AdminStaffSession } from './adminSetupIntents';
import { staffEmail } from './adminCreationForm';
import { EventStaffForm, StaffOperationStatus, StaffReadiness } from './components/AdminSetupSteps';
import { SettingsSection } from './components/AdminScheduleFields';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminButton from './components/AdminButton';
import AdminNotice from './components/AdminNotice';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import { liveStyles as s } from './components/AdminLiveUI';

export default function AdminRealEventStaffScreen({ navigation, eventId }) {
  const auth = useAuth();
  const owner = adminReadOwner(auth);
  const session = useContext(AdminStaffSession);
  if (!owner) return null;
  if (!session) return <AdminLiveScreen title="Equipe Staff" navigation={navigation} backLabel="Voltar ao painel"
    onBack={() => navigation.popTo('AdminRealEvent', { eventId })}>
    <AdminNotice tone="warning" title="Gestão Staff indisponível para esta sessão." />
  </AdminLiveScreen>;
  return <StaffManagement key={owner + ':' + eventId} {...{ navigation, eventId, session, owner }} />;
}

function useStaffRoster(navigation, eventId, session, owner) {
  const auth = useAuth();
  const client = auth.httpClient;
  const scope = useMemo(() => ({}), [navigation, client, eventId, session, owner]);
  const live = useRef({ scope, auth });
  live.current = { scope, auth };
  const request = useRef(null);
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let active = true;
    let focusStarted = false;
    let generation = 0;
    const focused = () => active && live.current.scope === scope && navigation.isFocused() &&
      adminReadOwner(live.current.auth) === owner && !session.snapshot(eventId).denied;
    async function refresh() {
      if (!focused()) return;
      const ticket = ++generation;
      setSnapshot(previous => {
        if (previous?.scope !== scope) return { scope, pending: true };
        if (previous.denied) return { ...previous, pending: true };
        return { scope, pending: true, hasLoaded: previous.hasLoaded };
      });
      try {
        const items = await readEventStaff(client, eventId);
        if (focused() && ticket === generation) setSnapshot({ scope, ticket, items, hasLoaded: true });
      } catch (error) {
        if (!focused() || ticket !== generation) return;
        const denied = [401, 403].includes(error?.status);
        setSnapshot(previous => ({ scope, ticket, denied, hasLoaded: previous?.scope === scope && previous.hasLoaded,
          error: denied ? 'Sua sessão não permite consultar a equipe Staff.' :
            error?.status === 404 ? 'Evento não encontrado ou indisponível.' : 'Não foi possível consultar a equipe Staff.' }));
      }
    }
    function onFocus() {
      // A montagem já focada e a notificação de foco podem ocorrer na mesma entrada.
      if (focusStarted || !focused()) return;
      focusStarted = true;
      void refresh();
    }
    request.current = { scope, refresh, isCurrent: ticket => focused() && ticket === generation };
    const focus = navigation.addListener('focus', onFocus);
    const blur = navigation.addListener('blur', () => {
      focusStarted = false;
      generation++;
    });
    const unsubscribe = session.subscribe((id, reload) => {
      if (id === eventId && reload) return refresh();
    });
    onFocus();
    return () => {
      active = false;
      if (request.current?.scope === scope) request.current = null;
      focus();
      blur();
      unsubscribe();
    };
  }, [navigation, client, eventId, session, owner, scope]);

  return {
    ...(snapshot?.scope === scope ? snapshot : { pending: true }),
    isCurrent: () => snapshot?.scope === scope && request.current?.scope === scope &&
      request.current.isCurrent(snapshot.ticket),
    refresh: () => { if (request.current?.scope === scope) return request.current.refresh(); },
  };
}

function StaffManagement({ navigation, eventId, session, owner }) {
  const panel = useAdminEventPanel(navigation, eventId);
  const roster = useStaffRoster(navigation, eventId, session, owner);
  const [draft, setDraft] = useState({ session, email: '' });
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState(null);
  const [, render] = useState(0);
  const live = useRef(null);
  const mounted = useRef(false);
  const refresh = useRef(null);
  refresh.current = panel.refresh;
  const view = session.snapshot(eventId);
  const email = draft.session === session ? draft.email : '';
  const available = Boolean(panel.event && !panel.blocked && !view.denied && !roster.denied);
  const blocked = view.denied || panel.blocked || (roster.denied && roster.error);
  const revocation = dialog?.session === session && dialog.kind === 'revoke' && !blocked ? dialog : null;
  const selectedGrant = revocation && roster.items?.find(item => item.id === revocation.target);
  const revokeAttempt = revocation && view.attempts.find(record => record.kind === 'revoke' && record.target === revocation.target &&
    record.status !== 'unavailable');
  let revokeAction;
  if (revocation) {
    if (roster.pending || panel.pending) revokeAction = 'checking';
    else if (roster.error || !panel.event) revokeAction = 'retry';
    else if (!selectedGrant) revokeAction = 'missing';
    else if (revokeAttempt) revokeAction = 'tracked';
    else revokeAction = 'send';
  }
  live.current = { session, available, dialog, email, roster, revokeAction };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = session.subscribe((id, reload) => {
      if (id && id !== eventId) return;
      render(n => n + 1);
      if (reload && navigation.isFocused()) return refresh.current(true, true);
    });
    const unsubscribeBlur = navigation.addListener('blur', () => {
      if (live.current?.dialog?.kind === 'revoke') live.current.dialog = null;
      setDialog(previous => previous?.kind === 'revoke' ? null : previous);
    });
    return () => { unsubscribe(); unsubscribeBlur(); mounted.current = false; };
  }, [session, eventId, navigation]);
  useEffect(() => {
    if (blocked || dialog?.session !== session) {
      setDialog(previous => previous?.kind === 'revoke' ? null : previous);
    }
  }, [blocked, dialog?.session, session]);
  const current = () => mounted.current && live.current?.session === session && live.current.available && navigation.isFocused();
  function edit(value) { setError(null); setDraft({ session, email: value }); }
  usePreventRemove(Boolean(email && !panel.blocked && !view.denied && !roster.denied), ({ data }) => {
    if (navigation.isFocused()) setDialog({ session, leave: data.action });
  });
  async function submit(kind, target, record) {
    if (!current()) return;
    setError(null);
    const done = await session.send(eventId, kind, target, record);
    if (done && mounted.current && kind === 'grant' && live.current?.session === session && live.current.email.trim().toLowerCase() === target) edit('');
  }
  function confirmGrant() {
    if (!current()) return;
    try { setDialog({ session, kind: 'grant', target: staffEmail(email) }); }
    catch (invalid) { setError({ session, message: invalid.message }); }
  }
  function resolve(confirm) {
    if (!mounted.current || live.current?.dialog !== dialog || dialog?.session !== session) return;
    live.current.dialog = null;
    setDialog(null);
    if (!confirm || !navigation.isFocused()) return;
    if (dialog.leave) { edit(''); navigation.dispatch(dialog.leave); }
    else if (dialog.kind === 'grant' && current()) void submit('grant', dialog.target);
  }
  function confirmRevocation() {
    if (!mounted.current || live.current?.dialog !== revocation || !revocation ||
        !navigation.isFocused() || live.current.revokeAction !== revokeAction) return;
    const latestRoster = live.current.roster;
    if (!latestRoster.isCurrent()) return;
    if (revokeAction === 'retry') {
      if (latestRoster.error) void latestRoster.refresh();
      if (!panel.event) void panel.refresh(true);
      return;
    }
    if (revokeAction === 'missing' || revokeAction === 'tracked') {
      resolve(false);
      return;
    }
    if (revokeAction !== 'send' || !current()) return;
    const grant = latestRoster.items?.find(item => item.id === revocation.target);
    if (!grant || grant.eventId !== eventId) return;
    if (session.snapshot(eventId).attempts.some(record => record.kind === 'revoke' &&
      record.target === grant.id && record.status !== 'unavailable')) return;
    resolve(false);
    setError(null);
    void session.revokeListed(eventId, grant);
  }
  const state = { ...view, email, readiness: panel.readiness, staffError: error?.session === session ? error.message : null };
  const latestFeedback = [...new Map(view.feedback.map(result => [
    result.kind === 'revoke' ? result.id : 'grant:' + result.email, result,
  ])).values()];
  const statusFor = kind => ({
    attempts: view.attempts.filter(record => record.kind === kind),
    feedback: latestFeedback.filter(result => result.kind === kind &&
      !view.attempts.some(record => record.status === 'sending' &&
        (record.kind === 'revoke' ? record.target === result.grantId : record.email === result.email))),
  });
  const retryStaff = record => submit(record.kind, record.target, record);
  const flow = { editSetup: patch => edit(patch.email) };
  const revokeNote = {
    checking: 'Atualizando a equipe Staff. Aguarde a verificação do vínculo.',
    retry: 'Não foi possível verificar o vínculo. Atualize os dados para tentar novamente.',
    missing: 'O acesso selecionado já não consta na equipe Staff.',
    tracked: 'Já existe uma revogação para este vínculo. Consulte o estado da operação na lista.',
  }[revokeAction];
  return <AdminLiveScreen title="Equipe Staff" navigation={navigation} showTabs backLabel="Voltar ao painel"
    subtitle={!blocked ? panel.event?.name : undefined}
    onBack={() => navigation.popTo('AdminRealEvent', { eventId })}>
    {blocked ? <AdminNotice tone="error" title="Acesso indisponível" message={blocked}>
      {roster.denied && !panel.blocked && !view.denied &&
        <AdminButton label="Tentar consultar a equipe novamente" onPress={roster.refresh} loading={roster.pending} />}
    </AdminNotice> :
      panel.pending ? <AdminNotice title="Consultando o evento..." /> : <>
        {(panel.detailError || panel.readinessError) && <AdminNotice tone="warning" title="Consulta indisponível"
          message={panel.detailError || panel.readinessError}>
          <AdminButton label="Tentar novamente" onPress={() => panel.refresh(true)} />
        </AdminNotice>}
        {available && <>
          <EventStaffForm {...{ state, flow, confirmGrant }}>
            <StaffOperationStatus state={statusFor('grant')} retryStaff={retryStaff} relatedFeedback={latestFeedback} />
          </EventStaffForm>
          <SettingsSection title="Staff do evento" icon="users">
            {roster.pending && <AdminNotice title={roster.hasLoaded ? 'Atualizando a equipe Staff...' : 'Consultando a equipe Staff...'} />}
            {roster.error && <AdminNotice tone="error" title={roster.error}>
              <AdminButton label="Tentar consultar a equipe novamente" onPress={roster.refresh} />
            </AdminNotice>}
            {roster.items?.length === 0 && <Text style={s.body}>Nenhum Staff vinculado a este evento</Text>}
            {roster.items?.map(grant => {
              const attempt = view.attempts.find(r => r.kind === 'revoke' && r.target === grant.id);
              return <View key={grant.id} style={s.card}>
                <Text style={s.title}>{grant.name}</Text>
                <Text style={s.body} selectable>{grant.email}</Text>
                {!grant.eligible && <Text style={s.body}>Vínculo ativo · conta inelegível</Text>}
                <AdminButton label="Revogar acesso" accessibilityLabel={`Revogar acesso de ${grant.email}`} variant="ghost"
                  loading={attempt?.status === 'sending'} disabled={Boolean(attempt && attempt.status !== 'unavailable')}
                  onPress={() => current() && setDialog({ session, kind: 'revoke', target: grant.id, email: grant.email,
                    eventName: panel.event.name })} />
              </View>;
            })}
            <StaffOperationStatus state={statusFor('revoke')} retryStaff={retryStaff} relatedFeedback={latestFeedback} />
            <StaffReadiness state={state} />
          </SettingsSection>
        </>}
      </>}
    {dialog?.session === session && dialog.kind !== 'revoke' && (dialog.leave || available) && <AdminConfirmDialog visible
      title={dialog.leave ? 'Descartar e-mail não enviado?' : 'Conceder acesso Staff?'}
      message={dialog.leave ? 'O campo será descartado. Operações já enviadas continuam no servidor.' :
        dialog.target + ' receberá acesso Staff ao evento ' + panel.event.name + '.'}
      confirmLabel={dialog.leave ? 'Descartar alterações' : 'Confirmar concessão'}
      cancelLabel="Cancelar" onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />}
    {revocation && <AdminConfirmDialog visible
      title="Revogar acesso Staff?"
      message={revocation.email + ' · ' + revocation.eventName}
      note={revokeNote ?? 'A confirmação remove o acesso Staff deste vínculo. A prontidão pode mudar.'}
      confirmLabel={revokeAction === 'retry' ? 'Atualizar equipe Staff' :
        ['missing', 'tracked'].includes(revokeAction) ? 'Voltar à equipe' : 'Revogar acesso'}
      confirmDisabled={revokeAction === 'checking'}
      cancelLabel="Cancelar" onConfirm={confirmRevocation} onCancel={() => resolve(false)} />}
  </AdminLiveScreen>;
}
