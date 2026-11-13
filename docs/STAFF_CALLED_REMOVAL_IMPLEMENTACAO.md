# STAFF-CALLED-REMOVAL — Remover participante chamado

## Escopo e contrato

Foi acrescentado `POST /api/v1/staff/events/:eventId/service-sessions/:serviceSessionId/remove`, com Bearer real, `Idempotency-Key`, UUIDs válidos e corpo vazio. A identidade vem exclusivamente do principal instalado pelo guard. `Cache-Control: no-store` também precede a autenticação. Admin sem concessão Staff vigente não recebe autorização operacional.

Resposta HTTP 200 (incluindo replay):

```json
{
  "serviceSession": {
    "id": "<UUID do atendimento>",
    "status": "canceled",
    "cancelReason": "staff_queue_removed",
    "resolvedAt": "<timestamp ISO UTC>"
  },
  "queueEntry": { "status": "closed", "closeReason": "staff_queue_removed" },
  "participation": { "status": "active", "currentQueueEntryId": null }
}
```

Erros seguem os contratos operacionais existentes: 400 para parâmetros, corpo ou chave inválidos; 401 para sessão inválida/revogada/expirada; 403 para ausência de Staff; 404 para atendimento inexistente no evento; 409 para atendimento já terminal, corte operacional ou conflito de idempotência. Falhas internas são sanitizadas como 500. Nenhum nome ou outro dado pessoal é necessário na resposta.

## Transação e schema

O serviço descobre a sessão explícita e bloqueia evento (SHARE), experiência, estação, participação, entrada e atendimento (UPDATE), com o mesmo posicionamento da autorização Staff usado por complete/absent. A concessão exige conta ativa, e-mail verificado e vínculo não revogado com o evento. Após a reserva idempotente e antes do commit, revalida a sessão autenticada.

O namespace é `staff_remove_called_service_session`, com fingerprint de evento e atendimento e a mesma unicidade existente por ator, operação e chave. Replay não exige que os estados atuais ainda sejam os originais; valida a referência, o status HTTP e o payload terminal e não altera atendimento posterior. Uma chave com fingerprint divergente gera conflito. Uma nova chave não substitui um terminal já gravado.

No UPDATE decisivo, `clock_timestamp()` verifica início, encerramento e prazo operacional/administrativo. A sessão só muda de pending para canceled; recebe responsável, instante e motivo Staff. A entrada called vinculada fecha com o mesmo timestamp PostgreSQL. Apenas o ponteiro da participação active é limpo. Não há inserção de fila, conclusão, ausência, alteração de disponibilidade da estação ou encerramento da participação. O índice parcial de pending por estação deixa de considerar a sessão cancelada. A auditoria `staff_called_service_removed` e o resultado idempotente pertencem à mesma transação; falha em qualquer escrita ou revalidação final causa rollback.

As constraints de `0004_event_operations.sql` e do schema Drizzle já permitem canceled com resolved_at e cancel_reason obrigatórios, assim como close_reason textual. O namespace cabe em varchar(80). Nenhum schema, snapshot, journal ou migration foi alterado, inclusive 0008. A 0007 continua preparatória: sua proteção específica de UPDATE para os três namespaces antigos não foi ampliada; este contrato usa o mesmo mecanismo legado de idempotência das operações atuais, sem alegar origem verificada ou retenção durável.

## Aplicativo

No cartão de participante chamado há a ação **Remover da fila**, junto de concluir e registrar ausência. Ela abre a confirmação existente e só envia após confirmação válida no contexto atual. A intenção `remove_called` preserva conta, sessão estável, evento, experiência, estação e atendimento, recebe UUID próprio e é reservada e marcada dispatching antes do POST.

O parser exige canceled, motivo Staff, fila closed, participação active e timestamp canônico. O armazenamento aceita o novo tipo sem mudar formatos antigos. Confirmação gera recibo terminal e exige o mesmo reconhecimento por receiptId das outras ações. Timeout, falha de rede, 5xx ou resposta inválida mantêm a intenção incerta; atualização visual e remount não reenviam mutações. Logout/contexto obsoleto não publica o resultado na nova sessão. O resultado definitivo pode ser preservado para a conta original.

A remoção waiting mantém contrato e implementação próprios. Nenhuma política nova de reingresso foi criada: o participante removido permanece no evento e as regras existentes decidem qualquer ingresso futuro na experiência. Não há reinserção automática, polling ou alteração de fila externa.

## Arquivos

- Backend: `staff-called-removal.service.ts`, `.types.ts` e `.controller.ts`; registro em `events.module.ts` e sanitização em `staff-operation.problem.ts`.
- App: `StaffStationOperationalScreen.js`, `staffOperationsService.js`, `staffIntentStorage.js`.
- Testes: `staff-called-removal.test.ts`, `staff-called-removal-http.test.ts`, helper `staff-called-removal-fixture.ts`; acréscimos em `staffOperationsService.integration.test.cjs` e `roleRoutingIntegration.test.cjs`.
- Este relatório e `qa-evidence/STAFF_CALLED_REMOVAL-changes.diff`.

## Validação preparada, ainda não executada

Os testes preparados cobrem cancelamento pending, participação active e ponteiro nulo, ausência de reentrada/conclusão/ausência, auditoria, replay, fingerprints distintos, terminal anterior, cortes, locks, sessão revogada/expirada, concessão, recurso ausente e falhas nas escritas. A persistência simulada restaura sessão, entrada, ponteiro e reserva quando a auditoria falha. A concorrência simulada executa os serviços reais com transações serializadas no adaptador; não comprova concorrência física ou constraints PostgreSQL.

No aplicativo, o adaptador SecureStore real sobre memória simulada exercita reserva, dispatching, recibo e reconhecimento, recriação do adaptador, timeout sem reenvio, 401, resposta inválida e resposta obsoleta após logout. O teste de navegação usa a tela, o coordenador e os provedores reais com transporte simulado, incluindo cancelamento de confirmação e atualização sem novo POST. Os skips por dependências opcionais da infraestrutura existente devem ser reportados, nunca tratados como aprovação.

Luna Medium deverá executar em `NODE_ENV=test`, sem `.env` ou variáveis herdadas de conexão:

```powershell
# backend
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/staff-called-removal.test.ts test/unit/staff-called-removal-http.test.ts test/unit/complete.test.ts test/unit/absent.test.ts test/unit/staff-station-operational.test.ts test/unit/staff-station-operational-http.test.ts
.\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit --incremental false
npm.cmd run typecheck:test
# app
node --test tests/staffOperationsService.integration.test.cjs tests/roleRoutingIntegration.test.cjs tests/staffDemoState.test.cjs tests/staffDashboard.test.cjs tests/staffRealNavigation.test.cjs
```

Se tsx falhar na inicialização com ENOMEM, utilizar o procedimento já autorizado de compilação temporária e Node, incluindo os helpers e preservando backend/dist. Nesta implementação foram feitas apenas inspeções estáticas e verificações Git; não foram executados testes, typechecks, build, migrations, seeds ou conexões PostgreSQL/Neon.

## Riscos e homologação pendente

A revisão e a validação automatizada estão registradas nesta documentação; falta a homologação operacional autorizada. O PostgreSQL real ainda precisa comprovar a disputa remove/complete/absent, replay com requisições concorrentes, rollback de auditoria e liberação efetiva do índice pending da estação. No Expo Go, conferir confirmação/cancelamento, desaparecimento do chamado, recibo, próxima chamada e preservação da remoção waiting. Intenções dispatching antigas continuam bloqueadas quando não há prova terminal; esta entrega não implementa reconciliação histórica nem autoriza reenvio incerto.

## Validação automatizada posterior — 2026-11-11

O executor `tsx` falhou antes de carregar os testes com `uv_os_get_passwd / ENOMEM`. A campanha prosseguiu por compilação TypeScript em diretório temporário e execução dos arquivos JavaScript com Node, preservando `backend/dist`. O processo de teste usou `NODE_ENV=test`, sem carregar `.env` e sem variáveis de conexão herdadas.

Na primeira execução compilada, 120 testes passaram e 1 falhou: o fixture compartilhado não respondia à consulta ampliada de evento feita pelo `AbsentService` no cenário concorrente, produzindo `staff_event_forbidden` antes de observar o atendimento cancelado. O helper foi ajustado para devolver os campos de evento exigidos pela consulta real. Nenhum código de produção foi alterado por essa correção.

Após o ajuste, os seis arquivos focados do backend executaram **121 testes: 121 aprovados, 0 falhos e 0 ignorados**. Os cinco arquivos focados do aplicativo executaram **119 testes: 119 aprovados, 0 falhos e 0 ignorados**. Os typechecks de produção e testes do backend passaram. `git diff --check` passou. Os testes HTTP usaram servidor efêmero em loopback e persistência simulada; nenhum PostgreSQL, Neon, migration, seed ou serviço externo foi acessado.

Essa campanha valida a cobertura automatizada simulada, inclusive remoção pending, participação active, encerramento da entrada chamada, replay/conflito, rollback, autorização, integração do botão, cancelamento da confirmação sem POST e timeout sem reenvio automático. A concorrência serializada pelo helper não comprova locks ou constraints físicos no PostgreSQL. Permanecem necessários ensaio PostgreSQL autorizado e homologação manual no Expo Go; a remoção não está liberada operacionalmente apenas por esses testes.
