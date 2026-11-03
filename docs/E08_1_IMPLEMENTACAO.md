# E08.1 — HTTP das operações Staff

Implementado sobre `b0b18e14631e2dfebeb26456d42b2ba2a69c762a`, branch
`feature/events-participations`. Conferidos os commits separados E07.4–E07.6,
o commit documental e a ponta remota antes de editar código. Working tree inicial
limpo; AGENTS.md permanece deliberadamente ignorado conforme .gitignore versionado.
Base externa informada pelo responsável: 25/25 E07.6 e 243/243 PostgreSQL anteriores.

## Contrato implementado

Todos os caminhos abaixo são relativos a `/api/v1` e usam POST:

| Caminho | Serviço existente | Sucesso/replay |
| --- | --- | --- |
| `/staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next` | CallNextService.callNext | 201 |
| `/staff/events/:eventId/service-sessions/:serviceSessionId/complete` | CompleteService.complete | 200 |
| `/staff/events/:eventId/service-sessions/:serviceSessionId/absent` | AbsentService.absent | 200 |

Controller exige sessão Bearer por RequireSessionAuth. O ator vem exclusivamente
de CurrentUserId; sessão revogada/expirada e Admin sem segundo fator são barrados
pelo mecanismo atual. Staff ativo/verificado, escopo de evento, vínculos, FIFO,
prazos e concorrência continuam sendo decididos nos serviços transacionais,
preservando as regras E07.1–E07.6. Admin isolado não adquire privilégio operacional.

UUIDs são validados e normalizados para minúsculas. Header Idempotency-Key único,
opaco, não vazio, até 128 caracteres, sem controles; chave não é renormalizada.
Somente objeto JSON vazio com Content-Type application/json ou corpo ausente;
campos extras, arrays e corpos não JSON são rejeitados. Corpo não pode determinar
ator, estado, FIFO, timestamps ou expiração. JSON público mantém os contratos
efetivos dos serviços sem o discriminante interno kind; Date vira ISO UTC e
queueOrder permanece decimal exato, inclusive além de Number.MAX_SAFE_INTEGER.

### Configuração explícita de idempotência

Por orientação do responsável, `STAFF_IDEMPOTENCY_TTL_SECONDS` é obrigatório,
sem valor padrão, validado na construção do provider Nest como inteiro positivo
e representável em Date. expiresAt é gerado pelo backend a cada chamada, sem
confiar no cliente. TTL não interfere no relógio PostgreSQL das decisões operacionais.
Nenhum expurgo ou reexecução pelo vencimento foi adicionado; enquanto a linha
existir, os helpers atuais preservam o replay. Retenção/expurgo definitivos
continuam pendentes. Testes fornecem TTL 60 explicitamente, sem definir prazo
de produção. Servidores e suítes antigas que iniciam AppModule também precisam
da configuração no processo.

### Erros RFC 7807

| HTTP | Códigos da camada Staff |
| --- | --- |
| 400 | VALIDATION_ERROR; BAD_REQUEST para JSON malformado |
| 401 | Códigos existentes de Auth/sessão/2FA |
| 403 | STAFF_EVENT_FORBIDDEN |
| 404 | SERVICE_NOT_FOUND |
| 409 | SERVICE_NOT_PENDING, STATION_UNAVAILABLE, STATION_HAS_PENDING_CALL, QUEUE_EMPTY, EVENT_OPERATION_ENDED, IDEMPOTENCY_REQUEST_CONFLICT, IDEMPOTENCY_IN_PROGRESS |
| 500 | INTERNAL_SERVER_ERROR, sem detalhes de integridade, SQL ou IDs |

Vínculo errado de experiência/estação em call-next mantém o bloqueio neutro 403
do serviço. Complete/absent retornam 404 para sessão ausente/de outro evento após
autorizar Staff; não expõem dados de terceiros. Replay é resposta histórica e
continua sujeito à autenticação e autorização atuais.

Correção pontual no filtro compartilhado: o adapter Nest ESM e o runner TS podem
carregar identidades diferentes de HttpException. Além de instanceof, o filtro
reconhece getStatus/getResponse e valida o status, reutilizando mensagens públicas
genéricas. Isso corrige JSON malformado que retornava 500 no teste HTTP. Nenhuma
regra de domínio foi alterada. A correção de injeção E07.1 está registrada abaixo.

## Histórico — validação inicial e pendências daquela rodada

- **214/214 testes aprovados**: 203 anteriores e 11 novos de validação/HTTP com
  Supertest, guard real e serviços simulados. Zero falhas/cancelamentos/skips.
- **11/11 HTTP específicos simulados** aprovados separadamente.
- Typecheck, lint e build aprovados, exit 0.
- **20 testes Supertest + PostgreSQL real escritos, não executados**: autenticação,
  2FA/sessões, permissões, UUIDs/vínculos, headers/corpo, três sucessos, ausência
  com/sem reentrada, replay após expiresAt vencido, conflitos, rollback real e
  concorrência HTTP/FIFO/prazo com bloqueios observados via pg_blocking_pids.
- Regressão PostgreSQL completa pendente (243 anteriores + 20 novos previstos).

As três URLs locais explícitas estavam ausentes. Nenhum .env foi carregado e
nenhum banco acessado; Supertest executado nesta rodada usa somente loopback e
serviços simulados. Unitários receberam URL fictícia sem conexão e TTL explícito;
tsx executado fora da sandbox por sua limitação uv_os_get_passwd conhecida.
Supertest e tipagens adicionados como devDependencies, com lockfile atualizado.

## Execução manual PostgreSQL

Banco local já preparado; substituir apenas as credenciais locais. Preflight
exige as três URLs idênticas, sem parâmetros, exclusivamente no destino indicado.
Fixtures e limpeza usam somente UUIDs próprios. Sem migrations, seed ou reset.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/staff-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar HTTP E08.1 antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Revisar regressão PostgreSQL.' }
```

Evidência original: `qa-evidence/e08-1-changes.diff`, exclusiva contra a base acima.
Sem endpoints de gestão/Admin, telas, migrations, notificações ou refatoração geral.
O bloqueio de commit/push desta rodada vigorou até a confirmação dos testes
PostgreSQL pelo responsável, registrada na validação final abaixo.

## Correção de injeção de dependência — 2026-11-03

Confirmada a falha de resolução automática sob `tsx`: o Nest instancia
`QueueEntryService`, resolve `DRIZZLE_DATABASE`, mas não fornece `EventsService`
ao segundo parâmetro sem token explícito. O teste de regressão
`test/unit/queue-entry-di.test.ts` falhou antes da correção na comparação com
`app.get(EventsService)` e passou após adicionar `@Inject(EventsService)`.
O teste usa `EventsModule`, providers reais, banco Drizzle e Pool reais;
não inicia o lifecycle de conexão nem executa SQL. Confere a identidade das
duas dependências de QueueEntryService e do banco recebido por EventsService.

Houve uma alteração pontual na injeção de dependência de E07.1, sem mudança de
comportamento de negócio: apenas o decorator no construtor. Nenhum outro serviço
foi modificado nesta correção. Os testes PostgreSQL existentes foram preservados.

Resultados efetivamente executados nesta correção:

- `npm test`: **215/215 aprovados**, incluindo o novo teste de DI; zero skips.
- `npm run typecheck:test`, `npm run lint` e `npm run build`: aprovados, exit 0.
- HTTP PostgreSQL E08.1: comando executado, exit 1 no preflight por ausência de
  `DATABASE_URL`; os 20 cenários não chegaram a executar.
- `npm run test:integration`: executado, exit 1; os 20 arquivos de integração
  falharam na carga/preflight pela configuração de banco ausente. Esses 20
  arquivos não equivalem aos 20 cenários HTTP E08.1, nem aos casos da regressão.
- A porta TCP `127.0.0.1:55432` responde, mas as três URLs estão ausentes nos
  escopos processo, usuário e máquina. Nenhum `.env` foi carregado; nenhuma
  credencial foi presumida. Unitários usaram URL fictícia, sem conexão, e TTL 60.
- O runner `tsx` exigiu execução fora da sandbox devido a
  `uv_os_get_passwd`/`ENOMEM`. A primeira versão da asserção de identidade também
  tentou inspecionar o grafo inteiro de providers e excedeu memória ao falhar;
  a asserção final usa comparação booleana e reproduziu a falha de DI diretamente.

Ao fim da rodada de correção, continuavam pendentes os 20 cenários HTTP com
PostgreSQL, a regressão completa e a investigação de falhas independentes após
os fixtures. Naquela rodada não houve aprovação PostgreSQL, commit ou push.
Essas pendências de integração foram resolvidas pela validação manual final abaixo.

Proveniência: a árvore já continha a implementação E08.1, incluindo arquivos
não rastreados e o patch original. O estado anterior desta correção foi copiado
para `%TEMP%/arenago-e081-before-86191227c0374b64ac07d2486990fe43`, com manifesto,
HEAD e status. Não foi usado reset, stash ou alteração do índice. A atribuição
da implementação anterior à E08.1 se apoia no patch existente e no relatório
anterior; não há snapshot desta sessão anterior à implementação original.

Evidência da correção de DI: `qa-evidence/e08-1-changes-rev-20261103-di.diff`,
contra `b0b18e14631e2dfebeb26456d42b2ba2a69c762a`, abrangendo os caminhos do
patch original e esta correção/teste/relatório. O nome foi revisado para preservar
o `.diff` existente conforme AGENTS.md. A aplicação é verificada em cópia isolada
da base e o resultado comparado aos arquivos finais; evidências `.diff`, segredos,
`.env`, dependências e temporários ficam excluídos.

## Validação final manual — 2026-11-03

Resultados confirmados pelo responsável após a correção de DI, no PostgreSQL
local de testes; a integração não foi reexecutada pela sessão do agente:

| Verificação | Resultado confirmado |
| --- | --- |
| HTTP E08.1 + PostgreSQL | **20/20 aprovados** |
| Regressão PostgreSQL completa | **263/263 aprovados** (243 anteriores + 20 HTTP E08.1) |
| Unitários | **215/215 aprovados** |
| Typecheck, lint e build | **Aprovados na última implementação** |

Zero falhas, cancelamentos ou skips nos testes confirmados. O erro inicial
`Cannot read properties of undefined (reading 'evaluateEventAvailabilityById')`
afetava os 20 cenários HTTP durante a preparação, antes dos endpoints. A injeção
explícita `@Inject(EventsService)` e a regressão de DI resolveram essa falha sem
mudar o comportamento de negócio de E07.1. Os bloqueios de configuração e as
falhas anteriores permanecem acima como histórico, não como pendências atuais.
Nenhuma falha independente permanece reportada nos resultados finais confirmados.

A confirmação manual encerra a pendência de integração e autoriza o commit único
da E08.1 e o push para `origin/feature/events-participations`, com a mensagem
`feat(events): implementar operações HTTP da equipe Staff`. Não houve validação
de produção. Retenção/expurgo definitivos continuam fora desta entrega; E08.2
não foi iniciada.

Evidência final completa: `qa-evidence/e08-1-changes-rev-20261103-final.diff`,
contra a mesma base `b0b18e14631e2dfebeb26456d42b2ba2a69c762a`, incluindo
implementação, correção de DI, dependências, testes e documentação final.
Os dois patches anteriores foram preservados. A nova revisão é aplicada em cópia
isolada da base e comparada aos arquivos finais, respeitando a normalização de
linhas do Git. Não inclui arquivos `.diff`, credenciais, `.env`, dependências
instaladas, temporários ou arquivos de outras etapas.

O estado anterior à finalização foi preservado separadamente em
`%TEMP%/arenago-e081-final-before-1a89f66107a7444d99c6b4f6fffc51ea`, incluindo
os arquivos não rastreados, evidências e manifesto de branch/HEAD/status.
O `AGENTS.md` local recebeu a convenção de mensagens de commit em português,
com prefixos Conventional Commits e sem reescrever commits existentes; permanece
ignorado pelo `.gitignore` versionado e fora do patch/commit E08.1.
