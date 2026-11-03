# E08.2 — HTTP das filas internas dos participantes

Implementação sobre `651d242204388f380e78c7fafadfca42c1e27625`, branch
`feature/events-participations`, com árvore e índice inicialmente limpos.
O estado inicial foi registrado em
`%TEMP%/arenago-e082-before-ee8033ff37f8427c92a974f52d43b64a/snapshot.json`.
Base de resultados informada pelo responsável: 215 unitários e 263 integrações
PostgreSQL aprovados até E08.1; esses resultados não validam antecipadamente E08.2.

## Rotas e contratos efetivos

Todas as rotas abaixo são relativas a `/api/v1`, exigem `RequireSessionAuth` e
obtêm o ator exclusivamente por `CurrentUserId`. Não exigem papel Staff e não
introduzem proibição para Admin jogar. A regra existente de segundo fator para
sessões Admin continua valendo. Participação inexistente e de terceiro retornam
o mesmo 404 `RESOURCE_NOT_FOUND`; UUID não concede acesso. Experiência inexistente
ou de outro evento no ingresso recebe o mesmo bloqueio neutro do serviço.

| Método e rota | Serviço E07 existente | Sucesso/replay |
| --- | --- | --- |
| `POST /participations/:participationId/queue-entries` | `QueueEntryService.joinExperienceQueue` | 201 |
| `GET /participations/:participationId/queue` | `QueueStateService.getParticipationQueue` | 200 |
| `POST /participations/:participationId/queue-entries/:queueEntryId/withdraw` | `QueueWithdrawalService.withdrawExperienceQueue` | 200 |

O caminho da desistência é uma definição técnica desta task: o UUID explícito
identifica a tentativa alvo. Ele evita interpretar retries como saída da fila
mais recente. Não representa saída da Arena, finalização de participação nem
cancelamento da fila externa.

### Ingresso

Corpo estrito `{ "experienceId": "UUID" }`, sem propriedades adicionais.
Resposta plana, seguindo os campos reais de E07.1 e sem o discriminante `kind`:

```json
{
  "queueEntryId": "550e8400-e29b-41d4-a716-446655440501",
  "participationId": "550e8400-e29b-41d4-a716-446655440201",
  "experienceId": "550e8400-e29b-41d4-a716-446655440301",
  "status": "waiting",
  "queueOrder": "9007199254741001",
  "enteredAt": "2026-11-03T12:00:00.000Z"
}
```

`queueOrder` continua decimal exato, inclusive além de `Number.MAX_SAFE_INTEGER`.
Não há posição no POST: posição dinâmica pertence ao snapshot de consulta.
Titularidade, participação ativa, vínculos, prontidão, disponibilidade, cortes,
uma única fila, FIFO e atomicidade são decididos pelo serviço transacional atual.

### Consulta

Retorna somente `participationId`, `observedAt` e `currentQueueEntry`. O estado
`waiting` contém `id`, `experienceId`, `experienceName`, `queueOrder`, `status`,
`position` e `serviceSession:null`. O estado `called` tem `position:null` e
`serviceSession:{ id, status:"pending", calledAt, station:{ id, label } }`.
Sem fila operacional atual:

```json
{
  "participationId": "550e8400-e29b-41d4-a716-446655440201",
  "observedAt": "2026-11-03T12:00:00.000Z",
  "currentQueueEntry": null
}
```

O controller não calcula posição, não cria idempotência, não calcula TTL nem
executa limpeza. Preserva as duas leituras no mesmo snapshot
`REPEATABLE READ READ ONLY` de E07.2 e sua projeção de encerramento definitivo,
inclusive quando as linhas ainda aguardam limpeza por outro processo.

### Desistência

Aceita `{}` ou corpo ausente. Retorna `participationId`, `queueEntryId`,
`experienceId`, `status:"closed"`, `closedAt` e `serviceSession` anulável.
Quando havia chamada, `serviceSession` contém `id`, `status:"canceled"` e
`resolvedAt`. Datas viram ISO UTC pelo Nest/JSON, sem conversão da ordem em number.

Mantém participação ativa, libera somente seu ponteiro, conserva ordens históricas
e cancela atomicamente eventual pending, sem ausência/conclusão, reentrada ou
chamada automática. Corte de novos ingressos não impede por si só a saída residual;
o prazo operacional/administrativo definitivo continua sendo respeitado por E07.3.
Replay antigo continua histórico, sem alterar uma tentativa ou atendimento posterior.

## Validação, configuração e erros

UUIDs são validados e normalizados para minúsculas. Cada POST exige um único
`Idempotency-Key` opaco, não vazio, até 128 caracteres, sem controles; a chave
original é preservada, sem trim ou renormalização. Corpo deve ser JSON e seguir
o schema da operação. Texto, formulário, arrays e campos extras são rejeitados;
nenhum usuário, posição, ordem, estado ou timestamp é aceito do cliente.

`PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS` é obrigatório, inteiro positivo e
compatível com Date, sem valor padrão. A política é independente de
`STAFF_IDEMPOTENCY_TTL_SECONDS`; nunca usa o TTL Staff como fallback. A aplicação
instancia ambas as políticas em `EventsModule`, portanto processos que iniciam
`AppModule`/`EventsModule` devem fornecer as duas configurações explicitamente.
O TTL só define `expiresAt` do backend. Não há expurgo, perda de replay após o
vencimento ou mudança nos namespaces/fingerprints persistidos de E07.1/E07.3.
Testes fornecem 60 segundos explicitamente, sem definir prazo de produção.

Os validadores HTTP e o parser de TTL da E08.1 foram extraídos para
`src/common/http/operation-validation.ts` e `idempotency-ttl.ts`. Staff mantém
os exports anteriores por wrappers. Nenhum serviço transacional E07.1–E07.6
foi modificado. O controller novo declara todos os tokens com `@Inject`, evitando
dependência de metadados automáticos sob `tsx`. O filtro RFC 7807 existente
preserva o tratamento de parsing e de erros internos sem expor SQL ou credenciais.

| HTTP | Códigos efetivos |
| --- | --- |
| 400 | `VALIDATION_ERROR`; `BAD_REQUEST` para JSON malformado |
| 401 | Códigos existentes de autenticação, sessão e segundo fator |
| 404 | `RESOURCE_NOT_FOUND`, neutro para inexistência/titularidade/vínculos |
| 409 | `PARTICIPATION_NOT_ACTIVE`, `ALREADY_IN_INTERNAL_QUEUE`, `EXPERIENCE_QUEUE_CLOSED`, `EXPERIENCE_UNAVAILABLE`, `EVENT_REGISTRATION_CLOSED`, `EVENT_UNAVAILABLE`, `QUEUE_ENTRY_NOT_CURRENT`, `EVENT_OPERATION_ENDED`, `IDEMPOTENCY_REQUEST_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS` |
| 500 | `INTERNAL_SERVER_ERROR`, sem detalhes de integridade ou SQL |

As propostas históricas da arquitetura foram atualizadas para apontar o contrato
efetivo, incluindo a resposta plana de ingresso sem posição e a rota de desistência.
Não há dados de outros participantes, Staff, documentos ou e-mails nas respostas.

## Validação efetivamente executada

- **232/232 testes unitários aprovados**, zero falhas, cancelamentos ou skips:
  215 anteriores e 17 novos em `participant-queue-http.test.ts`.
- **29/29 testes focados aprovados**: 17 novos, 11 HTTP Staff e 1 DI anterior,
  executados também com `--tsconfig tsconfig.test.json`.
- Typecheck (`npm run typecheck:test`), lint (`npm run lint`) e build
  (`npm run build`) aprovados, exit 0.
- Os testes simulados cobrem autenticação/ator, UUIDs, corpo/headers, chave opaca,
  TTL próprio sem fallback, status de replay, todas as variantes de bloqueio,
  serialização waiting/called/null, erros internos e DI real sob `tsx`.
- O teste de DI instancia providers reais de `EventsModule` e verifica identidade
  do controller, serviços, guard e banco. Sem `init/listen` nesse teste, Pool
  permanece com zero conexões; os demais testes HTTP usam serviços simulados.

O agente não acessou PostgreSQL nem solicitou/configurou credenciais.
Unitários receberam URL fictícia sem conexão, ambas as variáveis de TTL e
`DOTENV_CONFIG_PATH=NUL`. O runner `tsx` foi executado fora da sandbox devido
à limitação `uv_os_get_passwd` já constatada no ambiente.

## Integração PostgreSQL — aprovação manual final em 2026-11-03

Após as correções de fixture descritas na investigação abaixo, o responsável
confirmou a aprovação no PostgreSQL real local:

| Suíte | Executados | Aprovados | Falhas | Cancelamentos | Ignorados |
| --- | --- | --- | --- | --- | --- |
| HTTP PostgreSQL E08.2 | 22 | 22 | 0 | 0 | 0 |
| Regressão PostgreSQL completa | 285 | 285 | 0 | 0 | 0 |

Esses resultados foram executados manualmente pelo responsável, não pelo agente.
A aprovação encerra a pendência de integração da E08.2, incluindo os dois
cenários corrigidos. Permanecem registrados os resultados anteriores do Codex:
**232/232 unitários**, typecheck, lint e build aprovados. Esta consolidação é
exclusivamente documental: código, testes, schema e dependências já validados
foram preservados; nenhum teste adicional foi executado nesta rodada. Os serviços
de produção **E07.1–E07.6 não foram alterados** na E08.2. Não houve validação de
produção.

### Histórico da primeira execução e cobertura preservada

Foram escritos **22 testes HTTP + PostgreSQL real** em
`test/integration/participant-queue-http.integration.test.ts`. Na primeira entrega,
não foram executados pelo agente. Posteriormente, o responsável confirmou
**20/22 HTTP E08.2** e **283/285 na regressão completa**, com os **263 anteriores
aprovados**. As mesmas duas falhas apareceram nas duas execuções. A investigação
e as correções estão registradas abaixo. A repetição manual posterior aprovou
**22/22** e **285/285**, resolvendo as falhas de fixture `42P08` e `23505`.
Cobrem os 20 grupos solicitados: ingresso, autenticação, titularidade, estado,
vínculos, disponibilidade/prontidão/cortes, concorrência de ingresso e retry,
replay persistente/conflito, posição mutável, chamada/estação, GET sem mutações,
desistência waiting/called, permanência active, reentrada legítima, replay antigo
após nova chamada, disputas com chamada/conclusão/ausência Staff e rollback.
Incluem Admin autenticado como jogador, saída residual e projeção de fim operacional.

Disputas usam requisições HTTP reais e bloqueios de experiência observados por
`pg_blocking_pids`; aceitam somente resultados coerentes com o vencedor. Rollback
injeta uma falha depois das escritas reais dentro da transação de ingresso ou
desistência waiting/called e confere reversão de domínio e idempotência, seguida
de retry legítimo. Não substitui PostgreSQL por mock. Fixtures usam somente UUIDs
próprios; limpeza transacional inclui os dados criados. Sem migrations/seed/reset
nesta suíte. A primeira execução real revelou dois defeitos de preparação de dados,
mesmo após a revisão estática inicial; nenhum dos dois chegou aos endpoints.

Regressão completa aprovada: **285 casos** (263 anteriores + 22 novos).
Suítes HTTP anteriores que
iniciam `AppModule`/`EventsModule` receberam ambas as configurações de TTL nos
processos de teste, sem alterar suas asserções de regressão.

Comandos de reprodução para o responsável, no PostgreSQL local já preparado; substituir apenas
os placeholders locais, sem colocar credenciais em arquivos versionados:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/participant-queue-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar HTTP E08.2 antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Revisar regressão PostgreSQL.' }
```

Preflight exige as três URLs idênticas, sem parâmetros, exclusivamente no destino
local indicado; não usa `.env`. A aprovação registrada refere-se às suítes locais
confirmadas pelo responsável, sem declaração de validação de produção.

## Investigação das duas falhas reais — 2026-11-03

Diagnóstico baseado nos logs fornecidos pelo responsável, no SQL das linhas
indicadas e na conferência dos schemas/migrações e do fluxo de autenticação.
Nenhum PostgreSQL foi acessado pelo agente durante esta investigação.

### 1. Participação não ativa — erro na implementação do teste/fixture

- **Instrução exata anterior:** `await pool.query` do `UPDATE participations`
  na linha 194, com `status=$2` e duas condições `CASE WHEN $2 IN (...)`.
  O log registra SQLSTATE **42P08**, `text versus character varying`, posição 34,
  rotina `variable_coerce_param_hook`. A posição aponta ao parâmetro da atribuição
  `status=$2`; não é falha de CHECK nem de asserção.
- **Fase:** preparação de dados. O SQL falha na análise dos tipos, antes de
  `state(c)`, `join(c)` e `get(p)` desse cenário. Não há resposta HTTP inesperada
  nem execução do controller/serviço que justifique alteração de produção.
- **Schema/regra:** `participations.status` é `varchar(20)` em
  `src/database/schema/participations.schema.ts`; o mesmo parâmetro sem tipo
  explícito também aparece nas comparações dos CASEs. A dedução conflitante
  entre esses contextos é comprovada pelo diagnóstico PostgreSQL recebido.
  `ck_participations_terminal` exige `finished_at`/`finish_reason` para
  `finished|canceled` e NULL para `waiting|active`; `waiting` exige
  `arena_entered_at IS NULL`. Os valores pretendidos do fixture respeitam esses
  checks. O cenário continua coerente com §16.1 da arquitetura: somente active
  pode ingressar, e a consulta sem fila não deve fabricar uma entrada.
- **Correção da causa:** declarar `$2::varchar(20)` na atribuição e nos dois
  CASEs, alinhando todas as ocorrências ao tipo do schema. Permanecem os estados
  `waiting`, `finished`, `canceled`, a construção dos campos terminais e todas
  as asserções originais de 409, GET 200/null e ausência de mutações.

### 2. Admin como jogador — erro na implementação do teste/fixture

- **Instrução exata anterior:** `session(p.userId, true)` na linha 343 chama
  o `INSERT INTO sessions` da linha 83. Antes disso, `context()` já chamou
  `session(userId)` para a mesma pessoa na linha 104 e guardou seu `sessionId`.
- **Fase:** preparação do contexto autenticado. O log SQLSTATE **23505** aponta
  nominalmente `uq_sessions_one_unrevoked_user`, na tabela `sessions`, com
  duplicidade de `user_id`. O novo INSERT falha antes de `enter(c)`, GET e
  desistência; não existe falha de asserção de permissão de jogador.
- **Schema/regra:** `src/database/schema/access.schema.ts` e a migração
  `0003_credentials_roles.sql` definem o índice único de `user_id` com
  `revoked_at IS NULL`. A arquitetura (§2, sessões, e protocolo de novo login)
  determina uma única sessão não revogada. O fixture tentou criar duas sem
  revogar a anterior. Isso não demonstra defeito na produção nem divergência
  na intenção de testar Admin como jogador.
- **Autenticação conferida:** `AuthService.authenticateBearerToken` consulta
  papéis e segundo fator atuais no banco; Admin com `admin_2fa_verified_at=NULL`
  recebe `ADMIN_2FA_REQUIRED`. O JWT existente identifica usuário/sessão e não
  precisa ser trocado para consultar os papéis atuais. Não há nova proibição
  de jogar nem dispensa do segundo fator.
- **Correção da causa:** reutilizar a sessão criada por `context()`. Após
  conceder Admin, acrescentar a asserção de 401 `ADMIN_2FA_REQUIRED`; preparar
  o estado de segundo fator dessa mesma sessão com UPDATE limitado por
  `id`, `user_id` e `revoked_at IS NULL`, verificando exatamente uma linha,
  o mesmo ID e timestamp não nulo. Em seguida executar todas as asserções
  originais de ingresso/consulta/desistência. A preparação de segundo fator
  continua sendo fixture, como era no helper anterior; não valida o fluxo TOTP
  completo nem modifica o código de autenticação.

As duas causas identificadas são de fixture, não de produção ou de especificação.
Nenhum teste foi removido, expectativa alterada, asserção enfraquecida, constraint
desabilitada ou PostgreSQL substituído por mock. Mantidos os 22 testes e os três
estados de participação; a cobertura de segundo fator foi reforçada. A revisão
altera apenas a suíte PostgreSQL e este relatório; o único patch E08.2 é atualizado
no mesmo caminho. Não há commit ou push. Após as correções, **232/232 unitários**
foram novamente aprovados (zero falhas, cancelamentos ou skips); typecheck, lint
e build também passaram com exit 0. A execução manual posterior confirmou
**22/22 HTTP E08.2** e **285/285 na regressão**, sem falhas, cancelamentos ou
ignorados. Assim, as duas falhas de fixture foram corrigidas e validadas; a
aprovação não foi presumida a partir dos testes unitários. O histórico da
investigação permanece preservado, sem alterações nos serviços de produção.

## Evidência e limites

Única evidência: `qa-evidence/e08-2-changes.diff`, completa contra a base inicial,
incluindo arquivos novos ainda não rastreados, código HTTP compartilhado, testes
e documentação. Aplicação conferida em cópia isolada da base e resultado comparado
ao estado final com normalização Git de linhas, sem usar ou alterar o índice.
Exclui `.diff`, `.env`, segredos, dependências instaladas e temporários.

Sem novas dependências, migrations, telas Expo, notificações/WebSocket/polling,
finalização da participação, saída externa, gestão/Admin ou listagem HTTP E06.
Próxima task não iniciada. **Sem `git add`, commit ou push**; versionamento e
mensagem de commit ficam exclusivamente com o responsável. A aprovação manual
não autoriza versionamento automático pelo agente. E08.3 não foi iniciada.
