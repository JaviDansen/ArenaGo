# ArenaGO — AUTO-QUEUE-01: Atualização Automática das Filas e Alertas do Participante

**Responsável:** Kaled<br>
**Branch:** `feature/participant-auto-queue-sync`<br>
**Prioridade:** P0 — Apresentação em 13/11/2026, às 19h<br>
**Data da Implementação Inicial:** 11/11/2026<br>
**Revisão Técnica e Correções:** 11/11/2026 (após revisão do commit `2de957b`)

---

## 1. Visão Geral e Objetivos

A task **AUTO-QUEUE-01** implementa a sincronização periódica (polling de 5 segundos) e alertas em tempo real para as filas do participante no ArenaGO:
1. **Fila Externa (Evento):** Acompanhamento contínuo da posição de espera (`externalQueue.position`) e transição imediata para participação ativa (`waiting` → `active`) quando liberada pela organização.
2. **Fila Interna (Arena):** Atualização automática da posição na experiência (`currentQueueEntry.position`), contagem de participantes aguardando (`waitingCount`), detecção de chamada pelo Staff (`waiting` → `called`) com identificação da estação designada, e liberação imediata após conclusão do atendimento ou registro de ausência (`currentQueueEntry === null`).
3. **Alerta de Vibração Local Controlado:** Vibração única no dispositivo móvel quando o participante é chamado enquanto o aplicativo está ativo no primeiro plano. Supressão total de vibração em segundo plano e sem vibração retroativa ao retomar o aplicativo do segundo plano.
4. **Proteção Concorrente e Antirrace:** Bloqueio de consultas simultâneas na fila interna (`syncInFlight`), descarte estrito de respostas defasadas por sequência/geração e invalidação em logout, troca de conta ou perda de foco.
5. **Resiliência e Sinalização Discreta:** Retenção dos últimos dados válidos confirmados em oscilações de rede, exibindo aviso visual discreto (*"Conexão instável. Exibindo as últimas informações confirmadas."*), sem desmontar a tela ou apagar a posição, com remoção automática do aviso na recuperação da conectividade.

---

## 2. Detalhamento das Correções da Revisão Técnica

### 2.1. P1 — Impedir consultas simultâneas e respostas fora de ordem na fila interna (`RealArenaScreen.js`)
- **Controle In-Flight:** Adicionada a referência `syncInFlightRef`. Se uma consulta de leitura já estiver em trânsito (seja pelo polling silencioso ou pelo refresh manual inicial/acionado pelo usuário), novas consultas não são iniciadas em paralelo, evitando sobreposição de tráfego HTTP.
- **Identificação de Sequência e Geração:** Introduzida a referência de sequência incremental `readSeqRef` e validação com `focusGeneration`, `finishedRef` e `authRef`.
- **Descarte de Respostas Tardias:** Quando a resposta assíncrona do `coordinator.read(context)` é resolvida, ela é estritamente descartada se:
  - Uma leitura posterior já foi disparada ou concluída (`currentSeq !== readSeqRef.current`);
  - A tela perdeu o foco ou desmontou (`!focused.current || focusGeneration.current !== currentFocusGen`);
  - O participante encerrou a participação (`finishedRef.current`);
  - A sessão ou conta autenticada mudou (`userId`, `epoch` ou `isAuthenticated` divergentes).
- **Preservação de Ações:** O botão manual "Atualizar fila e experiências" é desabilitado enquanto `busy || loading`, eliminando requisições redundantes.

### 2.2. P1 — Eliminação de vibração retroativa ao retornar do segundo plano (`queueAlertService.js` e `RealArenaScreen.js`)
- **Detecção de Retomada:** Em `RealArenaScreen.js`, o listener de ciclo de vida do `AppState` identifica a transição de segundo plano (`background` / `inactive`) para primeiro plano (`active`), sinalizando `resumingFromBackgroundRef.current = true`.
- **Supressão Controlada no Gerenciador:** No `queueAlertService.js`, a função `checkAndAlert` suporta os parâmetros `isResuming` e `suppressVibration`. Se o aplicativo estava em segundo plano ou está processando a primeira consulta de retomada:
  - O identificador da chamada (`callKey`) é registrado no conjunto `alertedCallKeys`;
  - A participação é registrada em `initializedParticipations`;
  - Nenhuma chamada ao motor `vibrate()` é efetuada (`false`).
- **Detecção em Segundo Plano:** Se uma consulta ocorrer enquanto `!isAppActive()`, a chave é salva de imediato sem vibrar, garantindo que o retorno ao primeiro plano não gere vibração tardia.
- **Alertas Legítimos Posteriores:** Quando o participante continua no primeiro plano e uma *nova* chamada é recebida (com nova `serviceSessionId` ou identificador), a vibração é disparada normalmente.
- **Aviso Visual Garantido:** A interface renderiza o card "É a sua vez!" e a estação designada com base no estado do servidor, independentemente de a vibração ter sido suprimida por motivo de ciclo de vida.

### 2.3. P2 — Chamada incondicional do hook `useIsFocused()` (`HomeFlowScreen.js`)
- Removida completamente a função `useSafeIsFocused()`, que utilizava `require()` dinâmico e bloco `try/catch`.
- Importado diretamente `useIsFocused` de `@react-navigation/native` no nível superior do arquivo.
- Invocado `const isFocused = useIsFocused();` de forma incondicional no topo de `ExternalQueueScreen`, cumprindo estritamente as Regras dos Hooks do React.
- Atualizado o harness de testes (`questionnaireHarness.cjs` e `homeFlow.test.cjs`) com mock padronizado para `@react-navigation/native`, garantindo execução estável em ambiente Node.js.

### 2.4. P2 — Aviso visual discreto de instabilidade de conexão (`participationService.js`, `HomeFlowScreen.js`, `RealArenaScreen.js`)
- **Armazenamento de Estado:** Adicionada a propriedade `syncStale: boolean` ao snapshot do `createParticipationStore` e exposta via `ParticipationContext`.
- **Fila Externa:**
  - Em caso de erro temporário durante `syncCurrentSilent()`, o store preserva a participação e a posição confirmadas, marcando `syncStale: true`.
  - A `ExternalQueueScreen` renderiza um aviso discreto: *"Conexão instável. Exibindo as últimas informações confirmadas."*, sem desmontar nem navegar para tela de erro.
  - O texto informativo de atualização substitui a frase padrão por *"Tentando restabelecer conexão automaticamente..."*.
  - Ao reconectar com sucesso, `syncStale` retorna a `false` e o aviso é removido imediatamente.
- **Fila Interna:**
  - Em `RealArenaScreen.js`, falhas no `syncSilent()` ativam `syncStale: true`.
  - Exibe banner discreto no topo do conteúdo da tela sem limpar o card da fila ou as experiências.
  - A nota da fila interna informa que a conexão oscilou e está tentando reconectar.
  - No próximo polling bem-sucedido, o banner é removido e a nota volta à indicação regular de 5 segundos.

---

## 3. Matriz dos 10 Cenários de Testes Automatizados

O arquivo `app/tests/autoQueueSync.test.cjs` foi atualizado para cobrir expressamente os 10 cenários especificados:

| # | Cenário Solicitado | Arquivo / Módulo Testado | Descrição da Validação |
|---|---|---|---|
| 1 | Consultas simultâneas e respostas fora de ordem | `RealArenaScreen.js` | Resposta antiga com posição 5 descartada após chegada de resposta mais nova com posição 2. |
| 2 | Atualização manual concorrendo com polling | `RealArenaScreen.js` / `participationService.js` | `syncInFlight` bloqueia sobreposição de requisições; deduplicação em trânsito. |
| 3 | Resposta tardia após logout ou troca de participação | `RealArenaScreen.js` | Resposta resolvida após o logout do usuário é descartada sem atualizar o estado. |
| 4 | Chamada recebida enquanto app está em segundo plano | `queueAlertService.js` | Quando `isAppActive() === false`, chamada é registrada sem vibrar. |
| 5 | Retomada sem vibração retroativa | `queueAlertService.js` / `RealArenaScreen.js` | Primeira sincronização ao voltar ao primeiro plano não vibra para chamada já ocorrida. |
| 6 | Nova chamada legítima após retomada | `queueAlertService.js` | Nova chamada com nova estação/sessão identificada enquanto o app está ativo dispara vibração. |
| 7 | Ausência de vibrações duplicadas | `queueAlertService.js` | Polling repetido a cada 5s com a mesma chamada não vibra mais de uma vez. |
| 8 | Suspensão e retomada do polling conforme o foco | `RealArenaScreen.js` / `HomeFlowScreen.js` | Intervalo de 5s é cancelado no blur e reativado no foco. |
| 9 | Falha de conexão com preservação da posição e aviso visual | `participationService.js` / `HomeFlowScreen.js` / `RealArenaScreen.js` | Dados confirmados permanecem visíveis e aviso discreto é renderizado em ambas as telas. |
| 10 | Recuperação da conexão com remoção do aviso | `participationService.js` / `HomeFlowScreen.js` / `RealArenaScreen.js` | Sucesso na consulta seguinte limpa `syncStale` e oculta o aviso discreto. |

---

## 4. Arquivos Alterados

| Arquivo | Modificações Realizadas |
|---|---|
| `app/services/queueAlertService.js` | Adicionados `isResuming` e `suppressVibration`; registro de chaves sem vibração no background; isolamento por conta/sessão/participação. |
| `app/services/participationService.js` | Flag `syncStale` no estado do store; preservação de dados e marcação de instabilidade em falha do `syncCurrentSilent()`. |
| `app/context/ParticipationContext.js` | Exposição da propriedade `syncStale` no contexto para consumo nas telas. |
| `app/screens/home/HomeFlowScreen.js` | Chamada incondicional de `useIsFocused()`; aviso discreto de conexão instável sem desmontagem; remoção de `useSafeIsFocused()`. |
| `app/screens/arena/RealArenaScreen.js` | Controle in-flight `syncInFlightRef`; controle de sequência `readSeqRef`; descarte de respostas defasadas/sessão; supressão de vibração na retomada; banner discreto `syncWarningCard`. |
| `app/tests/autoQueueSync.test.cjs` | Cobertura estruturada dos 10 cenários da especificação. |
| `app/tests/homeFlow.test.cjs` | Mock explícito de `@react-navigation/native` para compatibilidade com o hook de foco. |
| `app/tests/helpers/questionnaireHarness.cjs` | Fallback seguro para `@react-navigation/native` na resolução de módulos do harness. |

---

## 5. Instruções para Validação Automatizada (Luna Medium)

Conforme a seção 2 do `AGENTS.md`, as validações automatizadas foram preparadas durante a implementação e devem ser executadas pelo modelo **GPT-6 Luna (Medium)**:

```bash
# Validação focada dos cenários de atualização automática e alertas
cmd.exe /c "cd app && node --test tests/autoQueueSync.test.cjs"

# Validação do fluxo de navegação da Home
cmd.exe /c "cd app && node --test tests/homeFlow.test.cjs"

# Bateria completa de testes do aplicativo
cmd.exe /c "cd app && npm test"
```

---

## 6. Limitações Restantes e Recomendações

1. **Vibração em Dispositivos Físicos:** Testes de vibração física exigem dispositivo Android/iOS real via Expo Go ou build nativo. Em emuladores de desktop, a API `Vibration` pode não produzir vibração tátil perceptível.
2. **Intervalo Fixo de 5 Segundos:** Mantido estritamente em 5 segundos conforme requisito P0. Não foram introduzidas tecnologias baseadas em WebSocket, SSE ou Push Notifications, que permanecem fora de escopo.
3. **Fluxo Git:** Conforme política do `AGENTS.md`, commits e push não foram executados pelo agente; o commit deve ser gerado pelo responsável via VSCode.
