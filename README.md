# ArenaGo

ArenaGo apoia a participação e a operação de eventos presenciais de games: ingresso na Arena, filas de experiências, atendimento em estações e avaliação da participação. Este repositório reúne um aplicativo React Native/Expo e uma API NestJS com persistência PostgreSQL e Drizzle ORM.

## Arquitetura e estado atual

O aplicativo consome a API sob `/api/v1` por um cliente HTTP compartilhado. O backend verifica sessões e permissões no servidor e coordena as operações com transações PostgreSQL, auditoria e chaves de idempotência. O estado da interface é separado por conta e sessão.

| Área | Implementado no aplicativo | Natureza e limites |
| --- | --- | --- |
| Participante | Cadastro/login, questionário, edição de nome, entrada por código ou QR, participação atual, filas, histórico, saída e avaliação, estatísticas do Perfil | Serviços reais de API. Componentes e estados demonstrativos antigos permanecem no código, separados do percurso real. O ingresso por QR foi observado fisicamente na campanha C-04/D09; isso não cobre todos os cenários da câmera. |
| Staff | Seleção de eventos autorizados, painel, Controle de Entrada, experiências, estações, filas, chamadas, conclusão, ausência e remoção | API real com concessão por evento. Há homologações funcionais delimitadas; recuperação de operações incertas e concorrência física ainda têm limites. |
| Admin | Login com senha e TOTP, confirmação de identidade, rota exclusiva `AdminArea`, logout real e 14 telas Heliom | Autenticação/autorização reais; operações, histórico, BI e indicadores do painel Heliom são demonstrativos, em memória. Não persistem configuração administrativa na API. |
| Backend | Identidade, sessões, TOTP, papéis, perfil, jogos, eventos/configuração, participações, filas, operações Staff, encerramento e avaliações | Contratos implementados não implicam integração de todas as telas nem aprovação integral para produção. |

O responsável informou **755 testes frontend aprovados, 0 falhos e 0 ignorados** na campanha após integrar `PROFILE_REAL_STATISTICS` e `ADMIN_AUTHENTICATED_NAVIGATION`. Confirmou também login Admin com TOTP e abertura do painel Heliom pelo Expo Go. Esses resultados pertencem à campanha da integração; esta atualização documental não executou testes. Para o backend, os relatórios registram campanhas específicas, sem aprovação geral da regressão atual.

Na campanha posterior [C-04/D09](docs/RETURN_AFTER_CLOSURE_C04_D09_IMPLEMENTACAO.md), a retomada com avaliação elegível após fechamento Admin passou em 99/99 testes focados e 773/773 testes frontend e foi homologada no Expo Go no fluxo principal. O relatório distingue essa evidência da homologação física ainda pendente para fechamento automático e cenários negativos. Esta atualização dos READMEs não executou novos testes.

## Tecnologias declaradas

| Área | Dependência | Versão no manifest |
| --- | --- | --- |
| Aplicativo | Expo / React Native / React | `~58.0.23` / `0.88.1` / `19.3.0` |
| Navegação | React Navigation (native / native-stack / bottom-tabs) | `^7.4.1` / `^7.19.2` / `^7.19.2` |
| Backend | Node.js / TypeScript | `>=24.15.0` / `6.0.3` |
| API | NestJS (common, core e platform-express) | `12.1.3` |
| Persistência | PostgreSQL / Drizzle ORM / Drizzle Kit | PostgreSQL sem versão mínima declarada / `^0.45.4` / `^0.31.11` |

As faixas acima são as declaradas, não versões inferidas do ambiente. Consulte os manifests de [app](app/package.json) e [backend](backend/package.json) e seus lockfiles.

## Organização

```text
app/           Aplicativo Expo, telas, serviços, estado e testes
backend/       API NestJS, schemas Drizzle, migrations e testes
docs/          Arquitetura, planejamento e relatórios por entrega
qa/regression/ Suíte independente com transporte e armazenamento simulados
qa-evidence/   Patches históricos e evidências de campanhas
```

## Desenvolvimento local

Tenha Node.js 24.15.0 ou superior, npm, Git, PostgreSQL local dedicado e Expo Go compatível com SDK 58 ou um emulador configurado. Execute os comandos PowerShell a partir da raiz do clone, em terminais separados.

Prepare primeiro o ambiente do backend seguindo seu [README](backend/README.md), incluindo conexão local, segredos próprios, TTLs e schema. Instalação e inicialização:

```powershell
Set-Location backend
npm.cmd ci
npm.cmd run start:dev
```

No outro terminal, configure `app/.env.local` conforme o [README do aplicativo](app/README.md) e inicie o Expo:

```powershell
Set-Location app
npm.cmd ci
npm.cmd start
```

No celular físico, use a mesma rede do computador e uma URL da API com o IP LAN do computador; `localhost` no celular aponta para o aparelho. O backend precisa aceitar conexões nessa interface e a porta deve estar acessível. A URL pública do Expo não carrega segredos JWT/TOTP. A configuração privada de homologação A4 e seus launchers não são dependências distribuídas pelo projeto.

Os comandos de build, lint, testes e preparação de banco estão no [README do backend](backend/README.md); a execução com Expo Go e os testes frontend estão no [README do app](app/README.md). Migrations, seeds e integrações PostgreSQL exigem inspeção do destino e autorização específica conforme as instruções do repositório.

## Documentação e evidências

- [Planejamento](docs/PLANEJAMENTO_ARENAGO.md) e [arquitetura do backend](docs/ARQUITETURA_BACKEND_ARENAGO.md): contexto e contratos; confira no código o estado de implementação.
- [Navegação Admin autenticada](docs/ADMIN_AUTHENTICATED_NAVIGATION_IMPLEMENTACAO.md) e [TOTP no Expo](docs/EXPO_ADMIN_TOTP_IMPLEMENTACAO.md).
- [Estatísticas reais do Perfil](docs/PROFILE_REAL_STATISTICS_IMPLEMENTACAO.md).
- [Seleção e isolamento de papéis](docs/ROLE_ROUTING_STAFF_INTEGRATION_IMPLEMENTACAO.md).
- [Controle de Entrada e homologação Staff](docs/STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md), [estação operacional](docs/STAFF_STATION_OPERATIONAL_IMPLEMENTACAO.md) e [atualização automática Staff](docs/STAFF_B1_IMPLEMENTACAO.md).
- [Recuperação do QA independente](docs/QA_RECOVERY_IMPLEMENTACAO.md) e [suíte independente](qa/regression/README.md).

Os relatórios e patches preservam a base e a campanha de cada task. Contagens de campanhas diferentes não se somam nem comprovam o estado atual inteiro. Testes simulados, ensaios PostgreSQL e homologações manuais são evidências distintas.

## Branches e pendências

- `main`: referência estável após revisão e validação; não significa prontidão para produção.
- `develop`: integração do desenvolvimento.
- `feature/*`: alterações delimitadas, revisadas antes de integrar a `develop`.

A integração de `develop` em `main` é uma etapa de revisão do responsável. Este documento não realiza essa integração.

Permanecem relevantes a persistência das telas Admin, o onboarding TOTP de Admins além do primeiro, a recuperação de senha, a reconciliação segura de operações Staff incertas, a validação física de concorrência e câmera, além de BI real, LGPD/retenção e infraestrutura de produção. Consulte os limites específicos de cada entrega antes de usar um fluxo operacionalmente. O ArenaGo não é declarado pronto para produção.
