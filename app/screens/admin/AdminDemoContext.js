import { createContext, useContext, useRef, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import {
  advanceClock as advanceClockTransition,
  createAdminDemoSession,
  resetClock as resetClockTransition,
} from './adminDemoState';

// Estado CENTRAL da demonstração Admin (ADM01–ADM03 evoluem este mesmo estado).
// Vive apenas enquanto a Área Admin está aberta (o provedor é montado dentro do
// AdminDemoNavigator), é isolado por conta + geração da sessão e não toca no
// ParticipationContext, na Área Staff, no httpClient nem em permissões reais.
export const AdminDemoContext = createContext(null);

export const ADMIN_SIMULATED_FAILURE_MESSAGE =
  'Erro simulado: nenhuma alteração foi feita. Tente novamente.';

// Dono da demonstração: conta autenticada + geração da sessão (epoch do
// AuthContext). Login, logout ou troca direta de conta mudam a chave.
export function getAdminDemoOwnerKey(auth) {
  if (!auth?.isAuthenticated || !auth.user?.id) return null;
  const epoch = typeof auth.getSessionEpoch === 'function' ? auth.getSessionEpoch() : 0;
  return `${auth.user.id}#${epoch}`;
}

function freshDemo(ownerKey) {
  return { ownerKey, session: ownerKey ? createAdminDemoSession() : null, failNextAction: false };
}

export function AdminDemoProvider({ children }) {
  const auth = useAuth();
  const ownerKey = getAdminDemoOwnerKey(auth);
  const authRef = useRef(auth);
  authRef.current = auth;

  const [demo, setDemo] = useState(() => freshDemo(ownerKey));
  // Ref garante resultado síncrono mesmo com cliques seguidos.
  const demoRef = useRef(demo);

  function commit(next) {
    demoRef.current = next;
    setDemo(next);
  }

  // Na renderização em que a identidade muda, nada da conta anterior é exposto.
  const current = demo.ownerKey === ownerKey ? demo : freshDemo(ownerKey);
  if (current !== demo) commit(current);

  // Ações conferem a geração no momento do clique: um callback antigo, disparado
  // depois de trocar de conta e antes da nova renderização, não altera nada.
  function liveDemo() {
    const liveKey = getAdminDemoOwnerKey(authRef.current);
    if (demoRef.current.ownerKey !== liveKey) commit(freshDemo(liveKey));
    return demoRef.current;
  }

  // Executa uma transição pura; com o erro simulado ligado, falha sem alterar nada.
  function run(transition, ...args) {
    const latest = liveDemo();
    if (!latest.session) {
      return { ok: false, code: 'NO_SESSION', message: 'Sessão de demonstração indisponível.' };
    }
    if (latest.failNextAction) {
      commit({ ...latest, failNextAction: false });
      return { ok: false, code: 'SIMULATED_ERROR', message: ADMIN_SIMULATED_FAILURE_MESSAGE };
    }
    const { state, result } = transition(latest.session, ...args);
    if (result.ok) commit({ ...latest, session: state });
    return result;
  }

  // Carregamento simulado da listagem: consome o erro simulado, se ligado.
  function simulateLoad() {
    const latest = liveDemo();
    if (!latest.session) return { ok: false, code: 'NO_SESSION', message: 'Sessão de demonstração indisponível.' };
    if (latest.failNextAction) {
      commit({ ...latest, failNextAction: false });
      return { ok: false, code: 'SIMULATED_ERROR', message: 'Falha simulada ao carregar os eventos. Nada foi consultado no servidor.' };
    }
    return { ok: true };
  }

  function updateClock(transition, ...args) {
    const latest = liveDemo();
    if (!latest.session) return;
    const { state, result } = transition(latest.session, ...args);
    if (result.ok) commit({ ...latest, session: state });
  }

  function toggleFailNextAction() {
    const latest = liveDemo();
    commit({ ...latest, failNextAction: !latest.failNextAction });
  }

  // Sair da Área Admin descarta toda a demonstração.
  function discard() {
    commit(freshDemo(liveDemo().ownerKey));
  }

  const value = {
    session: current.session,
    failNextAction: current.failNextAction,
    run,
    simulateLoad,
    advanceClock: (minutes) => updateClock(advanceClockTransition, minutes),
    resetClock: () => updateClock(resetClockTransition),
    toggleFailNextAction,
    discard,
  };

  return <AdminDemoContext.Provider value={value}>{children}</AdminDemoContext.Provider>;
}

export function useAdminDemo() {
  return useContext(AdminDemoContext);
}
