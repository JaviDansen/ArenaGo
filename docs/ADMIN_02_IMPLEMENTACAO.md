# ADMIN-02 — Painel Individual do Evento e Prontidão

## Preparação

- Branch `feature/admin-core-management`, base `e9d183b812f6b9a28f86da101e85508b99aeabb9`, working tree inicialmente limpo. ADMIN-01 incorporada nesse commit.
- Consultados `AGENTS.md`, o relatório ADMIN-01, a auditoria ADMIN-00, o Panorama e a Arquitetura Backend. Referência visual encontrada como `Admin - Painel Individual do Evento.png` na pasta de referências Admin do responsável, sem o sufixo `(1)` citado no pedido.
- Escopo: substituir o detalhe contextual por um painel de leitura do evento selecionado, com prontidão, cinco áreas informativas e atualização contextual. Usar a pilha, logo, tema e abas da ADMIN-01.
- Arquivos identificados: `AdminRealEventScreen`, `AdminDemoNavigator`, `AdminLiveScreen`, `AdminLiveUI`, `AdminBottomBar`, `AdminEventSummary`, `useAdminEvents`, `adminEventsService` e testes de Admin e roteamento. No backend foram inspecionados controller, DTO, projeção e query service de configuração Admin.

## Contratos e plano

- `GET /api/v1/admin/events/:eventId` retorna `{event}` com UUID, nome, horários, fuso e fase efetiva. O DTO e a projeção não oferecem local. O painel omitirá essa linha.
- `GET /api/v1/admin/events/:eventId/readiness` retorna diretamente `eventId`, `statusStored`, `effectivePhase`, `ready`, `missing`, `checks`, `acceptingNewParticipations` e `observedAt`. As duas rotas usam o guard de configuração Admin e a verificação de sessão com segundo fator. A projeção exige vínculo Staff ativo, usuário ativo e e-mail verificado, sem condição de presença ou vínculo com estação.
- Plano: ler detalhe e prontidão em paralelo pelo cliente autenticado, validar ambos os UUIDs e publicar o resultado por evento, sessão e consulta. Consultar ao recuperar foco, atualizar sob demanda e oferecer retry. Apresentar falhas parciais e suprimir dados quando o acesso for negado. Mapear os cinco códigos da projeção para orientação em português e reutilizar o contexto do evento na rota informativa.
- Limites: as duas respostas são snapshots independentes. A UI deve usar a observação dedicada para prontidão e não inferir aceite de participações a partir de `ready`. Edição, QR, experiências, concessões, operação e BI ficam para suas próprias tasks. Sem mudança de backend. Preparar testes com mocks e executar apenas inspeções estáticas nesta etapa, conforme pedido.

## Implementação

- A seleção da lista continua enviando o UUID à rota `AdminRealEvent`. O painel usa o cabeçalho com logo oficial, Voltar aos eventos com `popTo('AdminEvents')`, a barra Home | Histórico | BI e o selo de fase da ADMIN-01. O cartão mostra nome e horários em pt-BR no fuso IANA do evento, com datas de início e término separadas para explicitar a mudança de dia. O contrato atual não retorna local.
- O cliente compartilhado usa `auth: true` nas duas leituras. O serviço valida o UUID antes da requisição e rejeita respostas divergentes ou malformadas. A prontidão e a fase efetiva vêm do endpoint de prontidão quando ele responde validamente. Se só o detalhe estiver disponível, o painel exibe sua fase efetiva e sinaliza prontidão indisponível. Se só a prontidão estiver disponível, mostra fase e prontidão sem nome ou cards. 401, 403 ou 404 em qualquer leitura ocultam ambas as respostas e deixam retorno e retry disponíveis. Não há inferência de pendência a partir de erro de transporte.
- Um escopo vincula cada leitura a UUID, cliente, conta, sessão e revisão de identidade. Saída de foco ou desmontagem invalida a publicação anterior. A entrada em foco inicia uma nova leitura, com deduplicação de solicitações simultâneas dentro do escopo. A atualização manual usa gesto de puxar no nativo e ação Atualizar na web. Resultados de gerações anteriores não sobrescrevem a tela. A listagem anterior permanece na pilha em navegação normal. Posição de rolagem requer verificação em aparelho.
- O estado de prontidão positiva é informativo. Em pendência, o indicador abre uma seção acessível. Os códigos `EVENT_NAME_OR_ACCESS_CODE_INVALID` e `EVENT_SCHEDULE_INVALID` apontam para Informações e horários. `EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED` aponta para Operação do evento. `EXPERIENCE_WITH_AVAILABLE_STATION` aponta para Experiências e estações. `VERIFIED_ACTIVE_STAFF` aponta para Equipe Staff e descreve vínculo no evento, atividade e verificação de e-mail. Códigos desconhecidos recebem uma mensagem genérica. O painel não equipara prontidão à abertura ou ao aceite de participações.
- Os cinco cards, em ordem, são Informações e horários, Experiências e estações, Equipe Staff, Operação do evento e BI do evento. A rota `AdminEventManagementInfo` usa uma lista fechada de áreas, recebe o UUID e confirma o nome por leitura autenticada do detalhe. O retorno ao painel reconsulta os dados. As áreas são informativas e os contratos de escrita permanecem reservados à ADMIN-03, ADMIN-04, ADMIN-06, ADMIN-07 e ADMIN-09. Criação do evento fica para ADMIN-05.

## Arquivos

- Criados em `app/screens/admin`: `AdminEventManagementInfoScreen.js`, `adminEventManagement.js`, `useAdminEventPanel.js` e `components/AdminSelectedEvent.js`.
- Modificados em `app/screens/admin`: `AdminDemoNavigator.js`, `AdminRealEventScreen.js`, `components/AdminLiveScreen.js` e `components/AdminEventSummary.js`. O shell recebe opções de retorno e atualização, mantendo o comportamento padrão da ADMIN-01. O selo de fase foi extraído para reuso pela lista e pelo painel.
- Modificado `app/services/adminEventsService.js`. Nenhuma alteração de backend, autenticação, dependências, módulos Staff ou Participante.
- Cobertura preparada em `app/tests/adminRealEvents.test.cjs`, `adminNavigation.test.cjs` e `roleRoutingIntegration.test.cjs`. O ajuste em `app/tests/helpers/questionnaireHarness.cjs` adiciona `RefreshControl` à lista de componentes nativos simulados.

## Verificação e pendências

Revisadas as alterações e os contratos do backend. O parser Babel analisou 13 arquivos JS/CJS e verificou 46 imports. A conferência estática validou a assinatura PNG do logo, as referências de navegação, os quatro registros da pilha Admin e as três abas. `git diff --check` passou. A primeira checagem de nomes das abas no script de inspeção precisou ser repetida com escape Unicode para evitar a perda do acento na entrada do PowerShell.

Os testes preparados cobrem UUID e erros de contrato, fases independentes da prontidão, Staff sem requisito de presença, mapeamento e fallback de pendências, falhas parciais, 401/403/404, retry, foco, troca de UUID e sessão, logout durante consulta, descarte de resposta atrasada, cinco destinos em ordem e retorno da rota informativa à listagem e às abas. Testes existentes da ADMIN-01 foram preservados, com a expectativa do antigo placeholder substituída por verificações do painel integrado.

Campanha pendente para GPT-6 Luna Medium, após seleção manual e com mocks locais:

```powershell
# Em app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

As consultas são observações independentes. Durante uma atualização, a interface aguarda a conclusão das leituras antes de publicar o novo conjunto de dados. A integração de roteamento usa substitutos de views nativas, portanto a preservação visual da rolagem, o gesto de atualizar, a ergonomia e a fidelidade ao mockup precisam de conferência em aparelho. Nesta etapa não houve execução de testes automatizados, acesso a API ou banco real, build, staging ou geração de patch. O HEAD segue na base da tarefa e o working tree contém apenas os arquivos listados acima e este relatório. Aprovação da ADMIN-02 pendente.

## Primeira campanha de validação — Luna Medium

A campanha foi executada pelo Codex após seleção manual de GPT-6 Luna Medium, com `NODE_ENV=test`, em `app`. O comando efetivamente executado foi:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

- Exit code: `0`.
- Resultado: 72 testes aprovados, 0 reprovados, 0 ignorados (72 totais); nenhum cancelado ou marcado como todo.
- A suíte cobriu consultas autenticadas de detalhe e prontidão com UUID, validação de formatos e UUID divergente, datas em fuso IANA, fases e prontidão independentes, os cinco requisitos conhecidos e código desconhecido, ausência de requisito de Staff online, falhas parciais, 401/403/404, retry, foco, troca de UUID/sessão, logout com requisições pendentes e descarte de respostas antigas.
- Também verificou as cinco áreas na ordem definida, navegação de cada card com UUID, rota informativa com confirmação autenticada do evento, retorno ao painel/lista, abas e roteamento de papéis. A regressão ADMIN-01 de lista, busca, filtros, cursor/paginação, seleção por UUID, autenticação/TOTP, logout e isolamento de sessão passou nesta campanha.
- Não houve falha de teste nem regressão observada. Durante a execução apareceram avisos já emitidos pelo conjunto de testes: depreciação de `react-test-renderer` e telas substitutas com nome de componente `default`; não alteraram o resultado.

Verificação estática adicional: `git diff --check` executado na raiz do repositório, exit code `0`. O Git emitiu avisos informativos de conversão LF/CRLF para arquivos modificados; nenhum erro de whitespace foi reportado. O índice permaneceu sem alterações staged.

Limitações: os testes usam mocks locais e views nativas substitutas; não acessam banco/API real. Não foram executados build ou testes backend nesta campanha. A preservação de rolagem, gesto de atualização e fidelidade/ergonomia visual ainda dependem de revisão em aparelho. A ADMIN-02 permanece aguardando revisão visual e aprovação formal do responsável.

Este registro complementa a seção anterior, que descrevia o estado antes da campanha e a aguardava; o histórico da implementação foi preservado.
## Ajuste textual após revisão visual

O responsável informou a aprovação visual da ADMIN-02. A descrição do card Informações e horários, em `app/screens/admin/adminEventManagement.js`, foi alterada de “Dados gerais, datas, código e QR Code” para “Dados do evento, horários e QR Code”. A busca estática não encontrou testes dependentes do texto anterior. `git diff --check` foi executado após o ajuste. A campanha de 72 testes registrada acima precedeu esta alteração textual; testes não foram executados novamente nesta etapa. A aprovação formal permanece pendente.
## Fechamento e aprovação da ADMIN-02

O painel individual e a leitura de prontidão foram implementados para o evento selecionado. As leituras autenticadas utilizam `GET /api/v1/admin/events/:eventId` e `GET /api/v1/admin/events/:eventId/readiness`, validam os UUIDs e as respostas, e apresentam fase, horários no fuso do evento e pendências sem confundir prontidão com aceite de participações. As observações dos dois endpoints são independentes.

Os cinco cards — Informações e horários, Experiências e estações, Equipe Staff, Operação do evento e BI do evento — abrem destinos informativos com o UUID selecionado. A tela atualiza ao recuperar foco e por ação manual, oferece retry e trata falhas parciais. A identidade, sessão, UUID e geração da consulta limitam a publicação dos resultados; respostas obsoletas são descartadas e falhas 401/403/404 ocultam dados protegidos.

A campanha frontend anterior à alteração textual executou 72 testes com 72 aprovações, nenhuma falha ou teste ignorado, exit code 0. O responsável informou aprovação visual. Depois da campanha, a descrição de Informações e horários passou a ser “Dados do evento, horários e QR Code”; não se repetiu a campanha por se tratar apenas de texto e a busca não encontrou testes dependentes da descrição anterior. As verificações estáticas anteriores incluem parser, imports e `git diff --check`. Não foram executados testes backend nem integração PostgreSQL nesta task.

Inventário em relação à base `e9d183b812f6b9a28f86da101e85508b99aeabb9`:

- Modificados: `app/screens/admin/AdminDemoNavigator.js`, `app/screens/admin/AdminRealEventScreen.js`, `app/screens/admin/components/AdminEventSummary.js`, `app/screens/admin/components/AdminLiveScreen.js`, `app/services/adminEventsService.js`, `app/tests/adminNavigation.test.cjs`, `app/tests/adminRealEvents.test.cjs`, `app/tests/helpers/questionnaireHarness.cjs` e `app/tests/roleRoutingIntegration.test.cjs`.
- Criados: `app/screens/admin/AdminEventManagementInfoScreen.js`, `app/screens/admin/adminEventManagement.js`, `app/screens/admin/components/AdminSelectedEvent.js`, `app/screens/admin/useAdminEventPanel.js` e `docs/ADMIN_02_IMPLEMENTACAO.md`.
- Evidência de alterações: `qa-evidence/ADMIN_02-changes.diff`, excluída do próprio patch.

As áreas de gerenciamento são informativas. Edição, QR, experiências, concessões, operação e BI permanecem para tasks posteriores; criação do evento pertence à ADMIN-05. O contrato de detalhe não fornece local e as consultas são snapshots independentes. O responsável aprovou a revisão visual; a revisão final e o commit continuam sob sua responsabilidade.

No fechamento, a branch é `feature/admin-core-management`, com HEAD na base informada; os arquivos da task permanecem no working tree e o índice real está vazio. O patch é preparado e conferido com índice isolado, sem staging no índice real.