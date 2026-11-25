import { useEffect, useRef, useState } from 'react';

import {
  fetchParticipationHistory,
  fetchPendingEvaluationHistoryItem,
} from '../../services/participationHistoryService.js';
import {
  confirmSinglePending, initialPendingState, loadRecentParticipation, pendingEvaluationIds,
} from '../../utils/homeOverview.js';

const HISTORY_LOADING = { status: 'loading', recent: null, error: null, refreshing: false };

function errorKind(error) {
  if (error?.status === 401 || error?.status === 403) return 'authorization';
  if (error?.isNetworkError || error?.isTimeout) return 'network';
  return 'unavailable';
}

/**
 * Visão da Home para a conta e sessão atuais, em dois estados independentes:
 *
 * - histórico: `loading | empty | history | error`. Um histórico já confirmado da mesma conta e
 *   sessão continua visível (`refreshing`) durante a revalidação; um vazio anterior não continua
 *   sendo afirmado — volta a `loading` até o servidor confirmar de novo.
 * - avaliação pendente: `none | checking | single | multiple | error`. Cada mudança de contexto
 *   (conta, sessão, versão do retorno, IDs pendentes) ou nova leitura invalida a ação anterior
 *   até a confirmação; falha nunca vira ausência.
 *
 * Cada leitura tem geração própria: respostas fora de ordem, de outra conta/sessão ou após perda
 * de foco/desmontagem são descartadas. `knownPending` reaproveita a confirmação já feita pela
 * retomada C-04/D09 para a mesma versão do retorno, sem repetir a consulta; `pendingDeferred`
 * adia a checagem enquanto essa retomada ainda está consultando.
 */
export function useHomeOverview({
  auth, enabled, focused, returnState, returnStateVersion, knownPending = null, pendingDeferred = false,
}) {
  const userId = auth?.isAuthenticated ? auth.user?.id ?? null : null;
  const epoch = userId ? auth.getSessionEpoch?.() ?? null : null;
  const client = auth?.httpClient ?? null;
  const verified = auth?.isIdentityVerified?.() === true;
  const key = userId && client && verified ? `${userId}#${epoch}` : null;
  const pendingIds = pendingEvaluationIds(returnState);
  const pendingKey = pendingIds.join(',');
  const pendingContext = key ? `${key}|${returnStateVersion}|${pendingKey}` : null;
  const known = knownPending && pendingIds.length === 1 && knownPending.version === returnStateVersion
    && knownPending.participationId === pendingIds[0] && knownPending.item?.participationId === pendingIds[0]
    ? knownPending.item : null;

  const historyGeneration = useRef(0);
  const pendingGeneration = useRef(0);
  const [historyReload, setHistoryReload] = useState(0);
  const [pendingReload, setPendingReload] = useState(0);
  const [history, setHistory] = useState({ key: null, ...HISTORY_LOADING });
  const [pending, setPending] = useState({ context: null, reload: -1, status: 'checking', item: null, count: 0, error: null });

  useEffect(() => {
    const requestId = ++historyGeneration.current;
    if (!enabled || !focused || !key) return () => { historyGeneration.current += 1; };
    const isCurrent = () => requestId === historyGeneration.current;
    // Só um histórico confirmado da mesma conta/sessão permanece visível durante a atualização.
    setHistory(previous => (previous.key === key && previous.status === 'history'
      ? { ...previous, refreshing: true } : { key, ...HISTORY_LOADING }));
    loadRecentParticipation(client, { fetchHistory: fetchParticipationHistory, isCurrent }).then(recent => {
      if (!isCurrent() || recent === undefined) return;
      setHistory({ key, status: recent ? 'history' : 'empty', recent, error: null, refreshing: false });
    }).catch(error => {
      if (!isCurrent()) return;
      setHistory({ key, ...HISTORY_LOADING, status: 'error', error: errorKind(error) });
    });
    return () => { historyGeneration.current += 1; };
  }, [enabled, focused, key, client, returnStateVersion, historyReload]);

  useEffect(() => {
    const requestId = ++pendingGeneration.current;
    const stop = () => { pendingGeneration.current += 1; };
    // Retomada C-04/D09 ainda consultando a mesma pendência: aguardar e reaproveitar o resultado dela.
    if (!enabled || !focused || !key || pendingIds.length !== 1 || pendingDeferred) return stop;
    const isCurrent = () => requestId === pendingGeneration.current;
    const publish = value => { if (isCurrent()) setPending({ context: pendingContext, reload: pendingReload, ...value }); };
    if (known) {
      publish({ status: 'single', item: known, count: 1, error: null });
      return stop;
    }
    // Invalida a ação anterior antes de consultar de novo.
    publish(initialPendingState(pendingIds));
    confirmSinglePending(client, pendingIds[0], { fetchPendingItem: fetchPendingEvaluationHistoryItem, isCurrent })
      .then(result => { if (result) publish(result); })
      .catch(error => publish({ status: 'error', item: null, count: 1, error: errorKind(error) }));
    return stop;
    // pendingIds é representado por pendingKey/pendingContext.
  }, [enabled, focused, key, client, returnStateVersion, pendingKey, pendingReload, known, pendingDeferred]);

  const historyView = history.key === key && key !== null ? history : { key, ...HISTORY_LOADING };
  // Sem identidade verificada nada é afirmado: nem ausência nem pendência.
  const pendingView = !key ? { status: 'checking', item: null, count: 0, error: null }
    : pendingIds.length !== 1 ? initialPendingState(pendingIds)
      : pending.context === pendingContext && pending.reload === pendingReload
        ? { status: pending.status, item: pending.item, count: pending.count, error: pending.error }
        : initialPendingState(pendingIds);

  return {
    ...historyView,
    pending: pendingView,
    retry: () => setHistoryReload(value => value + 1),
    retryPending: () => setPendingReload(value => value + 1),
  };
}
