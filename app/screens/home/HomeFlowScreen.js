import { useContext } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import ActiveArenaScreen from '../arena/ActiveArenaScreen';
import RealArenaScreen from '../arena/RealArenaScreen';
import ArenaQueueScreen from '../arena/ArenaQueueScreen';
import HomeScreen from './HomeScreen';

function ExternalQueueScreen({ participation, onRefresh }) {
  return (
    <AuthBackground variant="login" overlayOpacity={0.68} testID="external-queue-background">
      <StatusBar style="light" />
      <ScreenHeader title="Fila do evento" showBack={false} />
      <View style={styles.externalQueueContent}>
        <Card variant="highlight" style={styles.externalQueueCard}>
          <Badge label="AGUARDANDO NA FILA" variant="brand" />
          <Text style={styles.externalQueueTitle}>Sua participação está confirmada</Text>
          <Text style={styles.externalQueueText}>
            {participation.externalQueue?.position
              ? `Sua posição atual é ${participation.externalQueue.position}º.`
              : 'Aguarde a chamada da equipe do evento.'}
          </Text>
          <Text style={styles.externalQueueMeta}>Evento: {participation.eventId}</Text>
        </Card>
        <Button title="Atualizar participação" variant="secondary" onPress={onRefresh} />
      </View>
    </AuthBackground>
  );
}

export default function HomeFlowScreen({ navigation }) {
  const { participation, status, error, returnState, refreshParticipation } = useContext(ParticipationContext);

  if (status === 'loading') {
    return <HomeScreen mode="loading" />;
  }

  if (status === 'error') {
    const message = error === 'authorization' ? 'Não foi possível autorizar a consulta da participação.' :
      error === 'network' ? 'Não foi possível conectar ao servidor para consultar sua participação.' :
      'Não foi possível consultar sua participação agora.';
    return <HomeScreen mode="error" message={message} onRetry={refreshParticipation} />;
  }

  if (participation?.source === 'server') {
    if (participation.status === 'active') {
      return <RealArenaScreen key={participation.id} participation={participation} refreshParticipation={refreshParticipation} />;
    }
    return <ExternalQueueScreen participation={participation} onRefresh={refreshParticipation} />;
  }

  if (!participation) {
    return <HomeScreen navigation={navigation} returnState={returnState} />;
  }

  if (participation.status === 'waiting') {
    return <ArenaQueueScreen />;
  }

  if (participation.status === 'active') {
    return <ActiveArenaScreen navigation={navigation} />;
  }

  return <HomeScreen navigation={navigation} />;
}

const styles = StyleSheet.create({
  externalQueueContent: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  externalQueueCard: {
    marginBottom: 20,
  },
  externalQueueTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 18,
  },
  externalQueueText: {
    color: '#A0A0B8',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
  },
  externalQueueMeta: {
    color: '#A0A0B8',
    fontSize: 13,
    marginTop: 18,
  },
});
