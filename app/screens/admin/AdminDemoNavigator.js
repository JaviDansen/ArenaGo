import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminReadOwner } from './useAdminEvents';
import AdminHomeScreen from './AdminHomeScreen';
import AdminRealEventsScreen from './AdminRealEventsScreen';
import AdminRealEventScreen from './AdminRealEventScreen';
import AdminEventSetupScreen from './AdminEventSetupScreen';
import { randomUUID } from 'expo-crypto';
import { bindStaffSession } from './adminStaffSession';
import { AdminStaffSession, AdminSetupIntents } from './adminSetupIntents';
import AdminEventManagementInfoScreen from './AdminEventManagementInfoScreen';
import AdminPendingScreen from './AdminPendingScreen';
import AdminBottomBar from './components/AdminBottomBar';

const Stack = createNativeStackNavigator(), Tabs = createBottomTabNavigator();
function AdminTabs() {
  return <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={({ state, navigation }) =>
    <AdminBottomBar active={state.routes[state.index].name} onSelect={name => {
      const route = state.routes.find(item => item.name === name);
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!event.defaultPrevented) navigation.navigate(name);
    }} onLongPress={name => navigation.emit({ type: 'tabLongPress', target: state.routes.find(item => item.name === name).key })} />}>
    <Tabs.Screen name="Home" component={AdminHomeScreen} />
    <Tabs.Screen name="Histórico" component={AdminPendingScreen} />
    <Tabs.Screen name="BI" component={AdminPendingScreen} />
  </Tabs.Navigator>;
}
// Keep the entry name used by App.js. Demo sources remain available for later
// migrations, but none of their mutation routes are registered for real events.
export default function AdminDemoNavigator() {
  const auth = useAuth();
  const owner = adminReadOwner(auth);
  const setupIntents = useMemo(() => new Map(), [owner, auth.httpClient]);
  if (!owner) return null;
  const staff = auth.getAdminStaffSession?.((manager, isProviderActive) => bindStaffSession(manager, randomUUID, isProviderActive));
  return <AdminSetupIntents.Provider value={setupIntents}>
    <AdminStaffSession.Provider value={staff}>
      <Stack.Navigator key={owner} initialRouteName="AdminTabs" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AdminTabs" component={AdminTabs} />
        <Stack.Screen name="AdminEvents" component={AdminRealEventsScreen} />
        <Stack.Screen name="AdminRealEvent" component={AdminRealEventScreen} />
        <Stack.Screen name="AdminEventManagementInfo" component={AdminEventManagementInfoScreen} />
        <Stack.Screen name="AdminEventSetup" component={AdminEventSetupScreen} />
      </Stack.Navigator>
    </AdminStaffSession.Provider>
  </AdminSetupIntents.Provider>;
}
