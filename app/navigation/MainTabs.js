import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import HomeFlowScreen from '../screens/home/HomeFlowScreen';
import ParticipationsScreen from '../screens/participation/ParticipationsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Início" component={HomeFlowScreen} />
      <Tab.Screen name="Eventos" component={ParticipationsScreen} />
      <Tab.Screen name="Perfil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
