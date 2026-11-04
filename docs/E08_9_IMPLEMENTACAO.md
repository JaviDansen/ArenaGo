# E08.9 — Regularização automática e idempotente de encerramentos

Implementação em 03/11/2026 na branch `feature/events-participations`, base
`03fd90b17efb9ad475aa23e07b6689e511c63092` (`feat(events): implementar encerramento
administrativo de eventos`). Antes das edições, branch/HEAD/histórico/índice/working
tree e arquivos não rastreados conferidos: E08.8 commitada, árvore limpa e índice
sem alterações. Nenhuma mudança preexistente incorporada. A aprovação manual
anterior de 530 testes PostgreSQL é a registrada pelo responsável na E08.8.

## Execução interna e regra temporal

EventClosureService integra o EventsModule existente e não expõe endpoint HTTP.
EventClosureScheduler executa um ciclo no OnApplicationBootstrap e agenda o
seguinte por setTimeout depois de terminar cada ciclo. Reinicialização repete a
descoberta dos vencidos, independentemente de requisições de pessoas ou Staff.
Reutiliza NestJS, Node, Drizzle e o pool atual, sem dependências ou migrations.

O prazo definitivo é `LEAST(events.operational_deadline_at, events.admin_deadline_at)`.
No PostgreSQL, LEAST ignora o argumento NULL; sem prazo Admin vale o operacional.
Elegibilidade inclusiva: prazo <= clock_timestamp(), reavaliada depois de todos os
locks, no próprio UPDATE decisivo. Status scheduled/open/closing defasado não
prolonga a janela; prontidão, Staff, experiências e capacidade não condicionam o
encerramento. Antes do prazo, a transação não altera registros.

No normal, preserva os campos de origem administrativa NULL; no controlado,
preserva closure_mode/closure_requested_at/admin_deadline_at e encerra os active
restantes, inclusive sem fila. Waiting externas já finalizadas pela E08.8 não são
reescritas: conservam `admin_controlled_external_wait_closed` e seu timestamp.
Imediato já fechado e íntegro é no-op. Não há segunda intenção Admin implícita,
mudança de prazo original, reabertura ou nova regra de admissões.

## Estados, motivos e instantes

Uma transação por evento efetiva todos os efeitos ou nenhum:

| Registro corrente | Efeito definitivo |
| --- | --- |
| service_sessions pending | canceled, resolved_by_user_id=NULL |
| queue_entries waiting/called | closed |
| participations waiting/active | finished, current_queue_entry_id=NULL |
| events scheduled/open/closing vencido | closed |

Motivo comum às linhas afetadas: `automatic_operational_deadline` sem origem Admin
ou `automatic_admin_deadline` com origem Admin. Ambos cabem em varchar(40) e são
distintos de admin_immediate e de saídas voluntárias. O schema/migration 0004
permite resolved_by_user_id NULL no cancelamento: nenhum Admin/Staff é inventado.

finished_at, closed_at e resolved_at automáticos recebem o **prazo efetivo**,
diretamente em SQL. Esse é o instante lógico do fim operacional, não prova de
permanência física até a execução tardia nem uma saída voluntária. updated_at do
evento recebe o clock_timestamp real da decisão de execução. O resultado interno
closed retorna deadlineAt e executedAt separadamente, formatados no PostgreSQL
em UTC com seis casas; não há passagem por Date ou perda de microssegundos.
Não promete igualdade entre esse instante e o COMMIT.

Assim, job 40 dias atrasado não reinicia/amplia os 30 dias contados de finished_at
para primeiro envio de avaliação. Conclusões reais anteriores são preservadas;
nenhuma conclusão, ausência, avaliação ou contador de conclusão é criado. Não
implementa endpoint de elegibilidade/avaliação ou navegação do app.

Preserva integralmente participações finished/canceled, entradas closed,
atendimentos completed/absent/canceled, ordens bigint/FIFO, snapshots, avaliações,
contadores, flags de fila, disponibilidade, horários originais, auditorias e dados
de outros eventos. Datas/motivos de registros já terminais não são substituídos.

## Locks, integridade e idempotência

READ COMMITTED, ordem compatível com E08.8:
events FOR UPDATE → experiências por UUID → estações por UUID → participações
por UUID → entradas correntes por UUID → atendimentos pending por UUID.
Joins bloqueiam somente a tabela de recurso indicada por OF. A API recebe
contagens dos locks, não arrays ilimitados com todas as pessoas do evento.
As linhas permanecem bloqueadas até o único COMMIT do evento.

Após todas as esperas, revalida: entrada corrente ligada à participação active e
ponteiro correspondente; experiência/evento coerentes; called com pending;
waiting sem pending; pending com entrada called e estação da mesma experiência;
ponteiros somente para entrada corrente da própria participação. FKs compostas
existentes continuam protegendo referências cruzadas. Divergência de vínculos ou
de contagens de escritas lança EVENT_CLOSURE_INTEGRITY e reverte tudo.

Evento closed com qualquer pessoa/entrada/pending corrente ou ponteiro indevido
também lança erro: não declara sucesso falso nem tenta corrigir dados históricos
incoerentes silenciosamente. A descoberta inclui esses fechados incompatíveis.
O log contém código operacional e UUID do evento, sem dados pessoais, SQL,
credenciais ou mensagens arbitrárias de exceção. A causa/dados precisam de
investigação pontual pelo responsável; falhar nesse evento não impede os demais.

O mutex de evento serializa com E03/E05/E08.5–E08.8 e conflita com SHARE das
operações E07. Operação que validou e venceu antes do corte mantém seu resultado
quando confirma; o job reconsulta dados/prazo após esperar. Operações posteriores
continuam sujeitas às guardas temporais próprias, inclusive se o job atrasar.
E08.7 que confirmou alteração válida antes do corte pode deslocar o prazo:
o job aguardando então retorna not_due. Admin imediato vencedor já deixa tudo
regularizado; o job retorna already_closed.

Reexecução e duas instâncias usam estados persistidos + locks, sem Idempotency-Key,
TTL ou reserva de usuário. Closed íntegro não emite UPDATE nem muda timestamps.
Falhas SQL nas quatro fases de escrita revertem evento e todos os efeitos;
próximo ciclo pode repetir. Não grava audit_logs, pois actor_user_id exige uma
pessoa real; a auditoria Admin E08.8 permanece intacta. Observabilidade automática
usa logs operacionais de resultado agregado e falhas, sem conta técnica fictícia.

## Descoberta, configuração e ciclo de vida

Descoberta keyset por UUID, no máximo 100 eventos por consulta, sem OFFSET.
Processa eventos em transações independentes. Erro individual é registrado e
o cursor avança; próximo ciclo começa do início e tenta novamente. Eventos
que vencem atrás do cursor são encontrados no próximo ciclo.

No agendador, somente o lock **do evento** usa FOR UPDATE SKIP LOCKED: evento
ocupado por outra transação/instância é deixado para o próximo ciclo e os outros
avançam. Nunca aplica SKIP LOCKED a pessoas/filas nem publica limpeza parcial.
Chamadas internas diretas podem usar o lock bloqueante para aguardar o evento.

EVENT_CLOSURE_INTERVAL_MS é inteiro decimal de 1000 a 3600000 ms; padrão 30000.
Valor inválido impede a construção do provider. O período é contado depois de
terminar o ciclo, sem sobreposição. runCycle concorrente compartilha a promessa
em andamento. Falhas de descoberta são observadas/logadas e não eliminam os
ciclos seguintes. O timer usa unref.

Produção/desenvolvimento têm agendamento habilitado. NODE_ENV=test o desabilita
por padrão, preservando fixtures/suítes anteriores; somente
EVENT_CLOSURE_JOB_TEST_ENABLED=true habilita automaticamente nesse ambiente.
A flag aceita true/false e não desabilita produção. Testes próprios também
constroem explicitamente o scheduler com política habilitada para controlar
startup/ciclos/shutdown. A fixture PostgreSQL mantém o AppModule com a flag false.

BeforeApplicationShutdown cancela o timer, impede novas páginas/eventos, aguarda
a transação corrente e só então permite o OnApplicationShutdown do pool.
main.ts já habilita shutdown hooks. Não há Redis, cron externo ou worker separado.

Limites: uma transação bloqueia todos os recursos de um evento até terminar;
custo no banco, duração do ciclo e espera crescem com o tamanho do evento.
Não há SLA de latência garantido ou lote parcial. Consulta de candidatos também
depende do volume/índices atuais; otimização futura requer evidência operacional.
Falha persistente de integridade necessita investigação, não tentativas de reparo
que enfraqueçam constraints. Não houve validação de produção ou auditoria geral E08.

## Testes e resultados reais

| Validação e responsável | Resultado |
| --- | --- |
| Unitários específicos E08.9, incluindo agendamento sem banco | 29/29 aprovados (20 serviço + 9 configuração/lifecycle) |
| Regressão unitária completa npm.cmd test | 419/419 aprovados (390 anteriores + 29 novos) |
| npm.cmd run typecheck:test | Aprovado, incluindo integração escrita |
| npm.cmd run lint | Aprovado |
| npm.cmd run build | Aprovado |
| PostgreSQL E08.9 — execução manual pelo responsável | 50/50 aprovados, em execução sequencial com guarda anterior à regressão |
| Regressão PostgreSQL completa — execução manual pelo responsável | 580/580 aprovados; zero falhas, cancelamentos ou testes ignorados |

Zero falhas, cancelamentos ou testes ignorados nas execuções aprovadas. O tsx
falhou inicialmente ao iniciar na sandbox com uv_os_get_passwd/ENOMEM, antes dos
testes; unitários foram executados fora dela com DOTENV_CONFIG_PATH=NUL,
NODE_ENV=test, URL fictícia 127.0.0.1:1/unit_no_connection e três TTLs explícitos de
60. Não houve acesso a .env, credenciais, Neon ou PostgreSQL real. Na preparação,
lint identificou um helper problem copiado e sem uso na fixture nova; ele foi
removido, sem alterar testes anteriores. Checks posteriores aprovados.

Escritos **50 testes PostgreSQL**, inicialmente contados estaticamente pela AST
TypeScript incluindo matrizes, sem execução pelo Codex. A execução manual posterior
aprovou os 50/50 específicos e a regressão **580/580 = 530 anteriores + 50 novos**.
Usam AppModule/serviços e SQL reais, banco local isolado,
fixtures próprias, limpeza transacional e URLs verificadas antes de importar
providers. A fixture nova adapta helpers aprovados E08.8; a suíte anterior fica
intacta. Não substitui PostgreSQL real por mocks.

Cobertura: normal/controlado/imediato; limite inclusivo e microssegundos; antes
do prazo; futuro vazio; sem Staff/capacidade/experiência; históricos terminais,
FIFO/bigint/snapshots/avaliações/outro evento; waiting externa preservada; active
sem fila; cancelamento sem ator humano; idempotência; reinício atrasado; duas
instâncias; evento ocupado e outro independente; paginação acima de 100;
falha isolada e recuperação; ponteiro/entrada/pending incoerentes e FKs cruzadas.
Caso de atraso de 40 dias verifica em SQL que finished_at + 30 dias já venceu.
Na preparação desses cenários, os timestamps das fixtures são envelhecidos antes
do snapshot de referência, mantendo ingresso/chamada/conclusão anteriores ao corte
lógico; não se fabrica conclusão posterior à finalização para testar atraso.

O schema efetivo impede admin_deadline_at maior que operational_deadline_at
(ck_events_closure_deadline). Não se remove/desabilita essa constraint para
fabricar dados: o teste real exige SQLSTATE 23514 e ausência de mutações. O
unitário confere LEAST no SQL decisivo e nas três datas automáticas, que continua
escolhendo o menor mesmo se dados incoerentes forem apresentados pelo driver.
O teste de borda real executa no/apos o prazo e verifica timestamps exatos;
a inclusão da igualdade também é conferida na expressão SQL/contrato unitário,
sem prometer sincronizar duas leituras de relógio na mesma fração de microssegundo.

Matriz concorrente: dez operações (E03, E07.1, E07.4, E07.5, E07.6, E07.3,
E08.5, E08.6/E05, E08.7 e E08.8) × duas ordens = 20 casos. Conexões independentes,
transação vencedora retida antes do COMMIT, espera real observada por
pg_blocking_pids e estado persistido conferido. Casos separados deixam o prazo
vencer durante lock de evento/estação/participação e só então liberam o lock.
Rollback injeta SELECT 1/0 na mesma transação depois de cada escrita real,
confere SQLSTATE 22012, fase atingida e snapshot integral restaurado; retry fecha.
Não altera expectativas/status/asserções das suítes anteriores.

Agendamento sem PostgreSQL usa timers controlados e ciclo Nest real com serviço
simulado: startup, periodicidade, desligamento, ausência de sobreposição,
espera da execução corrente antes de liberar pool, erro individual/descoberta e
retomada por nova instância. Sem novo endpoint, HTTP simulado específico não se
aplica; a regressão completa inclui os HTTP simulados anteriores.

## Validação manual PostgreSQL

O responsável informou a aprovação definitiva da execução manual: 50/50 casos
E08.9 aprovados em sequência, com guarda de sucesso antes de iniciar a regressão,
seguida de 580/580 aprovados na regressão PostgreSQL completa. Zero falhas,
cancelamentos ou testes ignorados nas execuções aprovadas. Os 419/419 unitários,
29/29 específicos, typecheck, lint e build são os resultados locais anteriores;
nenhuma suíte foi reexecutada nesta finalização exclusivamente documental.

A primeira tentativa manual foi bloqueada por autenticação PostgreSQL, SQLSTATE
28P01, com o usuário de exemplo USUARIO ainda na configuração. Credenciais locais
incorretas impediram essa tentativa de validar a funcionalidade; não se tratou de
falha funcional da E08.9. Após configurar as credenciais locais corretas, o
responsável executou com sucesso os específicos e a regressão acima. Não houve
compartilhamento ou registro das credenciais corretas, nem execução PostgreSQL
pelo Codex.

Comandos de referência para repetição manual: executar apenas no banco local de
teste já preparado, substituindo USUARIO:SENHA por credenciais locais corretas
privadamente. As três URLs precisam ser idênticas e sem query/hash; o guard aceita
somente 127.0.0.1:55432/arenago_events_test. Sem migrations/seed/reset nesta task.

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
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/event-closure.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar E08.9 antes da regressão PostgreSQL.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

Os 60 segundos são TTLs de fixture, não política de produção. A aprovação manual
dos 50 novos casos e da regressão completa de 580 está registrada acima.

## Arquivos e evidência única

- backend/src/events/event-closure.service.ts: descoberta e regularização transacional.
- backend/src/events/event-closure.policy.ts: configuração validada e isolamento de testes.
- backend/src/events/event-closure.scheduler.ts: startup, timer, recuperação e shutdown.
- backend/src/events/events.module.ts: registro/exportação dos providers internos.
- backend/test/unit/event-closure.test.ts: 20 testes de serviço/SQL/rollback.
- backend/test/unit/event-closure-scheduler.test.ts: nove testes de configuração/lifecycle.
- backend/test/integration/event-closure-fixture.ts: fixtures reais isoladas/guards/helpers.
- backend/test/integration/event-closure.integration.test.ts: 50 testes PostgreSQL aprovados manualmente.
- docs/ARQUITETURA_BACKEND_ARENAGO.md: nota E08.9 diretamente relacionada à §17.8.
- docs/E08_9_IMPLEMENTACAO.md: este relatório.

Evidência única: qa-evidence/e08-9-changes.diff, completa contra o HEAD inicial
03fd90b, incluindo oito arquivos novos não rastreados e dois modificados.
Validada por git apply --check --whitespace=error-all e aplicação real em cópia
isolada da base; os dez arquivos finais comparados com normalização Git de linhas,
sem omissões ou divergências. UTF-8 sem BOM, diff --git e caminhos relativos;
exclui evidência/outros diffs, .env/segredos, dependências, temporários e alterações
alheias. HEAD e índice preservados; versionamento disponível para revisão manual.
Sem git add/commit/push/merge/rebase, auditoria geral ou início da E08.10.
