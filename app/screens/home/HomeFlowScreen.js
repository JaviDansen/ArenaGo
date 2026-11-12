import { useContext, useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import ActiveArenaScreen from '../arena/ActiveArenaScreen';
import RealArenaScreen from '../arena/RealArenaScreen';
import ArenaQueueScreen from '../arena/ArenaQueueScreen';
import HomeScreen from './HomeScreen';

function ExternalQueueScreen({ participation, onRefresh, syncStale = false }) {
  const { syncCurrentParticipation } = useContext(ParticipationContext) || {};
  const isFocused = useIsFocused();
  const appStateRef = useRef(typeof AppState !== 'undefined' && AppState?.currentState ? AppState.currentState : 'active');

  useEffect(() => {
    if (typeof AppState?.addEventListener !== 'function') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active' && isFocused && typeof syncCurrentParticipation === 'function') {
        void syncCurrentParticipation();
      }
    });
    return () => subscription?.remove?.();
  }, [isFocused, syncCurrentParticipation]);

  useEffect(() => {
    if (!isFocused || typeof syncCurrentParticipation !== 'function' || typeof setInterval !== 'function') return;

    const intervalId = setInterval(() => {
      if (appStateRef.current === 'active') {
        void syncCurrentParticipation();
      }
    }, 5000);
    intervalId?.unref?.();

    return () => {
      if (typeof clearInterval === 'function') clearInterval(intervalId);
    };
  }, [isFocused, syncCurrentParticipation]);

  return (
    <AuthBackground variant="login" overlayOpacity={0.68} testID="external-queue-background">
      <StatusBar style="light" />
      <ScreenHeader title="Fila do evento" showBack={false} />
      <View style={styles.externalQueueContent}>
        {syncStale ? (
          <View style={styles.syncWarningBanner} accessibilityRole="alert">
            <Text style={styles.syncWarningText}>
              Conexão instável. Exibindo as últimas informações confirmadas.
            </Text>
          </View>
        ) : null}
        <Card variant="highlight" style={styles.externalQueueCard}>
          <Badge label="AGUARDANDO NA FILA" variant="brand" />
          <Text style={styles.externalQueueTitle}>Sua participação está confirmada</Text>
          <Text style={styles.externalQueueText}>
            {participation.externalQueue?.position
              ? `Sua posição atual é ${participation.externalQueue.position}º.`
              : 'Aguarde a chamada da equipe do evento.'}
          </Text>
          <Text style={styles.externalQueueAutoUpdate}>
            {syncStale
              ? 'Tentando restabelecer conexão automaticamente...'
              : 'A posição na fila é atualizada automaticamente a cada 5 segundos.'}
          </Text>
          <Text style={styles.externalQueueMeta}>Evento: {participation.eventId}</Text>
        </Card>
        <Button title="Atualizar participação" variant="secondary" onPress={onRefresh} />
      </View>
    </AuthBackground>
  );
}

export default function HomeFlowScreen({ navigation }) {
  const { participation, status, error, returnState, refreshParticipation, syncStale } = useContext(ParticipationContext);

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
      return <RealArenaScreen key={participation.id} participation={participation} refreshParticipation={refreshParticipation}
        onOpenEvaluation={(historyItem) => navigation.getParent()?.navigate('RealEvaluation', {
          participationId: historyItem.participationId, historyItem,
        })} />;
    }
    return <ExternalQueueScreen participation={participation} onRefresh={refreshParticipation} syncStale={syncStale} />;
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
  syncWarningBanner: {
    backgroundColor: '#2D2013',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  syncWarningText: {
    color: '#FCD34D',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
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
  externalQueueAutoUpdate: {
    color: '#8282A8',
    fontSize: 13,
    marginTop: 8,
  },
  externalQueueMeta: {
    color: '#A0A0B8',
    fontSize: 13,
    marginTop: 18,
  },
});
