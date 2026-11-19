# ADMIN-04 — Gestão de experiências e estações

Base exclusiva `f665f2dcbdd9ca6f462b63f4172aa769162f57ca`, branch `feature/admin-event-operations`. Árvore e índice limpos na abertura, após ADMIN-05.

## Objetivo e contratos

Abrir a gestão pelo card do Painel Individual e manter o UUID no retorno. A referência visual é “Admin - Painel Individual do Evento - Gestão de Experiências.png”, com o cabeçalho atualizado da ADMIN-05 e catálogo indisponível.

Sob `/api/v1`, ler detalhe e prontidão em `GET /admin/events/:eventId` e `/readiness`, e grupos na subrota `/experiences`. Criar e renomear experiências com POST na coleção e PATCH no recurso, usando `name` (160 caracteres Unicode). Criar e renomear estações na subcoleção da experiência com `label` (120). As quatro escritas usam Idempotency-Key. A estrutura devolve `pendingServiceSessionId`. O PATCH operacional em `/staff/events/:eventId/stations/:stationId/availability` recebe o estado desejado e retorna stationId, availability e pendingServiceSessionId, inclusive para estado já atingido. A autorização do servidor admite Admin global com segundo fator. Conflitos de histórico não impedem adicionar estação. O backend verifica encerramento e chamada pendente.

## Plano e validação

Reaproveitar adminEventSetupService, os leitores de detalhe e prontidão, a validação configurationName, o mapa da pilha verificada e AdminLiveScreen. Alterar o destino experiences em AdminEventManagementInfoScreen. Criar tela, controlador e suíte focada para leitura, escritas, reconciliação, concorrência e navegação. Preservar o wizard, o modelo de fila por experiência e as demais áreas. O escopo exclui backend, migrations, exclusão, gestão de chamadas e catálogo global. Preparar testes com transporte simulado para campanha posterior com Luna Medium e realizar inspeção estática nesta etapa.

## Implementação entregue para revisão

O card e o atalho da pendência de prontidão abrem a gestão pela rota existente `AdminEventManagementInfo`, com `area=experiences` e o UUID selecionado. “Voltar ao painel” retorna a `AdminRealEvent` com esse UUID. O painel faz sua própria leitura ao recuperar o foco. A gestão usa o cabeçalho compartilhado, a marca oficial à direita, área segura, rolagem e campos acessíveis. O catálogo aparece desabilitado como “Em breve”.

A tela identifica o evento, conta os grupos e suas estações e apresenta a prontidão oficial. O detalhe da estação usa o UUID e o vínculo com a experiência, inclusive para estações homônimas. Exibe a disponibilidade por texto e cor e indica chamadas pendentes. A criação de estação mantém a experiência selecionada. Renomear envia apenas a identificação. O controle de disponibilidade exige confirmação e explica o efeito de desativar uma estação.

| Operação | Contrato sob `/api/v1` | Dado conferido |
| --- | --- | --- |
| Identificação e prontidão | `GET /admin/events/:eventId` e `GET /admin/events/:eventId/readiness` | UUID do evento em ambos e checks oficiais de prontidão |
| Estrutura | `GET /admin/events/:eventId/experiences` | Evento, experiências, estações, vínculos, disponibilidade e UUID de chamada pendente quando presente |
| Criar ou editar experiência | `POST /admin/events/:eventId/experiences` ou `PATCH /admin/events/:eventId/experiences/:experienceId` | Corpo com `name`, resposta com UUID, nome e evento |
| Criar ou editar estação | `POST /admin/events/:eventId/experiences/:experienceId/stations` ou `PATCH /admin/events/:eventId/experiences/:experienceId/stations/:stationId` | Corpo com `label`, resposta com UUID, identificação e experiência |
| Disponibilidade | `PATCH /staff/events/:eventId/stations/:stationId/availability` | Corpo com `availability`, resposta com UUID da estação, estado desejado e chamada pendente |

### Segurança e recuperação

- A pilha Admin exige identidade verificada. O servidor revalida a sessão, o papel e o segundo fator. A gestão vincula o controlador ao cliente HTTP, à identidade, à sessão e ao evento. Respostas de consultas superadas e de telas desmontadas são descartadas. Em 401/403 a tela suprime os dados e bloqueia a escrita. Um 404 usa a mensagem genérica da consulta.
- O POST e o PATCH estruturais usam a validação de texto e a política de idempotência da ADMIN-05. Cada intenção guarda operação, UUIDs, valor normalizado e chave no mapa da sessão. Após timeout, resposta divergente ou `IDEMPOTENCY_IN_PROGRESS`, o Admin pode conferir a leitura e repetir explicitamente a mesma solicitação. Um segundo toque, refresh ou remount não inicia nova escrita. Um cadastro pendente em um dos fluxos também impede iniciar outro cadastro pelo segundo fluxo no mesmo evento.
- A gestão compara os dados confirmados pela mutação com uma leitura nova da estrutura e obtém novamente a prontidão. Um conflito entre a resposta e a leitura exibe o estado oficial. O formulário mantém o texto após uma recusa recuperável. O encerramento explícito de uma tentativa informa que o envio anterior pode ter sido salvo.
- A disponibilidade usa um PATCH de estado desejado, sem chave estrutural. Em resultado incerto, a tela consulta a estrutura e informa se o estado observado corresponde ao pedido. Uma chamada pendente conhecida impede o envio de desativação e provoca releitura. Se o servidor detectar a chamada durante a escrita, `STATION_HAS_PENDING_CALL` também provoca releitura. A gestão não chama rotas de fila, cancelamento ou conclusão de atendimento.
- `EVENT_CONFIGURATION_LOCKED` explica o bloqueio por histórico de participação, inclusive participação cancelada. O histórico restringe criar experiências e renomear recursos. Adicionar estação a uma experiência existente continua sujeito à decisão operacional do servidor. `EVENT_OPERATION_ENDED` comunica o encerramento. A fila continua compartilhada por experiência.

### Inventário

| Arquivo | Alteração |
| --- | --- |
| `app/screens/admin/AdminStructureScreen.js` | Novo. Lista, detalhe, formulários, confirmação e estados da gestão |
| `app/screens/admin/adminStructureFlow.js` | Novo. Leitura, isolamento, escritas e reconciliação |
| `app/screens/admin/AdminEventManagementInfoScreen.js` | Abre a gestão na rota existente |
| `app/screens/admin/AdminRealEventScreen.js` | Atualiza a descrição acessível do card |
| `app/screens/admin/components/AdminSelectedEvent.js` | Atualiza o atalho de prontidão para a gestão real |
| `app/services/adminEventSetupService.js` | Acrescenta as duas renomeações e o PATCH de disponibilidade. Reutiliza a leitura e os dois POSTs existentes |
| `app/screens/admin/adminCreationFlow.js` | Consulta a intenção de cadastro pendente na gestão antes de criar outra pelo wizard |
| `app/tests/adminEventStructure.test.cjs` | Nova suíte com 14 casos de leitura, validação, mutações, conflitos, idempotência e sessão |
| `app/tests/adminEventSetup.test.cjs` | Acrescenta um caso sobre a preservação da intenção entre wizard e gestão |
| `app/tests/roleRoutingIntegration.test.cjs` | Acrescenta um caso de navegação, edição, disponibilidade, grupo selecionado e prontidão no retorno |
| `docs/ADMIN_04_IMPLEMENTACAO.md` | Novo. Planejamento inicial, implementação e preparação da campanha |

### Testes preparados e verificações

Foram preparados **16 casos novos** com transporte simulado. A suíte específica cobre estrutura vazia e agrupada, vínculos inválidos, limites Unicode, payloads e chaves, dupla submissão, erros 401/403/404/409, timeout, replay explícito e remount. Exercita resultados divergentes, estações homônimas, estado já atingido, prontidão e descarte de respostas atrasadas após invalidar o contexto. Os casos nas suítes existentes percorrem o painel, o retorno pelo cabeçalho, o atalho de prontidão, o preenchimento e cancelamento de formulários e a interação com cadastros pendentes do wizard.

Nesta implementação houve **zero testes executados**. Os 103 testes aprovados pertencem à campanha anterior da ADMIN-05. A inspeção estática confrontou os DTOs, controllers e serviços de configuração e disponibilidade com os payloads do frontend. O parser Babel analisou os dez arquivos JS/CJS novos ou modificados e a resolução local verificou 56 imports ou chamadas literais a `require`, sem carregar os módulos de teste. `git diff --check` e `git diff --cached --exit-code` retornaram 0. O inventário inclui arquivos não rastreados.

Campanha proposta para **GPT-6 Luna — Medium**, após seleção manual pelo responsável. Executar a partir da raiz em PowerShell, após conferir a branch e o transporte simulado.

```powershell
Set-Location app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventStructure.test.cjs tests/adminEventSetup.test.cjs tests/adminRealEvents.test.cjs tests/adminEventSettings.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

### Limitações e próximas verificações

A recuperação de intenções dura enquanto a pilha e a identidade verificadas mantiverem o mapa em memória. Após encerramento do processo ou troca de sessão, é preciso consultar a estrutura antes de iniciar novo cadastro. A API não oferece versão condicional para estas edições. Administradores concorrentes podem alterar o recurso entre leituras. Estrutura e prontidão são consultas independentes e podem refletir instantes distintos. Um GET após timeout confirma o estado observado da disponibilidade, sem identificar qual operador o produziu.

Ficam pendentes a revisão técnica, a campanha frontend e a homologação em aparelho, especialmente teclado, rolagem, leitor de tela e retorno após editar em uma tela pequena. Esta etapa não exerceu PostgreSQL, backend real ou integrações remotas. O catálogo global fica para ADMIN-08. O changes definitivo aguarda autorização após a homologação.

### Estado Git e histórico

Branch `feature/admin-event-operations`, HEAD igual à base exclusiva registrada na abertura. Sete arquivos rastreados modificados e quatro novos. Índice sem alterações staged. Implementação inicial entregue para revisão. As correções e campanhas posteriores devem ser registradas neste documento.

## Auditoria técnica pós-implementação

**Decisão recomendada:** corrigir a recuperação de cadastros pendentes entre os fluxos e a saída com rascunho antes da campanha Luna Medium. A inspeção não identificou defeito crítico ou alto de autorização, vínculo entre eventos ou desativação com chamada pendente no caminho da ADMIN-04. Foram confirmados três defeitos moderados de frontend e uma divergência baixa na cobertura simulada.

### Defeitos confirmados

#### Moderado — Uma intenção do wizard fica inacessível durante o encerramento

- **Cenário e impacto.** Um POST de experiência ou estação no wizard termina com resposta incerta. O Admin volta ao painel e o evento passa à fase efetiva `closing` antes do prazo operacional. A gestão recusa novos cadastros por existir uma intenção do wizard. O painel já não oferece **Continuar configuração**. Mesmo se a rota do wizard estiver aberta, a visão de encerramento oculta as ações de recuperação e seu controlador rejeita o descarte. Assim, um cadastro de estação ainda permitido pelo servidor fica bloqueado na sessão, inclusive em outro grupo.
- **Evidência.** A guarda de cadastros está em `app/screens/admin/adminStructureFlow.js:146–153`. A ação de retomada em `app/screens/admin/AdminRealEventScreen.js:33–36` exclui `closing` e `closed`. `app/screens/admin/AdminEventSetupScreen.js:98–114` e `app/screens/admin/adminCreationFlow.js:223–231` impedem resolver a intenção no wizard encerrado. O servidor usa a janela operacional e o estado `closed` em `backend/src/events/admin-configuration.mutation.ts:7–20`. A fase `closing` pode começar antes dessa fronteira, conforme `backend/src/events/admin-configuration.projection.ts:21–25`.
- **Correção mínima.** Expor uma ação de recuperação da intenção existente mesmo em `closing`, com leitura e encerramento explícito da tentativa. Distinguir resolver a intenção já enviada de autorizar um novo POST. Preservar UUID, chave e corpo no caminho de replay.
- **Regressão necessária.** Simular timeout no wizard, voltar ao painel após mudança para `closing` ainda dentro do prazo, resolver a tentativa pelo caminho disponível e verificar que um cadastro permitido na gestão volta a ficar acessível. A entrada na recuperação deve fazer somente leituras.

#### Moderado — A trava entre wizard e gestão bloqueia cadastros independentes

- **Cenário e impacto.** Uma estação com resultado incerto na experiência A impede cadastrar uma estação na experiência B pelo outro fluxo. Um cadastro incerto de experiência também impede cadastrar uma estação em experiência já existente. A trava é por evento e ignora operação, experiência e corpo. Isso impede capacidade adicional legítima durante a operação. Além disso, as duas telas só exibem instruções para procurar a outra tela. Nenhuma consegue usar a intenção armazenada pela outra para retomada, replay ou encerramento explícito.
- **Evidência.** A gestão testa `intents.has(eventId)` em `app/screens/admin/adminStructureFlow.js:146–153` e recupera apenas `management:<UUID>` a partir de `:51–52,71–74,92–105`. O wizard verifica apenas o tipo do registro da gestão em `app/screens/admin/adminCreationFlow.js:146–161` e recupera o registro do próprio endereço do mapa em `:32–38`. Os formatos dos dois registros diferem. O UUID do evento delimita ambas as guardas corretamente no caminho normal, pois as duas telas recebem o UUID canônico das consultas.
- **Correção mínima.** Reaproveitar o mapa da sessão com uma representação recuperável dos POSTs a partir de ambos os fluxos. Restringir a trava de duplicidade pela intenção original, usando UUID do evento, operação, UUID da experiência quando aplicável e corpo normalizado. Manter o bloqueio de duplo envio para aquela intenção e assegurar que a confirmação ou o encerramento explícito remova somente seu registro.
- **Regressão necessária.** Fazer o POST em um fluxo, persistir no mock e perder a resposta. Reabrir o outro fluxo, conferir leitura antes de ação, nenhum POST automático e replay com URL, chave e corpo originais. Cobrir os dois sentidos, o cadastro que permanece permitido em outro grupo ou evento e a remoção da trava após reconciliação.

#### Moderado — A navegação descarta campos editados sem aviso

- **Cenário e impacto.** Após digitar um nome ou editar a identificação de uma estação, tocar **Voltar ao painel** descarta o texto local. O retorno nativo também pode remover a tela porque falta a guarda da rota. A perda ocorre inclusive após uma recusa recuperável que havia preservado o formulário.
- **Evidência.** O formulário fica em `editor`, porém o retorno chama diretamente `popTo` e só desabilita o botão durante escrita em `app/screens/admin/AdminStructureScreen.js:33–37,52–67,89–95`. A confirmação ali existente cobre disponibilidade e encerramento de tentativa em `:129–135`. O padrão para proteger a saída já existe em `app/screens/admin/AdminEventSettingsScreen.js:54–56` e `app/screens/admin/AdminEventSetupScreen.js:66–73`.
- **Correção mínima.** Aplicar `usePreventRemove` ao rascunho alterado e reaproveitar a confirmação compartilhada. Manter a edição se o usuário cancelar a saída e executar a ação de navegação original somente após confirmar o descarte. A troca real de sessão deve continuar invalidando a tela.
- **Regressão necessária.** Editar sem salvar, acionar retorno do cabeçalho e retorno nativo, cancelar a saída e confirmar que o texto ficou. Confirmar o descarte e verificar o UUID no painel e a ausência de PATCH.

#### Baixa — O mock de cadastro de estação devolve disponibilidade contrária ao backend

- **Cenário e impacto.** A integração cadastra Pista e espera que a estação nasça indisponível. O SQL cria estações disponíveis. O mock de prontidão usa somente a estação Mesa e continua pendente mesmo depois do cadastro de uma segunda estação, que no backend restabeleceria aquele requisito. Essa integração pode passar sem detectar uma regressão de prontidão após um novo cadastro.
- **Evidência.** Ver `app/tests/roleRoutingIntegration.test.cjs:633–646,696–698`, `backend/src/events/admin-configuration.mutation.ts:11–12` e `backend/src/events/admin-configuration.projection.ts:15–20`. A fixture focada também fixa o check de estação disponível em `true` mesmo com lista vazia ou estações indisponíveis em `app/tests/adminEventStructure.test.cjs:55–60`.
- **Correção mínima e regressão.** Fazer a estação nascer disponível no mock e derivar o check e os códigos de pendência das estações de todos os grupos. Assertar que desativar a última estação produz pendência e cadastrar a nova estação recupera o requisito na tela e no painel.

### Contratos e controles verificados por inspeção

- **Disponibilidade.** `station-availability.controller.ts:9–19,22–42` exige sessão, valida UUIDs e corpo `{availability}`, devolve o estado e mapeia conflitos a 409. `station-availability.service.ts:16–51` vincula evento, experiência e estação, permite Admin global com segundo fator e bloqueia conta inativa e sessão revogada ou expirada. O caminho mutável reavalia o prazo e atualiza somente a estação e a auditoria em `:53–87`. Uma solicitação do estado já vigente pode responder 200 após o encerramento, sem escrita. Na concorrência com uma chamada, `call-next.service.ts:66–74,96–104,129` e disponibilidade adquirem locks em ordem de evento, experiência e estação. Se a chamada estiver pendente, a desativação retorna 409. Se a desativação ganhar primeiro, a chamada posterior vê a estação indisponível. A operação de disponibilidade não resolve nem cancela chamadas.
- **Frontend da disponibilidade.** `AdminStructureScreen.js:96–104,129–135` abre o detalhe pelos IDs e exige confirmação para desativar. `adminStructureFlow.js:146–178` confere o recorte exibido, o alvo, o estado original e a pendência conhecida. Em 409, o controlador comunica a recusa e relê a estrutura. Em timeout, relê e apresenta o estado observado sem atribuir autoria ou repetir PATCH. O transporte envia somente o estado desejado e desativa retry de escrita, sem cabeçalho de idempotência estrutural. Ver `adminEventSetupService.js:79–87` e `adminStructureFlow.js:39–46,92–111,115–139`.
- **Experiências e estações.** Os clientes enviam `name` ou `label` no POST/PATCH correspondente e conferem UUID, vínculo e valor na resposta. O formulário reutiliza a validação por caracteres Unicode com limites 160 e 120. Uma recusa recuperável mantém o formulário. A gestão reserva chave e corpo antes do envio, faz replay explícito e compara a resposta aceita com uma nova leitura. O backend limita cada operação ao evento e ao recurso esperados, serializa a configuração no evento e usa fingerprint, reserva e conclusão na transação. O histórico inclui qualquer participação do evento, inclusive cancelada. Criar estação permanece isento do bloqueio por histórico. Renomear estação só escreve `label`, e a fila segue pertencendo à experiência. Ver `adminCreationForm.js:3–10`, `adminEventSetupService.js:18–54,63–77`, `admin-configuration.dto.ts:8–15,35–40`, `admin-configuration.controller.ts:39–55`, `admin-configuration.service.ts:16–18,35–57,73–98` e `admin-configuration.mutation.ts:7–21`.
- **Identidade e leitura.** `app/context/adminAccess.js:3–12` exige papel global e identidade verificada para a área, e `AdminDemoNavigator.js:30–41` escopa o mapa ao dono e ao cliente HTTP. `AdminStructureScreen.js:21–45` também vincula o controlador ao evento. `adminStructureFlow.js:55–83,108–111,128–137,144–147` invalida publicações antigas por geração e escopo. Durante uma leitura, a gestão não oferece escrita. Uma leitura anterior que termina depois de uma leitura mais nova ou de uma escrita não pode repor aquele estado. Em 401/403, os dados são limpos e as ações bloqueadas. As leituras e escritas estruturais revalidam papel, sessão e segundo fator no servidor. A autorização Staff para a rota operacional não dá acesso ao gerenciamento Admin.
- **Navegação e prontidão.** Card e checklist abrem a mesma área usando `event.id`. O cabeçalho e a volta ao mesmo painel usam o padrão compartilhado. Ao recuperar foco, o painel consulta detalhe e prontidão de novo. A gestão deriva somente os totais da coleção e lê a prontidão oficial. Estações homônimas são selecionadas por UUID. Os caminhos de horários, Staff, Operação e BI conservam seus destinos. Ver `AdminEventManagementInfoScreen.js:11–15`, `AdminRealEventScreen.js:15–26,42–47`, `components/AdminSelectedEvent.js:33–39`, `AdminStructureScreen.js:47–52,65–76,111–126`, `components/AdminLiveScreen.js:23–29` e `useAdminEventPanel.js:18–55`.

### Riscos residuais, limites e melhorias

- **Risco plausível.** Um GET após timeout pode observar o estado anterior antes do commit da solicitação original. A interface libera nova ação explícita após a leitura. O backend serializa mudanças, mas um estado observado é pontual e pode mudar depois dele. Priorizar a indicação de resultado indeterminado quando o estado divergir após timeout, com opção de nova leitura. Ver `adminStructureFlow.js:92–101,120–138`.
- **Risco plausível.** O valor original da edição é comparado com a última leitura da interface, sem precondição no PATCH. Um segundo Admin pode mudar o recurso entre a leitura e o envio. O servidor ainda aplica autorização, vínculos e locks, mas a escrita válida posterior pode prevalecer. Uma leitura mais recente reduz a janela. Uma precondição real exigiria contrato adicional.
- **Limitações aceitas.** Estrutura, detalhe e prontidão são consultas independentes. A tela usa a prontidão oficial e não pode garantir o mesmo instante de observação do conjunto. A recuperação de intenções termina ao descartar a sessão ou o processo. Depois disso, um cadastro incerto precisa ser conferido nos dados do evento. O catálogo global e a homologação visual ficam fora desta auditoria.
- **Melhoria opcional.** Usar as respostas mínimas de conflito da disponibilidade para contextualizar o aviso enquanto a nova leitura está em andamento. A leitura oficial deve continuar decidindo o estado exibido.

### Cobertura preparada e lacunas

Os 14 casos de `app/tests/adminEventStructure.test.cjs` inspecionados verificam os caminhos simulados de rota, payload, IDs, Unicode, dupla submissão, timeout, chave e corpo do replay, histórico, criação no grupo, estação homônima, 409, sessão e reconsulta. O caso em `app/tests/adminEventSetup.test.cjs:69–81` e o caso em `app/tests/adminEventStructure.test.cjs:340–350` preenchem o mapa manualmente e verificam a trava. Isso não exercita a recuperação cruzada. A integração em `app/tests/roleRoutingIntegration.test.cjs:619–707` cobre navegação, cancelamento explícito, disponibilidade, grupo selecionado e prontidão ao voltar. Como depende de `qa/regression`, a campanha deve conferir que ela foi efetivamente executada.

Além dos casos vinculados aos achados, os acréscimos mínimos recomendados são um caso com duas leituras sobrepostas no mesmo controlador, seguido da escrita que confirma o estado mais recente antes da primeira leitura terminar, e um caso de integração com troca de sessão durante o PATCH, mantendo o mesmo cliente HTTP. O teste existente de sessão em `adminEventStructure.test.cjs:315–337` usa uma flag injetada e uma segunda fixture independente. Ele verifica a barreira local, mas não a substituição real do mapa pela pilha. O mock de 409 em `:221–239` verifica a reação do frontend, sem reproduzir a concorrência do PostgreSQL. Já existem casos backend preparados de locks concorrentes, TOTP e isolamento por evento em `backend/test/integration/station-availability-http.integration.test.ts:191–225,303–312,368–393` e de configuração em `backend/test/integration/admin-configuration.integration.test.ts`. Sua existência foi identificada por leitura.

### Escopo e estado da auditoria

Foram examinados os dez arquivos JS/CJS da ADMIN-04 e este relatório, incluindo os quatro arquivos novos, contra a base exclusiva. A leitura também abrangeu o relatório da ADMIN-05, a pilha Admin, as guardas de identidade, o cliente HTTP, a tela e o controlador de retomada, o cabeçalho compartilhado, a reconsulta do painel, DTOs, controllers, SQL de configuração, autorização, idempotência, disponibilidade e criação de chamadas, além dos testes backend citados.

Auditoria exclusivamente estática. Zero testes executados e zero acessos a PostgreSQL ou Neon. Apenas este relatório foi atualizado. `git diff --check` passou. A branch e o HEAD continuam registrados acima, com sete arquivos rastreados modificados, quatro novos e índice vazio. O changes definitivo segue pendente do fechamento.

## Correções pós-auditoria — ADMIN-04

A rodada parte da base `f665f2dcbdd9ca6f462b63f4172aa769162f57ca`, com as alterações da implementação e da auditoria preservadas. O diagnóstico confirmou a retomada oculta em `closing`, a trava por evento, a saída desprotegida com rascunho e a disponibilidade inicial incorreta no mock. A solução usa o mapa da pilha Admin para compartilhar registros identificados por operação e destino, expõe a recuperação no painel e protege a remoção da rota com confirmação de descarte. A campanha automatizada fica para Luna Medium.

### Correções e riscos residuais

| Achado | Correção aplicada | Teste preparado e risco residual |
| --- | --- | --- |
| Recuperação oculta em `closing` | O painel e o wizard oferecem **Revisar operações pendentes de experiências e estações** somente para registros do evento na sessão. Ambos abrem a gestão pelo UUID. Quando acionado pelo wizard, o retorno leva à configuração. Em `closing`, a gestão consulta a estrutura e permite retry explícito com a chave original. O servidor continua aplicando prazo e histórico. Uma recusa `EVENT_OPERATION_ENDED` ao repetir preserva a primeira tentativa incerta. Em `closed`, a gestão oferece consulta e encerramento local, com as escritas desabilitadas. | A integração percorre uma tentativa incerta no wizard, prontidão oficial positiva, `closing`, consulta, retry com mesma chave e corpo recusado após o prazo e encerramento local em `closed`. A consulta pode precisar ser repetida se o backend estiver indisponível. |
| Bloqueio por evento | `adminStructureIntents.js` usa o mapa existente da pilha Admin. O registro inclui evento, operação, destino por UUID, valor normalizado, chave e estado da tentativa. O valor serve para reconhecer um envio equivalente ao mesmo destino, e a confirmação do recurso usa UUID. A trava inclui envios simultâneos da mesma intenção, renomeações conflitantes do mesmo alvo e disponibilidade pendente da mesma estação. Cadastros independentes usam chaves distintas. Uma leitura oficial após a última tentativa habilita a recuperação. O wizard consegue repetir POSTs iniciados na gestão. Sua ação de revisão também abre a gestão para renomeações e demais operações pendentes. | Casos focados cobrem homônimos em experiências diferentes, duas instâncias tentando o mesmo retry, limpeza seletiva, remount e isolamento por UUID. Integrações cobrem os dois sentidos e troca de sessão. O encerramento local informa que o servidor pode ter salvado a operação. |
| Rascunho perdido ao sair | A gestão usa `usePreventRemove` para proteger a remoção da rota após mudança efetiva no campo. **Continuar editando** preserva o valor e **Descartar alterações** executa a ação de navegação original. Uma escrita em curso bloqueia a remoção até a reconsulta. Depois de resultado incerto, a recuperação se dá pelo cartão da intenção, separado do formulário. | A integração cobre formulário vazio, retorno do cabeçalho, ação de retorno com plataforma Android simulada, remoção programática, cancelamento, descarte, GET tardio e retorno após salvar. O botão físico e os gestos no aparelho ficam para homologação. |
| Mock de estação incompatível com o backend | O transporte simulado cria estações disponíveis no grupo correto. O check de capacidade considera todas as estações de todos os grupos. A prontidão depende também de Staff elegível. | O caso de roteamento confere estado disponível após cadastro, prontidão quando os requisitos são satisfeitos, pendência sem Staff e pendência após desativar a última estação disponível. |

### Concorrência e limites preservados

A recuperação usa o mapa em memória delimitado por identidade verificada e cliente HTTP. Em cada tela, a leitura guarda apenas a versão da tentativa observada. O controlador rejeita retry e descarte antes de uma leitura válida dessa versão. Alterar conta, sessão ou UUID invalida a publicação antiga. Quando a gestão encontra uma escrita ainda em voo, pode consultar a estrutura e reler após a conclusão da escrita. Nenhuma dessas leituras reenvia a mutação.

O PATCH de disponibilidade usa o estado desejado, sem chave estrutural, e relê a API após timeout. A reconsulta pode anteceder o commit da solicitação anterior e informa apenas o estado observado. Permanecem a recuperação limitada à memória da sessão, a ausência de consulta por chave e de versão condicional, as consultas em snapshots independentes e o catálogo global reservado para ADMIN-08. O servidor mantém os contratos e as regras de encerramento existentes.

### Inventário atualizado contra a base

| Arquivo | Situação |
| --- | --- |
| `app/screens/admin/AdminEventManagementInfoScreen.js` | Modificado. Entrada da gestão e retorno à origem quando aberta pelo wizard. |
| `app/screens/admin/AdminEventSetupScreen.js` | Modificado. Atalho de recuperação, escrita independente e controles condicionados à leitura da intenção. |
| `app/screens/admin/AdminRealEventScreen.js` | Modificado. Atalho de recuperação no painel por UUID. |
| `app/screens/admin/adminCreationFlow.js` | Modificado. Wizard usa os mesmos registros, transporte e critérios de recuperação da gestão. |
| `app/screens/admin/components/AdminSelectedEvent.js` | Modificado na implementação inicial. Atalho de prontidão. |
| `app/services/adminEventSetupService.js` | Modificado na implementação inicial. Renomeações e disponibilidade. |
| `app/tests/adminEventSetup.test.cjs` | Modificado. Verifica retry com a chave da gestão e conserva as assertions de duplicidade da mesma intenção. |
| `app/tests/roleRoutingIntegration.test.cjs` | Modificado. Mock de prontidão e cinco casos de integração adicionais. |
| `app/screens/admin/AdminStructureScreen.js` | Novo. Gestão, recuperação por registro e proteção da saída. |
| `app/screens/admin/adminStructureFlow.js` | Novo. Consulta, concorrência, reconciliação e publicação vinculada ao contexto. |
| `app/screens/admin/adminStructureIntents.js` | Novo. Identificação, envio compartilhado e recuperação de operações. |
| `app/tests/adminEventStructure.test.cjs` | Novo. Dezessete casos focados, três a mais que na versão inicial. |
| `docs/ADMIN_04_IMPLEMENTACAO.md` | Novo em relação à base. Preserva implementação, auditoria e esta rodada. |

### Verificações e campanha

Oito casos foram acrescentados e os dezesseis casos iniciais foram preservados, com as expectativas ajustadas para a identidade da operação. Os cenários de leitura atrasada cobrem GET sobreposto à mutação e troca de UUID no mesmo cliente e mapa. Os de sessão cobrem logout e troca de conta durante PATCH mantendo a mesma instância HTTP, com verificação de que o callback anterior e as intenções anteriores não reaparecem.

A inspeção estática confrontou o frontend com o SQL de configuração e o contrato de disponibilidade. O parser Babel analisou os 12 arquivos JS/CJS e verificou a resolução local de 76 imports ou chamadas literais a `require`. `git diff --check` e `git diff --cached --exit-code` passaram. Os testes e builds ficaram pendentes nesta rodada. A próxima campanha usa o comando com as sete suítes da seção **Testes preparados e verificações**, em Luna Medium. A integração de roteamento depende dos pacotes de `qa/regression`, e a campanha deve conferir a contagem de ignorados.

Branch `feature/admin-event-operations`, HEAD `f665f2dcbdd9ca6f462b63f4172aa769162f57ca`. Oito arquivos rastreados modificados e cinco novos. Índice vazio. A geração do changes definitivo permanece para o fechamento, após validação e homologação.

## Campanha de validação pós-correções — Luna Medium

### Preparação e comando

A campanha foi executada após seleção manual de **GPT-6 Luna — Medium** pelo responsável. Antes da execução, foram lidos `AGENTS.md` e este relatório, conferidos o branch, o HEAD, o working tree e o índice. `app/package.json` define o script padrão como `node --test`; `qa/regression/package.json` descreve seus testes como isolados, sem conexões a banco ou alterações de produção. As sete suítes usam transporte e armazenamento simulados. O harness `qa/regression` estava presente e suas dependências React, React Test Renderer e React Navigation puderam ser carregadas; a integração não foi ignorada.

Comando executado, em PowerShell, no diretório `app`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventStructure.test.cjs tests/adminEventSetup.test.cjs tests/adminRealEvents.test.cjs tests/adminEventSettings.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

**Resultado:** 127 testes no total, 120 aprovados, 7 reprovados, 0 ignorados, 0 cancelados; exit code **1**. O runner iniciou e executou os casos das sete suítes. As integrações de roteamento, incluindo casos ADMIN-04 e ADMIN-05, efetivamente rodaram. Nenhum acesso a PostgreSQL, Neon ou serviço externo foi realizado.

### Falhas observadas e diagnóstico

| Teste | Arquivo e linha | Evidência | Diagnóstico |
| --- | --- | --- | --- |
| `painel consulta detalhe e prontidão pelo UUID, exibe dados oficiais e trata recurso inacessível` | `app/tests/adminRealEvents.test.cjs:159` | `TypeError: store.values is not a function or its return value is not iterable`; stack em `adminStructureIntents.js:27`, `AdminRealEventScreen.js:42`, `questionnaireHarness.cjs:425,447,471`. | Incompatibilidade confirmada no harness do teste isolado: `AdminSetupIntents` tem valor padrão `null`, mas `questionnaireHarness.useContext` usa `contextObj?._defaultValue ?? authContextValue`; assim, substitui o `null` pelo objeto de autenticação, que não é um `Map`. A tela real é montada pela pilha `AdminDemoNavigator`, que fornece o mapa por `AdminSetupIntents.Provider`. O teste precisa fornecer esse contexto ou o harness precisa preservar corretamente o valor padrão. A campanha não comprovou falha funcional no fluxo roteado da aplicação. |
| `prontidão dedicada substitui snapshot antigo e orienta pendências conhecidas e desconhecidas` | `app/tests/adminRealEvents.test.cjs:212` | Mesmo `TypeError` e stack acima. | Mesma causa confirmada: harness/contexto ausente no teste isolado. |
| `falha parcial não inventa prontidão e retry agrupa toques repetidos` | `app/tests/adminRealEvents.test.cjs:232` | Mesmo `TypeError` e stack acima. | Mesma causa confirmada: harness/contexto ausente no teste isolado. |
| `403 ou 404 na prontidão removem inclusive detalhe válido após atualizar` | `app/tests/adminRealEvents.test.cjs:262` | Mesmo `TypeError` e stack acima. | Mesma causa confirmada: harness/contexto ausente no teste isolado. |
| `recuperar foco consulta novamente e uma resposta anterior não sobrescreve a fase` | `app/tests/adminRealEvents.test.cjs:298` | Mesmo `TypeError` e stack acima. | Mesma causa confirmada: harness/contexto ausente no teste isolado. |
| `ADMIN-04: PATCH tardio no mesmo cliente após logout` | `app/tests/roleRoutingIntegration.test.cjs:901` (assertion em `:921`) | `AssertionError [ERR_ASSERTION]`: esperado `undefined`, recebido `[Function: back]`, na expressão `assert.equal(app.handler('Voltar ao painel'), undefined)`. | A assertion consulta somente `onPress`; o helper `handler` ignora o estado `disabled`. Durante a operação, `AdminStructureScreen` passa `backDisabled={state.busy}` e `AdminLiveScreen` renderiza `disabled={backDisabled}` embora o callback continue presente. O teste deve verificar `disabled`/`accessibilityState` ou comprovar que a ação não navega, em vez de exigir callback ausente. Causa confirmada como assertion/helper incompatível com a API do botão; este caso não chegou às assertions posteriores da resposta tardia/logout. |
| `ADMIN-04: PATCH tardio no mesmo cliente após troca de conta` | `app/tests/roleRoutingIntegration.test.cjs:901` (assertion em `:921`) | Mesmo `AssertionError`, esperado `undefined`, recebido `[Function: back]`. | Mesma causa confirmada. A execução interrompeu antes de concluir as verificações posteriores de troca de conta e resposta tardia; essas assertions permanecem não validadas por este caso. |

As cinco falhas standalone não chegaram às assertions próprias do painel (conteúdo, prontidão, retry, UUID ou resposta atrasada), pois ocorreram durante o render inicial. As duas falhas de integração confirmaram uma escrita PATCH em voo antes da assertion; porém, por terem parado nessa linha, o processamento final do callback depois de logout/troca de conta não foi validado nesses casos. Não foram feitas alterações de código, testes ou expectativas nesta campanha.

### Correções pós-auditoria e regressões exercitadas

- **Recuperação em `closing`/`closed`:** o teste `ADMIN-04: recuperação do wizard no painel pronto em closing, recusa do replay e consulta em closed` passou. A suite verificou a tentativa incerta, acesso explícito à gestão, consulta e replay com a intenção existente, resposta `EVENT_OPERATION_ENDED` e encerramento local em `closed`.
- **Operações independentes e idempotência local:** passaram os casos focados `gestão recupera a estação do wizard e permite cadastro independente e homônimo em outra experiência`, `duas instâncias compartilham o envio em voo e um descarte atrasado não remove outra operação` e `GET antigo termina depois da escrita e da releitura sem restaurar a disponibilidade anterior`, além dos casos de UUID e recuperação. Eles exercitaram mesma intenção em voo, cadastro independente em outra experiência, homônimos por UUID e descarte seletivo.
- **Recuperação wizard ↔ gestão:** passaram o caso de recuperação da estação do wizard e o caso integrado de retomada da intenção em `closing`; a troca de fluxo não deve fazer retry automático. Cobertura de callbacks que chegam após troca real de sessão foi preparada, mas os dois testes de integração correspondentes ficaram interrompidos na assertion do botão descrita acima.
- **Proteção de rascunho:** passou `ADMIN-04: edição vazia, rascunho, cancelamento e descarte não enviam PATCH`, com retorno, cancelamento, descarte, GET tardio e retorno após salvar conforme os caminhos simulados. Botão físico e gestos Android continuam exigindo homologação em aparelho.
- **Disponibilidade e prontidão:** passaram os casos focados sobre estado desejado, estado no-op, chamada pendente, timeout sem retry e leitura oficial; a integração também passou pela criação de estação disponível, contagem e prontidão com/sem Staff elegível e pendência após desativar a última estação disponível.
- **Regressões ADMIN-01/02/03/05:** busca, filtros, paginação, navegação e acesso por UUID, dados/horários/QR, autenticação/TOTP, criação em cinco etapas, concessões Staff, prontidão, erros, retry e isolamento ordinário de sessão passaram nos testes executados, exceto os cinco testes standalone listados e a cobertura final dos dois cenários PATCH tardios. Casos das ADMIN-01, ADMIN-02 e ADMIN-03 nestas sete suítes também incluem os cinco testes de painel que não chegaram às assertions por causa do contexto ausente.

Warnings relevantes: o React Test Renderer informa que está obsoleto; o roteamento simulado também emite avisos de que componentes default de telas `Welcome`, `Login`, `Register`, `Cadastro`, `ForgotPassword` e `EsqueciSenha` não começam com letra maiúscula. São avisos do ambiente/mock, não reprovações adicionais.

### Verificações estáticas, limitações e estado

`git diff --check`: exit 0. `git diff --cached --exit-code`: exit 0, confirmando índice sem alterações staged. Branch `feature/admin-event-operations` e HEAD `f665f2dcbdd9ca6f462b63f4172aa769162f57ca` foram preservados. O relatório registra as falhas da execução; nenhum código ou teste foi modificado. O working tree mantém as oito alterações rastreadas e cinco arquivos novos preexistentes da ADMIN-04.

Esta campanha não exerceu PostgreSQL real, backend, Neon, migrations, seeds, dispositivo físico ou gestos de navegação reais. Como houve falhas, a ADMIN-04 **não está aprovada pela campanha automatizada**. Recomenda-se corrigir os fixtures/contexto dos cinco testes do painel e as assertions de estado disabled dos dois testes integrados, então executar nova campanha Luna Medium. A revisão de código deve avaliar se a falha do harness afeta somente renderizações isoladas; não há, nesta execução, evidência de que a pilha real deixe de fornecer o contexto. Não gerar changes nesta etapa.

## Correção dos testes após a primeira campanha Luna Medium

O resultado histórico permanece 120 aprovados, 7 reprovados e 0 ignorados em 127 testes, exit 1. As cinco falhas do painel decorreram da substituição indevida do valor padrão `null` do contexto pelo objeto de autenticação no harness. `app/tests/helpers/questionnaireHarness.cjs` agora preserva o valor padrão explícito dos contextos, mantendo o tratamento próprio do contexto de autenticação. As assertions dos cinco testes em `adminRealEvents.test.cjs` foram preservadas.

Os dois testes de PATCH tardio em `app/tests/roleRoutingIntegration.test.cjs` verificam a presença do botão, `disabled` e o estado de acessibilidade, e simulam ativação respeitando a semântica do Pressable desabilitado, conferindo que a rota permanece. As verificações posteriores de logout, troca de conta, resposta antiga, cliente e intenções continuam presentes. Um caso adicional preparado verifica a habilitação e navegação após o PATCH terminar na mesma sessão. Os arquivos alterados nesta rodada são o harness, a suíte de integração e este relatório; nenhum código de produção foi alterado.

Inspeção estática: o parser Babel analisou o harness e as duas suítes envolvidas, sem erro. Foram inspecionados o contexto, o provider real, as propriedades do botão e as assertions finais. Não foi identificada evidência de defeito funcional de produção nesta análise. Não foram executados testes nesta rodada; a execução das sete suítes com Luna Medium continua pendente, inclusive para confirmar que os testes corrigidos avançam até o final. Homologação em aparelho e aprovação formal permanecem pendentes.

## Segunda campanha Luna Medium e correção do teste da Home

A segunda campanha executou as sete suítes: 128 testes, 127 aprovados, 1 falho, 0 ignorados, exit 1. Os cinco testes de painel anteriormente falhos, os dois testes de PATCH tardio e o novo teste de reabilitação passaram. A falha restante foi `Home oferece navegação explícita, sem contadores ou formulários demo`: `assert.equal(exits, 1)` observou `0 !== 1` antes da assertion de navegação para BI. A homologação funcional e visual no Expo foi informada como aprovada pelo responsável.

A inspeção confirmou que o cabeçalho importa `../../../context/AuthContext`, enquanto o harness interceptava apenas imports de um ou dois níveis. Assim, carregava um contexto distinto com valor padrão nulo, `useAuth()` não recebia a identidade simulada e a guarda de logout não chamava o callback. O cabeçalho e sua guarda são iguais à base ADMIN-05. A correção em `app/tests/helpers/questionnaireHarness.cjs` identifica o módulo pelo caminho absoluto normalizado, fornece a autenticação simulada em qualquer profundidade e preserva os valores padrão dos demais contextos, incluindo `AdminSetupIntents` nulo. Contextos desconhecidos não recebem autenticação automaticamente.

As assertions existentes de logout único e navegação para BI foram preservadas, bem como as dos cinco testes do painel e dos três casos de PATCH. Os arquivos modificados nesta rodada foram o harness e este relatório. A inspeção estática conferiu o import, a guarda e as assertions; a execução do callback e de todas as assertions deve ser confirmada na próxima campanha. Nenhum teste ou build foi executado nesta rodada. Repetir as sete suítes com Luna Medium; a ADMIN-04 continua aguardando validação automatizada e aprovação formal.

## Terceira campanha de validação — Luna Medium

### Comando e resultado

Executado em PowerShell a partir do diretório `app`, com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventStructure.test.cjs tests/adminEventSetup.test.cjs tests/adminRealEvents.test.cjs tests/adminEventSettings.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Resultado: **128 testes, 128 aprovados, 0 falhos, 0 ignorados, 0 cancelados; exit code 0**. As sete suítes foram incluídas. O harness `qa/regression` e suas dependências estavam instalados, portanto os testes integrados de roteamento foram executados, sem skip ambiental.

### Conferências

- **Home Admin:** `Home oferece navegação explícita, sem contadores ou formulários demo` passou integralmente, cobrindo logo, botão de logout, logout chamado uma vez, navegação para BI, catálogo indisponível e ausência de formulários demonstrativos.
- **Contextos:** os testes isolados do Painel Individual passaram, incluindo consulta pelo UUID, prontidão e pendências, falha parcial e retry, respostas 403/404 e atualização ao recuperar foco. A integração fornece o provider de intenções da pilha Admin separadamente do `AuthContext`.
- **ADMIN-04:** passaram os cenários de PATCH tardio após logout e troca de conta, com botão Voltar desabilitado durante a escrita e verificações de resposta antiga e isolamento de intenções concluídas. Também passou o novo caso de reabilitação do botão após PATCH na mesma sessão. Recuperação wizard/gestão, `closing`/`closed`, leituras sobrepostas, operações independentes, proteção de rascunhos, disponibilidade e prontidão também passaram.
- **Regressões:** as coberturas incluídas das ADMIN-01, ADMIN-02, ADMIN-03 e ADMIN-05 passaram, incluindo autenticação/TOTP, busca/filtros/paginação, acesso por UUID, dados e QR Code, criação de evento, Staff e isolamento de sessão.
- **Homologação visual:** o responsável informou que a homologação funcional e visual no Expo foi concluída com 31/31 verificações aprovadas. Esse resultado é manual e não faz parte da contagem automatizada acima.

Warnings: React Test Renderer informa que está obsoleto; o roteamento simulado emite avisos de componentes default com nome minúsculo para telas de autenticação. Não houve falhas ou testes ignorados associados a esses avisos. Nenhum teste conectou a PostgreSQL, Neon ou serviço externo; migrations e seeds não foram executadas.

### Estado Git e recomendação

`git diff --check` passou; `git diff --cached --exit-code` confirmou índice vazio. Branch `feature/admin-event-operations`, HEAD `f665f2dcbdd9ca6f462b63f4172aa769162f57ca`. As alterações preexistentes da ADMIN-04 foram preservadas; apenas este relatório foi atualizado nesta campanha.

Com a campanha automatizada aprovada e a homologação Expo informada pelo responsável, recomenda-se fechar tecnicamente a ADMIN-04 e encaminhar para aprovação formal do responsável. O changes definitivo ainda não foi gerado.

## Fechamento definitivo da ADMIN-04

A ADMIN-04 está tecnicamente aprovada e homologada pelo responsável. O escopo entrega a gestão de experiências e estações no Painel Individual, com consulta autenticada de estrutura e prontidão, criação e renomeação usando os contratos administrativos existentes, disponibilidade operacional via endpoint Staff autorizado, recuperação explícita de operações incertas e proteções contra resposta obsoleta, troca de evento e troca de sessão. Não houve alteração no backend.

### Validação e homologação

O histórico das campanhas permanece: primeira campanha **120/127**, segunda **127/128** e terceira **128/128 aprovados, 0 falhos, 0 ignorados, exit 0**, cobrindo as sete suítes frontend. A homologação funcional e visual no Expo foi informada pelo responsável: **31/31 verificações aprovadas**. Essa evidência manual está separada dos resultados automatizados. `git diff --check` passou. Não foram executados testes de PostgreSQL, Neon, migrations ou seeds.

### Escopo e limites aceitos

A recuperação de intenções permanece limitada à memória da pilha e à sessão atual. Estrutura, detalhe e prontidão são consultas independentes; não garantem um snapshot único. Os PATCHes não têm versão condicional, então outro Admin pode atualizar o recurso entre leitura e escrita. A leitura após timeout da disponibilidade confirma apenas o estado observado, não qual operador o produziu. O botão físico e gestos do dispositivo foram cobertos na homologação informada, mas não por testes automatizados. Catálogo global, remoções e demais áreas operacionais permanecem fora desta task.

### Inventário definitivo contra a base

Comparação com `f665f2dcbdd9ca6f462b63f4172aa769162f57ca`. Estes são os 14 arquivos pertencentes à ADMIN-04 incluídos no changes:

| Arquivo | Estado |
| --- | --- |
| `app/screens/admin/AdminEventManagementInfoScreen.js` | Modificado |
| `app/screens/admin/AdminEventSetupScreen.js` | Modificado |
| `app/screens/admin/AdminRealEventScreen.js` | Modificado |
| `app/screens/admin/AdminStructureScreen.js` | Novo |
| `app/screens/admin/adminCreationFlow.js` | Modificado |
| `app/screens/admin/adminStructureFlow.js` | Novo |
| `app/screens/admin/adminStructureIntents.js` | Novo |
| `app/screens/admin/components/AdminSelectedEvent.js` | Modificado |
| `app/services/adminEventSetupService.js` | Modificado |
| `app/tests/adminEventSetup.test.cjs` | Modificado |
| `app/tests/adminEventStructure.test.cjs` | Novo |
| `app/tests/helpers/questionnaireHarness.cjs` | Modificado |
| `app/tests/roleRoutingIntegration.test.cjs` | Modificado |
| `docs/ADMIN_04_IMPLEMENTACAO.md` | Novo em relação à base; contém implementação, auditoria e campanhas |

Não há remoções nem alterações binárias. O logo utilizado já pertence à base. Mudanças da ADMIN-05 já presentes no commit-base não fazem parte deste patch.

### Patch e estado Git

O patch definitivo é `qa-evidence/ADMIN_04-changes.diff`, gerado contra `f665f2dcbdd9ca6f462b63f4172aa769162f57ca` com índice e diretório de objetos temporários. O patch não contém a si próprio. Sua aplicação foi aprovada com `git apply --cached --check` e `git apply --cached` sobre um índice temporário inicializado no commit-base; a verificação reversa com `git apply --reverse --check` contra o working tree também passou. A validação inicial por extração via `tar` falhou por erro de checksum do utilitário, mas foi substituída com sucesso pela validação diretamente no índice isolado.

O inventário validado antes desta sincronização documental continha 14 arquivos: 3 novos e 11 modificados. Não há diferenças binárias nem segredos identificados. A atualização deste relatório está incluída no patch regenerado. Estatísticas finais do patch regenerado: 14 arquivos, 3 novos e 11 modificados; sem remoções de arquivos ou diferenças binárias. As contagens finais de linhas são obtidas do índice temporário e registradas na entrega da campanha.

`git diff --check` passou. O índice Git real permaneceu vazio e a comparação do diretório de objetos antes e depois confirmou que `.git/objects` não recebeu escritas. Branch `feature/admin-event-operations`; HEAD `f665f2dcbdd9ca6f462b63f4172aa769162f57ca`. A ADMIN-04 está aprovada para commit e push manuais do responsável. Nenhuma alteração funcional foi introduzida no fechamento.
