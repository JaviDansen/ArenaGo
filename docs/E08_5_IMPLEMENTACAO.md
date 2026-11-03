# E08.5 — Alteração de disponibilidade das estações

Implementada em 03/11/2026, branch `feature/events-participations`, sobre
`acf0e12575ca189d7255382a5bbe0249a62042a3`. Conferidos HEAD, branch, histórico
recente e `git status --porcelain=v1 --untracked-files=all` antes das edições:
working tree limpo, sem arquivos não rastreados. A E08.4 está versionada no próprio
HEAD `acf0e12` (`feat(events): implementar consultas operacionais HTTP do Staff`).
Nenhuma alteração preexistente foi incorporada. Base de validação anterior informada
pelo responsável: 260 unitários e 336 testes PostgreSQL aprovados.

## Contrato HTTP

`PATCH /api/v1/staff/events/:eventId/stations/:stationId/availability`, registrado
em EventsModule por `StationAvailabilityController`, delega a
`StationAvailabilityService.setAvailability({ userId, sessionId, eventId,
stationId, availability })`. Não havia serviço dessa mutação no backend.

Exige Bearer válido por `RequireSessionAuth`; ator vem de `CurrentUserId` e sessão
de `CurrentUser('sessionId')`. Identidades em query/body não escolhem o ator.
Reutiliza `operationUuid`, `validateOperationParams`, `validateOperationBody`
e o filtro RFC 7807 existentes. UUIDs são normalizados para minúsculas. Corpo JSON
obrigatório, objeto estrito contendo somente `availability: 'available' |
'unavailable'`. Arrays, corpo ausente, valores diferentes, JSON malformado,
campos extras e Content-Type inadequado são recusados.

Resposta 200 para mudança ou repetição:

```json
{
  "stationId": "550e8400-e29b-41d4-a716-446655440401",
  "availability": "unavailable",
  "pendingServiceSessionId": null
}
```

Repetir `available` com atendimento pending retorna 200 com o ID pendente, sem
alterar disponibilidade nem resolver atendimento. O controller projeta apenas os
três campos públicos, sem `kind`, ator, sessão, auditoria, nomes ou dados pessoais.

| HTTP | Código e condição |
| --- | --- |
| 400 | `VALIDATION_ERROR` para parâmetros/body; `BAD_REQUEST` para JSON malformado |
| 401 | Códigos existentes de token/sessão/conta/2FA e revalidação transacional |
| 404 | `RESOURCE_NOT_FOUND`: evento/estação ausente ou alheio, concessão insuficiente ou Staff não verificado |
| 409 | `STATION_HAS_PENDING_CALL`: desativação bloqueada; extensão `station` contém somente os três campos operacionais atuais |
| 409 | `EVENT_OPERATION_ENDED`: mudança efetiva com evento `closed` ou prazo definitivo atingido |
| 500 | `INTERNAL_SERVER_ERROR` genérico, inclusive falha SQL/auditoria, sem SQL ou dados privados |

## Permissões e revalidação

Staff precisa de concessão `role='staff'`, `event_id` igual ao evento, não revogada,
conta ativa e e-mail verificado. Admin precisa de concessão global vigente
`role='admin', event_id IS NULL`, conta ativa e sessão com segundo fator confirmado,
conforme a política atual de Auth. Admin sem Staff pode alterar disponibilidade
por D01/§16.7/§18.1, sem adquirir acesso às consultas exclusivas Staff ou às operações
call-next/complete/absent. Admin também Staff continua sujeito ao 2FA.

Papéis do token/principal não autorizam a mutação. Dentro da transação, após os
locks dos recursos, são bloqueados conta, concessões elegíveis e sessão, nessa
ordem, com `FOR SHARE`. Conta e concessões revogadas durante esperas são relidas
sob READ COMMITTED; os locks retêm a autorização obtida até COMMIT. Outra instrução
após os locks da sessão verifica revogação, expiração por relógio PostgreSQL e 2FA:
expressões de um SELECT com lock podem ter sido avaliadas antes da espera.
A sessão deve pertencer ao ator. Sua expiração é revalidada também no UPDATE.
O vínculo estação → experiência → evento é conferido antes e depois dos locks;
ID ausente/alheio não revela a cadeia persistida.

## Locks, tempo e preservação de estado

Transação `READ COMMITTED`, ordem `events FOR UPDATE` → descoberta não bloqueante
da experiência → `experiences FOR UPDATE` → `stations FOR UPDATE` → conta/papéis/
sessão. A descoberta não concede acesso nem dispensa a revalidação de vínculos.

O lock exclusivo do evento é necessário para a capacidade C-14. Serializa com o
ingresso E03, que usa o mesmo lock exclusivo, e conflita com `events FOR SHARE`
dos serviços E07.1 e E07.4–E07.6. Assim, uma admissão já efetivada é preservada;
uma admissão posterior deve observar a estação desativada. As ordens existentes
de experiência/estação/participação/entrada/atendimento não foram alteradas.
Não há upgrade de SHARE para UPDATE no novo serviço, locks em ordem inversa ou
SKIP LOCKED. Mudanças em estações diferentes do mesmo evento também são
serializadas; isso privilegia a consistência da capacidade, com escopo curto.

Após os locks e a autorização, consulta o pending. A desativação com pending
retorna 409 sem UPDATE ou auditoria. Uma chamada E07.4 não surge entre essa
verificação e o UPDATE se seguir o protocolo existente: precisa antes do SHARE
do evento e dos locks de experiência/estação, incompatíveis com o escritor atual.
Conclusão/ausência já confirmadas permitem desativação; se a desativação observar
pending primeiro, retorna conflito e a resolução pode prosseguir depois.

O instante decisivo vem de `clock_timestamp()` em CTE MATERIALIZED no UPDATE.
Mudanças efetivas exigem `status <> 'closed'` e instante anterior aos prazos
operacional e administrativo, quando existente. Não usa o relógio do aplicativo.
Não se promete precisão do instante de COMMIT nem ausência absoluta de deadlocks;
a aprovação PostgreSQL abaixo valida os cenários cobertos pela suíte.

**Decisão temporal:** a disponibilidade é configuração operacional. A §20.1
permite configurá-la antes da primeira participação; não se exige que o evento
já tenha começado. A §16.7 permite operação residual: reativação após corte
oficial ou fechamento controlado pode restaurar uma estação para chamadas de
waiting preexistentes, até o prazo efetivo. Isso não reabre novas inscrições.
E03/E07.1/E06 continuam aplicando seus cortes oficial/Admin e critérios de
prontidão. Após encerramento definitivo, ambas as mudanças efetivas são negadas.
Repetições autorizadas continuam 200 mesmo após o prazo, pois não mudam estado.

O serviço escreve somente `stations.availability`, `stations.updated_at` e sua
auditoria. Não muda evento, `queue_accepting_entries`, outras estações, filas,
participações, ponteiros, ordens bigint, contadores, snapshots ou atendimentos.
Perder a última estação suspende ingressos dinamicamente pelas guardas existentes,
sem cancelar pessoas ou fechar artificialmente o evento. Outra experiência apta
permanece habilitada. Ocupação pending continua distinta de disponibilidade.
Leituras E08.4 mantêm snapshot somente leitura e observam estado confirmado.

## Auditoria e idempotência

Foi consultado o schema `audit_logs`: não existe helper nem writer de auditoria
de produção no backend atual. A implementação mínima usa esse schema diretamente,
sem tabela/migration nova. Cada transição efetiva grava exatamente uma linha:

- `actor_user_id` e `event_id` do contexto autorizado; `origin='user'`.
- `category='station'`, `action='station_availability_changed'`.
- `metadata`: `stationId`, `experienceId`, `before: { availability }` e
  `after: { availability }`; sem dados de participante, tokens ou justificativa
  inventada. `target_user_id` e `reason` permanecem nulos.
- `occurred_at` obtido de `stations.updated_at` diretamente no PostgreSQL,
  preservando o mesmo instante e precisão do UPDATE.

UPDATE e auditoria usam a mesma conexão/transação. Auditoria sem exatamente uma
linha ou qualquer erro aborta e reverte integralmente a mutação. No-op, conflitos
e recusas não geram auditoria. Não há trilha fictícia de tentativa como mudança.

**Exceção específica à regra geral da §16.1:** aplica a idempotência natural
explicitamente prevista na §16.7. O PATCH declara estado desejado; após serializar
e reautorizar, igualdade com o estado atual retorna 200 sem UPDATE, sem tocar
updated_at e sem duplicar auditoria. Não exige nem interpreta Idempotency-Key,
não reserva `idempotency_operations` e não cria TTL. Os TTLs existentes do módulo
continuam necessários para seus providers de POST, sem política nova nesta rota.
Repetição após uma transição oposta é uma nova mudança real e deve ser auditada;
não é replay histórico de intenção. O cliente deve observar o estado atual antes
de decidir uma nova intenção; retries antigos não possuem garantia de replay.

## Validações executadas pelo Codex

| Verificação | Resultado real |
| --- | --- |
| Focados E08.5 com `tsx --tsconfig tsconfig.test.json` | **30/30 aprovados**, zero falhas/cancelamentos/skips |
| `npm.cmd test` | **290/290 aprovados**: 260 anteriores + 30 novos, zero falhas/cancelamentos/skips |
| `npm.cmd run typecheck:test` | Aprovado, incluindo a suíte PostgreSQL escrita |
| `npm.cmd run lint` | Aprovado |
| `npm.cmd run build` | Aprovado |
| PostgreSQL E08.5 e regressão real | Não executados pelo Codex; aprovados manualmente pelo responsável em 03/11/2026, conforme registro abaixo |

Dos 30 novos, 21 são de serviço e nove HTTP/DI. Cobrem ordem/escopo dos locks,
autorização, sessão após esperas, 2FA, mudanças/no-op/pending, tempo decisivo,
auditoria, rollback, UUIDs/body, RFC 7807, projeções e DI real. O teste DI verifica
identidade controller → serviço → banco e Pool sem conexões, sem init/listen.

A execução inicial do tsx na sandbox falhou antes dos testes por
`uv_os_get_passwd / ENOMEM`. As execuções aprovadas ocorreram fora da sandbox,
com DOTENV_CONFIG_PATH=NUL, URL fictícia sem conexão e TTLs 60 explícitos.
Não foi lido .env, solicitado segredo nem acessado PostgreSQL real/Neon.

O typecheck inicial encontrou apenas incompatibilidade do array readonly da
fixture; corrigido o tipo do parâmetro para aceitar a matriz imutável.
O primeiro focado passou 29/30: a asserção da falha SQL comparava o wrapper com
o erro original. Conferidos `pg-core/session.js` do Drizzle e os testes E07:
Drizzle lança `DrizzleQueryError` com o erro original em `cause`. A asserção passou
a exigir essa identidade exata em `cause`, mantendo a prova de rollback e a
proibição de COMMIT. Nenhuma expectativa de negócio foi alterada.

Revisão técnica pontual confrontou SQL, autenticação, schema/checks/FKs,
E03/E07.1/E07.4–E07.6, E08.4 e especificação. Na revisão estática, o tipo Context
da fixture foi explicitado como IDs string para testar UUID inválido/normalização;
o código esperado de perda de capacidade segue o catálogo efetivo E08.2
`EVENT_UNAVAILABLE`. Preservação de queue_order/last_queue_order é comparada em
texto exato, sem conversão de bigint em number nos snapshots de teste.

## PostgreSQL real — aprovação manual em 03/11/2026

O responsável confirmou a execução e aprovação manual da E08.5 em 03/11/2026:

| Suíte PostgreSQL | Executados | Aprovados | Falhas | Cancelamentos | Ignorados |
| --- | --- | --- | --- | --- | --- |
| HTTP E08.5 | 35 | 35 | 0 | 0 | 0 |
| Regressão completa | 371 | 371 | 0 | 0 | 0 |

Os **35/35 testes HTTP** estão em
`backend/test/integration/station-availability-http.integration.test.ts` e incluem
cenários parametrizados de conclusão/ausência. A regressão **371/371** corresponde
aos 336 testes anteriores e aos 35 novos da E08.5.

Esses resultados são atribuídos exclusivamente à execução manual informada pelo
responsável. Permanecem os resultados anteriores do Codex: **290/290 unitários**,
**30/30 focados**, typecheck, lint e build aprovados. A validação PostgreSQL da
E08.5 está concluída, sem testes de integração pendentes. Não há validação de produção.

Cobrem os 28 grupos solicitados: Staff/Admin, 2FA, conta/sessões, escopo/UUIDs,
body estrito, transições/no-op, pending/409, resolução e histórico, perda da última
estação do evento/experiência, restauração e cortes, fim definitivo, isolamento,
privacidade, auditoria exata/única e rollback. Disputas com call-next, conclusão/
ausência, ingresso E03 e E07.1, dois PATCH e revogação Staff são verificadas com
transações reais e conexões independentes, nas duas ordens relevantes.

Helpers retêm a primeira transação real antes do COMMIT e exigem observação por
`pg_blocking_pids` de que a segunda espera pelos locks. Não dependem somente de
Promise.all ou sleeps presumindo uma corrida. Fixtures também alteram conta,
sessão/2FA, concessão e prazo/status durante uma espera já observada no evento.
Os wrappers sempre restauram o método original e liberam/aguardam as operações
em finally. Um cenário confirma que E08.4 pode ler o estado confirmado durante
um UPDATE ainda não commitado, e observa a mudança na leitura seguinte.

A falha intermediária usa erro PostgreSQL real (`SELECT 1/0`) na fase da auditoria
e após seu INSERT, na mesma transação real. Não substitui resultado de consultas
por mocks. Exige HTTP 500 genérico e igualdade integral do estado antes/depois,
inclusive auditoria e updated_at. Snapshots comparam também filas, participações,
históricos, ordens exatas, contadores e idempotência.

Preflight antes dos providers exige as três URLs idênticas, sem parâmetros,
exclusivamente `127.0.0.1:55432/arenago_events_test`. Fixtures e limpeza transacional
limitadas a UUIDs próprios; sem migrations, seed ou reset. O responsável configura
as credenciais locais sem compartilhá-las. Os comandos abaixo ficam como
procedimento de reprodução no banco local já preparado:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/station-availability-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.5 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

## Arquivos e evidência

- `backend/src/events/station-availability.controller.ts`: PATCH, DTO estrito e RFC 7807.
- `backend/src/events/station-availability.service.ts`: mutação, locks, autorização e auditoria.
- `backend/src/events/station-availability.types.ts`: contratos internos mínimos.
- `backend/src/events/events.module.ts`: registra/exporta provider e controller.
- `backend/test/unit/station-availability.test.ts`: 21 testes de serviço.
- `backend/test/unit/station-availability-http.test.ts`: nove testes HTTP/DI.
- `backend/test/integration/station-availability-http.integration.test.ts`: 35 testes PostgreSQL HTTP aprovados manualmente.
- `docs/ARQUITETURA_BACKEND_ARENAGO.md`: nota local na §16.7.
- `docs/E08_5_IMPLEMENTACAO.md`: este relatório.

Evidência única: `qa-evidence/e08-5-changes.diff`, completa contra o HEAD inicial
`acf0e12`, incluindo arquivos novos ainda não rastreados. Validada com git apply
em cópia isolada da base e comparada aos nove arquivos finais com normalização
Git de linhas. UTF-8 sem BOM, caminhos relativos; exclui a si própria, outros diffs,
.env/segredos, dependências, temporários e alterações alheias. Índice e histórico
preservados; versionamento exclusivamente manual. Nenhuma nova dependência,
migration, rota Admin duplicada, tela, notificação ou alteração de fila. Sem
refatoração E07, git add, commit, push, merge, rebase, auditoria geral ou E08.6.
Validação PostgreSQL concluída conforme execução manual informada pelo responsável;
não há validação de produção.

Nesta finalização documental, o estado inicial conservava os nove arquivos da
E08.5 e sua evidência ainda disponíveis para commit manual, sobre o mesmo HEAD
`acf0e12`. Foram atualizados somente este relatório e a evidência única, preservando
os outros oito arquivos da task e o histórico de implementação acima. O Codex não
executou novamente testes, typecheck, lint ou build, nem acessou PostgreSQL ou
credenciais nesta rodada. O patch atualizado foi aplicado em cópia isolada do
commit-base e comparado aos nove arquivos finais, sem omissões ou alteração do índice.
