# E08.8 — Encerramento antecipado HTTP pelo Admin

Implementação em 03/11/2026, branch `feature/events-participations`, sobre
`a63e6330112f573c3f3bdc46b298f3243bc2601f`. Conferidos HEAD, branch, histórico,
índice, working tree e arquivos não rastreados antes das edições: árvore limpa,
índice sem alterações. E08.7 commitada em `a63e633` (`feat(events): implementar
alteração administrativa dos horários do evento`). Nenhuma mudança preexistente
incorporada. Base PostgreSQL anterior informada pelo responsável: 462 aprovados.
O relatório histórico E08.7 foi preservado; esta informação não é execução do Codex.

## Contrato e validação

`POST /api/v1/admin/events/:eventId/close`, no AdminEventsModule existente.
Bearer válido e Idempotency-Key única obrigatórios. UUID normalizado pelos
helpers HTTP atuais. Body obrigatório, JSON estrito:

```json
{ "mode": "immediate", "reason": "Interrupção operacional" }
```

```json
{
  "mode": "controlled",
  "reason": "Encerramento antecipado autorizado",
  "controlledUntilAt": "2026-11-05T19:00:00.000Z"
}
```

Mode admite somente os dois literais. Reason reutiliza o schema E08.6: trim,
1–500 caracteres, sem controles internos. ControlledUntilAt é obrigatório somente
no controlado e proibido no imediato. Reutiliza a normalização E08.7: instante ISO
inequívoco, ano UTC 0001–9999, calendário válido, T e fuso Z/offset explícito,
até três casas decimais, sem hora 24, segundo intercalar, offset desconhecido
-00:00 ou arredondamento silencioso de precisão adicional. Datas equivalentes
normalizam em UTC antes do fingerprint. Identidades/campos administrativos extras,
arrays, corpo ausente, JSON malformado e Content-Type inadequado são recusados.

Resposta 200, inclusive replay, com projeção fechada:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "status": "closing",
  "closureMode": "controlled",
  "newEntriesClosedAt": "2026-11-03T20:00:00.123456Z",
  "effectiveOperationalDeadlineAt": "2026-11-03T20:30:00.000000Z",
  "externalWaitingFinalized": 2
}
```

Não retorna kind, atores, justificativa, participantes, perfis ou auditoria.
Instantes são strings UTC de seis casas geradas pelo PostgreSQL, sem perda por
Date. NewEntriesClosedAt identifica closure_requested_at do encerramento Admin.
EffectiveOperationalDeadlineAt é LEAST(prazo operacional original, prazo Admin),
inclusive no imediato executado depois de o prazo original ter vencido. O modo
imediato retorna status closed; o controlado, closing. A contagem é das waiting
externas efetivamente finalizadas nesta intenção, não de todos os active encerrados.

| HTTP | Código efetivo |
| --- | --- |
| 400 | VALIDATION_ERROR para parâmetros/body/header; BAD_REQUEST para JSON malformado |
| 401 | Códigos atuais de token/conta/sessão e ADMIN_2FA_REQUIRED |
| 403 | ADMIN_REQUIRED para ausência de concessão Admin global vigente |
| 404 | RESOURCE_NOT_FOUND para evento ausente, após autorização |
| 409 | EVENT_ALREADY_CLOSED para evento fechado ou encerramento já iniciado, inclusive com status defasado |
| 409 | CLOSURE_DEADLINE_INVALID para prazo controlado não futuro ou acima dos limites |
| 409 | IDEMPOTENCY_KEY_REUSED ou IDEMPOTENCY_IN_PROGRESS conforme E08.6 |
| 500 | INTERNAL_SERVER_ERROR genérico para SQL, auditoria, integridade ou persistência |

Reutiliza RequireSessionAuth, CurrentUser/CurrentUserId, validação de operações
e filtro RFC 7807. IDs/papéis fornecidos no body/query/token não substituem a
autorização vigente no banco. Staff isolado não recebe a permissão Admin.

## Locks, autorização e relógio decisivo

Uma transação READ COMMITTED. Ordem: events FOR UPDATE → todas as experiências
do evento por UUID → estações por UUID → participações por UUID → entradas waiting/
called por UUID → atendimentos pending por UUID. Recursos recebem FOR UPDATE;
joins usam OF na tabela bloqueada. Não usa SKIP LOCKED, commits intermediários,
lotes publicados parcialmente ou upgrade de SHARE para UPDATE. O mutex do evento
serializa E03/E05/E08.5–E08.7 e conflita com SHARE de E07.1/E07.3–E07.6.

Depois dos recursos: conta → concessão Admin global → sessão própria, com FOR SHARE
retido até COMMIT, via helper compartilhado E08.6/E08.7. Exige conta ativa, role admin
com event_id NULL e revoked_at NULL, sessão do ator vigente/não revogada e 2FA
confirmado. Consulta validade em instrução nova depois dos locks, após reserva
idempotente, após decisão, antes da conclusão e depois dela, antes de retornar ao
COMMIT. UPDATE decisivo também exige sessão vigente/não revogada/com 2FA.

Após todas as esperas, revalida relações experiência/estação/participação/entrada/
atendimento: entrada corrente exige active e ponteiro coerente; called exige
pending correspondente, waiting não possui pending; pending exige called e estação
da mesma experiência. Inconsistências ou contagens divergentes causam rollback/500.
Não converte inconsistência de domínio em fechamento parcial aparentemente válido.

Uma CTE MATERIALIZED usa clock_timestamp() após locks/reserva, classificando e
condicionando a escrita na mesma instrução. Nunca usa o relógio do aplicativo para
autorizar fechamento/prazo. Recusa novo encerramento com status closing/closed,
closure_mode, closure_requested_at ou admin_deadline_at já preenchidos. Isso também
impede reabertura quando o status persistido está defasado. Não exige prontidão ou
início já alcançado para encerrar. O controlado pode ocorrer durante janela residual
oficial se ainda houver prazo operacional original suficiente.

ControlledUntilAt deve ser estritamente maior que o instante decisivo, no máximo
uma hora depois dele, e menor ou igual ao operational_deadline_at original.
Não cria prazo passado, não altera o prazo original e não converte silenciosamente
controlado inválido em imediato. Não promete precisão do instante de COMMIT: as
operações residuais continuam fazendo suas próprias guardas temporais no banco.

## Efeitos atômicos e preservação

Imediato grava status closed, closure_mode immediate e closure_requested_at/
admin_deadline_at/updated_at no mesmo instante PostgreSQL. Cancela todos os pending
do evento como canceled, resolved_by_user_id do Admin, cancel_reason admin_immediate.
Fecha waiting/called internas como closed, close_reason admin_immediate. Finaliza
waiting/active como finished, finish_reason admin_immediate e limpa seus ponteiros.
O motivo é compatível com o exemplo administrativo da §17.7 e os varchar(40)
atuais; nenhum enum, tabela ou migration nova. Todas as datas dos efeitos copiam
closure_requested_at diretamente no PostgreSQL, preservando microssegundos.

Controlado grava closing, closure_mode controlled, corte atual e prazo validado;
finaliza somente waiting externas como finished, com exatamente
admin_controlled_external_wait_closed, sem entrada na Arena ou desistência
voluntária. Active com ou sem fila permanecem active; filas/chamadas preexistentes
são preservadas. E07 continua autorizando operação residual até o menor prazo,
sem novas participações, inscrições internas ou reentrada após ausência.

Ambos preservam IDs, ordens bigint, contadores FIFO, snapshots, serviços completed,
resultados terminais/históricos, disponibilidade de estações, flag de fila externa,
horários originais, queue_accepting_entries e outros eventos. Não insere avaliações,
nem produz conclusão ou ausência artificiais. A elegibilidade de avaliação continua
dependendo de completed real, conforme §17.1; nenhum endpoint de avaliação foi criado.

## Idempotência, auditoria e limites

Namespace admin_close_event. Fingerprint SHA-256 inclui evento, modo, prazo controlado
normalizado quando aplicável e reason normalizada. Ator/operação/chave compõem a
unicidade existente. Usa AdminIdempotencyPolicy e ADMIN_IDEMPOTENCY_TTL_SECONDS
obrigatório, sem novo TTL/default/fallback. Expires_at vencido não autoriza reexecução
enquanto a linha existir; retenção/expurgo continuam fora do escopo.

Reserva, corte, efeitos, auditoria e resposta concluída confirmam/revertem juntos.
Replay autorizado é reconhecido antes de novos efeitos/validação de janela e retorna
a resposta histórica após rollback do caminho de consulta/conflito da reserva.
Não reaplica limpeza, reabre evento nem restaura prazo/estado anterior. Replay segue
exigindo autorização atual. Não existe no-op novo por mera igualdade de body: uma
chave distinta é outra intenção e recebe EVENT_ALREADY_CLOSED quando já iniciado.

Auditoria única por mudança: origin user, category event, action event_admin_closed,
ator, evento, reason, before com estado/modo/prazo original/efetivo anterior, after
com modo/estado/corte/prazo efetivo, externalWaitingFinalized. Occurred_at é o mesmo
closure_requested_at do evento. Falha da auditoria ou de qualquer escrita/conclusão
idempotente reverte tudo, sem auditoria fictícia. Payload idempotente contém somente
a resposta pública, sem texto da justificativa ou tokens.

A semântica completa de segunda intenção para encurtar controlado continua sem
aprovação. A E08.8 limita-se ao encerramento inicial e retries da mesma intenção;
recusa outra intenção, inclusive mudança para imediato, sem inventar uma transição.
O job que limpará o estado físico no vencimento controlado/operacional é futuro
(E08.9), **não implementado**. Após vencimento, guardas existentes bloqueiam operação
tardia, mas active/filas/pending podem aguardar o job: não declarar ciclo automático
completo. A transação atômica bloqueia o conjunto do evento; custo/latência crescem
com seu tamanho. Qualquer otimização em lotes exige desenho equivalente de garantia,
fora desta task. Concorrência real e latência ainda dependem de validação manual.

## Validações realizadas e pendências

| Execução pelo Codex | Resultado |
| --- | --- |
| Focados E08.8 + E08.7 + E08.6 + E05 sob tsconfig.test | 105/105 aprovados: 33 novos + 72 anteriores |
| Regressão unitária npm.cmd test | 390/390 aprovados: 357 anteriores + 33 novos |
| npm.cmd run typecheck:test | Aprovado, incluindo a suíte PostgreSQL escrita |
| npm.cmd run lint | Aprovado |
| npm.cmd run build | Aprovado |
| PostgreSQL real (validação manual posterior) | 68/68 HTTP E08.8 e 530/530 na regressão completa aprovados; zero falhas, cancelamentos ou testes ignorados |

Zero falhas, cancelamentos ou testes ignorados nas execuções aprovadas. Os novos
unitários são 25 de DTO/serviço/driver simulado e oito de HTTP/DI. DI real resolve
controller/serviço/banco/política compartilhados, sem conexão ou init/listen.
Unitários executados fora da sandbox pela falha de inicialização conhecida do tsx
(uv_os_get_passwd/ENOMEM), com DOTENV_CONFIG_PATH=NUL, URL fictícia sem conexão
postgresql://unit:unit@127.0.0.1:1/unit_no_connection e três TTLs explícitos de 60.
Nenhum .env, credencial, Neon ou PostgreSQL real foi acessado. Na preparação dos
novos testes, typecheck/lint identificaram um bloco de testes de programação copiado
além dos helpers e um alias local sem uso; ambos removidos do arquivo novo, sem
alterar testes anteriores ou suas expectativas. Nenhuma falha funcional nos focados.

Correção pontual após a primeira execução manual informada pelo responsável:
68 testes executados, 67 aprovados e uma falha no teste de rollback; a regressão
de 530 foi corretamente interrompida antes de iniciar. A fase que não acionava a
injeção era **complete**. O SQL emitido corresponde ao prefixo
`update "idempotency_operations"`, mas completeIdempotencyOperationWithTx usa
`tx.update(...).returning()`, cuja execução preparada passa pela sessão/driver
Drizzle, sem atravessar o `tx.execute` instrumentado. Portanto, alterar somente o
reconhecimento textual não resolveria a causa. O caminho foi conferido no helper
e no Drizzle instalado e reproduzido localmente com driver simulado: um UPDATE
idempotente observado no driver, zero observados pelo interceptador tx.execute;
um SELECT explícito é interceptado. Nenhuma conexão de rede nessa reprodução.

Mantidos os cinco pontos de falha de event/services/queues/people/audit e suas
asserções. Para complete, seguindo E08.6/E08.7, a injeção agora ocorre depois de
`await callback(tx)` e antes do COMMIT: consulta na mesma transação a intenção
exata por ator/operação/chave exclusiva da execução, exige completed/HTTP 200/
referência e payload correspondentes, verifica evento closed, cinco participações
finalizadas, ausência de pessoas/ponteiros/filas/pending abertos, um cancelamento,
um completed preservado e uma auditoria. Só então marca a fase atingida e executa
SQL real SELECT 1/0 na mesma transação. Permanecem obrigatórios HTTP 500
INTERNAL_SERVER_ERROR, reached=true, restauração integral do snapshot e zero
auditorias após rollback. Não simula o banco da integração nem altera produção,
schema, dependências ou testes anteriores.

Nesta correção, focados locais E08.8 (33/33), typecheck, lint e build aprovados;
os demais resultados da tabela pertencem à implementação anterior. O typecheck
exigiu estreitamento explícito do resultado genérico do callback no teste, feito
por asserções de runtime. PostgreSQL não foi reexecutado pelo Codex.

Em 03/11/2026, o responsável confirmou a nova execução manual PostgreSQL após
essa correção: os 68/68 testes HTTP da E08.8 passaram, inclusive o rollback que
antes retornara HTTP 200 inesperadamente, e a regressão PostgreSQL completa passou
em 530/530. Não houve falhas, cancelamentos ou testes ignorados. Esta aprovação
manual posterior confirma o mecanismo corrigido; não altera o histórico da primeira
execução, sua interrupção preventiva da regressão ou a causa verificada acima.

Escritos **68 testes HTTP/integração PostgreSQL**, com AppModule real. Total previsto:
**530 = 462 anteriores + 68 novos**. A contagem das matrizes foi conferida
estaticamente pela AST TypeScript durante a implementação, e a execução manual
posterior aprovou os 68 testes da task e os 530 da regressão completa.

Cobertura: modos, auth/2FA/sessão/revogação, UUID/body/header/prazos/reason, efeitos
imediatos/controlados, preservação de histórico/completed/snapshots/bigint/ponteiros,
privacidade, auditoria exata, replay histórico/vencido/conflitos/in_progress/segunda
intenção e isolamento. Matriz de 36 combinações: dois modos × duas ordens × E03,
E07.1, E07.4, E07.5, E07.6, E07.3, E08.5, E08.6 e E08.7. Usa operações reais;
retém primeira transação antes do COMMIT e exige espera real por pg_blocking_pids.
Verifica resultado vencedor, bloqueios posteriores e operação residual permitida.

Testes temporais observam bloqueio antes do prazo, aguardam relógio PostgreSQL
ultrapassá-lo e reconfirmam o bloqueio antes de liberar evento/estação/participação.
Incluem expiração de sessão e revalidação de autorização após espera; um teste
explicita que vencimento controlado bloqueia resolução sem executar job de limpeza.
Falhas SQL reais SELECT 1/0 são injetadas depois de evento, cancelamentos, filas,
participações, auditoria e conclusão; conferem efeitos intermediários antes do erro
e snapshot integral restaurado depois. Wrappers delegam SQL real, sem mock de banco,
e são restaurados/liberados/aguardados em finally.

Preflight antes dos providers exige três URLs explícitas idênticas, sem query/hash,
somente 127.0.0.1:55432/arenago_events_test. Fixtures isoladas por UUID e limpeza
transacional própria, sem seed/reset/migrations. Para execução manual, configurar
credenciais privadamente no banco local já preparado:

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
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-close-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.8 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

60 segundos é valor de fixture, não definição de TTL de produção.

## Arquivos e evidência única

- backend/src/events/admin-events.module.ts: registro/exportação do endpoint/serviço.
- backend/src/events/admin-close.controller.ts: POST 200, projeção e RFC 7807.
- backend/src/events/admin-close.dto.ts: modos estritos, reason e prazo normalizado.
- backend/src/events/admin-close.types.ts: contratos públicos/internos.
- backend/src/events/admin-close.service.ts: locks, corte, efeitos, auditoria e intenção.
- backend/test/unit/admin-close.test.ts: 25 testes de DTO/serviço/SQL/rollback.
- backend/test/unit/admin-close-http.test.ts: oito testes HTTP/DI.
- backend/test/integration/admin-close-http.integration.test.ts: 68 testes PostgreSQL aprovados manualmente.
- docs/ARQUITETURA_BACKEND_ARENAGO.md: nota local na §17.8, preservando decisões históricas.
- docs/E08_8_IMPLEMENTACAO.md: este relatório.

Evidência única: qa-evidence/e08-8-changes.diff, completa contra a63e633, com os
arquivos novos não rastreados. Aplicação conferida por git apply --check
--whitespace=error-all e aplicação efetiva em cópia isolada da base; conteúdo
comparado aos dez arquivos finais com normalização Git de linhas, sem omissões.
UTF-8 sem BOM, diff --git e caminhos relativos. Exclui a própria evidência, outros
diffs, .env/segredos, dependências, temporários e mudanças alheias. HEAD/índice
preservados; arquivos disponíveis para revisão e versionamento manual.
Sem git add/commit/push/merge/rebase, auditoria consolidada da E08 ou início da
próxima etapa. Nenhuma validação de produção declarada.
