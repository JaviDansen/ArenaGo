import * as ExpoSplashScreen from 'expo-splash-screen';

let hasPreventedAutoHide = false;
let hasHiddenNativeSplash = false;
let hasCompletedSplash = false;

/**
 * Bloqueia a ocultação automática da Splash nativa no escopo global
 * antes da montagem da árvore React Native.
 * Trata erros de forma segura (ex.: ambientes de teste, web ou recarga rápida).
 */
export async function preventAutoHideAsync(splashModule = ExpoSplashScreen) {
  if (hasPreventedAutoHide) {
    return true;
  }
  try {
    if (splashModule && typeof splashModule.preventAutoHideAsync === 'function') {
      await splashModule.preventAutoHideAsync();
    }
    hasPreventedAutoHide = true;
    return true;
  } catch (_err) {
    // Falhas de ambiente nativo não devem interromper o carregamento da aplicação
    return false;
  }
}

/**
 * Libera a Splash nativa de forma idempotente assim que a composição visual
 * correspondente em React Native estiver montada e pronta.
 */
export async function hideNativeSplashAsync(splashModule = ExpoSplashScreen) {
  if (hasHiddenNativeSplash) {
    return true;
  }
  try {
    if (splashModule && typeof splashModule.hideAsync === 'function') {
      await splashModule.hideAsync();
    }
    hasHiddenNativeSplash = true;
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Retorna se a Splash animada já foi executada e concluída nesta inicialização do processo.
 */
export function isSplashCompleted() {
  return hasCompletedSplash;
}

/**
 * Registra que a Splash animada foi concluída nesta abertura do app,
 * impedindo reexibição em navegações subsequentes.
 */
export function markSplashCompleted() {
  hasCompletedSplash = true;
}

/**
 * Retorna se o bloqueio de auto-hide foi registrado com sucesso.
 */
export function hasNativeSplashPrevented() {
  return hasPreventedAutoHide;
}

/**
 * Retorna se o hide da Splash nativa já foi acionado.
 */
export function hasNativeSplashHidden() {
  return hasHiddenNativeSplash;
}

/**
 * Restaura o estado da Splash para testes automatizados.
 */
export function resetSplashScreenStateForTesting() {
  hasPreventedAutoHide = false;
  hasHiddenNativeSplash = false;
  hasCompletedSplash = false;
}
