import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import EventsScreen from '../screens/EventsScreen';
import HomeFlowScreen from '../screens/HomeFlowScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Início" component={HomeFlowScreen} />
      <Tab.Screen name="Eventos" component={EventsScreen} />
      <Tab.Screen name="Perfil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
