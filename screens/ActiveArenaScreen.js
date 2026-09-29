import { SafeAreaView, StyleSheet, Text } from 'react-native';

export default function ActiveArenaScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.eventName}>BEAST Arena</Text>
      <Text style={styles.title}>Arena ativa</Text>
      <Text style={styles.message}>Sua participação na Arena está ativa.</Text>
      <Text style={styles.experiencesTitle}>Experiências</Text>
      <Text style={styles.message}>As experiências disponíveis aparecerão aqui.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  eventName: {
    fontSize: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  message: {
    fontSize: 16,
    marginTop: 16,
  },
  experiencesTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 24,
  },
});
