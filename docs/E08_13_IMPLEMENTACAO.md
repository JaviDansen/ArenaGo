# E08.13 — Configuração administrativa de eventos, experiências e estações

## Base, retomada e escopo

Entrega única na branch `feature/events-participations`, sobre
`00f89c96e594bbedbb68a462de968da9adff9656`
(`feat(events): implementar consultas e saídas de participação`). Antes das edições,
conferidos branch, HEAD, índice, working tree e arquivos não rastreados: E08.12
commitada e árvore limpa. Snapshot inicial em
`%TEMP%/arenago-e0813-before-TOFfRq/snapshot.json`.

A retomada solicitada pelo responsável preservou integralmente a implementação
e os testes já existentes. A tentativa anterior de regressão unitária foi recusada
antes da execução porque a revisão automática não conseguiu concluir por limite
de uso; não houve classificação da ação como insegura. Após a retomada, o mesmo
fluxo autorizado passou pela revisão e a regressão foi executada, sem alterar
políticas de segurança ou contornar a aprovação.

Consultados AGENTS.md, arquitetura §§14–18/20, planejamento D01–D11 e
C-05/C-10/C-13/C-14, relatórios E08.1–E08.12, schema/migrações e serviços/helpers
correspondentes. A seção 20 prevalece sobre as propostas antigas da seção 18.
As dez rotas ainda não existiam. Reutilizados `AdminEventsModule`, autenticação,
TTL Admin, helpers de autorização, reserva/conclusão duráveis e auditoria.

Base anterior informada pelo responsável: **584 unitários** e **841 PostgreSQL**
aprovados. Esses resultados não aprovam antecipadamente esta implementação.
Não há schema/migrações/dependências novos ou alterações de regras dos serviços
E03/E05, E07.1–E07.6 e E08.1–E08.12. Nenhum teste histórico precisou ser alterado.

## Dez contratos HTTP efetivos

Todas as rotas usam `/api/v1`, Bearer, conta ativa, sessão vigente, Admin global
vigente e 2FA Admin existente. Staff isolado não tem acesso ao CRUD. IDs da rota
são UUIDs validados e normalizados; identidade/sessão vêm exclusivamente do
principal autenticado. Todos os POST/PATCH exigem `Idempotency-Key` válida.

| Método e rota | Entrada | Sucesso / envelope |
| --- | --- | --- |
| `GET /admin/events` | Query paginada estrita | 200 `{ items, nextCursor }` |
| `POST /admin/events` | Configuração completa abaixo | 201 `{ event }` |
| `GET /admin/events/:eventId` | UUID | 200 `{ event }` |
| `PATCH /admin/events/:eventId` | `{ name, reason? }` | 200 `{ event }` |
| `GET /admin/events/:eventId/readiness` | UUID | 200 critérios/fase/aceitação |
| `GET /admin/events/:eventId/experiences` | UUID | 200 `{ eventId, items }` |
| `POST /admin/events/:eventId/experiences` | `{ name, reason? }` | 201 `{ experience }` |
| `PATCH /admin/events/:eventId/experiences/:experienceId` | `{ name, reason? }` | 200 `{ experience }` |
| `POST /admin/events/:eventId/experiences/:experienceId/stations` | `{ label, reason? }` | 201 `{ station }` |
| `PATCH /admin/events/:eventId/experiences/:experienceId/stations/:stationId` | `{ label, reason? }` | 200 `{ station }` |

O payload mínimo de criação do evento é:

```json
{
  "name": "ArenaGo — Dia 1",
  "accessCode": "ARENA-D1",
  "timezone": "America/Sao_Paulo",
  "startsAt": "2026-11-05T17:00:00.000Z",
  "officialEndsAt": "2026-11-05T23:00:00.000Z",
  "operationalDeadlineAt": "2026-11-05T23:30:00.000Z",
  "externalQueueEnabled": true
}
```

`reason` é opcional em todas as seis mutações. Quando informado, usa a validação
administrativa existente: texto não vazio após trim, até 500 caracteres, sem
controles. Quando ausente, auditoria recebe NULL, permitido pelo schema; não é
inventada uma justificativa humana. Isso preserva os exemplos mínimos `{name}`
e `{label}` da arquitetura, sem impor uma regra de produto adicional.

Nomes e labels são aparados nas extremidades, não vazios e limitados a 180/160/120
pontos de código Unicode, respectivamente. Controles, NUL e surrogates isolados
são rejeitados. Código passa por `normalizeEventAccessCode()` C-10: ASCII, 4–64,
grupos alfanuméricos separados por hífen e forma canônica maiúscula. Fuso é IANA
válido pelo Intl e é canonicalizado, inclusive quando digitado com outra caixa.

Instantes de entrada reutilizam `normalizeScheduleInstant()` da E08.7: RFC 3339
absoluto, com fuso explícito, calendário válido e até três casas decimais. Ausência
de fuso, `-00:00`, datas impossíveis ou precisão maior são rejeitados, sem
arredondamento silencioso. Intervalos exigem `startsAt < officialEndsAt`,
`officialEndsAt <= operationalDeadlineAt <= officialEndsAt + 60 minutos`.
A margem não é acrescentada automaticamente. Datas de saída e decisão mantêm
seis casas de microssegundos formatadas no PostgreSQL.

Todos os DTOs são estritos. IDs do corpo, reparent, status, closure, counters,
relógios internos, disponibilidade em PATCH estrutural e campos arbitrários são
rejeitados. JSON malformado/primitivo é rejeitado pelo parser/filtro existente.

## Respostas, paginação e privacidade

`event` contém `id`, `name`, `accessCode`, `timezone`, três horários originais,
`statusStored`, `closureMode`, `closureRequestedAt`, `adminDeadlineAt`,
`externalQueueEnabled`, `effectivePhase`, `readiness`,
`acceptingNewParticipations`, `createdAt` e `updatedAt`.
`readiness` contém `ready`, `missing` e os cinco `checks` descritos adiante.

`experience` contém `id`, `eventId`, `name`, `queueAcceptingEntries`,
`lastQueueOrder` como string decimal exata, `createdAt` e `updatedAt`.
`station` contém `id`, `experienceId`, `label`, `availability`,
`pendingServiceSessionId` derivado, `createdAt` e `updatedAt`.
GET experiências acrescenta `stations` a cada experiência; associações são
agrupadas em memória após consultas constantes, sem consulta por item.

Listagem aceita somente `limit` (1–50, padrão 20), `cursor`, `phase` e
`statusStored`. Usa keyset `(created_at,id)` descendente, desempate por UUID,
limite+1 e cursor base64url canônico com versão, timestamp preciso e UUID.
Reutiliza o padrão E08.10 sem offset, perdas de precisão ou consultas N+1.
Filtros e cursor inválidos são rejeitados; cursor não é autorização nem reserva.

GETs usam `REPEATABLE READ READ ONLY`, autorização SQL no mesmo snapshot e
consultas em número constante, sem `FOR SHARE`/`FOR UPDATE`, escrita, auditoria
ou intenção idempotente. A autorização de leitura usa os mesmos critérios dos
helpers Admin, com SELECT sem locks para respeitar READ ONLY. Prontidão pode
mudar após a resposta; os escritores existentes continuam responsáveis por
suas revalidações transacionais.

DTOs fechados não expõem participantes, nomes de contas, e-mails, perfis,
questionários, tokens, concessões nominais ou auditorias detalhadas. Pendência
de estação é somente o ID da sessão persistida, sem nome/identidade do jogador;
não cria coluna redundante de ocupação nem resolve atendimento em GET.

## Criação, imutabilidade e decisões estruturais

Evento nasce `scheduled`, fechamento Admin NULL, contador externo zero e horários
exatamente solicitados. Pode existir sem experiência, estação ou Staff; nessa
situação não está pronto para novas participações. `UNIQUE(access_code_normalized)`
resolve cadastros concorrentes, com `ON CONFLICT` específico desse código:
um cadastra, outro recebe `ACCESS_CODE_ALREADY_USED`, sem auditoria/intenção órfãs.
O trigger de imutabilidade e a reserva histórica do código permanecem intactos.
Não há DELETE ou mecanismo para reaproveitar códigos de eventos encerrados.

Como decisão conservadora para o ponto proposto da §18.6, PATCH de evento altera
**somente name**, e mudança real é bloqueada após qualquer participação histórica.
Não permite `startsAt`, `timezone`, código, horários de corte, fila externa,
estado/fechamento, counters ou metadados internos. As rotas operacionais E08.5,
E08.6, E08.7 e E08.8 seguem exclusivas e não foram duplicadas.

Criação de experiência e mudanças de experiência.name/station.label usam
`EXISTS(participations WHERE event_id=...)`, sem filtro de status. Waiting,
active, finished e canceled bloqueiam igualmente; reentrada e fila desligada
não liberam edição. A experiência nasce no evento, `queueAcceptingEntries=true`
e contador zero; o PATCH não implementa pausa operacional da fila ainda não
especificada. IDs e relacionamentos são imutáveis.

Nova estação nasce available, valor inicial técnico congelado da proposta,
sem Staff fixo ou fila própria. Adicioná-la à experiência existente é permitido
com histórico, enquanto o evento não estiver closed e o prazo definitivo não
tiver sido atingido. Isso inclui a janela residual de fechamento controlado,
sem reabrir admissões. FIFO, participações, serviços e avaliações são preservados.

Nome/label já igual após normalização é **no-op**: mesmo após histórico ou prazo,
não executa UPDATE do objeto, não muda `updated_at` e não cria auditoria. Exige
autorização e chave, e conclui somente a intenção com a resposta pública. Não é
um atalho para mudança real depois do bloqueio; essa escolha segue o padrão
dos comandos Admin anteriores.

## Prontidão e fase efetiva

`configurationProjection` calcula no PostgreSQL, sem `is_ready` persistido:

| Critério | Predicado |
| --- | --- |
| `nameAndAccessCode` | Nome não vazio com trim equivalente ao JS; código ASCII canônico e comprimento válido |
| `validScheduleAndTimezone` | Intervalos válidos e timezone no catálogo PostgreSQL, comparação sem distinguir caixa |
| `externalQueueConfigured` | Booleano explícito, inclusive false |
| `hasExperienceWithAvailableStation` | Experiência do evento com estação available, mesmo que tenha pending |
| `hasVerifiedActiveStaff` | Concessão Staff do evento não revogada, conta ativa e e-mail verificado, sem exigir sessão conectada |

`missing` usa `EVENT_NAME_OR_ACCESS_CODE_INVALID`, `EVENT_SCHEDULE_INVALID`,
`EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED`, `EXPERIENCE_WITH_AVAILABLE_STATION` e
`VERIFIED_ACTIVE_STAFF`. Estes indicadores administrativos não substituem os
códigos públicos de bloqueio E03/E07 nem expõem pessoas ao participante.

Fases, nesta precedência: closed se estado closed ou prazo definitivo vencido;
closing se fechamento Admin, estado closing ou corte oficial já alcançado;
scheduled se início futuro; not_ready se faltam critérios; open no restante.
Estado persistido scheduled atrasado não impede abertura efetiva quando pronto,
nem permite operar após corte. O prazo definitivo reutiliza
`effectiveEventDeadline()` da E08.9; aceitação exige prontidão, início inclusivo,
corte oficial exclusivo e ausência de fechamento Admin.

Perder a última estação/Staff suspende admissões, sem fechar evento ou cancelar
participantes. Recuperar recursos não supera nenhum corte. GET não abre evento,
não executa o job e não grava estado observado.

**Limitação de catálogo:** entradas novas são validadas/canonicalizadas pelo Intl
do Node, e a leitura valida o catálogo de timezones PostgreSQL. Não é declarada
equivalência universal entre aliases/versões de tzdata dos runtimes. Manter
catálogos compatíveis no ambiente; legado com fuso desconhecido no PostgreSQL
fica sem prontidão. Não foram feitas correções em massa ou migrações de legado.

## Locks, autorização, idempotência e auditoria

Mutações usam `READ COMMITTED`. Em objetos existentes: evento `FOR UPDATE` →
experiência → estação, quando aplicável → conta → concessão Admin global → sessão,
com os helpers existentes. A cadeia estação/experiência/evento é revalidada no
banco; recurso ausente ou de outro pai recebe 404 neutro. Cadastro de evento,
sem linha anterior para bloquear, autentica/bloqueia o ator e usa a unicidade do
código. Não há nova ordem de locks nos escritores antigos.

Após locks e reserva, a sessão é revalidada. A CTE decisiva materializa um único
`clock_timestamp()`, reavalia prazo definitivo e qualquer histórico, e faz o
INSERT/UPDATE condicionado no mesmo comando. Verifica `writtenId`/linha afetada.
Datas dos objetos e auditoria usam esse instante, sem `Date` entre writes.
Sessão é checada novamente antes da conclusão/commit, revertendo efeitos se
expirar. Papel/conta/sessão bloqueados permanecem protegidos até o commit.

As seis operações têm namespaces próprios: `admin_create_event`,
`admin_update_event_metadata`, `admin_create_experience`,
`admin_update_experience`, `admin_create_station` e `admin_update_station`.
Fingerprint contém versão, operação, recurso/cadeia e payload normalizado,
incluindo justificativa opcional; ator integra a chave única existente.
`ADMIN_IDEMPOTENCY_TTL_SECONDS` é reutilizado, sem nova variável ou fallback.

Mesma intenção devolve corpo/status históricos, inclusive após TTL ou fechamento,
sem nova mutação/auditoria. Outra intenção/recurso com a mesma chave conflita;
Admins distintos não compartilham respostas. Replay exige autorização atual e
valida DTO fechado, referência, status e pertencimento. `in_progress` persistido
segue o conflito existente; não há expurgo ou reexecução por TTL.

Mudança efetiva gera uma auditoria na mesma transação, com ator, evento, ação,
objeto, antes/depois mínimo, reason opcional e instante. Replay e no-op não geram
auditoria nova. Falhas revertem objeto, auditoria e reserva juntos. Erros internos
têm mensagem constante `ADMIN_CONFIGURATION_INTERNAL_ERROR`, com causa interna
preservada; o filtro não divulga SQL ou conteúdo privado.

## Erros RFC 7807

| Situação | HTTP / código |
| --- | --- |
| Entrada/UUID/filtros/chave inválidos | 400 `VALIDATION_ERROR` |
| Parsing JSON inválido/primitivo | 400 `BAD_REQUEST`, pelo filtro existente |
| Sessão/2FA inválidos | 401 códigos existentes, incluindo `ADMIN_2FA_REQUIRED` |
| Conta inativa | 401 `ACCOUNT_DEACTIVATED`, compatível com Admin anterior |
| Sem Admin global vigente | 403 `ADMIN_REQUIRED` |
| Objeto inexistente ou cadeia de outro evento | 404 `RESOURCE_NOT_FOUND` |
| Histórico bloqueia mudança estrutural | 409 `EVENT_CONFIGURATION_LOCKED` |
| Evento definitivamente encerrado | 409 `EVENT_OPERATION_ENDED` |
| Código já reservado | 409 `ACCESS_CODE_ALREADY_USED` |
| Outra intenção na mesma chave | 409 `IDEMPOTENCY_KEY_REUSED` |
| Intenção persistida em andamento | 409 `IDEMPOTENCY_IN_PROGRESS` |
| Integridade/falha interna | 500 `INTERNAL_SERVER_ERROR` |

## Arquivos da entrega

| Arquivo | Responsabilidade |
| --- | --- |
| `backend/src/events/admin-configuration.controller.ts` | Dez rotas e composição HTTP |
| `backend/src/events/admin-configuration.dto.ts` | Entradas, cursores e DTOs de resposta/replay |
| `backend/src/events/admin-configuration-query.service.ts` | Consultas/autorização em snapshot readonly |
| `backend/src/events/admin-configuration.projection.ts` | SQL de prontidão/fase e projeções públicas |
| `backend/src/events/admin-configuration.service.ts` | Transação, idempotência, mutações e auditoria |
| `backend/src/events/admin-configuration.mutation.ts` | CTE decisiva de histórico/prazo/escrita |
| `backend/src/events/admin-configuration.problem.ts` | Erros estáveis e sanitização |
| `backend/src/events/admin-events.module.ts` | Registro e exportação sem duplicar rotas antigas |
| `backend/test/unit/admin-configuration.test.ts` | 86 testes de DTO, consultas e serviço |
| `backend/test/unit/admin-configuration-http.test.ts` | 52 HTTP simulados e DI real sem conexão |
| `backend/test/integration/admin-configuration.integration.test.ts` | 188 testes PostgreSQL incluídos na regressão aprovada |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | Atualizações pontuais de §§18/20 |
| `docs/E08_13_IMPLEMENTACAO.md` | Este relatório |

## Validações efetivamente executadas

| Verificação | Resultado |
| --- | --- |
| Específicos de DTO/consulta/serviço | 86/86 aprovados antes da interrupção, preservados e incluídos na regressão final |
| HTTP simulados específicos | 52/52 aprovados antes da interrupção, preservados e incluídos na regressão final |
| Regressão unitária completa na retomada | **722/722 aprovados**, 0 falhas, cancelamentos ou skips |
| Typecheck produção/testes (`typecheck:test`) | Aprovado |
| Lint | Aprovado |
| Build | Aprovado |

Os **138 novos unitários/HTTP simulados** somam-se aos 584 anteriores. Testes
unitários usam doubles próprios e URL local inoperante, com dotenv desativado;
DI real verificou zero conexões. Não foi executado PostgreSQL real pelo Codex.

### Revisão pontual da preparação PostgreSQL

Na retomada, uma preparação ainda não executada tentou alterar um código de
evento para testar prontidão inválida. A migração `0002_events_base.sql` contém
`tr_events_access_code_immutable`, que rejeitaria esse UPDATE com 23514 antes
de alcançar a consulta alvo. Classificação: erro de fixture na preparação, não
defeito funcional confirmado por execução PostgreSQL.

Corrigida somente essa preparação local: INSERT de um evento legado cujo código
inválido C-10 ainda satisfaz o CHECK histórico `upper(btrim(...))`, com experiência,
estação e Staff próprios. O trigger não é desabilitado ou alterado. A asserção
continua exigindo o critério de código falso e foi reforçada para exigir os
outros quatro critérios verdadeiros. Recursos entram na limpeza local da suíte.
Contagem permanece 188; nenhuma fixture compartilhada ou teste aprovado anterior
foi modificado. Typecheck/lint foram repetidos após esse ajuste; a produção e os
unitários já aprovados não mudaram.

### PostgreSQL: aprovação manual definitiva

O responsável confirmou a execução manual da regressão PostgreSQL completa:

| Executados | Aprovados | Falhas | Cancelamentos | Ignorados |
| --- | --- | --- | --- | --- |
| **1.029** | **1.029** | **0** | **0** | **0** |

A regressão aprovada contempla todos os **188 testes novos E08.13** e os
**841 anteriores**. A contagem inicialmente prevista por análise estática foi
confirmada na execução real. O resumo da execução isolada dos 188 testes não
foi fornecido separadamente; não se declara uma execução focada independente.
A aprovação dos 188 está comprovada pela sua inclusão na regressão completa.

Permanecem registrados os resultados locais anteriores: **86/86 específicos de
serviço**, **52/52 HTTP simulados**, **722/722 unitários**, typecheck, lint e build
aprovados. Não há pendências de validação da E08.13.

PostgreSQL foi executado exclusivamente pelo responsável, não pelo Codex.
Nesta finalização, somente o relatório e a evidência foram atualizados; nenhum
teste foi reexecutado. Não foram solicitadas/acessadas credenciais ou alterados
arquivos `.env`, schema, migrações e dependências. Não se declara validação de
produção.

A suíte cobre as dez rotas, auth/2FA/revogação, código/cadastro incompleto,
validações, histórico em quatro estados, cadeias, no-op com `xmin`, defaults,
paginação, privacidade, prontidão/capacidade, replay/TTL/chaves/atores e isolamento.
Concorrências usam conexões/transações independentes, locks reais e
`pg_blocking_pids`, incluindo E03, disponibilidade E08.5, horários E08.7,
Admin E08.8 e job E08.9. Snapshot de readiness é mantido durante mudança real
de disponibilidade. Há **24 falhas SQL reais preparadas**: seis mutações ×
reserva/objeto/auditoria/conclusão; o SQL original é executado e validado antes
de `SELECT 1/0` na mesma conexão. Estado e retry são verificados após rollback.

**Limite da cobertura de concessões:** não foram encontrados controllers reais
grant/revoke de papéis neste checkout. Não foi criado um endpoint substituto.
Os testes de perda/recuperação do último Staff usam SQL transacional real sob
lock de evento, exercitando prontidão/ingresso e as tabelas existentes; não
alegam homologação de endpoints grant/revoke ausentes. Auth/Roles e protocolos
dos escritores existentes foram preservados. Nenhuma auditoria geral foi feita.

### Comandos PowerShell de referência para o responsável

Comandos preservados para reprodução futura; a regressão já está aprovada e
nenhuma nova execução é exigida nesta finalização documental.
Usar somente banco local descartável já preparado com as migrações do projeto.
As guardas existentes exigem URLs idênticas, `NODE_ENV=test`,
`127.0.0.1:55432/arenago_events_test`, sem redirecionamentos. Os quatro TTLs estão
explícitos; substituir placeholders somente na sessão local, sem compartilhá-los
ou salvá-los no repositório. A suíte limpa também eventos criados pela nova API,
sem modificar as fixtures compartilhadas.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:EVENT_CLOSURE_INTERVAL_MS = '30000'

# Focado: 188 testes; resumo de execução isolada não fornecido.
# Todos estão incluídos na regressão aprovada; não executados pelo Codex.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-configuration.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Falha na integração PostgreSQL E08.13' }

# Regressão: 1.029/1.029 aprovados manualmente pelo responsável.
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Falha na regressão PostgreSQL completa' }
```

## Evidência e pendências

Evidência única: `qa-evidence/e08-13-changes.diff`, patch completo dos **13 arquivos**
da tabela, incluindo onze novos, contra o HEAD inicial `00f89c9`. UTF-8 sem BOM,
caminhos relativos e cabeçalhos `diff --git`; exclui outros `.diff`, `.env`,
credenciais, dependências instaladas, temporários e mudanças de outras tasks.
Aplicação verificada com `git apply --check` e `git apply` em cópia isolada da base,
seguida de comparação integral dos 13 arquivos finais, normalizando apenas
CRLF/LF conforme Git. Nenhuma omissão/divergência; índice/HEAD e evidências
históricas preservados.

Não há pendências de validação da E08.13. Restam apenas commit e push manuais
pelo responsável; HEAD e índice foram preservados nesta finalização.
Sugestão sem execução: `feat(events): implementar configuração administrativa da Arena`.

Sem add, commit, push, merge ou rebase. E08.14 não iniciada. Não houve auditoria
geral, implantação, telas Expo, BI/exportações, notificações, CRUD de pessoas,
arquivamento/DELETE ou funcionalidade fora dos dez contratos.
