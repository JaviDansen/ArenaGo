/**
 * Suíte de Testes Unitários — Fundação do Design System (UI-01: C05 a C11)
 *
 * Escopo e Limitações (C08 / C11):
 * - Estes testes verificam em ambiente Node a estrutura da árvore de elementos React, os estilos
 *   declarados (incluindo minWidth/minHeight >= 48dp nos Pressables e >= 96dp combinados no TagChip
 *   com seleção e remoção), o bloqueio de overrides restritivos (width, minWidth, maxWidth, overflow),
 *   a independência de handlers sem mutação de eventos e os atributos de acessibilidade.
 * - Estes testes unitários avaliam estilos e estrutura declarados; NÃO medem layout nativo Yoga,
 *   hit-testing nativo do iOS/Android nem comportamento de VoiceOver/TalkBack em dispositivo físico.
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

test('C05 & C10: TagChip with selection and removal declares >= 96dp combined container minWidth and >= 48x48dp on each sibling Pressable without overlap', () => {
  const hChip = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Valorant',
      selected: true,
      onPress: () => {},
      onRemove: () => {},
      testID: 'chip-valorant',
    },
  });

  const outerView = hChip.nodes.find((n) => n.type === 'View');
  const innerRow = hChip.nodes.find((n) => n.type === 'View' && n.props.testID === 'chip-valorant-row');
  const selectPressable = hChip.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox'
  );
  const removePressable = hChip.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Remover Valorant'
  );

  assert.ok(outerView, 'Outer container View exists');
  assert.ok(innerRow, 'Inner row View exists');
  assert.ok(selectPressable, 'Selection Pressable exists');
  assert.ok(removePressable, 'Removal Pressable exists');

  const outerStyle = flattenStyle(outerView.props.style);
  const innerRowStyle = flattenStyle(innerRow.props.style);
  const selectStyle = flattenStyle(selectPressable.props.style({ pressed: false }));
  const removeStyle = flattenStyle(removePressable.props.style({ pressed: false }));

  // 1. Each Pressable declares >= 48x48dp with flexShrink: 0 and no overlapping hitSlop
  assert.equal(selectStyle.minWidth, 48, 'Selection Pressable declares minWidth 48dp');
  assert.equal(selectStyle.minHeight, 48, 'Selection Pressable declares minHeight 48dp');
  assert.equal(selectStyle.flexShrink, 0, 'Selection Pressable prevents shrinking below 48dp');
  assert.equal(selectPressable.props.hitSlop, undefined, 'Selection Pressable does not use overlapping hitSlop');

  assert.equal(removeStyle.minWidth, 48, 'Removal Pressable declares minWidth 48dp');
  assert.equal(removeStyle.minHeight, 48, 'Removal Pressable declares minHeight 48dp');
  assert.equal(removeStyle.flexShrink, 0, 'Removal Pressable prevents shrinking below 48dp');
  assert.equal(removePressable.props.hitSlop, undefined, 'Removal Pressable does not use overlapping hitSlop');

  // 2. Combined container and row minWidth >= sum of both Pressables (96dp), with no maxWidth: '100%' restriction
  const combinedPressableMinWidth = selectStyle.minWidth + removeStyle.minWidth;
  assert.equal(combinedPressableMinWidth, 96);
  assert.ok(
    outerStyle.minWidth >= combinedPressableMinWidth,
    `Outer container minWidth (${outerStyle.minWidth}) must accommodate both 48dp Pressables (>= 96dp)`
  );
  assert.ok(
    innerRowStyle.minWidth >= combinedPressableMinWidth,
    `Inner row minWidth (${innerRowStyle.minWidth}) must accommodate both 48dp Pressables (>= 96dp)`
  );
  assert.equal(outerStyle.minHeight, 48);
  assert.equal(outerStyle.maxWidth, undefined, 'Does not impose maxWidth: 100% that could compress dual actions in narrow parents');
  assert.equal(outerStyle.overflow, 'visible');
  assert.equal(outerStyle.flexShrink, 0);

  // 3. Compact visual decoration remains separated via pointerEvents="none"
  const pillSurface = hChip.nodes.find(
    (n) => n.type === 'View' && n.props.testID === 'chip-valorant-surface'
  );
  const removeBadge = hChip.nodes.find(
    (n) => n.type === 'View' && n.props.testID === 'chip-valorant-remove-badge'
  );
  assert.equal(pillSurface.props.pointerEvents, 'none');
  const pillSurfaceStyle = flattenStyle(pillSurface.props.style);
  assert.equal(pillSurfaceStyle.minHeight, 36, 'Visual pill preserves compact 36dp minimum height');
  assert.equal(pillSurfaceStyle.top, 6);
  assert.equal(pillSurfaceStyle.bottom, 6);

  assert.equal(removeBadge.props.pointerEvents, 'none');
  const removeBadgeStyle = flattenStyle(removeBadge.props.style);
  assert.equal(removeBadgeStyle.width, 20, 'Visual remove circle preserves 20dp width');
  assert.equal(removeBadgeStyle.height, 20, 'Visual remove circle preserves 20dp height');
});

test('C10 & C11: TagChip declared geometry adapts across select-only (48dp), remove-only (48dp) and static (36dp) modes without imposing dual-action width', () => {
  // 1. Select-only TagChip (onPress only)
  const hSelectOnly = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Solo Select',
      selected: false,
      onPress: () => {},
      testID: 'chip-select-only',
    },
  });
  const selectOnlyOuter = flattenStyle(hSelectOnly.nodes.find((n) => n.type === 'View').props.style);
  const selectOnlyRow = flattenStyle(
    hSelectOnly.nodes.find((n) => n.type === 'View' && n.props.testID === 'chip-select-only-row').props.style
  );
  const selectOnlyPressables = hSelectOnly.nodes.filter((n) => n.type === 'Pressable');
  assert.equal(selectOnlyPressables.length, 1, 'Select-only renders exactly 1 Pressable');
  assert.equal(selectOnlyPressables[0].props.accessibilityRole, 'checkbox');
  const selectOnlyBtnStyle = flattenStyle(selectOnlyPressables[0].props.style({ pressed: false }));
  assert.equal(selectOnlyBtnStyle.minWidth, 48);
  assert.equal(selectOnlyBtnStyle.minHeight, 48);
  assert.equal(selectOnlyOuter.minWidth, 48, 'Select-only container declares 48dp minWidth without imposing 96dp');
  assert.equal(selectOnlyRow.minWidth, 48, 'Select-only innerRow declares 48dp minWidth without imposing 96dp');
  assert.equal(selectOnlyOuter.minHeight, 48);

  // 2. Remove-only TagChip (onRemove only)
  const hRemoveOnly = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Solo Remove',
      onRemove: () => {},
      testID: 'chip-remove-only',
    },
  });
  const removeOnlyOuter = flattenStyle(hRemoveOnly.nodes.find((n) => n.type === 'View').props.style);
  const removeOnlyRow = flattenStyle(
    hRemoveOnly.nodes.find((n) => n.type === 'View' && n.props.testID === 'chip-remove-only-row').props.style
  );
  const removeOnlyPressables = hRemoveOnly.nodes.filter((n) => n.type === 'Pressable');
  assert.equal(removeOnlyPressables.length, 1, 'Remove-only renders exactly 1 Pressable');
  assert.equal(removeOnlyPressables[0].props.accessibilityRole, 'button');
  assert.equal(removeOnlyPressables[0].props.accessibilityLabel, 'Remover Solo Remove');
  const removeOnlyBtnStyle = flattenStyle(removeOnlyPressables[0].props.style({ pressed: false }));
  assert.equal(removeOnlyBtnStyle.minWidth, 48);
  assert.equal(removeOnlyBtnStyle.minHeight, 48);
  assert.equal(removeOnlyBtnStyle.flexShrink, 0);
  assert.equal(removeOnlyOuter.minWidth, 48, 'Remove-only container declares 48dp minWidth without imposing 96dp');
  assert.equal(removeOnlyRow.minWidth, 48, 'Remove-only innerRow declares 48dp minWidth without imposing 96dp');
  assert.equal(removeOnlyOuter.minHeight, 48);

  // 3. Static TagChip (neither onPress nor onRemove)
  const hStatic = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Estático',
      selected: false,
      testID: 'chip-static',
    },
  });
  const staticOuter = flattenStyle(hStatic.nodes.find((n) => n.type === 'View').props.style);
  const staticSurface = flattenStyle(
    hStatic.nodes.find((n) => n.type === 'View' && n.props.testID === 'chip-static-surface').props.style
  );
  const staticPressables = hStatic.nodes.filter((n) => n.type === 'Pressable');
  assert.equal(staticPressables.length, 0, 'Static TagChip renders 0 Pressables');
  assert.equal(staticOuter.minWidth, 36, 'Static TagChip declares compact 36dp minWidth');
  assert.equal(staticOuter.minHeight, 36, 'Static TagChip declares compact 36dp minHeight');
  assert.equal(staticSurface.top, 0);
  assert.equal(staticSurface.bottom, 0);
});

test('C10 & C11: TagChip blocks adversarial style overrides (width:20, minWidth:12, maxWidth:24, maxWidth:100%, overflow:hidden) from clipping single or dual actions', () => {
  const adversarialStyle = {
    width: 20,
    height: 18,
    minWidth: 12,
    minHeight: 14,
    maxWidth: 24,
    maxHeight: 24,
    overflow: 'hidden',
    backgroundColor: '#123456',
    borderColor: '#ABCDEF',
    marginTop: 14,
  };

  // 1. Dual-action TagChip under adversarial style must preserve >= 96dp minWidth and eliminate clipping constraints
  const hDual = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Apex Legends',
      selected: true,
      style: adversarialStyle,
      onPress: () => {},
      onRemove: () => {},
      testID: 'chip-dual-adv',
    },
  });
  const dualContainerStyle = flattenStyle(hDual.nodes.find((n) => n.type === 'View').props.style);
  const dualSurfaceStyle = flattenStyle(
    hDual.nodes.find((n) => n.type === 'View' && n.props.testID === 'chip-dual-adv-surface').props.style
  );
  assert.equal(dualContainerStyle.minWidth, 96, 'Dual-action TagChip enforces minWidth 96dp against minWidth: 12');
  assert.equal(dualContainerStyle.minHeight, 48, 'Dual-action TagChip enforces minHeight 48dp against minHeight: 14');
  assert.equal(dualContainerStyle.width, undefined, 'Removes clipping width: 20 on dual-action TagChip');
  assert.equal(dualContainerStyle.maxWidth, undefined, 'Removes clipping maxWidth: 24 on dual-action TagChip');
  assert.equal(dualContainerStyle.height, undefined, 'Removes clipping height: 18 on dual-action TagChip');
  assert.equal(dualContainerStyle.maxHeight, undefined, 'Removes clipping maxHeight: 24 on dual-action TagChip');
  assert.equal(dualContainerStyle.overflow, 'visible', 'Overrides overflow: hidden with visible');
  assert.equal(dualContainerStyle.marginTop, 14, 'Preserves legitimate layout margin');
  assert.equal(dualSurfaceStyle.backgroundColor, '#123456', 'Preserves legitimate custom backgroundColor on pill surface');
  assert.equal(dualSurfaceStyle.borderColor, '#ABCDEF', 'Preserves legitimate custom borderColor on pill surface');

  // Also test width: 60, maxWidth: 60 (between 48 and 96) and percentage maxWidth: '100%' on dual-action TagChip
  const hDualMid = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'CS2',
      style: { width: 60, minWidth: 60, maxWidth: '100%', overflow: 'scroll' },
      onPress: () => {},
      onRemove: () => {},
    },
  });
  const dualMidStyle = flattenStyle(hDualMid.nodes.find((n) => n.type === 'View').props.style);
  assert.equal(dualMidStyle.minWidth, 96, 'Enforces 96dp even when custom minWidth is 60dp');
  assert.equal(dualMidStyle.width, undefined, 'Removes width: 60 because it is smaller than 96dp');
  assert.equal(dualMidStyle.maxWidth, undefined, 'Removes percentage maxWidth: 100%');
  assert.equal(dualMidStyle.overflow, 'visible', 'Overrides overflow: scroll with visible');

  // 2. Select-only TagChip under adversarial style preserves >= 48dp minWidth
  const hSelectAdv = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Valorant',
      style: adversarialStyle,
      onPress: () => {},
    },
  });
  const selectAdvStyle = flattenStyle(hSelectAdv.nodes.find((n) => n.type === 'View').props.style);
  assert.equal(selectAdvStyle.minWidth, 48, 'Select-only TagChip enforces minWidth 48dp');
  assert.equal(selectAdvStyle.minHeight, 48);
  assert.equal(selectAdvStyle.width, undefined);
  assert.equal(selectAdvStyle.maxWidth, undefined);
  assert.equal(selectAdvStyle.overflow, 'visible');

  // 3. Remove-only TagChip under adversarial style preserves >= 48dp minWidth
  const hRemoveAdv = createHarness('components/ui/TagChip.js', {
    props: {
      label: 'Minecraft',
      style: adversarialStyle,
      onRemove: () => {},
    },
  });
  const removeAdvStyle = flattenStyle(hRemoveAdv.nodes.find((n) => n.type === 'View').props.style);
  assert.equal(removeAdvStyle.minWidth, 48, 'Remove-only TagChip enforces minWidth 48dp');
  assert.equal(removeAdvStyle.minHeight, 48);
  assert.equal(removeAdvStyle.width, undefined);
  assert.equal(removeAdvStyle.maxWidth, undefined);
  assert.equal(removeAdvStyle.overflow, 'visible');
});

test('C06 & C11: TagChip has no nested Pressables, never mutates events, and preserves independent actions and disabled state across modes', () => {
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

  // 4. Selection followed by removal and repeated interactions
  h.act(() => {
    selectNode.props.onPress(frozenEvent);
    removeNode.props.onPress(frozenEvent);
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

  // 5. Disabled state blocks both controls in dual-action mode
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

test('C05: Button, clickable Card and ScreenHeader back control declare >= 48x48dp style dimensions on their Pressables', () => {
  for (const size of ['sm', 'md', 'lg']) {
    const hBtn = createHarness('components/ui/Button.js', {
      props: { title: `Botão ${size}`, size, fullWidth: false, onPress: () => {} },
    });
    const btnPressable = hBtn.nodes.find((n) => n.type === 'Pressable');
    const btnStyle = flattenStyle(btnPressable.props.style({ pressed: false }));

    assert.ok(btnStyle.minWidth >= 48, `Button (${size}) Pressable declares minWidth >= 48dp`);
    assert.ok(btnStyle.minHeight >= 48, `Button (${size}) Pressable declares minHeight >= 48dp`);
    assert.equal(btnStyle.height, undefined, `Button (${size}) avoids fixed height to prevent clipping scaled text`);
  }

  const hCard = createHarness('components/ui/Card.js', {
    props: { onPress: () => {}, accessibilityLabel: 'Card interativo' },
  });
  const cardPressable = hCard.nodes.find((n) => n.type === 'Pressable');
  const cardStyle = flattenStyle(cardPressable.props.style({ pressed: false }));
  assert.ok(cardStyle.minWidth >= 48, 'Clickable Card Pressable declares minWidth >= 48dp');
  assert.ok(cardStyle.minHeight >= 48, 'Clickable Card Pressable declares minHeight >= 48dp');

  const hHeader = createHarness('components/ui/ScreenHeader.js', {
    props: { title: 'Perfil', onBack: () => {}, testID: 'hdr' },
  });
  const backPressable = hHeader.nodes.find(
    (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Voltar'
  );
  const backStyle = flattenStyle(backPressable.props.style({ pressed: false }));
  assert.ok(backStyle.minWidth >= 48, 'ScreenHeader back Pressable declares minWidth >= 48dp');
  assert.ok(backStyle.minHeight >= 48, 'ScreenHeader back Pressable declares minHeight >= 48dp');

  const backCircle = hHeader.nodes.find((n) => n.type === 'View' && n.props.testID === 'hdr-back-circle');
  const backCircleStyle = flattenStyle(backCircle.props.style);
  assert.equal(backCircle.props.pointerEvents, 'none');
  assert.equal(backCircleStyle.width, 40, 'ScreenHeader visual circle preserves 40dp width');
  assert.equal(backCircleStyle.height, 40, 'ScreenHeader visual circle preserves 40dp height');
});

test('C07: Button and clickable Card protect minimum 48x48dp style dimensions against accidental overrides while preserving appearance customizations', () => {
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
});

test('C07: Button preserves style dimensions during loading and blocks interaction in loading/disabled', () => {
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

  // Switch to loading=true and verify style stability
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

test('C08: InputField, Card, Badge, StepperIndicator and ScreenHeader states and accessibility props', () => {
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
