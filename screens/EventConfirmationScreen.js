import { Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';

export default function EventConfirmationScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Evento encontrado</Text>
      <Text style={styles.eventName}>BEAST Arena</Text>
      <Text style={styles.location}>Evento de demonstração</Text>
      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Confirmar entrada</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  eventName: {
    fontSize: 18,
    marginTop: 24,
  },
  location: {
    fontSize: 16,
    marginTop: 8,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 4,
    marginTop: 24,
    padding: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
