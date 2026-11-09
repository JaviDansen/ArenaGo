/**
 * ArenaGo Design System — TagChip Component
 * Chip de seleção e remoção rápida (utilizado no catálogo de jogos e filtros).
 *
 * Geometria e Acessibilidade (C05 / C06 / C07 / C10):
 * - Seleção e remoção utilizam Pressables irmãos independentes (sem aninhamento).
 * - Cada Pressable declara dimensões mínimas próprias de 48x48dp (MIN_TOUCH_TARGET = 48),
 *   sem sobreposição de hitSlop e com `flexShrink: 0`.
 * - Quando seleção e remoção estão presentes simultaneamente, o contêiner preserva
 *   largura mínima combinada de 96dp (MIN_COMBINED_TOUCH_WIDTH = 96). Quando há apenas
 *   uma ação interativa, preserva 48dp; quando estático, preserva 36dp.
 * - Impede que `width`, `minWidth`, `maxWidth` (incluindo percentuais como `'100%'`)
 *   ou `overflow` personalizados encolham ou recortem as regiões interativas.
 * - A aparência compacta do chip (pílula de 36dp de altura e círculo de remoção de 20x20dp)
 *   é preservada por elementos decorativos internos (pointerEvents="none").
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export const MIN_TOUCH_TARGET = 48;
export const MIN_COMBINED_TOUCH_WIDTH = MIN_TOUCH_TARGET * 2; // 96dp para seleção + remoção
export const CHIP_VISUAL_MIN_HEIGHT = 36;
export const REMOVE_BADGE_SIZE = 20;

const SURFACE_STYLE_KEYS = new Set([
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
]);

function flattenStyleInput(styleInput) {
  if (!styleInput) return {};
  if (typeof StyleSheet.flatten === 'function') {
    return StyleSheet.flatten(styleInput) || {};
  }
  if (Array.isArray(styleInput)) {
    return Object.assign({}, ...styleInput.map(flattenStyleInput));
  }
  if (typeof styleInput === 'object') {
    return { ...styleInput };
  }
  return {};
}

export function getRequiredMinWidth(hasSelectHandler, hasRemoveHandler) {
  if (hasSelectHandler && hasRemoveHandler) {
    return MIN_COMBINED_TOUCH_WIDTH;
  }
  if (hasSelectHandler || hasRemoveHandler) {
    return MIN_TOUCH_TARGET;
  }
  return CHIP_VISUAL_MIN_HEIGHT;
}

function partitionChipStyle(styleInput, hasSelectHandler, hasRemoveHandler) {
  const isInteractive = Boolean(hasSelectHandler || hasRemoveHandler);
  const flat = flattenStyleInput(styleInput);
  const layoutStyle = {};
  const surfaceStyle = {};

  for (const [key, value] of Object.entries(flat)) {
    if (SURFACE_STYLE_KEYS.has(key)) {
      surfaceStyle[key] = value;
    } else {
      layoutStyle[key] = value;
    }
  }

  if (isInteractive) {
    const requiredMinW = getRequiredMinWidth(hasSelectHandler, hasRemoveHandler);
    const requiredMinH = MIN_TOUCH_TARGET;

    const minW = typeof layoutStyle.minWidth === 'number'
      ? Math.max(layoutStyle.minWidth, requiredMinW)
      : requiredMinW;
    const minH = typeof layoutStyle.minHeight === 'number'
      ? Math.max(layoutStyle.minHeight, requiredMinH)
      : requiredMinH;

    layoutStyle.minWidth = minW;
    layoutStyle.minHeight = minH;

    if (layoutStyle.width !== undefined && (typeof layoutStyle.width !== 'number' || layoutStyle.width < minW)) {
      delete layoutStyle.width;
    }
    if (layoutStyle.maxWidth !== undefined && (typeof layoutStyle.maxWidth !== 'number' || layoutStyle.maxWidth < minW)) {
      delete layoutStyle.maxWidth;
    }
    if (layoutStyle.height !== undefined && (typeof layoutStyle.height !== 'number' || layoutStyle.height < minH)) {
      delete layoutStyle.height;
    }
    if (layoutStyle.maxHeight !== undefined && (typeof layoutStyle.maxHeight !== 'number' || layoutStyle.maxHeight < minH)) {
      delete layoutStyle.maxHeight;
    }

    layoutStyle.overflow = 'visible';
  }

  return { layoutStyle, surfaceStyle };
}

export function TagChip({
  label,
  selected = false,
  onPress,
  onRemove,
  disabled = false,
  style,
  textStyle,
  testID,
}) {
  const isDisabled = Boolean(disabled);
  const hasSelectHandler = typeof onPress === 'function';
  const hasRemoveHandler = typeof onRemove === 'function';
  const isInteractive = hasSelectHandler || hasRemoveHandler;
  const isDualAction = hasSelectHandler && hasRemoveHandler;

  const { layoutStyle, surfaceStyle } = partitionChipStyle(style, hasSelectHandler, hasRemoveHandler);

  const containerStyles = [
    styles.base,
    isDualAction
      ? styles.baseDualInteractive
      : isInteractive
      ? styles.baseSingleInteractive
      : styles.baseStatic,
    layoutStyle,
    isDisabled && styles.disabled,
  ];

  const innerRowStyles = [
    styles.innerRow,
    isDualAction
      ? styles.baseDualInteractive
      : isInteractive
      ? styles.baseSingleInteractive
      : styles.baseStatic,
  ];

  const pillSurfaceStyles = [
    styles.pillSurface,
    isInteractive ? styles.pillSurfaceInteractive : styles.pillSurfaceStatic,
    selected ? styles.selected : styles.unselected,
    surfaceStyle,
  ];

  const labelStyles = [
    styles.text,
    selected ? styles.textSelected : styles.textUnselected,
    isDisabled && styles.textDisabled,
    textStyle,
  ];

  function handleSelectPress() {
    if (isDisabled || !hasSelectHandler) return;
    onPress(label);
  }

  function handleRemovePress() {
    if (isDisabled || !hasRemoveHandler) return;
    onRemove(label);
  }

  return (
    <View style={containerStyles} testID={!hasSelectHandler ? testID : undefined}>
      {/* Decoração visual compacta da pílula (36dp) desacoplada dos alvos de toque (48dp) */}
      <View
        pointerEvents="none"
        style={pillSurfaceStyles}
        testID={testID ? `${testID}-surface` : undefined}
      />

      <View style={innerRowStyles} testID={testID ? `${testID}-row` : undefined}>
        {hasSelectHandler ? (
          <Pressable
            onPress={isDisabled ? undefined : handleSelectPress}
            disabled={isDisabled}
            style={({ pressed }) => [
              styles.selectAction,
              hasRemoveHandler ? styles.selectActionWithRemove : styles.selectActionSolo,
              pressed && !isDisabled && styles.pressed,
            ]}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: Boolean(selected), disabled: isDisabled }}
            testID={testID}
          >
            <Text style={labelStyles}>{label}</Text>
          </Pressable>
        ) : (
          <View
            style={[
              styles.staticLabelContainer,
              hasRemoveHandler ? styles.selectActionWithRemove : styles.selectActionSolo,
            ]}
          >
            <Text style={labelStyles}>{label}</Text>
          </View>
        )}

        {hasRemoveHandler && (
          <Pressable
            onPress={isDisabled ? undefined : handleRemovePress}
            disabled={isDisabled}
            style={({ pressed }) => [
              styles.removeAction,
              pressed && !isDisabled && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Remover ${label}`}
            accessibilityState={{ disabled: isDisabled }}
            testID={testID ? `${testID}-remove` : undefined}
          >
            <View
              pointerEvents="none"
              style={styles.removeBadge}
              testID={testID ? `${testID}-remove-badge` : undefined}
            >
              <Text
                style={[styles.removeIcon, isDisabled && styles.textDisabled]}
                allowFontScaling={false}
              >
                ✕
              </Text>
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'relative',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    overflow: 'visible',
    flexShrink: 0,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  baseDualInteractive: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_COMBINED_TOUCH_WIDTH,
  },
  baseSingleInteractive: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  baseStatic: {
    minHeight: CHIP_VISUAL_MIN_HEIGHT,
    minWidth: CHIP_VISUAL_MIN_HEIGHT,
  },
  pillSurface: {
    position: 'absolute',
    left: 0,
    right: 0,
    minHeight: CHIP_VISUAL_MIN_HEIGHT,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  pillSurfaceInteractive: {
    top: 6,
    bottom: 6,
  },
  pillSurfaceStatic: {
    top: 0,
    bottom: 0,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectAction: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  selectActionSolo: {
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  selectActionWithRemove: {
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  staticLabelContainer: {
    minHeight: CHIP_VISUAL_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  unselected: {
    backgroundColor: colors.background.surface,
    borderColor: colors.border.input,
  },
  selected: {
    backgroundColor: colors.brand.primaryDim,
    borderColor: colors.brand.primary,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.8,
  },
  text: {
    ...typography.body,
    fontWeight: typography.weights.medium,
  },
  textUnselected: {
    color: colors.text.secondary,
  },
  textSelected: {
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  textDisabled: {
    color: colors.text.disabled,
  },
  removeAction: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    flexShrink: 0,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadge: {
    width: REMOVE_BADGE_SIZE,
    height: REMOVE_BADGE_SIZE,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIcon: {
    color: colors.text.primary,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
});

export default TagChip;
