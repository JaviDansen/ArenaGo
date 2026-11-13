# Painel operacional Staff e experiências reais

## Escopo e fluxo

O Staff autenticado seleciona um evento retornado por `GET /staff/events` e acessa seu painel. A opção Controle de Entrada apresenta uma mensagem de desenvolvimento. A opção Estações apresenta leituras reais; cada estação pode ser selecionada para consultar a fila da experiência correspondente. É possível retornar ao painel ou à lista de estações sem perder o evento. A navegação de retorno também percorre essas etapas antes de sair do evento.

O painel usa `GET /staff/events/:eventId/experiences`, com `{ eventId, experiences: [{ id, name }] }`, `GET /staff/events/:eventId/stations` e `GET /staff/events/:eventId/experiences/:experienceId/queue`. O cliente HTTP existente envia autenticação em cada leitura. Os nomes e IDs de experiências são validados; estações sem experiência correspondente não oferecem seleção. Experiências sem estação aparecem apenas como informação. As leituras separadas podem observar instantes diferentes; a interface não trata a associação local como autorização. Cada endpoint revalida a concessão Staff vigente para o evento.

A fila pertence à experiência, não à estação. Estações distintas da mesma experiência consultam o mesmo endpoint e mantêm disponibilidade e atendimento pendente próprios. A implementação não cria filas por estação e não executa operações de atendimento. `CallNextService` exige evento, experiência, estação vinculada, conta ativa e e-mail verificado, concessão Staff vigente e janela operacional, mas não exige atribuição permanente à estação.

O store descarta respostas obsoletas por geração da consulta e compara evento, conta, geração da sessão e revisão da identidade. Ao voltar da estação invalida a consulta pendente da fila. Respostas 401, 403 e 404 limpam dados protegidos; erros de rede e contratos inválidos exibem mensagens e permitem atualização manual. Não há polling nem dados demonstrativos no painel real.

## Levantamento: Controle de Entrada

- `POST /events/lookup` consulta o evento por código e a elegibilidade do participante autenticado; `POST /participations` cria sua participação com chave de idempotência. A elegibilidade considera conta ativa, questionário e jogos, ausência de participação corrente, prontidão e janela do evento.
- Com `externalQueueEnabled`, o ingresso cria participação `waiting` com ordem externa; sem ela, cria participação `active`. `GET /participations/current` e `GET /participations/:participationId` retornam a posição da própria participação, protegida pela identidade do participante. Não são consultas Staff da fila inteira.
- Na inspeção dos controllers existentes não foi identificado endpoint Staff para listar a fila externa ou confirmar individualmente a entrada física. Essas capacidades dependem de contrato e autorização no backend; o painel não as simula.
- `PATCH /admin/events/:eventId/external-queue` é uma operação administrativa existente, com sessão, Admin global, TOTP, chave de idempotência e regras de disponibilidade do evento. Ao desativar a fila, o serviço libera atomicamente as participações `waiting`, tornando-as `active`, quando a janela e a prontidão permitem. Essa operação não é oferecida ao Staff nesta etapa.
- A leitura Staff de estações e filas exige sessão válida, conta ativa, e-mail verificado e concessão Staff não revogada no evento. Estados como `scheduled` e `closed` não são convertidos em disponibilidade inventada pelo aplicativo; os indicadores operacionais são os retornados pelo servidor.

## Arquivos da entrega

- `app/screens/staff/StaffEventsNavigator.js`: painel, retorno, seleção de estação e exibição dos nomes e da fila real.
- `app/services/staffOperationsService.js`: validação e leitura autenticada das experiências.
- `app/services/staffDashboardService.js`: estados e coordenação das leituras por identidade e evento.
- `app/tests/staffDashboard.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs`: testes preparados de contrato, navegação real, fila compartilhada, erros e respostas obsoletas.
- Este relatório e `qa-evidence/STAFF_OPERATIONAL_PANEL-changes.diff`.

## Validação, limitações e homologação

Foram preparados cenários para carregamento, lista vazia e inválida, duas estações na mesma experiência, experiência sem estação, retorno, troca de conta e evento, revisão da identidade, 401, 403, 404, rede e respostas concorrentes. Os testes de navegação usam o gerenciador de sessão e a navegação reais com transporte e armazenamento simulados; dependem das bibliotecas isoladas em `qa/regression`. A preservação dos fluxos Admin e participante também depende da suíte de regressão existente.

Nenhum teste, lint, typecheck, build, conexão ao banco ou homologação Expo foi executado nesta implementação. Luna Medium deve inspecionar os scripts e executar com `NODE_ENV=test` os testes `staffDashboard.test.cjs`, `roleRoutingIntegration.test.cjs`, `staffEventDiscovery.test.cjs`, `staffDemoState.test.cjs`, `authNavigation.test.cjs`, `staffNavigation.test.cjs` e `staffRealNavigation.test.cjs`, seguidos da suíte do app e verificações Git apropriadas.

Para homologar no Expo Go após validação, usar conta Staff e evento autorizados: abrir Controle de Entrada e retornar, listar estações, verificar nomes reais, abrir duas estações da mesma experiência e confirmar que ambas exibem a fila dessa experiência. Conferir lista vazia, atualização, troca de evento e logout. A leitura de experiências e estações ocorre em requisições distintas; uma alteração no servidor entre elas pode exigir atualização manual. A autorização de operações futuras continua exclusivamente no backend.
