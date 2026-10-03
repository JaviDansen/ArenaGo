import { useContext } from 'react';

import { ParticipationContext } from '../context/ParticipationContext';
import ActiveArenaScreen from './ActiveArenaScreen';
import ArenaQueueScreen from './ArenaQueueScreen';
import HomeScreen from './HomeScreen';

export default function HomeFlowScreen({ navigation }) {
  const { participation } = useContext(ParticipationContext);

  if (!participation) {
    return <HomeScreen navigation={navigation} />;
  }

  if (participation.status === 'waiting') {
    return <ArenaQueueScreen />;
  }

  if (participation.status === 'active') {
    return <ActiveArenaScreen navigation={navigation} />;
  }

  return <HomeScreen navigation={navigation} />;
}
