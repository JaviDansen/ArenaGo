# ArenaGO — AUTO-QUEUE-01: Atualização Automática das Filas e Alertas do Participante

**Responsável:** Kaled<br>
**Branch:** `feature/participant-auto-queue-sync`<br>
**Prioridade:** P0 — Apresentação em 13/11/2026, às 19h<br>
**Data da Implementação Inicial:** 11/11/2026<br>
**Revisão Técnica e Correções:** 13/11/2026 (correções da auditoria final sobre `d5cad92`)

**Estado desta entrega:** implementação concluída; testes automatizados aprovados; homologação operacional no Expo Go concluída. Integração com `develop` e encerramento no Git permanecem pendentes.

---

## 1. Visão Geral e Objetivos

A task **AUTO-QUEUE-01** implementa a sincronização periódica (polling de 5 segundos) e alertas em tempo real para as filas do participante no ArenaGO:
1. **Fila Externa (Evento):** Acompanhamento da posição de espera (`externalQueue.position`) e transição para participação ativa (`waiting` → `active`) na próxima consulta válida após a liberação pela organização.
2. **Fila Interna (Arena):** Atualização automática da posição na experiência (`currentQueueEntry.position`), contagem de participantes aguardando (`waitingCount`) e detecção de chamada (`waiting` → `called`) com estação. Após conclusão, a entrada corrente desaparece; após ausência, pode desaparecer ou ser substituída por nova entrada `waiting`, conforme o backend.
3. **Alerta de Vibração Local Controlado:** Vibração única no dispositivo móvel quando o participante é chamado enquanto o aplicativo está ativo no primeiro plano. Supressão total de vibração em segundo plano e sem vibração retroativa ao retomar o aplicativo do segundo plano.
4. **Proteção Concorrente e Antirrace:** Bloqueio de consultas simultâneas na fila interna (`syncInFlight`), descarte estrito de respostas defasadas por sequência/geração e invalidação em logout, troca de conta ou perda de foco.
5. **Resiliência e Sinalização Discreta:** Retenção dos últimos dados válidos confirmados em oscilações de rede, exibindo aviso visual discreto (*"Conexão instável. Exibindo as últimas informações confirmadas."*), sem desmontar a tela ou apagar a posição, com remoção automática do aviso na recuperação da conectividade.

---

## 2. Detalhamento das Correções da Revisão Técnica

### 2.1. P1 — Impedir consultas simultâneas e respostas fora de ordem na fila interna (`RealArenaScreen.js`)
- **Controle In-Flight:** `activeReadSeqRef` e `activeReadFocusGenRef` bloqueiam sobreposição de leituras da mesma geração de foco. Uma nova geração pode consultar enquanto a requisição invalidada termina; sua resposta antiga é descartada.
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

### 2.5. P1 — Estabilização da referência de `refresh` e não reinicialização do polling (`RealArenaScreen.js`)
- Adicionada a referência `stateRef = useRef(state)` sincronizada em cada renderização e nas chamadas de `setState`.
- Removido `state` da lista de dependências de `useCallback` em `refresh`, que passa a consultar `stateRef.current` ao decidir entre exibir erro inicial ou sinalizar `syncStale`.
- Com `refresh` e `syncSilent` referencialmente estáveis ao longo da participação ativa, atualizações sucessivas de posição ou estado da fila **não** reiniciam o `useFocusEffect`, **não** recriam o timer de 5 segundos, **não** disparam consultas extras e **não** reenviam `isInitial: true` ao gerenciador de alertas.

### 2.6. P2 — Remoção de condicional envolvendo `useEffect` (`HomeFlowScreen.js`)
- Removido o bloco condicional `if (typeof useEffect === 'function')` em `ExternalQueueScreen`.
- Mantidos ambos os hooks `useEffect` (listener de `AppState` e timer de 5s) diretamente no nível superior do componente.
- Adaptado o mock de `react` em `homeFlow.test.cjs` para expor `useEffect` e `useRef`.

### 2.7. P1 — Invalidação de consultas pendentes durante ingresso ou saída da fila interna (`RealArenaScreen.js`)
- Ao iniciar `join(experienceId)` ou confirmar `finish()`, `readSeqRef.current` é incrementado e o bloqueio de leitura ativa (`activeReadSeqRef.current` / `activeReadFocusGenRef.current`) é zerado antes da operação de escrita.
- Quando `join` retorna estado confirmado (`result.state`), `readSeqRef.current` é novamente avançado, garantindo que nenhuma consulta automática (`syncSilent`) iniciada antes do ingresso possa sobrescrever o estado confirmado se resolver atrasada.
- As proteções de idempotência do `coordinator.join` e o polling de 5 segundos permanecem intactos após a conclusão da operação.

### 2.8. P2 — Preservação de vibração legítima em atualizações manuais (`RealArenaScreen.js`)
- Introduzida a referência `initialReadDoneRef` (resetada apenas quando muda a chave `userId:epoch:participationId` via `lastSessionKeyRef`).
- Apenas a primeira leitura concluída da sessão repassa `isInitial: true` ao `alertManager.checkAndAlert(...)` para registrar chamadas preexistentes sem vibrar.
- Atualizações manuais posteriores acionadas pelo botão *"Atualizar fila e experiências"* repassam `isInitial: false`, permitindo que uma nova chamada (`called`) detectada manualmente dispare exatamente uma vibração.

### 2.9. P2 & Regressão — Controle de leitura ativa por geração/sequência no ciclo de foco (`RealArenaScreen.js` e `autoQueueSync.test.cjs`)
- Substituída a flag booleana simples por `activeReadSeqRef` e `activeReadFocusGenRef`.
- Uma leitura em trânsito só bloqueia novas leituras se pertencer à mesma geração de foco (`activeReadFocusGenRef.current === focusGeneration.current`).
- No `blur`, o bloqueio da geração anterior é limpo; ao recuperar foco, a nova geração inicia imediatamente uma leitura válida sem ficar bloqueada por requisições antigas pendentes.
- No bloco `finally`, uma requisição antiga verifica `if (activeReadSeqRef.current === currentSeq)` e `currentSeq === readSeqRef.current`, impedindo que sua conclusão tardia libere indevidamente o bloqueio ou encerre o `loading` de uma consulta mais recente.
- O teste do Cenário 1 exercita duas gerações de leitura com resolução fora de ordem e confirma que a posição 2 não é substituída pela posição 5; passou na campanha focada registrada na seção 5.

---

## 3. Matriz dos Cenários de Testes Automatizados

O arquivo `app/tests/autoQueueSync.test.cjs` contém os cenários automatizados abaixo. A seção 7 registra os acréscimos e limites da auditoria final:

| # | Cenário Solicitado | Arquivo / Módulo Testado | Descrição da Validação |
|---|---|---|---|
| 1 | Consultas de gerações distintas e respostas fora de ordem | `RealArenaScreen.js` | Consulta 2 (posição 2) resolve antes da Consulta 1 (posição 5); resposta tardia da Consulta 1 é descartada e posição 2 é mantida. |
| 2 | Atualização manual concorrendo com polling | `RealArenaScreen.js` / `participationService.js` | Controle in-flight bloqueia sobreposição de requisições na mesma geração; deduplicação em trânsito. |
| 3 | Resposta tardia após mudança de epoch | `RealArenaScreen.js` | O teste original altera o epoch; não simula uma troca completa de participação nem comprova todos os cenários anunciados em seu nome. |
| 4 | Chamada recebida enquanto app está em segundo plano | `queueAlertService.js` | Quando `isAppActive() === false`, chamada é registrada sem vibrar. |
| 5 | Retomada sem vibração retroativa | `queueAlertService.js` / `RealArenaScreen.js` | Primeira sincronização ao voltar ao primeiro plano não vibra para chamada já ocorrida. |
| 6 | Nova chamada legítima após retomada | `queueAlertService.js` | Nova chamada com nova estação/sessão identificada enquanto o app está ativo dispara vibração. |
| 7 | Ausência de vibrações duplicadas | `queueAlertService.js` | Polling repetido a cada 5s com a mesma chamada não vibra mais de uma vez. |
| 8 | Suspensão e retomada do polling conforme o foco | `RealArenaScreen.js` / `HomeFlowScreen.js` | Intervalo de 5s é cancelado no blur e reativado no foco com um único timer ativo. |
| 9 | Falha de conexão com preservação da posição e aviso visual | `participationService.js` / `HomeFlowScreen.js` / `RealArenaScreen.js` | Dados confirmados permanecem visíveis e aviso discreto é renderizado em ambas as telas. |
| 10 | Recuperação da conexão com remoção do aviso | `participationService.js` / `HomeFlowScreen.js` / `RealArenaScreen.js` | Sucesso na consulta seguinte limpa `syncStale` e oculta o aviso discreto. |
| 11 | Atualizações sucessivas de posição sem reinicializar polling | `RealArenaScreen.js` | Avanço de posições (3 → 2 → 1) mantém `useFocusEffect` intacto, 1 único timer de 5s e sem consultas extras. |
| 12 | Funcionamento da fila externa com hooks incondicionais | `HomeFlowScreen.js` | `useEffect` e `useIsFocused` no nível superior suspendem no blur e retomam no foco. |
| 13 | Concorrência entre polling pendente e ingresso na fila (`join`) | `RealArenaScreen.js` | Consulta antiga iniciada antes de `join()` e resolvida depois não sobrescreve a entrada confirmada (posição 3) e preserva o polling subsequente. |
| 14 | Chamada nova identificada por atualização manual (`refresh`) | `RealArenaScreen.js` / `queueAlertService.js` | Transição `waiting` → `called` detectada por refresh manual produz exatamente 1 vibração, sem repetir no polling seguinte. |
| 15 | Perda e recuperação de foco com consulta pendente | `RealArenaScreen.js` | Nova geração não fica bloqueada pela leitura anterior; resposta antiga não libera lock da nova geração e `isInitial: true` é preservado na primeira leitura concluída. |

---

## 4. Arquivos Alterados

| Arquivo | Modificações Realizadas |
|---|---|
| `app/services/queueAlertService.js` | Adicionados `isResuming` e `suppressVibration`; registro de chaves sem vibração no background; isolamento por conta/sessão/participação. |
| `app/services/participationService.js` | Flag `syncStale` no estado do store; preservação de dados e marcação de instabilidade em falha do `syncCurrentSilent()`. |
| `app/context/ParticipationContext.js` | Exposição da propriedade `syncStale` no contexto para consumo nas telas. |
| `app/screens/home/HomeFlowScreen.js` | Chamada incondicional de `useIsFocused()` e `useEffect()`; aviso discreto de conexão instável sem desmontagem; remoção de `useSafeIsFocused()`. |
| `app/screens/arena/RealArenaScreen.js` | Coordenação `join`/`finish` vs polling; diferenciação de `initialReadDoneRef` em `refresh`; controle de leitura ativa por sequência/geração (`activeReadSeqRef`, `activeReadFocusGenRef`); estabilização via `stateRef`; banner discreto `syncWarningCard`. |
| `app/tests/autoQueueSync.test.cjs` | Cenários preparados de concorrência, respostas fora de ordem, alertas, foco e conexão; regressões da auditoria final detalhadas na seção 7. |
| `app/tests/homeFlow.test.cjs` | Mock explícito de `@react-navigation/native`, `useEffect` e `useRef` para compatibilidade com hooks incondicionais. |
| `app/tests/helpers/questionnaireHarness.cjs` | Fallback seguro para `@react-navigation/native` na resolução de módulos do harness. |

---

## 5. Validação Automatizada (GPT-6 Luna Medium)

Campanha executada pelo GPT-6 Luna (Medium), após confirmação manual do responsável e autorização explícita. Os testes usaram dependências simuladas; não foram executados testes com PostgreSQL real, migrations ou seeds.

### Testes focados

Comando executado no diretório `app`:

```bash
node --test tests/autoQueueSync.test.cjs tests/homeFlow.test.cjs tests/participationService.test.cjs tests/participationProvider.test.cjs tests/arenaQueueService.integration.test.cjs tests/participationActionScreens.test.cjs
```

Resultado: **87 aprovados, 0 falhos, 0 cancelados, 0 ignorados**, código de saída **0**.

### Suíte completa

O comando `npm test` foi inicialmente bloqueado antes de iniciar pelo PowerShell, que impediu carregar `npm.ps1` (código de saída **1**). O launcher equivalente `npm.cmd test` executou o script `node --test tests/*.test.cjs` definido em `app/package.json` e terminou com código **0**: **464 aprovados, 0 falhos, 0 cancelados, 0 ignorados**.

Os avisos de módulos ES reparsados e de depreciação do `react-test-renderer` não provocaram falhas.

---

## 6. Limitações Restantes e Recomendações

1. **Vibração em Dispositivos Físicos:** A homologação não confirmou individualmente a vibração tátil. A API `Vibration` e o comportamento de `AppState` podem depender do dispositivo e exigem confirmação específica em Android/iOS via Expo Go ou build nativo.
2. **Intervalo Fixo de 5 Segundos:** Mantido estritamente em 5 segundos conforme requisito P0. Não foram introduzidas tecnologias baseadas em WebSocket, SSE ou Push Notifications, que permanecem fora de escopo.
3. **Fluxo Git:** Conforme política do `AGENTS.md`, commits e push não foram executados pelo agente; o commit deve ser gerado pelo responsável via VSCode.

## 7. Correções da auditoria final — 13/11/2026

### Alterações nesta rodada

- **P1 / ocupação após blur:** `RealArenaScreen.js` identifica cada operação por um objeto em `operationRef`. A limpeza de `busy` independe da geração de foco e exige a mesma operação, montagem e identidade (`userId`, epoch e participação). A desmontagem invalida o token. Resultados, erros e navegação continuam protegidos pelo foco. Se o foco voltou durante `join()`, uma leitura atual reconcilia o resultado descartado. A mesma limpeza foi aplicada a `finish()`, inclusive na rejeição. A saída confirmada ainda atualiza o contexto da sessão original sem navegar quando não está focada.
- **P2 / retomada:** o listener de `AppState` pertence à montagem e permanece ativo no blur. Suspender invalida a sequência e o bloqueio de leitura anterior. Leituras novas só começam com app ativo; apenas uma leitura válida posterior à retomada consome `resumingFromBackgroundRef`. Falhas e respostas antigas não consomem essa referência. Resultados de `join()` não a consomem. Chamada antiga continua visível sem vibração; nova sessão de atendimento observada depois da referência pode vibrar uma vez.
- **P2 / erro obsoleto:** `readError` guarda falhas de consulta separadamente de `error`, reservado para ações. Sucesso manual ou automático remove somente `readError`, preservando erro de ação pertinente. Uma resposta válida após falha inicial também encerra o loading.
- **P2 / desaparecimento:** `participationService.js` consulta `/participations/return-state` somente ao observar participação existente → `null`. Valida o DTO e publica participação e retorno juntos, sem publicar ausência com retorno antigo. Falha preserva o snapshot anterior com `syncStale`, permitindo nova tentativa enquanto a transição não for confirmada. Após confirmação, ciclos com `null` não repetem a consulta adicional. `refresh()` e a reconciliação usam a mesma validação do retorno.
- O single-flight silencioso agora pertence à geração: requisição antiga não bloqueia outra sessão/refresh nem libera seu lock. O sync não começa enquanto o snapshot está em `loading` por refresh completo.
- A fixture de recuperação preserva o último DTO válido e modifica sua posição; não espalha mais um `Error`. O teste de deduplicação carrega primeiro um snapshot `ready`, como no fluxo real.
- Mocks locais da Arena em `autoQueueSync.test.cjs` e `participationActionScreens.test.cjs` expõem `useEffect`. Os testes novos modelam dependências, montagem, blur, cleanup e promessas controladas; usam o gerenciador real de alertas, com coordenador de rede substituído por mock.

### Cenários adicionais preparados e cobertos pelos testes

- `join()` resolvido/rejeitado, concluindo antes ou depois do retorno ao foco; botões liberados e leitura atual de reconciliação.
- Limpeza tardia da operação antiga preservando a ocupação da nova sessão.
- `join()` e `finish()` concluindo após desmontagem, sem setters tardios e com listener/timer removidos.
- `finish()` resolvido/rejeitado, com conclusão sem foco ou após retornar à Arena.
- Consulta anterior à suspensão resolvida enquanto a consulta de retomada está pendente; chamada antiga sem vibração e chamada posterior com vibração única.
- Background em outra aba, retorno à Arena, ausência com nova entrada `waiting`, nova chamada e remoção da entrada após conclusão/ausência sem reentrada. O teste usa projeções de fila; não executa operações de Staff.
- Falha na consulta de retomada mantendo supressão até a primeira resposta válida.
- Falha inicial de leitura seguida de recuperação automática; polling e refresh manual preservando erro de ação.
- Desaparecimento com publicação conjunta de retorno/pendências, deduplicação em voo e ausência de consultas extras nos ciclos normais.
- Retorno malformado ou falha de rede, preservação do snapshot e nova tentativa.
- Descarte do retorno tardio após logout, conta, epoch ou refresh; sync da nova geração sem bloqueio pela anterior.
- Refresh completo pendente não antecipado por sync silencioso.

### Integração futura com develop

Inspecionados, sem modificar a branch, os contratos de `develop` em `66efaf6c36a8d90d8a032ab930aaa9c6dc83a69d`: `participationService.js`, `ParticipationContext.js` e o fluxo de retorno/avaliação da Home. A branch atual ainda não contém esses mecanismos; esta correção não os importa nem os substitui.

Na integração, preservar integralmente:

1. `suspend()` e `resume()`, incluindo bloqueio por `suspended`, incremento de geração na suspensão e refresh completo ao retomar. As respostas silenciosas também devem respeitar essas guardas. O single-flight por geração evita herdar uma requisição da suspensão anterior.
2. `returnStateVersion`: na publicação conjunta da transição reconciliada, vincular o retorno ao `requestGeneration` validado, como o refresh completo já faz em develop. Uma consulta de posição sem mudança no retorno não deve renovar versão nem limpar decisões de apresentação.
3. `canPresentReturnEvaluation()`, `claimReturnEvaluation()` e `presentedReturnEvaluations`: manter consumo antes da navegação, adiamento por sessão e validações de geração/identidade. Polling não deve limpar esse conjunto. Preservar o fluxo da Home e as proteções de identidade verificada.
4. O listener global do Provider de develop pode desmontar a Arena ao suspender e disparar refresh na retomada. Conciliar os dois listeners sem antecipar snapshots incompletos nem recriar polling a cada posição. Revalidar os testes de retorno/avaliação após a integração; não houve merge nem confirmação de conflito textual nesta rodada.

### Validação e evidência

- **Inspeção estática:** revisão dos fluxos de leitura/escrita, identidade, montagem, foco, suspensão, contratos da develop e diff. `git diff --check` executado com código de saída **0**; isso verifica whitespace do patch e não comprova comportamento funcional.
- **Validações automatizadas executadas pelo Codex com autorização:** GPT-6 Luna Medium; 87 testes focados e 464 testes da suíte completa aprovados, sem falhas, cancelamentos ou ignorados. O primeiro `npm test` não iniciou devido à política do PowerShell (`npm.ps1`); `npm.cmd test` executou a mesma suíte com sucesso. Nenhum teste com PostgreSQL real, migration ou seed foi executado.
- **Homologação operacional manual no Expo Go:** concluída no backend real do ambiente A4. O backend A4 foi executado pela branch `develop` em worktree separado, e o frontend Expo pela branch `feature/participant-auto-queue-sync`. A conta Staff já estava vinculada ao evento; operações Staff foram realizadas pelo PowerShell.
- **Próxima etapa:** integrar cuidadosamente com `develop`, preservando os contratos e as proteções descritos acima, e revalidar retorno/avaliação após a integração. A homologação operacional não integra branches nem encerra a task no Git.
- **Risco residual:** a vibração física não foi aprovada individualmente; os cenários de integração com os mecanismos de retorno/avaliação de `develop` ainda precisam ser revalidados após integrar. A primeira consulta válida de retomada estabelece uma referência conservadora sem vibração e não distingue por horário uma chamada ocorrida entre a retomada e essa consulta.
- **Evidência única:** `qa-evidence/AUTO-QUEUE-01-changes.diff`, cumulativa desde a base comum `b545998420699fe37b387bc2434da6c039ed939b`, incluindo esta rodada e excluindo o próprio arquivo de evidência para evitar autorreferência. Gerada pelo formato nativo de `git diff`, sem staging, commit ou alteração de histórico.

## 8. Homologação operacional no Expo Go

- **Evento:** `Multiestações 2`, mantido aberto para testes futuros.
- **Fluxo:** frontend Expo na branch `feature/participant-auto-queue-sync`, usando backend real do ambiente A4 executado pela branch `develop` em worktree separado. A conta Staff já estava vinculada ao evento; operações Staff foram realizadas pelo PowerShell.
- **Just Dance — Estação 01:** atendimento concluído e estação disponível.
- **Just Dance — Estação 02:** atendimento concluído e estação disponível.
- **Fila interna:** vazia ao final da homologação.
- **Participante:** atualização automática da tela funcionando conforme observado.
- Nenhuma alteração estrutural no banco ou no código foi necessária durante a homologação. Não há confirmação explícita de aprovação individual da vibração física.

## 9. Estado da task

- **Implementação:** concluída.
- **Testes automatizados:** aprovados (87 focados e 464 na suíte completa).
- **Homologação operacional no Expo Go:** concluída para os cenários registrados acima.
- **Integração com `develop`:** pendente; preservar `suspend()`, `resume()`, `returnStateVersion` e as proteções de apresentação única de avaliações descritas na seção de integração.
- **Encerramento no Git:** pendente; não houve staging, commit, push, merge ou rebase.
