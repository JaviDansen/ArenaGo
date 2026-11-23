# PARTICIPANTE-01 — Home e jornada de ingresso

**Task:** PARTICIPANTE-01 de 05 — Reformulação da Home e jornada de ingresso
**Responsável pela implementação:** Heliom
**Módulo:** Participante (frontend Expo)
**Branch:** `feature/heliom-participante-ux`
**Origem:** `origin/develop` em `5758fe1dcda104f6bfacf3ddb922a3711b088298` (19/11/2026, "style(admin): atualizar logo exclusiva do cabecalho")
**Estado atual:** entregue para revisão (aguardando análise do responsável; não aprovada)

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
