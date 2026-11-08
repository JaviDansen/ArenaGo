# E08.7 — Alteração HTTP dos horários do evento pelo Admin

Implementação em 03/11/2026, branch `feature/events-participations`, sobre
`68f7ec47efbdc3578a82838ccfd85898b2391c08`. Antes das edições, conferidos HEAD,
branch, histórico e working tree, incluindo todos os arquivos não rastreados:
estado limpo. E08.6 versionada em `68f7ec4` (`feat(events): implementar controle
HTTP da fila externa pelo Admin`). Nenhum trabalho preexistente incorporado.
Base anterior informada pelo responsável: 323 unitários e 411 PostgreSQL aprovados.

## Contrato implementado

`PATCH /api/v1/admin/events/:eventId/schedule`, por `AdminScheduleController` e
`AdminScheduleService`, registrados no `AdminEventsModule` existente.
Bearer e `Idempotency-Key` única obrigatórios. UUID validado e normalizado pelos
helpers HTTP atuais. Body obrigatório, JSON estrito, somente:

```json
{
  "officialEndsAt": "2026-11-05T23:00:00.000Z",
  "operationalDeadlineAt": "2026-11-06T00:00:00.000Z",
  "reason": "Prorrogação autorizada pela organização"
}
```

Os dois horários são exigidos juntos. Formato aceito: ano 0001–9999, data civil
válida, `T`, hora 00–23, minutos/segundos 00–59, fração opcional de 1–3 casas e
fuso explícito `Z` ou offset `±HH:mm`. Não aceita data local ambígua, espaço no
lugar de T, hora 24, segundo intercalar, `-00:00` (offset desconhecido), data
impossível, instante UTC fora desses anos ou mais de três casas decimais.
Essa precisão é explícita: rejeita em vez de arredondar silenciosamente em Date.
Offsets equivalentes são normalizados em UTC com três casas antes do fingerprint.
`reason` reutiliza exatamente o schema E08.6: trim, 1–500 caracteres e sem controles
ASCII internos. Campos administrativos/identidades extras são recusados.

Resposta 200 com projeção fechada, sem kind, justificativa, ator ou informações
internas:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "officialEndsAt": "2026-11-05T23:00:00.000Z",
  "operationalDeadlineAt": "2026-11-06T00:00:00.000Z",
  "changedAt": "2026-11-03T20:00:00.123456Z"
}
```

`changedAt` é texto PostgreSQL UTC com seis casas, idêntico ao instante persistido
em `events.updated_at`, sem conversão com perda para Date. No-op omite changedAt.
Replay preserva a resposta original, inclusive microssegundos e ausência do campo.

| HTTP | Código efetivo |
| --- | --- |
| 400 | `VALIDATION_ERROR`: parâmetros/body/chave, formatos, margem inválida e novo oficial não futuro ou não posterior ao início; `BAD_REQUEST` para JSON malformado |
| 401 | Códigos atuais de Bearer/conta/sessão e `ADMIN_2FA_REQUIRED` |
| 403 | `ADMIN_REQUIRED`: concessão Admin global ausente/revogada, inclusive Staff isolado ou participante |
| 404 | `RESOURCE_NOT_FOUND`: evento ausente, somente após autorizar Admin |
| 409 | `EVENT_TIME_CHANGE_CLOSED`: corte vigente alcançado, status closing/closed ou configuração de encerramento administrativo |
| 409 | `IDEMPOTENCY_KEY_REUSED` ou `IDEMPOTENCY_IN_PROGRESS`, seguindo E08.6 |
| 500 | `INTERNAL_SERVER_ERROR` genérico, inclusive falha SQL/auditoria/integridade de replay |

Reutiliza `RequireSessionAuth`, CurrentUser/CurrentUserId, validação de operações
e filtro RFC 7807. Para novo intervalo inválido reutiliza `VALIDATION_ERROR`,
sem ampliar o catálogo. Se corte vigente/fechamento e novo horário inválido
coincidem, a decisão temporal dá precedência a `EVENT_TIME_CHANGE_CLOSED`.

## Autorização, locks e decisão temporal

Transação única `READ COMMITTED`: `events FOR UPDATE` → conta FOR SHARE →
concessão Admin global vigente FOR SHARE em ordem de ID → sessão própria FOR SHARE
→ reserva idempotente → comparação/decisão e escrita → auditoria → conclusão.
O lock exclusivo de evento conflita com E03/E05/E08.6/E08.5 e com SHARE de
E07.1/E07.4–E07.6, sem obter locks de experiência/estação/participação em ordem
inversa. Escopo do domínio restrito ao evento solicitado.

As consultas de autorização E08.6 foram extraídas, sem mudança de SQL/regras, para
`admin-operation-auth.ts`, usado pelos dois serviços. Os testes antigos E08.6/E05
permanecem intactos e aprovados. Exige conta ativa, `role='admin'`, event_id NULL,
revoked_at NULL, sessão do ator vigente/não revogada com 2FA confirmado.
Não confia nos papéis do token ou em identidades fornecidas pelo cliente.
Não adiciona requisito de e-mail Staff ao Admin global.

Os locks retêm conta/concessão/sessão até COMMIT. A validade temporal da sessão
é consultada em instrução nova depois dos locks, novamente após possível espera
no índice UNIQUE da reserva, após a escrita e antes da conclusão. A condição do
UPDATE também exige sessão vigente, não revogada e com 2FA.

Para mudança efetiva, uma CTE MATERIALIZED captura `clock_timestamp()` depois
das esperas. A mesma instrução classifica a decisão e condiciona o UPDATE:

- Instante decisivo estritamente anterior ao oficial vigente.
- Status diferente de closing/closed; closure_requested_at, closure_mode e
  admin_deadline_at ausentes. Também bloqueia campos de fechamento com status open.
- Novo oficial estritamente futuro e posterior a starts_at.
- Novo operacional entre o novo oficial e 60 minutos depois, inclusive.

Não usa Date.now para autorizar horários de negócio (somente TTL técnico existente).
Não usa now(), cuja observação ficaria fixada no BEGIN, nem leitura pré-lock como
autorização definitiva. Não consulta prontidão/capacidade para editar programação:
permite antes do início, durante o evento e sem Staff/estação disponíveis, sempre
dentro da janela autorizada. Não cria estado derivado/cache de disponibilidade.

UPDATE altera apenas official_ends_at, operational_deadline_at e updated_at.
Preserva starts_at, status, configuração Admin, fila externa, contadores, filas
internas, participações, snapshots, estações, serviços e históricos.
O instante decisivo pode anteceder o COMMIT; não promete precisão de commit em
milissegundos nem elimina a necessidade da validação PostgreSQL concorrente.

## Auditoria e idempotência durável

Cada mudança efetiva exige exatamente uma linha audit_logs na mesma transação:
actor_user_id, event_id, origin=user, category=event, action=event_schedule_changed,
reason normalizada, metadata.before/after com os dois horários. Antes/depois são
obtidos no PostgreSQL; valores antigos com microssegundos não passam por Date.
occurred_at vem de events.updated_at, o mesmo instante do UPDATE e changedAt.
Falha antes/depois da auditoria ou na conclusão idempotente reverte toda a operação.
No-op, replay e recusa não gravam auditoria fictícia.

Namespace próprio `admin_update_event_schedule`, SHA-256 canônico de evento,
dois horários normalizados e justificativa normalizada. Ator/operação/chave opaca
compõem a unicidade persistida. Reserva, horários, auditoria e resposta mínima
completada confirmam juntos. Texto da justificativa fica somente na auditoria,
não no payload idempotente. Nenhum token é registrado.

Reutiliza `AdminIdempotencyPolicy` e **ADMIN_IDEMPOTENCY_TTL_SECONDS obrigatório**,
sem novo TTL/default/fallback ou migration. expires_at continua metadado técnico:
enquanto a linha existir, seu vencimento não permite reexecutar uma intenção.
Política definitiva de retenção/expurgo continua fora desta task, como na E08.6.

No-op compara os instantes no PostgreSQL (inclusive microssegundos antigos),
sem UPDATE do evento nem auditoria; registra intenção concluída. Seguindo E08.6,
é permitido após corte/encerramento porque não altera horários ou reabre nada,
mantidas autorização e validação do body. Replay é interpretado antes de comparar
com a programação atual ou exigir janela nova; retorna após rollback do caminho
de consulta/conflito da reserva. Uma intenção antiga nunca reaplica horários
depois de outra alteração ou fechamento. No-op histórico também não vira mudança.
Conflitos/falhas revertem reservas parciais. Replay continua exigindo Admin/sessão/2FA atuais.

## Validações reais

| Verificação executada pelo Codex | Resultado |
| --- | --- |
| Focados E08.7 + E08.6 + E05 sob tsconfig.test | **72/72 aprovados**, 34 novos + 38 anteriores |
| Regressão unitária `npm.cmd test` | **357/357 aprovados**, 323 anteriores + 34 novos |
| `npm.cmd run typecheck:test` | Aprovado, incluindo os 51 casos PostgreSQL novos |
| `npm.cmd run lint` | Aprovado |
| `npm.cmd run build` | Aprovado |
| PostgreSQL HTTP E08.7 e regressão completa | Não executados pelo Codex; primeira execução manual focada: **49/51 aprovados**, duas falhas de preparação da fixture; regressão completa não iniciada; aprovação definitiva pendente |

Zero falhas, cancelamentos ou testes ignorados nas execuções aprovadas. Os 34 novos
casos são 26 de DTO/serviço/driver simulado e oito de HTTP/DI. DI real resolve o
controller/serviço/política e banco único sem abrir conexão ou iniciar AppModule.

Na sandbox, tsx falhou antes de iniciar testes por uv_os_get_passwd/ENOMEM;
execuções aprovadas fora dela, com DOTENV_CONFIG_PATH=NUL, URL fictícia
`postgresql://unit:unit@127.0.0.1:1/unit_no_connection` e três TTLs explícitos de 60.
Nenhum .env/credencial/banco real/Neon acessado pelo Codex. O lint inicial apontou
regex de controles e variáveis locais sem uso: ajustados sem alterar as regras.
Na revisão estática da integração, corrigidos fixture de chamada Staff (rota
existente e 201) e estreitamento de tipo do participante. Nenhuma asserção foi
enfraquecida para obter aprovação. Revisão restrita ao contrato E08.7, schema,
locks, autorização, SQL e fixtures diretamente envolvidos.

## PostgreSQL — validação manual pendente

Primeira execução manual informada pelo responsável: **51 executados, 49 aprovados
e duas falhas**, nos cenários `stale-controlled` e `stale-immediate`. A regressão
completa foi corretamente interrompida antes da execução. As falhas ocorreram na
preparação da fixture, antes da chamada ao endpoint: SQLSTATE `42P08`, tipos
inconsistentes deduzidos para `$2` (`text` versus `character varying`).

Conferidos o schema Drizzle e a migration `0002_events_base.sql`: closure_mode é
`varchar(20)`. A correção pontual explicita `$2::varchar(20)` tanto na atribuição
a closure_mode quanto na comparação do CASE, preservando os valores parametrizados
`controlled` e `immediate`. Mantidos status open, solicitação de encerramento no
passado e prazos imediato/controlado: os dois estados intencionalmente defasados
continuam sendo construídos. Permanecem intactos HTTP 409 `EVENT_TIME_CHANGE_CLOSED`
e a comparação integral de ausência de mutações, sem remover cenários ou simular SQL.

Nesta correção foram aprovados typecheck, lint e build locais. Código de produção,
schema, migrations, dependências e asserções preservados. PostgreSQL não foi
executado pelo Codex; a aprovação definitiva dos 51 casos e da regressão completa
continua pendente de nova execução manual. Os resultados unitários/focados acima
pertencem à implementação anterior e não foram reexecutados nesta correção de SQL.

## Atualização retrospectiva de estado — 05/11/2026

Esta seção não reescreve os resultados nem as pendências da rodada original acima.
Ela registra o estado conhecido após as etapas posteriores: E08.1–E08.14 foram
implementadas, e as correções de estabilização E08-EST01–E08-EST04 foram concluídas.
Após a correção A04, o responsável executou manualmente a regressão PostgreSQL e
confirmou **1.229/1.229 aprovados**, sem falhas, cancelamentos ou ignorados; a
regressão unitária mais recente registrada foi **992/992 aprovada**, e typecheck,
lint e build foram aprovados na E08-EST04.

Essa regressão posterior inclui a evolução do produto desde E08.7, mas não é uma
nova evidência isolada dos 51 casos desta etapa. O PostgreSQL continuou sendo
executado exclusivamente pelo responsável; não há nesta atualização validação de
produção nem execução individual contemporânea da suíte E08.7 pelo Codex.

Escritos **51 testes HTTP/integração PostgreSQL**, com AppModule real, em
`backend/test/integration/admin-schedule-http.integration.test.ts`.
Total previsto: **462 (411 anteriores + 51 novos)**, sem presumir aprovação.
Contagem das matrizes conferida estaticamente com a AST TypeScript, sem executar a suíte.

Cobrem payloads, instantes inválidos/precisão, margem 0/60 e fora do intervalo,
início/corte/fechamento com status defasado, ausência de prontidão, permissões,
conta/sessão/2FA, ambos os horários atômicos, auditoria exata e privacidade.
Preservação inclui waiting/active/finished/canceled, snapshots, chamada pending,
filas internas, ordens bigint exatas e outro evento.
Incluem no-op/replay antigos, normalização de fuso/reason, namespace/ator/chave,
expires_at vencido, conflito/in_progress e recusa sem consumir chave.

Concorrência usa conexões/transações independentes, retém a primeira antes do
COMMIT e exige espera real observada por pg_blocking_pids antes de liberar.
Testa duas programações, retry simultâneo, E03/E07.1/E08.6/E08.5 nas duas ordens,
fechamento e revogação. Fechamento é exclusivamente SQL de fixture, não nova rota.
Revalida conta/concessão/sessão/2FA após espera e retenção da concessão até COMMIT.
Testes temporais exigem bloqueio observado antes do corte, aguardam o relógio
PostgreSQL ultrapassá-lo e confirmam que o bloqueio continua antes de liberar.
Incluem corte antigo durante locks de evento/conta, novo oficial vencendo durante
espera, e E03/E07.1/E08.6 bloqueadas observando o novo corte confirmado.

Rollback usa erro SQL real SELECT 1/0, na auditoria, após auditoria e após
conclusão idempotente; confirma efeitos intermediários relevantes antes da falha
e o estado integral restaurado depois. Wrappers delegam SQL real, sem simular
resultados, são restaurados e operações liberadas/aguardadas em finally.

Preflight antes dos providers exige três URLs explícitas idênticas, sem query/hash,
somente `127.0.0.1:55432/arenago_events_test`. Limpeza transacional dos próprios
UUIDs, sem seed/reset/migrations. Com banco local já preparado, o responsável
configura suas credenciais privadamente e executa:

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
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-schedule-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.7 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

O valor 60 é exclusivo de fixture, não define TTL de produção.

## Arquivos e evidência

- `backend/src/events/admin-events.module.ts`: registro do controller/serviço.
- `backend/src/events/admin-external-queue.service.ts`: delegação da autorização ao helper compartilhado, preservando E08.6/E05.
- `backend/src/events/admin-operation-auth.ts`: autorização e sessão Admin transacionais extraídas da E08.6.
- `backend/src/events/admin-schedule.controller.ts`: PATCH, validação/projeção HTTP e RFC 7807.
- `backend/src/events/admin-schedule.dto.ts`: datas exatas, body estrito e margem.
- `backend/src/events/admin-schedule.service.ts`: programação, auditoria e intenção durável atômicas.
- `backend/src/events/admin-schedule.types.ts`: contratos internos/públicos.
- `backend/test/unit/admin-schedule.test.ts`: 26 testes DTO/orquestração/SQL/rollback.
- `backend/test/unit/admin-schedule-http.test.ts`: oito testes HTTP/DI.
- `backend/test/integration/admin-schedule-http.integration.test.ts`: 51 testes PostgreSQL pendentes.
- `docs/ARQUITETURA_BACKEND_ARENAGO.md`: nota local na §17.9, preservando o contrato histórico.
- `docs/E08_7_IMPLEMENTACAO.md`: este relatório.

Evidência única `qa-evidence/e08-7-changes.diff`, completa contra `68f7ec4`,
incluindo os arquivos novos não rastreados. Aplicação validada em cópia isolada
da base, com git apply --check --whitespace=error-all e aplicação efetiva;
conteúdo comparado aos 12 arquivos finais com normalização Git de linhas.
UTF-8 sem BOM, diff --git e caminhos relativos. Exclui a própria evidência,
outros diffs, segredos/.env, dependências, temporários e alterações alheias.
Nenhum arquivo da task omitido. HEAD/índice preservados; versionamento manual.
Não houve git add/commit/push/merge/rebase, implementação de encerramento/jobs,
CRUD estrutural, controles de experiências, Expo, auditoria geral ou início de E08.8.
Integração real pendente; nenhuma validação de produção declarada.
