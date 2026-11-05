# E08-EST04 — Correção A04: destino PostgreSQL da fixture de leitura

**Base:** `38d6231b672bae0c642f6f7a871935e25a60fc46`, branch `feature/events-participations`, após E08-EST03. Working tree e índice estavam limpos no início.

## Diagnóstico

Em `backend/test/integration/participations-read.integration.test.ts`, a validação anterior examinava somente `hostname`, `port` e `pathname` de `DATABASE_URL` e `EVENTS_TEST_DATABASE_URL`. Ela não consultava `DATABASE_DIRECT_URL`, não exigia credenciais explícitas e não rejeitava query ou fragmento. O driver `pg` usa `pg-connection-string`, que incorpora parâmetros da query à configuração antes de preencher `host` e `port` da autoridade. Assim, `?host=servidor-remoto` ou `?port=outra-porta` podia superar o destino aparente aceito pela fixture. A checagem ocorria antes dos pools, mas era insuficiente.

O helper central `assertSafeTestDatabase()` já valida protocolo, allowlists de host/porta/banco, redirecionamentos divergentes de `host` e `port`, duplicatas desses parâmetros e `database`/`dbname`, inclusive nomes de parâmetro codificados. Sua política geral permite outros bancos locais de teste e algumas queries sem redirecionamento. A fixture de leitura requer um destino mais estrito, portanto o helper central foi reutilizado e recebeu uma camada pura específica da fixture, sem mudar sua política geral.

## Correção

`assertParticipationsReadTestDatabaseUrls()` valida as três variáveis antes de criar `Pool` ou preparar fixtures. Cada URL passa primeiro por `assertSafeTestDatabase()`. Depois exige `127.0.0.1:55432/arenago_events_test`, usuário e senha explícitos e ausência de qualquer query ou fragmento. Por fim exige igualdade textual entre `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL`; a URL aprovada é usada nos dois pools. Protocolos PostgreSQL aceitos pelo guard central permanecem `postgresql:` e `postgres:`.

A função pura está em `backend/test/integration/participations-read-db-guard.ts`. O teste unitário a importa sem carregar a suíte de integração ou criar conexões. Exemplos com credenciais fictícias rejeitados: `postgresql://fixture:placeholder@127.0.0.1:55432/arenago_events_test?host=servidor-remoto`, `?port=5432`, `?database=outro`, `?dbname=outro` e `#fragmento`. Também são rejeitados parâmetros codificados, variações de caixa, queries aparentemente inofensivas, portas/bancos distintos, credenciais ausentes e variáveis ausentes ou divergentes.

Não houve alteração em produção NestJS, schema, migrações, contratos HTTP, consultas de negócio, autenticação, Docker, portas autorizadas ou dependências. O guard central não foi enfraquecido. Não foi feita varredura ou mudança geral das demais fixtures; outras utilizações consultadas já chamam o helper central e aplicam suas próprias restrições.

## Validação local

- Testes unitários focados do guard central e da fixture: **21/21 aprovados**, sem PostgreSQL real.
- Regressão unitária: **992/992 aprovados**, zero falhas, cancelamentos ou ignorados.
- Typecheck de produção e testes: aprovados.
- Lint e build: aprovados.

Nesta sessão, `tsx` falhou antes da descoberta dos testes com `uv_os_get_passwd returned ENOMEM`. Um shim temporário de processo para `os.userInfo()` foi usado nas execuções unitárias e removido; não integra o patch. Nenhuma credencial foi lida ou registrada.

## Validação PostgreSQL manual concluída

O responsável executou manualmente os testes no PostgreSQL 18 Linux do contêiner `arenago-e08-pg18`, banco local `arenago_events_test` em `127.0.0.1:55432`. A suíte `participations-read.integration.test.ts` passou **7/7**. A regressão PostgreSQL completa passou **1.229/1.229**, com zero falhas, cancelamentos ou ignorados, código de saída 0 e duração de **572349.5826 ms**. O Codex não executou PostgreSQL. Não houve validação de produção.

Com as três URLs idênticas configuradas apenas na sessão do responsável, sem imprimir ou compartilhar seus valores:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
npx.cmd tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/participations-read.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar a suíte focada antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar a regressão PostgreSQL.' }
```

**Limitação:** a prova unitária cobre a validação pura, enquanto a ordem de execução anterior à criação dos pools foi confirmada pela inspeção da fixture. O funcionamento completo com conexão foi aprovado na suíte PostgreSQL manual. O destino autorizado permanece exclusivamente o indicado acima para esta fixture. Nenhum código de produção foi alterado.

**Arquivos da task:** `backend/test/integration/participations-read.integration.test.ts`, `backend/test/integration/participations-read-db-guard.ts`, `backend/test/unit/participations-read-db-guard.unit.test.ts` e este relatório. Evidência única: `qa-evidence/e08-est04-changes.diff`. E08-EST04 aprovada; resta o versionamento manual.
