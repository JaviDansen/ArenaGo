# ArenaGo — STAFF-02 | Reformulação da Estação, Fila e Atendimento

## 1. Identificação da Task e Commit-Base

- **Projeto:** ArenaGo — ProgramacaoMobile
- **Task:** STAFF-02 — Reformulação da Estação, Fila e Atendimento
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base (`HEAD` de referência da STAFF-02):** `95b8b80f3c0142af30c25e9483291d75677a085d` (`style(staff): padroniza interface com Admin e conclui homologação da STAFF-01`)
- **Commit da entrega inicial publicada:** `5cde6a57874bad816213a0e3be8234dd6b51173b` (`Reformulação da Estação, Fila e Atendimento`)
- **Commit da Rodada 1 publicado:** `d6765f1dec3b14f40be4d955e4791c88f1c56735` (`Correções da Auditoria Independente — Rodada 1`)
- **Status atual:** Ajuste contratual das fixtures de integração concluído sobre `d6765f1` (sem alterações em código de produção); aguardando execução da campanha automatizada por **GPT-6 Luna — Medium** e homologação presencial no Expo Go.

### Seleção de modelos e níveis de raciocínio (conforme [AGENTS.md](../AGENTS.md))

- **Correções da Auditoria Rodada 1 (`STAFF02-AUD-01` a `STAFF02-AUD-08`):** Concluídas neste ciclo sem alteração de contratos backend, migrations ou módulos Admin/Participante.
- **Execução da campanha de validações automatizadas:** Recomendado **GPT-6 Luna — Medium** (executor padrão designado pelo [AGENTS.md](../AGENTS.md)); nenhuma suíte automatizada (`node --test` / `npm test`) foi executada durante a etapa de implementação.

---

## 2. Diagnóstico do Código Anterior (Base `95b8b80`)

Antes de qualquer alteração visual ou funcional na entrega inicial (`5cde6a5`), o estado na base `95b8b80` foi inspecionado:

1. **Navegação e duplicidade em `app/screens/staff/StaffEventsNavigator.js` (`section === 'station'`):**
   - `StaffEventHomeScreen` já utilizava `StaffLiveScreen` com o padrão aprovado da STAFF-01 ([STAFF_01_PADRONIZACAO_VISUAL.md](./STAFF_01_PADRONIZACAO_VISUAL.md): `Voltar ao painel` à esquerda + logo `logo-arenago-staff.png` à direita, fundo `#090412`, órbitas decorativas, `SafeAreaView` e `ScrollView`), além de `beforeRemove` e `store.revalidateOnReturn()`.
   - Contudo, dentro de `section === 'station'`, `StaffEventDashboard` renderizava um cabeçalho e card de fila duplicados (`station.label`, `Experiência: ...`, `Disponibilidade: ...`, `Atendimento pendente: ...`, `Fila compartilhada da experiência`, `Fila de <experiência>`, `Pessoas em espera`, `Janela operacional` e um botão adicional `Atualizar fila`), logo acima de `StaffStationOperationalScreen`, que renderizava novamente título, estação, contagem e um segundo botão `Atualizar atendimento`.
   - Além disso, o callback `onChanged` disparava `store.refreshStations()` diretamente, o que podia transitar `stationStatus` para `'loading'` temporariamente em redes com latência real e desmontar `StaffStationOperationalScreen` logo após a confirmação da operação, perdendo o banner de feedback.
2. **Tela operacional `app/screens/staff/StaffStationOperationalScreen.js`:**
   - Já possuía toda a arquitetura segura de leitura (`operational-state`), polling de 5s (`useStaffPolling`), coordenador (`createStaffOperationsCoordinator`), persistência em `SecureStore` (`defaultStaffIntentStorage`), `Idempotency-Key`, reserva/despacho/recibo terminal, reconciliação automática de `terminal_pending`, cancelamento de `reserved`, proteção contra duplo toque e modal de confirmação para `complete`, `absent` e `remove_called`.
   - Visualmente, não seguia os tokens aprovados da STAFF-01 nem os mockups 03 e 04, usava rótulos antigos, não apresentava indicador de tempo desde a chamada (`pending.calledAt`), não exibia a faixa não clicável `Fila compartilhada entre as estações` e não propagava `403`/`401` diretamente ao bloqueio de acesso do painel.
3. **Serviços e contratos (`staffOperationsService.js`, `staffDashboardService.js`, `staffIntentStorage.js`, `useStaffPolling.js`):**
   - Já suportavam todos os campos e operações exigidos pela STAFF-02 sem qualquer alteração no backend ou em migrations.

---

## 3. Referências Visuais (Mockups 03 e 04)

- **Tela 03 (`ArenaGO_Staff_03_Estacao_Fila.png`) — Estado A (`pending === null`):**
  - Identificação superior com `station.label`, badge semântico de disponibilidade (`DISPONÍVEL` / `INDISPONÍVEL`), nome da experiência (`experience.name`) com ícone de controle e nome do evento (`event.name`).
  - Seção `FILA DA EXPERIÊNCIA` com contagem oficial `N aguardando`, lista FIFO em card estruturado (badge numérico de posição, `displayName`, status `Aguardando`) ou estado vazio real (`Fila vazia` / `Nenhuma pessoa aguardando nesta experiência.`), finalizada pela faixa informativa não clicável `Fila compartilhada entre as estações`.
  - Botão primário destacado `Chamar próximo` habilitado apenas quando todas as condições oficiais forem satisfeitas.
  - Seção `ATENDIMENTO ATUAL` com card vazio `Nenhum participante chamado` e orientação curta para resolver o atendimento antes da próxima chamada.
  - Indicação de atualização automática e botão único secundário `Atualizar atendimento`.
- **Tela 04 (`ArenaGO_Staff_04_Atendimento.png`) — Estado B (`pending !== null`):**
  - Mesma identificação superior e seção `FILA DA EXPERIÊNCIA` exibindo somente a fila remanescente devolvida pelo servidor (sem duplicar o participante chamado nem decrementar por suposição).
  - Ausência do botão `Chamar próximo` enquanto houver chamada pendente.
  - Seção `ATENDIMENTO ATUAL` com avatar de participante, `pending.displayName`, `Em atendimento`, pílula segura de tempo decorrido (`Chamado há MM:SS` / `HH:MM:SS`, com fallback seguro `Chamada pendente`), prompt `Selecione a ação para este participante:` e três botões semânticos distintos:
    - `Concluir experiência` (verde/sucesso)
    - `Marcar ausência` (âmbar/alerta)
    - `Remover da fila` (vermelho/perigo)

---

## 4. Adaptações ao Padrão Visual da STAFF-01

Seguindo a regra de precedência visual da STAFF-02 e [STAFF_01_PADRONIZACAO_VISUAL.md](./STAFF_01_PADRONIZACAO_VISUAL.md):
- **Cabeçalho compartilhado (`StaffLiveScreen`):** `Voltar ao painel` à esquerda + logo oficial transparente [logo-arenago-staff.png](../app/assets/images/logo-arenago-staff.png) à direita, com `SafeAreaView`, `ScrollView` e fundo `#090412` com órbitas decorativas.
- **Cabeçalhos antigos dos mockups não replicados:** sem texto `ArenaGO` à esquerda, sem badge `STAFF` no topo e sem segundo botão `Voltar` inferior.
- **Tokens reutilizados de [AdminLiveUI.js](../app/screens/admin/components/AdminLiveUI.js) (`liveColors`) e [adminTheme.js](../app/screens/admin/components/adminTheme.js):**
  - Fundo `#090412`, superfície `#151020`, borda `#C476ED`, acento principal `#B960F5`, acento forte `#7C3AED`, texto secundário `#C7B9D9`, fundo de ícones `#38204F`.
  - Cores semânticas preservadas distintas do roxo decorativo: verde (`#10B981` / `#34D399`) para disponibilidade e conclusão, âmbar (`#F59E0B` / `#FCD34D`) para ausência/alertas/stale/intenções pendentes, e vermelho (`#EF4444` / `#FCA5A5`) para indisponibilidade, remoção e erros de acesso.

---

## 5. Mapeamento entre Dados do Backend e Elementos Visuais

| Elemento Visual | Origem Real no Contrato | Regra Aplicada |
|---|---|---|
| Título da estação | `station.label` | Dado real do evento selecionado; sem valores fixos |
| Badge de disponibilidade | `data?.availability ?? station.availability` | `available` -> `DISPONÍVEL`; `unavailable` -> `INDISPONÍVEL` (independente da fila) |
| Experiência | `experience.name` | Exibida com ícone vetorial nativo |
| Evento | `event.name` | Sem inventar local, data ou horário |
| Contagem da fila | `data.waitingCount` | Exibido como `${data.waitingCount} aguardando` |
| Linhas da fila | `data.waiting` (`queueEntryId`, `position`, `displayName`) | Ordem FIFO exata do servidor; sem ordenação local ou remoção individual de espera |
| Faixa compartilhada | Fixo informativo (`View` não clicável) | `Fila compartilhada entre as estações` |
| Botão `Chamar próximo` | `data.canCall && !data.pending && data.waitingCount > 0 && data.availability === 'available' && !blocked` | Exibido apenas no Estado A (`!data.pending`); fluxo direto protegido via `coordinator.callNext` |
| Participante em atendimento | `data.pending.displayName` e `data.pending.serviceSessionId` | Ações sempre vinculadas a `serviceSessionId`, nunca ao nome |
| Tempo desde a chamada | `data.pending.calledAt` | Calculado em `formatElapsedSinceCall`; `Chamado há MM:SS` (`HH:MM:SS` se >= 1h) ou fallback `Chamada pendente` para desvios `< -60s` ou `> 24h`; sem ausência automática |
| Ações de resolução | `coordinator.complete`, `coordinator.absent`, `coordinator.removeCalled` | Preservam modal de confirmação (`CONFIRMAR OPERAÇÃO` / `CANCELAR OPERAÇÃO`) |
| Feedback real de ausência | `view.feedback.result.requeued` | Diferencia reinserção no fim da fila vs encerramento após o corte temporal |

---

## 6. Componentes Criados e Alterados (Entrega Inicial `5cde6a5`)

- **Criado:** [StaffStationSections.js](../app/screens/staff/components/StaffStationSections.js)
  - Helper puro `formatElapsedSinceCall(calledAt, nowMs)` com proteção contra relógio dessincronizado e sem impacto no estado operacional.
  - Componentes apresentacionais `StationStatusBadge`, `StationHeaderCard`, `ExperienceQueueCard`, `ElapsedCallBadge`, `CurrentServiceCard` e `StationConfirmModal`, com ícones vetoriais nativos sem dependências externas.
- **Alterado:** [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js)
  - Reorganização visual nos padrões STAFF-01 e mockups 03/04, propagação segura de `403`/`401` via `onAccessDenied`, suporte reativo a `accessDenied` e integração de atualização via `onRefresh`.
- **Alterado (integração):** [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js)
  - Consolidação visual em `section === 'station'`, removendo duplicidades e preservando `beforeRemove`, `revalidateOnReturn`, `refreshQueue`, `pollQueue` e `clearQueue`.

---

## 7. Decisões de Navegação

- Preservado o fluxo `Eventos Staff → Painel Operacional → Estação` sem rota intermediária.
- Retorno ao Painel exclusivamente pelo cabeçalho (`Voltar ao painel`) ou retorno nativo (`beforeRemove`), limpando `stationId`, executando `store.clearQueue()` e acionando `store.revalidateOnReturn()` sem perder o evento selecionado nem disparar mutações.
- Home e Painel Operacional homologados na STAFF-01 preservados fora das proteções estritamente necessárias à autorização.

---

## 8. Preservação dos Contratos e da Idempotência

- **Contratos HTTP preservados (sem alterações no backend):**
  - `GET /api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state`
  - `POST /api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next`
  - `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/complete`
  - `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/absent`
  - `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/remove`
- **Garantias mantidas:** `Idempotency-Key`, reserva persistida antes do `POST`, estado `dispatching`, bloqueio em resultado incerto/timeout, reconciliação automática de `terminal_pending`, cancelamento explícito de `reserved`, proteção contra duplo toque e diálogos de confirmação para `complete`, `absent` e `remove_called`.

---

## 9. Correções da Auditoria Independente — Rodada 1

Auditoria estática realizada sobre o commit publicado `5cde6a57874bad816213a0e3be8234dd6b51173b` identificou os oito achados abaixo. Esta seção registra o plano e a execução das correções antes de qualquer alteração em código.

### 9.1. Quadro de achados e plano de correção

| ID | Prioridade | Classificação | Resumo do Diagnóstico | Plano de Correção e Verificação |
|---|---|---|---|---|
| `STAFF02-AUD-01` | P0 | Defeito em código de produção | `GET .../operational-state` pode retornar `404` por perda de acesso ao evento ou remoção local da estação/experiência; ao limpar apenas na Estação sem invalidar cache nominal do Painel (`entry`, `stations`, `experiences`), o retorno ao Painel podia expor nomes em cache durante revalidação. | Limpar imediatamente cache nominal no store do Painel ao receber `404` da Estação, entrar em verificação segura via `GET /staff/events/:eventId/stations` vinculada a conta/sessão/evento/estação/revisão/geração, manter Estação e modais fechados/bloqueados (preservando `SecureStore`), diferenciar Casos A (`200` restrito à estação sem publicar dados de verificação como atualização do Painel), B (`401`/`403`/`404` bloqueio de evento/sessão) e C (`500`/rede/timeout mantendo ocultação e bloqueio sem loops), e cobrir todos os 12 cenários de regressão. |
| `STAFF02-AUD-02` | P1 | Defeito em código de produção | `onChanged` em `StaffEventsNavigator.js` executa atualização de estações assíncrona e depois chama `pollQueue`/`refreshQueue(station.experienceId)` sem revalidar contexto após cada `await`, permitindo corrida `A → Painel → B` que sobrescreve a fila de `B`. | Vincular `onChanged` (e `onRefresh`) a escopo completo imutável capturado na origem (identidade, sessão, epoch, revisão, evento, seção `'station'`, `stationId`, `experienceId`, `accessLocked` e contador monotônico de visita à estação) e revalidar após cada `await` antes de tocar na fila. Cobrir `A → Painel`, `A → Painel → B` e troca de conta/evento. |
| `STAFF02-AUD-03` | P1 | Ajuste de teste (inventário) | Novo componente [StaffStationSections.js](../app/screens/staff/components/StaffStationSections.js) não estava listado em `realStaffScreens` de [staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs). | Registrar `'components/StaffStationSections.js'` explicitamente em `realStaffScreens`, preservando comparação exata e isolamento de `StaffDemo`. |
| `STAFF02-AUD-04` | P1 | Ajuste de teste (VM) | `formatElapsedSinceCall` retorna objeto criado em contexto VM distinto no harness, podendo falhar em `assert.deepEqual` estrito de protótipos entre realms em [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs). | Comparar campos primitivos `label` e `live` (ou normalizar para o contexto do teste) sem alterar a função de produção nem enfraquecer cenários. |
| `STAFF02-AUD-05` | P2 | Defeito em código de produção | Rodapé mostrava indicador verde `"Fila e atendimento atualizados automaticamente"` mesmo com modal aberto, operação em andamento, polling pausado por foco/`AppState`, leitura stale, erro transitório ou acesso negado. | Derivar indicador visual diretamente das condições que governam `useStaffPolling` e a operação (suprimindo indicação ativa em acesso negado, diferenciando ativa / pausada / desatualizada / indisponível) sem criar timers ou consultas extras, e validar correlação com GETs nos testes. |
| `STAFF02-AUD-06` | P2 | Reforço de testes | Faltavam cenários de `404` contextual na Estação, polling real com foco/`AppState` dentro da tela da Estação, asserções exatas de badges e linhas posicionais FIFO, e validação completa de rotas/headers/`SecureStore` em mutações. | Reforçar [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) e [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) com `hasExactText`, `hasQueueRow`, `useStaffPolling` real + foco/`AppState` na Estação, `404` contextual, rotas/idempotency/receipts e documentação das dependências de `qa/regression`. |
| `STAFF02-AUD-07` | P2 | Mitigação de risco visual | `StationConfirmModal` podia cortar conteúdo ou botões em telas baixas ou fontes ampliadas. | Envolver o diálogo em `SafeAreaView` + container limitado (`maxHeight: '100%'`) + `ScrollView` interno rolável mantendo aparência, `onRequestClose` e zero cliques acidentais, preservando diálogos e preparando conferência no Expo. |
| `STAFF02-AUD-08` | P3 | Correção documental | Links locais absolutos de estação de trabalho e registro desatualizado sobre `5cde6a5`. | Substituir links por caminhos relativos portáveis, registrar publicação de `5cde6a5` e documentar integralmente esta Rodada 1. |

### 9.2. Correções efetivamente implementadas (`STAFF02-AUD-01` a `STAFF02-AUD-08`)

1. **`STAFF02-AUD-01` (P0 — Revogação por `404` e proteção de cache nominal):**
   - [staffDashboardService.js](../app/services/staffDashboardService.js): incluídos os estados `verifyingAccess` e `accessUncertain`, o contador `stationVerifyGeneration` e o método `verifyStationAccess({ stationId, experienceId })`, que invalida leituras em voo (`stationGeneration`, `experienceGeneration`, `entryGeneration`, `queueGeneration`, `orphanCheckedSignatures`), zera imediatamente dados nominais em cache (`stations: []`, `experiences: []`, `entry: null`, `queue: null`), verifica o evento via `fetchStaffStations(client, originContext.eventId)` sem publicar sua lista em `state.stations` e trata os **Casos A (`200`)**, **B (`401`/`403`/`404`)** e **C (`500`/rede/timeout)**. Bloqueadores de exposição parcial mantidos em `beginRevalidation`, `finishRevalidationSuccess`, `finishRevalidationError` e `settleRevalidationRound` via `accessLocked || accessUncertain`, além de guardas em `refreshStations`, `pollStations`, `pollExperiences`, `syncOrphanExperiences`, `pollEntryControl`, `refreshQueue`, `pollQueue`, `revalidateOnReturn` e `refreshPanel`.
   - [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js): adicionada `handleStationNotFound(originScope, originGeneration)` e tratamento de `404` em `refresh` e `poll` — limpando `data` e `pending` imediatamente, fechando o modal (`dialogRef.current = null; setDialog(null)`), incrementando `generation.current` sincronamente (invalidando callbacks anteriores em `dispatch` com zero `POST`s extras) e preservando `SecureStore` intacto. Diferencia localmente `local_denied` (`'Acesso à estação indisponível.'`), `uncertain` (`'Não foi possível consultar a estação.'` / `'Falha de conexão. Atualize a estação.'`), `denied` e `session`.
   - [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js): `entryBlocked` bloqueia `Controle de Entrada` também sob `verifyingAccess` e `accessUncertain`, `describeEntrySummary` exibe `VERIFICANDO` / `INDISPONÍVEL` sem vazar `entry.pendingCall`, métricas exibem `'—'`, o painel exibe `'Verificando acesso ao evento...'` durante a verificação, `useStaffPolling` de painel/fila é desabilitado sob `verifyingAccess || accessUncertain`, `activeStationMetaRef` preserva a tela da estação montada durante a verificação, e o retorno ao painel após Caso A (`200`) aciona `refreshPanel()` automaticamente para recomposição limpa.
2. **`STAFF02-AUD-02` (P1 — Corrida pós-operação em `onChanged`):**
   - [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js): adicionados `stationVisitGenRef`, `openStation`, `captureStationScope` e `isSameStationScope`, revalidados antes e após cada `await` em `onChanged` e `onRefresh`, descartando atualizações tardias de `A → Painel` e `A → Painel → B` e trocas de evento/sessão/identidade.
3. **`STAFF02-AUD-03` (P1 — Inventário Staff):**
   - [staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs): `'components/StaffStationSections.js'` registrado em `realStaffScreens`, com asserção garantindo ausência de dependências demonstrativas.
4. **`STAFF02-AUD-04` (P1 — Comparação VM em `formatElapsedSinceCall`):**
   - [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs): normalização `plain(...)` aplicada sobre os objetos retornados por `formatElapsedSinceCall` para comparações entre contextos VM.
5. **`STAFF02-AUD-05` (P2 — Indicador de polling fidedigno):**
   - [StaffStationOperationalScreen.js](../app/screens/staff/StaffStationOperationalScreen.js): `pollingEnabled` exige `!accessDenied && context && same(view.scope, context) && view.status === 'ready' && !view.busy && !hasModalOpen && !dispatching.current && !acknowledging.current`, e `pollingIndicator` reflete diretamente `useIsFocused()`, `AppState`, `pollingEnabled`, `view.error === 'stale'` e `view.status === 'error'`, omitindo-se totalmente em `accessDenied` ou erro `'denied'`/`'session'`. Nenhum timer ou leitura HTTP extra foi criado.
6. **`STAFF02-AUD-06` (P2 — Reforço de testes e documentação de dependências):**
   - [staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs): novo teste unitário de `verifyStationAccess` cobrindo limpeza imediata, não publicação da lista de verificação em `state.stations`, Casos A/B/C, barreira contra exposição parcial e descarte de verificação tardia na troca de evento.
   - [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs): adicionados `hasExactText`, `hasQueueRow`, cobertura do ciclo `useStaffPolling`, estados de `pollingIndicator`, modal `SafeAreaView` + `ScrollView` + `onRequestClose`, `404` Casos A/B/C com modal aberto, neutralização de callback e preservação de `SecureStore`.
   - [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs): adicionados `hasExactText` e `hasQueueRow`; teste `STAFF-02` reforçado com duplo toque em voo, `Idempotency-Key` UUID em todas as rotas de mutação, limpeza de recibos em `SecureStore`, linhas posicionais exatas e indicador de polling; novos testes reais cobrindo integralmente `STAFF02-AUD-01`, `STAFF02-AUD-02` (`A → Painel` e `A → Painel → B`) e `STAFF02-AUD-05 + AUD-06` (`Remover da fila`, `useStaffPolling` real + `useIsFocused` + `AppState`, erro transitório `stale`, `uncertain` sem segundo `POST` e ocultação do indicador em `403`).
7. **`STAFF02-AUD-07` (P2 — Responsividade do `StationConfirmModal`):**
   - [StaffStationSections.js](../app/screens/staff/components/StaffStationSections.js): `StationConfirmModal` envolto em `SafeAreaView` (`edges={['top', 'right', 'bottom', 'left']}`), `modalCard` limitado com `maxWidth: 460`, `maxHeight: '100%'` e `overflow: 'hidden'`, conteúdo interno em `ScrollView` (`keyboardShouldPersistTaps="handled"`, `bounces={false}`, `showsVerticalScrollIndicator`), `onRequestClose={onCancel}` preservado (sem fechamento por toque em backdrop) e `minWidth: 0` mantido em `calledIdentity`.
8. **`STAFF02-AUD-08` (P3 — Documentação e links portáveis):**
   - Remoção integral de links locais absolutos de estação de trabalho neste documento, registro explícito de `5cde6a57874bad816213a0e3be8234dd6b51173b` e documentação completa da Rodada 1.

### 9.3. Revisão adicional pós-push `d6765f1` — Alinhamento contratual das fixtures

Após a publicação do commit `d6765f1dec3b14f40be4d955e4791c88f1c56735`, foi realizada revisão objetiva de todas as fixtures adicionadas na STAFF-02 ([roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs), [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) e [staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs)) contra os parsers oficiais ([parseEntryState](../app/services/staffEntryService.js) e [staffOperationsService.js](../app/services/staffOperationsService.js)) e controladores backend ([staff-queries.controller.ts](../backend/src/events/staff-queries.controller.ts), [staff-station-state.service.ts](../backend/src/events/staff-station-state.service.ts), [staff-entry.service.ts](../backend/src/participations/staff-entry.service.ts), [staff-operations.controller.ts](../backend/src/events/staff-operations.controller.ts) e [staff-called-removal.controller.ts](../backend/src/events/staff-called-removal.controller.ts)):

1. **Correção da fixture `entryNominal` no teste `STAFF02-AUD-01` ([roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs)):**
   - **Problema identificado:** declarava `waitingCount: 2` com `waiting: []` (violando `waitingCount === waiting.length` em `parseEntryState`) e omitia os booleanos obrigatórios `canCall`, `canConfirm`, `canMarkAbsent` e `canRemove`. Como consequência, `parseStaffEntrySummary` rejeitava o payload no painel antes mesmo do fluxo de verificação de `404`.
   - **Correção aplicada:** incluídos dois participantes válidos e distintos em `entryWaiting` (`position: 1` e `2`, `participationId` UUIDs disjuntos de `pendingCall.participationId`), adicionados os booleanos consistentes com `canManage: true`, `externalQueueEnabled: true` e presença de `pendingCall` (`canCall: !hasPending`, `canConfirm: hasPending`, `canMarkAbsent: hasPending`, `canRemove: hasPending`), preservando `'JulianaEntrada'` em `pendingCall` e reforçando a asserção inicial do resumo nominal (`'Chamada pendente: JulianaEntrada · 2 aguardando'` e métrica `'Fila externa'` igual a `'2'`).
2. **Consistência de transição pós-`call-next` no teste `STAFF02-AUD-02` ([roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs)):**
   - **Problema identificado:** após `POST .../call-next` mover `'Alice A'` para `pendingA`, os mocks de `GET .../operational-state` e `GET .../experiences/:experienceId/queue` ainda retornavam o mesmo `queueEntryId` em `waiting` e `firstWaitingQueueEntryId`.
   - **Correção aplicada:** transição dinâmica de `waitingA` via `waitingA.shift()` no `POST /call-next`, mantendo fila remanescente, `waitingCount`, `canCallWaitingEntries`, `firstWaitingQueueEntryId` e `canCall` coerentes com o snapshot oficial do servidor.
3. **Completude dos DTOs oficiais de `/stations` e `/queue` nas fixtures da STAFF-02 ([roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs)):**
   - Adicionados `pendingCalledAt` nos payloads de `/stations` e `observedAt` + `acceptingNewEntries` nos payloads de `/queue` nos testes `STAFF-02`, `STAFF02-AUD-01`, `STAFF02-AUD-02` e `STAFF02-AUD-05 + AUD-06`, espelhando [staff-queries.controller.ts](../backend/src/events/staff-queries.controller.ts).
4. **Demais arquivos verificados:**
   - Fixtures de [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs) e [staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs) validadas estaticamente em conformidade com os parsers e contratos oficiais; nenhum defeito de produção foi encontrado, permanecendo inalterados todos os parsers e serviços/telas em `d6765f1`.

---

## 10. Dependências e Cobertura de Testes

### Requisitos para execução da campanha automatizada
- Suites que usam React 19, `react-test-renderer` e React Navigation reais ([staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs), [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs), [staffPolling.test.cjs](../app/tests/staffPolling.test.cjs) e [staffRealNavigation.test.cjs](../app/tests/staffRealNavigation.test.cjs)) resolvem essas dependências isoladas a partir de [qa/regression/package.json](../qa/regression/package.json) (`react@19.3.0`, `react-test-renderer@19.3.0`, `@react-navigation/core@7.22.1`, `@react-navigation/routers@7.6.4`).
- Portanto, tanto `app/node_modules` quanto `qa/regression/node_modules` devem estar instalados antes da execução com **GPT-6 Luna — Medium**. Testes críticos ignorados (`skipped`) por falta de dependências invalidam a aprovação da campanha.

---

## 11. Resultados Efetivamente Executados e Campanha Pendente

### 11.1. Verificações executadas nesta etapa de implementação (estáticas / não executoras de testes)
- **Inspeção estática e checagem de sintaxe `.cjs` (`node --check`):** realizada nos quatro arquivos de teste da entrega ([roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs), [staffStationOperational.test.cjs](../app/tests/staffStationOperational.test.cjs), [staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs) e [staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs)) sem executar casos de teste.
- **Integridade de patch acumulado (`qa-evidence/STAFF-02-changes.diff`):** patch regerado a partir da base fixa `95b8b80f3c0142af30c25e9483291d75677a085d` e validado estaticamente com `git diff --check -- app docs` e `git apply --check --reverse qa-evidence/STAFF-02-changes.diff` ao final das edições.

### 11.2. Validações automatizadas pendentes após as correções de integração
A segunda campanha foi interrompida na integração filtrada (Seção 13.2). Selecionar manualmente **GPT-6 Luna Medium**, usar o checkout da branch `feature/staff-operacional-v2` com as correções e retomar na raiz, com `NODE_ENV=test` e as dependências verificadas.

1. `node --test --test-name-pattern="STAFF02|STAFF-02|R3-" app/tests/roleRoutingIntegration.test.cjs`
2. `node --test app/tests/roleRoutingIntegration.test.cjs`
3. `node --test app/tests/staffOperationsService.integration.test.cjs`
4. `node --test app/tests/staffPolling.test.cjs`
5. `node --test app/tests/staffRealNavigation.test.cjs`

Se as prioridades passarem, executar `npm --prefix app test` e `npm --prefix qa/regression test`, com os scripts previamente inspecionados. A regressão de `app` inclui as suítes de demonstração, Dashboard e Estação já aprovadas isoladamente em campanhas anteriores. O filtro é diagnóstico e a suíte integral continua obrigatória. Interromper a campanha se houver falha.

*(Critério de aprovação: zero falhas, zero testes ignorados por ausência de `qa/regression/node_modules` e zero avisos inesperados em todos os comandos aplicáveis.)*

---

## 12. Riscos e Limitações

- Homologação presencial no Expo Go (incluindo Android pequeno, fonte ampliada do sistema e orientação horizontal para conferir `STAFF02-AUD-07` e o cronômetro `Chamado há MM:SS`) pendente de validação pelo responsável.
- Execução da campanha automatizada completa pendente com **GPT-6 Luna — Medium** na Seção 11.2.
- O indicador `Chamado há MM:SS` usa proteção contra desvios de relógio (`< -60s` ou `> 24h`), exibindo fallback `Chamada pendente` sem influenciar regras temporais do servidor.

---

## 13. Histórico de Publicações e Revisões

- **19/11/2026:** Criação do documento de diagnóstico e plano inicial da STAFF-02.
- **20/11/2026 — Commit `5cde6a57874bad816213a0e3be8234dd6b51173b`:** Publicação inicial da reformulação visual da Estação, Fila e Atendimento na branch `feature/staff-operacional-v2`.
- **20/11/2026 — Rodada 1 (Auditoria Independente — plano):** Registro dos achados `STAFF02-AUD-01` a `STAFF02-AUD-08` e plano de correção antes das modificações em código.
- **20/11/2026 — Commit `d6765f1dec3b14f40be4d955e4791c88f1c56735`:** Publicação das correções da **Auditoria Independente — Rodada 1** (`STAFF02-AUD-01` a `STAFF02-AUD-08`), reforço dos testes e patch acumulado na branch `feature/staff-operacional-v2`.
- **21/11/2026 — Ajuste final pós-push `d6765f1`:** Revisão contratual das fixtures da STAFF-02, correção de `entryNominal` (`STAFF02-AUD-01`), consistência de fila em `STAFF02-AUD-02`, completude de campos DTO em `/stations` e `/queue` nos mocks e regeneração integral do patch acumulado [STAFF-02-changes.diff](../qa-evidence/STAFF-02-changes.diff) desde `95b8b80`.

### 13.1. Primeira campanha automatizada — falha na AUD-01

A campanha com **GPT-6 Luna Medium** foi executada sobre `fbc9481843c49e5a55249459efc6c47b8b20dc82`.

| Suíte | Código de saída | Aprovados | Falhos |
| --- | ---: | ---: | ---: |
| `staffDemoState.test.cjs` | 0 | 21 de 21 | 0 |
| `staffDashboard.test.cjs` | 1 | 23 | 1 |

No teste `STAFF02-AUD-01` de [staffDashboard.test.cjs](../app/tests/staffDashboard.test.cjs), a asserção na linha 1350 do commit testado esperava `session` para HTTP 401 e recebeu `event_denied`. O runner também registrou uma rejeição `Error: 401` sem tratamento. A inspeção confirmou que `refreshPanel()` pegava a Promise rejeitada de `/stations` da iteração anterior e restabelecia o bloqueio de acesso. `verifyStationAccess()` retornava o bloqueio antes de consumir a nova Promise programada para o 401.

O fixture passou a consumir cada resposta programada uma única vez. O teste verifica o consumo antes de resolver ou rejeitar a Promise e confirma que o painel voltou ao estado autorizado antes de cada verificação de 403, 404 ou 401. O contrato de `verifyStationAccess()` preserva a distinção entre sessão e evento. A correção é restrita ao teste e mantém as expectativas de autorização.

A campanha foi interrompida antes de executar `staffStationOperational`, o filtro e a suíte integral de `roleRoutingIntegration`, `staffOperationsService.integration`, `staffPolling`, `staffRealNavigation` e as regressões de `app` e `qa/regression`. A STAFF-02 permanece bloqueada até nova validação com Luna Medium.

### 13.2. Segunda campanha automatizada — duas falhas de integração

A campanha com **GPT-6 Luna Medium** foi executada sobre `6682363ad1a2cbf0500a007c903edfb7f3af37da`.

| Suíte | Código de saída | Aprovados | Falhos | Ignorados | Cancelados |
| --- | ---: | ---: | ---: | ---: | ---: |
| `staffDashboard.test.cjs` | 0 | 24 | 0 | 0 | 0 |
| `staffStationOperational.test.cjs` | 0 | 3 | 0 | 0 | 0 |
| `roleRoutingIntegration.test.cjs` com filtro STAFF-02/R3 | 1 | 3 | 2 | 0 | 0 |

- **Chamar próximo.** O mock consumia e zerava `pendingCallDeferred` antes de o teste tentar chamar `.resolve()`, causando um `TypeError`. O teste agora retém a referência da resposta, confirma que o mock a consumiu e a libera mesmo se uma asserção falhar. Antes de liberá-la, verifica que houve um único POST, que a intenção está em `dispatching` e que a fila ainda não avançou. As verificações de idempotência, limpeza do SecureStore, FIFO, conclusão e ausência foram preservadas.
- **404 durante o modal.** O teste avançava o relógio após abrir o modal, quando o polling já estava pausado. Agora ele verifica a pausa e a retomada, conta o GET de `/operational-state` e retém sua resposta até o modal abrir novamente. O consumo de uma segunda resposta controlada, no GET de `/stations`, comprova que o aplicativo reagiu ao `404 RESOURCE_NOT_FOUND` entregue pelo harness. O cenário conserva as verificações de ocultação dos nomes, fechamento do modal, invalidação do callback e ausência de POST. A recuperação espera uma leitura nova de `/entry-control` para conferir o cache nominal. A negativa tardia continua sendo entregue após a troca de evento.

A campanha parou na integração filtrada. A nova execução do filtro, a suíte integral de integração, as outras prioridades e as duas regressões completas permanecem pendentes. As correções desta rodada passaram apenas por inspeção estática.

---

## 14. Estado Final da Entrega

A revisão contratual posterior a `d6765f1` está publicada em `fbc9481`. A correção do fixture do Dashboard foi publicada em `6682363` e passou na segunda campanha. As duas correções de integração estão preparadas localmente sobre `6682363` em `feature/staff-operacional-v2`. A evidência acumulada parte de `95b8b80f3c0142af30c25e9483291d75677a085d`. A STAFF-02 permanece bloqueada até a validação com **GPT-6 Luna Medium**. A decisão sobre homologação no Expo e publicação cabe ao responsável pelo projeto.
