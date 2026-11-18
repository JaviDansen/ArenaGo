# ArenaGo — STAFF-01: Reformulação da Seleção de Eventos e Painel Operacional

## 1. Identificação, Objetivo e Escopo

- **Projeto:** ArenaGo — ProgramacaoMobile
- **Task:** STAFF-01 — Reformulação da Seleção de Eventos e Painel Operacional
- **Responsável:** Kaled
- **Branch de trabalho:** `feature/staff-operacional-v2`
- **Branch base:** `origin/develop`
- **Prioridade:** P0
- **Status inicial:** Em implementação (documentação criada antes de alterações de código)

**Objetivo:** Reformular visualmente as telas reais de **Seleção de Eventos Staff** (`StaffEventsScreen`) e **Painel Operacional** (`StaffEventHomeScreen` e `StaffEventDashboard`), seguindo os mockups oficiais aprovados, preservando integralmente contratos HTTP existentes, autorização por evento, isolamento de conta/sessão, polling operacional e proteções contra respostas obsoletas.

**Fora de escopo nesta entrega:**
- Reformulação interna da tela de Estação (`STAFF-02` — mockups `ArenaGO_Staff_03_Estacao_Fila.png` e `ArenaGO_Staff_04_Atendimento.png`).
- Reformulação interna do Controle de Entrada (`STAFF-04`).
- Revisão ampliada de sincronização/reconexão (`STAFF-05`).
- Criação de novos endpoints backend, migrations, alterações de schema, interface do Participante ou módulo Admin.

---

## 2. Branch Utilizada e Commit-Base

- **Branch:** `feature/staff-operacional-v2`
- **Commit-base (`origin/develop`):** `ae2ba16b289daeff21fa09db7ca95613d6d79a6e` (`docs: consolida panorama e arquiva planejamento antigo`)
- **Comando de criação:** `git switch -c feature/staff-operacional-v2 origin/develop` (após `git fetch origin` e verificação de working tree limpo).

---

## 3. Diagnóstico Inicial da Implementação Existente

Antes de qualquer alteração na interface, os arquivos atuais na base `ae2ba16b` foram inspecionados:

1. **`app/screens/staff/StaffEventsNavigator.js`:**
   - Contém `StaffEventsProvider`, `StaffEventsScreen` (Seleção de Eventos) e `StaffEventHomeScreen` + `StaffEventDashboard` (Painel Operacional).
   - A seleção de eventos exibe título `"Eventos Staff"`, descrição genérica, lista simples de cards escuros contendo apenas nome do evento e rótulo de fase efetiva (`phaseLabel(event)`), botão `"Atualizar eventos"` e `"Sair da conta"` logo em seguida. Falta a barra superior `ArenaGO` + badge `STAFF`, hierarquia visual do mockup `ArenaGo_Staff_01_Home.png`, distinção visual de fase vs situação operacional e posicionamento do logout na região inferior.
   - O Painel Operacional exibe o nome do evento como título principal, `"Status: <fase>"`, `"Painel operacional"`, um botão plano `"Controle de Entrada"` (sem estado da fila externa ou indicação de chamada pendente), seção `"Estações do evento"` com agrupamentos de experiências (ocultando o nome da experiência quando há apenas 1 experiência retornada) e cards simples por estação com texto plano `"Disponibilidade: ..."` e `"Atendimento pendente: ..."`.
   - Já utiliza `AuthBackground` (`testID="staff-events-background"` / `testID="staff-event-home-background"`) e `useStaffPolling.js` (60s para `refreshSilent` de eventos/fase e 5s para `pollStations` / `pollQueue`), além de exibir alertas para erro `'stale'`.
   - Navegação direta do painel para estação selecionada (`section: 'panel' -> 'station'`), com botão `"Voltar ao painel"` e `beforeRemove` retornando para `'panel'` (sem tela intermediária `'stations'`, conforme decisão preservada da Task A4).
2. **`app/services/staffEventsService.js` e `backend/src/events/staff-queries.controller.ts`:**
   - `GET /api/v1/staff/events` retorna `{ events: [{ id, name, status, effectivePhase }] }`.
   - `effectivePhase` pode ser `'scheduled' | 'open' | 'not_ready' | 'closing' | 'closed'`.
   - O endpoint de listagem **não** retorna data/horário de início/fim, local ou contagem de estações por evento.
3. **`app/services/staffDashboardService.js` e `app/services/staffOperationsService.js`:**
   - Carregam experiências (`GET /staff/events/:eventId/experiences`), estações (`GET /staff/events/:eventId/stations`) e fila compartilhada da experiência selecionada (`GET /staff/events/:eventId/experiences/:experienceId/queue`).
   - Ainda não consultavam um resumo do Controle de Entrada no Painel Operacional para exibir o estado real da fila externa, contagem de espera externa ou chamada externa pendente.
4. **`app/services/staffEntryService.js` e `backend/src/participations/staff-entry.service.ts`:**
   - `GET /api/v1/staff/events/:eventId/entry-control` já retorna `{ eventId, externalQueueEnabled, canManage, observedAt, waitingCount, waiting, pendingCall, canCall, canConfirm, canMarkAbsent, canRemove }`, permitindo reutilização segura e fiel no card de Controle de Entrada e no resumo operacional do Painel sem criar novos endpoints.

---

## 4. Telas, Componentes, Hooks, Serviços e Contratos Identificados

| Camada | Arquivo | Papel |
|---|---|---|
| Roteamento Principal | `app/App.js` | Monta `StaffEventsNavigator` em `StaffPending` quando a identidade validada é estritamente `staff` (sem `admin`) |
| Navegação / Telas Staff | `app/screens/staff/StaffEventsNavigator.js` | `StaffEventsProvider`, `StaffEventsScreen` e `StaffEventHomeScreen` (`StaffEventDashboard`) |
| Subtelas Preservadas | `app/screens/staff/StaffEntryControlRealScreen.js`, `app/screens/staff/StaffStationOperationalScreen.js` | Operação interna de Controle de Entrada e de Estação (fora do escopo de reformulação visual desta task) |
| Polling | `app/screens/staff/useStaffPolling.js` | Hook de polling por ciclo concluído respeitando foco (`useIsFocused`), `AppState` ativo e escopo/geração |
| Serviços Staff | `app/services/staffEventsService.js`, `app/services/staffDashboardService.js`, `app/services/staffOperationsService.js`, `app/services/staffEntryService.js` | Stores reativos com controle de geração (`generation`), sessão (`epoch`, `revision`) e parsers estritos de resposta |
| UI Compartilhada | `app/components/ui/AuthBackground.js` | Fundo visual dark + iluminação roxa reutilizado nas telas reais |
| Testes Relacionados | `app/tests/staffEventDiscovery.test.cjs`, `app/tests/staffDashboard.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs`, `app/tests/staffDemoState.test.cjs` | Cobertura unitária dos stores, integração completa de navegação React Navigation real e inventário de arquivos Staff |

---

## 5. Requisitos e Referências Visuais

- **Mockup Tela 1:** `ArenaGo_Staff_01_Home.png`
  - Topo com marca `ArenaGO` e pill `STAFF`.
  - Eyebrow `ÁREA OPERACIONAL`, título `Eventos Staff` e subtítulo orientativo.
  - Rótulo de seção `SEUS EVENTOS` com card estilizado escuro/borda roxa, ícone de calendário à esquerda, nome real do evento, badge de fase + situação operacional à direita do badge e chevron `›`.
  - Nota explicativa de autorização abaixo do card.
  - Botão de atualização e ação discreta `↪ Sair da conta` ancorada na região inferior.
- **Mockup Tela 2:** `ArenaGO_Staff_02_Painel_Operacional.png`
  - Topo único com `ArenaGO` e pill `STAFF`.
  - Linha de título `Painel operacional` à esquerda + badge da fase oficial à direita.
  - Seção `RESUMO DO EVENTO`: card principal com ícone de calendário, fase/situação e nome do evento (sem repetir o nome do evento em cabeçalhos adicionais), seguido de divisor e 3 colunas de indicadores reais (`Estações ativas`, `Em atendimento`, `Fila externa`).
  - Card destacado clicável `Controle de Entrada` com ícone, subtítulo refletindo chamada pendente / espera / fila inativa / indisponível / sem acesso, badge de estado (`FILA ATIVA`, `FILA INATIVA`, `CONSULTANDO`, `INDISPONÍVEL`, `SEM ACESSO`, além de `CHAMADA PENDENTE` quando houver chamada) e chevron `›`.
  - Seção `ESTAÇÕES DO EVENTO` com contagem real de estações à direita, agrupamentos por nome da experiência e cards clicáveis por estação mostrando rótulo, situação real de atendimento pendente (`pendingServiceSessionId`), badge semântico de disponibilidade (`DISPONÍVEL` / `INDISPONÍVEL` e `CHAMADO` quando aplicável) e chevron `›`.
- **Mockups Reservados para `STAFF-02` (não alterados aqui):** `ArenaGO_Staff_03_Estacao_Fila.png` e `ArenaGO_Staff_04_Atendimento.png`.

---

## 6. Plano Técnico de Alterações

1. Estender `app/services/staffEntryService.js` e `app/services/staffOperationsService.js` garantindo validação unificada de `GET /staff/events/:eventId/entry-control` (`parseEntryState` + `parseStaffEntrySummary`) alinhada integralmente ao backend.
2. Estender `app/services/staffDashboardService.js` com máquina explícita de autorização (`accessStatus`, `accessLocked`), recuperação automática e independente de polling GET (`pollEntryControl`, `pollStations`, `pollExperiences`), `refreshPanel()` e `revalidateOnReturn()`.
3. Integrar `app/screens/staff/StaffEntryControlRealScreen.js` com o estado de autorização do painel (`accessDenied`, `accessDeniedKind`, `onAccessDenied`) para propagação bidirecional de perda de acesso sem descartar intenções persistidas em `defaultStaffEntryIntentStorage`.
4. Reformular visualmente `StaffEventsScreen`, `StaffEventHomeScreen` e `StaffEventDashboard` em `app/screens/staff/StaffEventsNavigator.js`, mantendo todas as garantias de autorização, geração, foco, retorno unificado, recuperação controlada de experiências órfãs e preservação dos inventários de testes (`realStaffScreens` e whitelist de `roleRoutingIntegration.test.cjs`).
5. Expandir testes unitários, harness de UI sem `skip` e suíte de integração com React/React Navigation reais (`staffDashboard.test.cjs`, `staffEventDiscovery.test.cjs`, `roleRoutingIntegration.test.cjs`).

---

## 7. Decisões de Implementação e Adaptações em Relação aos Mockups

1. **Adaptação por dados reais vs elementos ilustrativos dos mockups:**

| Elemento no Mockup | Dado Real Disponível no Contrato Atual | Decisão Implementada |
|---|---|---|
| `ArenaGo_Staff_01_Home.png`: texto `"4 Estações"` no card da seleção | `GET /staff/events` retorna `{ id, name, status, effectivePhase }`, e `parseStaffEvents` projeta estritamente esses campos | Sem contagem fictícia de estações na lista de eventos; blocos condicionais na UI só renderizam metadados se presentes e preservados no objeto |
| `ArenaGO_Staff_02_Painel_Operacional.png`: data, horário e local (`05 de dez de 2026 • 14:00 – 20:00`, `UNDB – São Luís/MA`) | O contrato atual `/staff/events` não envia `startsAt`, `officialEndsAt` nem local (`parseStaffEvents` projeta somente `{ id, name, status, effectivePhase }`) | Card do resumo exibe exclusivamente fase, situação operacional e nome real do evento, sem simular datas ou locais |
| `ArenaGO_Staff_02_Painel_Operacional.png`: contadores `128 Participantes`, `3 Estações ativas`, `42 Na fila (total)` | `/stations` informa todas as estações (`availability` e `pendingServiceSessionId`) e `/entry-control` informa `waitingCount` e `pendingCall` da fila externa; não existe endpoint de contagem total de participantes dentro do evento ou soma global de todas as filas internas no painel | Os 3 indicadores exibem exclusivamente métricas reais e confiáveis obtidas dos contratos existentes: **Estações ativas** (`disponíveis/total`), **Em atendimento** (`pendingServiceSessionId !== null`) e **Fila externa** (`entry.waitingCount`). Quando uma leitura falha, está carregando ou o acesso está bloqueado, exibe `—` |
| `ArenaGO_Staff_02_Painel_Operacional.png`: `Sem atendimento pendente` + badge `FILA ATIVA` no Controle de Entrada | `/entry-control` retorna `externalQueueEnabled`, `canManage`, `observedAt`, `waitingCount`, `waiting`, `pendingCall` e flags (`canCall`, `canConfirm`, `canMarkAbsent`, `canRemove`) | O card diferencia explicitamente **chamada pendente** (`Chamada pendente` + nome do chamado), **aguardando na fila**, **sem atendimento pendente**, **fila inativa** (`FILA INATIVA`), **leitura indisponível** (`INDISPONÍVEL`) e **acesso negado** (`SEM ACESSO`) |

2. **Separação estrita dos três estados operacionais:**
   - **Fase efetiva do evento** (`effectivePhase`): exibida no badge do painel/lista usando `scheduled | open | not_ready | closing | closed` com cores próprias e `textTransform: 'uppercase'` para fidelidade visual sem alterar o texto contratual (`Aberto`, `Agendado`, `Não está pronto`, `Em encerramento`, `Encerrado`).
   - **Estado da fila externa** (`externalQueueEnabled` + `pendingCall`): exibido exclusivamente no card de **Controle de Entrada** e no indicador **Fila externa**.
   - **Disponibilidade e atendimento das estações** (`availability` + `pendingServiceSessionId`): exibidos exclusivamente nos cards individuais de estação e nos indicadores de estações.
3. **Preservação dos inventários e imports dos testes de integração:**
   - Ícones construídos exclusivamente com primitivos `<View>` e `<Text>` nativos do React Native (`CalendarIcon`, `EntryScannerIcon`, `GamepadIcon`), evitando dependências externas não presentes na whitelist do harness de testes e mantendo intacto o inventário `realStaffScreens` em `app/tests/staffDemoState.test.cjs`.
   - Mantidos os `accessibilityLabel` originais críticos para regressão (`Selecionar evento ${event.name}`, `Atualizar eventos`, `Sair da conta`, `Voltar aos eventos`, `Controle de Entrada`, `Selecionar estação ${item.label} da experiência ${experience.name}`, `Atualizar estações`, `Voltar ao painel`).
4. **Atualização do agrupamento para experiência única no Painel (`roleRoutingIntegration.test.cjs`):**
   - Na implementação histórica da A4, o painel ocultava o título do grupo quando havia uma única experiência. Conforme o requisito 7.5 da `STAFF-01` ("Cada agrupamento deverá permitir identificar: Nome da experiência") e a hierarquia do mockup `ArenaGO_Staff_02_Painel_Operacional.png`, o título da experiência passou a ser exibido em todos os agrupamentos, com atualização explícita da asserção correspondente em `app/tests/roleRoutingIntegration.test.cjs` linha 725.

---

## 8. Arquivos Efetivamente Modificados

| Arquivo | Tipo | Alterações Realizadas |
|---|---|---|
| `docs/STAFF_01_SELECAO_EVENTOS_PAINEL.md` | Novo / Atualizado | Documentação técnica completa da STAFF-01, incluindo entrega inicial, primeira revisão técnica e auditoria independente do Codex (`AUD-01`..`AUD-05`) |
| `app/services/staffEntryService.js` | Modificado | `parseEntryState` alinhado integralmente ao backend: fila externa desativada exige `pendingCall === null` e `waiting.length === 0`, derivação exata de `canCall`/`canConfirm` e igualdade `canMarkAbsent === canRemove` preservando a janela residual (`canManage: false`) |
| `app/services/staffOperationsService.js` | Modificado | `parseStaffEntrySummary` passou a delegar diretamente para `parseEntryState` de `./staffEntryService.js`, eliminando duplicação de invariantes e exigindo `observedAt` e todas as flags operacionais |
| `app/services/staffDashboardService.js` | Modificado | Máquina explícita de autorização (`accessStatus`, `accessLocked`), manutenção do bloqueio durante revalidação manual e após `500` posterior, tratamento de `403`/`404` antigo concorrente no mesmo contexto, `reportAccessDenied`, `refreshPanel()`, `revalidateOnReturn()` e `pollExperiences()` |
| `app/screens/staff/StaffEntryControlRealScreen.js` | Modificado | Propagação bidirecional de perda de autorização do evento (`accessDenied`, `accessDeniedKind`, `onAccessDenied`), limpeza de dados nominais/modais/callbacks e preservação integral de intenções persistidas no armazenamento seguro |
| `app/screens/staff/StaffEventsNavigator.js` | Modificado | Reformulação visual das telas, polling de 5s independente/auto-recuperável, retorno unificado para Controle de Entrada e Estações (botão interno, botão do sistema e gesto via `beforeRemove`), revalidação controlada para experiências desconhecidas sem loops infinitos e bloqueio consistente durante `accessLocked` |
| `app/tests/roleRoutingIntegration.test.cjs` | Modificado | Linha 725 atualizada para agrupamento de experiência única; harness real estendido com `setFocus`, `setAppState`, controle determinístico de timers, `isDisabled` e `metricValueFor`, além de suítes reais para `AUD-01`..`AUD-05` |
| `app/tests/staffDashboard.test.cjs` | Modificado | Cobertura completa de `AUD-01`..`AUD-04`: `parseStaffEntrySummary` estrito com janela residual, remoção de fixture impossível (`externalQueueEnabled: false` com `pendingCall`) e todos os cenários concorrentes de `AUD-02` |
| `app/tests/staffEventDiscovery.test.cjs` | Modificado | Reconciliador autossuficiente sem `skip`, asserções `metricValueFor` vinculadas aos rótulos e cobertura de recuperação de entrada, payload inválido, revalidação controlada de órfãs e persistência de bloqueio |
| `qa-evidence/STAFF-01-changes.diff` | Novo / Atualizado | Patch unificado acumulado gerado a partir do commit-base `ae2ba16b289daeff21fa09db7ca95613d6d79a6e` (excluindo `qa-evidence/*`) |

---

## 9. Contratos Utilizados e Limitações

- `GET /api/v1/staff/events` — Lista oficial autorizada projetada estritamente para `{ id, name, status, effectivePhase }` por `parseStaffEvents`.
- `GET /api/v1/staff/events/:eventId/experiences` — Experiências vinculadas ao evento (`{ eventId, experiences }`).
- `GET /api/v1/staff/events/:eventId/stations` — Estações, disponibilidade e `pendingServiceSessionId`.
- `GET /api/v1/staff/events/:eventId/entry-control` — Estado completo validado por `parseEntryState` / `parseStaffEntrySummary`: `eventId`, `externalQueueEnabled`, `canManage`, `observedAt`, `waitingCount`, `waiting`, `pendingCall`, `canCall`, `canConfirm`, `canMarkAbsent`, `canRemove` (observando cancelamento de `pendingCall`/`waiting` quando `externalQueueEnabled === false` e janela residual quando `canManage === false`).
- `GET /api/v1/staff/events/:eventId/experiences/:experienceId/queue` — Consulta compartilhada da experiência ao abrir uma estação.

**Limitações contratuais documentadas:**
- O backend atual não expõe data/horário, local ou contagem de estações em `/staff/events` (`parseStaffEvents` descarta atributos extras), tampouco totais globais de participantes ativos no evento ou soma agregada das filas internas no endpoint de painel; nenhum desses números foi simulado.
- As capturas visuais reais em dispositivo físico (Android e iOS via Expo Go) continuam dependentes de homologação presencial pelo responsável; suítes automatizadas (unitárias e React Navigation real em Node) não substituem a homologação em aparelho.

---

## 10. Testes Preparados, Comandos e Resultados Reais

**Inspeções estáticas executadas nesta etapa da auditoria:**
- `git diff --check app docs` e `git diff --check ae2ba16b289daeff21fa09db7ca95613d6d79a6e -- app docs`: verificação de higiene de patch e ausência de erros de espaçamento/EOF.

**Campanha de testes automatizados preparada (pendente de execução pelo executor autorizado GPT-6 Luna — Medium, conforme política permanente do `AGENTS.md`):**

```bash
cd app

node --test tests/staffEventDiscovery.test.cjs
node --test tests/staffDashboard.test.cjs
node --test tests/roleRoutingIntegration.test.cjs
node --test tests/staffDemoState.test.cjs
node --test tests/staffBackground.test.cjs
node --test tests/staffScreens.test.cjs
node --test tests/staffNavigation.test.cjs
node --test tests/staffPolling.test.cjs
node --test tests/staffRealNavigation.test.cjs
npm test
```

**Cobertura adicionada e atualizada (por camada):**
1. **`app/tests/roleRoutingIntegration.test.cjs` (React 19 + `react-test-renderer` + `@react-navigation/core` reais + `useStaffPolling.js` real):**
   - **AUD-01 + Invalidação:** propagação imediata entre painel e `StaffEntryControlRealScreen` (nos dois sentidos), ocultação imediata de nomes de `waiting`, fechamento e neutralização de callbacks de modais antigos, preservação de intenções `dispatching` em `SecureStore` e preservação da sessão de login.
   - **AUD-02:** manutenção de `disabled` em `Controle de Entrada` durante revalidação manual em curso, em corrida com `403` antigo e em falha `500` posterior; desbloqueio exclusivo após confirmação positiva `200`, verificação de indicadores via `metricValueFor` e troca limpa para segundo evento.
   - **AUD-04 + Ciclo de vida/Foco/AppState:** revalidação equivalente no retorno de Controle de Entrada e de Estação tanto pelo botão interno quanto por `app.back()` (`beforeRemove` nativo); pausa/retomada real em `setFocus(false/true)` e `setAppState('background'/'active')`; revalidação controlada (1 consulta `/experiences`) para experiência desconhecida sem loop infinito e habilitação da estação após confirmação.
2. **`app/tests/staffDashboard.test.cjs` (Testes unitários de serviço e store):**
   - Cobertura completa de `AUD-03` em `parseStaffEntrySummary` (campos obrigatórios `observedAt` e flags, rejeição de `!externalQueueEnabled` com `pendingCall`/`waiting`, e preservação explícita da janela residual com `canManage: false`).
   - Todos os 6 cenários de `AUD-02` + recuperação independente de `pollEntryControl()`/`pollStations()` + `reportAccessDenied()`.
3. **`app/tests/staffEventDiscovery.test.cjs` (Harness JSX local sem `skip` + métricas vinculadas aos rótulos):**
   - `STAFF-01 UI (10.1)`, `(10.2)` com `metricValueFor` e `(10.3)` cobrindo recuperação de `/entry-control`, rejeição de payload inválido, órfã controlada sem loop infinito e persistência de bloqueio após `403`/`500`/`404`. *(Escopo documental explícito: este arquivo usa harness próprio para rodar sem dependências externas, sendo complementado pelas suítes com React e React Navigation reais em `roleRoutingIntegration.test.cjs`.)*

*(Nota: Conforme `AGENTS.md`, nenhum teste automatizado foi executado durante esta etapa de implementação/correção; os resultados reais deverão ser registrados somente após execução comprovada com GPT-6 Luna — Medium.)*

---

## 11. Validações Manuais e Ambientes

- **Homologação física / Expo Go (Android e iOS):** Pendente de execução pelo responsável após validação automatizada da entrega corrigida.
- **Limitação explícita:** Nenhuma simulação automatizada equivale à homologação presencial em dispositivo real.

---

## 12. Problemas Identificados e Correções Realizadas

- **17/11/2026 — Entrega inicial (`8184e76f`):** Adaptação da UI à base `origin/develop` (`ae2ba16b`) com `effectivePhase`, `useStaffPolling`, `AuthBackground`, navegação direta `'panel' -> 'station'` e preservação dos seletores de integração.
- **17/11/2026 — Primeira revisão técnica (`fa5e8814`):** Correções iniciais de recuperação do Controle de Entrada, exigência de `pendingCall`, limpeza em `403`/`404`, remoção de `skip` em `staffEventDiscovery.test.cjs` e correção de fixture duplicada.
- **18/11/2026 — Auditoria Independente do Codex (sobre `fa5e8814`):**
  1. **`AUD-01` — Propagação da perda de autorização:** Diagnosticado que negação no painel em voo não atingia `StaffEntryControlRealScreen` já aberto, nem `403`/`404` dentro da subtela atualizava o painel imediatamente. **Correção:** `StaffEntryControlRealScreen` recebeu `accessDenied`, `accessDeniedKind` e `onAccessDenied`, ligados diretamente a `store.isAccessLocked()` e `store.reportAccessDenied(kind)` em `StaffEventsNavigator.js`; `accessDenied` limpa contexto em memória, fecha modais e invalida callbacks sem apagar recibos persistidos no `SecureStore`, enquanto falhas de estação/evento continuam diferenciadas de invalidação de sessão (`401`).
  2. **`AUD-02` — Preservação do bloqueio durante revalidação:** Diagnosticado que `refresh*` zerava erros antes da resposta HTTP (desbloqueando o card durante `'loading'` ou após `'500'`) e descartava `403`/`404` de GET anterior no mesmo contexto se outro GET houvesse iniciado. **Correção:** introduzidos `accessStatus` (`'unknown' | 'revalidating' | 'granted' | 'denied' | 'session'`) e `accessLocked` com barreira de revalidação e staging em `staffDashboardService.js`; respostas `403`/`404`/`401` do mesmo `context`/`revision` acionam `denied()` mesmo se superadas por geração de requisição em voo, e o desbloqueio só ocorre após confirmação positiva `200`.
  3. **`AUD-03` — Alinhamento do parser com o contrato real:** Diagnosticado que `parseStaffEntrySummary` duplicava lógica, aceitava ausência de `observedAt`/flags e admitia fixture com fila inativa e `pendingCall`. **Correção:** `parseStaffEntrySummary` passou a reutilizar `parseEntryState` em `./staffEntryService.js`; `parseEntryState` passou a validar ausência de `pendingCall`/`waiting` quando `!externalQueueEnabled` (alinhado ao trigger `0008_external_entry_calls.sql` e `setExternalQueueEnabledWithTx`) e as derivações exatas de `canCall`, `canConfirm`, `canMarkAbsent === canRemove`, preservando a janela residual com `canManage: false`. Fixtures inválidas foram corrigidas.
  4. **`AUD-04` — Atualização ao retornar e órfãs:** Diagnosticado que retorno pelo botão do Controle de Entrada só atualizava entrada e retornos por `Voltar do sistema` / `Estação` não revalidavam o painel; além disso, estações com `experienceId` ausente não disparavam consulta controlada de `/experiences`. **Correção:** criado `store.revalidateOnReturn()` acionado uniformemente na transição de `'entry'` ou `'station'` para `'panel'` (cobrindo botão interno, botão Voltar do sistema e gesto `beforeRemove`) preservando estado durante leitura em segundo plano; adicionado `pollExperiences()` com disparo único por assinatura `orphanSignature` para evitar loops infinitos mantendo cards não confirmados sem navegação.
  5. **`AUD-05` — Confiabilidade dos testes:** Adicionados cenários com React, `react-test-renderer`, `@react-navigation/core` e `useStaffPolling.js` reais em `roleRoutingIntegration.test.cjs` cobrindo retorno nativo, ciclo de vida, foco, segundo plano, concorrência de polling/manual, propagação e callbacks antigos, além de asserções `metricValueFor` vinculando cada número ao respectivo rótulo.

---

## 13. Pendências e Limitações

1. Execução da campanha de testes automatizados pendente com **GPT-6 Luna (Medium)** antes da aprovação formal da **STAFF-01**.
2. Staging, commit e push via VSCode pendentes pelo responsável na branch `feature/staff-operacional-v2` (conforme seção 6 do `AGENTS.md`).
3. Homologação física em Android e iOS (Expo Go / build local) pendente pelo responsável.
4. `STAFF-02`, `STAFF-04` e `STAFF-05` permanecem reservadas para suas respectivas entregas futuras.

---

## 14. Commits Associados

- **Commit-base (`origin/develop`):** `ae2ba16b289daeff21fa09db7ca95613d6d79a6e` (`docs: consolida panorama e arquiva planejamento antigo`)
- **Commit 1 publicado (`feature/staff-operacional-v2`):** `8184e76f` (`8184e76` — `Reformulação da Seleção de Eventos e Painel Operacional`)
- **Commit 2 publicado (`feature/staff-operacional-v2`):** `fa5e8814` (`fa5e881` — `correçoes da primeira revisao tecnica`, objeto da auditoria independente do Codex)
- **Correções da auditoria independente (`AUD-01`..`AUD-05`):** Preparadas no working tree da branch `feature/staff-operacional-v2`, aguardando validação com GPT-6 Luna — Medium e publicação pelo responsável via VSCode.

---

## 15. Estado Final da Entrega

Correções da **auditoria independente do Codex (`AUD-01` a `AUD-05`)** aplicadas na branch `feature/staff-operacional-v2`, com documentação e `qa-evidence/STAFF-01-changes.diff` atualizados. Aguardando validação automatizada pelo executor autorizado (**GPT-6 Luna — Medium**), publicação pelo responsável e nova revisão para aprovação formal da **STAFF-01**.
