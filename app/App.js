import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ParticipationProvider } from './context/ParticipationContext';
import MainTabs from './navigation/MainTabs';
import EvaluationScreen from './screens/EvaluationScreen';
import EventConfirmationScreen from './screens/eventEntry/EventConfirmationScreen';
import EventEntryScreen from './screens/eventEntry/EventEntryScreen';
import ForgotPasswordScreen from './screens/auth/ForgotPasswordScreen';
import LoginScreen from './screens/auth/LoginScreen';
import ProfileQuestionnaireScreen from './screens/ProfileQuestionnaireScreen';
import RegisterScreen from './screens/auth/RegisterScreen';
import WelcomeScreen from './screens/auth/WelcomeScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <ParticipationProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Welcome" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="Cadastro" component={RegisterScreen} />
          <Stack.Screen name="ProfileQuestionnaire" component={ProfileQuestionnaireScreen} />
          <Stack.Screen name="Questionario" component={ProfileQuestionnaireScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <Stack.Screen name="EsqueciSenha" component={ForgotPasswordScreen} />
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
            name="Evaluation"
            component={EvaluationScreen}
            options={{
              headerShown: true,
              headerBackVisible: false,
              title: 'Avaliação',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ParticipationProvider>
  );
}
