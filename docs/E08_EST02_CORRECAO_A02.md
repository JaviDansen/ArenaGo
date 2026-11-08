# E08-EST02 — Correção A02: preservação do fechamento lógico tardio

**Achado:** A02 — P1, fechamento imediato administrativo posterior ao deadline podia deslocar a finalização persistida e, com isso, ampliar a janela inicial de avaliação.

**Base da task:** `1d8dc64ca4839271b5476521ef96c733b3e9c47b`, HEAD sincronizado com `origin/feature/events-participations` no início da execução. A E08-EST01 estava commitada. Nenhuma alteração preexistente foi encontrada.

## Diagnóstico e decisão contratual

A E08.8 documenta que `POST /api/v1/admin/events/:eventId/close` aceita modo imediato mesmo após o prazo operacional original. A resposta mantém dois instantes distintos:
`newEntriesClosedAt`, corte administrativo real, e `effectiveOperationalDeadlineAt = LEAST(operational_deadline_at, admin_deadline_at)`. A E08.9, por sua vez, finaliza filas, atendimentos pendentes e participações no deadline efetivo, com precisão PostgreSQL de microssegundos. A E08.10–E08.12 derivam a elegibilidade e os 720 horas iniciais de `participations.finished_at`.

A falha era real no caminho de produção: o fechamento imediato tardio gravava corretamente o corte Admin no evento, mas copiava `closure_requested_at` para `service_sessions.resolved_at`, `queue_entries.closed_at` e `participations.finished_at`. Quando o job estava atrasado, essa gravação substituía o instante lógico já projetado pela E08.10/E08.12 e podia estender a janela de avaliação. A ordem de execução Admin/job também determinava qual motivo e timestamp persistido prevaleciam.

**Decisão:** manter o comportamento público aprovado da E08.8: aceitar o fechamento imediato tardio e fechar novas entradas no momento administrativo da requisição. Para efeitos terminais de domínio, usar o deadline efetivo PostgreSQL (`LEAST(operational_deadline_at, admin_deadline_at)`). Se o prazo operacional já foi atingido quando a requisição é decidida, regularizar com a semântica automática operacional: motivo `automatic_operational_deadline` e `resolved_by_user_id=NULL`. Antes do prazo, preservar `admin_immediate` e o Admin como resolvedor. Não recusar a operação nem criar uma nova resposta HTTP. A comparação usa `operational_deadline_at <= closure_requested_at` no PostgreSQL, sem arredondamento/tolerância.

`closure_requested_at`, `events.updated_at`, `audit_logs.occurred_at` e
`newEntriesClosedAt` continuam registrando a ação Admin no seu horário real. `admin_deadline_at` conserva seu papel no cálculo do prazo efetivo. Auditoria e resposta não são retrodatadas. Assim, Admin-first e job-first convergem em motivo e timestamp para as filas, atendimentos e participações, enquanto status/metadata de fechamento e auditoria de ação Admin podem legitimamente diferir.

## Alterações

- `backend/src/events/admin-close.service.ts`: efeitos do modo imediato usam `LEAST(e.operational_deadline_at,e.admin_deadline_at)` para `resolved_at`, `closed_at` e `finished_at` somente no imediato. `participations.finished_at` usa `CASE`: deadline efetivo no imediato e `closure_requested_at` no controlado. Os motivos e `resolved_by_user_id` automáticos também se aplicam somente ao imediato tardio. Locks, auditoria, resposta e intenção idempotente permanecem preservados.
- `backend/src/participations/participation-query.service.ts`: a projeção de uma participação em evento imediatamente fechado usa o mesmo deadline efetivo. Uma leitura antes da regularização física e a leitura após a execução do Admin apresentam o mesmo `finishedAt` lógico.
- `backend/test/unit/admin-close.test.ts`: as asserções SQL distinguem o timestamp efetivo do imediato e `closure_requested_at` do controlado; a auditoria continua ligada ao horário da requisição.
- `backend/test/unit/participation-lifecycle.test.ts`: confirma a expressão compartilhada de deadline na projeção imediata.
- `backend/test/integration/admin-close-http.integration.test.ts`: o teste histórico de fechamento tardio foi aprofundado; o teste de fechamento controlado agora confirma `finished_at = closure_requested_at`; três cenários PostgreSQL novos exercitam deadline atrasado, consultas/avaliação/replay, corrida real Admin/job nas duas ordens e corrida de envio de avaliação com Admin tardio. A ordem evaluation-first usa barreira no lock real da participação, e a limpeza remove avaliações das fixtures antes das participações.

Não foram alterados rotas, DTOs públicos, schema, migrações, dependências ou outros serviços de produção. A arquitetura não foi alterada: a decisão decorre dos contratos existentes na arquitetura §17.8 e dos relatórios E08.8–E08.12.

## Efeitos, concorrência e garantias preservadas

- Um atendimento `completed` anterior permanece intacto e é a condição de elegibilidade; finalizar sem atendimento concluído continua sem oferecer avaliação.
- Uma participação ainda aberta recebe `admin_immediate` quando o Admin decide antes do deadline e `automatic_operational_deadline` quando o deadline operacional já foi atingido; o timestamp terminal converge ao deadline efetivo. Registros já terminais não são reescritos.
- Filas `waiting/called` e atendimentos `pending` são fechados/cancelados atomicamente com o mesmo deadline efetivo e o motivo correspondente à decisão temporal. O `resolved_by_user_id` fica nulo no caminho automático tardio. Histórico, ponteiros, contadores, serviços concluídos, snapshots e outras filas permanecem preservados.
- A projeção E08.12 do fechamento imediato usa o deadline efetivo, evitando uma mudança de `finishedAt` entre a visão lógica anterior e o estado fisicamente regularizado.
- Os 720 horas para o primeiro envio continuam inclusivos e começam em `finished_at`; por consequência, a requisição Admin tardia não prolonga a elegibilidade. As regras de 168/720 horas para edição/comentário não foram alteradas.
- O evento continua sendo o primeiro lock. Admin e job usam, depois dele, a ordem evento → experiências → estações → participações → entradas → atendimentos. Escritores E07 e ciclo E08.12 que tomam `events FOR SHARE/UPDATE` são serializados pelo lock do evento; a escrita de avaliação toma participação e avaliação, mas não solicita depois o lock do evento. Não foi introduzida nova inversão de locks.
- A cobertura existente exercita Admin contra operações Staff/participação, avaliação contra fechamento Admin/job, duas intenções Admin e job contra operações de participação. Os três cenários A02 cobrem as duas ordens de confirmação Admin/job e a concorrência Admin/avaliação usando transações PostgreSQL independentes e espera real observada por `pg_blocking_pids`.
- Revalidação A01 de conta, concessão, sessão e 2FA permanece no mesmo caminho transacional. A autorização atual ainda precede replay; replay autorizado retorna a resposta histórica sem repetir os efeitos. Uma nova intenção após o job ter fechado o evento continua recebendo `409 EVENT_ALREADY_CLOSED`. Reserva, efeitos, auditoria e conclusão idempotente continuam no mesmo commit/rollback.

## Cobertura PostgreSQL e validação manual

Foram preparados **3 cenários PostgreSQL A02** no arquivo `admin-close-http.integration.test.ts`. O primeiro substituiu e aprofundou o teste histórico de fechamento imediato após o prazo, sem alterar sua expectativa HTTP 200; os outros dois são testes concorrentes adicionais. O cenário tardio cobre: leitura lógica antes/depois, precisão de seis casas, participação com atendimento concluído, participação sem conclusão, estados/motivos e timestamps de fila/atendimento, histórico, elegibilidade e deadline de 720 horas, ausência de avaliação para quem não teve serviço concluído e replay após expiração técnica. O segundo cenário concorrente executa Admin-first e job-first em transações independentes. O terceiro verifica a corrida Admin tardio/envio de avaliação e o mesmo prazo persistido em ambas as ordens.

A contagem final comprovada é **70 testes focados**: a base E08.8 tinha 68, o teste histórico foi substituído por um dos três cenários A02 e somente os dois concorrentes aumentaram o total (`68 - 1 + 3 = 70`). Pelo mesmo motivo, a regressão passou de 1.226 para **1.228**, e não para as previsões anteriores de 71 e 1.229. Nenhum teste foi removido ou modificado para ajustar números; a diferença decorre exclusivamente de ter contado inicialmente o cenário histórico substituído como se permanecesse adicional.

### Primeira execução PostgreSQL focada e correções do teste

Na primeira execução manual, o runner contabilizou 71 itens: **69 testes aprovados**, o cenário `evaluation-first` reprovado e a falha adicional do hook `after` durante a limpeza. A falha do hook apareceu como item adicional; corrigida a FK, a suíte revelou sua contagem estável de 70 testes registrados. Esses resultados são intermediários e foram preservados como histórico, sem representar a aprovação final.

No cenário `evaluation-first`, o helper genérico `ordered()` só anunciava e suspendia a primeira transação depois que todo o callback transacional retornava com sucesso. O POST de avaliação, porém, toma `participations FOR UPDATE`, observa corretamente que a participação persistida ainda está `active`, decide `EVALUATION_NOT_ELIGIBLE` e desfaz a transação antes desse ponto. Por isso a mensagem `Primeira operação não manteve tx.` era uma falha da instrumentação, não evidência de ausência de transação nem defeito de produção. A ordem que falhou foi **avaliação primeiro**; Admin-first alcançava a barreira antiga porque o fechamento concluía seu callback antes de ser retido.

A expectativa `409 EVALUATION_NOT_ELIGIBLE` foi preservada. O contrato E08.11 exige participação fisicamente `finished` para o envio, e a E08.12 registra que, antes da regularização física, histórico/pendência/retomada da avaliação ainda aguardam o job ou fechamento que persista o estado terminal. A correção usa uma barreira específica logo após o `FOR UPDATE` real da participação na transação da avaliação. Em seguida inicia o fechamento Admin em outra conexão/transação, confirma por `pg_blocking_pids` que ele aguarda aquele lock e só então libera a avaliação. Assim, a ordem é determinística sem `Promise.all`, atraso arbitrário ou interceptação de método fora do caminho HTTP: evaluation-first retorna 409, o Admin regulariza depois; Admin-first continua submetendo a avaliação após o commit do fechamento. Em ambas as ordens, `finished_at` e as 720 horas permanecem ancorados no deadline operacional, e a unicidade continua impedindo avaliações duplicadas.

O hook de limpeza removia snapshots e depois tentava apagar `participations`, mas não removia antes as `evaluations` criadas pelo novo cenário Admin-first. O PostgreSQL recusou a exclusão com `fk_evaluations_participation` e reverteu a transação inteira de limpeza. Foi incluída a exclusão de avaliações por `participation_id`, limitada às participações cujos `event_id` pertencem a `ids.events`, antes da exclusão dessas participações. A consulta é idempotente, respeita a FK e não alcança fixtures de outras suítes. Como o rollback do hook pode ter preservado todos os registros daquela execução, resíduos anteriores são **possíveis**, mas não foram consultados nem removidos pelo Codex. Os UUIDs aleatórios daquela execução não existem mais em memória; qualquer saneamento deve ser precedido por inspeção manual e limitado aos eventos identificados pelo responsável, sem limpeza ampla. A nova execução limpa integralmente apenas as fixtures que ela própria registra.

### Aprovação PostgreSQL definitiva

Após as correções de sincronização e limpeza, o responsável aprovou manualmente:

- suíte focada E08-EST02: **70/70**;
- `database.integration.test.ts` no PostgreSQL 18 Linux em Docker: **22/22**, incluindo V12;
- regressão PostgreSQL completa: **1.228/1.228**, zero falhas, cancelamentos ou ignorados, código de saída 0 e duração de 627374.5094 ms.

A primeira regressão no PostgreSQL 18 nativo do Windows contabilizou 1.226 aprovações em 1.228 testes. O caso V12 falhou porque a política de integridade de código do Windows bloqueou o carregamento de `plpgsql.dll` (evento 3077); a segunda falha contabilizada correspondia ao agrupamento da suíte. Foi um bloqueio ambiental, não uma falha funcional da A02 ou das migrações. Sem desativar a segurança do Windows, o responsável instalou WSL 2 e Docker Desktop e executou um PostgreSQL 18 Linux isolado no contêiner `arenago-e08-pg18`, banco `arenago_events_test`, endereço local `127.0.0.1:55432` e volume persistente `arenago_e08_pg18_data`, com o serviço PostgreSQL Windows temporariamente parado. Após aplicar as migrações, V12 e toda a regressão passaram. Nenhuma credencial foi registrada.

O Codex não executou PostgreSQL. A validação manual confirma tanto a barreira determinística de `evaluation-first` quanto a limpeza das avaliações antes das participações. Não houve alteração adicional de produção depois da implementação A02.

Comandos PowerShell para o responsável, após configurar localmente e sem compartilhar as três URLs idênticas de `arenago_events_test`:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'

# DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL devem estar
# configuradas pelo responsável, idênticas e apontando para o banco local aprovado.
foreach ($name in @('DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name precisa estar configurada localmente."
  }
}

npx.cmd tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-close-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar a suíte focada E08.8/A02 antes da regressão.' }

# Regressão PostgreSQL comprovada: 1.228 testes; executar somente após a suíte focada.
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas antes de considerar A02 validada.' }
```

## Validações locais do Codex

- Testes unitários específicos (`admin-close.test.ts` e `participation-lifecycle.test.ts`): **100/100 aprovados**.
- Regressão unitária final: **984/984 aprovados**, zero falhas/cancelamentos/ignorados.
- A tentativa inicial usou `npm.cmd test -- --test-concurrency=1 --test-timeout=30000` com shim temporário de `os.userInfo()`, mas sem `STAFF_IDEMPOTENCY_TTL_SECONDS`, `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS`, `ADMIN_IDEMPOTENCY_TTL_SECONDS` e `EVALUATION_IDEMPOTENCY_TTL_SECONDS`. Os 13 arquivos listados abaixo inicializam policies Nest reais; `parseOperationIdempotencyTtl` lança erro de configuração quando a variável requerida está ausente, e o `NestFactory` aborta a criação do módulo. A ausência das variáveis foi confirmada após `dotenv/config`; não houve falha de asserção de A02. Com os quatro TTLs de teste definidos, `admin-close-http.test.ts` passou 8/8 e a regressão completa passou 984/984. A diferença 851 vs. 984 ocorreu porque o runner contou os arquivos que abortaram como falhas de arquivo, sem contabilizar seus casos internos.
- Os 13 arquivos foram: `admin-close-http`, `admin-external-queue-http`, `admin-schedule-http`, `evaluation-read-http`, `evaluation-write-http`, `experience-queue-control-http`, `experiences-http`, `mutation-session-http`, `participant-queue-http`, `participation-lifecycle-http`, `queue-entry-di`, `staff-queries-http` e `station-availability-http` (sufixo `.test.ts`).
- Typecheck de produção (`tsc --project tsconfig.json --noEmit`): aprovado.
- Typecheck de produção e testes (`tsc --project tsconfig.test.json`): aprovado.
- Lint: aprovado.
- Build: aprovado.
- PostgreSQL real executado exclusivamente pelo responsável: **70/70** na suíte focada, **22/22** na suíte de banco em Docker e **1.228/1.228** na regressão completa. Não houve validação de produção.

Sem shim, o Node v24.15.0/tsx falhou antes da descoberta dos testes com `uv_os_get_passwd returned ENOMEM`. O shim temporário forneceu o objeto completo esperado por `os.userInfo()` e foi usado tanto na tentativa inicial quanto na regressão final. A evidência mostra que o shim não causou as 13 falhas: com o mesmo shim e os quatro TTLs configurados, a regressão passou 984/984. O shim foi removido e não integra o patch.

Comando da regressão unitária final (não conecta ao PostgreSQL):

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
npm.cmd test -- --test-concurrency=1
```

## Limitações e estado

Não foram adicionadas novas regras, rotas ou respostas públicas. A precisão do COMMIT permanece sujeita ao protocolo A01 documentado: revogação/expiração posterior à última revalidação da sessão e anterior ao COMMIT não é atomicamente detectável. A latência e contenção dos locks do evento continuam proporcionais ao volume de registros, conforme limitação E08.8. A corrida real Admin/job, a sincronização Admin/avaliação, a limpeza e a regressão foram confirmadas pelo responsável no PostgreSQL local isolado.

**Arquivos de implementação/testes/documentação:** os cinco arquivos de código listados em “Alterações” e este relatório (6 arquivos). Evidência única: `qa-evidence/e08-est02-changes.diff`, patch completo relativo à base inicial acima, sem incluir a si próprio. Não foi executado `git add`, commit, push, merge, rebase ou reset.

**Estado final:** A02 corrigida e validada integralmente em PostgreSQL real; E08-EST02 pronta para revisão e versionamento manual.
