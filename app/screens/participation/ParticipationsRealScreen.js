import { useCallback, useContext, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import ParticipationCard from '../../components/ParticipationCard';
import { AuthBackground, Badge, Button, Card } from '../../components/ui';
import { AuthContext } from '../../context/AuthContext';
import { EVALUATION_SITUATIONS, getEvaluationSituation, getPendingEvaluationParticipations } from '../../utils/evaluation';
import {
  fetchParticipationHistory, mergeHistoryItems, toParticipationCardItem,
} from '../../services/participationHistoryService';
import { colors, spacing, typography } from '../../theme';

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
    <AuthBackground variant="login" overlayOpacity={0.68} testID="participations-background">
      <StatusBar style="light" />
      <View style={styles.screen}>
        <View style={styles.heading}>
          <Badge label="SEUS EVENTOS" variant="brand" />
          <Text style={styles.title}>Minhas Participações</Text>
          <Text style={styles.subtitle}>Histórico registrado no ArenaGo.</Text>
        </View>
        {state.status === 'loading' ? (
          <Card variant="elevated" style={styles.stateCard}>
            <ActivityIndicator size="small" color={colors.brand.primaryLight} />
            <Text style={styles.notice}>Carregando histórico...</Text>
          </Card>
        ) : null}
        {state.error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Badge label="ERRO AO CARREGAR" variant="danger" />
            <Text style={styles.error}>{state.error}</Text>
          </View>
        ) : null}
        {state.status === 'error' ? (
          <Button title="Tentar novamente" variant="secondary" onPress={() => setReload(n => n + 1)} />
        ) : null}
        {state.status === 'ready' ? (
          <FlatList
            style={styles.list}
            data={participations}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const historyItem = state.items.find(entry => entry.participationId === item.id);
              const situation = getEvaluationSituation(item);
              return <View>
                <ParticipationCard participation={item} evaluationSituation={situation}
                  onPress={() => navigation.navigate('ParticipationDetails', {
                    participationId: item.id, historyItem,
                  })} />
                {situation === EVALUATION_SITUATIONS.PENDING ? (
                  <Button
                    title="Avaliar evento"
                    variant="outline"
                    onPress={() => navigation.navigate('RealEvaluation', { participationId: item.id, historyItem })}
                    style={styles.evaluationButton}
                  />
                ) : null}
              </View>;
            }}
            ListHeaderComponent={pendingCount > 0 ? (
              <View style={styles.pendingNotice}>
                <Badge label="PENDENTE" variant="warning" />
                <Text style={styles.notice}>Avaliações pendentes: {pendingCount}</Text>
              </View>
            ) : null}
            ListEmptyComponent={(
              <Card variant="default" style={styles.emptyCard}>
                <Text style={styles.notice}>Você ainda não possui participações em eventos.</Text>
              </Card>
            )}
            ListFooterComponent={state.nextCursor ? (
              <Button
                title={state.loadingMore ? 'Carregando...' : 'Carregar mais'}
                variant="secondary"
                onPress={loadMore}
                disabled={state.loadingMore}
                style={styles.loadMoreButton}
              />
            ) : null}
          />
        ) : null}
      </View>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.lg },
  heading: { marginBottom: spacing.md },
  title: { ...typography.titleLarge, color: colors.text.primary, marginTop: spacing.md },
  subtitle: { ...typography.body, color: colors.text.secondary, marginTop: spacing.xs },
  stateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { flex: 1 },
  listContent: { flexGrow: 1, paddingBottom: spacing.xxl },
  pendingNotice: { marginTop: spacing.md, alignItems: 'flex-start' },
  notice: { ...typography.body, color: colors.text.secondary, marginTop: spacing.sm },
  errorCard: { borderColor: colors.semantic.danger, borderWidth: 1, backgroundColor: colors.semantic.dangerBg, borderRadius: 12, padding: spacing.lg, marginBottom: spacing.md },
  error: { ...typography.body, color: '#FF9AAE', marginTop: spacing.sm },
  emptyCard: { marginTop: spacing.lg },
  evaluationButton: { marginTop: spacing.sm },
  loadMoreButton: { marginTop: spacing.xl },
});
