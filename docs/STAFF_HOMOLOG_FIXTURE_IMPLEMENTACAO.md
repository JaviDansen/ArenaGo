# Contas sintéticas para homologação Staff

## Escopo e limitações

O utilitário `backend/scripts/prepare-staff-homologation.cjs` prepara somente sete contas sintéticas: uma destinada ao bootstrap Admin, uma ao Staff e cinco participantes. Todos recebem UUID próprio, senha distinta fornecida em terminal e hash Argon2id com os parâmetros do cadastro real. A política de senha existente é aplicada. Os endereços são fictícios sob `arenago.invalid`; o utilitário marca o e-mail como verificado apenas como dado sintético de homologação. Cria o papel global `participante` como no cadastro e não cria papel Admin ou Staff, sessão, TOTP, perfil, evento ou participação.

A execução exige `NODE_ENV=test`, `--execute`, terminal interativo e a frase de autorização `AUTORIZO CONTAS SINTETICAS`. O destino TCP e o banco são fixos no código: `127.0.0.1:55432/arenago_staff_homolog_20261111`. O programa não carrega `.env` nem aceita URL ou opções de conexão; pede role e senha PostgreSQL em terminal, sem mostrar a senha. Rejeita variáveis de redirecionamento e `NODE_OPTIONS` no ambiente. O PostgreSQL confirma banco, endereço, porta e que não está em recuperação. Antes das escritas e novamente na transação, os sete hashes e timestamps do journal Drizzle são comparados aos arquivos desta branch; também são exigidos tabelas, check e trigger da 0007, questionário ativo e jogo curado. A transação bloqueia as tabelas e exige ausência de usuários, papéis, eventos e operações de idempotência. Conflitos ou erros abortam; se o resultado do commit for incerto, inspecione o banco antes de qualquer nova tentativa.

Essas verificações não comprovam ausência de proxy local, identidade operacional do cluster, equivalência integral do schema ou segurança dos privilégios. Conferir servidor, processo, porta, proprietário e ambiente antes da campanha. O banco `arenago_events_test` e seus dados históricos não devem ser usados. Nenhuma consulta PostgreSQL, fixture, seed, migration, teste ou build foi executado nesta implementação.

## Preparação posterior — não executada

Cada etapa de escrita requer autorização explícita própria. Em PowerShell, a partir da raiz, confirme branch, processo que escuta a porta e, com credenciais locais fornecidas interativamente, consulte somente metadados:

```powershell
git status --short --branch
Get-NetTCPConnection -LocalPort 55432 -State Listen
psql -X -h 127.0.0.1 -p 55432 -U <admin-local> -d postgres -W -v ON_ERROR_STOP=1 -c "SELECT current_database(), host(inet_server_addr()), inet_server_port(), pg_is_in_recovery(); SELECT datname FROM pg_database WHERE datname = 'arenago_staff_homolog_20261111';"
```

Substituir `<admin-local>` pelo nome da role local. Se o servidor não for o esperado ou o banco já existir, interromper. Após autorização para criação, usar uma role dedicada já autorizada e executar:

```powershell
createdb -h 127.0.0.1 -p 55432 -U <admin-local> -O <role-dedicada> -W arenago_staff_homolog_20261111
```

O dono deve ter privilégios limitados ao banco novo. Se for necessário criar uma role dedicada antes de criar o banco, isto é outra escrita no cluster e requer autorização específica; por exemplo, antes do `createdb`:

```powershell
createuser -h 127.0.0.1 -p 55432 -U <admin-local> -W --login --no-superuser --no-createdb --no-createrole --no-inherit --pwprompt arenago_staff_homolog
```

Nesse caso, use `arenago_staff_homolog` como `<role-dedicada>`. Confirmar novamente `current_database()`, endereço e porta conectando ao banco novo antes das migrations.

Após autorização para aplicar **somente 0001–0007**, confirme que a branch contém somente essas entradas no journal. Em um terminal PowerShell em `backend`, prepare uma URL local em memória sem expor senha no comando ou no relatório. O caminho escolhido para `DOTENV_CONFIG_PATH` deve não existir; a implementação de `dotenv/config` respeita essa variável. `DATABASE_DIRECT_URL` tem precedência na configuração Drizzle e deve ser igual à URL local.

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = Join-Path $env:TEMP ('arenago-no-dotenv-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $env:DOTENV_CONFIG_PATH) { throw 'Caminho dotenv já existe' }
[Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
$dbRole = Read-Host 'Role dedicada do banco local'
$dbSecret = Read-Host 'Senha da role local' -AsSecureString
$dbPlain = [System.Net.NetworkCredential]::new('', $dbSecret).Password
$dbUrl = 'postgresql://' + [uri]::EscapeDataString($dbRole) + ':' + [uri]::EscapeDataString($dbPlain) + '@127.0.0.1:55432/arenago_staff_homolog_20261111'
$dbPlain = $null
$env:DATABASE_URL = $dbUrl
$env:DATABASE_DIRECT_URL = $dbUrl
npm.cmd run db:migrate
```

Interrompa se houver erro; não repita automaticamente. Confirme journal, hashes e `current_database()` antes de prosseguir. O script Drizzle aplica as migrations pendentes listadas no journal; não o use se outra migration aparecer. Após autorização separada para dados iniciais, no mesmo ambiente execute `npm.cmd run db:seed`. O seed insere a versão publicada do questionário e jogos curados; não cria contas nem evento.

Após autorização separada para criar contas, ainda em `backend`, mantenha `$dbUrl` somente em memória e limpe do processo as variáveis que a fixture recusa. Execute sem redirecionar saída ou registrar a sessão:

```powershell
@('NODE_OPTIONS','DATABASE_URL','DATABASE_DIRECT_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS') | ForEach-Object { [Environment]::SetEnvironmentVariable($_, $null, 'Process') }
$env:NODE_ENV = 'test'
node scripts/prepare-staff-homologation.cjs --execute
```

O utilitário solicita a role e sua senha PostgreSQL, verifica o destino, pede a frase de autorização e solicita duas vezes uma senha nova e distinta para cada conta. Use apenas credenciais sintéticas, nunca reutilize credenciais reais. Ele encerra se qualquer conta, evento, concessão ou idempotência já existir no banco; não faz limpeza nem sobrescreve registros. Após o uso, limpe `$dbUrl` e outros valores sensíveis do processo quando não forem mais necessários.

## Bootstrap e cenário real

Para os comandos a seguir, restaure no processo `DATABASE_URL` e `DATABASE_DIRECT_URL` com `$dbUrl`, mantendo `DOTENV_CONFIG_PATH` apontando para caminho inexistente e `NODE_OPTIONS` vazio. Configure chaves sintéticas independentes `JWT_SECRET`, `JWT_TEMP_SECRET`, `TOTP_ENCRYPTION_KEY` e `TOTP_RECOVERY_HMAC_KEY` em memória. As duas chaves TOTP devem ser 32 bytes distintos codificados em base64, independentes dos segredos JWT; conserve-as durante a campanha, pois trocar a chave de criptografia impede usar o TOTP configurado.

Para gerá-las no processo PowerShell atual, sem imprimir os valores:

```powershell
$env:DATABASE_URL = $dbUrl
$env:DATABASE_DIRECT_URL = $dbUrl
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  foreach ($keyName in @('JWT_SECRET','JWT_TEMP_SECRET','TOTP_ENCRYPTION_KEY','TOTP_RECOVERY_HMAC_KEY')) {
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    [Environment]::SetEnvironmentVariable($keyName, [Convert]::ToBase64String($bytes), 'Process')
  }
} finally { $rng.Dispose() }
```

Depois de autorização para estas escritas, faça o bootstrap do primeiro Admin com a conta sintética:

```powershell
.\node_modules\.bin\tsx.cmd src/auth/bootstrap-first-admin.ts --email staff-homolog-admin@arenago.invalid
.\node_modules\.bin\tsx.cmd src/auth/issue-first-admin-totp.ts --email staff-homolog-admin@arenago.invalid
```

A segunda ferramenta imprime uma autorização sensível de uso único no terminal interativo. Não capture saída, imagem ou log. Ela revoga autorizações pendentes e remove credenciais TOTP **não verificadas** anteriores dessa conta; use somente no banco e conta sintéticos, com autorização e após conferir seu estado. Verifique que a porta 3000 está livre e inicie o backend neste mesmo terminal, que possui as chaves e URLs locais:

```powershell
$env:PORT = '3000'
$env:API_BIND_HOST = '0.0.0.0'
npm.cmd run start:dev
```

Em outro terminal, autentique o Admin por senha, use o desafio e a autorização nos endpoints `/auth/2fa/setup` e `/auth/2fa/confirm`, configure o aplicativo autenticador e conclua o login TOTP. Mantenha códigos e tokens fora de logs e relatórios.

Com Admin autenticado, crie o evento por `POST /api/v1/admin/events`, uma experiência por `POST /api/v1/admin/events/:eventId/experiences` e duas estações por `POST /api/v1/admin/events/:eventId/experiences/:experienceId/stations`; envie uma `Idempotency-Key` nova por intenção. Conceda Staff pela API `POST /api/v1/admin/roles/grant` com `{ "role": "staff", "email": "staff-homolog-staff@arenago.invalid", "eventId": "<UUID>" }`. Admin deve estar ativo, verificado e autenticado com TOTP; o Staff deve estar ativo e verificado.

Obtenha `clock_timestamp()` do servidor local para calcular os horários em UTC: início cinco minutos antes, fim oficial algumas horas depois e prazo operacional entre o fim oficial e até uma hora depois. O DTO de criação e o INSERT aceitam início anterior ao instante atual, desde que `startsAt < officialEndsAt <= operationalDeadlineAt <= officialEndsAt + 1 hora`; o evento nasce `scheduled`. A prontidão exige código válido, fuso IANA, Staff vigente e estação disponível. Confirme `GET /api/v1/admin/events/:eventId/readiness` antes de admitir pessoas.

O corpo de criação do evento é `{ "name": "Homologacao Staff", "accessCode": "STAFF-HOMOLOG-01", "timezone": "America/Sao_Paulo", "startsAt": "<ISO-inicio>", "officialEndsAt": "<ISO-fim>", "operationalDeadlineAt": "<ISO-prazo>", "externalQueueEnabled": true }`. Substitua os instantes pelos valores calculados do relógio do banco. A experiência recebe `{ "name": "Experiencia de homologacao" }` e cada estação `{ "label": "Estacao 1" }` ou `{ "label": "Estacao 2" }`; envie JSON e Bearer do Admin sem registrá-lo. A inscrição usa `{ "eventId": "<UUID>" }` e a entrada na fila da experiência usa `{ "experienceId": "<UUID>" }`.

Cada participante autentica normalmente, conclui `PUT /api/v1/profile/questionnaire` com ao menos um jogo e usa `POST /api/v1/events/lookup`, `POST /api/v1/participations` e `POST /api/v1/participations/:participationId/queue-entries` quando aplicável. Com fila externa ligada, confirme o primeiro, desative para liberar os demais e reative; uma entrada posterior deve aguardar. Use duas estações da mesma experiência e confira chamada FIFO, conclusão, ausência e remoção. Cinco participantes são suficientes se um for admitido depois da reativação. Não repita automaticamente mutação de resultado incerto.

Com o backend em execução, em outro terminal, em `app`, execute os comandos abaixo com o endereço LAN real do computador. `EXPO_NO_DOTENV=1` é reconhecido pelo pacote Expo instalado e impede carregar `.env` no processo Expo.

```powershell
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_PUBLIC_API_BASE_URL = 'http://<IP-LAN>:3000'
npm.cmd run start -- --lan
```

O Expo e o backend devem estar na mesma rede; restrinja o firewall à LAN de homologação. Encerrar processos ao final. Descarte do banco isolado é destrutivo e depende de autorização separada e nova confirmação de identidade.

## Validação pendente

Foram preparados testes unitários de guardas e verificação simulada do destino e do journal; não foram executados. A revisão de segurança deve avaliar parsing de ambiente, entrada oculta, hashes, atomicidade e caminhos incertos. Depois, Luna Medium deve executar os testes autorizados em isolamento. A primeira conexão ou escrita PostgreSQL requer campanha explícita em banco dedicado, com verificação de identidade e ausência de túneis; testes simulados não comprovam as garantias físicas.
