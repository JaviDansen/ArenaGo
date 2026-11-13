# Consulta histórica das operações Staff

## Escopo e contrato

Consultas GET autenticadas de leitura, com `Idempotency-Key` no cabeçalho, sem corpo:

- `/api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/history/call-next`
- `/api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/history/complete`
- `/api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/history/absent`

Os UUIDs usam a mesma validação e normalização das operações Staff. A chave segue o contrato existente: uma única ocorrência, não vazia, até 128 caracteres e sem controles. A identidade da conta e a sessão são obtidas exclusivamente do principal autenticado. As respostas têm `Cache-Control: no-store`, inclusive quando o guard de autenticação recusa a requisição.

Uma sessão inválida ou expirada recebe 401; evento inexistente e concessão ausente recebem 404 neutro. O serviço consulta novamente sessão, conta ativa, TOTP quando aplicável, e concessão Staff vigente para o evento, com e-mail confirmado. O resultado é lido pelo ator autenticado, nome da operação, chave e fingerprint dos recursos. Admin sem concessão Staff não recebe acesso. A leitura ocorre numa transação `REPEATABLE READ READ ONLY`, sem locks de fila nem métodos de execução operacional; autorizações e dados seguem o mesmo snapshot. Uma revogação confirmada depois do snapshot pode não ser observada pela consulta já em andamento.

Para um registro terminal válido a resposta é `200` com `{ kind: "recorded", originSession: "unavailable", automaticReconciliation: false, result: {...} }`. `result` contém somente o formato mínimo correspondente ao resultado original de chamada, conclusão ou ausência, validado e projetado a partir do histórico; não representa o estado atual da fila. Os campos de identificação de experiência, estação ou atendimento são conferidos contra o fingerprint e a referência armazenada. Campos adicionais no JSON persistido não são devolvidos.

Após a revisão Sol High, a projeção passou a exigir timestamps no formato canônico produzido pelos serviços com `toISOString()`: data e horário completos em UTC, milissegundos e sufixo `Z`, com verificação de ida e volta para rejeitar datas inexistentes. A ordem de reentrada deve ser uma string decimal inteira entre `1` e `9223372036854775807`, validada com `BigInt` sem perda de precisão. Um payload incompatível retorna `unknown`.

Quando não houver prova histórica utilizável, a resposta é `200` com `{ kind: "unknown", originSession: "unavailable", automaticReconciliation: false }`. Isso inclui registro inexistente, removido, escopo divergente, resultado inconsistente e registro `in_progress` visível. A reserva e a conclusão normalmente ocorrem na mesma transação: uma reserva ainda não confirmada é invisível para esta leitura, e um registro `in_progress` isolado não comprova que um processo ainda está trabalhando. Nenhuma dessas respostas autoriza repetir o POST ou gerar outra chave.

## Sessão e limite de segurança

`idempotency_operations` não guarda o `sessionId` de origem. O backend pode verificar a sessão de consulta e a conta autora, mas não provar se o registro foi produzido pela sessão atual ou por uma sessão anterior da mesma conta, inclusive depois de restauração ou novo login. `originSession: "unavailable"` é obrigatório mesmo para `recorded`; **o resultado não deve liberar nem reconhecer automaticamente uma intenção persistida**. Após perda da concessão, troca de conta ou revogação da sessão de consulta, a consulta é recusada conforme a autorização atual.

Para reconciliação automática futura será necessário um contrato persistente que vincule de forma imutável a sessão de origem à reserva e ao resultado, com política explícita para registros legados, nova sessão e revogação. Isso exige avaliar alteração de schema e migration em etapa própria; nenhuma foi criada ou executada aqui. Mesmo com a mesma chave e fingerprint, a remoção física seguida de reutilização pode criar novo registro e impede provar que ele corresponde à intenção antiga.

## Retenção e idempotência

`STAFF_IDEMPOTENCY_TTL_SECONDS` é obrigatório e positivo; a política calcula `expires_at` na criação. O helper de reserva existente não filtra `expires_at`: enquanto a linha existir, inclusive após esse instante, o POST encontra a restrição única e pode reproduzir seu resultado ou detectar conflito. Esta consulta também lê registros expirados ainda presentes. Não foi encontrado expurgo automático no código de produção inspecionado; testes de integração contêm limpeza de suas próprias fixtures. A presença da coluna ou do índice de expiração não garante retenção física, prazo mínimo ou ausência de limpeza externa/manual.

Se uma linha for apagada, o backend atual não mantém tombstone e uma nova execução com a mesma chave pode ser aceita. O cliente deve manter a intenção despachada bloqueada, inclusive após reinício e logout, e nunca usar ausência histórica como prova de que pode repetir. Uma garantia entre dispositivos ou após remoção exige política de retenção verificável e mecanismo durável no servidor, ainda pendentes. Este GET não executa limpeza e não modifica o comportamento dos POSTs.

## Integração futura e validação

O coordenador poderá consultar o GET com a chave já persistida e o escopo original, somente após verificar conta, sessão, evento e recursos atuais. Nesta etapa, mesmo `recorded` é evidência histórica informativa, não um recibo automaticamente reconhecível, pois não há vínculo com a sessão de origem nem garantia contra reutilização depois de exclusão. As consultas não liberam intenções persistidas automaticamente; as operações Staff reais permanecem desabilitadas e os botões operacionais não foram conectados.

Arquivos de implementação: `backend/src/events/staff-history.controller.ts`, `backend/src/events/staff-history.service.ts` e registro no `events.module.ts`. Os testes em `backend/test/unit/staff-history.test.ts` e `backend/test/unit/staff-history-http.test.ts` usam persistência e transporte simulados. A campanha cobriu os contratos `recorded` e `unknown`; timestamps ISO canônicos, parciais e inexistentes nas três operações; limites BIGINT e valores inválidos de `queueOrder`; falha de leitura, propagação e rollback sem SQL mutante; e HTTP 500 com `INTERNAL_SERVER_ERROR`, `Cache-Control: no-store` e resposta sem marcador privado. Um cenário usa controller, guard e serviço reais com persistência simulada para revalidar sessão e concessão Staff após o guard. Esses testes não comprovam retenção física em banco real nem coordenação entre dispositivos.

Sol High revisou estaticamente a implementação inicial sem identificar problemas P0–P2; as três pendências P3 foram corrigidas antes da validação. Luna Medium executou a campanha autorizada: 14 testes focados aprovados e 1.168 testes unitários aprovados em 65 arquivos, em ambos os casos com zero falhas e zero ignorados. Os typechecks de produção e de testes, a compilação temporária isolada e `git diff --check` também foram aprovados.

O comando padrão com `tsx` falhou antes de iniciar os testes com `uv_os_get_passwd / ENOMEM`. A execução utilizou o fallback de compilação temporária e Node, com `NODE_ENV=test` e `EVALUATION_IDEMPOTENCY_TTL_SECONDS=60` somente nos processos de teste. A campanha não acessou Neon nem executou migrations, seeds ou operações Staff reais. Não houve homologação em banco real nesta etapa.
