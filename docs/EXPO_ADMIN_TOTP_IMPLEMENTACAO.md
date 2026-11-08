# ArenaGo — Correção do login administrativo com TOTP no Expo

## Estado e escopo

Implementação preparada na branch `feature/events-participations`, HEAD-base `a34c0a94782cfb0f7fbe47f899fa538386565d87`. A correção se limita ao gerenciador de autenticação, ao contexto, à tela de login e aos respectivos testes frontend. As alterações locais preexistentes de Arena, participações, ingresso, mailer e fixtures backend foram preservadas e não fazem parte desta evidência.

Os testes e o bundle **não foram executados nesta sessão**, por decisão explícita do responsável em 08/11/2026 e pela política do `AGENTS.md`. A campanha executável será realizada com Luna Medium. Não há aprovação desta implementação em Expo Go, dispositivo físico ou produção.

## Diagnóstico

O backend já devolve o desafio administrativo, mas `authService.login()` descartava o `tempToken`; `AuthContext` não oferecia confirmação do segundo fator; e `LoginScreen` mostrava somente um aviso. O participante/Staff já utilizava sessão HTTP real. Não foi identificado motivo para alterar o backend nesta correção.

Contratos conferidos no código:

- `POST /api/v1/auth/login`: `{ email, password }`; para Admin retorna `{ requires2FA: true, isTotpConfigured, tempToken, message }`, sem sessão.
- `POST /api/v1/auth/2fa/verify`: `{ tempToken, code }`, sem Bearer; retorna a sessão com usuário público, access token, refresh token e `expiresIn` somente depois da confirmação transacional.
- `twoFactorVerifySchema` aceita TOTP com seis dígitos ou recovery code hexadecimal minúsculo com 32 caracteres. A nova interface oferece o campo TOTP solicitado; o método do gerenciador respeita os dois formatos do DTO.
- A verificação usa `401 ADMIN_2FA_INVALID` genérico para código/desafio inválido, `409 ADMIN_TOTP_NOT_CONFIGURED`, `429 ADMIN_2FA_RATE_LIMITED` e `503 TOTP_CONFIGURATION_UNAVAILABLE`, além da validação 400. A resposta genérica 401 não permite distinguir com certeza código incorreto de expiração no servidor.

## Implementação e garantias

O `tempToken` fica em uma variável privada do `AuthSessionManager`. Não aparece no snapshot, no resultado público de login ou no `AuthContext`; não vai para SecureStore, access token, refresh token, logs ou navegação. O contexto expõe somente os metadados do desafio e os métodos `verifyAdminTwoFactor(code)` e `cancelAdminTwoFactor()`.

O login invalida a geração anterior no início da tentativa, antes de aguardar HTTP ou armazenamento. Logout, cancelamento, invalidação de sessão, novo login e saída da tela descartam o desafio. `sessionEpoch` impede publicação ou gravação de credenciais de uma resposta antiga. A intenção de credenciais continua coordenada pela fila de armazenamento existente.

A confirmação compartilha uma única Promise entre chamadas concorrentes. Envia exclusivamente `{ tempToken, code }`, sem reenviar e-mail/senha, sem Bearer e sem retry automático de autenticação. A resposta válida segue o mesmo `completeLogin()` usado por Participante/Staff: valida o corpo, persiste somente o refresh token no adaptador seguro existente, verifica a geração e publica a sessão. O access token permanece em memória e o `/auth/me` e refresh existentes são preservados. A navegação continua sendo decidida pelo `AuthSessionGate` a partir da sessão publicada.

O prazo local conservador é de 299 segundos a partir do início da tentativa de login. O backend usa JWT temporário com TTL de 300 segundos e arredonda sua emissão em segundos. A aplicação não decodifica claims não verificadas para tomar decisões de autorização; o timer local e a checagem antes/depois do HTTP apenas limitam a vida do desafio na interface. O servidor continua sendo a autoridade sobre assinatura, finalidade, expiração e consumo único.

Código inválido preserva o desafio ainda vigente e não publica sessão. Falha de rede/timeout, resultado de confirmação incerto, resposta de sessão inválida ou limite 429 descartam a tentativa local e exigem novo login. O app não repete automaticamente uma confirmação que pode já ter consumido o desafio. Uma falha 503 mantém a possibilidade de tentar novamente enquanto o desafio estiver válido. Erro de gravação segura não publica a sessão e provoca tentativa de limpeza das credenciais locais.

A tela mantém os estilos existentes. Quando há TOTP configurado, mostra campo numérico com seis dígitos, “Verificar código”, loading, mensagens de erro e cancelamento disponível inclusive durante o HTTP. Remove a senha do estado local depois do desafio. Cancelamento/blur também limpam código e senha; respostas de uma submissão anterior não repõem erros ou loading em uma tentativa nova.

## Contas sem TOTP configurado

As rotas existentes `/auth/2fa/setup` e `/auth/2fa/confirm` exigem também um `activationToken`. A emissão dessa autorização é interna/CLI e exige a proveniência específica do primeiro Admin, conforme B1/B2. Receber `tempToken` no login não fornece essa autorização. O onboarding de outros Admins promovidos continua uma pendência arquitetural independente.

Assim, a tela informa que a configuração deve seguir o procedimento administrativo existente e permite cancelar; não oferece confirmação, gera segredo ou simula sessão. Nenhum CLI, credencial ou endpoint de ativação foi executado por esta tarefa.

## Testes preparados e inspeções realizadas

Foram adicionadas **24 declarações de teste** em `app/tests/auth.test.cjs`, algumas com variações internas. Cobrem:

- Participante/Staff, exposição dos métodos pelo contexto e ausência do token temporário no estado público.
- TOTP válido, inválido e malformado; desafio expirado, cancelado, substituído ou sem token; proibição de reutilização após sucesso.
- Confirmação concorrente única, logout/cancelamento durante HTTP e durante a gravação segura, novo login e resposta de senha/2FA atrasada.
- Rede, timeout, HTTP 429/503, resposta incompleta, falha de SecureStore e ausência de refresh/restauração usando o desafio.
- Interface numérica, loading, duplo toque, sucesso/erro, cancelamento, blur, orientação para conta sem TOTP e retorno ao login após erro de rede/expiração.

Os testes existentes de cadastro, senha, navegação, restauração, refresh e logout foram preservados. A fixture de autenticação aceita um relógio local injetado para os cenários de prazo; nenhum teste muda o relógio global ou faz chamadas reais de autenticação.

Executadas somente inspeções estáticas: leitura dos contratos e dependências, análise sintática sem executar os módulos, revisão do diff, `git diff --check` e validação da evidência em árvore isolada. Nenhum teste, lint, typecheck, build, bundle, SQL, migration ou operação de banco foi executado. Os totais históricos informados no pedido não são resultados desta correção.

## Comandos preparados para Luna Medium

Em uma sessão PowerShell exclusiva, conferir a branch e inspecionar os scripts antes de executar. Não carregar variáveis ou arquivos de backend. O script de testes do `app/package.json` é `node --test tests/*.test.cjs`; os testes de autenticação usam fetch e SecureStore simulados.

```powershell
Set-Location 'C:\DoJob\ProgramacaoMobile\app'

# Primeiro, autenticação e navegação pertinentes; interromper se houver falhas.
node.exe --test tests/auth.test.cjs tests/authNavigation.test.cjs tests/authValidation.test.cjs
if ($LASTEXITCODE -ne 0) { throw 'Validação focada falhou; investigar antes de continuar.' }

# Depois, regressão completa do frontend, sem PostgreSQL.
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Regressão frontend falhou; investigar antes do bundle.' }

# Exportação Metro local para iOS; não inicia servidor nem publica o aplicativo.
# Sem leitura de .env. As variáveis abaixo valem somente para esta sessão PowerShell.
$env:EXPO_NO_DOTENV = '1'
$env:CI = '1'
$bundleTOTP = Join-Path $env:TEMP ('arenago-admin-totp-bundle-' + [guid]::NewGuid().ToString('N'))
& .\node_modules\.bin\expo.cmd export --platform ios --output-dir $bundleTOTP
if ($LASTEXITCODE -ne 0) { throw 'Bundle iOS falhou; registrar o erro antes de prosseguir.' }

git diff --check
```

O comando de exportação foi conferido na CLI Expo instalada; não foi executado. Registrar contagens, falhas, skips, códigos de saída e eventual bloqueio de infraestrutura na campanha. Não instalar dependências, executar backend, migrations ou integrações PostgreSQL para validar esta correção frontend.

## Validação manual no Expo Go

Após a aprovação automatizada, usar a configuração de conexão já existente, sem alterar segredos. Confirmar no iPhone: login de Participante/Staff, desafio Admin configurado, código incorreto, código atual válido, loading, cancelamento, retorno à tela, logout e reabertura com a sessão criada após 2FA. Uma conta sem TOTP deve exibir a orientação administrativa e permanecer sem sessão.

Se a rede cair depois da confirmação, iniciar novo login; não considerar a ausência de resposta prova de rollback. Cancelar localmente não revoga no servidor uma requisição já recebida: a aplicação descarta a resposta antiga, e o backend mantém suas regras de expiração, consumo e substituição de sessões. Não foram criados endpoints de cancelamento ou onboarding.

## Inventário e evidência

1. `app/services/authService.js`
2. `app/context/AuthContext.js`
3. `app/screens/auth/LoginScreen.js`
4. `app/tests/auth.test.cjs`
5. `docs/EXPO_ADMIN_TOTP_IMPLEMENTACAO.md`

Evidência única: `qa-evidence/expo-admin-totp-changes.diff`, contra o HEAD-base indicado. Inclui os cinco arquivos acima, excluindo a própria evidência e todo o trabalho local de outras tarefas. A comparação da reconstrução considera a normalização CRLF/LF do Git para arquivos de texto.

Pendências: execução com Luna Medium, aprovação da regressão frontend e do bundle iOS e teste real no Expo Go. Nenhum staging, commit, push ou alteração de branch/HEAD foi realizado.
