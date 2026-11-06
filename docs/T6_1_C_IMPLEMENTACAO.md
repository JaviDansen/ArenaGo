# T6.1-C — Conclusão do login administrativo com TOTP

**Estado:** implementação concluída e aprovada nas validações manuais informadas pelo responsável. Não representa validação de produção ou homologação.
**Branch/base inicial:** `feature/events-participations` / `7fa5e40d4d50ca9faabca9e94fe8335e553d304f`.
**B2:** já estava commitada na base. Índice e working tree estavam limpos antes da task.

## Contrato HTTP

`POST /api/v1/auth/2fa/verify` é público e recebe estritamente:

```json
{ "tempToken": "...", "code": "..." }
```

`code` é string e aceita exatamente seis dígitos TOTP ou um recovery code hexadecimal minúsculo de 32 caracteres, no formato emitido pela B2. O schema é estrito: não aceita `userId`, e-mail, papel, sessão ou propriedades adicionais. O endpoint retorna o `AuthSessionResponseDto` existente somente após o commit, com projeção pública da conta, access token de 15 minutos, refresh token opaco e `expiresIn: 900`. Segredos, códigos, hashes e campos internos nunca são serializados. Login, verificação, cadastro e refresh retornam `Cache-Control: no-store` e `Pragma: no-cache`.

O desafio é assinado com o segredo temporário existente, tem `type='2fa_challenge'`, UUID de conta e `jti`, duração máxima de cinco minutos e não contém `sid`. A assinatura/formato são verificados antes do acesso ao banco; a validade temporal decisiva é revalidada com `clock_timestamp()` dentro da transação PostgreSQL. A linha persistida do desafio precisa corresponder ao mesmo titular, `jti`, `iat` e `exp`. O mesmo `jti` não pode ser consumido duas vezes; cada novo login Admin invalida os desafios anteriores ainda abertos. O verificador comum de Bearer continua aceitando somente tokens `type='access'`.

Erros RFC 7807: `400 VALIDATION_ERROR`, `401 ADMIN_2FA_INVALID`, `409 ADMIN_TOTP_NOT_CONFIGURED`, `429 ADMIN_2FA_RATE_LIMITED` com `Retry-After: 900`, e `503 TOTP_CONFIGURATION_UNAVAILABLE` para configuração ou estado histórico inconsistente. Respostas de desafio/código inválidos são genéricas.

## Fatores, estado e segurança

- TOTP mantém RFC 6238/SHA-1, passo de 30 segundos, seis dígitos e janela ±1 passo. O instante PostgreSQL é usado na validação. `last_totp_counter` guarda o maior passo aceito na própria credencial; sob lock, um passo igual ou anterior não pode ser reutilizado.
- Para abrir o segredo AES-256-GCM, a consulta exige exatamente uma autorização inicial consumida (`totp_activation_tokens`, `issued_by IS NULL`) e exatamente um registro `totp_initial_activated`. Ambiguidade, revogação do token ou uso posterior à expiração é rejeitado. O AAD original da B2 (`userId` + `authorizationId`) e a autenticação da cifra são preservados; segredo claro não é persistido.
- Recovery code usa `recoveryCodeHash` HMAC-SHA-256 da B2, incluindo titular e chave. Os hashes são comparados em tempo constante; o código é marcado `used_at` na mesma transação da sessão. Essa via depende da chave HMAC, não da abertura do segredo AES; TOTP exige a chave AES e a autorização original. Código incorreto, utilizado ou pertencente a outra conta não cria sessão e produz a mesma resposta pública.
- Falhas de segundo fator são registradas em `audit_logs` sem códigos ou tokens. A conta é bloqueada antes de contar tentativas; cinco rejeições nos últimos 15 minutos bloqueiam tentativas seguintes durante a janela, inclusive após reinício do processo.
- A ordem de locks começa por `users`, papéis Admin ativos, credencial TOTP, desafio e, para recovery, códigos; depois bloqueia/revoga sessões anteriores e seus refresh tokens. O estado de conta ativa, e-mail confirmado e Admin global é revalidado sob locks. Staff ou participante sem Admin continua no fluxo de login atual sem TOTP.
- Antes do segundo fator, senha correta de Admin produz apenas desafio: não emite sessão/refresh nem revoga sessão anterior. Após fator aceito, desafio, contador/código, revogação da sessão anterior (inclusive expirada), sessão nova com `admin_2fa_verified_at` PostgreSQL, hash de refresh e auditoria de sucesso são efetivados atomicamente. Access/refresh tokens só são devolvidos depois de `COMMIT`; falha de commit não devolve tokens.
- Refresh, logout e autorização Admin continuam usando os controles existentes. A validação de papel vigente permanece no backend; claims JWT não são fonte suficiente de autorização. A autenticação não altera participações, filas ou histórico.

## Persistência e migration

Migration `backend/drizzle/0006_admin_2fa_login.sql`, registrada no journal Drizzle e coerente com `backend/src/database/schema/access.schema.ts`:

1. adiciona `user_totp_credentials.last_totp_counter bigint NULL`, inicialmente vazio para credenciais da B2;
2. cria `admin_2fa_challenges`, com `jti` como PK, titular, emissão/expiração, consumo/invalidação, FK para `users`, índices por titular/criação e expiração e checks temporais/terminais.

Não há dependência nova nem alteração de setup/confirm da B2. O responsável aplicou manualmente a migration 0006 em `arenago_bootstrap_test` e `arenago_events_test`; o Codex não executou migrations. Não copiar nem reconstruir dados entre os bancos.

## Cobertura implementada e correções

- `backend/test/unit/admin-two-factor.unit.test.ts`: contrato estrito, formato e janela TOTP/replay, formato de recovery code e HTTP local simulado com status RFC 7807 e cabeçalhos.
- `backend/test/unit/schema.test.ts`: confere 24 tabelas, presença explícita de `admin_2fa_challenges`, os 23 nomes anteriores e ausência de duplicações.
- `backend/test/integration/admin-two-factor-login.integration.test.ts`: PostgreSQL real/HTTP Nest para TOTP e recovery, código inválido/reutilizado, limite persistente, desafio expirado/adulterado/invalidado/concorrente, concorrência de TOTP/recovery/logins, chave/cifra/referência de autorização, conta/papel, Staff/participante, sessão/refresh/logout, rollback após falhas SQL/auditoria/COMMIT, primeiro login Admin sem desafios prévios (desafio persistido e nenhuma sessão antes do segundo fator) e ausência de mutação de participação/fila.
- Compatibilidade: as fixtures de limpeza B1 e B2 removem somente os desafios dos próprios titulares, agora necessários pela FK. O teste histórico de login Admin foi alinhado ao contrato: a sessão anterior permanece até o segundo fator; se ela não tinha verificação Admin, o guard continua negando acesso.

## Validação manual — responsável

As validações abaixo foram executadas manualmente pelo responsável. O Codex não executou testes, lint, typecheck, build, migrations, seeds, SQL ou comandos PostgreSQL nesta consolidação.

Usar a chave local existente `TOTP_ENCRYPTION_KEY` e `TOTP_RECOVERY_HMAC_KEY` da B2, sem imprimi-las, rotacioná-las ou incluí-las em arquivos. O guard da integração B1 usado pela suíte C valida `NODE_ENV=test`, as três URLs idênticas, credenciais explícitas e exatamente `127.0.0.1:55432/arenago_bootstrap_test`; a suíte ainda confirma `current_database()` antes de criar fixtures. A suíte não exige banco vazio nem apaga Admins históricos.

Exemplo de preparação segura em PowerShell; executar em sessão local sem transcript e carregar as chaves do cofre local sem eco:

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
# Carregar do cofre local, sem imprimir ou salvar os valores:
# TOTP_ENCRYPTION_KEY, TOTP_RECOVERY_HMAC_KEY, JWT_SECRET, JWT_TEMP_SECRET

function Set-C-TestDatabase {
  param([ValidateSet('arenago_bootstrap_test','arenago_events_test')][string]$Database)
  $secure = Read-Host "URL PostgreSQL local para $Database" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
  $parsed = $null
  if (-not [uri]::TryCreate($value,[UriKind]::Absolute,[ref]$parsed) -or
      $parsed.Scheme -notin @('postgresql','postgres') -or
      $parsed.Host -cne '127.0.0.1' -or $parsed.Port -ne 55432 -or
      $parsed.AbsolutePath -cne "/$Database" -or $value.Contains('?') -or
      $value.Contains('#') -or -not $parsed.UserInfo) { throw 'Destino PostgreSQL não autorizado.' }
  $env:DATABASE_URL = $value
  $env:DATABASE_DIRECT_URL = $value
  $env:EVENTS_TEST_DATABASE_URL = $value
  $parts = [uri]::UnescapeDataString($parsed.UserInfo)
  $separator = $parts.IndexOf(':')
  if ($separator -le 0 -or $separator -eq ($parts.Length - 1)) { throw 'Credenciais explícitas obrigatórias.' }
  $env:PGHOST = $parsed.Host
  $env:PGPORT = [string]$parsed.Port
  $env:PGDATABASE = $Database
  $env:PGUSER = $parts.Substring(0,$separator)
  $env:PGPASSWORD = $parts.Substring($separator + 1)
}

function Invoke-C-TestQuery {
  param([Parameter(Mandatory)][string]$Query)
  if (Get-Command psql -ErrorAction SilentlyContinue) {
    $result = & psql -X -v ON_ERROR_STOP=1 -Atqc $Query
  } else {
    # Fallback para o cliente instalado no contêiner local, sem imprimir URL ou senha.
    $result = & docker exec arenago-e08-pg18 psql -X -U $env:PGUSER -d $env:PGDATABASE -v ON_ERROR_STOP=1 -Atqc $Query
  }
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar o destino PostgreSQL.' }
  return $result
}
function Confirm-C-TestDatabase {
  param([ValidateSet('arenago_bootstrap_test','arenago_events_test')][string]$Database)
  if ($env:DATABASE_URL -cne $env:DATABASE_DIRECT_URL -or $env:DATABASE_URL -cne $env:EVENTS_TEST_DATABASE_URL) {
    throw 'As três URLs PostgreSQL devem ser idênticas.'
  }
  $parsed = $null
  if (-not [uri]::TryCreate($env:DATABASE_URL,[UriKind]::Absolute,[ref]$parsed) -or
      $parsed.Host -cne '127.0.0.1' -or $parsed.Port -ne 55432 -or
      $parsed.AbsolutePath -cne "/$Database" -or $parsed.Query -or $parsed.Fragment) {
    throw 'Host, porta publicada ou banco da URL não correspondem ao destino de teste.'
  }
  $actual = Invoke-C-TestQuery 'SELECT current_database()'
  if ($actual -cne $Database) { throw 'O banco conectado não corresponde ao destino autorizado.' }
}
function Confirm-C-Schema {
  $ready = Invoke-C-TestQuery "SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_totp_credentials' AND column_name='last_totp_counter') AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_2fa_challenges'))::int"
  if ($ready -cne '1') { throw 'Migration T6.1-C não está presente no banco esperado.' }
}

# Confirmar o destino antes de cada migration. Não reutilizar o banco dedicado para a regressão compartilhada:
Set-C-TestDatabase 'arenago_bootstrap_test'
Confirm-C-TestDatabase 'arenago_bootstrap_test'
if ((Read-Host 'Digite arenago_bootstrap_test para autorizar esta migration') -cne 'arenago_bootstrap_test') { throw 'Migration cancelada.' }
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migration falhou no banco dedicado.' }
Confirm-C-Schema
Set-C-TestDatabase 'arenago_events_test'
Confirm-C-TestDatabase 'arenago_events_test'
if ((Read-Host 'Digite arenago_events_test para autorizar esta migration') -cne 'arenago_events_test') { throw 'Migration cancelada.' }
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migration falhou no banco compartilhado.' }
Confirm-C-Schema
```

Ambiente reproduzível para regressão unitária e inicialização dos módulos HTTP/DI. Definir no processo PowerShell antes de iniciar os comandos; estes valores são exclusivos de teste e não alteram configuração de produção:

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
# Opcional; o padrão do código é 30000 ms. Só definir ao testar o intervalo do scheduler.
# $env:EVENT_CLOSURE_INTERVAL_MS = '30000'
$env:EMAIL_VERIFICATION_TTL_SECONDS = '86400'
$env:EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = '120'
$env:EMAIL_VERIFICATION_MAX_PER_HOUR = '5'
```

A política de verificação de e-mail usa esses três valores como padrões quando as variáveis não estão definidas. Para a regressão normal, mantenha `RESEND_API_KEY`, `RESEND_FROM` e `EMAIL_VERIFICATION_CONFIRMATION_URL` ausentes: assim o módulo não ativa configuração de envio externo. Os testes unitários específicos do mailer usam valores fictícios internos às fixtures. Não copie chaves de produção, não habilite envio externo para a regressão e não registre valores secretos.


Unitários focados e verificações locais:

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-two-factor.unit.test.ts test/unit/auth.unit.test.ts test/unit/totp-activation-crypto.test.ts test/unit/totp-activation-service.test.ts test/unit/totp-activation-http.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Unitários focados falharam.' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Regressão unitária falhou.' }
.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit --incremental false
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de produção falhou.' }
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de testes falhou.' }
npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }
```

Integrações dedicadas/compartilhadas, sempre serializadas; não usar `npm run test:integration` com apenas um banco configurado:

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
Set-C-TestDatabase 'arenago_bootstrap_test'
Confirm-C-TestDatabase 'arenago_bootstrap_test'
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-two-factor-login.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração PostgreSQL C falhou.' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/totp-activation.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Compatibilidade PostgreSQL B2 falhou.' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/first-admin-bootstrap.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Compatibilidade PostgreSQL B1 falhou.' }

Set-C-TestDatabase 'arenago_events_test'
Confirm-C-TestDatabase 'arenago_events_test'
$excluded = @('admin-two-factor-login.integration.test.ts','totp-activation.integration.test.ts','first-admin-bootstrap.integration.test.ts')
$shared = @(Get-ChildItem test/integration -Filter '*.test.ts' -File |
  Where-Object { $_.Name -notin $excluded } | Sort-Object Name | ForEach-Object { $_.FullName })
if ($shared.Count -eq 0) { throw 'Nenhuma suíte compartilhada encontrada.' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 $shared
if ($LASTEXITCODE -ne 0) { throw 'Regressão PostgreSQL compartilhada falhou.' }
```

Não executar `DROP`, `TRUNCATE` ou limpeza global. As fixtures removem apenas IDs que criaram. Não executar B1/B2/C em paralelo nem apontar as três URLs a bancos diferentes.

## Retomada: correção da fixture de desafio expirado

Na primeira integração PostgreSQL executada manualmente pelo responsável, 14 cenários passaram e um cenário falhou; o teste agrupador também foi contabilizado como reprovado (código de saída 1). A falha foi `23514` na constraint `ck_admin_2fa_challenges_expiration`, durante a preparação do cenário “desafio expirado, adulterado e invalidado por nova senha”: a fixture alterava `expires_at` para antes do horário atual e mantinha `issued_at` original, violando `expires_at > issued_at` antes da chamada HTTP.

A fixture foi corrigida sem mudança de produção ou da migration 0006. Agora cria um JWT de desafio legítimo com `signTempTwoFactorToken`, usando emissão suficientemente antiga para que o token já esteja expirado. Persiste `jti`, `iat` e `exp` convertidos diretamente das claims assinadas, mantendo `expires_at > issued_at` e o limite máximo de cinco minutos da constraint. A chamada `/auth/2fa/verify` retorna 401; o cenário verifica que nenhuma sessão foi criada nem recovery code consumido. O responsável confirmou a aprovação final da integração C com 16/16. Os subcenários de assinatura adulterada e invalidação por novo login foram preservados. Não há sleeps nem alteração de relógio global.

A migration 0006 foi aplicada manualmente pelo responsável nos bancos `arenago_bootstrap_test` e `arenago_events_test`. Na verificação daquela etapa, os seis Admins históricos então existentes foram preservados. Posteriormente, a investigação de C15 identificou um sétimo Admin persistido pela fixture sem cleanup; nenhuma limpeza desse registro foi autorizada. A validação posterior da fixture confirmou sete Admins antes e depois, sem qualquer registro Admin adicionado, removido ou modificado nessa execução. O Codex não acessou o banco.

## Correção da fixture C15 e preservação do banco compartilhado

A fixture C15 de `backend/test/integration/auth.integration.test.ts` registra os IDs do usuário, papel Admin e credencial TOTP criados pelo cenário; recupera dependências geradas pelo cadastro/login estritamente pelo ID do usuário recém-criado; e executa a limpeza em `finally`. A ordem respeita as FKs: refresh tokens antes das sessões, depois desafios, auditorias, credencial TOTP, papéis e conta. As exclusões usam IDs, sem filtros globais por papel ou padrão de e-mail. Se o teste e a limpeza falham, um `AggregateError` inclui ambos e define `cause` para o erro original; falhas isoladas são propagadas sem encapsulamento.

A validação PostgreSQL Auth após essa correção passou 20/20. A comparação manual confirmou sete Admins antes e depois e nenhum registro Admin modificado, adicionado ou removido. O sétimo Admin antigo permanece no banco de teste; sua remoção não foi solicitada nem autorizada. A fixture não altera registros históricos.

A validação ESLint também identificou quatro erros no tratamento de exceções da C15. A implementação foi ajustada para capturar separadamente as falhas do teste e da limpeza, sem lançar dentro do `finally`; ESLint foi aprovado na validação manual informada. As asserções e a limpeza restrita por IDs foram preservadas.

## Validações finais confirmadas pelo responsável

As validações abaixo foram executadas manualmente pelo responsável. O Codex não executou testes, lint, typecheck, build, migrations, seeds, SQL ou comandos PostgreSQL nesta consolidação.

- Testes unitários: **1.106/1.106 aprovados**.
- Integração PostgreSQL T6.1-C: **16/16 aprovados**.
- Compatibilidade PostgreSQL B2: **32/32 aprovados**.
- Compatibilidade PostgreSQL B1: **4/4 aprovados**.
- Regressão PostgreSQL compartilhada: **1.255/1.255 aprovados**.
- Integração Auth após a correção da fixture C15: **20/20 aprovados**.
- ESLint, typecheck de produção, typecheck de testes e build: **aprovados**.

## Configuração operacional e limites

Não há emissão/rotação de chaves nesta task. TOTP exige as mesmas chaves independentes da B2: `TOTP_ENCRYPTION_KEY` AES-256 e `TOTP_RECOVERY_HMAC_KEY` HMAC-SHA-256, ambas base64 canônico com 32 bytes, distintas de `JWT_SECRET`/`JWT_TEMP_SECRET`. Recovery code exige a chave HMAC válida e independente; não depende da chave AES. Ausência, divergência ou perda impede a autenticação correspondente; não há fallback.

Não implementa reset TOTP, regeneração de recovery codes, CLI emergencial, concessão/revogação de papéis, interface Expo, e-mail, BI, deploy ou configuração de produção. Não foi executado CLI real, produção ou homologação. A retenção/expurgo futuro de desafios e auditorias e a rotação/recuperação de chaves continuam decisões operacionais pendentes. A aplicação da migration e as validações desta implementação foram concluídas manualmente pelo responsável, conforme os resultados acima. Revisão e validação de produção não foram realizadas; não declarar prontidão produtiva.

## Inventário e evidência

Arquivos da task: `backend/src/auth/auth.controller.ts`, `auth.dto.ts`, `auth.service.ts`, `admin-two-factor.crypto.ts`, `totp-challenge.ts`, `backend/src/database/schema/access.schema.ts`, `backend/drizzle/0006_admin_2fa_login.sql`, `backend/drizzle/meta/_journal.json`, `backend/test/unit/admin-two-factor.unit.test.ts`, `backend/test/integration/admin-two-factor-login.integration.test.ts`, `backend/test/integration/auth.integration.test.ts`, `backend/test/integration/first-admin-bootstrap.integration.test.ts`, `backend/test/integration/totp-activation.integration.test.ts`, `backend/test/unit/schema.test.ts`, `docs/ARQUITETURA_BACKEND_ARENAGO.md` e este relatório.

Evidência única: `qa-evidence/t6-1-c-changes.diff`, baseada no HEAD inicial `7fa5e40d4d50ca9faabca9e94fe8335e553d304f`, contendo todos os arquivos acima e excluindo a própria evidência, segredos, `.env`, logs, dependências e outras tasks. Patch aplicado sem erros em cópia isolada da base; os 16 arquivos da task foram comparados byte a byte após normalização da quebra de linha de checkout Windows. Nenhuma validação executável foi realizada pelo Codex.
