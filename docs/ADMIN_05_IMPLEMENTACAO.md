# ADMIN-05 — Criar evento

## Preparação

A branch `feature/admin-event-operations` parte de `develop` em `ae4815fd62237b746ceb2987e10ff37b1e21b50d`, com índice e árvore limpos na abertura. As cinco imagens das etapas e a imagem Evento criado orientam o layout.

O fluxo usa o POST administrativo de eventos ao confirmar a programação. O UUID retornado identifica as leituras de detalhe, estrutura e prontidão e os comandos incrementais de experiência, estação e Staff. A primeira etapa mantém um formulário em memória. O catálogo global e as gestões avançadas de estrutura, equipe e operação pertencem às próximas tarefas.

Os testes de interface e contrato usam respostas HTTP locais controladas. A execução fica para a campanha Luna Medium e a conferência em aparelho para o responsável.

Foram consultados os relatórios ADMIN-01 a ADMIN-03, o Panorama ArenaGo, a seção de configuração administrativa da Arquitetura Backend e os controllers, DTOs, serviços e projeções em `backend/src/events` e `backend/src/auth`. A branch foi criada nesta execução a partir da referência local de `develop`, coincidente com `origin/develop` local.

## Fluxo implementado

| Tela | Comportamento |
| --- | --- |
| Dados do evento | Valida o nome em até 180 caracteres Unicode e o código em 4–64 caracteres ASCII, com hífens entre grupos. O botão sugere um código editável. A reserva definitiva ocorre no servidor. |
| Datas e funcionamento | Os seletores da ADMIN-03 interpretam o início e o término no fuso IANA informado. Horas ambíguas ou inexistentes exigem outra escolha. A margem inicial é zero, editável até 60 minutos. O formulário mostra o prazo calculado e envia a fila externa como booleano explícito. O botão de criação reúne as duas etapas. |
| Experiências e estações | Cada comando persiste um recurso. O cadastro de estação usa o UUID da experiência escolhida na estrutura oficial. Ao concluir cada escrita, o fluxo consulta novamente a API. Uma recusa no cadastro de estação preserva a experiência e permite corrigir sua identificação. |
| Equipe Staff | O Admin concede Staff pelo e-mail normalizado. O backend verifica conta, e-mail e permissões. O fluxo guarda em memória os comprovantes de concessão recebidos para este evento. A revogação exige confirmação, usa o ID devolvido na concessão e é seguida de reconsulta da prontidão. |
| Revisão e prontidão | Detalhe, estrutura e prontidão alimentam o resumo. A porcentagem indica a etapa do formulário. O checklist mostra os cinco checks oficiais, inclusive a configuração da fila externa, e os totais de experiências e estações da leitura. As pendências conhecidas remetem à etapa correspondente. |
| Evento criado | O fluxo volta a consultar o evento antes de apresentar o resultado final. Exibe nome, código, programação, fuso, fase e prontidão atuais. Um evento incompleto recebe “Evento salvo com sucesso” e “Configuração pendente”. Há caminhos para painel, Staff, operação informativa e Home. |

A Home e Gerenciar Eventos abrem a rota dedicada `AdminEventSetup`. A listagem volta a consultar o backend quando recupera o foco, respeitando busca e filtro. A partir de um painel com configuração pendente, o botão **Continuar configuração** passa o UUID ao fluxo. Na retomada, o fluxo começa pela estrutura e permite consultar as etapas anteriores em modo de leitura.

As referências visuais orientaram a barra de progresso, os cartões e os botões das etapas. O cabeçalho, o logo oficial, os ícones, os campos de data, a confirmação de ações, a rolagem e o tratamento do teclado reutilizam componentes Admin. A tela dedicada inclui a área segura inferior.

## Contratos utilizados

Todas as rotas abaixo usam o prefixo `/api/v1` e o cliente HTTP da sessão autenticada.

| Método e rota | Dados utilizados |
| --- | --- |
| `POST /admin/events` | Envia `name`, `accessCode`, `timezone`, `startsAt`, `officialEndsAt`, `operationalDeadlineAt` e `externalQueueEnabled`. A justificativa é opcional. Valida a resposta `{event}` e adota o UUID retornado. |
| `GET /admin/events/:eventId` | Lê os dados e o código persistido. |
| `GET /admin/events/:eventId/experiences` | Lê `{eventId, items}` e estações aninhadas. Confere os identificadores de evento e experiência. |
| `POST /admin/events/:eventId/experiences` | Envia `{name}` e confere a experiência devolvida. |
| `POST /admin/events/:eventId/experiences/:experienceId/stations` | Envia `{label}` e confere a estação devolvida e sua experiência. |
| `POST /admin/roles/grant` | Envia `{role: 'staff', email, eventId}` e confere o vínculo retornado. |
| `POST /admin/roles/revoke` | Envia `{grantId}` a partir de um comprovante do evento e confere o vínculo e a data da revogação. |
| `GET /admin/events/:eventId/readiness` | Usa `ready`, `checks`, `missing` e `effectivePhase`. Prontidão e horário de abertura são apresentados separadamente. |

## Persistência, sessão e recuperação

- O projeto contém armazenamento específico para credenciais e intenções operacionais. Não foi identificado um armazenamento de rascunhos de formulário Admin isolado por conta. O texto inicial informa a duração do formulário em memória. A saída com campos pendentes permite cancelar ou descartar.
- Depois do primeiro POST confirmado, o UUID identifica todas as operações da preparação. O código e os horários passam a ser somente leitura no fluxo. A edição de horários permanece no painel da ADMIN-03. **Salvar e revisar depois** mostra a confirmação do que já foi persistido. A saída mantém esses registros.
- A sessão Admin verificada, a revisão de identidade e o cliente autenticado delimitam o estado da tela. Requisições de leitura têm controle de geração. Desmontagem ou mudança de sessão invalida resultados anteriores. A recuperação de foco realiza somente leituras.
- Cada escrita usa uma chave por intenção e bloqueia outra submissão em voo. Timeout, resposta divergente, falha de rede ou processamento incerto preservam a chave e o corpo enquanto o fluxo estiver aberto. O reenvio é explícito. Na saída após resultado incerto, a interface orienta conferir o evento na listagem. Conflito de código permite corrigir a entrada e iniciar uma nova intenção.
- Erros de acesso bloqueiam a apresentação dos dados. Uma falha de leitura deixa a prontidão indisponível e oferece nova consulta. A interface distingue conflito de código, concessão duplicada e conta inelegível.

## Limites dos contratos

O controller de papéis expõe concessão e revogação. A inspeção das rotas não identificou uma leitura administrativa da lista nominal de Staff por evento. A seção **Concessões nesta sessão** identifica exatamente o que pode ser revogado ali. Ao reabrir o fluxo, a API de prontidão informa se existe Staff elegível. A composição completa da equipe, sua contagem e a revogação de vínculos anteriores dependem de uma leitura autorizada futura na ADMIN-06.

O catálogo global fica para ADMIN-08. A gestão avançada da estrutura permanece na ADMIN-04 e as ações operacionais na ADMIN-07. A confirmação omite localização, ausente no contrato. A implementação usa os serviços existentes e dispensa mudanças de backend, migrations e dependências.

## Inventário

| Área | Arquivos na árvore de trabalho |
| --- | --- |
| Novos em `app/screens/admin/` | `AdminEventSetupScreen.js`, `adminCreationFlow.js`, `adminCreationForm.js`, `components/AdminSetupSteps.js` |
| Alterados em `app/screens/admin/` | `AdminDemoNavigator.js`, `AdminHomeScreen.js`, `AdminRealEventsScreen.js`, `AdminRealEventScreen.js`, `AdminEventSettingsScreen.js`, `adminEventManagement.js`, `components/AdminLiveScreen.js`, `components/AdminLiveUI.js`, `components/AdminScheduleFields.js` |
| Serviços | Novo `app/services/adminEventSetupService.js` e alterado `app/services/adminEventsService.js` |
| Testes | Novo `app/tests/adminEventSetup.test.cjs`. Alterados `app/tests/adminNavigation.test.cjs`, `app/tests/adminRealEvents.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs` |
| Documentação | Novo `docs/ADMIN_05_IMPLEMENTACAO.md` |

## Verificações e campanha pendente

Foi feita inspeção estática do diff, dos arquivos novos, das rotas registradas, dos DTOs, das chaves de escrita e do isolamento da sessão. O parser Babel local analisou 19 arquivos JS/CJS e a resolução estática encontrou os 91 imports declarados. A inspeção de espaços finais incluiu os arquivos novos. `git diff --check` terminou com código 0. O índice real está vazio.

Foram preparados nove testes focados de formulário, contratos e controle do fluxo e dois cenários de integração do roteador. Os dois cenários percorrem o caminho com pendências e o caminho pronto, incluindo os dois pontos de entrada, progresso, retorno com UUID, Staff, cancelamento de revogação, confirmação e retomada. As expectativas anteriores de navegação foram ajustadas para a ação de criação agora disponível.

## Primeira campanha de validação — Luna Medium

Modelo selecionado pelo responsável: GPT-6 Luna — Medium. Comando executado em `app`, com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = "test"
node --test --test-reporter=spec tests/adminEventSetup.test.cjs tests/adminRealEvents.test.cjs tests/adminEventSettings.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Resultado: **91 testes aprovados, 0 reprovados, 0 ignorados**, exit code **0**. O runner informou 91 testes e nenhuma suíte com falha. Os seis arquivos indicados no comando foram executados, incluindo ADMIN-03, criação ADMIN-05, navegação Admin, autenticação e roteamento de papéis.

O mock integrado usa o transporte local do harness, com URL-base `127.0.0.1:3000`, e intercepta cada requisição sem abrir conexão. Os testes focados usam clientes HTTP falsos. Nenhuma fixture ou script acessa PostgreSQL, Neon ou serviço remoto, e nenhum teste realiza migration ou seed.

### Cenários ADMIN-05 exercitados

- Os testes integrados passam da Home e da listagem ao wizard, navegam entre etapas e retomam evento pelo UUID retornado. O teste focado confirma que o primeiro POST ocorre somente após a etapa 2, que o código fica bloqueado após criação e que voltar não duplica o evento.
- Testes focados validam nome, código ASCII, geração compatível, fuso, virada de dia, margens 0 e 60, margem excessiva, hora local inválida ou ambígua e fila externa explícita.
- O timeout simula resultado incerto. O teste confirma edição bloqueada, retry explícito, mesma chave e corpo, e bloqueio de segunda submissão enquanto há escrita. Falha definitiva de código duplicado mantém o formulário e a nova tentativa usa outra chave.
- Testes focados verificam UUIDs de evento e experiência, persistência incremental, falha de estação sem apagar experiência, concessão vinculada ao evento, usuário inelegível, revogação e readiness atualizado. O cenário integrado confirma que cancelar a revogação não envia escrita.
- A revisão usa os checks de readiness do servidor. Cobrem pendência e prontidão, fase agendada mesmo com `ready=true`, conclusão sem novo POST e abertura do Painel Individual pelo UUID correto.
- A saída é coberta pelo cenário integrado. Logout e retorno pedem confirmação com campos locais, e cancelar mantém a tela aberta. Troca de proprietário durante POST é coberta no teste focado. As suítes anteriores cobrem logout, troca de conta e respostas atrasadas no painel.

### Regressões e lacunas

As suítes de ADMIN-01, ADMIN-02 e ADMIN-03 passaram nos mesmos 91 testes. Busca, filtros, paginação, seleção por UUID, detalhe, prontidão, conflitos, datas, QR, autenticação/TOTP, logout, pilhas por papel e sessão foram exercitados.

O harness HTTP não prova isolamento transacional, autorização real, auditoria ou idempotência efetiva no PostgreSQL. Layout, teclado, seletores nativos, áreas de toque e continuidade visual em iOS/Android não foram homologados em aparelho. A API não oferece leitura nominal de Staff, então contagem completa e revogação de concessões anteriores à sessão ficam fora desta cobertura. Não há teste dedicado que atrase uma resposta GET do setup durante troca de UUID. A implementação usa geração e escopo de sessão para descartar respostas antigas. POST atrasado está coberto no teste focado.

Durante a execução, React emitiu avisos de depreciação de `react-test-renderer` e avisos do harness integrado sobre componentes stub chamados `default` nas rotas de autenticação. Não houve falhas associadas. As buscas por `.only` e exclusões acidentais nos seis arquivos não encontraram ocorrências.

Verificações posteriores: `git diff --check` exit 0, `git diff --cached --exit-code` exit 0 e índice sem staged. O inventário permanece com 13 arquivos rastreados modificados e sete novos, incluindo o relatório. Nenhum arquivo backend mudou. O patch não foi gerado. HEAD permanece em `ae4815fd62237b746ceb2987e10ff37b1e21b50d`, branch `feature/admin-event-operations`.

A campanha focada passou. Revisão técnica e homologação visual e funcional em aparelho continuam pendentes antes da aprovação da ADMIN-05.

## Auditoria técnica pós-implementação

**Decisão: corrigir antes da homologação.** A leitura do código confirmou caminhos para disparar a criação sem tocar no botão da etapa 2, perder a recuperação de um evento recém-criado e perder a confirmação de logout enquanto a criação termina. Também há risco de duplicar uma experiência ou estação ao sair após uma resposta incerta. A auditoria não identificou um caminho de concessão global a partir do wizard ou exposição de dados de uma conta anterior. O resultado de 91 testes pertence à primeira campanha. Esta auditoria foi feita por inspeção estática, sem executar testes.

### Defeitos confirmados

| Gravidade e localização | Causa, cenário e impacto | Correção mínima e teste recomendado |
| --- | --- | --- |
| **Moderada. A confirmação da etapa 2 pode ser pulada.** `app/screens/admin/AdminEventSetupScreen.js:109–111` e `app/screens/admin/adminCreationFlow.js:148–155`. | O botão de avanço usa o mesmo callback nas duas etapas e `next()` lê a etapa mutável ao executar. Preencha a etapa 2, volte à etapa 1 e acione duas vezes o callback de “Continuar” antes que a tela atualize. A primeira chamada muda a etapa para 2. A segunda usa a programação que ficou no formulário e envia o POST, reservando o código de forma permanente. O bloqueio `busy` só atua depois que esse POST começa. | Vincular a ação à etapa que a exibiu e reservar o comando de criação para a ação explícita da etapa 2. Em teste de integração, invoque duas vezes o handler capturado da etapa 1 com programação válida preservada e confirme zero POSTs até pressionar “Criar evento e continuar”. |
| **Moderada. O wizard pode salvar um evento já encerrado que some da listagem.** `app/screens/admin/adminCreationForm.js:35–41`, `backend/src/events/admin-configuration.dto.ts:27–30`, `backend/src/events/admin-configuration.service.ts:60–66`, `backend/src/events/admin-configuration.projection.ts:21–25` e `app/services/adminEventsService.js:28–37`. | Informe um intervalo completo no passado, incluindo o prazo operacional. A criação valida a ordem dos horários e a margem, portanto a API insere o evento com status armazenado `scheduled` e fase efetiva `closed`. As escritas da estrutura rejeitam o evento vencido, o painel omite “Continuar configuração” e Gerenciar Eventos exclui `closed`. Após sair, o fluxo normal não oferece a recuperação desse evento, embora o código já esteja reservado. A aba Histórico ainda é informativa. | No wizard, rejeitar uma janela oficial já encerrada antes do envio e tratar uma eventual resposta `closing`/`closed` como condição de encerramento, mantendo acesso ao painel pelo UUID confirmado. Se o produto precisa aceitar eventos históricos pelo wizard, definir um caminho de recuperação para eles. Cobrir horários passados e fronteira de vencimento com relógio controlado e fase realista nas respostas simuladas. Preservar as regras de alteração da ADMIN-03. |
| **Moderada. O logout confirmado pode ser descartado.** `app/screens/admin/AdminEventSetupScreen.js:70–74,116–118`, `app/screens/admin/components/AdminLiveScreen.js:13–17,24–26` e `app/screens/admin/adminCreationFlow.js:106–110`. | Atrase o POST da etapa 2, abra “Sair da conta” durante a escrita, deixe o POST terminar e pressione “Confirmar saída”. O avanço para a etapa 3 remonta `AdminLiveScreen`, pois sua chave muda. O diálogo retido no componente pai ainda chama o logout do cabeçalho desmontado. A guarda `mounted.current` descarta a ação e o diálogo se fecha com a sessão ainda ativa. | Usar no diálogo uma ação de logout que pertença ao wizard e confira a sessão vigente ao confirmar. Testar confirmação com POST atrasado que resolve entre abrir e confirmar o diálogo e verificar término da sessão, sem efeito ao invocar um diálogo de outra sessão. |
| **Baixa. Uma revogação externa deixa um comprovante com ação obsoleta.** `app/screens/admin/adminCreationFlow.js:86–94,127–131`, `app/screens/admin/components/AdminSetupSteps.js:89–95` e `backend/src/auth/admin-role-management.service.ts:154–158`. | Conceda Staff no wizard e revogue o mesmo vínculo em outra sessão autorizada. O comprovante local permanece. Ao tentar revogar, o backend responde 404 para o vínculo que já não está ativo. O erro mantém o botão e não atualiza a prontidão nessa tentativa. A próxima recuperação de foco atualiza a prontidão e o comprovante continua na lista. | Em 404 da revogação, retirar ou marcar aquele comprovante como indisponível e reconsultar prontidão, sem afirmar quem revogou ou quando. Testar o 404 com dois comprovantes e preservar o outro registro. |

### Riscos residuais

- **Moderado, duplicação de estrutura após sair com resultado incerto.** O `intent` conserva chave e corpo na instância corrente de `adminCreationFlow.js:26–32,86–100`. Reabrir a rota cria outra instância em `AdminEventSetupScreen.js:24–39`. Se o servidor tiver gravado uma experiência ou estação e a resposta se perder, a leitura de retomada mostra o que já estiver confirmado no servidor, mas não associa aquele item à intenção anterior. Se o usuário repetir o mesmo cadastro, inclusive antes de a escrita anterior ficar visível, o novo comando usa outra chave. A chave do servidor distingue as duas intenções, e `admin-configuration.mutation.ts:9–12` e `backend/drizzle/0004_event_operations.sql:1–21` permitem registros homônimos. A advertência de saída e a reconsulta reduzem o risco, mas não resolvem a ambiguidade. Recomenda-se conservar a intenção explicitamente recuperável ao reabrir o mesmo evento na mesma sessão, mantendo o reenvio manual com a chave original. Para saída de conta, definir como reconciliar sem carregar dados para outra sessão. Testar commit seguido de perda de resposta, leitura que ainda não enxerga a escrita, saída e retomada. Para eventos, o índice único impede duplicata do mesmo código mesmo com chave nova. Uma troca de código após perder uma confirmação pode criar um segundo evento operacionalmente equivalente.
- **Baixo, divergência de leitura.** Detalhe, estrutura e prontidão são três snapshots autorizados e independentes. Uma mudança concorrente entre consultas pode mostrar contagem e checklist de instantes diferentes. As gerações do wizard impedem a publicação de uma rodada obsoleta, mas não tornam a rodada atômica. A revisão e a confirmação reconsultam os dados. Ver `adminCreationFlow.js:45–67,69–74` e `admin-configuration-query.service.ts:23–25,37–52`. Cobrir troca de UUID com GET pendente e, se for observado em uso, avaliar uma projeção única em tarefa própria.
- **Baixo, diferenças de plataforma em datas.** A criação envia instantes UTC com milissegundos, compatíveis com `normalizeScheduleInstant`, enquanto o backend exibe microssegundos. O wizard só compara e apresenta datas persistidas, com perda de precisão submilissegundo no resumo da margem. As regras e a precisão de escrita da ADMIN-03 foram preservadas. Restam a homologação dos seletores e do suporte a `Intl` nos aparelhos, incluindo fuso diferente do dispositivo e transição de horário. Ver `adminCreationForm.js:21–41`, `adminScheduleForm.js:22–46,49–60`, `AdminSetupSteps.js:26–50,109–111` e `backend/src/events/admin-schedule.dto.ts:6–20`.

### Contratos, isolamento e compatibilidade

- No caminho ordinário, a etapa 2 só cria sem UUID. `busy` é marcado antes do transporte. Timeout e `IDEMPOTENCY_IN_PROGRESS` conservam chave e payload e a recuperação de foco só consulta. O servidor usa fingerprint, reserva e reapresentação do resultado na mesma operação autorizada. `ACCESS_CODE_ALREADY_USED` permite corrigir a entrada e emitir outra intenção. Com UUID persistido, voltar ou retomar apenas consulta o evento e mantém o código bloqueado. O backend restringe o PATCH do evento e a migration base protege a imutabilidade no banco. Ver `adminCreationFlow.js:69–110,144–158`, `admin-configuration.service.ts:35–66,91–98` e `backend/drizzle/0002_events_base.sql:25–40`.
- O serviço fecha o escopo de estrutura por UUID e valida o vínculo retornado. Para estações, o backend confirma a experiência dentro do evento antes da escrita. Falha da estação preserva a experiência confirmada. As leituras retomam a estrutura por UUID, e as escritas do wizard são operações de adição, concessão ou revogação de Staff. Não há exclusão de evento, experiência ou estação. Ver `adminEventSetupService.js:17–53` e `admin-configuration.service.ts:39–46,75–90`.
- O grant usa sempre `role: 'staff'` e o UUID do evento. Cliente e DTO aplicam a mesma normalização e restrição de e-mail. A API requer Admin global e sessão com segundo fator, valida conta ativa e e-mail verificado do alvo, rejeita concessão vigente duplicada e retorna um comprovante. O wizard confere o vínculo, pede confirmação e só revoga o `grantId` guardado para aquele evento. Concessões confirmadas e revogações bem-sucedidas disparam reconsulta. O checklist usa Staff ativo, verificado e com concessão vigente, sem inferir equipe completa do comprovante local. Ver `adminCreationForm.js:44–47`, `adminEventSetupService.js:56–76`, `admin-role-management.dto.ts:5–25`, `admin-role-management.service.ts:44–119,128–197` e `admin-configuration.projection.ts:14–20`.
- O proprietário inclui conta, sessão, época e revisão de identidade. A pilha Admin usa essa identidade como chave. O wizard troca o fluxo por proprietário/cliente/UUID, descarta publicação fora da geração e remove os dados ao receber 401/403. As escritas não têm refresh e reenvio automáticos após 401. Uma resposta confirmada de outra sessão não pode preencher o wizard vigente. A janela de corrida no diálogo de logout é a exceção funcional descrita acima. Ver `useAdminEvents.js:6–9`, `AdminDemoNavigator.js:28–36`, `AdminEventSetupScreen.js:24–39` e `adminCreationFlow.js:32–67,75–90,137–142`.
- A revisão usa `GET /readiness`, dados e contagens oficiais. A barra mostra etapa do formulário. Uma leitura parcial ou inválida suspende a confirmação e oferece retry. A fase efetiva é exibida separadamente, portanto um `ready=true` ainda pode corresponder a um evento agendado. A ação final reconsulta pelo UUID em vez de emitir outro POST. Home e listagem só ganham a entrada para a nova rota e a lista se atualiza no foco. A troca do validador de nome da ADMIN-03 conserva a regra e nenhum código de QR, TOTP ou dependência foi alterado. Os serviços de estrutura e Staff podem ser reaproveitados em ADMIN-04/06, mantendo as telas do wizard específicas desta entrega.

### Testes e limites

Os nove testes focados e os dois cenários integrados foram lidos. As assertions de envio concorrente na etapa 2, igualdade de corpo/chave no retry, vínculo de UUIDs, falha parcial, revogação confirmada e prontidão exercitam o comportamento alegado. O mock de criação integrado devolve o payload recebido com um UUID sintético e sempre marca a fase `scheduled`. Ele não simula o DTO completo, a projeção em microssegundos, a expiração da janela ou a confirmação perdida após gravação. O mock de estrutura persiste em memória, e o teste de sessão invalida o proprietário antes de liberar uma resposta POST, sem efetuar logout durante o diálogo do wizard. A expectativa antiga de “Criar evento” desabilitado foi substituída pela assertion de navegação, e o catálogo continua coberto como desabilitado.

Priorizar os testes vinculados aos achados acima. Acrescentar respostas de contrato com campos de tempo em seis casas, transição para fase encerrada, `409 IDEMPOTENCY_IN_PROGRESS` e uma negativa de escrita Staff/estrutura seguida de mudança de conta. O histórico de 91 aprovações dá cobertura frontend com mocks. A leitura do código do backend fundamenta a análise de contratos e locks, sem confirmação em PostgreSQL ou Neon. A ausência da lista nominal Staff é aceita no escopo, assim como o rascunho anterior ao primeiro POST limitado à memória. Os comprovantes são apresentados como concessões do fluxo corrente e não como lista da equipe. Validação visual e funcional em aparelho permanece pendente.

Foram examinados os 19 arquivos JS/CJS do inventário e este relatório, os testes de horários e autenticação, `useAdminEvents.js`, `adminScheduleForm.js`, o cliente HTTP e o contexto de sessão. A leitura de referência incluiu controllers, DTOs, serviços, respostas de erro, projeção e autorização de configuração Admin e papéis, normalização de acesso e datas, reserva idempotente e constraints de eventos e estrutura, além dos relatórios ADMIN-01 a ADMIN-03 e E08.13. A auditoria alterou somente este relatório.

O estado conferido ao fim da auditoria foi branch `feature/admin-event-operations`, HEAD `ae4815fd62237b746ceb2987e10ff37b1e21b50d`, 13 arquivos rastreados modificados e sete novos. O índice estava vazio, `git diff --check` retornou 0 e a inspeção direta do relatório não encontrou espaços finais. A evidência `qa-evidence/ADMIN_05-changes.diff` ainda não existe.

## Correções pós-auditoria — ADMIN-05

A implementação das correções parte da mesma branch e do mesmo HEAD, com as alterações anteriores preservadas. A criação será vinculada ao botão da etapa 2, com verificação do término e recuperação pelo UUID confirmado. O logout usará o contexto de sessão do wizard, a revogação indisponível será reconciliada por comprovante e as intenções de estrutura terão recuperação explícita em memória dentro da sessão. Os 91 testes aprovados correspondem à versão anterior. A execução pós-correção fica para Luna Medium.

| Achado | Correção implementada | Teste preparado |
| --- | --- | --- |
| Criação acionada pelo botão da etapa 1 | `AdminEventSetupScreen.js` e `adminCreationFlow.js` separam o avanço da confirmação. As ações são vinculadas à versão da etapa apresentada. O POST exige uma confirmação da etapa 2, UUID ainda ausente e fluxo sem escrita em andamento ou resultado incerto. | O teste de navegação captura o handler da etapa 1 depois de preencher os horários e voltar. Invoca duas vezes e exige zero POSTs até confirmar explicitamente na etapa 2. Os testes verificam UUID, bloqueio de segundo envio e igualdade de chave e payload no retry. |
| Criação fora da janela oficial | `adminCreationForm.js` e `adminCreationFlow.js` validam o término ao enviar pelo relógio local. O início pode estar no passado. Uma confirmação com fase `closing` ou `closed` mantém o UUID, interrompe a configuração no wizard e abre o Painel Individual pelo UUID. | Relógio controlado verifica intervalo vencido, término igual ao instante da validação, início no passado com fim futuro e datas futuras. A integração simula `closing` e `closed` e confere o aviso, a ausência de prontidão no wizard, o painel correto e um único POST. |
| Logout confirmado durante a transição | `AdminLiveScreen.js` encaminha o pedido para o wizard. `AdminEventSetupScreen.js` executa o logout do contexto atual após conferir instância, identidade, cliente e foco. O diálogo permanece válido após a remontagem interna do cabeçalho. Cancelar consome a confirmação. | O POST é mantido pendente enquanto o usuário abre o diálogo. Os casos cobrem resolução antes da confirmação, cancelamento, sessão encerrada e troca de conta antes da resposta e da invocação de uma confirmação antiga. |
| Revogação Staff indisponível | O `404` da revogação limpa apenas o comprovante relacionado e reconsulta o servidor. O aviso informa que o vínculo deixou de estar disponível. `401` e `403` continuam bloqueando o fluxo e limpando os dados exibidos. | O teste usa dois comprovantes, verifica a remoção de apenas um, a nova leitura de prontidão e o uso do segundo comprovante. Verifica separadamente os dois códigos de autorização. |
| Resultado incerto de experiência ou estação | A pilha Admin fornece um mapa em memória por identidade verificada e cliente, indexado pelo UUID do evento. O controlador reserva chave, corpo e identificadores antes do envio. Ao reabrir, consulta a estrutura e mantém a intenção recuperada para retry explícito com os mesmos dados. O painel oferece a retomada mesmo quando a estação já gravada tornou o evento pronto. O usuário pode encerrar a tentativa após consultar a estrutura e confirmar que o cadastro anterior pode ter sido salvo. | Os testes simulam persistência com perda de resposta para experiência e estação, fecham e reabrem a instância, verificam leitura antes do retry, preservação de chave e corpo e isolamento com outra sessão. A integração verifica a retomada real pelo Painel Individual com `ready=true`. Um teste adicional verifica o aviso e a liberação da próxima ação depois de encerrar a tentativa. |

Após um timeout de criação sem UUID, se o término for alcançado, o wizard preserva o estado incerto e informa que o envio anterior pode ter sido concluído. Um novo envio da mesma intenção poderia criar o evento depois do término se a primeira chamada nunca tivesse chegado ao servidor. O teste prepara essa fronteira e exige que o retry após o término não emita outro POST. O relógio do aparelho é uma proteção de interface, e a fase que o backend devolver continua sendo a referência. As validações e escritas da ADMIN-03 foram preservadas.

O mapa é descartado se a pilha Admin for desmontada, se mudar a identidade verificada ou se o processo for encerrado. Ele guarda dados da operação, sem tokens ou credenciais. Após perda da intenção, a tela orienta conferir a estrutura salva antes de outro cadastro. O contrato atual não permite associar automaticamente por chave um recurso cuja intenção foi perdida. A existência de homônimos e a possibilidade de gravação tardia impedem garantir uma única criação nesse caso. A equipe completa de Staff continua fora do escopo.

**Arquivos desta rodada.** Em `app/screens/admin/`, foram ajustados `AdminDemoNavigator.js`, `AdminEventSetupScreen.js`, `AdminRealEventScreen.js`, `adminCreationFlow.js`, `adminCreationForm.js`, `components/AdminLiveScreen.js` e `components/AdminSetupSteps.js`. O novo `adminSetupIntents.js` declara o contexto da pilha. Os testes foram preparados em `app/tests/adminEventSetup.test.cjs`, `app/tests/adminNavigation.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs`. O relatório registra a rodada no mesmo arquivo. Backend, contratos HTTP, dependências, filtros e migrations permanecem como na primeira implementação.

Foram acrescentados seis testes focados e seis cenários de integração. O cenário integrado existente de criação foi ampliado e a verificação da composição do navegador foi adaptada ao provedor de intenções. A inspeção estática revisou as fases da API, o código `RESOURCE_NOT_FOUND`, os caminhos de sessão e o uso de idempotência existente. A sintaxe e os imports dos 11 arquivos JS/CJS desta rodada foram conferidos, incluindo 59 resoluções e 70 símbolos locais conferidos. `git diff --check` aprovou a revisão. Nesta rodada não houve execução de testes. A campanha de seis arquivos registrada acima fica para Luna Medium. A homologação visual e funcional continua pendente.
Estado final da rodada: `feature/admin-event-operations`, HEAD `ae4815fd62237b746ceb2987e10ff37b1e21b50d`, 13 arquivos rastreados modificados e oito novos. Índice vazio. O patch definitivo ainda não existe.

## Campanha de validação pós-correções — Luna Medium

O responsável selecionou GPT-6 Luna — Medium para esta campanha. Antes de executar, foram conferidos `AGENTS.md`, este relatório, a branch, o HEAD, o índice Git, os scripts do `app/package.json` e os seis arquivos de teste. Não existe `app/AGENTS.md`. A inspeção confirmou que a campanha usa harnesses locais, clientes HTTP falsos e transporte simulado em `127.0.0.1`; não acessa banco, Neon ou serviços externos e não executa migrations ou seeds. Os testes não foram modificados nesta campanha.

Comando executado em `app` (PowerShell):

```powershell
$env:NODE_ENV = "test"
node --test --test-reporter=spec tests/adminEventSetup.test.cjs tests/adminRealEvents.test.cjs tests/adminEventSettings.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Resultado do Node test runner: **103 testes, 103 aprovados, 0 reprovados, 0 ignorados**, exit code **0**. As seis entradas indicadas foram executadas. A contagem aumentou em relação aos 91 testes da campanha anterior; não foi presumida. Avisos observados: `react-test-renderer is deprecated` e stubs de telas com nome `default` no teste de integração de roteamento. São avisos do ambiente de teste; não causaram falha.

### Resultado dos cenários pós-correção

- **Criação pela etapa 2:** os testes do controlador cobrem submissões em voo e bloqueio de segundo POST. O teste de roteamento invoca repetidamente um callback antigo da etapa 1 e confirma que não cria o evento; a criação acontece por confirmação explícita da etapa 2.
- **Janela e encerramento:** relógio controlado cobre término vencido, término exatamente no instante atual e início passado com término futuro. Casos integrados de `closing` e `closed` verificam UUID preservado, aviso, acesso ao painel do evento e ausência de nova criação.
- **Logout:** integrações mantêm o POST pendente durante a abertura do diálogo e cobrem confirmar, cancelar e trocar de conta; a confirmação válida encerra a sessão, o cancelamento a preserva e a confirmação antiga não afeta a conta nova. Casos separados para fases `closing`/`closed` conferem UUID e acesso ao painel sem novo POST.
- **Revogação Staff:** o teste focado simula 404 para uma concessão já revogada, preserva o outro comprovante, reconsulta prontidão e continua a tratar 401/403 como bloqueio.
- **Intenções de experiência e estação:** testes focados simulam gravação com resposta perdida, desmontagem e retomada do mesmo evento na mesma sessão, leitura antes de retry, preservação de chave e corpo e reenvio somente explícito. Também verificam isolamento para um mapa de outra sessão e a perda da intenção quando a memória é descartada. A integração cobre retomada de estação salva quando a prontidão já passou a `ready=true`.

### Regressões, lacunas e verificações estáticas

Os mesmos seis arquivos exercitaram regressões da Home Admin, Gerenciar Eventos, Painel Individual, horários e QR Code da ADMIN-03, navegação, autenticação/TOTP, troca de conta e roteamento de papéis, além da criação, retomada, experiências, estações, Staff e checklist de prontidão. Todos os testes executados passaram.

Essas verificações são frontend e usam mocks. Não provam a execução dos contratos reais do backend, transações PostgreSQL, idempotência entre instâncias nem comportamento após encerramento do processo. A recuperação de intenções de estrutura é deliberadamente limitada à memória da pilha/sessão. A homologação em aparelho continua pendente.

Verificações adicionais executadas:

| Comando | Resultado |
| --- | --- |
| `git diff --check` | Exit 0; sem erros de whitespace no diff rastreado. |
| `git status --short` | Exit 0; 13 arquivos rastreados modificados e oito arquivos novos, conforme inventário anterior. |
| `git diff --cached --exit-code` | Exit 0; índice Git real vazio. |
| Busca por `.only` nos seis arquivos de teste | Nenhum caso `.only` encontrado. Os usos de `skip` no arquivo integrado são condicionais; o runner reportou zero ignorados. |

Não houve correções nesta campanha. A documentação foi atualizada preservando o resultado histórico de 91 testes, que se refere à versão anterior às correções. Estado ao concluir: branch `feature/admin-event-operations`, HEAD `ae4815fd62237b746ceb2987e10ff37b1e21b50d`; alterações da ADMIN-05 preservadas; índice sem staging; `qa-evidence/ADMIN_05-changes.diff` ainda não gerado. Recomenda-se avançar para homologação visual e funcional em aparelho, mantendo pendente a revisão do responsável.

## Padronização global do cabeçalho Admin — ajuste pós-homologação

O responsável informou homologação funcional em aparelho da criação de evento, experiências, estação, concessões Staff, prontidão e conclusão antes deste ajuste. A campanha de 103 testes acima também é anterior à alteração do cabeçalho.

O cabeçalho compartilhado `AdminLiveScreen` exibe o asset oficial `app/assets/images/logo-arenago.png` à direita, com `contain`, e ação à esquerda. A Home usa logout com a guarda de identidade e montagem existente. As outras telas fornecem retorno explícito, sem logout. O cabeçalho permanece acima da rolagem, respeita a área segura e usa menos espaçamento vertical; botão e texto podem se ajustar à largura disponível. A marca não é um botão.

| Tela ou rota ativa | Ação no cabeçalho |
| --- | --- |
| Home (`AdminTabs`) | Sair da conta. |
| Histórico e BI (`AdminTabs`) | Voltar para Home pela navegação de abas. |
| Gerenciar Eventos (`AdminEvents`) | Voltar para Home. |
| Painel Individual (`AdminRealEvent`) | Voltar aos eventos. |
| Informações e horários e quatro áreas informativas (`AdminEventManagementInfo`) | Voltar ao painel com o UUID do evento. |
| Criar Evento (`AdminEventSetup`) | Na primeira etapa, volta à origem Home/listagem, ou ao painel na retomada; etapas 2–5 voltam uma etapa. Resultado e evento em encerramento abrem o painel pelo UUID. |

As rotas demonstrativas antigas continuam fora do navegador ativo. Home e listagem informam a origem do wizard explicitamente. O retorno inferior de etapa foi removido para não duplicar a ação do cabeçalho. Durante escrita, o retorno fica desabilitado. Em resultado incerto, o retorno leva à origem com a confirmação de saída já existente, preservando a intenção de estrutura recuperável na sessão; campos locais em mudança de etapa continuam sujeitos à confirmação. Informações e horários mantém `usePreventRemove`. As guardas de dono, cliente e geração do wizard e a autenticação central permanecem em uso. O diálogo de logout exclusivo do wizard foi retirado porque o logout agora está na Home.

Arquivos desta rodada: `app/screens/admin/components/AdminLiveScreen.js`, `AdminHomeScreen.js`, `AdminPendingScreen.js`, `AdminRealEventsScreen.js`, `AdminEventSetupScreen.js`, `app/tests/adminRealEvents.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs` e este relatório. Foram preparadas assertions de ordem da ação e logo, ausência de logout interno, retornos por origem e etapa, painel final, descarte em Informações e horários, navegação das abas e isolamento de respostas pendentes após logout ou troca de conta. Os testes anteriores de retry e intenção incerta continuam preparados.

Inspeção estática: rotas registradas, destinos, proteções e asset rastreado foram conferidos; o parser Babel analisou os sete arquivos JS/CJS desta rodada e conferiu seus imports relativos. Uma primeira chamada do parser falhou por aspas do PowerShell; a chamada corrigida terminou com exit 0. `git diff --check` terminou com exit 0 no diff rastreado. Não foram executados testes nesta implementação com Terra. Permanecem para Luna Medium a campanha automatizada e, para o responsável, a conferência visual e funcional do novo cabeçalho em aparelho, inclusive fonte ampliada e telas pequenas. A ADMIN-05 não está aprovada por esta rodada; o changes não foi gerado.

## Campanha de validação do cabeçalho Admin — Luna Medium

O responsável selecionou GPT-6 Luna — Medium. Foram lidos `AGENTS.md` e este relatório, confirmados branch `feature/admin-event-operations`, HEAD `ae4815fd62237b746ceb2987e10ff37b1e21b50d`, árvore e índice. O comando do `app/package.json` é o Node test runner. A inspeção dos seis arquivos confirmou mocks locais e URL de loopback interceptada pelo harness, sem conexão real, banco, migrations ou serviços externos.

Comando executado em `app` (PowerShell):

```powershell
$env:NODE_ENV = "test"
node --test --test-reporter=spec tests/adminEventSetup.test.cjs tests/adminRealEvents.test.cjs tests/adminEventSettings.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Resultado: **103 testes, 103 aprovados, 0 reprovados, 0 ignorados**, exit code **0**. Os seis arquivos foram executados. A contagem é a informada pelo runner.

### Cobertura do cabeçalho e navegação

- Home: assertion estrutural confere ação de logout antes do logo ArenaGO com `resizeMode="contain"`; a integração de restauração confirma logout real, remoção do token e retorno à área pública.
- Telas internas: teste estrutural verifica que retorno precede o logo e que não há logout. A integração verifica destino Home da listagem, destino da lista no painel, retorno das áreas informativas, navegação das abas Histórico/BI e ausência de logout nessas telas.
- Informações e horários: integração edita o nome, tenta retornar, confirma que aparece o diálogo de alterações não salvas, permanece na edição e depois descarta explicitamente. Os testes ADMIN-03 mantêm cobertura dos campos, programação, QR Code e gravação.
- Wizard: integração confirma retorno da etapa 1 à Home ou listagem conforme a origem, percorre as etapas 2–5 pelos controles de cabeçalho, chega ao resultado e retorna ao Painel Individual. A quantidade de POST permanece em um. A tela final mantém ação para abrir o painel pelo UUID.
- Sessão e operações pendentes: integrações cobrem logout e troca de conta durante POST, sem reapresentar o evento. O teste de intenção de estação confirma saída, retomada no mesmo evento, mesma chave/corpo no retry explícito e nenhum retry causado pelo retorno.
- Os testes incluídos também exercitam busca, filtros, paginação, detalhe, readiness, horários e QR Code.

As assertions verificam ordem dos elementos na árvore e `resizeMode`, não posição em pixels nem layout real. A conferência visual em aparelho, fontes ampliadas e telas pequenas permanece necessária. O conjunto de mocks também não valida backend ou comportamento transacional em PostgreSQL.

### Avisos e verificações estáticas

O runner emitiu avisos de depreciação de `react-test-renderer` e sobre stubs de rotas de autenticação chamados `default`; não houve falhas associadas. A busca por `.only` nos seis arquivos terminou com exit 1 por não encontrar correspondências.

| Comando | Resultado |
| --- | --- |
| `git diff --check` | Exit 0. |
| `git status --short` | Exit 0; 14 arquivos rastreados modificados e oito novos, incluindo este relatório não rastreado. |
| `git diff --cached --exit-code` | Exit 0; índice vazio. |

Não houve alterações de código durante a campanha. O resultado anterior de 103 testes também foi preservado como histórico da versão anterior ao cabeçalho. Estado final: branch e HEAD inalterados, alterações locais preservadas, sem staging e sem `qa-evidence/ADMIN_05-changes.diff`. A campanha frontend passou; a aprovação permanece pendente da homologação visual em aparelho e revisão do responsável.

## Fechamento e homologação final da ADMIN-05

O responsável declarou a ADMIN-05 aprovada para fechamento e informou homologação funcional real e homologação visual final. Essa confirmação inclui criação do evento, cadastro de experiências e estações, concessões Staff, prontidão e tela final. O wizard usa os contratos administrativos descritos em **Contratos utilizados**: cria o evento somente após confirmação da etapa 2, adota o UUID retornado para todas as operações seguintes e consulta detalhe, estrutura e prontidão oficiais.

As correções pós-auditoria vinculam a criação à confirmação atual da etapa 2, verificam a janela de término, mantêm o UUID para fases `closing`/`closed`, protegem a confirmação de saída durante transições, reconciliam comprovante Staff revogado e preservam chave e corpo das intenções incertas de experiência/estação para retomada e retry explícito dentro da sessão. O cabeçalho compartilhado agora mostra logout à esquerda na Home e retorno contextual à esquerda nas demais rotas ativas, com o logo oficial à direita. O botão inferior duplicado do wizard foi removido.

A campanha final de frontend com Luna Medium executou os seis arquivos listados na seção anterior: **103 aprovados, 0 falhos, 0 ignorados, exit code 0**. Os testes usam mocks locais e cobrem regressões de navegação e sessão. `git diff --check` passou; a busca por `.only` não encontrou ocorrências; `git diff --cached --exit-code` confirmou índice sem staged. Não foi executado teste transacional PostgreSQL nesta task.

Limitações aceitas e escopo reservado:

- A recuperação de intenções de estrutura depende da memória da pilha/sessão e não sobrevive ao encerramento do processo ou à troca de identidade.
- A API disponível não oferece listagem nominal completa de Staff; esse gerenciamento fica para ADMIN-06.
- A campanha automatizada usou mocks, sem comprovar transações PostgreSQL reais.
- O catálogo global fica reservado para ADMIN-08.

### Inventário final em relação ao commit-base

Base: `ae4815fd62237b746ceb2987e10ff37b1e21b50d`. O inventário abaixo inclui 14 arquivos rastreados modificados e oito arquivos novos, totalizando **22 arquivos**. O logo `app/assets/images/logo-arenago.png` já existe inalterado no commit-base e, portanto, não é uma diferença da task.

| Arquivo | Estado | Finalidade |
| --- | --- | --- |
| `app/screens/admin/AdminDemoNavigator.js` | Modificado | Registra rotas Admin ativas, provedor das intenções e navegação isolada por identidade. |
| `app/screens/admin/AdminEventSettingsScreen.js` | Modificado | Tela ADMIN-03 de nome, programação e QR Code, integrada ao cabeçalho compartilhado. |
| `app/screens/admin/AdminHomeScreen.js` | Modificado | Home Admin, ações de eventos e entrada contextual no wizard. |
| `app/screens/admin/AdminPendingScreen.js` | Modificado | Placeholders de Histórico/BI com retorno à Home. |
| `app/screens/admin/AdminRealEventScreen.js` | Modificado | Painel individual e acesso por UUID, incluindo retomada de configuração. |
| `app/screens/admin/AdminRealEventsScreen.js` | Modificado | Listagem, busca, filtros, paginação, retorno à Home e entrada no wizard. |
| `app/screens/admin/AdminEventSetupScreen.js` | Novo | Wizard, confirmações, revisão, saída e resultado da criação. |
| `app/screens/admin/adminCreationFlow.js` | Novo | Estado, leituras, escrita, idempotência e isolamento do fluxo. |
| `app/screens/admin/adminCreationForm.js` | Novo | Validação do formulário, código e programação. |
| `app/screens/admin/adminSetupIntents.js` | Novo | Contexto em memória para intenções recuperáveis por sessão/evento. |
| `app/screens/admin/adminEventManagement.js` | Modificado | Áreas administrativas associadas ao painel do evento. |
| `app/screens/admin/components/AdminLiveScreen.js` | Modificado | Cabeçalho Admin compartilhado, logo, logout/retorno e layout. |
| `app/screens/admin/components/AdminLiveUI.js` | Modificado | Componentes e ações visuais reutilizados nas telas Admin. |
| `app/screens/admin/components/AdminScheduleFields.js` | Modificado | Seletores de data e horário reutilizados pela configuração. |
| `app/screens/admin/components/AdminSetupSteps.js` | Novo | Conteúdo visual das cinco etapas e revisão do wizard. |
| `app/services/adminEventSetupService.js` | Novo | Contratos de criação, estrutura e Staff do wizard. |
| `app/services/adminEventsService.js` | Modificado | Consultas e serviços administrativos de eventos. |
| `app/tests/adminEventSetup.test.cjs` | Novo | Validações, contratos, idempotência e controle do wizard. |
| `app/tests/adminNavigation.test.cjs` | Modificado | Estrutura e destinos registrados do navegador Admin. |
| `app/tests/adminRealEvents.test.cjs` | Modificado | Listagem, painel, cabeçalho e navegação Admin. |
| `app/tests/roleRoutingIntegration.test.cjs` | Modificado | Integração de autenticação, sessão, navegação e wizard. |
| `docs/ADMIN_05_IMPLEMENTACAO.md` | Novo | Relatório, auditorias, campanhas, homologação e fechamento da task. |

O patch definitivo será gravado em `qa-evidence/ADMIN_05-changes.diff` e validado contra o commit-base sem alterar o índice Git real. Branch final `feature/admin-event-operations`; HEAD/base `ae4815fd62237b746ceb2987e10ff37b1e21b50d`.

### Changes definitivo e validação

O changes final está em `qa-evidence/ADMIN_05-changes.diff`. Contém os 22 caminhos do inventário, sem se incluir. O logo não aparece no patch: já está rastreado e inalterado na base. Não há diferenças binárias da task. A varredura de padrões de credenciais apontou somente valores literais genéricos (`password` e `ficticia`) usados pelas fixtures de teste; não identificou credenciais de ambiente.

O patch foi criado a partir de índice e repositório temporários, pois o diretório `.git/objects` do checkout não permite escrita. Nenhum comando modificou o índice Git real. A verificação reversa (`git apply --reverse --check`) passou no working tree atual; a aplicação encaminhada foi verificada no índice isolado inicializado na base. `git apply --stat` reconheceu 22 arquivos, 1.754 inserções e 62 remoções. `git diff --check` terminou com exit 0; o relatório novo também foi inspecionado quanto a whitespace final. O inventário do patch corresponde aos 14 arquivos rastreados modificados e oito arquivos novos listados acima. A task fica pronta para o commit e push manuais do responsável.
