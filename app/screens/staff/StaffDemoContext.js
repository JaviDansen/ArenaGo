import { createContext, useContext, useRef, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { createStaffDemoSession } from './staffDemoState';

// Estado da demonstração Staff. Vive apenas enquanto a Área Staff está aberta
// (o provedor é montado dentro do StaffDemoNavigator) e não toca no
// ParticipationContext nem em dados de outras contas.
export const StaffDemoContext = createContext(null);

export const SIMULATED_FAILURE_MESSAGE =
  'Erro simulado: nenhuma alteração foi feita. Tente novamente.';

// Dono da demonstração: conta autenticada + geração da sessão (epoch do
// AuthContext). Login, logout ou troca direta de conta mudam a chave.
export function getStaffDemoOwnerKey(auth) {
  if (!auth?.isAuthenticated || !auth.user?.id) return null;
  const epoch = typeof auth.getSessionEpoch === 'function' ? auth.getSessionEpoch() : 0;
  return `${auth.user.id}#${epoch}`;
}

function emptyDemo(ownerKey) {
  return { ownerKey, session: null, failNextAction: false };
}

export function StaffDemoProvider({ children }) {
  const auth = useAuth();
  const ownerKey = getStaffDemoOwnerKey(auth);
  const authRef = useRef(auth);
  authRef.current = auth;

  const [demo, setDemo] = useState(() => emptyDemo(ownerKey));
  // Ref garante resultado síncrono mesmo com cliques seguidos.
  const demoRef = useRef(demo);

  function commit(next) {
    demoRef.current = next;
    setDemo(next);
  }

  // Na renderização em que a identidade muda, nada da conta anterior é exposto.
  const current = demo.ownerKey === ownerKey ? demo : emptyDemo(ownerKey);
  if (current !== demo) commit(current);

  // Ações conferem a geração no momento do clique: um callback antigo, disparado
  // depois de trocar de conta e antes da nova renderização, não altera nada.
  function liveDemo() {
    const liveKey = getStaffDemoOwnerKey(authRef.current);
    if (demoRef.current.ownerKey !== liveKey) commit(emptyDemo(liveKey));
    return demoRef.current;
  }

  function enterEvent(eventCode) {
    const owner = liveDemo().ownerKey;
    if (!owner) return null;
    const nextSession = createStaffDemoSession(eventCode);
    commit({ ownerKey: owner, session: nextSession, failNextAction: false });
    return nextSession;
  }

  // Trocar de evento ou sair do painel limpa toda a seleção anterior.
  function leaveEvent() {
    commit(emptyDemo(liveDemo().ownerKey));
  }

  function run(transition, ...args) {
    const latest = liveDemo();
    if (!latest.session) {
      return { ok: false, code: 'NO_SESSION', message: 'Nenhum evento de demonstração selecionado.' };
    }
    if (latest.failNextAction) {
      commit({ ...latest, failNextAction: false });
      return { ok: false, code: 'SIMULATED_ERROR', message: SIMULATED_FAILURE_MESSAGE };
    }
    const { state, result } = transition(latest.session, ...args);
    if (result.ok) commit({ ...latest, session: state });
    return result;
  }

  function toggleFailNextAction() {
    const latest = liveDemo();
    commit({ ...latest, failNextAction: !latest.failNextAction });
  }

  const value = {
    session: current.session,
    failNextAction: current.failNextAction,
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
