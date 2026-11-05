# E08-EST01 — Revalidação de sessão nas mutações HTTP críticas

## Estado inicial e escopo

Implementação em 04/11/2026, branch `feature/events-participations`, sobre o HEAD
inicial `75011639bb7f3f156b94bf98d5b63b92b65b1d8b`. A E08.14 estava commitada
(`feat(events): implementar controle operacional da fila por experiência`).
Índice e working tree inicialmente limpos, sem arquivos não rastreados.

A base de validação informada pelo responsável era 777 unitários e 1.128
PostgreSQL aprovados, além de typecheck/lint/build. Essa aprovação não abrangia
antecipadamente a E08-EST01. A validação final foi executada manualmente pelo
responsável: **98/98 novos testes PostgreSQL**, **234/234 nas quatro suítes
históricas corrigidas** e **1.226/1.226 na regressão PostgreSQL completa**,
todos aprovados, sem falhas, cancelamentos ou ignorados, código de saída 0 e
duração total de 673630.0193 ms. A01 está corrigida e validada em PostgreSQL real.

Escopo exclusivo A01. Não foram corrigidos A02–A05, modificados contratos de
fechamento, relatórios históricos E08.1–E08.14, schema, migrações, dependências,
configuração de ambiente ou serviços de Identidade/Permissões. Nenhuma nova
funcionalidade ou etapa foi iniciada. Sem commit, staging ou push.

## Diagnóstico e contratos preservados

O guard validava o Bearer/sessão antes do controller. Os nove caminhos enviavam
somente o ator para serviços que podiam aguardar locks e confirmar alterações
ou devolver replay sem consultar novamente a sessão usada na requisição. A
constatação original é estática; os cenários concorrentes foram posteriormente
cobertos pelos 98 testes novos aprovados manualmente. As quatro suítes históricas
de rollback adaptadas e a regressão completa também foram aprovadas manualmente.

Foram consultados planejamento, arquitetura, relatórios E08.1/2/5/11/12/13/14,
guard e autenticação, contratos de papéis/TOTP, schema `access.schema.ts` e
migrações `0003_credentials_roles.sql`/`0005_idempotency.sql`, além dos serviços
operacionais e helpers de idempotência existentes.

Todas as rotas são relativas a `/api/v1`. Sucesso e replay mantêm status e DTOs:

| Método e caminho | Entrada autenticada do serviço | HTTP |
| --- | --- | --- |
| POST `/staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next` | `CallNextService.callNextAuthenticated` | 201 |
| POST `/staff/events/:eventId/service-sessions/:serviceSessionId/complete` | `CompleteService.completeAuthenticated` | 200 |
| POST `/staff/events/:eventId/service-sessions/:serviceSessionId/absent` | `AbsentService.absentAuthenticated` | 200 |
| POST `/participations/:participationId/queue-entries` | `QueueEntryService.joinExperienceQueueAuthenticated` | 201 |
| POST `/participations/:participationId/queue-entries/:queueEntryId/withdraw` | `QueueWithdrawalService.withdrawExperienceQueueAuthenticated` | 200 |
| POST `/participations/:participationId/evaluation` | `EvaluationWriteService.submitAuthenticated` | 201 |
| PATCH `/evaluations/:evaluationId` | `EvaluationWriteService.editAuthenticated` | 200 |
| POST `/participations/:participationId/cancel` | `ParticipationLifecycleService.cancelAuthenticated` | 200 |
| POST `/participations/:participationId/finish` | `ParticipationLifecycleService.finishAuthenticated` | 200 |

FIFO, contadores, reentrada após ausência, desistência isolada, titularidade,
finalizações, histórico, elegibilidade/janelas de avaliação, disponibilidade,
pausa, cortes e encerramentos conservam suas decisões de negócio anteriores.

## Contexto autenticado e fronteira com os contratos internos

`auth/mutation-session.ts` centraliza extração, erros, revalidação e conclusão
transacional. `mutationSession(request, userId)` lê exclusivamente `authPrincipal`,
instalado por `SessionAuthGuard`. Não usa `request.user` como fallback nem aceita
sessão escolhida pelo cliente em corpo, query ou cabeçalhos arbitrários. A sessão
e o usuário precisam estar presentes; o ator do contexto precisa coincidir com
o ator da operação. SQL exige `sessions.id` **e** `sessions.user_id` correspondentes.

Os nove métodos `*Authenticated` exigem contexto também em runtime, antes de
abrir transação. Contexto ausente/incompatível não chama um método interno como
alternativa. Os controllers foram migrados exclusivamente para essas entradas.

Os métodos internos anteriores continuam disponíveis para chamadas confiáveis
do servidor e preparação dos testes históricos; não constituem endpoints nem
autenticam requisições. Passam `null` explicitamente à implementação privada,
preservando os contratos internos preexistentes. A entrada HTTP nunca passa
`null` e nunca usa esse caminho. Essa separação evita transformar fixtures E07
em clientes HTTP ou exigir sessões artificiais para operações internas.

## Revalidação, locks e ponto de autorização

As transações continuam `READ COMMITTED`. O helper adquire, nesta ordem:

1. Conta do ator, `users FOR SHARE`.
2. Concessões vigentes do ator, ordenadas por ID, `user_roles FOR SHARE`.
3. Sessão própria, `sessions FOR SHARE`.
4. **Nova instrução SQL**, após os locks, para conferir existência, pertencimento,
   revogação, expiração por `clock_timestamp()`, conta ativa e TOTP para quem tem
   papel Admin global atual. Para operações Staff, exige também concessão Staff
   vigente no evento e e-mail verificado. Admin isolado não substitui Staff.

Não se usa `transaction_timestamp()` nem Date/relógio JavaScript para decidir a
validade da sessão. A consulta temporal separada evita que uma expressão de
`SELECT FOR SHARE` seja avaliada antes de sua espera.

Mapeamento dos locks anteriores, mantidos sem reordenar recursos de domínio:

| Caminho | Sequência relevante e primeira revalidação nova |
| --- | --- |
| call-next | evento SHARE → experiência UPDATE → estação UPDATE → conta/concessão Staff SHARE existente → reserva → nova conta/concessões/sessão; depois participação → entrada → atendimento |
| complete/absent | descoberta → evento SHARE → experiência/estação UPDATE (testemunha disponível em absent) → conta/concessão Staff SHARE existente → participação/entrada/atendimento UPDATE → reserva → nova autorização |
| join | descoberta → evento SHARE → experiência UPDATE → estação SHARE → participação UPDATE → reserva → nova autorização; depois entrada aberta e testemunha Staff/capacidade anteriores |
| withdraw | descoberta → evento SHARE → experiência UPDATE → estação quando chamada → participação/entrada/atendimento UPDATE → reserva → nova autorização |
| submit/edit | descoberta própria → reserva → participação UPDATE → avaliação UPDATE no PATCH → nova autorização |
| cancel/finish | descoberta própria → reserva → evento UPDATE → experiência/estação quando existentes → participação UPDATE → nova autorização; depois entradas/atendimentos UPDATE |
| logout/login/refresh | conta UPDATE → sessão UPDATE; refresh também bloqueia seus tokens, sem adquirir recursos de eventos/filas |

As reservas de avaliação/ciclo permanecem antes do domínio para preservar o
protocolo de idempotência existente. Sua FK adquire implicitamente proteção de
chave na conta: isso pode impedir que **logout**, que solicita `users FOR UPDATE`,
confirme enquanto a operação espera um recurso de domínio. Não se afirma que
logout possa sempre vencer esses quatro caminhos. Os testes distinguem logout
real, revogação SQL concorrente da sessão e expiração temporal.

Staff sem conta/concessão elegível também passa pela revalidação antes da recusa,
para distinguir conta desativada/sessão inválida de falta de autorização Staff.
Conflito de chave e `in_progress` em avaliação/ciclo são revalidados antes de
retornar o conflito, mesmo sem prosseguir para os locks de domínio.

Depois de todas as escritas e da conclusão da intenção, `mutationTransaction`
reexecuta o helper **antes de devolver o callback ao Drizzle**, inclusive para
replay. Logo, uma expiração durante esperas posteriores à primeira checagem
provoca rollback de domínio e idempotência. A resposta HTTP só é devolvida após
a transação terminar. Erros de sessão não são convertidos em erro interno pelos
wrappers de avaliações/ciclo.

O ponto final de autorização temporal é a última consulta de validade no
PostgreSQL. Os locks de conta/concessões existentes/sessão são retidos até o
COMMIT. Uma revogação confirmada antes da aquisição/revalidação é observada;
se a mutação obtém a proteção primeiro, o revogador incompatível aguarda e pode
confirmar depois dela. Logout legítimo não é impedido permanentemente.

**Limite temporal explícito:** não existe checagem atomicamente simultânea ao
COMMIT. Expiração estritamente posterior à última consulta e anterior ao COMMIT
não é detectável por este protocolo. Não se promete validade em cada instante
do envio da resposta nem se acrescenta tolerância ao prazo. A passagem do tempo
durante esperas anteriores à última checagem é detectada, mesmo com locks já
retidos. A revisão estática não identificou inversão incompatível com os
escritores atuais; não equivale a prova de ausência de deadlocks sob toda carga.
Futuros escritores de concessão devem respeitar o mutex/ordem de conta e evento
já previstos, inclusive para inserções de novos papéis; não são implementados aqui.

## Idempotência e erros

Namespaces, fingerprints, armazenamento, quatro políticas de TTL e regras de
replay histórico foram preservados. TTL vencido não autoriza reexecutar intenção
concluída. O replay exige sessão/conta/autorização atuais antes de retornar e na
checagem final. Não se transforma revogação em cancelamento de participação,
perda de posição ou ausência.

Recusa de segurança lança erro dentro da transação, desfazendo reserva nova,
eventuais alterações de domínio e conclusão da intenção. Intenções históricas
permanecem intactas. Nenhuma auditoria de sucesso deve sobreviver a rollback.
Uma tentativa futura válida pode reutilizar a chave de uma tentativa revertida.

| HTTP | Código RFC 7807 existente |
| --- | --- |
| 401 | `UNAUTHENTICATED_CONTEXT`, `INVALID_SESSION`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `ACCOUNT_DEACTIVATED`, `ADMIN_2FA_REQUIRED` |
| 403 | `STAFF_EVENT_FORBIDDEN` quando falta Staff vigente/verificado no evento |

Demais erros de token, validação, titularidade, negócio e idempotência conservam
os contratos anteriores. Não são expostos IDs de sessão, SQL ou dados privados
nos DTOs públicos.

## Testes e resultados executados pelo Codex

| Validação local final | Resultado |
| --- | --- |
| Serviços específicos + HTTP simulados (12 arquivos) | **457/457 aprovados** |
| Regressão unitária completa (`npm.cmd test`) | **984/984 aprovados** |
| Typecheck produção (`npx.cmd tsc --noEmit`) | Aprovado |
| Typecheck produção/testes (`npm.cmd run typecheck:test`) | Aprovado |
| Lint (`npm.cmd run lint`) | Aprovado |
| Build (`npm.cmd run build`) | Aprovado |

Nas duas execuções finais de testes: zero falhas, cancelamentos e ignorados.
Foram adicionados **206 testes locais**: 144 casos de serviço (16 por mutação),
oito casos adicionais de conflito/in_progress em avaliação/ciclo, e 54 HTTP
simulados (seis por rota). Testes anteriores foram preservados; os quatro
adaptadores HTTP históricos foram atualizados para as entradas autenticadas e
agora também conferem o contexto propagado. Nenhuma expectativa histórica foi
relaxada ou removida.

Cobertura nova: sessão válida, revogada, expirada, estrangeira, contexto
ausente/incompatível, conta inativa, Admin sem TOTP, invalidação após espera de
domínio/reserva, recusa final depois da conclusão da intenção, rollback e replay
com sessão inválida. HTTP verifica contexto exclusivo do guard, ignora tentativa
de selecionar sessão por query/header e rejeita `sessionId` no corpo estrito.
Mocks locais não comprovam concorrência PostgreSQL.

Execução local com dotenv desativado, quatro TTLs explícitos e URL fictícia de
unitários sem conexão. A tentativa inicial de `npx` foi bloqueada pela política
PowerShell para arquivos `.ps1`; utilizado `npx.cmd`, sem alterar a política.
O sandbox também impediu a consulta de usuário do `tsx`
(`uv_os_get_passwd`, `ENOMEM`) antes dos testes; a execução autorizada fora do
sandbox funcionou. A primeira seleção sem os quatro TTLs explícitos terminou
com falha de inicialização de três arquivos HTTP; a configuração de teste foi
corrigida, sem ler credenciais, e as execuções finais acima passaram.

## Investigação da regressão histórica após A01

O responsável forneceu `%TEMP%\arenago-est01-regressao-final.log`. O log completo
foi inspecionado, sem acessar PostgreSQL ou credenciais. Resultado real:
**1.226 executados, 1.209 aprovados, 17 falhas, zero cancelamentos/ignorados**.
Há exatamente 17 registros na seção `failing tests`, distribuídos em quatro
arquivos. Nenhuma falha adicional de inicialização aparece nesse resumo.

Todos falham na **verificação da resposta HTTP 500**, antes de alcançar as
asserções seguintes de `reached`, rollback e retry. A preparação não é a causa.
O quadro identifica todos os casos; o status esperado continua sendo **500**:

| Arquivo de integração | Teste/caso reprovado | HTTP observado | Asserção antes do ajuste |
| --- | --- | --- | --- |
| `evaluation-write.integration.test.ts` | E08.11 falha depois da escrita `reserve post` | 201 | linha 237, `problem(r,500,...)` |
| mesmo | E08.11 falha depois da escrita `reserve patch` | 200 | linha 237 |
| mesmo | E08.11 falha depois da escrita `domain post` | 201 | linha 237 |
| mesmo | E08.11 falha depois da escrita `domain patch` | 200 | linha 237 |
| mesmo | E08.11 falha depois da escrita `complete post` | 201 | linha 237 |
| mesmo | E08.11 falha depois da escrita `complete patch` | 200 | linha 237 |
| `participant-queue-http.integration.test.ts` | E08.2 erro após escritas de ingresso faz rollback integral e permite retry | 201 | linha 360, `problem(r,500,...)` |
| mesmo | E08.2 erro após desistência waiting/called reverte efeitos e idempotência | 200 | linha 377, `problem(r,500,...)` |
| `participation-lifecycle.integration.test.ts` | E08.12 falha SQL após escrita real `cancel/reserve` | 200 | linha 281, `problem(await mutate(...),500,...)` |
| mesmo | E08.12 falha SQL após escrita real `cancel/participation` | 200 | linha 281 |
| mesmo | E08.12 falha SQL após escrita real `cancel/complete` | 200 | linha 281 |
| mesmo | E08.12 falha SQL após escrita real `finish/reserve` | 200 | linha 281 |
| mesmo | E08.12 falha SQL após escrita real `finish/participation` | 200 | linha 281 |
| mesmo | E08.12 falha SQL após escrita real `finish/queue` | 200 | linha 281 |
| mesmo | E08.12 falha SQL após escrita real `finish/session` | 200 | linha 281 |
| mesmo | E08.12 falha SQL após escrita real `finish/complete` | 200 | linha 281 |
| `staff-http.integration.test.ts` | E08.1 erro após as escritas reais faz rollback e permite retry | 200 | linha 334, `problem(r,500,...)` |

O teste de desistência contém duas variantes sequenciais (`waiting` e `called`).
O erro em `waiting` interrompeu o teste antes de `called`; ambas as variantes
foram preservadas. São 17 testes contabilizados, não 18 testes novos.

### Causa e instrução de injeção em cada grupo

- **E08.11, seis casos:** o proxy de `client.query` executa primeiro
  `await originalQuery(config,params)`. Após INSERT da reserva, CTE decisiva
  de INSERT/UPDATE da avaliação ou UPDATE da intenção, exige uma linha retornada
  (e `writtenId` na fase domain) e executa **`SELECT 1/0` no mesmo cliente real**.
  Entretanto, o teste substituía `writes.submit`/`writes.edit`, enquanto o
  controller chama `submitAuthenticated`/`editAuthenticated`. O proxy não era
  utilizado pela requisição HTTP.
- **E08.12, oito casos:** o mesmo mecanismo de SQL real seguido de `SELECT 1/0`
  intercepta reserva, UPDATE de participação, fila, atendimento ou conclusão
  da intenção. O teste substituía `writes[mode]` (`cancel`/`finish`), mas o
  controller escolhe `cancelAuthenticated`/`finishAuthenticated`. As oito
  combinações do quadro não alcançavam o cliente instrumentado.
- **E08.2, dois testes:** `failingDb.transaction` executa o callback real e
  consulta seus efeitos ainda dentro da transação: ponteiro preenchido após
  ingresso; ponteiro nulo/entrada closed e atendimento canceled, quando chamado,
  após desistência. Só então provoca a exceção `E082_PRIVATE_ROLLBACK`. Esse
  mecanismo é uma **exceção JavaScript após SQL real**, não divisão por zero.
  Os testes substituíam `joinExperienceQueue`/`withdrawExperienceQueue`, enquanto
  o HTTP chama suas versões `Authenticated`; o wrapper não era executado.
- **E08.1, um teste:** o wrapper transacional consulta atendimento completed e
  ponteiro nulo após o callback real, depois lança `E081_ROLLBACK_PRIVATE`.
  Também é exceção após SQL real. O teste substituía `completion.complete`, mas
  o HTTP executa `completeAuthenticated`; o wrapper ficava fora do caminho.

Nos sete pontos de entrada afetados, os métodos autenticados chamam diretamente
a implementação privada (`execute`/`write`), sem delegar ao método interno antigo.
Antes da A01 os controllers chamavam os métodos que os testes substituíam;
depois da A01 passaram a ignorar essas substituições. A inspeção dos caminhos
de chamada comprova por que a injeção não era acionada. O log anterior não contém
uma medição de `reached=false`: a asserção HTTP falhava antes dessa verificação.

As respostas do log contêm os resultados reais das escritas (IDs/instantes de
avaliações e filas, participação finalizada/cancelada e atendimento completed).
Os serviços só produzem esses resultados após suas escritas; os controllers
aguardam a transação. Conferido também o executor instalado do Drizzle:
`node-postgres/session.js`, linhas 180–193, executa callback, depois COMMIT;
em exceção executa ROLLBACK e relança. Assim, o sucesso observado corresponde
à execução normal do banco original, sem a falha artificial esperada. Não foi
feita uma nova consulta ao banco pelo Codex para inspecionar aqueles registros.

**Classificação dos 17 casos:** erro na instrumentação dos testes, introduzido
pela adaptação incompleta ao novo caminho HTTP A01. Não é uma divergência de
regra funcional e não há evidência nesses erros de uma exceção SQL capturada
indevidamente ou de um COMMIT após falha transacional efetivamente disparada.
Foi uma omissão da implementação inicial A01 ao migrar os controllers sem
migrar estas instrumentações históricas.

### Efeito de `mutationTransaction()` e correção mínima

`mutationTransaction()` chama **o `database.transaction` recebido**, usa o mesmo
executor para domínio e revalidação e não abre outra conexão, confirma
antecipadamente ou suprime exceções. No wrapper de E08.1/E08.2, o callback inclui
a checagem final A01, mas a falha posterior ainda ocorre antes do COMMIT do
Drizzle. Nos proxies de E08.11/E08.12, uma falha SQL rejeita o callback usando o
mesmo cliente. Não foi necessário alterar esse helper ou qualquer código de produção.

A correção altera somente os pontos substituídos e restaurados nos quatro
arquivos de integração. Cada wrapper intercepta o método **autenticado atual**
e encaminha **`input` e `context` sem substituir a sessão**, para a instância
com banco instrumentado. `finally` restaura o mesmo método autenticado antes
do retry. Foram preservados integralmente SQL real, momentos de injeção,
exceções, expectativa 500, sigilo da resposta, `reached=true`, comparação de
rollback e retry válido com a mesma chave. Não foram criados mocks PostgreSQL,
testes adicionais ou alteradas asserções para aceitar sucesso.

Após a correção das instrumentações, o Codex repetiu os testes locais:
**457/457 específicos/HTTP simulados**, **984/984 unitários**, typecheck de
produção e testes, lint e build aprovados. Zero falhas, cancelamentos ou
ignorados nessas execuções. Os quatro arquivos de integração foram incluídos
no typecheck e lint; sua execução PostgreSQL corrigida permanece manual.

## PostgreSQL — validação manual final aprovada

`backend/test/integration/mutation-session.integration.test.ts`: **98 testes
novos**, aprovados manualmente pelo responsável (**98/98**). Na entrega inicial
nenhum histórico havia sido modificado; nesta correção foram adaptados **17
testes históricos em quatro arquivos**, sem adicionar/remover testes. Total
esperado da regressão permanece **1.128 + 98 = 1.226**. PostgreSQL não foi
executado pelo Codex; foi executado manualmente pelo responsável com aprovação
integral final.

- Dez testes por operação, total 90: sucesso/replay válido; conta inativa e
  perda de TOTP após espera; revogação e expiração durante lock de domínio;
  revogação e expiração em replay bloqueado; expiração na reserva idempotente
  com tentativa válida posterior; mutação protegida antes do logout; expiração
  final após concluir a intenção com rollback integral.
- Cinco operações com logout real confirmado antes da liberação do domínio:
  call-next, complete, absent, join e withdraw.
- Três operações Staff com concessão revogada enquanto aguardam o domínio.

Usa conexões/transações independentes e `pg_blocking_pids`. A expiração aguarda
uma condição observada do relógio PostgreSQL, não um atraso arbitrário como
prova de sincronização. Na checagem tardia, a instrumentação acrescenta uma
espera real por advisory lock no mesmo executor, após concluir a intenção e
antes da última revalidação; não substitui consultas ou resultados do banco.

Os snapshots comparam evento, participações, filas, contadores, estações,
atendimentos, snapshots de perfil, avaliações, auditoria e intenções do ator.
Alterações deliberadas da fixture de autenticação (revogação, expiração, conta,
papéis) são verificadas pela recusa e não confundidas com efeitos de domínio.
Fixtures próprias são limpas pelo helper existente; não dependem de resíduos
de outras suítes nem limpam/reconstroem todo o banco.

Comandos PowerShell para o responsável, **apenas depois de configurar localmente
as três URLs idênticas do banco de testes**. Não compartilhar os valores:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'

# DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL já configuradas
# pelo responsável: 127.0.0.1:55432/arenago_events_test, sem query ou fragmento.
foreach ($name in @('DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name precisa estar configurada localmente."
  }
}

npx.cmd tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/staff-http.integration.test.ts test/integration/participant-queue-http.integration.test.ts test/integration/evaluation-write.integration.test.ts test/integration/participation-lifecycle.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Suítes históricas falharam; investigar antes da regressão.' }

# Esperados 234 testes nas quatro suítes: 20 + 22 + 103 + 89.
# Executar a regressão somente depois da aprovação focada pelo responsável.
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Regressão PostgreSQL falhou; preservar os logs para investigação.' }
```

O fixture valida banco/host/porta/URLs antes de importar a aplicação. A guarda
histórica A04 e as fixtures K03 de A03 não foram alteradas nesta task.

### Execuções históricas e aprovação definitiva

O bloco de PowerShell acima foi mantido como registro do procedimento manual,
não como pendência. As quatro suítes históricas foram aprovadas com **234/234**:
20 E08.1, 22 E08.2, 103 E08.11 e 89 E08.12. A primeira regressão completa
registrou 17 falhas de instrumentação; após a correção limitada aos testes, a
regressão final aprovou **1.226/1.226**, sem falhas, cancelamentos ou ignorados,
com código de saída 0. Esse resultado inclui os 98 cenários novos A01 já
aprovados, sem inventar uma nova execução isolada.

As validações locais já registradas permanecem: **984/984 unitários**,
**457/457 específicos e HTTP simulados**, typecheck de produção e testes, lint
e build aprovados. Não houve validação de produção.

## Limitação temporal documentada

O ponto final de autorização é a última consulta de sessão/concessões no
PostgreSQL, imediatamente antes de o callback transacional retornar ao Drizzle.
Expiração ou revogação confirmada antes dela é observada e pode provocar rollback
integral. Uma expiração estritamente posterior a essa consulta e anterior ao
COMMIT não é detectável atomicamente pelo protocolo atual. Não foi criada janela
de tolerância, nem prometida validade até o envio da resposta. Essa limitação
continua documentada apesar da aprovação dos cenários reais de espera/rollback.

## Inventário e evidência

**31 arquivos de implementação, testes e documentação**, além do único patch:

- Novo: `backend/src/auth/mutation-session.ts`.
- Serviços: `backend/src/events/{call-next,complete,absent,queue-entry,queue-withdrawal}.service.ts`,
  `backend/src/evaluations/evaluation-write.service.ts` e
  `backend/src/participations/participation-lifecycle.service.ts`.
- Controllers: `backend/src/events/{staff-operations,participant-queue}.controller.ts`,
  `backend/src/evaluations/evaluation-write.controller.ts` e
  `backend/src/participations/participation-lifecycle.controller.ts`.
- Unitários existentes, com casos novos:
  `backend/test/unit/{call-next,complete,absent,queue-entry,queue-withdrawal,evaluation-write,participation-lifecycle}.test.ts`.
- Adaptadores HTTP históricos:
  `backend/test/unit/{staff-http,participant-queue-http,evaluation-write-http,participation-lifecycle-http}.test.ts`.
- Novos: `backend/test/unit/mutation-session-scenario.ts`,
  `backend/test/unit/mutation-session-http.test.ts` e
  `backend/test/integration/mutation-session.integration.test.ts`.
- Instrumentações PostgreSQL históricas corrigidas:
  `backend/test/integration/{staff-http,participant-queue-http,evaluation-write,participation-lifecycle}.integration.test.ts`.
- Este relatório: `docs/E08_EST01_CORRECAO_A01.md`.

Evidência única: `qa-evidence/e08-est01-changes.diff`, base
`75011639bb7f3f156b94bf98d5b63b92b65b1d8b`. Patch completo UTF-8 sem BOM, com
arquivos novos, sem incluir o próprio diff, credenciais, `.env`, dependências,
temporários ou mudanças de outras tasks. Validação por `git apply --check` e
aplicação em cópia isolada da base, seguida de comparação integral dos **31/31
arquivos** e do conjunto de caminhos alterados. HEAD e índice preservados.

Não há pendência de validação para A01. Restam somente revisão, staging, commit e
push manuais. Sem validação de produção. A02–A05 e demais etapas permanecem fora
desta correção.

Mensagem sugerida, sem executar commit:
`fix(events): revalidar sessões nas mutações críticas`.
