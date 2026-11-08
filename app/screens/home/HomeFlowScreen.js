import { useContext } from 'react';
import { Pressable, Text } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { ParticipationContext } from '../../context/ParticipationContext';
import ActiveArenaScreen from '../arena/ActiveArenaScreen';
import RealArenaScreen from '../arena/RealArenaScreen';
import ArenaQueueScreen from '../arena/ArenaQueueScreen';
import HomeScreen from './HomeScreen';

export default function HomeFlowScreen({ navigation }) {
  const { participation, status, error, returnState, refreshParticipation } = useContext(ParticipationContext);

  if (status === 'loading') {
    return <ScreenContainer><Text>Carregando sua participação...</Text></ScreenContainer>;
  }

  if (status === 'error') {
    const message = error === 'authorization' ? 'Não foi possível autorizar a consulta da participação.' :
      error === 'network' ? 'Não foi possível conectar ao servidor para consultar sua participação.' :
      'Não foi possível consultar sua participação agora.';
    return <ScreenContainer><Text>{message}</Text><Pressable onPress={refreshParticipation}><Text>Tentar novamente</Text></Pressable></ScreenContainer>;
  }

  if (participation?.source === 'server') {
    if (participation.status === 'active') {
      return <RealArenaScreen key={participation.id} participation={participation} refreshParticipation={refreshParticipation} />;
    }
    return (
      <ScreenContainer>
        <Text>Você está na fila externa do evento.</Text>
        {participation.externalQueue?.position ? <Text>Posição: {participation.externalQueue.position}º</Text> : null}
        <Text>Evento: {participation.eventId}</Text>
        <Pressable onPress={refreshParticipation}><Text>Atualizar participação</Text></Pressable>
      </ScreenContainer>
    );
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
