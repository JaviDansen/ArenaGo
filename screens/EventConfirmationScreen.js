import { Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';

export default function EventConfirmationScreen({ navigation, route }) {
  const { event } = route.params;

  function handleConfirmEntry() {
    if (event.hasArenaQueue) {
      navigation.navigate('ArenaQueue');
      return;
    }

    navigation.navigate('ActiveArena');
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Evento encontrado</Text>
      <Text style={styles.eventName}>{event.name}</Text>
      <Text style={styles.location}>{event.location}</Text>
      <Pressable style={styles.button} onPress={handleConfirmEntry}>
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
