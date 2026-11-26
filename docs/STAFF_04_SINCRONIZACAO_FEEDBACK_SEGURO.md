# ArenaGo — STAFF-04 | Sincronização e Feedback Seguro

## 1. Objetivos e Escopo

- **Projeto:** ArenaGo — ProgramacaoMobile (`JaviDansen/ArenaGo`)
- **Task:** STAFF-04 — Sincronização e Feedback Seguro
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base de referência (`HEAD` inicial verificado):** `6c77c3b515ef4ed47607250081055868cc803a30` (`Correções da Auditoria Independente — Rodada 2` da STAFF-03)
- **Status do ciclo:** Implementação e preparação de testes concluídas para auditoria independente e posterior execução da campanha automatizada conjunta. **STAFF-03 e STAFF-04 ainda não foram submetidas à campanha automatizada conjunta nem homologadas no Expo Go**; portanto, nenhuma das duas tasks está testada, aprovada ou homologada.

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
   - [useStaffPolling.js](../app/screens/staff/useStaffPolling.js): hook único por ciclo concluído (agenda o próximo timer somente no `finally` após o término da leitura anterior, impedindo sobreposição). Respeita `useIsFocused()`, `AppState === 'active'`, `enabled`, `intervalMs` e `scope`; reinicia ao retornar ao foco ou primeiro plano sem duplicar timers quando há leitura em voo.
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
   - `StaffEventsScreen`: observa `useIsFocused()` e `AppState`, habilita polling de 60s também em erro inicial recuperável (`network`/`unavailable`), exibe mensagem específica para `denied` (`403`) e apresenta `<StaffPollingStatusPill indicator={eventsPollingIndicator} />`.
   - `StaffEventDashboard`: observa `useIsFocused()` e `AppState`, habilita recuperação automática em `pollQueue` para erro inicial transitório, inclui `experienceError === 'stale'` e `staff.error === 'stale'` no alerta de desatualização do painel e apresenta `<StaffPollingStatusPill indicator={panelPollingIndicator} />` refletindo o estado real da sincronização de 5s.
6. **[app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js):**
   - Classificação uniforme de `error?.isTimeout` como `'network'` em `refresh()` e `handleStationNotFound()`.
   - Flag explícita `autoRecoverable` diferenciando erro inicial transitório de leitura (`autoRecoverable: true`, habilitando recuperação por GET a cada 5s com releitura obrigatória de `coordinator.pending(scope)` antes de liberar `ready`) de erro de acesso incerto após `404` / falha de `SecureStore` (`autoRecoverable: false`, preservando integralmente STAFF02-AUD-01 Caso C).
   - Adoção de `describeStationFeedback`, `resolveStaffPollingIndicator` e `<StaffPollingStatusPill />`, mantendo a pausa de polling durante modais (STAFF-02).
   - Adição do banner explícito de processamento (`view.busy`) diferenciando `"Processando operação no servidor..."` de `"Finalizando reconhecimento seguro..."`.
7. **[app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js):**
   - Habilitação de `pollingEnabled` também para erro inicial recuperável (`network`/`unavailable`), mantendo polling de 5s ativo durante modais com invalidação `evaluateEntryDialog` (STAFF-03).
   - Adoção de `describeEntryNotice`, `resolveStaffPollingIndicator` e `<StaffPollingStatusPill />` (incluindo diferenciação de `absent` com `requeued: true` vs `false` e todos os códigos reais de recusa do backend).
   - Adição do banner explícito de processamento (`snapshot.busy`) diferenciando `"Processando operação no servidor..."` de `"Finalizando reconhecimento seguro..."`, além de aviso dedicado para `knownOutcome.kind === 'rejected'` quando a gravação local do recibo falha.

---

## 7. Fluxos de Sincronização (Matriz Comparativa Antes × Depois)

| Superfície / Aspecto | Antes da STAFF-04 (`6c77c3b`) | Depois da STAFF-04 |
|---|---|---|
| **Seleção de eventos (60s)** | Falha no primeiro GET interrompia polling permanentemente; `403` não separado de `unavailable`; sem indicador visual de sincronização. | Recuperação automática por GET a cada 60s em `network`/`timeout`/`503`/inválida; `403` separado como `denied` (oculta indicador e para polling); indicador honesto ligado a foco e `AppState`. |
| **Painel Operacional (5s + 60s fase)** | Sem indicador visual de polling; `timeout` classificado como `unavailable`; `experienceError`/`staff.error === 'stale'` não apareciam no aviso de desatualização do painel. | Indicador honesto de 5s (`StaffPollingStatusPill`) refletindo ativo/pausado/desatualizado/recuperação/verificação/indisponível; `timeout` classificado como `network`; revalidação mantida em `revalidateOnReturn()`. |
| **Estação — Fila e Atendimento (5s)** | Falha inicial em `/operational-state` ou `/queue` interrompia polling até ação manual; sem estado visual `busy`; `call`/`complete`/`remove_called` com texto genérico; recusas sem mapeamento de códigos backend; `uncertain`/`cleanup_pending`/`storage_error` com texto único. | Recuperação automática por GET a cada 5s em falhas transitórias iniciais (reconsultando `SecureStore` antes de liberar `ready`), preservando Caso C (`404`→`500`) sem polling automático; banner explícito `busy`; confirmações específicas por ação; mapeamento de todos os códigos backend; mensagens distintas por tipo de pendência/falha; pausa durante modais preservada (STAFF-02). |
| **Controle de Entrada (5s)** | Falha inicial em `/entry-control` interrompia polling; sem estado visual `busy`; `absent` não distinguia `requeued: true` vs `false`; recusas mapeavam apenas `ENTRY_NOT_FIRST`; recusa com erro de gravação local sem mensagem própria. | Recuperação automática por GET a cada 5s em falhas transitórias iniciais (preservando intenções do `SecureStore` antes de liberar `ready`); banner explícito `busy`; `absent` distingue reinserção vs corte de entrada; todos os códigos reais de recusa mapeados; aviso dedicado para `knownOutcome.kind === 'rejected'`; polling ativo com invalidação de modais preservado (STAFF-03). |
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
| **5. Operação em andamento (`busy`)** | Exibe card `progressbar` (`Processando operação no servidor...` ou `Finalizando reconhecimento seguro...`), bloqueia acionamentos conflitantes/duplo toque e pausa o polling operacional durante a mutação. |
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
| `unavailableError` (ex.: `accessUncertain` após `404`→`500` ou erro de `SecureStore`) | `Atualização indisponível · aguardando recuperação` |
| Polling pausado (modal na estação, `busy`, perda de foco ou segundo plano) | `Atualização temporariamente pausada` |
| Polling ativo e tela visível | `Atualização automática ativa · a cada <5\|60>s` |

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
  - [app/services/staffEventsService.js](../app/services/staffEventsService.js)
  - [app/services/staffDashboardService.js](../app/services/staffDashboardService.js)
  - [app/services/staffEntryService.js](../app/services/staffEntryService.js)
  - [app/screens/staff/StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js)
  - [app/screens/staff/StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js)
  - [app/screens/staff/StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js)
- **Testes automatizados preparados/atualizados (App):**
  - [app/tests/staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs)
  - [app/tests/staffPolling.test.cjs](../app/tests/staffPolling.test.cjs)
  - [app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs)
  - [app/tests/staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs)
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
2. **[app/tests/staffPolling.test.cjs](../app/tests/staffPolling.test.cjs):** cobertura adicional do intervalo de 60s, alternância de `enabled` (pausa/retomada sem duplicar timers) e continuidade de ciclo único mesmo após rejeição de `read()`.
3. **[app/tests/staffEventDiscovery.test.cjs](../app/tests/staffEventDiscovery.test.cjs):**
   - `staffEventsService`: classificação de `403` (`denied`), `timeout` (`network`), `503` e payload inválido (`unavailable`), recuperação automática via `refreshSilent()` após falha inicial e bloqueio de novas tentativas em `401`/`403`.
   - UI (`StaffEventsScreen` e `StaffEventDashboard`): atualização do harness para `StaffSyncFeedback` + controle de foco/`AppState`; validação dos indicadores de 60s e 5s, recuperação automática inicial, pausa em foco/segundo plano, estado `stale` e ocultação do indicador em `403`.
4. **[app/tests/staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs):** classificação de `timeout` como `network` e recuperação automática em `pollQueue()` após `timeout`/`503`/malformada sem fabricar fila vazia, interrompendo em `403`.
5. **[app/tests/staffEntryControl.test.cjs](../app/tests/staffEntryControl.test.cjs):** recuperação automática em `poll()` após `timeout`/`503`/malformada recarregando intenção `dispatching` do `SecureStore` antes de publicar `ready` (0 mutações enviadas), interrupção em `403` preservando `SecureStore` e preservação de `knownOutcome.kind === 'rejected'` quando falha a persistência local do recibo.
6. **[app/tests/staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs):**
   - Suíte unitária pura de `StaffSyncFeedback.js` cobrindo todos os estados de `resolveStaffPollingIndicator`, todas as operações confirmadas, todos os códigos reais de recusa (Entrada e Estação), fallback seguro sem vazamento de códigos internos e `describeStationFeedback`.
   - Suíte de tela `StaffEntryControlRealScreen`: recuperação automática inicial por GET preservando `dispatching` no `SecureStore`, descarte seguro de `reserved`, estado visual `busy`, diferenciação de `absent` (`requeued: true` vs `false`), códigos de recusa reais e fallback seguro.
7. **[app/tests/staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs):** recuperação automática após erro inicial (`timeout`/`503`/malformada) preservando intenção `dispatching` no `SecureStore`, contraste com Caso C (`404`→`500`, sem polling automático), estado visual `busy` com proteção contra duplo toque, confirmações específicas (`call`, `complete`, `remove_called`), códigos reais de recusa e fallback seguro.
8. **[app/tests/roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs):**
   - Adição de `screens/staff/components/StaffSyncFeedback` na allowlist `control.realStaff`.
   - Teste integrado ponta a ponta com `manualTimers: true` cobrindo recuperação automática inicial em Eventos (60s), Entrada (5s) e Estação (5s), ausência após corte (`requeued: false`), coerência ao voltar ao Painel (`revalidateOnReturn`) e pausa por foco/segundo plano.
   - Teste integrado ponta a ponta cobrindo mutação incerta (`timeout`) sobrevivendo a múltiplos ciclos de polling, logout, nova sessão da mesma conta (`pending_other`) e troca de conta Staff sem replay automático nem vazamento nominal.

---

## 14. Verificações Realizadas

### 14.1. Verificações estáticas executadas pelo agente implementador (permitidas por [AGENTS.md](../AGENTS.md))

- Inspeção estática integral dos arquivos de produção e testes modificados/criados.
- Validação sintática via `node --check` em todos os arquivos `.cjs` alterados.
- Verificação de formatação e patches via `git diff --check -- app backend docs`.
- Validação de aplicabilidade do patch acumulado da STAFF-04 via `git apply --stat qa-evidence/STAFF-04-changes.diff` e `git apply --check --reverse qa-evidence/STAFF-04-changes.diff`.
- Conferência de integridade: ausência de auto-inclusão do patch (`SELF_PATCH_COUNT=0`), ausência de URIs locais na documentação (`DOC_FILE_URI_COUNT=0`), preservação intacta de [qa-evidence/STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) e conferência de `git status --short --branch`.

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
- Identidade exata das URLs exigidas (`DATABASE_URL`, `DIRECT_DATABASE_URL`, `TEST_DATABASE_URL`), host/porta dedicados (`127.0.0.1:55432`) e `current_database() = arenago_staff_homolog_20261111`.
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
- **26/11/2026 — Implementação e preparação de testes da STAFF-04 concluídas:** consolidados recuperação automática segura por GET em todas as superfícies Staff, classificação uniforme de `timeout` e `403`, componente compartilhado [StaffSyncFeedback.js](../app/screens/staff/components/StaffSyncFeedback.js), indicadores honestos nas 4 telas/seções (incluindo Seleção de Eventos e Painel Operacional), feedback específico por operação e por código real do backend, banners explícitos de processamento `busy`, preparação completa das suítes de teste, documentação consolidada das 17 seções (incluindo campanha conjunta STAFF-03 + STAFF-04 e roteiro de 18 cenários) e geração de [qa-evidence/STAFF-04-changes.diff](../qa-evidence/STAFF-04-changes.diff). Aguardando publicação por Kaled, auditoria independente e posterior execução da campanha conjunta por **GPT-6 Luna — Medium**.
