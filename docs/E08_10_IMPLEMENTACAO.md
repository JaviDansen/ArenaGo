# E08.10 — Consultas de avaliações, histórico e retomada

Implementação em 04/11/2026, branch `feature/events-participations`, base
`199b8f3085372e1c97da211627656f20d8e2cc58` (`feat(events): implementar encerramento
automático de eventos`). Antes de editar, conferidos branch, HEAD, histórico,
índice, working tree e arquivos não rastreados: E08.9 commitada, árvore limpa e
índice sem alterações. Nenhuma alteração preexistente incorporada. Base PostgreSQL
anterior de 580/580 aprovada manualmente pelo responsável; não é execução do Codex.

## Rotas e respostas efetivas

As cinco rotas abaixo usam prefixo `/api/v1`, GET/200, RequireSessionAuth e
CurrentUserId existentes. EvaluationReadController/Service são registrados no
EventsModule existente, que já integra AuthModule e o banco compartilhado.
Não havia endpoints de avaliações ou histórico a duplicar. ParticipationsService
mantém seus métodos internos getCurrentParticipation/getParticipationById intactos.

| Rota | Resposta |
| --- | --- |
| /participations/:participationId/evaluation-eligibility | Projeção plana de elegibilidade |
| /evaluations/pending | { items: [...] } |
| /participations/:participationId/evaluation | { evaluation: objeto próprio ou null, eligibility: projeção } |
| /participations/history?limit=20&cursor=... | { items: [...], nextCursor: string ou null } |
| /participations/return-state | { recentFinalization: objeto ou null, pendingEvaluationParticipationIds: [...] } |

Elegibilidade possui exatamente participationId, participationStatus,
completedServicesCount, eligible, submitted, pending, firstSubmissionDeadlineAt
e reason. completedServicesCount conta somente service_sessions completed
ligados via queue_entries àquela participação/evento/experiência. Não conta pending,
absent ou canceled; reentradas no mesmo evento têm IDs e contagens independentes.

eligible é **estrutural**: status finished e pelo menos um completed real.
submitted reflete existência de avaliação. pending exige eligible, não submitted
e prazo inicial ainda válido. Assim, eligible pode continuar true depois da
expiração ou submissão, mas pending nunca é true nesses casos.
firstSubmissionDeadlineAt é finished_at + 30 dias para status finished, inclusive
se não houver conclusão; é null nos outros estados.

Prioridade de reason, calculada pela mesma política em todas as projeções:

1. NOT_FINISHED para waiting/active/canceled.
2. Sem completed: EXTERNAL_WAIT_CLOSED para admin_controlled_external_wait_closed,
   ou NO_COMPLETED_SERVICE nos demais motivos.
3. ALREADY_SUBMITTED se a participação estruturalmente elegível já tem avaliação.
4. SUBMISSION_EXPIRED se o prazo inicial terminou sem avaliação.
5. null para participação elegível com pendência válida.

Pendências retornam participationId, event { id, name }, finishedAt,
firstSubmissionDeadlineAt e completedServicesCount. Somente linhas do titular
finished, com completed, sem avaliação e dentro do prazo inicial. Ordenação:
finished_at DESC e UUID DESC. Lista vazia é 200 com items: [], sem tabela nova.

Avaliação existente retorna somente id, participationId, rating, comment,
submittedAt, updatedAt, editableUntilAt, commentAddUntilAt e permissions:
canEditRating, canEditComment e canAddFirstComment. Durante edição integral,
rating/comment podem ser alterados; canAddFirstComment=false identifica que não
está na janela restrita. Nesta última, canEditRating=false,
canEditComment=true/canAddFirstComment=true indicam somente inclusão de primeiro
comentário, sem editar/apagar comentário anterior ou alterar nota.
Após o prazo, ou se a inclusão tardia já foi usada, as permissões são false.
first_comment_at não é exposto; comment atual NULL não restaura a permissão.
Sem avaliação, evaluation:null e a mesma elegibilidade são retornadas com 200.
POST/PATCH não foram implementados; GET não autoriza mutação futura sem revalidação.

Histórico retorna por item participationId, event { id, name }, status, joinedAt,
arenaEnteredAt, finishedAt, finishReason, completedServicesCount e evaluation
{ eligible, submitted, pending }. Mantém waiting/active/finished/canceled como
persistidos e preserva motivos Admin/automáticos; não inventa saída voluntária.
Vazio: items: [], nextCursor:null. Avaliação expirada não aparece como pendente.

Retomada retorna recentFinalization com participationId, eventId, finishReason e
finishedAt, ou null. "Recent" significa a **última finalização de sistema persistida**,
ordenada por finished_at DESC/id DESC, com um dos motivos:
admin_immediate, admin_controlled_external_wait_closed,
automatic_operational_deadline ou automatic_admin_deadline. Não há janela fixa,
acknowledgment, filtro por leitura anterior ou tabela de notificações. Pode retornar
finalização antiga mesmo havendo saída voluntária mais nova. A leitura não consome
o aviso. IDs de pendências são derivados da mesma seleção do endpoint pending,
com a mesma ordem e snapshot; sem completed não cria avaliação pendente.
O Expo decidirá apresentação/navegação junto de current e pending.

## Política temporal e precisão

Cada resposta de domínio abre REPEATABLE READ READ ONLY, captura uma vez
clock_timestamp PostgreSQL em UTC com seis casas e usa esse mesmo instante em
todas as comparações/consultas da resposta. A autenticação mantém sua verificação
temporal anterior e independente. Não usa relógio JavaScript nas regras de domínio.

As durações são 30 × 24 horas (720 horas) e 7 × 24 horas (168 horas), em instantes
UTC, sem depender do fuso da sessão SQL ou de transições de horário de verão:

| Regra | Borda efetiva |
| --- | --- |
| Primeiro envio | observado <= finished_at + 720 horas |
| Edição integral | submitted_at <= observado <= submitted_at + 168 horas |
| Primeiro comentário tardio | +168 horas < observado <= +720 horas, first_comment_at NULL |
| Janela totalmente vencida | observado > submitted_at + 720 horas |

Os dois relógios são independentes: primeiro envio parte de finished_at; edição
parte de submitted_at. updated_at nunca reinicia os prazos. Um GET no último
instante permitido é informativo; POST/PATCH futuros precisarão verificar seu
próprio instante transacional. Todos os timestamps da resposta são formatados
diretamente em SQL, mantendo microssegundos.

Datas retroativas do job E08.9 continuam sendo o prazo lógico original, sem
estender avaliação pelo atraso da execução. Antes da regularização persistida,
histórico pode ainda mostrar active; GET não fecha registros nem simula finished
para torná-los elegíveis. Retomada mostra apenas finalizações já persistidas.

## Paginação, segurança e consistência

Histórico: limit decimal escalar de 1 a 50, padrão 20. Rejeita arrays, valores
fracionários, parâmetros extras e cursor inválido com 400 VALIDATION_ERROR.
Cursor base64url sem padding, até 512 caracteres, JSON estrito versão 1 com
joinedAt UTC de seis casas e UUID. Valida UTF-8, representação base64url,
calendário e campos. Date é usado somente para validar calendário/milissegundos;
o valor completo nunca é convertido para o predicado SQL. Cursor não é segredo
nem autorização: mesmo uma posição fabricada continua filtrada pelo user_id real.

Keyset `(joined_at,id) < (cursor.joinedAt::timestamptz,cursor.id::uuid)`, ambos
DESC. Busca limit+1, retorna limit e gera cursor do último item visível somente
quando há continuação. Agregações ocorrem depois da página limitada. Não usa
OFFSET ou consultas por item. Inserções posteriores ao cursor não duplicam a
página seguinte. Cada página é um snapshot próprio; não promete congelar o histórico
entre requisições caso registros sejam corrigidos/excluídos legitimamente.

Todos os SELECTs de domínio filtram user_id do principal confiável. Participação
inexistente e de terceiro têm o mesmo 404 RESOURCE_NOT_FOUND nas duas rotas por ID.
UUIDs são normalizados pelos validadores existentes. Staff/Admin não obtêm acesso
transversal. Admin participante usa seus próprios IDs e continua exigindo sessão
com 2FA pelo AuthService real. Query/body/header não trocam o titular; no histórico,
parâmetros extras são rejeitados, nas outras consultas não viram identidade.
Nenhuma rota exige Idempotency-Key, perfil completo ou concessão Staff para ler.

Consultas de domínio leem somente participations, events, queue_entries,
service_sessions e evaluations. Não adicionam leitura de questionários, snapshots,
perfis, pessoas ou auditorias. O guard mantém as consultas de autenticação anteriores.
Projeções fechadas não retornam principal, user_id, perfis, credenciais, primeira
data de comentário, atores Staff/Admin ou auditoria. Falhas usam o filtro RFC 7807
existente, sem SQL/detalhes privados na resposta; erro inesperado é 500
INTERNAL_SERVER_ERROR. Contagens fora do intervalo inteiro seguro geram erro,
sem conversão silenciosa.

EvaluationReadPolicy centraliza fatos/condições de todas as rotas, sem repetir
regras em controladores. A contagem lateral faz parte de uma única instrução SQL,
não é N+1 de conexões. Return-state usa pending e depois a última finalização
no mesmo snapshot. Não há locks de linha ou escrita/reserva/limpeza em GET.
Permissões, contagens, avaliação e participação nunca misturam commits posteriores
à abertura do snapshot; a próxima requisição enxerga os novos commits.

No HEAD inicial, `/participations/current` não possuía controller HTTP, embora o
serviço interno exista. Continua retornando o 404 anterior, sem ser capturado como
UUID. As cinco rotas desta entrega são explícitas, com history/return-state literais
declarados antes das rotas parametrizadas e sem rota genérica `:participationId`.
Rotas E08.2 de queue/withdraw e demais endpoints anteriores permanecem intactos.

**Pendência explícita para o inventário das próximas subetapas:** falta o controller
HTTP de `GET /api/v1/participations/current`. A existência do método interno
`ParticipationsService.getCurrentParticipation` não equivale à exposição dessa rota.
Registrar essa lacuna como aberta no inventário futuro; ela não integra as cinco
rotas aprovadas da E08.10 e não foi implementada nesta finalização documental.

Limites: pending e seus IDs retornam a lista completa do titular nos 30 dias,
conforme contrato sem paginação; custo depende desse volume. Não adiciona limite
silencioso ou retenção. Conta/admin/perfis/sessão continuam sob política existente.
Nenhum endpoint de envio/edição, finalização voluntária, UI, aviso consumível,
mudança no job, dependência ou migration foi criado. Não há nova decisão de
produto além das comparações e da semântica de "recente" solicitadas nesta task.

## Testes e resultados reais

| Validação | Resultado e execução |
| --- | --- |
| Unitários específicos de consulta/cursor/política | 21/21 aprovados |
| HTTP simulados e DI real E08.10 | 16/16 aprovados |
| Específicos combinados sob tsconfig.test | 37/37 aprovados |
| Regressão unitária completa npm.cmd test | 456/456 aprovados: 419 anteriores + 37 novos |
| npm.cmd run typecheck:test | Aprovado, incluindo integração escrita |
| npm.cmd run lint | Aprovado |
| npm.cmd run build | Aprovado |
| PostgreSQL real E08.10 | 69/69 aprovados manualmente pelo responsável |
| Regressão PostgreSQL completa | 649/649 aprovados manualmente pelo responsável |

Em 04/11/2026, o responsável confirmou os resultados definitivos da validação
manual no PostgreSQL local: **69 testes E08.10 executados e aprovados** e
**649 testes da regressão completa executados e aprovados**, com **zero falhas,
cancelamentos ou ignorados** em ambas as suítes. A aprovação é atribuída ao
responsável, sem execução PostgreSQL pelo Codex.

Os resultados de **456/456 unitários**, **37/37 específicos**, typecheck, lint e
build foram obtidos anteriormente pelo Codex e permanecem registrados, sem
reexecução nesta rodada exclusivamente documental. Código, testes, schema,
dependências, contratos, decisões e limitações foram preservados. Não há validação
PostgreSQL pendente na E08.10 nem declaração de validação de produção.

Zero falhas, cancelamentos ou testes ignorados nas execuções aprovadas. O tsx foi
executado fora da sandbox devido à limitação uv_os_get_passwd/ENOMEM conhecida,
com NODE_ENV=test, DOTENV_CONFIG_PATH=NUL, URL fictícia
127.0.0.1:1/unit_no_connection e os três TTLs explícitos de 60 segundos.
Não acessou .env, credenciais, Neon ou PostgreSQL real.

Na implementação inicial, foram escritos **69 testes PostgreSQL**, contando
matrizes estaticamente pela AST, sem executar a suíte pelo Codex nem presumir
aprovação. A execução manual posterior confirmou os **649 = 580 anteriores + 69
novos** aprovados. Reutilizam guard, setup/cleanup e helpers da E08.9, com um
arquivo auxiliar novo para os fatos de avaliação; nenhum teste anterior foi alterado.
Fixtures usam SQL/constraints/FKs reais, IDs próprios e limpeza transacional do
helper existente, incluindo avaliações. Agendador E08.9 permanece explicitamente
inativo no AppModule de teste; regularização própria é invocada quando o cenário exige.

Cobrem os cinco contratos, estados e contagens, submissão/expiração, titularidade
inclusive Staff/Admin, sessão/2FA, reentradas, ordenação/cursores/microssegundos,
limites padrão/máximo, inserção entre páginas, leitura repetida sem qualquer escrita,
privacidade, motivos reais E08.8/E08.9 e atraso de 40 dias. Fronteiras de primeiro
envio, edição integral e comentário têm -1, 0 e +1 microssegundo usando instantes
derivados no PostgreSQL e o mesmo fragmento SQL da produção; não há mock de banco
nem tentativa de sincronizar relógios físicos no mesmo microssegundo.

Testes concorrentes retêm o leitor após estabelecer snapshot, confirmam outro
transaction/client com PID diferente e verificam que a resposta mantém relações
anteriores; a próxima leitura mostra o novo commit. Inclui fechamento E08.8 e
complete E07.5 reais concorrentes via HTTP, preservando o estado/contagem anterior
no snapshot e a mudança na requisição seguinte. Leituras repetidas verificam transaction_read_only=on e
comparam participações, avaliações, filas, serviços, sessões, intenções e evento.

## Reprodução da validação PostgreSQL manual aprovada

Para reproduzir no banco local de teste já preparado, substituir USUARIO:SENHA somente
por credenciais locais corretas, privadamente; não enviar esses valores ao Codex.
As três URLs devem ser idênticas, sem query/hash, para
127.0.0.1:55432/arenago_events_test. Nenhum reset/seed/migration nesta task.

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
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:EVENT_CLOSURE_INTERVAL_MS = '30000'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/evaluation-read.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.10 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

60 segundos são TTLs de fixture e não política de produção. Os comandos são
mantidos para reprodução: os **69/69 novos** e a **regressão de 649/649** já foram
aprovados manualmente pelo responsável. Nenhum teste foi reexecutado nesta
consolidação documental; a aprovação não representa validação de produção.

## Arquivos e evidência única

- backend/src/evaluations/evaluation-read.types.ts: contratos públicos.
- backend/src/evaluations/evaluation-read.dto.ts: parâmetros e cursor preciso.
- backend/src/evaluations/evaluation-read.policy.ts: projeção SQL/política compartilhada.
- backend/src/evaluations/evaluation-read.service.ts: consultas/snapshots/keyset.
- backend/src/evaluations/evaluation-read.controller.ts: cinco rotas autenticadas.
- backend/src/events/events.module.ts: registro dos providers/controller.
- backend/test/unit/evaluation-read.test.ts: 21 testes de serviço/política/cursor.
- backend/test/unit/evaluation-read-http.test.ts: 16 HTTP simulados/DI.
- backend/test/integration/evaluation-read-fixture.ts: fatos/fixtures reais específicos.
- backend/test/integration/evaluation-read.integration.test.ts: 69 PostgreSQL aprovados manualmente.
- docs/ARQUITETURA_BACKEND_ARENAGO.md: notas diretamente afetadas nas §§15.10/17.2.
- docs/E08_10_IMPLEMENTACAO.md: este relatório.

Evidência única: qa-evidence/e08-10-changes.diff, completa contra o HEAD inicial
199b8f3, com dez arquivos novos não rastreados e dois modificados. Git apply --check
--whitespace=error-all e aplicação efetiva em cópia isolada da base; doze arquivos
finais comparados com normalização Git de linhas, sem omissões ou divergências.
UTF-8 sem BOM, diff --git e caminhos relativos. Exclui a própria evidência/outros
diffs, .env/segredos, dependências, temporários e alterações alheias. HEAD/índice
preservados; revisão e versionamento permanecem manuais. Sem git add/commit/push/
merge/rebase, auditoria geral E08 ou início de outra task. Sem validação de produção.
