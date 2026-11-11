# ArenaGO — AUTO-QUEUE-01: Atualização Automática das Filas e Alertas do Participante

**Responsável:** Kaled  
**Branch:** `feature/participant-auto-queue-sync`  
**Prioridade:** P0 — Apresentação em 13/11/2026, às 19h  
**Data:** 11/11/2026  

---

## 1. Visão Geral e Objetivos

A task **AUTO-QUEUE-01** implementa a atualização contínua e em tempo real (via polling periódico de 5 segundos) das filas do participante no ArenaGO:
1. **Fila Externa (Evento):** Acompanhamento automático da posição de espera (`externalQueue.position`) e transição imediata para participação ativa (`waiting` → `active`) quando a entrada na Arena for liberada pela organização.
2. **Fila Interna (Arena):** Atualização periódica da posição na experiência (`currentQueueEntry.position`), contagem de participantes aguardando (`waitingCount`), detecção de chamada pelo Staff (`waiting` → `called`) com identificação da estação designada, e atualização quando o atendimento for concluído ou a ausência registrada (`currentQueueEntry === null`).
3. **Alerta de Vibração Local:** Vibração única no dispositivo móvel quando o participante autenticado é chamado pelo Staff, sem repetições nos ciclos seguintes de 5 segundos, sem vibração para chamadas antigas na abertura/reconexão e sem alertas em segundo plano.
4. **Resiliência e Atualização Silenciosa:** Sincronização em background sem piscar a tela, sem desmontar componentes, com retenção do último estado confirmado em caso de oscilações de rede.

---

## 2. Arquitetura da Solução

### 2.1. Fila Externa (`participationService.js` e `ParticipationContext.js`)
- Criado o método assíncrono `syncCurrentSilent()` no store de participação:
  - Consulta estritamente `GET /api/v1/participations/current` com autenticação.
  - Não consulta `/participations/return-state` a cada 5 segundos, poupando largura de banda e processamento do backend.
  - Não altera o estado do store para `loading`, evitando desmontagens e piscadas na interface.
  - Implementa proteção contra concorrência (`syncInFlight`): requisições concorrentes são deduplicadas enquanto uma estiver em trânsito.
  - Em falhas de rede transitórias, preserva integralmente os dados já confirmados e a posição do participante.
  - Valida a geração de requisição e a identidade da sessão (`matches(identity)`), descartando respostas tardias após logout ou troca de conta.
- Exposto `syncCurrentParticipation` no `ParticipationContext` para consumo na árvore de navegação.

### 2.2. Polling na Tela da Fila Externa (`HomeFlowScreen.js` / `ExternalQueueScreen`)
- Na tela `ExternalQueueScreen`, configurado intervalo de 5.000 ms (5s) que dispara `syncCurrentParticipation()`.
- Monitoramento de ciclo de vida com `AppState` e `useIsFocused`:
  - Polling suspenso quando o aplicativo entra em segundo plano (`AppState !== 'active'`).
  - Polling suspenso quando a tela perde o foco de navegação (`!isFocused`).
  - Retomada imediata da sincronização quando o aplicativo retorna ao primeiro plano.
  - Limpeza dos timers e listeners ao desmontar o componente.
- Exibição de mensagem informativa discreta: *"A posição na fila é atualizada automaticamente a cada 5 segundos."*
- Preservação do botão manual "Atualizar participação" com o método tradicional `refreshParticipation()`.

### 2.3. Fila Interna e Alertas na Arena (`RealArenaScreen.js` e `arenaQueueService.js`)
- Em `arenaQueueService.js`:
  - A função `parseArenaQueue` passa a expor `serviceSessionId: entry.status === 'called' ? entry.serviceSession.id : null`.
- Em `RealArenaScreen.js`:
  - Implementado `syncSilent`: método assíncrono de leitura periódica via `coordinator.read(context)` a cada 5 segundos.
  - Não aciona indicador de carregamento de tela inteira durante o polling silencioso, preservando botões e visão geral das experiências.
  - Atualização automática das quantidades de pessoas aguardando (`waitingCount`) em cada experiência aberta.
  - Atualização automática quando o Staff finaliza o atendimento ou registra ausência (`currentQueueEntry` passa a `null`), liberando imediatamente a possibilidade de entrar em outra fila.
  - Em oscilações de rede, mantém os dados anteriores confirmados.
  - Ciclo de vida gerido no `useFocusEffect` em conjunto com `AppState`, cancelando timers no blur/desmonte.
  - Atualizada a nota informativa da fila interna: *"A posição e a chamada são atualizadas automaticamente a cada 5 segundos."*

### 2.4. Serviço Dedicado de Alertas (`queueAlertService.js`)
- Criado o gerenciador `createQueueAlertManager({ getIdentity, vibrate, isAppActive })`:
  - Utiliza `Vibration.vibrate(500)` do `react-native`, compatível com Android e iOS, com fallback silencioso caso o hardware ou permissões impeçam a vibração.
  - **Identificador Único da Chamada:** Constrói chave composta por `userId:epoch:participationId:queueEntryId:sessionId`.
  - **Vibração Única:** Dispara a vibração exatamente uma vez na detecção de transição para `called`. As consultas subsequentes de 5 segundos identificam que a chave já foi alertada e não repetem a vibração.
  - **Sem Vibração na Inicialização / Reconexão:** Na carga inicial (`isInitial: true`), o estado atual é registrado no conjunto de chamadas conhecidas sem disparar o motor de vibração.
  - **Primeiro Plano:** Apenas vibra se `isAppActive()` for verdadeiro (`AppState.currentState === 'active'`).
  - **Isolamento de Sessão:** Qualquer troca de conta ou logout invalida os alertas da sessão anterior.

---

## 3. Resumo dos Arquivos Modificados e Criados

| Arquivo | Tipo | Descrição |
|---|---|---|
| `app/services/queueAlertService.js` | Novo | Gerenciador de alertas de chamada, controle de chave de sessão, debounce de 5s e vibração nativa |
| `app/services/participationService.js` | Modificado | Adicionado `syncCurrentSilent()` com proteção in-flight e preservação de estado |
| `app/context/ParticipationContext.js` | Modificado | Exposto `syncCurrentParticipation` para consumo nos componentes |
| `app/screens/home/HomeFlowScreen.js` | Modificado | Polling de 5s, monitoramento de `AppState`/`useIsFocused` e nota visual em `ExternalQueueScreen` |
| `app/services/arenaQueueService.js` | Modificado | Exposto `serviceSessionId` na extração de `currentQueueEntry` |
| `app/screens/arena/RealArenaScreen.js` | Modificado | Sincronização silenciosa a cada 5s, disparo do alerta via `alertManager` e ciclo de vida |
| `app/tests/autoQueueSync.test.cjs` | Novo | 13 testes automatizados cobrindo filas externa/interna, alertas, ciclo de vida e concorrência |
| `app/tests/helpers/questionnaireHarness.cjs` | Modificado | Disponibilizados `setInterval` e `clearInterval` no contexto de execução do harness VM |

---

## 4. Instruções de Validação Automatizada (Luna Medium)

Conforme as regras do `AGENTS.md`, as validações foram preparadas para execução com o executor padrão Luna Medium:

```bash
cd app
node --test tests/autoQueueSync.test.cjs
npm test
```

### Cobertura dos Testes:
1. `queueAlertService`:
   - Disparo de vibração única na nova chamada.
   - Ausência de vibrações repetidas a cada 5s.
   - Bloqueio de vibração para chamadas antigas na carga inicial.
   - Suspensão de alertas em segundo plano.
   - Isolamento de alertas entre contas e sessões distintas.
2. `participationService` e `HomeFlowScreen`:
   - Atualização da posição na fila externa sem piscar a UI.
   - Transição `waiting` → `active`.
   - Preservação da posição em falhas de rede.
   - Deduplicação de requisições concorrentes.
   - Suspensão do polling em segundo plano e retomada no primeiro plano.
3. `RealArenaScreen`:
   - Atualização automática de posição e exibição de estação.
   - Atualização após conclusão/ausência pelo Staff.
   - Preservação de estado em falhas transitórias.
   - Ciclo de vida com cancelamento de timers no blur.

---

## 5. Roteiro de Homologação Integrada (Android & iOS)

### Pré-requisitos do Ambiente:
1. Backend Node.js em execução (`cd backend && npm start` ou Docker).
2. Dois aparelhos ou instâncias móveis: **Participante A** e **Participante B**.
3. Um navegador com a **Área Staff** aberta (`/staff` ou painel web) apontando para o mesmo backend.
4. Evento cadastrado com fila externa e pelo menos uma experiência interna configurada (ex.: PS5, VR).

### Roteiro de Testes:
1. **Entrada na Fila Externa:**
   - Participante A e Participante B entram no evento pelo app.
   - Ambos visualizam a tela "Fila do evento" com suas respectivas posições (ex.: 1º e 2º).
   - Verifique que o texto informa *"A posição na fila é atualizada automaticamente a cada 5 segundos."*
2. **Liberação de Entrada pelo Staff:**
   - Na Área Staff, libere a entrada da fila externa para o Participante A.
   - Observe a tela do Participante A: sem tocar em "Atualizar", em até 5 segundos a tela deve transitar automaticamente para a **Minha Arena** (`status: 'active'`).
3. **Entrada na Fila Interna:**
   - Participante A entra na fila de uma experiência (ex.: "PlayStation 5").
   - A tela passa a exibir o card "Você está na fila" com posição 1º.
4. **Chamada pelo Staff e Alerta de Vibração:**
   - Na Área Staff, chame o Participante A indicando a estação (ex.: "Estação 01").
   - Observe o dispositivo de A:
     - O aparelho vibra **uma única vez**.
     - O card é atualizado automaticamente para **"É a sua vez!"** e informa **"Dirija-se à estação: Estação 01"**.
     - Aguarde 10 a 15 segundos: confirme que o aparelho **NÃO continua vibrando** a cada 5 segundos.
5. **Conclusão pelo Staff:**
   - O Staff clica em "Concluir atendimento".
   - A interface do Participante A atualiza automaticamente em até 5 segundos: o card de chamada desaparece e os botões de entrar nas experiências voltam a ficar disponíveis.
6. **Recuperação de Conexão:**
   - Desative o Wi-Fi do aparelho durante 10 segundos enquanto estiver na fila.
   - Verifique que a tela não pisca nem exibe erro fatal, mantendo a última posição exibida.
   - Reative o Wi-Fi e confirme a retomada da atualização.

---

## 6. Status de Homologação

- **Android:** Preparado para validação em dispositivo físico via Expo Go pelo responsável (Kaled).
- **iOS:** Reservado para homologação pelo responsável de homologação iOS. Não declarar aprovação antes da execução com o build/dispositivo correspondente.
