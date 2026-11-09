import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { createStaffEventsStore } from '../../services/staffEventsService';

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
      <View style={styles.content}>
        {selected ? <>
          <Text style={styles.title}>{selected.name}</Text>
          <Text style={styles.description}>Status: {STATUS_LABELS[selected.status]}</Text>
          <Text style={styles.message}>A área operacional deste evento será disponibilizada em uma próxima etapa.</Text>
        </> : <>
          <Text style={styles.title}>Selecione um evento</Text>
          <Text style={styles.message}>Atualize a lista para confirmar os eventos autorizados.</Text>
        </>}
        <Button label="Voltar aos eventos" onPress={() => {
          staff.clearSelection();
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate('StaffEvents');
        }} />
      </View>
    </SafeAreaView>
  );
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
