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

test('C01: Button guarantees >= 44x44pt effective touch area across sm, md and lg sizes while preserving visual height', () => {
  const hBtnSm = createHarness('components/ui/Button.js', {
    props: { title: 'Filtro', size: 'sm', fullWidth: false, onPress: () => {} },
  });
  const btnSmPressable = hBtnSm.nodes.find((n) => n.type === 'Pressable');
  const btnSmStyle = flattenStyle(btnSmPressable.props.style({ pressed: false }));
  const btnSmHitSlop = btnSmPressable.props.hitSlop;

  const effectiveBtnSmHeight = btnSmStyle.height + (btnSmHitSlop?.top || 0) + (btnSmHitSlop?.bottom || 0);
  const effectiveBtnSmMinWidth = btnSmStyle.minWidth + (btnSmHitSlop?.left || 0) + (btnSmHitSlop?.right || 0);
  assert.equal(btnSmStyle.height, 36, 'Visual height of small button preserves Figma 36pt aesthetic');
  assert.equal(effectiveBtnSmHeight, 44, 'Effective touch height of sm button is 44pt');
  assert.ok(effectiveBtnSmMinWidth >= 44, 'Effective touch width of sm button is >= 44pt');

  const hBtnMd = createHarness('components/ui/Button.js', {
    props: { title: 'Médio', size: 'md', onPress: () => {} },
  });
  const btnMdStyle = flattenStyle(hBtnMd.nodes.find((n) => n.type === 'Pressable').props.style({ pressed: false }));
  assert.equal(btnMdStyle.height, 44);
  assert.ok(btnMdStyle.minWidth >= 44);

  const hBtnLg = createHarness('components/ui/Button.js', {
    props: { title: 'Grande', size: 'lg', onPress: () => {} },
  });
  const btnLgStyle = flattenStyle(hBtnLg.nodes.find((n) => n.type === 'Pressable').props.style({ pressed: false }));
  assert.equal(btnLgStyle.height, 52);
  assert.ok(btnLgStyle.minWidth >= 44);
});

test('C01: TagChip and ScreenHeader guarantee >= 44x44pt effective touch targets for selection, removal and back controls', () => {
  const hChip = createHarness('components/ui/TagChip.js', {
    props: { label: 'Valorant', selected: true, onPress: () => {}, onRemove: () => {} },
  });
  const chipRootView = hChip.nodes.find((n) => n.type === 'View');
  const chipRootStyle = flattenStyle(chipRootView.props.style);
  const selectPressable = hChip.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox'
  );
  const removePressable = hChip.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Valorant'
  );

  const selectHitSlop = selectPressable.props.hitSlop;
  const effectiveChipHeight = chipRootStyle.minHeight + (selectHitSlop?.top || 0) + (selectHitSlop?.bottom || 0);
  assert.equal(effectiveChipHeight, 44, 'Effective chip touch height is 44pt');
  assert.ok(chipRootStyle.minWidth >= 44, 'Chip minimum width is >= 44pt');

  const removeStyle = flattenStyle(removePressable.props.style({ pressed: false }));
  const removeHitSlop = removePressable.props.hitSlop;
  const effectiveRemoveWidth = removeStyle.width + (removeHitSlop?.left || 0) + (removeHitSlop?.right || 0);
  const effectiveRemoveHeight = removeStyle.height + (removeHitSlop?.top || 0) + (removeHitSlop?.bottom || 0);
  assert.equal(removeStyle.width, 20, 'Visual width of remove button is 20pt');
  assert.equal(removeStyle.height, 20, 'Visual height of remove button is 20pt');
  assert.equal(effectiveRemoveWidth, 44, 'Remove control effective touch width is 44pt');
  assert.equal(effectiveRemoveHeight, 44, 'Remove control effective touch height is 44pt');

  const hHeader = createHarness('components/ui/ScreenHeader.js', {
    props: { title: 'Perfil', onBack: () => {} },
  });
  const backPressable = hHeader.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Voltar'
  );
  const backStyle = flattenStyle(backPressable.props.style({ pressed: false }));
  const backHitSlop = backPressable.props.hitSlop;
  assert.ok(backStyle.width + backHitSlop.left + backHitSlop.right >= 44);
  assert.ok(backStyle.height + backHitSlop.top + backHitSlop.bottom >= 44);
});

test('C02: TagChip eliminates nested Pressables and strictly isolates onRemove from onPress', () => {
  let selectCalls = 0;
  let removeCalls = 0;
  let selectedArg = null;
  let removedArg = null;

  const h = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Fortnite',
      selected: true,
      onPress: (label) => {
        selectCalls += 1;
        selectedArg = label;
      },
      onRemove: (label) => {
        removeCalls += 1;
        removedArg = label;
      },
    },
  });

  // Verify there are NO nested Pressables inside another Pressable
  const allPressables = h.nodes.filter((n) => n.type === 'Pressable');
  assert.equal(allPressables.length, 2, 'Renders two sibling Pressables (select and remove)');
  for (const pressable of allPressables) {
    const descendantPressables = collectNodes(pressable.props.children).filter((n) => n.type === 'Pressable');
    assert.equal(descendantPressables.length, 0, 'Pressable must NOT contain nested Pressable children');
  }

  // Pressing Remove executes ONLY onRemove, never onPress
  h.act(() => h.press('Remover Fortnite'));
  assert.equal(removeCalls, 1, 'onRemove called once');
  assert.equal(removedArg, 'Fortnite');
  assert.equal(selectCalls, 0, 'onPress must NOT be called when Remover is pressed');

  // Pressing chip label executes ONLY onPress, never onRemove
  h.act(() => h.press('Fortnite'));
  assert.equal(selectCalls, 1, 'onPress called once when chip is pressed');
  assert.equal(selectedArg, 'Fortnite');
  assert.equal(removeCalls, 1, 'onRemove must NOT be called when chip label is pressed');
});

test('C02 Adversarial: TagChip blocks synthetic event propagation and prevents any interaction when disabled', () => {
  let selectCalls = 0;
  let removeCalls = 0;

  const h = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Apex Legends',
      selected: true,
      onPress: () => { selectCalls += 1; },
      onRemove: () => { removeCalls += 1; },
    },
  });

  const selectNode = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox');
  const removeNode = h.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Apex Legends');
  let propagationStopped = false;
  const sharedEvent = {
    stopPropagation() {
      propagationStopped = true;
    },
  };

  h.act(() => {
    removeNode.props.onPress(sharedEvent);
    selectNode.props.onPress(sharedEvent);
  });
  assert.equal(propagationStopped, true, 'stopPropagation invoked on remove event');
  assert.equal(removeCalls, 1, 'onRemove executed');
  assert.equal(selectCalls, 0, 'onPress blocked when event already handled by remove');

  // Adversarial disabled state
  let disabledSelectCalls = 0;
  let disabledRemoveCalls = 0;
  const hDisabled = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Minecraft',
      selected: false,
      disabled: true,
      onPress: () => { disabledSelectCalls += 1; },
      onRemove: () => { disabledRemoveCalls += 1; },
    },
  });

  const disabledSelect = hDisabled.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox');
  const disabledRemove = hDisabled.nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Minecraft');

  assert.equal(disabledSelect.props.disabled, true);
  assert.equal(disabledSelect.props.onPress, undefined);
  assert.equal(disabledSelect.props.accessibilityState.checked, false);
  assert.equal(disabledSelect.props.accessibilityState.disabled, true);

  assert.equal(disabledRemove.props.disabled, true);
  assert.equal(disabledRemove.props.onPress, undefined);
  assert.equal(disabledRemove.props.accessibilityState.disabled, true);

  assert.throws(() => hDisabled.press('Minecraft'), /AssertionError/);
  assert.throws(() => hDisabled.press('Remover Minecraft'), /AssertionError/);
  assert.equal(disabledSelectCalls, 0);
  assert.equal(disabledRemoveCalls, 0);
});

test('C03: Button preserves dimensional stability when toggling loading and blocks interaction in loading/disabled', () => {
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

  // Trigger press in normal state
  h.act(() => h.press('Confirmar Entrada'));
  assert.equal(pressCount, 1);

  // Switch to loading=true and verify dimensional stability
  h.setProps({ loading: true });
  const loadingPressable = h.nodes.find((n) => n.type === 'Pressable');
  const loadingButtonStyle = flattenStyle(loadingPressable.props.style({ pressed: false }));

  assert.equal(loadingButtonStyle.height, normalButtonStyle.height, 'Height stays identical during loading');
  assert.equal(loadingButtonStyle.minHeight, normalButtonStyle.minHeight, 'minHeight stays identical during loading');
  assert.equal(loadingButtonStyle.minWidth, normalButtonStyle.minWidth, 'minWidth stays identical during loading');
  assert.equal(loadingButtonStyle.paddingHorizontal, normalButtonStyle.paddingHorizontal, 'Horizontal padding stays identical during loading');

  // Content row remains mounted with opacity: 0 so intrinsic width does not collapse
  const hiddenContentRow = h.nodes.find(
    (n) => n.type === 'View' && flattenStyle(n.props.style).opacity === 0
  );
  assert.ok(hiddenContentRow, 'Content row stays mounted with opacity 0 during loading');
  assert.equal(hiddenContentRow.props.accessibilityElementsHidden, true);

  // Spinner is rendered inside an absolute overlay
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

test('C03: Button derives accessible name from children when title is omitted and styles primary, secondary and destructive variants', () => {
  const hStringChildren = createHarness('components/ui/Button.js', {
    props: {
      children: 'Entrar com E-mail',
      onPress: () => {},
    },
  });
  const stringChildrenBtn = hStringChildren.nodes.find((n) => n.type === 'Pressable');
  assert.equal(stringChildrenBtn.props.accessibilityLabel, 'Entrar com E-mail');

  const hElementChildren = createHarness('components/ui/Button.js', {
    props: {
      children: [
        { type: 'Text', props: { children: 'Sair' } },
        { type: 'Text', props: { children: 'da Arena' } },
      ],
      onPress: () => {},
    },
  });
  const elementChildrenBtn = hElementChildren.nodes.find((n) => n.type === 'Pressable');
  assert.equal(elementChildrenBtn.props.accessibilityLabel, 'Sair da Arena');

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

test('C04: InputField handles focus/blur transitions, required mark, disabled state, hint and error alert', () => {
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

  const hintNode = h.nodes.find((n) => n.type === 'Text' && textOf(n) === 'Use seu e-mail institucional ou pessoal');
  assert.ok(hintNode, 'Hint text rendered when no error is present');

  h.act(() => input.props.onFocus({}));
  assert.equal(focusCalled, true, 'onFocus callback triggered');
  const focusedBox = h.nodes.find(
    (n) => n.type === 'View' && flattenStyle(n.props.style).borderColor === '#5F33FA'
  );
  assert.ok(focusedBox, 'Input box border changes to #5F33FA on focus');

  h.act(() => input.props.onBlur({}));
  assert.equal(blurCalled, true, 'onBlur callback triggered');
  const blurredBox = h.nodes.find(
    (n) => n.type === 'View' && flattenStyle(n.props.style).borderColor === '#2E2E48'
  );
  assert.ok(blurredBox, 'Input box border restores to #2E2E48 on blur');

  h.act(() => input.props.onChangeText('novo@arena.com'));
  assert.equal(updatedText, 'novo@arena.com');

  h.setProps({ error: 'Formato de e-mail inválido' });
  const errorAlert = h.nodes.find((n) => n.type === 'Text' && n.props.accessibilityRole === 'alert');
  assert.ok(errorAlert, 'Error message with accessibilityRole="alert" must be rendered');
  assert.equal(textOf(errorAlert), 'Formato de e-mail inválido');
  const hintAfterError = h.nodes.find((n) => n.type === 'Text' && textOf(n) === 'Use seu e-mail institucional ou pessoal');
  assert.equal(hintAfterError, undefined, 'Hint is hidden when error is displayed');

  h.setProps({ editable: false, error: null });
  const disabledInput = h.nodes.find((n) => n.type === 'TextInput');
  assert.equal(disabledInput.props.editable, false);
  assert.equal(disabledInput.props.accessibilityState.disabled, true);
});

test('C04: Card, Badge, StepperIndicator and ScreenHeader variants, disabled states and accessibility', () => {
  let cardClicked = 0;
  const hCard = createHarness('components/ui/Card.js', {
    props: {
      variant: 'highlight',
      accessibilityLabel: 'Estação VR',
      onPress: () => { cardClicked += 1; },
    },
  });
  const cardPressable = hCard.nodes.find((n) => n.type === 'Pressable');
  assert.ok(cardPressable);
  hCard.act(() => cardPressable.props.onPress());
  assert.equal(cardClicked, 1);

  hCard.setProps({ disabled: true });
  const disabledCardPressable = hCard.nodes.find((n) => n.type === 'Pressable');
  assert.equal(disabledCardPressable.props.disabled, true);
  assert.equal(disabledCardPressable.props.onPress, undefined);
  assert.equal(disabledCardPressable.props.accessibilityState.disabled, true);

  for (const variant of ['default', 'brand', 'success', 'danger', 'warning', 'info']) {
    const hBadge = createHarness('components/ui/Badge.js', {
      props: { label: variant.toUpperCase(), variant, size: 'sm' },
    });
    const badgeText = hBadge.nodes.find((n) => n.type === 'Text' && textOf(n) === variant.toUpperCase());
    assert.ok(badgeText, `Badge renders variant ${variant}`);
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
  assert.ok(progressBar, 'StepperIndicator exposes progressbar role');
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

test('C04: Isolated DesignSystemPreview exports and renders all component families', () => {
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
  const reactStub = {
    useState: (initial) => [initial, () => {}],
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

  const tree = PreviewComponent({});
  const renderedNodes = collectNodes(tree);
  assert.ok(renderedNodes.length > 20, 'DesignSystemPreview renders complete showcase tree');
});
