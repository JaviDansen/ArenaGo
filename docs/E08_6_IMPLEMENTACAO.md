# E08.6 — Controle HTTP da fila externa pelo Admin

Implementação em 03/11/2026, branch `feature/events-participations`, sobre
`db29b6bf6a54feab667edb8a36c21eb22c89157c`. Antes das edições, conferidos HEAD,
branch, histórico e `git status --porcelain=v1 --untracked-files=all`: working tree
limpo, sem arquivos não rastreados. A E08.5 está versionada em `db29b6b`
(`feat(events): implementar controle de disponibilidade das estações`). Nenhuma
alteração preexistente incorporada; não foi exigido nem executado push.
Base anterior confirmada pelo responsável: 290 unitários e 371 PostgreSQL aprovados.

## Contrato e autenticação

`PATCH /api/v1/admin/events/:eventId/external-queue`, registrado por
`AdminExternalQueueController` no novo `AdminEventsModule`, importado em AppModule.
O módulo importa ParticipationsModule/EventsModule, DatabaseModule e AuthModule,
sem dependência circular entre Events e Participations.

Exige Bearer válido por `RequireSessionAuth`; ator vem de `CurrentUserId`, sessão
de `CurrentUser('sessionId')`. UUID validado/normalizado com os componentes HTTP
existentes. Body JSON estrito:

```json
{
  "enabled": false,
  "reason": "Acesso direto à Arena autorizado pela organização"
}
```

`enabled` é booleano, sem coerção. `reason` é string obrigatória, aparada nos extremos,
de 1 a 500 caracteres após trim, sem controles ASCII 0–31/127. A justificativa
normalizada é usada na auditoria e no fingerprint; conteúdo do cliente não determina
ator, data, contagem, autorização ou expiração. Arrays, campos extras, corpo ausente,
Content-Type inadequado e JSON malformado são recusados. Idempotency-Key única,
opaca, não vazia, até 128 caracteres e sem controles, pelo validador compartilhado.

Sucesso 200, inclusive no-op e replay, sem `kind`:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "externalQueueEnabled": false,
  "releasedCount": 3,
  "changedAt": "2026-11-03T15:00:00.000Z"
}
```

No-op retorna `releasedCount: 0` e omite `changedAt`. Replay conserva a resposta
original, inclusive contagem e presença/ausência de changedAt; pode representar um
estado histórico se outra intenção já modificou o evento. Não expõe lista de
participantes, perfis, dados pessoais, justificativa, auditoria, sessão ou SQL.
O controller seleciona explicitamente os campos públicos.

| HTTP | Código efetivo |
| --- | --- |
| 400 | `VALIDATION_ERROR` para UUID/body/reason/chave; `BAD_REQUEST` para JSON malformado |
| 401 | Códigos atuais de token, conta e sessão; `ADMIN_2FA_REQUIRED`, inclusive após esperas |
| 403 | `ADMIN_REQUIRED`: sem concessão Admin global vigente, inclusive Staff isolado |
| 404 | `RESOURCE_NOT_FOUND` para evento ausente, após autorizar Admin |
| 409 | `EVENT_REGISTRATION_CLOSED`: início ainda não atingido, corte oficial/Admin ou estado closing/closed impedindo mudança |
| 409 | `EVENT_UNAVAILABLE`: prontidão/capacidade insuficiente |
| 409 | `IDEMPOTENCY_KEY_REUSED` para chave do mesmo ator/operação com payload/evento diferente; `IDEMPOTENCY_IN_PROGRESS` para intenção em andamento |
| 500 | `INTERNAL_SERVER_ERROR` genérico, incluindo integridade de replay, SQL/auditoria e persistência |

O código de conflito de chave segue o contrato administrativo §18.1. Os POSTs
Staff/participante mantêm seus códigos existentes. Não foi alterado o filtro
RFC 7807, a política de autenticação ou as permissões de outras rotas.

## Composição mínima da E05 e autorização

`ParticipationsService.setExternalQueueEnabled(eventId, enabled)` mantém assinatura,
resultados e transação própria READ COMMITTED. Seu corpo foi extraído para
`setExternalQueueEnabledWithTx(tx, eventId, enabled, beforeDecision?)`, que usa o
executor do chamador, sem abrir/confirmar transação interna. O callback opcional
ocorre após os locks, antes da decisão/efeitos; também é chamado para no-op e evento
ausente. Sem callback, a sequência SQL original E05 é mantida. Acrescentado
`@Inject(EventsService)` ao provider E05 para sua nova composição real sob tsx,
verificada pelo teste de identidade das dependências.

`AdminExternalQueueService` abre uma única transação e chama a E05 WithTx. Ordem:
evento FOR UPDATE → waiting do próprio evento FOR UPDATE em UUID crescente ao
desligar → conta → concessão Admin global → sessão, com FOR SHARE nesses três
últimos. A autorização exige conta ativa, `role='admin', event_id IS NULL,
revoked_at IS NULL`, sessão do ator não revogada/expirada e segundo fator confirmado.
Papéis/identidades fornecidos no body, query ou principal não substituem a consulta.
E-mail verificado continua sendo exigência Staff, sem inventar nova regra Admin
além da autenticação vigente e do segundo fator.

A autorização ocorre depois de esperas em evento/participações e é mantida por
locks até COMMIT. A validade temporal da sessão é lida em nova instrução após seu
lock, reavaliada após a reserva idempotente (que pode esperar no índice UNIQUE)
e após a E05, antes de auditar/concluir. Admin ausente/revogado e sessão inválida
bloqueiam também no-op/replay. Para evento ausente, a autorização global ainda é
verificada antes de responder 404, sem reservar intenção.

Depois dessa composição, a E05 original obtém clock_timestamp PostgreSQL após
todas as esperas e aplica `EventsService.evaluateEventAvailabilityById` no mesmo
tx. Preservados prontidão, início inclusivo, corte oficial/Admin exclusivo e estado
administrativo. Janela residual não permite alternar a fila externa; difere da
reativação operacional de estação E08.5. Repetição autorizada continua no-op após
o corte, sem liberar waiting tardio nem reabrir ingressos.

Desligar atualiza flag/timestamp do evento e libera somente waiting para active,
preenchendo arena_entered_at com o instante comum E05. Preserva IDs, ordens bigint,
contadores, snapshots e histórico. Religar afeta ingressos futuros, sem recolocar
ativos em espera ou reiniciar FIFO. Filas internas, atendimentos, experiências e
estações não são alterados. E03 disputa o mesmo lock exclusivo do evento; E04
continua lendo estado confirmado sem nova implementação de consultas.

## Auditoria e idempotência durável

Cada mudança efetiva grava uma linha em `audit_logs` na mesma conexão/transação:
ator, evento, `origin='user'`, `category='event'`,
`action='external_queue_enabled_changed'`, reason normalizada, metadata com
`before/after.externalQueueEnabled` e `releasedCount`. O instante vem de
`events.updated_at`, igual ao instante persistido pela E05. Exige exatamente uma
linha; falha reverte flag, liberações, auditoria e idempotência integralmente.
Não há auditoria de mudança para no-op, replay, recusa ou falha.

Idempotência natural isolada não atende esta rota: um retry antigo poderia desfazer
uma intenção oposta e liberar pessoas novas. A rota exige intenção durável, pelo
helper existente `idempotency_operations`, namespace `admin_set_external_queue`.
Chave única por ator/operação/chave opaca; fingerprint SHA-256 canônico inclui
evento, enabled e reason normalizada. Justificativa não é armazenada em texto no
payload idempotente, somente na auditoria obrigatória; o hash vincula o pedido.

Reserva, resposta 200, E05 e auditoria confirmam juntas. No-op também conclui sua
intenção, para nunca se transformar em uma mudança tardia após outra alternância.
Replay é reconhecido no callback antes de qualquer mutação E05 e devolvido após
rollback desse caminho de consulta/conflito da reserva, sem nova auditoria ou
efeitos duráveis da tentativa de INSERT ON CONFLICT.
Recusas/conflitos ou falhas revertem reservas parciais. Resultado de replay é
validado e projetado sem propriedades extras. A contagem deve ser inteira segura.

**Configuração nova obrigatória:** `ADMIN_IDEMPOTENCY_TTL_SECONDS`, inteiro positivo
compatível com Date, sem valor padrão e sem fallback para TTL Staff/participante.
`AdminIdempotencyPolicy` gera expiresAt no backend; não altera relógio de negócio.
AppModule passa a exigir esse valor ao inicializar o módulo Admin. Fixtures de
auth e profile-games que iniciam AppModule receberam somente essa configuração
explícita. Suítes que iniciam EventsModule sem Admin permanecem independentes.
O valor 60 usado pelos testes é exclusivo de fixture, não define TTL de produção.

Não há expurgo nem invalidação automática por expires_at. Enquanto a linha existir,
o helper preserva o replay mesmo vencido. Política definitiva de retenção/expurgo
continua sem implementação; esta entrega não autoriza apagar uma intenção vencida
e reexecutá-la. Nenhum campo, tabela, migration ou dependência nova foi criado.

## Validações executadas pelo Codex

| Verificação | Resultado real |
| --- | --- |
| E05 existente após extração | **5/5 aprovados**, sem alterar seus testes |
| Focados E08.6 + E05, com tsconfig.test | **38/38 aprovados**: 33 novos + cinco E05 |
| Regressão unitária `npm.cmd test` | **323/323 aprovados**: 290 anteriores + 33 novos; zero falhas/cancelamentos/skips |
| Typecheck `npm.cmd run typecheck:test` | Aprovado, incluindo a nova suíte PostgreSQL |
| Lint `npm.cmd run lint` | Aprovado |
| Build `npm.cmd run build` | Aprovado |
| PostgreSQL HTTP E08.6 | **40/40 aprovados manualmente pelo responsável em 03/11/2026** |
| Regressão PostgreSQL completa | **411/411 aprovados manualmente pelo responsável em 03/11/2026** |

São 23 testes novos de orquestração com E05 real/driver simulado e dez de HTTP/DI/
configuração. DI real sob tsx verifica controller → orquestrador → E05 → EventsService
no mesmo banco e Pool sem conexões, sem init/listen nesse teste.

A primeira execução E05 na sandbox falhou antes dos testes por
`uv_os_get_passwd / ENOMEM` do tsx. Execuções aprovadas fora da sandbox, com
DOTENV_CONFIG_PATH=NUL, URL fictícia sem conexão e três TTLs explícitos. Nenhum
.env, credencial, Neon ou PostgreSQL real foi acessado. Não houve falha funcional
nos focados/typecheck/lint/build. A revisão técnica foi restrita à E08.6,
confrontando E05, locks, schema, helpers idempotentes, Auth e fixtures. A fixture
unitária do corte deriva o prazo operacional do encerramento oficial e exige
prontidão estática válida, isolando o impedimento temporal sem configuração inválida.
O teste de namespace exige os dois atores exatos, sem depender da ordem entre
auditorias que eventualmente compartilhem o mesmo milissegundo.

## PostgreSQL — validação manual concluída

Foram aprovados manualmente em 03/11/2026 os **40 testes HTTP PostgreSQL** em
`backend/test/integration/admin-external-queue-http.integration.test.ts`, iniciando
AppModule real, e os **411 testes da regressão PostgreSQL completa** (371 anteriores
+ 40 novos). Houve zero falhas, cancelamentos ou testes ignorados. Inclui quatro casos gerados pelas matrizes de alternância
oposta e corte temporal durante locks de evento/participação.

Cobertura: autenticação/Admin/2FA/sessão; UUID/body/reason/chave; liberação e
preservação de active/finished/canceled, snapshots, ordens e outros eventos;
filas internas/atendimentos; reativação e ingresso E03/FIFO; cortes e prontidão;
no-op; replay após intenção oposta, no-op histórico, expiração técnica, perda de
autorização, conflitos por evento/payload/ator e in_progress; auditoria e rollback.

Concorrência usa transações PostgreSQL reais e conexões independentes. Helpers
mantêm a primeira operação antes do COMMIT e exigem pg_blocking_pids para observar
a segunda bloqueada; depois liberam e verificam resultados. Testam E03 nas duas
ordens, alterações iguais/opostas, fechamento, revogação e mudanças de sessão/2FA
durante espera. Encerramento é alteração exclusiva de fixture, sem nova rota.
Os testes de corte configuram margem de dez segundos, exigem bloqueio observado
antes do corte, aguardam o relógio PostgreSQL ultrapassá-lo e confirmam a espera
ainda ativa antes de liberar o lock. Polling não é a prova de sincronização.

Falhas intermediárias usam erro PostgreSQL real (`SELECT 1/0`) após efeitos E05,
na auditoria, após auditoria e após conclusão idempotente, dentro do mesmo tx.
Asserções confirmam liberações/estado completed antes da falha nas fases relevantes
e comparam o estado integral depois do rollback. Não substituem SQL/resultados
por mocks. Wrappers são restaurados e operações liberadas/aguardadas em finally.
Snapshots preservam ordens bigint como texto exato, sem arredondamento numérico.

Preflight antes dos providers exige as três URLs idênticas, sem parâmetros,
exclusivamente `127.0.0.1:55432/arenago_events_test`. Limpeza transacional restrita
aos UUIDs próprios. Sem migrations, seed ou reset. Com banco local já preparado,
o responsável configura suas credenciais sem compartilhá-las:

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
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-external-queue-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.6 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

## Arquivos e evidência

- `backend/src/app.module.ts`: importa o módulo Admin.
- `backend/src/events/admin-events.module.ts`: providers/controller e composição de módulos.
- `backend/src/events/admin-external-queue.controller.ts`: PATCH e respostas RFC 7807.
- `backend/src/events/admin-external-queue.dto.ts`: UUID e body/reason estritos.
- `backend/src/events/admin-external-queue.service.ts`: autorização, E05, auditoria e idempotência.
- `backend/src/events/admin-external-queue.types.ts`: contratos internos e públicos mínimos.
- `backend/src/events/admin-idempotency.policy.ts`: configuração técnica própria obrigatória.
- `backend/src/participations/participations.service.ts`: extração WithTx/callback e DI explícita.
- `backend/test/unit/admin-external-queue.test.ts`: 23 testes de orquestração.
- `backend/test/unit/admin-external-queue-http.test.ts`: dez testes HTTP/DI/configuração.
- `backend/test/integration/admin-external-queue-http.integration.test.ts`: 40 testes HTTP PostgreSQL aprovados manualmente.
- `backend/test/integration/auth.integration.test.ts`: somente TTL Admin na inicialização.
- `backend/test/integration/profile-games.integration.test.ts`: somente TTL Admin na inicialização.
- `docs/ARQUITETURA_BACKEND_ARENAGO.md`: nota local na §17.10.
- `docs/E08_6_IMPLEMENTACAO.md`: este relatório.

Evidência única: `qa-evidence/e08-6-changes.diff`, completa contra o HEAD inicial
`db29b6b`, incluindo os arquivos novos ainda não rastreados. Aplicação validada com
git apply em cópia isolada da base e conteúdo comparado aos 15 arquivos finais com
normalização Git de linhas. UTF-8 sem BOM, caminhos relativos; sem a própria
evidência, outros diffs, .env/segredos, dependências, temporários ou mudanças alheias.
Índice/HEAD preservados. Sem git add, commit, push, merge ou rebase. Sem outras
rotas Admin, controle da fila de experiência, encerramento, avaliações, telas,
notificações, auditoria geral ou início de E08.7. A validação manual PostgreSQL
foi concluída; não há validação de produção. Arquivos disponíveis para
revisão/versionamento manual.
