# E07.5 — conclusão de atendimento pelo Staff

Implementação interna em 02/11/2026, branch `feature/events-participations`.
Base informada pelo responsável: E07.4 com 22/22 PostgreSQL e regressão 198/198
aprovados; esses resultados não são reexecuções desta entrega.

`CompleteService.complete({ staffUserId, eventId, serviceSessionId,
idempotencyKey, expiresAt })`, exportado pelo `EventsModule`, recebe ator de
contexto confiável e revalida conta ativa, e-mail verificado e Staff vigente
do evento no banco. Admin isolado não opera.

Transação READ COMMITTED: descoberta não bloqueante da sessão explícita →
evento SHARE → experiência UPDATE → estação UPDATE → conta/concessão Staff
SHARE → participação UPDATE → entrada UPDATE → sessão UPDATE. Revalida todos
os vínculos após esperas. Estados terminais retornam `service_not_pending`;
sessão ausente/de outro evento retorna `service_not_found` ao Staff autorizado.
Pending com participação/entrada/ponteiro incoerentes provoca erro de integridade
e rollback, sem fabricar uma conclusão.

O UPDATE decisivo exige pending/called/active e ponteiro correspondente, usando
clock_timestamp() após todos os locks/reserva, com instante estritamente anterior
aos prazos operacional e administrativo e evento não closed. A janela residual
permite concluir apesar do corte oficial/fila pausada. No mesmo commit: sessão
completed com autoria e resolved_at, entrada closed com motivo completed e
closed_at copiado de resolved_at no PostgreSQL, ponteiro liberado e idempotência
concluída. Mantém participação active, disponibilidade, FIFO e conclusões anteriores.
Não cria próxima chamada.

Namespace `complete_service_session`; fingerprint de evento/sessão, ator na chave
única existente. Replay retorna a resposta original, inclusive após encerramento
ou nova entrada/chamada, ainda exigindo autorização atual. Não altera atendimento
posterior. Nova intenção sobre sessão terminal é conflito. expiresAt não define
nem executa expurgo. Nenhum serviço E07.1–E07.4 foi modificado; apenas adicionado
o provider/export no módulo comum. Sem HTTP, telas, migrations, commit ou push.

## Validação

- **182/182 unitários aprovados**, incluindo **18 novos E07.5**; zero falhas/skips.
- `npm.cmd run typecheck:test`, `npm.cmd run lint`, `npm.cmd run build`: exit 0.
- **20 testes PostgreSQL escritos, não executados**: conclusão e timestamp exato,
  retries concorrentes, permissões/vínculos, estados terminais, prazos após espera,
  janela residual, disputa E07.3 nas duas ordens, rollback após as quatro escritas,
  estação liberada para E07.4 e reentrada E07.1 com FIFO/replay antigo preservados.
  Corridas exigem bloqueio observado por pg_blocking_pids; a ausência futura é
  apenas uma fixture SQL terminal, sem serviço de ausência implementado aqui.

As três URLs explícitas estavam ausentes. Nenhum banco foi acessado, nem arquivo
.env carregado (incluindo .env.neon.local). Unitários usam driver simulado, dotenv
desabilitado e URL fictícia sem conexão; tsx executado fora da sandbox devido à
limitação uv_os_get_passwd já conhecida. Aprovação unitária não comprova as
corridas PostgreSQL, que continuam pendentes.

## Execução manual pendente

Usar banco local de testes já preparado e substituir apenas as credenciais locais.
Preflight exige URLs idênticas, sem parâmetros, para o destino abaixo. Fixtures
e limpeza se limitam aos UUIDs da própria suíte; não executar migrations/seed/reset.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/complete.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar E07.5 antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Revisar regressão PostgreSQL.' }
```

Próximo passo: executar as integrações e depois implementar ausência manual
(§16.11), preservando resolução terminal única e as regras de reentrada/cortes.
