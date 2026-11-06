import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';

import HomeFlowScreen from '../screens/home/HomeFlowScreen';
import ParticipationsScreen from '../screens/participation/ParticipationsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import { colors, radii, spacing, typography } from '../theme';

const Tab = createBottomTabNavigator();

export function TabBarIcon({ focused, symbol }) {
  return (
    <View style={[styles.iconPill, focused ? styles.iconPillActive : null]}>
      <Text style={[styles.iconSymbol, focused ? styles.iconSymbolActive : null]}>
        {symbol}
      </Text>
    </View>
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: styles.headerStyle,
        headerTintColor: colors.text.primary,
        headerTitleStyle: styles.headerTitleStyle,
        headerShadowVisible: false,
        sceneStyle: styles.sceneStyle,
        tabBarActiveTintColor: colors.brand.primaryLight,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarStyle: styles.tabBarStyle,
        tabBarItemStyle: styles.tabBarItemStyle,
        tabBarLabelStyle: styles.tabBarLabelStyle,
      }}
    >
      <Tab.Screen
        name="Início"
        component={HomeFlowScreen}
        options={{
          headerShown: false,
          tabBarAccessibilityLabel: 'Aba Início',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} symbol="⚡" />,
        }}
      />
      <Tab.Screen
        name="Eventos"
        component={ParticipationsScreen}
        options={{
          title: 'Eventos',
          tabBarAccessibilityLabel: 'Aba Eventos',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} symbol="🎮" />,
        }}
      />
      <Tab.Screen
        name="Perfil"
        component={ProfileScreen}
        options={{
          title: 'Perfil',
          tabBarAccessibilityLabel: 'Aba Perfil',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} symbol="👤" />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerStyle: {
    backgroundColor: colors.background.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    elevation: 0,
    shadowOpacity: 0,
  },
  headerTitleStyle: {
    color: colors.text.primary,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.4,
  },
  sceneStyle: {
    backgroundColor: colors.background.canvas,
  },
  tabBarStyle: {
    backgroundColor: colors.background.base,
    borderTopColor: colors.border.subtle,
    borderTopWidth: 1,
    height: 68,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    elevation: 0,
  },
  tabBarItemStyle: {
    minHeight: 48,
    paddingVertical: 2,
  },
  tabBarLabelStyle: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  iconPill: {
    minWidth: 44,
    height: 26,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    backgroundColor: 'transparent',
  },
  iconPillActive: {
    backgroundColor: colors.brand.primaryDim,
    borderWidth: 1,
    borderColor: colors.brand.primary,
  },
  iconSymbol: {
    fontSize: 14,
    color: colors.text.muted,
  },
  iconSymbolActive: {
    color: colors.text.primary,
  },
});
