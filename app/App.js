import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from './context/AuthContext';
import { ParticipationProvider } from './context/ParticipationContext';
import MainTabs from './navigation/MainTabs';
import AuthSessionGate, { resolveInitialRouteForAuthState } from './screens/auth/AuthSessionGate';
import EvaluationScreen from './screens/participation/EvaluationScreen';
import EventConfirmationScreen from './screens/event-entry/EventConfirmationScreen';
import EventEntryScreen from './screens/event-entry/EventEntryScreen';
import ForgotPasswordScreen from './screens/auth/ForgotPasswordScreen';
import LoginScreen from './screens/auth/LoginScreen';
import ParticipationDetailsScreen from './screens/participation/ParticipationDetailsScreen';
import ProfileQuestionnaireScreen from './screens/profile/ProfileQuestionnaireScreen';
import RegisterScreen from './screens/auth/RegisterScreen';
import WelcomeScreen from './screens/auth/WelcomeScreen';

const Stack = createNativeStackNavigator();

export function AppNavigation() {
  const auth = useAuth();
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const initialRouteName = resolveInitialRouteForAuthState(auth);
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
      options: { headerShown: true, title: 'Entrar em um evento' },
    },
    {
      name: 'EventConfirmation',
      component: EventConfirmationScreen,
      options: { headerShown: true, title: 'Confirmar entrada' },
    },
    {
      name: 'ParticipationDetails',
      component: ParticipationDetailsScreen,
      options: { headerShown: true, title: 'Detalhes da participação' },
    },
    {
      name: 'Evaluation',
      component: EvaluationScreen,
      options: { headerShown: true, headerBackVisible: false, title: 'Avaliação' },
    },
  ];
  const isQuestionnairePending =
    isAuthenticated && auth?.user && auth?.user.hasCompletedQuestionnaire === false;

  const pendingQuestionnaireScreens = [
    { name: 'ProfileQuestionnaire', component: ProfileQuestionnaireScreen },
    { name: 'Questionario', component: ProfileQuestionnaireScreen },
  ];

  const availableScreens = !isAuthenticated
    ? publicScreens
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
    <ParticipationProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
        >
          {orderedScreens.map(({ name, component, options }) => (
            <Stack.Screen
              key={name}
              name={name}
              component={component}
              options={options}
            />
          ))}
        </Stack.Navigator>
      </NavigationContainer>
    </ParticipationProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthSessionGate>
        <AppNavigation />
      </AuthSessionGate>
    </SafeAreaProvider>
  );
}
