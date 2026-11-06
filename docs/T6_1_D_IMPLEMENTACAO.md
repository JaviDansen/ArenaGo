# T6.1-D — Gestão segura de permissões Admin/Staff

**Base da task:** `5ce2a5d755d7b632152486ee9e9d6f078f0120f7`
**Branch:** `feature/events-participations`
**Estado:** implementação validada nas suítes e verificações informadas pelo responsável; pronta para versionamento manual. O onboarding TOTP de novos Admins continua pendente em etapa própria. Não declarar prontidão para produção.

No preflight original, a C estava commitada nesse HEAD, a branch era a indicada acima e índice/working tree estavam limpos. Na retomada, as alterações D existentes foram preservadas; havia uma atualização local independente de `AGENTS.md`, mantida fora do escopo e da evidência. HEAD e índice permanecem intactos.

## Objetivo e escopo

Implementar concessão e revogação HTTP de papéis administrativos, reutilizando `user_roles`, a autenticação existente, `audit_logs` e `idempotency_operations`. O papel `participante` continua independente; uma conta pode acumular papéis. Nenhuma migration foi necessária: constraints, índices e tabelas já existem.

Rotas, sob o prefixo global `/api/v1`:

| Método e rota | Contrato | Sucesso |
|---|---|---|
| `POST /admin/roles/grant` | `{ "role": "admin", "email": "..." }` com `eventId` ausente ou `null`; ou `{ "role": "staff", "email": "...", "eventId": "UUID" }` | `201 { grant: { id, userId, role, eventId, grantedAt, revokedAt: null } }` |
| `POST /admin/roles/revoke` | `{ "grantId": "UUID" }` | `200 { grant: { id, userId, role, eventId, grantedAt, revokedAt } }` |

Os DTOs são estritos, validam UUIDs, rejeitam campos extras e normalizam e-mail com trim e minúsculas, conforme `normalizeEmail` da autenticação. Admin é global (`event_id IS NULL`); Staff sempre recebe um evento existente. A concessão não cria conta, não exige ou cria uma sessão para o destinatário e exige conta ativa e e-mail verificado. Não é permitido administrar o papel `participante` pela rota de revogação.

As respostas contêm somente identificadores, papel, escopo e instantes da concessão/revogação. Não retornam e-mail, credenciais, tokens, segredo TOTP, códigos de recuperação nem dados pessoais adicionais.

## Autorização e respostas de erro

As rotas reutilizam `RequireSessionAuth`/`SessionAuthGuard` e ainda revalidam dentro da transação:

- sessão pertencente ao ator, não revogada, vigente e com `admin_2fa_verified_at` persistido;
- conta Admin ativa, e-mail verificado e papel Admin global vigente;
- ator, concessão e escopo sob locks até o commit.

Claims do access token, sozinhas, não autorizam a mutação. Staff, participante e não autenticado não podem conceder/revogar. Principais erros RFC 7807: 400 `VALIDATION_ERROR`; 401 para token/sessão/2FA/conta; 403 `ADMIN_REQUIRED` ou `ADMIN_EMAIL_UNVERIFIED`; 404 `RESOURCE_NOT_FOUND`; 409 para duplicidade, último Admin, chave idempotente reutilizada ou requisição em andamento; 422 `ROLE_TARGET_INELIGIBLE`.

## Política de concessão, revogação e idempotência

- Concessão cria uma nova linha histórica `user_roles`, mantendo concessões revogadas anteriores. O índice único parcial continua sendo a última barreira contra duas concessões ativas do mesmo papel e escopo.
- `granted_by` e `revoked_by` recebem o Admin autenticado. Horários são obtidos no PostgreSQL; concessão/revogação e auditoria usam o mesmo instante do banco.
- Revogação é lógica (`revoked_at`), preserva a linha e não apaga sessões, participações, filas ou avaliações. Uma segunda chamada com a mesma chave idempotente reproduz a resposta sem nova auditoria; com nova chave, uma concessão já revogada recebe 404 sem efeito adicional.
- Ambas as mutações exigem uma única chave `Idempotency-Key` válida e usam `ADMIN_IDEMPOTENCY_TTL_SECONDS` e a tabela compartilhada `idempotency_operations`. Reserva, mudança de papel, auditoria e resposta mínima persistida pertencem à mesma transação. O TTL não apaga registros nem invalida replay por conta própria.
- O replay continua exigindo autorização atual. Depois de autorrevogar seu papel, o ator não consegue usar a mesma chave para contornar a perda de permissão; recebe `ADMIN_REQUIRED` nas próximas operações.
- A rota não registra tentativas rejeitadas: não foi encontrada uma política aprovada que justifique auditoria adicional para recusas.

## Decisões sobre Admins

Autorrevogação é permitida somente se permanecer outro Admin viável. A operação bloqueia a revogação do último Admin cuja conta esteja ativa, e-mail verificado e credencial TOTP verificada. Se o destinatário já não for viável, revogá-lo não reduz o número de Admins viáveis e não é impedido por essa regra.

O planejamento permite um Admin durante desenvolvimento e exige pelo menos dois Admins ativos, verificados e com TOTP antes de eventos reais. Não existe no schema nem na configuração atual uma distinção aprovada entre ambiente de desenvolvimento e operação real. Por isso esta implementação preserva a operação de desenvolvimento com um Admin, mas só consegue impedir a remoção do último Admin viável; o mínimo de dois antes de evento real permanece requisito operacional a verificar pelo responsável, não uma condição inferida do estado do banco. A verificação do conjunto é serializada por lock transacional comum às mutações de papéis.

## Locks, transação e concorrência

Todas as mudanças de papéis passam por um advisory transaction lock comum, adquirido dentro da transação e sem tabela/migration nova. Isso serializa concessões e revogações concorrentes, inclusive a contagem do último Admin, e permite revalidar a autorização depois de qualquer espera.

Para Staff, a ordem começa por `events FOR UPDATE` e depois pelo lock comum de papéis. O evento é obtido por leitura de descoberta somente na revogação; o grant ou revogação e o vínculo ao evento são revalidados depois. Essa ordem coordena a mutação com ingresso, estação e outros escritores de capacidade que bloqueiam o evento primeiro. A autorização bloqueia a conta, a concessão Admin global e a sessão do ator com `FOR SHARE`, e verifica o marcador de segundo fator persistido na sessão. A concessão bloqueia a conta destinatária e consulta a linha de papel ativo com `FOR UPDATE`; a revogação bloqueia a conta e a linha de papel destinatárias com `FOR UPDATE`, mas apenas lê o indicador de verificação da credencial TOTP destinatária, sem lock explícito nessa linha. A credencial TOTP do ator não é consultada nem bloqueada por esta operação. Papéis globais Admin não têm lock de evento.

Concessão/revogação e auditoria são escritas atomicamente; qualquer erro reverte também a reserva idempotente. A integração injeta uma falha após o SQL real que contém a alteração e a auditoria e valida rollback/retry. Outro caso simula perda da confirmação depois do commit e verifica recuperação pelo replay idempotente. Dois cenários coordenam o serviço de admissão PostgreSQL real com a revogação Staff: um exige bloqueio do ingresso quando a revogação obtém primeiro o lock do evento; o outro exige ingresso criado e preservado quando a admissão obtém primeiro esse lock. Ambos observam a relação entre os bloqueadores por `pg_blocking_pids` antes de liberar a transação da fixture e integram a execução dedicada de 46/46 aprovada pelo responsável.

Não é prometido efeito retroativo sobre uma operação que já tenha obtido autorização antes da revogação. A revogação confirmada passa a ser considerada nas próximas consultas/ações: o Auth guard carrega papéis atuais, consultas Staff e serviços operacionais conferem concessões atuais. A implementação não revoga sessões nem transforma perda de Staff em encerramento de evento. A última revalidação temporal da sessão ocorre antes do retorno do callback transacional; permanece uma janela entre essa leitura e o COMMIT, conforme a limitação já documentada na A01. O lock comum serializa todas as mutações de papéis e pode limitar vazão; não foi realizado benchmark nem teste de falha física da conexão durante COMMIT.

## Regras operacionais de Staff

Revogar o último Staff é permitido, mesmo se o evento ficar sem capacidade. A operação não altera status, prontidão, estações, participações, entradas de fila ou histórico. A falta de Staff passa a suspender dinamicamente novas admissões segundo o mecanismo existente. Uma nova concessão não altera `events.status` e não reabre evento encerrado. Grants a Staff exigem evento existente, mas não fazem mutação estrutural ou temporal do evento.

## Onboarding de novos Admins — bloqueio arquitetural conhecido

Conceder o papel Admin **não** ativa TOTP. A concessão não cria sessão nem altera `user_totp_credentials`. O Auth guard continua recusando sessões Admin sem segundo fator.

A ativação B2/TOTP disponível no repositório é exclusiva do primeiro Admin: `TotpActivationService.issue/setup/confirm` exige a proveniência do bootstrap inicial (`granted_by IS NULL` e auditoria de primeiro Admin). Não há contrato aprovado para um Admin existente autorizar a configuração inicial de outro Admin, e o endpoint público de ativação não foi definido. Portanto um novo destinatário Admin sem TOTP fica sem capacidade de usar as rotas administrativas e não consegue concluir onboarding pelos fluxos atuais. Esta task não amplia B2, não reutiliza o CLI excepcional, não cria token de ativação nem bypass. Um fluxo seguro de onboarding para Admin promovido precisa de especificação e etapa própria antes de tornar novas concessões Admin operacionalmente utilizáveis. Reset TOTP e recuperação de códigos permanecem fora de escopo.

## Auditoria

As operações efetivas escrevem `audit_logs` na mesma transação:

- ações `admin_role_granted` e `admin_role_revoked`, categoria `identity`, origem `user`;
- ator e destinatário em `actor_user_id` e `target_user_id`;
- `event_id` preenchido apenas para Staff;
- metadados mínimos `{ grantId, role }`, sem e-mail, token, segredo, código ou payload completo.

Em concessão, `granted_at` coincide com `occurred_at`; na revogação, `revoked_at` coincide com `occurred_at`. Uma falha na escrita/auditoria aborta a transação.

## Migrations e dados de teste

Não foi criada migration. A implementação utiliza schema existente: `user_roles`, `users`, `events`, `sessions`, `user_totp_credentials`, `audit_logs` e `idempotency_operations`.

As integrações da T6.1-D usam exclusivamente **`arenago_roles_test`**, banco descartável exclusivo desta suíte. `arenago_bootstrap_test` permanece reservado a B1/B2/C; `arenago_events_test` mantém as demais integrações e os sete Admins históricos. Nenhum desses registros é alterado pela D. A guarda `admin-role-management-db-guard.ts` exige `NODE_ENV=test`, três URLs idênticas, host `127.0.0.1`, porta publicada `55432`, nome exato `arenago_roles_test`, credenciais explícitas e ausência de query/fragmento. Antes das fixtures, a suíte confirma `current_database()`, todas as tabelas utilizadas (incluindo o marcador `admin_2fa_challenges` da migration 0006) e ausência de qualquer concessão Admin histórica no banco D; se falhar, bloqueia sem apagar registros.

As fixtures usam UUIDs próprios e removem somente contas, eventos e dependências criados pelo cenário, em ordem de FK. O hook `afterEach` executa a limpeza também em caso de falha do teste; o Node Test Runner registra separadamente o erro do cenário e do hook. Se o rollback da limpeza também falhar, ambos os erros de cleanup são preservados em `AggregateError`. Não há limpeza global. O bloqueio de Admins preexistentes é necessário para que a prova do último Admin não dependa de dados anteriores nem revogue autoridades alheias.

Na retomada foram corrigidas, por inspeção estática, expectativas das fixtures: a concessão preserva exatamente a sessão já criada para o alvo; duas autorrevogações deixam um sucesso e um `409 LAST_ADMIN_REQUIRED`; a disputa grant/revoke aceita as duas ordens serializáveis e exige retry válido quando o grant chega primeiro. Também foi corrigido o caso de URLs divergentes para exercitar a comparação de URLs sem ser interrompido antes pela allowlist. Não houve alteração funcional adicional no serviço já implementado.

Se `arenago_roles_test` ainda não existir, o responsável cria somente esse banco vazio no contêiner local autorizado, sem copiar dados. O exemplo abaixo é **manual**, exige uma conta local com permissão de criação e solicita a senha interativamente; não contém credenciais. Se o banco já existir, não o recriar nem remover: a criação falha e a situação deve ser inspecionada.

```powershell
$dbAdministrator = Read-Host 'Papel PostgreSQL local autorizado a criar o banco dedicado'
if ($dbAdministrator -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') { throw 'Papel inválido.' }
if ((Read-Host 'Digite arenago_roles_test para autorizar a criação') -cne 'arenago_roles_test') { throw 'Criação cancelada.' }
docker exec -it arenago-e08-pg18 psql -X -W -U $dbAdministrator -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE arenago_roles_test WITH TEMPLATE template0 ENCODING ''UTF8'''
if ($LASTEXITCODE -ne 0) { throw 'Criação não concluída; não remover nem sobrescrever bancos existentes.' }
```

Aplicar manualmente as migrations existentes até `0006_admin_2fa_login` no banco novo, sem seed e somente após confirmar o destino no bloco seguinte. Nenhuma migration nova foi criada. A porta `55432` pertence ao host; o `psql` dentro do contêiner usa a conexão interna e não deve comparar `current_setting('port')` com `55432`. Não executar `DROP`, `TRUNCATE` ou limpeza de dados preexistentes.

### Preparação e comandos PowerShell — somente responsável

O helper abaixo recebe a URL por prompt seguro, valida rigorosamente o destino e compartilha a mesma URL entre os três nomes exigidos. Não imprimir nem gravar a URL em arquivo/transcript. A senha é tratada em memória durante a sessão local.

```powershell
function Set-T61DTestDatabase {
  if ($env:NODE_ENV -cne 'test') { throw 'NODE_ENV=test obrigatório.' }
  $secureUrl = Read-Host 'URL local PostgreSQL 127.0.0.1:55432/arenago_roles_test' -AsSecureString
  $urlBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  try { $connectionUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($urlBuffer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($urlBuffer); $secureUrl.Dispose() }
  $parsedUrl = $null
  if (-not [uri]::TryCreate($connectionUrl,[UriKind]::Absolute,[ref]$parsedUrl)) { throw 'URL inválida.' }
  if ($parsedUrl.Scheme -notin @('postgres','postgresql') -or $parsedUrl.Host -cne '127.0.0.1' -or
      $parsedUrl.Port -ne 55432 -or $parsedUrl.AbsolutePath -cne '/arenago_roles_test' -or
      $connectionUrl.Contains('?') -or $connectionUrl.Contains('#') -or $parsedUrl.UserInfo -notmatch '^[^:]+:.+$') {
    throw 'Destino fora da allowlist dedicada T6.1-D.'
  }
  $env:DATABASE_URL = $connectionUrl
  $env:DATABASE_DIRECT_URL = $connectionUrl
  $env:EVENTS_TEST_DATABASE_URL = $connectionUrl
}

function Confirm-T61DTestDatabase {
  if ($env:NODE_ENV -cne 'test' -or -not $env:DATABASE_URL -or
      $env:DATABASE_URL -cne $env:DATABASE_DIRECT_URL -or $env:DATABASE_URL -cne $env:EVENTS_TEST_DATABASE_URL) {
    throw 'NODE_ENV=test e três URLs idênticas são obrigatórios.'
  }
  $url = [uri]$env:DATABASE_URL
  if ($url.Scheme -notin @('postgres','postgresql') -or $url.Host -cne '127.0.0.1' -or $url.Port -ne 55432 -or
      $url.AbsolutePath -cne '/arenago_roles_test' -or $env:DATABASE_URL.Contains('?') -or $env:DATABASE_URL.Contains('#') -or
      $url.UserInfo -notmatch '^[^:]+:.+$') { throw 'Destino não autorizado para D.' }
  $databaseRole = [uri]::UnescapeDataString($url.UserInfo.Split(':',2)[0])
  docker exec -it arenago-e08-pg18 psql -X -W -U $databaseRole -d arenago_roles_test -v ON_ERROR_STOP=1 -c "SELECT current_database(), 1 / ((current_database() = 'arenago_roles_test')::integer) AS target_ok"
  if ($LASTEXITCODE -ne 0) { throw 'Conferência do banco conectado falhou.' }
}

Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
Set-T61DTestDatabase
Confirm-T61DTestDatabase
# Somente para preparar o banco novo e vazio; confirmar novamente antes de cada migration:
if ((Read-Host 'Digite arenago_roles_test para aplicar migrations existentes') -cne 'arenago_roles_test') { throw 'Migration cancelada.' }
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migration falhou; interromper e investigar.' }
```

Os comandos abaixo registram o procedimento de validação e podem ser reutilizados em campanha autorizada conforme `AGENTS.md`; não executar migrations novamente como parte dos testes. Configurar chaves locais de teste pelos procedimentos existentes, sem copiar ou imprimir segredos. Não habilitar envio externo de e-mail; manter `RESEND_API_KEY`, `RESEND_FROM` e `EMAIL_VERIFICATION_CONFIRMATION_URL` ausentes na sessão de teste.

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:EMAIL_VERIFICATION_TTL_SECONDS = '86400'
$env:EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = '120'
$env:EMAIL_VERIFICATION_MAX_PER_HOUR = '5'

$unitFiles = Get-ChildItem test/unit -Filter 'admin-role-management*.test.ts' | Sort-Object Name | ForEach-Object { $_.FullName }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test $unitFiles
if ($LASTEXITCODE -ne 0) { throw 'Unitários T6.1-D falharam.' }
Confirm-T61DTestDatabase
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-role-management.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração PostgreSQL T6.1-D falhou; investigar antes de continuar.' }

npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Regressão unitária falhou.' }
& .\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit --incremental false
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de produção falhou.' }
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de testes falhou.' }
npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }
```

Os blocos apenas preparam comandos; não foram executados pelo Codex. O comando genérico `npm run test:integration` reúne suítes de bancos diferentes e não deve ser usado com uma única URL. B1/B2/C continuam no banco `arenago_bootstrap_test` e seguem os comandos próprios de seus relatórios. Para a regressão compartilhada, configurar e conferir `arenago_events_test` pelo procedimento existente e excluir somente as quatro suítes dedicadas:

```powershell
# Somente após configurar e conferir as três URLs de arenago_events_test:
$dedicated = @('first-admin-bootstrap.integration.test.ts','totp-activation.integration.test.ts',
  'admin-two-factor-login.integration.test.ts','admin-role-management.integration.test.ts')
$integrationFiles = Get-ChildItem test/integration -Filter '*.integration.test.ts' |
  Where-Object { $_.Name -notin $dedicated } | Sort-Object Name | ForEach-Object { $_.FullName }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 $integrationFiles
if ($LASTEXITCODE -ne 0) { throw 'Regressão compartilhada falhou.' }
```

## Testes preparados e limitações

Foram preparados **28 casos unitários/HTTP simulados**: 4 de DTO/política, 4 da guarda de banco, 12 do serviço e 8 HTTP. Cobrem autorização persistida, identidade confiável, normalização, escopo estrito, respostas mínimas, RFC 7807, duplicidade, replay/conflito idempotente, revogação repetida, última revalidação da sessão e proteção do último Admin. Os doubles unitários verificam decisões e chamadas, sem pretender provar rollback físico.

A suíte real contém **46 cenários PostgreSQL**, incluindo quatro casos gerados pelo produto grant/revoke × falha de auditoria/SQL. Cobre concessões/revogações, auth/2FA/sessões, idempotência, auditoria, duplicidade e concorrência, Admins, último Staff, suspensão/restauração da prontidão, efeito imediato de revogação e preservação de participação/fila. Os dois cenários Staff × ingresso exigem resultados diferentes conforme a ordem observada do lock do evento. Dois casos adicionais enviam grant ou revoke simultâneos com o mesmo payload e a mesma chave idempotente: uma transação da fixture segura o advisory lock de papéis até observar as duas requisições aguardando, então o libera. Esses casos exigem respostas coerentes, uma única mudança de papel, uma única auditoria e uma única operação idempotente. O responsável confirmou a aprovação dos 46 cenários na execução dedicada.

Uma falha injetada depois da instrução SQL real de concessão/auditoria verifica rollback de papel, auditoria e idempotência; outra simula confirmação de commit perdida e valida recuperação por replay. Há também uma interrupção injetada no callback depois de todas as escritas e antes da tentativa de COMMIT, exigindo rollback e retry; isso não representa falha física do comando COMMIT. Para grant e revoke, a instrumentação também executa falhas PostgreSQL reais: no CTE de mutação, troca somente o UUID obrigatório da auditoria por NULL (23502), preservando os parâmetros e a dependência da escrita de papel; no segundo caso, executa divisão por zero (22012) depois da escrita real. Ambos exigem rollback integral e retry com a mesma chave. Não há triggers temporárias nem alteração de constraints. A concorrência de admissão usa o serviço interno existente porque a API pública de ingresso ainda não foi implementada conforme o inventário arquitetural. Os dois cenários preparados verificam a coordenação transacional pelo lock do evento, não a existência de uma rota HTTP de ingresso.

**Resultados informados pelo responsável:**

| Validação | Resultado |
|---|---|
| Unitários/HTTP específicos T6.1-D | 28/28 aprovados |
| Regressão unitária do backend | 1.134/1.134 aprovados |
| Typecheck de produção e de testes | Aprovados |
| ESLint e build NestJS | Aprovados |
| PostgreSQL dedicado T6.1-D | 46/46 aprovados; código de saída 0 |
| Regressão PostgreSQL compartilhada | 36 suítes, 1.255/1.255 aprovados; código de saída 0 |

Na execução anterior, o typecheck de testes apontou três erros TS2345/TS2339 em `admin-role-management.integration.test.ts`. As correções locais ajustaram o tipo do helper de chave idempotente e estreitaram explicitamente o resultado de disponibilidade; o responsável confirmou a aprovação posterior do typecheck de testes.

Na primeira execução manual da integração PostgreSQL T6.1-D, os **46 cenários falharam com `ERR_INVALID_URL`**. O helper combinava `supertest(app.getHttpServer())`, que já fornece a origem HTTP local, com uma URL absoluta que repetia a mesma origem; por exemplo, `http://127.0.0.1:62581http://127.0.0.1:62581/api/v1/admin/roles/grant`. A falha ocorreu na montagem da URL da requisição, antes da validação do comportamento dos endpoints, e não constitui evidência de defeito de produção. A correção passou a usar caminhos relativos com o prefixo `/api/v1`; na execução manual posterior, os 46 cenários foram aprovados.

Após a execução dedicada, o responsável confirmou que `arenago_roles_test` continha zero usuários, Admins, eventos, auditorias e operações idempotentes. Na regressão compartilhada, os sete Admins históricos de `arenago_events_test` foram preservados. A especificação do onboarding seguro de novos Admins continua pendente, fora do escopo desta task.

## Investigação de resíduos no banco compartilhado

O responsável informou as seguintes contagens antes e depois da regressão compartilhada:

| Registro | Antes | Depois | Diferença |
|---|---:|---:|---:|
| Usuários | 572 | 640 | +68 |
| Admins históricos | 7 | 7 | 0 |
| Eventos | 154 | 173 | +19 |

A investigação estática identificou caminhos de criação sem cleanup geral em `database.integration.test.ts`, `auth.integration.test.ts` e `profile-games.integration.test.ts`. Para uma execução completa, os resíduos previstos nesses caminhos somam **68 usuários e 19 eventos**: respectivamente 27/16, 20/2 e 21/1. A coincidência de contagens não comprova a atribuição individual dos registros. Nenhum registro foi apagado durante a investigação. Recomenda-se uma task separada para corrigir a limpeza das fixtures, limitada aos registros criados por cada suíte e respeitando as dependências.

Esta consolidação não executou testes, typecheck ou PostgreSQL. Não declarar homologação ou prontidão de produção.

## Inventário da task

1. `backend/src/app.module.ts` — registra `AdminRoleManagementModule`.
2. `backend/src/auth/admin-role-management.module.ts`.
3. `backend/src/auth/admin-role-management.controller.ts`.
4. `backend/src/auth/admin-role-management.dto.ts`.
5. `backend/src/auth/admin-role-management.problem.ts`.
6. `backend/src/auth/admin-role-management.service.ts`.
7. `backend/test/unit/admin-role-management.test.ts`.
8. `backend/test/unit/admin-role-management-db-guard.test.ts`.
9. `backend/test/integration/admin-role-management-db-guard.ts`.
10. `backend/test/integration/admin-role-management.integration.test.ts`.
11. `backend/test/unit/admin-role-management-service.test.ts`.
12. `backend/test/unit/admin-role-management-http.test.ts`.
13. Este relatório.

Evidência única da task: `qa-evidence/t6-1-d-changes.diff`, com base no HEAD inicial acima. O patch inclui os 13 arquivos do inventário e exclui a própria evidência. Ele foi preservado nesta consolidação documental: representa os arquivos de implementação e testes e a versão do relatório anterior aos resultados finais. Portanto, o relatório atual não é reproduzido byte a byte pelo patch preservado. A alteração local preexistente de `AGENTS.md` fica fora da evidência da D. Nenhuma migration ou arquivo de outras tasks faz parte do escopo.

Na revisão anterior à consolidação documental, o patch foi aplicado sobre uma cópia da base com `git apply --check --whitespace=error-all` e reproduziu os 13 arquivos então existentes. O patch preservado não contém credenciais reais, `.env`, logs, dependências ou temporários; as URLs `fixture:fixture` dos unitários são exclusivamente valores fictícios para exercitar a guarda. Não houve staging, commit ou push nesta consolidação.
