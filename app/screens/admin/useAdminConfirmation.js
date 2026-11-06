import { useRef, useState } from 'react';

// Confirmação de uso único para as ações administrativas da demonstração.
// Cada abertura do diálogo gera um contexto novo (token) com o snapshot dos
// dados revisados. A confirmação só é aceita se o token ainda for o vigente
// e nenhuma operação estiver em andamento; o token é consumido de forma
// SÍNCRONA (por ref), antes de qualquer renderização. Assim:
// - dois toques seguidos no confirmar executam a ação no máximo uma vez;
// - cancelar invalida o contexto: um callback guardado antes não executa;
// - um callback de um diálogo anterior nunca vale para o diálogo atual.
export function useAdminConfirmation() {
  const tokenRef = useRef(null);
  const busyRef = useRef(false);
  const [pending, setPending] = useState(null);

  function open(snapshot) {
    if (busyRef.current) return false;
    const token = { snapshot };
    tokenRef.current = token;
    setPending(token);
    return true;
  }

  function cancel() {
    tokenRef.current = null;
    setPending(null);
  }

  // Devolve o snapshot se a confirmação for válida; senão, null (nada a fazer).
  function claim(token) {
    if (busyRef.current || !token || tokenRef.current !== token) return null;
    tokenRef.current = null;
    busyRef.current = true;
    setPending(null);
    return token.snapshot;
  }

  function release() {
    busyRef.current = false;
  }

  return {
    pending,
    snapshot: pending ? pending.snapshot : null,
    visible: pending !== null,
    open,
    cancel,
    claim,
    release,
  };
}
