# ArenaGo Backend

Fundação NestJS + Express, Drizzle ORM e PostgreSQL. Esta etapa contém apenas inicialização, configuração de banco, schemas relacionais e migrações; não implementa operações de domínio nem endpoints funcionais.

## Requisitos

- Node.js 24.15 ou superior e npm.
- PostgreSQL local descartável para executar migrações e testes de integração.

## Configuração local

Copie `.env.example` para `.env` e ajuste `DATABASE_URL` para o PostgreSQL local. Não use credenciais de outro ambiente. Para preparar o banco de desenvolvimento, defina uma URL local fictícia e execute:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run build
npm.cmd start:dev
```

`db:generate` cria novas migrações a partir de `src/database/schema`. As migrações versionadas em `drizzle/` são aplicadas pelo migrador oficial `drizzle-kit migrate`, que registra cada arquivo em `drizzle.__drizzle_migrations`.

## PostgreSQL remoto futuro

Nenhum banco remoto está configurado. Quando a conexão remota for autorizada, guarde URLs e certificados fora do Git. A API usa `DATABASE_URL`; para Drizzle Kit, `DATABASE_DIRECT_URL` tem precedência e deve apontar para conexão direta quando o provedor usar pooler. Use TLS com verificação completa do certificado (`sslmode=verify-full`), nunca desative `rejectUnauthorized`. `DATABASE_CA_CERT` pode conter uma CA customizada aprovada pelo ambiente.

## Scripts

- `npm run build`, `npm run start:dev`, `npm run start:prod`
- `npm run lint`, `npm test`, `npm run test:integration`
- `npm run db:generate`, `npm run db:check`, `npm run db:migrate`
