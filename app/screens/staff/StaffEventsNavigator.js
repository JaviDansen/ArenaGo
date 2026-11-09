import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { createStaffEventsStore } from '../../services/staffEventsService';
import { createStaffDashboardStore } from '../../services/staffDashboardService';

const Stack = createNativeStackNavigator();
const StaffEventsContext = createContext(null);
const STATUS_LABELS = { scheduled: 'Agendado', open: 'Aberto', closing: 'Em encerramento', closed: 'Encerrado' };

function StaffEventsProvider({ children }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const getIdentity = () => {
    const current = authRef.current;
    const roles = current?.user?.roles;
    if (!current?.isAuthenticated || !current.user?.id || !Array.isArray(roles) ||
        !roles.includes('staff') || roles.includes('admin') ||
        typeof current.isIdentityVerified !== 'function' || !current.isIdentityVerified() ||
        typeof current.getSessionEpoch !== 'function' || typeof current.getIdentityRevision !== 'function') return null;
    return { userId: current.user.id, epoch: current.getSessionEpoch(), revision: current.getIdentityRevision() };
  };
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStaffEventsStore({
      client: { get: (...args) => authRef.current.httpClient.get(...args) }, getIdentity,
    });
  }
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const identity = getIdentity();
  const userId = identity?.userId ?? null;
  const epoch = identity?.epoch ?? null;
  const revision = identity?.revision ?? null;

  useEffect(() => store.subscribe(setSnapshot), [store]);
  useEffect(() => {
    const next = userId !== null ? { userId, epoch, revision } : null;
    store.setIdentity(next);
    if (next) void store.refresh();
    return () => store.setIdentity(null);
  }, [store, userId, epoch, revision]);

  const current = store.isCurrent(snapshot.identity);
  const value = {
    status: current ? snapshot.status : 'loading',
    events: current ? snapshot.events : [],
    selected: current ? snapshot.selected : null,
    error: current ? snapshot.error : null,
    refresh: store.refresh,
    select: store.select,
    clearSelection: store.clearSelection,
    isCurrent: store.isCurrent,
    getSelected: () => store.isCurrent() ? store.getSnapshot().selected : null,
  };
  return <StaffEventsContext.Provider value={value}>{children}</StaffEventsContext.Provider>;
}

function Button({ label, onPress, disabled = false }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={disabled ? undefined : onPress} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function StaffEventsScreen({ navigation }) {
  const staff = useContext(StaffEventsContext);
  const auth = useAuth();
  const messages = {
    session: 'Não foi possível confirmar sua sessão. Entre novamente ou tente atualizar.',
    network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    unavailable: 'Não foi possível carregar os eventos autorizados. Tente novamente.',
  };
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Eventos Staff</Text>
        <Text style={styles.description}>Selecione um evento autorizado para sua conta.</Text>
        {staff.status === 'loading' && <View accessibilityRole="progressbar" style={styles.notice}>
          <ActivityIndicator color="#a78bfa" /><Text style={styles.message}>Carregando eventos...</Text>
        </View>}
        {staff.status === 'error' && <Text accessibilityRole="alert" style={styles.message}>{messages[staff.error]}</Text>}
        {staff.status === 'ready' && staff.events.length === 0 &&
          <Text style={styles.message}>Nenhum evento autorizado para esta conta.</Text>}
        {staff.status === 'ready' && staff.events.map((event) => (
          <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`Selecionar evento ${event.name}`}
            style={styles.event} onPress={() => {
              if (staff.select(event.id)) navigation.navigate('StaffEventHome');
            }}>
            <Text style={styles.eventName}>{event.name}</Text>
            <Text style={styles.eventStatus}>{STATUS_LABELS[event.status]}</Text>
          </Pressable>
        ))}
        <Button label="Atualizar eventos" disabled={staff.status === 'loading'} onPress={() => { void staff.refresh(); }} />
        <Button label="Sair da conta" onPress={() => { if (staff.isCurrent()) void auth.logout(); }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StaffEventHomeScreen({ navigation }) {
  const staff = useContext(StaffEventsContext);
  useEffect(() => navigation.addListener('beforeRemove', staff.clearSelection), [navigation, staff.clearSelection]);
  const selected = staff.isCurrent() ? staff.selected : null;
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {selected ? <>
          <Text style={styles.title}>{selected.name}</Text>
          <Text style={styles.description}>Status: {STATUS_LABELS[selected.status]}</Text>
          <StaffEventDashboard event={selected} staff={staff} />
        </> : <>
          <Text style={styles.title}>Selecione um evento</Text>
          <Text style={styles.message}>Atualize a lista para confirmar os eventos autorizados.</Text>
        </>}
        <Button label="Voltar aos eventos" onPress={() => {
          staff.clearSelection();
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate('StaffEvents');
        }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StaffEventDashboard({ event, staff }) {
  const auth = useAuth();
  const live = useRef({ auth, staff });
  live.current = { auth, staff };
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStaffDashboardStore({
      client: { get: (...args) => live.current.auth.httpClient.get(...args) },
      getContext: () => {
        const { auth: current, staff: area } = live.current;
        const selected = area.getSelected();
        if (!selected || !current?.isAuthenticated || !current.isIdentityVerified()) return null;
        return { eventId: selected.id, userId: current.user.id,
          epoch: current.getSessionEpoch(), revision: current.getIdentityRevision() };
      },
    });
  }
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const epoch = auth.getSessionEpoch();
  const revision = auth.getIdentityRevision();
  useEffect(() => store.subscribe(setSnapshot), [store]);
  useEffect(() => {
    store.setContext({ eventId: event.id, userId: auth.user.id, epoch, revision });
    void store.refreshStations();
    return () => store.setContext(null);
  }, [store, event.id, auth.user.id, epoch, revision]);
  if (!store.isCurrent()) return null;
  const messages = {
    session: 'Não foi possível confirmar sua sessão. Entre novamente ou tente atualizar.',
    denied: 'Acesso ao evento ou à experiência indisponível. Atualize seus eventos autorizados.',
    network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    unavailable: 'Não foi possível carregar os dados. Tente novamente.',
  };
  const experiences = [...new Set(snapshot.stations.map((station) => station.experienceId))];
  return <>
    <Text style={styles.title}>Estações</Text>
    {snapshot.stationStatus === 'loading' && <Text style={styles.message}>Carregando estações...</Text>}
    {snapshot.stationStatus === 'error' && <Text accessibilityRole="alert" style={styles.message}>{messages[snapshot.stationError]}</Text>}
    {snapshot.stationStatus === 'ready' && snapshot.stations.length === 0 &&
      <Text style={styles.message}>Nenhuma estação encontrada neste evento.</Text>}
    {snapshot.stationStatus === 'ready' && snapshot.stations.map((station) => <View key={station.id} style={styles.event}>
      <Text style={styles.eventName}>{station.label}</Text>
      <Text style={styles.message}>Experiência: {station.experienceId}</Text>
      <Text style={styles.message}>Disponibilidade: {station.availability === 'available' ? 'Disponível' : 'Indisponível'}</Text>
      <Text style={styles.message}>Atendimento pendente: {station.pendingServiceSessionId ? 'Sim' : 'Não'}</Text>
    </View>)}
    <Button label="Atualizar estações" disabled={snapshot.stationStatus === 'loading'} onPress={() => { void store.refreshStations(); }} />
    {snapshot.stationStatus === 'ready' && <>
      <Text style={styles.title}>Filas por experiência</Text>
      <Text style={styles.message}>São exibidas apenas experiências com estações retornadas. Os nomes ainda não estão disponíveis.</Text>
      {experiences.map((id) => <Button key={id} label={`Consultar fila ${id}`} onPress={() => { void store.refreshQueue(id); }} />)}
      {snapshot.queueStatus === 'loading' && <Text style={styles.message}>Carregando fila...</Text>}
      {snapshot.queueStatus === 'error' && <Text accessibilityRole="alert" style={styles.message}>{messages[snapshot.queueError]}</Text>}
      {snapshot.queueStatus === 'ready' && <View style={styles.event}>
        <Text style={styles.eventName}>Fila da experiência {snapshot.experienceId}</Text>
        <Text style={styles.message}>Pessoas em espera: {snapshot.queue.waitingCount}</Text>
        <Text style={styles.message}>Janela operacional para chamadas: {snapshot.queue.canCallWaitingEntries ? 'Aberta' : 'Fechada'}</Text>
      </View>}
      {snapshot.experienceId && snapshot.queueStatus !== 'loading' &&
        <Button label="Atualizar fila" onPress={() => { void store.refreshQueue(); }} />}
    </>}
  </>;
}

export default function StaffEventsNavigator() {
  return (
    <StaffEventsProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="StaffEvents" component={StaffEventsScreen} />
        <Stack.Screen name="StaffEventHome" component={StaffEventHomeScreen} />
      </Stack.Navigator>
    </StaffEventsProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0a17' },
  content: { flexGrow: 1, padding: 24, gap: 14 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  description: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  message: { color: '#cbd5e1', fontSize: 14, lineHeight: 21 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  event: { backgroundColor: '#191330', borderColor: '#34265a', borderWidth: 1, borderRadius: 14, padding: 16 },
  eventName: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  eventStatus: { color: '#c4b5fd', marginTop: 6, fontSize: 14 },
  button: { backgroundColor: '#7c3aed', borderRadius: 14, padding: 16, alignItems: 'center' },
  disabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
