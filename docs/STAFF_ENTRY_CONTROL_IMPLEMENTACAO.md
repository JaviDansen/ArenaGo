# Controle de Entrada Staff — implementação

## Escopo e estado da entrega

Implementação de backend e aplicativo para consultar a fila externa, confirmar individualmente o primeiro participante e desativar/reativar a fila do evento. A autorização explícita desta tarefa amplia essas duas alternâncias para Staff com concessão vigente no evento; o endpoint Admin, sua exigência de TOTP e justificativa continuam com o contrato anterior. Esta entrega não modifica a tela de estações, operações de experiências, schema, migrations, snapshots, dados ou `.env`.

Foram feitas inspeções estáticas do planejamento, arquitetura, contratos e alterações. **Testes, build e typechecks não foram executados nesta tarefa.** Não houve conexão PostgreSQL/Neon ou operação real. O código está preparado para revisão de segurança e validação por Luna Medium; não constitui homologação operacional.

## Contratos HTTP

Todas as rotas começam em `/api/v1/staff/events/:eventId/entry-control`, usam Bearer e `Cache-Control: no-store`, inclusive nos erros. O principal autenticado fornece conta e sessão; parâmetros do cliente não as substituem. UUIDs são validados/normalizados; corpos extras são recusados. Admin sem concessão Staff não obtém acesso; conta Admin também Staff conserva a exigência TOTP do guard e da revalidação transacional.

### GET `/`

Resposta 200:

```json
{
  "eventId": "UUID do evento",
  "externalQueueEnabled": true,
  "observedAt": "2026-11-10T15:00:00.000Z",
  "canManage": true,
  "waitingCount": 1,
  "waiting": [{ "participationId": "UUID da participação", "displayName": "Nome da conta", "position": 1 }]
}
```

O nome e o identificador da participação são a identificação mínima autorizada nesta operação presencial. Não são retornados e-mail, UUID de conta, nascimento, questionário, códigos de acesso, credenciais ou histórico de experiências. A ordenação e as posições são calculadas no servidor por `external_queue_order, id`; BIGINT não é convertido para Number. O contrato retorna a lista completa, sem paginação. `canManage` vem da disponibilidade existente do evento; a lista é observacional, não autorização futura. A leitura usa `REPEATABLE READ READ ONLY` e revalida sessão, conta ativa, e-mail verificado e concessão Staff no mesmo snapshot. Uma revogação posterior ao snapshot pode não ser observada por uma leitura já iniciada.

### POST `/participants/:participationId/confirm`

Corpo `{}` ou ausente; `Idempotency-Key` obrigatório. Resposta 200:

```json
{ "eventId": "UUID do evento", "participation": {
  "id": "UUID da participação", "status": "active", "arenaEnteredAt": "2026-11-10T15:00:00.000Z"
} }
```

O ID representa o primeiro participante apresentado, não permite escolher alguém fora da ordem. O servidor obtém lock exclusivo do evento e do primeiro `waiting`, sem `SKIP LOCKED`, verifica o alvo e muda somente essa participação para `active`, com horário PostgreSQL. Confirmação repetida com outra chave não ativa a próxima pessoa. A chave original possui replay do resultado registrado; o aplicativo não o tenta automaticamente após resultado incerto.

### PATCH `/`

Corpo estrito `{ "enabled": false }` ou `{ "enabled": true }`; `Idempotency-Key` obrigatório. Resposta 200: `{ eventId, externalQueueEnabled, releasedCount, changedAt? }`. `changedAt` está ausente em no-op; neste caso `releasedCount` é zero. Reativação sempre libera zero pessoas. Um replay representa o resultado histórico original e não a situação atual do evento; a interface consulta o GET após a operação.

Reutiliza `ParticipationsService.setExternalQueueEnabledWithTx` na mesma transação do chamador Staff. Desativar libera todos os `waiting` atomicamente; reativar muda somente a configuração para futuras participações. Não altera `queue_entries`, estações ou `service_sessions` e não encerra o evento.

### Erros públicos

- 400 `VALIDATION_ERROR`: UUID, corpo ou chave inválidos.
- 401: sessão inválida, expirada/revogada, conta inativa ou TOTP exigido pelo contrato de autenticação.
- 404 `RESOURCE_NOT_FOUND`: evento ausente ou sem concessão Staff; recusa neutra.
- 409 `ENTRY_NOT_FIRST`: alvo não é mais o primeiro aguardando; exige atualização e nova decisão humana.
- 409 `EVENT_ENTRY_UNAVAILABLE`: evento/fila não permitem a alteração.
- 409 `IDEMPOTENCY_REQUEST_CONFLICT` ou `IDEMPOTENCY_IN_PROGRESS`: intenção conflitante/em processamento; não libera reenvio.
- 500 `INTERNAL_SERVER_ERROR`: falha interna, sem SQL, marcador privado ou dados da persistência.

## Transações, autorização e D06/D07/D09

As mutações usam `READ COMMITTED`, ordem evento -> participações -> conta/concessões/sessão e revalidação da sessão após reserva e antes do retorno/commit. Reutilizam `revalidateMutationSession`, o helper de reserva/conclusão e o TTL Staff existente. A confirmação usa namespace `staff_confirm_event_entry` e fingerprint evento/participação. A alternância usa `staff_set_external_queue` e fingerprint evento/estado. Não compartilham chaves com o endpoint Admin ou com operações de experiências.

Reserva, efeito, auditoria e resultado terminal pertencem à mesma transação; falhas provocam rollback. A alternância reutiliza a exclusão do evento e dos `waiting` da E05. Novos ingressos, fechamentos e outras operações que respeitam o lock de evento não ultrapassam essas decisões. O evento exclusivo serializa as ações de entrada entre Staffs. A confirmação adicionalmente confere corte e configuração no UPDATE decisivo, com `clock_timestamp()`. A liberação segue as guardas existentes da E05: prontidão, início, corte oficial e fechamento administrativo. A margem residual não reabre a entrada externa. No-op da alternância mantém o comportamento existente, inclusive depois do corte; não reabre nem libera ninguém.

Não há garantia de commit em milissegundo exato; os limites e a ordem real de locks ainda exigem ensaio PostgreSQL específico. A confirmação não pula registros inconsistentes nem cria fila por experiência. Auditoria registra ator, evento, ação e ID da participação ou contagem/estado da alternância, sem copiar nomes. O schema existente comporta tudo; nenhuma alteração de banco foi criada.

## Aplicativo e proteção contra resultado incerto

`StaffEntryControlRealScreen` substitui a mensagem provisória dentro do painel existente. Mantém a identidade visual do painel, ordem FIFO, contagem, botões de ativação/desativação, confirmação explícita e retorno sem perder o evento. Somente o primeiro participante recebe o acionador individual. Carregamento, vazio, indisponibilidade temporal, rede, 401/403/404, falha de contrato e atualização manual têm estados próprios. As consultas passam pelo cliente autenticado; o eventId vem da seleção Staff. Mudanças de conta, sessão, evento, epoch ou revisão descartam respostas antigas e fecham a confirmação. Callbacks antigos não executam a ação após logout/revalidação.

As intenções de entrada têm adaptador dedicado, sem alterar a infraestrutura de estações já validada. Um slot SecureStore por conta persiste `reserved -> dispatching -> terminal -> acknowledged`; `reserved -> cancelled` só é permitido antes de envio comprovado. Reserva e despacho são gravados antes do POST/PATCH. Não há exclusão do slot: reconhecer um resultado terminal grava a nova fase no mesmo registro, comparando chave e escopo sob serialização local. Um reconhecimento antigo não modifica uma intenção posterior. As informações persistidas são IDs, tipo da operação, estado desejado e resultado mínimo; nomes e credenciais não são persistidos.

Falha de gravação antes/depois da efetivação é reavaliada por leitura; registros inválidos ou ilegíveis bloqueiam novas mutações. Resultado definitivo é persistido antes de liberar uma ação futura e exige reconhecimento humano (`Entendi`). Falha ao persistir esse resultado mantém o bloqueio e conserva a confirmação conhecida em memória enquanto o contexto original permanecer válido. O reconhecimento local não consulta nem prova o backend. Uma intenção pendente de outra sessão/evento não é excluída nem reconhecida na sessão atual.

Timeout, rede, HTTP 5xx, resposta inválida e conflitos de idempotência mantêm `dispatching`; o aplicativo **não repete automaticamente** POST/PATCH, nem habilita uma nova mutação por observar uma lista diferente. As mutações desativam o retry automático de 401 do cliente; o GET posterior usa a renovação/invalidação existente. A serialização do adaptador vale somente para o mesmo runtime; autorizações e concorrência global permanecem no backend. Na web, as consultas funcionam, mas mutações ficam bloqueadas sem armazenamento durável apropriado.

## Testes preparados (não executados)

- `backend/test/unit/staff-entry.test.ts`: consulta mínima/read-only, autorização e recusa neutra, FIFO, idempotência/replay sem desfazer estado posterior, D06 e corte de ingresso, rollback e concorrência simulada entre confirmação/alternância.
- `backend/test/unit/helpers/staff-entry-fixture.ts`: pool simulado com transações, reserva e exclusão solicitada pelo SQL. Essa simulação não comprova locks, isolamento ou deadlines físicos do PostgreSQL.
- `backend/test/unit/staff-entry-http.test.ts`: guard, controller e serviço reais sobre persistência simulada; Bearer, identidade, UUID, corpos/chave, 200/400/401/404/409, 500 seguro e no-store.
- `app/tests/staffEntryControl.test.cjs`: validação de contrato, seleção do primeiro, atualização após operação, alternância, timeout e recriação do adaptador, falhas antes/depois de gravações, recibo posterior, exclusão de contexto, concorrência local e respostas fora de ordem.
- `app/tests/roleRoutingIntegration.test.cjs`: fluxo da tela real com gerenciador de autenticação, provedores, cliente HTTP e roteador; confirmação/alternância/retorno, callback após logout e 401 terminal. As dependências isoladas de `qa/regression` continuam necessárias; skips são pendências.
- `app/tests/staffDemoState.test.cjs`: classificação explícita da nova tela como real; os 17 módulos demonstrativos e a fixture permanecem isolados.

## Validação reservada ao Luna Medium

Inspecionar scripts, confirmar branch/ambiente e preservar alterações locais. Sem banco e sem carregar `.env`, na pasta `backend`, configurar `NODE_ENV=test` e executar primeiro `node_modules/.bin/tsx --test test/unit/staff-entry.test.ts test/unit/staff-entry-http.test.ts`; depois a suíte unitária, com `EVALUATION_IDEMPOTENCY_TTL_SECONDS=60` somente no processo de teste, conforme a campanha anterior. Se `tsx` falhar em `uv_os_get_passwd/ENOMEM`, utilizar a compilação temporária já aprovada do `tsconfig.test.json` e Node com `NODE_PATH` apontando às dependências existentes, preservando `backend/dist`.

No `app`, com `NODE_ENV=test`: `node --test tests/staffEntryControl.test.cjs tests/roleRoutingIntegration.test.cjs tests/staffDemoState.test.cjs tests/staffDashboard.test.cjs tests/authNavigation.test.cjs tests/staffNavigation.test.cjs tests/staffRealNavigation.test.cjs`. Se os focados passarem, executar as suítes unitárias completas do backend e aplicativo, typechecks de produção/testes do backend e verificações Git. Nenhum desses comandos foi executado nesta implementação.

## Bloqueios e limites restantes

1. Exige revisão de segurança e execução dos testes preparados. Não houve homologação HTTP ou Expo Go desta entrega.
2. Um `dispatching` incerto continua bloqueado inclusive após reinício/novo login. Não existe nesta entrega endpoint histórico com prova de origem nem procedimento que autorize liberação automática. Verificação manual pelo responsável e evolução contratual de recuperação permanecem necessárias; atualizar a lista não resolve essa dependência.
3. Namespaces de entrada usam a idempotência legada. Não recebem `verified_v1` e não são protegidos pelo trigger preparatório específico das três operações de experiências. Não há promessa de retenção durável ou coordenação de intenções entre dispositivos. A proteção local não sobrevive à perda/exclusão do SecureStore.
4. Concorrência real (confirmação contra confirmação, desativação, cancelamento do titular, novo ingresso, revogação e fechamento D07/D09), locks, rollback e bordas de relógio exigem campanha PostgreSQL dedicada e autorizada. Nenhum teste PostgreSQL foi executado ou autorizado aqui.
5. A expansão `0007` já exigida pelo schema atual da branch continua sendo pré-condição de implantação em outros bancos; esta tarefa não aplica migrations nem autoriza Neon.
6. A lista nominal não é paginada; volume, pessoas com nomes iguais, conferência presencial e conectividade precisam de homologação. O nome da conta não constitui verificação documental de identidade. Não há polling.

## Arquivos e evidência

Produção: `backend/src/participations/staff-entry.service.ts`, `staff-entry.controller.ts`, `participations.module.ts`; `app/services/staffEntryService.js`, `staffEntryIntentStorage.js`; `app/screens/staff/StaffEntryControlRealScreen.js`, `StaffEventsNavigator.js`.

Testes: os seis arquivos relacionados acima (incluindo o helper) e a atualização de navegação/classificação. Este relatório e `qa-evidence/STAFF_ENTRY_CONTROL-changes.diff` acompanham a entrega. A evidência deve representar apenas esta tarefa, incluir novos arquivos e ter sua aplicação reversa conferida sem alterar arquivos. Os nomes, UUIDs e credenciais de testes são sintéticos.
