import { StatusBar } from 'expo-status-bar';
import { useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';

import { AuthBackground, Badge, Button, Card, InputField, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * Valida e normaliza o conteúdo textual lido de um QR Code de evento.
 * Rejeita valores vazios, URLs arbitrárias, comandos e tamanhos excessivos.
 */
export function validateAndNormalizeQrCode(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'QR Code com formato incompatível.' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'QR Code vazio. Aponte para um código de evento válido.' };
  }
  // Bloqueia esquemas de URL, scripts ou quebras de linha arbitrárias
  if (/^(?:https?|ftp|javascript|data|file):/i.test(trimmed) || /[\r\n\t]/.test(trimmed)) {
    return { ok: false, error: 'O QR Code escaneado não é um código de evento válido.' };
  }
  if (trimmed.length > 64) {
    return { ok: false, error: 'Código de evento excessivamente longo.' };
  }
  // Permite grupos ASCII alfanuméricos com hífens ou underscores
  if (!/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(trimmed)) {
    return { ok: false, error: 'O QR Code deve conter apenas caracteres alfanuméricos e hífens.' };
  }
  return { ok: true, code: trimmed };
}

export default function EventEntryScreen({ navigation, route }) {
  const { admission, lookupEvent, isCurrentAdmission } = useContext(ParticipationContext);

  // Modo inicial: 'select' (padrão), 'qr' ou 'manual'
  const [mode, setMode] = useState(route?.params?.initialMethod || 'select');

  // Estado do formulário manual
  const [eventCode, setEventCode] = useState('');
  const [localError, setLocalError] = useState(null);

  // Estado do scanner QR
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraError, setCameraError] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState(null);

  // Controle de concorrência e ciclo de vida
  const isScanningRef = useRef(false);
  const scanSequenceRef = useRef(0);
  const isMountedRef = useRef(true);

  // Foco da tela via React Navigation (somente ativa câmera quando em foco)
  const isFocused = useIsFocused();

  const loading = admission?.status === 'looking_up';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      scanSequenceRef.current += 1;
      isScanningRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isFocused) {
      scanSequenceRef.current += 1;
      isScanningRef.current = false;
      setScanned(false);
    }
  }, [isFocused]);

  function switchMode(newMode) {
    scanSequenceRef.current += 1;
    isScanningRef.current = false;
    setScanned(false);
    setScanError(null);
    setLocalError(null);
    setCameraError(null);
    setMode(newMode);
  }

  async function handleContinue() {
    if (loading) return;
    const code = eventCode.trim();
    if (!code) {
      setLocalError('Digite o código do evento.');
      return;
    }
    setLocalError(null);
    const result = await lookupEvent(code);
    if (result?.kind === 'found' && isCurrentAdmission()) {
      navigation.navigate('EventConfirmation', { event: result.event, eligibility: result.eligibility });
    }
  }

  async function handleBarcodeScanned({ data } = {}) {
    if (isScanningRef.current || scanned) return;
    isScanningRef.current = true;
    setScanned(true);

    const currentSequence = ++scanSequenceRef.current;
    const validation = validateAndNormalizeQrCode(data);

    if (!validation.ok) {
      if (isMountedRef.current && currentSequence === scanSequenceRef.current) {
        setScanError(validation.error);
      }
      isScanningRef.current = false;
      return;
    }

    setScanError(null);
    try {
      const result = await lookupEvent(validation.code);
      if (!isMountedRef.current || currentSequence !== scanSequenceRef.current) {
        return;
      }
      if (!isCurrentAdmission()) {
        isScanningRef.current = false;
        return;
      }
      if (result?.kind === 'found') {
        navigation.navigate('EventConfirmation', {
          event: result.event,
          eligibility: result.eligibility,
        });
      } else {
        setScanError(result?.message || 'Evento não encontrado para este QR Code.');
        isScanningRef.current = false;
      }
    } catch {
      if (isMountedRef.current && currentSequence === scanSequenceRef.current) {
        setScanError('Erro ao consultar o evento. Verifique sua conexão e tente novamente.');
      }
      isScanningRef.current = false;
    }
  }

  function handleRetryScan() {
    setScanError(null);
    setScanned(false);
    isScanningRef.current = false;
  }

  // --- Renderização por Modo ---

  // Modo A: Leitor de QR Code
  if (mode === 'qr') {
    return (
      <AuthBackground variant="login" overlayOpacity={0.65} testID="event-entry-background">
        <StatusBar style="light" />
        <ScreenHeader
          title="Ler QR Code"
          onBack={() => switchMode('select')}
          testID="event-entry-header"
        />

        <View style={styles.scannerRoot}>
          {!permission ? (
            <View style={styles.centeredFeedback}>
              <ActivityIndicator size="large" color={colors.brand.primary} />
              <Text style={styles.feedbackText}>Verificando permissões de câmera...</Text>
            </View>
          ) : !permission.granted ? (
            <ScrollView contentContainerStyle={styles.permissionContent}>
              <Card variant="highlight" style={styles.permissionCard} testID="event-entry-permission-card">
                <Badge
                  label="ACESSO À CÂMERA"
                  variant={permission.canAskAgain === false ? 'danger' : 'brand'}
                />
                <Text style={styles.permissionTitle}>
                  {permission.canAskAgain === false
                    ? 'Permissão de câmera bloqueada'
                    : 'Permissão de câmera necessária'}
                </Text>
                <Text style={styles.permissionDescription}>
                  {permission.canAskAgain === false
                    ? 'A permissão de câmera foi negada permanentemente. Por favor, habilite o acesso à câmera nas configurações do seu celular ou utilize a digitação manual.'
                    : 'O ArenaGO precisa de acesso à câmera para ler o QR Code de acesso ao evento.'}
                </Text>

                {permission.canAskAgain === false ? (
                  <Button
                    title="Abrir configurações"
                    variant="primary"
                    onPress={() => Linking.openSettings()}
                    style={styles.actionMargin}
                    testID="event-entry-settings-button"
                  />
                ) : (
                  <Button
                    title="Permitir acesso à câmera"
                    variant="primary"
                    onPress={requestPermission}
                    style={styles.actionMargin}
                    testID="event-entry-permission-button"
                  />
                )}

                <Button
                  title="Digitar código manualmente"
                  variant="outline"
                  onPress={() => switchMode('manual')}
                  style={styles.actionMargin}
                  testID="event-entry-switch-manual-button"
                />
                <Button
                  title="Voltar para opções"
                  variant="ghost"
                  onPress={() => switchMode('select')}
                  style={styles.actionMargin}
                  testID="event-entry-back-select-button"
                />
              </Card>
            </ScrollView>
          ) : cameraError ? (
            <ScrollView contentContainerStyle={styles.permissionContent}>
              <Card variant="highlight" style={styles.permissionCard} testID="event-entry-camera-error-card">
                <Badge label="CÂMERA INDISPONÍVEL" variant="danger" />
                <Text style={styles.permissionTitle}>Falha ao iniciar a câmera</Text>
                <Text style={styles.permissionDescription}>{cameraError}</Text>
                <Button
                  title="Digitar código manualmente"
                  variant="primary"
                  onPress={() => switchMode('manual')}
                  style={styles.actionMargin}
                  testID="event-entry-switch-manual-button"
                />
                <Button
                  title="Voltar para opções"
                  variant="ghost"
                  onPress={() => switchMode('select')}
                  style={styles.actionMargin}
                  testID="event-entry-back-select-button"
                />
              </Card>
            </ScrollView>
          ) : isFocused ? (
            <View style={styles.cameraContainer}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned || isScanningRef.current ? undefined : handleBarcodeScanned}
                onMountError={(error) => setCameraError(error?.message || 'Câmera indisponível no dispositivo.')}
                testID="event-entry-camera-view"
              />

              {/* Sobreposição visual de enquadramento */}
              <View style={styles.overlay} pointerEvents="box-none">
                <View style={styles.overlayTop}>
                  <Text style={styles.scannerInstruction}>
                    Aponte a câmera para o QR Code do evento
                  </Text>
                </View>

                <View style={styles.reticleRow} pointerEvents="none">
                  <View style={styles.overlaySide} />
                  <View style={styles.reticleFrame} testID="event-entry-scanner-reticle">
                    <View style={[styles.reticleCorner, styles.cornerTL]} />
                    <View style={[styles.reticleCorner, styles.cornerTR]} />
                    <View style={[styles.reticleCorner, styles.cornerBL]} />
                    <View style={[styles.reticleCorner, styles.cornerBR]} />
                  </View>
                  <View style={styles.overlaySide} />
                </View>

                <View style={styles.overlayBottom}>
                  {loading && (
                    <View style={styles.loadingBanner}>
                      <ActivityIndicator size="small" color={colors.brand.primary} />
                      <Text style={styles.loadingBannerText}>Consultando evento...</Text>
                    </View>
                  )}

                  {scanError && (
                    <View style={styles.scanErrorCard} accessibilityRole="alert">
                      <Text style={styles.scanErrorText} testID="event-entry-scan-error">
                        {scanError}
                      </Text>
                      <Button
                        title="Escanear novamente"
                        variant="secondary"
                        size="sm"
                        onPress={handleRetryScan}
                        style={styles.retryButton}
                        testID="event-entry-retry-scan-button"
                      />
                    </View>
                  )}

                  <View style={styles.scannerActions}>
                    <Button
                      title="Digitar código manualmente"
                      variant="outline"
                      onPress={() => switchMode('manual')}
                      style={styles.scannerActionButton}
                      testID="event-entry-switch-manual-button"
                    />
                    <Button
                      title="Voltar para opções"
                      variant="ghost"
                      onPress={() => switchMode('select')}
                      style={styles.scannerActionButton}
                      testID="event-entry-back-select-button"
                    />
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.centeredFeedback}>
              <Text style={styles.feedbackText}>Leitor inativo fora de foco.</Text>
            </View>
          )}
        </View>
      </AuthBackground>
    );
  }

  // Modo B: Digitar código manualmente
  if (mode === 'manual') {
    return (
      <AuthBackground variant="login" overlayOpacity={0.65} testID="event-entry-background">
        <StatusBar style="light" />
        <ScreenHeader
          title="Digitar código"
          onBack={() => switchMode('select')}
          testID="event-entry-header"
        />
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroSection}>
              <Badge label="CHECK-IN PRESENCIAL" variant="brand" />
              <Text style={styles.title}>Digite o código de acesso</Text>
              <Text style={styles.description}>
                Informe o código disponibilizado na recepção ou nas estações do evento para consultar sua entrada.
              </Text>
            </View>

            <Card variant="highlight" style={styles.formCard} testID="event-entry-form-card">
              <Badge label="CÓDIGO DO EVENTO" variant="default" />
              <InputField
                value={eventCode}
                onChangeText={(value) => { setEventCode(value); setLocalError(null); }}
                placeholder="Ex.: ARENA123"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
                error={localError || (admission?.status === 'error' ? admission.error : null)}
                testID="event-entry-code-input"
                returnKeyType="go"
                onSubmitEditing={handleContinue}
                containerStyle={styles.codeInput}
              />
              <Text style={styles.helperText}>O código é fornecido presencialmente pela equipe do evento.</Text>
              <Button
                title={loading ? 'Consultando...' : 'Continuar'}
                variant="primary"
                onPress={handleContinue}
                disabled={loading}
                style={styles.continueButton}
                testID="event-entry-continue-button"
              />
              <Button
                title="Ler QR Code"
                variant="outline"
                onPress={() => switchMode('qr')}
                disabled={loading}
                style={styles.switchButton}
                testID="event-entry-switch-qr-button"
              />
              <Button
                title="Voltar para opções"
                variant="ghost"
                onPress={() => switchMode('select')}
                disabled={loading}
                style={styles.backOptionsButton}
                testID="event-entry-back-to-options-button"
              />
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </AuthBackground>
    );
  }

  // Modo Seleção Inicial: Apresenta as duas opções
  return (
    <AuthBackground variant="login" overlayOpacity={0.65} testID="event-entry-background">
      <StatusBar style="light" />
      <ScreenHeader
        title="Entrar em um evento"
        onBack={() => navigation.goBack()}
        testID="event-entry-header"
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Badge label="CHECK-IN PRESENCIAL" variant="brand" />
          <Text style={styles.title}>Como deseja entrar?</Text>
          <Text style={styles.description}>
            Escolha entre apontar a câmera para o QR Code do evento ou digitar o código de acesso manualmente.
          </Text>
        </View>

        <View style={styles.methodsContainer}>
          {/* Opção A: QR Code */}
          <Card
            variant="interactive"
            style={styles.methodCard}
            onPress={() => switchMode('qr')}
            testID="event-entry-choose-qr"
            accessibilityRole="button"
            accessibilityLabel="Ler QR Code. Aponte a câmera para o QR Code do evento."
            accessibilityHint="Toque para abrir o leitor de QR Code"
          >
            <View style={styles.methodCardBadgeRow}>
              <Badge label="RÁPIDO" variant="brand" />
            </View>
            <Text style={styles.methodCardTitle}>Ler QR Code</Text>
            <Text style={styles.methodCardDescription}>
              Aponte a câmera do seu celular para a credencial, banner ou totem da estação.
            </Text>
            <View
              style={[styles.methodCardActionBadge, styles.methodCardActionPrimary]}
              pointerEvents="none"
              testID="event-entry-qr-action-indicator"
            >
              <Text style={styles.methodCardActionTextPrimary}>Ler QR Code</Text>
            </View>
          </Card>

          {/* Opção B: Digitar código */}
          <Card
            variant="interactive"
            style={styles.methodCard}
            onPress={() => switchMode('manual')}
            testID="event-entry-choose-manual"
            accessibilityRole="button"
            accessibilityLabel="Digitar código. Informe o código de acesso manualmente."
            accessibilityHint="Toque para abrir a digitação manual de código"
          >
            <View style={styles.methodCardBadgeRow}>
              <Badge label="MANUAL" variant="default" />
            </View>
            <Text style={styles.methodCardTitle}>Digitar código</Text>
            <Text style={styles.methodCardDescription}>
              Informe o código alfanumérico fornecido pela recepção ou equipe do evento.
            </Text>
            <View
              style={[styles.methodCardActionBadge, styles.methodCardActionOutline]}
              pointerEvents="none"
              testID="event-entry-manual-action-indicator"
            >
              <Text style={styles.methodCardActionTextOutline}>Digitar código</Text>
            </View>
          </Card>
        </View>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  heroSection: {
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginTop: spacing.lg,
  },
  description: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  methodsContainer: {
    gap: spacing.lg,
  },
  methodCard: {
    alignItems: 'stretch',
    padding: spacing.xl,
  },
  methodCardBadgeRow: {
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  methodCardTitle: {
    ...typography.titleLarge,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  methodCardDescription: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  methodCardActionBadge: {
    minHeight: 48,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  methodCardActionPrimary: {
    backgroundColor: colors.brand.primary,
  },
  methodCardActionOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border.input,
  },
  methodCardActionTextPrimary: {
    ...typography.bodyLarge,
    fontWeight: '700',
    color: colors.text.onBrand,
  },
  methodCardActionTextOutline: {
    ...typography.bodyLarge,
    fontWeight: '700',
    color: colors.text.primary,
  },
  formCard: {
    alignItems: 'stretch',
  },
  codeInput: {
    marginTop: spacing.lg,
  },
  helperText: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  continueButton: {
    marginTop: spacing.xl,
  },
  switchButton: {
    marginTop: spacing.md,
  },
  backOptionsButton: {
    marginTop: spacing.sm,
  },
  scannerRoot: {
    flex: 1,
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  centeredFeedback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  feedbackText: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  permissionContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  permissionCard: {
    alignItems: 'stretch',
    padding: spacing.xl,
  },
  permissionTitle: {
    ...typography.titleLarge,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  permissionDescription: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  actionMargin: {
    marginTop: spacing.md,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  scannerInstruction: {
    ...typography.titleMedium,
    color: colors.text.primary,
    textAlign: 'center',
  },
  reticleRow: {
    flexDirection: 'row',
    height: 250,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.72)',
  },
  reticleFrame: {
    width: 250,
    height: 250,
    position: 'relative',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  reticleCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: colors.brand.primaryLight,
  },
  cornerTL: {
    top: -1,
    left: -1,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: radii.md,
  },
  cornerTR: {
    top: -1,
    right: -1,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: radii.md,
  },
  cornerBL: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: radii.md,
  },
  cornerBR: {
    bottom: -1,
    right: -1,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: radii.md,
  },
  overlayBottom: {
    flex: 1.2,
    backgroundColor: 'rgba(5, 5, 10, 0.72)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    marginBottom: spacing.md,
  },
  loadingBannerText: {
    ...typography.bodySmall,
    color: colors.text.primary,
  },
  scanErrorCard: {
    width: '100%',
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  scanErrorText: {
    ...typography.bodySmall,
    color: colors.semantic.danger,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.sm,
  },
  scannerActions: {
    width: '100%',
    marginTop: 'auto',
    gap: spacing.sm,
  },
  scannerActionButton: {
    width: '100%',
  },
});
