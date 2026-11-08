# T6.1-B2 — ativação inicial segura do TOTP do primeiro Admin

## Base, escopo e situação

Branch `feature/events-participations`; base inicial `6db9a7d6d327ad12edd07682d4c901253eff8aa7`. O preflight encontrou índice e working tree limpos, com o fechamento e as correções da B1 versionados. A base histórica B1 não é a base desta evidência.

Implementação restrita à emissão CLI da autorização e à configuração/confirmação inicial do TOTP. Mantidos AuthService, AuthController, token.util, o bootstrap B1, A1/A2, E07/E08, schema, migrações e dependências. O único arquivo existente alterado é `auth.module.ts`, para registrar o novo controller e serviço.

As validações abaixo foram executadas manualmente pelo responsável. A revisão desta entrega pelo Codex é estática. Não há homologação ou declaração de prontidão de produção.

Referências de contrato: `PLANEJAMENTO_ARENAGO.md` §9.2, `ARQUITETURA_BACKEND_ARENAGO.md` §§2.2/4/14.4 e prompt aprovado da B2. A arquitetura citava rotas candidatas de verificação; esta entrega reserva `/confirm` para ativação inicial e não implementa `/verify` como login definitivo.

## Contrato CLI e elegibilidade

`TotpActivationService.issue(email)` é exposto somente pelo entrypoint `src/auth/issue-first-admin-totp.ts`. Não existe endpoint para emissão. A CLI aceita exclusivamente `--email <conta-bootstrap>` e recusa saída não interativa (`stdout.isTTY`), para impedir redirecionamento acidental do token.

Após as validações manuais e configuração segura do ambiente pelo responsável:

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$bootstrapEmail = Read-Host 'E-mail da conta promovida pelo bootstrap B1'
.\node_modules\.bin\tsx.cmd src/auth/issue-first-admin-totp.ts --email $bootstrapEmail
if ($LASTEXITCODE -ne 0) { throw 'Emissão não concluída. Conferir elegibilidade e configuração.' }
```

Este comando **não foi executado pelo Codex**. O operador precisa de acesso autorizado ao ambiente e ao banco; não há autenticação administrativa alternativa na CLI. Não usar captura de terminal, transcript, redirecionamento, log ou screenshot. A CLI mostra o token apenas na emissão, após COMMIT, e sua expiração; exibe aviso de sigilo. Entregar a autorização somente ao titular, que também precisa autenticar-se por senha.

A conta deve estar ativa, ter e-mail confirmado e papel Admin global vigente. A elegibilidade exige `granted_by IS NULL` e auditoria `first_admin_bootstrapped`, com `origin='cli'`, ator/evento nulos, mesmo alvo e `occurred_at = granted_at` do papel. A comparação é feita no PostgreSQL, preservando microssegundos. Ser Admin, ou ter `granted_by=NULL` isoladamente, não basta.

Credencial já verificada ou histórico `totp_initial_activated` bloqueiam a emissão. A CLI não recupera outra conta nem redefine TOTP confirmado. Nova emissão revoga autorizações anteriores não consumidas e remove somente a credencial pendente da própria conta, na mesma transação. Não apaga códigos de recuperação.

Token: 32 bytes aleatórios (256 bits), base64url, 43 caracteres; somente SHA-256 hexadecimal persistido. Expira em 30 minutos pelo relógio do PostgreSQL, `issued_by=NULL`. A confirmação consome uma vez. A emissão é auditada sem token, e-mail ou segredo nos metadados.

## Contrato HTTP

As rotas recebem as duas provas no corpo JSON. `tempToken` é o desafio retornado pelo login Admin após a senha correta, com `type='2fa_challenge'`, assinatura HS256 com `JWT_TEMP_SECRET`, `typ='JWT'`, UUIDs de conta/jti, `iat` não futuro e duração máxima de cinco minutos. Access token, token falsificado, expirado ou de outro tipo são recusados. Não há identidade fornecida separadamente pelo cliente.

| Rota | Corpo estrito | Resposta 200 |
|---|---|---|
| `POST /api/v1/auth/2fa/setup` | `{ tempToken, activationToken }` | `{ secret, otpauthUri }` |
| `POST /api/v1/auth/2fa/confirm` | `{ tempToken, activationToken, code }` | `{ activated: true, recoveryCodes: [...] }` |

`code` é texto. Códigos malformados em texto de até 128 caracteres entram no controle transacional de tentativas e recebem erro. Campos adicionais, identidade no corpo, tipos incorretos e limites de tamanho são recusados como DTO inválido. O desafio no cabeçalho Bearer não substitui as provas no corpo e continua rejeitado nas APIs comuns pelo verificador de access token existente.

As respostas têm `Cache-Control: no-store` e `Pragma: no-cache`. A confirmação não retorna segredo ou URI, nem accessToken, refreshToken ou sessão. Nenhuma operação atualiza `admin_2fa_verified_at`. Depois de ativado, novo login continua devolvendo desafio 2FA, agora com `isTotpConfigured=true`; o login definitivo com TOTP pertence a outra task.

| Status | Código | Condição |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Corpo inválido |
| 400 | `TOTP_CODE_INVALID` | Código incorreto/malformado com duas provas válidas; tentativa persistida |
| 401 | `TOTP_CHALLENGE_INVALID` | Desafio inválido, tipo incorreto, expirado ou fora do prazo de autenticação recente |
| 403 | `TOTP_ACTIVATION_FORBIDDEN` | Conta/papel/proveniência inelegíveis |
| 403 | `TOTP_AUTHORIZATION_INVALID` | Autorização ausente, expirada, revogada, consumida ou de outra conta |
| 409 | `TOTP_SETUP_REQUIRED` | Ainda não existe credencial pendente |
| 409 | `TOTP_ALREADY_ACTIVATED` | Credencial confirmada, histórico de ativação ou códigos preexistentes ao confirmar |
| 429 | `TOTP_ACTIVATION_RATE_LIMITED` | Limite atingido; `Retry-After: 900` |
| 503 | `TOTP_CONFIGURATION_UNAVAILABLE` | Chaves ausentes/inválidas ou falha de autenticação da cifra |
| 500 | `INTERNAL_SERVER_ERROR` | Falha inesperada de persistência, com rollback quando possível |

Erros seguem o filtro RFC 7807 existente. O serviço converte falhas inesperadas em problema genérico, sem encaminhar mensagens SQL ao logger global. Não incluir corpos dessas rotas em logs de proxy/APM. HTTPS e armazenamento seguro do cliente são requisitos operacionais.

## Criptografia e configuração

TOTP: segredo aleatório de 160 bits em Base32, HMAC-SHA-1, período de 30 segundos e seis dígitos. A janela aceita o passo anterior, o atual e o seguinte (±1 passo). Comparação em tempo constante; não há janela adaptativa. A URI contém issuer `ArenaGo`, identidade codificada no label e parâmetros explícitos `algorithm=SHA1`, `digits=6`, `period=30`.

Implementação com `node:crypto`, sem dependência nova. Referências: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) e [RFC 4226](https://www.rfc-editor.org/rfc/rfc4226). Os testes usam os vetores SHA-1 do RFC 6238 reduzidos a seis dígitos.

Segredo persistido em envelope `v1.iv.tag.ciphertext`, usando AES-256-GCM, nonce aleatório de 12 bytes e tag de 16 bytes. AAD inclui versão, UUID da conta e UUID da autorização. Copiar a cifra para outra conta/autorização, alterar conteúdo ou usar outra chave impede a abertura. Setup repetido com a mesma autorização devolve o mesmo segredo pendente, sujeito ao limite; não troca o segredo silenciosamente. Reemitir a autorização pela CLI reinicia apenas a pendência.

Configurações obrigatórias para operações B2:

- `TOTP_ENCRYPTION_KEY`: 32 bytes aleatórios, base64 canônico.
- `TOTP_RECOVERY_HMAC_KEY`: outros 32 bytes aleatórios, base64 canônico.
- `JWT_TEMP_SECRET` e `JWT_SECRET`: configuração Auth existente; manter valores explícitos, fortes e independentes no ambiente real.

As duas chaves TOTP devem ser diferentes entre si e não podem reutilizar os segredos JWT, em bytes UTF-8 ou base64. Não existem defaults para as chaves TOTP. A validação ocorre ao chamar B2, para não interromper os módulos anteriores quando B2 ainda não estiver configurada. Nenhuma chave reside no banco ou no repositório.

O responsável pode gerar as duas chaves **uma única vez**, em uma sessão local sem gravação/transcript:

```powershell
function New-B2SecretKey {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes); return [Convert]::ToBase64String($bytes) }
  finally { $rng.Dispose() }
}
$env:TOTP_ENCRYPTION_KEY = New-B2SecretKey
$env:TOTP_RECOVERY_HMAC_KEY = New-B2SecretKey
```

Não imprimir as variáveis. Guardá-las em cofre de segredos fora do banco/repositório e disponibilizar os mesmos valores à API e à CLI. Não gerar novamente ao reiniciar. A perda/troca da chave AES impede abrir os segredos existentes; a perda/troca da chave HMAC invalida a verificação futura dos códigos. Rotação e recuperação de chaves não foram implementadas nesta etapa.

Códigos de recuperação: dez códigos aleatórios de 16 bytes cada (128 bits), apresentados em hexadecimal somente na resposta de confirmação após COMMIT. O banco guarda HMAC-SHA-256 com namespace/versão/UUID da conta e `used_at=NULL`. O helper `recoveryCodeHash` permite à futura autenticação reproduzir o hash; o consumo único ainda precisa de operação transacional futura. Não existe rota para reler códigos nem reapresentação após retry.

## Transações, limites e concorrência

As três operações usam `READ COMMITTED` e ordem de locks `users → papel Admin → user_totp_credentials → totp_activation_tokens → user_backup_codes`. O papel é bloqueado para impedir revogação concorrente durante a mutação; o lock de conta serializa emissão, setup e confirmação mesmo quando não há credencial. Não há lock global novo.

Após locks, a validade do desafio e da autorização é reavaliada com `clock_timestamp()`. Na confirmação, credencial verificada, consumo do token, dez hashes e auditoria são persistidos atomicamente. Há nova verificação temporal após a última escrita e antes de COMMIT. Erros nessa fase revertem todas as escritas. Falha de conexão com resultado de COMMIT incerto exige consultar o estado antes de tentar novamente; não há promessa de recuperar os códigos de uma resposta perdida.

O relógio pode avançar entre a última verificação e o COMMIT; não se afirma atomicidade entre tempo de parede e confirmação do commit. Conta e papel permanecem protegidos pelos locks até terminar a transação. Manter relógios de aplicação/PostgreSQL sincronizados; uma divergência pode rejeitar desafios por segurança.

Proteção contra força bruta: cinco códigos rejeitados por conta em janela móvel de 15 minutos. A quinta tentativa inválida é persistida; as seguintes recebem 429, mesmo com código correto, até sair da janela. A auditoria de falha é confirmada antes de responder 400. Reemissão CLI ou reinício do serviço não apagam o contador. Há limite independente de cinco setups por conta em 15 minutos. As contagens usam `audit_logs`, sob lock da conta, e o índice existente por alvo/tempo. Não expurgar esses registros durante a janela de proteção.

Auditorias sem payload sensível: `totp_initial_authorization_issued` (CLI, ator nulo), `totp_initial_setup`, `totp_initial_code_rejected`, `totp_initial_activated` (usuário como ator). Metadados vazios. Uma segunda confirmação encontra a credencial/histórico confirmado e não gera outro conjunto de códigos.

## Testes preparados e execução manual

Contagem estática preparada: **44 testes unitários/HTTP simulados** e **32 testes PostgreSQL B2**. Esses números são inventário de casos, não resultados de execução.

### Validação manual e correção TS4053

Em 06/11/2026, o responsável informou **44/44 testes focados aprovados**, zero falhas e código de saída 0. A regressão unitária completa aprovou **1.101/1.101** testes. A integração PostgreSQL B2, no banco dedicado `arenago_bootstrap_test`, aprovou **32/32** testes; a compatibilidade PostgreSQL B1 no mesmo banco aprovou **4/4**. A regressão PostgreSQL compartilhada, no banco `arenago_events_test` e excluindo B1/B2, aprovou **1.255/1.255**, sem falhas. Typecheck de produção, typecheck de testes, ESLint e build NestJS também foram aprovados pelo responsável.

O typecheck de testes falhou em `src/auth/totp-activation.controller.ts:27:3` com **TS4053**: o retorno público inferido de `confirm` dependia de `ActivationConfirmed`, interface não exportada pelo serviço. A correção exporta essa interface e importa o tipo no controller, declarando explicitamente `Promise<ActivationConfirmed>`. Não há alteração no corpo da operação, no contrato HTTP ou nas regras de segurança.

O typecheck de testes foi aprovado após a correção TS4053. O total consolidado informado foi de **2.392 testes aprovados, zero falhas**, contando a regressão unitária de 1.101 como cobertura dos 44 focados, sem duplicá-los. O CLI real de autorização TOTP não foi executado; sua emissão continua sendo um procedimento operacional manual separado. O login administrativo definitivo após o desafio TOTP não faz parte desta task.

- Criptografia/desafio: 17 casos, incluindo vetores RFC, janela, Base32/URI, nonce, adulteração/AAD/chaves, HMAC e tipo/assinatura/expiração do JWT.
- Serviço: 13 casos de gravação, recusa, limite, auditoria da falha, rollback em cada fase/COMMIT, liberação de conexão e não emissão de sessão.
- HTTP simulado: 14 casos de DTO, cabeçalhos, status RFC 7807, Bearer insuficiente, ausência de endpoints de emissão/reset/login definitivo.
- PostgreSQL: 32 casos com login por senha real, bootstrap B1 real, HTTP, hashes/cifras, reemissão, proveniência, revogação, preservação de sessão sem segundo fator, expiração durante espera e após escritas, concorrência de confirmações/emissões, limites persistentes, SQL real seguido de falha/rollback/retry e configuração inválida. Não substitui PostgreSQL por mocks.

Os testes usam apenas chaves/segredos fictícios. Não enviam e-mails. A suíte PostgreSQL importa a guarda exclusiva da B1 antes de criar pools; exige três URLs idênticas e `127.0.0.1:55432/arenago_bootstrap_test`. Antes de qualquer fixture, confere o banco e exige zero Admins históricos. A limpeza elimina apenas UUIDs criados pela própria suíte, incluindo seus tokens/códigos/auditorias. Nenhuma limpeza alcança `arenago_events_test` ou seus quatro Admins históricos.

O schema já preparado para a B1 é suficiente. Não há migração nova. Se for necessário preparar um banco dedicado vazio, seguir o procedimento manual de criação com `template0` e migrações em `T6_1_B1_IMPLEMENTACAO.md`; não copiar dados do banco compartilhado. Não executar B1/B2 em paralelo nem junto das integrações compartilhadas com uma única URL. `npm run test:integration` inclui ambas e não deve ser usado indiscriminadamente.

### Unitários e verificações locais — somente responsável

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_DIRECT_URL = $env:DATABASE_URL
$env:EVENTS_TEST_DATABASE_URL = $env:DATABASE_URL
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/totp-activation-crypto.test.ts test/unit/totp-activation-service.test.ts test/unit/totp-activation-http.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Testes focados B2 falharam.' }
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

### PostgreSQL dedicado e compartilhado — somente responsável

Configurar localmente as URLs sem exibir credenciais. A função abaixo aceita somente os dois destinos de teste conhecidos; as suítes conservam suas próprias guardas mais específicas:

```powershell
function Set-B2TestDatabase {
  param([ValidateSet('arenago_bootstrap_test','arenago_events_test')][string]$Database)
  $secretUrl = Read-Host "URL PostgreSQL local de 127.0.0.1:55432/$Database" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretUrl)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $secretUrl.Dispose() }
  $parsed = $null
  if (-not [uri]::TryCreate($value,[UriKind]::Absolute,[ref]$parsed)) { throw 'URL inválida.' }
  if ($parsed.Scheme -notin @('postgresql','postgres') -or $parsed.Host -ne '127.0.0.1' -or $parsed.Port -ne 55432 -or $parsed.AbsolutePath -cne "/$Database" -or $value.Contains('?') -or $value.Contains('#') -or $parsed.UserInfo -notmatch '^[^:]+:.+$') { throw 'Destino não autorizado.' }
  $env:DATABASE_URL = $value
  $env:DATABASE_DIRECT_URL = $value
  $env:EVENTS_TEST_DATABASE_URL = $value
}
Set-Location 'C:\DoJob\ProgramacaoMobile\backend'
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
Set-B2TestDatabase 'arenago_bootstrap_test'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/totp-activation.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração B2 falhou. Investigar antes de prosseguir.' }
# Compatibilidade B1 no mesmo banco dedicado, serialmente e após a limpeza da B2:
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/first-admin-bootstrap.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração B1 falhou.' }

Set-B2TestDatabase 'arenago_events_test'
$sharedFiles = @(Get-ChildItem test/integration -Filter '*.test.ts' -File |
  Where-Object { $_.Name -notin @('first-admin-bootstrap.integration.test.ts','totp-activation.integration.test.ts') } |
  Sort-Object Name | ForEach-Object { $_.FullName })
if ($sharedFiles.Count -eq 0) { throw 'Nenhuma suíte compartilhada encontrada.' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 $sharedFiles
if ($LASTEXITCODE -ne 0) { throw 'Regressão PostgreSQL compartilhada falhou.' }
```

Nenhum comando acima foi executado pelo Codex. A separação obrigatória permanece: `arenago_bootstrap_test` para B1/B2 e `arenago_events_test` para as demais integrações. Se uma fixture falhar e deixar registros, investigar os UUIDs da própria execução ou recriar manualmente somente o banco dedicado conforme procedimento B1; não apagar Admins históricos para obter aprovação.

## Inventário e evidência

1. `backend/src/auth/auth.module.ts` — registro do controller e serviço.
2. `backend/src/auth/totp-activation.controller.ts` — dois contratos HTTP estritos.
3. `backend/src/auth/totp-activation.service.ts` — emissão, setup, confirmação, locks e auditoria.
4. `backend/src/auth/totp-activation.crypto.ts` — TOTP, cifra, configuração e hashes.
5. `backend/src/auth/totp-challenge.ts` — verificação estrita do desafio existente.
6. `backend/src/auth/issue-first-admin-totp.ts` — CLI restrita.
7. `backend/test/unit/totp-activation-crypto.test.ts`.
8. `backend/test/unit/totp-activation-service.test.ts`.
9. `backend/test/unit/totp-activation-http.test.ts`.
10. `backend/test/integration/totp-activation.integration.test.ts`.
11. `docs/T6_1_B2_IMPLEMENTACAO.md`.

Evidência única: `qa-evidence/t6-1-b2-changes.diff`, contra a base inicial desta task; contém esses 11 arquivos e exclui a própria evidência, credenciais, `.env`, logs e outras tasks. Verificação estática concluída: aplicação limpa em cópia isolada da base, comparação byte a byte de 11/11 arquivos, inventário completo e UTF-8 sem BOM. HEAD e índice preservados. Essa verificação do patch não executa nem substitui testes, typecheck, lint ou build.

## Limites e pendências

Não há login administrativo definitivo, emissão de sessão privilegiada, consumo de códigos de recuperação, reset por outro Admin, gestão geral de permissões, frontend/QR visual ou envio de e-mail. O CLI real de autorização não foi executado. A B1 permanece de uso único. Não foi iniciada outra task.

Riscos residuais: segurança da máquina/terminal do operador e entrega da autorização; manutenção e backup das chaves; janela curta de exposição do segredo no cliente; resposta de confirmação perdida após COMMIT (sem nova entrega de códigos); política futura de retenção das auditorias e proteção de tráfego no perímetro. Esses pontos não autorizam bypass, reset emergencial ou recuperação de TOTP pela CLI. Preservar pelo menos dois Admins verificados com TOTP antes de operação real, conforme planejamento; a gestão correspondente permanece em etapa própria.
