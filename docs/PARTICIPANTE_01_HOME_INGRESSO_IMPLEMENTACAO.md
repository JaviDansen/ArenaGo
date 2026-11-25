# PARTICIPANTE-01 — Home e jornada de ingresso

**Task:** PARTICIPANTE-01 de 05 — Reformulação da Home e jornada de ingresso
**Responsável pela implementação:** Heliom
**Módulo:** Participante (frontend Expo)
**Branch:** `feature/heliom-participante-ux`
**Origem:** `origin/develop` em `5758fe1dcda104f6bfacf3ddb922a3711b088298` (19/11/2026, "style(admin): atualizar logo exclusiva do cabecalho")
**Estado atual:** Revisão 01 entregue para revalidação (não aprovada). Ver §10.

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

**Estado da task:** Entregue para revalidação — não aprovada.
