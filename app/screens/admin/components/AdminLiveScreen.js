import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { adminReadOwner } from '../useAdminEvents';
import { AdminIcon, liveColors as c } from './AdminLiveUI';
import AdminBottomBar from './AdminBottomBar';

export default function AdminLiveScreen({ title, subtitle, navigation, backLabel = 'Voltar', showTabs = false, children }) {
  const auth = useAuth();
  const owner = adminReadOwner(auth), live = useRef(auth), mounted = useRef(true);
  live.current = auth;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.decoration}>
      <View style={styles.orbitTop} /><View style={styles.orbitBottom} />
    </View>
    <View style={styles.header}>
      <Image source={require('../../../assets/images/logo-arenago.png')} style={styles.brand} resizeMode="contain" accessible accessibilityRole="image" accessibilityLabel="ArenaGO" />
      <Pressable accessibilityRole="button" accessibilityLabel="Sair da conta" style={({ pressed }) => [styles.logout, pressed && { opacity: 0.7 }]} onPress={() => {
        if (mounted.current && owner && adminReadOwner(live.current) === owner) void live.current.logout();
      }}><AdminIcon name="logout" color={c.text} size={20} /><Text style={styles.logoutText}>Sair da conta</Text></Pressable>
    </View>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
        {navigation ? <Pressable accessibilityRole="button" accessibilityLabel={backLabel} style={({ pressed }) => [styles.back, pressed && styles.backPressed]} onPress={() => navigation.goBack()}>
          <AdminIcon name="back" color={c.accent} size={22} /><Text style={styles.backText}>{backLabel}</Text></Pressable> : null}
        <Text style={styles.eyebrow}>ÁREA ADMINISTRATIVA</Text>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
    {showTabs ? <AdminBottomBar active="Home" onSelect={screen => navigation.popTo('AdminTabs', { screen })} /> : null}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  decoration: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  orbitTop: { position: 'absolute', width: 680, height: 350, borderWidth: 1, borderColor: '#311042', borderRadius: 300, top: -290, right: -300, transform: [{ rotate: '35deg' }] },
  orbitBottom: { position: 'absolute', width: 1000, height: 380, borderWidth: 1, borderColor: '#281036', borderRadius: 500, bottom: -250, left: -260, transform: [{ rotate: '-20deg' }] },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  brand: { width: 150, height: 48 },
  logout: { flexDirection: 'row', gap: 7, alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 16, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: c.text, fontSize: 13 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, width: '100%', maxWidth: 840, alignSelf: 'center' },
  eyebrow: { color: c.muted, fontSize: 12, lineHeight: 18, fontWeight: '700', letterSpacing: 2, marginTop: 12 },
  title: { color: c.text, fontSize: 28, lineHeight: 35, fontWeight: '700', marginTop: 8 },
  subtitle: { color: c.muted, fontSize: 16, lineHeight: 24, marginTop: 10, marginBottom: 22 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', minHeight: 48, paddingRight: 12, marginBottom: 12 },
  backPressed: { opacity: 0.7 },
  backText: { color: '#ddc4f2', fontSize: 15, fontWeight: '600' },
});
