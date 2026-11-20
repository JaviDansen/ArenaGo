# ArenaGo — STAFF-02 | Reformulação da Estação, Fila e Atendimento

## 1. Identificação da Task e Commit-Base

- **Projeto:** ArenaGo — ProgramacaoMobile
- **Task:** STAFF-02 — Reformulação da Estação, Fila e Atendimento
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base (`HEAD` de referência):** `95b8b80f3c0142af30c25e9483291d75677a085d` (`style(staff): padroniza interface com Admin e conclui homologação da STAFF-01`)
- **Status:** Implementação e inspeção estática concluídas; aguardando campanha automatizada com **GPT-6 Luna — Medium**, publicação via VSCode pelo responsável e homologação no Expo.

### Seleção de modelos e níveis de raciocínio (conforme `AGENTS.md`)

- **Implementação (`STAFF-02`):** Recomendado **GPT-6.1 Sol — High** (integração visual/funcional em tela operacional com coordenador idempotente, persistência em `SecureStore`, bloqueios de concorrência, propagação de autorização e atualização de harnesses reais).
- **Execução da campanha de validações automatizadas:** **GPT-6 Luna — Medium** (executor padrão designado pelo `AGENTS.md`; nenhum teste automatizado foi executado durante esta etapa de implementação).

---

## 2. Diagnóstico do Código Anterior

Antes de qualquer alteração visual ou funcional, o estado na base `95b8b80` foi inspecionado:

1. **Navegação e duplicidade em `app/screens/staff/StaffEventsNavigator.js` (`section === 'station'`):**
   - `StaffEventHomeScreen` já utilizava `StaffLiveScreen` com o padrão aprovado da STAFF-01 (`Voltar ao painel` à esquerda + logo `logo-arenago-staff.png` à direita, fundo `#090412`, órbitas decorativas, `SafeAreaView` e `ScrollView`), além de `beforeRemove` e `store.revalidateOnReturn()`.
   - Contudo, dentro de `section === 'station'`, `StaffEventDashboard` renderizava um cabeçalho e card de fila duplicados (`station.label`, `Experiência: ...`, `Disponibilidade: ...`, `Atendimento pendente: ...`, `Fila compartilhada da experiência`, `Fila de <experiência>`, `Pessoas em espera`, `Janela operacional` e um botão adicional `Atualizar fila`), logo acima de `StaffStationOperationalScreen`, que renderizava novamente título, estação, contagem e um segundo botão `Atualizar atendimento`.
   - Além disso, o callback `onChanged` disparava `store.refreshStations()` diretamente, o que podia transitar `stationStatus` para `'loading'` temporariamente em redes com latência real e desmontar `StaffStationOperationalScreen` logo após a confirmação da operação, perdendo o banner de feedback.
2. **Tela operacional `app/screens/staff/StaffStationOperationalScreen.js`:**
   - Já possuía toda a arquitetura segura de leitura (`operational-state`), polling de 5s (`useStaffPolling`), coordenador (`createStaffOperationsCoordinator`), persistência em `SecureStore` (`defaultStaffIntentStorage`), `Idempotency-Key`, reserva/despacho/recibo terminal, reconciliação automática de `terminal_pending`, cancelamento de `reserved`, proteção contra duplo toque e modal de confirmação para `complete`, `absent` e `remove_called`.
   - Visualmente, não seguia os tokens aprovados da STAFF-01 nem os mockups 03 e 04, usava os rótulos antigos (`Concluir atendimento` e `Registrar ausência`), não apresentava o indicador seguro de tempo desde a chamada (`pending.calledAt`), não exibia a faixa não clicável `Fila compartilhada entre as estações` nem o rodapé discreto `Fila e atendimento atualizados automaticamente`, e não propagava `403`/`401` diretamente ao bloqueio de acesso do painel.
3. **Serviços e contratos (`staffOperationsService.js`, `staffDashboardService.js`, `staffIntentStorage.js`, `useStaffPolling.js`):**
   - Já suportavam todos os campos e operações exigidos pela STAFF-02 sem qualquer alteração no backend ou em migrations.

---

## 3. Referências Visuais (Mockups 03 e 04)

- **Tela 03 (`ArenaGO_Staff_03_Estacao_Fila.png`) — Estado A (`pending === null`):**
  - Identificação superior com `station.label`, badge semântico de disponibilidade (`DISPONÍVEL` / `INDISPONÍVEL`), nome da experiência (`experience.name`) com ícone de controle e nome do evento (`event.name`).
  - Seção `FILA DA EXPERIÊNCIA` com contagem oficial `N aguardando`, lista FIFO em card estruturado (badge numérico de posição, `displayName`, status `Aguardando`) ou estado vazio real (`Fila vazia` / `Nenhuma pessoa aguardando nesta experiência.`), finalizada pela faixa informativa não clicável `Fila compartilhada entre as estações`.
  - Botão primário destacado `Chamar próximo` habilitado apenas quando todas as condições oficiais forem satisfeitas.
  - Seção `ATENDIMENTO ATUAL` com card vazio `Nenhum participante chamado` e orientação curta para resolver o atendimento antes da próxima chamada.
  - Rodapé discreto `Fila e atendimento atualizados automaticamente` e botão único secundário `Atualizar atendimento`.
- **Tela 04 (`ArenaGO_Staff_04_Atendimento.png`) — Estado B (`pending !== null`):**
  - Mesma identificação superior e seção `FILA DA EXPERIÊNCIA` exibindo somente a fila remanescente devolvida pelo servidor (sem duplicar o participante chamado nem decrementar por suposição).
  - Ausência do botão `Chamar próximo` enquanto houver chamada pendente.
  - Seção `ATENDIMENTO ATUAL` com avatar de participante, `pending.displayName`, `Em atendimento`, pílula segura de tempo decorrido (`Chamado há MM:SS` / `HH:MM:SS`, com fallback seguro `Chamada pendente`), prompt `Selecione a ação para este participante:` e três botões semânticos distintos:
    - `Concluir experiência` (verde/sucesso)
    - `Marcar ausência` (âmbar/alerta)
    - `Remover da fila` (vermelho/perigo)

---

## 4. Adaptações ao Padrão Visual da STAFF-01

Seguindo a regra de precedência visual da STAFF-02:
- **Cabeçalho compartilhado (`StaffLiveScreen`):** `Voltar ao painel` à esquerda + logo oficial transparente `app/assets/images/logo-arenago-staff.png` à direita, com `SafeAreaView`, `ScrollView` e fundo `#090412` com órbitas decorativas.
- **Cabeçalhos antigos dos mockups não replicados:** sem texto `ArenaGO` à esquerda, sem badge `STAFF` no topo e sem segundo botão `Voltar` inferior.
- **Tokens reutilizados de `AdminLiveUI.js` (`liveColors`) e `adminTheme.js`:**
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

## 6. Componentes Criados e Alterados

- **Criado:** [app/screens/staff/components/StaffStationSections.js](file:///C:/Users/kaled/.gemini/antigravity/worktrees/ProgramacaoMobile/auth_and_sessions/app/screens/staff/components/StaffStationSections.js)
  - Helper puro `formatElapsedSinceCall(calledAt, nowMs)` com proteção contra relógio dessincronizado e sem impacto no estado operacional.
  - Componentes apresentacionais `StationStatusBadge`, `StationHeaderCard`, `ExperienceQueueCard`, `ElapsedCallBadge`, `CurrentServiceCard` e `StationConfirmModal`, com ícones vetoriais nativos sem dependências externas e layout responsivo (`flexWrap`, `minWidth: 0`, `flexShrink: 1`, `minHeight: 48/52`).
- **Alterado:** [app/screens/staff/StaffStationOperationalScreen.js](file:///C:/Users/kaled/.gemini/antigravity/worktrees/ProgramacaoMobile/auth_and_sessions/app/screens/staff/StaffStationOperationalScreen.js)
  - Reorganização visual completa nos padrões STAFF-01 e mockups 03/04, estados especiais explícitos (carregamento, vazio, indisponível, encerramento operacional, stale, erro de rede, acesso negado, intenções persistidas), propagação segura de `403`/`401` via `onAccessDenied`, suporte reativo a `accessDenied` (fechando modais e limpando dados nominais sem apagar recibos do `SecureStore`) e integração de atualização única via `onRefresh`.
- **Alterado (mínimo de integração):** [app/screens/staff/StaffEventsNavigator.js](file:///C:/Users/kaled/.gemini/antigravity/worktrees/ProgramacaoMobile/auth_and_sessions/app/screens/staff/StaffEventsNavigator.js)
  - Removido o bloco visual e o botão `Atualizar fila` duplicados em `section === 'station'`, consolidando a apresentação na tela operacional, mantendo `store.refreshQueue`, `store.pollQueue`, `store.clearQueue`, `beforeRemove` e `revalidateOnReturn`, passando `accessDenied`/`onAccessDenied`/`onRefresh` e usando `pollStations`/`pollQueue` em `onChanged` para evitar desmontagem transitória e perda do feedback após mutações confirmadas.

---

## 7. Decisões de Navegação

- Preservado o fluxo `Eventos Staff → Painel Operacional → Estação` sem rota intermediária.
- Retorno ao Painel exclusivamente pelo cabeçalho (`Voltar ao painel`) ou retorno nativo (`beforeRemove`), limpando `stationId`, executando `store.clearQueue()` e acionando `store.revalidateOnReturn()` sem perder o evento selecionado nem disparar mutações.
- Home e Painel Operacional homologados na STAFF-01 não foram alterados visualmente.

---

## 8. Preservação dos Contratos e da Idempotência

- **Arquivos preservados intactos (zero alterações):** `app/services/staffOperationsService.js`, `app/services/staffDashboardService.js`, `app/services/staffIntentStorage.js`, `app/screens/staff/useStaffPolling.js`, `app/screens/staff/components/StaffLiveScreen.js`, todo o módulo `admin`, todo o módulo `participant` e todo o `backend/`.
- **Rotas preservadas:**
  - `GET /api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state`
  - `POST /api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next`
  - `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/complete`
  - `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/absent`
  - `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/remove`
- **Garantias mantidas:** `Idempotency-Key`, reserva persistida antes do `POST`, estado `dispatching`, bloqueio em resultado incerto/timeout, reconciliação automática de `terminal_pending`, cancelamento explícito de `reserved`, proteção contra duplo toque e diálogos de confirmação para `complete`, `absent` e `remove_called`.

---

## 9. Cobertura de Testes

1. **Nova suíte dedicada:** [app/tests/staffStationOperational.test.cjs](file:///C:/Users/kaled/.gemini/antigravity/worktrees/ProgramacaoMobile/auth_and_sessions/app/tests/staffStationOperational.test.cjs)
   - Testes unitários puros de `formatElapsedSinceCall` (`MM:SS`, `HH:MM:SS`, pequeno desvio negativo, desvio > 60s, > 24h e entradas inválidas).
   - Testes de renderização real (`react` + `react-test-renderer`) cobrindo: carregamento inicial sem dados inventados; Estado A com fila FIFO não-alfabética e nomes longos; faixa `Fila compartilhada entre as estações` não clicável; fila vazia sem erro de conexão; estação `INDISPONÍVEL` mantendo fila visível e bloqueando chamada; encerramento operacional (`canCall: false`); Estado B com tempo decorrido e sem duplicação do chamado; descarte de resposta tardia em troca de estação/evento; falha transitória `stale` bloqueando mutações e recuperando via polling sem `POST`; propagação de `accessDenied` fechando modal e neutralizando callback antigo; intenções `reserved` e `pending_other` bloqueando mutações; diferenciação `404` vs `403` (coerente com `R3-03`); e logout desmontando contexto operacional.
2. **Suíte de integração real atualizada:** [app/tests/roleRoutingIntegration.test.cjs](file:///C:/Users/kaled/.gemini/antigravity/worktrees/ProgramacaoMobile/auth_and_sessions/app/tests/roleRoutingIntegration.test.cjs)
   - Whitelist `control.realStaff` atualizada explicitamente com `'screens/staff/components/StaffStationSections'`.
   - Cenários preexistentes preservados integralmente e alinhados aos novos rótulos obrigatórios (`Concluir experiência`, `Marcar ausência`, `Fila compartilhada entre as estações`, `Atualizar atendimento` sem duplicidade de `Atualizar fila`).
   - Novo cenário completo de integração **STAFF-02** exercitando Estados A e B, transição via `Chamar próximo`, `Concluir experiência`, `Marcar ausência` (com reinserção e após o corte), fila compartilhada em segunda estação `INDISPONÍVEL` e propagação de `403` de `/operational-state` para `SEM ACESSO` no Painel.

---

## 10. Resultados Efetivamente Executados

### Inspeções estáticas executadas nesta etapa
- Confirmação de branch `feature/staff-operacional-v2` e commit-base `95b8b80f3c0142af30c25e9483291d75677a085d`, sem merge/rebase em andamento.
- Revisão estática de imports, dependências de `useEffect` (estabilização de `defaultGetNow` + `useRef` em `ElapsedCallBadge`), contratos HTTP, bloqueios de concorrência, `SecureStore` e consistência de harnesses.
- Geração do patch exclusivo [qa-evidence/STAFF-02-changes.diff](file:///C:/Users/kaled/.gemini/antigravity/worktrees/ProgramacaoMobile/auth_and_sessions/qa-evidence/STAFF-02-changes.diff) relativo a `95b8b80f3c0142af30c25e9483291d75677a085d` e verificação estática `git diff --check` + validação de compatibilidade com `git apply --check` (a registrar após execução abaixo).

### Validações automatizadas NÃO executadas nesta etapa (pendentes com GPT-6 Luna — Medium)
Conforme `AGENTS.md`, **nenhum teste automatizado foi executado durante esta etapa de implementação**. Campanha preparada para execução por **GPT-6 Luna — Medium** após confirmação do responsável:

```powershell
cd app
node --test tests/staffStationOperational.test.cjs
node --test tests/staffOperationsService.integration.test.cjs
node --test tests/roleRoutingIntegration.test.cjs
node --test tests/staffDashboard.test.cjs
node --test tests/staffEventDiscovery.test.cjs
node --test tests/staffScreens.test.cjs
node --test tests/staffNavigation.test.cjs
node --test tests/staffRealNavigation.test.cjs
node --test tests/staffPolling.test.cjs
node --test tests/staffBackground.test.cjs
node --test tests/staffDemoState.test.cjs
npm.cmd test
```

*(Script `app/package.json -> "test"` inspecionado: executa exclusivamente `node --test tests/*.test.cjs`, sem migrations, seeds, banco real ou operações destrutivas.)*

---

## 11. Riscos e Limitações

- **Validação automatizada ainda pendente:** Embora toda a revisão estática tenha sido feita, a execução real da suíte Node.js depende da etapa de validação com **GPT-6 Luna — Medium**.
- **Homologação física pendente:** Comportamento visual exato em telas pequenas Android/iOS, fontes ampliadas pelo sistema operacional, SafeAreas físicas e gesto nativo de retorno exigem validação presencial no Expo Go pelo responsável.
- **Relógio do dispositivo no indicador `Chamado há MM:SS`:** Se o relógio do aparelho divergir mais de 60s para trás ou mais de 24h para frente do timestamp `calledAt` do servidor, a UI usa o fallback seguro `Chamada pendente` sem afetar regras temporais do backend.

---

## 12. Pendências de Homologação (Expo e Publicação)

- **Cenário A (sem chamada):** Estação disponível com fila, contagem/posição FIFO reais, `Fila compartilhada entre as estações`, `Chamar próximo` habilitado e card `Nenhum participante chamado`.
- **Cenário B (com chamada):** Participante chamado em `ATENDIMENTO ATUAL`, tempo decorrido, fila remanescente sem duplicação, ausência de `Chamar próximo` e botões `Concluir experiência`, `Marcar ausência` e `Remover da fila` com diálogos e feedback real.
- **Cenários complementares:** Fila vazia, estação `INDISPONÍVEL`, nomes longos, retorno ao painel (cabeçalho e gesto/botão do sistema), atualização automática (5s) e erro de rede/acesso.
- **Publicação Git:** Conforme seção 6 do `AGENTS.md`, `git add`, `git commit` e `git push` permanecem sob responsabilidade do usuário via VSCode na branch `feature/staff-operacional-v2` (mensagem sugerida: `feat(staff): reformula telas de estação, fila e atendimento`).

---

## 13. Histórico de Correções Posteriores

- **19/11/2026 (Preparação):** Criação inicial de `docs/STAFF_02_ESTACAO_FILA_ATENDIMENTO.md` antes das alterações de código.
- **19/11/2026 (Implementação inicial):** Criação de `StaffStationSections.js`, reformulação de `StaffStationOperationalScreen.js`, consolidação em `StaffEventsNavigator.js`, criação de `staffStationOperational.test.cjs`, atualização de `roleRoutingIntegration.test.cjs` e geração de `qa-evidence/STAFF-02-changes.diff`.
- **Revisão estática preventiva durante implementação:**
  1. Estabilizada a referência padrão `defaultGetNow` + `useRef` em `ElapsedCallBadge` para evitar recriação de `setInterval` a cada segundo.
  2. Ajustado `onChanged` em `StaffEventsNavigator.js` para usar `pollStations()` / `pollQueue()` quando o estado já está `'ready'`, evitando desmontagem transitória da tela da estação e perda do banner de feedback em redes com latência real.
  3. Tornada assíncrona a ação `Atualizar atendimento` (`Promise.all([refresh(), Promise.resolve(onRefresh?.())])`) para sincronizar deterministicamente a leitura da estação e da fila.

---

## 14. Estado Final da Entrega

Implementação da **STAFF-02** concluída na branch `feature/staff-operacional-v2` sobre a base `95b8b80f3c0142af30c25e9483291d75677a085d`, sem iniciar `STAFF-03`, `STAFF-04`, `STAFF-05` ou quaisquer outras tasks. Aguardando validação automatizada com **GPT-6 Luna — Medium**, commit/push pelo responsável via VSCode e homologação no Expo.
