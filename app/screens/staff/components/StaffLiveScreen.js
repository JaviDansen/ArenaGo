import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdminIcon, liveColors as c } from '../../admin/components/AdminLiveUI';

const staffLogo = require('../../../assets/images/logo-arenago-staff.png');

export default function StaffLiveScreen({ testID, actionLabel, onAction, logout = false, children }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID={testID}>
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" style={styles.decoration}>
        <View style={styles.orbitTop} />
        <View style={styles.orbitBottom} />
      </View>
      <View style={styles.header} testID="staff-live-header">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [logout ? styles.logout : styles.back, pressed && styles.pressed]}
        >
          <AdminIcon name={logout ? 'logout' : 'back'} color={logout ? c.text : c.accent} size={logout ? 20 : 22} />
          <Text style={logout ? styles.logoutText : styles.backText}>{actionLabel}</Text>
        </Pressable>
        <Image source={staffLogo} style={styles.brand} resizeMode="contain"
          accessible accessibilityRole="image" accessibilityLabel="ArenaGO" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  decoration: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  orbitTop: { position: 'absolute', width: 680, height: 350, borderWidth: 1, borderColor: '#311042',
    borderRadius: 300, top: -290, right: -300, transform: [{ rotate: '35deg' }] },
  orbitBottom: { position: 'absolute', width: 1000, height: 380, borderWidth: 1, borderColor: '#281036',
    borderRadius: 500, bottom: -250, left: -260, transform: [{ rotate: '-20deg' }] },
  header: { width: '100%', maxWidth: 840, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, gap: 8 },
  brand: { width: '38%', maxWidth: 150, height: 48, flexShrink: 1 },
  logout: { flexDirection: 'row', gap: 7, alignItems: 'center', borderWidth: 1, borderColor: c.border,
    borderRadius: 16, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, flexShrink: 1 },
  logoutText: { color: c.text, fontSize: 13, flexShrink: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, flexShrink: 1, paddingRight: 4 },
  backText: { color: '#ddc4f2', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  pressed: { opacity: 0.7 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, width: '100%', maxWidth: 840,
    alignSelf: 'center', gap: 12 },
});
