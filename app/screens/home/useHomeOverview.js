import { useEffect, useRef, useState } from 'react';

import {
  fetchParticipationHistory,
  fetchPendingEvaluationHistoryItem,
} from '../../services/participationHistoryService.js';
import {
  confirmSinglePending, initialPendingState, loadRecentParticipation, pendingEvaluationIds,
} from '../../utils/homeOverview.js';

const HISTORY_LOADING = { status: 'loading', recent: null, error: null, refreshing: false };
const CHECKING = { status: 'checking', item: null, count: 0, error: null };

// Identidade estável por instância de cliente HTTP (para compor o contexto sem serializar objetos).
const clientTokens = new WeakMap();
let nextClientToken = 0;
function clientToken(client) {
  if (!client || (typeof client !== 'object' && typeof client !== 'function')) return 'none';
  if (!clientTokens.has(client)) clientTokens.set(client, `c${++nextClientToken}`);
  return clientTokens.get(client);
}

function errorKind(error) {
  if (error?.status === 401 || error?.status === 403) return 'authorization';
  if (error?.isNetworkError || error?.isTimeout) return 'network';
  return 'unavailable';
}

/**
 * Visão da Home para a conta e sessão atuais, em dois estados independentes:
 *
 * - histórico: `loading | empty | history | error`;
 * - avaliação pendente: `none | checking | single | multiple | error`.
 *
 * R02: cada dado guarda o contexto em que foi confirmado (conta, época, identidade verificada,
 * instância do cliente HTTP, versão do retorno, IDs pendentes, ciclo de foco e de nova tentativa).
 * A seleção do que é exibido acontece **no render**, antes de qualquer efeito: um contexto novo
 * nunca mostra vazio antigo como conclusão atual, nem avaliação antiga clicável, nem dados de
 * outro cliente/sessão. Só um histórico já confirmado da mesma conta, sessão e cliente continua
 * visível, marcado como `refreshing`. Respostas fora de ordem são descartadas por geração.
 * `knownPending` reaproveita a confirmação da retomada C-04/D09 na mesma versão do retorno;
 * `pendingDeferred` adia a checagem enquanto essa retomada ainda consulta.
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

  // Ciclo de foco calculado no render: voltar ao foco é um novo contexto de leitura.
  const focusCycle = useRef(0);
  const lastFocused = useRef(focused);
  if (focused && !lastFocused.current) focusCycle.current += 1;
  lastFocused.current = focused;
  const cycle = focusCycle.current;

  const historyGeneration = useRef(0);
  const pendingGeneration = useRef(0);
  const [historyReload, setHistoryReload] = useState(0);
  const [pendingReload, setPendingReload] = useState(0);
  const [history, setHistory] = useState({ context: null, key: null, client: null, ...HISTORY_LOADING });
  const [pending, setPending] = useState({ context: null, ...CHECKING });

  const historyContext = key ? `${key}|${clientToken(client)}|${returnStateVersion}|${cycle}|${historyReload}` : null;
  const pendingContext = key
    ? `${key}|${clientToken(client)}|${returnStateVersion}|${pendingKey}|${cycle}|${pendingReload}` : null;
  const known = knownPending && pendingIds.length === 1 && knownPending.version === returnStateVersion
    && knownPending.participationId === pendingIds[0] && knownPending.item?.participationId === pendingIds[0]
    ? knownPending.item : null;

  useEffect(() => {
    const requestId = ++historyGeneration.current;
    if (!enabled || !focused || !key) return () => { historyGeneration.current += 1; };
    const isCurrent = () => requestId === historyGeneration.current;
    const context = historyContext;
    // Só um histórico confirmado da mesma conta/sessão/cliente permanece visível durante a atualização.
    setHistory(previous => (previous.key === key && previous.client === client && previous.status === 'history'
      ? { ...previous, context, refreshing: true } : { context, key, client, ...HISTORY_LOADING }));
    loadRecentParticipation(client, { fetchHistory: fetchParticipationHistory, isCurrent }).then(recent => {
      if (!isCurrent() || recent === undefined) return;
      setHistory({ context, key, client, status: recent ? 'history' : 'empty', recent, error: null, refreshing: false });
    }).catch(error => {
      if (!isCurrent()) return;
      setHistory({ context, key, client, ...HISTORY_LOADING, status: 'error', error: errorKind(error) });
    });
    return () => { historyGeneration.current += 1; };
  }, [enabled, focused, historyContext]);

  useEffect(() => {
    const requestId = ++pendingGeneration.current;
    const stop = () => { pendingGeneration.current += 1; };
    // Retomada C-04/D09 ainda consultando a mesma pendência: aguardar e reaproveitar o resultado dela.
    if (!enabled || !focused || !key || pendingIds.length !== 1 || pendingDeferred) return stop;
    const isCurrent = () => requestId === pendingGeneration.current;
    const context = pendingContext;
    const publish = value => { if (isCurrent()) setPending({ context, ...value }); };
    if (known) {
      publish({ status: 'single', item: known, count: 1, error: null });
      return stop;
    }
    publish(initialPendingState(pendingIds));
    confirmSinglePending(client, pendingIds[0], { fetchPendingItem: fetchPendingEvaluationHistoryItem, isCurrent })
      .then(result => { if (result) publish(result); })
      .catch(error => publish({ status: 'error', item: null, count: 1, error: errorKind(error) }));
    return stop;
    // pendingIds/client estão representados em pendingContext.
  }, [enabled, focused, pendingContext, known, pendingDeferred]);

  // Seleção no render (antes dos efeitos).
  let historyView;
  if (!key) historyView = HISTORY_LOADING;
  else if (history.context === historyContext) historyView = history;
  else if (history.key === key && history.client === client && history.status === 'history') {
    historyView = { ...history, refreshing: true };
  } else historyView = HISTORY_LOADING;

  let pendingView;
  // Sem identidade verificada nada é afirmado: nem ausência nem pendência.
  if (!key) pendingView = CHECKING;
  else if (pendingIds.length !== 1) pendingView = initialPendingState(pendingIds);
  else if (known && !pendingDeferred) pendingView = { status: 'single', item: known, count: 1, error: null };
  else if (pending.context === pendingContext) {
    pendingView = { status: pending.status, item: pending.item, count: pending.count, error: pending.error };
  } else pendingView = initialPendingState(pendingIds);

  return {
    status: historyView.status,
    recent: historyView.recent,
    error: historyView.error,
    refreshing: Boolean(historyView.refreshing),
    pending: pendingView,
    retry: () => setHistoryReload(value => value + 1),
    retryPending: () => setPendingReload(value => value + 1),
  };
}
