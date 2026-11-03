# E07.4 — chamada do próximo participante

Implementado em 02/11/2026 sobre `893e6c9`, branch `feature/events-participations`.

`CallNextService.callNext({ staffUserId, eventId, experienceId, stationId,
idempotencyKey, expiresAt })`, disponível no `EventsModule`, retorna `created`,
`replay`, conflitos de idempotência ou bloqueios internos descritos nos tipos.
O ator deve vir de contexto confiável do chamador; a autorização Staff do evento,
conta ativa e e-mail verificado são conferidos no banco, inclusive para replay.
Admin sem concessão Staff não opera.

Uma transação READ COMMITTED bloqueia evento (SHARE), experiência (UPDATE),
estação (UPDATE) e conta/concessão Staff (SHARE). Reconhece a intenção antes
de exigir estação livre/tempo/fila atuais; reserva nova bloqueada sofre rollback.
Seleciona o primeiro waiting por queue_order/id sem SKIP LOCKED, bloqueia
participação e entrada e revalida FIFO, vínculos, estado active e ponteiro.
Inconsistência interrompe a operação com CallNextIntegrityError, sem furar fila.

O INSERT de service_sessions.pending usa clock_timestamp() após todas as
esperas, condicionado ao início do evento e aos prazos operacional/administrativo
exclusivos, com status diferente de closed. Atualiza waiting para called e conclui
idempotência no mesmo commit. O índice parcial de pending por estação continua
como barreira final. O corte oficial, fechamento controlado e fila pausada não
impedem chamar quem já aguardava na janela residual.

Namespace `call_next`; fingerprint inclui evento, experiência e estação, com ator
na chave única existente. Replay reproduz a resposta histórica, mesmo após
resolução/encerramento, sem nova chamada. expiresAt não implementa expurgo/TTL.
Não altera ponteiro, contadores, disponibilidade ou os serviços E07.1–E07.3.
Sem migration, HTTP, tela, commit, push ou acesso a dados reais/remotos.

## Validação

- Unitários: **164/164 aprovados**, incluindo **19 novos E07.4**; zero falhas/skips.
- `typecheck:test`, lint e build: aprovados, exit 0.
- **22 testes PostgreSQL escritos, não executados**: FIFO/bigint, chamadas em
  duas estações, estação ocupada/indisponível, idempotência, permissões/vínculos,
  operação residual, cortes após espera, revogação concorrente, experiências
  independentes, disputa com E07.3 nas duas ordens e rollback após cada escrita.
  Corridas exigem espera real observada por pg_blocking_pids, não apenas Promise.all.

As três URLs explícitas estavam ausentes. Nenhum .env foi carregado nem conexão
PostgreSQL aberta. Unitários usam driver simulado; sua aprovação não comprova
concorrência PostgreSQL. O tsx exigiu execução fora da sandbox devido a
uv_os_get_passwd/ENOMEM; dotenv ficou desabilitado, sem conexão a banco.

## Execução PostgreSQL pendente

Com o banco local **já preparado**, substitua apenas as credenciais locais abaixo.
O preflight exige três URLs idênticas, sem parâmetros, exclusivamente para
`127.0.0.1:55432/arenago_events_test`; desabilita dotenv antes de importar serviços.
Fixtures e limpeza usam apenas UUIDs criados pela própria suíte. Não executar
migrations, seed ou reset como parte destes comandos.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/call-next.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar E07.4 antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Revisar regressão PostgreSQL.' }
```

Próximo passo: executar as integrações; depois implementar conclusão de atendimento
(§16.10), mantendo o mesmo protocolo e a resolução única de pending.
