import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ParticipationProvider } from './context/ParticipationContext';
import MainTabs from './navigation/MainTabs';
import EventConfirmationScreen from './screens/EventConfirmationScreen';
import EventEntryScreen from './screens/EventEntryScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import WelcomeScreen from './screens/WelcomeScreen';

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
        </Stack.Navigator>
      </NavigationContainer>
    </ParticipationProvider>
  );
}
