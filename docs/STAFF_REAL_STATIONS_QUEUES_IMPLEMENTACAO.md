# Consulta real de estações e filas Staff

## Dependência de contrato identificada

Não existe, na inspeção atual, uma listagem de experiências autorizada pela concessão Staff. `GET /events/:eventId/experiences` exige participação ativa no evento; não é adequado presumir essa participação para Staff. `GET /staff/events/:eventId/stations` retorna `experienceId`, mas não o nome da experiência e não inclui experiências sem estação. Nesta etapa não será criado endpoint nem alterado o backend. O painel poderá consultar apenas filas das experiências identificadas pelas estações retornadas, exibindo o ID real e informando essa limitação. Uma futura listagem Staff autorizada pelo evento é necessária para apresentar nomes e experiências sem estação.

## Escopo e arquivos

- `app/screens/staff/StaffEventsNavigator.js`: painel de consulta para o evento selecionado, estações, seleção de experiência por ID e fila; carregamento, vazio, erro, atualização e retorno.
- `app/services/staffDashboardService.js`: estado e coordenação das leituras, associados a usuário, evento, geração e revisão da identidade.
- `app/tests/staffDashboard.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs`: testes preparados da camada de estado e da integração com sessão, cliente HTTP, provedores e navegação.
- Este relatório e `qa-evidence/STAFF_REAL_STATIONS_QUEUES-changes.diff` documentam a entrega.

## Contratos confirmados

As consultas usam o cliente autenticado e a identidade da sessão é extraída no servidor. A concessão Staff vigente é verificada por evento em transação de leitura; acesso negado ou experiência inexistente retornam 404 indistinguível. O frontend também trata 403 como acesso indisponível e limpa os dados operacionais. O cliente HTTP existente trata 401, renovação e invalidação da sessão.

- `GET /api/v1/staff/events/:eventId/stations`: `{eventId, stations:[{id, experienceId, label, availability, pendingServiceSessionId, pendingCalledAt}]}`. A disponibilidade configurada e a existência de atendimento pendente são informações separadas. O serviço existente valida os campos utilizados; a tela não exibe o horário pendente.
- `GET /api/v1/staff/events/:eventId/experiences/:experienceId/queue`: `{eventId, experienceId, observedAt, waitingCount, acceptingNewEntries, canCallWaitingEntries, firstWaitingQueueEntryId}`. O painel exibe a contagem e a janela operacional retornadas; o contrato não inclui nomes ou lista de participantes. `canCallWaitingEntries` não garante que haja alguém aguardando nem estação livre.
- Os eventos `scheduled` e `closed` continuam selecionáveis quando retornados pelo backend. Não se infere a condição da fila pelo status do evento: a resposta da fila determina a janela operacional.

## Arquitetura e riscos

O evento vem somente da seleção autorizada em memória; parâmetros de navegação não definem acesso. A escolha de experiência é limitada aos IDs nas estações obtidas para o evento. O servidor revalida a concessão em cada requisição. Mudança de contexto, retorno, troca de conta, revalidação e concorrência invalidam resultados anteriores; falhas não preservam dados antigos. Não há polling, chamadas, conclusões, ausências nem fixtures demonstrativas no painel.

As respostas são retratos do momento da consulta e podem ficar desatualizadas; a atualização é manual. IDs de experiências são exibidos porque não há nome no contrato Staff, e experiências sem estação não aparecem. A listagem não é uma prova persistente de autorização: operações futuras exigem nova verificação no servidor.

## Testes preparados e validação

- Testes de estado cobrem estações, filas, resposta vazia ou inválida, falhas de rede, 401, 403 e 404, troca de evento ou usuário, logout, revisão de identidade e respostas fora de ordem.
- Testes de integração preparados cobrem tela e dados reais simulados, retorno, dois eventos, `scheduled` e `closed`, 403 e 401 terminal ou recuperável com o gerenciador de sessão. Os testes existentes de roteamento Admin e participante permanecem.
- Inspeção estática realizada sobre os contratos, a autorização e a implementação. Testes, lint, typecheck e build não foram executados; ficam para Luna Medium. A homologação HTTP anterior do endpoint de eventos e a seleção no Expo Go foram informadas pelo responsável, não repetidas nesta etapa.
- Para validação, inspecionar os comandos e executar com `NODE_ENV=test` em `app`: `node --test tests/staffDashboard.test.cjs tests/roleRoutingIntegration.test.cjs tests/staffEventDiscovery.test.cjs tests/staffDemoState.test.cjs tests/authNavigation.test.cjs tests/staffNavigation.test.cjs tests/staffRealNavigation.test.cjs`, seguido da suíte completa se os focados passarem.

## Homologação no Expo Go

Após a validação automatizada, entrar com Staff autorizado, selecionar o evento, conferir estações e disponibilidade frente aos dados do backend, escolher um ID de experiência e comparar contagem e janela da fila. Verificar evento sem estação, atualização manual, retorno e troca de conta. Conferir `scheduled` e `closed` sem realizar operações de escrita. Exercitar falha de rede e sessão expirada de forma controlada.
