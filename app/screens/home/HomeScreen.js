import { StatusBar } from 'expo-status-bar';
import { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { AuthContext } from '../../context/AuthContext';

export default function HomeScreen({ navigation }) {
  const auth = typeof useContext === 'function' ? useContext(AuthContext) : null;
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const hasPendingQuestionnaire =
    auth?.user != null && auth.user.hasCompletedQuestionnaire === false;

  async function handleLogout() {
    if (isLoggingOut || !auth?.logout) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await auth.logout();
      if (navigation?.reset) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
      } else {
        navigation?.navigate?.('Login');
      }
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>BEAST MARAGAMES</Text>
      <Text style={styles.welcome}>Bem-vindo à BEAST!</Text>
      <Text style={styles.description}>
        Participe das experiências e eventos da BEAST MARAGAMES.
      </Text>

      {hasPendingQuestionnaire ? (
        <View style={styles.questionnaireBanner}>
          <Text style={styles.questionnaireBannerTitle}>
            Seu questionário de perfil ainda está pendente.
          </Text>
          <Text style={styles.questionnaireBannerText}>
            Conclua o questionário para personalizar sua experiência na Arena.
          </Text>
          <Pressable
            style={styles.questionnaireButton}
            onPress={() =>
              navigation.navigate('ProfileQuestionnaire', {
                user: auth.user,
              })
            }
          >
            <Text style={styles.questionnaireButtonText}>
              Completar questionário de perfil
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        style={styles.eventButton}
        onPress={() => navigation.navigate('EventEntry')}
      >
        <Text style={styles.eventButtonText}>Entrar em um evento</Text>
      </Pressable>

      {auth?.logout ? (
        <Pressable
          style={[styles.logoutButton, isLoggingOut && styles.logoutButtonDisabled]}
          onPress={handleLogout}
          disabled={isLoggingOut}
        >
          <Text style={styles.logoutButtonText}>
            {isLoggingOut ? 'Saindo...' : 'Sair da conta'}
          </Text>
        </Pressable>
      ) : null}

      <StatusBar style="dark" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  welcome: {
    fontSize: 18,
    marginTop: 24,
  },
  description: {
    fontSize: 16,
    marginTop: 8,
  },
  questionnaireBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    padding: 12,
  },
  questionnaireBannerTitle: {
    color: '#92400e',
    fontSize: 14,
    fontWeight: '600',
  },
  questionnaireBannerText: {
    color: '#92400e',
    fontSize: 13,
    marginTop: 4,
  },
  questionnaireButton: {
    alignItems: 'center',
    backgroundColor: '#92400e',
    borderRadius: 6,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  questionnaireButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  eventButton: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 4,
    marginTop: 24,
    padding: 12,
  },
  eventButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logoutButton: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 4,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  logoutButtonDisabled: {
    opacity: 0.6,
  },
  logoutButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
});
