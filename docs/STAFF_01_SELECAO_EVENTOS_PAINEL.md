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
  - Seção `RESUMO DO EVENTO`: card principal com ícone de calendário, fase/situação e nome do evento (sem repetir o nome do evento em cabeçalhos adicionais), seguido de divisor e 3 colunas de indicadores reais (`Estações ativas`, `Em atendimento`, `Fila de entrada`).
  - Card destacado clicável `Controle de Entrada` com ícone, subtítulo refletindo chamada pendente / espera / fila inativa / indisponível, badge de estado da fila externa (`FILA ATIVA`, `FILA INATIVA`, `CHAMADA PENDENTE`, `INDISPONÍVEL`) e chevron `›`.
  - Seção `ESTAÇÕES DO EVENTO` com contagem real de estações à direita, agrupamentos por nome da experiência e cards clicáveis por estação mostrando rótulo, situação real de atendimento pendente (`pendingServiceSessionId`), badge semântico de disponibilidade (`DISPONÍVEL` / `INDISPONÍVEL`) e chevron `›`.
- **Mockups Reservados para `STAFF-02` (não alterados aqui):** `ArenaGO_Staff_03_Estacao_Fila.png` e `ArenaGO_Staff_04_Atendimento.png`.

---

## 6. Plano Técnico de Alterações

1. Estender `app/services/staffOperationsService.js` com `parseStaffEntrySummary` e `fetchStaffEntrySummary` para leitura autenticada e validada de `GET /staff/events/:eventId/entry-control` no painel.
2. Estender `app/services/staffDashboardService.js` com estado (`entryStatus`, `entry`, `entryError`) e ações `refreshEntryControl()` e `pollEntryControl()`, isolando falhas parciais de `/entry-control` (exceto `401 session`) para não apagar estações e experiências já carregadas.
3. Reformular visualmente `StaffEventsScreen`, `StaffEventHomeScreen` e `StaffEventDashboard` em `app/screens/staff/StaffEventsNavigator.js`, mantendo todas as garantias de autorização, geração, foco, polling, acessibilidade e ausência de arquivos extras que violem `realStaffScreens` em `app/tests/staffDemoState.test.cjs` ou a whitelist de `app/tests/roleRoutingIntegration.test.cjs`.
4. Atualizar a asserção de título da experiência única no Painel em `app/tests/roleRoutingIntegration.test.cjs` conforme o requisito 7.5 da `STAFF-01` ("Cada agrupamento deverá permitir identificar: Nome da experiência") e expandir os testes em `app/tests/staffDashboard.test.cjs` e `app/tests/staffEventDiscovery.test.cjs`.

---

## 7. Decisões de Implementação e Adaptações em Relação aos Mockups

1. **Adaptação por dados reais vs elementos ilustrativos dos mockups:**

| Elemento no Mockup | Dado Real Disponível no Contrato Atual | Decisão Implementada |
|---|---|---|
| `ArenaGo_Staff_01_Home.png`: texto `"4 Estações"` no card da seleção | `GET /staff/events` retorna `{ id, name, status, effectivePhase }`, sem contagem de estações | A linha complementar de estações só é renderizada se o campo opcional existir no objeto `event`; caso contrário, é omitida sem exibir valor fictício |
| `ArenaGO_Staff_02_Painel_Operacional.png`: data, horário e local (`05 de dez de 2026 • 14:00 – 20:00`, `UNDB – São Luís/MA`) | O contrato atual `/staff/events` não envia `startsAt`, `officialEndsAt` nem local | Período e local são exibidos apenas se campos opcionais existirem; quando ausentes, o card exibe exclusivamente fase, situação operacional e nome real do evento |
| `ArenaGO_Staff_02_Painel_Operacional.png`: contadores `128 Participantes`, `3 Estações ativas`, `42 Na fila (total)` | `/stations` informa todas as estações (`availability` e `pendingServiceSessionId`) e `/entry-control` informa `waitingCount` e `pendingCall` da fila externa; não existe endpoint de contagem total de participantes dentro do evento ou soma global de todas as filas internas no painel | Os 3 indicadores exibem exclusivamente métricas reais e confiáveis obtidas dos contratos existentes: **Estações ativas** (`disponíveis/total`), **Em atendimento** (`pendingServiceSessionId !== null`) e **Fila externa** (`entry.waitingCount`). Quando uma leitura falha ou está carregando, exibe `—` |
| `ArenaGO_Staff_02_Painel_Operacional.png`: `Sem atendimento pendente` + badge `FILA ATIVA` no Controle de Entrada | `/entry-control` retorna `externalQueueEnabled`, `waitingCount` e `pendingCall` (`null` ou objeto da chamada pendente) | O card diferencia explicitamente **chamada pendente** (`Chamada pendente` + nome do chamado), **aguardando na fila**, **sem atendimento pendente**, **fila inativa** (`FILA INATIVA`) e **leitura indisponível** (`INDISPONÍVEL`) |

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
| `docs/STAFF_01_SELECAO_EVENTOS_PAINEL.md` | Novo | Documentação técnica completa do ciclo STAFF-01 (diagnóstico, contratos, decisões, adaptações e testes) |
| `app/services/staffOperationsService.js` | Modificado | Adicionados `parseStaffEntrySummary` e `fetchStaffEntrySummary` para resumo real do Controle de Entrada com `pendingCall` |
| `app/services/staffDashboardService.js` | Modificado | Adicionados estados `entryStatus`, `entry`, `entryError`, além de `refreshEntryControl()` e `pollEntryControl()` com isolamento de falha parcial |
| `app/screens/staff/StaffEventsNavigator.js` | Modificado | Reformulação visual de `StaffEventsScreen` (`ArenaGo_Staff_01_Home.png`) e `StaffEventHomeScreen`/`StaffEventDashboard` (`ArenaGO_Staff_02_Painel_Operacional.png`), integração de polling 5s/60s, badges semânticos e preservação das subtelas |
| `app/tests/roleRoutingIntegration.test.cjs` | Modificado | Atualização da asserção de experiência única na linha 725 para refletir identificação obrigatória do grupo no painel |
| `app/tests/staffDashboard.test.cjs` | Modificado | Testes unitários de `parseStaffEntrySummary`, `refreshEntryControl()`, `pollEntryControl()`, isolamento de falhas parciais e descarte por geração/troca de evento |
| `app/tests/staffEventDiscovery.test.cjs` | Modificado | Suíte integrada de UI (`STAFF-01 UI 10.1` e `10.2`) cobrindo Seleção de Eventos, Painel Operacional, Controle de Entrada, agrupamento, falhas e navegação |
| `qa-evidence/STAFF-01-changes.diff` | Novo | Patch unificado gerado a partir do commit-base `ae2ba16b289daeff21fa09db7ca95613d6d79a6e` (excluindo `qa-evidence/*`) |

---

## 9. Contratos Utilizados e Limitações

- `GET /api/v1/staff/events` — Lista oficial autorizada (`id`, `name`, `status`, `effectivePhase`).
- `GET /api/v1/staff/events/:eventId/experiences` — Experiências vinculadas ao evento.
- `GET /api/v1/staff/events/:eventId/stations` — Estações, disponibilidade e `pendingServiceSessionId`.
- `GET /api/v1/staff/events/:eventId/entry-control` — Fila externa habilitada/desativada, fila nominal e `pendingCall`.
- `GET /api/v1/staff/events/:eventId/experiences/:experienceId/queue` — Consulta compartilhada da experiência ao abrir uma estação.

**Limitações contratuais documentadas:**
- O backend atual não expõe data/horário, local ou contagem de estações em `/staff/events`, tampouco totais globais de participantes ativos dentro do evento ou soma agregada das filas internas no endpoint de painel; nenhum desses números foi simulado ou extrapolado.

---

## 10. Testes Preparados, Comandos e Resultados Reais

**Inspeções estáticas executadas durante a implementação:**
- `git diff --check app docs`: executado para verificação de higiene de patch e ausência de erros sintáticos/espaços residuais.

**Testes preparados (pendentes de execução automatizada com GPT-6 Luna — Medium, conforme política permanente do `AGENTS.md`):**

```bash
cmd.exe /c "cd app && node --test tests/staffEventDiscovery.test.cjs"
cmd.exe /c "cd app && node --test tests/staffDashboard.test.cjs"
cmd.exe /c "cd app && node --test tests/roleRoutingIntegration.test.cjs"
cmd.exe /c "cd app && node --test tests/staffDemoState.test.cjs"
cmd.exe /c "cd app && node --test tests/staffScreens.test.cjs"
cmd.exe /c "cd app && node --test tests/staffNavigation.test.cjs"
cmd.exe /c "cd app && npm test"
```

**Cobertura adicionada e atualizada:**
1. **`app/tests/staffDashboard.test.cjs`:** validação estrita de `parseStaffEntrySummary` (com e sem `pendingCall`), leitura e polling de `entry-control`, preservação das estações e experiências durante falha 500/rede parcial em `/entry-control`, invalidação global em 401 e descarte de resposta obsoleta em troca de evento.
2. **`app/tests/staffEventDiscovery.test.cjs`:**
   - **Seleção de Eventos (10.1):** renderização com marca `ArenaGO` e pill `STAFF`, carregamento, distinção erro de rede vs lista vazia, fases reais (`open`, `not_ready`), descarte de resposta atrasada em troca de conta, polling de 60s e logout no rodapé.
   - **Painel Operacional (10.2):** título único do evento sem repetição, exibição das métricas reais (`2/3`, `1`, `2`) sem valores de mockup (`128`, `05 de dez`), Controle de Entrada diferenciando `Chamada pendente` e `FILA ATIVA`/`FILA INATIVA`/`INDISPONÍVEL`, agrupamento por experiência (incluindo experiência vazia), disponibilidade e chamado por estação, falha parcial isolada em `/entry-control`, navegação para Controle de Entrada e Estação correta, e limpeza completa ao trocar de evento.
3. **`app/tests/roleRoutingIntegration.test.cjs`:** atualizado teste de regressão para confirmar exibição do nome da experiência no painel mantendo todas as verificações de 401, 403, troca de evento, entrada e estação.

*(Nota: Nenhum teste unitário/integrado automatizado foi executado durante esta etapa de implementação; os resultados efetivos devem ser preenchidos somente após execução autorizada por GPT-6 Luna — Medium.)*

---

## 11. Validações Manuais e Ambientes

- **Homologação física / Expo Go (Android e iOS):** Pendente de execução pelo responsável após validação automatizada da entrega.
- **Comparação visual esperada:** Confirmar legibilidade em telas compactas, scroll suave, contraste do tema escuro/roxo e fidelidade estrutural com `ArenaGo_Staff_01_Home.png` e `ArenaGO_Staff_02_Painel_Operacional.png`.

---

## 12. Problemas Identificados e Correções Realizadas

- **17/11/2026 — Divergências entre referência inicial e `origin/develop` (`ae2ba16b`):** A base real trouxe `effectivePhase` (5 estados incluindo `not_ready`), `useStaffPolling`, `AuthBackground`, remoção da seção intermediária `'stations'` (Task A4) e `pendingCall` no Controle de Entrada. A implementação adaptou a reformulação exatamente para essa base, preservando integralmente o polling B1 e os seletores da integração.
- **17/11/2026 — Compatibilidade visual vs `hasText` em maiúsculas:** Badges usam `textTransform: 'uppercase'` no estilo para corresponder aos mockups mantendo as strings contratuais em caixa mista para os assertions existentes (`Agendado`, `Aberto`, `Não está pronto`, `Em encerramento`, `Encerrado`).

---

## 13. Pendências e Limitações

1. Execução da suíte de testes automatizados pendente com **GPT-6 Luna (Medium)** antes da aprovação.
2. Homologação visual e tátil em dispositivo real (Android e iOS) pendente pelo responsável.
3. Reformulações internas das telas de Estação (`STAFF-02`) e Controle de Entrada (`STAFF-04`) e refinamento de reconexão (`STAFF-05`) continuam reservadas para suas respectivas tasks.
4. Campos opcionais (`stationCount` em `/staff/events`, `periodLabel`, `location`, participantes totais e filas internas somadas no resumo) permanecem omitidos até eventual evolução futura da API aprovada pelo responsável.

---

## 14. Commits Associados

- **Commit-base (`origin/develop`):** `ae2ba16b289daeff21fa09db7ca95613d6d79a6e`
- **Publicação Git (`feature/staff-operacional-v2`):** Conforme seção 6 do `AGENTS.md`, staging, commit e push permanecem sob responsabilidade do usuário via VSCode após revisão.

---

## 15. Estado Final da Entrega

Implementação e preparação de testes da **STAFF-01** concluídas na branch `feature/staff-operacional-v2` (working tree pronto para validação com GPT-6 Luna — Medium e posterior commit/push pelo responsável).
