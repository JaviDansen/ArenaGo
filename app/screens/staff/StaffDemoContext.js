import { createContext, useContext, useRef, useState } from 'react';

import { createStaffDemoSession } from './staffDemoState';

// Estado da demonstração Staff. Vive apenas enquanto a Área Staff está aberta
// (o provedor é montado dentro do StaffDemoNavigator) e não toca no
// ParticipationContext nem em dados de outras contas.
export const StaffDemoContext = createContext(null);

export const SIMULATED_FAILURE_MESSAGE =
  'Erro simulado: nenhuma alteração foi feita. Tente novamente.';

export function StaffDemoProvider({ children }) {
  const [session, setSession] = useState(null);
  const [failNextAction, setFailNextAction] = useState(false);
  // Refs garantem resultado síncrono mesmo com cliques seguidos.
  const sessionRef = useRef(null);
  const failNextRef = useRef(false);

  function replaceSession(nextSession) {
    sessionRef.current = nextSession;
    setSession(nextSession);
  }

  function enterEvent(eventCode) {
    const nextSession = createStaffDemoSession(eventCode);
    failNextRef.current = false;
    setFailNextAction(false);
    replaceSession(nextSession);
    return nextSession;
  }

  // Trocar de evento limpa toda a seleção anterior da demonstração.
  function leaveEvent() {
    failNextRef.current = false;
    setFailNextAction(false);
    replaceSession(null);
  }

  function run(transition, ...args) {
    if (!sessionRef.current) {
      return { ok: false, code: 'NO_SESSION', message: 'Nenhum evento de demonstração selecionado.' };
    }
    if (failNextRef.current) {
      failNextRef.current = false;
      setFailNextAction(false);
      return { ok: false, code: 'SIMULATED_ERROR', message: SIMULATED_FAILURE_MESSAGE };
    }
    const { state, result } = transition(sessionRef.current, ...args);
    if (result.ok) replaceSession(state);
    return result;
  }

  function toggleFailNextAction() {
    failNextRef.current = !failNextRef.current;
    setFailNextAction(failNextRef.current);
  }

  const value = {
    session,
    failNextAction,
    enterEvent,
    leaveEvent,
    run,
    toggleFailNextAction,
  };

  return <StaffDemoContext.Provider value={value}>{children}</StaffDemoContext.Provider>;
}

export function useStaffDemo() {
  return useContext(StaffDemoContext);
}
