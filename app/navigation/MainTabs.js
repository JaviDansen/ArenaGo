import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import * as SafeAreaContext from 'react-native-safe-area-context';

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
  let insets = { bottom: 0, top: 0, left: 0, right: 0 };
  if (typeof SafeAreaContext?.useSafeAreaInsets === 'function') {
    try {
      insets = SafeAreaContext.useSafeAreaInsets() || insets;
    } catch {
      // Fora de SafeAreaProvider em testes isolados
    }
  }

  const bottomInset = typeof insets?.bottom === 'number' ? insets.bottom : 0;
  // Acomoda navegação por gestos no Android/iOS (quando bottomInset > 0)
  // preservando a altura compacta em dispositivos com 3 botões tradicionais (bottomInset === 0).
  const dynamicTabHeight = 60 + bottomInset;
  const dynamicPaddingBottom = bottomInset > 0 ? bottomInset : spacing.xs;

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
        tabBarStyle: [
          styles.tabBarStyle,
          {
            height: dynamicTabHeight,
            paddingBottom: dynamicPaddingBottom,
          },
        ],
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
    paddingTop: spacing.xs,
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
