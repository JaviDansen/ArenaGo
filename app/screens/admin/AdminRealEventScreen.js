import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAdminEvent, adminReadError } from '../../services/adminEventsService';
import { adminReadOwner } from './useAdminEvents';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminEventSummary from './components/AdminEventSummary';
import AdminCard from './components/AdminCard';
import AdminNotice from './components/AdminNotice';
import AdminButton from './components/AdminButton';

export default function AdminRealEventScreen({ navigation, route }) {
  const auth = useAuth(), owner = adminReadOwner(auth), id = route.params?.eventId;
  const live = useRef(auth); live.current = auth;
  const [result, setResult] = useState(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    const current = () => active && owner && adminReadOwner(live.current) === owner;
    if (owner) getAdminEvent(auth.httpClient, id).then(event => {
      if (current()) setResult({ owner, id, event });
    }).catch(error => { if (current()) setResult({ owner, id, error: adminReadError(error) }); });
    return () => { active = false; };
  }, [auth.httpClient, owner, id, attempt]);
  const visible = result?.owner === owner && result?.id === id ? result : null;
  return <AdminLiveScreen title="Evento selecionado" navigation={navigation}>
    {!visible ? <AdminNotice title="Carregando evento..." /> : visible.error ?
      <AdminNotice tone="error" title="Evento indisponível" message={visible.error}>
        <AdminButton label="Tentar novamente" onPress={() => setAttempt(value => value + 1)} />
      </AdminNotice> : <>
        <AdminCard><AdminEventSummary event={visible.event} /></AdminCard>
        <AdminNotice title="Gerenciamento em implementação" message="As opções deste evento serão integradas na ADMIN-02." />
      </>}
  </AdminLiveScreen>;
}
