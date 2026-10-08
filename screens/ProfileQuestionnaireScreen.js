import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { validateAboutYouStep } from '../utils/validation';

// =============================================================================
// DEFINIÇÃO DAS ETAPAS DO QUESTIONÁRIO (TASK 3)
// 1. Sobre você (funcional nesta task)
// 2. Seus jogos (provisório — Task 4)
// 3. Mercado de games (provisório — Task 5)
// =============================================================================
const QUESTIONNAIRE_STEPS = [
  {
    id: 'about-you',
    stepNumber: 1,
    tag: 'ETAPA 1 DE 3',
    title: 'Sobre você',
    subtitle: 'Preencha suas informações para personalizarmos sua experiência na arena.',
  },
  {
    id: 'your-games',
    stepNumber: 2,
    tag: 'ETAPA 2 DE 3',
    title: 'Seus jogos',
    subtitle: 'Seleção dos seus jogos favoritos (busca e seleção múltipla na Task 4).',
    isProvisional: true,
  },
  {
    id: 'games-market',
    stepNumber: 3,
    tag: 'ETAPA 3 DE 3',
    title: 'Mercado de games',
    subtitle: 'Percepção e interesse no mercado profissional de games (Task 5).',
    isProvisional: true,
  },
];

const GENDER_OPTIONS = [
  'Feminino',
  'Masculino',
  'Outro',
  'Prefiro não informar',
];

const EDUCATION_OPTIONS = [
  'Fundamental',
  'Médio',
  'Superior',
  'Pós-graduação',
  'Prefiro não informar',
];

// Estrutura de dados local compartilhada por todas as etapas do questionário
const INITIAL_QUESTIONNAIRE_DATA = {
  // Etapa 1 — Sobre você
  age: '',
  gender: '',
  otherGender: null,
  education: '',

  // Etapa 2 — Seus jogos (estrutura reservada para a Task 4)
  selectedGames: [],

  // Etapa 3 — Mercado de games (estrutura reservada para a Task 5)
  marketKnowledge: null,
  marketInterest: null,
};

export default function ProfileQuestionnaireScreen({ navigation, route }) {
  const registeredUser = route?.params?.user || null;

  // Controle de etapa atual (0-indexada: 0 = Etapa 1, 1 = Etapa 2, 2 = Etapa 3)
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Estado compartilhado em memória pelas etapas do questionário
  const [questionnaireData, setQuestionnaireData] = useState(INITIAL_QUESTIONNAIRE_DATA);

  // Estados dos campos da Etapa 1 — Sobre você
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [otherGender, setOtherGender] = useState('');
  const [education, setEducation] = useState('');
  const [errors, setErrors] = useState({});

  const totalSteps = QUESTIONNAIRE_STEPS.length;
  const currentStep = QUESTIONNAIRE_STEPS[currentStepIndex];
  const progressPercent = ((currentStepIndex + 1) / totalSteps) * 100;

  // Navegação para trás
  function handleBack() {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    } else {
      // Retornar da Etapa 1 ao Cadastro, quando necessário
      navigation.goBack();
    }
  }

  // Seleção única de gênero
  function handleSelectGender(option) {
    setGender(option);
    if (errors.gender) {
      setErrors((prev) => ({ ...prev, gender: null }));
    }

    if (option !== 'Outro') {
      // Se o participante trocar "Outro" por outra opção, o campo adicional
      // deixa de ser exigido e seu valor anterior não deve ser considerado na resposta final.
      setOtherGender('');
      if (errors.otherGender) {
        setErrors((prev) => ({ ...prev, otherGender: null }));
      }
    }
  }

  // Seleção única de escolaridade
  function handleSelectEducation(option) {
    setEducation(option);
    if (errors.education) {
      setErrors((prev) => ({ ...prev, education: null }));
    }
  }

  // Validação e avanço da Etapa 1 para a Etapa 2
  function handleAdvanceStep1() {
    const validation = validateAboutYouStep({
      age,
      gender,
      otherGender,
      education,
    });

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});

    // Se o gênero não for 'Outro', a especificação não é considerada na resposta final
    const resolvedOtherGender = gender === 'Outro' ? otherGender.trim() : null;

    setQuestionnaireData((prev) => ({
      ...prev,
      age: age.trim(),
      gender,
      otherGender: resolvedOtherGender,
      education,
    }));

    setCurrentStepIndex(1);
  }

  // Avanço provisório da Etapa 2 para a Etapa 3
  function handleAdvanceStep2() {
    setCurrentStepIndex(2);
  }

  // Finalização provisória do questionário (direcionamento para Home / MainTabs)
  function handleFinishQuestionnaire() {
    // Simulação de navegação: direciona para o MainTabs (Início com HomeFlowScreen)
    // Sem registrar perfil definitivamente completo nem salvar permanentemente.
    if (navigation.reset) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    } else {
      navigation.replace('MainTabs');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Top Header com botão voltar e marca */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={8}
          accessibilityLabel="Voltar etapa"
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>QUESTIONÁRIO DE PERFIL</Text>
          <Text style={styles.headerStepBadge}>
            Etapa {currentStepIndex + 1} de {totalSteps}
          </Text>
        </View>

        <View style={styles.headerPlaceholder} />
      </View>

      {/* Barra visual de progresso */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <View style={styles.stepsSegments}>
          {QUESTIONNAIRE_STEPS.map((step, idx) => (
            <View
              key={step.id}
              style={[
                styles.segmentDot,
                idx <= currentStepIndex ? styles.segmentDotActive : styles.segmentDotInactive,
              ]}
            />
          ))}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Cabeçalho da Etapa Atual */}
          <Text style={styles.tag}>{currentStep.tag}</Text>
          <Text style={styles.title}>{currentStep.title}</Text>
          <Text style={styles.subtitle}>{currentStep.subtitle}</Text>

          {/* ================================================================= */}
          {/* ETAPA 1 — SOBRE VOCÊ */}
          {/* ================================================================= */}
          {currentStepIndex === 0 && (
            <View style={styles.form}>
              {/* CAMPO 1 — IDADE */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Idade</Text>
                  <Text style={styles.requiredStar}>*</Text>
                </View>
                <TextInput
                  style={[styles.input, errors.age ? styles.inputError : null]}
                  placeholder="Ex: 22"
                  placeholderTextColor="#64748b"
                  value={age}
                  onChangeText={(text) => {
                    // Aceitar somente dígitos numéricos
                    const numericText = text.replace(/[^0-9]/g, '');
                    setAge(numericText);
                    if (errors.age) {
                      setErrors((prev) => ({ ...prev, age: null }));
                    }
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                />
                {errors.age ? (
                  <Text style={styles.errorText}>{errors.age}</Text>
                ) : null}
              </View>

              {/* CAMPO 2 — GÊNERO */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Gênero</Text>
                  <Text style={styles.requiredStar}>*</Text>
                </View>

                <View style={styles.optionsList}>
                  {GENDER_OPTIONS.map((option) => {
                    const isSelected = gender === option;
                    return (
                      <Pressable
                        key={option}
                        style={[
                          styles.optionCard,
                          isSelected ? styles.optionCardSelected : null,
                          errors.gender ? styles.optionCardError : null,
                        ]}
                        onPress={() => handleSelectGender(option)}
                      >
                        <View style={styles.optionRadioOuter}>
                          {isSelected && <View style={styles.optionRadioInner} />}
                        </View>
                        <Text
                          style={[
                            styles.optionText,
                            isSelected ? styles.optionTextSelected : null,
                          ]}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {errors.gender ? (
                  <Text style={styles.errorText}>{errors.gender}</Text>
                ) : null}

                {/* CAMPO CONDICIONAL: SE GÊNERO FOR "OUTRO" */}
                {gender === 'Outro' && (
                  <View style={styles.conditionalInputContainer}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>Especifique seu gênero</Text>
                      <Text style={styles.requiredStar}>*</Text>
                    </View>
                    <TextInput
                      style={[
                        styles.input,
                        errors.otherGender ? styles.inputError : null,
                      ]}
                      placeholder="Como você se identifica?"
                      placeholderTextColor="#64748b"
                      value={otherGender}
                      onChangeText={(text) => {
                        setOtherGender(text);
                        if (errors.otherGender) {
                          setErrors((prev) => ({ ...prev, otherGender: null }));
                        }
                      }}
                      autoCapitalize="words"
                    />
                    {errors.otherGender ? (
                      <Text style={styles.errorText}>{errors.otherGender}</Text>
                    ) : null}
                  </View>
                )}
              </View>

              {/* CAMPO 3 — ESCOLARIDADE */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.questionLabel}>
                    Qual o nível mais alto de ensino que você cursa ou já cursou?
                  </Text>
                  <Text style={styles.requiredStar}>*</Text>
                </View>

                <View style={styles.optionsList}>
                  {EDUCATION_OPTIONS.map((option) => {
                    const isSelected = education === option;
                    return (
                      <Pressable
                        key={option}
                        style={[
                          styles.optionCard,
                          isSelected ? styles.optionCardSelected : null,
                          errors.education ? styles.optionCardError : null,
                        ]}
                        onPress={() => handleSelectEducation(option)}
                      >
                        <View style={styles.optionRadioOuter}>
                          {isSelected && <View style={styles.optionRadioInner} />}
                        </View>
                        <Text
                          style={[
                            styles.optionText,
                            isSelected ? styles.optionTextSelected : null,
                          ]}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {errors.education ? (
                  <Text style={styles.errorText}>{errors.education}</Text>
                ) : null}
              </View>

              {/* BOTÃO DE AVANÇO */}
              <Pressable
                style={styles.primaryButton}
                onPress={handleAdvanceStep1}
              >
                <Text style={styles.primaryButtonText}>Avançar para a próxima etapa</Text>
              </Pressable>
            </View>
          )}

          {/* ================================================================= */}
          {/* ETAPA 2 (PROVISÓRIA) — SEUS JOGOS */}
          {/* ================================================================= */}
          {currentStepIndex === 1 && (
            <View style={styles.provisionalContainer}>
              <View style={styles.provisionalBadge}>
                <Text style={styles.provisionalBadgeText}>ETAPA PROVISÓRIA</Text>
              </View>

              <Text style={styles.provisionalTitle}>
                Etapa 2 — Seus jogos
              </Text>
              <Text style={styles.provisionalDescription}>
                Você está na Etapa 2 do questionário. A busca, seleção múltipla e inclusão manual de jogos serão implementadas na Task 4.
              </Text>

              {/* Resumo visual dos dados preservados da Etapa 1 */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Dados preservados da Etapa 1:</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Idade:</Text>
                  <Text style={styles.summaryValue}>{questionnaireData.age || age} anos</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Gênero:</Text>
                  <Text style={styles.summaryValue}>
                    {gender === 'Outro' && otherGender ? `Outro (${otherGender})` : gender}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Escolaridade:</Text>
                  <Text style={styles.summaryValue}>{questionnaireData.education || education}</Text>
                </View>
              </View>

              {/* Estrutura prevista para a Task 4 */}
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderCardTitle}>Jogos Selecionados (Estrutura Local)</Text>
                <Text style={styles.placeholderCardSubtitle}>
                  Lista em memória: {questionnaireData.selectedGames.length} jogos selecionados
                </Text>
              </View>

              <View style={styles.provisionalActions}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={handleAdvanceStep2}
                >
                  <Text style={styles.primaryButtonText}>Avançar para a Etapa 3</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={handleBack}
                >
                  <Text style={styles.secondaryButtonText}>← Voltar para Etapa 1</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ================================================================= */}
          {/* ETAPA 3 (PROVISÓRIA) — MERCADO DE GAMES */}
          {/* ================================================================= */}
          {currentStepIndex === 2 && (
            <View style={styles.provisionalContainer}>
              <View style={styles.provisionalBadge}>
                <Text style={styles.provisionalBadgeText}>ETAPA PROVISÓRIA</Text>
              </View>

              <Text style={styles.provisionalTitle}>
                Etapa 3 — Mercado de games
              </Text>
              <Text style={styles.provisionalDescription}>
                Você está na Etapa 3 do questionário. As perguntas obrigatórias sobre conhecimento e interesse no mercado profissional de games serão implementadas na Task 5.
              </Text>

              <View style={styles.infoBox}>
                <Text style={styles.infoBoxText}>
                  Esta finalização é uma simulação de navegação. Não registra o perfil como definitivamente completo nem salva dados permanentemente.
                </Text>
              </View>

              <View style={styles.provisionalActions}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={handleFinishQuestionnaire}
                >
                  <Text style={styles.primaryButtonText}>Concluir questionário e ir para o Início</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={handleBack}
                >
                  <Text style={styles.secondaryButtonText}>← Voltar para Etapa 2</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a17',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#191330',
    borderWidth: 1,
    borderColor: '#34265a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  headerStepBadge: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  headerPlaceholder: {
    width: 40,
  },
  progressContainer: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#191330',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: 3,
  },
  stepsSegments: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  segmentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  segmentDotActive: {
    backgroundColor: '#a78bfa',
  },
  segmentDotInactive: {
    backgroundColor: '#2a2046',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  tag: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  questionLabel: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    flex: 1,
  },
  requiredStar: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    color: '#ffffff',
    fontSize: 15,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  optionsList: {
    gap: 10,
    marginTop: 4,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  optionCardSelected: {
    backgroundColor: '#1f1638',
    borderColor: '#7c3aed',
    borderWidth: 1.5,
  },
  optionCardError: {
    borderColor: '#ef4444',
  },
  optionRadioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#64748b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#a78bfa',
  },
  optionText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  optionTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  conditionalInputContainer: {
    marginTop: 10,
    paddingLeft: 4,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#191330',
    borderWidth: 1,
    borderColor: '#34265a',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e2d9f3',
    fontSize: 15,
    fontWeight: '700',
  },
  provisionalContainer: {
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
  },
  provisionalBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#261b47',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  provisionalBadgeText: {
    color: '#c084fc',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  provisionalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  provisionalDescription: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  summaryCard: {
    backgroundColor: '#0c0a17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2046',
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  summaryTitle: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#64748b',
    fontSize: 14,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  placeholderCard: {
    backgroundColor: '#0c0a17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2046',
    padding: 14,
    marginBottom: 20,
    gap: 4,
  },
  placeholderCardTitle: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
  },
  placeholderCardSubtitle: {
    color: '#64748b',
    fontSize: 12,
  },
  infoBox: {
    backgroundColor: '#191330',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#34265a',
    padding: 14,
    marginBottom: 20,
  },
  infoBoxText: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  provisionalActions: {
    gap: 12,
  },
});
