import { Text, View } from 'react-native';
import { adminEventAreas } from './adminEventManagement';
import useAdminEventPanel from './useAdminEventPanel';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
import AdminButton from './components/AdminButton';
import { liveStyles as s } from './components/AdminLiveUI';
import AdminEventSettingsScreen from './AdminEventSettingsScreen';
import AdminRealEventStaffScreen from './AdminRealEventStaffScreen';
import AdminEventOperationScreen from './AdminEventOperationScreen';
import AdminStructureScreen from './AdminStructureScreen';

export default function AdminEventManagementInfoScreen({ navigation, route }) {
  const { eventId, area, returnToSetup } = route.params ?? {};
  if (area === 'staff') return <AdminRealEventStaffScreen key={eventId} eventId={eventId} navigation={navigation} />;
  if (area === 'operation') return <AdminEventOperationScreen key={eventId} eventId={eventId} navigation={navigation} />;
  if (area === 'experiences') return <AdminStructureScreen navigation={navigation} eventId={eventId}
    returnToSetup={returnToSetup === true} />;
  return area === 'schedule' ? <AdminEventSettingsScreen navigation={navigation} eventId={eventId} /> :
    <AdminEventManagementPlaceholder navigation={navigation} eventId={eventId} area={area} />;
}

function AdminEventManagementPlaceholder({ navigation, eventId, area }) {
  const section = typeof area === 'string' && Object.hasOwn(adminEventAreas, area) ? adminEventAreas[area] : null;
  const { event, pending, blocked, detailError, refresh } = useAdminEventPanel(navigation, section ? eventId : undefined, false);

  return <AdminLiveScreen title={section?.title ?? 'Área indisponível'} navigation={navigation}
    backLabel="Voltar ao painel" onBack={() => navigation.popTo('AdminRealEvent', { eventId })} showTabs>
    {!section ? <AdminNotice title="Área indisponível" message="Selecione uma área no painel do evento." /> :
      pending ? <AdminNotice title="Carregando evento..." /> :
      event ? <View style={s.card}>
        <Text style={s.title}>{event.name}</Text>
        <Text style={s.body}>Esta área ainda não permite alterações. Volte ao painel para consultar a prontidão do evento.</Text>
      </View> : <AdminNotice tone="error" title="Evento indisponível" message={blocked || detailError}>
        <AdminButton label="Tentar novamente" onPress={() => refresh()} />
      </AdminNotice>}
  </AdminLiveScreen>;
}
