import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import AdminCreateEventScreen from './AdminCreateEventScreen';
import { AdminDemoProvider, getAdminDemoOwnerKey } from './AdminDemoContext';
import AdminEventCloseScreen from './AdminEventCloseScreen';
import AdminEventDetailScreen from './AdminEventDetailScreen';
import AdminEventQueueScreen from './AdminEventQueueScreen';
import AdminEventScheduleScreen from './AdminEventScheduleScreen';
import AdminEventsScreen from './AdminEventsScreen';
import AdminPanelScreen from './AdminPanelScreen';

const Stack = createNativeStackNavigator();

// Pilha própria da Área Admin (demonstração). O provedor fica aqui dentro para
// que todo o estado simulado seja descartado ao sair da área. A key amarrada à
// conta e à geração da sessão remonta provedor e telas se a identidade mudar.
// O cabeçalho nativo fica oculto porque cada tela desenha o seu.
export default function AdminDemoNavigator() {
  const ownerKey = getAdminDemoOwnerKey(useAuth()) ?? 'sem-conta';
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
      </Stack.Navigator>
    </AdminDemoProvider>
  );
}
