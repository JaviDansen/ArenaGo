import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

// O próximo ciclo começa após o término da leitura pertinente do mesmo escopo; mudança de foco/contexto invalida o timer.
const defaultScheduler = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
export function useStaffPolling(enabled, read, intervalMs = 5000, scope = null, scheduler = defaultScheduler) {
  const focused = useIsFocused();
  const readRef = useRef(read);
  readRef.current = read;
  const flightsRef = useRef(new Map());

  useEffect(() => {
    if (!enabled || !focused) return;
    let active = true;
    let timer = null;
    let foreground = AppState.currentState === 'active';
    const scopeKey = scope;
    let subscribedFlight = null;

    const clearTimer = () => {
      if (timer !== null) {
        scheduler.clear(timer);
        timer = null;
      }
    };

    const onFlightSettled = () => {
      subscribedFlight = null;
      schedule();
    };

    const detachFlight = () => {
      if (subscribedFlight) {
        subscribedFlight.waiters.delete(onFlightSettled);
        subscribedFlight = null;
      }
    };

    function schedule() {
      if (!active || !foreground || timer !== null) return;
      const existing = flightsRef.current.get(scopeKey);
      if (existing) {
        if (subscribedFlight !== existing) {
          detachFlight();
          subscribedFlight = existing;
          existing.waiters.add(onFlightSettled);
        }
        return;
      }
      detachFlight();
      timer = scheduler.set(() => {
        timer = null;
        void cycle();
      }, intervalMs);
    }

    const cycle = async () => {
      if (!active || !foreground || flightsRef.current.has(scopeKey)) {
        schedule();
        return;
      }
      let flightPromise;
      try {
        flightPromise = Promise.resolve(readRef.current());
      } catch (error) {
        flightPromise = Promise.reject(error);
      }
      const flight = {
        promise: flightPromise,
        waiters: new Set([onFlightSettled]),
      };
      flightsRef.current.set(scopeKey, flight);
      subscribedFlight = flight;
      try {
        await flightPromise;
      } catch {
        /* A leitura sinaliza seu erro no estado da tela. */
      } finally {
        if (flightsRef.current.get(scopeKey) === flight) {
          flightsRef.current.delete(scopeKey);
        }
        const pendingWaiters = [...flight.waiters];
        flight.waiters.clear();
        for (const notify of pendingWaiters) {
          notify();
        }
      }
    };

    const subscription = AppState.addEventListener('change', (next) => {
      const wasForeground = foreground;
      foreground = next === 'active';
      if (!foreground) {
        clearTimer();
      } else if (!wasForeground && active) {
        schedule();
      }
    });

    schedule();
    return () => {
      active = false;
      detachFlight();
      clearTimer();
      subscription?.remove?.();
    };
  }, [enabled, focused, intervalMs, scope, scheduler]);
}
