import { useContext, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import ActiveArenaScreen from '../arena/ActiveArenaScreen';
import RealArenaScreen from '../arena/RealArenaScreen';
import ArenaQueueScreen from '../arena/ArenaQueueScreen';
import HomeScreen from './HomeScreen';
import { useAuth } from '../../context/AuthContext';
import { fetchReturnEvaluationHistoryItem } from '../../services/participationHistoryService';

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
  const { participation, status, error, returnState, returnStateVersion, refreshParticipation,
    canPresentReturnEvaluation, claimReturnEvaluation } = useContext(ParticipationContext);
  const auth = useAuth();
  const focused = useIsFocused();
  const live = useRef(null);
  const [returnCheck, setReturnCheck] = useState(null);
  const epoch = auth?.getSessionEpoch?.();
  live.current = { auth, focused, participation, status, returnState };

  useEffect(() => {
    let active = true;
    const isCurrent = () => {
      const now = live.current;
      return active && now.focused && !now.participation && now.status === 'ready'
        && now.returnState === returnState && now.auth?.isAuthenticated
        && now.auth.user?.id === auth?.user?.id && now.auth.httpClient === auth?.httpClient
        && now.auth.getSessionEpoch?.() === epoch && now.auth.isIdentityVerified?.() === true
        && canPresentReturnEvaluation?.(returnState, returnStateVersion);
    };
    if (isCurrent()) {
      setReturnCheck({ returned: returnState, version: returnStateVersion, status: 'loading' });
      fetchReturnEvaluationHistoryItem(auth.httpClient, returnState, { isCurrent }).then(item => {
        if (!isCurrent()) return;
        if (item) {
          const root = navigation.getParent();
          if (!root) throw new Error('Navegação de avaliação indisponível.');
          if (!claimReturnEvaluation(returnState, returnStateVersion)) return;
          root.navigate('RealEvaluation', { participationId: item.participationId, historyItem: item });
        }
        setReturnCheck({ returned: returnState, version: returnStateVersion, status: 'ready', unavailable: !item });
      }).catch(() => {
        if (isCurrent()) setReturnCheck({ returned: returnState, version: returnStateVersion, status: 'error' });
      });
    }
    return () => { active = false; };
  }, [focused, participation, status, returnState, returnStateVersion, auth?.user?.id, auth?.httpClient, epoch,
    auth?.isAuthenticated, auth?.identityStatus, auth?.isInitializing,
    canPresentReturnEvaluation, claimReturnEvaluation, navigation]);

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
    return <ExternalQueueScreen participation={participation} onRefresh={refreshParticipation} />;
  }

  if (!participation) {
    if (focused && auth?.isAuthenticated && canPresentReturnEvaluation?.(returnState, returnStateVersion)) {
      if (!returnCheck || returnCheck.returned !== returnState || returnCheck.version !== returnStateVersion || returnCheck.status === 'loading') return <HomeScreen mode="loading" />;
      if (returnCheck.status === 'error') return <HomeScreen mode="error"
        message="Não foi possível confirmar a avaliação da participação encerrada. Tente novamente."
        onRetry={refreshParticipation} />;
    }
    const visibleReturnState = returnCheck && returnState && returnCheck.returned === returnState && returnCheck.version === returnStateVersion
      && returnCheck.unavailable ? { ...returnState, pendingEvaluationParticipationIds:
        returnState.pendingEvaluationParticipationIds.filter(id => id !== returnState.recentFinalization?.participationId) }
      : returnState;
    return <HomeScreen navigation={navigation} returnState={visibleReturnState} />;
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
