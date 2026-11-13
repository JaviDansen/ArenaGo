# ArenaGo — Estação operacional Staff

## Objetivo e escopo

Integrar a estação de experiência com o backend real: fila compartilhada da experiência, chamada pendente da estação, chamada do próximo, conclusão, ausência e remoção manual de uma entrada ainda em espera. A seleção de evento, experiência e estação continua vindo das consultas Staff autorizadas. O Controle de Entrada, as telas demonstrativas, a área Admin e os fluxos do participante não foram alterados nesta entrega.

## Contratos

- `GET /api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state`: exige sessão autenticada e concessão Staff vigente para o evento. Responde `eventId`, `experienceId`, `stationId`, `availability`, `canCall`, `waitingCount`, `waiting` em FIFO (`queueEntryId`, `displayName`, `position`) e `pending` da estação (`serviceSessionId`, `queueEntryId`, `displayName`, `calledAt`) ou `null`. A leitura usa transação `REPEATABLE READ READ ONLY`. A identificação nominal é limitada ao nome já cadastrado; não retorna e-mail, telefone, código de acesso ou dados de avaliação. Sessão inválida recebe 401; recurso inexistente ou sem concessão recebe 404 neutro.
- `POST /api/v1/staff/events/:eventId/experiences/:experienceId/queue-entries/:queueEntryId/remove`: exige Bearer, concessão Staff, corpo vazio e `Idempotency-Key`. Fecha exclusivamente uma entrada `waiting` e limpa o ponteiro da participação, mantendo a participação `active`. Retorna `eventId`, `experienceId`, `queueEntry: {id, status: "closed", closeReason: "staff_queue_removed"}` e `participation: {id, status: "active", currentQueueEntryId: null}`. Idempotência, efeito e auditoria são concluídos na mesma transação. Concorrentes adquirem locks na ordem evento, experiência, participação e entrada. Um replay da mesma chave retorna o resultado registrado; outra chave para entrada já removida recebe conflito. Não executa conclusão, ausência nem cancelamento da participação no evento.
- Reutilizados sem alteração de rota: `POST .../stations/:stationId/call-next`, `POST .../service-sessions/:serviceSessionId/complete`, `POST .../service-sessions/:serviceSessionId/absent`, e as consultas de eventos, experiências, estações e fila da experiência.

As duas rotas novas respondem com `Cache-Control: no-store`, inclusive quando a autenticação falha. IDs são validados como UUID. O cliente não fornece `userId` ou `sessionId`; ambos vêm do principal autenticado. O backend escolhe o próximo da fila, nunca a tela.

## Interface e recuperação

`StaffStationOperationalScreen` aparece somente após selecionar uma estação da lista real e revalida conta, sessão, evento, estação, geração e revisão de identidade antes de publicar respostas. Exibe a experiência, a disponibilidade, a fila nominal compartilhada e a chamada pendente da estação. Confirmar uma ação exige diálogo. O resultado confirmado aparece na tela; a ausência informa se houve reinserção. Consultas são atualizadas manualmente e após resultado. Não há polling.

O coordenador Staff grava intenção `reserved`, depois `dispatching`, antes do POST. Todas as mutações usam chave idempotente e desabilitam retry automático de POST após 401. Timeout, erro de rede ou resposta inválida deixam a intenção bloqueada para reconciliação, sem novo envio. O recibo terminal é persistido antes de remover a intenção e exige reconhecimento pelo `receiptId`. Intenções de outra sessão, evento ou estação continuam bloqueando novas operações na conta. A web, sem armazenamento seguro equivalente ao SecureStore, permite leitura e bloqueia mutações.

## Arquivos desta entrega

- `backend/src/events/staff-station-state.service.ts` e `.controller.ts`.
- `backend/src/events/staff-queue-removal.service.ts` e `.controller.ts`.
- `backend/src/events/events.module.ts`.
- `app/screens/staff/StaffStationOperationalScreen.js` e `StaffEventsNavigator.js`.
- `app/services/staffOperationsService.js` e `staffIntentStorage.js`.
- `backend/test/unit/staff-station-operational.test.ts`, `staff-station-operational-http.test.ts` e `helpers/staff-station-fixture.ts`.
- `app/tests/staffOperationsService.integration.test.cjs`, `roleRoutingIntegration.test.cjs` e `staffDemoState.test.cjs`.
- Este relatório e `qa-evidence/STAFF_STATION_OPERATIONAL-changes.diff`.

As alterações locais preexistentes do Controle de Entrada foram preservadas. A evidência desta entrega deve conter apenas o delta da estação.

## Testes e validação

Foram preparados cenários de consulta nominal mínima, fila FIFO, chamada pendente, sessão revogada, concessão ausente, remoção idempotente, duas remoções concorrentes, rollback de auditoria, autenticação e validação HTTP, resposta 500 sanitizada, reserva local antes do POST, reinício com intenção de remoção e isolamento do recibo. A integração simulada de navegação percorre seleção de evento e estação e uma chamada via cliente autenticado. Os testes existentes de Admin, participante, Controle de Entrada e isolamento da demonstração permanecem como regressão necessária.

Na validação inicial, o cenário de auditoria falhou porque Drizzle preserva o marcador privado em `cause`, enquanto o teste verificava a mensagem externa. A fixture de navegação usava `userId` que não era UUID, impedindo o coordenador de ler a intenção persistida. A correção verifica a causa real, o estado após rollback e a execução de `ROLLBACK`, fornece UUID válido à conta Staff e move a fixture comum para um módulo sem testes, eliminando cinco execuções duplicadas. O teste HTTP continua verificando 500 sanitizado, `no-store` e ausência do marcador privado.

Na campanha posterior à correção, autorizada pelo responsável, os dois arquivos focados do backend executaram **10 testes: 10 aprovados, 0 falhos e 0 ignorados**. O cenário isolado de navegação executou **1 teste aprovado**; a regressão focada do app, incluindo Controle de Entrada, executou **149 testes: 149 aprovados, 0 falhos e 0 ignorados**. Os typechecks de produção e testes do backend passaram. O backend foi compilado em diretório temporário e os testes executados com Node, pois o `tsx` havia falhado na inicialização com `uv_os_get_passwd / ENOMEM` na campanha anterior. Nenhum build de distribuição ou teste físico PostgreSQL foi executado.

## Limites e decisões pendentes

- A política de produto após remoção manual ainda precisa definir se a pessoa poderá ingressar novamente na **mesma** fila. Esta entrega preserva as regras atuais de ingresso: a remoção não cria uma proibição nova. Cada ingresso futuro, se permitido pelo servidor, gera entrada e posição novas.
- A ausência de política contratual de retenção de idempotência e de consulta histórica para esta nova remoção impede o aplicativo de liberar automaticamente uma intenção `dispatching` com resultado incerto. A migration preparatória 0007 não ativa proteção de origem/retenção para esta operação. Nenhuma retentativa automática foi introduzida.
- O bloqueio de armazenamento é serializado no runtime do aplicativo. A coordenação entre aparelhos depende das transações, restrições e chaves do servidor; os testes simulados não comprovam o comportamento físico PostgreSQL.
- A leitura nominal pode refletir um snapshot que começou imediatamente antes de uma revogação concorrente. Cada nova requisição revalida sessão e concessão. A homologação real e a revisão de segurança ainda são necessárias antes de liberar botões operacionais.
