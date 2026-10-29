const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, textOf } = require('./helpers/questionnaireHarness.cjs');

test('theme exports official tokens matching Figma BEAST specifications', () => {
  const colorsModule = loadModule('theme/colors.js', require).exports;
  const typographyModule = loadModule('theme/typography.js', require).exports;
  const spacingModule = loadModule('theme/spacing.js', require).exports;
  const radiiModule = loadModule('theme/radii.js', require).exports;

  const colors = colorsModule.colors || colorsModule.default;
  const typography = typographyModule.typography || typographyModule.default;
  const spacing = spacingModule.spacing || spacingModule.default;
  const radii = radiiModule.radii || radiiModule.default;

  // Cores oficiais
  assert.equal(colors.brand.primary, '#5F33FA');
  assert.equal(colors.background.base, '#0B0B12');
  assert.equal(colors.background.surface, '#161626');
  assert.equal(colors.background.elevated, '#1F1F35');
  assert.equal(colors.text.primary, '#FFFFFF');
  assert.equal(colors.text.secondary, '#A0A0B8');
  assert.equal(colors.semantic.success, '#00E676');
  assert.equal(colors.semantic.danger, '#E11D48');

  // Tipografia
  assert.equal(typography.hero.fontSize, 28);
  assert.equal(typography.titleLarge.fontSize, 24);
  assert.equal(typography.button.fontSize, 16);
  assert.equal(typography.tag.letterSpacing, 1.2);

  // Espaçamentos e Dimensões responsivas
  assert.equal(spacing.xs, 4);
  assert.equal(spacing.sm, 8);
  assert.equal(spacing.md, 12);
  assert.equal(spacing.lg, 16);
  assert.equal(spacing.xl, 20);
  assert.equal(spacing.layout.buttonHeight, 52);
  assert.equal(spacing.layout.inputHeight, 52);

  // Raios
  assert.equal(radii.lg, 12);
  assert.equal(radii.xl, 18);
  assert.equal(radii.pill, 9999);
});

test('Button renders variants, labels, and handles press and loading states', () => {
  let pressed = false;
  const h = createHarness('components/ui/Button.js', {
    props: {
      title: 'Cadastrar',
      variant: 'primary',
      onPress: () => { pressed = true; },
    },
  });

  const button = h.nodes.find((n) => n.type === 'Pressable');
  assert.ok(button, 'Button Pressable must exist');
  assert.equal(textOf(button), 'Cadastrar');

  // Trigger press
  h.act(() => h.press('Cadastrar'));
  assert.equal(pressed, true, 'onPress must be triggered');

  // Test loading state
  let loadingPressed = false;
  const hLoading = createHarness('components/ui/Button.js', {
    props: {
      title: 'Salvando',
      loading: true,
      onPress: () => { loadingPressed = true; },
    },
  });
  const spinner = hLoading.nodes.find((n) => n.type === 'ActivityIndicator');
  assert.ok(spinner, 'Spinner must be rendered during loading state');
  const loadingPressable = hLoading.nodes.find((n) => n.type === 'Pressable');
  assert.equal(loadingPressable.props.onPress, undefined, 'onPress must be disabled during loading');
});

test('InputField renders label, value, calls onChangeText and presents error', () => {
  let updatedText = '';
  const h = createHarness('components/ui/InputField.js', {
    props: {
      label: 'E-mail',
      required: true,
      value: 'test@example.com',
      placeholder: 'Digite seu e-mail',
      onChangeText: (text) => { updatedText = text; },
    },
  });

  const input = h.nodes.find((n) => n.type === 'TextInput');
  assert.ok(input, 'TextInput must be rendered');
  assert.equal(input.props.value, 'test@example.com');
  assert.equal(input.props.placeholder, 'Digite seu e-mail');

  h.act(() => input.props.onChangeText('novo@arena.com'));
  assert.equal(updatedText, 'novo@arena.com');

  // Test error presentation
  const hError = createHarness('components/ui/InputField.js', {
    props: {
      label: 'Senha',
      error: 'A senha é obrigatória',
      value: '',
    },
  });
  const errorAlert = hError.nodes.find((n) => n.type === 'Text' && n.props.accessibilityRole === 'alert');
  assert.ok(errorAlert, 'Error message with accessibilityRole="alert" must be rendered');
  assert.equal(textOf(errorAlert), 'A senha é obrigatória');
});

test('Card renders content and supports clickable variant', () => {
  // Passive card
  const hPassive = createHarness('components/ui/Card.js', {
    props: {
      variant: 'default',
    },
  });
  const cardView = hPassive.nodes.find((n) => n.type === 'View');
  assert.ok(cardView, 'Passive card renders as View');

  // Clickable card
  let clicked = false;
  const hClickable = createHarness('components/ui/Card.js', {
    props: {
      variant: 'highlight',
      onPress: () => { clicked = true; },
    },
  });
  const cardPressable = hClickable.nodes.find((n) => n.type === 'Pressable');
  assert.ok(cardPressable, 'Clickable card renders as Pressable');
  hClickable.act(() => cardPressable.props.onPress());
  assert.equal(clicked, true);
});

test('Badge renders label', () => {
  const h = createHarness('components/ui/Badge.js', {
    props: {
      label: 'ATIVO',
      variant: 'success',
    },
  });

  const badgeText = h.nodes.find((n) => n.type === 'Text' && textOf(n) === 'ATIVO');
  assert.ok(badgeText, 'Badge label must be rendered');
});

test('TagChip handles selection and onRemove callback', () => {
  let removed = false;
  let clicked = false;
  const h = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Fortnite',
      selected: true,
      onPress: () => { clicked = true; },
      onRemove: () => { removed = true; },
    },
  });

  const chipText = h.nodes.find((n) => n.type === 'Text' && textOf(n) === 'Fortnite');
  assert.ok(chipText, 'TagChip label rendered');

  const removeButton = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Fortnite');
  assert.ok(removeButton, 'Remove button rendered');
  h.act(() => removeButton.props.onPress());
  assert.equal(removed, true, 'onRemove callback triggered');
});

test('StepperIndicator renders total steps and step title', () => {
  const h = createHarness('components/ui/StepperIndicator.js', {
    props: {
      totalSteps: 3,
      currentStep: 2,
      title: 'Seus jogos',
      subtitle: 'Informe seus jogos favoritos',
    },
  });

  const tag = h.nodes.find((n) => n.type === 'Text' && textOf(n).includes('ETAPA 2 DE 3'));
  assert.ok(tag, 'Step tag rendered');

  const title = h.nodes.find((n) => n.type === 'Text' && textOf(n) === 'Seus jogos');
  assert.ok(title, 'Title rendered');
});

test('ScreenHeader renders back button and triggers onBack', () => {
  let backTriggered = false;
  const h = createHarness('components/ui/ScreenHeader.js', {
    props: {
      title: 'Meu Perfil',
      onBack: () => { backTriggered = true; },
    },
  });

  const title = h.nodes.find((n) => n.type === 'Text' && textOf(n) === 'Meu Perfil');
  assert.ok(title, 'Header title rendered');

  const backButton = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Voltar');
  assert.ok(backButton, 'Back button rendered');
  h.act(() => backButton.props.onPress());
  assert.equal(backTriggered, true, 'onBack triggered');
});
