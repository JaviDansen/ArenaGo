# E08.4 — Consultas HTTP operacionais do Staff

Implementação em 03/11/2026, branch `feature/events-participations`, sobre
`fb3e75ceb7c73e517928c9a40a9c52c2ae7553c1`. A primeira conferência de HEAD,
branch e `git status --porcelain=v1 --untracked-files=all` encontrou working tree
limpo, inclusive sem arquivos não rastreados. Não havia alterações preexistentes
a incorporar. AGENTS.md local foi preservado. E08.1–E08.3 já estavam versionadas.

## Contratos e autorização

| GET relativo a `/api/v1` | Resposta 200 |
| --- | --- |
| `/staff/events/:eventId/stations` | `eventId`, `stations[]` |
| `/staff/events/:eventId/experiences/:experienceId/queue` | `eventId`, `experienceId`, `observedAt`, `waitingCount`, `acceptingNewEntries`, `canCallWaitingEntries`, `firstWaitingQueueEntryId` |

Cada estação contém exatamente `id`, `experienceId`, `label`, `availability`
(`available`/`unavailable`), `pendingServiceSessionId` e `pendingCalledAt`.
Os dois últimos são null sem atendimento pending; o instante é ISO UTC da chamada
persistida. A descrição da §16.6 exige esse instante, embora seu exemplo histórico
o omita; `pendingCalledAt` explicita o campo sem acrescentar dados pessoais.
Estações são ordenadas por experiência/UUID e estação/UUID no PostgreSQL.
O índice único parcial de pending evita duplicação por atendimento; não há join
de estações com filas. Histórico completed/absent/canceled não ocupa a estação.
Evento sem experiências/estações retorna `stations: []` para Staff autorizado.

As duas rotas usam `@RequireSessionAuth` e `@CurrentUserId`, sem aceitar ator
fornecido por query/body. UUIDs são validados e normalizados pelos validadores
existentes. A camada Auth mantém Bearer, expiração/revogação de sessão e segundo
fator Admin. O serviço consulta a conta ativa, e-mail verificado e concessão
`user_roles(role='staff', event_id=evento, revoked_at IS NULL)` no snapshot dos dados.
Não há cache de concessão nem dependência exclusiva dos papéis obtidos na sessão.

**Admin isolado não autoriza estas leituras.** A menção histórica a gestão Admin
na matriz §16.2 não concede acesso operacional implícito. Esta decisão segue as
exigências Staff da §16.6/§16.8 e a política efetiva E07.4/E08.1. Admin também Staff
precisa de 2FA, preservando o bloqueio atual da autenticação; gestão administrativa
e mutações de disponibilidade mantêm seus contratos próprios e não foram criadas.

| HTTP | Tratamento efetivo |
| --- | --- |
| 400 | UUID inválido: `VALIDATION_ERROR` |
| 401 | Códigos atuais de Bearer, token, sessão, conta inativa e 2FA Admin |
| 404 | `RESOURCE_NOT_FOUND`: evento ausente/alheio, Staff ausente/revogado, e-mail não verificado ou experiência ausente/alheia |
| 500 | `INTERNAL_SERVER_ERROR` genérico pelo filtro RFC 7807 existente |

Todas as recusas 404 têm a mesma resposta sem IDs ou detalhes de existência.
Conta inativa é recusada antes pelo Auth com 401 `ACCOUNT_DEACTIVATED`; a checagem
redundante no serviço protege também a autorização após mudanças concorrentes.
Sem nomes de pessoas, e-mails, contas Staff, perfis, lista nominal de fila ou SQL.
Controllers selecionam explicitamente os campos públicos, sem `kind` interno.

## Semântica dos indicadores e FIFO

Não existia serviço para essas duas consultas Staff. Foi criado
`StaffQueriesService.getStations(staffUserId, eventId)` e
`getQueue(staffUserId, eventId, experienceId)`, registrado/exportado no EventsModule,
com tokens `@Inject` explícitos para o banco e EventsService. O controller apenas
valida parâmetros, delega e projeta respostas; consultas/decisões ficam no serviço.

`acceptingNewEntries` reutiliza
`EventsService.evaluateEventAvailabilityById(eventId, observedAt, tx)` da E06:
configuração/prontidão, Staff apto, recursos, início, corte oficial/Admin e estado
administrativo. Exige ainda `queue_accepting_entries=true` e estação configurada
`available` **nesta experiência**. Ocupação pending não altera a configuração e
não impede, por si só, ingressar para aguardar. Recurso de outra experiência não
habilita ingressos nesta fila.

`canCallWaitingEntries` representa a **janela operacional** efetiva da E07.4:
`status <> 'closed'`, início inclusivo e instante estritamente anterior a
`operational_deadline_at` e a `admin_deadline_at`, se existente. Fila pausada,
corte oficial e fechamento controlado não impedem, isoladamente, chamadas
residuais. Prazo definitivo, fechamento imediato e `closed` impedem chamadas.
Este indicador pode ser true com zero waiting, nenhuma estação disponível ou
todas ocupadas: informa a permissão temporal para operar esperas preexistentes,
sem prometer sucesso na estação concreta. Prontidão para novos ingressos não
substitui as regras próprias da E07.4.

`waitingCount` e `firstWaitingQueueEntryId` usam somente entradas `waiting` do
evento/experiência solicitados, sem incluir `called`, `closed`, fila externa ou
esperas de outra experiência/evento. O seletor é o mesmo da E07.4:
`ORDER BY queue_order, id LIMIT 1`, executado no PostgreSQL sobre bigint. Não há
conversão de queue_order em JavaScript, renumeração nem fila por estação.
O primeiro ID é null se não há waiting. A contagem decimal é convertida somente
após validar inteiro não negativo e seguro; overflow/inconsistência numérica gera
erro interno, sem arredondar silenciosamente.

Não se cria outra definição de elegibilidade nem se pula o primeiro waiting para
ocultar inconsistências de domínio: E07.4 ainda revalida participação active,
ponteiro corrente, ausência de atendimento anterior e FIFO na mutação. Os GETs
não reservam entrada/estação, não concedem permissão futura e não alteram as
regras E07.1–E07.6. Mesmo após encerramento definitivo, mostram contagens/pendências
persistidas sem resolver linhas, com `canCallWaitingEntries=false`.

## Snapshot e ausência de efeitos

Cada consulta abre `REPEATABLE READ READ ONLY` na mesma conexão Drizzle. O primeiro
SELECT autoriza e estabelece o snapshot, usando `statement_timestamp()` PostgreSQL
para observação/avaliação temporal. Os SELECTs seguintes, inclusive a avaliação
E06 de prontidão/recursos, usam o mesmo executor transacional. A consulta de
estações usa dois SELECTs; a de fila, cinco no sucesso. Sem N+1 ou locks de linha.

Uma revogação confirmada depois do primeiro SELECT não invalida o snapshot em
andamento; a próxima consulta a observa. A autenticação da sessão ocorre antes da
transação operacional pelo mecanismo existente. Nenhuma promessa de atualização
em tempo real ou autorização persistente decorre do snapshot. Mutação deve sempre
revalidar estado/tempo atuais, como já faz call-next com `clock_timestamp()` após
esperas. Não há limpeza, gravação, Idempotency-Key ou TTL novo nos GETs.

## Testes executados pelo Codex

| Verificação | Resultado real |
| --- | --- |
| Novos unitários/HTTP com `tsx --tsconfig tsconfig.test.json` | **18/18 aprovados** |
| Regressão unitária `npm.cmd test` | **260/260 aprovados** (242 anteriores + 18 novos), zero falhas/cancelamentos/skips |
| `npm.cmd run typecheck:test` | Aprovado, incluindo compilação dos testes PostgreSQL |
| `npm.cmd run lint` | Aprovado |
| `npm.cmd run build` | Aprovado |
| PostgreSQL HTTP E08.4, execução manual do responsável em 03/11/2026 | **28/28 aprovados**, zero falhas, cancelamentos ou ignorados |
| Regressão PostgreSQL completa, execução manual do responsável em 03/11/2026 | **336/336 aprovados**, zero falhas, cancelamentos ou ignorados |

Os 18 novos testes verificam HTTP 200/400/401/404/500, ator confiável, UUIDs,
projeções fechadas, UTC/nulos, indicadores distintos, contagem segura/overflow,
autorização SQL, transação somente leitura, ausência de mutações e DI real.
O teste DI compara identidade do controller/serviço/EventsService/banco e confirma
Pool sem conexões; não inicializa nem escuta nesse teste.

A primeira execução focada na sandbox falhou **antes dos testes** por
`uv_os_get_passwd / ENOMEM` no tsx. A execução fora da sandbox aprovou os 18;
a regressão unitária também foi executada fora dela. Usados `DOTENV_CONFIG_PATH=NUL`,
URL fictícia sem conexão e TTLs explícitos de 60 segundos para providers dos POSTs
existentes. Nenhum .env ou credencial foi lido e nenhum banco real foi acessado.

O primeiro typecheck da suíte PostgreSQL apontou perda de tipo genérico no wrapper
de `database.transaction` do helper concorrente. Causa: chamada via `Function.call`
inferia `unknown`. Corrigida somente a ligação tipada do método original, mantendo
as asserções e todas as consultas/resultados reais. Novo typecheck aprovado.
Nenhuma expectativa foi alterada para ocultar falha. Lint e build aprovados após
essa correção. Revisão técnica restrita à E08.4 confrontou consultas, fixtures,
schema/FKs/checks, Auth, E06 e seletor/prazos E07.4; sem auditoria geral da E08.

## PostgreSQL real — aprovação manual em 03/11/2026

O responsável confirmou a aprovação manual dos **28/28 testes HTTP Supertest +
PostgreSQL real** em `backend/test/integration/staff-queries-http.integration.test.ts`
e dos **336/336 testes da regressão PostgreSQL completa**. As duas execuções não
tiveram falhas, cancelamentos ou testes ignorados. A regressão corresponde aos
308 testes anteriores e aos 28 novos da E08.4.

Esses resultados são atribuídos exclusivamente à execução manual do responsável.
O Codex não acessou PostgreSQL nem credenciais nesta atualização documental, e os
resultados anteriores de 260/260 unitários, typecheck, lint e build permanecem
registrados como execuções do Codex. Não há validação de produção.

Cobertura prevista: Bearer/sessões; Staff vigente/revogado/alheio; conta/e-mail;
Admin isolado e Admin também Staff/2FA; UUIDs; recursos ausentes/alheios; coleções
vazias; várias estações/experiências; pending e histórico terminal; FIFO com bigint
acima de MAX_SAFE_INTEGER contra ID/timestamp; exclusão called/closed; pausa;
cortes oficial/Admin; futuro; margem residual; encerramento definitivo/imediato;
recursos por experiência; isolamento; privacidade com perfil realmente persistido;
leituras repetidas sem alteração do banco e snapshot sob commits concorrentes.

Os dois testes de snapshot intercalam um commit real em outra conexão após o SELECT
de autorização, para **ambas as rotas**. Um revoga Staff; outro altera fila,
pending, estação, configuração e evento em transação. O GET em curso deve conservar
o estado anterior e o próximo observar o commit. O helper envolve métodos reais,
sem substituir SQL/resultados por mocks, restaura o método em finally e verifica
`transaction_isolation=repeatable read` e `transaction_read_only=on`. Comparações
antes/depois incluem domínio, contas, papéis, sessões, idempotência e snapshots.

Fixtures/limpeza limitadas aos UUIDs próprios; sem migrations, seed ou reset.
Preflight antes de importar providers exige as três URLs idênticas, sem parâmetros,
exclusivamente `127.0.0.1:55432/arenago_events_test`. Não acessar Neon. O responsável
configura as credenciais locais sem compartilhá-las. Com banco já preparado:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/staff-queries-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.4 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

Os comandos abaixo permanecem como procedimento de reprodução no banco local já
preparado; não representam uma pendência de validação.

## Arquivos e evidência

- `backend/src/events/staff-queries.controller.ts`: dois GETs e projeções HTTP.
- `backend/src/events/staff-queries.service.ts`: autorização/leitura/snapshot.
- `backend/src/events/staff-queries.types.ts`: resultados de domínio mínimos.
- `backend/src/events/events.module.ts`: registro/exportação dos providers.
- `backend/test/unit/staff-queries.test.ts`: nove testes de serviço.
- `backend/test/unit/staff-queries-http.test.ts`: nove testes HTTP/DI.
- `backend/test/integration/staff-queries-http.integration.test.ts`: 28 testes PostgreSQL HTTP aprovados manualmente.
- `docs/ARQUITETURA_BACKEND_ARENAGO.md`: notas locais nas §§16.6/16.8.
- `docs/E08_4_IMPLEMENTACAO.md`: este contrato, decisões e resultados.

Evidência única: `qa-evidence/e08-4-changes.diff`, patch completo contra o HEAD-base
acima, incluindo arquivos novos ainda não rastreados. Aplicação com `git apply`
verificada em cópia isolada da base e conteúdo resultante comparado aos arquivos
finais com normalização Git de linhas; índice original preservado. Exclui o próprio
diff e outros diffs, .env/segredos, dependências, temporários e alterações de outras
tasks. Sem novas dependências, migrations, campos de ocupação, telas ou outras
rotas/mutações. Sem git add, commit, push, merge ou rebase. Arquivos disponíveis para
revisão e versionamento manual; próxima task não iniciada. Não há validação de produção.
