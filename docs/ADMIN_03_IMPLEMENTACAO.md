# ADMIN-03 — Informações, Horários e QR Code

## Preparação

A implementação parte de `77a944b67b31a902bb20757b50c57737f9993c75` em `feature/admin-core-management`, com working tree e índice inicialmente limpos. Sol High é a recomendação para uma integração entre app e backend com concorrência transacional. A campanha automatizada fica para Luna Medium conforme a política do repositório.

A referência anexada orienta o cabeçalho, o resumo do evento e os três grupos da tela. A tarefa substitui apenas o destino Informações e horários da ADMIN-02. Criação, experiências, concessões, encerramento e BI ficam para as tasks correspondentes.

## Contratos e plano inicial

O detalhe Admin já contém código, fuso e programação, sem local, descrição ou indicador de participações históricas. A prontidão vem da consulta existente. A renomeação usa o PATCH de configuração com idempotência e bloqueio de histórico. O PATCH de programação existente usa justificativa, idempotência, lock no evento, relógio PostgreSQL e auditoria. Falta suporte a corrigir o início. A extensão planejada adiciona o início opcional e uma proteção contra edição de programação desatualizada, preservando o contrato legado.

O painel, a navegação, os componentes Admin, o cliente autenticado e o controle da sessão serão reutilizados. O formulário terá salvamentos separados de nome e programação, seletores nativos no celular e adaptação web. O QR será produzido localmente a partir do código persistido, após conferir o leitor Participante. A ação de cópia exige suporte da plataforma.

Serão preparados testes com mocks para navegação, formulário, contratos HTTP, datas, sessão e QR. A decisão do backend será coberta por testes de contrato e serviço. Uma campanha PostgreSQL para concorrência real exige autorização específica.

## Implementação

O primeiro card do painel abre a tela funcional na rota contextual da ADMIN-02 com o UUID selecionado. Os quatro destinos restantes continuam informativos. A tela reaproveita `AdminLiveScreen`, `AdminSelectedEvent`, tema, componentes de ação e a reconsulta ao recuperar foco. O cabeçalho mantém o logo, o logout, o retorno ao painel e as abas Admin. Os dados vêm do detalhe `GET /api/v1/admin/events/:eventId` e da prontidão `GET /api/v1/admin/events/:eventId/readiness`. A tela informa que a possibilidade de edição será confirmada ao salvar porque o detalhe não fornece histórico de participações.

- **Informações gerais:** abre em consulta. A edição salva somente o nome por `PATCH /api/v1/admin/events/:eventId`, com a validação de 180 caracteres e a guarda de histórico e encerramento existentes no backend. Um 409 por histórico bloqueia novas tentativas de renomear na tela corrente.
- **Datas e horários:** início antes do horário vigente, término oficial e margem operacional de 0 a 60 minutos. A tela combina data e hora no fuso IANA do evento e converte para UTC. Valores novos em horários locais ambíguos ou inexistentes são rejeitados. Horários não editados preservam a precisão do servidor. São usados seletores nativos no iOS e Android e campos com validação de formato na web. A edição mostra o prazo operacional previsto e exige justificativa. O fuso é somente leitura.
- **Acesso:** o código persistido é somente leitura. A ação Copiar usa o clipboard incluído na versão local do React Native no celular e o clipboard do navegador na web, com seleção manual como alternativa. O QR codifica o código canônico ASCII em texto puro, aceito por `validateAndNormalizeQrCode` do Participante. Usa `toqr` 0.1.1, já presente no lockfile, agora declarado diretamente. O modal gera a matriz localmente e usa fundo branco com margem de quatro módulos.

Nome e programação têm salvamentos separados, sem transação entre os dois grupos. Escritas usam o cliente autenticado com chave de idempotência e bloqueio de submissões simultâneas. Falhas ou respostas não confirmadas levam à reconsulta do detalhe e da prontidão. Timeout não dispara novo PATCH. A resposta só pode atualizar a tela no escopo vigente de UUID, conta e sessão. Falhas 401/403/404 ocultam dados protegidos. Voltar com alterações abertas exige confirmação. A troca da árvore autenticada no logout e na revogação encerra a edição.

## Contrato de programação e concorrência

`PATCH /api/v1/admin/events/:eventId/schedule` preserva os campos legados `officialEndsAt`, `operationalDeadlineAt` e `reason`. A extensão inclui `startsAt` opcional e `expectedUpdatedAt`, obrigatório ao enviar início ou precisão estendida. A versão é o `updatedAt` de seis casas retornado pelo detalhe. O cliente envia a versão também nas edições de término e prazo. Alterações com instantes persistidos de seis casas preservam essa precisão em UTC. Código, fuso e campos de fechamento continuam fora do DTO. Uma resposta que inclui início confirma o valor correspondente ao UUID.

O backend obtém `events FOR UPDATE`, o mesmo lock obtido pelo ingresso do Participante, antes de revalidar a versão, o relógio PostgreSQL e a existência de qualquer participação do evento. O predicado de histórico considera todos os estados. Só uma mudança real de início depende de ausência de histórico e de o horário vigente e o proposto estarem no futuro. Os horários continuam sujeitos às invariantes do episódio E08.7, incluindo término futuro e posterior ao início, margem máxima de uma hora e bloqueio por encerramento. As guardas Admin/TOTP e a reserva de idempotência permanecem na transação. `EVENT_START_CHANGE_LOCKED` e `EVENT_SCHEDULE_STALE` são 409. A auditoria `event_schedule_changed` registra justificativa e valores anteriores e posteriores, incluindo o início quando enviado. Rejeições fazem rollback e operações sem mudança não geram auditoria. Sem migration.

## Arquivos

- App e contrato HTTP: `app/screens/admin/AdminEventSettingsScreen.js`, `AdminEventManagementInfoScreen.js`, `AdminRealEventScreen.js`, `adminScheduleForm.js`, `useAdminEventPanel.js`, `components/AdminEventAccess.js`, `components/AdminScheduleFields.js`, `components/AdminLiveUI.js`, `components/AdminSelectedEvent.js` e `app/services/adminEventsService.js`.
- Dependências: `app/package.json` e `app/package-lock.json`.
- Backend: `backend/src/events/admin-schedule.controller.ts`, `admin-schedule.dto.ts`, `admin-schedule.service.ts` e `admin-schedule.types.ts`.
- Testes: `app/tests/adminEventSettings.test.cjs`, `roleRoutingIntegration.test.cjs`, `helpers/questionnaireHarness.cjs`, `backend/test/unit/admin-schedule.test.ts` e `admin-schedule-http.test.ts`.
- Relatório: `docs/ADMIN_03_IMPLEMENTACAO.md`.

## Validação e pendências

Os testes preparados verificam navegação e UUID, consulta e edição, campos fixos, descarte, proteção de saída, envio único, falhas 401/403/404, conflito por participação ou versão, reconsulta, logout, fuso, margem e payload do QR. Os testes backend cobrem validação HTTP, preservação de precisão, guardas no SQL, ordem da decisão após o lock, bloqueios, rollback e auditoria. A concorrência em PostgreSQL real ainda precisa de validação em campanha dedicada e autorizada.

Inspeção estática com Babel e parser TypeScript, checagem dos imports locais, JSON e consistência do lockfile. `git diff --check` aprovado com avisos de LF/CRLF. A campanha automatizada, typechecks, testes em aparelho e homologação física do QR permanecem pendentes. Sugestão de revisão crítica do backend com Astra High antes de rodar a campanha Luna Medium.

```powershell
# Em app, com transporte simulado
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventSettings.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs

# Em backend, testes unitários e HTTP simulado, sem PostgreSQL
$env:NODE_ENV = 'test'
node --import tsx --test test/unit/admin-schedule.test.ts test/unit/admin-schedule-http.test.ts test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts
node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project tsconfig.test.json --noEmit --incremental false
```

O HEAD segue em `77a944b67b31a902bb20757b50c57737f9993c75` com as mudanças no working tree e índice vazio. O changes será gerado após validação automatizada, revisão visual e aprovação do responsável.

## Primeira campanha de validação — Luna Medium

Ambiente: GPT-6 Luna, seleção manual informada pelo responsável; Windows PowerShell; Node.js `v24.15.0`; sem banco, API ou serviço remoto. O working tree da implementação foi preservado. O relatório registra a campanha, sem atribuir os resultados a uma execução em aparelho ou PostgreSQL real.

### Frontend

Executado em `app` com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventSettings.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Exit code `0`: 80 testes aprovados, 0 reprovados, 0 ignorados, 80 totais. Foram exercitados grupos e navegação, consulta e edição de nome, descarte, confirmação de resposta persistida, conflito 409, bloqueio de nome, horários em fuso IANA e em meia-noite, horários locais inexistentes/ambíguos, precisão, margem, sessão e logout, campos imutáveis, cópia e geração do QR com payload aceito pelo parser do Participante, além das regressões ADMIN-01/02.

A execução emitiu avisos do `react-test-renderer` depreciado e de componentes substitutos de tela nomeados `default`. Não causaram reprovação.

### Backend

Executado em `backend` com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
node --import tsx --test test/unit/admin-schedule.test.ts test/unit/admin-schedule-http.test.ts test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts
```

Exit code `1`. Node v24.15.0 lançou `SystemError [ERR_SYSTEM_ERROR]` durante o bootstrap de `tsx`: `uv_os_get_passwd returned ENOMEM (not enough memory)`, em `node:os:306`, chamada `Object.userInfo`, importada por `backend/node_modules/tsx/dist/client-XItNFmsq.cjs:1:198`. O runner listou quatro arquivos como falhos na inicialização (`admin-configuration-http.test.ts`, `admin-configuration.test.ts`, `admin-schedule-http.test.ts`, `admin-schedule.test.ts`), mas **nenhum caso de teste foi executado**. Isso é um bloqueio ambiental, não evidência de falha funcional. A suíte requer reexecução no terminal Windows apropriado.

### Typechecks e verificações estáticas

Em `backend`, ambos terminaram sem saída ou diagnóstico e com exit code `0`:

```powershell
node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project tsconfig.test.json --noEmit --incremental false
```

Também foram executados `node --version` (`v24.15.0`), verificação da correspondência de `toqr` em `app/package.json`, lockfile e instalação (`0.1.1`, consistente), busca do conteúdo do QR e do parser Participante, e `git diff --check` (exit code `0`). Git emitiu somente avisos informativos de conversão LF/CRLF. A inspeção confirmou que o QR envia o código de acesso em texto puro, aceito por `validateAndNormalizeQrCode`.

### Resultado e limitações

O frontend e os dois typechecks passaram. A suíte backend permanece sem resultado funcional por falha ambiental antes da execução dos casos. Os testes de serviço usam mocks e não comprovam concorrência real, locks ou auditoria em PostgreSQL. QR, seletores e layout ainda dependem de testes físicos em iOS/Android e conferência visual. Aprovação formal permanece pendente. Não foi gerado changes nem realizado staging.

## Auditoria técnica de concorrência e segurança da ADMIN-03

**Conclusão.** A edição do início e o primeiro ingresso se serializam na mesma linha de `events`. Nos caminhos de aplicação examinados, o PATCH não consegue mudar o início depois de um ingresso confirmado. A revisão estática não identificou falha crítica ou alta em autorização, exclusão mútua ou atomicidade. Restam uma divergência de precisão no ingresso, um caso de conflito de idempotência por formatação e a necessidade de validar o comportamento transacional em PostgreSQL.

**Escopo e evidências.** A comparação com `77a944b67b31a902bb20757b50c57737f9993c75` abrangeu quatro arquivos de produção do backend (controller, DTO, serviço e tipos de programação) e dois de testes. Foram consultados também os contratos E08.7 e de primeiro ingresso, os serviços relacionados, o esquema e o SQL das migrations em disco. A partir dos templates reais do serviço, uma inspeção local em memória com o parser TypeScript e `PgDialect.sqlToQuery` renderizou a leitura de versão, a decisão de escrita e a auditoria nas variantes legada e estendida. A CTE decisiva gerou respectivamente 11 e 16 parâmetros. Nenhuma consulta foi enviada a um banco.

O responsável informou **182 testes backend aprovados no seu terminal Windows** após o impedimento de inicialização registrado acima. A campanha anterior também registrou 80 testes frontend e dois typechecks backend aprovados. O responsável informou revisão visual inicial. Nesta auditoria, a evidência adicional é de inspeção estática, sem nova campanha ou comprovação de concorrência física.

### Garantias observadas no código

| Ponto | Resultado e localização |
| --- | --- |
| Primeiro ingresso e ordem dos locks | O ingresso bloqueia evento e usuário, nessa ordem, **antes** de reservar a intenção. Reavalia a elegibilidade na mesma transação e mantém o lock até persistir participação, snapshot e resultado. O PATCH bloqueia o mesmo evento antes da conta, concessão Admin global, sessão e intenção. O `EXISTS` de histórico é uma instrução posterior ao lock em `READ COMMITTED` e inclui participações em qualquer estado. Se o ingresso confirmar primeiro, o PATCH vê o histórico. Na ordem inversa, o ingresso avalia os horários já confirmados. A repetição do lock no ingresso pertence à mesma transação. Não foi encontrada inversão de ordem entre esses dois caminhos. Ver `backend/src/participations/join-idempotency.ts:195`, `participations.service.ts:382,464,484,522,553,588` e `backend/src/events/admin-schedule.service.ts:48,73,123`. |
| Decisão temporal | O SQL materializa `clock_timestamp()` depois dos locks e da reserva. Mudar o início exige início vigente e proposto estritamente futuros. O término proposto deve superar o início resultante e o instante da decisão. O término vigente já atingido, os estados closing/closed e os marcadores de fechamento impedem a escrita. O prazo fica entre o término e mais uma hora, inclusive, no DTO, no UPDATE e no CHECK da tabela. O término pode continuar sendo editado durante o evento na janela legada. O relógio do aparelho não participa da autorização. Ver `admin-schedule.service.ts:72–101`, `admin-schedule.dto.ts:45–50` e `backend/drizzle/0002_events_base.sql:18`. |
| Versão e compatibilidade | O detalhe projeta seis casas em UTC. O DTO exige a versão ao receber início ou extremos com seis casas. Sob o lock, o serviço compara `updated_at` diretamente como `timestamptz` e rejeita divergência com 409 antes de aceitar até mesmo um no-op novo. O formato legado sem versão continua limitado a término e prazo em precisão de milissegundos. Nesse contrato duas intenções diferentes podem se suceder com a última escrita prevalecendo. O legado não fornece um caminho para mudar o início. Ver `admin-configuration.projection.ts:35`, `admin-schedule.dto.ts:28–49`, `admin-schedule.service.ts:61–75` e `admin-schedule.controller.ts:18–23`. |
| Autorização e idempotência | A rota autenticada extrai ator e sessão do principal e exige uma única chave válida. Na transação, conta ativa, concessão global vigente e sessão da própria conta recebem locks compartilhados. Revogação confirmada, expiração ou ausência de TOTP impedem inclusive o replay. Uma revogação que obtenha o lock depois da escrita se ordena depois dela. A unicidade no banco é por ator, operação e chave. O hash inclui evento, horários, justificativa e campos opcionais presentes. Um retry idêntico autorizado retorna o resultado original antes da comparação de versão. Conteúdo diferente conflita. Ver `admin-schedule.controller.ts:26–43`, `admin-operation-auth.ts:10–31`, `admin-schedule.service.ts:49–70,93–104,119–125`, `backend/src/common/http/operation-validation.ts:40–50`, `backend/src/database/schema/idempotency.schema.ts:39` e `join-idempotency.ts:115–177`. |
| Atomicidade e superfície de escrita | A reserva, o UPDATE condicional, o registro de auditoria e a conclusão da intenção usam o mesmo `tx`. O “antes” vem da linha anterior materializada e o “depois” da releitura do evento bloqueado. O início integra ambos quando enviado. Uma auditoria com contagem diferente de um ou uma conclusão malsucedida lança erro e desfaz o conjunto. Rejeições saem da transação por exceção. Um no-op autorizado conclui a intenção sem UPDATE, auditoria ou nova versão, inclusive após o corte para o formato legado. O DTO estrito e o SET explícito excluem código, fuso e encerramento. A rota de metadados edita apenas o nome do evento. A busca nos escritores de `backend/src` localizou a criação do evento e este PATCH como pontos de atribuição de início, e um único ponto de inserção de participação. Ver `admin-schedule.service.ts:77–125`, `join-idempotency.ts:218–244`, `admin-configuration.dto.ts:31`, `admin-configuration.mutation.ts:13` e `participations.service.ts:553`. |

### Achados e decisões

1. **Moderado — divergência de precisão confirmada no código do ingresso.** A programação compara microssegundos no PostgreSQL. O ingresso lê as colunas como `Date`, converte o instante decisivo para `Date` e compara milissegundos. Um início persistido entre dois milissegundos pode abrir a janela de ingresso uma fração de milissegundo antes. Um término nessa condição pode fechar a janela cedo. Um intervalo válido cujos extremos caiam no mesmo milissegundo também pode ser classificado como programação inválida. A conversão já existia na base. A ADMIN-03 passa a aceitar término e prazo com seis casas em pedidos versionados. O efeito diz respeito à elegibilidade temporal e não quebra o lock nem permite editar o início depois do ingresso. Recomenda-se alinhar a comparação decisiva de ingresso e a validade do intervalo à precisão persistida. Ver `backend/src/database/schema/events.schema.ts:13,22–24`, `participations.service.ts:509–526`, `events.service.ts:145–157`, `event-entry-window.ts:37–51` e `event-availability.ts:90–98`.
2. **Baixo — conflito de idempotência por representação, confirmado no código.** Num pedido versionado, um extremo com três casas e o mesmo extremo com seis casas terminadas em zeros chegam ao mesmo instante no banco, mas conservam strings distintas no hash e na conferência de replay. Reformatar o corpo no retry pode produzir 409. O retry literal permanece válido e o conflito não duplica o efeito. Para tratar representações equivalentes como a mesma intenção, definir a forma canônica do pedido versionado e compatibilizar hash e replay com intenções já persistidas. Ver `admin-schedule.dto.ts:23–39`, `admin-schedule.service.ts:23–26,52–59` e `join-idempotency.ts:52–74`.
3. **Baixo — risco residual do token de versão.** A comparação tem seis casas, mas a nova versão é o valor de relógio `p.at`. O UPDATE não exige que ele difira da versão anterior. Se o relógio repetir exatamente um valor de versão, a igualdade deixa de distinguir os estados correspondentes. Nenhuma colisão foi observada. Se a especificação exigir identidade de revisão garantida, considerar uma revisão monotônica comum aos escritores relevantes. Ver `admin-schedule.service.ts:63–70,78,87` e `admin-configuration.mutation.ts:13,18`.

### Lacunas e validação transacional pendente

O mock de `backend/test/unit/admin-schedule.test.ts:22–39` fornece os resultados de versão, encerramento, bloqueio de início, escrita e auditoria. Os casos nas linhas 88–122 conferem fragmentos de SQL e a reação do serviço. O mock também calcula o hash de replay a partir do corpo legado, deixando sem verificação o replay bem-sucedido com início e versão. O teste HTTP na linha 78 de `backend/test/unit/admin-schedule-http.test.ts` usa um serviço substituto. A integração E08.7 existente (`backend/test/integration/admin-schedule-http.integration.test.ts:338–352`) intercala programação e ingresso, mas altera término e prazo. Seu resultado esperado inclusive permite que ambas as operações confirmem. Isso não exercita a nova correção de início.

É necessária uma campanha **separada e autorizada**, com PostgreSQL dedicado e duas conexões, para comprovar as garantias sob contenção. Priorizar as duas ordens entre correção de início e ingresso, histórico em estado terminal, passagem do início durante a espera, duas intenções com a mesma versão, retry versionado com a mesma chave e revogação antes de replay. Conferir os limites submilissegundo e, em outra conexão após o término das transações, evento, participação, valores anterior/posterior da auditoria e intenção. Uma falha controlada entre UPDATE e conclusão deve deixar os três registros administrativos no estado anterior. Locks reais, visibilidade depois da espera, ausência de deadlocks nas intercalações exercitadas e rollback até o commit seguem sem medição nesta auditoria.

**Estado Git.** Branch `feature/admin-core-management`, HEAD igual ao commit-base acima. O working tree contém 16 arquivos rastreados modificados e seis não rastreados, incluindo este relatório. O índice está sem alterações staged. A única edição desta auditoria foi o acréscimo desta seção. O changes da ADMIN-03 continua pendente.

## Correção pós-auditoria — precisão temporal do ingresso

A leitura original perdia precisão em dois pontos. O mapeamento das colunas `timestamptz` para `Date` truncava os limites do evento. A leitura transacional do relógio convertia o epoch para `double precision` e depois para `Date`. Com isso, instantes distintos dentro do mesmo milissegundo podiam parecer iguais tanto na janela de ingresso quanto na validação da programação.

O PostgreSQL agora projeta os horários relevantes como epoch inteiro em microssegundos, transportado como texto e convertido para `bigint`. A janela compara o início inclusivo e o menor limite exclusivo entre término oficial e fechamento antecipado. A validade da programação também usa microssegundos, inclusive na margem operacional de zero a 60 minutos. A consulta por código, a avaliação sob lock e a revalidação antes da escrita usam `clock_timestamp()` do PostgreSQL. O ingresso novo e seu snapshot gravam a mesma amostra decisiva como `timestamptz`. Os horários existentes e o fuso do evento são preservados.

O contrato de resposta mantém as datas no formato anterior. Chamadas com `Date` continuam aceitas, com a precisão que o próprio chamador fornece. Somente o fluxo de ingresso passou a colher o relógio em microssegundos. O compartilhamento da leitura de disponibilidade mantém os critérios de prontidão, capacidade, fila e fechamento administrativo. O PATCH de programação, o QR, a autenticação, os locks e a idempotência permanecem como na implementação auditada. A correção dispensa migration.

### Arquivos e testes preparados

| Arquivos | Alteração |
| --- | --- |
| `backend/src/events/event-instant.ts`, `event-entry-window.ts`, `event-availability.ts` e `events.service.ts` | Projeção e comparação exatas do início, término, prazo operacional e fechamento, com saídas de data compatíveis. |
| `backend/src/participations/participations.service.ts` e `participant-admission.controller.ts` | Relógio PostgreSQL na consulta e nas duas avaliações do ingresso. A escrita reutiliza o instante decisivo. |
| `backend/test/unit/event-entry-window.test.ts` e `event-availability.test.ts` | Fronteiras com diferença de um microssegundo, meia-noite, instantes de três e seis casas, dois limites no mesmo milissegundo, fechamento antecipado e margem operacional. |
| `backend/test/unit/participant-admission-precision.test.ts` e `participant-admission-http.test.ts` | Contrato HTTP da consulta, projeção Drizzle com transporte simulado, referência `Date` legada, ingresso no último microssegundo permitido e rollback no corte exclusivo. |
| `docs/ADMIN_03_IMPLEMENTACAO.md` | Registro da correção e das verificações. |

A inspeção via API do parser TypeScript verificou sintaxe e resolução de imports nos dez arquivos TypeScript da correção. A renderização local de SQL pelo Drizzle confirmou a projeção inteira para texto, a amostra única do relógio e o parâmetro `timestamptz` com seis casas. `git diff --check` terminou com exit code `0`, com avisos de conversão de fim de linha em alterações anteriores do app. Nenhum teste ou typecheck foi executado nesta correção. Os 80 testes frontend, os 182 backend informados pelo responsável e os dois typechecks permanecem como resultados históricos.

A próxima campanha com Luna Medium deve executar, em `backend` com `NODE_ENV=test`, os testes unitários focados e os dois typechecks já documentados:

```powershell
$env:NODE_ENV = 'test'
node --import tsx --test test/unit/event-entry-window.test.ts test/unit/event-availability.test.ts test/unit/participant-admission-precision.test.ts test/unit/participant-admission-http.test.ts test/unit/join-eligibility.test.ts test/unit/join-idempotency.test.ts test/unit/admin-schedule.test.ts test/unit/admin-schedule-http.test.ts
```

A validação em PostgreSQL dedicado, incluindo a disputa com a alteração de início, o comportamento do driver real e os limites submilissegundo, continua pendente de campanha autorizada. Os testes preparados simulam o transporte e o rollback.

### Achados de baixa gravidade

- **Fingerprint por representação.** O algoritmo e os replays existentes foram preservados. Uma evolução posterior pode gravar um fingerprint canônico apenas em novas intenções, com identificação da versão do formato. Para registros legados, manter o hash já persistido e comparar com as variantes históricas equivalentes e válidas de três e seis casas sob a mesma chave e o mesmo ator. Em caso de correspondência, devolver o payload histórico original e manter o conflito quando os instantes, a justificativa ou os demais campos forem diferentes.
- **Token de versão.** `updatedAt` segue sendo um instante de relógio com seis casas e mantém a possibilidade residual de duas revisões compartilharem um valor. A correção temporal usa o relógio para comparar instantes de ingresso e deixa o contrato de versão como documentado na auditoria.

O trabalho permanece em `feature/admin-core-management`, no HEAD `77a944b67b31a902bb20757b50c57737f9993c75`, com índice vazio. O changes e a aprovação final da ADMIN-03 permanecem pendentes.

## Campanha pós-correção temporal — Luna Medium

Branch `feature/admin-core-management`; HEAD `77a944b67b31a902bb20757b50c57737f9993c75`. A alteração temporal foi validada sem banco remoto. O comando unitário foi executado no diretório `backend`:

```powershell
$env:NODE_ENV = "test"
node --import tsx --test test/unit/event-entry-window.test.ts test/unit/event-availability.test.ts test/unit/participant-admission-precision.test.ts test/unit/participant-admission-http.test.ts test/unit/join-eligibility.test.ts test/unit/join-idempotency.test.ts test/unit/admin-schedule.test.ts test/unit/admin-schedule-http.test.ts
```

Exit code `1`. O Node.js `v24.15.0` falhou no bootstrap de `tsx` com `ERR_SYSTEM_ERROR: uv_os_get_passwd returned ENOMEM`, em `node:os:306`. Os oito arquivos foram marcados pelo runner como falhos na inicialização; **zero casos de teste executaram**, portanto há zero aprovados, zero reprovados funcionalmente e zero ignorados. Não foi repetida tentativa equivalente.

Os dois comandos de typecheck desta campanha **não foram executados**, pois a seleção Luna Medium não está confirmada pelo responsável neste turno. Assim, permanecem sem resultado para esta correção. Os dois typechecks aprovados e 182 testes backend aprovados mencionados nas seções anteriores pertencem à versão anterior à correção. Não se executou teste de integração PostgreSQL.

A campanha solicitada pelo responsável poderá ser repetida em terminal Windows onde `tsx.cmd` inicialize. Usar o comando de testes acima e, em seguida, `node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --incremental false` e `node node_modules/typescript/bin/tsc --project tsconfig.test.json --noEmit --incremental false`.

Foi executado `git diff --check`, exit code `0`, com somente avisos LF/CRLF nos arquivos anteriores do app. A preparação estática verificou sintaxe e imports de dez arquivos TypeScript e renderizou SQL localmente. Campanha funcional e typechecks pós-correção continuam pendentes. A validação concorrente com PostgreSQL dedicado permanece uma atividade separada que exige autorização específica.

O índice permanece vazio, sem staging. Não foi gerado changes.

## Preparação da campanha de concorrência PostgreSQL — ADMIN-03

O responsável informou **84 testes backend aprovados, zero falhas e zero ignorados** para a versão pós-correção, executados no seu terminal Windows. Os dois typechecks backend pós-correção foram executados sem diagnósticos apresentados. A saída informada não inclui seus códigos de saída individuais. O registro do `uv_os_get_passwd returned ENOMEM` descreve a tentativa anterior no Codex e permanece no histórico.

### Suíte e isolamento

Os dez testes com prefixo `ADMIN-03` foram preparados em `backend/test/integration/admin-schedule-http.integration.test.ts`. A suíte E08.7 já fornece o Nest HTTP em loopback, o pool da aplicação, um pool independente para fixtures e observação, as contas de teste e a limpeza por UUID. A suíte de ingresso usa uma guarda semelhante em `participant-admission-db-guard.ts`, com outro nome de banco. O destino reutilizado aqui é `127.0.0.1:55432/arenago_events_test` em **uma instância nova e descartável**, com o mesmo valor explícito em `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL`. A suíte exige `NODE_ENV=test`, confere `current_database()` antes do bootstrap do Nest e desativa a leitura de `.env`. As operações de limpeza usam apenas os identificadores gerados pela suíte, dentro de uma transação. Quando o preflight falha antes de criar fixtures, a limpeza fecha os recursos sem emitir DELETE ou UPDATE.

| Cenário | Evidência preparada |
| --- | --- |
| A | Evento com status `scheduled` cujo início já chegou. O primeiro ingresso mantém o lock até que o PATCH esteja em espera. Depois do commit do ingresso, o PATCH recebe `EVENT_START_CHANGE_LOCKED`. As comparações de estado preservam toda a programação, sem auditoria ou intenção administrativa persistida. Tanto o início alcançado quanto o histórico impedem a mudança nessa ordem. |
| B | O PATCH mantém aberto o commit da nova programação enquanto o ingresso aguarda o lock. O observador vê a versão anterior até o commit. A barreira solta o PATCH depois de o relógio PostgreSQL cruzar o início antigo. O teste verifica que a amostra real usada pelo ingresso caiu entre o início antigo e o novo. O ingresso recebe `EVENT_NOT_STARTED`, sem participação, snapshot ou intenção persistida. A auditoria grava os valores de início anterior e confirmado. |
| C | A participação terminal é criada em fixture com início vigente futuro. A recusa `EVENT_START_CHANGE_LOCKED` neste cenário isola o predicado de histórico e confirma ausência de efeitos. |
| D | Duas chaves distintas com a mesma versão competem pela linha em conexões independentes. A segunda recebe `EVENT_SCHEDULE_STALE`. A programação, a auditoria e a intenção correspondem à primeira escrita. |
| E | A mesma chave devolve a resposta histórica depois de outra escrita versionada. A mudança de conteúdo com a mesma chave recebe `IDEMPOTENCY_KEY_REUSED`. Ambas as verificações deixam a versão mais recente intacta. |
| F | A sessão revogada é rejeitada antes da escrita e do replay. Outros casos revogam a concessão ou removem a verificação TOTP enquanto o PATCH espera pelo lock do evento. O serviço toma os locks na ordem evento, conta, concessão e sessão. As asserções conferem a resposta e o estado persistido. |
| G | O interceptador da transação de teste verifica o novo início, a auditoria e a intenção em andamento na conexão da escrita. Após conferir que outra conexão ainda vê apenas o estado anterior, injeta uma falha SQL entre a auditoria e a conclusão da intenção. A leitura após rollback confirma o estado completo anterior. |
| H | A leitura de horários usa PostgreSQL e Drizzle reais. Os instantes de referência explícitos exercitam as fronteiras de um microssegundo numa janela de três microssegundos, incluindo o menor corte quando o fechamento antecede ou sucede o fim oficial. Um segundo teste observa as amostras do relógio PostgreSQL do ingresso real e compara, em SQL, a segunda amostra com `joined_at`, `arena_entered_at` e `captured_at`. |

Nos casos A, B e D, a segunda operação só pode avançar depois que uma terceira conexão observar `pg_blocking_pids` e a instrução `FOR UPDATE` do evento em espera. O primeiro callback de transação fica em uma barreira antes de devolver ao Drizzle o controle do commit. A sondagem tem prazo finito. No caso B, o relógio PostgreSQL decide a passagem do horário antigo. Os intervalos entre sondagens servem apenas para limitar a frequência das consultas. Nos limites de um microssegundo, o caso H usa referências explícitas para evitar depender do agendamento dos processos.

### Execução posterior proposta no Windows

A seleção do executor Luna Medium, a autorização específica e a confirmação do isolamento precedem qualquer acesso. O Docker CLI foi encontrado durante a preparação. A disponibilidade do engine e da imagem ainda precisa ser conferida. Usar Docker Desktop local com containers Linux e a imagem local `postgres:16`, ou disponibilizar uma instância PostgreSQL 16 equivalente, dedicada, nova e com porta de loopback exclusiva. Se `55432` estiver ocupada, interromper a preparação desse ambiente e identificar o listener com o responsável. Não reutilizar o banco servido por ele.

No diretório `backend`, em PowerShell exclusivo para a campanha, após autorização:

```powershell
if (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) {
    throw 'A porta 55432 já tem um listener.'
}
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
docker run --detach --rm --pull=never --name arenago-admin03-pg --publish 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data --env POSTGRES_USER=arenago_admin03 --env POSTGRES_DB=arenago_events_test --env POSTGRES_PASSWORD postgres:16 -c statement_timeout=20000 -c lock_timeout=16000 -c idle_in_transaction_session_timeout=25000
if ($LASTEXITCODE -ne 0) { throw 'O PostgreSQL dedicado não iniciou.' }
$published = docker port arenago-admin03-pg 5432/tcp
if ($LASTEXITCODE -ne 0 -or $published -ne '127.0.0.1:55432') { throw 'Publicação da porta inesperada.' }
docker exec arenago-admin03-pg pg_isready -h 127.0.0.1 -U arenago_admin03 -d arenago_events_test
if ($LASTEXITCODE -ne 0) { throw 'Aguarde a prontidão do container recém-criado antes de prosseguir.' }

$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = node -p "require('node:os').devNull"
$env:JWT_SECRET = [guid]::NewGuid().ToString('N')
$env:JWT_TEMP_SECRET = [guid]::NewGuid().ToString('N')
$env:DATABASE_URL = 'postgresql://arenago_admin03:' + $env:POSTGRES_PASSWORD + '@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_DIRECT_URL = $env:DATABASE_URL
$env:EVENTS_TEST_DATABASE_URL = $env:DATABASE_URL
Remove-Item Env:POSTGRES_PASSWORD

$preflight = @'
const { Client } = require('pg');
(async () => {
  const names = ['DATABASE_URL', 'DATABASE_DIRECT_URL', 'EVENTS_TEST_DATABASE_URL'];
  const value = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !value || !names.every(name => process.env[name] === value)) throw Error();
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432'
      || url.pathname !== '/arenago_events_test' || url.username !== 'arenago_admin03' || !url.password
      || url.search || url.hash) throw Error();
  const client = new Client({ connectionString: value, ssl: false, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const { rows: [db] } = await client.query(
      "SELECT current_database() AS name, current_user AS owner, to_regclass('public.events') IS NULL AND to_regclass('drizzle.__drizzle_migrations') IS NULL AS empty"
    );
    if (db.name !== 'arenago_events_test' || db.owner !== 'arenago_admin03' || !db.empty) throw Error();
    console.log('Destino descartável e vazio confirmado.');
  } finally {
    await client.end();
  }
})().catch(() => { console.error('Preflight rejeitado.'); process.exitCode = 1; });
'@
$preflight | node -
if ($LASTEXITCODE -ne 0) { throw 'Interrompa a campanha.' }
```

Se o primeiro `pg_isready` ainda não aceitar conexões, consultar novamente o estado do mesmo container antes de continuar. O trecho a seguir depende de **autorização explícita também para preparar o schema do banco novo**. A política geral do repositório veda migrations automáticas nesta preparação. A operação abaixo aplica apenas as migrations versionadas ao banco vazio confirmado, sem seed. Se o responsável disponibilizar um schema já migrado na instância dedicada, ele pode verificar o histórico de migrations e pular a aplicação.

```powershell
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'A aplicação do schema falhou.' }
$expected = (Get-Content .\drizzle\meta\_journal.json -Raw | ConvertFrom-Json).entries.Count
$applied = docker exec arenago-admin03-pg psql -X -U arenago_admin03 -d arenago_events_test -A -t -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM drizzle.__drizzle_migrations'
if ($LASTEXITCODE -ne 0 -or [int]$applied -ne $expected) { throw 'O histórico de migrations está incompleto.' }

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 --test-name-pattern='ADMIN-03' test/integration/admin-schedule-http.integration.test.ts
$campaignExitCode = $LASTEXITCODE
Write-Output "Exit code da campanha: $campaignExitCode"
```

A opção `--test-name-pattern` deixa os cenários legados E08.7 fora da execução focada. Registrar contagens, erros e código de saída. Concluída a coleta, o responsável pode encerrar o container dedicado com `docker stop arenago-admin03-pg`. Com a configuração acima, isso também descarta seus dados temporários. Encerrar o terminal dedicado remove as variáveis do processo.

### Estado da preparação

O parser TypeScript confirmou a sintaxe, a resolução dos imports estáticos e os dez casos com prefixo `ADMIN-03`. A renderização em memória com Drizzle confirmou que o filtro da barreira reconhece o `SELECT … FROM "events" … FOR UPDATE` produzido pelo caminho de ingresso. `git diff --check` passou com avisos de conversão LF/CRLF em alterações existentes do app. O índice permaneceu vazio em `feature/admin-core-management`, HEAD `77a944b67b31a902bb20757b50c57737f9993c75`.

Nesta etapa houve somente inspeção estática. A execução dos testes, a verificação da instância PostgreSQL dedicada e a aprovação formal da ADMIN-03 permanecem pendentes. O changes da ADMIN-03 também permanece pendente.

## Fechamento técnico da ADMIN-03

A ADMIN-03 integra o detalhe autenticado do evento, a edição de nome, horários e prazo operacional, o código de acesso e o QR Code. O PATCH de programação usa controle de versão, idempotência, auditoria e bloqueio transacional compartilhado com o ingresso. A correção posterior preserva microssegundos nas decisões temporais do Participante.

O responsável informou 80 testes frontend aprovados e 84 testes backend pós-correção aprovados no terminal Windows, com zero falhas e zero ignorados no backend. Na última conferência, os comandos `node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --incremental false` e `node node_modules/typescript/bin/tsc --project tsconfig.test.json --noEmit --incremental false` terminaram com exit code 0 cada. O responsável revisou a interface e confirmou o funcionamento físico do QR Code no aplicativo Participante.

Dez testes PostgreSQL de concorrência foram preparados e não executados. O responsável adiou essa campanha para a homologação integrada. Permanecem os riscos baixos documentados na auditoria, relativos à representação no fingerprint e à versão baseada em `updatedAt`. A concorrência real aguarda validação.

Os dois arquivos de testes inicialmente questionados já constavam na seção Arquivos deste relatório. O diff desde a base confirma que `app/tests/helpers/questionnaireHarness.cjs` oferece mocks de navegação, UUID e clipboard utilizados pela tela e pelos testes de configurações. `app/tests/roleRoutingIntegration.test.cjs` fornece o seletor de data e os dados do evento e acrescenta a navegação à tela Informações e horários e o retorno ao painel, preservando o fluxo anterior. Os dois arquivos integram integralmente a ADMIN-03 e o changes.

Inventário das diferenças em relação à base:

- Dependências: `app/package.json` e `app/package-lock.json`.
- Telas e componentes: `app/screens/admin/AdminEventManagementInfoScreen.js`, `AdminRealEventScreen.js`, `AdminEventSettingsScreen.js`, `adminScheduleForm.js`, `useAdminEventPanel.js`, `components/AdminLiveUI.js`, `AdminSelectedEvent.js`, `AdminEventAccess.js` e `AdminScheduleFields.js`.
- Serviço e testes do app: `app/services/adminEventsService.js`, `app/tests/adminEventSettings.test.cjs`, `roleRoutingIntegration.test.cjs` e `helpers/questionnaireHarness.cjs`.
- Backend: `backend/src/events/admin-schedule.controller.ts`, `admin-schedule.dto.ts`, `admin-schedule.service.ts`, `admin-schedule.types.ts`, `event-availability.ts`, `event-entry-window.ts`, `event-instant.ts` e `events.service.ts`; `backend/src/participations/participant-admission.controller.ts` e `participations.service.ts`.
- Testes backend: `backend/test/integration/admin-schedule-http.integration.test.ts`, `backend/test/unit/admin-schedule-http.test.ts`, `admin-schedule.test.ts`, `event-availability.test.ts`, `event-entry-window.test.ts`, `participant-admission-http.test.ts` e `participant-admission-precision.test.ts`.
- Relatório: `docs/ADMIN_03_IMPLEMENTACAO.md`.

O changes é `qa-evidence/ADMIN_03-changes.diff`, baseado em `77a944b67b31a902bb20757b50c57737f9993c75`. A branch é `feature/admin-core-management` e o índice real permanece vazio. A tarefa aguarda commit manual e homologação transacional integrada.
