# E08-EST03 — Correção A03: precisão da restauração K03-F.1

**Base:** `ca05db54723d0c2050b8feab56640f62695d273f`, branch `feature/events-participations`, com E08-EST02 commitada. Working tree e índice estavam limpos no início.

## Diagnóstico

Na fixture histórica K03-F.1 de `backend/test/integration/profile-games.integration.test.ts`, a captura `SELECT id, version, activated_at FROM questionnaire_versions` retornava `activated_at` como `Date | null` pelo driver `pg`. O bloco `finally` enviava esses objetos ao `unnest($2::timestamptz[])` para restaurar cada versão por ID. Como `Date` mantém apenas milissegundos, um instante PostgreSQL como `.123456` podia voltar como `.123000`. A perda ocorria na leitura da fixture, antes da restauração; não foi identificada mudança de regra de produção.

O contrato K03-F.1 continua exigindo que `onModuleInit()` não reative versões inativas e que o PUT do questionário responda HTTP 422 `QUESTIONNAIRE_VERSION_UNAVAILABLE` quando nenhuma versão está ativa. A preparação ainda desativa temporariamente todas as versões ativas e a restauração continua no `finally`, inclusive diante de falha do cenário. O tratamento que agrega falha primária e falha de cleanup foi preservado.

## Correção e cobertura

- A captura agora usa `activated_at::text AS activated_at`, com tipo `string | null`. Nenhum timestamp capturado passa por `Date`.
- A restauração usa arrays de IDs `uuid[]` e valores `text[]`, com `saved.activated_at::timestamptz` no PostgreSQL. O cast conserva microssegundos e interpreta corretamente o fuso do texto; `NULL` continua `NULL`. Somente `activated_at` das versões identificadas pelo ID é atualizado.
- O teste unitário K03-F verifica texto de seis casas, múltiplas versões ativas e inativas, os parâmetros e casts da restauração, execução do `finally` após erro e preservação de ambos os erros quando o cleanup também falha.
- Um novo cenário PostgreSQL usa três versões descartáveis identificadas por UUID numa transação com rollback: uma ativa com `.123456`, uma inativa e uma terceira versão alheia com `.654321` e deslocamento `-03`. Desativa e restaura somente as duas primeiras, compara `activated_at::text` e `created_at::text` antes/depois diretamente no banco, confirma a igualdade do instante com cast `::timestamptz` e verifica que a terceira versão não mudou. Não depende dos timestamps existentes no catálogo.

Não foram alterados código NestJS de produção, schema, migrações, dependências, autenticação ou contrato HTTP. O cenário funcional K03-F.1 mantém suas asserções HTTP 422 e código de erro.

## Validação local

- Unitários K03-F: **8/8 aprovados**.
- Regressão unitária: **985/985 aprovados**, sem falhas, cancelamentos ou ignorados.
- Typecheck de produção e de testes: aprovados.
- Lint e build: aprovados.

O `tsx` desta sessão apresentou `uv_os_get_passwd returned ENOMEM` antes da descoberta dos testes. Um shim temporário de processo para `os.userInfo()` permitiu as execuções; foi removido e não integra a evidência. A instalação local também estava sem `supertest` e seus tipos; `npm ci --ignore-scripts` restaurou as dependências do lockfile, sem alterar manifesto ou lockfile.

## Validação PostgreSQL manual concluída

O responsável executou os testes no PostgreSQL 18 Linux em Docker, banco local `arenago_events_test` na porta `55432`. A suíte `profile-games.integration.test.ts` passou **24/24**, incluindo o cenário HTTP histórico K03-F.1 e a nova prova de restauração. Esta confirmou no PostgreSQL a preservação dos seis dígitos de microssegundos, de `NULL` e de uma versão não relacionada. A regressão PostgreSQL completa passou **1.229/1.229**, com zero falhas, cancelamentos ou ignorados, código de saída 0 e duração de 580429.5331 ms. O Codex não executou PostgreSQL. Não houve validação de produção.

Com as três URLs idênticas já configuradas localmente pelo responsável para `arenago_events_test` em `127.0.0.1:55432`, sem compartilhá-las:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
npx.cmd tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/profile-games.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar K03-F antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar a regressão PostgreSQL.' }
```

Limitação: a fixture histórica ainda isola o catálogo global durante seu cenário; nenhuma outra fixture ou tabela foi modificada. Os unitários verificam o caminho do texto até o cast SQL, e a comparação exata de `activated_at::text` foi confirmada na execução PostgreSQL manual. Não houve alteração de código de produção.

**Arquivos da task:** `backend/test/integration/profile-games.integration.test.ts`, `backend/test/unit/k03-cleanup.unit.test.ts` e este relatório. Evidência única: `qa-evidence/e08-est03-changes.diff`. A E08-EST03 está aprovada e resta o versionamento manual.
