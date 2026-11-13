# ArenaGo — Correções do reconhecimento terminal e corte da fila externa

## Escopo e decisões

- O armazenamento da estação aceita concluir a limpeza quando não há recibo físico nem intenção e existe marcador `pending` válido, terminal e com a mesma chave. A validação de conta, sessão, evento, estação, operação, escopo e resultado continua no adaptador e no coordenador. O marcador é preservado até o reconhecimento concluir; ausência isolada não é prova. `dispatching` não é reconhecido.
- A tela vincula seus callbacks de reconhecimento e cancelamento ao identificador apresentado. Um callback antigo de A não atua sobre B. A serialização do armazenamento permanece no mesmo runtime.
- O serviço compartilhado da fila externa mantém os locks e a primeira avaliação de prontidão. A decisão que altera o evento usa `clock_timestamp()` dentro de um `UPDATE` condicional para início, corte oficial, fechamento administrativo e status. A liberação coletiva usa o instante da decisão bem-sucedida. Se o corte for atingido antes do comando, o resultado é `blocked`; os serviços Staff e Admin revertem suas reservas e demais efeitos. No-op continua sem alterar domínio mesmo após corte.

## Arquivos

- `app/screens/staff/StaffStationOperationalScreen.js`, `app/services/staffIntentStorage.js`, `app/services/staffOperationsService.js`.
- `backend/src/participations/participations.service.ts`.
- `app/tests/roleRoutingIntegration.test.cjs`, `app/tests/staffOperationsService.integration.test.cjs`.
- `backend/test/unit/external-queue.test.ts`, `admin-external-queue.test.ts`, `staff-entry.test.ts` e `helpers/staff-entry-fixture.ts`.
- Este relatório e `qa-evidence/STAFF_TERMINAL_CUTOFF_FIX-changes.diff`.

## Testes preparados

A integração simulada da tela usa o adaptador real e SecureStore simulado: exclusão do recibo efetivada seguida de rejeição, recriação da aplicação com restauração de sessão, reconhecimento do marcador e callback antigo de A diante do recibo B. Há também cenário de ausência de marcador e de intenção `dispatching`.

Os testes de fila externa preparam corte entre a avaliação inicial e o `UPDATE` para desligar e religar. Os cenários Staff e Admin verificam recusa, rollback, ausência de liberação, auditoria e conclusão da reserva. Os testes E05 preservam a cobertura de no-op, limites temporais e liberação coletiva.

**Durante a implementação, testes, build e typechecks não foram executados.** A validação posterior está registrada abaixo. `git diff --check` é uma verificação estática; a homologação física PostgreSQL, a prova de origem de operações e a recuperação de `dispatching` permanecem pendentes.

## Procedimento de validação previsto durante a implementação

Inspecionar scripts e fixtures; definir `NODE_ENV=test`, remover URLs de banco herdadas e não carregar `.env`. No app, executar `node --test tests/roleRoutingIntegration.test.cjs tests/staffOperationsService.integration.test.cjs tests/staffEntryControl.test.cjs`. No backend, executar os unitários `test/unit/external-queue.test.ts`, `admin-external-queue.test.ts`, `staff-entry.test.ts` e seus testes HTTP relacionados, seguidos dos typechecks de produção e testes. Se o `tsx` reproduzir `uv_os_get_passwd / ENOMEM`, usar compilação temporária e Node, preservando `backend/dist`. Uma campanha PostgreSQL dedicada exige autorização própria e deve exercitar corte e locks reais.

## Validação posterior — 2026-11-10

### Aplicativo

Campanha anterior: 103 testes aprovados, 0 falhos e 0 ignorados. Os cenários de recibo terminal após exclusão ambígua, recriação do app, callback antigo de A e bloqueio de `dispatching` passaram. Essa campanha antecedeu a correção da fixture E05; não houve alteração posterior no app.

### Backend

- `external-queue.test.ts` isolado: 6 aprovados, 0 falhos, 0 ignorados.
- Cinco arquivos focados (`external-queue`, `admin-external-queue`, `staff-entry` e os dois arquivos HTTP): 61 aprovados, 0 falhos, 0 ignorados. Os 6 testes isolados estão incluídos nesses 61.
- O E05 demonstrou avaliações simuladas favorável e desfavorável ao cruzar o corte, execução única do UPDATE decisivo, condição temporal presente, resultado `blocked` e ausência de atualização de participações.
- Typecheck de produção e typecheck de testes aprovados.

O `tsx` falhou na inicialização com `uv_os_get_passwd / ENOMEM`. A execução usou compilação TypeScript em diretório temporário e Node, sem alterar `backend/dist`. A compilação temporária e os testes usaram `NODE_ENV=test`, sem carregar `.env` e sem variáveis de conexão a banco. Nenhum PostgreSQL, Neon, migration, seed ou serviço externo foi acessado.

`git diff --check` passou. O Git emitiu avisos de conversão LF/CRLF em arquivos preexistentes da entrega.

### Limitações

Os resultados de fila externa e de rollback vêm de fixtures simuladas; não comprovam o comportamento do relógio, locks ou rollback em PostgreSQL real. A persistência terminal foi exercitada com SecureStore simulado, não com recuperação de sessão autenticada em dispositivo real. Permanecem pendentes a homologação física PostgreSQL, a coordenação entre dispositivos, a prova de origem das operações e a recuperação segura de `dispatching`. As operações Staff continuam sem liberação para uso operacional.
