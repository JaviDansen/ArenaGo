# E07.6 — registro manual de ausência

Implementação interna em 03/11/2026, branch `feature/events-participations`.
Base informada pelo responsável: E07.5 com 20/20 PostgreSQL e regressão 218/218
aprovados; esses resultados não são reexecuções desta entrega.

`AbsentService.absent({ staffUserId, eventId, serviceSessionId, idempotencyKey,
expiresAt })`, exportado pelo `EventsModule`. Exige ator confiável do chamador,
conta ativa/verificada e Staff vigente do evento, inclusive em replay; Admin
isolado não opera. Não há timeout ou gatilho de ausência por desconexão.

READ COMMITTED e protocolo comum: descoberta não bloqueante da sessão explícita,
evento SHARE, experiência UPDATE, estação UPDATE, testemunha de estação disponível
da mesma experiência SHARE (C-14/E07.1), conta/concessão Staff SHARE, participação,
entrada e sessão UPDATE. Revalida todos os vínculos/estados/ponteiro após esperas.
Terminal retorna `service_not_pending`; recurso ausente/alheio retorna
`service_not_found` ao Staff autorizado; inconsistência de pending provoca rollback.

Uma transação registra absent com autoria/horário, fecha a entrada original com
motivo absent e timestamp copiado diretamente de resolved_at, opcionalmente cria
nova waiting e atualiza somente o ponteiro correspondente, concluindo idempotência.
Preserva participação active, conclusões anteriores, disponibilidade e ordens alheias.

O UPDATE de ausência usa clock_timestamp() e exige instante anterior aos prazos
operacional/administrativo efetivos. O INSERT da nova entrada usa outro relógio
atual no próprio comando, com incremento de last_queue_order condicionado no
mesmo CTE: início alcançado, antes do corte oficial/Admin, status não closing/closed,
fila aberta, prontidão estática existente e estação disponível na experiência.
A concessão Staff já está protegida. Não exige estação livre para reentrar.
Assim, corte/fila pausada/perda de condições de ingresso não impedem ausência
residual, mas não geram nova entrada nem consomem ordem FIFO. Se o corte ocorrer
entre a resolução e o INSERT, não há reentrada tardia. O commit pode suceder a
decisão temporal, como nos serviços existentes.

Nova tentativa recebe UUID/ordem próprios e posição waiting observada no tx;
bigint é retornado como decimal exato. Namespace `absent_service_session`, fingerprint
de evento/sessão e ator na chave única existente. Replay histórico com/sem reentrada
não resolve novamente nem altera entradas/chamadas posteriores. expiresAt não
implementa expurgo. E07.1–E07.5 preservadas; apenas provider/export adicionado no
módulo comum. Sem HTTP, telas, migrations, commit, push ou merge.

## Validação inicial pelo Codex

- **202/202 unitários aprovados**, incluindo **20 novos E07.6**, zero falhas/skips.
- `typecheck:test`, lint e build aprovados, exit 0.
- **25 testes PostgreSQL escritos, não executados**: reentrada FIFO/bigint/ponteiro,
  cortes/fila pausada/capacidade, permissões/vínculos, retries, disputas reais com
  E07.3–E07.5 nas duas ordens, liberação de estação, conclusões preservadas e
  rollback após resolver/fechar/inserir/apontar/concluir idempotência. Barreiras
  verificam bloqueio real por pg_blocking_pids; teste adicional cruza o corte
  entre a resolução e o INSERT, com relógio do PostgreSQL.

As três URLs explícitas estavam ausentes. Nenhum banco foi acessado ou .env
carregado, incluindo .env.neon.local. Unitários usaram driver simulado, dotenv
desabilitado e URL fictícia sem conexão; tsx fora da sandbox pela limitação
uv_os_get_passwd conhecida. Corridas PostgreSQL permanecem pendentes.

## Execução manual

Usar banco local de testes já preparado e substituir as credenciais locais abaixo.
O preflight exige três URLs idênticas, sem parâmetros, no destino indicado.
Fixtures/limpeza se limitam aos UUIDs próprios. Sem migrations, seed ou reset.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/absent.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar E07.6 antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Revisar regressão PostgreSQL.' }
```

## Correção pontual — 03/11/2026

O responsável informou 7/25 PostgreSQL aprovados e 18 falhas: 17 TypeErrors na
prontidão e uma colisão unique na fixture destinada a testar FK.

O driver Drizzle instalado mantém timestamptz como string em SQL bruto; a tipagem
Date não executava conversão. AbsentService agora lê os três horários como epoch
double precision e os converte com instant(), conforme E07.2, antes do helper de
prontidão. Unitários passam a simular esse retorno e cobrem valores inválidos.
Helper compartilhado, locks e os dois clock_timestamp() decisivos preservados.

A fixture agora cria estação livre de outra experiência, confirma ausência de
pending e exige 23503 da constraint fk_service_sessions_station_experience.
Não aceita 23505 nem altera constraints. Permanecem 25 testes PostgreSQL.

Nesta correção: **203/203 unitários aprovados**, typecheck, lint e build exit 0.
Reexecução dos 25 PostgreSQL e regressão completa **pendentes**: as três URLs
locais explícitas continuam ausentes. Nenhum .env ou banco acessado; comandos
acima permanecem válidos. Sem commit/push ou alterações em E07.1–E07.5.
