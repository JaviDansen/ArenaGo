import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

// O próximo ciclo começa após o término da leitura; mudança de foco/contexto invalida o timer.
const defaultScheduler = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
export function useStaffPolling(enabled, read, intervalMs = 5000, scope = null, scheduler = defaultScheduler) {
  const focused = useIsFocused();
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!enabled || !focused) return;
    let active = true, timer = null, running = false, foreground = AppState.currentState === 'active';
    const schedule = () => {
      if (!active || !foreground || running || timer !== null) return;
      timer = scheduler.set(() => { timer = null; void cycle(); }, intervalMs);
    };
    const cycle = async () => {
      if (!active || !foreground || running) return;
      running = true;
      try { await readRef.current(); } catch { /* A leitura sinaliza seu erro no estado da tela. */ } finally {
        running = false;
        schedule();
      }
    };
    const subscription = AppState.addEventListener('change', next => {
      const wasForeground = foreground;
      foreground = next === 'active';
      if (!foreground) { scheduler.clear(timer); timer = null; }
      else if (!wasForeground && active) schedule();
    });
    schedule();
    return () => { active = false; scheduler.clear(timer); subscription.remove(); };
  }, [enabled, focused, intervalMs, scope, scheduler]);
}
