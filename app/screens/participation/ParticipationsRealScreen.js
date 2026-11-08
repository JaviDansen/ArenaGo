import { useCallback, useContext, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import ParticipationCard from '../../components/ParticipationCard';
import ScreenContainer from '../../components/ScreenContainer';
import { AuthContext } from '../../context/AuthContext';
import { EVALUATION_SITUATIONS, getEvaluationSituation, getPendingEvaluationParticipations } from '../../utils/evaluation';
import {
  fetchParticipationHistory, mergeHistoryItems, toParticipationCardItem,
} from '../../services/participationHistoryService';

const INITIAL = { items: [], nextCursor: null, status: 'loading', loadingMore: false, error: null };

function errorMessage(error) {
  if (error?.isNetworkError) return 'Sem conexão com o servidor. Confira a rede e tente novamente.';
  if (error?.status === 401 || error?.status === 403) return 'Sua sessão não permite consultar o histórico. Entre novamente.';
  return 'Não foi possível carregar seu histórico. Tente novamente.';
}

export default function ParticipationsRealScreen({ navigation }) {
  const auth = useContext(AuthContext);
  const client = auth?.httpClient;
  const userId = auth?.isAuthenticated ? auth?.user?.id : null;
  const sessionEpoch = auth?.getSessionEpoch?.() ?? null;
  const generation = useRef(0);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState(INITIAL);

  useFocusEffect(useCallback(() => {
    const requestId = ++generation.current;
    setState({ ...INITIAL });
    if (!userId || !client) {
      setState({ ...INITIAL, status: 'error', error: 'Entre novamente para consultar o histórico.' });
      return () => { generation.current += 1; };
    }
    fetchParticipationHistory(client).then(result => {
      if (requestId !== generation.current) return;
      setState({ items: result.items, nextCursor: result.nextCursor,
        status: 'ready', loadingMore: false, error: null });
    }).catch(error => {
      if (requestId !== generation.current) return;
      setState({ ...INITIAL, status: 'error', error: errorMessage(error) });
    });
    return () => { generation.current += 1; };
  }, [client, userId, sessionEpoch, reload]));

  async function loadMore() {
    if (state.status !== 'ready' || state.loadingMore || !state.nextCursor || !client) return;
    const requestId = generation.current;
    const cursor = state.nextCursor;
    setState(previous => ({ ...previous, loadingMore: true, error: null }));
    try {
      const page = await fetchParticipationHistory(client, { cursor });
      if (requestId !== generation.current) return;
      setState(previous => ({ ...previous, items: mergeHistoryItems(previous.items, page.items),
        nextCursor: page.nextCursor, loadingMore: false, error: null }));
    } catch (error) {
      if (requestId !== generation.current) return;
      setState(previous => ({ ...previous, loadingMore: false, error: errorMessage(error) }));
    }
  }

  const participations = state.items.map(toParticipationCardItem);
  const pendingCount = getPendingEvaluationParticipations(participations).length;

  return (
    <ScreenContainer>
      <Text style={styles.title}>Minhas Participações</Text>
      <Text style={styles.subtitle}>Histórico registrado no ArenaGo.</Text>
      {state.status === 'loading' ? <Text style={styles.notice}>Carregando histórico...</Text> : null}
      {state.error ? <Text style={styles.error} accessibilityRole="alert">{state.error}</Text> : null}
      {state.status === 'error' ? (
        <Pressable onPress={() => setReload(n => n + 1)} style={styles.button}>
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </Pressable>
      ) : null}
      {state.status === 'ready' ? (
        <FlatList
          data={participations}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const historyItem = state.items.find(entry => entry.participationId === item.id);
            const situation = getEvaluationSituation(item);
            return <View>
              <ParticipationCard participation={item} evaluationSituation={situation}
                onPress={() => navigation.navigate('ParticipationDetails', {
                  participationId: item.id, historyItem,
                })} />
              {situation === EVALUATION_SITUATIONS.PENDING ? (
                <Pressable style={styles.button} accessibilityRole="button"
                  onPress={() => navigation.navigate('RealEvaluation', { participationId: item.id, historyItem })}>
                  <Text style={styles.buttonText}>Avaliar evento</Text>
                </Pressable>
              ) : null}
            </View>;
          }}
          ListHeaderComponent={pendingCount > 0 ? (
            <Text style={styles.notice}>Avaliações pendentes: {pendingCount}</Text>
          ) : null}
          ListEmptyComponent={<Text style={styles.notice}>Você ainda não possui participações em eventos.</Text>}
          ListFooterComponent={state.nextCursor ? (
            <View>
              <Pressable onPress={loadMore} disabled={state.loadingMore} style={styles.button}>
                <Text style={styles.buttonText}>{state.loadingMore ? 'Carregando...' : 'Carregar mais'}</Text>
              </Pressable>
            </View>
          ) : null}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: 'bold', marginTop: 16 },
  subtitle: { marginTop: 8, color: '#555', fontSize: 14 },
  notice: { marginTop: 18, fontSize: 15, color: '#555' },
  error: { marginTop: 16, color: '#9b1c1c', fontSize: 15 },
  button: { marginTop: 18, padding: 12, backgroundColor: '#111', borderRadius: 6, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  listContent: { paddingBottom: 24 },
});
