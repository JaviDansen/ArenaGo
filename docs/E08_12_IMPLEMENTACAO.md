# E08.12 — Consultas, cancelamento externo e saída voluntária da Arena

## Preparação e escopo

Implementação conjunta das quatro rotas em 04/11/2026, branch
`feature/events-participations`, sobre o HEAD inicial
`d1d1bb1ede5ef466a90facd0ef582189a9747aaf`
(`feat(events): implementar envio e edição de avaliações`). E08.11 commitada;
working tree, índice e lista de arquivos não rastreados inicialmente limpos.
Snapshot inicial registrado em `%TEMP%/arenago-e0812-before-Fb0Yan/snapshot.json`.
Nenhuma alteração preexistente incorporada.

Consultados os contratos §§15.1, 15.6–15.9 e 16 da arquitetura, D03/D06/C-15 do
planejamento, relatórios E08.2/E08.9/E08.10/E08.11 e serviços, schema e helpers
transacionais correspondentes. As quatro rotas não existiam. As consultas
internas E05 já existentes permanecem intactas, preservando seus chamadores e
tipos `Date`; o novo contrato HTTP tem projeção temporal e precisão próprias.
Não há migrações, novas dependências ou alterações nos serviços E07.1–E07.6.

Base anterior informada pelo responsável: **517 unitários** e **752 PostgreSQL**
aprovados até E08.11. Esses resultados não aprovam antecipadamente a E08.12.

## Contratos HTTP efetivos

Prefixo `/api/v1`, Bearer e sessão válida em todas as rotas. Ator exclusivamente
de `CurrentUserId`; UUID, corpo ou query string não conferem acesso a terceiros.
Staff/Admin usam somente suas próprias participações, com a exigência de 2FA
Admin já existente. Não há autorização administrativa implícita.

| Método e rota | Sucesso | Resultado |
| --- | --- | --- |
| `GET /participations/current` | 200 | `{ participation: objeto ou null }` |
| `GET /participations/:participationId` | 200 | `{ participation: objeto }`, inclusive histórico |
| `POST /participations/:participationId/cancel` | 200, inclusive replay | Participação `canceled` |
| `POST /participations/:participationId/finish` | 200, inclusive replay | Participação `finished` e projeção de avaliação |

DTO público comum: `id`, `eventId`, `status`, `joinedAt`, `arenaEnteredAt`,
`finishedAt`, `finishReason` e `externalQueue`. A fila é
`{ position: número inteiro positivo seguro, observedAt: instante UTC }` somente
para espera externa efetiva; nos demais estados é `null`. Datas preservam seis
casas de microssegundos, formatadas pelo PostgreSQL, sem passagem por `Date`.
O objeto ampliado `event` da proposta opcional da §15.7 não foi acrescentado:
mantém-se o DTO de participação existente, identificando o evento por `eventId`.
Não se expõem autor, perfis, questionários, tokens ou a lista de participantes.

Os POSTs exigem `Idempotency-Key` única no cabeçalho, não vazia, até 128 caracteres
e sem controles. Aceitam `{}` ou corpo ausente. UUID inválido, propriedades extras,
identidade/motivo/timestamp fornecidos pelo cliente, JSON inválido e tipos de
conteúdo inadequados seguem os validadores/filtro existentes. Query strings não
fornecem identidade ou campos de mutação. `current` é registrado antes do caminho
genérico; `history`/`return-state` da E08.10 são registrados antes deste controller.

| Condição | HTTP / código |
| --- | --- |
| Nenhuma participação corrente efetiva | `200 { participation: null }` |
| ID inexistente ou de terceiro | Mesmo `404 RESOURCE_NOT_FOUND` |
| Token/sessão inválidos, revogados ou 2FA exigido | `401`, códigos existentes da autenticação |
| Entrada ou cabeçalho inválido | `400 VALIDATION_ERROR`; JSON malformado segue `BAD_REQUEST` |
| Cancelamento sobre estado diferente de waiting | `409 PARTICIPATION_NOT_WAITING` |
| Saída sobre estado diferente de active | `409 PARTICIPATION_NOT_ACTIVE` |
| Corte definitivo ou fechamento lógico já atingido | `409 EVENT_OPERATION_ENDED` |
| Mesma chave com outro recurso/intenção | `409 IDEMPOTENCY_KEY_REUSED` |
| Intenção persistida em andamento | `409 IDEMPOTENCY_IN_PROGRESS` |
| Integridade/falha SQL inesperada | `500 INTERNAL_SERVER_ERROR` |

Conflitos de estado/prazo incluem somente a participação própria atualizada na
extensão `participation` do problema RFC 7807. Não alteram seu estado nem
confirmam uma nova intenção. Mensagem interna constante
`PARTICIPATION_LIFECYCLE_INTERNAL_ERROR`, com causa interna preservada, evita
exposição de SQL/dados pelo filtro HTTP existente.

## Consultas, posição e encerramento lógico

`ParticipationQueryService` usa uma instrução SQL dentro de
`REPEATABLE READ READ ONLY`. Participação, posição externa e relógio são observados
no mesmo snapshot, sem N+1, reserva idempotente, locks de linha ou limpeza.
A posição conta as participações `waiting` do mesmo evento com ordem menor ou
igual à do titular, diretamente em PostgreSQL. Ordem histórica `bigint` não é
convertida para número JavaScript; somente a contagem validada pode ser retornada.
Cancelamento/liberação aparece no próximo snapshot sem atualizar posições em massa.

O instante vem de uma única CTE materializada com `clock_timestamp()`. O prazo
definitivo é `LEAST(operational_deadline_at, admin_deadline_at)`; o argumento Admin
nulo não elimina o prazo operacional. A E08.12 extraiu esse SQL e a escolha de
motivo automático de `EventClosureService` para `event-closure.projection.ts` e
fez o próprio regularizador reutilizá-los. A E08.9 conserva os mesmos predicados,
motivos, timestamps, locks e efeitos; não há segunda regra de prazo.

Se o prazo já foi atingido, ou o evento já está fechado, uma linha corrente
persistida é projetada como `finished`, com instante lógico e motivo original
automático/administrativo, nunca `voluntary`. `current` retorna `null` e o detalhe
por ID retorna esse terminal efetivo. Waiting residual de fechamento controlado
usa `closure_requested_at` e `admin_controlled_external_wait_closed`, como E08.8.
Um terminal já persistido mantém integralmente seu timestamp e motivo.

Uma revisão pontual identificou a propagação de `NULL` no predicado de espera
quando não existe fechamento Admin. A expressão foi corrigida com `COALESCE`
antes da entrega; sem isso, a posição poderia ficar ausente. Nenhum teste
PostgreSQL foi executado pelo Codex para alegar aprovação dessa expressão.

**Limite preservado de integração:** os cinco GETs e as escritas de avaliações
E08.10/E08.11 continuam usando o estado persistido e a política oficial existente.
Antes do job regularizar uma participação apenas logicamente encerrada, `current`
já é `null`, mas histórico/pendência/retomada de avaliação aguardam a finalização
física. Depois dela, data/motivo coincidem com o detalhe projetado e a avaliação
depende das conclusões reais. Esta task não fabrica pendência, não executa o job
durante GET e não muda o contrato de elegibilidade das avaliações.

## Cancelamento externo, saída completa e C-15

| Ação | Estado e efeito |
| --- | --- |
| Cancelar espera externa | `waiting → canceled`, `external_wait_withdrawal`, perde a posição |
| Desistir só da fila interna C-15 | Mantém `active`, encerra apenas a tentativa explícita |
| Sair da Arena | `active → finished`, `voluntary`, resolve eventual fila/chamada corrente |

Cancelamento externo grava `finished_at` no instante decisório PostgreSQL, conserva
o histórico e não cria avaliação, sessão ausente ou efeito em outra participação.
Uma liberação concorrente para active prevalece quando vencer: o cancelamento
recebe conflito com o estado atualizado. Fechamento lógico controlado de waiting
também impede convertê-la em cancelamento voluntário.

Saída da Arena não exige conclusão anterior. Sem fila interna, finaliza sem criar
entrada ou atendimento. Com waiting, fecha a entrada corrente e limpa o ponteiro.
Com called/pending, fecha a entrada, cancela somente esse pending, registra o
titular como resolvedor e limpa o ponteiro. Motivo técnico de entrada/atendimento:
`participation_voluntary_finish`, distinto da desistência interna C-15.

Todas as datas relacionadas são copiadas de `participations.finished_at` dentro
do PostgreSQL. Não se criam ausência ou conclusão artificiais. Conclusões, seus
responsáveis/timestamps e snapshots anteriores ficam intactos. A estação é
liberada pela ausência de pending; sua configuração `available/unavailable` não
é alterada. Não há campo de ocupação inventado nem liberação forçada de estação
indisponível.

Além do DTO comum, finish responde `completedServicesCount` e
`evaluationEligibility: { eligible, hasSubmitted }`, calculados por
`evaluationReadProjection`/`eligibility` oficiais, no mesmo tx e instante.
Com completed real, a participação finalizada pode aparecer em pending e receber
POST de avaliação; sem completed, a saída é válida e a avaliação não é elegível.
Nova entrada legítima passa por E03, usa outro `participationId` e snapshot próprio.

## Transação, locks e concorrência

As mutações usam `READ COMMITTED` e a seguinte ordem:

1. Descobrir a participação filtrada pelo titular, sem lock exclusivo.
2. Reservar/reconhecer a intenção durável.
3. Bloquear evento `FOR UPDATE` e descobrir a fila corrente sob esse lock.
4. Bloquear experiência e, se houver chamada, estação `FOR UPDATE`.
5. Bloquear participação, revalidar titularidade e reconhecer eventual replay.
6. Bloquear entradas e atendimento; verificar ponteiro, vínculos e estados.
7. Capturar `clock_timestamp()` no UPDATE decisivo, depois de todas as esperas;
   revalidar prazo/estado e verificar linhas afetadas.
8. Resolver fila/pending, projetar resposta e concluir intenção no mesmo commit.

O lock exclusivo do evento segue a ordem usada por E03 e encerramentos Admin/job.
Ele estabiliza a descoberta inclusive se outra operação antes da espera trocar
a experiência corrente. Evita adquirir lock de experiência depois de participação
e evita tratar uma tentativa antiga como fila atual. Os escritores E07 preservam
seus locks de evento antes dos demais recursos.

**Limitação técnica:** essa estratégia conservadora serializa as mutações do
evento durante a curta transação de saída/cancelamento, incluindo outras pessoas.
Não há alegação de teste de carga ou otimização de throughput. GETs permanecem
MVCC sem locks de linha.

Se Staff concluir primeiro, sua conclusão permanece e a saída usa a fila atual
revalidada. Se ausência reencaminhar primeiro, a saída resolve a nova entrada.
Se a saída vencer, o pending fica canceled e complete/absent posteriores recebem
conflito. Disputas com chamada e C-15 seguem a mesma ordem, sem perda de ponteiro.
Admin imediato/job que vença mantém seu motivo; controlled deixa os active sair
voluntariamente antes do prazo residual, conservando os waiting já finalizados.
Depois do corte definitivo não há nova mutação voluntária, mesmo após espera.

Não se exigem guardas de novo ingresso para sair: após o corte oficial, a saída
continua permitida até o corte definitivo. Qualquer falha intermediária reverte
participação, fila, sessão e intenção; não existe commit parcial de `in_progress`.

## Idempotência e TTL

Namespaces estáveis e distintos: `cancel_external_participation` e
`finish_arena_participation`. Fingerprint contém operação, versão semântica,
ator, recurso e payload vazio normalizado; o ator também compõe a chave única
existente. Corpo ausente e `{}` representam a mesma intenção.

Mesma chave/intenção retorna exatamente o corpo histórico e status 200. TTL
vencido e prazo encerrado não reexecutam a intenção persistida nem mudam seu
resultado. Replay exige autenticação e titularidade atuais, sem exigir estado
corrente novamente. Outra chave sobre participação já terminal recebe conflito;
outra participação com a mesma chave/namespace conflita. Atores distintos e os
dois namespaces não compartilham resultados. Não há expurgo/retenção novos.

Reutilizado **somente o TTL técnico explícito**
`PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS`, já obrigatório para ações do
participante. Essa configuração não carrega semântica de domínio: namespaces e
fingerprints de cancelamento/saída são próprios, separados de ingresso e C-15.
Não foi necessária nova variável nem fallback silencioso. `Date.now()` continua
restrito a calcular `expiresAt` técnico, sem decidir prazos do negócio.

## Arquivos e reuso

| Arquivo | Alteração |
| --- | --- |
| `backend/src/participations/participation-lifecycle.controller.ts` | Quatro rotas, validação e problemas RFC 7807 |
| `backend/src/participations/participation-lifecycle.dto.ts` | DTO público estrito e validação de replay |
| `backend/src/participations/participation-query.service.ts` | Snapshot/posição e projeção temporal sem escrita |
| `backend/src/participations/participation-lifecycle.service.ts` | Cancelamento e saída atômicos, locks e idempotência |
| `backend/src/events/event-closure.projection.ts` | Prazo e motivo SQL compartilhados |
| `backend/src/events/event-closure.service.ts` | Reuso mecânico das mesmas expressões da E08.9 |
| `backend/src/events/events.module.ts` | Registro, exportação e ordem dos controllers |
| `backend/test/unit/participation-lifecycle.test.ts` | 39 testes de DTO/projeção, transação, erros e idempotência |
| `backend/test/unit/participation-lifecycle-http.test.ts` | 28 testes HTTP simulados, autenticação, roteamento e DI |
| `backend/test/integration/participation-lifecycle.integration.test.ts` | 89 testes PostgreSQL reais para execução manual |
| `backend/test/integration/evaluation-read.integration.test.ts` | Compatibilidade pontual da asserção current da E08.10 com o contrato E08.12 |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | Atualizações pontuais de §15 e §16.2 |
| `docs/E08_12_IMPLEMENTACAO.md` | Este relatório |

Reutilizados guard/session auth, `CurrentUserId`, validadores HTTP, política de
TTL existente, helpers de reserva/conclusão duráveis, política oficial de
avaliações e fixtures PostgreSQL existentes. Não há implementação duplicada de
elegibilidade ou substituição dos testes PostgreSQL por mocks. A única atualização
de expectativa de uma etapa anterior é a asserção current da E08.10 descrita abaixo,
necessária para compatibilidade com o contrato implementado na E08.12.

## Validação executada pelo Codex

| Verificação | Resultado |
| --- | --- |
| Específicos unitários e HTTP simulados | **67/67 aprovados**: 39 + 28 |
| Regressão unitária completa | **584/584 aprovados**, 0 falhas, cancelamentos ou skips |
| `npm.cmd run typecheck:test` | Aprovado, incluindo os novos testes PostgreSQL sem executá-los |
| `npm.cmd run lint` | Aprovado |
| `npm.cmd run build` | Aprovado |

Foram adicionados 67 unitários à base de 517. Os checks foram repetidos após a
correção do predicado SQL nulo; ajustes anteriores de tipagem dos doubles não
mudaram as asserções. Os testes unitários/HTTP simulados usam doubles e URL local
inoperante, com `.env` desativado. Nenhum PostgreSQL real foi executado pelo Codex.

Os **67 específicos**, **584 unitários**, typecheck, lint e build foram novamente
executados e aprovados após a correção do cenário de disponibilidade descrita
abaixo. Nesta correção, somente o teste de integração, este relatório e a evidência
foram atualizados; serviços de produção e fixtures compartilhadas foram preservados.

### Primeira execução PostgreSQL e correção do cenário E08.5

O responsável informou a primeira execução manual focada: **89 executados,
88 aprovados e 1 falha**. A regressão completa de **841 testes não foi executada**,
pois a guarda interrompeu o fluxo após a falha focada.

O cenário original era `E08.12 PostgreSQL saída cancela pending e conserva
disponibilidade real false`. A instrução que falhou foi a asserção
`assert.equal((await station(c)).status,200)`, então na linha 161 do arquivo
`backend/test/integration/participation-lifecycle.integration.test.ts`.
`called(c)` já havia criado um atendimento pending naquela estação. A chamada
`station(c)` tenta desativá-la pela API E08.5; o POST de saída voluntária ainda
não havia sido executado quando a asserção falhou.

**Classificação: erro na preparação/implementação do teste.**
`StationAvailabilityService.setAvailability` consulta o pending da estação e,
antes do UPDATE, retorna `station_has_pending_call` ao solicitar unavailable.
`StationAvailabilityController` traduz esse resultado em
**409 `STATION_HAS_PENDING_CALL`**, conforme a regra aprovada E08.5. O HTTP 409
observado estava correto; a expectativa de desativação bem-sucedida naquele
estado contrariava o contrato. Não houve evidência de defeito na saída voluntária
nesse cenário nem necessidade de alterar produção, schema ou constraints.

Os dois casos de disponibilidade foram estruturados como dois testes explícitos,
mantendo a contagem **89** e reforçando as asserções:

- **Available com pending:** cria called/pending e outra pessoa elegível waiting;
  confirma que tentar desativar retorna `STATION_HAS_PENDING_CALL`, sem alterar
  o estado. Exige HTTP 200 da saída, participação finished/voluntary sem ponteiro,
  entrada closed e sessão canceled com o mesmo timestamp, motivo e resolvedor
  esperados. Confirma disponibilidade available e uma próxima chamada HTTP 201
  para a outra pessoa, com novo pending.
- **Unavailable sem pending:** cria duas pessoas waiting, confirma inexistência
  de sessões e desativa legitimamente a estação pela API, exigindo HTTP 200.
  Exige HTTP 200 da saída da primeira pessoa, finalização e fechamento de sua
  entrada no mesmo instante. Confirma disponibilidade unavailable, recusa da
  próxima chamada com `STATION_UNAVAILABLE`, nenhuma sessão criada e preservação
  da entrada waiting e do ponteiro da outra pessoa.

Nenhuma saída passou a aceitar conflito como sucesso. A regra E08.5, os serviços
de produção, as fixtures compartilhadas e os demais cenários não foram alterados.

### Segunda execução PostgreSQL e compatibilidade do contrato E08.10

Após a correção da preparação do cenário de disponibilidade, o responsável
confirmou **89/89 específicos E08.12 aprovados**. A correção anterior foi, portanto,
validada manualmente. Na mesma rodada, a regressão completa executou **841 testes**,
com **840 aprovados e 1 falha**, sem cancelamentos ou testes ignorados; os
específicos também não tiveram cancelamentos ou ignorados.

A falha ocorreu na verificação do resultado em
`backend/test/integration/evaluation-read.integration.test.ts`, teste
`E08.10 PostgreSQL parâmetros e cursor malformados recebem 400 sem consultar outra identidade`.
A instrução antiga na linha 132 era
`problem(await get(actor, "/participations/current"), 404, "RESOURCE_NOT_FOUND")`.
A conta criada por `account()` não possuía participação corrente. O endpoint
retornou corretamente HTTP **200** e corpo **`{ "participation": null }`**.

**Classificação: divergência entre o teste histórico e a especificação atual.**
Na E08.10 a rota ainda não tinha controller HTTP; o 404 era coerente com aquela
etapa. A E08.12 implementou oficialmente a rota, cujo contrato aprovado exige
200/null para ausência de participação corrente. A resposta de produção e a
preparação da conta estavam corretas; a asserção antiga ficou incompatível.

Correção pontual: a mesma requisição agora exige `current.status === 200` e
`assert.deepEqual(current.body, { participation: null })`. O teste não foi removido
e suas asserções de cursor inválido, parâmetros malformados, UUID, autenticação e
titularidade foram preservadas, assim como todos os demais testes. Não houve
mudança de regra de negócio, código de produção ou fixture compartilhada.
Documentos e evidências históricos E08.10/E08.11 permanecem intactos.

Após essa atualização de compatibilidade, foram executados pelo Codex **104/104
específicos unitários/HTTP simulados** das E08.10 e E08.12 (37 + 67),
**584/584 unitários** na regressão, typecheck, lint e build, todos aprovados.
Nenhum teste PostgreSQL real foi executado pelo Codex nesta correção.

### PostgreSQL: aprovação manual definitiva

Após as duas correções documentadas acima, o responsável confirmou a execução
final no PostgreSQL local `arenago_events_test`:

| Suíte | Executados | Aprovados | Falhas | Cancelamentos | Ignorados |
| --- | --- | --- | --- | --- | --- |
| E08.10 + E08.12 focados | 158 | **158** | 0 | 0 | 0 |
| Regressão PostgreSQL completa | 841 | **841** | 0 | 0 | 0 |

Os **89 testes novos E08.12** foram preservados; o total **841 = 752 anteriores +
89 novos**, inicialmente previsto por contagem estática, foi confirmado na
execução real. O resultado final resolve as duas falhas anteriores: preparação
incompatível com E08.5 e expectativa histórica de 404 da E08.10. A asserção
compatibilizada exige o contrato correto HTTP 200 com `{ participation: null }`.
Não resta pendência de validação PostgreSQL da E08.12.

Permanecem aprovadas as verificações locais anteriores: **584/584 unitários**,
**104/104 específicos unitários/HTTP simulados**, typecheck, lint e build.
Nesta finalização, somente o relatório e a evidência foram atualizados; nenhum
teste foi reexecutado. Os resultados PostgreSQL foram fornecidos pelo responsável,
não executados pelo Codex. Credenciais reais não foram solicitadas, acessadas ou
registradas, e nenhuma validação de produção é declarada.

A suíte cobre as quatro rotas, autenticação/revogação/2FA, titularidade,
UUID/corpo/chave, privacidade e estados; posição bigint e liberação externa;
projeção no limite e ±1 microssegundo, encerramento atrasado e ausência de efeitos
nos GETs; saída idle/waiting/called, estação disponível/indisponível, completed,
avaliação e reentrada; chaves/TTL/replay/conflitos e isolamento entre contas/eventos.

Concorrências usam transações/conexões independentes, locks reais e
`pg_blocking_pids`: liberação versus cancelamento, chamada, complete, absent,
C-15, Admin imediato/controlado, job e outras saídas. Há casos de espera que
cruza o prazo, snapshots de posição mantidos durante cancelamento e GET que não
aguarda locks exclusivos. As fronteiras SQL usam a mesma projeção com expressão
de relógio interna; não há relógio enviado por HTTP.

Oito casos provocam `SELECT 1/0` na conexão PostgreSQL **depois** da escrita real
de reserva, participação, fila, sessão ou conclusão da intenção, conforme a
operação; verificam rollback integral e retry com a mesma chave. O proxy apenas
introduz a falha após o SQL nativo, sem substituir consultas por respostas falsas.
As fixtures compartilhadas e todas as demais expectativas dos testes anteriores
à E08.12 permanecem intactas; somente a asserção current acima foi compatibilizada.

### Comandos PowerShell de referência para o responsável

As execuções acima já foram aprovadas. Os comandos são preservados para
reprodução futura, sem exigência de nova execução nesta finalização.
Usar somente o banco local descartável já preparado com o schema atual.
As guardas exigem três URLs idênticas, `NODE_ENV=test`, `127.0.0.1:55432` e banco
`arenago_events_test`, sem redirecionamentos. Todos os quatro TTLs obrigatórios
estão explícitos. O exemplo contém placeholders; preencher valores somente na
sessão local do responsável, sem compartilhá-los ou gravá-los no repositório.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:EVENT_CLOSURE_INTERVAL_MS = '30000'

# Focado E08.12: 89 testes, aprovados na segunda execução manual.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/participation-lifecycle.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Falha na integração PostgreSQL E08.12' }

# Compatibilidade E08.10: asserção current corrigida e aprovada na execução final.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/evaluation-read.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Falha na compatibilidade PostgreSQL E08.10' }

# Regressão completa: 841 testes aprovados na execução manual final.
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Falha na regressão PostgreSQL completa' }
```

## Evidência e pendências

Evidência única: `qa-evidence/e08-12-changes.diff`, patch completo dos **13 arquivos**
da tabela, incluindo nove novos, contra o HEAD inicial `d1d1bb1`. UTF-8 sem BOM,
caminhos relativos e cabeçalhos `diff --git`. Aplicação verificada com
`git apply --check` e `git apply` em cópia isolada da base, seguida de comparação
integral dos 13 arquivos finais, normalizando somente CRLF/LF conforme o Git.
Nenhuma omissão/divergência; HEAD e índice preservados. Excluídos outros `.diff`,
`.env`, credenciais, dependências instaladas, temporários e alterações alheias.
Evidências históricas e documentos de tasks anteriores não foram alterados.

Não há pendências de validação da E08.12. Resta apenas o versionamento manual
pelo responsável; HEAD e índice foram preservados nesta finalização documental.
Sugestão sem execução: `feat(events): implementar consultas e saídas de participação`.

Não houve add, commit, push, merge ou rebase. E08.13 não foi iniciada. CRUD Admin
estrutural, telas Expo, notificações, BI/exportações e auditoria geral da E08
permanecem fora desta entrega.
