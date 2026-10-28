# ArenaGo Backend

Fundação NestJS + Express, Drizzle ORM e PostgreSQL, incluindo o módulo de Identidade, Autenticação e Sessões (`K01`) e a API de Questionário de Perfil e Catálogo de Jogos (`K03`).

## Requisitos

- Node.js 24.15 ou superior e npm.
- PostgreSQL local descartável para executar migrações, seed e testes de integração.

## Configuração local

Copie `.env.example` para `.env` e ajuste `DATABASE_URL`, `JWT_SECRET` e `JWT_TEMP_SECRET` para o ambiente local. Não use credenciais de outro ambiente. Para preparar o banco de desenvolvimento, defina uma URL local fictícia e execute:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd start:dev
```

`db:generate` cria novas migrações a partir de `src/database/schema`. As migrações versionadas em `drizzle/` são aplicadas pelo migrador oficial `drizzle-kit migrate`, que registra cada arquivo em `drizzle.__drizzle_migrations`.

## Autenticação e Sessões (K01)

Endpoints expostos sob `/api/v1/auth`:

- `POST /api/v1/auth/register`: cria conta (`participante`), armazena hash `Argon2id`, bloqueia senhas comuns/comprometidas (`422 PASSWORD_COMPROMISED_OR_COMMON`), cria sessão única de 30 dias e retorna `hasCompletedQuestionnaire: false`.
- `POST /api/v1/auth/login`: autentica por e-mail/senha sem enumeração de contas (`401 INVALID_CREDENTIALS`), revoga sessão anterior na mesma transação (`superseded_by_new_login`), emite access JWT de 15 minutos e refresh token opaco persistido apenas por hash SHA-256. Contas com papel `admin` recebem `requires2FA: true` + `tempToken` restrito de 5 minutos sem criar sessão ativa antes do segundo fator.
- `POST /api/v1/auth/refresh`: rotaciona o refresh token com `FOR UPDATE` na ordem canônica (`users` $\rightarrow$ `sessions` $\rightarrow$ `refresh_tokens`), preserva o `expires_at` absoluto de 30 dias da sessão e revoga imediatamente a sessão caso um refresh token já consumido seja reutilizado (`401 REFRESH_TOKEN_REUSED`).
- `GET /api/v1/auth/me`: exige `Bearer <accessToken>`, valida assinatura/expiração/`sid` e consulta o estado vivo no PostgreSQL (`users`, `sessions`, `user_roles`, `profiles` e `user_games`).
- `POST /api/v1/auth/logout`: revoga a sessão autenticada atual (`user_logout`) e invalida seus refresh tokens ativos.

### Rate Limiting e Tratamento de IP

- **Cadastro (`POST /api/v1/auth/register`)**: `RegistrationRateLimiterService` aplica janela deslizante em memória de **10 requisições / 15 min por IP** e **5 requisições / 15 min por e-mail normalizado**, executada **antes** do cálculo do hash `Argon2id` e antes de consultar o banco. Contabiliza todas as tentativas (sucesso ou falha) com a mesma mensagem HTTP `429 TOO_MANY_REGISTRATION_ATTEMPTS` + cabeçalho `Retry-After`, evitando enumeração de contas.
- **Login (`POST /api/v1/auth/login`)**: `LoginRateLimiterService` aplica janela deslizante em memória de **10 falhas / 15 min por IP** e **5 falhas / 15 min por par `email+IP`**, retornando HTTP `429 TOO_MANY_LOGIN_ATTEMPTS` + `Retry-After` antes do `Argon2id`.
- **Extração segura de IP**: `extractClientMetadata` utiliza exclusivamente `req.ip` / `req.socket.remoteAddress` resolvidos pelo Express e ignora cabeçalhos `X-Forwarded-For` ou `X-Real-IP` arbitrários enviados diretamente pelo cliente quando `trust proxy` não está configurado.
- **Limitação documentada do ambiente local**: os contadores de rate limiting operam em memória no processo Node.js local (sem dependência de Redis na `K01`).

## Questionário de Perfil e Catálogo de Jogos (K03)

Endpoints expostos sob `/api/v1`:

- `GET /api/v1/profile/questionnaire`: exige sessão autenticada (`@RequireSessionAuth()`, `SessionAuthGuard`, `@CurrentUserId()`). Consulta exclusivamente o perfil do próprio titular autenticado. Quando não há perfil completo (ou não há jogos vinculados em `user_games`), retorna HTTP `200` com `{ hasCompleted: false, aboutYou: null, yourGames: [], gamesMarket: null, completedAt: null }` (sem retornar `404`). Quando completo, retorna as respostas persistidas, `birthDate` como texto civil `YYYY-MM-DD` (`birth_date::text`, sem conversão por fuso) e `yourGames` com os nomes canônicos do catálogo.
- `PUT /api/v1/profile/questionnaire`: exige sessão autenticada e salva ou atualiza atomicamente as três etapas (`profiles`, `games` quando houver novos nomes, e `user_games`) em uma transação PostgreSQL real sob a ordem canônica de bloqueio `users FOR UPDATE` $\rightarrow$ `profiles` $\rightarrow$ `user_games` (compatível com a criação de snapshots em `participation_profile_snapshots`, que nunca são modificados retroativamente).
  - **Calendário civil de referência (`birthDate`)**: valida datas reais do calendário gregoriano (`YYYY-MM-DD`) e exige `birthDate <= hoje` (aceitando a data de hoje e sem impor idade mínima presumida). O fuso civil de referência do servidor está explicitado como `America/Sao_Paulo` (`DEFAULT_REFERENCE_CIVIL_TIMEZONE`), revalidado diretamente contra o relógio do PostgreSQL (`(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date`) dentro da transação após `users FOR UPDATE`, podendo ser configurado via `ARENAGO_CIVIL_TIMEZONE`.
  - **Deduplicação e concorrência de jogos**: normaliza e deduplica `selectedGames` por `lower(btrim(name))`, preservando a grafia canônica já existente no catálogo. Em inserções de jogos personalizados, utiliza `INSERT ... ON CONFLICT DO NOTHING RETURNING id, name` seguido de `SELECT` em comando SQL separado sob `READ COMMITTED`.
- `GET /api/v1/games`: consulta o catálogo persistido de jogos com filtros opcionais `query` (1 a 100 caracteres após `trim`, pesquisa *case-insensitive*) e `limit` (1 a 50, padrão 20).
  - **Ordenação estável**: `ORDER BY is_curated DESC, lower(btrim(name)) ASC, name ASC, id ASC`.
  - **Semântica de `total`**: representa a quantidade total de registros no catálogo `games` que satisfazem o filtro `query` (contagem total antes da aplicação de `LIMIT`), enquanto `games` contém até `limit` itens `{ id, name, isCurated }`, sem expor metadados privados de usuários (`created_by_user_id` ou `created_at`).
- **Seed idempotente (`npm run db:seed`)**: insere de forma idempotente a versão publicada `1.0.0` em `questionnaire_versions` e os 20 jogos curados iniciais definidos em `app/data/mockData.js`. Também é executado automaticamente de forma idempotente na inicialização dos módulos (`OnModuleInit`).
- **Política de publicação e curadoria (K03-F)**: reinicializações do servidor respeitam versões inativas (`activated_at = NULL`), retornando `422 QUESTIONNAIRE_VERSION_UNAVAILABLE` sem reativá-las inadvertidamente. O seed de catálogo respeita decisões administrativas sobre `is_curated` sem desmarcar jogos customizados promovidos pela administração nem forçar `true` em jogos desmarcados.

## API Cadastral de Perfil (K04)

Endpoints expostos sob `/api/v1/profile`:

- `GET /api/v1/profile`: exige sessão autenticada (`@RequireSessionAuth()`, `SessionAuthGuard`, `@CurrentUserId()`). Retorna os dados cadastrais essenciais do titular autenticado: `{ id, name, email, emailVerified, roles, hasCompletedQuestionnaire, createdAt, updatedAt }`.
- `PATCH /api/v1/profile`: exige sessão autenticada. Atualiza o nome de exibição (`name` de 2 a 150 caracteres após normalização). Bloqueia a linha do usuário via `users FOR UPDATE` em transação e retorna `{ message: "Perfil atualizado com sucesso.", user }`. Rejeita modificação de e-mail, papéis administrativos ou respostas do questionário (`400 BAD_REQUEST`, RFC 7807).

## PostgreSQL remoto futuro

Nenhum banco remoto está configurado. Quando a conexão remota for autorizada, guarde URLs e certificados fora do Git. A API usa `DATABASE_URL`; para Drizzle Kit, `DATABASE_DIRECT_URL` tem precedência e deve apontar para conexão direta quando o provedor usar pooler. Use TLS com verificação completa do certificado (`sslmode=verify-full`), nunca desative `rejectUnauthorized`. `DATABASE_CA_CERT` pode conter uma CA customizada aprovada pelo ambiente.

## Scripts

- `npm run build`, `npm run start:dev`, `npm run start:prod`
- `npm run lint`, `npm test`, `npm run test:integration`
- `npm run db:generate`, `npm run db:check`, `npm run db:migrate`, `npm run db:seed`
