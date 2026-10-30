/**
 * ArenaGo Design System — TagChip Component
 * Chip de seleção e remoção rápida (utilizado no catálogo de jogos e filtros).
 *
 * Geometria e Acessibilidade (C05 / C06 / C07):
 * - Seleção e remoção utilizam Pressables irmãos independentes (sem aninhamento).
 * - Cada Pressable possui dimensões mínimas próprias de 48x48dp (iOS 44pt / Android 48dp),
 *   sem sobreposição entre alvos de toque e sem depender exclusivamente de hitSlop.
 * - A aparência compacta do chip (pílula de 36dp de altura e círculo de remoção de 20x20dp)
 *   é preservada por elementos decorativos internos (pointerEvents="none") desacoplados
 *   da caixa interativa de 48x48dp.
 * - Nota: A geometria final em dispositivo depende de os contêineres ancestrais não
 *   recortarem (overflow) nem sobreporem o componente.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export const MIN_TOUCH_TARGET = 48;
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

function partitionChipStyle(styleInput, isInteractive) {
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
    const minW = typeof layoutStyle.minWidth === 'number'
      ? Math.max(layoutStyle.minWidth, MIN_TOUCH_TARGET)
      : MIN_TOUCH_TARGET;
    const minH = typeof layoutStyle.minHeight === 'number'
      ? Math.max(layoutStyle.minHeight, MIN_TOUCH_TARGET)
      : MIN_TOUCH_TARGET;

    layoutStyle.minWidth = minW;
    layoutStyle.minHeight = minH;

    if (typeof layoutStyle.width === 'number' && layoutStyle.width < minW) {
      layoutStyle.width = minW;
    }
    if (typeof layoutStyle.height === 'number' && layoutStyle.height < minH) {
      delete layoutStyle.height;
    }
    if (typeof layoutStyle.maxWidth === 'number' && layoutStyle.maxWidth < minW) {
      layoutStyle.maxWidth = minW;
    }
    if (typeof layoutStyle.maxHeight === 'number' && layoutStyle.maxHeight < minH) {
      layoutStyle.maxHeight = minH;
    }
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

  const { layoutStyle, surfaceStyle } = partitionChipStyle(style, isInteractive);

  const containerStyles = [
    styles.base,
    isInteractive ? styles.baseInteractive : styles.baseStatic,
    layoutStyle,
    isDisabled && styles.disabled,
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

      <View style={styles.innerRow}>
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
    maxWidth: '100%',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  baseInteractive: {
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
  },
  selectAction: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    flexShrink: 1,
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
    flexShrink: 1,
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
    flexShrink: 1,
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
