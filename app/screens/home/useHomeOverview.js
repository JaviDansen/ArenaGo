import { useEffect, useRef, useState } from 'react';

import {
  fetchParticipationHistory,
  fetchPendingEvaluationHistoryItem,
} from '../../services/participationHistoryService.js';
import { loadHomeOverview, pendingEvaluationIds } from '../../utils/homeOverview.js';

const LOADING = { status: 'loading', recent: null, pending: null, error: null };

function errorKind(error) {
  if (error?.status === 401 || error?.status === 403) return 'authorization';
  if (error?.isNetworkError || error?.isTimeout) return 'network';
  return 'unavailable';
}

/**
 * Visão da Home para a conta e sessão atuais. Recarrega ao focar a aba e quando o
 * provider publica um novo estado de retorno; respostas de outra conta/sessão são descartadas.
 */
export function useHomeOverview({ auth, enabled, focused, returnState, returnStateVersion }) {
  const userId = auth?.isAuthenticated ? auth.user?.id ?? null : null;
  const epoch = userId ? auth.getSessionEpoch?.() ?? null : null;
  const client = auth?.httpClient ?? null;
  const verified = auth?.isIdentityVerified?.() === true;
  const key = userId && client && verified ? `${userId}#${epoch}` : null;
  const pendingIds = pendingEvaluationIds(returnState);
  const pendingKey = pendingIds.join(',');

  const generation = useRef(0);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ key: null, ...LOADING });

  useEffect(() => {
    const requestId = ++generation.current;
    if (!enabled || !focused || !key) return () => { generation.current += 1; };
    const isCurrent = () => requestId === generation.current;
    // Mantém os dados da mesma conta enquanto recarrega; outra conta começa do zero.
    setState(previous => (previous.key === key && previous.status !== 'error'
      ? { ...previous, refreshing: true } : { key, ...LOADING }));
    loadHomeOverview(client, {
      pendingIds,
      isCurrent,
      fetchHistory: fetchParticipationHistory,
      fetchPendingItem: fetchPendingEvaluationHistoryItem,
    }).then(result => {
      if (!isCurrent() || !result) return;
      setState({ key, status: result.recent ? 'history' : 'empty', recent: result.recent,
        pending: result.pending, error: null });
    }).catch(error => {
      if (!isCurrent()) return;
      setState({ key, status: 'error', recent: null, pending: null, error: errorKind(error) });
    });
    return () => { generation.current += 1; };
    // pendingIds é representado por pendingKey.
  }, [enabled, focused, key, client, returnStateVersion, pendingKey, reload]);

  const current = state.key === key && key !== null ? state : { key, ...LOADING };
  return { ...current, retry: () => setReload(value => value + 1) };
}
