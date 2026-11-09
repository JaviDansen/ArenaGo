import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import * as SafeAreaContext from 'react-native-safe-area-context';

import HomeFlowScreen from '../screens/home/HomeFlowScreen';
import ParticipationsScreen from '../screens/participation/ParticipationsRealScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import { colors, radii, spacing, typography } from '../theme';

const Tab = createBottomTabNavigator();

/**
 * Ícone profissional de Casa (Home) desenhado com Views nativas.
 * Mesma espessura (1.8dp), proporção e bounding box (20x20dp) dos demais ícones.
 */
export function HomeIcon({ focused, color }) {
  return (
    <View style={iconStyles.container} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[iconStyles.homeRoof, { borderColor: color }]} />
      <View
        style={[
          iconStyles.homeBody,
          {
            borderColor: color,
            backgroundColor: focused ? `${color}18` : 'transparent',
          },
        ]}
      >
        <View style={[iconStyles.homeDoor, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

/**
 * Ícone profissional de Calendário / Eventos desenhado com Views nativas.
 * Mesma espessura (1.8dp), proporção e bounding box (20x20dp).
 */
export function EventsIcon({ focused, color }) {
  return (
    <View style={iconStyles.container} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[iconStyles.calendarPin, { left: 4.5, backgroundColor: color }]} />
      <View style={[iconStyles.calendarPin, { right: 4.5, backgroundColor: color }]} />
      <View
        style={[
          iconStyles.calendarBody,
          {
            borderColor: color,
            backgroundColor: focused ? `${color}18` : 'transparent',
          },
        ]}
      >
        <View style={[iconStyles.calendarHeaderLine, { backgroundColor: color }]} />
        <View style={iconStyles.calendarGridRow}>
          <View style={[iconStyles.calendarDot, { backgroundColor: color }]} />
          <View style={[iconStyles.calendarDot, { backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

/**
 * Ícone profissional de Usuário (Perfil) desenhado com Views nativas.
 * Mesma espessura (1.8dp), proporção e bounding box (20x20dp).
 */
export function ProfileIcon({ focused, color }) {
  return (
    <View style={iconStyles.container} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View
        style={[
          iconStyles.profileHead,
          {
            borderColor: color,
            backgroundColor: focused ? color : 'transparent',
          },
        ]}
      />
      <View
        style={[
          iconStyles.profileTorso,
          {
            borderColor: color,
            backgroundColor: focused ? `${color}18` : 'transparent',
          },
        ]}
      />
    </View>
  );
}

export function TabBarIcon({ focused, name, symbol }) {
  const activeColor = colors.brand.primaryLight;
  const inactiveColor = colors.text.muted;
  const color = focused ? activeColor : inactiveColor;

  return (
    <View style={[styles.iconPill, focused ? styles.iconPillActive : null]}>
      {name === 'home' ? (
        <HomeIcon focused={focused} color={color} />
      ) : name === 'events' ? (
        <EventsIcon focused={focused} color={color} />
      ) : name === 'profile' ? (
        <ProfileIcon focused={focused} color={color} />
      ) : (
        <Text style={[styles.iconSymbol, focused ? styles.iconSymbolActive : null]}>
          {symbol}
        </Text>
      )}
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
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="home" symbol="⚡" />,
        }}
      />
      <Tab.Screen
        name="Eventos"
        component={ParticipationsScreen}
        options={{
          title: 'Eventos',
          tabBarAccessibilityLabel: 'Aba Eventos',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="events" symbol="🎮" />,
        }}
      />
      <Tab.Screen
        name="Perfil"
        component={ProfileScreen}
        options={{
          title: 'Perfil',
          tabBarAccessibilityLabel: 'Aba Perfil',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="profile" symbol="👤" />,
        }}
      />
    </Tab.Navigator>
  );
}

const iconStyles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeRoof: {
    width: 10,
    height: 10,
    borderTopWidth: 1.8,
    borderLeftWidth: 1.8,
    transform: [{ rotate: '45deg' }],
    position: 'absolute',
    top: 2,
  },
  homeBody: {
    width: 13,
    height: 9,
    borderLeftWidth: 1.8,
    borderRightWidth: 1.8,
    borderBottomWidth: 1.8,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    position: 'absolute',
    bottom: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  homeDoor: {
    width: 3.5,
    height: 4.5,
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
  },
  calendarPin: {
    position: 'absolute',
    top: 1,
    width: 2,
    height: 3.5,
    borderRadius: 1,
    zIndex: 2,
  },
  calendarBody: {
    width: 16,
    height: 14.5,
    borderWidth: 1.8,
    borderRadius: 3,
    position: 'absolute',
    bottom: 2,
    paddingTop: 3.5,
    alignItems: 'center',
    overflow: 'hidden',
  },
  calendarHeaderLine: {
    width: '100%',
    height: 1.5,
    position: 'absolute',
    top: 3,
  },
  calendarGridRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDot: {
    width: 2.2,
    height: 2.2,
    borderRadius: 1,
  },
  profileHead: {
    width: 7.5,
    height: 7.5,
    borderRadius: 4,
    borderWidth: 1.8,
    position: 'absolute',
    top: 2,
  },
  profileTorso: {
    width: 15,
    height: 7,
    borderTopLeftRadius: 7.5,
    borderTopRightRadius: 7.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    borderWidth: 1.8,
    position: 'absolute',
    bottom: 2,
  },
});

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
    height: 28,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
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
