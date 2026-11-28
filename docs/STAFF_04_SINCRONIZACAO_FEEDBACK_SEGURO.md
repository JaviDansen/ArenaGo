# ArenaGo — STAFF-04 | Sincronização e Feedback Seguro

### Escopo autorizado STAFF04-VAL-10 — 27/11/2026

Implementar o reset visual no ciclo de vida da visita da Estação, preservando intenções persistidas, refresh no mesmo contexto e guards de callbacks antigos. Preparar cobertura A–G e procedimento ambiental comparativo para ENV-VAL-01. Esta rodada permite implementação e inspeção estática; testes, lint, typecheck e build ficam para Luna Medium. Os resultados anteriores não validam a nova alteração.

Revisão diretamente relacionada identificou duas lacunas adicionais de visita: o catch de refresh verificava escopo antes de tratar 401/403, mas não a visita; o retorno de cancelReserved também verificava só escopo. Ao retornar à mesma estação, callbacks dessas visitas anteriores poderiam alterar a visita atual. Serão acrescentadas guards de visita nesses dois pontos, sem modificar contratos de persistência ou regras de autorização.

## 1. Objetivos e Escopo

- **Projeto:** ArenaGo — ProgramacaoMobile (`JaviDansen/ArenaGo`)
- **Task:** STAFF-04 — Sincronização e Feedback Seguro
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base de referência (`HEAD` inicial verificado):** `6c77c3b515ef4ed47607250081055868cc803a30` (`Correções da Auditoria Independente — Rodada 2` da STAFF-03)
- **Status do ciclo (27/11/2026):** campanha automatizada local conjunta STAFF-03/STAFF-04 aprovada conforme a consolidação final deste documento: Backend 1.299/1.299, App 995/995 e QA independente 51/51. VAL-09/VAL-10 foram revalidadas nas suítes focadas e regressões App finais; ENV-VAL-01 foi superado pelo runner oficial no PowerShell convencional, embora sua causa específica no Codex permaneça desconhecida. Homologação Expo, integração PostgreSQL dedicada e aprovação formal continuam pendentes.

### Contexto das entregas anteriores

- **STAFF-01:** Seleção de Eventos e Painel Operacional — concluída e aprovada ([STAFF_01_SELECAO_EVENTOS_PAINEL.md](./STAFF_01_SELECAO_EVENTOS_PAINEL.md)).
- **STAFF-02:** Estação, Fila e Atendimento — concluída, testada, homologada e aprovada ([STAFF_02_ESTACAO_FILA_ATENDIMENTO.md](./STAFF_02_ESTACAO_FILA_ATENDIMENTO.md)).
- **STAFF-03:** Controle de Entrada e Integração da Chamada Externa — implementação e duas rodadas de auditoria estática concluídas (`6c77c3b515ef4ed47607250081055868cc803a30`), com campanha automatizada e homologação adiadas deliberadamente para execução conjunta com a STAFF-04 ([STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md](./STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md)).

### Objetivo geral da STAFF-04

Consolidar a sincronização automática, a recuperação segura de leituras após falhas transitórias, o tratamento rigoroso de falhas de conexão e autorização, a preservação de intenções persistidas e a padronização do feedback operacional em todas as superfícies reais do módulo Staff, mantendo o **backend como fonte única e oficial da verdade operacional**.

### Seleção de modelos e níveis de raciocínio (conforme [AGENTS.md](../AGENTS.md))

- **Implementação da STAFF-04:** **GPT-6.1 Sol — High** (coordenação entre múltiplos stores Staff, ciclo de vida de polling, isolamento de autorização, feedback operacional padronizado e preparação de testes unitários/integração sem enfraquecer garantias de idempotência).
- **Execução da campanha conjunta STAFF-03 + STAFF-04:** **GPT-6 Luna — Medium** (executor padrão designado em [AGENTS.md](../AGENTS.md); nenhum teste automatizado, lint, typecheck, build ou acesso a PostgreSQL é executado durante a implementação).
- **Revisão crítica opcional (concorrência, autorização e idempotência):** **GPT-6 Astra — High** antes da homologação final, caso solicitado pelo responsável.

### Restrições explícitas de escopo

Fora de escopo nesta task:
- Reconstrução visual das telas aprovadas nas STAFF-01, STAFF-02 e STAFF-03.
- Alteração de regras de FIFO, janelas temporais, ausência, remoção, conclusão ou encerramento de eventos.
- Modificação desnecessária do contrato `externalEntryCall` entregue na STAFF-03.
- Implementação de notificações push, WebSockets ou canais paralelos entre dispositivos.
- Replay automático de mutações com resultado desconhecido ou liberação insegura de intenções persistidas.
- Criação de migrations, alteração estrutural da retenção de idempotência ou execução em bancos PostgreSQL/Neon.
- Implementação das telas visuais do Participante (responsabilidade exclusiva do Heliom).
- Implementação antecipada da STAFF-05 (aprofundamento arquitetural de concorrência).

---

## 2. Diagnóstico Inicial (Base `6c77c3b515ef4ed47607250081055868cc803a30`)

Antes de qualquer alteração em arquivos de produção ou teste, o estado real do repositório foi inspecionado:

1. **Estado do Git:** branch `feature/staff-operacional-v2` sincronizada com `origin/feature/staff-operacional-v2` no commit `6c77c3b515ef4ed47607250081055868cc803a30`, working tree limpo e [qa-evidence/STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) preservado.
2. **Fluxos de sincronização existentes:**
   - [useStaffPolling.js](../app/screens/staff/useStaffPolling.js): hook de ciclo único pós-conclusão; na revisão estática inicial em `6c77c3b`, a flag local `running` já serializava leituras dentro da mesma execução do `useEffect`, mas não sobrevivia a pausas/retomadas (`enabled`, `useIsFocused()`, `AppState`) enquanto o GET anterior ainda permanecia pendente (corrigido na Rodada 1 com registro persistente em `useRef` por `scope`). Respeita `useIsFocused()`, `AppState === 'active'`, `enabled`, `intervalMs` e `scope`.
   - **Seleção de eventos (`StaffEventsScreen`):** consulta `GET /api/v1/staff/events` via [staffEventsService.js](../app/services/staffEventsService.js) na carga inicial e em polling de **60 segundos** (`refreshSilent`).
   - **Painel Operacional (`StaffEventHomeScreen` + `StaffEventDashboard`):** consulta `GET /staff/events` a cada **60 segundos** (para atualizar `effectivePhase` do evento selecionado), `GET /staff/events/:eventId/stations` a cada **5 segundos**, `GET /staff/events/:eventId/entry-control` a cada **5 segundos** e `GET /staff/events/:eventId/experiences` na entrada do painel (com recuperação automática de **5 segundos** em erro transitório/stale e sincronização controlada de experiências órfãs via `syncOrphanExperiences`). Ao retornar de `entry` ou `station` para `panel`, dispara `store.revalidateOnReturn()`.
   - **Estação — Fila e Atendimento (`StaffStationOperationalScreen` + `StaffEventDashboard` em `section === 'station'`):** consulta `GET /staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state` a cada **5 segundos**, além de `pollStations` (5s) e `pollQueue` (5s) no dashboard pai. Pausa o polling de `operational-state` durante modais de confirmação abertos, `busy`, `dispatching` e `acknowledging` (política aprovada na STAFF-02).
   - **Controle de Entrada (`StaffEntryControlRealScreen` + [staffEntryService.js](../app/services/staffEntryService.js)):** consulta `GET /staff/events/:eventId/entry-control` a cada **5 segundos**. Mantém o polling **ativo durante modais de confirmação** com invalidação automática de confirmações obsoletas (`evaluateEntryDialog`) e neutralização de callbacks antigos (decisão aprovada na STAFF-03).
3. **Estados de carregamento, erro e recuperação encontrados na base:**
   - `pollStations`, `pollExperiences` e `pollEntryControl` no dashboard já distinguiam falha inicial recuperável (`network`/`unavailable` com retry automático por GET) de falha após carga válida (`stale`, preservando os últimos dados válidos).
   - Em contrapartida, `staffEventsService.refreshSilent`, `staffDashboardService.pollQueue`, `staffEntryService.poll` e `StaffStationOperationalScreen.poll` exigiam `status === 'ready'` tanto no serviço quanto na flag `enabled` do hook — impedindo recuperação automática caso o **primeiro carregamento** falhasse por rede, timeout, HTTP 503 ou resposta malformada.
4. **Regras existentes de bloqueio de operações:**
   - **Estações:** bloqueia mutações quando `busy`, `stale`, `!coordinator`, `accessDenied`, `pending` ativo (`reserved`, `dispatching`/`pending_reconciliation`, `terminal_pending`, `pending_other`, `storage_error`), `!data.canCall`, estação `unavailable` ou modal em curso. Protege contra duplo toque via ref `dispatching` e persistência pré-envio.
   - **Controle de Entrada:** bloqueia mutações quando `busy`, `stale`, `accessDenied`, `storageError`, `pending` ativo (`reserved`, `dispatching`, `terminal` aguardando reconhecimento ou outro contexto), `canManage === false` (respeitando janela residual `canMarkAbsent`/`canRemove`) ou flags individuais falsas (`canCall`, `canConfirm`, `canMarkAbsent`, `canRemove`).
5. **Mecanismos de persistência e reconhecimento de intenções (duas arquiteturas separadas — preservadas):**
   - **Estações ([staffIntentStorage.js](../app/services/staffIntentStorage.js) + [staffOperationsService.js](../app/services/staffOperationsService.js)):** 3 chaves por usuário (`arenago.staff.operation.<userId>`, `.receipt`, `.ack`) com ciclo `reserved → dispatching → terminal → clear → acknowledge (pending → completed)`.
   - **Controle de Entrada ([staffEntryIntentStorage.js](../app/services/staffEntryIntentStorage.js) + [staffEntryService.js](../app/services/staffEntryService.js)):** slot lógico único (`arenago.staff.entry.<userId>`) com transições lógicas `reserved → dispatching → terminal → acknowledged` ou `cancelled`.
6. **Diferenças legítimas preservadas entre superfícies Staff:**
   - Estações pausam polling de `operational-state` enquanto o modal de confirmação está aberto (STAFF-02); Controle de Entrada mantém o polling de 5s ativo durante modais com invalidação automática de chamada/permissão/contagem D06 (STAFF-03).
   - Seleção de eventos e fase do evento operam em 60s (conforme [STAFF_B1_IMPLEMENTACAO.md](./STAFF_B1_IMPLEMENTACAO.md)), enquanto leituras operacionais operam em 5s.
   - Negativa `404` em `operational-state` executa revalidação contextual via `GET /stations` (STAFF-02) para distinguir estação inexistente de revogação do evento ou erro transitório (`accessUncertain`).

---

## 3. Matriz dos Mecanismos Existentes (Diagnóstico Inicial em `6c77c3b`)

| Superfície | Polling | Recuperação | Autorização | Feedback | Intenções |
|---|---|---|---|---|---|
| **Seleção de eventos** (`StaffEventsScreen` + `staffEventsService.js`) | 60s (`refreshSilent`), ativo apenas quando `status === 'ready'`. Sem indicador visual de polling na tela. | Recuperava após `stale`, mas **não** recuperava automaticamente após falha no primeiro carregamento (`network`/`unavailable`). Timeout caía em `unavailable`. | `401` limpava eventos/seleção (`session`). `403` não era distinguido de `unavailable` em `refresh()` e caía em `session` em `refreshSilent()`. | Exibia loading, erro (`session`/`network`/`unavailable`), `stale` e lista vazia. Sem indicador de sincronização. | Não aplicável (superfície somente leitura). |
| **Painel Operacional** (`StaffEventDashboard` + `staffDashboardService.js`) | 5s para `/stations`, `/entry-control` e `/experiences` (em erro/stale); 60s para fase (`refreshSilent`). Sem indicador visual de polling no painel. | `pollStations`, `pollExperiences` e `pollEntryControl` já recuperavam após falha inicial; timeout caía em `unavailable` em `errorKind`. Revalidava ao voltar (`revalidateOnReturn`). | `401`/`403`/`404` ativavam `accessLocked`, limpavam dados protegidos e propagavam/recebiam bloqueio das subtelas. | Exibia resumo real, badges de fila externa/estação, erros, `verifyingAccess` e alerta `stale`. Sem indicador de estado do polling. | Não executa mutações diretamente; preserva intenções das subtelas no `SecureStore`. |
| **Estação — Fila** (`StaffStationOperationalScreen` Estado A + `pollQueue`) | 5s para `operational-state`, `pollStations` e `pollQueue`. Indicador visual de polling presente. | `operational-state` e `pollQueue` recuperavam de `stale`, mas **não** recuperavam automaticamente após falha no carregamento inicial (`network`/`unavailable`). Timeout caía em `unavailable`. | `401`/`403` limpavam dados e propagavam `onAccessDenied`; `404` acionava verificação contextual via `/stations` (STAFF-02). | Mostrava fila FIFO, vazio, indisponível, encerramento e alerta `stale`. Confirmação de chamada usava texto genérico; recusas não mapeavam códigos reais do backend; sem estado visual `busy`. | `staffIntentStorage.js` (3 chaves + `Idempotency-Key`); bloqueia `callNext` em `reserved`/`dispatching`/`terminal_pending`/`pending_other`/`storage_error`. |
| **Estação — Atendimento** (`StaffStationOperationalScreen` Estado B) | 5s para `operational-state`, pausado durante modal de confirmação, `busy`, `dispatching` e `acknowledging` (STAFF-02). Indicador visual presente. | Igual à Estação — Fila: recuperação após `stale` ativa, mas não após falha inicial transitória. | Igual à Estação — Fila, com fechamento de modal e neutralização de callback antigo em `401`/`403`/`404`. | Ausência distinguia `requeued`, porém `complete` e `remove_called` exibiam texto genérico; recusas ignoravam códigos backend (`SERVICE_NOT_PENDING`, `EVENT_OPERATION_ENDED`, etc.); `uncertain`/`cleanup_pending`/`storage_error` colapsavam na mesma frase. | `staffIntentStorage.js` + reconciliação automática segura de `terminal_pending`; nunca repete mutação desconhecida automaticamente. |
| **Controle de Entrada** (`StaffEntryControlRealScreen` + `staffEntryService.js`) | 5s para `/entry-control`, mantido **ativo durante modais** com invalidação automática `evaluateEntryDialog` (STAFF-03). Indicador visual presente. | Recuperava após `stale`, mas `poll()` e `pollingEnabled` exigiam `status === 'ready'`, impedindo recuperação automática após falha inicial (`network`/`timeout`/`503`/inválida). | `401`/`403`/`404` ativavam `revokedKind`, limpavam dados nominais, fechavam modais, neutralizavam callbacks e propagavam `onAccessDenied`, preservando `SecureStore`. | `call`/`confirm_call`/`remove`/`toggle` claros, mas `absent` **não** distinguia `requeued: true` vs `false`; recusas mapeavam somente `ENTRY_NOT_FIRST`; sem indicador visual `busy`/`acknowledging`; recusa definitiva com erro de gravação local não tinha aviso específico. | `staffEntryIntentStorage.js` (slot lógico único com `reserved`/`dispatching`/`terminal`/`acknowledged`/`cancelled`); nunca repete mutação desconhecida automaticamente. |

---

## 4. Lacunas Identificadas

Com base na inspeção direta do código em `6c77c3b515ef4ed47607250081055868cc803a30`, foram confirmadas sete lacunas concretas:

1. **Interrupção permanente da sincronização após falha transitória no primeiro carregamento (Parte A — 5.2):**
   - `staffEventsService.js` (`refreshSilent`) e `StaffEventsScreen`: exigiam `status === 'ready'`. Se o primeiro `GET /staff/events` falhasse por rede, timeout, 503 ou payload inválido, o polling de 60s nunca voltava a tentar automaticamente.
   - `staffEntryService.js` (`poll`) e `StaffEntryControlRealScreen.js`: exigiam `status === 'ready'`, interrompendo o polling de 5s após falha inicial transitória.
   - `StaffStationOperationalScreen.js` (`poll` e `pollingEnabled`): exigiam `view.status === 'ready'`, interrompendo a recuperação por GET a cada 5s após falha inicial transitória em `/operational-state`.
   - `staffDashboardService.js` (`pollQueue`) e `StaffEventsNavigator.js`: exigiam `queueStatus === 'ready'`, diferentemente de `pollStations`/`pollExperiences`/`pollEntryControl`.
2. **Classificação incompleta de `timeout` e `403` em serviços de leitura (Parte A — 5.2 e Parte E):**
   - `staffEventsService.js`, `staffDashboardService.js` e `StaffStationOperationalScreen.js` não classificavam `error?.isTimeout` como `'network'` (caindo em `'unavailable'`).
   - `staffEventsService.js` não distinguia `403` (`'denied'`) de `'unavailable'`/`'session'`.
3. **Ausência de indicadores honestos de sincronização na Seleção de Eventos e no Painel Operacional (Parte B — 6.4):**
   - `StaffEventsScreen` (60s) e `StaffEventDashboard` (5s) não exibiam indicador de polling atrelado a `useIsFocused()` e `AppState`; além disso, `stale` durante pausa de foco/segundo plano não sinalizava que a tentativa estava pausada.
4. **Feedback incompleto para resultados confirmados no Controle de Entrada e nas Estações (Parte B — 6.2):**
   - Em `StaffEntryControlRealScreen.js`, `absent` exibia sempre `"Ausência registrada pelo servidor."`, sem diferenciar `requeued: true` (retorno ao fim da fila) de `requeued: false` (sem retorno após o corte de entrada).
   - Em `StaffStationOperationalScreen.js`, `call`, `complete` e `remove_called` exibiam todas a frase genérica `"Operação confirmada pelo servidor."`, sem identificar a ação efetivamente confirmada.
5. **Mapeamento incompleto dos códigos reais de recusa do backend (Parte B — 6.3):**
   - Em `StaffEntryControlRealScreen.js`, apenas `ENTRY_NOT_FIRST` tinha mensagem contextual; os demais códigos já aceitos pelo serviço (`ENTRY_QUEUE_EMPTY`, `ENTRY_CALL_PENDING`, `ENTRY_CALL_REQUIRED`, `ENTRY_CALL_NOT_PENDING`, `EVENT_ENTRY_UNAVAILABLE`, `STAFF_EVENT_FORBIDDEN`, `FORBIDDEN`, `SESSION_REVOKED`, `UNAUTHORIZED`) caíam no genérico.
   - Em `StaffStationOperationalScreen.js`, nenhum dos códigos reais já validados em `staffOperationsService.js` (`QUEUE_EMPTY`, `STATION_UNAVAILABLE`, `STATION_HAS_PENDING_CALL`, `SERVICE_NOT_PENDING`, `EVENT_OPERATION_ENDED`, `QUEUE_ENTRY_NOT_WAITING`, `STAFF_EVENT_FORBIDDEN`, `FORBIDDEN`, `SESSION_REVOKED`, `UNAUTHORIZED`) possuía mensagem contextual.
6. **Diferenciação insuficiente entre processamento em andamento, resultado incerto, falha de reconhecimento local e armazenamento indisponível (Parte B — 6.1, Parte C — 7.3 e Parte D — 8.2):**
   - Em `StaffStationOperationalScreen.js`, `uncertain`, `pending_reconciliation`, `confirmed_cleanup_pending`, `rejected_cleanup_pending` e `storage_error` colapsavam na mesma mensagem genérica, e `blocked` (pré-condição alterada antes do envio) não exibia aviso.
   - Em `StaffEntryControlRealScreen.js`, recusa definitiva com falha na escrita do recibo local (`knownOutcome.kind === 'rejected'` com `pending.phase !== 'terminal'`) não apresentava aviso específico.
   - Em ambas as telas operacionais, o estado `busy` / reconhecimento em andamento desabilitava botões sem apresentar indicador visual explícito de processamento.
7. **Lacunas de cobertura automatizada para cenários STAFF-04 (Seção 11):**
   - Faltavam testes validando recuperação automática após falha inicial (`network`/`timeout`/`503`/malformada) com preservação de `SecureStore`, indicadores honestos nas 5 superfícies, diferenciação de `absent` (`requeued`), todos os códigos reais de recusa, fallback seguro sem vazamento técnico, processamento `busy` e fluxos ponta a ponta com troca de sessão/conta.

---

## 5. Decisões Técnicas

1. **Preservação integral das arquiteturas aprovadas nas STAFF-01, STAFF-02 e STAFF-03:**
   - Mantido [useStaffPolling.js](../app/screens/staff/useStaffPolling.js) como mecanismo único por ciclo concluído (5s operacional, 60s eventos/fase).
   - Mantidos [staffIntentStorage.js](../app/services/staffIntentStorage.js) (estações — 3 chaves) e [staffEntryIntentStorage.js](../app/services/staffEntryIntentStorage.js) (entrada — slot lógico único) separados, sem unificação artificial de formato nem enfraquecimento de garantias.
   - Mantida a pausa do polling operacional durante modais nas **Estações** (STAFF-02) e mantido o polling de 5s ativo com invalidação automática `evaluateEntryDialog` durante modais no **Controle de Entrada** (STAFF-03).
   - Mantida a revalidação contextual de HTTP `404` das estações via `GET /stations` (STAFF02-AUD-01), garantindo que **Caso C** (`404` seguido de `500`/rede em `/stations`, com `accessUncertain = true`) **não** inicie polling automático (`autoRecoverable: false`), enquanto falhas iniciais transitórias normais em `/operational-state` (sem `404`) habilitam recuperação automática segura por GET.
   - Mantido integralmente o contrato `externalEntryCall` do Participante (`GET /api/v1/participations/current`) sem qualquer edição nas telas do Heliom.
2. **Recuperação segura por GET após falha transitória inicial:**
   - Habilitada recuperação automática por GET somente para erros transitórios (`network` ou `unavailable`), nunca para `session` (`401`), `denied` (`403`/`404`), `verifying` ou `accessUncertain`.
   - Na recuperação automática a partir de erro inicial (`!wasReady`) em [staffEntryService.js](../app/services/staffEntryService.js) e [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), o armazenamento seguro (`storage.get` / `coordinator.pending`) é consultado **antes** de publicar `status: 'ready'`, garantindo que intenções `reserved`, `dispatching` ou `terminal_pending` continuem bloqueando mutações após reconexão.
3. **Módulo compartilhado de feedback e indicadores ([StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js)):**
   - Criado componente/helper puro com tokens visuais oficiais de [AdminLiveUI.js](../app/screens/admin/components/AdminLiveUI.js), sem novo padrão visual e sem qualquer import demonstrativo.
   - Registrado no inventário `realStaffScreens` de [staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs) e na allowlist `control.realStaff` de [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs).

---

## 6. Correções Implementadas

1. **[app/screens/staff/components/StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js) *(novo)*:**
   - Exporta `resolveStaffPollingIndicator`, `StaffPollingStatusPill`, `describeEntryConfirmed`, `describeEntryRejection`, `describeEntryNotice`, `describeStationConfirmed`, `describeStationRejection` e `describeStationFeedback`.
   - Mapeia exclusivamente os códigos reais de recusa já retornados pelo backend e validados pelos serviços Staff, com fallback seguro que nunca exibe códigos HTTP, SQL, stack traces ou códigos internos desconhecidos.
2. **[app/services/staffEventsService.js](../app/services/staffEventsService.js):**
   - Adicionados `eventsErrorKind` (`401 → session`, `403 → denied`, `isNetworkError || isTimeout → network`, demais → `unavailable`) e `isRecoverableEventsError`.
   - Atualizado `refreshSilent()` para permitir recuperação automática por GET quando `status === 'error' && isRecoverableEventsError(error)`, mantendo limpeza total e bloqueio de novas tentativas em `401`/`403`, e protegendo o reset de `silentFlight` por `requestGeneration === generation` e em `setIdentity`/`refresh`.
3. **[app/services/staffDashboardService.js](../app/services/staffDashboardService.js):**
   - Classificação uniforme de `error?.isTimeout` como `'network'` em `errorKind`.
   - Atualizado `pollQueue()` para permitir recuperação automática segura por GET após falha transitória inicial (`queueStatus === 'error' && isRecoverableError(queueError)`), mantendo `queue: null` se a falha persistir (sem fabricar fila vazia) e interrompendo em `401`/`403`/`404`.
4. **[app/services/staffEntryService.js](../app/services/staffEntryService.js):**
   - Atualizado `poll()` para permitir recuperação automática por GET quando `status === 'error'` com `network`/`unavailable` e `!revokedKind`, lendo `storage.get(context.userId)` antes de publicar `{ status: 'ready', data, error: null, pending, storageError }` e preservando `status: 'error', data: null` se a consulta continuar falhando.
5. **[app/screens/staff/StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js):**
   - `StaffEventsScreen`: observa `useIsFocused()` e `AppState`, habilita polling de 60s também em erro inicial recuperável (`network`/`unavailable`) quando `!accessLocked`, exibe mensagem específica para `denied` (`403`) e apresenta `<StaffPollingStatusPill indicator={eventsPollingIndicator} />`.
   - `StaffEventDashboard`: observa `useIsFocused()` e `AppState`, habilita recuperação automática em `pollQueue` para erro inicial transitório, consolida como fonte única dentro do evento selecionado o `useStaffPolling(..., 60000)` de `Eventos e fase` (cobrindo Painel, Controle de Entrada e Estação com a mesma condição `eventPhasePollingEnabled` do indicador), separa `operationalStale` (5s) de `eventPhaseStale` (`60s` em `Eventos e fase`) e apresenta `<StaffPollingStatusPill indicator={panelPollingIndicator} />` e `<StaffPollingStatusPill indicator={eventPhaseIndicator} />`.
6. **[app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js) + [app/services/staffOperationsService.js](../app/services/staffOperationsService.js):**
   - Classificação uniforme de `error?.isTimeout` como `'network'` em `refresh()` e `handleStationNotFound()`.
   - Trava de voo/sequência em `poll()` (`pollingFlight`/`pollSeq`), guarda individual por leitura preliminar (`createPreconditionAuthGuard` observando `fetchStaffQueue` e `fetchStaffStations` em paralelo sem ocultar `401`/`403` atrás de `503`/rede concorrente), barreira síncrona `!revokedKindRef.current` durante `reserve()`/`dispatch()` e callback `onAuthError` em [staffOperationsService.js](../app/services/staffOperationsService.js) antes de `storage.recordTerminal()`/`clear()`, bloqueando UI e Painel imediatamente mantendo a persistência do recibo `.receipt` para a intenção original; `404` contextual mantido via `/operational-state` + `/stations`.
   - Isolamento estrito de contexto e visita (`visitIdRef`, `opSeqRef`, `activeOpIdRef` + escopo completo de 6 campos `userId`, `sessionId`, `eventId`, `stationId`, `epoch`, `revision` e `!accessDenied`) para qualquer publicação tardia de feedback ou `onStage`, além de revalidação GET direta em `refresh()` (`fetchStaffStationState`) limpando `revokedKindRef.current` apenas após resposta `200` válida da visita/geração corrente (enquanto a recuperação oficial sob `accessDenied` ocorre pelo retorno ao Painel em `Atualizar estações`).
   - Flag explícita `autoRecoverable` diferenciando erro inicial transitório de leitura (`autoRecoverable: true`, habilitando recuperação por GET a cada 5s com releitura obrigatória de `coordinator.pending(scope)` antes de liberar `ready`) de erro de acesso incerto após `404` / falha de `SecureStore` (`autoRecoverable: false`, preservando integralmente STAFF02-AUD-01 Caso C).
   - Adoção de `describeStationFeedback`, `resolveStaffPollingIndicator` e `<StaffPollingStatusPill />`, mantendo a pausa de polling durante modais (STAFF-02).
   - Adição do banner explícito de processamento (`view.busy` + `busyKind`) diferenciando `"Verificando condições antes do envio..."`, `"Preparando solicitação com segurança..."`, `"Registrando envio seguro..."`, `"Processando operação no servidor..."`, `"Registrando resultado com segurança..."`, `"Finalizando reconhecimento seguro local..."` e `"Descartando solicitação não enviada..."`.
7. **[app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) + [app/services/staffEntryService.js](../app/services/staffEntryService.js):**
   - Habilitação de `pollingEnabled` também para erro inicial recuperável (`network`/`unavailable`) quando `!revokedKind`, mantendo polling de 5s ativo durante modais com invalidação `evaluateEntryDialog` (STAFF-03).
   - Reação imediata a `401`/`403` em `mutate()` (limpando `data` e encerrando `busy`/`busyKind` antes de `storage.finish()`), trava síncrona `revokedKind` entre `reserve()`, `dispatch()` e HTTP (cancelando apenas `reserved` não enviada e preservando `dispatching`) e supressão de GET extra pós-negativa.
   - Adoção de `describeEntryNotice`, `resolveStaffPollingIndicator` e `<StaffPollingStatusPill />` (incluindo diferenciação de `absent` com `requeued: true` vs `false` e todos os códigos reais de recusa do backend).
   - `busyKind` geracional na store e banner explícito na tela diferenciando `"Preparando solicitação com segurança..."`, `"Registrando envio seguro..."`, `"Processando operação no servidor..."`, `"Registrando resultado com segurança..."`, `"Finalizando reconhecimento seguro local..."` e `"Descartando solicitação não enviada..."` (sem inferir descarte via `pending?.phase === 'reserved'`), além de aviso dedicado para `knownOutcome.kind === 'rejected'` quando a gravação local do recibo falha.

---

## 7. Fluxos de Sincronização (Matriz Comparativa Antes × Depois)

| Superfície / Aspecto | Antes da STAFF-04 (`6c77c3b`) | Depois da STAFF-04 |
|---|---|---|
| **Seleção de eventos (60s)** | Falha no primeiro GET interrompia polling permanentemente; `403` não separado de `unavailable`; sem indicador visual de sincronização. | Recuperação automática por GET a cada 60s em `network`/`timeout`/`503`/inválida; `403` separado como `denied` com trava `accessLocked` contra `200`/`503` atrasados; indicador honesto ligado a foco e `AppState`. |
| **Painel Operacional (5s + 60s fase)** | Sem indicador visual de polling; `timeout` classificado como `unavailable`; `experienceError`/`staff.error === 'stale'` não apareciam no aviso de desatualização do painel. | Indicador operacional de `5s` (`stations`/`experiences`/`entry-control`/`accessUncertain`/`verifyingAccess`) separado do indicador dedicado de **Eventos e fase (`60s`)**, com `timeout` classificado como `network`, banners `stale` separados e sinalização explícita de recuperação manual em `accessUncertain`/`accessLocked`. |
| **Estação — Fila e Atendimento (5s)** | Falha inicial em `/operational-state` ou `/queue` interrompia polling até ação manual; sem estado visual `busy`; `call`/`complete`/`remove_called` com texto genérico; recusas sem mapeamento de códigos backend; `uncertain`/`cleanup_pending`/`storage_error` com texto único. | Recuperação automática por GET a cada 5s em falhas transitórias iniciais (reconsultando `SecureStore` antes de liberar `ready`), preservando Caso C (`404`→`500`) sem polling automático (`aguardando recuperação manual`); trava contra `poll()` concorrente; reação imediata a `401`/`403` em pré-condições paralelas e mutações; isolamento completo de contexto/visita; estágios `busy` distintos (`precondition`/`preparing`/`dispatching`/`mutating`/`persisting`/`acknowledging`/`cancelling`); falhas prévias sem afirmar envio; mapeamento de códigos backend e pausa durante modais preservada (STAFF-02). |
| **Controle de Entrada (5s)** | Falha inicial em `/entry-control` interrompia polling; sem estado visual `busy`; `absent` não distinguia `requeued: true` vs `false`; recusas mapeavam apenas `ENTRY_NOT_FIRST`; recusa com erro de gravação local sem mensagem própria. | Recuperação automática por GET a cada 5s em falhas transitórias iniciais (preservando intenções do `SecureStore` antes de liberar `ready`); reação imediata a `401`/`403` em mutação sem aguardar GET ou gravação local; estágios `busy` distintos (`preparing`/`dispatching`/`mutating`/`persisting`/`acknowledging`/`cancelling`); `absent` distingue reinserção vs corte; códigos reais de recusa mapeados (incluindo `RESOURCE_NOT_FOUND`); aviso para `knownOutcome.kind === 'rejected'`; polling ativo com invalidação de modais preservado (STAFF-03). |
| **Indicador de `stale` durante pausa** | Em `stale`, exibia `"tentando atualizar a cada 5s"` mesmo quando a tela perdia foco ou ia para segundo plano. | Quando `!pollingEnabled \|\| !visible`, exibe `"Dados desatualizados · atualização temporariamente pausada"`, refletindo fielmente a pausa real do timer. |
| **Participante (`externalEntryCall`)** | Contrato `GET /api/v1/participations/current` com validação estrita, `syncStale` e limpeza em `401`/`403` (STAFF-03). | Preservado integralmente sem alterações desnecessárias e sem edição das telas do Heliom. |

---

## 8. Política de Feedback Operacional

### 8.1. Mapeamento dos 11 estados obrigatórios

| Estado obrigatório | Comportamento consolidado no módulo Staff |
|---|---|
| **1. Carregamento inicial** | Exibe `ActivityIndicator` (`accessibilityRole="progressbar"`) e mensagem contextual (`Carregando eventos...`, `Carregando estações...`, `Carregando atendimento...`, `Carregando fila de entrada...`); nunca fabrica lista vazia; indicador informa pausa por carregamento. |
| **2. Estado atualizado** | Apresenta exclusivamente os dados validados pelos parsers estritos; libera botões apenas conforme permissões oficiais retornadas pela API (`canCall`, `canConfirm`, `canMarkAbsent`, `canRemove`, `canManage`, `availability`). |
| **3. Atualização silenciosa** | Executa somente GET sem sobreposição (`useStaffPolling`), atualizando dados na tela sem spinner bloqueante nem fechamento indevido de conteúdo válido (exceto invalidação de modal obsoleto no Controle de Entrada ou `401`/`403`/`404`). |
| **4. Dados desatualizados (`stale`)** | Preserva a última leitura válida, exibe card de alerta `stale`, bloqueia mutações sensíveis e sinaliza no indicador se está tentando atualizar ou se o ciclo está temporariamente pausado. |
| **5. Operação em andamento (`busy`)** | Exibe card `progressbar` específico do estágio (`Verificando condições antes do envio...`, `Preparando solicitação com segurança...`, `Registrando envio seguro...`, `Processando operação no servidor...`, `Registrando resultado com segurança...`, `Finalizando reconhecimento seguro local...` ou `Descartando solicitação não enviada...`), bloqueia acionamentos conflitantes/duplo toque e pausa o polling operacional durante a execução local/servidor. |
| **6. Operação confirmada** | Exibe banner verde somente após confirmação HTTP válida e parser estrito aprovado, descrevendo a ação efetivamente confirmada pelo servidor. |
| **7. Operação recusada** | Exibe banner de alerta com orientação contextual derivada do código real de erro do backend (ou fallback seguro), orientando conferência/atualização do estado. |
| **8. Resultado desconhecido** | Preserva intenção `dispatching` + `Idempotency-Key`, bloqueia novas operações, permite leituras autorizadas e informa explicitamente para não repetir a ação e procurar o responsável caso persista. |
| **9. Falha de armazenamento** | Bloqueia mutações, informa indisponibilidade ou falha de verificação do armazenamento seguro (`SecureStore`) e preserva `knownOutcome` em memória quando o servidor já respondeu antes da falha local. |
| **10. Acesso negado (`403`/`404` revogado)** | Remove imediatamente dados operacionais e nominais em memória, fecha modais, neutraliza callbacks antigos, oculta o indicador de polling, bloqueia ações e preserva registros de intenções no `SecureStore`. |
| **11. Sessão inválida (`401`)** | Segue o fluxo oficial de sessão (`session`), limpa dados protegidos, fecha modais, neutraliza callbacks antigos e orienta nova autenticação preservando intenções persistidas. |

### 8.2. Feedback específico por operação confirmada

- **Controle de Entrada:**
  - `call`: `"Participante chamado pelo servidor."`
  - `confirm_call`: `"Entrada confirmada pelo servidor."`
  - `absent` (`requeued: true`): `"Ausência registrada pelo servidor. Participante retornou ao fim da fila externa."`
  - `absent` (`requeued: false`): `"Ausência registrada pelo servidor. Após o corte de entrada, o participante não retornou à fila externa."`
  - `remove`: `"Participante removido da fila externa pelo servidor."`
  - `toggle` (`enabled: true`): `"Fila externa reativada pelo servidor."`
  - `toggle` (`enabled: false`): `"Fila externa desativada pelo servidor. Participantes liberados: <releasedCount>."`
- **Estações:**
  - `call` (`status: 'pending'`): `"Participante chamado. Operação confirmada pelo servidor."`
  - `complete` (`status: 'completed'`): `"Atendimento concluído. Operação confirmada pelo servidor."`
  - `absent` (`requeued: true`): `"Ausência registrada; participante retornou ao fim da fila."`
  - `absent` (`requeued: false`): `"Ausência registrada; participante não retornou à fila após o corte."`
  - `remove_called` (`status: 'canceled'`): `"Participante removido da fila. Operação confirmada pelo servidor."`

### 8.3. Mapeamento dos códigos reais de recusa do backend

| Superfície | Código real do backend | Orientação apresentada ao operador |
|---|---|---|
| Entrada | `ENTRY_NOT_FIRST` | A fila mudou. Confira o primeiro participante na lista atualizada. |
| Entrada | `ENTRY_QUEUE_EMPTY` | A fila externa está vazia. Nenhum participante aguarda chamada. |
| Entrada | `ENTRY_CALL_PENDING` | Já existe uma chamada externa pendente neste evento. Resolva-a antes de chamar o próximo. |
| Entrada | `ENTRY_CALL_REQUIRED` | É necessário chamar um participante antes de executar esta ação. |
| Entrada | `ENTRY_CALL_NOT_PENDING` | A chamada externa já não está pendente. Confira o estado atualizado. |
| Entrada | `EVENT_ENTRY_UNAVAILABLE` | A operação na fila externa não é permitida no estado atual do evento. |
| Estação | `QUEUE_EMPTY` | A fila da experiência está vazia. Nenhum participante aguarda chamada. |
| Estação | `STATION_UNAVAILABLE` | A estação não está disponível para esta operação. |
| Estação | `STATION_HAS_PENDING_CALL` | Esta estação já possui um atendimento pendente. Resolva-o antes de chamar o próximo. |
| Estação | `SERVICE_NOT_PENDING` | A chamada já não está pendente. Atualize o atendimento antes de decidir a próxima ação. |
| Estação | `EVENT_OPERATION_ENDED` | A operação não é permitida no estado atual do evento. |
| Estação | `QUEUE_ENTRY_NOT_WAITING` | A fila mudou. Confira o próximo participante antes de continuar. |
| Ambas | `RESOURCE_NOT_FOUND` | Mensagem específica informando que a chamada/atendimento ou recurso informado não foi encontrado no servidor (mantendo evento ativo quando GET contextual retorna `200`). |
| Ambas | `STAFF_EVENT_FORBIDDEN` / `FORBIDDEN` | O acesso a este evento não está disponível. |
| Ambas | `SESSION_REVOKED` / `UNAUTHORIZED` | Sessão inválida. Entre novamente para continuar. |
| Ambas | Código desconhecido / ausente | Mensagem genérica segura (sem expor código HTTP, SQL, stack trace ou identificador interno). |

### 8.4. Indicadores honestos de sincronização (`resolveStaffPollingIndicator`)

| Condição real | Texto exibido |
|---|---|
| `hidden` (`accessDenied`, `session`, `denied`) | Oculto (`null`) |
| `verifying` (revalidação contextual após `404` ou verificação de acesso) | `Atualização indisponível · verificando autorização` |
| `loading` (carregamento inicial ou atualização manual em curso) | `Atualização temporariamente pausada · carregamento em andamento` |
| `stale` com polling ativo e tela visível | `Dados desatualizados · tentando atualizar a cada <5\|60>s` |
| `stale` com polling pausado ou tela fora de foco/segundo plano | `Dados desatualizados · atualização temporariamente pausada` |
| `recoverableError` com polling ativo e tela visível | `Atualização indisponível · aguardando recuperação (a cada <5\|60>s)` |
| `recoverableError` fora de foco/segundo plano | `Atualização temporariamente pausada` |
| `unavailableError` (ex.: `accessUncertain` após `404`→`500`, `accessLocked` após `403` com falha `503` manual ou erro de `SecureStore`) | `[Assunto: ]Atualização indisponível · aguardando recuperação manual` |
| Polling pausado (modal na estação, `busy`, perda de foco ou segundo plano) | `[Assunto: ]Atualização temporariamente pausada` |
| Polling ativo e tela visível | `[Assunto: ]Atualização automática ativa · a cada <5\|60>s` |

---

## 9. Tratamento de Falhas

- **Falhas transitórias em GET (`network`, `timeout`, `503`, resposta malformada):** preservam o último estado válido (`stale`) quando já havia carga confirmada ou exibem erro explícito sem fabricar fila vazia na carga inicial; bloqueiam mutações sensíveis enquanto `stale` ou em erro; permitem tanto atualização manual quanto recuperação automática exclusivamente por GET.
- **Falhas em mutações (`POST`/`PATCH` com timeout, queda de rede, HTTP 5xx, payload inesperado ou `IDEMPOTENCY_IN_PROGRESS`):** nunca presumem execução nem recusa; preservam fase `dispatching` com `Idempotency-Key`, bloqueiam ações incompatíveis e proíbem qualquer replay automático, inclusive após fechamento do app, logout ou nova sessão.
- **Falhas de autorização (`401`/`403`/`404`):** limpam imediatamente dados operacionais e nominais em memória, fecham modais, neutralizam callbacks antigos, bloqueiam novas ações e **nunca** apagam intenções persistidas no `SecureStore`. HTTP `404` na estação continua executando verificação contextual via `/stations` (STAFF02-AUD-01) para distinguir recurso inexistente de revogação do evento ou erro transitório (`accessUncertain`).

---

## 10. Política de Intenções Persistidas

Os dois mecanismos existentes foram inspecionados separadamente e preservados sem unificação de formato:

- **Estações ([staffIntentStorage.js](../app/services/staffIntentStorage.js) + [staffOperationsService.js](../app/services/staffOperationsService.js)):**
  - 3 chaves no `SecureStore`: `arenago.staff.operation.<userId>` (operação `reserved`/`dispatching`), `.receipt` (recibo `terminal`) e `.ack` (marcador `pending`/`completed`).
  - Estados diferenciados na UI: `reserved` (não enviada — permite descarte seguro), `pending_reconciliation` (`dispatching` incerto — bloqueio sem replay), `terminal_pending` (resultado registrado aguardando limpeza/reconhecimento), `pending_other` (outra sessão/evento/estação sem vazar dados privados), `storage_error` e ausência de armazenamento persistente (`!coordinator`).
- **Controle de Entrada ([staffEntryIntentStorage.js](../app/services/staffEntryIntentStorage.js) + [staffEntryService.js](../app/services/staffEntryService.js)):**
  - Slot lógico único no `SecureStore`: `arenago.staff.entry.<userId>` com transições lógicas `reserved → dispatching → terminal → acknowledged` ou `cancelled`, sem ambiguidade de exclusão física.
  - Estados diferenciados na UI: `reserved` (permite descarte seguro), `dispatching` (incerto bloqueante sem replay), `terminal` (reconhecimento seguro pendente), `pending` de outro contexto (`!ownPending`), `storageError`, `!isPersistent`, `knownOutcome` confirmado com falha local e `knownOutcome` recusado com falha local.

---

## 11. Limitações de Reconciliação

Conforme documentado em [STAFF_HISTORICAL_RECONCILIATION_IMPLEMENTACAO.md](./STAFF_HISTORICAL_RECONCILIATION_IMPLEMENTACAO.md):

- O contrato atual de consulta histórica retorna `originSession: "unavailable"` e `automaticReconciliation: false`: não comprova a sessão de origem da operação.
- Não existe garantia física de retenção indefinida nem tombstone dos registros de idempotência; ausência de registro histórico **não** comprova ausência de execução.
- Um registro histórico encontrado ou uma leitura atual da fila **não** autoriza desbloquear nem reconhecer automaticamente uma intenção `dispatching` com resultado desconhecido.
- A STAFF-04 respeita integralmente essas fronteiras: nenhuma ação de desbloqueio manual por confirmação visual do operador nem reconciliação automática baseada em GET/histórico foi criada. Evoluções estruturais em proveniência de sessão ou retenção de idempotência permanecem como proposta separada fora desta task.

---

## 12. Arquivos Modificados

- **Código de produção (App — módulo Staff):**
  - [app/screens/staff/components/StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js) *(novo)*
  - [app/screens/staff/useStaffPolling.js](../app/screens/staff/useStaffPolling.js)
  - [app/services/staffEventsService.js](../app/services/staffEventsService.js)
  - [app/services/staffDashboardService.js](../app/services/staffDashboardService.js)
  - [app/services/staffOperationsService.js](../app/services/staffOperationsService.js)
  - [app/services/staffEntryService.js](../app/services/staffEntryService.js)
  - [app/screens/staff/StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js)
  - [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js)
  - [app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js)
- **Testes automatizados preparados/atualizados (App):**
  - [app/tests/staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs)
  - [app/tests/staffPolling.test.cjs](../app/tests/staffPolling.test.cjs)
  - [app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs)
  - [app/tests/staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs)
  - [app/tests/staffOperationsService.integration.test.cjs](../app/tests/staffOperationsService.integration.test.cjs)
  - [app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs)
  - [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs)
  - [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs)
  - [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs)
- **Documentação e Evidências:**
  - [docs/STAFF_04_SINCRONIZACAO_FEEDBACK_SEGURO.md](./STAFF_04_SINCRONIZACAO_FEEDBACK_SEGURO.md) *(novo)*
  - [qa-evidence/STAFF-04-changes.diff](../qa-evidence/STAFF-04-changes.diff) *(novo — exclusivamente alterações da STAFF-04 desde `6c77c3b515ef4ed47607250081055868cc803a30`, excluindo a si próprio e preservando [qa-evidence/STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff))*

---

## 13. Testes Preparados

1. **[app/tests/staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs):** registro de `components/StaffSyncFeedback.js` em `realStaffScreens` e verificação de ausência de imports demonstrativos.
2. **[app/tests/staffPolling.test.cjs](../app/tests/staffPolling.test.cjs):** cobertura do intervalo de 60s, rejeição em `read()`, e bateria da Rodada 1 (`STAFF04-AUD-01`) com promises controladas e scheduler simulado cobrindo leitura pendente + alternância `enabled`/`useIsFocused()`/`AppState` sem execuções simultâneas nem timers duplicados, retomada em ciclo único após sucesso/rejeição, troca de `scope` `A`→`B` independente e `unmount` sem timers órfãos.
3. **[app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs):**
   - `staffEventsService`: classificação de `403`/`401`/`timeout`/`503`/malformada, recuperação via `refreshSilent()`, trava `accessLocked` (`STAFF04-AUD-02`) tratando `401`/`403` mesmo com outra geração ativa para a mesma identidade, bloqueando `200`/`503` atrasados ou subsequentes até nova revalidação manual `200`, e isolando troca de conta.
   - UI (`StaffEventsScreen` e `StaffEventDashboard`): indicadores de 60s e 5s, desmontagem imediata sob `403` (`STAFF04-AUD-02`), separação 5s vs `Eventos e fase` 60s e recuperação manual (`STAFF04-AUD-05`), e confirmação na Rodada 2 (`STAFF04-AUD-06`) de existência de exatamente um agendador de 60s (`:events:`) ativo entre Painel, Controle de Entrada e Estação.
4. **[app/tests/staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs):** classificação de `timeout` como `network` e recuperação automática em `pollQueue()` após `timeout`/`503`/malformada sem fabricar fila vazia, interrompendo em `403`.
5. **[app/tests/staffOperationsService.integration.test.cjs](../app/tests/staffOperationsService.integration.test.cjs):** validação da Rodada 1 (`STAFF04-AUD-03`) para `phase: 'precondition'`, testes da Rodada 2 (`STAFF04-AUD-04`) para `onAuthError` antes de `recordTerminal()`/`clear()` e travamento entre `reserve()`/`dispatch()`/`POST`, e suítes da Rodada 3 (`STAFF04-AUD-08` + `STAFF04-AUD-10`) cobrindo os 8 cenários de leituras preliminares paralelas em `callNext` (`503`→`403`, `403` com consulta irmã pendente, `network`/`timeout`→`401`, duplo `403` sem duplicação, `503`+`503`, isolamento por conta/evento/estação e revalidação posterior) e a sequência completa de estágios `['precondition', 'preparing', 'dispatching', 'mutating', 'persisting']` (suprimindo `'persisting'` em `401`/`403` e em resultado `uncertain`).
6. **[app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs):** recuperação em `poll()`, preservação de `knownOutcome` em `storage_error`, suítes das Rodadas 1 e 2 (`STAFF04-AUD-03` e `STAFF04-AUD-04`) e suíte da Rodada 3 (`STAFF04-AUD-10`) validando `busyKind: 'persisting'` durante `storage.finish()` em confirmação e recusa definitiva `409`, limpeza imediata de `busy`/`busyKind` em `403` antes da persistência e ausência de `'persisting'` em `uncertain`.
7. **[app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs):**
   - Suíte unitária pura de `StaffSyncFeedback.js`.
   - Suíte de tela `StaffEntryControlRealScreen` reforçada na Rodada 2 (`STAFF04-AUD-03` + `STAFF04-AUD-04`) e ampliada na Rodada 3 (`STAFF04-AUD-10`) validando a exibição de `"Registrando resultado com segurança..."` durante `storage.finish()`, o encerramento imediato da faixa `busy` em `403` mesmo com persistência pendente e a ausência de texto de persistência/sucesso em `uncertain`.
8. **[app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs):** recuperação após falha inicial, Caso C manual, `poll()` concorrente (`STAFF04-AUD-01`), pré-condição transitória (`STAFF04-AUD-03`), suíte da Rodada 2 (`STAFF04-AUD-04` + `STAFF04-AUD-07`) e suítes da Rodada 3 cobrindo `STAFF04-AUD-08` (`503` + `403` em `callNext` e `403` com consulta irmã pendente), `STAFF04-AUD-09` (descarte de feedback tardio após troca de `sessionId`, `revision`, `stationId`, saída/retorno da estação e `accessDenied`, não reabilitação em `503` e revalidação legítima `200` preservando `.receipt`) e `STAFF04-AUD-10` (`"Registrando resultado com segurança..."` em `recordTerminal()`/`clear()`, bloqueio imediato em `403` sem banner `busy` e ausência de `'persisting'` em `uncertain`).
9. **[app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs):**
   - Allowlist `control.realStaff` com `StaffSyncFeedback`.
   - Fluxos completos com `manualTimers: true`, incluindo atualizações da Rodada 2 (`STAFF04-AUD-07`, `STAFF04-AUD-06` e `STAFF04-AUD-04`) e fluxo ponta a ponta da Rodada 3 (`STAFF04-AUD-08/09/10`) verificando `"Registrando resultado com segurança..."` no Controle de Entrada, revogação imediata da árvore em `callNext` sob `503` + `403` concorrentes, recuperação oficial via `Atualizar estações` no Painel e isolamento de feedback tardio entre sessões/visitas.

---

## 14. Verificações Realizadas

### 14.1. Verificações estáticas executadas pelo agente implementador (permitidas por [AGENTS.md](../AGENTS.md))

- Inspeção estática integral dos arquivos de produção, serviço, hook e testes modificados/criados na entrega inicial e nas Rodadas 1, 2 e 3.
- Validação sintática via `node --check` em todos os arquivos `.cjs` alterados e `node --input-type=module --check` nos serviços ESM modificados.
- Análise sintática via `@babel/parser` (`parse` com `sourceType: 'module'` e plugin `jsx`) em todos os arquivos React Native/JSX modificados.
- Verificação de formatação e higiene via `git diff --check -- app backend docs`.
- Validação de aplicabilidade do patch acumulado da STAFF-04 desde `6c77c3b515ef4ed47607250081055868cc803a30` via `git apply --stat qa-evidence/STAFF-04-changes.diff` e `git apply --check --reverse qa-evidence/STAFF-04-changes.diff`.
- Conferência de integridade: ausência de auto-inclusão do patch (`SELF_PATCH_HEADER_COUNT=0`), ausência de URIs locais absolutas na documentação (`DOC_FILE_URI_COUNT=0`), preservação intacta de [qa-evidence/STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) e conferência de `git status --short --branch`.

### 14.2. Validações automatizadas NÃO executadas nesta etapa (pendentes para **GPT-6 Luna — Medium**)

Em estrita conformidade com [AGENTS.md](../AGENTS.md), o agente implementador **não executou** `node --test`, `npm test`, `npm run typecheck:test`, `npm run lint`, `npm run build`, `qa/regression` nem testes contra PostgreSQL. Nenhum teste foi declarado aprovado.

---

## 15. Campanha Conjunta STAFF-03 + STAFF-04

Por decisão do responsável, todas as validações automatizadas pendentes da **STAFF-03** e da **STAFF-04** serão executadas em campanha conjunta com **GPT-6 Luna — Medium** (após auditoria estática independente da STAFF-04 e autorização do responsável).

### Pré-verificação obrigatória antes de iniciar a campanha

1. Confirmar que o modelo ativo selecionado pelo responsável é **GPT-6 Luna — Medium**.
2. Confirmar branch `feature/staff-operacional-v2`, working tree sem alterações destrutivas e ambiente isolado (`NODE_ENV=test` quando aplicável).
3. Não imprimir segredos, tokens ou URLs com credenciais.

### Etapa 1 — Testes focados (STAFF-03 + STAFF-04 no App — executar a partir de `app/`)

```powershell
Push-Location app
node --test tests/staffPolling.test.cjs tests/staffEventDiscovery.test.cjs tests/staffDashboard.test.cjs tests/staffOperationsService.integration.test.cjs tests/staffEntryControl.test.cjs tests/staffEntryControlScreen.test.cjs tests/staffStationOperational.test.cjs tests/staffRealNavigation.test.cjs tests/staffBackground.test.cjs tests/staffDemoState.test.cjs tests/participationService.test.cjs tests/roleRoutingIntegration.test.cjs
Pop-Location
```

### Etapa 2 — Backend (typecheck de produção e testes, lint, build local, unitários e HTTP simulados — executar a partir de `backend/`)

```powershell
Push-Location backend
npm run typecheck:test
npm run lint
npm run build
npm test
Pop-Location
```

*(Observação: `npm test` executa `tsx --test test/unit/*.test.ts`, incluindo as suítes da STAFF-03 e regressões Staff/Participante: `participation-lifecycle.test.ts`, `participation-lifecycle-http.test.ts`, `staff-entry-call.test.ts`, `staff-entry-http.test.ts`, `staff-station-operational-http.test.ts`, `staff-http.test.ts` e `staff-history-http.test.ts`.)*

### Etapa 3 — Regressões completas (App e `qa/regression`)

```powershell
Push-Location app
npm test
Pop-Location

Push-Location qa/regression
node run.cjs
Pop-Location
```

### Etapa 4 — Integração PostgreSQL dedicado (SOMENTE mediante autorização explícita do responsável)

Antes de executar qualquer comando desta etapa, confirmar integralmente:
- Autorização explícita do responsável para a campanha PostgreSQL.
- `NODE_ENV=test`.
- Identidade exata das URLs exigidas (`DATABASE_URL`, `DATABASE_DIRECT_URL`, `EVENTS_TEST_DATABASE_URL`), host/porta dedicados (`127.0.0.1:55432`) e `current_database() = arenago_staff_homolog_20261111`.
- Presença da migration `0008` sem executar migrations ou seeds automaticamente.
- Preservação de registros preexistentes (incluindo Admins históricos) e ausência de limpeza global.
- Variável de guarda `STAFF03_POSTGRES_PROJECTION_TEST=authorized-local`.

Comandos focados (executar a partir de `backend/` — não rodar genericamente toda a pasta `test/integration/*.test.ts` sem conferir os guards individuais):

```powershell
Push-Location backend
npx tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/staff03-external-call-projection.integration.test.ts
npx tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/participations-read.integration.test.ts test/integration/participation-lifecycle.integration.test.ts test/integration/external-entry-calls-schema.integration.test.ts
Pop-Location
```

### Etapa 5 — Homologação conjunta no Expo Go

Executar manualmente pelo responsável seguindo os 18 cenários da Seção 16.

---

## 16. Roteiro de Homologação (Expo Go — STAFF-03 + STAFF-04)

Validação manual posterior recomendada com **dois dispositivos Staff** (`Staff A` e `Staff B`) e **um dispositivo Participante**, sobre API e ambiente homologados.

> **Dependência explícita com Heliom:** a exibição visual da chamada externa, alertas e vibração no aplicativo do Participante dependem da implementação de interface sob responsabilidade do Heliom (consumindo `GET /api/v1/participations/current` → `externalEntryCall`). Enquanto essa frente não estiver disponível e validada, a homologação integrada Staff + Participante **não** deve ser declarada concluída (os cenários de contrato podem ser conferidos via resposta oficial de `/participations/current` até a entrega visual do Heliom).

### Cenários mínimos (18 itens)

1. **Login Staff e seleção de evento:** autenticar conta Staff real, confirmar carregamento inicial em `Eventos Staff`, indicador `Atualização automática ativa · a cada 60s` e exibição exclusiva de eventos autorizados com fase oficial.
2. **Navegação entre Painel, Estações e Controle de Entrada:** abrir o Painel Operacional (confirmar indicador de `5s`), acessar Controle de Entrada, retornar ao painel, acessar uma estação e retornar ao painel conferindo consistência dos cabeçalhos e métricas reais.
3. **Entrada de participante na fila externa:** com `externalQueueEnabled = true`, admitir participante na fila externa e conferir sua posição FIFO real (`1`, badge `PRÓXIMO`) sem ação manual no Staff.
4. **Atualização automática da fila:** observar a atualização automática a cada `5s` tanto no Painel Operacional quanto no Controle de Entrada e na fila da Estação sem carregamento intrusivo e sem duplicação de requisições.
5. **Chamada externa e consulta pelo Participante:** em `Controle de Entrada`, acionar **Chamar próximo**; verificar destaque da chamada pendente sem duplicação na lista, aviso `"Participante chamado pelo servidor."` e presença de `externalEntryCall` (`callId`, `kind: "external_entry"`, `status: "pending"`, `calledAt`) em `GET /api/v1/participations/current` (e na tela do Participante quando entregue pelo Heliom).
6. **Confirmação de entrada:** confirmar a entrada no modal, conferir aviso `"Entrada confirmada pelo servidor."`, desaparecimento da chamada pendente no Staff e transição do Participante para `status: "active"` com `externalEntryCall: null`.
7. **Chamada e conclusão de atendimento interno:** entrar em uma estação disponível com participante na fila da experiência, acionar **Chamar próximo** (confirmar `"Participante chamado. Operação confirmada pelo servidor."`), concluir o atendimento (confirmar `"Atendimento concluído. Operação confirmada pelo servidor."`) e retornar ao Painel conferindo que a estação voltou a aparecer sem atendimento pendente.
8. **Ausência com reinserção (e ausência após corte, se em janela de corte):** registrar ausência antes do corte na fila externa e na estação; confirmar reinserção ao fim da fila, mensagem correspondente (`Participante retornou ao fim da fila...`) e geração de novo `callId` distinto em chamada posterior. Caso testado após o corte, confirmar que a mensagem informa explicitamente o não retorno à fila.
9. **Remoção:** testar **Remover da fila** tanto na chamada externa quanto no atendimento interno da estação, verificando modal de confirmação, aviso específico (`Participante removido...`) e limpeza de `externalEntryCall` / atendimento pendente.
10. **Mudança operacional realizada por outro Staff:** com `Staff A` e `Staff B` no mesmo evento/estação, executar operação em `Staff B` e confirmar que `Staff A` reflete a alteração automaticamente no próximo ciclo de `5s` (e exibe orientação contextual se tentar operar sobre estado já alterado, ex.: `SERVICE_NOT_PENDING` ou `ENTRY_CALL_NOT_PENDING`).
11. **Invalidação de modal obsoleto:** em `Controle de Entrada`, abrir modal de confirmação em `Staff A` enquanto `Staff B` resolve/substitui a chamada ou altera a contagem da fila; confirmar fechamento automático do modal em `Staff A` com aviso contextual e zero mutações sobre a chamada seguinte. Nas Estações, confirmar pausa do polling enquanto o modal estiver aberto (política STAFF-02).
12. **Desativação e reativação da fila externa (D06):** desativar a fila externa verificando a contagem observada (`waitingCount + chamada pendente`) no card e no modal, conferindo o aviso pós-operação com `releasedCount` oficial e a atualização coerente ao voltar ao Painel (`FILA INATIVA`); em seguida reativar (`FILA ATIVA`, lista vazia, sem recolocar liberados).
13. **Perda e recuperação de conexão durante consultas:** desabilitar temporariamente a rede (modo avião) em telas já carregadas — confirmar preservação dos dados válidos, banner `stale`, bloqueio de mutações e indicador `Dados desatualizados`; desabilitar a rede antes da carga inicial — confirmar mensagem de erro sem fabricar fila vazia e recuperação automática por GET ao restabelecer a conexão.
14. **Segundo plano e retomada:** minimizar o Expo Go (segundo plano) e retornar; confirmar que o indicador alterna para `Atualização temporariamente pausada` durante ausência e volta a `Atualização automática ativa` ao retomar, sem timers duplicados.
15. **Troca de evento e estação:** alternar entre dois eventos e entre Estação A e Estação B; confirmar ausência total de dados nominais ou ações residuais do contexto anterior.
16. **Troca de sessão / revogação de acesso:** testar logout, novo login com a mesma conta e login com conta diferente (e, em ambiente controlado, revogação `401`/`403`); confirmar limpeza imediata de dados nominais, fechamento de modais e ausência de vazamento entre sessões/contas.
17. **Conferência dos indicadores de sincronização:** validar visualmente o indicador nas 4 telas/seções (Seleção de Eventos `60s`, Painel `5s`, Controle de Entrada `5s` e Estação `5s`) em estado ativo, pausado, carregando, desatualizado e em recuperação.
18. **Conferência da coerência das mensagens operacionais:** verificar legibilidade, contraste, ausência de códigos HTTP/SQL/stack traces, diferenciação entre `busy`, confirmado, recusado, incerto e indisponível.

> **Nota sobre cenários de resposta de mutação perdida:** cenários de interrupção entre despacho e resposta (`dispatching` com resultado desconhecido), falha de armazenamento ou falha de reconhecimento local devem ser validados exclusivamente por mecanismos controlados (testes automatizados / proxy controlado em homologação), sem improvisar alterações manuais ou inseguras em bancos reais.

---

## 17. Histórico de Revisões e Correções

- **25/11/2026 — Diagnóstico inicial (pré-código):** criação de `docs/STAFF_04_SINCRONIZACAO_FEEDBACK_SEGURO.md` sobre a base `6c77c3b515ef4ed47607250081055868cc803a30`, com mapeamento das 5 superfícies Staff, 7 lacunas verificadas e plano técnico antes de qualquer edição de código de produção.
- **26/11/2026 — Implementação e preparação de testes da STAFF-04 concluídas:** consolidados recuperação automática segura por GET em todas as superfícies Staff, classificação uniforme de `timeout` e `403`, componente compartilhado [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), indicadores honestos nas 4 telas/seções (incluindo Seleção de Eventos e Painel Operacional), feedback específico por operação e por código real do backend, banners explícitos de processamento `busy`, preparação completa das suítes de teste, documentação consolidada das 17 seções (incluindo campanha conjunta STAFF-03 + STAFF-04 e roteiro de 18 cenários) e geração de [qa-evidence/STAFF-04-changes.diff](../qa-evidence/STAFF-04-changes.diff) (publicada em `bed637fb35455d51edcb8a3f0a78cd8dcaad8548`).
- **26/11/2026 — Auditoria Independente — Rodada 1 (aberta pré-código):** registrados os cinco achados confirmados sobre `bed637fb35455d51edcb8a3f0a78cd8dcaad8548` (`STAFF04-AUD-01` a `STAFF04-AUD-05`), causas técnicas, riscos e plano de correção antes de editar código de produção.
- **26/11/2026 — Auditoria Independente — Rodada 1 (correções aplicadas e testes preparados):** implementadas todas as correções de código, componentes, serviços e suítes de testes para `STAFF04-AUD-01` a `STAFF04-AUD-05` (incluindo polling dedicado de 60s de Eventos/fase ativo também em `StaffEventDashboard`), validados syntax/Babel/diff estáticos e regerado [qa-evidence/STAFF-04-changes.diff](../qa-evidence/STAFF-04-changes.diff) desde `6c77c3b515ef4ed47607250081055868cc803a30`.
- **26/11/2026 — Auditoria Independente — Rodada 2 (aberta pré-código):** registrados os achados remanescentes e novos identificados sobre `409b6abb18a259b8d1d984441d6ac853d6342aaa` (`STAFF04-AUD-03`, `STAFF04-AUD-04`, `STAFF04-AUD-06` e `STAFF04-AUD-07`), causas técnicas confirmadas e plano de correção antes da alteração de código.
- **26/11/2026 — Auditoria Independente — Rodada 2 (correções aplicadas e testes preparados):** concluídas as correções para `STAFF04-AUD-03`, `STAFF04-AUD-04`, `STAFF04-AUD-06` e `STAFF04-AUD-07`, atualizadas as suítes e fixtures persistentes de teste, executadas as checagens estáticas (`node --check`, `--input-type=module --check`, `@babel/parser`, `git diff --check`) e regerado [qa-evidence/STAFF-04-changes.diff](../qa-evidence/STAFF-04-changes.diff) desde `6c77c3b515ef4ed47607250081055868cc803a30`.
- **27/11/2026 — Auditoria Independente — Rodada 3 (aberta pré-código):** registrados os três achados adicionais identificados sobre `35e7c4e584db50a8bc86af5e84d46906e770a351` (`STAFF04-AUD-08`, `STAFF04-AUD-09` e `STAFF04-AUD-10`), causas técnicas confirmadas e plano de correção antes da alteração de código.
- **27/11/2026 — Auditoria Independente — Rodada 3 (correções aplicadas e testes preparados):** implementadas as correções para `STAFF04-AUD-08` (guarda individual `createPreconditionAuthGuard` em leituras preliminares paralelas), `STAFF04-AUD-09` (isolamento completo de contexto/visita/operação e revalidação GET direta em `refresh()`) e `STAFF04-AUD-10` (estágio `'persisting'` explícito pós-resposta definitiva não-auth), preparadas as suítes correspondentes nos 5 arquivos de teste afetados, executadas as checagens estáticas permitidas e regerado [qa-evidence/STAFF-04-changes.diff](../qa-evidence/STAFF-04-changes.diff) desde `6c77c3b515ef4ed47607250081055868cc803a30`.

---

## Auditoria Independente — Rodada 1

Auditoria estática independente realizada sobre o commit `bed637fb35455d51edcb8a3f0a78cd8dcaad8548` (branch `feature/staff-operacional-v2`, base original da STAFF-04: `6c77c3b515ef4ed47607250081055868cc803a30`). Todos os cinco achados abaixo foram confirmados por inspeção direta do código antes da aplicação das correções e permanecem **não executados em campanha automatizada** até que **GPT-6 Luna — Medium** seja acionado pelo responsável.

### Resumo dos achados tratados (Rodada 1)

| ID | Prioridade | Status da preparação |
|---|---|---|
| `STAFF04-AUD-01` | P1 | Correção aplicada e testes unitários/integrados preparados (pendente execução por Luna Medium) |
| `STAFF04-AUD-02` | P1 | Correção aplicada e testes unitários/integrados preparados (pendente execução por Luna Medium) |
| `STAFF04-AUD-03` | P2 | Correção aplicada e testes unitários/integrados preparados (pendente execução por Luna Medium) |
| `STAFF04-AUD-04` | P1 | Correção aplicada e testes unitários/integrados preparados (pendente execução por Luna Medium) |
| `STAFF04-AUD-05` | P2 | Correção aplicada e testes unitários/integrados preparados (pendente execução por Luna Medium) |

### Detalhamento completo por achado

#### `STAFF04-AUD-01` (P1) — Eliminação de sobreposição e corridas no polling durante pausa/retomada e modais

- **Causa:** em [useStaffPolling.js](../app/screens/staff/useStaffPolling.js), a variável local `running` existia apenas no escopo de uma execução de `useEffect`; ao pausar e retomar (`enabled` em modais, `useIsFocused()` ou `AppState`), nova instância do efeito iniciava `running = false` com o GET anterior ainda pendente, podendo agendar segundo disparo sobreposto ao fim de 5s/60s. Adicionalmente, `poll()` em [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js) não possuía trava de voo próprio (`pollingFlight`) nem sequência independente (`pollSeq`) frente a `refresh()` manual.
- **Solução aplicada:** em [useStaffPolling.js](../app/screens/staff/useStaffPolling.js), criado `flightsRef = useRef(new Map())` indexado por `scope` com lista de callbacks `waiters`; retomadas enquanto há voo no mesmo `scope` assinam a conclusão da leitura pendente antes de agendar o próximo timer (sem bloquear troca para escopo `B`, limpando listeners/timers e mantendo voo em curso isolado no `unmount`). Em [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), adicionados `pollingFlight` e `pollSeq` em `poll()`, preservando a política de pausa em modais nas Estações (STAFF-02) e de polling de 5s ativo com invalidação no Controle de Entrada (STAFF-03), além de não descartar `401`/`403` da identidade vigente caso `refresh()` manual concorra.
- **Arquivos alterados:** [app/screens/staff/useStaffPolling.js](../app/screens/staff/useStaffPolling.js), [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js).
- **Testes preparados:** [app/tests/staffPolling.test.cjs](../app/tests/staffPolling.test.cjs) (promises controladas e scheduler simulado cobrindo alternância `enabled`, foco, `AppState`, sucesso/rejeição, troca de escopo `A`→`B` e `unmount`), [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) (`poll()` concorrente vs `refresh()` manual, abertura/cancelamento de modal e `403` tardio) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (estação com GET em voo + modal aberto/cancelado sobre `useStaffPolling` real com `manualTimers: true`).
- **Checks estáticos executados:** `node --input-type=module --check`, `@babel/core` (`parseSync` JSX), `node --check`, `git diff --check`.
- **Limitações identificadas:** testes automatizados dependem de execução com dependências de `qa/regression` (`react-test-renderer`).
- **Pendências:** execução das suítes em **GPT-6 Luna — Medium** e validação manual em segundo plano/modais no Expo Go.

#### `STAFF04-AUD-02` (P1) — Preservação de `401`/`403` em `staffEventsService` e bloqueio de reabilitação indevida

- **Causa:** em [staffEventsService.js](../app/services/staffEventsService.js), `refresh()` e `refreshSilent()` comparavam `requestGeneration !== generation` antes de processar `401`/`403`, podendo descartar negativas pertencentes à conta atual caso outra consulta tivesse incrementado `generation`, além de inexistir trava `revokedKind`/`accessLocked` para impedir restauração por `200`/`503` atrasado ou reativação de `refreshSilent()`; [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js) também não sinalizava `accessLocked` na árvore dependente nem distinguia recuperação manual após erro pós-revogação.
- **Solução aplicada:** em [staffEventsService.js](../app/services/staffEventsService.js), introduzidos `revokedKind`, `accessLocked` no snapshot público e `lockAuthorization(kind, identity)`, aplicando bloqueio e limpeza imediata de `events`/`selected` sempre que `isCurrent(identity)` for verdadeira para `401`/`403`, bloqueando `refreshSilent()`, `select()` e respostas `200`/`503` atrasadas até uma nova revalidação manual `200` legítima, com isolamento completo em troca de conta (`setIdentity`). Em [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js), bloqueio imediato do `StaffEventDashboard` e telas filhas quando `staff.accessLocked` é ativado, mantendo o erro explícito em `StaffEventHomeScreen` e bloqueando reativação automática em `503`.
- **Arquivos alterados:** [app/services/staffEventsService.js](../app/services/staffEventsService.js), [app/screens/staff/StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js).
- **Testes preparados:** [app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs) (concorrência `Polling A` vs `Refresh B` para `403` e `401`, `200`/`503` atrasados ou manuais bloqueados, restauração por `200`, isolamento `u-1`→`u-2` e desmontagem do painel dependente via `createStaffUiHarness`) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (`403` no ciclo de Eventos limpando painel em andamento).
- **Checks estáticos executados:** `node --input-type=module --check`, `@babel/core` (`parseSync` JSX), `node --check`, `git diff --check`.
- **Limitações identificadas:** cenário real de revogação no backend durante navegação ativa depende de sessão de teste controlada.
- **Pendências:** execução das suítes com **GPT-6 Luna — Medium** e validação no roteiro integrado.

#### `STAFF04-AUD-03` (P2) — Separação explícita de falha de pré-condição sem envio e estágios `busy` locais vs servidor

- **Causa:** em [staffOperationsService.js](../app/services/staffOperationsService.js), erros de pré-condição retornavam apenas `network: Boolean(error?.isNetworkError)` sem capturar `isTimeout` nem flag `transient` (`503`/payload malformado), fazendo `describeStationFeedback` em [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js) classificá-los incorretamente como *"Operação recusada pelo servidor"*; ademais, [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) e [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js) exibiam *"Processando operação no servidor..."* mesmo durante cancelamento ou reconhecimento local.
- **Solução aplicada:** em [staffOperationsService.js](../app/services/staffOperationsService.js), retorno aditivo `{ phase: 'precondition', status, code, network, timeout, transient }` nas falhas de pré-condição e callback opcional `onStage('precondition' | 'mutating')`; em [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), tratamento prioritário de `phase === 'precondition'` em `describeStationFeedback` diferenciando `401`/`403`/`404`, recusa real de pré-condição e falha transitória (*"Não foi possível verificar se a operação pode ser realizada. Nenhuma alteração foi enviada. Atualize os dados antes de tentar novamente."*). Em ambas as telas operacionais, distinção dos textos de ocupação (`Verificando condições antes do envio...`, `Processando operação no servidor...`, `Finalizando reconhecimento seguro local...`, `Descartando solicitação não enviada...`).
- **Arquivos alterados:** [app/services/staffOperationsService.js](../app/services/staffOperationsService.js), [app/screens/staff/components/StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), [app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js).
- **Testes preparados:** [app/tests/staffOperationsService.integration.test.cjs](../app/tests/staffOperationsService.integration.test.cjs) (`network`, `timeout`, `503`, payload malformado, `401`, `403`, `blocked` e `onStage` em ordem exata com 0 POSTs), [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) (suíte unitária de `StaffSyncFeedback` + estágios `cancelling`/`mutating`/`acknowledging` na tela de Entrada) e [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) (transição `precondition`→`mutating` e ausência de texto de recusa após falhas prévias transitórias).
- **Checks estáticos executados:** `node --input-type=module --check`, `@babel/core` (`parseSync` JSX), `node --check`, `git diff --check`.
- **Limitações identificadas:** na tela real com rede instantânea, a etapa visual `precondition` transita rapidamente para `mutating`; sua observação visual direta ocorre sobretudo sob latência de rede.
- **Pendências:** execução das suítes com **GPT-6 Luna — Medium**.

#### `STAFF04-AUD-04` (P1) — Reação imediata a `401`/`403` em mutações/pré-condições sem depender de GET posterior e tratamento preciso de `404`

- **Causa:** em [staffEntryService.js](../app/services/staffEntryService.js) (`mutate()`) e [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js) (`dispatch()`), respostas `401`/`403` em mutações (ou pré-condição na estação) ainda dependiam do `refresh()` GET subsequente para travar a conta e propagar `onAccessDenied`, abrindo brecha caso o GET subsequente falhasse com `503`/rede ou um GET anterior chegasse `200`. Já o `404` pontual (`RESOURCE_NOT_FOUND`) precisava continuar diferenciado entre atendimento/chamada já resolvido (GET `200` preserva evento) e perda de acesso (`403`/`404` na consulta contextual revoga o evento).
- **Solução aplicada:** em [staffEntryService.js](../app/services/staffEntryService.js), `401`/`403` durante `mutate()` avançam `readGeneration`, limpam `data` e gravam `status: 'error', error: 'session'|'denied'` imediatamente antes da etapa de armazenamento e pulam o `refresh()` posterior ao término (mantendo o recibo/chave `dispatching` + `knownOutcome` caso o `SecureStore` falhe). Em [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), adicionado `revokeStationAccess()` chamado imediatamente em `401`/`403` de pré-condição, recusa ou `rejected_cleanup_pending`, fechando modais, limpando dados nominais/callbacks, preservando `SecureStore`, notificando `onAccessDenied` no pai (`staffDashboardService`) e suprimindo o `refresh()` pós-mutação. Adicionados mapeamentos explícitos de `RESOURCE_NOT_FOUND` e fallbacks por status `401`/`403`/`404` em [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), mantendo `404` contextual via `refresh()` (Entrada) e `/operational-state` + `/stations` (Estações).
- **Arquivos alterados:** [app/services/staffEntryService.js](../app/services/staffEntryService.js), [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), [app/screens/staff/components/StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js).
- **Testes preparados:** [app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs), [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs), [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) cobrindo `401`/`403` em mutação/pré-condição/`cleanup_pending` com GETs atrasados `200` e posteriores `503`, preservação intacta de recibos/`dispatching`/`Idempotency-Key` no `SecureStore`, isolamento em troca de conta e `404 RESOURCE_NOT_FOUND` preservando o evento sob GET `200`.
- **Checks estáticos executados:** `node --input-type=module --check`, `@babel/core` (`parseSync` JSX), `node --check`, `git diff --check`.
- **Limitações identificadas:** validação com revogação real concorrente de permissões Staff no servidor depende de banco/API em homologação.
- **Pendências:** execução completa com **GPT-6 Luna — Medium**.

#### `STAFF04-AUD-05` (P2) — Separação dos indicadores `5s` vs `60s` (`Eventos e fase`) e honestidade na recuperação manual

- **Causa:** em [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js), `panelStale` misturava `staff.error === 'stale'` (cadência de `60s`) ao indicador operacional de `intervalSeconds: 5`; ao mesmo tempo, `unavailableError` em [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js) usava o texto *"Atualização indisponível · aguardando recuperação"* sem informar intervenção manual (inclusive em Caso C `404`→`500` / `accessUncertain`), e `StaffEventDashboard` anunciava `60s` ativos mesmo quando a tela anterior `StaffEventsScreen` perdia o foco na pilha.
- **Solução aplicada:** em [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), adicionado parâmetro opcional `subject` (`formatSubjectText`) em `resolveStaffPollingIndicator` e atualizado o texto de `unavailableError` (e de `recoverableError` quando sem polling automático e tela visível) para *"Atualização indisponível · aguardando recuperação manual"*. Em [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js), separados no Painel Operacional os estados `operationalStale` (`5s`, banner operacional próprio) e `eventPhaseStale` (`Eventos e fase`, `60s`, banner próprio + pill dedicado `<StaffPollingStatusPill indicator={eventPhaseIndicator} />`), com `useStaffPolling(eventPhasePollingEnabled, () => staff.refreshSilent(), 60000, ...)` ativo no próprio `StaffEventDashboard` em `section === 'panel'`.
- **Arquivos alterados:** [app/screens/staff/components/StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), [app/screens/staff/StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js).
- **Testes preparados:** [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) (todos os estados de `resolveStaffPollingIndicator` com `subject` e recuperação manual), [app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs) (stale somente em eventos/fase, somente em ops, combinado, em segundo plano e erro manual após `403`), [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) (Caso C `404`→`500` manual) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (fluxo ponta a ponta com `5s` vs `60s` e retorno do painel em `accessUncertain` exibindo `"aguardando recuperação manual"`).
- **Checks estáticos executados:** `@babel/core` (`parseSync` JSX), `node --check`, `git diff --check`.
- **Limitações identificadas:** dependência visual do comportamento dos dois `StaffPollingStatusPill` empilhados no Painel exige inspeção visual final no Expo Go.
- **Pendências:** execução das suítes com **GPT-6 Luna — Medium** e conferência visual no Cenário 17 do roteiro Expo Go.

---

## Auditoria Independente — Rodada 2

Auditoria estática independente realizada sobre o commit `409b6abb18a259b8d1d984441d6ac853d6342aaa` (branch `feature/staff-operacional-v2`, base original da STAFF-04: `6c77c3b515ef4ed47607250081055868cc803a30`). Os achados `STAFF04-AUD-01`, `STAFF04-AUD-02` e `STAFF04-AUD-05` (na apresentação) foram considerados corrigidos; abaixo estão registradas as resoluções aplicadas para `STAFF04-AUD-03`, `STAFF04-AUD-04`, `STAFF04-AUD-06` e `STAFF04-AUD-07` (com campanha automatizada ainda pendente de execução em **GPT-6 Luna — Medium**).

### Resumo dos achados tratados (Rodada 2)

| ID | Prioridade | Status da preparação |
|---|---|---|
| `STAFF04-AUD-03` | P2 | Correção aplicada e 8 cenários preparados com armazenamento controlado (pendente execução por Luna Medium) |
| `STAFF04-AUD-04` | P1 | Bloqueio pré-persistência e barreiras síncronas implementadas com testes em promessas pendentes (pendente execução por Luna Medium) |
| `STAFF04-AUD-06` | P2 | Agendador de 60s consolidado em fonte única e coberto nos 10 cenários com hook real (pendente execução por Luna Medium) |
| `STAFF04-AUD-07` | P1 | Fixtures alinhadas ao contrato de 3 chaves de `staffIntentStorage` (pendente execução por Luna Medium) |

### Detalhamento completo por achado (Rodada 2)

#### `STAFF04-AUD-03` (P2) — Feedback fiel à atividade em Controle de Entrada e isolamento de `busyStage`

- **Causa:** em [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js), a expressão `busyStage === 'cancelling' || pending?.phase === 'reserved'` rotulava a preparação/despacho normal de uma nova mutação como `"Descartando solicitação não enviada..."`, enquanto callbacks assíncronos locais podiam limpar `busyStage` sem guardar geração/contexto.
- **Solução aplicada:** em [staffEntryService.js](../app/services/staffEntryService.js), introduzido `busyKind` geracional diretamente no estado da store (`'preparing'`, `'dispatching'`, `'mutating'`, `'acknowledging'`, `'cancelling'`), limpo por `setContext()` e no `finally` somente sob `generation === currentGeneration && isCurrent(context)` sem alterar o formato salvo no `SecureStore`. Em [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js), removida a inferência via `pending?.phase === 'reserved'`, priorizado `snapshot.busyKind ?? busyStage` com proteção `busyTokenRef` e exibidas mensagens fiéis por etapa (`"Preparando solicitação com segurança..."`, `"Registrando envio seguro..."`, `"Processando operação no servidor..."`, `"Finalizando reconhecimento seguro local..."` e `"Descartando solicitação não enviada..."`).
- **Arquivos alterados:** [app/services/staffEntryService.js](../app/services/staffEntryService.js), [app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js).
- **Testes preparados:** [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) (`onSecureSet` controlada cobrindo os 8 cenários na tela) e [app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs) (troca de contexto com `acknowledge` em voo não limpando `busyKind` do novo contexto).
- **Verificações realizadas:** `node --input-type=module --check`, `@babel/parser` JSX, `node --check`, `git diff --check`.
- **Limitações:** transição visual entre `preparing` e `dispatching` com `SecureStore` instantâneo no dispositivo físico ocorre em milissegundos, sendo observável sobretudo sob contenção de armazenamento.

#### `STAFF04-AUD-04` (P1) — Bloqueio de autorização antes da persistência local e barreira síncrona reserva→despacho

- **Causa:** em [staffOperationsService.js](../app/services/staffOperationsService.js) + [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), a tela só reagia à negativa `401`/`403` da mutação após concluir `storage.recordTerminal()` e `storage.clear()`; ademais, tanto [staffOperationsService.js](../app/services/staffOperationsService.js) quanto [staffEntryService.js](../app/services/staffEntryService.js) ainda dependiam de propagação reativa assíncrona caso um GET concorrente recebesse `401`/`403` entre `reserve()`, `dispatch()` e envio HTTP.
- **Solução aplicada:** adicionado callback `onAuthError` em [staffOperationsService.js](../app/services/staffOperationsService.js) acionado imediatamente ao classificar `401`/`403` antes de `storage.recordTerminal()`, invocando `revokeStationAccess()` e `onAccessDenied` na [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js) enquanto a persistência do recibo `.receipt` e a limpeza da chave primária prosseguem com segurança para a intenção original; incluída barreira síncrona `!revokedKindRef.current` em `isCurrent` do coordenador e `revokedKind` entre `reserve()`, `dispatch()` e HTTP em [staffEntryService.js](../app/services/staffEntryService.js) (cancelando somente `reserved` não enviada e conservando `dispatching` já gravada, além de impedir `refresh()` final pós-revogação).
- **Arquivos alterados:** [app/services/staffOperationsService.js](../app/services/staffOperationsService.js), [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), [app/services/staffEntryService.js](../app/services/staffEntryService.js).
- **Testes preparados:** [app/tests/staffOperationsService.integration.test.cjs](../app/tests/staffOperationsService.integration.test.cjs), [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs), [app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs), [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) com promessas pendentes em `recordTerminal()`, `clear()`, `finish()`, `reserve()` e `dispatch()`, verificando bloqueio de UI e travas antes da conclusão do armazenamento.
- **Verificações realizadas:** `node --input-type=module --check`, `@babel/parser` JSX, `node --check`, `git diff --check`.
- **Limitações:** comportamento conjunto contra revogação real concorrente no servidor depende da etapa integrada e homologação controlada.

#### `STAFF04-AUD-06` (P2) — Consolidação de agendador único de 60s dentro do evento selecionado

- **Causa:** [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js) mantinha simultaneamente `useStaffPolling(..., 60000, staff.selected?.id)` em `StaffEventHomeScreen` e `useStaffPolling(eventPhasePollingEnabled, ..., 60000, ...)` em `StaffEventDashboard`.
- **Solução aplicada:** removido o `useStaffPolling` duplicado de `StaffEventHomeScreen` e consolidado o agendamento único de 60s em `StaffEventDashboard` (ativo em Painel Operacional, Controle de Entrada e Estação com a mesma condição `eventPhasePollingEnabled` usada por `eventPhaseIndicator`, adicionando também `verifying` ao indicador).
- **Arquivos alterados:** [app/screens/staff/StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js).
- **Testes preparados:** [app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs) (comprovação de escopo único `:events:` entre Painel, Entrada e Estação) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (todos os 10 cenários com `useStaffPolling` real e `manualTimers: true`, incluindo resposta lenta, foco, `AppState`, troca de evento/identidade, `accessUncertain`, `403` e correspondência fiel com o indicador).
- **Verificações realizadas:** `@babel/parser` JSX, `node --check`, `git diff --check`.
- **Limitações:** campanha com relógio real e alternância visual no Expo Go pendente na homologação.

#### `STAFF04-AUD-07` (P1) — Alinhamento das fixtures de teste ao contrato de 3 chaves de `staffIntentStorage`

- **Causa:** [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) (linhas 1282–1284) consultava a chave primária esperando resultado terminal após `clear()`, e [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (linha 4309) aplicava `assert.equal(deleteCalls, 0)` no fluxo de Estação, onde `clear()` remove legitimamente a chave primária após salvar `.receipt`.
- **Solução aplicada:** corrigidas as asserções em [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) e [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) para validar a estrutura oficial de [staffIntentStorage.js](../app/services/staffIntentStorage.js) (`.receipt` com resultado/escopo/chave originais, chave primária removida apenas após `.receipt` gravado ou mantida em `dispatching` desconhecido/falha local e ausência de `.ack`, rastreando `deletedKeys` e zero replays).
- **Arquivos alterados:** [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs), [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs).
- **Verificações realizadas:** `node --check`, `git diff --check`.
- **Limitações:** execução das suítes pendente para **GPT-6 Luna — Medium**.

---

## Auditoria Independente — Rodada 3

Auditoria estática independente realizada sobre o commit `35e7c4e584db50a8bc86af5e84d46906e770a351` (branch `feature/staff-operacional-v2`, base original da STAFF-04: `6c77c3b515ef4ed47607250081055868cc803a30`). Os achados `STAFF04-AUD-01` a `STAFF04-AUD-07` foram considerados corrigidos nos respectivos cenários de referência por inspeção estática; abaixo estão documentadas as correções aplicadas exclusivamente para `STAFF04-AUD-08`, `STAFF04-AUD-09` e `STAFF04-AUD-10` (com campanha automatizada ainda pendente de execução em **GPT-6 Luna — Medium**).

### Resumo dos achados tratados (Rodada 3)

| ID | Prioridade | Status da preparação |
|---|---|---|
| `STAFF04-AUD-08` | P1 | Guarda individual em leituras preliminares paralelas aplicada e 8 cenários preparados (pendente execução por Luna Medium) |
| `STAFF04-AUD-09` | P2 | Isolamento integral de contexto/visita/operação e revalidação GET local corrigidos com testes preparados (pendente execução por Luna Medium) |
| `STAFF04-AUD-10` | P2 | Estágio `'persisting'` explícito pós-resposta definitiva aplicado em Entrada e Estações com testes preparados (pendente execução por Luna Medium) |

### Detalhamento completo por achado (Rodada 3)

#### `STAFF04-AUD-08` (P1) — Negativa de autorização não ocultada por falha concorrente em pré-condições paralelas

- **Causa técnica:** em [staffOperationsService.js](../app/services/staffOperationsService.js), `callNext()` executava `Promise.all([fetchStaffQueue(...), fetchStaffStations(...)])` e entregava apenas a primeira rejeição ao bloco `catch` de `execute()`. Se uma das leituras falhasse primeiro com erro transitório (`503`, queda de rede ou `timeout`) e a leitura irmã rejeitasse em seguida com `401` ou `403`, a segunda rejeição era descartada pelo `Promise.all`, deixando de acionar `onAuthError`, de limpar os dados operacionais protegidos e de propagar `onAccessDenied` ao Painel.
- **Solução adotada:** introduzida `createPreconditionAuthGuard(context, desired)` em [staffOperationsService.js](../app/services/staffOperationsService.js), envolvendo individualmente cada leitura preliminar (`observe(fetchStaffQueue(...))` e `observe(fetchStaffStations(...))` em `callNext`, além das leituras preliminares das demais operações). Assim que qualquer leitura preliminar rejeita com `401`/`403` enquanto `isCurrent(context, desired)` permanece verdadeiro para o contexto/visita original, `onAuthError` é disparado imediatamente (sem aguardar consulta irmã pendente, mesmo após rejeição `503`/rede/`timeout` anterior da outra leitura e com trava `notified` contra duplicação). Em `execute()`, quando `preconditionGuard.wasNotified()` já ocorreu na chamada corrente, preserva-se o retorno estruturado `{ kind: 'rejected', phase: 'precondition', status: 401|403 }` em vez de sobrescrevê-lo como `stale`, mantendo zero reservas/mutações iniciadas e total isolamento caso conta, sessão, evento, estação ou visita já tenham mudado.
- **Arquivos modificados:** [app/services/staffOperationsService.js](../app/services/staffOperationsService.js), [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js).
- **Testes preparados:** [app/tests/staffOperationsService.integration.test.cjs](../app/tests/staffOperationsService.integration.test.cjs) (8 cenários: `503` em `/queue` + `403` em `/stations`; `403` em `/queue` com `/stations` pendente; `network`/`timeout` + `401`; duplo `403` sem duplicação de `onAuthError`; `503` + `503` mantendo erro transitório sem bloqueio indevido; isolamento após troca de conta/evento/estação; e revalidação autorizada subsequente), [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) (tela de Estação limpando dados nominais, invalidando `poll()` concorrente e propagando `onAccessDenied` sob `503`→`403` e sob `403` com consulta irmã pendente) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (fluxo ponta a ponta desmontando Estação e bloqueando Painel).
- **Verificações estáticas realizadas:** `node --input-type=module --check`, `@babel/parser` JSX, `node --check`, `git diff --check`.
- **Riscos e limitações:** a validação em execução real dos cenários temporizados de concorrência aguarda a campanha automatizada conjunta com **GPT-6 Luna — Medium**.

#### `STAFF04-AUD-09` (P2) — Isolamento completo do contexto em feedback tardio e coerência da revalidação GET

- **Causa técnica:** dois pontos complementares em [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js):
  1. Ao concluir `storage.recordTerminal()`/`storage.clear()` de uma operação que havia sofrido `401`/`403`, o ramo `preservedFeedback` comparava apenas `scope.eventId === String(event.id)` e `scope.userId === String(auth.user.id)`, ignorando `sessionId`, `stationId`, `epoch`, `revision`, permanência na mesma visita (`visitId`) e ausência de `accessDenied` externo — permitindo que um retorno tardio do armazenamento publicasse feedback visual em nova sessão, nova revisão do token, outra estação ou nova entrada na tela.
  2. Em `refresh()`, a leitura manual chamava `coordinator.readStationState(scope)` antes de limpar `revokedKindRef.current`; como `isCurrent` do coordenador verifica `!revokedKindRef.current`, `alive()` lançava `'Sessão alterada durante a leitura.'` mesmo diante de um `GET 200` legítimo quando a tela permanecia montada com `accessDenied={false}` e exibia o botão `"Atualizar atendimento"`.
- **Solução adotada:**
  1. Removido integralmente o fallback parcial por `userId + eventId` em [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js). Adicionados `visitIdRef` (incrementado a cada montagem/troca de escopo e invalidado no `unmount`), `opSeqRef`, `activeOpIdRef` e `revokedByOpRef`: qualquer publicação tardia de `feedback` ou `onStage` exige simultaneamente `mounted`, `!accessDenied`, `originVisitId === visitIdRef.current`, `opSeqRef.current === opId` (ou `activeOpIdRef.current === opId` para estágios) e igualdade integral dos 6 campos de `same(scope, getContext())` (`userId`, `sessionId`, `eventId`, `stationId`, `epoch`, `revision`), enquanto a gravação durável de `.receipt` e os bloqueios de autorização permanecem independentes da camada visual.
  2. Em `refresh()`, substituída a leitura indireta via `coordinator.readStationState` pela chamada direta a `fetchStaffStationState` (alinhada a `poll()`), limpando `revokedKindRef.current = null` **exclusivamente** após confirmação de `GET 200` válido na geração e visita vigentes (`current()`) e **antes** de consultar `coordinator.pending(scope)`, revalidando `!current() || revokedKindRef.current` em seguida; falhas `503`/rede/timeout mantêm `revokedKindRef.current` intacto e mutações continuam bloqueadas por `!revokedKindRef.current` enquanto não houver revalidação `200`.
  3. **Caminhos oficiais de recuperação documentados:** na navegação integrada (`StaffEventsNavigator` / `StaffEventDashboard`), `onAccessDenied` ativa `accessLocked` no painel e desmonta imediatamente a `StaffStationOperationalScreen` (`resolvedStation = null`), de modo que a recuperação oficial ocorre retornando ao Painel Operacional e acionando **`"Atualizar estações"`** (`store.refreshPanel()`). Quando `StaffStationOperationalScreen` recebe `accessDenied={true}` por prop, renderiza apenas o card de bloqueio sem oferecer botão local inoperante; quando permanece montada de forma autônoma com `accessDenied={false}`, o botão **`"Atualizar atendimento"`** executa a revalidação GET real e só restaura a tela após `200` autorizado, preservando intactas as intenções/recibos pendentes no `SecureStore`.
- **Arquivos modificados:** [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js).
- **Testes preparados:** [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) (5 transições com `recordTerminal` atrasado: troca de `sessionId`, troca de `revision`/`epoch`, troca de `stationId`, saída e retorno à mesma estação e `accessDenied={true}`, além de `503` manual não reabilitando `403` e `200` manual legítimo restaurando a estação sem perder `.receipt`) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (recuperação oficial pelo Painel e ausência de vazamento após troca de sessão).
- **Verificações estáticas realizadas:** `@babel/parser` JSX, `node --check`, `git diff --check`.
- **Riscos e limitações:** a separação entre recuperação via Painel (fluxo integrado padrão) e recuperação local na Estação (`accessDenied={false}`) é intencional para respeitar o bloqueio centralizado de `StaffEventDashboard` introduzido nas STAFF-02/STAFF-04.

#### `STAFF04-AUD-10` (P2) — Distinção explícita entre processamento no servidor e persistência segura local do resultado

- **Causa técnica:** após o servidor retornar e o parser validar um resultado definitivo (confirmado ou recusado não-auth como `409`/`404`/`400`), tanto [staffEntryService.js](../app/services/staffEntryService.js) (durante `await storage.finish(...)`) quanto [staffOperationsService.js](../app/services/staffOperationsService.js) (durante `await storage.recordTerminal(...)` e `await storage.clear(...)`) mantinham o estágio `'mutating'`, fazendo [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) e [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js) exibirem *"Processando operação no servidor..."* enquanto ocorria apenas gravação local no `SecureStore` (e, nas Estações, omitindo também `'preparing'` e `'dispatching'` em `onStage`).
- **Solução adotada:**
  1. Em [staffOperationsService.js](../app/services/staffOperationsService.js), ampliada a emissão de `onStage` para `'preparing'` (antes de `storage.reserve`), `'dispatching'` (antes de `storage.dispatch`), `'mutating'` (antes da requisição HTTP) e `'persisting'` (imediatamente antes de `storage.recordTerminal`, cobrindo também `storage.clear` subsequente) exclusivamente quando há resultado definitivo validado e `!revokedByCurrentAuth` (resultados `uncertain` retornam antes sem emitir `'persisting'`, e negativas `401`/`403` priorizam `onAuthError` imediato).
  2. Em [staffEntryService.js](../app/services/staffEntryService.js), após resposta HTTP definitiva não-auth, `mutate()` publica `busyKind: 'persisting'` antes de `await storage.finish(...)` (sob guarda `sameOperationScope()`), enquanto negativas `401`/`403` publicam imediatamente `busy: false, busyKind: null, data: null` antes da persistência local; resultados `uncertain` não emitem `'persisting'` nem confirmação prematura.
  3. Em [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) e [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), mapeado o estágio `'persisting'` para **`"Registrando resultado com segurança..."`** (além de `'preparing'` e `'dispatching'` na Estação), mantendo intacto o formato persistido em [staffIntentStorage.js](../app/services/staffIntentStorage.js) e [staffEntryIntentStorage.js](../app/services/staffEntryIntentStorage.js) e protegendo `onStage` contra gerações/visitas/operações antigas.
- **Arquivos modificados:** [app/services/staffOperationsService.js](../app/services/staffOperationsService.js), [app/services/staffEntryService.js](../app/services/staffEntryService.js), [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js), [app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js).
- **Testes preparados:** [app/tests/staffOperationsService.integration.test.cjs](../app/tests/staffOperationsService.integration.test.cjs), [app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs), [app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs), [app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) e [app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) cobrindo `recordTerminal()`, `clear()` e `finish()` controlados em sucesso e recusa definitiva (`409`), limpeza imediata sem banner `busy` em `401`/`403`, ausência de `'persisting'` em `uncertain` e descarte de `onStage` obsoleto em troca de contexto.
- **Verificações estáticas realizadas:** `node --input-type=module --check`, `@babel/parser` JSX, `node --check`, `git diff --check`.
- **Riscos e limitações:** em dispositivos com `SecureStore` rápido, a etapa `"Registrando resultado com segurança..."` dura poucos milissegundos em operação normal, tornando-se visualmente proeminente apenas sob latência de I/O local.

### Campanha de Validação Automatizada Conjunta — STAFF-03 + STAFF-04

**Execução parcial — 27/11/2026 — GPT-6 Luna Medium**, no HEAD `9ee8789fdf22fd38b4f1d8303d2012706b4586d4` da branch `feature/staff-operacional-v2`.

O achado `STAFF04-VAL-01` teve duas inconsistências na fixture do cenário `STAFF04-AUD-06 + AUD-04 (integrado)`: (1) a resposta HTTP pendente capturava antecipadamente a fase `open`, mesmo após o teste mudar a intenção para `closing`; (2) a expectativa `Status: Encerrando` não correspondia ao rótulo oficial `STATUS_LABELS.closing = 'Em encerramento'`. A fixture passou a fornecer explicitamente `closing` ao resolver a resposta pendente. A asserção foi ajustada para `Status: Em encerramento`, e o estado inicial `Status: Aberto` é verificado. O teste isolado passou (1/1, sem skips ou cancelamentos, código 0).

A suíte completa `roleRoutingIntegration.test.cjs` terminou normalmente em 42.944 ms, com 63 aprovados, 1 falho, zero ignorados ou cancelados, código 1. O caso falho `STAFF04-AUD-01/02/04/05` esperava o botão `Cancelar` ao fechar o modal de conclusão da experiência; `app.press()` encontrou zero correspondências (`roleRoutingIntegration.test.cjs:4178`, helper na linha 283). Causa ainda não confirmada; a campanha foi interrompida e nenhum outro teste/código foi alterado. A falha não permite concluir se é fixture, implementação ou regressão sem inspeção adicional.

O teste combinado que havia ficado sem conclusão na campanha anterior não reproduziu o travamento quando executado isoladamente nem durante a suíte completa desta retomada. Isso não explica definitivamente a interrupção anterior. Ainda pendem as outras suítes focadas, typecheck/lint/build/unitários do backend e as regressões completas de App e QA independente. Nenhuma integração PostgreSQL/Neon, migration, seed ou homologação Expo foi executada.

### STAFF04-VAL-02 — Fixture de cancelamento e visibilidade do modal

A suíte de integração havia falhado em `STAFF04-AUD-01/02/04/05` porque o harness procurava o rótulo `Cancelar`, enquanto `StationConfirmModal` expõe `CANCELAR OPERAÇÃO` como `accessibilityLabel`. A fixture agora aciona o rótulo correto, verifica `visible: false` no Modal ainda montado e confirma que a participação pendente permanece preservada, sem mutação. O teste isolado passou (1/1); a suíte integral de integração passou (64/64, código 0).

Na retomada, `staffPolling.test.cjs` passou (6/6). `staffEventDiscovery.test.cjs` falhou em `STAFF04-AUD-02` (13/14): após um 403 no polling de eventos, a linha 1396 esperava `latestEventsPolling()?.enabled === false`, mas recebeu `true`. A falha bloqueia a continuação e permanece sem causa confirmada; não houve alteração nesse cenário. As outras suítes focadas, verificações do backend e regressões completas não foram executadas nesta retomada.

A tentativa de campanha anterior que foi interrompida sem resumo não voltou a travar nesta rodada: o teste de modal isolado e a integração completa terminaram normalmente. Isso não estabelece a causa do travamento anterior.

Integração PostgreSQL/Neon, migrations, seeds e homologação Expo não foram executadas. STAFF-03 e STAFF-04 continuam sem validação automatizada conjunta completa ou aprovação formal.

### STAFF04-VAL-03 — Ciclo de vida do polling no harness

**Causa confirmada:** o harness registrava apenas snapshots históricos de `useStaffPolling`; o seletor do evento retornava registros de escopo indefinido, pertencentes à Seleção de Eventos, mesmo quando o Painel com escopo `${event.id}:events:${epoch}:${revision}` estava montado. Após o 403, o registro antigo continuava aparecendo como habilitado, causando a falha da linha 1396 de `staffEventDiscovery.test.cjs`.

**Correção:** preservado o histórico para as asserções existentes e adicionado um mapa distinto de registros atualmente montados, com identidade estável por `useRef`, atualização no efeito e remoção por cleanup. Os helpers atuais passaram a selecionar primeiro o polling do evento com escopo `:events:`. O teste verifica o registro único ativo do Painel antes do 403 e que ele deixa de ser acionável após o bloqueio/desmontagem.

**Resultados:** STAFF04-AUD-02 isolado 1/1; `staffEventDiscovery` 14/14; `staffDashboard` 25/25. `roleRoutingIntegration` permanece 64/64; `staffPolling` 6/6. A execução seguinte, `staffOperationsService.integration`, falhou em STAFF04-AUD-04 (68/69): expectativa de sequência `post:401`, `onAuthError:session`, `recordTerminal:start` recebeu vetor vazio em `app/tests/staffOperationsService.integration.test.cjs:1114`. Causa ainda não classificada; nenhuma correção foi aplicada, e as suítes seguintes foram suspensas.

Nenhuma validação Backend, regressão completa App/QA, PostgreSQL/Neon, migration, seed ou Expo foi executada nesta etapa. As tasks permanecem sem aprovação automatizada conjunta integral ou aprovação formal.

### STAFF04-VAL-04 — Sincronização determinística dos testes do coordenador

**Correção aplicada somente ao teste** `app/tests/staffOperationsService.integration.test.cjs`: sinais deferred explícitos acompanham o início de `recordTerminal()`, `clear()`, `reserve()` e `dispatch()` nos subcenários STAFF04-AUD-04. A espera possui limite de 3 segundos, diferencia operação encerrada/falha antes da etapa e libera os gates em `finally`. As asserções temporais e de persistência foram preservadas, inclusive os casos 401 e 403, recibo terminal, intenção presente durante `clear()`, remoção após sua conclusão, troca de conta e ausência de POST após contexto obsoleto.

**Validação executada com `NODE_ENV=test`:** cenário filtrado STAFF04-AUD-04: 1/1, código 0, 627 ms. Suíte `staffOperationsService.integration.test.cjs`: 69/69, código 0, 1.607 ms. Ambas sem falhas, ignorados ou cancelados. Aviso não bloqueante do Node: `staffOperationsService.js` é inferido como ES module sem `type: module` no `package.json`.

A campanha retomada prosseguiu para `staffEntryControl.test.cjs`, que teve 35 aprovados e 1 falho, código 1, em 906 ms. O teste `STAFF04-AUD-04: 404 RESOURCE_NOT_FOUND na resolução de chamada...` falhou em `staffEntryControl.test.cjs:536`: resultado observado `blocked`, esperado `rejected`. Diagnóstico estático: a fixture `stateWithCall` herda de `body()` a participante `id(4)` na fila e também declara essa mesma participante em `pendingCall`; `parseEntryState()` rejeita a duplicidade e o store não alcança estado `ready`. Isso indica fixture inconsistente, não prova falha de produção. A campanha foi interrompida; nenhuma modificação foi feita nesse cenário.

Permanecem pendentes `staffEntryControlScreen`, `staffStationOperational`, `staffRealNavigation`, `staffBackground`, `staffDemoState`, `participationService`, verificações de backend e regressões completas de App e QA. Não foram executados PostgreSQL/Neon, migrations, seeds nem homologação Expo. STAFF-03/04 não estão aprovadas formalmente.
### STAFF04-VAL-05 — Fixture 404, recibo e revalidação contextual

**Correções somente em `app/tests/staffEntryControl.test.cjs`:** `stateWithCall` agora representa a participante chamada fora da FIFO e uma fila restante válida (`waitingCount: 1`, posição 1). Foi adicionada uma asserção ao teste do parser para a duplicidade entre `pendingCall` e `waiting`. O teste confere `kind/status` em `mutate()`, o `RESOURCE_NOT_FOUND` no resultado terminal do snapshot e no registro realmente persistido antes do reconhecimento, e utiliza chaves distintas `id(30)`, `id(31)` e `id(32)`.

A revalidação é acionada pelo fluxo real de `mutate()` após cada POST: Caso A, POST 404 + GET 200 mantém o evento pronto e apresenta o novo estado; Caso B, POST 404 + GET 403 preserva o recibo da mutação, bloqueia o contexto e remove os dados protegidos; Caso C, POST 404 + GET 404 contextual também bloqueia e remove dados. O segundo POST foi confirmado e utiliza chave diferente da primeira operação.

**Resultados efetivos:** teste isolado filtrado: 1 aprovado, 0 falhos/ignorados/cancelados, código 0, 528 ms. `staffEntryControl.test.cjs`: 36 aprovados, 0 falhos/ignorados/cancelados, código 0, 1.152 ms. `staffEntryControlScreen.test.cjs`: 10 aprovados, 3 falhos, 0 ignorados/cancelados, código 1, 4.221 ms. A campanha parou nessa primeira suíte falha.

Diagnóstico estático das três falhas: `staffEntryControlScreen.test.cjs:1004` espera texto de acesso ao evento enquanto `StaffSyncFeedback.js` retorna “O acesso a esta operação não está disponível”; linhas 1152 e 1324 dereferenciam `postDeferred` após o callback `onPost` copiar seu valor e zerar a variável compartilhada. Não foi feita correção nesses testes. A saída também contém avisos não bloqueantes de depreciação de `react-test-renderer` e atualizações React fora de `act(...)`.

Continuam pendentes `staffStationOperational.test.cjs`, `staffRealNavigation.test.cjs`, `staffBackground.test.cjs`, `staffDemoState.test.cjs`, `participationService.test.cjs`, as verificações de backend e as regressões completas de App e QA independente. Não foram executados PostgreSQL/Neon, migrations, seeds ou homologação Expo. STAFF-03/04 não estão aprovadas formalmente.
### STAFF04-VAL-06 — Feedback e promises controladas da tela de Entrada

**Escopo de implementação:** apenas `app/tests/staffEntryControlScreen.test.cjs`. As verificações de pré-condição 403 e 404 agora exigem as mensagens completas de `StaffSyncFeedback` e o tom `warning`; 401 e 409 também são conferidos no contexto de pré-condição, incluindo a informação de que nenhuma alteração foi enviada. As expectativas específicas de `describeStationRejection()` para mutações foram mantidas.

As referências de promises controladas nos fluxos de ausência e confirmação foram separadas da variável consumível `postDeferred`. Sinais de entrada com timeout identificável comprovam POST, reserva, despacho, reconhecimento e cancelamento. Gates são liberados em `finally`, operações pendentes são aguardadas, falhas originais são preservadas contra erro de cleanup e os dois renderers são desmontados dentro de `act()`. A resolução do POST é seguida de uma etapa `act()` separada para permitir o efeito React que inicia o reconhecimento.

**Validação dos três cenários selecionados:** comando filtrado com `STAFF-04: StaffSyncFeedback|STAFF-04 tela Controle de Entrada|STAFF04-AUD-03: StaffEntryControlRealScreen`. Primeira execução: 2 aprovados, 1 falho, código 1, 4.315 ms; AUD-03 teve timeout no sinal de reconhecimento. Após sincronização do ciclo React/`act`, segunda execução: 2 aprovados, 1 falho, código 1, 1.646 ms; AUD-03 atingiu a asserção posterior de falha de armazenamento, mas a mensagem esperada não estava visível (`staffEntryControlScreen.test.cjs:1434`). A suíte completa terminou com 12 aprovados, 1 falho, zero ignorados/cancelados, código 1, 3.913 ms, na mesma asserção. O diagnóstico então pendente foi confirmado em VAL-09: após `reserve()` falhar antes da escrita, `mutate()` publica `storageError: true` e `feedback: 'storage'`; o `refresh()` do `finally` recupera a disponibilidade do SecureStore (`storageError: false`) sem apagar `feedback`, mas a tela condiciona o aviso somente a `storageError`, fazendo a mensagem desaparecer. Nenhuma mudança de produção ou nessa asserção foi feita.

**Cinco suítes focadas independentes:** `staffStationOperational.test.cjs` ficou em execução por mais de 30 s; foi encerrada sem resumo final. Saída parcial: 5 aprovados e 3 falhos. O filtro diagnóstico posterior executou exatamente os três casos falhos (0 aprovados, 3 falhos, código 1, 1.245 ms): (1) `STAFF-04 tela Estação`, TypeError em `:869`, `postDeferred` nulo após o callback consumi-lo; (2) `STAFF04-AUD-01`, asserção em `:1030` exige botão `Cancelar` mas o harness encontra zero; o componente expõe o rótulo `CANCELAR OPERAÇÃO`; (3) `STAFF04-AUD-03`, TypeError em `:1149` pela mesma referência nula a `postDeferred`. Provável bloqueio de execução completa: primeiro subcaso de `STAFF04-AUD-08`, que aguarda a operação enquanto o GET `/stations` está pendente; inferência estática, não causa confirmada. As demais passaram: `staffRealNavigation` 2/2 (1.394 ms), `staffBackground` 1/1 (95 ms), `staffDemoState` 22/22 (480 ms) e `participationService` 13/13 (436 ms); todas código 0, sem ignorados/cancelados.

As suítes anteriormente aprovadas permanecem registradas: `roleRoutingIntegration` 64/64, `staffPolling` 6/6, `staffEventDiscovery` 14/14, `staffDashboard` 25/25, `staffOperationsService.integration` 69/69 e `staffEntryControl` 36/36. A validação ampliada de backend, regressão completa App e QA não foi executada porque há falha e bloqueio nas suítes focadas. Avisos observados: depreciação de `react-test-renderer` e atualizações React fora de `act()` na suíte completa de telas; warnings não foram suprimidos. Nenhum PostgreSQL/Neon, migration, seed, homologação ou publicação Git foi executado. STAFF-03/04 não estão aprovadas formalmente.

### Implementação final e preparação pré-merge — 27/11/2026

**Estado atual: implementação preparada, não validada.** Referência `9ee8789fdf22fd38b4f1d8303d2012706b4586d4`, branch `feature/staff-operacional-v2`. Os 275/276 resultados anteriores não validam as alterações desta rodada. Nenhum teste, lint, typecheck, build, PostgreSQL, seed ou migration foi executado nesta implementação.

#### STAFF04-VAL-09 — Correção de produção preparada

Alterado apenas `StaffEntryControlRealScreen.js` no código de produção. Aproveitado `snapshot.feedback === 'storage'`, que o serviço já preserva durante refresh/polling. Com armazenamento atualmente indisponível, permanece a mensagem original de atualização obrigatória. Após recuperação, o aviso histórico mantém a frase original e informa que a tentativa anterior não pôde ser concluída com segurança e que o armazenamento voltou a responder. Nenhuma mensagem nova afirma que a solicitação não foi enviada. O aviso histórico genérico não é apresentado com `knownOutcome`: nesse caso permanece o aviso específico de confirmação/recusa. Negativas de autorização têm prioridade e ocultam o aviso de armazenamento.

Não foi criado estado adicional nem alterado o store ou formato persistente. O aviso dura durante refresh e polling; uma nova mutação válida já limpa/substitui `feedback`; reconhecimento/descarte efetivamente verificados e troca de contexto também o limpam. Tentativas bloqueadas não o apagam. Não há timer, replay, reconciliação por GET ou limpeza automática de intenções. A condição de habilitação dos botões não foi alterada: disponibilidade atual, intenção ativa, contexto e permissões continuam prevalecendo.

Testes preparados (não executados):

- A/H/I: mantida a asserção originalmente falha no AUD-03 da tela, acrescentando persistência do aviso após polling/refresh manual, preservação do registro acknowledged anterior, contagem de POST e chave diferente na próxima operação legítima, sem apagar manualmente a intenção anterior.
- A/B/C: quatro casos novos de tela controlam falhas antes/depois da escrita de reserved/dispatching; conferem zero POST/PATCH, storage_error, aviso recuperado, bloqueio conforme intenção persistida, preservação do registro e isolamento após troca de sessão. Gates têm sinal explícito, timeout diagnóstico e cleanup que preserva a falha original.
- A/B/C/H/I: ampliados os quatro casos do store com retorno storage_error, recuperação de storageError, feedback sobrevivendo a polling/refresh, bloqueio de intenções ativas, descarte seguro, chave nova após falha anterior à reserva e limpeza de feedback na nova sessão.
- D/E/F/G: preservados os testes existentes de knownOutcome confirmado/recusado após falha terminal, uncertain/dispatching sem replay, 401/403 durante persistência, recibos históricos e troca de identidade/evento/epoch/revision. A cobertura existente não equivale a nova execução; requer revalidação integral.

#### Investigação complementar da Estação

AUD-09/AUD-10 anteriores não verificavam diretamente busy herdado em uma mutação sem negativa de autorização. Preparado o caso `STAFF04-VAL-09: novo contexto não herda busy da mutação não-auth da Estação anterior`: POST controlado, troca ST_1 → ST_2, ausência dos textos reais de busyKind, intenção antiga ainda bloqueante, zero POST extra e descarte da recusa 409 tardia. Corrigida também uma asserção negativa de AUD-09 para a mensagem real de `rejected_cleanup_pending`, evitando buscar texto obsoleto.

**Defeito adicional identificado estaticamente, ainda sem execução:** `refresh()` da Estação aplica spread de `previous` e não limpa busy/busyKind ao receber novo scope; o efeito de troca invalida a operação antiga, cujo retorno também não limpa o novo contexto. Assim, busy pode ficar herdado. A proposta mínima é reinicializar busy/busyKind somente na troca de visita/contexto, preservando a intenção persistida e as guards dos callbacks. Não foi alterado código de produção da Estação. O teste novo pode expor esse bloqueio e não deve ser marcado skip ou ter expectativas enfraquecidas para avançar a campanha.

#### STAFF03-VAL-01 — Tipagem transacional

Em evidência complementar separada: `drizzle(client, { schema })` substitui o cast baseado em ConstructorParameters. As declarações instaladas admitem pg.Client em NodePgClient; drizzle é função, não construtor. Mesma instância transacional, guards, transação/rollback, observador, relógio, savepoints e projeções preservados. Typecheck pendente; nenhum acesso a banco foi executado.

#### PREMERGE-VAL-01 — Lint preexistente

Evidência separada contém somente os três arquivos reportados. `configurationQuery.search` verifica code units por `Array.from(...).every(...)`, equivalente à rejeição de U+0000–001F/U+007F e surrogates isolados, preservando normalização anterior, limites e busca. Pares válidos continuam aceitos. Isso remove a regex reportada por `no-control-regex` sem desabilitar regra.

As duas fixtures importam `createRequire` de node:module e carregam o mesmo CommonJS relativamente a `__filename`, compatível com module commonjs. Preservada a inferência dinâmica já existente para exports dos .cjs, sem casts, novas declarações any ou supressões. Isso remove as chamadas diretas require reportadas por `no-require-imports`. Scripts de preparação e suas barreiras não foram alterados/executados. ESLint e typecheck ainda precisam comprovar a correção.

#### ENV-VAL-01 — Plano para Luna Medium

O log anterior ocorreu antes do runner em `node:os.userInfo`. O arquivo instalado `tsx/dist/temporary-directory-Du7LpLp9.mjs` consulta `process.geteuid()` quando disponível; no Windows utiliza `os.userInfo().username` e compõe um diretório sob `os.tmpdir()`. ENOMEM não comprova falta de memória física. O Node do log era 24.15.0, compatível com engines >=24.15.0; conferir a versão efetiva na próxima execução.

Plano de diagnostico da campanha anterior, executado nesta revalidacao: confirmar versao Node; testar os.userInfo/os.tmpdir sem expor usuario/caminhos; testar escrita em arquivo temporario exclusivo; conferir somente presenca de TEMP/TMP/USERPROFILE/NODE_OPTIONS; inspecionar recursos/permissoes e inicializacao do tsx. Os resultados efetivos estao registrados na secao Revalidacao conjunta abaixo.

#### Evidências e próxima campanha

- `STAFF-04-changes.diff`: acumulado desde `6c77c3b515ef4ed47607250081055868cc803a30`, somente app/ e as duas documentações; exclui o próprio patch e as correções backend de STAFF-03/pré-merge.
- `STAFF-03-typecheck-fix.diff`: complemento desde HEAD de referência, somente o teste SQL. O patch histórico `STAFF-03-changes.diff` permanece intacto.
- `PREMERGE-VAL-01-changes.diff`: complemento desde HEAD de referência, somente os três arquivos de lint.

Plano de execucao registrado antes da campanha de 27/11/2026; os resultados e bloqueios efetivos constam na secao Revalidacao conjunta abaixo. Suites completas App/QA condicionadas a todos os bloqueios focados resolvidos.

Inspeções estáticas efetivamente realizadas nesta implementação: `node --check` dos três testes CJS alterados; parse JSX com o @babel/parser já instalado em app (o caminho inicialmente consultado em qa/regression não possui esse pacote; nenhuma instalação foi feita); `git diff --check -- app backend docs`; `git apply --stat` e `git apply --reverse --check` dos três patches. Todos os checks finais retornaram 0. Conferidos escopos dos headers dos patches e ausência de backend/autorreferência no patch STAFF-04. O histórico STAFF-03 está idêntico ao HEAD, SHA-256 `9CB0BEE61A0CC5037A4F793E7E3FEECC13EE58EE2C72C2F9E5EB74E6B598B183`. Git avisa sobre normalização LF/CRLF; os patches foram mantidos no formato emitido por Git. Essas inspeções não substituem testes/typecheck/lint/build.

### Escopo da rodada final de implementação — 27/11/2026

Rodada aberta antes da implementação: corrigir a renderização do feedback histórico de armazenamento usando o estado existente; ampliar cobertura sem executar testes; revisar busy na troca de contexto da Estação; corrigir tipagem SQL e os três erros de lint em evidências separadas; preparar diagnóstico do ENOMEM para Luna Medium. Preservar todas as correções anteriores. Nenhuma validação automatizada ou operação de banco está autorizada nesta etapa.

### STAFF04-VAL-07/08/09 — Retomada de 27/11/2026

#### VAL-07 — Fixtures da Estação

Em `staffStationOperational.test.cjs`, o deferred do POST mantém referência estável mesmo após o callback consumir e zerar a variável compartilhada. O teste aguarda sinal explícito de início do POST antes de verificar processamento, polling pausado, bloqueio de duplo toque, contagem e confirmação. AUD-03 usa gates estáveis separados para GET de estações e POST, com sinais antes de conferir pré-condição e mutação. AUD-01 aciona o label acessível oficial `CANCELAR OPERAÇÃO`; o Modal segue montado com `visible: false`. Foram preservadas a pausa/retomada do polling e a ausência de mutação após cancelamento.

Os três cenários que falharam na rodada anterior passaram filtrados: 3 aprovados, 0 falhos/ignorados/cancelados, código 0, duração 1.501 ms. A suíte integral da Estação passou 11/11, sem falhas, ignorados ou cancelados, código 0, 5.880 ms.

#### VAL-08 — Sincronização concorrente do AUD-08

A sequência anterior podia aguardar `pCall` enquanto ela aguardava um GET operacional que o teste só resolveria depois; havia dependência circular entre a promise da operação e a resposta controlada. O cenário agora sinaliza o início de `/queue` e `/stations`, inicia `pCall` sem esperá-la, rejeita `/queue` com 503 e aguarda o início do GET operacional posterior sem resolver esse GET. Em seguida, o 403 de `/stations` revoga imediatamente o acesso e remove os dados protegidos; somente depois o teste resolve a leitura 200 atrasada e aguarda `pCall`. O segundo subcenário verifica 401 enquanto `/queue` permanece pendente. Ambos verificam zero POSTs. AUD-08 isolado passou 1/1, código 0, 1.146 ms. A suíte integral passou, confirmando a correção da sincronização do harness.

#### VAL-09 — Diagnóstico do aviso perdido

A revalidação isolada de STAFF04-AUD-03 em `staffEntryControlScreen.test.cjs` falhou novamente na linha 1434: 0 aprovados, 1 falho, 0 ignorados/cancelados, código 1. O erro observado é a ausência de “Não foi possível verificar o registro seguro da solicitação.” A instrumentação temporária do teste foi retirada após a coleta.

Estágio e efeitos confirmados pelo fluxo e pelo harness:

- O bloqueio acontece em `storage.reserve(intent)`, no `setItemAsync` do SecureStore.
- O mock rejeita dentro de `onSecureSet` antes de executar `Map.set`; a nova intenção não foi gravada. O valor anterior continua sendo uma operação `acknowledged`, que `active()` considera não pendente.
- Como a exceção ocorre antes de `storage.dispatch` e da chamada HTTP, esta tentativa não envia POST nem PATCH. O `mutate()` retorna `{ kind: 'storage_error' }`.
- O `catch` publica `storageError: true` e `feedback: 'storage'`. O `finally` limpa `busy` e chama `refresh()`.
- O refresh retorna GET e SecureStore bem-sucedidos; publica `storageError: false`, preservando `feedback: 'storage'`. A renderização do aviso depende somente de `snapshot.storageError`, por isso o aviso some. A indisponibilidade atual foi recuperada, mas a falha da tentativa anterior ainda está no campo `feedback`.
- Depois de GET 200, leitura do SecureStore bem-sucedida, nenhuma intenção ativa e mesmo contexto autenticado, os controles podem permitir nova tentativa; a reserva posterior pode substituir uma intenção `acknowledged`. Se a falha ocorrer depois do dispatch, o estado `dispatching`/resultado desconhecido deve continuar bloqueando repetição; para falha após resposta definitiva, `knownOutcome` e recibo devem continuar visíveis e preservados.

Correção mínima proposta para uma tarefa posterior: separar o aviso persistente da tentativa anterior do indicador corrente de disponibilidade do armazenamento. O refresh pode limpar `storageError` após comprovar disponibilidade sem apagar o aviso. O aviso não deve ser, por si só, um bloqueio; manter os gates atuais para armazenamento indisponível, intenção ativa, resultado incerto, revogação e escopo obsoleto. Não limpar intenções automaticamente. Nenhuma produção ou asserção foi alterada nesta rodada. Naquela rodada, VAL-09 permanecia aberta; a revalidacao posterior passou, conforme os resultados atuais abaixo.

#### Resultado individual das 12 suítes focadas

| Suíte | Último resultado confirmado |
|---|---:|
| `roleRoutingIntegration` | 64/64 passou (execução anterior) |
| `staffPolling` | 6/6 passou (anterior) |
| `staffEventDiscovery` | 14/14 passou (anterior) |
| `staffDashboard` | 25/25 passou (anterior) |
| `staffOperationsService.integration` | 69/69 passou (anterior) |
| `staffEntryControl` | 36/36 passou (anterior) |
| `staffEntryControlScreen` | execução completa anterior 12/13; nesta rodada, filtro VAL-09 0/1 e falhou |
| `staffStationOperational` | 11/11 passou nesta rodada |
| `staffRealNavigation` | 2/2 passou (anterior) |
| `staffBackground` | 1/1 passou (anterior) |
| `staffDemoState` | 22/22 passou (anterior) |
| `participationService` | 13/13 passou (anterior) |

Os resultados marcados como anteriores não foram repetidos nesta rodada. Também passaram isoladamente AUD-09 (1/1, código 0, 1.710 ms) e AUD-10 (1/1, código 0, 851 ms); a suíte completa da Estação inclui ambos. Os runners React emitiram avisos não bloqueantes de depreciação de `react-test-renderer`.

#### Typecheck, lint, build e unitários do backend

Os scripts inspecionados em `backend/package.json` apontam `typecheck:test` para TypeScript, `lint` para ESLint do código/testes, `build` para `nest build` e `test` para `tsx --test test/unit/*.test.ts`. O script PostgreSQL `test:integration` não foi chamado.

- `npm run typecheck:test`: código 2; erro TS2344 em `test/integration/staff03-external-call-projection.integration.test.ts:67`, `typeof drizzle` incompatível com uma restrição de construtor.
- `npm run lint`: código 1; três erros: `src/events/admin-configuration.dto.ts:51`, `no-control-regex`; `test/unit/staff-a4-homolog-fixture.test.ts:4` e `test/unit/staff-homolog-fixture.test.ts:4`, `no-require-imports`.
- `npm run build`: código 0.
- `npm test`: código 1 antes de iniciar qualquer unitário; Node v24.15.0 reportou `uv_os_get_passwd returned ENOMEM` em `node:os.userInfo`, invocado pelo `tsx` ao criar diretório temporário.

Nenhum desses comandos acessou PostgreSQL. Regressões completas do App e QA seguem suspensas devido à falha da VAL-09. STAFF-03/04 continuam sem aprovação formal ou homologação.


### Revalidacao conjunta STAFF-03 + STAFF-04 — 27/11/2026

Modelo designado confirmado manualmente: GPT-6 Luna Medium. Branch feature/staff-operacional-v2, HEAD 9ee8789fdf22fd38b4f1d8303d2012706b4586d4. Scripts inspecionados; NODE_ENV=test. Resultados anteriores permanecem historicos e nao foram somados.

| Validacao/comando | Aprovados | Falhos | Ignorados/cancelados | Exit | Duracao |
|---|---:|---:|---:|---:|---:|
| VAL-09 store (filtro persistencia) | 6 | 0 | 0/0 | 0 | 897 ms |
| VAL-09 screen (4 casos + AUD-03) | 5 | 0 | 0/0 | 0 | 2.211 ms |
| staffEntryControl.test.cjs completa | 36 | 0 | 0/0 | 0 | 1.099 ms |
| staffEntryControlScreen.test.cjs completa | 17 | 0 | 0/0 | 0 | 6.191 ms |
| VAL-10 isolada, novo contexto sem busy | 0 | 1 | 0/0 | 1 | 1.228 ms |
| staffStationOperational.test.cjs completa | 11 | 1 | 0/0 | 1 | 7.292 ms |
| Backend typecheck:test | N/A | N/A | N/A | 0 | 9.779 ms |
| Backend lint | N/A | N/A | N/A | 0 | 6.856 ms |
| Backend build | N/A | N/A | N/A | 0 | 9.532 ms |
| Backend unit npm test | 0* | 0* | 0/0* | 1 | 662 ms |
| Regressao completa App | nao executada: bloqueada por VAL-10 | | | N/A | N/A |
| QA independente | nao executada: bloqueada por VAL-10 | | | N/A | N/A |

*Runner falhou antes da coleta de testes; nao houve casos funcionais. os.userInfo() e tsx falham com ERR_SYSTEM_ERROR/uv_os_get_passwd returned ENOMEM. os.tmpdir() e escrita/remocao no temp passaram; TEMP/TMP/USERPROFILE presentes, NODE_OPTIONS ausente. O processo PowerShell de controle estava em 67.8 MB de working set, 55.2 MB privados e 572 handles; no Windows, Node nao expoe geteuid/getuid. Esses dados nao caracterizam a memoria do processo Node ja encerrado e nao comprovam falta de memoria fisica.

#### STAFF04-VAL-09: passou nesta rodada

Seis cenarios focados do store e quatro casos de tela cobriram falhas antes/depois da escrita em reserved e dispatching. As suites passaram 36/36 e 17/17; filtro de tela passou 5/5 com AUD-03. Confirmados aviso apos refresh/polling, nenhum POST/PATCH quando a escrita falha, bloqueio coerente com intencao e feedback correto. Estes resultados superam as falhas historicas da VAL-09. Avisos: depreciacao react-test-renderer e atualizacoes React fora de act() na suite de tela.

#### STAFF04-VAL-10: falhou; regressao bloqueada

Em app/tests/staffStationOperational.test.cjs:2039, a operacao alcanca o POST controlado e a intencao original esta em dispatching. Apos trocar ST_1 por ST_2, os dados da fila B aparecem, mas continua o texto Processando operacao no servidor...; observado true, esperado false. A suite completa reproduziu a falha (11/12). As verificacoes posteriores de intencao bloqueante, zero POST extra e descarte do resultado tardio nao foram alcancadas. A leitura estatica de StaffStationOperationalScreen.js indica refresh preservando propriedades do estado anterior durante troca de scope; evidencia favorece defeito de producao, nao fixture. Nenhuma correcao foi feita. Correcao minima: limpar busy/busyKind apenas na troca de contexto/visita, mantendo intencao persistida e guards.

#### STAFF03-VAL-01 e PREMERGE-VAL-01: passaram

Backend typecheck:test, lint e build terminaram com exit 0. Typecheck incluiu arquivo SQL para tipagem sem executar o teste. Lint nao reportou no-control-regex nem no-require-imports; build passou. Nenhum acesso PostgreSQL ocorreu.

#### Regressao completa e status

App e QA independente nao foram executados pela falha focada VAL-10. As demais suites focadas planejadas (roleRoutingIntegration, polling, discovery, dashboard, operations service, navegacao, background, demo state e participation service) tambem nao foram repetidas; seus resultados anteriores permanecem historicos e nao validam esta rodada. Unitarios backend bloqueados antes dos casos. Nenhum PostgreSQL/Neon, test:integration, migration, seed ou operacao Git de publicacao ocorreu. Homologacao Expo e aprovacao formal de STAFF-03/04 continuam pendentes.

### STAFF04-VAL-10 — implementação e revisão estática de 27/11/2026

**Estado atual:** correção implementada localmente, ainda não validada. A campanha anterior confirmou VAL-09, Entrada 36/36 e tela Entrada 17/17; VAL-10 falhou 0/1 e Estação 11/12. Esses resultados são anteriores a esta alteração. Typecheck/lint/build backend passaram na campanha anterior; unitários continuam bloqueados por ENV-VAL-01.

**Causa e alteração:** o efeito de nova visita já invalidava refs de operação, mas preservava `view.busy`/`busyKind`; `refresh()` espalhava esse estado anterior. O efeito agora inicia `scope: null`, `status: loading`, dados/pending/feedback nulos, busy falso e busyKind nulo, e fecha o modal. Em seguida, a leitura existente obtém o estado oficial e `coordinator.pending()`. O reset é apenas da representação em memória: não remove, reconhece, cancela nem substitui intenções persistidas. O refresh no mesmo contexto mantém busy/busyKind; seus controles e gates não foram alterados.

**Revisão de callbacks:** dispatch já exige visita, sequência da operação, escopo, montagem e autorização antes de publicar resultado; seu finally só limpa dispatching da visita original e activeOpId correspondente. onStage/onAuthError e o reconhecimento automático continuam protegidos por visita/escopo. Foram documentadas antes da alteração e corrigidas duas lacunas relacionadas: catch do refresh passou a rejeitar visita antiga antes de tratar 401/403; retorno de descarte reservado passou a exigir montagem, mesma visita, escopo e ausência de revogação antes de limpar busy ou atualizar. Os pedidos de persistência já iniciados continuam pertencendo ao registro original. Uma negativa atual ainda bloqueia imediatamente; uma negativa atrasada de visita anterior não se torna atual por retorno à mesma estação. Guards generation, pollSeq, opSeqRef e revogação não foram removidas.

**Cobertura preparada, não executada:** o teste original conserva a asserção falha e usa identificador STAFF04-VAL-10; foram preparados dez casos VAL-10 no total:

- A/B/C: dois casos de troca ST_1 → ST_2 durante POST controlado, confirmando dispatching, fila B, ausência de busy herdado e bloqueio sem POST extra. Recusa definitiva 409 fica no recibo terminal da intenção original; timeout mantém dispatching. Refresh e nova tentativa continuam bloqueados; nenhum feedback tardio é exibido em B.
- D: troca de conta e troca de sessão, com UUIDs válidos distintos; verificam limpeza visual, histórico da conta original, bloqueio por sessão, recibo confirmado e ausência de feedback cruzado.
- E: a mutação de A termina no coordenador, mas o dispatch da tela ainda aguarda seu refresh. A conta B então pode legitimamente iniciar seu POST. Liberar o refresh antigo não pode limpar busy/estágio, alterar intenção nem publicar feedback em B. Não se cria concorrência artificial enquanto o coordenador ainda tem a mutação A em voo.
- F: o botão Atualizar permanece desabilitado durante POST; um callback de refresh capturado antes da mutação, representando uma atualização já enfileirada, preserva busy e o bloqueio no mesmo contexto.
- G: quatro casos 401/403 cobrem retorno à mesma estação com POST antigo e com refresh antigo, e preservam a prioridade de uma negativa atual. AUD-08/09/10 existentes foram mantidos.

Gates independentes usam sinais explícitos com timeout diagnóstico; cleanup libera as promises, aguarda operações e preserva o erro primário. Não houve execução de testes, lint, typecheck ou build nesta implementação. A revisão sintática CJS e o parse JSX são inspeções estáticas, não aprovação funcional.

#### ENV-VAL-01 — procedimento preparado para a próxima campanha

O pacote instalado é tsx 4.23.15. `dist/temporary-directory-Du7LpLp9.mjs` calcula o diretório temporário no carregamento: usa geteuid quando disponível e `os.userInfo().username` no Windows. A CLI importa esse módulo e configura IPC/preflight; a exceção ocorre na avaliação do módulo, antes de comprovar criação de canal IPC. `dist/loader.mjs` e `dist/esm/index.mjs` também importam o mesmo módulo: usar `node --import tsx` não evita comprovadamente a causa.

O comando oficial usa a descoberta explícita `test/unit/*.test.ts` e a configuração padrão `backend/tsconfig.json`; não usa tsconfig.test.json (este é do typecheck e do script de integração). O tsconfig padrão declara commonjs, experimentalDecorators e emitDecoratorMetadata. CLI/loader usam transformações esbuild; a presença de emitDecoratorMetadata no tsconfig não comprova emissão desses metadados pelo esbuild. Vários testes HTTP carregam reflect-metadata e `queue-entry-di.test.ts` valida a DI real Nest sem init/listen nem conexão ao banco. A equivalência de loader quanto a preflight, resolução, decorators e DI não foi comprovada nesta etapa; o loader não está recomendado como substituição autorizada do runner oficial. Não usar TypeScript nativo nem descoberta genérica de testes.

Com Luna Medium, comparar primeiro dentro do Codex e em PowerShell normal, ambos em `C:\DoJob\ProgramacaoMobile\backend`, usando o mesmo executável Node e `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
(Get-Command node).Source
node --version
node -e "const os=require('node:os'); for(const [name,fn] of [['userInfo',()=>os.userInfo()],['tmpdir',()=>os.tmpdir()]]) { try { fn(); console.log(name+': ok'); } catch(e) { console.log(name+': '+e.code+' / '+(e.info?.syscall??'')); } }"
'TEMP','TMP','USERPROFILE','NODE_OPTIONS' | ForEach-Object { '{0}: {1}' -f $_,[bool][Environment]::GetEnvironmentVariable($_) }
node_modules/.bin/tsx.cmd --version
```

Registrar apenas sucesso/códigos e presença de variáveis. Se necessário, repetir a prova de escrita num arquivo exclusivo sob TEMP com try/finally e remover somente esse arquivo. Não imprimir os dados de userInfo nem variáveis completas. Comparar permissões e recursos do processo sem desabilitar sandbox, falsificar usuário, alterar dependências ou configurações permanentes. Se o runner oficial funcionar no PowerShell normal, priorizar ali `npm.cmd test` após conferir novamente o script e inventário unitário; registrar a saída integral e contagens. Se não funcionar, preservar o erro e investigar o contexto de identidade Windows/Node antes de nova campanha. Não concluir falta de RAM a partir do código ENOMEM.

**Próxima validação do App (Luna Medium):** em app/, primeiro `node --test --test-reporter=spec --test-timeout=30000 --test-name-pattern='STAFF04-VAL-10' tests/staffStationOperational.test.cjs`, com limite externo e saída integral; depois suíte completa da Estação e as duas suítes de Entrada. Só ampliar para as outras focadas e regressões completas após resolver os bloqueios. Nenhum PostgreSQL, integração real, migration, seed, homologação ou publicação Git foi executado nesta rodada. Expo e aprovação formal continuam pendentes.


#### ENV-VAL-01 — inventário estático do comando oficial

Arquivos diretos correspondentes a test/unit/*.test.ts (77), sem executar ou importar os testes:

```text
test/unit/absent.test.ts
test/unit/access-code.test.ts
test/unit/admin-close.test.ts
test/unit/admin-close-http.test.ts
test/unit/admin-configuration.test.ts
test/unit/admin-configuration-http.test.ts
test/unit/admin-external-queue.test.ts
test/unit/admin-external-queue-http.test.ts
test/unit/admin-role-management.test.ts
test/unit/admin-role-management-db-guard.test.ts
test/unit/admin-role-management-http.test.ts
test/unit/admin-role-management-service.test.ts
test/unit/admin-schedule.test.ts
test/unit/admin-schedule-http.test.ts
test/unit/admin-two-factor.unit.test.ts
test/unit/auth.unit.test.ts
test/unit/auth-stable-session-http.test.ts
test/unit/call-next.test.ts
test/unit/complete.test.ts
test/unit/email-verification.test.ts
test/unit/email-verification-http.test.ts
test/unit/email-verification-mailer.test.ts
test/unit/evaluation-read.test.ts
test/unit/evaluation-read-http.test.ts
test/unit/evaluation-write.test.ts
test/unit/evaluation-write-http.test.ts
test/unit/event-availability.test.ts
test/unit/event-closure.test.ts
test/unit/event-closure-scheduler.test.ts
test/unit/event-entry-window.test.ts
test/unit/event-operational-capacity.test.ts
test/unit/experience-queue-control.test.ts
test/unit/experience-queue-control-http.test.ts
test/unit/experiences.test.ts
test/unit/experiences-http.test.ts
test/unit/external-queue.test.ts
test/unit/first-admin-bootstrap.test.ts
test/unit/first-admin-bootstrap-db-guard.test.ts
test/unit/join-eligibility.test.ts
test/unit/join-idempotency.test.ts
test/unit/k03-cleanup.unit.test.ts
test/unit/mutation-session-http.test.ts
test/unit/participant-admission-db-guard.test.ts
test/unit/participant-admission-http.test.ts
test/unit/participant-admission-precision.test.ts
test/unit/participant-queue-http.test.ts
test/unit/participation-lifecycle.test.ts
test/unit/participation-lifecycle-http.test.ts
test/unit/participations-read-db-guard.unit.test.ts
test/unit/profile-games.unit.test.ts
test/unit/profile-statistics.unit.test.ts
test/unit/queue-entry.test.ts
test/unit/queue-entry-di.test.ts
test/unit/queue-state.test.ts
test/unit/queue-withdrawal.test.ts
test/unit/schema.test.ts
test/unit/staff-a4-homolog-fixture.test.ts
test/unit/staff-called-removal.test.ts
test/unit/staff-called-removal-http.test.ts
test/unit/staff-entry.test.ts
test/unit/staff-entry-call.test.ts
test/unit/staff-entry-http.test.ts
test/unit/staff-history.test.ts
test/unit/staff-history-http.test.ts
test/unit/staff-homolog-fixture.test.ts
test/unit/staff-http.test.ts
test/unit/staff-idempotency-schema-preparation.test.ts
test/unit/staff-queries.test.ts
test/unit/staff-queries-http.test.ts
test/unit/staff-station-operational.test.ts
test/unit/staff-station-operational-http.test.ts
test/unit/station-availability.test.ts
test/unit/station-availability-http.test.ts
test/unit/test-db-guard.unit.test.ts
test/unit/totp-activation-crypto.test.ts
test/unit/totp-activation-http.test.ts
test/unit/totp-activation-service.test.ts
```

#### Integridade estática desta implementação

node --check do teste CJS e parse JSX com @babel/parser instalado passaram, sem executar os módulos ou os cenários. git diff --check -- app backend docs retornou 0. git apply --stat e git apply --check --reverse da evidência STAFF-04 retornaram 0; reverse check das evidências complementares STAFF-03-typecheck-fix e PREMERGE-VAL-01 também retornou 0. O diff global retorna 2 por whitespace nas linhas de contexto do arquivo de patch acumulado; isso é distinto de erro de whitespace em fontes/documentação, que não foi detectado. Preservado o formato de patch emitido pelo Git, sem retirar linhas necessárias à aplicação. Avisos LF/CRLF permanecem registrados.

O patch STAFF-04 contém apenas app/ e os dois documentos das tasks, excluindo backend e o próprio patch. STAFF-03-changes.diff permanece com SHA-256 9CB0BEE61A0CC5037A4F793E7E3FEECC13EE58EE2C72C2F9E5EB74E6B598B183; as duas evidências complementares não foram regeneradas. Branch/HEAD mantidos, índice sem staging. Arquivos desta rodada: StaffStationOperationalScreen.js, staffStationOperational.test.cjs, os dois documentos STAFF-03/04 e STAFF-04-changes.diff. Demais alterações acumuladas preservadas. Não houve nova validação funcional nem declaração de aprovação.
### PREMERGE-VAL-02 — isolamento de TTL em evaluation-write-http

Resultados manuais informados pelo responsável: PowerShell convencional, Node 24.15.0 e tsx 4.23.15; os.userInfo e tsx --version funcionaram. npm test teve 1.287/1.290 aprovados e três falhos: dois expiresAt em evaluation-write-http.test.ts e um em experiences-http.test.ts. A suíte de avaliação isolada teve 23/25 com TTL externo não igual a 60; definindo TTL=60 apenas no processo, passou 25/25. A suíte de experiências passou isolada 10/10; a causa de sua falha na regressão permanece indeterminada. Esses resultados são execução manual do responsável.

A fixture HTTP agora guarda EVALUATION_IDEMPOTENCY_TTL_SECONDS antes do Nest before, força 60 para cumprir as duas asserções fixas de expiração e restaura o valor anterior no encerramento, inclusive quando inicialização ou fechamento falham. Se a variável estava ausente, é removida. O teste que altera valores inválidos continua restaurando seu próprio valor interno em finally. Asserções, policy real, rotas, identidade e DI foram preservados. Nenhum teste foi executado nesta implementação; revalidação manual pendente.

Campanha App/QA: VAL-10 passou 10/10; Estação 21/21; Entry 36/36; EntryScreen 17/17; OperationsService 69/69. roleRoutingIntegration não forneceu resumo recuperável na execução paralela e permanece pendente; demais suítes e regressões completas não foram executadas. Não inferir aprovação do conjunto.

Para o responsável revalidar backend em PowerShell convencional, na pasta backend, preservando a configuração original do processo para o primeiro caso:

```powershell
npm.cmd test -- --test-name-pattern="E08.11 HTTP submit|E08.11 HTTP edit|TTL de avaliação|DI Nest resolve"
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '120'
npx.cmd tsx --test test/unit/evaluation-write-http.test.ts
Remove-Item Env:EVALUATION_IDEMPOTENCY_TTL_SECONDS
```

Para testar a variável ausente, remover somente no processo e executar a mesma suíte; atenção: o teste inválido restaura o estado que observou ao iniciar. Depois executar `npm.cmd run typecheck:test`, `npm.cmd run lint` e `npm.cmd test`. Antes, confirmar scripts e presença/ausência do TTL sem exibir segredos. A regressão completa já inclui experiências; se reaparecer a falha, guardar stdout/stderr, exit e stack antes de qualquer hipótese. Nenhum teste de integração PostgreSQL, migration ou seed é autorizado por estas instruções.

### Consolidação final da campanha local — resultados informados em 27/11/2026

**Backend — execução manual do responsável em PowerShell convencional, Node v24.15.0, tsx v4.23.15, NODE_ENV=test.** O Codex não executou estes comandos. PREMERGE-VAL-02: evaluation-write-http passou 25/25 com TTL externo original (3.565,8582 ms, exit 0) e 25/25 com TTL temporário 120 (3.253,6247 ms, exit 0); nenhuma falha, skip ou cancelamento, e a variável foi restaurada. TTL ausente após dotenv não foi testado. `typecheck:test`, lint e build passaram (build aprovado em campanha anterior, sem alterações posteriores de produção backend). `npm test`: 1.299/1.299, 0 falhas/ignorados/cancelados/todo, 25.715,3853 ms, exit 0. experiences-http passou seus dez casos isolada e integralmente; sete testes STAFF-03/AUD-02/AUD-07 passaram. A falha anterior em nível de arquivo não foi reproduzida; causa indeterminada.

**App — quatro primeiras suítes executadas pelo Codex; demais resultados fornecidos pelo responsável.** VAL-10 isolada 10/10; Station 21/21; Entry 36/36; EntryScreen 17/17; OperationsService 69/69. O responsável informou roleRoutingIntegration 64/64 (47.270,4485 ms), staffPolling 6/6 (560,9309 ms), staffEventDiscovery 14/14 (3.186,9821 ms), staffDashboard 25/25 (669,4606 ms), staffRealNavigation 2/2 (1.377,0723 ms), staffBackground 1/1 (93,7623 ms), staffDemoState 22/22 (513,1905 ms) e participationService 13/13 (544,6068 ms). As 12 suítes somam 290/290 sem falhas, skips ou cancelamentos; a VAL-10 isolada não é contada de novo.

O responsável informou regressão completa App via `npm test`: 995/995, sem falhas/ignorados/cancelados/todo, 69.242,5012 ms, exit 0. Informou QA independente `node run.cjs`: 51 PASS, exit 0; distribuição A 19, B 2, C 13, D 4, E 3, F 10. Não foi fornecida duração ou contagem adicional. Artefatos locais `qa/regression/artifacts/results.tap`, `results.jsonl` e `runner-stderr.txt` existem; os dois relatórios de resultados concordam em 51 casos aprovados e stderr tem zero bytes. Portanto, total das três regressões informadas: 2.345/2.345, sem duplicar os focados.

**ENV-VAL-01:** o responsável confirmou que o runner oficial funcionou no PowerShell convencional; o erro ENOMEM do ambiente Codex não se reproduziu lá. A causa específica dentro do Codex permanece indeterminada. Resultados backend/App acima são atribuições do responsável, não execuções do Codex nesta consolidação. Avisos de `react-test-renderer`, updates fora de `act()` e normalização LF/CRLF são observações, não falhas funcionais.

**Status:** campanha automatizada local aprovada conforme resultados disponíveis. Isso não declara homologação Expo nem aprovação formal de STAFF-03/04. Integração PostgreSQL, homologação visual/funcional e aprovação do responsável permanecem pendentes.

### Estado individual dos achados STAFF-04 após a campanha — 27/11/2026

Os históricos anteriores permanecem preservados. A regressão final do App (995/995) e o total das suítes focadas (290/290) não apresentaram falhas; a campanha não fornece um exit isolado para cada identificador abaixo. Resultados isolados explicitamente disponíveis permanecem registrados nas seções VAL correspondentes.

| Registro | Estado final da validação automatizada local |
|---|---|
| STAFF04-AUD-01 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-02 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-03 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-04 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-05 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-06 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-07 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-08 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-09 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-AUD-10 | Sem falha na regressão App final; status isolado permanece conforme histórico. |
| STAFF04-VAL-01 | Teste isolado aprovado (1/1), conforme histórico; regressão App final sem falhas. |
| STAFF04-VAL-02 | Teste isolado e integração completa aprovados (64/64), conforme histórico; regressão App final sem falhas. |
| STAFF04-VAL-03 | Cenário isolado, `staffEventDiscovery` (14/14) e `staffDashboard` (25/25) aprovados. |
| STAFF04-VAL-04 | Cenário isolado e `staffOperationsService.integration` (69/69) aprovados. |
| STAFF04-VAL-05 | Cenário isolado e `staffEntryControl` (36/36) aprovados. |
| STAFF04-VAL-06 | Sem falha nas suítes finais; resultado isolado conforme histórico. |
| STAFF04-VAL-07 | Sem falha nas suítes finais; resultado isolado conforme histórico. |
| STAFF04-VAL-08 | Sem falha nas suítes finais; resultado isolado conforme histórico. |
| STAFF04-VAL-09 | `staffEntryControl` 36/36 e `staffEntryControlScreen` 17/17 aprovados, conforme histórico. |
| STAFF04-VAL-10 | Teste isolado 10/10 e `staffStationOperational` 21/21 aprovados, conforme histórico. |

Esses status registram validação automatizada, sem declarar homologação Expo ou aprovação formal.

### Preflight PostgreSQL STAFF-03 — 27/11/2026

O preflight local foi **bloqueado antes de qualquer conexão**: as três URLs não existem no ambiente do processo; em `backend/.env` só foram encontradas `DATABASE_URL` e `DATABASE_DIRECT_URL`, com destinos não permitidos e diferentes entre si; `EVENTS_TEST_DATABASE_URL` está ausente. O serviço PostgreSQL do Windows está iniciado, mas não há listener em `127.0.0.1:55432`; o Docker daemon também não estava acessível. Nenhuma URL completa/credencial foi registrada, nenhuma consulta a PostgreSQL ou Neon ocorreu e nenhum serviço/container foi iniciado. A presença, identidade e permissões do schema não foram confirmadas.

A inspeção estática confirma o guard de destino e autorização, a migration 0008 com constraints/índices/triggers da chamada externa, e a fixture com UUIDs aleatórios, mesma conexão para Drizzle e SQL, `BEGIN`/savepoints/rollback, sem `COMMIT`, verificação por conexão observadora e encerramento das conexões. Isso não substitui a confirmação do schema instalado. O roteiro de execução individual permanece preparado no documento STAFF-03; o teste funcional transacional segue sem autorização e não foi executado.

### Recuperação do PostgreSQL e migration — atualização de 27/11/2026

O responsável informou que recriou apenas o banco dedicado em PostgreSQL local (a instância consultada não continha esse banco; a causa da ausência não foi determinada) e confirmou sua identidade por uma consulta read-only. A tentativa posterior de preflight de migration havia parado em `CHECK_FAILED`; nenhuma migration foi executada. A possível divergência entre `inet_server_addr()::text` e `127.0.0.1` não foi comprovada. A configuração oficial usa `DATABASE_DIRECT_URL` antes de `DATABASE_URL`, importa dotenv e contém exatamente as oito migrations do journal local. O procedimento no documento STAFF-03 foi ajustado: cria arquivo dotenv temporário vazio e único, restaura-o/ambiente em `finally`, não define nem exige `STAFF03_POSTGRES_PROJECTION_TEST` (essa autorização é exclusiva da fixture futura), preserva a confirmação humana de migration e captura stdout/stderr com `2>&1` em PowerShell 5.1 e 7 sob preferências isoladas, sanitizando antes da exibição e lendo o exit code antes de processar a saída. O dotenv instalado é 16.6.1; nele a string `DOTENV_CONFIG_OVERRIDE=false` é truthy, e o arquivo vazio impede qualquer override de valores. O Codex não executou conexão, migrations, testes ou qualquer operação de banco; a aplicação das migrations e a integração PostgreSQL continuam pendentes.
