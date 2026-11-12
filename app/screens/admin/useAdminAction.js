import { useEffect, useRef, useState } from 'react';

import { waitAdminDemoLatency } from './adminDemoLatency';
import { useAdminConfirmation } from './useAdminConfirmation';

// Ciclo comum das ações da ADM02: revisar → confirmar → carregando →
// resultado. Usa a confirmação de uso único da ADM01: toque duplicado,
// confirmação cancelada, callback de diálogo antigo ou nova ação durante o
// carregamento não executam nada. O snapshot revisado no diálogo (transição e
// argumentos) é exatamente o que é aplicado. Tela desmontada não recebe nada.
export function useAdminAction(run) {
  const confirmation = useAdminConfirmation();
  const [saving, setSaving] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // snapshot: { kind, transition, args, onSuccess?, ...dados do diálogo }
  function review(snapshot) {
    if (!confirmation.open(snapshot)) return false;
    setFeedback(null);
    return true;
  }

  async function confirm(token) {
    const snapshot = confirmation.claim(token);
    if (!snapshot) return null;
    setSaving(snapshot.kind);
    await waitAdminDemoLatency();
    if (!mountedRef.current) return null;
    const result = run(snapshot.transition, ...snapshot.args);
    confirmation.release();
    setSaving(null);
    setFeedback({
      kind: snapshot.kind,
      tone: result.ok ? 'success' : 'error',
      text: result.message,
      errors: result.errors ?? {},
    });
    if (result.ok && typeof snapshot.onSuccess === 'function') snapshot.onSuccess(result);
    return result;
  }

  // Erro de preenchimento detectado antes de abrir a confirmação.
  function reject(kind, text, errors = {}) {
    setFeedback({ kind, tone: 'error', text, errors });
  }

  function feedbackFor(kind) {
    return feedback && feedback.kind === kind ? feedback : null;
  }

  return {
    saving,
    busy: saving !== null,
    snapshot: confirmation.snapshot,
    review,
    reject,
    feedbackFor,
    clearFeedback: () => setFeedback(null),
    dialog: {
      visible: confirmation.visible,
      onConfirm: () => confirm(confirmation.pending),
      onCancel: confirmation.cancel,
    },
  };
}
