# T6.1-B1 — bootstrap restrito do primeiro Admin

## Base e escopo

Base: branch `feature/events-participations`, HEAD `31c78955514451c3a61c7eb6fd887ae98e1fd421`. O índice e o working tree estavam limpos. O planejamento geral aprova o primeiro Admin por comando restrito, sem endpoint público; a arquitetura exige auditoria `origin='cli'`, ator nulo, alvo correspondente e atomicidade.

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

`backend/test/integration/first-admin-bootstrap.integration.test.ts` usa a guarda A04 e PostgreSQL local autorizado. Cobre primeiro Admin e auditoria no mesmo instante, execução concorrente de dois candidatos, estados de conta recusados, rollback provocado após inserção real da auditoria, preservação de sessão/papel participante/TOTP e rejeição `ADMIN_2FA_REQUIRED` de uma sessão sem segundo fator. Não reimplementa as suítes E07/E08 nem envia mensagens.

Comandos para o responsável executar manualmente no computador principal:

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:55432/arenago_events_test'
Set-Location 'C:\Users\Débora Jansen\Desktop\Davi\ArenaGo\backend'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/first-admin-bootstrap.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Unitários do bootstrap falharam.' }
# Configurar localmente DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL
# com a mesma URL autorizada 127.0.0.1:55432/arenago_events_test, sem query/fragmento.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/first-admin-bootstrap.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração PostgreSQL do bootstrap falhou.' }
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de testes falhou.' }
npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }
```

Testes, typecheck, lint e build não executados pelo Codex. Validação manual pendente do responsável.

## Evidência e pendências

Evidência única: `qa-evidence/t6-1-b1-changes.diff`, baseada no HEAD acima e contendo apenas a task. Aplicação isolada e comparação byte a byte concluídas sobre o HEAD-base: 5/5 arquivos reconstruídos sem divergência. Não há pendência de infraestrutura para implementar ou testar no computador principal além de disponibilizar o PostgreSQL autorizado; o comando em si permanece para execução explícita posterior pelo responsável.
