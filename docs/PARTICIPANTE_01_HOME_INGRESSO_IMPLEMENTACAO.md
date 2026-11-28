# PARTICIPANTE-01 — Home e jornada de ingresso

**Task:** PARTICIPANTE-01 de 05 — Reformulação da Home e jornada de ingresso
**Responsável pela implementação:** Heliom
**Módulo:** Participante (frontend Expo)
**Branch:** `feature/heliom-participante-ux`
**Origem:** `origin/develop` em `5758fe1dcda104f6bfacf3ddb922a3711b088298` (19/11/2026, "style(admin): atualizar logo exclusiva do cabecalho")
**Estado atual:** Revisão 02 entregue para revalidação (não aprovada). Ver §11 (R02) e §10 (R01, histórico).

## 1. Objetivo e escopo

Reformular a Home do Participante (conta sem histórico e conta com histórico) e a apresentação do evento encontrado/confirmação de ingresso, mantendo os contratos reais do backend. Não faz parte desta task: Minha Arena, Perfil, edição de avaliação, push, polling operacional, regras Staff/Admin, backend, schema ou migrations.

## 2. Diagnóstico inicial (develop `5758fe1`)

### 2.1 Home

- `app/screens/home/HomeFlowScreen.js` escolhe a tela pela participação corrente (`ParticipationContext`): carregando/erro → `HomeScreen` em modo de estado; participação `waiting`/`active` do servidor → fila externa ou `RealArenaScreen`; sem participação → `HomeScreen`. Também faz a apresentação automática da avaliação após encerramento (C-04/D09) com `canPresentReturnEvaluation`/`claimReturnEvaluation`.
- `app/screens/home/HomeScreen.js` já tem saudação pelo primeiro nome de `auth.user.name`, o card "ACESSO À ARENA / Pronto para jogar? / Entrar em um evento", aviso de questionário pendente, aviso de finalização recente e aviso de avaliações pendentes (apenas contagem, levando à aba Eventos).
- A Home **não consulta o histórico**: sempre exibe "Nenhuma participação ativa no momento", tanto para contas novas como para contas com histórico. Não existe minitutorial nem card de evento recente.

### 2.2 Ingresso

- `EventEntryScreen.js`: digitação do código e leitura de QR (`expo-camera`), ambos chamam `lookupEvent` e navegam para `EventConfirmation` com `{ event, eligibility }`.
- `EventConfirmationScreen.js`: mostra fuso, início, término e prazo como **texto ISO cru** e os bloqueios como **códigos técnicos** (`EVENT_NOT_STARTED, ...`). A confirmação usa `confirmEventEntry` (chave idempotente persistida por intenção) e `retryEntrySync`.
- `services/eventAdmissionService.js`: lookup, POST idempotente, estados `looking_up/ready/joining/confirmed_unsynced/uncertain/complete/error` e mensagens em português por status/código (`describeAdmissionError`).

### 2.3 Componentes e serviços reutilizados

`AuthContext` (`useAuth`: `user`, `isAuthenticated`, `getSessionEpoch`, `isIdentityVerified`, `httpClient`), `ParticipationContext`, `participationHistoryService` (`fetchParticipationHistory`, `fetchPendingEvaluationHistoryItem`), `components/ui` (`AuthBackground`, `Card`, `Badge`, `Button`, `ScreenHeader`), tema (`colors`, `spacing`, `typography`, `radii`).

## 3. Contratos de API utilizados (verificados no código do backend)

| Rota | Uso | Campos relevantes |
|---|---|---|
| `GET /participations/current` | Participação corrente (já usada pelo provider) | `participation: null \| { id, eventId, status, externalQueue }` |
| `GET /participations/return-state` | Retorno após encerramento e pendências | `recentFinalization`, `pendingEvaluationParticipationIds` |
| `GET /participations/history?limit&cursor` | Histórico da conta, mais recente primeiro (cursor por `joinedAt`, `id`) | `participationId`, `event: { id, name }`, `status`, `joinedAt`, `arenaEnteredAt`, `finishedAt`, `completedServicesCount`, `evaluation: { eligible, submitted, pending }` |
| `GET /participations/:id/evaluation-eligibility` | Confirmação da pendência antes de oferecer avaliação | `eligible`, `submitted`, `pending` |
| `POST /events/lookup` | Evento encontrado | `event: { id, name, timezone, startsAt, officialEndsAt, operationalDeadlineAt, externalQueueEnabled }`, `eligibility: { eligible, blockingReasons[] }` |
| `POST /participations` (Idempotency-Key) | Ingresso | `{ participationId }` |

**Limite do contrato:** o histórico entrega somente `id` e `name` do evento. Não há data/fuso/local do evento nem rota GET de evento para o Participante (Panorama §3.9). Por isso o card "Evento recente" usa a data/hora da própria participação e **omite o local**. Incluir fuso/local no histórico seria mudança de contrato compartilhado e fica registrada como decisão pendente, não implementada.

## 4. Estratégia técnica

1. **Visão geral da Home em hook próprio** (`useHomeOverview`): lê a primeira página do histórico (`limit` pequeno) e, quando o servidor indicar exatamente uma pendência, confirma-a com `fetchPendingEvaluationHistoryItem`. Isolamento por `userId` + época da sessão + `httpClient`, com geração para descartar respostas antigas; recarrega ao focar a aba e quando o provider publica um novo `returnStateVersion` (retorno ao primeiro plano já dispara esse refresh). Sem novo polling.
2. **Estados da Home**: `loading` (sem estado vazio prematuro), `error` (aviso com "Tentar novamente", sem tutorial nem vazio), `empty` (minitutorial + "Você ainda não participou de nenhum evento."), `history` (Evento recente + "Ver todos" → aba Eventos).
3. **Avaliação pendente**: uma pendência confirmada → card que abre `RealEvaluation` com a participação correta; várias pendências → card com a contagem que leva à aba Eventos (política existente). A apresentação automática C-04 do `HomeFlowScreen` não é alterada.
4. **Evento recente**: abre `ParticipationDetails` com `participationId` e o item do histórico (identifica a participação, não só o evento). Status apresentado conforme a semântica real (`waiting`, `active`, `finished`, `canceled`).
5. **Confirmação de ingresso**: datas formatadas em pt-BR no fuso IANA do evento (com `Intl`, sem usar o fuso do aparelho), tratamento de eventos que atravessam a meia-noite, motivos de bloqueio traduzidos a partir dos códigos estruturados, mesmo fluxo de confirmação/idempotência.

## 5. Arquivos previstos

- `app/screens/home/HomeScreen.js` (layout), `app/screens/home/HomeFlowScreen.js` (repasse dos dados), novo `app/screens/home/useHomeOverview.js` e `app/utils/homeOverview.js` (regras puras).
- `app/screens/event-entry/EventConfirmationScreen.js`, novo `app/utils/eventTime.js` (formatação por fuso).
- Testes novos/adaptados em `app/tests/`.

## 6. Riscos de regressão conhecidos

- Testes de `HomeFlow`/`homeReturnEvaluation` dependem da estrutura de `HomeScreen`.
- Apresentação automática de avaliação (C-04) e fila externa não podem mudar.
- Respostas atrasadas do histórico após logout/troca de conta.
- Formatação de fuso no Hermes: `Intl.DateTimeFormat` com `timeZone` precisa de fallback seguro (UTC explícito, nunca o fuso do aparelho).

## 7. Referências visuais

As imagens `ArenaGO_01_Home_Inicial_Padronizada(3).png` e `ArenaGO_03_Home_Apos_Evento_Padronizada(3).png` não estavam disponíveis no computador de implementação no início da task. A implementação segue a descrição textual da task; a comparação visual com os mockups fica pendente até as imagens serem anexadas.

## 8. Linha de base de testes

`npm test` em `app/` na base `5758fe1` antes de qualquer alteração: **899 aprovados, 0 falhas, 0 ignorados** (node --test, Windows, Node 24).

---

## 9. Entrega (23/11/2026)

### 9.1 Funcionalidades implementadas

**Home**

- Saudação "Olá, [primeiro nome]!" a partir de `auth.user.name`, limitada a 2 linhas; sem nome, "Olá!".
- Card "ACESSO À ARENA / Pronto para jogar? / Entrar em um evento" mantido e ligado ao fluxo real `EventEntry`.
- **Conta sem histórico** (histórico confirmado vazio pelo servidor): seção "Como funciona?" com os 3 passos e o estado vazio "Você ainda não participou de nenhum evento.".
- **Conta com histórico:** seção "Evento recente" com nome do evento, data, horário e situação real da participação (Aguardando entrada / Em andamento / Encerrada / Cancelada), indicador de navegação e "Ver todos" para a aba **Eventos**. O card abre `ParticipationDetails` com o `participationId` e o item do histórico.
- **Avaliação pendente:** card abaixo do card de ingresso. Uma pendência confirmada abre `RealEvaluation` da participação pendente (que pode não ser a mais recente; o texto se adapta). Várias pendências mostram a contagem e levam à aba Eventos, que era a política existente.
- **Carregando / falha:** cartão de carregamento ou de "histórico indisponível" com "Tentar novamente". Nenhum desses estados mostra o estado vazio nem o tutorial.
- Avisos já existentes preservados: questionário pendente e participação encerrada recentemente.

**Ingresso (evento encontrado)**

- Nome do evento em destaque e situação derivada só da elegibilidade do servidor: Entradas abertas / Ainda não iniciado / Entradas encerradas / Em preparação / Entrada indisponível.
- Horários em pt-BR **no fuso IANA do evento**: data, início, "Entradas até" (horário oficial) e "Encerramento final" (prazo operacional). Quando um horário cai em outro dia, a data completa aparece, cobrindo eventos que atravessam a meia-noite. O fuso aparece descrito ("Horário de Brasília (America/Sao_Paulo)").
- Explicação da fila externa conforme `externalQueueEnabled`.
- Motivos de bloqueio em português a partir dos códigos estruturados, sem exibir os códigos. Para `PROFILE_INCOMPLETE` há o botão "Completar questionário"; para `PARTICIPATION_ALREADY_CURRENT`, o botão "Voltar ao início", que recarrega a participação corrente e volta às abas sem criar outra.
- Resultado incerto (`uncertain`): o botão passa a "Verificar ingresso" e chama o mesmo `confirmEventEntry`, que reutiliza a intenção e a `Idempotency-Key` salvas. Não há nova intenção.

### 9.2 Arquivos

| Arquivo | Tipo | Conteúdo |
|---|---|---|
| `app/screens/home/HomeScreen.js` | modificado | Novo layout e estados (tutorial, vazio, recente, pendência, carregando/erro) |
| `app/screens/home/HomeFlowScreen.js` | modificado | Usa `useHomeOverview` e repassa `overview`; `visibleReturnState` calculado antes dos retornos (mesma expressão) |
| `app/screens/home/useHomeOverview.js` | novo | Leitura da Home isolada por conta/sessão, com descarte de respostas antigas |
| `app/utils/homeOverview.js` | novo | Regras puras: carga, pendência, descrição do evento recente |
| `app/utils/eventTime.js` | novo | Formatação pt-BR por fuso IANA e horários do evento |
| `app/utils/eventEntryPresentation.js` | novo | Textos de bloqueio, situação do evento e fila externa |
| `app/screens/event-entry/EventConfirmationScreen.js` | modificado | Nova apresentação do evento encontrado |
| `app/tests/participante01Home.test.cjs` | novo | 20 testes (regras, telas e hook) |
| `app/tests/eventEntry.test.cjs` | modificado | +6 testes da confirmação; 1 teste adaptado (ver 9.4) |
| `app/tests/homeFlow.test.cjs`, `homeReturnEvaluation.test.cjs`, `autoQueueSync.test.cjs` | modificados | Stub de `./useHomeOverview` nos harnesses que simulam os hooks (5 linhas) |
| `app/tests/adminNavigation.test.cjs` | modificado | Checagem do card antigo trocada pelos novos `testID` (ver 9.4) |

Nenhuma alteração em backend, contratos, serviços de sessão/participação/ingresso, navegação de papéis, schema ou migrations.

### 9.3 Decisões técnicas

- **Primeira página do histórico com `limit=1`:** a ordenação do backend (`joinedAt` desc, `id`) já define o registro mais recente; basta saber se existe e qual é.
- **Pendência confirmada antes de aparecer:** `return-state` indica os IDs, e `fetchPendingEvaluationHistoryItem` (já existente) confere elegibilidade e histórico. Se essa confirmação falhar, o card não aparece e o histórico continua visível.
- **Sem novo polling:** a Home relê ao focar a aba e quando o provider publica um novo `returnStateVersion` (login, retorno ao primeiro plano, refresh). O polling de posição não muda essa versão.
- **Fuso:** `Intl.DateTimeFormat` com `timeZone`. Se o fuso informado não for reconhecido, a data aparece em UTC explícito, nunca no fuso do aparelho. O app não usa o relógio local para liberar ou bloquear o ingresso.
- **Evento recente sem fuso do evento:** o histórico não traz fuso. A data e a hora da participação (`arenaEnteredAt` ou `joinedAt`) aparecem no fuso do aparelho, como já faz a tela de detalhes.
- **Badge "ONLINE" removido do cabeçalho da Home:** era fixo e não refletia nenhum estado real.
- **Fallback da saudação:** "Bem-vindo ao ArenaGo!" passou a "Olá!", em linha com o novo cabeçalho.

### 9.4 Testes adaptados (sem remover proteção)

- `eventEntry.test.cjs` › "ineligibilidade mostra motivo real e impede POST": antes exigia o texto `PROFILE_INCOMPLETE` na tela. A task proíbe exibir códigos técnicos, então agora exige a mensagem em português **e** a ausência do código. A garantia de não haver POST foi mantida.
- `adminNavigation.test.cjs` › "Início permite entrada em evento...": exigia o `testID` do card antigo "sem participação ativa", que a task substitui. Agora renderiza a Home sem histórico e exige `home-first-access` e `home-empty-history`. As demais garantias (sem atalhos Admin/Staff, botão de ingresso) foram mantidas.
- Harnesses de `HomeFlowScreen`: simulam `./useHomeOverview` como já simulavam `./HomeScreen` e os serviços.

### 9.5 Testes executados

Ambiente: Windows 10, Node 24.19.0, `app/` com `node_modules` do lockfile da develop.

| Comando | Resultado |
|---|---|
| `npm test` (base `5758fe1`, antes) | 899/899, 0 falhas, 0 ignorados |
| `npm test` (entrega) | **925/925**, 0 falhas, 0 cancelados, 0 ignorados |
| `node --test tests/participante01Home.test.cjs` | 20/20 |
| `node --test tests/eventEntry.test.cjs` | 30/30 |
| `npx expo export --platform ios` | exit 0, bytecode Hermes gerado (`.hbc` 2,9 MB) |
| `npx expo export --platform android` | exit 0, bytecode Hermes gerado (`.hbc` 2,9 MB) |
| `git diff --check` | sem problemas |

Observação de ambiente: `expo export --platform ios --platform android` na **mesma** chamada fez o `hermesc.exe` encerrar com exceção nativa (exit 3765269347). O mesmo bundle compilou com `hermesc` direto (exit 0), e cada plataforma isolada exportou normalmente. Não foi tratado como defeito do código.

**Cobertura da matriz 11.1 por testes automatizados:** P01-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12 (sem identidade verificada não há leitura), 13 (leitura desabilitada com participação corrente; seleção de tela coberta pelos testes de HomeFlow existentes), 14, 15, 16, 17, 18, 19, 20, 21 (tela; a reutilização da chave é coberta por `eventAdmissionService.test`), 22 e 23 (limites de linhas e nomes longos).

### 9.6 Não executado / pendências de validação

- **P01-24 (Android e iOS físicos):** não executado nesta entrega. Os testes usam componentes simulados e não substituem a homologação no aparelho: rolagem, área segura, fonte ampliada, teclado e comportamento de `Intl` com `timeZone` no Hermes do aparelho.
- **Comparação com os mockups:** as imagens 01 e 03 não estavam no computador de implementação. A comparação visual e eventuais ajustes finos (espaçamentos, ícones) ficam pendentes até o envio das imagens. Os textos seguem literalmente a task.
- **Ícones:** emojis (📷 🎮 ⭐ 📅 🕒), porque o app não tem biblioteca de ícones instalada e adicionar uma dependência estaria fora do escopo.
- **Lint/typecheck:** o `app/package.json` não tem scripts de lint ou typecheck; nada foi executado nesse sentido.

### 9.7 Limitações e decisões pendentes (não implementadas)

- **Local e fuso no histórico:** o contrato `GET /participations/history` traz só `event.id` e `event.name`. Exibir local e horário no fuso do evento na Home exige acrescentar campos ao histórico (contrato compartilhado, backend). Fica aguardando decisão do responsável.
- **Várias avaliações pendentes:** mantida a política existente (contagem → aba Eventos). Abrir diretamente uma delas exigiria definir um critério de escolha.

### 9.8 Git

- Branch: `feature/heliom-participante-ux` (criada de `origin/develop` `5758fe1dcda104f6bfacf3ddb922a3711b088298`).
- Commit de implementação: `b27c5f547c08ae3eaa73edc0d3994ffc7d7ab75a` — código, testes, este documento e `qa-evidence/PARTICIPANTE_01-changes.diff` (diff da implementação contra a base, verificado com `git apply --check`).
- Commit seguinte: somente este registro de Git no documento.
- Sem merge na `develop`, sem force push. Task 02 não iniciada.

---

## 10. Revisão 01 — Correções após auditoria técnica

**Estado:** entregue para revalidação (não aprovada).
**HEAD auditado:** `7149f53803da9282560c988c87e3da8162ef7b58` (commit principal auditado `b27c5f547c08ae3eaa73edc0d3994ffc7d7ab75a`, base `5758fe1dcda104f6bfacf3ddb922a3711b088298`).
**Ambiente desta revisão:** macOS 12.7.6 (x86_64), Node v24.22.3 (binário oficial, verificado por SHA-256), dependências do `app/` instaladas com `npm ci --ignore-scripts` a partir do lockfile da branch.

### 10.1 Preparação

- Branch local criada a partir de `origin/feature/heliom-participante-ux`; `origin` apontava exatamente para `7149f53` (sem commits posteriores à auditoria).
- Divergência confirmada: 2 commits próprios da feature e 5 exclusivos da `develop` (base `5758fe1`). A `develop` **não** foi incorporada (§12 da task).
- Linha de base neste ambiente, no HEAD auditado (`npm test`): 925 testes, 872 aprovados, 0 falhas, 0 cancelados, 53 ignorados. Os 53 ignorados são suítes de integração condicionadas a ambiente (PostgreSQL/variáveis), não relacionadas a esta task; a entrega anterior registrou 0 ignorados em Windows com outro ambiente.
- O documento indicado na task (`ProgramacaoMobile/docs/...`) corresponde, neste repositório, a `docs/PARTICIPANTE_01_HOME_INGRESSO_IMPLEMENTACAO.md` (não há pasta `ProgramacaoMobile`).

### 10.2 Diagnóstico do contrato de backend usado nas correções (somente leitura, sem alteração)

| Fonte | Fato verificado | Uso na correção |
|---|---|---|
| `backend/src/participations/join-idempotency.ts` (`reserveIdempotencyOperationWithTx`) | A chave é reservada **antes** da elegibilidade. Chave concluída ⇒ `replay` do resultado gravado (`resultReference`); outra requisição com a mesma chave e outro `eventId` ⇒ `request_conflict` (`IDEMPOTENCY_KEY_REUSED`). | Replay com a **mesma chave e o mesmo corpo** recupera o identificador da operação original sem criar nada. |
| `participations.service.ts` (`createParticipation` + `JoinEligibilityRollback`) | Recusa de elegibilidade faz rollback da transação inteira, inclusive da reserva da chave. | Recusa de elegibilidade (`409/422/404/400` com código conhecido) para a chave enviada **prova** que ela não foi aplicada ⇒ a intenção pode ser liberada. |
| `participation-lifecycle.controller.ts` + `participation-query.service.ts` | `GET /participations/:id` devolve a participação **da própria conta** com status efetivo (`finished` quando o evento encerrou), ou 404. | Distingue participação corrente de participação já encerrada (cenário B) sem usar a ausência em `/current` como prova. |
| `idempotency.schema.ts`, `common/http/idempotency-ttl.ts` | `expires_at` é gravado (TTL por `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS`), mas **não existe expurgo nem verificação de expiração no replay** ("não implementa retenção nem expurgo"). | Hoje o replay é autoritativo. **Limitação registrada** em 10.9: se um expurgo for introduzido, o replay de uma chave expurgada passaria a ser avaliado como novo ingresso. |

Nenhum arquivo de backend, contrato, schema, migração ou retenção foi alterado.

### 10.3 AUD-P01-01 — Isolamento do ingresso por evento e intenção (P1)

- **Causa confirmada:** `lookup` publicava `{ ...state, status: 'looking_up', ... }`, herdando `confirmedParticipationId`, erros e status da consulta anterior; `joinFlight`/`syncFlight` eram globais ao store e a geração só mudava com conta/sessão. Uma resposta tardia de A publicava sobre o estado de B.
- **Comportamento anterior:** após ingressar e encerrar A, a consulta de B mostrava "Atualizar participação" e `retrySync` tentava sincronizar a participação de A com o evento B.
- **Correção:** cada `lookup` abre uma nova **operação** (`state.operation`); o estado é reconstruído do zero (sem `confirmedParticipationId`, `outcome`, erro ou recuperação herdados). Toda publicação assíncrona exige identidade + sessão + geração + operação atuais. Voos (`joinFlight`, `syncFlight`, `recoveryFlight`, `revalidateFlight`) são marcados com a operação que os criou e nunca são compartilhados com outra; um ingresso de outra operação ainda em voo bloqueia o novo com mensagem explícita, sem disparar POST. A confirmação devolvida pelo servidor continua sendo persistida na intenção mesmo quando a resposta chega tarde (a prova não se perde), mas não publica nada em B. A nova intenção registra `createdAt` (campo informativo; intenções antigas continuam válidas).
- **Arquivos:** `app/services/eventAdmissionService.js`, `app/context/ParticipationContext.js`.
- **Testes:** `participante01Revisao01.test.cjs` — R01-01, R01-02 (2 testes), R01-03 (3 testes), R01-22.
- **Status:** corrigido.

### 10.4 AUD-P01-02 — Reconciliação segura de ingresso com resposta perdida (P1)

- **Causa confirmada:** com a resposta do POST perdida, a intenção ficava sem `confirmedParticipationId`; a nova consulta devolvia `PARTICIPATION_ALREADY_CURRENT`, a tela bloqueava o botão (único caminho de replay) e "Voltar ao início" não resolvia a intenção; além disso, a recusa `PARTICIPATION_ALREADY_CURRENT` era explicitamente excluída da liberação. Depois de encerrar a participação, qualquer outro evento recebia `ADMISSION_OTHER_EVENT_PENDING` indefinidamente. Uma intenção com identificador confirmado cuja participação já tinha terminado também ficava presa em `confirmed_unsynced`.
- **Correção:**
  - Novo `reconcile()` (exposto como `reconcileEntryIntent`): caminho próprio de recuperação, independente da elegibilidade de um novo ingresso. Lê a intenção da conta (de qualquer evento) e, sem identificador confirmado, repete o POST original com **a mesma `Idempotency-Key` e o mesmo corpo** (`{ eventId }` original). Nunca gera chave nova.
  - `settleConfirmed()`: com o identificador provado pelo servidor, (A) participação corrente em `/current` com o mesmo id e evento ⇒ `complete`; senão (B) `GET /participations/:id` ⇒ `finished/canceled` do mesmo evento ⇒ resultado **histórico**; status corrente ⇒ `complete`. Só esses desfechos liberam a intenção. Evento divergente ⇒ bloqueio explícito.
  - `classifyJoinFailure()`: `not_applied` (códigos de elegibilidade/validação, que pelo contrato só ocorrem com a chave não gravada) ⇒ libera; `uncertain` (rede, timeout, 5xx, `IDEMPOTENCY_IN_PROGRESS`, resposta inválida) ⇒ preserva; `session` (401/403) e `conflict` (`IDEMPOTENCY_KEY_REUSED`) ⇒ preserva e bloqueia; 4xx desconhecido ⇒ preserva. Mudança deliberada: 401/403 deixaram de liberar a intenção (antes liberavam) e `PARTICIPATION_ALREADY_CURRENT` passou a liberar, ambos justificados pela ordem reserva→elegibilidade do backend.
  - A intenção nunca é apagada por fechar o app, renovar sessão, trocar de conta, consultar outro evento, falha de leitura ou passagem de tempo.
  - Na confirmação, o cartão "Tentativa anterior" aparece sempre que existe intenção não resolvida (de outro evento, confirmada, ilegível ou do mesmo evento bloqueado), com "Verificar tentativa anterior"; o ingresso novo fica desabilitado até a resolução. Intenção incerta do mesmo evento com entradas abertas continua usando o próprio botão ("Verificar ingresso", mesma chave).
- **Arquivos:** `app/services/eventAdmissionService.js`, `app/context/ParticipationContext.js`, `app/screens/event-entry/EventConfirmationScreen.js`.
- **Testes:** R01-04/05 (cenário completo dos 8 passos com reabertura do app), R01-06 (2 testes), R01-07, R01-08 (2 testes), R01-18 (troca de conta durante a reconciliação), R01-22; na tela: R01-05 (2), R01-07/08, R01-02, R01-22.
- **Limitações:** ver 10.9 (expurgo futuro; pacote de rede muito atrasado).
- **Status:** corrigido.

### 10.5 AUD-P01-03 — Revalidação da elegibilidade do evento (P1)

- **Causa confirmada:** `EventConfirmationScreen` lia `route.params.eligibility` como autoridade permanente; "Completar questionário" navegava sem contexto de retorno e, ao salvar, o questionário fazia `reset` para `MainTabs`, perdendo a jornada.
- **Correção:**
  - O store guarda (só em memória, por operação) o código consultado e expõe `revalidate()` (`revalidateEventEntry`), que repete `POST /events/lookup` — contrato real, autenticado — sem abrir nova operação. Estado `eligibilityStatus`: `fresh | revalidating | error`. Resposta de outro evento, sessão ou operação é descartada; chamadas concorrentes compartilham o mesmo voo; não revalida durante o POST de ingresso.
  - A tela usa a rota só para identificar o evento; situação, cartões e botão derivam de `admission.eligibility` com `eligibilityStatus === 'fresh'`. Durante a revalidação mostra "ATUALIZANDO SITUAÇÃO" e bloqueia o botão; em falha, "SITUAÇÃO NÃO CONFIRMADA" + "Atualizar situação do evento". Nada é liberado pelo relógio do aparelho.
  - Gatilhos: volta de foco (não na montagem inicial, que usa a consulta recém-feita), retorno ao primeiro plano com a tela focada, botão manual, recusa definitiva do POST (`revalidate: true`), resultado histórico e resolução da tentativa anterior. Sem polling.
  - "Completar questionário" abre `ProfileQuestionnaire` com `{ mode: 'edit', returnTo: 'EventConfirmation' }`. Ao salvar ou cancelar, o questionário volta (`goBack`) para a confirmação, que revalida no servidor (identidade da sessão + perfil avaliado pelo backend). O parâmetro só decide o destino da navegação, nunca prova conclusão. O fluxo só existe em modo edição — usuários com questionário obrigatório pendente ficam na pilha própria e nunca chegam à confirmação —, e a edição a partir do Perfil continua voltando ao Perfil.
- **Arquivos:** `app/services/eventAdmissionService.js`, `app/context/ParticipationContext.js`, `app/screens/event-entry/EventConfirmationScreen.js`, `app/screens/profile/ProfileQuestionnaireScreen.js`.
- **Testes:** store R01-09/10/11, R01-09 (descarte e voo único), R01-12 (revalidação após perfil completo; retorno do questionário vs. edição pelo Perfil); tela R01-09/10, R01-09/23, R01-11, R01-12/23 (foco e `AppState`), R01-10 (recusa definitiva).
- **Status:** corrigido.

### 10.6 AUD-P01-04 — Separação entre histórico e avaliação pendente (P2)

- **Causa confirmada:** `loadHomeOverview` capturava a falha da elegibilidade e devolvia `pending: null` (ausência silenciosa), e o histórico só era publicado depois da consulta da pendência.
- **Correção:** `useHomeOverview` passou a ter dois ciclos independentes, cada um com sua geração: histórico (`loading | empty | history | error`, com `refreshing`) e avaliação pendente (`none | checking | single | multiple | error`). 0 ou várias pendências derivam do `return-state` do servidor; uma única é confirmada por `fetchPendingEvaluationHistoryItem`. Falha ⇒ `error`, card sem ação de avaliação e "Tentar novamente" (`retryPending`), histórico preservado. Várias pendências ⇒ aba Eventos (política mantida).
- **C-04/D09:** `HomeFlowScreen` guarda o item confirmado pela retomada e o repassa (`knownPending`) para a mesma versão do retorno; enquanto a retomada ainda consulta, o hook adia só a pendência (`pendingDeferred`). Não foram alterados `returnStateVersion`, `canPresentReturnEvaluation`, `claimReturnEvaluation`, a correlação com a finalização recente nem "Avaliar mais tarde". O teste com o hook real detectou e eliminou uma consulta duplicada da mesma pendência.
- **Teste revisado:** o antigo "Falha na confirmação esconde só o card" (que aceitava a falha silenciosa) foi substituído: a falha agora deve ser propagada e virar estado de erro.
- **Arquivos:** `app/screens/home/useHomeOverview.js`, `app/utils/homeOverview.js`, `app/screens/home/HomeScreen.js`, `app/screens/home/HomeFlowScreen.js`.
- **Testes:** R01-13/14, R01-14, R01-19 (hook real em `homeReturnEvaluation.test.cjs`), R01-13 e R01-16 de tela.
- **Status:** corrigido.

### 10.7 AUD-P01-05 — Estados obsoletos durante revalidação da Home (P2)

- **Causa confirmada:** o hook mantinha `{ ...previous, refreshing: true }` para qualquer estado não-erro da mesma conta, inclusive `empty` e a pendência anterior.
- **Correção:** só um histórico **confirmado** da mesma conta/sessão/cliente permanece visível durante atualização (indicador discreto no título); vazio anterior volta a `loading` até nova confirmação. A pendência é ligada ao contexto `conta#sessão|versão|IDs` e ao ciclo de nova tentativa; mudança de contexto ou nova leitura invalida a ação (`checking`, sem item) até a confirmação. Respostas fora de ordem da mesma conta são descartadas pela geração de cada leitura.
- **Ajuste de harness:** os testes do hook passaram a manter o mesmo `httpClient` por conta/época (como o `AuthContext` real); um cliente novo a cada render representava outro contexto HTTP e disparava, corretamente, nova leitura.
- **Testes:** R01-15, R01-16, R01-17, R01-18 (hook) e R01-16 (tela).
- **Status:** corrigido.

### 10.8 AUD-P01-06 — Fila externa e horários programados (P2)

- **Causa confirmada:** o cartão de fila só aparecia quando elegível, e "Entradas até"/"Encerramento final" soavam como prazos vigentes mesmo com encerramento administrativo.
- **Correção:** `describeQueueConfiguration(event, eligibility)` apresenta a configuração oficial em todos os estados, com texto adaptado (aberto, ainda não iniciado/em preparação, encerrado, outros bloqueios, situação em revalidação), sem sugerir ingresso possível quando o servidor nega. O cartão passou a "Programação do evento" com "Data programada", "Início programado", "Encerramento programado das entradas", "Limite operacional programado" e "Fuso horário do evento"; o estado oficial aparece antes e, com `EVENT_REGISTRATION_CLOSED`, um aviso diz que os horários são a programação original e não valem mais como prazo. Nenhum horário ou motivo novo é inventado (o contrato não informa o horário efetivo do encerramento).
- **Arquivos:** `app/utils/eventEntryPresentation.js`, `app/screens/event-entry/EventConfirmationScreen.js`.
- **Testes:** R01-20 (fila habilitada/desabilitada, aberto, não iniciado, em preparação, encerrado), R01-21 (encerramento antecipado; fusos diferentes e meia-noite em `America/Manaus`), além dos testes de fuso já existentes.
- **Status:** corrigido.

### 10.9 Limitações e pontos para alinhamento (não implementados)

- **Retenção de idempotência:** o replay só é seguro enquanto o registro da chave existir. Hoje não há expurgo; se for introduzido (ou se o replay passar a respeitar `expires_at`), uma chave expurgada seria tratada como novo ingresso e poderia criar participação. Antes de qualquer política de retenção, é necessário alinhar um sinal explícito do backend para "chave expirada/desconhecida" (fora do escopo; não alterado).
- **Pacote original muito atrasado:** se o POST original ainda estiver em trânsito quando o replay recebe uma recusa de elegibilidade e a intenção é liberada, ele pode ser processado depois. A exclusividade de participação corrente do backend impede duas participações correntes; o efeito seria uma participação inesperada visível em `/current`. Risco teórico, registrado.
- **Local e fuso no histórico** e **escolha entre várias pendências** continuam como em 9.7.

### 10.10 Fidelidade visual e ícones

- Emojis permanentes (📷 🎮 ⭐ 📅 🕒 🚪 🏁 🌎) substituídos por `components/ui/LineIcon.js`: ícones desenhados com `View` (mesmo padrão de `navigation/MainTabs.js`), traço de 1,8 dp, sem fonte de ícones, SVG ou nova dependência, idênticos em Android e iOS (`qr`, `gamepad`, `star`, `calendar`, `clock`, `door`, `flag`, `globe`, `queue`, `alert`, `refresh`).
- Card de avaliação pendente com identidade roxa (`brand.primary`/`primaryDim`), ícone de estrela em caixa própria e divisor vertical entre ícone e conteúdo; estados "verificando" e "erro" em versão neutra, sem ação de avaliação.
- Evento recente: ícone de controle, e o horário passou a ser rotulado como da participação ("Sua entrada na Arena" ou "Seu ingresso"), não como horário oficial do evento; local continua omitido.
- **Comparação com os mockups:** PENDENTE. `ArenaGO_01_Home_Inicial_Padronizada(3).png` e `ArenaGO_03_Home_Apos_Evento_Padronizada(3).png` não estavam disponíveis neste computador durante a revisão (foram solicitados). Os ajustes acima seguem a lista do item 9 da task; espaçamentos, cores e posições finos ainda precisam ser conferidos contra as imagens.
- **Capturas reais:** não produzidas — não há simulador, emulador nem aparelho neste ambiente. Nenhuma imagem gerada ou mockup foi usada como evidência.

### 10.11 Testes executados nesta revisão

Ambiente: macOS 12.7.6 x86_64, Node v24.22.3, `app/` e `qa/regression/` com `npm ci --ignore-scripts` pelos lockfiles. Nenhum banco, migração ou serviço externo. Executado pelo assistente com autorização do responsável nesta sessão.

| Comando (em `app/`) | SHA testado | Total | Aprov. | Falhas | Cancel. | Ignor. | Exit |
|---|---|---|---|---|---|---|---|
| `npm test` — linha de base, sem deps de `qa/regression` | `7149f53` | 925 | 872 | 0 | 0 | 53 | 0 |
| `npm test` — revisão, sem deps de `qa/regression` | working tree sobre `7149f53` | 968 | 915 | 0 | 0 | 53 | 0 |
| `npm test` — revisão, **com** deps de `qa/regression` | working tree sobre `7149f53` (idêntico ao commit da revisão) | **968** | **968** | 0 | 0 | 0 | 0 |
| Suíte focada (abaixo) | idem | **332** | **332** | 0 | 0 | 0 | 0 |
| `npx expo export --platform android` | idem | — | — | — | — | — | 0 (Hermes `.hbc` 2,9 MB) |
| `npx expo export --platform ios` | idem | — | — | — | — | — | 0 |
| `git diff --check` (código e documentação) | idem | — | — | — | — | — | sem problemas |

Os 53 ignorados das duas primeiras linhas são suítes que exigem as dependências de `qa/regression` (`staffRealNavigation`, `roleRoutingIntegration` etc., `skip` explícito no próprio teste); com elas instaladas, nenhum teste é ignorado. O número de 925 da entrega anterior não foi reaproveitado.

Suíte focada: `node --test tests/participante01Home.test.cjs tests/homeReturnEvaluation.test.cjs tests/eventEntry.test.cjs tests/eventAdmissionService.test.cjs tests/participante01Revisao01.test.cjs tests/homeFlow.test.cjs tests/participationProvider.test.cjs tests/participationService.test.cjs tests/auth.test.cjs tests/authNavigation.test.cjs tests/adminNavigation.test.cjs tests/roleRoutingIntegration.test.cjs tests/autoQueueSync.test.cjs tests/profileEditing.test.cjs`.

Testes novos: `tests/participante01Revisao01.test.cjs` (25, com backend simulado fiel à ordem reserva→elegibilidade, rollback, replay e `GET /participations/:id`), 14 em `eventEntry.test.cjs`, 3 em `participante01Home.test.cjs`, 1 em `homeReturnEvaluation.test.cjs` (hook real). As asserções verificam estados do store, requisições, `eventId`, chaves idempotentes, número de criações no servidor e conteúdo do armazenamento de intenções, não só textos.

Testes adaptados (sem enfraquecer proteções): fixtures da confirmação passaram a publicar a elegibilidade no store (`official(...)`), pois a rota deixou de ser autoridade; P01-17 agora exige `{ mode: 'edit', returnTo: 'EventConfirmation' }`; os testes de `loadHomeOverview` foram substituídos pelos das novas funções (a falha silenciosa deixou de ser aceita); harness: stub `LineIcon`, `canGoBack` opcional, `AppState` opcional no `screenRig` e `httpClient` estável por conta/época no hook.

### 10.12 Matriz de regressão R01

| ID | Cobertura |
|---|---|
| R01-01 | store: ingresso A → finalização → B (chaves e intenções distintas, 2 criações) |
| R01-02 | store: reingresso no mesmo evento; intenção residual de evento encerrado tratada como histórica; tela: "Verificar ingresso" com mesma chave |
| R01-03 | store: POST tardio de A durante B; lookup tardio; consulta de outro evento preserva intenção incerta |
| R01-04 / R01-05 | store: resposta perdida → reabertura → `ALREADY_CURRENT` → replay com a chave original → 1 criação → B com nova chave; tela: recuperação leva à participação corrente |
| R01-06 | store: recuperação com participação encerrada (histórico); confirmação presa em "Atualizar" resolvida como histórico |
| R01-07 | store: rede, 5xx e falha do GET durante reconciliação preservam intenção e chave |
| R01-08 | store: `KEY_REUSED`, 401, 403 e armazenamento ilegível bloqueiam explicitamente; prova de não aplicação libera sem criar |
| R01-09 / R01-10 / R01-11 | store: abertura, preparação, encerramento e recusa definitiva; tela: rota não libera, revalidação bloqueia, erro oferece atualização |
| R01-12 | store: revalidação após perfil completo; questionário volta à confirmação (e à aba Perfil quando aberto pelo Perfil); tela: foco revalida |
| R01-13 / R01-14 | hook: histórico antes da avaliação, timeout → erro → retry → card; tela: erro sem CTA e com retry |
| R01-15 | hook: vazio não reafirmado; histórico confirmado visível em atualização |
| R01-16 | hook: nova versão invalida CTA; tela: "verificando" sem CTA |
| R01-17 | hook: respostas fora de ordem na mesma conta |
| R01-18 | hook: troca de conta e logout; store: troca de conta durante reconciliação |
| R01-19 | `homeReturnEvaluation`: HomeFlow + hook real, apresentação única, sem consulta duplicada na mesma versão |
| R01-20 | tela: fila habilitada/desabilitada em aberto, não iniciado, em preparação e encerrado |
| R01-21 | tela: encerramento antecipado (aviso, rótulos "programado"); fusos e meia-noite |
| R01-22 | store: toques repetidos em confirmar e reconciliar; tela: verificação com toque repetido |
| R01-23 | tela: retorno ao primeiro plano (`AppState`) e foco revalidam sem consultas redundantes |
| R01-24 | testes ENTRY-QR-01 e de código manual existentes em `eventEntry.test.cjs` (inalterados, aprovados) |

### 10.13 Validação física — PENDENTE

Não executada: não há aparelho Android/iOS, simulador ou emulador neste ambiente. Pendentes no aparelho: Home inicial, Home com histórico, avaliação pendente, QR Code, código manual, confirmação (elegível/indisponível/recuperação), retorno do questionário, ingressos sucessivos, reabertura, perda de conexão, fonte ampliada, áreas seguras, formatação de horários e o desenho dos novos ícones (em especial a estrela feita com triângulos de borda). A geração dos bundles Expo não substitui essa homologação.

### 10.14 Evidências de diff e Git

- **Avisos de whitespace do patch versionado:** causa confirmada — num diff unificado, linhas de contexto em branco são gravadas como `" "`, que o `git diff --check` aponta como espaço final *dentro do arquivo `.diff`* (42 avisos em `qa-evidence/PARTICIPANTE_01-changes.diff`). O patch histórico **não** foi alterado; ele continua representando `5758fe1` → `b27c5f5` (código da entrega inicial) e **não** representa o HEAD corrigido. Para patches, a verificação adequada é `git apply --check` contra a base declarada.
- **Novo patch da revisão:** `qa-evidence/PARTICIPANTE_01_R01-changes.diff` — base `7149f53803da9282560c988c87e3da8162ef7b58` (HEAD auditado), escopo: todas as alterações de código, testes e documentação desta revisão (exceto o próprio patch), finalidade: revisão isolada das correções R01. Verificado com `git apply --check` sobre `7149f53`.
- **Alterações de contratos:** nenhuma (backend, schema, migrações, retenção de idempotência e autenticação intactos).
- **Integração:** `develop` não incorporada; sem merge na `develop`; sem force push. PARTICIPANTE-02 não iniciada.

### 10.15 Commits da revisão

- `e82678a22903ac8ebc0debb3772f29b40cb82710` — `fix(participante): corrigir ingresso e home apos auditoria P01` (código, testes, este documento e `qa-evidence/PARTICIPANTE_01_R01-changes.diff`). É o SHA testado em 10.11: o conteúdo do working tree testado é idêntico ao deste commit.
- Commit seguinte: somente este registro de commits no documento.
- Push para `origin/feature/heliom-participante-ux` sem force; o SHA final da branch é o do commit de registro, informado no resumo da entrega.

**Estado da task ao final da R01:** Entregue para revalidação — não aprovada.

## 11. Revisão 02 — Correções residuais após auditoria Git

**Estado:** Revisão 02 entregue para revalidação (não aprovada).
**HEAD auditado:** `970ae10338989bfa002bd457378f0db9ef5d5b2b` (commit principal da R01: `e82678a22903ac8ebc0debb3772f29b40cb82710`).
**Ambiente:** macOS 12.7.6 (21H1320, x86_64), Node v22.23.5 (`~/.local/node`), dependências já instaladas em `app/`, `backend/` e `qa/regression/`. Validações executadas pelo assistente (Claude Code) com autorização explícita do responsável nesta sessão, inclusive commit e push (§15 da task). Nenhum banco foi acessado.

### 11.1 Preparação

- Branch `feature/heliom-participante-ux`; local e `origin` em `970ae10` (nenhum commit posterior à auditoria). Implementação feita como alterações sobre esse HEAD.
- `develop` não incorporada; sem merge, rebase, force push ou reescrita de histórico.
- **Nota de processo:** a implementação começou antes de esta seção existir. O item 2 da task pedia o diagnóstico registrado aqui antes do código. O diagnóstico abaixo foi consolidado ao final, junto com os resultados. Não há registro prévio a apresentar.
- O documento indicado na task (`ProgramacaoMobile/docs/...`) corresponde a `docs/PARTICIPANTE_01_HOME_INGRESSO_IMPLEMENTACAO.md` (mesma observação de 10.1).

### 11.2 Diagnóstico confirmado no código (HEAD `970ae10`)

| Fonte | Fato verificado | Consequência |
|---|---|---|
| `app/services/eventAdmissionService.js` (`reconcile`) | "Verificar tentativa anterior" reenviava `POST /participations` com a chave e o corpo originais. | Sem registro da chave e com o evento aberto, a verificação **criava** a participação (cenário 3.2 da task). |
| `join-idempotency.ts` (`reserveJoinIntentWithTx`) | Ordem: `events FOR UPDATE` → `users FOR UPDATE` → reserva da chave (UNIQUE ator+operação+chave) → elegibilidade. Recusa ⇒ rollback de tudo, inclusive da reserva. | Uma recusa só prova "não aplicado" para a requisição que a recebeu; outra requisição com a mesma chave ainda em trânsito pode ser aceita depois. |
| `classifyJoinFailure()` (R01) | Tratava `VALIDATION_ERROR`/elegibilidade como `not_applied` e liberava a intenção, inclusive durante a recuperação. | Liberação insegura de intenção incerta (4.1 da task). |
| `intentStorage.set()` (R01) | Gravação incondicional por conta; a resposta tardia gravava `{ ...intent, confirmedParticipationId }`. | Resposta tardia de A podia sobrescrever a intenção B da mesma conta (5.1). |
| `ParticipantAdmissionController.joinResponse` | Replay válido pressupunha HTTP 201 com `participationId`; outro formato ⇒ erro 500. | Um registro terminal de abandono precisaria de tratamento próprio (4.6). |
| `idempotency.schema.ts` | Status `in_progress`/`completed`, `http_status`, `result_reference` (anulável), `result_payload` (jsonb), `expires_at`; UNIQUE (ator, operação, chave). | O abandono cabe como linha `completed` sem referência, **sem migration**. |
| Retenção (`expires_at`) | Gravado e indexado (`ix_idempotency_expires`), mas nenhum código do backend apaga linhas de `idempotency_operations` nem lê `expires_at` no replay. | O replay e o abandono são hoje permanentes; ver 11.9. |

### 11.3 R02-01 — Separação entre consulta e execução de ingresso (P1)

- **Problema:** a ação de consulta executava o ingresso.
- **Causa confirmada:** `reconcile()` reaproveitava o `POST /participations` como consulta (11.2).
- **Solução aplicada:**
  - Backend: novo contrato somente-leitura `POST /api/v1/participations/admission-intents/lookup` (11.8). `ParticipationsService.lookupJoinIntent` roda `readJoinIntentWithExecutor` numa transação `READ ONLY` (`read committed`). O PostgreSQL recusa qualquer escrita acidental. Não reserva a chave, não trava linhas, não toca fila externa, snapshot nem participação.
  - App: a jornada distingue três operações do store, todas com a chave e o corpo originais da intenção:
    - `reconcile` (botão "Verificar tentativa anterior"/"Verificar novamente") usa **somente** o contrato de consulta;
    - `repeatPrevious` ("Repetir ingresso anterior") reenvia o POST original e exige segunda confirmação na tela ("Repetir a tentativa … pode concluir seu ingresso nesse evento, caso ele ainda não tenha sido registrado.");
    - `abandonPrevious` ("Cancelar tentativa anterior") também exige segunda confirmação e usa o contrato de abandono (R02-02).
  - Resposta da consulta: `completed` ⇒ grava a prova na intenção (condicionada à chave) e recupera a participação pelas regras da R01 (`/current` ou `GET /participations/:id`, conferindo o evento). `not_found` ⇒ **não cria e não apaga**; mensagem "O servidor ainda não tem registro do resultado…" com as três opções. `in_progress` ⇒ preserva e pede nova consulta. `abandoned` ⇒ libera a intenção. `conflict` ⇒ bloqueia e orienta suporte.
  - `confirm()` deixou de repetir automaticamente uma intenção incerta do mesmo evento. O botão principal recusa ("Verifique, repita ou cancele essa tentativa") e o cartão de recuperação assume.
- **Arquivos:** `backend/src/participations/join-idempotency.ts`, `participations.service.ts`, `participant-admission.controller.ts`; `app/services/eventAdmissionService.js`, `app/context/ParticipationContext.js` (expõe `repeatPreviousEntry` e `abandonPreviousEntry`), `app/screens/event-entry/EventConfirmationScreen.js`.
- **Decisões:** POST para transportar o corpo, com a chave no cabeçalho `Idempotency-Key` (nunca na URL). O ator vem só da sessão. A resposta tem apenas `state` e, se concluída, o `participationId` da própria conta (sem hash, chave ou dados administrativos).
- **Testes:** backend R02-T01/T11, T02/T23, T03, T04 e "in_progress/abandoned" (serviço), R02-T01, T02, T03 e validação de sessão/corpo/chave (HTTP); app R02-T01 (cenário 3.2 completo: **0 participações** criadas pela consulta, intenção intacta), R02-T02, R02-T03/T16; tela R02-01 (verificar só consulta; repetir/cancelar com segunda confirmação; intenção já confirmada oferece só verificação), P01-21 e R01-02 revisados.
- **Resultado:** aprovado (11.11).
- **Limitação:** a consulta enxerga apenas registros confirmados (`read committed`). Um ingresso original ainda em transação aparece como `not_found`, e por isso `not_found` nunca libera nada.
- **Status:** corrigido.

### 11.4 R02-02 — Resolução autoritativa e cancelamento seguro de intenções (P1)

- **Problema:** ausência de registro, recusa de elegibilidade e `VALIDATION_ERROR` eram tratadas como prova de que a intenção nunca seria aplicada.
- **Causa confirmada:** `classifyJoinFailure()` da R01 e a falta de um resultado terminal persistido para "esta chave nunca poderá criar participação".
- **Solução aplicada:**
  - **Abandono persistido:** `POST /api/v1/participations/admission-intents/abandon` (11.8). `ParticipationsService.abandonJoinIntent` usa **o mesmo** `reserveJoinIntentWithTx` do ingresso (evento → usuário → chave). Com a chave livre, grava na mesma transação a reserva e o resultado terminal `ABANDONED_JOIN_RESULT`. Se o ingresso venceu, devolve o resultado dele. Com fingerprint diferente devolve conflito. Com `in_progress` confirmado (anomalia) devolve 409 sem alterar nada.
  - **Representação persistida** (linha de `idempotency_operations`): `operation='join'`, `status='completed'`, `http_status=409`, `result_reference=NULL`, `result_payload={"code":"ADMISSION_INTENT_ABANDONED"}`, `request_hash` = fingerprint do `eventId` original, `expires_at` pela política de TTL do participante (igual ao ingresso).
  - **Leitura semântica única:** `classifyCompletedJoin()` reconhece só dois formatos: ingresso (201, `result_reference = result_payload.participationId`, formato gravado desde a Etapa 3) e abandono (acima). Qualquer outro formato lança erro e nunca é tratado como ingresso nem como chave livre.
  - **Ingresso com chave abandonada:** `joinResponse` reconhece o replay terminal e responde `409 ADMISSION_INTENT_ABANDONED` (RFC 7807). Não gera 500, não é tratado como ingresso confirmado e não volta a ser elegível. Replays de sucesso (201) seguem idênticos.
  - **App, `classifyJoinFailure()`:** passou a distinguir `refused` (recusa recebida), `abandoned`, `uncertain`, `session`, `conflict`, `other_pending` e `unknown`. Uma recusa só libera a intenção quando a intenção tem `attempts === 1`, ou seja, quando aquela foi a **primeira e única** requisição enviada com a chave. A contagem é gravada **antes** do envio, por atualização condicional (11.5). Intenções antigas, sem `attempts`, contam como já enviadas e nunca são liberadas por recusa. Recusas durante repetição ou recuperação mantêm a intenção ("A tentativa anterior continua sem resultado confirmado…").
  - O cliente HTTP não reenvia POST em falha de rede. Só repete após 401 com renovação de sessão, e o 401 é recusado antes da reserva da chave. Isso sustenta a regra da primeira e única tentativa.
- **Garantias transacionais (4.5):**
  - **Cenário A — ingresso conclui primeiro:** o abandono encontra a linha `completed` (201) e devolve `{ state: "completed", participationId }`. Nada é sobrescrito e a participação continua.
  - **Cenário B — abandono conclui primeiro:** o ingresso atrasado encontra a linha terminal e responde 409 `ADMISSION_INTENT_ABANDONED`. Não cria participação, não mexe na fila externa (`external_last_order`) e não cria snapshot. Repetições devolvem o mesmo estado.
  - **Cenário C — fingerprint diferente:** conflito sem modificar o registro.
  - **Ordem de locks:** idêntica à do ingresso (`events FOR UPDATE` → `users FOR UPDATE` → UNIQUE da chave). Ingresso e abandono da mesma chave serializam no lock do evento. Abandono de A e ingresso em B da mesma conta travam eventos diferentes e depois o mesmo usuário, sem inversão. A consulta não trava nada.
  - **Sem `in_progress` órfão:** reserva e resultado terminal são gravados na mesma transação. Falha ao gravar o resultado faz rollback (teste "abandono não confirma reserva in_progress sem resultado").
- **Compatibilidade:** linhas de ingresso gravadas antes da R02 continuam com replay 201 (R02-T23). Nenhum mecanismo de idempotência de Staff/Admin foi alterado: `reserveIdempotencyOperationWithTx` e `completeIdempotencyOperationWithTx` foram reutilizados sem mudança.
- **Arquivos:** os mesmos de 11.3, mais `app/tests/participante01Revisao01.test.cjs` (o teste R01-08 que aceitava "prova de não aplicação" foi substituído por R01-08 (R02-T11)).
- **Testes:** backend R02-T07 (ordem dos locks e gravação terminal; ingresso atrasado vira replay terminal), T08, T09, rollback e formato desconhecido (serviço); T07/T08/T09, T04 e "POST com chave abandonada é 409, nunca 500" (HTTP). App: R02-T05, T06, T07, T08, T09/T10, T12, "só a primeira e única tentativa recusada libera; legado nunca", R02-T24 (app); tela R02-02/T13 e R02-02 (abandono que encontra ingresso concluído leva à participação corrente).
- **Integração com PostgreSQL real:** `backend/test/integration/participant-admission-intents.integration.test.ts` (6 testes: T01, T07, T08, T03/T04 e dois de T24: abandono × ingresso concorrentes com a mesma chave; abandono de A × ingresso em B sem deadlock). Usa a guarda da Etapa 3 (`participant-admission-db-guard`, banco `arenago_admission_test` vazio, sem limpeza global, removendo só as próprias fixtures). **Não executado:** não há PostgreSQL neste ambiente e o `AGENTS.md` exige autorização por campanha. Os testes foram compilados (`tsc -p tsconfig.test.json`) e passaram no lint. **A garantia transacional não está homologada**: a evidência atual vem de testes de serviço com executor simulado, que verificam a ordem das chamadas e o desfecho.
- **Status:** corrigido no código; pendente a campanha de concorrência em PostgreSQL isolado.

### 11.5 R02-03 — Proteção do armazenamento de intenções contra respostas tardias (P1 preventivo)

- **Problema:** gravação incondicional por conta (`intentStorage.set`).
- **Causa confirmada:** leitura e gravação independentes. Uma resposta de A gravava `confirmedParticipationId` sobre o registro da conta, mesmo que ele já fosse de B.
- **Solução aplicada:** `createAdmissionIntentStorage` passou a executar toda operação numa **fila serializada única** (seção crítica). A leitura, a comparação e a gravação acontecem dentro da mesma tarefa da fila:
  - `create(intent)`: grava só se a conta não tiver intenção; senão devolve a existente intacta;
  - `update(userId, expectedKey, patch)`: só altera se a chave atual for a esperada. `patch` pode ser função do valor atual (transição atômica, usada no contador `attempts`). Conta, evento e chave nunca mudam;
  - `clear(userId, key, expected)`: só remove a chave esperada, opcionalmente exigindo campos (`attempts: 1`, `confirmedParticipationId`).
  - `set` continua exportado para compatibilidade, mas **não é usado** por código de produção. O app usa uma única instância (`defaultAdmissionIntentStorage`).
- **Ciclo de vida analisado:**

| Evento | Comportamento |
|---|---|
| Logout / novo login na mesma conta / nova época | `setIdentity` incrementa geração e operação e descarta os voos. Respostas antigas não publicam estado. A intenção persiste por conta (não é apagada no logout). |
| Resposta tardia da operação anterior | Grava a prova do servidor **só** se a chave ainda for a atual (`recordConfirmation` → `update` condicional). Se a intenção atual for outra, nada é gravado. A prova antiga pode ser recuperada depois pelo contrato de consulta. |
| Troca de conta | Armazenamento isolado por UUID da conta. O contexto antigo é descartado por identidade. |
| Reabertura do app | A intenção é lida do SecureStore. Não há concorrência entre processos. |
| Reconciliação concorrente | Um voo de recuperação por operação. A mesma ação compartilha o voo; outra ação recebe "Aguarde…". O ingresso em voo bloqueia a recuperação e vice-versa. |
| Cancelamento definitivo / nova intenção | `clear` condicionado à chave abandonada; a nova intenção só é criada por `create` com a conta livre, e recebe nova chave. |

- **Testes:** R02-03 (create/update/clear condicionais e serializados), R02-T14 (resposta de A após criação de B não troca a chave de B), R02-T15 (logout e novo login na mesma conta), R02-T03/T16 (troca de conta durante a recuperação).
- **Limitação:** a seção crítica vale dentro do processo JS (uma instância). Várias instâncias do armazenamento não compartilhariam a fila, situação que hoje não existe em produção.
- **Status:** corrigido.

### 11.6 R02-04 — Complementos da revalidação de elegibilidade (P2)

- **Problema:** não havia atualização manual com elegibilidade positiva. A recuperação dependia da tela de evento elegível. O teste do questionário usava um usuário já completo.
- **Solução aplicada:**
  - "Atualizar situação" (botão `ghost` pequeno, ao lado do selo de situação, com `accessibilityLabel`) aparece em todos os estados da situação, inclusive elegível. Fica desabilitado durante a revalidação e a recuperação e some durante consulta ou ingresso. `revalidate()` tem voo único, marca `eligibilityStatus='revalidating'` (o que invalida a autorização de confirmar até a nova resposta) e devolve `busy` durante ingresso ou recuperação. Sem polling.
  - O cartão de recuperação aparece sempre que existe intenção não resolvida, **independente da elegibilidade** (inclusive com evento encerrado). Consulta e cancelamento não exigem evento elegível. A repetição segue as regras do backend e o resultado terminal da chave.
  - Questionário: a navegação usa `{ returnTo: 'EventConfirmation' }` sem forçar `mode: 'edit'`. Assim, o perfil que deixou de atender aos requisitos abre no modo de conclusão, pré-preenchido. `ProfileQuestionnaireScreen` volta (`goBack`) para a confirmação quando há tela anterior. O fluxo obrigatório de novos usuários é a raiz da própria pilha, sem tela anterior, e mantém o `reset`. A edição iniciada pelo Perfil continua voltando ao Perfil. O retorno revalida no servidor.
- **Arquivos:** `app/screens/event-entry/EventConfirmationScreen.js`, `app/screens/profile/ProfileQuestionnaireScreen.js`, `app/services/eventAdmissionService.js`.
- **Testes:** R02-T17 (atualização manual com evento antes aberto reflete o encerramento), R02-04 (recuperação com evento encerrado), R02-T18 ×3 (perfil **efetivamente incompleto** → questionário salvo → conta atualizada → retorno → nova consulta → elegível; questionário que deixou de atender os requisitos; fluxo obrigatório e edição pelo Perfil mantêm seus destinos); tela R02-04/T17.
- **Status:** corrigido.

### 11.7 R02-05 — Invalidação imediata dos estados obsoletos da Home (P2)

- **Problema:** parte da invalidação ocorria em `useEffect`, deixando uma renderização com dados do contexto anterior.
- **Causa confirmada:** o estado guardava só `key` (conta#sessão). O contexto completo era comparado apenas dentro dos efeitos, e o harness anterior rodava os efeitos antes de observar o resultado.
- **Solução aplicada** (`app/screens/home/useHomeOverview.js`): cada dado guarda o **contexto em que foi confirmado**. Histórico: conta/sessão/identidade verificada, instância do cliente HTTP (token estável por `WeakMap`), versão do retorno, ciclo de foco e ciclo de nova tentativa. Pendência: os mesmos campos mais os IDs pendentes. O ciclo de foco é calculado no render. A **seleção do que é exibido acontece no render**, antes de qualquer efeito: dado com contexto diferente vira `loading`/`checking`. Só um histórico confirmado da mesma conta, sessão e cliente continua visível, marcado `refreshing`. Avaliação antiga nunca fica clicável. Respostas fora de ordem continuam descartadas por geração. `knownPending`/`pendingDeferred` (C-04/D09) e "Avaliar mais tarde" não foram alterados.
- **Testes** (harness que observa a renderização **anterior** aos efeitos): R02-T19 (mudança de versão do retorno; perda e recuperação de foco e mudança de pendências; respostas fora de ordem), R02-T20 (mudança do cliente HTTP). T21 (C-04/D09) foi coberto pelas suítes existentes `homeReturnEvaluation`, `homeFlow` e `participante01Home`, todas aprovadas.
- **Status:** corrigido.

### 11.8 Contratos de backend criados ou modificados

Prefixo global `api/v1`. Ambos exigem sessão (`Authorization: Bearer`), um único cabeçalho `Idempotency-Key` válido (`validateOperationIdempotencyKey`) e o corpo estrito `{ "eventId": "<uuid>" }`, o mesmo do ingresso, do qual sai o fingerprint. O ator é sempre o usuário da sessão.

| Contrato | Respostas |
|---|---|
| `POST /participations/admission-intents/lookup` (novo, somente leitura) | `200 { intent: { state: "completed", participationId } }` · `200 { intent: { state: "not_found" | "in_progress" | "abandoned" | "conflict" } }` · 400 `VALIDATION_ERROR` (corpo/chave) · 401 sessão |
| `POST /participations/admission-intents/abandon` (novo) | `200 { intent: { state: "abandoned" } }` · `200 { intent: { state: "completed", participationId } }` (ingresso venceu) · 409 `IDEMPOTENCY_KEY_REUSED` (fingerprint diferente) · 409 `IDEMPOTENCY_IN_PROGRESS` · 400/401 como acima |
| `POST /participations` (modificado só no replay) | Chave abandonada ⇒ 409 `ADMISSION_INTENT_ABANDONED`. Demais respostas inalteradas. |

Sem alteração de schema, migration, retenção, autenticação ou contratos de Staff/Admin.

### 11.9 Retenção de idempotência e riscos futuros

- **Política atual verificada:** `expires_at` é gravado (TTL `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS`) e indexado, mas **não existe expurgo** de `idempotency_operations` nem verificação de expiração no replay. Os resultados de ingresso e de abandono são, na prática, permanentes. Nada foi alterado.
- **Requisito para qualquer política futura:** uma linha `completed` de `join`, seja ingresso ou abandono, não pode ser removida enquanto uma requisição original com aquela chave puder ser aceita. Remover uma linha de abandono transformaria a chave de volta em livre, e um POST atrasado criaria participação. Um expurgo futuro precisa preservar o terminal ou introduzir um sinal explícito de "chave expirada" que o ingresso recuse. Esse ponto exige alinhamento e está fora desta revisão.
- Nenhum mecanismo existente incompatível foi encontrado. Por isso esta parte não precisou ser interrompida (4.8 da task).

### 11.10 R02-06 — Validação visual e acabamento

- Os ajustes da R01 (`LineIcon`, card roxo de avaliação, rótulos de horário da participação) foram preservados e não foram reimplementados.
- Novos elementos de interface: cartão "TENTATIVA ANTERIOR" com "Verificar tentativa anterior", "Repetir ingresso anterior" e "Cancelar tentativa anterior", caixas de segunda confirmação e "Atualizar situação". Todos usam os componentes existentes (`Badge`, `Button`).
- **Comparação com os mockups: PENDENTE.** `ArenaGO_01_Home_Inicial_Padronizada(3).png` e `ArenaGO_03_Home_Apos_Evento_Padronizada(3).png` continuam indisponíveis neste computador (busca em Documentos, Downloads e Mesa sem resultado). O acesso foi solicitado novamente ao responsável. Nenhuma imagem da internet foi usada.
- **Capturas reais: não produzidas.** Não há simulador, emulador nem aparelho neste ambiente. Ficam pendentes: Home inicial, Home com histórico, Home com avaliação pendente, confirmação de evento, recuperação e cancelamento seguro de tentativa anterior.
- `npx expo export` (Android e iOS) concluiu com código 0, o que só prova que o bundle compila. Não prova fidelidade visual nem homologação física.
- **Status:** pendente de homologação visual e física.

### 11.11 Testes executados nesta revisão

| Comando | SHA testado | Total | Aprov. | Falhas | Cancel. | Ignor. | Exit |
|---|---|---|---|---|---|---|---|
| `npm test` em `app/` (com deps de `qa/regression`) | working tree sobre `970ae10` (idêntico ao commit da R02) | **997** | **997** | 0 | 0 | 0 | 0 |
| `npm test` em `backend/` — **linha de base** (worktree temporária) | `970ae10` | 1159 | 1146 | 13 | 0 | 0 | 1 |
| `npm test` em `backend/` — R02 | working tree sobre `970ae10` | 1178 | 1165 | 13 | 0 | 0 | 1 |
| Testes unitários R02 do backend (`participant-admission-intents*.test.ts`) | idem | 19 | 19 | 0 | 0 | 0 | 0 |
| `npx tsc --noEmit -p .` (produção) e `-p tsconfig.test.json` (testes) em `backend/` | idem | — | — | — | — | — | 0 / 0 |
| `npx eslint` nos arquivos R02 do backend | idem | — | — | — | — | — | 0 |
| `npx eslint "src/**/*.ts" "test/**/*.ts"` (backend completo) | idem | — | — | 3 erros | — | — | 1 |
| `npx expo export --platform android` / `ios` | idem | — | — | — | — | — | 0 / 0 (Hermes ≈ 2,9 MB cada) |
| `git diff --check` (código e documentação) | idem | — | — | — | — | — | sem problemas |
| Integração PostgreSQL (`participant-admission-intents.integration.test.ts`) | — | 6 | **não executados** | — | — | — | — |

- **Backend: 13 falhas de ambiente, anteriores à R02.** Os testes unitários do backend precisam das variáveis do `.env.example` (`DATABASE_URL` local, `127.0.0.1:55432`; nenhuma conexão é aberta nos unitários). Executado com `set -a; . ./.env.example; set +a; NODE_ENV=test npm test`. Treze arquivos HTTP/DI de outros módulos (`admin-close-http`, `admin-external-queue-http`, `admin-schedule-http`, `evaluation-read-http`, `evaluation-write-http`, `experience-queue-control-http`, `experiences-http`, `mutation-session-http`, `participant-queue-http`, `participation-lifecycle-http`, `queue-entry-di`, `staff-queries-http`, `station-availability-http`) encerram o processo com código 1 sem mensagem. Os casos que chegam a rodar passam. A lista de arquivos com falha é **idêntica** na linha de base `970ae10` e na R02 (comparação por `diff`), então não foi introduzida por esta revisão. A causa não foi investigada, por estar fora do escopo. Fica registrada para o responsável.
- **Lint completo do backend:** 3 erros em `src/events/admin-configuration.dto.ts`, `test/unit/staff-a4-homolog-fixture.test.ts` e `test/unit/staff-homolog-fixture.test.ts`, arquivos que a R02 não altera (anteriores).
- **App:** 997 = 968 da R01 + 29 novos (24 em `participante01Revisao02.test.cjs` e 5 em `eventEntry.test.cjs`). Três testes anteriores foram substituídos por versões R02 (P01-21, R01-02 de tela e R01-08 do store), porque o comportamento antigo (repetir pelo botão principal; liberar por "prova de não aplicação") é justamente o que a R02 proíbe. A suíte completa inclui `eventAdmissionService`, `eventEntry`, `participante01Revisao01`, `participante01Home`, `homeReturnEvaluation`, `homeFlow`, `participationProvider`, autenticação, questionário e navegação. As asserções verificam requisições, chaves, número de participações no backend simulado, conteúdo do armazenamento e estados do store, não só textos.
- A campanha de 968 testes da R01 permanece como resultado histórico (10.11). Não é resultado da R02.

### 11.12 Matriz de regressão R02

| ID | Cobertura | Resultado |
|---|---|---|
| R02-T01 | app (cenário 3.2) + backend serviço/HTTP; integração preparada | 0 participações; aprovado (integração pendente) |
| R02-T02 | app + backend serviço/HTTP | resultado original recuperado; aprovado |
| R02-T03 | app (isolamento por conta) + backend serviço/HTTP; integração preparada | aprovado |
| R02-T04 | app + backend serviço/HTTP; integração preparada | conflito sem alteração; aprovado |
| R02-T05 | app | ingresso só conforme backend, mesma chave; aprovado |
| R02-T06 | app | replay sem duplicação; aprovado |
| R02-T07 | app + backend serviço/HTTP; integração preparada | ingresso atrasado não cria; aprovado (integração pendente) |
| R02-T08 | app + backend serviço/HTTP; integração preparada | resultado confirmado preservado; aprovado |
| R02-T09 / T10 | app + backend serviço/HTTP | mesmo terminal; resposta perdida recuperada por consulta; aprovado |
| R02-T11 | app (R02-T01 e R01-08 (R02-T11)) + backend | intenção não apagada; aprovado |
| R02-T12 | app (2 testes) | nenhuma liberação insegura; aprovado |
| R02-T13 | app + tela | nova chave independente para B, sem ingresso automático; aprovado |
| R02-T14 | app | intenção B preservada; aprovado |
| R02-T15 | app | sem sobrescrita; aprovado |
| R02-T16 | app | isolamento integral; aprovado |
| R02-T17 | app + tela | elegibilidade atualizada; aprovado |
| R02-T18 | app (3 testes) | jornada retomada; aprovado |
| R02-T19 | hook (3 testes, antes dos efeitos) | sem ações obsoletas; aprovado |
| R02-T20 | hook | dados invalidados; aprovado |
| R02-T21 | suítes existentes `homeReturnEvaluation`/`homeFlow` | preservado; aprovado |
| R02-T22 | `participante01Revisao01.test.cjs` completo | preservado; aprovado |
| R02-T23 | backend serviço/HTTP | replay 201 pré-R02 compatível; aprovado |
| R02-T24 | app (voo único) + backend (integração: 2 testes) | app aprovado; **concorrência real pendente** |

### 11.13 Evidências de diff e Git

- **Patch da revisão:** `qa-evidence/PARTICIPANTE_01_R02-changes.diff`. Base: `970ae10338989bfa002bd457378f0db9ef5d5b2b` (HEAD auditado). Escopo: todas as alterações de código, testes e documentação da R02, exceto o próprio patch. Verificado com `git apply --check` sobre `970ae10`. Os patches anteriores (`PARTICIPANTE_01-changes.diff`, `PARTICIPANTE_01_R01-changes.diff`) foram preservados sem alteração como evidência histórica.
- **Git:** commit e push na `feature/heliom-participante-ux` feitos pelo assistente por pedido explícito do responsável nesta sessão. O `AGENTS.md` da raiz atribui commits ao responsável, e essa instrução direta prevaleceu. Sem force push, sem merge na `develop`, sem integração da `develop`. PARTICIPANTE-02 não iniciada.

### 11.14 Commits da revisão

- `84ffb2aea82128531c41f1a442bb160b63aeeac6`: `fix(participante): garantir reconciliacao segura de intencoes de ingresso` (código, testes, este documento e `qa-evidence/PARTICIPANTE_01_R02-changes.diff`). O código desse commit é idêntico ao working tree testado em 11.11. Depois dos testes mudaram apenas este documento e o patch.
- Commit seguinte: somente este registro de commits no documento.
- Push para `origin/feature/heliom-participante-ux` sem force (`970ae10..84ffb2a`), com a conta `heliom13`, a mesma das entregas anteriores. O SHA final da branch é o do commit de registro, informado no resumo da entrega.

**Estado da task:** Revisão 02 entregue para revalidação — não aprovada.
