import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import StaffAccessScreen from './StaffAccessScreen';
import { getStaffDemoOwnerKey, StaffDemoProvider } from './StaffDemoContext';
import StaffEntryControlScreen from './StaffEntryControlScreen';
import StaffPanelScreen from './StaffPanelScreen';
import StaffStationScreen from './StaffStationScreen';

const Stack = createNativeStackNavigator();

// Pilha própria da Área Staff (demonstração). O provedor fica aqui dentro para
// que todo o estado simulado seja descartado ao sair da área. A key amarrada à
// conta e à geração da sessão remonta o provedor e as telas (diálogos abertos
// inclusive) se a identidade mudar sem sair da área. O cabeçalho nativo fica
// oculto porque cada tela desenha o seu, como nos prints.
export default function StaffDemoNavigator() {
  const ownerKey = getStaffDemoOwnerKey(useAuth()) ?? 'sem-conta';
  return (
    <StaffDemoProvider key={ownerKey}>
      <Stack.Navigator initialRouteName="StaffAccess" screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="StaffAccess"
          component={StaffAccessScreen}
          options={{ title: 'Área do Staff' }}
        />
        <Stack.Screen
          name="StaffPanel"
          component={StaffPanelScreen}
          options={{ title: 'Painel Operacional' }}
        />
        <Stack.Screen
          name="StaffEntryControl"
          component={StaffEntryControlScreen}
          options={{ title: 'Controle de Entrada' }}
        />
        <Stack.Screen
          name="StaffStation"
          component={StaffStationScreen}
          options={{ title: 'Estação' }}
        />
      </Stack.Navigator>
    </StaffDemoProvider>
  );
}
