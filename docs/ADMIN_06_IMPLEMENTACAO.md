# ADMIN-06 — Gestão da equipe Staff

[Estado atual — consolidação final](#consolidação-final-das-correções-complementares). As seções anteriores registram as evidências e pendências de cada rodada.

Na abertura, a branch `feature/admin-event-operations` estava no commit `5758fe1dcda104f6bfacf3ddb922a3711b088298`, com árvore limpa e índice vazio. O responsável autorizou o modelo Astra ativo a implementar.

## Escopo e contratos

Integrar o card Equipe Staff e a pendência VERIFIED_ACTIVE_STAFF à gestão por evento. O controller, DTO, serviço e mapeamento de problemas de admin-role-management confirmam POST /api/v1/admin/roles/grant (201, role staff, eventId e email) e POST /api/v1/admin/roles/revoke (200, grantId). Ambos usam Idempotency-Key e retornam grant sem e-mail. A interface deve guardar o e-mail normalizado usado na concessão e conferir o vínculo antes de qualquer revogação. GET /admin/events/:eventId/readiness fornece checks.hasVerifiedActiveStaff. O backend decide autorização e elegibilidade.

## Plano de implementação e validação

Reutilizar os serviços da ADMIN-05 e o cabeçalho da BRAND-01. Criar um registro Staff em memória no navegador Admin, separado das intenções estruturais da ADMIN-04. Integrar o wizard, a rota de gerenciamento e seus componentes ao registro e proteger o rascunho na saída. Preparar adminEventStaff.test.cjs e adaptar as suítes do painel, wizard e roteamento aos novos destinos e confirmações. A campanha com mocks fica para Luna Medium e a homologação para o responsável.

A API não lista a equipe nem recupera uma concessão por e-mail, ID ou chave. A perda da memória da sessão também perde o acompanhamento local. Uma mudança na prontidão não identifica quem recebeu ou perdeu acesso.

## Implementação entregue para revisão

O card Equipe Staff e a ação Consultar Equipe Staff do checklist abrem a área `staff` da rota `AdminEventManagementInfo`. A tela usa o UUID selecionado para buscar o nome e a fase no detalhe e o requisito de Staff na prontidão oficial. A gestão permite conceder e revogar inclusive em evento encerrado. A tela mantém o cabeçalho Admin da BRAND-01, com retorno ao mesmo painel. O painel recarrega ao recuperar foco.

O formulário normaliza o e-mail com trim e conversão para minúsculas, aplica o formato e o limite de 255 caracteres do DTO e pede confirmação com o destinatário e o evento. A revogação exige confirmar a consequência e a possível mudança de prontidão. Somente um comprovante ativo da sessão, previamente validado para aquele evento e papel, fornece o grantId. O retorno é conferido pelos serviços grantEventStaff e revokeEventStaff, inclusive ID do usuário, papel, evento, datas e identidade do vínculo revogado. Um 404 na revogação remove o comprovante indisponível e reconsulta a prontidão. Uma recusa por papel já concedido não fornece comprovante. Erros de autorização bloqueiam o registro.

### Wizard, concorrência e recuperação

O navegador Admin fornece um registro específico para Staff ao wizard e à gestão. A identidade administrativa verificada, o identificador e a geração da sessão, a revisão da identidade e a instância do cliente delimitam seu tempo de vida. Cada evento tem mapas próprios para comprovantes e operações. Os assinantes recebem mudanças do seu evento. O e-mail vem da entrada normalizada e os identificadores vêm da resposta. As intenções de experiências e estações continuam em seu próprio contexto.

A operação reserva a combinação de evento, tipo e alvo antes do POST. O retry explícito exige o registro incerto atual e usa a chave original com os mesmos argumentos do serviço. Outro destinatário pode prosseguir independentemente. Timeout, erro de servidor, resposta inválida ou operação em andamento deixam o resultado incerto. Conflito de chave mantém a operação bloqueada. Montar uma tela e recuperar foco fazem leituras. Ao confirmar uma escrita, os observadores consultam novamente a prontidão. Uma nova consulta da gestão invalida uma leitura anterior ainda em voo. A saída com e-mail em edição passa pela proteção de remoção da rota, inclusive no retorno nativo.

A lista representa somente concessões conhecidas nesta sessão. Outra pessoa autorizada pode alterar o estado no servidor. Prontidão indisponível tem apresentação própria e o último Staff elegível pode ser revogado.

## Inventário da rodada

| Área | Arquivos |
| --- | --- |
| Tela e estado novos | `app/screens/admin/AdminRealEventStaffScreen.js`, `app/screens/admin/adminStaffSession.js` |
| Navegação e contexto | `app/screens/admin/AdminDemoNavigator.js`, `app/screens/admin/adminSetupIntents.js`, `app/screens/admin/AdminEventManagementInfoScreen.js`, `app/screens/admin/AdminRealEventScreen.js` |
| Painel e wizard | `app/screens/admin/components/AdminSelectedEvent.js`, `app/screens/admin/useAdminEventPanel.js`, `app/screens/admin/AdminEventSetupScreen.js`, `app/screens/admin/adminCreationFlow.js`, `app/screens/admin/components/AdminSetupSteps.js` |
| Serviço | `app/services/adminEventSetupService.js` |
| Suíte nova | `app/tests/adminEventStaff.test.cjs` |
| Suítes ajustadas | `app/tests/adminNavigation.test.cjs`, `app/tests/adminRealEvents.test.cjs`, `app/tests/adminEventSetup.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs` |
| Relatório novo | `docs/ADMIN_06_IMPLEMENTACAO.md` |

## Evidências e próximas validações

A suíte Staff prepara casos de validação de e-mail e respostas, erros de autorização, vínculo desconhecido ou de outro evento, revogação divergente, perda de resposta, duplo envio, conflito de chave e conclusão tardia. A integração de roteamento prepara o percurso por card e checklist, confirmação e cancelamento, compartilhamento de comprovantes e retry nos dois sentidos, prontidão indisponível, retorno com rascunho, evento encerrado e troca de conta durante uma concessão. Os mocks HTTP de integração retornam grant sem e-mail e usam 201 na concessão e 200 na revogação.

A inspeção estática compreendeu os contratos, o vínculo entre rotas e telas, o parser Babel com JSX em 17 arquivos JS/CJS e a resolução de 77 imports relativos. O índice permaneceu vazio e `git diff --check` passou. Nenhum teste, build ou acesso a serviço externo foi executado nesta rodada. A tela demonstrativa preexistente, as imagens, o backend e os fluxos Staff e Participante permanecem fora do inventário.

Campanha sugerida no PowerShell para Luna Medium, a partir da raiz:

```powershell
Set-Location app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminEventStructure.test.cjs tests/adminEventSettings.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/roleRoutingIntegration.test.cjs tests/authNavigation.test.cjs tests/authVisualIntegration.test.cjs tests/splashScreen.test.cjs
```

A auditoria deve revisar as transições incertas e os callbacks tardios com mudança de identidade, evento ou cliente. Os testes preparados precisam ser executados. A homologação no Expo deve conferir rolagem, teclado, diálogos, retorno Android e a apresentação da lista parcial. A revisão técnica, a homologação e a geração da evidência final permanecem pendentes.


## Auditoria técnica pós-implementação

Revisão estática do working tree da ADMIN-06, inclusive a tela, o registro e a suíte ainda não rastreados. Foram lidos o histórico das ADMIN-04 e ADMIN-05, o código de autenticação e transporte, os controllers e DTOs de papéis e os serviços de autorização, idempotência e prontidão. Branch `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`, com índice vazio. A rodada atualizou somente este relatório. Testes, builds, validação em aparelho e execução em banco seguem pendentes.

### Alto — Renovar o token na mesma sessão descarta a operação Staff incerta

**Defeito constatado por inspeção.** `app/services/authService.js:260–268,378–387,484–543,659–677`, `app/screens/auth/AuthSessionGate.js:33–39,66–79`, `app/App.js:39–49,116–124,140–149` e `app/screens/admin/AdminDemoNavigator.js:32–49`.

- **Cenário.** O Admin tem um POST Staff incerto e um GET autenticado recebe `ACCESS_TOKEN_EXPIRED`. O refresh publica `checking`, invalida a revisão da identidade e encaminha a navegação para recuperação. O registro Staff fica dentro da pilha Admin removida nessa transição. Quando o servidor confirma o mesmo usuário e o mesmo `sessionId`, a navegação volta ao Admin com um registro novo. Uma conclusão do POST durante a verificação também é descartada pela guarda do registro antigo. Se o próprio POST receber o 401 recuperável, `adminStaffSession.js:69–75` bloqueia todo o registro e apaga as intenções, pois `mutationOptions` desativa a renovação automática no POST (`app/services/adminEventsService.js:60–63`, `app/services/httpClient.js:318–335`).
- **Impacto.** A mesma sessão autenticada pode perder comprovantes, payloads e chaves. Depois da renovação, a interface pode aceitar a mesma operação com outra chave enquanto o resultado anterior é desconhecido. O servidor ainda protege a unicidade do vínculo ativo, mas uma nova chave representa outra operação e perde o replay da primeira. Se o vínculo tiver sido revogado entre as tentativas, por exemplo, a nova concessão pode produzir um efeito novo.
- **Correção recomendada.** Reter o registro em memória acima da pilha desmontável durante a verificação transitória, vinculado ao usuário, `sessionId`, geração e cliente HTTP. Suspender exposição e mutações até a confirmação da identidade e descartar o registro em logout, troca de sessão ou de cliente e perda efetiva da autorização. Para `ACCESS_TOKEN_EXPIRED` no POST, suportar revalidação sem reenviar a mutação automaticamente nem destruir chaves pendentes. Um POST que conclui durante a suspensão precisa ter resultado retido em quarentena ou voltar a um estado recuperável com a chave original.
- **Regressão.** Simular POST incerto, GET com 401 recuperável e refresh com o mesmo usuário e `sessionId`. Reabrir a gestão ou o wizard, confirmar a preservação do comprovante e da intenção e verificar que só o retry explícito usa a chave e o corpo originais. Variar conclusão tardia durante a suspensão, 401 recuperável no POST, logout, perda de papel, novo `sessionId` para o mesmo usuário e troca de cliente.

### Médio — O 404 da revogação elimina o comprovante e encerra uma recuperação ambígua

**Defeito constatado por inspeção.** `app/screens/admin/adminStaffSession.js:77–90`, `backend/src/auth/admin-role-management.service.ts:128–159,188–198`, `backend/src/auth/admin-role-management.problem.ts:24–26` e `app/tests/adminEventSetup.test.cjs:261–295`.

- **Cenário.** Um POST de revogação retorna 404 na primeira tentativa ou durante o retry após timeout. O serviço pode mapear tanto vínculo ausente ou já revogado quanto evento ausente para `RESOURCE_NOT_FOUND`. O frontend aplica o mesmo tratamento a qualquer HTTP 404, elimina o comprovante e a intenção e anuncia que o vínculo está indisponível.
- **Impacto.** A interface não anuncia sucesso e não dispara uma nova revogação automaticamente. Ela perde, porém, a evidência anterior e a chave da tentativa incerta, sem distinguir o motivo do 404. No contrato atual, o replay confirmado de revogação é avaliado antes dessas verificações e devolve a resposta 200 registrada. Portanto o 404 não é comprovante de replay bem-sucedido. O GET de prontidão pode informar que o evento não está disponível ou que há Staff elegível, mas não identifica o estado daquele vínculo nem o autor de uma mudança.
- **Correção recomendada.** Preservar o comprovante como informação histórica e suspender a ação normal sobre o vínculo com indicação de que a resposta não confirmou a revogação. Manter a chave da tentativa anteriormente incerta e definir sua recuperação explícita conforme o recurso e a sessão permaneçam válidos. Reservar a remoção como revogação confirmada para a resposta de sucesso validada. Não alterar outros comprovantes nem reabrir a intenção com outra chave enquanto incerta.
- **Regressão.** Ajustar o caso que hoje espera apagar o comprovante. Simular 404 por evento e por vínculo, com dois comprovantes e com e sem timeout anterior. Conferir linguagem neutra, preservação seletiva, ausência de novo POST automático e inexistência de confirmação inferida de prontidão.

### Médio — A leitura do corpo HTTP pode manter uma intenção indefinidamente em andamento

**Risco de execução fundamentado no transporte compartilhado.** `app/services/httpClient.js:105–125,220–228,231–282`, `app/screens/admin/adminStaffSession.js:43–54,84–91` e `app/screens/admin/components/AdminSetupSteps.js:88–101`.

- **Cenário.** Em um transporte que resolve `fetch` ao receber os cabeçalhos, o servidor ou intermediário entrega os cabeçalhos e deixa o corpo pendente. O cliente cancela o temporizador antes de aguardar `response.text()`.
- **Impacto.** A intenção fica em `sending`, sem recuperação explícita daquele alvo. Trocar entre as telas não libera a intenção. Outros alvos continuam independentes. Se houver o mesmo tipo de espera em um GET após confirmar a escrita, a lista permanece gravada, mas a tela pode continuar em carregamento.
- **Correção recomendada.** Fazer o limite do transporte abranger a leitura do corpo e classificar a interrupção de uma escrita já enviada como resultado incerto. Tratar a reconsulta como fase separada da confirmação.
- **Regressão.** No cliente HTTP simulado, devolver cabeçalhos imediatamente e atrasar a leitura do corpo até o abort. Conferir transição para resultado incerto no tempo limite e retry explícito com o mesmo corpo e a mesma chave. A manifestação em React Native precisa ser conferida no ambiente correspondente.

### Baixo — Um aviso anterior pode ocultar ou confundir o resultado de outra operação

**Defeito constatado por inspeção.** `app/screens/admin/AdminRealEventStaffScreen.js:49–61,71–86`, `app/screens/admin/adminCreationFlow.js:225–230` e `app/screens/admin/adminStaffSession.js:28–34,47–49,65–67`.

- **Cenário.** Na gestão, tentar conceder com e-mail inválido e depois revogar um vínculo confirmado ou repetir uma intenção já existente sem editar o campo. A mensagem de validação local tem precedência e permanece após a operação. No wizard, ao iniciar uma segunda operação, o registro publica uma mensagem vazia, mas `sync` só copia mensagens verdadeiras. O aviso de sucesso da primeira pode ficar junto ao estado em andamento da segunda. A mensagem Staff ainda compartilha o campo do fluxo de estrutura.
- **Impacto.** A lista e a intenção refletem a mutação, mas o anúncio pode ocultar a confirmação ou ser atribuído à operação errada. As guardas de envio continuam efetivas.
- **Correção recomendada.** Separar o aviso do campo, o resultado Staff por operação e a mensagem do fluxo estrutural. Limpar só o aviso pertinente quando uma nova operação começa e incluir seu alvo no retorno.
- **Regressão.** Com erro local de e-mail, revogar um vínculo válido e conferir o feedback. Sobrepor duas operações Staff para alvos diferentes e comprovar que seus resultados, e o aviso de uma intenção estrutural pendente, permanecem distinguíveis.

### Controles verificados e limites

- **Autorização e escopo.** A rota e suas telas usam a identidade verificada com papel Admin e o backend refaz a autorização para o ator da sessão. Escritas exigem Admin global ativo, sessão válida, segundo fator e e-mail verificado. O grant enviado tem papel `staff` fixo e UUID do evento selecionado. A revogação exige um comprovante imutável do mapa desse evento, com papel `staff`, `eventId` correspondente e vínculo ativo. O serviço valida os IDs e o papel/evento antes do POST e confere a resposta da revogação, inclusive `grantId` e `userId`. Nenhum caminho da ADMIN-06 aceita um `grantId` avulso ou usa o endpoint para revogar Admin global. Referências `app/context/adminAccess.js:3–12`, `app/screens/admin/useAdminEvents.js:6–9`, `app/screens/admin/adminStaffSession.js:36–64`, `app/services/adminEventSetupService.js:56–65,95–108` e `backend/src/auth/admin-role-management.service.ts:44–49,69–98,128–172`.
- **Concorrência no mesmo registro.** A reserva síncrona por evento, operação e e-mail normalizado ou ID do vínculo precede o POST. Enquanto a entrada está enviando, incerta ou em conflito, a outra tela não cria uma chave nova para aquele alvo. O retry exige a instância atual de uma entrada incerta e conserva destino e chave. O backend verifica o fingerprint e realiza replay da resposta persistida para o mesmo ator. A conclusão é retida no mapa do evento original ao desmontar uma tela na mesma sessão. A gestão filtra as notificações por evento e os dois fluxos removem seus assinantes. Troca de conta, logout, nova sessão e troca de cliente invalidam a publicação antiga pela guarda do navegador. A renovação transitória tem a perda descrita no achado alto. A memória Staff é separada do mapa estrutural da ADMIN-04.
- **Prontidão e navegação.** Card e checklist chegam à gestão com o UUID autorizado pelo detalhe. A lista se anuncia como parcial. O status oficial vem de `GET /admin/events/:eventId/readiness` e um GET não confirma autoria. Escritas validadas atualizam o registro antes de refazer a leitura. A gestão pode substituir GET em andamento e só publica o ticket atual. O wizard protege os GETs por geração, e o painel relê ao recuperar foco. Uma falha do GET não reverte a mutação confirmada. O caminho funcional da gestão continua disponível em evento encerrado, mesmo quando o wizard termina sua configuração. Referências `app/screens/admin/AdminRealEventScreen.js:17–42`, `app/screens/admin/components/AdminSelectedEvent.js:31–39`, `app/screens/admin/AdminEventManagementInfoScreen.js:12–18`, `app/screens/admin/useAdminEventPanel.js:18–58` e `app/screens/admin/adminCreationFlow.js:63–97`.
- **Interface.** O cabeçalho aprovado usa `AdminLiveScreen`. A confirmação exibe e-mail e nome do evento, o cancelamento fecha o diálogo sem chamar a mutação e `usePreventRemove` protege o rascunho. O botão Voltar pode continuar disponível durante Staff em andamento. A saída passa pela proteção quando existe e-mail em edição e a operação já enviada continua vinculada à sessão. A inspeção do código confirma a ligação ao contêiner rolável. Botão físico do Android, teclado, gestos nativos e legibilidade em tela pequena requerem homologação. O harness chama uma ação de navegação e não reproduz o evento físico. Referências `app/screens/admin/AdminRealEventStaffScreen.js:48–94`, `app/screens/admin/AdminEventSetupScreen.js:65–105` e `app/screens/admin/components/AdminLiveScreen.js:23–39`.
- **Limitação de backend.** O contrato não reconcilia nominalmente os vínculos em uma leitura de prontidão e não expõe consulta de concessão ou intenção por chave após perda da memória. Um replay confirma uma resposta histórica. A presença atual do acesso pode mudar por ação de outro Admin.

### Qualidade dos testes preparados

`app/tests/adminEventStaff.test.cjs:33–163` cobre normalização, formato de grant, papel ou evento divergente, retry concorrente, conflito e publicação tardia. O teste de troca de escopo desliga um booleano, então não exercita a renovação real nem a troca de cliente. `app/tests/roleRoutingIntegration.test.cjs:215–288,393–475,883–920` cobre navegação, compartilhamento, 201/200, resposta sem e-mail, volta com rascunho e troca real de Admin com o cliente preservado. No teste de perda de resposta, o mock atribui `eligible` a cada POST, inclusive ao replay. As asserções comparam chave e payload, mas o mock não prova que o servidor aplicou a mutação apenas uma vez. Para a regressão de concorrência no app, distinguir no mock transporte, aplicação da mutação e replay. Contar um único efeito e controlar duas ações do wizard e da gestão sobre a mesma intenção, incluindo a primeira disputa e o retry.

Além das regressões de cada achado, falta combinar uma mutação confirmada com GET de prontidão falho ou atrasado e trocar o evento na mesma navegação durante o POST. Verificar o feedback da confirmação, a publicação apenas no evento original e a precedência da leitura mais recente. A cobertura estrutural existente deve acompanhar a campanha, dado o campo de mensagem compartilhado no wizard. Conferir se as dependências de QA estão instaladas, pois a suíte de roteamento declara `skip` quando o harness não é carregado (`app/tests/roleRoutingIntegration.test.cjs:10–16`). Nenhuma dessas coberturas foi executada nesta auditoria.

A inspeção não identificou achado crítico ou caminho de elevação de privilégios na ADMIN-06. Recomenda-se tratar a perda de intenções na renovação e o 404 ambíguo antes de aprovar a entrega. A validação automatizada e a homologação visual permanecem pendentes.



## Correções pós-auditoria — quatro findings

A rodada manteve a branch `feature/admin-event-operations` e o HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`. O responsável autorizou o GPT-6.2 Sol para as correções. O histórico acima registra a implementação e os achados anteriores à correção.

### A — Alto. Continuidade do registro durante revalidação

O registro anterior pertencia ao navegador Admin, que pode ser desmontado quando a identidade passa por `checking`. O provedor de autenticação agora guarda em memória um vínculo Staff criado sob demanda. Suas guardas consultam a sessão atual do gerenciador de autenticação. A continuidade exige o mesmo usuário, `sessionId`, geração da sessão e cliente HTTP, com papel Admin e e-mail verificado. Durante inicialização ou revalidação de uma sessão existente, as telas e os callbacks ficam sem acesso ao registro. A confirmação da mesma identidade libera o registro novamente. Logout, novo login, mudança do identificador ou da geração, troca de cliente e perda de autorização invalidam a referência anterior.

Um POST iniciado sob a identidade verificada pode concluir enquanto a sessão está suspensa. O resultado validado fica retido no registro do mesmo escopo, sem notificar as telas durante a suspensão. Com `ACCESS_TOKEN_EXPIRED`, o registro preserva ação, destinatário, corpo e chave. A autenticação renova as credenciais sem repetir a mutação. O retry fica disponível explicitamente após a verificação. O contexto de intenções estruturais continua vinculado ao navegador Admin.

Arquivos da correção: `app/context/AuthContext.js`, `app/screens/admin/AdminDemoNavigator.js`, `app/screens/admin/adminStaffSession.js`, `app/screens/admin/adminSetupIntents.js`, `app/screens/admin/adminCreationFlow.js` e `app/screens/admin/AdminEventSetupScreen.js`. Os testes preparados exercitam recuperação por GET com 401 e renovação real no harness, 401 recuperável no POST, resposta durante a suspensão, logout e novo `sessionId` para o mesmo usuário. O caso de troca de Admin existente continua na campanha. Testes focados cobrem perda do papel, mudança da geração e troca do cliente. O registro permanece limitado à memória do provedor. Reiniciar o app ou encerrar a sessão exige consultar novamente as fontes oficiais disponíveis.

### B — Médio. Revogação com 404 ambíguo

`RESOURCE_NOT_FOUND` pode representar evento ou vínculo indisponível. A tela mantém o comprovante da sessão e sinaliza que seu estado atual não foi confirmado. Na primeira tentativa com 404, a revogação normal daquele vínculo fica bloqueada. Se já havia uma tentativa incerta, o 404 preserva a intenção recuperável com a mesma chave. A reconsulta de prontidão continua separada do resultado da revogação. Nenhum 404 é apresentado como sucesso. A confirmação exige HTTP 200 e o comprovante validado do mesmo vínculo. A concessão exige HTTP 201 e mantém suas validações anteriores.

Arquivos da correção: `app/screens/admin/adminStaffSession.js`, `app/screens/admin/components/AdminSetupSteps.js`, `app/services/adminEventSetupService.js` e `app/services/httpClient.js`. `adminEventStaff.test.cjs` cobre o retorno ambíguo antes e depois de timeout, comprovante paralelo preservado, ausência de segundo POST automático e replay 200. `adminEventSetup.test.cjs` foi ajustado para conferir histórico e reconsulta. A API não fornece leitura nominal para identificar a causa de um 404 nem confirmar o estado atual da concessão pelo GET de prontidão.

### C — Médio. Prazo de transporte até o fim do corpo

O prazo do cliente agora abrange cabeçalhos e leitura integral da resposta. A aplicação recebe a rejeição no prazo mesmo se o transporte ignorar o sinal de cancelamento. O cliente também solicita o abort quando o ambiente oferece suporte e limpa o temporizador ao concluir a tentativa. Se uma escrita já alcançou a resposta e falha durante sua leitura, o resultado é incerto. Uma falha explicitamente comprovada antes do envio conserva a indicação de que a requisição não foi enviada. Status HTTP com corpo concluído segue o tratamento normal. A verificação de status de sucesso exato é optativa e foi habilitada apenas para os endpoints Staff usados nesta task.

Arquivos da correção: `app/services/httpClient.js`, `app/services/adminEventSetupService.js` e `app/screens/admin/adminStaffSession.js`. A nova suíte `httpClientTimeout.test.cjs` prepara casos determinísticos para GET e POST, corpo indefinido ou tardio, prazo, abort durante a leitura, resposta antes do limite, limpeza de temporizadores e status HTTP. O comportamento de cancelamento físico do transporte ainda precisa de validação no React Native.

### D — Baixo. Feedback por operação e destinatário

A validação do campo de e-mail é separada do retorno Staff. A lista de avisos guarda ação, destinatário e indicação de retry. Ao iniciar uma operação o registro limpa apenas o aviso anterior para aquela ação e alvo. O wizard mantém a mensagem estrutural no seu próprio estado. A confirmação de escrita continua separada da reconsulta de prontidão.

Arquivos da correção: `app/screens/admin/AdminRealEventStaffScreen.js`, `app/screens/admin/AdminEventSetupScreen.js`, `app/screens/admin/adminCreationFlow.js`, `app/screens/admin/components/AdminSetupSteps.js` e `app/screens/admin/adminStaffSession.js`. As regressões preparadas cobrem e-mail inválido seguido de revogação, resultados separados entre alvos, retry, ausência de sucesso antecipado e confirmação Staff com aviso estrutural pendente.

### Integração e campanha pendente

Ajustes de fixtures em `app/tests/adminNavigation.test.cjs`, `app/tests/adminEventSetup.test.cjs`, `app/tests/adminEventStaff.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs` mantêm a cobertura dos fluxos anteriores. Os mocks de recuperação registram tentativa HTTP, aplicação da mutação e replay separadamente. A integração prepara disputa de callbacks entre gestão e wizard, duplo toque, GET posterior falho, leitura de prontidão sobreposta que chega fora de ordem e troca de evento durante POST. Os casos focados também exercitam dois primeiros envios equivalentes e outro destinatário independente. Nenhum caso infere autoria a partir de prontidão positiva.

O parser Babel analisou 20 arquivos JS/CJS no inventário da ADMIN-06. Foram conferidos 81 imports relativos e 9 referências de fixtures. `git diff --check` passou e o índice real permaneceu vazio. O diff está restrito a AuthContext, cliente HTTP, Staff Admin, testes e este relatório, além do trabalho anterior da ADMIN-06 preservado. Testes e builds não foram executados. A campanha automatizada e a homologação no Expo aguardam revisão.

Comando PowerShell para a próxima campanha com Luna Medium, a partir da raiz:

```powershell
Set-Location app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/httpClientTimeout.test.cjs tests/apiConfig.test.cjs tests/auth.test.cjs tests/authNavigation.test.cjs tests/authVisualIntegration.test.cjs tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminEventStructure.test.cjs tests/adminEventSettings.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/roleRoutingIntegration.test.cjs tests/participationService.test.cjs tests/participationProvider.test.cjs tests/questionnaire.test.cjs tests/staffRealNavigation.test.cjs tests/staffOperationsService.integration.test.cjs tests/splashScreen.test.cjs
```



## Revisão final das correções pós-auditoria

Revisão estática dos 20 arquivos JS/CJS da ADMIN-06, do contrato backend de papéis e prontidão, do gerenciador de autenticação, do transporte instalado e das suítes preparadas, além do histórico deste relatório e do `AGENTS.md`. A branch é `feature/admin-event-operations` e o HEAD corresponde à base `5758fe1dcda104f6bfacf3ddb922a3711b088298`. Esta rodada acrescentou apenas esta seção. Testes, builds e validação em aparelho permanecem pendentes.

### Situação dos quatro achados

| Achado | Classificação | Evidência |
| --- | --- | --- |
| A — Perda de intenções na renovação | **Parcialmente resolvido.** O defeito original de renovação na mesma sessão está resolvido por inspeção. A desmontagem do provedor ainda precisa invalidar o registro antigo. | `AuthProvider` retém o vínculo acima da pilha Admin e sincroniza o escopo usando o snapshot do gerenciador. Usuário, `sessionId`, geração e cliente devem coincidir. Durante inicialização ou revalidação, o registro permanece oculto e chamadas novas a `send` saem sem POST. Uma conclusão válida pode alterar apenas o registro retido daquele escopo, com notificação suspensa. `ACCESS_TOKEN_EXPIRED` preserva a intenção, usa o refresh do gerenciador e só reenvia após ação explícita. Logout, novo login, troca de conta, papel, e-mail verificado, sessão, geração ou instância efetiva do cliente invalidam o vínculo incompatível. `app/context/AuthContext.js:15–42`, `app/screens/admin/adminStaffSession.js:22–101,122–135`, `app/screens/admin/AdminDemoNavigator.js:32–49`, `app/services/adminEventsService.js:60–63` e `app/services/authService.js:378–387,659–677,953,1173–1188`. |
| B — 404 ambíguo na revogação | **Resolvido por inspeção.** | A resposta mantém apenas o comprovante afetado como não confirmado. O 404 inicial bloqueia a revogação normal e mantém o histórico. Timeout, retry explícito e 404 mantêm a mesma intenção recuperável e a chave. Outros vínculos ficam disponíveis. A resposta de sucesso precisa satisfazer o HTTP 200 esperado e validar o vínculo, o usuário, o papel, o evento e a data da revogação. No backend, replay confirmado precede as verificações que podem retornar 404. Nenhum cálculo de prontidão substitui esse resultado. Se o GET também devolver 404, a tela mostra o bloqueio do evento e o comprovante permanece armazenado. `app/screens/admin/adminStaffSession.js:81–99,137–159`, `app/services/adminEventSetupService.js:103–109`, `app/screens/admin/components/AdminSetupSteps.js:90–104`, `app/screens/admin/useAdminEventPanel.js:34–45` e `backend/src/auth/admin-role-management.service.ts:141–159,194–199`. |
| C — Timeout durante a leitura do corpo | **Resolvido por inspeção no cliente JS.** O efeito do cancelamento nativo em aparelho segue indeterminado sem execução. | `Promise.race` concorre com a operação que aguarda tanto `fetch` quanto a leitura do corpo. O timer é limpo em `finally`; abort é solicitado no vencimento. A leitura que termina depois do limite não chega ao processamento de status nem ao tratamento de 401. Timeout de escrita mantém incerteza quando não há prova de que o envio deixou de ocorrer. GET preserva erro HTTP com corpo completo e o fluxo anterior de renovação. As mutações Admin continuam com `retryOnUnauthorized: false`, e o status exato é uma opção ativada apenas em grant/revoke Staff. `app/services/httpClient.js:105–128,221–298,318–379`, `app/services/adminEventsService.js:60–63` e `app/services/adminEventSetupService.js:95–108`. |
| D — Feedback conflitante | **Parcialmente resolvido.** | A gestão limpa o erro local ao iniciar uma ação, o wizard usa `staffError` e `feedback` separados da mensagem estrutural, e o sucesso só é emitido após a validação da resposta. Resultados de destinatários diferentes são distinguíveis. Permanece interferência entre operações de vínculos distintos com o mesmo e-mail. `app/screens/admin/AdminRealEventStaffScreen.js:53–89`, `app/screens/admin/adminCreationFlow.js:209–232,241–246`, `app/screens/admin/components/AdminSetupSteps.js:84–109` e `app/screens/admin/adminStaffSession.js:93–100,106–120,137–159`. |

### Novos findings

**Médio — Uma resposta pendente pode iniciar renovação depois que o provedor foi desmontado.** Defeito de ciclo de vida demonstrável por leitura. Em `app/context/AuthContext.js:25–42`, a limpeza cancela apenas a inscrição do gerenciador. Enquanto o snapshot do gerenciador antigo continuar autenticado, a closure em `app/screens/admin/adminStaffSession.js:42–60,97,122–129` pode aceitar o resultado e chamar `refreshSession`, mesmo depois de a tela e o provedor antigos serem descartados. Na aplicação, o provedor fica na raiz e o logout normalmente invalida o escopo antes da desmontagem. O cenário residual exige desmontar ou substituir o provedor no mesmo runtime sem antes invalidar o gerenciador, com um POST que posteriormente devolva `ACCESS_TOKEN_EXPIRED`. Se uma nova instância compartilhar cliente ou armazenamento, o gerenciador antigo pode competir pela rotação das credenciais. A rotação persiste o novo token antes de confirmar a identidade em `app/services/authService.js:411,479–537`. Isso não demonstra publicação direta do comprovante antigo no contexto novo.

Correção mínima recomendada. Vincular a disponibilidade do registro e o callback de renovação ao ciclo de vida do provedor. Na limpeza, invalidar ou desligar o vínculo antigo e impedir novas chamadas ao gerenciador a partir dele. Na remontagem, permitir somente a nova instância ativa, respeitando a repetição de effects do React Strict Mode e mantendo a continuidade durante a desmontagem apenas da pilha Admin. Regressão proposta. Suspender um POST, desmontar/substituir o provedor sem logout, montar outra identidade com o mesmo cliente ou armazenamento e liberar o 401 antigo. Verificar ausência de renovação ou publicação pela instância descartada. Manter o caso de desmontagem da pilha durante renovação da mesma sessão.

**Baixo — O replay da revogação de um vínculo antigo pode apagar a confirmação de uma concessão posterior.** Defeito demonstrável por leitura. Em `app/screens/admin/adminStaffSession.js:106–120,137–141`, a conclusão ou o 404 da revogação apaga `grant:<email>` sem verificar a qual vínculo pertence o aviso. Se a revogação do vínculo A for aplicada com resposta perdida, uma nova concessão para o mesmo e-mail pode criar o vínculo B. Quando o retry de A confirmar a revogação antiga, B continua no mapa de comprovantes, mas o aviso de concessão de B é removido e fica visível apenas a revogação para aquele e-mail. Os botões de dois retries pendentes para o mesmo e-mail também compartilham o rótulo, embora a linha mostre o tipo da operação (`app/screens/admin/components/AdminSetupSteps.js:99–108`).

Correção mínima recomendada. Associar o aviso confirmado ao `grantId` e retirar avisos de concessão somente para o vínculo afetado. Identificar o tipo de operação também no rótulo de retry. Regressão proposta. Confirmar A, perder a resposta da revogação A, conceder B e reproduzir a resposta de A. Conferir comprovante e feedback de B, feedback histórico de A e identificação inequívoca dos retries com o mesmo e-mail.

### Transporte efetivo e risco residual

O projeto instala Expo 58.0.23 e React Native 0.88.1. O runtime nativo do Expo pode instalar `expo/fetch` como fetch global, com opção de manter o fetch do React Native. O `expo/fetch` registra o sinal, aborta o fluxo do corpo e chama `NativeRequest.cancel()`. O caminho de fallback do React Native instala `whatwg-fetch`, que liga o sinal a `XMLHttpRequest.abort()`. São ligações verificáveis nas dependências locais. Referências `app/node_modules/expo/src/winter/runtime.native.ts:35–46`, `app/node_modules/expo/src/winter/fetch/fetch.ts:83–114`, `app/node_modules/react-native/Libraries/Core/setUpXHR.js:27–41`, `app/node_modules/whatwg-fetch/fetch.js:530–537,619–627` e `app/node_modules/react-native/Libraries/Network/XMLHttpRequest.js:652–655`.

O encerramento da Promise JS no prazo independe de o transporte honrar o sinal. Em Expo no Android e no iOS, ainda é preciso observar o abort durante a leitura e verificar a liberação da requisição nativa e a apresentação de retry. Abort no dispositivo pode ocorrer depois de o servidor executar um POST. O backend continua sendo a fonte do resultado e do replay. A campanha do cliente compartilhado deve incluir autenticação e os consumidores Admin, Staff e Participante previstos no comando anterior.

### Qualidade da cobertura preparada e preservação

- A integração monta o provedor real de autenticação e o roteamento com transporte simulado. Cobre a identidade em `checking`, manutenção de usuário e `sessionId` após renovação, 401 recuperável em GET e POST, resposta durante a suspensão, logout e novo `sessionId` para a mesma conta. A troca de Admin está em caso separado. Troca de cliente e perda de papel foram preparadas em testes do vínculo, sem remontagem do provedor. Falta a regressão de desmontagem definitiva apontada acima. Referências `app/tests/roleRoutingIntegration.test.cjs:900–937,1913–2032` e `app/tests/adminEventStaff.test.cjs:228–269`.
- O mock de replay registra tentativas no vetor, aplica o efeito ao criar a entrada da chave e devolve a resposta memorizada no replay. Confere um efeito por intenção, o mesmo corpo e a mesma chave. O caso de disputa faz dupla chamada no wizard e invoca um callback da gestão que já saiu de foco. Isso cobre callback obsoleto e duplo toque, além da guarda por slot nos testes focados. O harness monta a rota em foco, portanto não representa duas telas ativas ao mesmo tempo. Os 404 de evento e vínculo têm a mesma resposta no mock, coerente com o contrato, sem simular verificações internas distintas do servidor. Referências `app/tests/roleRoutingIntegration.test.cjs:93–116,215–305`, `app/tests/adminEventStaff.test.cjs:68–92,167–225` e `app/tests/httpClientTimeout.test.cjs:11–96`.
- A integração prepara uma escrita confirmada seguida de GET falho, leitura de prontidão fora de ordem e troca de evento durante POST. `useAdminEventPanel` usa tickets e escopo para descartar leitura anterior, e o wizard mantém seu contador de geração. A navegação por UUID, a confirmação e a proteção de rascunho continuam ligadas aos seus fluxos. As alterações preservam por inspeção o contexto separado das intenções estruturais, os destinos das ADMIN-01 a ADMIN-05, a regra de segundo fator e a logo exclusiva do cabeçalho. `app/screens/admin/useAdminEventPanel.js:18–58`, `app/screens/admin/AdminEventSetupScreen.js:43–87`, `app/screens/admin/components/AdminLiveScreen.js:23–39`, `app/tests/roleRoutingIntegration.test.cjs:294–304,2034–2153` e `app/tests/adminEventSetup.test.cjs:424–440`.
- Os cinco módulos do harness resolvem localmente via `qa/regression`. O `catch` de `app/tests/roleRoutingIntegration.test.cjs:9–16` ainda converte qualquer erro de carga em skip, com motivo genérico. A resolução estática confirma presença, mas não garante carregamento. Na campanha, exigir execução efetiva da suíte e conferir o relatório de casos ignorados. Se houver skip, expor o erro de carga antes de aceitar a evidência de integração.

### Recomendação e Git

Corrigir primeiro o vínculo com o ciclo de vida de `AuthProvider` e preparar sua regressão. O ajuste de feedback por vínculo pode entrar na mesma rodada. Depois, liberar a campanha Luna Medium com as suítes do comando anterior e exigir que as regressões de roteamento tenham sido exercitadas. A homologação em aparelho continua necessária para avaliar o transporte nativo e a navegação física.

O inventário segue com 16 arquivos rastreados modificados e 5 novos no working tree. Os novos são `AdminRealEventStaffScreen.js`, `adminStaffSession.js`, `adminEventStaff.test.cjs`, `httpClientTimeout.test.cjs` e este relatório. As alterações rastreadas se concentram no provedor de autenticação, na navegação e no wizard Admin, no serviço Staff Admin, no cliente HTTP e nas suítes preparadas. O índice estava vazio antes e depois da revisão. O changes definitivo permanece reservado ao fechamento.



## Correção final — desmontagem do AuthProvider e feedback por vínculo

### Ciclo de vida da autenticação

A revisão encontrou que a limpeza de `AuthProvider` removia o observador, mas mantinha a autoridade das closures Staff ligadas ao gerenciador antigo. O provedor agora tem um escopo próprio. A limpeza do efeito de layout desativa esse escopo imediatamente. Com o escopo inativo, a sessão Staff deixa de expor comprovantes, publicar conclusões ou iniciar renovação. Se o mesmo provedor voltar imediatamente durante o replay de efeitos do Strict Mode, o registro existente continua vinculado a ele. Se permanecer desmontado, a referência é descartada. O cancelamento da inscrição de autenticação e as limpezas das telas continuam removendo seus observadores.

Na renovação transitória, apenas a pilha Admin perde foco ou é remontada. O provedor permanece ativo e retém a intenção para o mesmo usuário, `sessionId`, geração e cliente. Durante a revalidação, a interface fica protegida e uma conclusão pode ser guardada para o escopo original. Após confirmação da mesma sessão, somente a ação explícita repete o POST com a mesma chave e payload.

A revisão desta rodada também encontrou que um GET iniciado pelo provedor antigo podia usar handlers de 401 instalados pelo provedor novo no mesmo cliente HTTP. O transporte passou a conferir o conjunto de handlers e o escopo capturados no envio antes de iniciar renovação, invalidação por 401 ou replay. O gerenciador bloqueia novas ações de refresh, leitura de identidade e logout quando desacoplado. Operações de autenticação já em andamento conferem o escopo depois das esperas e antes dos próximos efeitos, inclusive gravações ou limpezas de credenciais ainda enfileiradas. O escopo do próprio gerenciador muda se outro provedor assumir a associação.

O cliente não expõe cancelamento externo por provedor. Uma requisição Staff pendente continua sujeita ao prazo HTTP existente e o resultado tardio perde sua autoridade na desmontagem. O app não deduz o resultado do servidor a partir de abort ou teardown. Uma operação remota ou nativa já despachada pode terminar depois da desmontagem. Se a memória do provedor for perdida, o contrato atual não oferece recuperação da intenção apenas pela chave. O cancelamento físico do transporte ainda precisa da homologação no Expo.

Arquivos envolvidos nesta correção

- `app/context/AuthContext.js`, `app/screens/admin/AdminDemoNavigator.js` e `app/screens/admin/adminStaffSession.js` ligam o registro e seus callbacks ao tempo de vida do provedor.
- `app/services/authService.js` e `app/services/httpClient.js` delimitam os efeitos de autenticação ao escopo que iniciou a operação. O prazo e a classificação de resposta de escrita incerta continuam os mesmos.
- `app/tests/auth.test.cjs` atualiza o stub de React para o efeito de layout, e `app/tests/roleRoutingIntegration.test.cjs` prepara a troca real do provedor com o mesmo cliente e armazenamento simulados.

### Feedback Staff por vínculo

Antes, a conclusão ou o 404 de uma revogação apagava o aviso de concessão pelo e-mail. Agora os avisos ficam no mapa do evento e guardam tipo de operação, destinatário, identidade da intenção e `grantId` quando conhecido. Uma concessão ainda sem comprovante usa o e-mail normalizado no escopo da intenção. Uma concessão confirmada e uma revogação têm chave própria por tipo e vínculo. Resolver ou marcar X como incerto não apaga a confirmação de Y. Quando mais de um vínculo tem o mesmo destinatário, a interface identifica o vínculo no aviso, e o rótulo de retry indica concessão ou revogação.

O timeout, o 404 ambíguo e o corte por sessão mantêm os tratamentos existentes. O 404 mantém o histórico não confirmado e a chave de uma tentativa incerta. A confirmação espera o status e o comprovante esperados. O wizard e a gestão continuam usando o mesmo registro, com avisos das experiências e estações mantidos no estado estrutural.

Arquivos envolvidos nesta correção

- `app/screens/admin/adminStaffSession.js` guarda e limpa avisos por vínculo.
- `app/screens/admin/components/AdminSetupSteps.js` exibe identidade e ação no componente compartilhado.
- `app/tests/adminEventStaff.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs` preparam regressões com X e Y distintos para o mesmo e-mail.

### Regressões e harness

A cobertura preparada acrescenta POST tardio com 401 recuperável, sucesso e timeout após substituição do provedor. Cada resposta é combinada com troca de usuário ou novo `sessionId` para o mesmo usuário. O harness verifica remoção da inscrição antiga, ausência de refresh ou logout antigos, preservação da credencial e do estado novos e descarte do resultado Staff anterior. Um GET terminal iniciado antes da troca usa o mesmo cliente HTTP e também é liberado depois da remontagem. Os casos anteriores de renovação legítima e retry explícito continuam na campanha.

O novo teste integrado de feedback concede X no wizard. A gestão perde a resposta após a revogação de X, concede Y e recupera X com a chave original. A confirmação de Y aparece na gestão e no wizard reaberto. Os testes do registro incluem replay 200 e 404 no retry com os IDs distintos. A cobertura anterior de destinos simultâneos, idempotência entre telas e independência dos avisos estruturais permanece.

`roleRoutingIntegration.test.cjs` e `staffRealNavigation.test.cjs` agora falham explicitamente com a causa de erro de carga do harness. As dependências travadas de `qa/regression` são React e seu JSX runtime, React Test Renderer e React Navigation core/routers. Se estiverem ausentes no ambiente da campanha, a preparação é `npm ci` em `qa/regression`. A resolução local dos cinco pontos de entrada foi conferida por inspeção, sem executar a suíte.

### Verificações e inventário

O parser Babel analisou 23 arquivos JS/JSX/CJS, resolveu 83 imports relativos e 11 referências a fixtures. O grafo local de autenticação e registro Staff, com 11 módulos, foi conferido sem ciclos. As assinaturas do vínculo, dos handlers e dos callbacks Staff foram conferidas nas chamadas. `git diff --check` passou. A branch segue em `feature/admin-event-operations`, no HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`. O inventário final tem 19 arquivos modificados e 5 novos, todos da ADMIN-06. Além dos arquivos de código e testes listados nesta seção, foram alterados o carregamento de `app/tests/staffRealNavigation.test.cjs` e este relatório. O índice permanece vazio.

Testes e builds ficam reservados à campanha. Homologação em aparelho e changes definitivo seguem pendentes. As classificações das revisões anteriores permanecem registradas no histórico.

Campanha Luna Medium em PowerShell, a partir da raiz

```powershell
Set-Location app
$env:NODE_ENV = 'test'
$suites = @(
  'tests/httpClientTimeout.test.cjs', 'tests/apiConfig.test.cjs',
  'tests/auth.test.cjs', 'tests/authNavigation.test.cjs', 'tests/authVisualIntegration.test.cjs',
  'tests/adminEventStaff.test.cjs', 'tests/adminEventSetup.test.cjs',
  'tests/adminEventStructure.test.cjs', 'tests/adminEventSettings.test.cjs',
  'tests/adminRealEvents.test.cjs', 'tests/adminNavigation.test.cjs', 'tests/roleRoutingIntegration.test.cjs',
  'tests/participationService.test.cjs', 'tests/participationProvider.test.cjs', 'tests/questionnaire.test.cjs',
  'tests/staffRealNavigation.test.cjs', 'tests/staffOperationsService.integration.test.cjs', 'tests/splashScreen.test.cjs'
)
node --test --test-reporter=spec @suites
```

## Campanha automatizada — GPT-6.2 Sol

Execução autorizada pelo responsável, em 19/11/2026, após confirmação do executor. Não houve alterações de código durante a campanha.

### Comando e ambiente

Na raiz do repositório, em PowerShell:

```powershell
Set-Location app
$env:NODE_ENV = 'test'
$suites = @(
  'tests/httpClientTimeout.test.cjs', 'tests/apiConfig.test.cjs',
  'tests/auth.test.cjs', 'tests/authNavigation.test.cjs', 'tests/authVisualIntegration.test.cjs',
  'tests/adminEventStaff.test.cjs', 'tests/adminEventSetup.test.cjs',
  'tests/adminEventStructure.test.cjs', 'tests/adminEventSettings.test.cjs',
  'tests/adminRealEvents.test.cjs', 'tests/adminNavigation.test.cjs', 'tests/roleRoutingIntegration.test.cjs',
  'tests/participationService.test.cjs', 'tests/participationProvider.test.cjs', 'tests/questionnaire.test.cjs',
  'tests/staffRealNavigation.test.cjs', 'tests/staffOperationsService.integration.test.cjs', 'tests/splashScreen.test.cjs'
)
node --test --test-reporter=spec @suites
```

Node `v24.15.0`; `NODE_ENV=test`. As 18 suítes/arquivos foram passadas ao runner; todos os caminhos existiam, as dependências do harness estavam instaladas localmente, e os testes de roteamento carregaram o harness obrigatório sem skip. O runner concluiu com **393 testes aprovados, 0 falhos, 0 ignorados, 0 cancelados**, exit code **0**. Duração reportada pelo Node: **49.8476 s** (duração medida pelo PowerShell: **49.948 s**). O resumo Node informa `suites 0`, que é a contagem de grupos `describe` do reporter; os 18 caminhos de arquivo foram argumentos efetivos do comando.

### Regressões observadas

- **AuthProvider e isolamento:** passaram os casos de renovação/transição de sessão e os seis cenários de POST tardio após substituição do `AuthProvider` (401 recuperável, sucesso e timeout; mesmo usuário e usuário diferente). Também passou a verificação de replay X sem apagar a concessão Y, compartilhada entre gestão e wizard.
- **Staff e idempotência:** passaram os testes de grant 201 e revoke 200, comprovantes, chave e corpo preservados no retry explícito, bloqueio de duplo envio, concorrência entre consumidores, timeout incerto, resultado tardio, conflitos e 404 sem falso sucesso. Os casos distinguem tentativas/replay e efeito persistido conforme os mocks preparados.
- **HTTP:** os sete casos do cliente HTTP passaram: quatro combinações de timeout GET/POST após cabeçalhos, corpo concluído dentro do prazo, aborto durante leitura com resultado incerto de POST e validação de status estrito. Isso valida a Promise e o mock Node, não a liberação efetiva do transporte nativo no Expo.
- **Integração e prontidão:** passaram navegação pelo card/checklist, UUID, consultas oficiais, refresh de prontidão, resposta antiga, logout/troca de conta, retorno com rascunho e proteção de áreas por papel.
- **Regressões anteriores:** as suítes incluídas exercitaram fluxos de ADMIN-01 a ADMIN-05, BRAND-01, autenticação/TOTP, cliente HTTP, participação e navegação Staff. O teste de BRAND-01 confirmou a logo Admin isolada e assets originais na splash/autenticação.

### Avisos e limitações

Não foram observadas falhas funcionais nem skips. O processo emitiu avisos de depreciação de `react-test-renderer`, avisos do React Navigation sobre componentes de tela de fixture chamados `default` e `[MODULE_TYPELESS_PACKAGE_JSON]` para `app/services/staffOperationsService.js` (reinterpretação como ES module, com custo de desempenho). Eles não alteraram o exit code. Os avisos de conversão LF/CRLF surgiram em `git diff --check`, não no runner.

Os testes usam transporte e armazenamento simulados e não acessam PostgreSQL, Neon ou serviços externos. A execução Node não substitui homologação funcional no Expo, especialmente para cancelamento do transporte nativo durante a leitura do corpo. Nenhuma homologação Expo é declarada nesta seção.

### Verificações finais e decisão

`git diff --check` passou (exit 0); o índice real permaneceu vazio (`git diff --cached --exit-code`, exit 0). Branch `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`. O inventário permaneceu em 19 arquivos rastreados modificados e 5 novos, sem artefatos adicionais da campanha. **Resultado automatizado: aprovado**, sem falhas pendentes desta campanha. A ADMIN-06 ainda aguarda homologação funcional do responsável no Expo e aprovação final; não está completamente aprovada nesta etapa.

## Preparação manual das contas sintéticas para homologação

**Nota de versionamento.** Os preparadores local e remoto e o teste isolado do preparador remoto foram usados apenas na homologação. Os comandos abaixo documentam o ambiente da campanha e dependem desses arquivos locais. O fluxo normal da ADMIN-06 e suas suítes versionadas funcionam sem eles. Nesta revisão, foram generalizados dois trechos históricos para omitir os identificadores específicos do destino remoto. Essa é a única exceção à preservação byte a byte do texto anterior.

Em 21/11/2026, a inspeção de `app/.env` indicou uma origem da API na interface LAN desta máquina, porta 3000. A porta não tinha processo escutando. As duas URLs configuradas em `backend/.env` apontavam para Neon. Havia um processo PostgreSQL escutando em `127.0.0.1:55432`, mas a escuta só confirma a presença do servidor. O banco efetivamente usado pelo Expo permanece **não confirmado**. A configuração padrão atual do backend é imprópria para a homologação local.

### Confirmar o ambiente antes de criar

1. Identifique a origem da API que o Expo carregou. Verifique a configuração do bundler e de `EXPO_PUBLIC_API_BASE_URL` ou do alias legado `EXPO_PUBLIC_API_URL`. Em aparelho físico, use a interface LAN da máquina que hospeda a API.
2. Confirme o processo que serve essa origem e o destino efetivo de sua `DATABASE_URL`, considerando o launcher, as variáveis do processo e o valor de fallback de `backend/.env`. Se for iniciar uma API para esta rodada, use o launcher local dedicado já autorizado e configure explicitamente `DATABASE_URL` e `DATABASE_DIRECT_URL` para o mesmo destino local, com as credenciais do próprio ambiente. Use `NODE_ENV=test` e mantenha `EVENT_CLOSURE_JOB_TEST_ENABLED=false`. A inicialização da API pode escrever dados auxiliares. Mantenha as credenciais fora do histórico e use apenas o ambiente dedicado.
3. Se a API só estiver disponível com banco remoto, pare aqui e providencie um ambiente isolado autorizado. Se houver um destino local aprovado, selecione o perfil exato da tabela. Uma origem LAN da API e uma porta PostgreSQL local aberta não demonstram que ambos estão ligados.

| Perfil | Host e porta | Banco | Role restrita |
| --- | --- | --- | --- |
| `a4` | `127.0.0.1:55432` | `arenago_staff_a4_20261112` | `arenago_staff_a4` |
| `geral` | `127.0.0.1:55432` | `arenago_staff_homolog_geral_20261111` | `arenago_staff_homolog_geral` |

### Inspeção e criação pelo responsável

Execute no PowerShell a partir da raiz, em um terminal interativo separado do launcher da API e sem variáveis `PG*`, `DATABASE_*` ou `NODE_OPTIONS`. Use Node 24.15.0 ou compatível com o backend e as dependências locais do projeto. O exemplo usa `a4`. Se a confirmação identificar o ambiente geral, use `geral` em todas as invocações.

```powershell
$env:NODE_ENV = 'test'
node backend/scripts/prepare-admin-06-staff-homologation.cjs --check a4
```

O modo `--check` pede a senha da role sem eco. Confere `current_database()`, endereço e porta do servidor, usuário efetivo e de sessão, role restrita, condição de servidor primário, as oito migrations pelos respectivos hashes e timestamps e os controles de schema e dados de referência das fixtures existentes. Em uma transação somente leitura, verifica a presença e o estado inicial dos quatro e-mails. Uma divergência exige revisão manual antes de prosseguir.

Depois de confirmar o destino e o resultado da conferência, execute:

```powershell
node backend/scripts/prepare-admin-06-staff-homologation.cjs --execute a4
```

O utilitário exige uma frase que inclui o nome do banco e solicita a digitação e repetição da senha de cada conta ausente, sem eco. Use senhas sintéticas distintas das credenciais de outros ambientes. A política de senha e os parâmetros Argon2id são reaproveitados das fixtures. O utilitário insere somente `staff1@arenago.invalid` a `staff4@arenago.invalid`, com nomes `Homologação Staff 1` a `Homologação Staff 4`, conta ativa e `email_verified_at` preenchido. Cada conta nova recebe um único papel global `participante`. A transação serializável bloqueia as tabelas necessárias, repete a conferência e valida o estado final antes do commit. A criação preserva contas existentes compatíveis. Colisão de e-mail normalizado, estado divergente ou histórico de concessões fora do estado inicial interrompe a execução sem sobrescrever dados. O utilitário não envia e-mails nem cria tokens de verificação.

Repita `--check` no mesmo perfil antes de usar as contas no Expo. O resultado esperado é que os quatro e-mails constem como contas existentes compatíveis. Em caso de commit incerto, use a mesma conferência antes de decidir por outra tentativa. Essa inspeção foi feita para o estado inicial. Após as concessões pela interface, a presença de histórico Staff torna a conta incompatível com uma nova preparação.

### Roteiro no Expo e evidência

1. No Admin, conceda Staff 1 e Staff 2 ao evento A. Verifique a confirmação na gestão e a atualização da prontidão oficial.
2. Entre com uma conta concedida e verifique acesso apenas ao evento autorizado.
3. Revogue Staff 1 pela gestão Admin. Confira a perda de acesso e a prontidão considerando Staff 2 ainda autorizado.
4. Use Staff 3 e Staff 4 em outros eventos para verificar o isolamento das permissões. Cada conta só passa a exercer Staff após a concessão efetiva pelo Admin.

Arquivos desta preparação: `backend/scripts/prepare-admin-06-staff-homologation.cjs` e esta seção do relatório. `node --check` passou para o utilitário. A inspeção do ambiente foi local e estática. Nenhuma conexão ao banco, criação de contas, execução de fixture ou campanha automatizada foi realizada nesta rodada. A preparação aguarda confirmação do destino pelo responsável, execução manual e homologação no Expo.

### Verificação do ambiente local em 21/11/2026

O serviço Windows `postgresql-x64-18` estava em execução. `netstat -ano -p tcp` mostrou `postgres` escutando em `127.0.0.1:55432`, e `pg_isready` retornou código 0 nesse endereço. A tentativa de consultar a identidade com `psql -X -w`, host e porta fixos e transações configuradas como somente leitura, retornou código 2 nos dois perfis, com `fe_sendauth: no password supplied`. Nenhuma consulta SQL foi executada. Esses resultados comprovam a escuta local e a exigência de autenticação, mas deixam pendentes a confirmação de `current_database()`, roles, migrations aplicadas, usuários, Admin com TOTP e eventos.

**Perfil indicado, sujeito à conferência autenticada: `a4`**, banco `arenago_staff_a4_20261112`, role `arenago_staff_a4`, em `127.0.0.1:55432`. É o ambiente isolado usado historicamente para Multiestações, com duas experiências e três estações, segundo `docs/STAFF_A4_IMPLEMENTACAO.md` e `docs/STAFF_B1_IMPLEMENTACAO.md`. O perfil `geral` corresponde ao banco e role históricos de Homologação Geral, com outro evento e outra fixture, descritos em `docs/STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md`. O histórico não confirma o estado atual de nenhum dos dois. Não há troca automática de perfil.

A revisão do caminho `--check` confirmou que ele abre somente uma transação `REPEATABLE READ READ ONLY`, executa consultas de identidade, catálogos, migrations, controles do schema e as quatro contas, e encerra a transação com `ROLLBACK`. O retorno ocorre antes da confirmação de criação, dos hashes e dos `INSERT`. O cliente conecta por TCP no loopback fixo, rejeita variáveis que podem redirecionar a conexão e não carrega `.env`. O modo não consulta aptidão do Admin nem inventaria os eventos.

#### Conferência autenticada pelo responsável

Rode primeiro o `--check a4` acima, com a senha digitada sem eco no próprio terminal. Ele compara as migrations 0001–0008 aos hashes e timestamps do repositório e exige controles das migrations 0007/0008, um questionário ativo e jogo curado. Se houver erro, pare antes de iniciar a API. O modo `--execute` permanece reservado para autorização posterior.

Para avaliar o Admin e os eventos, abra outra sessão somente leitura, a partir de um terminal sem redirecionadores PostgreSQL. Informe a senha da role apenas no prompt do `psql`.

```powershell
$env:PGSSLMODE = 'disable'
$env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=5000'
& 'C:/Program Files/PostgreSQL/18/bin/psql.exe' -X -W -h 127.0.0.1 -p 55432 -U arenago_staff_a4 -d arenago_staff_a4_20261112 -v ON_ERROR_STOP=1
```

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), host(inet_server_addr()), inet_server_port(),
       current_user, session_user, pg_is_in_recovery();
-- Confirme o perfil da tabela, servidor primário e identidades iguais à role esperada.

SELECT count(*) AS total_usuarios,
       count(*) FILTER (WHERE is_active AND email_verified_at IS NOT NULL) AS ativos_verificados
FROM public.users;

SELECT EXISTS (
  SELECT 1
  FROM public.users u
  JOIN public.user_roles r ON r.user_id = u.id
  JOIN public.user_totp_credentials t ON t.user_id = u.id
  WHERE u.email = 'staff-homolog-admin@arenago.invalid'
    AND u.is_active AND u.email_verified_at IS NOT NULL
    AND starts_with(u.password_hash, '$argon2id$')
    AND r.role = 'admin' AND r.event_id IS NULL AND r.revoked_at IS NULL
    AND t.is_verified AND t.verified_at IS NOT NULL
) AS admin_sintetico_apto_no_banco;

SELECT e.id, e.status, e.starts_at, e.official_ends_at, e.operational_deadline_at,
       e.closure_requested_at IS NOT NULL AS encerramento_solicitado,
       least(e.operational_deadline_at, e.admin_deadline_at) > now() AS antes_do_limite,
       EXISTS (
         SELECT 1 FROM public.experiences x
         JOIN public.stations s ON s.experience_id = x.id
         WHERE x.event_id = e.id AND s.availability = 'available'
       ) AS tem_estacao_disponivel,
       EXISTS (
         SELECT 1 FROM public.user_roles r
         JOIN public.users u ON u.id = r.user_id
         WHERE r.event_id = e.id AND r.role = 'staff' AND r.revoked_at IS NULL
           AND u.is_active AND u.email_verified_at IS NOT NULL
       ) AS tem_staff_verificado
FROM public.events e
ORDER BY e.starts_at, e.id;
ROLLBACK;
```

A consulta do Admin verifica os pré-requisitos persistidos, sem consultar a senha nem o segredo TOTP. O acesso efetivo ainda depende do titular ter a senha e o TOTP e de o launcher usar as chaves do A4 compatíveis com a credencial armazenada. Para observar a transição de prontidão, selecione um evento sintético com os demais requisitos completos e inicialmente sem Staff verificado. Um Staff remanescente mantém esse requisito atendido após outra revogação. Confira horários e encerramento pelo relógio do banco, e reserve um segundo evento para testar isolamento.

#### Inicialização futura da API com configuração isolada

O backend importa `dotenv/config` e normalmente lê `.env` do diretório de execução. O pool usa `DATABASE_URL`. `DATABASE_DIRECT_URL` é opcional na API e tem precedência no Drizzle Kit. A inspeção local classificou ambas as URLs de `backend/.env` como Neon, sem exibir seus valores. A API estava sem escuta na porta 3000. Use um launcher local cujo destino tenha sido conferido ou a configuração privada explícita abaixo. O arquivo privado precisa conter as duas URLs para o mesmo A4, JWTs distintos, chaves TOTP compatíveis com o A4 e os quatro TTLs exigidos. Use um terminal separado, sem variáveis de configuração herdadas que possam sobrepor as do ambiente dedicado. Não inclua credenciais de outros ambientes.

Em uma etapa posterior autorizada, a partir da raiz, selecione um arquivo privado fora do repositório. A checagem abaixo somente lê o arquivo e confere o destino sem mostrar as URLs. Rejeite `DOTENV_CONFIG_OVERRIDE`, inclusive quando definido como a string `false`.

```powershell
$localConfig = (Resolve-Path -LiteralPath (Read-Host 'Caminho do arquivo privado do A4')).Path
$repoRoot = (Get-Location).Path.TrimEnd('\')
if ($localConfig.StartsWith("$repoRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Escolha um arquivo privado fora do repositório.'
}
$overrides = Get-ChildItem Env: | Where-Object Name -Match '^(PG|DATABASE_|DOTENV_CONFIG_|NODE_OPTIONS$|JWT_|TOTP_|RESEND_)'
if ($overrides) { throw 'Abra um terminal sem configurações herdadas do banco, dotenv, Node ou autenticação.' }
Set-Location backend
$env:DOTENV_CONFIG_PATH = $localConfig
@'
const fs = require('node:fs');
const dotenv = require('dotenv');
try {
  const env = dotenv.parse(fs.readFileSync(process.env.DOTENV_CONFIG_PATH));
  for (const key of ['DATABASE_URL', 'DATABASE_DIRECT_URL']) {
    const url = new URL(env[key]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
        || url.hostname !== '127.0.0.1' || url.port !== '55432'
        || url.pathname !== '/arenago_staff_a4_20261112'
        || decodeURIComponent(url.username) !== 'arenago_staff_a4' || !url.password
        || url.search || url.hash) throw new Error();
  }
  console.log('As duas URLs apontam para o perfil local A4.');
} catch {
  console.error('Arquivo privado ausente, inválido ou com destino diferente do A4.');
  process.exitCode = 1;
}
'@ | node
if ($LASTEXITCODE -ne 0) { throw 'Inicialização bloqueada.' }
```

Após a conferência autenticada do banco e a autorização de inicialização, prossiga no mesmo terminal. Aponte o bind somente para a interface LAN confirmada, e restrinja o firewall à rede privada. O PostgreSQL permanece no loopback.

```powershell
$env:NODE_ENV = 'test'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:PGAPPNAME = 'arenago-admin06-a4-api'
$env:API_BIND_HOST = Read-Host 'IPv4 LAN deste computador'
$env:PORT = '3000'
npm.cmd run start:dev
```

O pool verifica conectividade com `SELECT 1`. O scheduler de encerramento fica desabilitado nas condições acima. A inicialização ainda emite `INSERT ... ON CONFLICT DO NOTHING` em `games` e `questionnaire_versions` em `OnModuleInit`, mesmo com `NODE_ENV=test`. Pode inserir jogos canônicos e a versão inicial do questionário se faltarem. Por isso, a inicialização fica para a etapa autorizada. Não há execução de migrations ou do comando `db:seed` no script de início. Login, TOTP e concessões também produzem escritas na homologação funcional.

#### Verificar Expo → API → PostgreSQL

1. No mesmo Wi-Fi, configure conscientemente a origem do Expo para `http://<IPv4-LAN-do-computador>:3000` em `app/.env.local` ou no ambiente do processo Expo. Reinicie o bundler em desenvolvimento e verifique a origem efetiva. O celular usa seu próprio loopback quando recebe `localhost`. Liberar o QR do bundler não comprova acesso à API.
2. No computador e no navegador do aparelho, abra `http://<IPv4-LAN-do-computador>:3000/api/v1/games?limit=1`. Essa rota pública consulta o PostgreSQL e deve responder com sucesso. Se o computador responder e o aparelho não, confira bind, firewall e isolamento da rede.
3. Na sessão local somente leitura do `psql`, confirme o banco e a role da conexão do processo iniciado. Durante a execução da API, o resultado esperado é uma ou mais conexões etiquetadas no A4, com cliente loopback.

```sql
SELECT datname, usename, host(client_addr) AS cliente, count(*) AS conexoes
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'arenago-admin06-a4-api'
GROUP BY datname, usename, client_addr;
```

4. Depois de autorizada a homologação funcional, faça login no Expo com o Admin sintético e TOTP. Abra o evento confirmado localmente e a gestão Equipe Staff. Compare o UUID e a prontidão da tela com a leitura oficial. Essa etapa confirma o acesso Admin no app e fica separada do diagnóstico somente leitura.

Situação desta rodada: servidor local responde, autenticação SQL e pré-requisitos continuam pendentes, e cadeia Expo → API → PostgreSQL não demonstrada. O backend não foi iniciado, nenhuma conta foi criada e não houve acesso ao Neon, alterações no banco ou execução de testes automatizados.

### Diagnóstico da falha antes da confirmação de criação

O responsável informou duas execuções aprovadas de `--check a4`. Ambas confirmaram identidade do banco local, role, migrations e controles do schema, com os quatro e-mails ausentes no momento das consultas. Em uma execução separada de `--execute a4`, o prompt da senha PostgreSQL apareceu, seguido da mensagem genérica “Preparação não confirmada”. Não apareceram o resultado da pré-checagem nem o prompt de autorização. Isso localiza a falha antes da criação. Os resultados de `--check` não verificaram Admin com TOTP, eventos disponíveis ou conectividade do Expo.

Os dois modos validam os mesmos argumentos, `NODE_ENV=test`, terminal interativo e ausência das mesmas variáveis de override. Usam o mesmo cliente, destino e role, solicitam a senha do PostgreSQL e executam a mesma transação somente leitura. As validações de ambiente e do journal local ocorrem antes do prompt da senha. Após o prompt, as causas ainda compatíveis com a mensagem antiga incluem falha na conexão ou autenticação, erro ao abrir ou fechar a transação de leitura, e erro durante a conferência de identidade, migrations, controles ou contas. O filtro antigo ocultou a exceção, então a mensagem registrada não permite distinguir essas causas. Não há uma condição específica de `--execute` antes da confirmação.

Em `--execute`, a frase de autorização e as senhas das contas ausentes vêm depois da pré-checagem. Somente após a confirmação e os hashes é aberta a transação de criação, que exige permissões para os bloqueios e inserts. Essas permissões não são verificadas pelo `--check` e não foram alcançadas na tentativa relatada.

O utilitário agora identifica as etapas de conexão, abertura da transação de leitura, verificação do perfil, consulta de contas e encerramento da leitura. A saída traduz códigos PostgreSQL e de transporte conhecidos e usa apenas mensagens fixas ou previamente reconhecidas. Senhas, URLs, mensagens brutas do driver, detalhes SQL e stack traces ficam fora da saída. Se uma leitura e seu rollback falharem, o diagnóstico preserva a falha da leitura. A transação de criação distingue também falha em bloqueios e continua sinalizando um commit incerto para conferência manual.

Para repetir, use o mesmo PowerShell interativo e as credenciais do A4. Rode `--check a4` e depois `--execute a4`. Para diagnosticar sem criar contas, interrompa com Ctrl+C se aparecer a frase de autorização. Se falhar antes, registre somente a etapa e a mensagem segura. Em caso de `28P01`, confira a senha da role dedicada no próprio terminal. Em caso de `42501`, a etapa informa qual operação deve ser revisada antes de qualquer ajuste de privilégios. A criação só deve continuar quando houver autorização explícita para o destino A4.

Esta investigação foi feita por inspeção do fluxo e do resultado informado pelo responsável. Nenhuma conexão ao banco, execução de fixture ou escrita foi realizada nesta rodada.

## Diagnóstico da fixture para o Neon de desenvolvimento

O responsável definiu uma branch de testes do Neon do projeto ArenaGO como destino da homologação manual desta rodada. O utilitário local usa o endpoint direto do banco dedicado, a role configurada para esse ambiente e TLS com validação de certificado. Os registros anteriores do A4 descrevem a investigação do ambiente local.

O responsável informou que `--check` confirmou o destino, oito migrations, um Admin elegível e as quatro contas ausentes. Nas duas tentativas manuais de `--execute`, a confirmação de criação foi aceita e a falha foi reportada na etapa de validação das senhas e geração de hashes. Essa etapa precede `BEGIN`. A causa comprovada no código foi a perda de diagnóstico: divergência, tamanho inválido, repetição e padrão trivial geravam erros sem código e com mensagens que `safeDiagnostic` não reconhecia. Erros da leitura ou do Argon2id também podiam cair na mesma mensagem. A evidência histórica não permite determinar qual ocorreu em cada tentativa nem inferir o tamanho da senha digitada.

### Correção e verificações

- `backend/scripts/prepare-admin06-neon-test.cjs` usa erros próprios com códigos estáveis. Os diagnósticos distinguem confirmação divergente, senha com menos de 12 ou mais de 128 caracteres, reutilização, rejeição pela política, falha de leitura e falha do Argon2id. A confirmação, as guardas de identidade e os erros conhecidos do PostgreSQL têm mensagens específicas. Erros inesperados omitem mensagens e códigos desconhecidos. O terminal trata cancelamento e fechamento na leitura, e o fluxo registra a etapa de bloqueio, revalidação, inserção ou commit quando uma transação falha.
- A fixture mantém seus limites de senha, exige senhas diferentes e reutiliza `evaluatePasswordSecurity` com o nome e e-mail da conta. Os parâmetros Argon2id permanecem 19.456 KiB, duas iterações e paralelismo um. A validação de ambiente e terminal, o destino fixo, a conferência do banco, role, migrations, Admin e contas, a autorização textual, os bloqueios, a transação serializável, a revalidação e o rollback foram preservados. A escrita continua limitada aos quatro usuários sintéticos ativos e verificados e aos papéis iniciais `participante`.
- `backend/test/unit/admin06-neon-test-fixture.test.cjs` prepara 13 casos com cliente, entradas e hash simulados. Eles cobrem a leitura de `--check`, recusas de senha antes de `BEGIN`, parâmetros de hash, sanitização, erros de conexão, rollback, autorização e contas já existentes. A execução cabe à etapa de teste com Luna Medium, conforme `AGENTS.md`. A partir da raiz, o comando é `node --test backend/test/unit/admin06-neon-test-fixture.test.cjs`.
- As checagens de sintaxe com `node --check` passaram nos dois arquivos, e a verificação de espaços do Git passou. A revisão foi local e estática. Nenhum teste automatizado nem modo do utilitário foi executado. Nenhuma conexão ao Neon, migration, seed, alteração de TOTP ou operação sobre contas foi realizada.

### Retomada manual

No terminal PowerShell privado, a partir da raiz, confira o destino e o estado das contas:

```powershell
$env:NODE_ENV = 'test'
node backend/scripts/prepare-admin06-neon-test.cjs --check
```

Somente após nova confirmação do destino e autorização da criação, rode no mesmo terminal:

```powershell
node backend/scripts/prepare-admin06-neon-test.cjs --execute
```

Digite a frase solicitada e forneça quatro senhas distintas, de 8 a 128 caracteres, nos prompts ocultos. Se a preparação parar, registre apenas a etapa e o código exibido. Se o resultado do commit for incerto, repita `--check` antes de tentar outra criação. A suíte simulada não confirma o comportamento do terminal real, do hash nativo nem das permissões de escrita do destino. A criação manual e a homologação pelo Expo permanecem pendentes.

### Campanha automatizada da correção — Luna Medium (22/11/2026)

Comando executado na raiz do repositório:

```text
node --test backend/test/unit/admin06-neon-test-fixture.test.cjs
```

Resultado: 13 testes aprovados, 0 reprovados, 0 ignorados; exit code 0. O Node reportou 13 testes e nenhuma suíte independente. Os casos exercitaram `--check` somente leitura; limites, confirmação, unicidade e política de senhas; parâmetros de Argon2id simulados; sanitização de diagnósticos; falhas de conexão e PostgreSQL; rollback; confirmação de autorização; e bloqueio de contas já existentes.

O teste importa `run` do utilitário e injeta um cliente falso baseado em `EventEmitter`; `connect`, `query` e `end` são implementados pela fixture. A factory verifica o endpoint fixo e as opções sem abrir uma conexão. A rotina executável real está protegida por `require.main === module` e não é iniciada pela suíte. Não foi usado `--execute` diretamente, nem houve conexão ao Neon, criação ou alteração de contas.

Verificações estáticas executadas:

- `node --check backend/scripts/prepare-admin06-neon-test.cjs` — aprovado, exit code 0.
- `node --check backend/test/unit/admin06-neon-test-fixture.test.cjs` — aprovado, exit code 0.
- `git diff --check` — exit code 0; foram exibidos avisos de conversão LF para CRLF em arquivos preexistentes da ADMIN-06, sem erro de whitespace.
- `git diff --cached --exit-code` — aprovado; índice real vazio.

A inspeção das mensagens e assertions confirma que os diagnósticos são mensagens fixas associadas a códigos reconhecidos; códigos, mensagens e detalhes desconhecidos são omitidos. As senhas fictícias e o marcador interno da fixture não são enviados à saída de diagnóstico. Esta verificação cobre o caminho simulado. Não valida o terminal interativo real, a autenticação do endpoint, permissões de escrita, hash Argon2 nativo nem a criação transacional no destino remoto.

Parecer: a correção e os testes simulados passaram, então a tentativa manual pode ser retomada somente pelo responsável, após confirmar novamente a branch de teste e o destino no Neon, com credenciais digitadas no terminal privado. A fixture não constitui aprovação para executar a criação nem prova o estado atual do banco. A criação efetiva e a homologação no Expo continuam pendentes.

### Alinhamento do tamanho da senha com o cadastro

A homologação identificou que o preparador Neon impunha um mínimo próprio de 12 caracteres, documentado na campanha anterior. A regra oficial em `backend/src/auth/auth.dto.ts` aceita de 8 a 128 caracteres. O preparador agora aplica essa mesma faixa e informa o mínimo de 8 no diagnóstico `PASSWORD_TOO_SHORT`. A correção se limita ao preparador e preserva `evaluatePasswordSecurity`, o bloqueio de padrões triviais e a exigência de senhas distintas.

A suíte simulada verifica a rejeição com 7 e 129 caracteres antes da transação e confirma que senhas válidas de 8 e 128 chegam ao hash simulado. Também verifica senhas comprometidas, previsíveis, triviais, reutilizadas e divergentes na confirmação.

```powershell
node --test backend/test/unit/admin06-neon-test-fixture.test.cjs
```

Resultado desta campanha final: 15 testes aprovados, 0 reprovados, 0 ignorados, exit code 0. Os limites aceitos de 8 e 128 e os limites rejeitados de 7 e 129 foram exercitados. O teste também confirmou bloqueios de senha fraca e as demais proteções descritas acima. `node --check` passou para o utilitário e para a suíte, e `git diff --check` passou. Nenhum banco real foi acessado, e nenhum `--execute` foi executado.

Os checks de sintaxe e whitespace não substituem a execução de todo o backend. A suíte usa um cliente PostgreSQL simulado, portanto não valida a criação no Neon, a autenticação real, as permissões do banco ou o hash nativo Argon2id. A preparação manual das contas na branch de testes do Neon aprovada para a homologação pode ser retomada pelo responsável após nova conferência do destino e das contas com `--check`. Esta validação não declara as contas criadas nem homologa os fluxos no Expo.

## Recuperação da equipe Staff persistida

Na homologação pelo responsável no Expo Go, a concessão, a revogação e a nova concessão de `staff1@arenago.invalid` foram aceitas. Ao retornar à tela, a lista ficou vazia e a revogação indisponível, embora uma tentativa de conceder novamente tenha retornado acesso já concedido. A tela usava apenas os comprovantes de mutações mantidos em memória na sessão. Sem consultar as concessões persistidas, ela não podia recuperar o identificador usado para revogar um vínculo antigo.

### Contrato de leitura

`GET /api/v1/admin/events/:eventId/staff` responde `200` com `{ eventId, items }`. Cada item tem `grantId` (UUID de `user_roles.id` usado na revogação), `userId`, `name`, `email`, `grantedAt` (UTC, ISO 8601) e `eligible` (conta ativa com e-mail verificado). A consulta usa uma transação `REPEATABLE READ READ ONLY`, revalida o Admin global, a sessão, o e-mail e o segundo fator antes de consultar o evento. O UUID inválido recebe `400`, o evento inexistente recebe `404 RESOURCE_NOT_FOUND` e falhas de sessão ou acesso seguem os códigos administrativos `401` e `403`. A resposta envia `Cache-Control: no-store`.

A leitura combina `user_roles` e `users`, limita os resultados ao evento informado e ao papel Staff com `revoked_at IS NULL`, e ordena por data de concessão e UUID do vínculo em ordem crescente. Um evento existente sem vínculos retorna `items: []`. Contas inelegíveis com vínculo ativo continuam na lista e podem ter esse acesso revogado. A projeção e o DTO limitam a resposta aos seis campos descritos. Os contratos de concessão e revogação continuam sendo os POSTs de papéis existentes.

### Tela Equipe Staff

O nome do evento aparece como subtítulo. O primeiro card contém o formulário e os estados da concessão. O segundo card, **Staff do evento**, contém a lista, os estados de leitura e as ações de revogação. Os cards usam a mesma área rolável do cabeçalho Admin, com a barra inferior fora da rolagem. A lista carrega no foco da tela e é consultada novamente após concessões e revogações confirmadas. Ela distingue leitura em andamento, falha com opção de tentar novamente e vazio confirmado. A leitura valida o evento, os identificadores e a unicidade dos membros antes de publicar os dados. Respostas fora de ordem ou de outra conta, sessão, tela ou evento são descartadas.

O vínculo recebido no GET pode ser revogado pelo seu `grantId`, inclusive após reabrir o app. A sessão mantém apenas o acompanhamento das operações e os comprovantes já usados pelo wizard. Uma tentativa pendente ou incerta bloqueia outro envio conflitante para o vínculo. Um reenvio explícito de resultado incerto usa o mesmo vínculo e a mesma chave. A interface só confirma uma mutação quando o POST devolve o comprovante correspondente. Um GET que mostra o estado atual não confirma por si só que uma tentativa incerta causou esse estado.

### Arquivos desta correção

- Backend em `backend/src/events/`: `admin-configuration.controller.ts`, `admin-configuration-query.service.ts`, `admin-configuration.dto.ts` e `admin-configuration.problem.ts`.
- App: `app/services/adminEventSetupService.js`, `app/screens/admin/AdminRealEventStaffScreen.js`, `app/screens/admin/adminStaffSession.js` e `app/screens/admin/components/AdminSetupSteps.js`.
- Testes: `backend/test/unit/admin-configuration.test.ts`, `backend/test/unit/admin-configuration-http.test.ts`, `backend/test/integration/admin-role-management.integration.test.ts`, `app/tests/adminEventStaff.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs`.

### Validação e nova homologação

A inspeção estática conferiu o filtro e a ordenação do SQL, a projeção, os pontos de autorização, a conversão de `grantId` para o formato dos POSTs e o descarte de respostas fora de escopo. Os testes preparados cobrem o contrato HTTP e a leitura simulada, a lista de vínculos antigos, os estados de erro e vazio, a revogação de vínculo inelegível, o isolamento entre eventos e sessões, a atualização após operações e a estrutura de rolagem. Os testes e builds desta correção aguardam a campanha com GPT-6 Luna Medium. As validações históricas deste relatório não abrangem o novo GET nem a nova tela.

Para a próxima campanha, executar as suítes focadas em terminais separados a partir da raiz:

```powershell
Set-Location app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs
```

```powershell
Set-Location backend
$env:NODE_ENV = 'test'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts test/unit/admin-role-management-http.test.ts
npm.cmd run typecheck:test
```

A integração PostgreSQL preparada depende de autorização específica e do banco dedicado verificado pela guarda existente. A resolução do transporte real, a apresentação em iOS e Android, a rolagem até o último integrante, o teclado em uma tela pequena e a ausência de sobreposição com a barra inferior dependem de nova homologação no Expo. Nessa etapa, conferir um vínculo anterior à sessão, sair e retornar, reiniciar o app, conceder e revogar, e navegar por Voltar ao painel, Home, Histórico e BI. A revisão técnica e a evidência definitiva permanecem pendentes.

### Campanha automatizada da listagem persistente — Luna Medium

Validação executada sem acesso ao Neon, sem migrations, seeds ou operações em bancos reais. A branch permaneceu `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`; o índice real estava vazio antes e depois das verificações. As demais alterações preexistentes foram preservadas.

#### Frontend

Comando executado em `app`, com `NODE_ENV=test`:

```powershell
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs
```

Resultado: 138 testes, 136 aprovados, 2 reprovados, 0 ignorados; exit code 1. As cinco suítes foram carregadas. Os testes de contrato do GET, recuperação de vínculo antigo, inelegibilidade e idempotência passaram, assim como a maior parte dos cenários de navegação e sessão. A campanha também exercitou regressões ADMIN-01 a ADMIN-06 incluídas nesses arquivos.

Falhas em `app/tests/roleRoutingIntegration.test.cjs`:

1. `ADMIN-06: equipe persistida reaparece, mostra erro de consulta separado de vazio e permite revogar conta inelegível` — linha 969: esperava 3 chamadas `GET .../staff`, recebeu 5. A assertion ocorre depois de entrar, voltar, reentrar após erro e acionar retry. Causa provável, apoiada pelo código: `useStaffRoster` registra `refresh` no listener `focus` e também chama `void refresh()` diretamente no efeito (linhas 56–62 de `app/screens/admin/AdminRealEventStaffScreen.js`), produzindo leituras duplicadas em uma entrada/montagem. A contagem inesperada é observada; a atribuição de cada chamada a cada gatilho é inferida desses gatilhos e do fluxo do teste.
2. `ADMIN-06: concessão tardia de A não altera a gestão de B` — linha 2256: `assert.ok(app.hasText('Consultando a equipe Staff...'))` recebeu falso. O teste libera a barreira quando a primeira chamada chega ao mock HTTP, mas uma segunda chamada é possível pelo padrão de montagem/foco acima; ela retorna imediatamente e pode substituir o estado pendente antes da assertion. Esta é a causa provável; a falha observada é confirmada, mas o runner não registrou a ordem de cada leitura.

Para diagnóstico, os dois testes foram repetidos isoladamente:

```powershell
node --test --test-reporter=spec --test-name-pattern='equipe persistida reaparece|concessão tardia de A não altera' tests/roleRoutingIntegration.test.cjs
```

Resultado: 2 selecionados, 0 aprovados, 2 reprovados, 0 ignorados; exit code 1, com as mesmas assertions e valores. As falhas são reproduzíveis. Nenhuma expectativa foi alterada.

#### Backend e verificações estáticas

Comando das suítes unitárias simuladas, executado em `backend` com `NODE_ENV=test`:

```powershell
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts test/unit/admin-role-management-http.test.ts
```

Resultado: exit code 1 antes de carregar qualquer teste. O Node v24.15.0 falhou na inicialização do `tsx` com `SystemError [ERR_SYSTEM_ERROR]`, `uv_os_get_passwd returned ENOMEM`, em `node:os` (`os.userInfo()`), chamado por `tsx/dist/temporary-directory-...mjs`. Contagem: 0 aprovados, 0 reprovados por assertion, 0 ignorados; a suíte não iniciou. A integração `backend/test/integration/admin-role-management.integration.test.ts`, dependente de PostgreSQL real e protegida por guarda própria, não foi executada por não haver autorização específica para uma campanha transacional nesta solicitação.

Verificações estáticas executadas:

```powershell
# backend
.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit
.\node_modules\.bin\tsc.cmd --project tsconfig.test.json --noEmit
# app
node --check screens/admin/AdminRealEventStaffScreen.js
node --check screens/admin/adminStaffSession.js
node --check services/adminEventSetupService.js
node --check tests/adminEventStaff.test.cjs
node --check tests/roleRoutingIntegration.test.cjs
# raiz
git diff --check
git diff --cached --exit-code
```

Os dois typechecks e todas as verificações `node --check` passaram (exit code 0). `git diff --check` passou (exit code 0), com avisos de conversão LF para CRLF em arquivos preexistentes modificados; não indicaram erro de whitespace. `git diff --cached --exit-code` passou (exit code 0), confirmando índice vazio. Os arquivos TypeScript de testes foram cobertos pelo typecheck `tsconfig.test.json`; o check de sintaxe JS não substitui testes.

#### Parecer e limitações

Resultado: **reprovado para revisão técnica nesta campanha**. As duas falhas frontend repetem-se; a primeira mede cinco GETs quando o teste prevê três e o código atual contém dois gatilhos de leitura no efeito. Recomenda-se ao Sol 6.2 High revisar a estratégia de carregamento inicial versus foco e a sincronização do teste de estado pendente, sem enfraquecer assertions de isolamento e respostas obsoletas. A suíte backend simulada não foi validada por execução devido ao bloqueio ambiental do `tsx`; os typechecks não substituem sua execução. Não houve acesso ao Neon nem a serviços externos. A campanha não comprova transporte real, autorização/SQL em PostgreSQL real, nem homologação física Expo. Após a correção, solicitar nova campanha Luna Medium; considerar a integração PostgreSQL separadamente somente com ambiente dedicado e autorização específica.

### Correção do ciclo de leitura da equipe Staff

A campanha Luna anterior registrou **136/138 aprovados**, 2 falhas, 0 ignorados e exit code 1. Os dois casos voltaram a falhar isoladamente. O teste de recuperação da equipe registrou cinco GETs para a entrada inicial, a reentrada e a tentativa manual, que deveriam produzir três. O teste da concessão tardia de A falhou ao verificar o aviso de carregamento antes de trocar para B.

A inspeção de `app/screens/admin/AdminRealEventStaffScreen.js` e de `useFocusEvents` do React Navigation confirmou dois caminhos de leitura na mesma entrada. O efeito chama a consulta quando a rota já é considerada focada e o navegador pode emitir `focus` para a mesma rota. O código anterior iniciava uma nova geração em ambos os caminhos. No teste A/B, o mock retinha apenas o primeiro GET de A e respondia de imediato ao seguinte. Por inspeção, essa segunda resposta podia encerrar o carregamento enquanto a primeira continuava pendente. A campanha anterior registrou a contagem e a ausência do aviso, sem rastrear individualmente a ordem dos eventos do navegador.

O hook `useStaffRoster` agora encaminha a montagem e a notificação de foco para o mesmo disparador. Ele inicia uma leitura por entrada, inclusive se a primeira leitura já terminou quando o evento de foco chega. O blur reabre o disparador para o próximo foco e invalida a geração em andamento. A desmontagem encerra o escopo e remove os listeners de foco, blur e sessão. A conta, a sessão, a revisão de identidade, o cliente HTTP e o evento delimitam o escopo. Antes de publicar sucesso ou erro, a resposta também precisa corresponder à última geração e a uma tela ativa, focada e autorizada.

Uma tentativa manual e as notificações de atualização do evento continuam iniciando novas leituras. Isso preserva a atualização após uma concessão ou revogação confirmada e impede que um GET iniciado antes da mutação prevaleça. O fluxo também preserva as reconsultas específicas por acesso já concedido ou vínculo indisponível. A tela distingue a consulta inicial, a atualização da lista após uma leitura bem-sucedida e a escrita em andamento. Uma lista vazia só aparece após um GET válido e vazio. As operações preservam o `grantId`, o contrato dos POSTs e o reenvio explícito da mesma intenção e chave após resultado incerto.

Arquivos desta rodada:

- `app/screens/admin/AdminRealEventStaffScreen.js` concentra os disparos de montagem e foco e verifica o escopo ativo.
- `app/tests/roleRoutingIntegration.test.cjs` verifica a contagem de GETs por entrada, reentrada, tentativa manual e revogação confirmada. O teste mantém o vínculo visível durante o POST, confirma a atualização após a resposta e só aceita a lista vazia depois que o GET termina. Os testes de troca de evento e logout com troca de conta mantêm o GET novo pendente enquanto resolvem o GET e o POST antigos. O teste de concorrência no mesmo evento preserva a verificação da resposta mais recente e agora confere a presença do vínculo após a concessão. Os cenários existentes de resultado incerto seguem verificando corpo e chave no reenvio.
- `docs/ADMIN_06_IMPLEMENTACAO.md` registra a correção e os comandos para a nova campanha.

As expectativas de três leituras antes da revogação e de carregamento inicial foram preservadas. Os testes usam promessas controladas, com resolução explícita das respostas e sem ampliação dos timeouts. A inspeção desta rodada foi estática. A execução das suítes e dos typechecks fica para Luna Medium.

#### Ambiente do runner backend

No ambiente atual, uma chamada isolada a `require('node:os').userInfo()` reproduziu `ERR_SYSTEM_ERROR`, `ENOMEM` e `uv_os_get_passwd` em Node v24.15.0. A sonda registrou apenas a versão e os códigos do erro e terminou com exit code 1. A inspeção do `tsx` instalado confirmou que ele chama `os.userInfo()` no Windows para compor seu diretório temporário. O erro ocorre fora do código da aplicação, antes de carregar os testes. O runner não foi iniciado nesta rodada.

Na próxima campanha, rodar em um terminal PowerShell local comum. Primeiro conferir se a consulta ao sistema funciona, sem imprimir o nome da conta. Se a sonda ainda falhar, registrar o ambiente e evitar repetir o mesmo comando `tsx` nele. Outra opção para a Luna é validar a compilação CommonJS para um diretório temporário usando o TypeScript instalado e executar com `node --test` apenas os três arquivos emitidos das suítes unitárias. Essa alternativa precisa preservar os decorators do Nest e a resolução das dependências do backend. Ela ainda não foi experimentada nesta rodada. A execução direta dos arquivos TypeScript pelo Node não é equivalente, pois o Nest depende da transformação de decorators.

```powershell
# Raiz do repositório
git diff --check

# Em app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs

# Em backend, em terminal separado
$env:NODE_ENV = 'test'
node -e "require('node:os').userInfo(); console.log('os.userInfo OK')"
# Prosseguir com tsx apenas se a sonda retornar exit code 0.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts test/unit/admin-role-management-http.test.ts
.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit
npm.cmd run typecheck:test
```

A ADMIN-06 aguarda nova campanha automatizada, revisão técnica e homologação funcional no Expo. A integração PostgreSQL real depende de autorização específica e de um banco dedicado. A evidência definitiva continua pendente.

### Revalidação após a correção do ciclo de leitura

Os dois testes anteriormente reprovados passaram no recorte inicial, com **2 aprovados, 0 falhos, 0 ignorados**, exit code 0. A campanha foi retomada a partir desse resultado. Comandos executados em `app`, com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec --test-name-pattern='equipe persistida reaparece|concessão tardia de A não altera' tests/roleRoutingIntegration.test.cjs
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs
```

A execução completa terminou com **138 aprovados, 0 falhos, 0 ignorados e 0 cancelados**, exit code 0. O total da regressão já inclui os dois cenários do recorte. Houve avisos repetidos de depreciação do `react-test-renderer` e de nomenclatura de componentes no React Navigation, agrupados na saída da execução completa.

- **Equipe persistida.** O teste verificou uma leitura na abertura e uma no retorno. A falha de GET exibiu erro sem mostrar lista vazia. A tentativa manual somou a terceira chamada e recuperou o vínculo anterior à sessão. A revogação usou o `grantId` persistido. Enquanto o POST estava pendente, o vínculo continuou visível e a contagem de GETs ficou em três. Após a confirmação, a quarta leitura atualizou o estado e a lista vazia só apareceu quando o GET confirmou a ausência de vínculos.
- **Evento A e evento B.** O teste confirmou um GET por entrada. As respostas antigas do GET e da concessão de A chegaram enquanto o GET de B estava pendente. B manteve seu aviso de carregamento, sem publicar o vínculo, a confirmação de A ou um vazio prematuro. O retorno a A fez uma nova leitura e recuperou o vínculo confirmado.
- **Regressão de operações e sessão.** Os casos de concessão e revogação concorrentes confirmaram a lista e a prontidão da leitura mais recente, com envio pelo formulário. A troca de conta e sessão descartou respostas antigas. Os cenários de resultado incerto verificaram o reenvio explícito com o mesmo corpo e a mesma chave de idempotência.

#### Backend e verificações estáticas

A sonda isolada no PowerShell local retornou exit code 1 em Node v24.15.0, com `ERR_SYSTEM_ERROR`, `ENOMEM` e `uv_os_get_passwd`. O comando abaixo registra a versão e os códigos sem exibir o nome da conta:

```powershell
# Em backend
$env:NODE_ENV = 'test'
node -e 'try { require(`node:os`).userInfo(); console.log(`os.userInfo OK em Node ${process.version}`); } catch (e) { console.error(JSON.stringify({node: process.version, code: e.code, uvCode: e.info?.code, syscall: e.info?.syscall})); process.exitCode = 1; }'
.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit
npm.cmd run typecheck:test
# Em app
node --check screens/admin/AdminRealEventStaffScreen.js
node --check screens/admin/adminStaffSession.js
node --check services/adminEventSetupService.js
node --check tests/adminEventStaff.test.cjs
node --check tests/roleRoutingIntegration.test.cjs
# Na raiz
git --no-optional-locks diff --check
git --no-optional-locks diff --cached --exit-code
```

O bloqueio ambiental manteve o `tsx` fora desta execução. As três suítes unitárias do backend ficaram pendentes, com zero testes executados. A próxima execução pode usar um terminal em que a sonda retorne 0 e os comandos unitários já documentados. Ambos os typechecks e os cinco `node --check` passaram com exit code 0. `git diff --check` retornou 0, com avisos de conversão LF para CRLF. A conferência do índice retornou 0 e sem diferenças na branch `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`.

A regressão usou transporte HTTP simulado. A sonda e os checks estáticos foram locais. A campanha ocorreu sem acesso ao Neon, integração PostgreSQL real, migrations ou seeds. Somente este relatório foi atualizado nesta retomada.

**Parecer para revisão técnica: aprovado com ressalvas no escopo da campanha.** As duas falhas anteriores foram resolvidas na regressão automatizada do frontend. A execução dos testes unitários do endpoint backend e a homologação funcional no Expo permanecem pendentes. A ADMIN-06 segue aguardando revisão técnica e decisão final.

## Auditoria técnica da listagem persistente de Staff

**Parecer: necessita correções antes da homologação.** A revisão estática encontrou um defeito de tratamento da confirmação de revogação durante a atualização da lista. Não foi identificado bloqueante nem achado alto de autorização, exfiltração de dados ou integridade transacional no fluxo revisado. A campanha anterior de 138/138 permanece evidência de regressão frontend simulada. Os testes do backend e a validação nativa continuam pendentes.

### Backend e autorização

- O guard do controller usa o principal autenticado. `authenticateBearerToken` valida o token e vincula usuário e sessão, verifica expiração, revogação, atividade e segundo fator do Admin. O serviço volta a verificar, no snapshot somente leitura, o Admin global ativo, a sessão associada, o TOTP e o e-mail verificado antes de consultar o evento. O parâmetro de rota é apenas o UUID do evento, convertido para a forma canônica. Staff e participantes sem Admin global são recusados antes da leitura de existência, sem distinguir eventos existentes de inexistentes para esses usuários. Referências: `backend/src/auth/session-auth.guard.ts:52`, `backend/src/auth/auth.service.ts:1019–1144`, `backend/src/events/admin-configuration.controller.ts:33–37` e `backend/src/events/admin-configuration-query.service.ts:11–28`.
- O snapshot de leitura é `REPEATABLE READ READ ONLY`. O serviço consulta a existência do evento e retorna 404 se estiver ausente. O GET limita a junção ao UUID solicitado, `role='staff'` e `revoked_at IS NULL`, com ordenação por `granted_at` e `id`. O índice parcial cobre evento/papel e a restrição de unicidade impede duplicação ativa por usuário, papel e evento. A conta inelegível continua visível enquanto seu vínculo estiver ativo. Não há consulta por integrante. O GET vê o estado confirmado no snapshot. Uma mutação efetivada durante uma leitura em andamento pode aparecer apenas na próxima consulta. Referências: `backend/src/events/admin-configuration-query.service.ts:22–28,58–71` e `backend/drizzle/0003_credentials_roles.sql:128–130`.
- A projeção e o DTO limitam a resposta a UUID do vínculo, UUID do usuário, nome, e-mail, instante UTC de concessão e elegibilidade. Nome e e-mail identificam o integrante, e os UUIDs sustentam a revogação e a validação da resposta. Não há retorno de hashes, tokens, sessões, segredos TOTP ou códigos de recuperação. A rota define `Cache-Control: no-store`. Referências: `backend/src/events/admin-configuration-query.service.ts:62–69`, `backend/src/events/admin-configuration.dto.ts:38–45` e `backend/src/events/admin-configuration.controller.ts:33–37`.
- `grantId` é `user_roles.id`. A interface usa exatamente esse UUID no POST e verifica vínculo, usuário, evento, papel e data de revogação na resposta. O contrato de POST e o serviço persistente permanecem como na base. As mutações revalidam o ator, reservam a intenção por chave e fingerprint, vinculam o replay ao resultado salvo e gravam alteração, auditoria e conclusão da intenção na mesma transação. A revogação não exige que o alvo Staff ainda seja elegível. Referências: `app/services/adminEventSetupService.js:68–80,118–125` e `backend/src/auth/admin-role-management.service.ts:44–49,73–124,130–200`.

### Frontend, ciclo de leitura e cobertura

`useStaffRoster` compartilha a guarda de foco entre montagem e evento `focus`. `blur` permite outra entrada e invalida a consulta em voo. Cleanup invalida a inscrição e remove listeners de foco, blur e sessão. O escopo combina dono administrativo, revisão de identidade, cliente, evento e sessão. A publicação de sucesso ou erro exige foco válido e geração mais recente. As leituras após escrita e tentativa manual avançam a geração. O estado vazio exige uma resposta válida e vazia. O registro Staff separa vínculos e operações por evento e preserva a chave, o alvo e o corpo no reenvio explícito. O GET não confirma nem repete um POST. Referências: `app/screens/admin/AdminRealEventStaffScreen.js:18–91,108–128,175–193`, `app/screens/admin/useAdminEvents.js:6–9` e `app/screens/admin/adminStaffSession.js:21–59,82–172`.

A tela apresenta o nome do evento como subtítulo, com o formulário de concessão e o card **Staff do evento** separados. Cada integrante tem nome, e-mail e botão com rótulo acessível. O `ScrollView` tem tratamento de teclado e a barra inferior fica fora da rolagem. A estrutura é verificável no código e no harness. Alcance do último item, teclado, fontes ampliadas e composição em telas pequenas dependem de Expo em aparelho. Referências: `app/screens/admin/AdminRealEventStaffScreen.js:158–203`, `app/screens/admin/components/AdminLiveScreen.js:31–39` e `app/tests/roleRoutingIntegration.test.cjs:960–967`.

| Evidência | Cobertura e limite |
| --- | --- |
| `backend/test/unit/admin-configuration-http.test.ts:102–132` | Corpo, `no-store`, identidade encaminhada, UUID canônico e códigos para Bearer/sessão/TOTP/Staff. Auth e consulta são simulados. A recusa do Staff vem do serviço simulado. |
| `backend/test/unit/admin-configuration.test.ts:151–209` | Exercita o serviço e o DTO com cliente simulado. Confere parâmetro SQL, filtro de evento/papel/revogação, ordenação, transação, projeção e recusa antes de consultar o evento. O cliente devolve linhas programadas e não executa os predicados no PostgreSQL. A matriz completa de estados da sessão usa a leitura compartilhada de eventos. |
| `backend/test/integration/admin-role-management.integration.test.ts:193–225` | Prepara cobertura com guard e PostgreSQL para evento correto, exclusão de revogados e de Staff de outro evento, inelegíveis, recusa de participante/Staff/Admin sem TOTP e revogabilidade do UUID retornado. Continua sem execução nesta campanha. |
| `app/tests/roleRoutingIntegration.test.cjs:236–325,925–1063,2165–2328` e `app/tests/adminEventStaff.test.cjs:19–95` | Regressão anterior executada. Conta GETs por entrada, reentrada e recuperação, testa UUID histórico e ausência de vazio falso, respostas fora de ordem e isolamento entre eventos e sessões. Também verifica mutações incertas e reenvio com a chave e o corpo originais. A navegação usa transporte e views nativas simulados. |

### Achados e riscos residuais

**Média · Defeito comprovado por inspeção — A confirmação de revogação pode fechar sem executar nem informar o motivo.** `app/screens/admin/AdminRealEventStaffScreen.js:46–53,108,124–129,137–144,196–203` e `app/screens/admin/useAdminEventPanel.js:23–27,41–47`. Uma escrita em voo de outro integrante pode iniciar reconsulta enquanto a confirmação está aberta. A leitura limpa os itens e o render do modal depende do painel, sem validar se o `grantId` continua presente. Se o painel já tiver voltado e a lista seguir pendente, ou se a nova lista não contiver mais o vínculo, `resolve` fecha o modal e `submit` sai em silêncio. O efeito é perda da ação e da explicação. O código conserva a proteção contra revogação de outro vínculo. Na correção, desabilitar a confirmação durante a consulta ou informar que o vínculo deixou de estar disponível, preservando a conferência do UUID mais recente. Preparar regressão com GET controlado e confirmação aberta, cobrindo lista pendente, ausência do vínculo e substituição por novo UUID para o mesmo e-mail. Conferir mensagem e ausência de POST indevido. Com o mesmo UUID confirmado, conferir um único POST.

**Baixa · Lacuna de teste — O harness desmonta rotas fora de foco.** `app/tests/roleRoutingIntegration.test.cjs:92–100,952–979` e `app/screens/admin/AdminRealEventStaffScreen.js:64–85`. A regressão cobre reentrada por navegação e desmontagem. O caso de `blur` seguido de `focus` na mesma montagem retida pela pilha nativa continua sem evidência direta. A implementação tem a guarda correspondente. Preparar teste com rota retida ou teste focado do hook, incluindo conclusão tardia da primeira leitura, exatamente uma leitura ao refocar e remoção dos listeners. Conferir o mesmo ciclo no Expo.

**Baixa · Lacuna de teste — Falta validar alguns limites específicos do contrato HTTP.** `backend/test/unit/admin-configuration-http.test.ts:102–132,215–224`, `backend/test/unit/admin-configuration.test.ts:197–209` e `backend/test/integration/admin-role-management.integration.test.ts:193–225`. A suíte não combina, para a rota Staff, e-mail do Admin não verificado, resposta HTTP `403 ADMIN_EMAIL_UNVERIFIED` e verificação de que eventos existentes e inexistentes produzem a mesma recusa. Adicionar a regressão antes da leitura do evento, com e sem parâmetros forjados de ator. Fixar também o empate de timestamp na integração para demonstrar o desempate real por UUID. O código revisado já impõe as condições correspondentes.

**Baixa · Risco residual de volume — Listagem e renderização sem limite.** `backend/src/events/admin-configuration-query.service.ts:62–69` e `app/screens/admin/AdminRealEventStaffScreen.js:180–191`. O endpoint devolve todos os Staff ativos e a tela cria uma view por membro. O índice reduz o custo da seleção. A cardinalidade, o tamanho do payload e o custo de renderização continuam proporcionais ao número de vínculos. Não há medição que demonstre problema no volume atual do ArenaGO. Definir volume esperado e medir tempo, tamanho e rolagem em aparelho. Se exceder o orçamento, avaliar paginação com ordenação estável e renderização virtualizada, com teste de navegação completa e revogação por UUID em páginas diferentes.

### Diagnóstico do ENOMEM e próxima etapa

A campanha anterior reproduziu `ERR_SYSTEM_ERROR` e `uv_os_get_passwd returned ENOMEM` no Node v24.15.0 com `os.userInfo()` isolado. O `tsx` instalado consulta essa função para derivar o nome do diretório temporário no Windows. O [libuv incluído no Node v24.15.0](https://github.com/nodejs/node/blob/v24.15.0/deps/uv/src/win/util.c#L1066-L1137) consulta o token do processo, o diretório de perfil e o nome da conta. Seu código pode retornar `ENOMEM` tanto em alocação quanto em um erro de buffer na consulta de nome. A mensagem disponível identifica a chamada nativa, sem isolar qual etapa falhou. Contexto de execução e perfil do Windows são hipóteses a comparar, assim como alocação. A única instalação de Node listada pelo PowerShell atual foi `C:\Program Files\nodejs\node.exe`.

Para desbloquear a próxima campanha, usar a sonda sanitizada da seção anterior em um PowerShell interativo comum e registrar o exit code, `node -v` e a versão de libuv (`node -p 'process.versions.uv'`). Se necessário, repetir a comparação uma vez em instalação ou executor isolado compatível com `backend/package.json:6–7` (`>=24.15.0`), usando dependências locais compatíveis com o runtime. Prosseguir com os três arquivos unitários já documentados apenas no ambiente em que a sonda passar. A compilação CommonJS temporária descrita acima permanece alternativa a validar separadamente com Luna Medium, mantendo os decorators e a resolução de dependências. A investigação atual não executou novas suítes, não iniciou API e não acessou Neon ou PostgreSQL.

Corrigir o feedback de revogação, repetir a campanha frontend e completar a execução dos unitários do endpoint antes da homologação funcional no Expo. PostgreSQL real exige autorização específica. A revisão preservou o histórico do relatório, inclusive as descrições das etapas anteriores que foram substituídas pelo contrato de leitura persistida. A branch permanece `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`, com índice vazio. A auditoria atualizou somente este relatório.

## Correção pós-auditoria da confirmação de revogação

A auditoria identificou que o diálogo era fechado antes de verificar o vínculo na lista atual. Uma leitura iniciada pela conclusão de outra operação removia temporariamente os itens exibidos. A confirmação podia então sair sem POST e sem feedback, tanto durante a leitura quanto após uma resposta que já não incluía aquele vínculo.

A confirmação agora preserva a seleção pelo `grantId` e os dados de apresentação do diálogo. Durante a leitura, o diálogo indica que a equipe está sendo atualizada e desabilita a confirmação. Uma falha recuperável oferece **Atualizar equipe Staff** no próprio diálogo. Essa ação faz uma leitura e mantém a seleção. Se a resposta válida não contém o mesmo UUID, o diálogo informa que o acesso já não consta na equipe e oferece **Voltar à equipe**. Uma nova concessão ao mesmo e-mail exige seleção e confirmação próprias.

Para enviar, a tela exige o diálogo atual, foco, sessão válida e a geração vigente de uma leitura bem-sucedida que ainda contenha o UUID no evento. Um novo GET invalida o comprovante anterior imediatamente, inclusive antes da próxima renderização. A tela consulta o registro de operações antes de enviar e consome a confirmação uma única vez. Resultados incertos continuam recuperáveis pelo retry explícito do registro com o mesmo corpo e a mesma chave. Troca de conta, sessão ou evento, perda de autorização e saída de foco invalidam a confirmação anterior. A consulta não dispara mutações.

### Arquivos e regressões preparadas

- `app/screens/admin/AdminRealEventStaffScreen.js` acompanha a geração do comprovante e apresenta o estado da confirmação. `app/screens/admin/components/AdminConfirmDialog.js` aceita a opção de desabilitar o botão principal, com o padrão já utilizado pelos demais diálogos.
- `app/tests/roleRoutingIntegration.test.cjs` prepara casos com GET controlado, callback capturado, duplo toque, vínculo ativo, ausente ou substituído pelo mesmo e-mail, falha e retry de leitura, e troca de provedor com a leitura pendente. A regressão entre eventos também tenta usar a confirmação anterior depois de sair de A. Os cenários verificam o diálogo, a lista, o número de POSTs e a preservação de corpo e chave no retry de revogação incerta.
- `backend/test/unit/admin-configuration-http.test.ts` usa o servidor Nest local, o guard, o controller, o filtro de problemas e o serviço real de consulta. O principal autenticado e o executor SQL são simulados. Verifica `403 ADMIN_EMAIL_UNVERIFIED`, `401 ADMIN_2FA_REQUIRED` e `403 ADMIN_REQUIRED`, com status e corpo iguais para um evento existente e outro inexistente. Confere a identidade recebida do principal com parâmetros de ator divergentes na query e que apenas a consulta de autorização ocorreu. Um Admin autorizado serve de controle para a diferença entre 200 e 404.

### Foco nativo e volume

O harness atual desmonta a rota ao trocar a tela ativa. A reentrada automatizada cobre esse ciclo e os callbacks antigos. Para homologar a tela que permanece montada, usar uma navegação que a cubra sem removê-la da pilha em uma build de diagnóstico no Expo. Com a primeira leitura de equipe em voo e o transporte controlado, cobrir a rota e retornar. Conferir uma única leitura no retorno, liberar a resposta anterior primeiro e observar que o carregamento permanece até a leitura atual. Abrir o diálogo antes de cobrir a tela em uma segunda passagem e confirmar que ele não reaparece no retorno. Remover a rota e observar que os listeners anteriores deixam de reagir, com um único GET ao abrir uma nova instância. O teste Node atual não reproduz a retenção nativa.

A consulta filtra por evento e Staff ativo, com índice parcial para evento e papel. A ordenação por data e UUID ainda pode exigir sort após o filtro. A junção usa a chave do usuário e o volume transferido e renderizado cresce com o tamanho da equipe. A regressão preparada usa 80 linhas sintéticas e verifica que o primeiro e o último botões pertencem à mesma rolagem do formulário, são identificáveis por e-mail, têm papel de botão e alvo mínimo previsto no estilo. Também abre e cancela a confirmação do último item sem enviar POST. Essa inspeção de estrutura não mede quadros, latência ou rolagem física. No Expo, homologar em tela pequena com teclado e fonte ampliada, rolar até os últimos registros e verificar o alcance e a resposta dos botões. Paginação e virtualização ficam condicionadas a evidência de degradação no volume previsto.

### Próxima campanha Luna Medium

Esta rodada fez inspeção estática do código, das asserções e do estado Git. As novas suítes ainda aguardam execução. Os 138 testes da seção anterior são evidência da versão anterior à correção do diálogo. O backend segue com o diagnóstico ambiental anterior de `os.userInfo()` em Node v24.15.0. O bloqueio não foi reavaliado nesta rodada. Usar o terminal PowerShell interativo e o Node compatível (`>=24.15.0`), com a sonda da campanha anterior antes do comando backend. Se o ambiente continuar bloqueado, manter os resultados unitários pendentes.

```powershell
# A partir de app
$env:NODE_ENV = 'test'
node --test --test-reporter=spec --test-name-pattern='confirmação de revogação durante atualização|equipe maior|concessão tardia de A' tests/roleRoutingIntegration.test.cjs
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs
node --check tests/roleRoutingIntegration.test.cjs

# A partir de backend, em outro terminal
$env:NODE_ENV = 'test'
node -e "require('node:os').userInfo(); console.log('os.userInfo OK')"
# Executar o runner somente se a sonda retornar exit code 0.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts test/unit/admin-role-management-http.test.ts
.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit
npm.cmd run typecheck:test

# Raiz do repositório
git diff --check
git --no-optional-locks diff --cached --exit-code
```

A ADMIN-06 aguarda a revalidação automatizada antes da homologação no Expo. A branch é `feature/admin-event-operations`, HEAD `5758fe1`, com índice vazio e as alterações preexistentes preservadas.




## Nova campanha de validação pós-auditoria — Luna Medium

### Preparação e segurança

A campanha foi executada em `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`. O índice real estava vazio antes da execução. Os testes frontend foram inspecionados e executados com `NODE_ENV=test`; os harnesses usam transporte/fixtures simulados. Não houve acesso ao Neon, PostgreSQL, migrations ou seeds.

### Casos focados de revogação

Comando executado em `app`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec --test-name-pattern='ADMIN-06: ' tests/roleRoutingIntegration.test.cjs
```

Resultado: **22 testes selecionados; 21 aprovados, 1 reprovado, 0 ignorados; exit code 1**. Passaram os cinco estados do diálogo de revogação durante a atualização (ativo, vínculo ausente, substituído pelo mesmo e-mail, falha recuperável/retry e troca de sessão), além dos cenários de concorrência, resposta tardia entre eventos e continuidade da sessão. O cenário de equipe com 80 integrantes falhou, descrito abaixo.

### Regressão frontend completa

Comando executado em `app` com `NODE_ENV=test`, conforme a campanha ampla documentada acima: `node --test --test-reporter=spec @suites`, onde `$suites` continha os 18 arquivos de teste frontend listados no relatório.

Resultado: **402 testes; 401 aprovados, 1 reprovado, 0 ignorados; exit code 1**. As 18 suítes foram passadas ao runner; não houve skips por ausência do harness. A regressão cobriu os fluxos ADMIN-01 a ADMIN-06, autenticação/TOTP, Staff, Participante, splash e cliente HTTP pelos arquivos dessa lista.

Falha única: `ADMIN-06: equipe maior mantém formulário e ações nominais na mesma rolagem`, em `app/tests/roleRoutingIntegration.test.cjs:1121`, assertion na linha 1147. O teste abre a confirmação do último dos 80 vínculos, toca **Cancelar**, confirma que o diálogo fechou e verifica um GET de equipe; falha em `assert.equal(rig.requests.some(request => request.method === 'POST'), false)` (`true !== false`). Reproduzida isoladamente com:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec --test-name-pattern='equipe maior mantém formulário' tests/roleRoutingIntegration.test.cjs
```

Resultado isolado: **1 reprovado, exit code 1**. A fixture grava em `rig.requests` todas as requisições encaminhadas pelo transporte simulado, mas a assertion não registra nem limita a rota do POST encontrado. Portanto, está confirmado que houve um POST no transporte do harness; não está identificado por essa falha se ele foi a mutação Staff que o teste pretende excluir ou outra requisição da inicialização. A causa mais provável é a assertion global contar POST fora da operação de revogação, mas isso permanece hipótese até que a rota seja observada. Não houve mudança em implementação ou teste nesta campanha.

Avisos apresentados: `react-test-renderer is deprecated`; avisos do React Navigation sobre screens nomeadas `default`; e aviso Node `MODULE_TYPELESS_PACKAGE_JSON` ao importar `app/services/staffOperationsService.js`, com custo de reparse ESM. Não causaram outras falhas.

### Testes backend e sonda ENOMEM

Foi executada uma única sonda, em `backend`, com Node v24.15.0:

```powershell
$env:NODE_ENV = 'test'
node -e 'try { require(`node:os`).userInfo(); console.log(`os.userInfo OK em Node ${process.version}`); } catch (e) { console.error(JSON.stringify({node: process.version, code: e.code, uvCode: e.info?.code, syscall: e.info?.syscall})); process.exitCode = 1; }'
```

A sonda terminou com exit code 1: `ERR_SYSTEM_ERROR`, `ENOMEM`, `uv_os_get_passwd`. Conforme a condição da campanha, os testes unitários `admin-configuration.test.ts`, `admin-configuration-http.test.ts` e `admin-role-management-http.test.ts` **não foram iniciados**: 0 aprovados, 0 falhos por assertion, 0 ignorados. Os testes HTTP simulados e o teste adicional de autorização do GET Staff permanecem pendentes de execução; nenhuma evidência de backend aprovado é atribuída a esta campanha. A integração com PostgreSQL real também não foi executada nem autorizada.

### Verificações estáticas

- Typecheck de produção (executado em `backend`): `.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit` — exit code 0.
- Typecheck dos testes: `npm.cmd run typecheck:test` — exit code 0.
- `node --check` em `roleRoutingIntegration.test.cjs`, `adminEventStaff.test.cjs`, `adminEventSetup.test.cjs`, `adminNavigation.test.cjs`, `adminRealEvents.test.cjs`, `auth.test.cjs`, `staffRealNavigation.test.cjs` e `httpClientTimeout.test.cjs`, no diretório `app` — todos exit code 0.
- Uma tentativa inicial desses oito `node --check` foi feita por engano no diretório `backend`, com paths relativos a `app`; todos retornaram `MODULE_NOT_FOUND` (exit code 1). A repetição no diretório correto passou; a falha inicial não representa erro de sintaxe.
- `git diff --check` — exit code 0. Git emitiu somente avisos de conversão LF/CRLF em arquivos rastreados já modificados.
- `git --no-optional-locks diff --cached --exit-code` — exit code 0, sem alterações staged.

### Limitações e parecer

A campanha simulada não valida PostgreSQL real, Expo/React Native em aparelho, rota retida na pilha nativa, rolagem física com teclado/fontes ampliadas, nem desempenho real da lista. O runner backend permanece bloqueado pela falha ambiental da sonda.

**Parecer: necessita correções/diagnóstico antes da homologação manual.** A única falha frontend é a assertion ampla do teste de equipe com 80 integrantes; o método/rota do POST encontrado precisa ser identificado, preservando a garantia de que cancelar não envia revogação. A campanha não permite concluir se há defeito funcional ou somente escopo de assertion inadequado. Não modificar a assertion para forçar aprovação. Reexecutar a campanha automatizada depois que a causa for diagnosticada. Os limites de tela nativa e volume continuam reservados à homologação Expo.

## Diagnóstico e correção do teste de equipe com 80 integrantes

Na campanha anterior, o frontend registrou 401 aprovações em 402 testes, com uma falha também reproduzida no teste isolado. A asserção `rig.requests.some(request => request.method === 'POST')` consultava o histórico acumulado desde a montagem e falhava mesmo sem uma revogação. **Classificação: defeito no teste.** A restauração legítima da sessão já coloca `POST /api/v1/auth/refresh` nesse histórico antes de a equipe ser aberta.

A origem foi identificada por rastreamento estático. `structureIntegration` fornece uma credencial persistida ao harness. Ao montar a árvore, `AuthProvider` chama `restoreSession()` (`app/context/AuthContext.js:58`). O gerenciador começa sem token de acesso, chama `refreshSession()` (`app/services/authService.js:792`) e envia `POST /auth/refresh` (`app/services/authService.js:504`). O cliente usa o prefixo `/api/v1` e seu `fetchImpl` simulado encaminha a chamada para `control.http`. A fixture registra método, rota e corpo em `rig.requests` antes de devolver a chamada ao transporte de autenticação simulado (`app/tests/roleRoutingIntegration.test.cjs:75` e `:876`). O corpo contém apenas o campo `refreshToken`, cujo valor será omitido do diagnóstico. A chamada não tem `grantId`.

Na sequência, a autenticação lê `GET /api/v1/auth/me` e a navegação abre o evento, lê detalhe e prontidão e faz um `GET /api/v1/admin/events/:eventId/staff`. Selecionar o último vínculo grava a seleção no estado do diálogo. **Cancelar** chama `resolve(false)`, que limpa o diálogo e retorna antes de despachar qualquer ação (`app/screens/admin/AdminRealEventStaffScreen.js:159` e `:260`). A desmontagem de limpeza chama apenas `unmount()`. O fluxo examinado tem um POST de autenticação anterior ao cancelamento e zero POSTs acrescentados pelo cancelamento. Esses totais foram deduzidos da sequência do código. O teste ajustado registra os totais medidos na próxima execução.

### Ajustes e cobertura preparada

- `app/tests/roleRoutingIntegration.test.cjs` verifica o refresh na montagem e captura o histórico imediatamente antes de **Cancelar**. O diagnóstico do runner mostra método, pathname, nomes dos campos do corpo, contagem em cada etapa e `grantId` apenas quando a rota é de revogação. A asserção verifica os POSTs de concessão e revogação por método e rota, antes da ação e nas requisições acrescentadas por ela. Também verifica o fechamento do diálogo, os 80 botões acessíveis na mesma rolagem do formulário, a equipe simulada intacta após cancelar e um único GET de equipe nessa entrada.
- O mesmo teste seleciona o primeiro e o último vínculos separadamente. Cada confirmação explícita deve produzir exatamente um `POST /api/v1/admin/roles/revoke` com o `grantId` selecionado. O transporte simulado remove apenas o vínculo correspondente e a UI deve refletir o novo GET, preservando os demais integrantes.
- A matriz de concorrência agora verifica a concessão, a ausência de revogação durante o GET pendente e a ausência de novo POST ou reaparecimento do diálogo quando a resposta chega após cancelar. Também exige nova seleção para um vínculo substituído com o mesmo e-mail, confere o novo UUID e compara corpo e chave entre a tentativa de resultado incerto e seu reenvio explícito. As asserções leem as requisições registradas pelo transporte.

Esta rodada modificou o teste de integração e este relatório. A inspeção do fluxo identificou a origem do POST e sustentou a correção apenas no teste. A implementação e os contratos seguem como na campanha anterior. Os novos resultados ainda dependem da execução por Luna Medium.

### Revalidação pendente

Em `app`, executar os casos ajustados e as regressões diretas. Depois, repetir a campanha frontend de 18 arquivos registrada acima.

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec --test-name-pattern='equipe maior|confirmação de revogação durante atualização' tests/roleRoutingIntegration.test.cjs
node --test --test-reporter=spec tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs
```

Para os três arquivos unitários do backend já listados, usar um PowerShell interativo ou executor isolado com Node compatível (`>=24.15.0`). Executar primeiro a sonda sanitizada de `os.userInfo()` registrada acima. Prosseguir com o `tsx` somente quando a sonda terminar com exit code 0. A falha `uv_os_get_passwd returned ENOMEM` permanece registrada como bloqueio ambiental da última campanha. Esta rodada não executou testes, sonda ou integrações com banco. Rolagem física, teclado e foco nativo continuam pendentes de homologação no Expo.

## Revalidação da correção do teste de revogação

Na campanha anterior a este ajuste visual, o caso isolado de equipe extensa passou com 1 teste aprovado, nenhum reprovado ou ignorado, exit code 0. O diagnóstico registrou um POST de refresh antes de cancelar e nenhum POST depois. A campanha frontend de 18 arquivos registrou 403 aprovados, nenhum reprovado ou ignorado, exit code 0. Os dois typechecks backend, oito verificações de sintaxe e `git diff --check` passaram. Os testes unitários backend continuaram pendentes devido ao diagnóstico ambiental de `os.userInfo()`. Esses resultados antecedem o ajuste visual descrito a seguir.

## Ajuste visual dos integrantes Staff

O card de cada integrante elegível exibe nome, e-mail e ação de revogação. A remoção da linha redundante de acesso reduz a altura do card e aproxima os elementos restantes, sem alterar o estilo compartilhado. Para contas inelegíveis, o aviso `Vínculo ativo · conta inelegível` continua visível. A consulta e as operações Staff mantêm seus contratos.

Arquivos desta rodada: `app/screens/admin/AdminRealEventStaffScreen.js`, `app/tests/roleRoutingIntegration.test.cjs` e este relatório. As asserções preparadas verificam a ausência do texto removido tanto na equipe elegível quanto na inelegível, e a preservação do aviso na conta inelegível. A campanha automatizada desta versão fica para Luna Medium. A conferência visual e a homologação da ADMIN-06 continuam pendentes no Expo.

## Revalidação após ajuste visual dos cards Staff — Luna Medium

### Preparação

A validação ocorreu na branch `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`. O índice estava vazio antes da campanha. Foram lidas as instruções de `AGENTS.md`, o histórico deste relatório e as assertions alteradas em `app/tests/roleRoutingIntegration.test.cjs`. O ajuste visual sob teste remove a linha redundante `Acesso ativo` para integrantes elegíveis e conserva `Vínculo ativo · conta inelegível` para contas inelegíveis.

### Testes focados

Executado em `app` com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec --test-name-pattern='equipe persistida reaparece|equipe maior mantém' tests/roleRoutingIntegration.test.cjs
```

Resultado: **2 testes aprovados, 0 falhos, 0 ignorados; exit code 0**. O cenário de listagem persistida confirmou o aviso de inelegibilidade e a ausência de `Acesso ativo`. O caso de 80 integrantes confirmou que ambos os textos estão ausentes nessa lista elegível, mantendo formulário e ações na mesma rolagem. A confirmação de revogação e as requisições de leitura também foram exercitadas nesses fluxos.

### Regressão frontend completa

Executado em `app` com `NODE_ENV=test` nas 18 suítes documentadas:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/httpClientTimeout.test.cjs tests/apiConfig.test.cjs tests/auth.test.cjs tests/authNavigation.test.cjs tests/authVisualIntegration.test.cjs tests/adminEventStaff.test.cjs tests/adminEventSetup.test.cjs tests/adminEventStructure.test.cjs tests/adminEventSettings.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/roleRoutingIntegration.test.cjs tests/participationService.test.cjs tests/participationProvider.test.cjs tests/questionnaire.test.cjs tests/staffRealNavigation.test.cjs tests/staffOperationsService.integration.test.cjs tests/splashScreen.test.cjs
```

Resultado: **403 testes aprovados, 0 falhos, 0 ignorados; exit code 0**. O runner executou as 18 suítes. Os cenários de listagem persistente, estados inelegíveis, confirmação/cancelamento de revogação e lista extensa passaram. A suíte cobre ainda as regressões Admin, autenticação, Staff e Participante enumeradas no comando. Nenhum acesso ao Neon/PostgreSQL, migration ou seed ocorreu.

Avisos observados: `react-test-renderer is deprecated` e avisos do React Navigation sobre componentes de tela nomeados `default`. Não impediram a execução nem causaram falha.

### Verificações estáticas

- Backend produção (diretório `backend`): `.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit` — exit code 0.
- Backend testes (diretório `backend`): `npm.cmd run typecheck:test` — exit code 0.
- Sintaxe JavaScript no diretório `app`, oito arquivos (`roleRoutingIntegration.test.cjs`, `adminEventStaff.test.cjs`, `adminEventSetup.test.cjs`, `adminNavigation.test.cjs`, `adminRealEvents.test.cjs`, `auth.test.cjs`, `staffRealNavigation.test.cjs`, `httpClientTimeout.test.cjs`): `node --check` individual para cada arquivo — 8/8 aprovados, exit code 0.
- Raiz: `git diff --check` — exit code 0. Foram exibidos avisos de conversão LF para CRLF em arquivos preexistentes; nenhum erro de whitespace.
- Raiz: `git --no-optional-locks diff --cached --exit-code` — exit code 0, índice sem alterações staged.

### Backend unitário/HTTP e limitações

Os testes unitários/HTTP do backend **não foram executados**. O relatório já registra que a sonda isolada `os.userInfo()` falhou no Node v24.15.0 com `ERR_SYSTEM_ERROR`, `ENOMEM` e `uv_os_get_passwd`; esta campanha não repetiu a sonda nem tentou contornar o bloqueio. Portanto, 0 testes backend aprovados, 0 falhos por assertion e 0 ignorados: a execução permaneceu pendente por impedimento ambiental, e não é evidência de falha funcional. A integração PostgreSQL real e a homologação física no Expo também não foram executadas nesta campanha.

### Estado Git e parecer

Após a campanha, o único arquivo alterado por esta rodada é `docs/ADMIN_06_IMPLEMENTACAO.md`; as alterações preexistentes da ADMIN-06 foram preservadas. Branch `feature/admin-event-operations`, HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298`, índice real vazio. Não houve edição de implementação ou testes, staging, commit ou push.

**Parecer da campanha: frontend e verificações estáticas aprovados para esta revalidação; backend unitário/HTTP continua pendente por bloqueio ambiental e a homologação no Expo permanece necessária. A ADMIN-06 não está declarada definitivamente aprovada ou homologada.**

## Consolidação das evidências de homologação e validação

Esta seção consolida resultados já obtidos na ADMIN-06. A campanha frontend foi executada pelo Codex com GPT-6 Luna Medium. O responsável executou o backend no PowerShell local e informou os resultados das duas rodadas manuais no Expo Go. A consolidação foi exclusivamente documental.

### Frontend após a remoção de “Acesso ativo”

A campanha executou 18 suítes após o ajuste visual dos cards Staff. Foram **403 testes aprovados, 0 reprovados, 0 ignorados e exit code 0**. Os typechecks de produção e de testes, as oito verificações `node --check` e o `git diff --check` também passaram, todos com exit code 0.

Os avisos de depreciação de `react-test-renderer`, de telas simuladas chamadas `default` no React Navigation e de conversão LF/CRLF em arquivos modificados não causaram falhas. Os cenários simulados conferiram listagem persistida, confirmação e cancelamento de revogação e rolagem compartilhada com o formulário em uma equipe de 80 integrantes. O aviso `Vínculo ativo · conta inelegível` segue preservado para vínculos ativos de contas inelegíveis. O teste com 80 integrantes usou dados simulados e não mediu desempenho em aparelho com uma equipe real desse tamanho.

### Backend executado pelo responsável no PowerShell

O responsável informou que executou os testes com Node.js v24.15.0 em `C:\Program Files\nodejs\node.exe`. A sonda `os.userInfo()` funcionou nesse terminal, onde o erro `uv_os_get_passwd returned ENOMEM` não ocorreu. As campanhas anteriores da Luna registraram o erro na sonda no ambiente original e, nesse ambiente, a execução dos testes ficou bloqueada. As execuções locais demonstram que o backend pode ser testado no PowerShell do responsável. O ambiente original da Luna permanece sem nova confirmação. O `ENOMEM` observado é um bloqueio do ambiente de execução.

| Execução | Total | Aprovados | Reprovados | Ignorados | Exit code |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Suíte geral via `npm.cmd test` em `backend` | 1.298 | 1.296 | 2 | 0 | 1 |
| Seleção de gestão de permissões e fixture | 43 | 43 | 0 | 0 | 0 |
| Seleção de configuração administrativa e listagem Staff | 150 | 150 | 0 | 0 | 0 |

Os conjuntos selecionados têm arquivos distintos entre si. São recortes de validação reportados separadamente e não são adicionados à contagem da suíte geral.

#### Duas falhas da suíte geral em E08.11

As falhas ocorreram em `backend/test/unit/evaluation-write-http.test.ts`:

- `E08.11 HTTP submit responde contrato e usa somente ator autenticado`.
- `E08.11 HTTP edit responde contrato e usa somente ator autenticado`.

A causa provável é a incompatibilidade entre `EVALUATION_IDEMPOTENCY_TTL_SECONDS=86400` (24 horas), informado para o ambiente local, e a janela de aproximadamente 60 segundos exigida pela asserção compartilhada no [teste](../backend/test/unit/evaluation-write-http.test.ts#L47). A [política de avaliações](../backend/src/evaluations/evaluation-write.controller.ts#L14) usa o TTL configurado para calcular `expiresAt`, e o [parser de TTL](../backend/src/common/http/idempotency-ttl.ts#L2) converte segundos em milissegundos. Essa leitura sustenta o diagnóstico provável, que segue sem correção ou revalidação. E08.11 pertence ao módulo de avaliações, fora do escopo funcional direto da gestão Staff. As duas falhas permanecem no resultado da suíte geral.

#### Arquivos dos conjuntos selecionados

Gestão de permissões e fixture, com caminhos relativos a `backend`:

- `test/unit/admin-role-management.test.ts`
- `test/unit/admin-role-management-http.test.ts`
- `test/unit/admin-role-management-service.test.ts`
- `test/unit/admin-role-management-db-guard.test.ts`
- `test/unit/admin06-neon-test-fixture.test.cjs`

Configuração administrativa e listagem Staff:

- `test/unit/admin-configuration-http.test.ts`
- `test/unit/admin-configuration.test.ts`

Para `GET /api/v1/admin/events/:eventId/staff`, o [teste HTTP](../backend/test/unit/admin-configuration-http.test.ts#L115) passa pelo serviço de consulta com autenticação e executor SQL simulados. Confere que a autorização usa os dados do principal autenticado e recusa Admin com e-mail não verificado, Admin sem TOTP e Staff sem papel Admin antes de revelar se o evento existe. Também verifica o retorno vazio para evento existente autorizado, o `404` de evento ausente e o cabeçalho `Cache-Control: no-store` no contrato da rota.

O [teste de consulta](../backend/test/unit/admin-configuration.test.ts#L183) verifica o UUID parametrizado, os filtros de evento, papel Staff e vínculo não revogado, a ordenação por data e ID e a transação somente leitura. A projeção mantém o `grantId` da concessão e o indicador `eligible: false` na lista simulada, sem devolver campos privados. As asserções inspecionam o SQL e os resultados de fixtures. A execução dos predicados com dados reais requer a campanha de integração PostgreSQL.

### Homologação manual no Expo Go informada pelo responsável

#### Primeira rodada, persistência de vínculos no Neon de desenvolvimento

**8/8 verificações aprovadas**, conforme informado pelo responsável.

1. Recuperar Staff previamente concedido.
2. Sair da tela e retornar mantendo a listagem.
3. Reiniciar o Expo e recuperar a listagem.
4. Cancelar a revogação e manter o vínculo.
5. Confirmar a revogação.
6. Sair e retornar para confirmar que a revogação persistiu.
7. Conceder Staff novamente após a revogação.
8. Impedir concessão duplicada e apresentar a mensagem de acesso já concedido.

#### Segunda rodada, conferência visual e de interação

**5/5 verificações aprovadas**, conforme informado pelo responsável.

1. Conferir o visual sem a linha redundante “Acesso ativo”.
2. Rolar a equipe.
3. Conferir o comportamento com teclado aberto.
4. Navegar e retornar à tela.
5. Abrir e cancelar a confirmação de revogação.

### Limitações e conclusão técnica

Os cenários executados validam a consulta, a concessão e a revogação de Staff por evento. A campanha frontend e os conjuntos selecionados do backend passaram, assim como as duas rodadas manuais no Expo Go. A homologação manual da primeira rodada verificou operações reais no Neon de desenvolvimento. Os testes unitários e HTTP usaram dependências simuladas. As duas evidências cobrem aspectos complementares, e a campanha automatizada de integração com PostgreSQL real permanece pendente.

A avaliação física de uma equipe com 80 integrantes continua sem evidência. As duas falhas de E08.11 na suíte geral aguardam tratamento separado. A aprovação formal da ADMIN-06 e a decisão sobre procedimentos Git aguardam manifestação expressa do responsável.

## Registro final da campanha de integração PostgreSQL

**Integração PostgreSQL executada e aprovada pelo responsável: 47/47.** Este registro encerra a pendência de execução mencionada na consolidação anterior. O responsável realizou a preparação, a execução e as conferências no PowerShell local. Esta rodada do Codex registrou as evidências informadas.

### Ambiente e verificações anteriores à execução

- PostgreSQL local **18.6**, em `127.0.0.1:55432`, com banco e papel dedicados `arenago_roles_test`. O papel não tinha privilégios de superusuário, criação de bancos ou criação de papéis.
- O banco foi criado vazio, com o acesso de `PUBLIC` revogado. A conexão foi autenticada com o papel proprietário.
- O Drizzle aplicou as oito migrations do checkout atual, de `0001_identity_profile` a `0008_external_entry_calls`, com exit code 0. O histórico PostgreSQL confirmou oito migrations registradas.
- `backend/.env` foi preservado, incluindo a configuração Neon de desenvolvimento.

Antes dos testes, o responsável confirmou por consultas SQL somente leitura a identidade do servidor local, a porta, o banco e o usuário conectado. As tabelas `users`, `events` e `user_roles` existiam e o histórico registrava oito migrations. As contagens de usuários, eventos e papéis eram zero. A contagem de concessões Admin também era zero, incluindo concessões revogadas.

### Execução e cobertura

O responsável executou exclusivamente `test/integration/admin-role-management.integration.test.ts` a partir de `backend`, com Node.js local compatível e concorrência de teste igual a 1. O processo usou `NODE_ENV=test` e `DOTENV_CONFIG_PATH=NUL`. `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL` apontavam para a mesma URI local dedicada. As configurações de envio de e-mail externo foram retiradas temporariamente do processo. As variáveis de ambiente originais foram restauradas ao final.

| Executados | Aprovados | Reprovados | Ignorados | Exit code | Duração |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 47 | 47 | 0 | 0 | 0 | Aproximadamente 5,99 s |

- Os testes de permissões conferem concessão e revogação lógica, efeitos persistidos por evento, preservação de outros escopos, autoria e instante da auditoria, duplicidade, replay idempotente, concorrência e rollback de papel, auditoria e intenção idempotente. Referências na suíte: [concessão](../backend/test/integration/admin-role-management.integration.test.ts#L237), [rollback](../backend/test/integration/admin-role-management.integration.test.ts#L432), [revogação e auditoria](../backend/test/integration/admin-role-management.integration.test.ts#L511) e [preservação de escopos](../backend/test/integration/admin-role-management.integration.test.ts#L769).
- O cenário de `GET /api/v1/admin/events/:eventId/staff` confere a leitura de vínculos ativos persistidos, incluindo contas inelegíveis, exclui vínculos revogados e de outro evento e verifica o `grantId` persistido, o cabeçalho `Cache-Control: no-store` e as recusas para participante, Staff e Admin sem segundo fator. Usa o `grantId` da listagem para revogar um vínculo inelegível e confirma a remoção na requisição seguinte. [Cenário de integração do GET Staff](../backend/test/integration/admin-role-management.integration.test.ts#L193).

### Conferência posterior do PostgreSQL

O responsável informou as seguintes contagens, obtidas por consultas somente leitura após a execução:

| Entidade | Registros |
| --- | ---: |
| Usuários | 0 |
| Eventos | 0 |
| Papéis | 0 |
| Concessões Admin | 0 |
| Auditorias | 0 |
| Operações de idempotência | 0 |
| Épocas de idempotência Staff | 0 |

O histórico das oito migrations permaneceu preservado. As contagens indicam ausência de resíduos nas tabelas verificadas. As consultas se limitaram às entidades listadas. O banco dedicado permanece disponível para futuras campanhas.

### Estado consolidado e limitações

| Evidência | Resultado |
| --- | --- |
| Frontend após o ajuste visual | 403/403 aprovados |
| Backend unitário e HTTP selecionado | 43/43 e 150/150 aprovados |
| Integração automatizada PostgreSQL real | 47/47 aprovados |
| Homologação manual no Expo Go | 8/8 funcionais e 5/5 complementares aprovados |

- A suíte geral do backend permanece com **1.296/1.298 aprovados**, duas falhas em E08.11 e exit code 1. A divergência entre o TTL configurado e a expectativa dos testes segue como causa provável, pendente de tratamento separado.
- O cenário com 80 integrantes foi simulado. A avaliação de desempenho em aparelho com 80 Staff reais permanece pendente.
- Na integração do GET Staff, a fixture insere os vínculos iniciais diretamente. Continuam sem cobertura direta nesse cenário o fluxo único de conceder via HTTP, listar, revogar e listar novamente, a lista vazia em evento existente, o desempate com horários de concessão iguais, a leitura após reiniciar a aplicação e a comparação das recusas para Admin com e-mail não verificado em eventos existentes e inexistentes. Parte do contrato já tem cobertura HTTP simulada.

A campanha técnica de integração PostgreSQL está concluída. A **aprovação formal da ADMIN-06** permanece sob decisão expressa do responsável.

## Correções complementares de E08.11 e da cobertura do GET Staff

A revisão complementar isolou o TTL e o relógio dos dois casos HTTP de E08.11. A mudança pertence à suíte do módulo de avaliações. Foram preparados seis testes PostgreSQL adicionais do GET Staff para o fluxo HTTP de concessão e revogação, equipe vazia, ordenação com empate, persistência em nova instância, recusa do Admin sem e-mail verificado e recuperação de 80 vínculos sintéticos. [Diagnóstico, cobertura e comandos de validação](./ADMIN_06_CORRECOES_COMPLEMENTARES.md).

Os resultados históricos de 47/47 da integração PostgreSQL e de 1.296/1.298 da suíte geral permanecem registrados. A execução da suíte geral após a correção de E08.11 e a validação dos seis casos adicionais continuam pendentes. A integração exige nova autorização para o banco local dedicado. O diagnóstico de latência do GET com 80 vínculos não mede desempenho da interface em aparelho. A aprovação formal da ADMIN-06 permanece sob decisão do responsável.

### Correções após auditoria independente

Após a correção de E08.11 e antes deste ajuste da guarda, o responsável informou **1.298/1.298** aprovados em `npm.cmd test` e exit code 0 em `npm.cmd run typecheck:test`. Nesta rodada, a pré-verificação passou a conferir a sessão PostgreSQL, os atributos da role, o schema, o journal e a ausência de Admins históricos antes de iniciar o Nest. A contagem estática reconciliada é **53 casos previstos**, com os 47 históricos preservados e seis novos. Passaram 18 testes da guarda, 89 testes HTTP simulados e o typecheck de testes. [Detalhes, comandos, limites e procedimento para nova campanha](./ADMIN_06_CORRECOES_COMPLEMENTARES.md#correções-após-auditoria-independente).

A integração real desta versão continua pendente. Sua execução depende de conferência independente do processo que atende `127.0.0.1:55432` e de autorização específica. A ADMIN-06 segue sem aprovação formal.

## Consolidação final das correções complementares

O responsável executou a suíte geral do backend via `npm.cmd test` no PowerShell local após o reforço da guarda. Os dois casos de E08.11, corrigidos com TTL controlado e relógio fixo nos testes, passaram sem reincidência. Os resultados gerais de 1.296/1.298 e 1.298/1.298, assim como os 47/47 da primeira integração PostgreSQL, permanecem no histórico das campanhas anteriores.

| Campanha final executada pelo responsável | Executados | Aprovados | Falhas | Ignorados | Exit code | Duração total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Suíte geral do backend | 1.312 | 1.312 | 0 | 0 | 0 | Aproximadamente 18,48 s |
| Integração PostgreSQL ampliada | 53 | 53 | 0 | 0 | 0 | Aproximadamente 4,90 s |

A Luna Medium confirmou por inspeção as consultas somente leitura anteriores à inicialização do Nest, a verificação da identidade e dos privilégios da conexão, o bloqueio antes de escritas e a liberação de recursos em caso de falha. A revisão confirmou a preservação dos 47 casos históricos e a adição de seis. O parecer liberou a execução mediante conferência operacional do servidor local.

O responsável identificou o listener `127.0.0.1:55432` no processo `postgres` de PID `9144`. O `netsh interface portproxy show all` não exibiu entradas. O caminho do executável não foi exibido, e a conferência não exclui todas as formas de encaminhamento. Em ambiente isolado, o responsável executou somente `test/integration/admin-role-management.integration.test.ts`, com as três URLs apontando para `127.0.0.1:55432/arenago_roles_test`, e restaurou as variáveis originais ao final. Passaram os seis casos adicionais do GET Staff: ciclo de concessão e revogação, equipe vazia, ordenação determinística, persistência em nova instância Nest, recusa de Admin sem e-mail verificado e listagem de 80 vínculos sintéticos persistidos. Os 4,90 s medem a suíte inteira.

Após a integração, o responsável confirmou o banco e o usuário `arenago_roles_test` com consultas em transação `READ ONLY`, encerrada com `ROLLBACK`. As consultas registraram zero usuários, eventos, papéis, auditorias, operações de idempotência, épocas de idempotência Staff e concessões Admin, inclusive revogadas. Permaneceram registradas as oito migrations. A ausência de resíduos se restringe às tabelas consultadas. [Evidências detalhadas no relatório complementar](./ADMIN_06_CORRECOES_COMPLEMENTARES.md#consolidação-final-da-campanha-complementar).

As campanhas técnicas planejadas foram concluídas com sucesso. Estão encerradas as pendências de E08.11, da cobertura adicional do GET Staff e do cenário automatizado de 80 vínculos persistidos. Continua sem medição o desempenho da interface em aparelho físico com 80 integrantes reais.

A ADMIN-06 está **tecnicamente apta à avaliação de aceite**. A entrega reúne **403/403 testes frontend**, **1.312/1.312 testes gerais do backend**, **53/53 testes de integração PostgreSQL** e a homologação funcional anterior no Expo Go com **8/8 verificações funcionais e 5/5 complementares**. A aprovação formal depende da manifestação expressa do responsável.
