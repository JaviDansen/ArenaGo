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
   - **R3-01 a R3-05 (Auditoria Rodada 3):**
     - `R3-05`: resolução normalizada de caminhos com extensão `.js` (`target.replace(/\.js$/, '')`) carregando `services/staffEntryService.js` real com `parseEntryState`; verificação segura de modais desmontados após revogação (`app.modals()`); separação explícita da leitura disparada na abertura de `Controle de Entrada` (`entry: +1`) em relação à revalidação disparada no retorno ao painel (`stations: +1, experiences: +1, entry: +1`).
     - `R3-01`: revalidação parcial (`200, 200, 500`) mantendo bloqueio de acesso sem deixar `stationStatus`/`experienceStatus`/`entryStatus` em `'loading'` e reabilitando `"Atualizar estações"`.
     - `R3-02`: negativa `403` em `GET A` concorrente com `GET B` manual (`500`) em `StaffEntryControlRealScreen`, propagando a perda de acesso ao painel.
     - `R3-03`: descarte de `404` tardio de fila operacional já abandonada ao retornar ao painel.
     - `R3-04`: recuperação automática de experiência desconhecida no ciclo de 5s após falha transitória de rede na primeira tentativa, mantendo a mesma `orphanSignature`.
2. **`app/tests/staffEntryControl.test.cjs` (Testes unitários da store do Controle de Entrada):**
   - **R3-02:** preservação de negativa `403`/`404` (`denied`) e `401` (`session`) de `GET A` quando um `refresh()` manual inicia `GET B` que falha com `500` (em ambas as ordens de chegada), com invalidação da geração de leitura em voo e descarte de erros de escopo antigo após troca de evento ou logout.
3. **`app/tests/staffDashboard.test.cjs` (Testes unitários de serviço e store do Painel):**
   - Cobertura completa de `AUD-03` em `parseStaffEntrySummary` (campos obrigatórios `observedAt` e flags, rejeição de `!externalQueueEnabled` com `pendingCall`/`waiting`, e preservação explícita da janela residual com `canManage: false`).
   - Todos os 6 cenários de `AUD-02` + recuperação independente de `pollEntryControl()`/`pollStations()` + `reportAccessDenied()`.
   - **R3-01:** revalidação após negativa com `200, 200, 500`, `500, 200, 200`, falha de rede após dois `200`, garantia de que nenhum domínio permanece em `'loading'`, duas ondas consecutivas de revalidação, recuperação completa com três `200`, troca de evento e logout durante tentativa.
   - **R3-03:** descarte de `404` tardio de fila após `clearQueue()` e após troca de estação/experiência; em fila ativa com `404`, bloqueio imediato apenas da fila e confirmação em `/stations` diferenciando experiência inexistente (`200` em `/stations`, preservando painel) de perda real de acesso ao evento (`403`/`404` em `/stations`, bloqueando todo o evento).
   - **R3-04:** experiência desconhecida surgindo com `GET /experiences` já em andamento, falha inicial de rede, recuperação posterior mantendo a mesma assinatura, experiência encontrada em consulta subsequente, experiência persistentemente inexistente sem loop infinito e troca de evento durante tentativa.
4. **`app/tests/staffEventDiscovery.test.cjs` (Harness JSX local sem `skip` + métricas vinculadas aos rótulos):**
   - `STAFF-01 UI (10.1)`, `(10.2)` com `metricValueFor` e `(10.3)` cobrindo recuperação de `/entry-control`, rejeição de payload inválido, órfã controlada com recuperação após falha de rede (`R3-04`) sem loop infinito, persistência de bloqueio após `403`/`500`/`404` e reabilitação do botão `"Atualizar estações"` após revalidação parcial (`R3-01`). *(Escopo documental explícito: todas as verificações automatizadas acima ocorrem em ambiente simulado Node.js e não substituem a homologação nativa em dispositivo físico / Expo Go.)*

*(Nota: Conforme `AGENTS.md`, nenhum teste automatizado foi executado durante esta etapa de implementação/correção; os resultados reais deverão ser registrados somente após execução comprovada com GPT-6 Luna — Medium.)*

---

## 11. Validações Manuais e Ambientes

- **Verificação automatizada em ambiente simulado:** Executada exclusivamente pelo modelo designado (**GPT-6 Luna — Medium**) sobre Node.js (`node --test` / `npm test`).
- **Homologação nativa em dispositivo físico / Expo Go (Android e iOS):** Pendente de execução manual pelo responsável após validação automatizada da entrega corrigida.
- **Limitação explícita:** Nenhuma simulação automatizada equivale à homologação presencial em dispositivo real.

---

## 12. Problemas Identificados e Correções Realizadas

- **17/11/2026 — Entrega inicial (`8184e76f`):** Adaptação da UI à base `origin/develop` (`ae2ba16b`) com `effectivePhase`, `useStaffPolling`, `AuthBackground`, navegação direta `'panel' -> 'station'` e preservação dos seletores de integração.
- **17/11/2026 — Primeira revisão técnica (`fa5e8814`):** Correções iniciais de recuperação do Controle de Entrada, exigência de `pendingCall`, limpeza em `403`/`404`, remoção de `skip` em `staffEventDiscovery.test.cjs` e correção de fixture duplicada.
- **18/11/2026 — Auditoria Independente do Codex — Rodada 2 (`3451de55` sobre `fa5e8814`):**
  1. **`AUD-01` — Propagação da perda de autorização:** `StaffEntryControlRealScreen` conectado a `store.isAccessLocked()` e `store.reportAccessDenied(kind)`.
  2. **`AUD-02` — Preservação do bloqueio durante revalidação:** Barreira de revalidação em `staffDashboardService.js` exigindo confirmação positiva antes de desbloquear o evento.
  3. **`AUD-03` — Alinhamento do parser com o contrato real:** Reutilização direta de `parseEntryState` em `parseStaffEntrySummary` com validação de invariantes do contrato real.
  4. **`AUD-04` — Atualização ao retornar e órfãs:** `store.revalidateOnReturn()` nas transições de subtela para painel e verificação controlada de experiências órfãs.
  5. **`AUD-05` — Confiabilidade dos testes:** Cobertura de integração real em `roleRoutingIntegration.test.cjs` e `metricValueFor`.
- **18/11/2026 — Auditoria Independente do Codex — Rodada 3 (sobre `3451de55`):**
  1. **`R3-01` — Painel bloqueado após revalidação parcial (`app/services/staffDashboardService.js`, `app/screens/staff/StaffEventsNavigator.js`):**
     - **Diagnóstico:** Quando `accessLocked === true` e uma rodada de revalidação (`refreshPanel()`) obtinha respostas parciais `200` combinadas com falha transitória (`500` ou erro de rede), `finishRevalidationSuccess` guardava `stationStatus: 'ready'` / `experienceStatus: 'ready'` apenas em `stagedPatch` (para não expor dados antes da confirmação completa). Ao encerrar a rodada com erro, `stagedPatch` era descartado sem retirar os domínios que já haviam respondido `200` do estado `'loading'`, deixando o botão `"Atualizar estações"` permanentemente desabilitado.
     - **Correção:** Adicionado controle de rodada (`revalidationRound`, `revalidationPending`, `revalidationOk`, `revalidationErrors`) com finalização atômica em `settleRevalidationRound()`. Se qualquer domínio falhar na rodada de revalidação, todos os domínios participantes saem de `'loading'` para `'error'` sem expor dados parciais e mantendo `accessLocked = true`, reabilitando `"Atualizar estações"` para novas tentativas.
  2. **`R3-02` — Negativa descartada por consulta concorrente (`app/services/staffEntryService.js`):**
     - **Diagnóstico:** Em `createStaffEntryStore`, `refresh()` incrementava `readGeneration`, fazendo `current()` (`request === readGeneration`) falhar para um `GET A` anterior. Se `GET A` retornasse `403`/`404` (`denied`) ou `401` (`session`) e o `GET B` mais recente falhasse com `500`, a negativa de autorização era descartada antes de classificar o erro e nunca chegava ao painel via `onAccessDenied`.
     - **Correção:** Introduzidos `sameScope()` (`generation === currentGeneration && isCurrent(context)`) e `revokedKind`. Nos blocos `catch` de `refresh()` e `poll()`, respostas `401`/`403`/`404` do mesmo escopo são tratadas antes do filtro `request === readGeneration`, registrando `revokedKind`, invalidando leituras concorrentes em voo (`readGeneration += 1`) e preservando o bloqueio mesmo se outro GET concorrente retornar `500`, enquanto respostas de eventos/sessões anteriores continuam descartadas.
  3. **`R3-03` — Negativa ambígua de fila operacional (`app/services/staffDashboardService.js`):**
     - **Diagnóstico:** Em `refreshQueue()` e `pollQueue()`, `if (kind === 'denied' || kind === 'session') return denied(kind)` executava antes de verificar `request === queueGeneration && state.experienceId === experienceId`, permitindo que um `404` tardio de fila já abandonada bloqueasse todo o evento. Além disso, no backend (`StaffQueriesService.getQueue`), `404` é retornado tanto quando o acesso ao evento é negado (`!access`) quanto quando a experiência não existe no evento (`!row`).
     - **Correção:** Respostas de filas abandonadas (`request !== queueGeneration || state.experienceId !== experienceId`) são descartadas antes de classificar `403`/`404`. Na fila ativa, `403` bloqueia o evento imediatamente, enquanto `404` bloqueia de imediato a fila (`queueStatus: 'error', queue: null, queueError: 'denied'`) e executa confirmação em recurso de escopo do evento (`verifyEventAccessFromQueue` via `fetchStaffStations`), bloqueando o evento inteiro somente se `/stations` confirmar `401`/`403`/`404`.
  4. **`R3-04` — Recuperação de experiências desconhecidas (`app/services/staffDashboardService.js`, `app/screens/staff/StaffEventsNavigator.js`):**
     - **Diagnóstico:** `orphanSyncRef.current = orphanSignature` era gravado antes de confirmar se `pollExperiences()` realmente iniciou ou concluiu com `200`, impedindo novas tentativas com a mesma assinatura se houvesse um GET já em voo ou falha transitória de rede/`500`. Também faltava polling de recuperação de 5s para `/experiences` em estado de erro recuperável ou `'stale'`.
     - **Correção:** Centralizado o controle de assinaturas órfãs na store (`computeOrphanSignature`, `orphanCheckedSignatures`, `recordOrphanVerification`, `syncOrphanExperiences`), marcando uma assinatura como verificada somente quando uma leitura iniciada sob aquela assinatura conclui com `200` válido, e adicionado `useStaffPolling` de 5s (`canPollExperiences`) em `StaffEventsNavigator.js` para recuperar `/experiences` após falhas transitórias sem gerar loop infinito quando a experiência realmente não existe.
  5. **`R3-05` — Correções da integração automatizada (`app/tests/roleRoutingIntegration.test.cjs`):**
     - **Diagnóstico:** (A) `staffOperationsService.js` importa `./staffEntryService.js` com extensão `.js`, mas o resolvedor do teste comparava `target` sem `.js`, caindo no stub genérico sem `parseEntryState`; (B) o teste chamava `app.modal()` após `accessDenied = true`, quando `StaffEntryControlRealScreen` desmonta o `<Modal>` da árvore; (C) o teste `AUD-04 + AUD-05` não separava o `GET /entry-control` disparado ao abrir `Controle de Entrada` dos 3 GETs disparados ao retornar ao painel.
     - **Correção:** Normalizado `target` removendo sufixo `.js` no resolvedor de `roleRoutingIntegration.test.cjs`, adicionado `app.modals()` para validar ausência de modal visível/montado após revogação e separadas as asserções de contagem de GETs na abertura da subtela e no retorno ao painel.

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
- **Commit 2 publicado (`feature/staff-operacional-v2`):** `fa5e8814` (`fa5e881` — `correçoes da primeira revisao tecnica`)
- **Commit 3 publicado (`feature/staff-operacional-v2`):** `3451de55` (`3451de55eac301ff1f519b2296ed674b1ad19765` — `correçoes da auditoria do codex`, objeto da Auditoria Rodada 3)
- **Correções da Auditoria Rodada 3 (`R3-01`..`R3-05`):** Aplicadas no working tree da branch `feature/staff-operacional-v2`, aguardando validação com GPT-6 Luna — Medium e publicação pelo responsável via VSCode.

---

## 15. Estado Final da Entrega

Correções da **Auditoria Independente Rodada 3 (`R3-01` a `R3-05`)** aplicadas na branch `feature/staff-operacional-v2`, com documentação e `qa-evidence/STAFF-01-changes.diff` atualizados. Aguardando validação automatizada pelo executor autorizado (**GPT-6 Luna — Medium**), publicação pelo responsável e aprovação formal da **STAFF-01**.
