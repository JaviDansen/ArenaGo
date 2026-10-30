# E07.3 — saída voluntária da fila interna

Implementação de 30/10/2026 em `feature/events-participations`, HEAD de referência
`5d7fae1217eb28a4be2610660245a6b8dacc4f7a`. O working tree inicial já continha a
E07.2 sem commit e o checkout auxiliar `audit-1647dd6/`. A E07.2 foi preservada,
incluindo seu relatório, tipos, testes e patch; o checkout auxiliar ficou fora
da entrega. Sem staging, commit, push ou auditoria técnica consolidada.

**Fechamento posterior — 30/10/2026:** a revalidação PostgreSQL foi concluída
pelo responsável, após a correção pontual das fixtures, e a auditoria consolidada
terminou APROVADA COM RESSALVAS. O registro final ao fim deste documento contém
a sequência 23/27 → correção 42P08 → 27/27 e os executores das verificações.
As pendências descritas nas rodadas anteriores são históricas e foram mantidas.

## Arquivos próprios desta rodada

| Arquivo | Alteração E07.3 |
| --- | --- |
| `backend/src/events/queue-withdrawal.service.ts` | Novo serviço mutador interno. |
| `backend/src/events/queue-withdrawal.types.ts` | Input/resultado próprios da saída. |
| `backend/src/events/events.module.ts` | Registro aditivo, mantendo os serviços E07.1/E07.2. |
| `backend/test/unit/queue-withdrawal.test.ts` | 19 testes novos. |
| `backend/test/integration/queue-withdrawal.integration.test.ts` | 27 testes PostgreSQL próprios, pendentes. |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | §16.2 registra o contrato interno implementado, sem HTTP. |
| `docs/PLANEJAMENTO_ARENAGO.md` | Estado da implementação C-15 e trabalho atual; históricos preservados. |
| `docs/E07_3_IMPLEMENTACAO.md` | Este relatório. |
| `qa-evidence/e07-3-changes.diff` | Snapshot cumulativo contra HEAD, conforme a seção de evidência. |

Inspecionados C-15/§16, relatórios E07.1/E07.2, serviços de ingresso/consulta,
helpers E03, schemas, FKs/checks, migrações e testes. Não foram alterados os
mutadores E07.1, a consulta/snapshot E07.2, testes anteriores ou módulos do Kaled.
Não há endpoint, controller, DTO público, Expo, migração ou comandos Staff novos.

## Contrato técnico interno

```ts
QueueWithdrawalService.withdrawExperienceQueue({
  userId, participationId, queueEntryId, idempotencyKey, expiresAt,
}): Promise<WithdrawExperienceQueueResult>
```

userId e UUIDs de sintaxe válida vêm de chamador confiável. A tentativa alvo é
obrigatória: não se resolve uma intenção antiga buscando o ponteiro mais recente.
expiresAt é explícito como na E03; não se cria política de TTL/expurgo.

Sucesso `kind: 'withdrawn'` ou `kind: 'replay'` contém participationId,
queueEntryId, experienceId, `status: 'closed'`, closedAt: Date e serviceSession
null ou `{ id, status: 'canceled', resolvedAt: Date }`. `withdrawn` é somente um
discriminador do resultado da operação; **não é estado persistido**. Datas do
contrato são UTC/ISO, com resolução de milissegundos de Date.

| Resultado sem saída nova | Significado |
| --- | --- |
| access_denied | Participação ausente/alheia ou tentativa ausente/de outra participação; resposta neutra. |
| participation_not_active | Titular com participação externa/terminal; não a reativa. |
| entry_not_current | A tentativa explícita já foi encerrada; não atua na tentativa posterior. |
| event_ended | O estado/prazo operacional efetivo impediu o UPDATE decisivo. |
| request_conflict | Ator/operação/chave já usados com outra participação/tentativa. |
| in_progress | Reserva anterior persistida incompleta; sem novo efeito de domínio. |

Inputs inválidos e inconsistências internas geram exceção e rollback.
QueueWithdrawalIntegrityError distingue ponteiro incoerente, estados desconhecidos,
called sem pending, vínculos incorretos e contagem inesperada de linhas afetadas.
As mensagens não contêm IDs privados. Não há catálogo público de erros congelado.

### Motivos e autoria

Escolha técnica mínima: `participant_queue_withdrawal` em queue_entries.close_reason
e, para called, service_sessions.cancel_reason. Cabe em varchar(40). Schema e
migração 0004 admitem os estados closed/canceled e exigem os instantes/motivos,
sem enum fechado de motivos; nenhuma alteração de schema foi necessária.
resolved_by_user_id recebe o titular confiável, identificando ação do participante,
sem inferir Staff. Esses valores não são nova decisão de produto nem contrato HTTP.

## Transação, locks e revalidação

Uma transação READ COMMITTED, sem executor raiz dentro dela:

1. Descobrir evento/experiência da tentativa explícita, filtrando usuário,
   participação, queueEntryId e coerência de evento. A leitura não autoriza mutação.
2. Bloquear events FOR SHARE e experiences FOR UPDATE do mesmo evento.
3. Reconsultar entrada/atendimento após a espera na experiência. Uma chamada que
   venceu antes do mutex agora aparece como called e determina a estação correta.
4. Se called possui atendimento, stations FOR UPDATE antes de participations.
   Não exigir disponibilidade available para desistir.
5. participations FOR UPDATE, queue_entries FOR UPDATE e service_sessions FOR
   UPDATE; revalidar titularidade, evento, experiência, estado e IDs descobertos.
   Mudança fora do protocolo de locks é integridade, não motivo para adquirir
   estação tardiamente e inverter a ordem.
6. Reservar/reconhecer a intenção pelo helper genérico E03. Replay/conflito vêm
   antes de exigir condições atuais para uma saída nova. Reserva nova bloqueada
   é revertida, nunca confirmada sozinha.
7. Exigir participação active, entrada waiting/called corrente e, para called,
   exatamente um pending válido; waiting não pode possuir atendimento.
8. UPDATE decisivo da entrada usa um CTE materializado com clock_timestamp() e
   exige estado do evento diferente de closed e instante estritamente anterior
   aos prazos operacional e administrativo aplicável. Exige também o ponteiro,
   titularidade e estado corrente. Zero linhas implica event_ended e rollback.
9. Cancelar somente o pending bloqueado, limpar somente o ponteiro daquela entrada
   e concluir a idempotência no mesmo commit, conferindo cada linha afetada.

Fila pausada, perda de Staff/estações e corte oficial/início de fechamento controlado
não impedem saída preexistente na janela residual. Não se reutiliza a avaliação
de **novos ingressos** da E02 para decidir desistência. Fechamento imediato usa
admin_deadline_at igual à solicitação; no limite definitivo nenhuma nova saída
é fabricada e nenhum estado terminal é reativado. Igualdade já está fora da janela.

closed_at é gerado no PostgreSQL. resolved_at é copiado diretamente de closed_at
no banco, preservando microssegundos iguais entre as escritas; Date é usado só
na resposta mínima. Não se alteram disponibilidade da estação, contadores FIFO,
queue_order, status da participação, arena_entered_at, histórico ou conclusões.
Uma falha posterior reverte tudo, inclusive a reserva idempotente.

O commit pode suceder o instante decisivo: não se promete precisão de commit em
milissegundos. Os escritores concorrentes precisam seguir locks e condições de
estado compatíveis; não há retentativa automática indiscriminada de deadlocks.

## Idempotência e tentativas posteriores

Namespace `withdraw_experience_queue`, usando reserveIdempotencyOperationWithTx,
completeIdempotencyOperationWithTx e createRequestFingerprint existentes da E03.
Fingerprint inclui participação e queueEntryId; ator integra a chave UNIQUE.
Resultado mínimo é persistido com referência à entrada e status técnico 200,
sem criar rota HTTP. Retenção/expurgo permanece uma política explícita futura.

Mesma intenção retorna resposta original sem repetir cancelamento, mesmo após
encerramento ou entrada posterior. Chave antiga aplicada a outra tentativa dá
request_conflict. Chave nova aplicada à tentativa antiga encerrada dá
entry_not_current. Ausência que criou nova fila não muda o alvo da desistência
antiga. Um novo ingresso E07.1 continua exigindo outra intenção e todas as guardas
de admissão, recebendo novo ID/ordem. E07.2 lê null após a saída e recalcula a
posição dos demais por count, sem renumerar ninguém.

## Testes escritos e evidência de concorrência

19 testes unitários E07.3, além dos 126 existentes no estado local inicial.
Usam Drizzle e driver simulado; verificam contratos, fingerprint, locks, SQL de
corte, titularidade, replay, integridade, linhas afetadas e rollback solicitado.
Não são demonstração de concorrência nativa.

27 testes PostgreSQL E07.3, ainda não executados, cobrem:

- waiting/called, participação active, cancelamento pending, ponteiro, timestamps
  iguais, disponibilidade intacta, conclusões anteriores e outras pessoas.
- Compatibilidade com ingresso/consulta reais E07.1/E07.2 e posição recalculada.
- Titularidade neutra, participação externa/terminal, integridade e nenhum resíduo.
- Retry sequencial e concorrente, chaves diferentes, conflito e tentativa posterior.
- Disputa nas duas ordens com chamada, conclusão, ausência, finalização e ingresso;
  ausência vencedora cria nova entrada protegida da intenção antiga.
- Fechamento controlado/imediato, janela residual, encerramento depois da saída
  e prazo operacional/administrativo atingido durante espera real.
- Falhas após fechar entrada, cancelar pending, limpar ponteiro e concluir
  idempotência. Cada fase exige marcador próprio, estado parcial real no tx,
  snapshot integral restaurado e retry reutilizável da chave.

As corridas retêm a primeira transação após suas escritas e antes do commit,
ou após a leitura bloqueante da fila ocupada antes do rollback do ingresso.
A segunda usa PID independente. pg_stat_activity/pg_blocking_pids devem provar
que ela espera pela primeira; só então a barreira libera a transação vencedora.
Não se deduz sobreposição de Promise.all ou de sleep fixo. Recursos são drenados
e clientes devolvidos também em falha. O teste temporal confirma xact_start antes
do corte, espera o prazo do relógio PostgreSQL e exige bloqueio após liberar o lock.

**Limite importante:** não existem serviços E08–E10 implementados nesta rodada.
Seus escritores são emulações SQL de fixture, com locks/condições reais, para
exercitar o protocolo. Não é homologação end-to-end de comandos Staff futuros.
Eles devem revalidar pending/ponteiro e nunca sobrescrever uma resolução terminal.
Não foi criado trigger/migração que proíba qualquer UPDATE SQL arbitrário externo.

## Validações executadas e pendentes

Resultados da implementação inicial, preservados como histórico; a correção
pontual posterior de fixtures está registrada na subseção seguinte.

| Verificação efetivamente executada | Resultado |
| --- | --- |
| `npm.cmd --prefix backend test` | 145/145 aprovados, zero falhas/cancelamentos/skips, exit 0: 126 anteriores + 19 E07.3. |
| `npm.cmd --prefix backend run typecheck:test` | Aprovado, exit 0, incluindo integrações. |
| `npm.cmd --prefix backend run lint` | Aprovado, exit 0. |
| `npm.cmd --prefix backend run build` | Aprovado, exit 0. |
| PostgreSQL específico e regressão completa | NÃO executados; três URLs explícitas ausentes. |

Unitários executaram com dotenv direcionado a NUL e URL local sem conexão. A
execução usa o acesso já necessário ao tsx nesta sessão para contornar o problema
conhecido de consulta ao usuário Windows na sandbox. Nenhuma URL/credencial de
.env foi carregada. Sem conexões PostgreSQL, sondagem, migrations, DROP, TRUNCATE,
reset ou seed nesta rodada. Os resultados 21/21 e 129/129 da E07.1, informados pelo
responsável, não são atribuídos à E07.2/E07.3 ou a esta rodada.

### Correção pontual de fixtures — PostgreSQL 42P08 (30/10/2026)

O responsável informou erros 42P08 na execução dos 27 testes específicos. Não
foi fornecida contagem de aprovações/falhas daquela execução; nenhum resultado
PostgreSQL é presumido a partir desse relato.

A inspeção confirmou a mistura de tipos do mesmo parâmetro em duas consultas:
a atribuição a uma coluna varchar coexistia com casts explícitos para text nas
condições CASE, causando inferência inconsistente do parâmetro. O schema atual
declara participations.status, events.status e events.closure_mode como varchar.
Foram alteradas exclusivamente estas consultas em
`backend/test/integration/queue-withdrawal.integration.test.ts`:

- UPDATE participations do teste de participação externa/terminal: `$2::varchar`
  na atribuição de status e nas três condições CASE.
- UPDATE events de mutate(): `$3::varchar` na atribuição de closure_mode e na
  condição do fechamento controlado; status recebe `$2::varchar`, compatível com
  a coluna. Nenhum valor, condição de negócio ou expectativa foi alterado.

Os 27 testes e suas assertions foram preservados. Nenhum serviço E07.3/E07.1/
E07.2, outro módulo, migration ou banco foi alterado nesta correção. Além da
fixture, somente este relatório e o patch cumulativo foram atualizados.

O preflight de ambiente encontrou DATABASE_URL, DATABASE_DIRECT_URL e
EVENTS_TEST_DATABASE_URL ausentes no processo. O responsável decidiu
explicitamente deixar a execução PostgreSQL pendente para si. Não foram
carregados arquivos .env nem abertas conexões.

| Verificação desta rodada de correção | Resultado real |
| --- | --- |
| 27 testes PostgreSQL específicos | Não executados; sem exit code do runner. Validação da correção no PostgreSQL pendente. |
| Regressão PostgreSQL completa | Não executada; 176 testes previstos, sem resultado nem exit code. |
| Unitários, typecheck, lint e build | Não repetidos nesta rodada; a sequência solicitada depende da aprovação dos 27 específicos. Resultados anteriores permanecem na tabela histórica. |

Não há nova falha de execução a relatar nesta rodada, pois os runners não foram
iniciados. A correção SQL ainda precisa ser confirmada no banco autorizado;
falhas adicionais devem ser relatadas integralmente antes de qualquer mudança
adicional no serviço. Os comandos da seção seguinte permanecem válidos.

Conferência desta rodada: somente fixture, relatório e evidência cumulativa
alterados; 213 dos 216 arquivos presentes no início ficaram idênticos por
SHA-256. Patch regenerado contra o mesmo HEAD 5d7fae1, preservando E07.2/E07.3
anteriores, com reconstrução de 14/14 arquivos e reverse-check; diff sem erro de
whitespace nas alterações próprias, índice vazio e branch/HEAD inalterados.
Sem staging, commit, push ou auditoria consolidada.

## Execução manual segura pendente

Configurar DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL no processo,
idênticas e exclusivamente para `127.0.0.1:55432/arenago_events_test`, sem query
params, com credenciais locais explícitas. O teste valida as três antes de importar
serviços/configuração ou abrir pools e desabilita dotenv. O banco deve estar pronto;
não executar migrations/seed como parte desta validação. Nunca exibir credenciais.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
# Definir explicitamente as três URLs locais autorizadas nesta sessão.
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/queue-withdrawal.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar falha E07.3 antes da regressão completa.' }
npm.cmd run test:integration
```

Esperados, ainda não comprovados por execução: 27 testes específicos E07.3 e
176 na regressão completa (129 anteriores + 20 E07.2 + 27 E07.3). Os 20 testes
E07.2 também continuam pendentes no estado local recebido. Manter as URLs explícitas
e dotenv desabilitado na regressão, pois ela inclui suítes anteriores.
Fixtures têm UUIDs próprios; a limpeza transacional remove apenas registros de
seus eventos/usuários, incluindo idempotência, na ordem das FKs. Pools são fechados
mesmo em erro de limpeza. Não há limpeza global nem dados pessoais reais.

## Evidência, preservação e continuidade

`qa-evidence/e07-3-changes.diff` é **cumulativo contra o HEAD real 5d7fae1**:
contém E07.2 já presente no início e a implementação E07.3. Inclui os arquivos
novos/modificados da entrega local e a evidência E07.2 preservada, sem reescrevê-la.
Não é um patch incremental para reaplicar sobre uma árvore que já contém E07.2.
Exclui o próprio patch E07.3 e `audit-1647dd6/`. A proveniência da E07.2 permanece
no relatório/patch originais; a lista inicial desta nota identifica só esta rodada.

Conferência final: 190 dos 193 arquivos presentes no início permaneceram idênticos
por SHA-256; os três arquivos existentes alterados são somente EventsModule e os
dois documentos canônicos listados acima. O patch reconstrói em memória 14/14
arquivos idênticos ao working tree a partir de 5d7fae1 e passa em
`git apply --reverse --check`; `git diff --check` passa e o índice permanece vazio.
Os arquivos novos próprios também não contêm whitespace final indevido. A evidência
E07.2 incluída mantém seus espaços sintáticos de contexto de diff sem alteração.

E07.1/E07.2, tipos/testes/evidência anteriores e módulos do Kaled foram preservados,
salvo adição no módulo compartilhado e atualização dos documentos pertinentes.
Sem staging/commit/push, alteração de .env/credenciais/infraestrutura, reset,
stash, rebase, merge, PR ou auditoria consolidada. A próxima revisão do conjunto
E07.1–E07.3 fica reservada à etapa posterior definida pelo responsável.

Pendências reais: executar PostgreSQL e regressão; validar os escritores Staff/
finalização/fechamento futuros contra o protocolo; congelar apenas futuramente
catálogo público/HTTP e política de retenção/expurgo. Nenhuma nova decisão de
produto foi inferida desses detalhes técnicos internos.

## Fechamento documental E07.1–E07.3 — registro posterior de 30/10/2026

Este registro acrescenta as evidências finais fornecidas pelo responsável e o
parecer da auditoria consolidada já concluída. Não substitui os relatos anteriores
de não execução pelo Codex, as pendências então existentes ou seus resultados.

### Sequência de execução e correção E07.3

1. **Primeira execução PostgreSQL pelo responsável:** 23/27 testes aprovados e
   quatro falhas 42P08. A contagem completa, ainda não informada quando foi
   escrita a nota de correção acima, foi fornecida neste fechamento. O erro
   decorria da inferência inconsistente de parâmetros nas duas consultas de
   fixture: atribuições a colunas varchar combinadas com casts text nos CASEs.
2. **Correção pontual anterior:** uniformizados os casts `::varchar` no UPDATE
   participations (atribuição de status e três condições com `$2`) e no UPDATE
   events de mutate() (closure_mode e CASE com `$3`, status compatível com `$2`).
   Somente os casts dessas consultas foram alterados; serviços, assertions,
   expectativas e os 27 testes foram preservados. A rodada de correção não
   executou PostgreSQL pelo Codex e registrou corretamente a pendência à época.
3. **Revalidação final pelo responsável:** 27/27 E07.3 e 176/176 na regressão
   completa aprovados, zero falhas, cancelamentos ou skips. O responsável também
   confirmou 20/20 testes específicos E07.2 aprovados, sem falhas, cancelamentos
   ou skips. Nenhum defeito funcional bloqueante do serviço foi confirmado.

### Evidências finais e autoria

| Verificação final | Executor | Resultado |
| --- | --- | --- |
| PostgreSQL específico E07.2 | Responsável | **20/20 aprovados**, zero falhas, cancelamentos ou skips. |
| PostgreSQL específico E07.3 corrigida | Responsável | **27/27 aprovados**, zero falhas, cancelamentos ou skips. |
| Regressão completa PostgreSQL | Responsável | **176/176 aprovados**, zero falhas, cancelamentos ou skips. |
| Unitários completos | Codex, na auditoria consolidada | **145/145 aprovados**, zero falhas, cancelamentos ou skips, exit 0. |
| Typecheck | Codex, na auditoria consolidada | Exit 0. |
| Lint | Codex, na auditoria consolidada | Exit 0. |
| Build | Codex, na auditoria consolidada | Exit 0. |

PostgreSQL foi executado pelo responsável no banco local autorizado
`127.0.0.1:55432/arenago_events_test`. Esses resultados não são execuções do Codex
ou do auditor. Na auditoria consolidada, o Codex não tinha as três URLs explícitas,
não acessou PostgreSQL e identificou a evidência como execução externa. Os
145/145 e os exits 0 acima foram efetivamente reexecutados pelo Codex naquela
auditoria; não são novas execuções deste fechamento documental.

### Parecer e dependências futuras

| Objeto auditado | Parecer |
| --- | --- |
| E07.1 — ingresso | Aprovada. |
| E07.2 — consulta | Aprovada. |
| E07.3 — desistência | Aprovada. |
| Integração E07.1–E07.3 | **Aprovada com ressalvas.** |

Nenhum defeito funcional bloqueante foi confirmado. O achado baixo de falta do
registro da revalidação externa é tratado por este fechamento; o parecer da
auditoria permanece APROVADO COM RESSALVAS, sem nova auditoria nesta rodada.

Continuam como dependências futuras, sem caracterizar falhas atuais ou homologação
antecipada:

1. **Expurgo/idempotência:** definir e validar a política antes de implementar
   remoção de registros. O expiresAt atual não executa expurgo. Validar a perda
   de replay após remoção, especialmente no ingresso E07.1; a tentativa explícita
   da E07.3 protege a entrada posterior contra a desistência antiga.
2. **Escritores Staff reais:** homologar seus locks, transições condicionais e
   interações com E07.1–E07.3 quando forem desenvolvidos. As fixtures SQL atuais
   não equivalem à homologação desses serviços futuros.

Este fechamento altera somente documentação e a evidência cumulativa
`qa-evidence/e07-3-changes.diff`, mantendo a base
`5d7fae1217eb28a4be2610660245a6b8dacc4f7a`, as alterações anteriores e a exclusão
do próprio patch e de `audit-1647dd6/`. Nenhum serviço, teste, schema, migration
ou outro módulo foi alterado. Sem nova execução de testes, auditoria, conexão a
banco, staging, commit, push, merge, reset ou rebase.
