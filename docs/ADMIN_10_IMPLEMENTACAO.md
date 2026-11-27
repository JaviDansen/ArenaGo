# ADMIN-10 — Histórico Administrativo

Estado final: implementação concluída e homologação funcional e visual aprovada pelo responsável em 27/11/2026, após os ajustes de layout. As evidências consolidadas e a decisão transversal para a ADMIN-10.1 constam no fechamento abaixo. As seções anteriores preservam o histórico das revisões e suas pendências à época.

## Diagnóstico inicial

Branch `feature/admin-analytics`, working tree inicialmente limpo e ADMIN-09 commitada em `82d30e27822967104e1178efaa3ea19f8b968ce8`. O Histórico da navegação real era um destino informativo. A ADMIN-09 já oferecia leitura administrativa em snapshot e agregações reaproveitáveis.

Escopo: lista real exclusivamente de eventos encerrados e resumo individual de leitura. Referências locais: Panorama §3.8, arquitetura do backend e relatório/código ADMIN-09. Os dois prints chegaram após a implementação inicial. O Rascunho de Escopo v0.5 segue indisponível no checkout.

## Contratos e cálculo

As duas rotas usam autenticação de sessão, revalidação SQL de Admin global, conta ativa, sessão vinculada e vigente, TOTP, transação PostgreSQL `repeatable read read only` e `Cache-Control: no-store`. A rota literal de histórico é registrada antes de `:eventId`.

- `GET /api/v1/admin/events/history` aceita `search` opcional (até 180 unidades UTF-16, com validação e normalização da listagem Admin), `period=all|7|30|90`, `limit` de 1 a 50 (padrão 20) e `cursor` opcional. Retorna `{items,nextCursor}`. Cada card inclui `id,name,timezone,effectivePhase,startsAt,officialEndsAt,closedAt,participations,evaluationCount,evaluationMean`. A pesquisa considera nome sem distinção de maiúsculas, com espaços normalizados, e trecho de código ASCII em maiúsculas, usando a normalização canônica para códigos completos. As comparações são literais e parametrizadas, sem devolver o código. Valores inválidos recebem 400.
- `GET /api/v1/admin/events/:eventId/summary` valida UUID e retorna 404 `RESOURCE_NOT_FOUND` para evento inexistente ou inelegível. O objeto `event` contém a identificação e os horários do card, sem contagens, mais `scheduledDurationSeconds` e `closedEarly` (prazo efetivo anterior ao término oficial). A duração programada é o intervalo do início ao término oficial. A resposta inclui `observedAt`, `overview {participations,completed}`, `ranking`, `ratings` e `durationA {meanSeconds,population}`, com as mesmas definições do BI individual.

A seleção compartilha o predicado de fase encerrada com a projeção administrativa e exige que o prazo efetivo seja alcançado. O prazo é o menor entre `operational_deadline_at` e `admin_deadline_at`, usando o primeiro quando inexiste antecipação. Fechamento imediato usa o instante gravado como prazo Admin. Um prazo controlado vencido entra mesmo com status persistido desatualizado. Eventos em fechamento com prazo futuro ficam de fora, assim como registros inconsistentes com status encerrado e prazo futuro. O scheduler não precisa ter regularizado o estado para a consulta funcionar.

Cada requisição usa `transaction_timestamp()`. Os períodos móveis de 7, 30 e 90 dias equivalem a 168, 720 e 2.160 horas, com limite inferior inclusivo e limite superior inclusivo no instante observado. A ordenação é por prazo efetivo decrescente e UUID decrescente. O cursor versionado preserva ambos, com seis casas decimais no horário. Cada página usa seu próprio snapshot e instante de referência. Um evento pode mudar de posição ou sair de um recorte entre requisições se os dados ou o relógio avançarem.

Nome, período e cursor restringem a consulta antes do limite. Os agregados da listagem são feitos em dois agrupamentos independentes para os eventos da página, incluindo a linha extra usada para detectar a próxima página. Cada participação conta como um registro, inclusive reentradas, e as avaliações usam a nota atual de cada participação avaliada. Ausência de avaliações retorna contagem zero e média nula. O resumo executa diretamente a consulta de BI da ADMIN-09 para o UUID elegível dentro do mesmo snapshot. Reaproveita ranking, notas e Indicador A sem reimplementar fórmulas.

## Aplicativo

A aba Histórico agora apresenta consulta real, pesquisa com debounce de 300 ms, quatro períodos, cards no fuso do evento e paginação. O resumo é aberto na pilha Admin por UUID, com retorno à mesma aba e Histórico selecionado na barra. Reutiliza cabeçalho, tema, formatação de datas, botões, avisos e componentes de ranking e avaliações extraídos do BI individual. O resumo apresenta duração programada, cinco indicadores, cinco faixas de estrelas e estados de ausência de dados. A tela BI individual mantém suas métricas, navegação e ciclo de atualização.

Lista e resumo consultam inicialmente, ao recuperar foco e por ação manual. A lista recompõe somente as páginas que já estavam carregadas na atualização, mantendo-as visíveis até o novo resultado e preservando a posição quando a instância da rota continua montada. Bloqueia sobreposição no mesmo contexto, descarta cursores repetidos e deduplica cards por UUID. Mudanças de conta, sessão, cliente, evento, busca, filtro ou foco invalidam respostas obsoletas. Falha de rede preserva dados do mesmo contexto com aviso. Negação de acesso ou recurso indisponível limpa os dados anteriores. O Histórico não usa polling.

## Privacidade e limites

Comentários ficam indisponíveis. Nenhum texto livre de avaliação ou identificador de participante é consultado ou devolvido. Faixa etária permanece sem snapshot histórico adequado. A divulgação de gênero aguarda a política de privacidade. Os endpoints não consultam dados demográficos e não expõem parâmetros de liberação. Localização, exportação, BI Geral, comparação e ações operacionais ficam fora desta entrega. A homologação do layout em aparelho permanece pendente.

## Arquivos

- Backend: `admin-event-history.ts`, `admin-configuration.controller.ts`, `admin-configuration-query.service.ts`, `admin-configuration.projection.ts` e `event-closure.projection.ts` em `backend/src/events/`.
- Aplicativo: `AdminDemoNavigator.js`, `AdminRealHistoryScreen.js`, `AdminHistorySummaryScreen.js`, `useAdminHistory.js`, `AdminRealEventBiScreen.js`, `components/AdminLiveScreen.js` e `components/AdminBiResults.js` em `app/screens/admin/`, mais `adminHistoryService.js` e `adminBiService.js` em `app/services/`.
- Testes: `adminHistory.test.cjs`, `adminNavigation.test.cjs` e `roleRoutingIntegration.test.cjs` em `app/tests/`. No backend, `admin-configuration.test.ts`, `admin-configuration-http.test.ts` e `admin-event-history.integration.test.ts`.
- Evidência única: `qa-evidence/ADMIN_10-changes.diff`, relativa ao HEAD inicial, excluída do próprio conteúdo.

## Validação preparada

Frontend cobre navegação, paginação concorrente, deduplicação, debounce, datas, troca de contexto, retomada por foco, atualização manual, falhas, vazios e privacidade. Backend simulado cobre registro das rotas, sessão/TOTP/papéis, parâmetros, snapshot somente leitura, resposta reduzida, 404 e reuso do BI. A integração PostgreSQL prepara tabelas temporárias com tipos reais e rollback, usando o guard legado da campanha ADMIN-09. Cobre fechamento natural com status desatualizado, imediato e controlado, prazo futuro, fronteiras móveis, busca literal e por código, desempate e paginação, reentradas, avaliações editadas e paridade dos agregados. O ensaio SQL não cobre HTTP com banco real, constraints das fixtures ou desempenho.

Comandos preparados para a próxima campanha com Luna Medium, após conferir branch, ambiente isolado e scripts:

```powershell
$env:NODE_ENV = 'test'
# No diretório app
node --test tests/adminHistory.test.cjs tests/adminBi.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
npm.cmd test
# No diretório backend
node --import tsx --test test/unit/admin-bi.test.ts test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts
npm.cmd run typecheck:test
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json
# Integração somente após autorização explícita por campanha e qualificação do destino
node --import tsx --test --test-concurrency=1 test/integration/admin-event-history.integration.test.ts
```

Para a integração, qualificar previamente a role e o banco dedicado `arenago_roles_test` em `127.0.0.1:55432`, com as três URLs idênticas exigidas pela guarda, `NODE_ENV=test`, checagem de identidade, privilégios e migrations existentes. Confirmar acesso somente leitura às tabelas públicas usadas e permissão para fixtures temporárias. Interromper se qualquer confirmação falhar. O destino `arenago_events_test` da INFRA-01 está fora desta campanha.

## Inspeções desta implementação

TypeScript `createSourceFile` e Babel parser aceitaram os 20 arquivos de código e testes alterados. A decodificação UTF-8 estrita passou. `git diff --check` não apontou erros. A integridade da evidência é conferida por aplicação e reversão isoladas sobre o HEAD inicial e comparação do conteúdo, com SHA-256 informado na entrega.

Testes, typechecks, lint, builds e PostgreSQL aguardam campanha posterior. A aprovação final depende de validação independente e homologação visual pelo responsável.

## Complementação das referências visuais

Comparação estática com os prints “Admin — Histórico” e “Admin — Histórico — Evento específico”.

- **Histórico de eventos.** A marca ficava à direita e os cards apresentavam horários e indicadores como texto corrido. O cabeçalho agora alinha a marca à esquerda. O aviso ganhou ícone e contorno, o campo usa o texto do print e os filtros ganharam estados ativo e inativo com quebra de linha. Os cards agrupam nome, selo de encerramento e datas junto ao ícone de calendário, destacam Participações, Avaliações e Nota média em blocos e apresentam “Ver resumo” com seta. O ícone é comum aos eventos porque o contrato não fornece categoria visual.
- **Resumo individual.** O cabeçalho separa marca, selo Admin, retorno e identificação do evento. Os horários e a duração programada ocupam um painel próprio. Os cinco indicadores aparecem em uma grade que se reorganiza conforme a largura. A duração média é identificada como Indicador A e mantém a população elegível. O ranking usa linhas com nome, barra e quantidade. A média e o total de avaliações ficam ao lado da distribuição quando há espaço, com cinco linhas que mostram contagem e percentual.
- **Privacidade e navegação.** Comentários e perfil do público ganharam seções próprias. Comentários continuam indisponíveis, sem “Ver tudo”. Faixa etária e gênero mostram o motivo da indisponibilidade. A localização foi omitida por falta de dado persistido. A barra inferior mantém Histórico selecionado nas duas telas. A saída continua na Home Admin para preservar o fluxo existente. Os valores vêm dos contratos atuais.

A revisão alterou a apresentação das duas telas, os componentes visuais compartilhados `AdminLiveScreen`, `AdminLiveUI` e `AdminBiResults`, e acrescentou `AdminHistoryUI`. A apresentação compacta de ranking e avaliações é optativa e usada no Histórico. Uma asserção visual existente passou a verificar “Participações” com a nova quebra entre valor e rótulo. Contratos, backend, busca, filtros, paginação e cálculos foram preservados.

Inspeções desta rodada: sintaxe por Babel e TypeScript, decodificação UTF-8 estrita, `git diff --check` e comparação do conteúdo do patch após aplicação e reversão isoladas. A comparação com os prints foi feita por leitura da interface e dos estilos. A aparência em aparelho e em diferentes tamanhos de fonte segue para homologação. Testes, typechecks e operações de banco não foram executados.

## Correção após validação independente

O teste de debounce falhou na validação independente. Por inspeção, `press()` apenas chama o handler no harness. Como a troca de período só era aplicada pelo `act()` que inseria o texto, o hook recebia as duas mudanças no mesmo ciclo e suspendia a leitura até o debounce. A chamada intermediária esperada pelo teste não ocorria. Isso explica a divergência na sequência simulada sem apontar defeito no hook.

O teste agora aplica cada interação em seu próprio `act()` e associa respostas a período, busca e cursor. Ele carrega uma página adicional em cada contexto, confirma que tanto a troca de período quanto a busca começam sem cursor e verifica os dois lados do limite de 300 ms. Respostas antigas chegam separadamente após cada transição e a última não pode reintroduzir o botão de paginação.

Na revisão dos demais casos, a paginação passou a reutilizar a resposta associada ao cursor, e os testes do resumo passaram a distinguir requisições pela rota e pela conta simulada. Os atrasos simulados são resolvidos no `finally`, após a desmontagem. O teste de debounce também restaura os timers no `finally`. O código de produção foi preservado. A correção foi inspecionada estaticamente e aguarda nova execução direcionada.

## Correção da navegação de retorno

Na campanha seguinte, o frontend encerrou naturalmente com 1.001 de 1.002 testes aprovados, sem cancelamentos ou casos ignorados. O debounce passou. A única falha informada foi o retorno do resumo para Home no teste de integração de navegação.

A origem da divergência está no `FocusedStack` do harness. Ele renderizava apenas a rota focada e desmontava `AdminTabs` quando o resumo era aberto. No retorno, o `TabRouter` era recriado com Home, sua primeira rota. A implementação do native stack instalada no app mantém as rotas da pilha renderizadas por chave. O resumo usa `goBack()` na pilha Admin e a aba Histórico continua sendo a origem. Assim, a instância da lista mantém busca, período e páginas carregadas enquanto está sob o resumo e pode reconsultá-las no foco.

O harness agora mantém `AdminTabs` montado pela mesma chave sob o resumo, com a pilha e o roteador de abas reais. O teste conserva as asserções de rota, evento e sequência de consultas, e também verifica que Histórico está selecionado na barra após o retorno. O ajuste se limita ao harness e à documentação. A execução do teste corrigido segue para a próxima validação.

## Ajustes finais após homologação visual — 27/11/2026

O responsável informou aprovação funcional, frontend 1.002/1.002, backend 1.359/1.359, integração PostgreSQL 1/1 e ambos os typechecks aprovados na revisão anterior, cujo patch era `A2D26D9CDDEDBC8A6C366F1BF408800466B5BA6ACE35762BB9B0845DF8F0A7AF`. Esses resultados antecedem os ajustes visuais abaixo e não validam automaticamente esta revisão. O encerramento da correção de navegação descrita acima integra essa evidência informada pelo responsável.

No Histórico, os três indicadores passaram a empilhar ícone, valor e rótulo com alinhamento central, usando a largura integral do card e permitindo reorganização quando necessário. Nota média ausente continua representada por travessão, com rótulo curto e descrição acessível explícita de indisponibilidade por ausência de avaliações. Os filtros usam duas colunas por padrão e quatro a partir de 640 pontos medidos no contêiner, evitando a composição de três mais um. Textos continuam escaláveis e podem ocupar mais linhas dentro da célula, sem limite de linhas ou redução de fonte. Reduzidas as margens da pesquisa e do subtítulo exclusivo do Histórico; áreas interativas continuam com pelo menos 44 pontos.

No resumo, horários e duração programada ocupam linhas separadas, sem disputar largura. A formatação da duração programada usa dias a partir de 24 horas e preserva horas, minutos e segundos restantes, sem alterar o contrato ou os cálculos backend. Os quatro primeiros indicadores seguem a ordem participações/avaliações, nota média/conclusões, em duas colunas responsivas. O Indicador A ocupa toda a largura abaixo, com título, valor destacado e identificação/população secundárias; definição e cálculo preservados. Mensagens de comentários, faixa etária e gênero foram abreviadas conforme solicitado, mantendo todos os bloqueios. Ranking e distribuição de avaliações foram preservados.

Arquivos ajustados nesta rodada: `AdminRealHistoryScreen.js`, `AdminHistorySummaryScreen.js`, `components/AdminHistoryUI.js`, estilo `historySubtitle` de `components/AdminLiveScreen.js`, `app/tests/adminHistory.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs`, este relatório e a evidência acumulada. O estilo compartilhado alterado é condicionado a `historyHeader`, sem afetar a ADMIN-09. Testes preparados atualizam os textos esperados, verificam acessibilidade da nota ausente, identificação/população A e formatação de dias com restos. Navegação, filtros, busca, paginação e atualizações não foram alterados.

Limitação de referência: o anexo desta rodada contém somente o roteiro textual; os seis prints reais citados não estavam disponibilizados nesta sessão nem entre os assets encontrados. Os ajustes seguem os problemas descritos, sem afirmar inspeção dessas seis capturas. A aparência final e fontes ampliadas devem ser reconferidas no aparelho pelo responsável.

Inspeções desta rodada: parsers Babel/TypeScript dos arquivos de código do patch, decodificação UTF-8 estrita, `git diff --check`, aplicação isolada na base `82d30e27822967104e1178efaa3ea19f8b968ce8`, comparação de blobs e reversão contra working tree. Índice real preservado. Testes, typechecks e builds não executados; nenhum banco acessado.

## Encerramento definitivo — 27/11/2026

O responsável aprovou a homologação funcional e visual após os ajustes de layout e informou os seguintes resultados efetivamente obtidos nas respectivas revisões:

| Revisão | Evidência informada pelo responsável | Resultado |
| --- | --- | --- |
| Anterior aos ajustes visuais | Frontend completo | 1.002/1.002 aprovados |
| Anterior aos ajustes visuais | Backend completo | 1.359/1.359 aprovados |
| Anterior aos ajustes visuais | Integração PostgreSQL | 1/1 aprovado |
| Anterior aos ajustes visuais | Typecheck da aplicação e dos testes | Ambos aprovados |
| Final, após ajustes visuais | Frontend direcionado | 128/128 aprovados |
| Final, após ajustes visuais | Homologação funcional e visual | Aprovada pelo responsável |

O patch da revisão visual validada possui SHA-256 `C5F14DC80424A1AA92A9340864B504576928F411343393E1E3449A0342453CEA`. Os 128 casos direcionados constituem uma reexecução sobre o escopo afetado e não são somados aos 1.002 casos da campanha completa como testes distintos. Não se atribui à revisão visual uma nova execução integral do backend, da integração ou dos typechecks. Nenhuma campanha foi executada pelo Codex nesta consolidação.

Nova decisão expressa do responsável: o Admin global deverá acessar os comentários das avaliações e o perfil agregado do público. A implementação ocorrerá na task transversal **ADMIN-10.1**, abrangendo também a ADMIN-09 e preparando reutilização pela ADMIN-11. Esta decisão registra o escopo futuro; os bloqueios atuais de comentários e perfil permanecem temporariamente nesta entrega, sem consulta ou divulgação adicional de dados. As limitações de histórico adequado para faixa etária permanecem registradas e deverão ser consideradas nessa task.

ADMIN-10 encerrada no escopo entregue. A aprovação visual informada pelo responsável supera a pendência de homologação das seções históricas, sem afirmar que o Codex inspecionou as seis capturas indisponíveis nesta sessão. Exportação, BI Geral e demais funcionalidades fora do escopo continuam reservados às tasks correspondentes.

Neste fechamento foram alterados exclusivamente este relatório e `qa-evidence/ADMIN_10-changes.diff`. Evidência acumulada regenerada na base `82d30e27822967104e1178efaa3ea19f8b968ce8`, incluindo o relatório final e excluindo a si própria. Integridade conferida por inventário, aplicação em índice e objetos temporários, correspondência de blobs com working tree, reversão e `git diff --check`; índice real vazio. Branch `feature/admin-analytics`, HEAD preservado. Não houve alteração de código/testes, execução de campanhas, acesso a bancos ou commit.
