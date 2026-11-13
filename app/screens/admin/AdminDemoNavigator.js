import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import AdminCreateEventScreen from './AdminCreateEventScreen';
import { AdminDemoProvider, getAdminDemoOwnerKey } from './AdminDemoContext';
import AdminEventBiScreen from './AdminEventBiScreen';
import AdminEventCloseScreen from './AdminEventCloseScreen';
import AdminEventDetailScreen from './AdminEventDetailScreen';
import AdminEventExperiencesScreen from './AdminEventExperiencesScreen';
import AdminEventQueueScreen from './AdminEventQueueScreen';
import AdminEventScheduleScreen from './AdminEventScheduleScreen';
import AdminEventsScreen from './AdminEventsScreen';
import AdminEventStaffScreen from './AdminEventStaffScreen';
import AdminExperienceDetailScreen from './AdminExperienceDetailScreen';
import AdminHistoryScreen from './AdminHistoryScreen';
import AdminOverviewScreen from './AdminOverviewScreen';
import AdminPanelScreen from './AdminPanelScreen';
import AdminStationDetailScreen from './AdminStationDetailScreen';

const Stack = createNativeStackNavigator();

// Pilha do Admin autenticado; as operações continuam demonstrativas. O provedor fica aqui para
// que todo o estado simulado seja descartado ao sair da área. A key amarrada à
// conta e à geração da sessão remonta provedor e telas se a identidade mudar.
// O cabeçalho nativo fica oculto porque cada tela desenha o seu.
export default function AdminDemoNavigator() {
  const ownerKey = getAdminDemoOwnerKey(useAuth());
  // Defesa adicional inclusive se este componente for montado por uma rota antiga.
  if (!ownerKey) return null;
  return (
    <AdminDemoProvider key={ownerKey}>
      <Stack.Navigator initialRouteName="AdminPanel" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AdminPanel" component={AdminPanelScreen} options={{ title: 'Painel Administrativo' }} />
        <Stack.Screen name="AdminEvents" component={AdminEventsScreen} options={{ title: 'Gerenciar Eventos' }} />
        <Stack.Screen name="AdminCreateEvent" component={AdminCreateEventScreen} options={{ title: 'Criar Evento' }} />
        <Stack.Screen name="AdminEventDetail" component={AdminEventDetailScreen} options={{ title: 'Detalhe do Evento' }} />
        <Stack.Screen name="AdminEventSchedule" component={AdminEventScheduleScreen} options={{ title: 'Alterar Horários' }} />
        <Stack.Screen name="AdminEventQueue" component={AdminEventQueueScreen} options={{ title: 'Fila Externa' }} />
        <Stack.Screen name="AdminEventClose" component={AdminEventCloseScreen} options={{ title: 'Encerrar Evento' }} />
        <Stack.Screen name="AdminEventExperiences" component={AdminEventExperiencesScreen} options={{ title: 'Experiências do Evento' }} />
        <Stack.Screen name="AdminExperienceDetail" component={AdminExperienceDetailScreen} options={{ title: 'Experiência' }} />
        <Stack.Screen name="AdminStationDetail" component={AdminStationDetailScreen} options={{ title: 'Estação' }} />
        <Stack.Screen name="AdminEventStaff" component={AdminEventStaffScreen} options={{ title: 'Staff do Evento' }} />
        <Stack.Screen name="AdminHistory" component={AdminHistoryScreen} options={{ title: 'Histórico' }} />
        <Stack.Screen name="AdminEventBi" component={AdminEventBiScreen} options={{ title: 'BI do Evento' }} />
        <Stack.Screen name="AdminOverview" component={AdminOverviewScreen} options={{ title: 'Visão Geral' }} />
      </Stack.Navigator>
    </AdminDemoProvider>
  );
}
