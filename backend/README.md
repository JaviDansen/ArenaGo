# ArenaGo Backend

Fundação NestJS + Express, Drizzle ORM e PostgreSQL, incluindo o módulo de Identidade, Autenticação e Sessões (`K01`).

## Requisitos

- Node.js 24.15 ou superior e npm.
- PostgreSQL local descartável para executar migrações e testes de integração.

## Configuração local

Copie `.env.example` para `.env` e ajuste `DATABASE_URL`, `JWT_SECRET` e `JWT_TEMP_SECRET` para o ambiente local. Não use credenciais de outro ambiente. Para preparar o banco de desenvolvimento, defina uma URL local fictícia e execute:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run build
npm.cmd start:dev
```

`db:generate` cria novas migrações a partir de `src/database/schema`. As migrações versionadas em `drizzle/` são aplicadas pelo migrador oficial `drizzle-kit migrate`, que registra cada arquivo em `drizzle.__drizzle_migrations`.

## Autenticação e Sessões (K01)

Endpoints expostos sob `/api/v1/auth`:

- `POST /api/v1/auth/register`: cria conta (`participante`), armazena hash `Argon2id` (`memoryCost: 65536 KiB`, `timeCost: 3`, `parallelism: 4`), bloqueia senhas comuns/comprometidas (`422 PASSWORD_COMPROMISED_OR_COMMON`), cria sessão única de 30 dias e retorna `hasCompletedQuestionnaire: false`.
- `POST /api/v1/auth/login`: autentica por e-mail/senha sem enumeração de contas (`401 INVALID_CREDENTIALS`), revoga sessão anterior na mesma transação (`superseded_by_new_login`), emite access JWT de 15 minutos e refresh token opaco persistido apenas por hash SHA-256. Contas com papel `admin` recebem `requires2FA: true` + `tempToken` restrito de 5 minutos sem criar sessão ativa antes do segundo fator.
- `POST /api/v1/auth/refresh`: rotaciona o refresh token com `FOR UPDATE` na ordem canônica (`users` $\rightarrow$ `sessions` $\rightarrow$ `refresh_tokens`), preserva o `expires_at` absoluto de 30 dias da sessão e revoga imediatamente a sessão caso um refresh token já consumido seja reutilizado (`401 REFRESH_TOKEN_REUSED`).
- `GET /api/v1/auth/me`: exige `Bearer <accessToken>`, valida assinatura/expiração/`sid` e consulta o estado vivo no PostgreSQL (`users`, `sessions`, `user_roles`, `profiles` e `user_games`).
- `POST /api/v1/auth/logout`: revoga a sessão autenticada atual (`user_logout`) e invalida seus refresh tokens ativos.

### Rate Limiting e Tratamento de IP

- **Cadastro (`POST /api/v1/auth/register`)**: `RegistrationRateLimiterService` aplica janela deslizante em memória de **10 requisições / 15 min por IP** e **5 requisições / 15 min por e-mail normalizado**, executada **antes** do cálculo do hash `Argon2id` e antes de consultar o banco. Contabiliza todas as tentativas (sucesso ou falha) com a mesma mensagem HTTP `429 TOO_MANY_REGISTRATION_ATTEMPTS` + cabeçalho `Retry-After`, evitando enumeração de contas.
- **Login (`POST /api/v1/auth/login`)**: `LoginRateLimiterService` aplica janela deslizante em memória de **10 falhas / 15 min por IP** e **5 falhas / 15 min por par `email+IP`**, retornando HTTP `429 TOO_MANY_LOGIN_ATTEMPTS` + `Retry-After` antes do `Argon2id`.
- **Extração segura de IP**: `extractClientMetadata` utiliza exclusivamente `req.ip` / `req.socket.remoteAddress` resolvidos pelo Express e ignora cabeçalhos `X-Forwarded-For` ou `X-Real-IP` arbitrários enviados diretamente pelo cliente quando `trust proxy` não está configurado.
- **Limitação documentada do ambiente local**: os contadores de rate limiting operam em memória no processo Node.js local (sem dependência de Redis na `K01`).

## PostgreSQL remoto futuro

Nenhum banco remoto está configurado. Quando a conexão remota for autorizada, guarde URLs e certificados fora do Git. A API usa `DATABASE_URL`; para Drizzle Kit, `DATABASE_DIRECT_URL` tem precedência e deve apontar para conexão direta quando o provedor usar pooler. Use TLS com verificação completa do certificado (`sslmode=verify-full`), nunca desative `rejectUnauthorized`. `DATABASE_CA_CERT` pode conter uma CA customizada aprovada pelo ambiente.

## Scripts

- `npm run build`, `npm run start:dev`, `npm run start:prod`
- `npm run lint`, `npm test`, `npm run test:integration`
- `npm run db:generate`, `npm run db:check`, `npm run db:migrate`
