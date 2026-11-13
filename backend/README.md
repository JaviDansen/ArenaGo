# ArenaGo — Backend

API NestJS com Express, Drizzle ORM e PostgreSQL. O prefixo global é `/api/v1`. Os módulos registrados em [AppModule](src/app.module.ts) cobrem identidade, sessões, TOTP, papéis, perfil, jogos, configuração de eventos, participações, filas, operações Staff, encerramentos e avaliações.

Os contratos abaixo existem no backend. O painel Admin Heliom do aplicativo ainda opera em memória: sua autenticação é real, mas suas alterações administrativas não chamam esses contratos. Implementação, teste simulado, ensaio PostgreSQL e homologação manual não são equivalentes.

Para decisões temporais e contratos detalhados, consulte a [arquitetura do backend](../docs/ARQUITETURA_BACKEND_ARENAGO.md) e os controllers em `src/`; o código atual prevalece sobre descrições históricas.

## Requisitos e tecnologias

- Node.js **>=24.15.0**, conforme [package.json](package.json), e npm.
- NestJS `12.1.3`, TypeScript `6.0.3`, Drizzle ORM `^0.45.4`, Drizzle Kit `^0.31.11` e `pg` `^8.23.1`.
- PostgreSQL local dedicado. Não há versão mínima de PostgreSQL declarada no manifest; os relatórios locais registram uso de PostgreSQL 18.

## Configuração local

Os comandos deste documento são para Windows PowerShell, dentro de `backend/`, a partir da raiz do clone:

```powershell
Set-Location backend
npm.cmd ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
```

Edite a configuração apenas com credenciais próprias de desenvolvimento. O exemplo não substitui a lista de configurações validada pelo código. Não use bancos de produção, homologação ou compartilhados para preparar o ambiente local ou executar fixtures.

| Variável | Contrato |
| --- | --- |
| `DATABASE_URL` | URL PostgreSQL obrigatória para a API. Deve apontar para o banco local pretendido. |
| `DATABASE_DIRECT_URL` | Opcional na API; tem precedência sobre `DATABASE_URL` no Drizzle Kit. Deve identificar o mesmo ambiente e usar conexão direta quando houver pooler. |
| `DATABASE_CA_CERT` | CA opcional para TLS remoto. O pool desativa TLS apenas em hosts locais e exige certificado válido para os demais. |
| `JWT_SECRET`, `JWT_TEMP_SECRET` | Segredos distintos, com pelo menos 32 caracteres. Há padrões locais no código; em produção os valores explícitos são obrigatórios. Configure valores próprios também no desenvolvimento. |
| `TOTP_ENCRYPTION_KEY`, `TOTP_RECOVERY_HMAC_KEY` | Para fluxos Admin/TOTP: duas chaves independentes de 32 bytes, em Base64 canônico, distintas entre si e dos segredos JWT. Ausência/formato inválido impede os fluxos TOTP. |
| `ADMIN_IDEMPOTENCY_TTL_SECONDS` | Inteiro positivo explícito, sem padrão. |
| `STAFF_IDEMPOTENCY_TTL_SECONDS` | Inteiro positivo explícito, independente do TTL Admin. |
| `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS` | Inteiro positivo explícito para ingresso/fila do participante. |
| `EVALUATION_IDEMPOTENCY_TTL_SECONDS` | Inteiro positivo explícito para envio/edição de avaliações. |
| `NODE_ENV` | `development` (padrão), `test` ou `production`. |
| `API_BIND_HOST`, `PORT` | Bind padrão `127.0.0.1`; porta padrão `3000`. Use interface LAN adequada para Expo Go em celular físico. |
| `EVENT_CLOSURE_INTERVAL_MS` | Inteiro de 1000 a 3600000 ms; padrão 30000. |
| `EVENT_CLOSURE_JOB_TEST_ENABLED` | `true`/`false`. Em `NODE_ENV=test`, somente `true` habilita o scheduler. Fora de `test`, o scheduler fica habilitado mesmo com essa variável em `false`. |
| `ARENAGO_CIVIL_TIMEZONE` | Fuso civil do questionário; padrão `America/Sao_Paulo`. |

Os quatro TTLs são exigidos pelos serviços carregados na aplicação. Eles definem vencimentos de registros de idempotência; não garantem expurgo automático nem um prazo seguro de reenvio pelo cliente.

Para envio de confirmação de e-mail, há integração Resend: `RESEND_API_KEY`, `RESEND_FROM` e `EMAIL_VERIFICATION_CONFIRMATION_URL`. A URL exige HTTPS, exceto localhost, sem credenciais/query/fragmento. `RESEND_TEST_RECIPIENT` é exigido com o remetente de teste do provedor. Sem configuração do transporte, solicitar envio retorna indisponibilidade; não há confirmação falsa. Os limites opcionais são `EMAIL_VERIFICATION_TTL_SECONDS` (86400), `EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS` (120) e `EMAIL_VERIFICATION_MAX_PER_HOUR` (5). Consulte [mailer](src/auth/email-verification-mailer.ts) e [política](src/auth/email-verification.policy.ts).

### Banco, migrations e seeds

O schema está em [src/database/schema](src/database/schema); o journal em [drizzle/meta/_journal.json](drizzle/meta/_journal.json) contém as migrations 0001 a 0008. `db:check` verifica a consistência das migrations; não confirma que o banco está atualizado. `db:generate` gera novos arquivos; `db:migrate` aplica os existentes e registra o journal em `drizzle.__drizzle_migrations`.

Antes de qualquer escrita, o responsável deve confirmar host, porta, nome do banco, usuário e destino das URLs. Somente para preparar um banco de desenvolvimento dedicado e autorizado:

```powershell
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:seed
```

Esses comandos não fazem parte da inicialização cotidiana. Não recrie migrations históricas nem execute limpeza global para obter aprovação de testes.

O seed insere idempotentemente os 20 jogos curados iniciais e a versão `1.0.0` do questionário. Os serviços de jogos e questionário também fazem inserções idempotentes em `OnModuleInit`; iniciar a API pode escrever no banco. Reinicializações respeitam decisões de curadoria e versões inativas, sem reativá-las. O scheduler pode encerrar eventos conforme as regras operacionais. Uma inicialização não deve ser tratada como inspeção somente leitura.

### Inicializar a API

Após configurar o ambiente e o schema:

```powershell
npm.cmd run start:dev
```

Para acesso por Expo Go em outro aparelho da mesma LAN, defina antes do comando:

```powershell
$env:API_BIND_HOST = '0.0.0.0'
```

Também é possível selecionar uma interface LAN específica. Libere somente o acesso necessário no firewall; configure a URL pública da API no aplicativo conforme [app/README.md](../app/README.md). `localhost` no celular não aponta para o computador. O launcher privado de homologação A4 e seu arquivo DPAPI não são distribuídos pelo Git nem são pré-requisitos do projeto.

## Autenticação, identidade e papéis

As rotas abaixo usam o prefixo `/api/v1`.

| Método e rota | Comportamento |
| --- | --- |
| `POST /auth/register` | Cadastro de Participante com `{ name, email, password }`, hash Argon2id, política de senha e criação de sessão; questionário inicialmente incompleto. |
| `POST /auth/login` | Senha real; Participante/Staff recebem sessão. Admin recebe `{ requires2FA, isTotpConfigured, tempToken, message }`, sem sessão antes do segundo fator. |
| `POST /auth/2fa/verify` | `{ tempToken, code }`, sem Bearer. Aceita TOTP de seis dígitos ou código de recuperação hexadecimal minúsculo de 32 caracteres; publica sessão após confirmação. |
| `POST /auth/refresh` | Rotação do refresh token; reutilização de token consumido revoga a sessão. |
| `GET /auth/me` | Bearer JWT e identidade viva no banco: usuário, sessão, papéis e estado do questionário. |
| `POST /auth/logout` | Revoga a sessão autenticada atual e seus refresh tokens ativos. |
| `POST /auth/verify-email/request` | Solicita confirmação de e-mail da conta autenticada pelo transporte configurado. |
| `POST /auth/verify-email/confirm` | Confirma o token de verificação de e-mail. Não é recuperação de senha. |

O access JWT dura 15 minutos; a sessão tem limite absoluto de 30 dias. Refresh tokens opacos são persistidos por hash SHA-256. Novo login substitui a sessão anterior; refresh mantém a expiração absoluta e a ordem de bloqueio `users → sessions → refresh_tokens`. Sessões Admin exigem a marca de segundo fator verificado também no refresh e nas verificações de sessão. O token temporário de 5 minutos não funciona como credencial de API.

Cadastro limita tentativas por IP/e-mail antes do Argon2id; login limita falhas por IP e par e-mail/IP. Os limitadores são locais ao processo. A extração de IP usa `req.ip`/socket; cabeçalhos de proxy arbitrários não conferem identidade. Erros seguem Problem Details (RFC 7807).

### Ativação TOTP e gestão de permissões

- `POST /auth/2fa/setup`: recebe `tempToken` e `activationToken` e prepara o credenciamento autorizado.
- `POST /auth/2fa/confirm`: recebe os mesmos tokens e `code` para confirmar a ativação. É distinto de `/auth/2fa/verify`, usado no login com credencial já configurada.
- A autorização de ativação é emitida por procedimento restrito para o primeiro Admin com proveniência CLI. O `tempToken` de login sozinho não autoriza ativação. Veja [bootstrap do primeiro Admin](../docs/T6_1_B1_IMPLEMENTACAO.md) e [ativação TOTP](../docs/T6_1_B2_IMPLEMENTACAO.md). Não há endpoint público de bootstrap nem onboarding geral de novos Admins promovidos.
- `POST /admin/roles/grant`: Admin autorizado concede papel `admin` global ou `staff` com `eventId` obrigatório a uma conta elegível.
- `POST /admin/roles/revoke`: revoga uma concessão identificada por `grantId`. Concessões/revogações passam pelas validações transacionais e auditoria do serviço; não são edição livre de papéis.
- Operações Staff exigem concessão vigente no evento, além da sessão válida. Ter um papel no cliente ou alterar parâmetros de navegação não concede autorização no servidor.

Nunca publique segredos TOTP, tokens de ativação, códigos de recuperação, senhas, URLs com credenciais ou conteúdo DPAPI. Não copie chaves de outro ambiente para contornar falhas de autenticação; preserve a relação entre as credenciais persistidas e as chaves do ambiente autorizado.

## Perfil, questionário e catálogo

| Método e rota | Contrato principal |
| --- | --- |
| `GET /profile` | Dados cadastrais do titular autenticado, papéis e estado do questionário. |
| `PATCH /profile` | Atualiza somente o nome de exibição, de 2 a 150 caracteres; rejeita alterações de e-mail, papéis e respostas do questionário. |
| `GET /profile/statistics` | `{ participationCount, totalMinutes }`, filtrado pelo usuário autenticado, sem aceitar ID do cliente. |
| `GET /profile/questionnaire` | Respostas persistidas; perfil incompleto retorna 200 com `hasCompleted: false`. |
| `PUT /profile/questionnaire` | Salva atomicamente as três etapas, perfil e jogos; snapshots históricos não são reescritos. |
| `GET /games` | Catálogo persistido; filtros `query` (1–100 caracteres) e `limit` (1–50, padrão 20); total antes do limite. |

O questionário valida datas civis `YYYY-MM-DD`, reais e não futuras, sem idade mínima presumida; revalida pelo relógio PostgreSQL no fuso civil configurado. Jogos são normalizados/deduplicados, com resolução transacional de inserções concorrentes e preservação de nomes canônicos. O catálogo ordena curados primeiro e não expõe metadados privados dos criadores.

As estatísticas contam participações que já têm `arena_entered_at`, inclusive ativas ou canceladas após entrada. O tempo soma somente participações `finished` com início/fim finitos e intervalo não negativo; arredonda para minutos após somar os segundos. Espera externa não entra no tempo. Sem registros, retorna zero. Veja [PROFILE_REAL_STATISTICS](../docs/PROFILE_REAL_STATISTICS_IMPLEMENTACAO.md), incluindo os limites de validação da agregação SQL.

## Eventos, participações e avaliações

| Grupo | Endpoints principais (prefixo `/api/v1`) |
| --- | --- |
| Descoberta e ingresso | `POST /events/lookup` com `{ accessCode }`; `POST /participations` com `{ eventId }`. Ambos exigem sessão; descoberta não é um catálogo público anônimo. |
| Participação atual e ciclo de vida | `GET /participations/current`, `GET /participations/:participationId`, `POST /participations/:participationId/cancel`, `POST /participations/:participationId/finish`. |
| Experiências e filas internas | `GET /events/:eventId/experiences`; `GET /participations/:participationId/queue`; `POST /participations/:participationId/queue-entries`; `POST /participations/:participationId/queue-entries/:queueEntryId/withdraw`. |
| Histórico e retorno | `GET /participations/history`, `GET /participations/return-state`, `GET /evaluations/pending`. |
| Avaliação | `GET /participations/:participationId/evaluation-eligibility`; `GET` e `POST /participations/:participationId/evaluation`; `PATCH /evaluations/:evaluationId`. |
| Configuração Admin | `GET` e `POST /admin/events`; `GET` e `PATCH /admin/events/:eventId`; `GET /admin/events/:eventId/readiness`. |
| Estrutura Admin | `GET` e `POST /admin/events/:eventId/experiences`; `PATCH /admin/events/:eventId/experiences/:experienceId`; `POST /admin/events/:eventId/experiences/:experienceId/stations`; `PATCH /admin/events/:eventId/experiences/:experienceId/stations/:stationId`. |
| Operação do evento por Admin | `PATCH /admin/events/:eventId/schedule`; `PATCH /admin/events/:eventId/external-queue`; `POST /admin/events/:eventId/close`. |

O servidor decide elegibilidade, prontidão, janela temporal, exclusividade de participação e posição FIFO. As mutações idempotentes exigem `Idempotency-Key`; confirme DTO, corpo e resposta no controller correspondente antes de criar um cliente. Avaliações usam nota de 1 a 5 e comentário opcional, sujeitos à elegibilidade e à política de edição. O encerramento operacional usa o scheduler e a regularização transacional dos eventos, não depende de a tela permanecer aberta.

## Operações Staff

| Grupo | Endpoints principais |
| --- | --- |
| Eventos autorizados | `GET /staff/events` com status persistido e fase operacional; `GET /staff/events/:eventId/experiences`; `GET /staff/events/:eventId/stations`. |
| Controle de Entrada | `GET` e `PATCH /staff/events/:eventId/entry-control`; `POST /staff/events/:eventId/entry-control/participants/:participationId/confirm`. |
| Chamadas da fila externa | `POST /staff/events/:eventId/entry-control/call-next`; `POST /staff/events/:eventId/entry-control/calls/:callId/:action`, com `action` igual a `confirm`, `absent` ou `remove`. |
| Estado e fila da experiência | `GET /staff/events/:eventId/experiences/:experienceId/queue`; `GET /staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state`. |
| Chamar e atender na estação | `POST /staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next`; `POST /staff/events/:eventId/service-sessions/:serviceSessionId/complete`, `/absent` ou `/remove`. |
| Controles adicionais | `PATCH /staff/events/:eventId/stations/:stationId/availability`; `PATCH /staff/events/:eventId/experiences/:experienceId/queue`; `POST /staff/events/:eventId/experiences/:experienceId/queue-entries/:queueEntryId/remove`. |

Também existem consultas de histórico de `call-next`, `complete` e `absent` em [staff-history.controller.ts](src/events/staff-history.controller.ts). Elas não substituem uma garantia geral de reconciliação para toda operação incerta.

O servidor escolhe o próximo da fila, revalida sessão/concessão e trata estação ocupada, fila vazia, ausência, reinserção e término operacional. As mutações usam chaves de idempotência e transações; testes simulados não comprovam concorrência física. Consulte [estação operacional](../docs/STAFF_STATION_OPERATIONAL_IMPLEMENTACAO.md) e [Controle de Entrada](../docs/STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md).

## Build, lint e testes

Os comandos são os declarados em [package.json](package.json). Não foram executados nesta atualização documental.

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run typecheck:test
npm.cmd test
```

`build` usa `nest build`; `lint` analisa `src/**/*.ts` e `test/**/*.ts`, sem `--fix`; `typecheck:test` usa `tsconfig.test.json`; `test` executa `tsx --test test/unit/*.test.ts`. Para servir uma compilação já preparada, existe `npm.cmd run start:prod` (`node dist/main.js`), o que não constitui aprovação de produção.

O script `npm.cmd run test:integration` usa PostgreSQL real e execução serial. Exige autorização por campanha, `NODE_ENV=test`, banco dedicado e conferência das URLs/host/porta/nome/`current_database()` e migrations, sem aplicá-las automaticamente. As suítes têm guardas e destinos distintos, inclusive bootstrap; uma URL genérica não atende necessariamente a todas. Leia fixtures e guardas antes de escolher os arquivos; preserve dados históricos e não execute limpeza global. Não use o comando como etapa automática de instalação.

A política do repositório designa Luna Medium para validações automatizadas rotineiras após seleção confirmada pelo responsável. Implementação/revisão deve preparar as verificações. Resultados precisam registrar comando, ambiente, contagens e código de saída.

## Evidências e limitações

As campanhas são específicas: [estação operacional](../docs/STAFF_STATION_OPERATIONAL_IMPLEMENTACAO.md) registra 10 testes backend focados aprovados e typechecks; [correção terminal/cutoff](../docs/STAFF_TERMINAL_CUTOFF_FIX_IMPLEMENTACAO.md) registra 61 testes backend focados e typechecks aprovados com fixtures simuladas. Há registros de fallback por falha de inicialização do `tsx`. Esses resultados não equivalem à regressão completa atual do backend.

A [homologação Staff](../docs/STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md) descreve os cenários Expo Go observados e ressalvas da auditoria. Não se declara aprovação integral do backend. A consulta de estatísticas foi homologada funcionalmente, mas seus casos SQL extremos ainda carecem de campanha física própria. Onboarding TOTP além do primeiro Admin, recuperação de senha, retenção/reconciliação de operações incertas, concorrência física, BI/LGPD e infraestrutura de produção continuam com trabalho pendente. Não há prontidão de produção declarada.
