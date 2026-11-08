# T6.1-B1 — bootstrap restrito do primeiro Admin

## Base e escopo

Base histórica da implementação: `31c78955514451c3a61c7eb6fd887ae98e1fd421`. O planejamento geral aprova o primeiro Admin por comando restrito, sem endpoint público; a arquitetura exige auditoria `origin='cli'`, ator nulo, alvo correspondente e atomicidade.

Esta implementação não altera A1/A2, E07/E08, schemas, migrations, autenticação, nem os fluxos de TOTP. Não adiciona dependências.

## Contrato do comando

O procedimento é `FirstAdminBootstrapService.bootstrap(email)`, acessível pelo entrypoint local `backend/src/auth/bootstrap-first-admin.ts`. A invocação é explícita e aceita somente `--email <conta-existente>`. Ela usa a configuração de banco já existente e deve ser executada pelo responsável na máquina principal, nunca nesta tarefa.

O endereço é normalizado com trim/minúsculas e seleciona uma conta já cadastrada. Somente conta existente, ativa e com `email_verified_at` preenchido pode receber o papel. O resultado do comando não inclui e-mail, UUID, senha, chave, token ou sessão. Erros inesperados são exibidos como mensagem genérica; detalhes do banco não são impressos.

Resultado de sucesso: papel global `admin` em `user_roles`, com `event_id=NULL` e `granted_by=NULL`. Conta inexistente, inativa, não verificada, e-mail inválido ou bootstrap já consumido encerram sem mutação. Qualquer papel Admin global histórico impede nova execução, mesmo revogado; não existe opção de força nem recuperação administrativa por este mecanismo.

## Concorrência e transação

Cada chamada usa `BEGIN ISOLATION LEVEL READ COMMITTED`, adquire um `pg_advisory_xact_lock` com chave namespaced do ArenaGo e verifica a existência global de papel Admin antes de procurar a conta. Assim, execuções concorrentes deste procedimento serializam mesmo quando ainda não há linha Admin para bloquear. Após o lock global, a conta selecionada é bloqueada com `users FOR UPDATE` e seu estado é revalidado.

O papel e a auditoria são gravados na mesma transação, com o mesmo `clock_timestamp()` do PostgreSQL. Erro em SQL, concessão, auditoria ou commit causa tentativa de rollback e liberação da conexão. Se a conexão cair com resultado de commit incerto, verificar o banco antes de repetir; a próxima execução consultará o registro Admin existente.

Auditoria: `origin='cli'`, `actor_user_id=NULL`, `target_user_id` da conta, `event_id=NULL`, `category='identity'`, `action='first_admin_bootstrapped'`, metadado mínimo `{"role":"admin"}`. Não grava e-mail nem dados de autenticação. O papel respeita o check e o índice global de `user_roles` existentes.

O comando não cria nem atualiza sessão, refresh token, credencial TOTP, token de ativação ou `admin_2fa_verified_at`. O login e a guarda atuais continuam exigindo TOTP confirmado antes de aceitar qualquer sessão Admin; o próprio teste PostgreSQL verifica `ADMIN_2FA_REQUIRED` após a concessão. A configuração legítima de TOTP segue pendente da T6.1-B2.

## Interface local e execução manual

Não há controller ou rota HTTP para bootstrap. O entrypoint usa `require.main === module` para executar somente quando chamado diretamente; não há bypass por `NODE_ENV`, senha mestre ou credencial fixa.

Após validação manual e com schema já aplicado, o responsável pode executar:

```powershell
Set-Location 'C:\Users\Débora Jansen\Desktop\Davi\ArenaGo\backend'
.\node_modules\.bin\tsx.cmd src/auth/bootstrap-first-admin.ts --email admin@example.com
```

O e-mail acima é apenas ilustrativo. Confirmar antes que o banco selecionado é o ambiente local pretendido e que a conta já está ativa e verificada. O comando nunca foi executado nesta task.

## Testes preparados

`backend/test/unit/first-admin-bootstrap.test.ts` cobre concessão/auditoria, lock e ordenação, conta inexistente/inativa/não verificada, e-mail inválido, bloqueio de repetição, rollback em falha de gravação/commit, resolução DI real do serviço e ausência de rota HTTP.

`backend/test/integration/first-admin-bootstrap.integration.test.ts` usa guarda exclusiva e PostgreSQL local dedicado. Cobre primeiro Admin e auditoria no mesmo instante, execução concorrente de dois candidatos, estados de conta recusados, rollback provocado após inserção real da auditoria, preservação de sessão/papel participante/TOTP e rejeição `ADMIN_2FA_REQUIRED` de uma sessão sem segundo fator. Não reimplementa as suítes E07/E08 nem envia mensagens. Antes de criar a API ou qualquer fixture, confere `current_database()` e exige zero papéis Admin globais históricos, inclusive revogados. Caso contrário, falha explicitamente e não apaga registros.

`backend/test/integration/first-admin-bootstrap-db-guard.ts` exige `NODE_ENV=test`, três URLs textualmente idênticas, credenciais explícitas e destino exato `127.0.0.1:55432/arenago_bootstrap_test`, sem query ou fragmento. Ela é independente da guarda central e não amplia a allowlist das outras suítes. `backend/test/unit/first-admin-bootstrap-db-guard.test.ts` prepara provas de aceitação e rejeição de destinos ou configurações divergentes.

## Falhas observadas e isolamento PostgreSQL

Na primeira execução manual, a suíte B1 falhou **4/4**: o serviço retornou `already_bootstrapped`. A investigação somente leitura do responsável encontrou no banco compartilhado `arenago_events_test` quatro papéis Admin globais históricos, quatro não revogados e zero revogados. A consulta do serviço considera qualquer Admin global histórico, como exige o contrato de bootstrap único. Logo, o defeito estava no isolamento da fixture, que apontava para um banco já utilizado. Nenhum desses registros foi alterado; o serviço de produção permanece correto e não foi modificado.

O responsável deve criar `arenago_bootstrap_test` vazio no mesmo contêiner PostgreSQL Docker, aplicar somente as migrações versionadas para obter o schema e executar exclusivamente a suíte B1 nele. Não copiar dados, restaurar dump, aplicar seed ou reutilizar `arenago_events_test`. Os comandos abaixo são **para execução manual pelo responsável**. Conferir o nome do contêiner e a role local antes; nenhum deles foi executado pelo Codex.

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$container = 'arenago-e08-pg18'
$role = 'arenago'
$existing = docker exec $container psql -U $role -d postgres -X -tA -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname='arenago_bootstrap_test'"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar o catálogo de bancos.' }
if ([string]$existing -ne '') { throw 'O banco dedicado já existe. Investigue antes de reutilizá-lo.' }
docker exec $container psql -U $role -d postgres -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE arenago_bootstrap_test OWNER arenago TEMPLATE template0'
if ($LASTEXITCODE -ne 0) { throw 'Criação do banco dedicado falhou.' }

# Informar localmente a URL com credenciais próprias, sem exibi-la no terminal ou gravá-la.
$secretUrl = Read-Host 'URL postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_bootstrap_test' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretUrl)
try { $bootstrapUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$parsed = [uri]$bootstrapUrl
if ($parsed.Scheme -notin @('postgresql','postgres') -or $parsed.Host -ne '127.0.0.1' -or $parsed.Port -ne 55432 -or $parsed.AbsolutePath -cne '/arenago_bootstrap_test' -or $parsed.Query -or $parsed.Fragment -or $bootstrapUrl.Contains('?') -or $bootstrapUrl.Contains('#') -or -not $parsed.UserInfo.Contains(':')) { throw 'URL do banco dedicado inválida.' }
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:DATABASE_URL = $bootstrapUrl
$env:DATABASE_DIRECT_URL = $bootstrapUrl
$env:EVENTS_TEST_DATABASE_URL = $bootstrapUrl
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migrações do banco dedicado falharam.' }
```

Depois de preparar o schema, executar **somente** a integração B1. A guarda da suíte faz a verificação de banco vazio antes de qualquer fixture; a limpeza `afterEach` remove apenas os usuários criados pela própria suíte. A B1 não integra a regressão que aponta para `arenago_events_test`.

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/first-admin-bootstrap.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração PostgreSQL B1 falhou; não reutilizar o banco sem investigar.' }
```

Após inspecionar o resultado e confirmar que o nome é **somente** `arenago_bootstrap_test`, o responsável pode remover manualmente o banco descartável. O comando usa conexão ao banco `postgres`, não ao compartilhado. Não executar `DROP`, `TRUNCATE` ou `DELETE` em `arenago_events_test`.

```powershell
$container = 'arenago-e08-pg18'
$role = 'arenago'
$confirmation = Read-Host 'Para remover apenas o banco dedicado, digite arenago_bootstrap_test'
if ($confirmation -cne 'arenago_bootstrap_test') { throw 'Limpeza cancelada.' }
docker exec $container psql -U $role -d postgres -X -v ON_ERROR_STOP=1 -c 'DROP DATABASE arenago_bootstrap_test'
if ($LASTEXITCODE -ne 0) { throw 'Remoção manual do banco dedicado falhou.' }
Remove-Item Env:DATABASE_URL,Env:DATABASE_DIRECT_URL,Env:EVENTS_TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Variable bootstrapUrl,secretUrl -ErrorAction SilentlyContinue
```

## Validações manuais concluídas

O responsável executou manualmente, sem compartilhar credenciais:

- Guarda de segurança do banco dedicado: **13/13 aprovados**.
- Integração PostgreSQL B1 em `arenago_bootstrap_test`: **4/4 aprovados**.
- Regressão PostgreSQL compartilhada em `arenago_events_test`, excluindo somente `first-admin-bootstrap.integration.test.ts`: **1.255/1.255 aprovados**, código de saída 0.
- Testes unitários completos: **1.057/1.057 aprovados**.
- Typecheck de testes, ESLint e build NestJS: aprovados.

Total informado: **2.316 testes aprovados**, sem falhas. A B1 exige exclusivamente o banco dedicado `arenago_bootstrap_test`; as demais integrações continuam usando `arenago_events_test`. O comando genérico `npm run test:integration` inclui a B1 e não deve ser executado indiscriminadamente com apenas um banco configurado.

Para repetir manualmente a regressão compartilhada, mantendo execução serial e excluindo apenas a B1:

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$integrationFiles = Get-ChildItem test/integration -Filter '*.integration.test.ts' |
  Where-Object { $_.Name -ne 'first-admin-bootstrap.integration.test.ts' } |
  ForEach-Object { $_.FullName }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 $integrationFiles
if ($LASTEXITCODE -ne 0) { throw 'Regressão PostgreSQL compartilhada falhou.' }
```

Comandos para o responsável executar manualmente no computador principal:

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/first-admin-bootstrap.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Unitários do bootstrap falharam.' }
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/first-admin-bootstrap-db-guard.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Unitários da guarda B1 falharam.' }
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de testes falhou.' }
npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }
```

Na implementação anterior, o responsável corrigiu localmente TS2322 na atribuição a `current` e `no-useless-assignment` na variável `results`; essas alterações foram preservadas. Após o isolamento, a guarda, a integração B1 e a regressão compartilhada passaram conforme os resultados acima. O Codex não executou testes, typecheck, lint, build, migrations ou comandos PostgreSQL nesta consolidação.

## Evidência e pendências

Evidência única: `qa-evidence/t6-1-b1-changes.diff`, baseada no HEAD inicial da B1 `31c78955514451c3a61c7eb6fd887ae98e1fd421` e contendo a implementação original, as correções de fixture/guarda e este fechamento documental. A aplicação isolada e a comparação byte a byte devem ser repetidas após esta atualização; não há pendência de validação da B1. O banco compartilhado e seus quatro Admins históricos permanecem intactos.
