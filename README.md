# ArenaGo

ArenaGo é um aplicativo mobile para apoiar a participação em eventos de games. O repositório contém o frontend Expo e uma API NestJS com persistência PostgreSQL. A integração entre eles é parcial: autenticação e questionário usam a API, enquanto os fluxos de eventos e Arena no aplicativo ainda dependem de dados e estado locais.

## Estado do desenvolvimento

- **Frontend Expo:** cadastro, login, sessão e questionário consultam ou gravam na API real. Entrada por código de demonstração, participação na Arena, filas e avaliações exibidas nas telas ainda usam simulação/estado local; a integração desses fluxos com os endpoints existentes não está concluída.
- **Backend NestJS:** autenticação e sessão, perfil/questionário, jogos, configuração administrativa de eventos, participações, filas, operação Staff, encerramentos e avaliações têm controllers e serviços implementados. Isso não significa que todo o percurso do participante esteja disponível por HTTP: consulta pública do evento por código e criação de participação ainda não têm controller.
- **Banco e testes:** Drizzle, migrações SQL e PostgreSQL local de testes. Após a E08-EST04, o responsável confirmou 1.229/1.229 testes PostgreSQL e a regressão unitária passou 992/992. Esses resultados são do ambiente de desenvolvimento/testes.
- **Dependências abertas:** concessão/revogação de Staff e Admin, conclusão do fluxo Admin TOTP, integração Expo dos eventos, BI, LGPD e infraestrutura de produção. Não há validação de produção declarada.

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
