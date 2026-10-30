/**
 * Suíte de Testes Unitários — Fundação do Design System (UI-01: C05 a C09)
 *
 * Escopo e Limitações (C08):
 * - Estes testes verificam em ambiente Node a árvore de elementos React, os contratos de props,
 *   a proteção de estilos (minWidth/minHeight >= 48dp), a independência de handlers sem mutação
 *   de eventos e os atributos de acessibilidade declarados nos componentes.
 * - Estes testes unitários NÃO substituem o cálculo nativo de layout Yoga, o hit-testing nativo
 *   do iOS/Android nem a homologação com leitores de tela reais (VoiceOver / TalkBack) em
 *   dispositivo físico.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, loadModule, nodes: collectNodes, textOf } = require('./helpers/questionnaireHarness.cjs');

function flattenStyle(styleProp) {
  if (!styleProp) return {};
  if (Array.isArray(styleProp)) {
    return Object.assign({}, ...styleProp.map(flattenStyle));
  }
  if (typeof styleProp === 'object') {
    return { ...styleProp };
  }
  return {};
}

test('theme exports official tokens matching Figma BEAST specifications', () => {
  const colorsModule = loadModule('theme/colors.js', require).exports;
  const typographyModule = loadModule('theme/typography.js', require).exports;
  const spacingModule = loadModule('theme/spacing.js', require).exports;
  const radiiModule = loadModule('theme/radii.js', require).exports;
  const indexModule = loadModule('theme/index.js', (id) => {
    if (id.startsWith('./')) return loadModule(`theme/${id.slice(2)}`, require).exports;
    return require(id);
  }).exports;

  const colors = colorsModule.colors || colorsModule.default;
  const typography = typographyModule.typography || typographyModule.default;
  const spacing = spacingModule.spacing || spacingModule.default;
  const radii = radiiModule.radii || radiiModule.default;

  assert.equal(colors.brand.primary, '#5F33FA');
  assert.equal(colors.background.base, '#0B0B12');
  assert.equal(colors.background.surface, '#161626');
  assert.equal(colors.background.elevated, '#1F1F35');
  assert.equal(colors.text.primary, '#FFFFFF');
  assert.equal(colors.text.secondary, '#A0A0B8');
  assert.equal(colors.semantic.success, '#00E676');
  assert.equal(colors.semantic.danger, '#E11D48');

  assert.equal(typography.hero.fontSize, 28);
  assert.equal(typography.titleLarge.fontSize, 24);
  assert.equal(typography.button.fontSize, 16);
  assert.equal(typography.tag.letterSpacing, 1.2);

  assert.equal(spacing.xs, 4);
  assert.equal(spacing.sm, 8);
  assert.equal(spacing.md, 12);
  assert.equal(spacing.lg, 16);
  assert.equal(spacing.xl, 20);
  assert.equal(spacing.layout.buttonHeight, 52);
  assert.equal(spacing.layout.inputHeight, 52);

  assert.equal(radii.lg, 12);
  assert.equal(radii.xl, 18);
  assert.equal(radii.pill, 9999);

  assert.ok(indexModule.theme.colors);
  assert.ok(indexModule.theme.typography);
  assert.ok(indexModule.theme.spacing);
  assert.ok(indexModule.theme.radii);
});

test('C05: TagChip defines >= 48x48dp directly on each sibling Pressable without overlap while separating compact visual decoration', () => {
  const hChip = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Valorant',
      selected: true,
      onPress: () => {},
      onRemove: () => {},
      testID: 'chip-valorant',
    },
  });

  // 1. Verify each interactive Pressable has its own >= 48x48dp style (not relying on hitSlop or outer View)
  const selectPressable = hChip.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox'
  );
  const removePressable = hChip.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Valorant'
  );
  assert.ok(selectPressable, 'Selection Pressable exists');
  assert.ok(removePressable, 'Removal Pressable exists');

  const selectStyle = flattenStyle(selectPressable.props.style({ pressed: false }));
  const removeStyle = flattenStyle(removePressable.props.style({ pressed: false }));

  assert.ok(selectStyle.minWidth >= 48, 'Selection Pressable itself has minWidth >= 48dp');
  assert.ok(selectStyle.minHeight >= 48, 'Selection Pressable itself has minHeight >= 48dp');
  assert.equal(selectPressable.props.hitSlop, undefined, 'Selection Pressable does not rely on overlapping hitSlop');

  assert.ok(removeStyle.minWidth >= 48, 'Removal Pressable itself has minWidth >= 48dp');
  assert.ok(removeStyle.minHeight >= 48, 'Removal Pressable itself has minHeight >= 48dp');
  assert.equal(removePressable.props.hitSlop, undefined, 'Removal Pressable does not rely on overlapping hitSlop');

  // 2. Verify no negative margins or overlapping styles between sibling Pressables
  assert.ok(!(selectStyle.marginRight < 0), 'No negative right margin on select Pressable');
  assert.ok(!(removeStyle.marginLeft < 0), 'No negative left margin on remove Pressable');

  // 3. Verify compact visual decoration (36dp pill surface and 20x20dp remove badge) is decoupled with pointerEvents="none"
  const pillSurface = hChip.nodes.find(
    (n) => n.type === 'View' && n.props.testID === 'chip-valorant-surface'
  );
  const removeBadge = hChip.nodes.find(
    (n) => n.type === 'View' && n.props.testID === 'chip-valorant-remove-badge'
  );
  assert.ok(pillSurface, 'Decorative pill surface View exists');
  assert.equal(pillSurface.props.pointerEvents, 'none');
  const pillSurfaceStyle = flattenStyle(pillSurface.props.style);
  assert.equal(pillSurfaceStyle.minHeight, 36, 'Visual pill preserves compact 36dp minimum height');
  assert.equal(pillSurfaceStyle.top, 6);
  assert.equal(pillSurfaceStyle.bottom, 6);

  assert.ok(removeBadge, 'Decorative remove badge View exists');
  assert.equal(removeBadge.props.pointerEvents, 'none');
  const removeBadgeStyle = flattenStyle(removeBadge.props.style);
  assert.equal(removeBadgeStyle.width, 20, 'Visual remove circle preserves 20dp width');
  assert.equal(removeBadgeStyle.height, 20, 'Visual remove circle preserves 20dp height');
});

test('C05: Button, clickable Card and ScreenHeader back control define >= 48x48dp directly on their Pressables', () => {
  for (const size of ['sm', 'md', 'lg']) {
    const hBtn = createHarness('components/ui/Button.js', {
      props: { title: `Botão ${size}`, size, fullWidth: false, onPress: () => {} },
    });
    const btnPressable = hBtn.nodes.find((n) => n.type === 'Pressable');
    const btnStyle = flattenStyle(btnPressable.props.style({ pressed: false }));

    assert.ok(btnStyle.minWidth >= 48, `Button (${size}) Pressable has minWidth >= 48dp`);
    assert.ok(btnStyle.minHeight >= 48, `Button (${size}) Pressable has minHeight >= 48dp`);
    assert.equal(btnStyle.height, undefined, `Button (${size}) avoids fixed height to prevent clipping scaled text`);
  }

  const hCard = createHarness('components/ui/Card.js', {
    props: { onPress: () => {}, accessibilityLabel: 'Card interativo' },
  });
  const cardPressable = hCard.nodes.find((n) => n.type === 'Pressable');
  const cardStyle = flattenStyle(cardPressable.props.style({ pressed: false }));
  assert.ok(cardStyle.minWidth >= 48, 'Clickable Card Pressable has minWidth >= 48dp');
  assert.ok(cardStyle.minHeight >= 48, 'Clickable Card Pressable has minHeight >= 48dp');

  const hHeader = createHarness('components/ui/ScreenHeader.js', {
    props: { title: 'Perfil', onBack: () => {}, testID: 'hdr' },
  });
  const backPressable = hHeader.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Voltar'
  );
  const backStyle = flattenStyle(backPressable.props.style({ pressed: false }));
  assert.ok(backStyle.minWidth >= 48, 'ScreenHeader back Pressable has minWidth >= 48dp');
  assert.ok(backStyle.minHeight >= 48, 'ScreenHeader back Pressable has minHeight >= 48dp');

  const backCircle = hHeader.nodes.find((n) => n.type === 'View' && n.props.testID === 'hdr-back-circle');
  const backCircleStyle = flattenStyle(backCircle.props.style);
  assert.equal(backCircle.props.pointerEvents, 'none');
  assert.equal(backCircleStyle.width, 40, 'ScreenHeader visual circle preserves 40dp width');
  assert.equal(backCircleStyle.height, 40, 'ScreenHeader visual circle preserves 40dp height');
});

test('C06: TagChip has no nested Pressables, never mutates events, and supports remove->select, select->remove and repeated interactions', () => {
  const actions = [];

  const h = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Fortnite',
      selected: true,
      onPress: (label) => actions.push(`select:${label}`),
      onRemove: (label) => actions.push(`remove:${label}`),
    },
  });

  // 1. Verify absence of nested Pressables
  const allPressables = h.nodes.filter((n) => n.type === 'Pressable');
  assert.equal(allPressables.length, 2, 'Renders exactly two sibling Pressables');
  for (const pressable of allPressables) {
    const descendantPressables = collectNodes(pressable.props.children).filter((n) => n.type === 'Pressable');
    assert.equal(descendantPressables.length, 0, 'Pressable must NOT contain nested Pressable children');
  }

  const selectNode = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox');
  const removeNode = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Fortnite');

  // 2. Verify zero event mutation (frozen event object would throw if _tagChipRemoved or any property were written)
  const frozenEvent = Object.freeze({});
  h.act(() => {
    removeNode.props.onPress(frozenEvent);
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(frozenEvent, '_tagChipRemoved'),
    false,
    'Must not attach _tagChipRemoved to event'
  );
  assert.deepEqual(actions, ['remove:Fortnite']);

  // 3. Removal followed immediately by selection (using the exact same event reference) must NOT block selection
  h.act(() => {
    selectNode.props.onPress(frozenEvent);
  });
  assert.deepEqual(
    actions,
    ['remove:Fortnite', 'select:Fortnite'],
    'Removal followed by selection executes both callbacks cleanly'
  );

  // 4. Selection followed by removal
  h.act(() => {
    selectNode.props.onPress(frozenEvent);
    removeNode.props.onPress(frozenEvent);
  });
  assert.deepEqual(
    actions,
    ['remove:Fortnite', 'select:Fortnite', 'select:Fortnite', 'remove:Fortnite'],
    'Selection followed by removal executes both callbacks cleanly'
  );

  // 5. Repeated alternating and consecutive interactions via harness press helper
  h.act(() => {
    h.press('Remover Fortnite');
    h.press('Fortnite');
    h.press('Fortnite');
    h.press('Remover Fortnite');
    h.press('Fortnite');
  });
  assert.deepEqual(actions, [
    'remove:Fortnite',
    'select:Fortnite',
    'select:Fortnite',
    'remove:Fortnite',
    'remove:Fortnite',
    'select:Fortnite',
    'select:Fortnite',
    'remove:Fortnite',
    'select:Fortnite',
  ]);

  // 6. Disabled state blocks both controls
  let disabledCalls = 0;
  h.setProps({
    disabled: true,
    onPress: () => { disabledCalls += 1; },
    onRemove: () => { disabledCalls += 1; },
  });
  const disabledSelect = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox');
  const disabledRemove = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Fortnite');

  assert.equal(disabledSelect.props.disabled, true);
  assert.equal(disabledSelect.props.onPress, undefined);
  assert.equal(disabledSelect.props.accessibilityState.disabled, true);
  assert.equal(disabledRemove.props.disabled, true);
  assert.equal(disabledRemove.props.onPress, undefined);
  assert.equal(disabledRemove.props.accessibilityState.disabled, true);
  assert.equal(disabledCalls, 0);
});

test('C07: Button, Card, TagChip and ScreenHeader protect minimum 48x48dp dimensions against accidental style overrides while preserving appearance customizations', () => {
  const shrinkingOverride = {
    width: 20,
    height: 18,
    minWidth: 12,
    minHeight: 14,
    maxWidth: 24,
    maxHeight: 24,
    backgroundColor: '#123456',
    borderColor: '#ABCDEF',
    marginTop: 14,
  };

  // 1. Button with shrinking style override
  const hBtn = createHarness('components/ui/Button.js', {
    props: {
      title: 'Salvar',
      size: 'sm',
      fullWidth: false,
      style: shrinkingOverride,
      onPress: () => {},
    },
  });
  const btnPressable = hBtn.nodes.find((n) => n.type === 'Pressable');
  const btnStyle = flattenStyle(btnPressable.props.style({ pressed: false }));
  assert.ok(btnStyle.minWidth >= 48, 'Button protects minWidth >= 48 against style override');
  assert.ok(btnStyle.minHeight >= 48, 'Button protects minHeight >= 48 against style override');
  assert.ok(btnStyle.width >= 48, 'Button clamps numeric width < 48 to >= 48');
  assert.equal(btnStyle.height, undefined, 'Button removes sub-minimum fixed height so text can scale');
  assert.ok(btnStyle.maxWidth >= 48, 'Button clamps maxWidth >= 48');
  assert.ok(btnStyle.maxHeight >= 48, 'Button clamps maxHeight >= 48');
  assert.equal(btnStyle.backgroundColor, '#123456', 'Button preserves custom backgroundColor');
  assert.equal(btnStyle.borderColor, '#ABCDEF', 'Button preserves custom borderColor');
  assert.equal(btnStyle.marginTop, 14, 'Button preserves custom marginTop');

  // Button with larger legitimate dimensions preserves them
  const hBtnLarge = createHarness('components/ui/Button.js', {
    props: {
      title: 'Expandido',
      size: 'lg',
      fullWidth: false,
      style: { minWidth: 200, minHeight: 68, width: 240, height: 68 },
      onPress: () => {},
    },
  });
  const btnLargeStyle = flattenStyle(hBtnLarge.nodes.find((n) => n.type === 'Pressable').props.style({ pressed: false }));
  assert.equal(btnLargeStyle.minWidth, 200);
  assert.equal(btnLargeStyle.minHeight, 68);
  assert.equal(btnLargeStyle.width, 240);
  assert.equal(btnLargeStyle.height, 68);

  // 2. Clickable Card with shrinking style override
  const hCard = createHarness('components/ui/Card.js', {
    props: {
      onPress: () => {},
      style: shrinkingOverride,
      accessibilityLabel: 'Card customizado',
    },
  });
  const cardPressable = hCard.nodes.find((n) => n.type === 'Pressable');
  const cardStyle = flattenStyle(cardPressable.props.style({ pressed: false }));
  assert.ok(cardStyle.minWidth >= 48, 'Clickable Card protects minWidth >= 48');
  assert.ok(cardStyle.minHeight >= 48, 'Clickable Card protects minHeight >= 48');
  assert.ok(cardStyle.width >= 48, 'Clickable Card clamps numeric width >= 48');
  assert.equal(cardStyle.backgroundColor, '#123456', 'Clickable Card preserves custom backgroundColor');
  assert.equal(cardStyle.borderColor, '#ABCDEF', 'Clickable Card preserves custom borderColor');
  assert.equal(cardStyle.marginTop, 14, 'Clickable Card preserves custom marginTop');

  // 3. TagChip with shrinking style override
  const hChip = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Apex',
      selected: false,
      style: shrinkingOverride,
      onPress: () => {},
      onRemove: () => {},
      testID: 'chip-apex',
    },
  });
  const chipContainer = hChip.nodes.find((n) => n.type === 'View');
  const chipContainerStyle = flattenStyle(chipContainer.props.style);
  const chipSurface = hChip.nodes.find((n) => n.type === 'View' && n.props.testID === 'chip-apex-surface');
  const chipSurfaceStyle = flattenStyle(chipSurface.props.style);
  assert.ok(chipContainerStyle.minWidth >= 48, 'TagChip container protects minWidth >= 48');
  assert.ok(chipContainerStyle.minHeight >= 48, 'TagChip container protects minHeight >= 48');
  assert.equal(chipContainerStyle.marginTop, 14, 'TagChip preserves layout margin customization');
  assert.equal(chipSurfaceStyle.backgroundColor, '#123456', 'TagChip applies custom backgroundColor to pill surface');
  assert.equal(chipSurfaceStyle.borderColor, '#ABCDEF', 'TagChip applies custom borderColor to pill surface');
});

test('C07: Button preserves dimensional stability during loading and blocks interaction in loading/disabled', () => {
  let pressCount = 0;
  const h = createHarness('components/ui/Button.js', {
    props: {
      title: 'Confirmar Entrada',
      variant: 'primary',
      size: 'lg',
      fullWidth: false,
      onPress: () => { pressCount += 1; },
    },
  });

  const normalPressable = h.nodes.find((n) => n.type === 'Pressable');
  const normalButtonStyle = flattenStyle(normalPressable.props.style({ pressed: false }));
  const normalContentRow = h.nodes.find(
    (n) => n.type === 'View' && flattenStyle(n.props.style).flexDirection === 'row'
  );
  assert.ok(normalContentRow, 'Content row is rendered in normal state');
  assert.equal(flattenStyle(normalContentRow.props.style).opacity, undefined);

  h.act(() => h.press('Confirmar Entrada'));
  assert.equal(pressCount, 1);

  // Switch to loading=true and verify dimensional stability
  h.setProps({ loading: true });
  const loadingPressable = h.nodes.find((n) => n.type === 'Pressable');
  const loadingButtonStyle = flattenStyle(loadingPressable.props.style({ pressed: false }));

  assert.equal(loadingButtonStyle.minHeight, normalButtonStyle.minHeight, 'minHeight stays identical during loading');
  assert.equal(loadingButtonStyle.minWidth, normalButtonStyle.minWidth, 'minWidth stays identical during loading');
  assert.equal(loadingButtonStyle.paddingHorizontal, normalButtonStyle.paddingHorizontal, 'Horizontal padding stays identical');
  assert.equal(loadingButtonStyle.paddingVertical, normalButtonStyle.paddingVertical, 'Vertical padding stays identical');

  const hiddenContentRow = h.nodes.find(
    (n) => n.type === 'View' && flattenStyle(n.props.style).opacity === 0
  );
  assert.ok(hiddenContentRow, 'Content row stays mounted with opacity 0 during loading');
  assert.equal(hiddenContentRow.props.accessibilityElementsHidden, true);

  const spinner = h.nodes.find((n) => n.type === 'ActivityIndicator');
  assert.ok(spinner, 'ActivityIndicator is rendered during loading');
  assert.equal(loadingPressable.props.disabled, true);
  assert.equal(loadingPressable.props.onPress, undefined);
  assert.equal(loadingPressable.props.accessibilityState.disabled, true);
  assert.equal(loadingPressable.props.accessibilityState.busy, true);
  assert.throws(() => h.press('Confirmar Entrada'), /AssertionError/);
  assert.equal(pressCount, 1);

  // Switch to disabled=true, loading=false
  h.setProps({ loading: false, disabled: true });
  const disabledPressable = h.nodes.find((n) => n.type === 'Pressable');
  assert.equal(disabledPressable.props.disabled, true);
  assert.equal(disabledPressable.props.onPress, undefined);
  assert.equal(disabledPressable.props.accessibilityState.disabled, true);
  assert.equal(disabledPressable.props.accessibilityState.busy, false);
  assert.throws(() => h.press('Confirmar Entrada'), /AssertionError/);
  assert.equal(pressCount, 1);
});

test('C07 & C08: Button accessible label extraction, explicit accessibilityLabel requirement for opaque children, and variants', () => {
  // 1. String children extraction
  const hStringChildren = createHarness('components/ui/Button.js', {
    props: {
      children: 'Entrar com E-mail',
      onPress: () => {},
    },
  });
  assert.equal(
    hStringChildren.nodes.find((n) => n.type === 'Pressable').props.accessibilityLabel,
    'Entrar com E-mail'
  );

  // 2. Nested Text elements extraction
  const hElementChildren = createHarness('components/ui/Button.js', {
    props: {
      children: [
        { type: 'Text', props: { children: 'Sair' } },
        { type: 'Text', props: { children: 'da Arena' } },
      ],
      onPress: () => {},
    },
  });
  assert.equal(
    hElementChildren.nodes.find((n) => n.type === 'Pressable').props.accessibilityLabel,
    'Sair da Arena'
  );

  // 3. Opaque custom element requires explicit accessibilityLabel (falls back to generic 'Botão' if omitted)
  const opaqueIconElement = { type: function OpaqueIcon() {}, props: {} };
  const hOpaqueWithoutLabel = createHarness('components/ui/Button.js', {
    props: {
      children: opaqueIconElement,
      onPress: () => {},
    },
  });
  assert.equal(
    hOpaqueWithoutLabel.nodes.find((n) => n.type === 'Pressable').props.accessibilityLabel,
    'Botão'
  );

  const hOpaqueWithExplicitLabel = createHarness('components/ui/Button.js', {
    props: {
      children: opaqueIconElement,
      accessibilityLabel: 'Fechar janela',
      onPress: () => {},
    },
  });
  assert.equal(
    hOpaqueWithExplicitLabel.nodes.find((n) => n.type === 'Pressable').props.accessibilityLabel,
    'Fechar janela'
  );

  // 4. All 6 visual variants
  const variantExpectations = [
    { variant: 'primary', bg: '#5F33FA', pressedBg: '#724CFB', text: '#FFFFFF', spinner: '#FFFFFF' },
    { variant: 'secondary', bg: '#161626', border: '#2E2E48', pressedBg: '#1F1F35', text: '#FFFFFF', spinner: '#FFFFFF' },
    { variant: 'outline', bg: 'transparent', border: '#5F33FA', text: '#5F33FA', spinner: '#5F33FA' },
    { variant: 'danger', bg: '#E11D48', text: '#FFFFFF', spinner: '#FFFFFF' },
    { variant: 'dangerOutline', bg: 'transparent', border: '#E11D48', text: '#E11D48', spinner: '#E11D48' },
    { variant: 'ghost', bg: 'transparent', text: '#A0A0B8', spinner: '#5F33FA' },
  ];

  for (const spec of variantExpectations) {
    const hVar = createHarness('components/ui/Button.js', {
      props: { title: `Botão ${spec.variant}`, variant: spec.variant, onPress: () => {} },
    });
    const pressable = hVar.nodes.find((n) => n.type === 'Pressable');
    const styleRest = flattenStyle(pressable.props.style({ pressed: false }));
    const stylePressed = flattenStyle(pressable.props.style({ pressed: true }));
    const labelNode = hVar.nodes.find((n) => n.type === 'Text');
    const labelStyle = flattenStyle(labelNode.props.style);

    assert.equal(styleRest.backgroundColor, spec.bg, `${spec.variant} background matches`);
    if (spec.border) {
      assert.equal(styleRest.borderColor, spec.border, `${spec.variant} border matches`);
    }
    if (spec.pressedBg) {
      assert.equal(stylePressed.backgroundColor, spec.pressedBg, `${spec.variant} pressed background matches`);
    }
    assert.equal(labelStyle.color, spec.text, `${spec.variant} text color matches`);

    hVar.setProps({ loading: true });
    const varSpinner = hVar.nodes.find((n) => n.type === 'ActivityIndicator');
    assert.equal(varSpinner.props.color, spec.spinner, `${spec.variant} spinner color matches`);
  }
});

test('C08: InputField, Card, Badge, StepperIndicator and ScreenHeader states and accessibility', () => {
  let updatedText = '';
  let focusCalled = false;
  let blurCalled = false;

  const h = createHarness('components/ui/InputField.js', {
    props: {
      label: 'E-mail',
      required: true,
      value: 'test@example.com',
      placeholder: 'Digite seu e-mail',
      hint: 'Use seu e-mail institucional ou pessoal',
      onChangeText: (text) => { updatedText = text; },
      onFocus: () => { focusCalled = true; },
      onBlur: () => { blurCalled = true; },
    },
  });

  const input = h.nodes.find((n) => n.type === 'TextInput');
  assert.ok(input, 'TextInput must be rendered');
  assert.equal(input.props.value, 'test@example.com');
  assert.equal(input.props.accessibilityState.disabled, false);

  h.act(() => input.props.onFocus({}));
  assert.equal(focusCalled, true);
  assert.ok(
    h.nodes.find((n) => n.type === 'View' && flattenStyle(n.props.style).borderColor === '#5F33FA'),
    'Input box border changes to #5F33FA on focus'
  );

  h.act(() => input.props.onBlur({}));
  assert.equal(blurCalled, true);
  assert.ok(
    h.nodes.find((n) => n.type === 'View' && flattenStyle(n.props.style).borderColor === '#2E2E48'),
    'Input box border restores to #2E2E48 on blur'
  );

  h.act(() => input.props.onChangeText('novo@arena.com'));
  assert.equal(updatedText, 'novo@arena.com');

  h.setProps({ error: 'Formato de e-mail inválido' });
  const errorAlert = h.nodes.find((n) => n.type === 'Text' && n.props.accessibilityRole === 'alert');
  assert.ok(errorAlert);
  assert.equal(textOf(errorAlert), 'Formato de e-mail inválido');

  h.setProps({ editable: false, error: null });
  const disabledInput = h.nodes.find((n) => n.type === 'TextInput');
  assert.equal(disabledInput.props.editable, false);
  assert.equal(disabledInput.props.accessibilityState.disabled, true);

  for (const variant of ['default', 'brand', 'success', 'danger', 'warning', 'info']) {
    const hBadge = createHarness('components/ui/Badge.js', {
      props: { label: variant.toUpperCase(), variant, size: 'sm' },
    });
    assert.ok(hBadge.nodes.find((n) => n.type === 'Text' && textOf(n) === variant.toUpperCase()));
  }

  const hStepper = createHarness('components/ui/StepperIndicator.js', {
    props: {
      totalSteps: 3,
      currentStep: 2,
      title: 'Seus jogos',
      subtitle: 'Informe seus jogos favoritos',
    },
  });
  const progressBar = hStepper.nodes.find((n) => n.type === 'View' && n.props.accessibilityRole === 'progressbar');
  assert.ok(progressBar);
  assert.equal(progressBar.props.accessibilityValue.min, 1);
  assert.equal(progressBar.props.accessibilityValue.max, 3);
  assert.equal(progressBar.props.accessibilityValue.now, 2);

  let backCalls = 0;
  const hHeader = createHarness('components/ui/ScreenHeader.js', {
    props: {
      title: 'Meu Perfil',
      subtitle: 'Dados da conta',
      backDisabled: true,
      onBack: () => { backCalls += 1; },
    },
  });
  const backButton = hHeader.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Voltar');
  assert.equal(backButton.props.disabled, true);
  assert.equal(backButton.props.onPress, undefined);
  assert.equal(backCalls, 0);
});

test('C09: Isolated DesignSystemPreview renders all 7 component families and supports remove-then-select in preview state', () => {
  const nativeStub = {
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    StyleSheet: {
      create: (v) => v,
      flatten: flattenStyle,
      absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    },
  };

  let states = [];
  let cursor = 0;

  const reactStub = {
    useState(initial) {
      const idx = cursor++;
      if (states[idx] === undefined) {
        states[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = (updater) => {
        states[idx] = typeof updater === 'function' ? updater(states[idx]) : updater;
      };
      return [states[idx], setState];
    },
  };

  function customRequire(id) {
    if (id === 'react') return reactStub;
    if (id === 'react-native') return nativeStub;
    if (id.startsWith('../../theme/')) {
      return loadModule(`theme/${id.replace('../../theme/', '')}`, require).exports;
    }
    if (id.startsWith('./')) {
      return loadModule(`components/ui/${id.slice(2)}`, customRequire).exports;
    }
    return require(id);
  }

  const previewModule = loadModule('components/ui/DesignSystemPreview.js', customRequire).exports;
  const PreviewComponent = previewModule.DesignSystemPreview || previewModule.default;
  assert.equal(typeof PreviewComponent, 'function');

  function renderPreview() {
    cursor = 0;
    return collectNodes(PreviewComponent({}));
  }

  let renderedNodes = renderPreview();
  assert.ok(renderedNodes.length > 25, 'DesignSystemPreview renders complete showcase tree');

  // Verify interactive remove followed by select inside DesignSystemPreview state
  const removeFortniteBtn = renderedNodes.find(
    (n) => n.type === 'Pressable' && n.props?.accessibilityLabel === 'Remover Fortnite'
  );
  assert.ok(removeFortniteBtn, 'Fortnite remove button is rendered in preview');
  removeFortniteBtn.props.onPress({});

  renderedNodes = renderPreview();
  const statusAfterRemove = renderedNodes.find((n) => n.props?.testID === 'preview-last-action');
  assert.equal(textOf(statusAfterRemove), 'Status: Removido: Fortnite');

  const selectFortniteBtn = renderedNodes.find(
    (n) => n.type === 'Pressable' && n.props?.accessibilityRole === 'checkbox' && n.props?.accessibilityLabel === 'Fortnite'
  );
  assert.ok(selectFortniteBtn, 'Fortnite select button remains interactive after removal');
  selectFortniteBtn.props.onPress({});

  renderedNodes = renderPreview();
  const statusAfterSelect = renderedNodes.find((n) => n.props?.testID === 'preview-last-action');
  assert.equal(textOf(statusAfterSelect), 'Status: Selecionado/Alternado: Fortnite');
});
