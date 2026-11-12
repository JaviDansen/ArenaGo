# ArenaGo

ArenaGo é um aplicativo mobile para apoiar a participação em eventos de games. O repositório contém o frontend Expo e uma API NestJS com persistência PostgreSQL. A integração inclui autenticação, questionário e as telas operacionais Staff de Controle de Entrada e estações; outras telas demonstrativas e etapas do participante ainda exigem validação própria.

## Estado do desenvolvimento

- **Frontend Expo:** cadastro, login, sessão e questionário usam a API. Controle de Entrada Staff e operação das estações consomem contratos reais e foram homologados funcionalmente no Expo Go em cenários delimitados. Telas demonstrativas e outros percursos do participante devem ser distinguidos das jornadas operacionais reais.
- **Backend NestJS:** autenticação e sessão, Admin com TOTP, concessões Staff, configuração de eventos, participações, filas, operações Staff, encerramentos e avaliações têm contratos implementados. Staff 02 usa chamadas externas persistidas por `callId`; a migration 0008 foi aplicada em bancos locais isolados de homologação.
- **Banco e testes:** Drizzle e migrations SQL versionadas. A validação focada Staff 02 passou 341 testes backend e 145 do aplicativo; o ensaio físico específico da 0008 passou 1/1 no banco inicial dedicado. Na auditoria pré-commit posterior, a suíte completa do backend ainda apresentou falhas no fallback de execução, registradas em `docs/STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md`. Resultados históricos de outras campanhas não comprovam a entrega atual.
- **Dependências abertas:** diagnóstico da regressão completa do backend, correspondência da evidência QA, concorrência física, recuperação segura de intenções incertas, cenários após cutoff, BI, LGPD e infraestrutura de produção. Não há validação de produção declarada.

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
backend/   API NestJS, schemas Drizzle, migrações PostgreSQL e testes
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

O backend requer uma instância PostgreSQL local e as variáveis de conexão, tokens e TTLs descritas no [README do backend](backend/README.md). Na pasta do backend:

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
