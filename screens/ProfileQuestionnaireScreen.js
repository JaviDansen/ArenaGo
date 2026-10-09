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

import { mockGames } from '../data/mockData';
import {
  validateAboutYouStep,
  validateGamesMarketStep,
  validateYourGamesStep,
} from '../utils/validation';

// =============================================================================
// DEFINIÇÃO DAS ETAPAS DO QUESTIONÁRIO
// 1. Sobre você (funcional — Task 3)
// 2. Seus jogos (funcional — Task 4)
// 3. Mercado de games (funcional — Task 5)
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
    subtitle: 'Informe quais jogos você costuma jogar para personalizarmos sua experiência.',
  },
  {
    id: 'games-market',
    stepNumber: 3,
    tag: 'ETAPA 3 DE 3',
    title: 'Mercado de games',
    subtitle: 'Informe seu conhecimento e interesse no mercado profissional de games.',
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

export const MARKET_KNOWLEDGE_OPTIONS = [
  'Sim, conheço.',
  'Conheço um pouco.',
  'Não conheço.',
];

export const MARKET_INTEREST_OPTIONS = [
  'Sim, tenho interesse.',
  'Talvez — quero conhecer melhor.',
  'Não tenho interesse.',
];

// Estrutura de dados local compartilhada por todas as etapas do questionário
const INITIAL_QUESTIONNAIRE_DATA = {
  // Etapa 1 — Sobre você (Task 3)
  age: '',
  gender: '',
  otherGender: null,
  education: '',

  // Etapa 2 — Seus jogos (Task 4)
  selectedGames: [],

  // Etapa 3 — Mercado de games (Task 5)
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

  // Estados dos campos da Etapa 2 — Seus jogos
  const [searchQuery, setSearchQuery] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState(null);

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

  // Atualização do texto da busca de jogos
  function handleSearchChange(text) {
    setSearchQuery(text);
    if (feedbackMessage) {
      setFeedbackMessage(null);
    }
  }

  // Adiciona um jogo à lista de selecionados (via sugestão ou inclusão manual)
  function handleAddGame(gameName) {
    if (!gameName) return;
    const trimmed = gameName.trim();
    if (!trimmed) return;

    // Prevenção de duplicações: normaliza espaços e compara sem distinção de maiúsculas/minúsculas
    const isAlreadySelected = (questionnaireData.selectedGames || []).some(
      (g) => g.trim().toLowerCase() === trimmed.toLowerCase()
    );

    if (isAlreadySelected) {
      setFeedbackMessage({
        type: 'warning',
        text: `"${trimmed}" já está na lista de jogos selecionados.`,
      });
      return;
    }

    setQuestionnaireData((prev) => {
      // Revalida no estado mais recente para impedir duplicações em atualizações agrupadas.
      const alreadySelected = prev.selectedGames.some(
        (g) => g.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (alreadySelected) return prev;

      return {
        ...prev,
        selectedGames: [...prev.selectedGames, trimmed],
      };
    });

    setSearchQuery('');
    setFeedbackMessage({
      type: 'success',
      text: `"${trimmed}" adicionado aos seus jogos.`,
    });

    if (errors.selectedGames) {
      setErrors((prev) => ({ ...prev, selectedGames: null }));
    }
  }

  // Remove um jogo da lista de selecionados (permitindo selecioná-lo novamente)
  function handleRemoveGame(gameToRemove) {
    setQuestionnaireData((prev) => ({
      ...prev,
      selectedGames: (prev.selectedGames || []).filter(
        (g) => g.trim().toLowerCase() !== gameToRemove.trim().toLowerCase()
      ),
    }));

    setFeedbackMessage(null);
  }

  // Validação e avanço da Etapa 2 para a Etapa 3
  function handleAdvanceStep2() {
    const validation = validateYourGamesStep({
      selectedGames: questionnaireData.selectedGames,
    });

    if (!validation.isValid) {
      setErrors((prev) => ({ ...prev, ...validation.errors }));
      return;
    }

    setErrors({});
    setFeedbackMessage(null);
    setCurrentStepIndex(2);
  }

  // Seleção única de conhecimento sobre o mercado de games (Etapa 3)
  function handleSelectMarketKnowledge(option) {
    setQuestionnaireData((prev) => ({
      ...prev,
      marketKnowledge: option,
    }));
    if (errors.marketKnowledge) {
      setErrors((prev) => ({ ...prev, marketKnowledge: null }));
    }
  }

  // Seleção única de interesse no mercado profissional de games (Etapa 3)
  function handleSelectMarketInterest(option) {
    setQuestionnaireData((prev) => ({
      ...prev,
      marketInterest: option,
    }));
    if (errors.marketInterest) {
      setErrors((prev) => ({ ...prev, marketInterest: null }));
    }
  }

  // Validação e conclusão do questionário (Etapa 3)
  function handleFinishQuestionnaire() {
    // 1. Validar as respostas da Etapa 3
    const validation = validateGamesMarketStep({
      marketKnowledge: questionnaireData.marketKnowledge,
      marketInterest: questionnaireData.marketInterest,
    });

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});

    // 2. Manter a consistência dos dados reunidos em questionnaireData
    const resolvedOtherGender = gender === 'Outro' ? (otherGender ? otherGender.trim() : null) : null;
    const finalData = {
      ...questionnaireData,
      age: age.trim(),
      gender,
      otherGender: resolvedOtherGender,
      education,
      selectedGames: questionnaireData.selectedGames || [],
      marketKnowledge: questionnaireData.marketKnowledge,
      marketInterest: questionnaireData.marketInterest,
    };

    setQuestionnaireData(finalData);

    // 3. Executar a finalização do questionário
    // 4. Direcionar o participante ao MainTabs, abrindo a aba Início com o HomeFlowScreen existente
    if (navigation.reset) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    } else {
      navigation.replace('MainTabs');
    }
  }

  const trimmedSearch = searchQuery.trim().toLowerCase();
  const filteredSuggestions = trimmedSearch
    ? mockGames.filter((game) => game.toLowerCase().includes(trimmedSearch))
    : [];
  const exactMatchExists = trimmedSearch
    ? mockGames.some((game) => game.toLowerCase() === trimmedSearch)
    : false;

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
          {/* ETAPA 2 — SEUS JOGOS (TASK 4) */}
          {/* ================================================================= */}
          {currentStepIndex === 1 && (
            <View style={styles.form}>
              {/* CAMPO DE PESQUISA */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Pesquisar jogos</Text>
                  <Text style={styles.requiredStar}>*</Text>
                </View>
                <View style={styles.searchRow}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Ex: Minecraft, Valorant..."
                    placeholderTextColor="#64748b"
                    value={searchQuery}
                    onChangeText={handleSearchChange}
                    onSubmitEditing={() => {
                      if (searchQuery.trim()) {
                        handleAddGame(searchQuery);
                      }
                    }}
                    returnKeyType="done"
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                  {searchQuery.trim().length > 0 ? (
                    <Pressable
                      style={styles.searchAddButton}
                      onPress={() => handleAddGame(searchQuery)}
                      accessibilityLabel={`Adicionar ${searchQuery.trim()}`}
                    >
                      <Text style={styles.searchAddButtonText}>Adicionar</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {/* MENSAGEM DE FEEDBACK (AVISO OU SUCESSO) */}
              {feedbackMessage ? (
                <View
                  style={[
                    styles.feedbackBanner,
                    feedbackMessage.type === 'warning'
                      ? styles.feedbackBannerWarning
                      : styles.feedbackBannerSuccess,
                  ]}
                >
                  <Text
                    style={[
                      styles.feedbackText,
                      feedbackMessage.type === 'warning'
                        ? styles.feedbackTextWarning
                        : styles.feedbackTextSuccess,
                    ]}
                  >
                    {feedbackMessage.text}
                  </Text>
                </View>
              ) : null}

              {/* SUGESTÕES FILTRADAS PELA BUSCA OU POPULARES */}
              {searchQuery.trim().length > 0 ? (
                filteredSuggestions.length > 0 ? (
                  <View style={styles.suggestionsCard}>
                    <Text style={styles.suggestionsHeader}>SUGESTÕES DE JOGOS</Text>
                    <View style={styles.suggestionsList}>
                      {filteredSuggestions.map((game) => {
                        const isSelected = questionnaireData.selectedGames.some(
                          (g) => g.trim().toLowerCase() === game.trim().toLowerCase()
                        );
                        return (
                          <Pressable
                            key={game}
                            style={[
                              styles.suggestionItem,
                              isSelected ? styles.suggestionItemSelected : null,
                            ]}
                            onPress={() => handleAddGame(game)}
                            disabled={isSelected}
                            accessibilityLabel={`Selecionar ${game}`}
                          >
                            <Text
                              style={[
                                styles.suggestionGameName,
                                isSelected ? styles.suggestionGameNameSelected : null,
                              ]}
                            >
                              {game}
                            </Text>
                            <View
                              style={[
                                styles.suggestionBadge,
                                isSelected ? styles.suggestionBadgeSelected : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.suggestionBadgeText,
                                  isSelected ? styles.suggestionBadgeTextSelected : null,
                                ]}
                              >
                                {isSelected ? '✓ Selecionado' : '+ Selecionar'}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* INCLUSÃO MANUAL QUANDO NÃO HÁ CORRESPONDÊNCIA EXATA */}
                    {!exactMatchExists && (
                      <Pressable
                        style={styles.manualAddInlineButton}
                        onPress={() => handleAddGame(searchQuery)}
                        accessibilityLabel={`Adicionar ${searchQuery.trim()}`}
                      >
                        <Text style={styles.manualAddInlineText}>
                          + Adicionar "{searchQuery.trim()}"
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <View style={styles.noSuggestionsCard}>
                    <Text style={styles.noSuggestionsText}>
                      Nenhum jogo correspondente encontrado no catálogo para "{searchQuery.trim()}".
                    </Text>
                    <Pressable
                      style={styles.manualAddPrimaryButton}
                      onPress={() => handleAddGame(searchQuery)}
                      accessibilityLabel={`Adicionar ${searchQuery.trim()}`}
                    >
                      <Text style={styles.manualAddPrimaryButtonText}>
                        + Adicionar "{searchQuery.trim()}"
                      </Text>
                    </Pressable>
                  </View>
                )
              ) : (
                <View style={styles.quickSuggestionsCard}>
                  <Text style={styles.quickSuggestionsHeader}>Sugestões populares:</Text>
                  <View style={styles.quickChipsWrapper}>
                    {mockGames.slice(0, 8).map((game) => {
                      const isSelected = questionnaireData.selectedGames.some(
                        (g) => g.trim().toLowerCase() === game.trim().toLowerCase()
                      );
                      return (
                        <Pressable
                          key={game}
                          style={[
                            styles.quickChip,
                            isSelected ? styles.quickChipSelected : null,
                          ]}
                          onPress={() => handleAddGame(game)}
                          disabled={isSelected}
                        >
                          <Text
                            style={[
                              styles.quickChipText,
                              isSelected ? styles.quickChipTextSelected : null,
                            ]}
                          >
                            {isSelected ? `✓ ${game}` : `+ ${game}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* LISTA DE JOGOS SELECIONADOS */}
              <View style={styles.selectedSection}>
                <View style={styles.selectedHeaderRow}>
                  <Text style={styles.selectedSectionTitle}>Jogos selecionados</Text>
                  <View style={styles.counterBadge}>
                    <Text style={styles.counterBadgeText}>
                      {questionnaireData.selectedGames.length}
                    </Text>
                  </View>
                </View>

                {questionnaireData.selectedGames.length === 0 ? (
                  <View style={styles.emptySelectedCard}>
                    <Text style={styles.emptySelectedIcon}>🎮</Text>
                    <Text style={styles.emptySelectedTitle}>Nenhum jogo selecionado ainda</Text>
                    <Text style={styles.emptySelectedSubtitle}>
                      Busque acima ou toque em uma sugestão para adicionar à sua lista.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.selectedList}>
                    {questionnaireData.selectedGames.map((game, index) => (
                      <View key={`${game}-${index}`} style={styles.selectedGameCard}>
                        <View style={styles.selectedGameContent}>
                          <Text style={styles.gameIconBullet}>🎮</Text>
                          <Text style={styles.selectedGameName}>{game}</Text>
                        </View>
                        <Pressable
                          style={styles.removeGameButton}
                          onPress={() => handleRemoveGame(game)}
                          hitSlop={8}
                          accessibilityLabel={`Remover ${game}`}
                        >
                          <Text style={styles.removeGameButtonText}>✕</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                {/* MENSAGEM DE ERRO DE VALIDAÇÃO (CASO TENTE AVANÇAR SEM JOGOS) */}
                {errors.selectedGames ? (
                  <View style={styles.stepErrorContainer}>
                    <Text style={styles.errorText}>{errors.selectedGames}</Text>
                  </View>
                ) : null}
              </View>

              {/* BOTÕES DE AVANÇO E VOLTA */}
              <View style={styles.actionsContainer}>
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
          {/* ETAPA 3 — MERCADO DE GAMES (TASK 5) */}
          {/* ================================================================= */}
          {currentStepIndex === 2 && (
            <View style={styles.form}>
              {/* PERGUNTA 1 — CONHECIMENTO SOBRE O MERCADO DE GAMES */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.questionLabel}>
                    Você já conhece o mercado de games?
                  </Text>
                  <Text style={styles.requiredStar}>*</Text>
                </View>

                <View style={styles.optionsList}>
                  {MARKET_KNOWLEDGE_OPTIONS.map((option) => {
                    const isSelected = questionnaireData.marketKnowledge === option;
                    return (
                      <Pressable
                        key={option}
                        style={[
                          styles.optionCard,
                          isSelected ? styles.optionCardSelected : null,
                          errors.marketKnowledge ? styles.optionCardError : null,
                        ]}
                        onPress={() => handleSelectMarketKnowledge(option)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
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
                {errors.marketKnowledge ? (
                  <Text style={styles.errorText}>{errors.marketKnowledge}</Text>
                ) : null}
              </View>

              {/* PERGUNTA 2 — INTERESSE NO MERCADO PROFISSIONAL DE GAMES */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.questionLabel}>
                    Você tem interesse no mercado profissional de games?
                  </Text>
                  <Text style={styles.requiredStar}>*</Text>
                </View>

                <View style={styles.optionsList}>
                  {MARKET_INTEREST_OPTIONS.map((option) => {
                    const isSelected = questionnaireData.marketInterest === option;
                    return (
                      <Pressable
                        key={option}
                        style={[
                          styles.optionCard,
                          isSelected ? styles.optionCardSelected : null,
                          errors.marketInterest ? styles.optionCardError : null,
                        ]}
                        onPress={() => handleSelectMarketInterest(option)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
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
                {errors.marketInterest ? (
                  <Text style={styles.errorText}>{errors.marketInterest}</Text>
                ) : null}
              </View>

              {/* BOTÕES DE CONCLUSÃO E RETORNO */}
              <View style={styles.actionsContainer}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={handleFinishQuestionnaire}
                  accessibilityLabel="Concluir questionário"
                >
                  <Text style={styles.primaryButtonText}>Concluir</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={handleBack}
                  accessibilityLabel="Voltar para Etapa 2"
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

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    color: '#ffffff',
    fontSize: 15,
  },
  searchAddButton: {
    backgroundColor: '#261b47',
    borderWidth: 1,
    borderColor: '#7c3aed',
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchAddButtonText: {
    color: '#c084fc',
    fontSize: 14,
    fontWeight: '700',
  },
  feedbackBanner: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  feedbackBannerWarning: {
    backgroundColor: '#2a1a12',
    borderColor: '#f59e0b',
  },
  feedbackBannerSuccess: {
    backgroundColor: '#0f241a',
    borderColor: '#10b981',
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackTextWarning: {
    color: '#fbbf24',
  },
  feedbackTextSuccess: {
    color: '#34d399',
  },
  suggestionsCard: {
    backgroundColor: '#141026',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2046',
    padding: 12,
    gap: 8,
  },
  suggestionsHeader: {
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  suggestionsList: {
    gap: 6,
  },
  suggestionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0c0a17',
    borderWidth: 1,
    borderColor: '#22193b',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestionItemSelected: {
    backgroundColor: '#18122c',
    borderColor: '#382561',
    opacity: 0.7,
  },
  suggestionGameName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  suggestionGameNameSelected: {
    color: '#94a3b8',
  },
  suggestionBadge: {
    backgroundColor: '#261b47',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  suggestionBadgeSelected: {
    backgroundColor: '#1b1433',
  },
  suggestionBadgeText: {
    color: '#c084fc',
    fontSize: 12,
    fontWeight: '700',
  },
  suggestionBadgeTextSelected: {
    color: '#64748b',
  },
  manualAddInlineButton: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#1f1638',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7c3aed',
    alignItems: 'center',
  },
  manualAddInlineText: {
    color: '#c084fc',
    fontSize: 13,
    fontWeight: '700',
  },
  noSuggestionsCard: {
    backgroundColor: '#141026',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2046',
    padding: 16,
    alignItems: 'center',
    gap: 12,
  },
  noSuggestionsText: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  manualAddPrimaryButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  manualAddPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  quickSuggestionsCard: {
    gap: 8,
  },
  quickSuggestionsHeader: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  quickChipsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickChipSelected: {
    backgroundColor: '#1e153b',
    borderColor: '#4c2889',
    opacity: 0.6,
  },
  quickChipText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  quickChipTextSelected: {
    color: '#8b5cf6',
  },
  selectedSection: {
    gap: 10,
    marginTop: 4,
  },
  selectedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedSectionTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  counterBadge: {
    backgroundColor: '#261b47',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
  },
  counterBadgeText: {
    color: '#c084fc',
    fontSize: 12,
    fontWeight: '800',
  },
  emptySelectedCard: {
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptySelectedIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  emptySelectedTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
  },
  emptySelectedSubtitle: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  selectedList: {
    gap: 8,
  },
  selectedGameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectedGameContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  gameIconBullet: {
    fontSize: 16,
  },
  selectedGameName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  removeGameButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#25152a',
    borderWidth: 1,
    borderColor: '#5c1d35',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeGameButtonText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '800',
  },
  stepErrorContainer: {
    backgroundColor: '#291118',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  actionsContainer: {
    gap: 12,
    marginTop: 8,
  },
});
