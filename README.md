# ArenaGo

ArenaGo é um aplicativo mobile para apoiar a participação em eventos de games. A proposta reúne entrada em eventos, acompanhamento de filas e participação em experiências da Arena. O backend em desenvolvimento fornecerá a API e a persistência PostgreSQL necessárias para substituir os dados locais simulados.

## Estado do desenvolvimento

- **Frontend:** aplicativo React Native com Expo e fluxos de demonstração executados localmente. Cadastro, login, eventos, filas, experiências e avaliações ainda usam validações, estado ou dados simulados no cliente.
- **Backend:** fundação NestJS com Drizzle ORM, configuração de conexão PostgreSQL, schemas e migrações versionadas implementados. Os documentos de arquitetura relatam validação local da fundação; isso não representa prontidão de produção.
- **Banco:** o schema Drizzle define 23 tabelas e o diretório `backend/drizzle/` contém cinco migrações SQL versionadas.
- **APIs e integração:** não há endpoints funcionais de domínio; o app Expo ainda não consome o backend.
- **Hospedagem:** não há banco Neon nem ambiente de produção configurados.

## Tecnologias

| Área | Tecnologia | Versão declarada |
| --- | --- | --- |
| Aplicativo | React Native | 0.86.3 |
| Aplicativo | Expo | ~57.0.25 |
| Linguagem do backend | Node.js e TypeScript | Node.js >=24.15.0; TypeScript 6.0.3 |
| API | NestJS | 12.1.3 |
| Banco de dados | PostgreSQL | Banco relacional |
| ORM e migrações | Drizzle ORM / Drizzle Kit | ^0.45.4 / ^0.31.11 |

O frontend também usa React 19.2.3 e React Navigation 7. Para as dependências completas, consulte os manifests de [app](app/package.json) e [backend](backend/package.json).

## Estrutura do repositório

```text
app/       Aplicativo mobile Expo, telas, estado local e testes
backend/   Fundação da API NestJS, schemas Drizzle e migrações PostgreSQL
docs/      Planejamento do produto e arquitetura técnica
```

## Como começar

### Frontend

No PowerShell, na pasta do aplicativo:

```powershell
cd C:\DoJob\ProgramacaoMobile\app
npm.cmd ci
npm.cmd start
```

O servidor Expo oferece as opções de execução disponíveis no README do app.

### Backend

O backend requer uma instância PostgreSQL local e `DATABASE_URL` configurada conforme as instruções específicas. Na pasta do backend:

```powershell
cd C:\DoJob\ProgramacaoMobile\backend
npm.cmd ci
npm.cmd run build
npm.cmd start:dev
```

Consulte [backend/README.md](backend/README.md) antes de configurar o banco. Não configure uma conexão de produção para seguir estes passos.

## Documentação

- [Planejamento ArenaGo](docs/PLANEJAMENTO_ARENAGO.md)
- [Arquitetura do backend](docs/ARQUITETURA_BACKEND_ARENAGO.md)
- [README do frontend](app/README.md)
- [README do backend](backend/README.md)

## Desenvolvimento colaborativo

- `main`: branch estável.
- `develop`: integração do desenvolvimento.
- `feature/*`: trabalho isolado em funcionalidades, integrado posteriormente ao fluxo de desenvolvimento.
