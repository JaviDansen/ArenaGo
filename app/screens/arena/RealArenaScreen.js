import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { useAuth } from '../../context/AuthContext';
import { createArenaQueueCoordinator, describeArenaError } from '../../services/arenaQueueService';
import { defaultArenaQueueIntentStorage } from '../../services/arenaQueueIntentStorage';
import { createParticipationActionCoordinator, describeParticipationActionError } from '../../services/participationActionService';

/** Tela real de participação ativa. Sem alterações de domínio feitas em estado React. */
export default function RealArenaScreen({ participation, refreshParticipation }) {
  const auth = useAuth();
  const userId = auth?.user?.id;
  const participationId = participation.id;
  const eventId = participation.eventId;
  const client = auth?.httpClient;
  const getEpoch = auth?.getSessionEpoch;
  const epoch = typeof getEpoch === 'function' ? getEpoch() : null;
  const focused = useRef(false);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const busyRef = useRef(false);

  const context = useMemo(() => ({ userId, participationId, eventId }), [userId, participationId, eventId]);
  const coordinator = useMemo(() => createArenaQueueCoordinator({
    client,
    storage: defaultArenaQueueIntentStorage,
    createKey: () => Crypto.randomUUID(),
    isCurrent: () => focused.current && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [client, getEpoch, epoch]);
  const completion = useMemo(() => createParticipationActionCoordinator({
    client,
    isCurrent: () => focused.current && auth?.user?.id === userId
      && typeof getEpoch === 'function' && getEpoch() === epoch,
  }), [client, auth, getEpoch, epoch, userId]);

  const refresh = useCallback(async () => {
    if (!focused.current || busyRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const next = await coordinator.read(context);
      if (focused.current) { setState(next); setNotice(null); }
    } catch (err) {
      if (focused.current) setError(describeArenaError(err));
    } finally {
      if (focused.current) setLoading(false);
    }
  }, [coordinator, context]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refresh();
    return () => { focused.current = false; };
  }, [refresh]));

  const join = async (experienceId) => {
    if (busyRef.current || !focused.current || loading || !state) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await coordinator.join(context, experienceId);
      if (!focused.current) return;
      if (result.state) setState(result.state);
      if (result.kind === 'confirmed') setNotice('Entrada na fila confirmada pelo servidor.');
      else if (result.kind === 'already') setNotice('Você já possui uma entrada na fila.');
      else if (result.kind === 'pending_other') setError('Há outra tentativa de fila pendente nesta conta. Nenhuma nova entrada foi enviada.');
      else if (result.kind === 'closed') setError('Esta experiência não está mais aceitando entradas.');
      else setError(result.message || 'Entrada não confirmada. Atualize e repita somente com a mesma chave.');
    } catch (err) {
      if (focused.current) setError(describeArenaError(err));
    } finally {
      busyRef.current = false;
      if (focused.current) setBusy(false);
    }
  };

  const finish = () => {
    if (busyRef.current || loading || state?.pendingIntent) return;
    Alert.alert('Deseja sair da Arena?', 'Sua participação será encerrada e não poderá ser retomada.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair da Arena', style: 'destructive', onPress: async () => {
        if (busyRef.current || !focused.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
          await completion.finish(userId, participationId);
          if (!focused.current) return;
          await refreshParticipation();
        } catch (err) {
          if (focused.current) setError(describeParticipationActionError(err, 'finish'));
        } finally {
          busyRef.current = false;
          if (focused.current) setBusy(false);
        }
      } },
    ]);
  };

  const entry = state?.currentQueueEntry;
  const pending = state?.pendingIntent;
  const pendingHere = pending?.participationId === participationId;
  const hasOtherPending = Boolean(pending && !pendingHere);
  const lockActions = busy || loading || Boolean(entry) || Boolean(pending);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>Minha Arena</Text>
        <Text style={styles.sub}>Participação ativa · informações do servidor</Text>
        {loading && !state ? <ActivityIndicator accessibilityLabel="Consultando a Arena" /> : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {entry ? (
          <View style={styles.highlight}>
            <Text style={styles.sectionTitle}>{entry.status === 'waiting' ? 'Você está na fila' : 'É a sua vez!'}</Text>
            <Text style={styles.line}>{entry.experienceName}</Text>
            {entry.status === 'waiting'
              ? <Text style={styles.position}>Posição {entry.position}º</Text>
              : <Text style={styles.position}>Dirija-se à estação: {entry.stationLabel}</Text>}
            <Text style={styles.note}>A posição e a chamada são atualizadas ao tocar em “Atualizar”.</Text>
          </View>
        ) : null}

        {!entry && pending ? (
          <View style={styles.highlight}>
            <Text style={styles.sectionTitle}>Tentativa anterior não confirmada</Text>
            <Text style={styles.line}>
              {hasOtherPending
                ? 'Há uma solicitação pendente de outra participação nesta conta. Não será criada uma nova entrada.'
                : 'Atualize a fila antes de tentar novamente. A mesma chave de operação será reutilizada.'}
            </Text>
            {pendingHere ? (
              <Pressable disabled={busy || loading} style={styles.button} onPress={() => join(pending.experienceId)}>
                <Text style={styles.buttonText}>Conferir / repetir a mesma tentativa</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Experiências disponíveis</Text>
        {state?.experiences.length === 0 ? <Text style={styles.line}>Nenhuma experiência cadastrada.</Text> : null}
        {state?.experiences.map((experience) => {
          const permitted = state.acceptingNewQueueEntries && experience.acceptingNewQueueEntries;
          return (
            <View key={experience.id} style={styles.card}>
              <Text style={styles.cardTitle}>{experience.name}</Text>
              <Text style={styles.line}>{experience.waitingCount} pessoa(s) aguardando</Text>
              <Text style={styles.note}>{permitted ? 'Recebendo entradas' : 'Entrada na fila encerrada'}</Text>
              {!entry && !pending && permitted ? (
                <Pressable disabled={lockActions} style={[styles.button, lockActions && styles.disabled]}
                  onPress={() => join(experience.id)}>
                  <Text style={styles.buttonText}>{busy ? 'Verificando...' : 'Entrar na fila'}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Pressable disabled={busy} style={[styles.secondaryButton, busy && styles.disabled]} onPress={refresh}>
          <Text style={styles.secondaryText}>{loading ? 'Consultando...' : 'Atualizar fila e experiências'}</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={refreshParticipation}>
          <Text style={styles.secondaryText}>Atualizar situação da participação</Text>
        </Pressable>
        <Pressable disabled={busy || loading || Boolean(pending)}
          style={[styles.secondaryButton, (busy || loading || pending) && styles.disabled]}
          onPress={finish} accessibilityRole="button">
          <Text style={styles.secondaryText}>{busy ? 'Aguarde...' : 'Sair da Arena'}</Text>
        </Pressable>
        <Text style={styles.note}>
          Chamada e conclusão são realizadas pelo Staff. Este aplicativo não simula atendimento
          nem permite cancelar somente a fila.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 25, fontWeight: '700', color: '#111827' },
  sub: { color: '#6b7280', marginTop: 6, marginBottom: 16 },
  sectionTitle: { fontSize: 19, fontWeight: '700', marginVertical: 12, color: '#111827' },
  highlight: { borderWidth: 1, borderColor: '#93c5fd', backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, marginBottom: 16 },
  card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 6 },
  line: { fontSize: 15, color: '#374151', marginTop: 4 },
  position: { fontSize: 19, fontWeight: '700', marginTop: 10, color: '#1d4ed8' },
  note: { fontSize: 13, color: '#6b7280', marginTop: 10, lineHeight: 20 },
  button: { backgroundColor: '#111827', padding: 14, borderRadius: 8, marginTop: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  secondaryButton: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 14, marginTop: 10, alignItems: 'center' },
  secondaryText: { color: '#111827', fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  error: { color: '#991b1b', backgroundColor: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 10 },
  notice: { color: '#166534', backgroundColor: '#f0fdf4', padding: 12, borderRadius: 8, marginBottom: 10 },
});
