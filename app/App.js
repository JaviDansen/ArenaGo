
import { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from './context/AuthContext';
import { ParticipationProvider } from './context/ParticipationContext';
import MainTabs from './navigation/MainTabs';
import AuthSessionGate, { resolveInitialRouteForAuthState } from './screens/auth/AuthSessionGate';
import SplashScreenGate from './screens/splash/SplashScreenGate';
import RolePendingScreen from './screens/auth/RolePendingScreen';
import StaffEventsNavigator from './screens/staff/StaffEventsNavigator';
import EvaluationScreen from './screens/participation/EvaluationScreen';
import RealEvaluationScreen from './screens/participation/RealEvaluationScreen';
import EventConfirmationScreen from './screens/event-entry/EventConfirmationScreen';
import EventEntryScreen from './screens/event-entry/EventEntryScreen';
import ForgotPasswordScreen from './screens/auth/ForgotPasswordScreen';
import LoginScreen from './screens/auth/LoginScreen';
import ParticipationDetailsScreen from './screens/participation/ParticipationRealDetailsScreen';
import ProfileQuestionnaireScreen from './screens/profile/ProfileQuestionnaireScreen';
import RegisterScreen from './screens/auth/RegisterScreen';
import WelcomeScreen from './screens/auth/WelcomeScreen';
import { colors, typography } from './theme';

const Stack = createNativeStackNavigator();
const participantHeaderOptions = {
  headerStyle: { backgroundColor: colors.background.base },
  headerTintColor: colors.text.primary,
  headerTitleStyle: {
    color: colors.text.primary,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
  },
  headerShadowVisible: false,
};

export function AppNavigation() {
  const auth = useAuth();
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const initialRouteName = resolveInitialRouteForAuthState(auth);
  const roleArea = initialRouteName === 'AdminArea' ? 'admin'
    : initialRouteName === 'StaffPending' ? 'staff'
      : initialRouteName === 'IdentityRecovery' ? 'recovery'
      : isAuthenticated ? 'participant' : 'public';
  const sessionKey = isAuthenticated
    ? `${roleArea}:${auth?.user?.id || ''}:${auth?.user?.sessionId || ''}:${auth?.getSessionEpoch?.() ?? ''}`
    : 'public';

  const publicScreens = [
    { name: 'Welcome', component: WelcomeScreen },
    { name: 'Login', component: LoginScreen },
    { name: 'Register', component: RegisterScreen },
    { name: 'Cadastro', component: RegisterScreen },
    { name: 'ForgotPassword', component: ForgotPasswordScreen },
    { name: 'EsqueciSenha', component: ForgotPasswordScreen },
  ];

  const appScreens = [
    { name: 'ProfileQuestionnaire', component: ProfileQuestionnaireScreen },
    { name: 'Questionario', component: ProfileQuestionnaireScreen },
    { name: 'MainTabs', component: MainTabs },
    {
      name: 'EventEntry',
      component: EventEntryScreen,
      options: { headerShown: false, title: 'Entrar em um evento' },
    },
    {
      name: 'EventConfirmation',
      component: EventConfirmationScreen,
      options: { headerShown: false, title: 'Confirmar entrada' },
    },
    {
      name: 'ParticipationDetails',
      component: ParticipationDetailsScreen,
      options: {
        ...participantHeaderOptions,
        headerShown: true,
        title: 'Detalhes da participação',
      },
    },
    {
      name: 'Evaluation',
      component: EvaluationScreen,
      options: {
        ...participantHeaderOptions,
        headerShown: true,
        headerBackVisible: false,
        title: 'Avaliação',
      },
    },

    // Avaliação real de uma participação finalizada.
    {
      name: 'RealEvaluation',
      component: RealEvaluationScreen,
      options: {
        ...participantHeaderOptions,
        headerShown: true,
        title: 'Avaliar evento',
      },
    },
  ];

  const isQuestionnairePending =
    isAuthenticated &&
    auth?.user &&
    auth.user.hasCompletedQuestionnaire === false;

  const pendingQuestionnaireScreens = [
    { name: 'ProfileQuestionnaire', component: ProfileQuestionnaireScreen },
    { name: 'Questionario', component: ProfileQuestionnaireScreen },
  ];

  const availableScreens = !isAuthenticated
    ? publicScreens
    : roleArea === 'admin'
      ? [{ name: 'AdminArea', getComponent: () => require('./screens/admin/AdminDemoNavigator').default }]
      : roleArea === 'staff'
        ? [{ name: 'StaffPending', component: StaffEventsNavigator }]
        : roleArea === 'recovery'
          ? [{ name: 'IdentityRecovery', component: RolePendingScreen }]
        : isQuestionnairePending
      ? pendingQuestionnaireScreens
      : appScreens;

  const firstScreenIndex = availableScreens.findIndex(
    (screen) => screen.name === initialRouteName
  );

  const orderedScreens =
    firstScreenIndex > 0
      ? [
          availableScreens[firstScreenIndex],
          ...availableScreens.filter((_, index) => index !== firstScreenIndex),
        ]
      : availableScreens;

  return (
    <ParticipationProvider key={sessionKey}>
      <NavigationContainer key={sessionKey}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {orderedScreens.map(({ name, component, getComponent, options }) => (
            <Stack.Screen
              key={name}
              name={name}
              component={component}
              getComponent={getComponent}
              options={options}
            />
          ))}
        </Stack.Navigator>
      </NavigationContainer>
    </ParticipationProvider>
  );
}

export default function App() {
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);

  return (
    <SafeAreaProvider>
      <SplashScreenGate isReady={!isAuthInitializing}>
        <AuthSessionGate onInitializingChange={setIsAuthInitializing}>
          <AppNavigation />
        </AuthSessionGate>
      </SplashScreenGate>
    </SafeAreaProvider>
  );
}
