import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MainTabs from './navigation/MainTabs';
import ActiveArenaScreen from './screens/ActiveArenaScreen';
import ArenaQueueScreen from './screens/ArenaQueueScreen';
import EventConfirmationScreen from './screens/EventConfirmationScreen';
import EventEntryScreen from './screens/EventEntryScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen
          name="EventEntry"
          component={EventEntryScreen}
          options={{ headerShown: true, title: 'Entrar em um evento' }}
        />
        <Stack.Screen
          name="EventConfirmation"
          component={EventConfirmationScreen}
          options={{ headerShown: true, title: 'Confirmar entrada' }}
        />
        <Stack.Screen
          name="ArenaQueue"
          component={ArenaQueueScreen}
          options={{ headerShown: true, title: 'Fila da Arena' }}
        />
        <Stack.Screen
          name="ActiveArena"
          component={ActiveArenaScreen}
          options={{ headerShown: true, title: 'Arena' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
