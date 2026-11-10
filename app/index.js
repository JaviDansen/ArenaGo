import * as SplashScreen from 'expo-splash-screen';
import { preventAutoHideAsync } from './services/splashScreenService';
import { registerRootComponent } from 'expo';

import App from './App';

// Bloqueia a ocultação automática da Splash nativa no escopo global do módulo,
// antes de qualquer componente React Native ser montado.
void preventAutoHideAsync(SplashScreen);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
