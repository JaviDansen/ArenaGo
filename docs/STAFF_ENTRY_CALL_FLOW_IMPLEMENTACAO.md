# Correção Staff 02 — Controle de Entrada com chamada persistente

## Estado da entrega — 11/11/2026

Staff 02 está implementada e foi homologada funcionalmente no Expo Go nos cenários descritos adiante. A validação automatizada focada passou, e a migration 0008 também foi aplicada e validada fisicamente em dois bancos locais dedicados, em campanhas distintas. Isso não equivale a homologação técnica exaustiva: a auditoria pré-commit mais recente registrou falhas no fallback da suíte unitária completa do backend, detalhadas abaixo. Nenhuma conclusão aqui declara o backend integralmente aprovado.

Antes da interrupção já existiam a migration, schema/journal/snapshot, StaffEntryCallService, rotas e integração do aplicativo. Havia testes incompletos, fixture sem ordenação após ausência, textos com caracteres danificados e documentação ainda descrevendo bloqueios anteriores. Na retomada foram corrigidos esses pontos, reforçada a validação das respostas e a integridade terminal diferida e preparada a campanha física separada.

## Histórico das decisões e migrations

1. A viabilidade inicial com Astra High concluiu que participations não tinha chamada externa e que service_sessions/queue_entries exigiam experiência/estação. O trabalho foi bloqueado corretamente para aprovação de schema.
2. O responsável aprovou external_entry_calls, callId, pending único por evento/participação, confirmação somente por chamada, ausência antes/depois do corte e remoção externa com motivo próprio.
3. A continuação com Sol High identificou risco real de aplicar 0009 antes da 0008 A1. O Drizzle instalado lê journal.entries e utiliza when/folderMillis contra o maior created_at aplicado; não recupera automaticamente migrations anteriores omitidas.
4. O responsável adiou a A1 e autorizou ocupar a sequência ativa 0008 com chamadas externas. A branch feature/staff-recovery-a1-preparation permanece intocada e isolada. **A futura A1 deve ser adaptada logicamente ao novo schema e regenerada com nova numeração, timestamp e snapshots; não poderá simplesmente adicionar a antiga 0008 ao journal.** Não executar rebase Git automaticamente.

A inspeção inicial confirmou migrations e journal ativos terminando em 0007, sem 0008 nesta branch ou evidência documental de aplicação da antiga 0008 nos ambientes conhecidos. Isso não comprova o histórico de todos os bancos: antes de aplicar, verificar cada ambiente por campanha autorizada e parar se houver uma 0008 diferente.

Preparada `backend/drizzle/0008_external_entry_calls.sql`; journal idx=7, when=1794412800000, após 0007 (idx=6, when=1794200000000). Snapshot novo `meta/0007_snapshot.json` segue o índice zero-based do Drizzle e prevId de 0006_snapshot.json. A tabela nova foi serializada offline com generateDrizzleJson do Drizzle Kit instalado sobre o schema TypeScript (sem importar drizzle.config.ts ou conectar). A comparação estática confirmou que todas as tabelas anteriores foram preservadas e o único acréscimo é public.external_entry_calls. O snapshot histórico 0005 ausente não foi inventado. Funções/triggers SQL personalizados não são representados no snapshot; precisam de revisão e ensaio próprios. A conferência não substitui validação física nem teste completo do gerador/migrador.

## Modelo persistido e proteções

external_entry_calls contém id UUID, event_id, participation_id, called_by_user_id, called_at, status, resolved_by_user_id, resolved_at e resolution_reason. Estados: pending, confirmed, absent, removed, canceled. Não armazena nome, senha ou tokens.

FK composta participation_id/event_id impede vínculo cruzado; FKs de evento e atores preservam referência. Índices únicos parciais limitam pending por evento e por participação. A mesma participação pode possuir várias ocorrências históricas após ausência, cada uma com UUID distinto. Índice de histórico por participação/instante.

Checks exigem shape pending/terminal, motivo não vazio e resolved_at >= called_at. Trigger BEFORE exige criação pending com autor e impede alteração da identidade, reabertura, substituição terminal e DELETE. TRUNCATE também é recusado. confirmed/absent/removed exigem responsável na resolução. Estas proteções não são defesa contra owner/superuser que possa desabilitar/dropar objetos.

FKs de atores usam ON DELETE SET NULL, conforme o padrão de service_sessions/audit_logs. O trigger aceita somente a remoção do identificador de uma conta efetivamente excluída, preservando o conteúdo terminal restante. FKs para participação/evento não têm cascata; apagar esses objetos com histórico exige política própria de privacidade/retenção. Não foi implementado fluxo de exclusão de contas nem alegada compatibilidade de um expurgo futuro sem revisão.

Constraint triggers DEFERRABLE INITIALLY DEFERRED nas chamadas, participações e eventos impedem commit com pending órfão: participação waiting, arena_entered_at e ponteiro interno nulos, fila habilitada, evento sem fechamento administrativo. Na transição terminal explícita, verificam a correspondência da resolução com a participação no commit. Checks temporais usam SQL decisivo; não há relógio volátil em CHECK nem registro automático de ausência por passagem de tempo.

## Contratos HTTP implementados

Base: `/api/v1/staff/events/:eventId/entry-control`. Guard SessionAuthGuard, no-store antes da autenticação, identidade exclusivamente do principal, UUIDs normalizados, corpo vazio estrito e Idempotency-Key obrigatório em POST. Conta ativa/verificada, TOTP aplicável e concessão Staff vigente são revalidados na transação.

| Método/rota | Ação e namespace |
| --- | --- |
| GET `/` | Leitura de fila e chamada no mesmo REPEATABLE READ READ ONLY |
| POST `/call-next` | Chamar; staff_call_event_entry |
| POST `/calls/:callId/confirm` | Confirmar; staff_confirm_called_entry |
| POST `/calls/:callId/absent` | Ausência; staff_absent_event_entry |
| POST `/calls/:callId/remove` | Remover; staff_remove_called_entry |
| PATCH `/` com enabled boolean | Alternância já existente, staff_set_external_queue |
| POST `/participants/:participationId/confirm` | Somente replay legado válido; nova execução recebe 409 ENTRY_CALL_REQUIRED |

GET preserva eventId, externalQueueEnabled, observedAt e canManage; acrescenta pendingCall (null ou id/participationId/displayName/calledAt), canCall, canConfirm, canMarkAbsent e canRemove. waiting contém somente quem ainda não foi chamado, com position contígua calculada no servidor; waitingCount exclui a pessoa chamada. O chamado continua participation.status=waiting no banco, até resolução. O nome é exibido somente no cabeçalho do chamado. Campos de conta, código do evento, questionário e credenciais não são retornados. Permissões são observacionais e revalidadas na mutação.

Resposta 200 dos quatro POSTs novos:

```json
{
  "eventId": "UUID",
  "call": { "id": "UUID", "participationId": "UUID", "status": "pending|confirmed|absent|removed", "calledAt": "ISO UTC", "resolvedAt": null },
  "participation": { "id": "UUID", "status": "waiting|active|finished|canceled", "arenaEnteredAt": null, "finishReason": null, "externalQueueOrder": "1" },
  "requeued": false
}
```

resolvedAt é ISO UTC nos terminais; arenaEnteredAt é preenchido apenas na confirmação; finishReason contém o motivo terminal quando aplicável. A ordem BIGINT permanece string decimal exata. Parsers de backend e aplicativo conferem vínculo, estado, timestamps e forma do resultado. PATCH mantém resposta anterior (eventId/externalQueueEnabled/releasedCount/changedAt opcional).

Erros: 400 VALIDATION_ERROR; 401 para sessão inválida/revogada/expirada/TOTP; 404 RESOURCE_NOT_FOUND indistinguível para concessão/recurso ausente; 409 ENTRY_CALL_PENDING, ENTRY_CALL_NOT_PENDING, ENTRY_QUEUE_EMPTY, ENTRY_CALL_REQUIRED ou EVENT_ENTRY_UNAVAILABLE; conflitos de idempotência continuam IDEMPOTENCY_REQUEST_CONFLICT/IDEMPOTENCY_IN_PROGRESS. Falhas internas seguem o filtro global com INTERNAL_SERVER_ERROR sanitizado e no-store.

A rota legada preserva namespace, fingerprint evento/participação, referência e replay 200 válido. Não associa participationId automaticamente a uma nova chamada. Reserva nova é revertida com a recusa, sem efeito operacional. Callbacks antigos não podem confirmar uma segunda ocorrência após ausência. Clientes antigos precisam ser atualizados; nenhuma intenção local antiga é convertida ou reenviada.

## Transações, FIFO e idempotência

Novas mutações usam READ COMMITTED, evento FOR UPDATE, participações waiting em ordem estável de ID, chamadas em ordem de ID, conta/concessão/sessão pelo helper existente, reserva e revalidações posteriores. O evento exclusivo serializa chamadas, admissão, mudança de ordem, alternância, desistência e fechamento dos escritores atuais. Não há SKIP LOCKED na seleção FIFO. O servidor seleciona a menor ordem external_queue_order/id; o cliente não escolhe a pessoa.

Reserva, efeito, auditoria e resultado idempotente pertencem ao mesmo commit. Falha em uma escrita, parse ou revalidação provoca rollback. Call fingerprint contém evento; resolução inclui evento/callId. Replay revalida autorização e confere status HTTP, referência, escopo e tipo de resultado, sem aplicar efeitos nem exigir que o estado atual continue o histórico original. Namespace/ator/chave mantêm a unicidade existente.

A chamada é inserida por INSERT SELECT com clock_timestamp e guardas de início, corte oficial, prazo operacional, fila e fechamento. A resolução e a atribuição de nova ordem de ausência usam uma decisão SQL compartilhada; overflow de BIGINT não produz efeitos parciais. O timestamp de participação é copiado da chamada no PostgreSQL, evitando perda de microssegundos. Não se promete igualdade atômica entre relógio de parede e instante do COMMIT.

A idempotência continua legacy; a 0008 não ativa verified_v1, retenção durável, prova de origem ou reconciliação automática. A recuperação A1 está fora da entrega. A existência/ausência de chamada no GET nunca comprova o resultado de uma intenção incerta.

## Transições e interações com fluxos existentes

- Chamar: primeiro waiting elegível, chamada pending persistida, sem admissão; uma pendência impede outra chamada no evento e é visível a outra sessão Staff autorizada.
- Confirmar: somente callId pending; chamada confirmed e participação active/arena_entered_at no mesmo commit. Após corte oficial ou administrativo não há admissão, inclusive durante a margem residual.
- Ausência antes do corte: chamada absent; mesma participação waiting recebe nova ordem no final; auditoria registra ordem anterior/nova, sem criar outra participação.
- Ausência após corte oficial e antes do limite definitivo: chamada absent, sem reinserção; participação finished, motivo external_absence_after_entry_cutoff. As demais pessoas waiting permanecem intactas. A passagem do horário não registra ausência automaticamente.
- Remover: chamada removed, participação canceled/finished_at, motivo staff_external_wait_removed; sem admissão, conclusão, ausência, avaliação ou reinserção. Reingresso futuro segue os contratos atuais; não há banimento novo.
- Desativar pelo Admin ou Staff: o serviço compartilhado mantém D06 e ativa todos os waiting, inclusive o chamado. Trigger transacional cancela a chamada com external_queue_disabled e auditoria sistêmica. Confirmação atrasada com chave nova é recusada; replay histórico não altera estado atual. Reativação não restaura espera/chamada; no-op conserva contrato anterior.
- Desistência do titular: a transição waiting→canceled já existente cancela a chamada pending no trigger, com o motivo real external_wait_withdrawal e timestamp da participação.
- Encerramento controlado/imediato e regularizador: a finalização waiting→finished já executada pelos serviços atuais cancela pending no mesmo commit, preservando finish_reason e finished_at do encerramento. Não sobrescreve terminais anteriores; ação Staff após fechamento não substitui o motivo por ausência. Não altera serviços internos ou estações.

A integração com esses escritores está no trigger AFTER UPDATE OF status de participations, não em duplicação de SQL nos serviços homologados. Seus locks atuais de evento/recursos/participação precedem o lock da chamada feito pelo trigger. Escritores desconhecidos que deixem pending órfão são recusados pela integridade diferida. Auditoria sistêmica do cancelamento complementa a auditoria da ação original. O ensaio físico de schema foi realizado nos bancos locais descritos abaixo; concorrência física entre esses escritores e compatibilidade sob disputas simultâneas continuam pendentes.

## Aplicativo

Sem chamada: primeiro destacado, Chamar próximo, lista informativa sem Confirmar/Ausência/Remover individuais. Com chamada: cabeçalho nominal e exatamente Confirmar entrada, Marcar ausência e Remover da fila. Ausência/remoção podem continuar habilitadas na janela residual mesmo quando confirmar/chamar estão bloqueados. Mantidas confirmações prévias, Entendi, atualização manual, navegação e estados de erro; sem polling/background.

Os tipos locais call/confirm_call/absent/remove incluem callId nas resoluções e usam endpoints novos. Reserved e dispatching são persistidos antes do POST, sem retry de 401 ou rede; resultado definitivo precede reconhecimento. Conta, sessão estável, evento, epoch e revisão protegem respostas e callbacks. Duplo toque e dois coordenadores usam os bloqueios existentes de voo/reserva. GET, refresh e remount não reenviam mutações nem liberam dispatching incerto.

O formato legado confirm/toggle continua legível e mantém recibos antigos. Nenhuma conversão de confirmação antiga em chamada nova. O adaptador de entrada conserva seu próprio protocolo de chave/escopo e transição terminal→acknowledged no mesmo registro, sem exclusão física; não foi trocado pelo adaptador de estações. Mudança de callId integra a comparação de reconhecimento. Sessão diferente não assume uma intenção anterior. Operação incerta permanece bloqueada até evolução contratual própria.

## Arquivos desta entrega

Produção/schema:
- backend/drizzle/0008_external_entry_calls.sql
- backend/drizzle/meta/_journal.json e meta/0007_snapshot.json
- backend/src/database/schema/participations.schema.ts
- backend/src/participations/staff-entry-call.service.ts
- backend/src/participations/staff-entry.service.ts, staff-entry.controller.ts, participations.module.ts
- app/services/staffEntryService.js e staffEntryIntentStorage.js
- app/screens/staff/StaffEntryControlRealScreen.js

Testes:
- backend/test/unit/helpers/staff-entry-fixture.ts
- backend/test/unit/staff-entry-call.test.ts, staff-entry.test.ts, staff-entry-http.test.ts
- backend/test/integration/external-entry-calls-schema.integration.test.ts
- app/tests/staffEntryControl.test.cjs e roleRoutingIntegration.test.cjs

Este documento e qa-evidence/STAFF_ENTRY_CALL_FLOW-changes.diff registram a entrega Staff 02. Não houve alteração de tela/serviço das estações, da Staff 01, da A1 ou das migrations antigas nesta implementação.

## Cobertura automatizada e limites

Os testes unitários/HTTP preparados cobrem FIFO, chamada visível a outro Staff, bloqueio pending, concorrência simulada, confirmação/ausência/remoção, ausência com uma pessoa e após corte, sequência após ausência, callback antigo, replay, conflito, recurso ausente, autorização/revogação, rollback de auditoria, desativação/reativação, rota legada somente replay, UUID/body/chave/Bearer, no-store e 500 sanitizado.

No aplicativo, os cenários preparados cobrem chamada e resoluções por callId, ausência de ação em waiting, três ações do chamado, cancelamento de diálogo sem POST, duplo envio bloqueado, recibo/reconhecimento, falhas SecureStore, timeout/remount sem reenvio, intenção antiga preservada, resposta obsoleta, troca de sessão, atualização e retorno ao painel. A campanha focada de 11/11/2026 executou 17 arquivos backend e 6 arquivos do aplicativo: 341 e 145 testes aprovados, respectivamente, sem falhas ou skips; os dois typechecks do backend passaram. Isso valida apenas os conjuntos focados daquela campanha.

O fixture backend serializa transações em memória e modela efeitos do trigger na liberação coletiva. Isso, assim como o teste DDL unitário que lê texto, não prova sozinho o comportamento PostgreSQL de constraints diferidas, FKs, triggers ou deadlocks.

O teste físico separado `external-entry-calls-schema.integration.test.ts` exige `NODE_ENV=test`, opt-in `STAFF_ENTRY_CALLS_SCHEMA_TEST=authorized-local`, três URLs idênticas e identidade do destino validada pelo guard. Não aplica migration, não importa dotenv nem faz limpeza global: cria fixtures sintéticas em transação revertida e confere sua ausência por outra conexão. Exercita unicidade/FKs, resolução inconsistente, terminal imutável, bloqueio de DELETE, desistência/fechamentos por transição de participação e alternância. O SQL de transição isola triggers e não é teste end-to-end dos serviços Admin/participante.

## Estado das validações automatizadas e pendências técnicas

Na auditoria pré-commit posterior, o aplicativo passou 520/520 testes, sem falhas ou skips; os typechecks de produção e testes do backend também passaram. O comando padrão backend `npm test` não iniciou os testes por `uv_os_get_passwd / ENOMEM`. No fallback temporário de compilação TypeScript e execução Node, 74 arquivos unitários produziram 1.122 aprovações, 14 falhas e 0 skips. Uma falha concreta em `backend/test/unit/schema.test.ts` esperava 25 tabelas, enquanto o schema atual exporta 26 após a inclusão de `external_entry_calls`; a expectativa e a lista de nomes foram corrigidas nesta preparação, ainda sem reexecutar testes. As outras 13 falhas foram reportadas no nível de arquivos/processos pelo fallback. Uma campanha anterior documentou exatamente 13 abortos de módulos Nest quando faltaram os quatro TTLs de idempotência no ambiente isolado; essa é uma hipótese forte para a repetição, mas os logs individuais da auditoria atual não estão disponíveis para comprová-la. Portanto, a suíte completa do backend ainda não está aprovada e precisa de validação com Luna Medium.

Na mesma auditoria, `git diff --cached --check` apontou espaços finais no relatório funcional então staged e no patch de QA. A verificação reversa da evidência também não correspondeu ao teste de integração atual: o patch registrado continha a versão anterior da asserção de unicidade, menos restritiva que o teste final. O relatório separado foi consolidado e removido; o patch de QA foi regenerado nesta preparação, sem novos testes. A documentação da fixture foi atualizada para o banco geral e oito migrations. O índice Git pode ainda conter versões staged anteriores até revisão do responsável no VS Code.

Também permanecem pendentes: concorrência física entre serviços/sessões; recuperação segura de intenções cujo resultado permanece incerto; cenários de ausência e resolução depois do cutoff, do fim oficial e do prazo operacional; desativação com pessoas aguardando ou chamada pendente; verificações específicas de TRUNCATE, anonimização, grants e retenção. A desativação funcional observada ocorreu somente depois de a fila externa estar vazia. Não há GET posterior nem captura que comprove o estado final da fila. A lista nominal não tem paginação; nome não prova identidade. Nenhuma política de desbloqueio de intenção incerta foi adicionada.

## Validação automatizada — 11/11/2026 (Luna Medium)

### Testes executados

- Backend: 17 arquivos unitários/HTTP simulados; **341 aprovados, 0 falhos, 0 ignorados**.
- Aplicativo: 6 arquivos focados; **145 aprovados, 0 falhos, 0 ignorados**.
- Total executado: **486 aprovados, 0 falhos, 0 ignorados**.
- Typecheck de produção do backend: aprovado (código 0).
- Typecheck dos testes do backend: aprovado (código 0).
- git diff --check: aprovado.

O primeiro início por tsx foi bloqueado antes de carregar os testes por uv_os_get_passwd / ENOMEM. O fallback compilou em diretório temporário e executou os JS selecionados com Node. A primeira execução do fallback encontrou duas falhas de asserção, ambas no teste do guard de destino: a allowlist recusava o banco dedicado antes da verificação específica da porta. A checagem de porta foi movida antes da allowlist; a allowlist geral continua restrita. Reexecutados os 17 arquivos, os 341 testes passaram. A compilação temporária não escreveu em backend/dist; seus arquivos e logs temporários foram removidos.

Os testes unitários cobriram chamadas FIFO, confirmação/ausência/remoção por callId, idempotência/replay, autorização, rollback de auditoria, cortes temporais simulados, desativação/reativação, desistência/fechamento modelados, rota legada somente replay e regressões de conclusão, ausência e remoção de atendimento nas estações. O aplicativo cobriu a jornada real de Controle de Entrada, cancelamento sem POST, intenções persistentes, timeout sem repetição, mudança de sessão e regressões de navegação/demonstração/estações.

### Correção do trigger e cobertura

A função check_external_call_integrity() agora exige que uma chamada canceled vinculada a participação finished ou canceled tenha p.finish_reason = NEW.resolution_reason e p.finished_at = NEW.resolved_at. O caso active permanece separado e requer external_queue_disabled e igualdade entre p.arena_entered_at e NEW.resolved_at. O trigger de transição existente copia o motivo e o horário da participação, portanto desistência, encerramento e regularização mantêm o vínculo esperado; desativação coletiva continua usando a regra active.

O teste PostgreSQL preparado para rejeitar cancelamentos com motivo ou horário divergente foi executado como parte da validação física do schema e passou no banco inicial dedicado, conforme registrado abaixo. O teste unitário que verifica o texto do DDL não substitui a cobertura física de concorrência entre serviços.

### Banco e limites

**Ensaio físico inicial:** a migration 0008 foi aplicada e estruturalmente conferida no banco local isolado `arenago_staff_homolog_20261111` (127.0.0.1:55432): foram confirmadas 8 migrations com hashes/timestamps, 4 FKs, 2 CHECKs, 2 índices únicos parciais, 6 triggers habilitados e 3 triggers diferidos. O teste físico de schema passou 1/1 após correção de asserções localizadas do PostgreSQL; a verificação independente confirmou rollback e ausência de usuários, eventos e chamadas sintéticas. Esta evidência se refere ao banco inicial, não ao banco geral.

**Banco de homologação geral:** separadamente, `arenago_staff_homolog_geral_20261111` recebeu as migrations 0001–0008, verificadas por journal, timestamps, hashes e tabelas essenciais. O relatório funcional registra o uso desse banco para o evento ArenaGo — Homologação Geral. Não confundir essa validação com a execução do teste físico de schema, que usou o banco inicial.

O teste de schema não simula concorrência física entre os serviços Admin/participante e os writers Staff; também não comprova condições reais de carga, grants efetivos em todos os papéis, retenção, TRUNCATE ou recuperação de intenção incerta. A migration foi aplicada nos bancos locais indicados, mas a Staff 02 não passou por homologação técnica exaustiva nem há base aqui para declarar o backend totalmente aprovado.

## Homologação funcional no Expo Go

O relatório separado de homologação foi consolidado nesta seção. Registra 20 cenários funcionais relatados: 10 de Staff 02 e 10 de Staff 01. A aprovação limita-se às ações observadas e não substitui testes automatizados, concorrência física, revisão de segurança ou homologação técnica exaustiva.

O relatório tem **data de referência** 12/11/2026 (America/Fortaleza), mas os documentos disponíveis não registram a data efetiva de execução dos cenários Expo Go. A data no nome do arquivo não foi usada como data de execução. A campanha automatizada focada acima está registrada como 11/11/2026; essa data não deve ser atribuída à homologação funcional ou ao ensaio físico sem registro próprio.

Ambiente informado: `arenago_staff_homolog_geral_20261111`, evento ArenaGo — Homologação Geral, Experiência de Homologação Geral, Estação 01 e Estação 02. O banco geral tinha as oito migrations, seed com questionário 1.0.0 e 20 jogos, sete contas sintéticas, Admin com TOTP, evento, duas estações e concessão Staff. Perfis/inscrições e entrada na fila interna foram preparados via API/PowerShell; as operações de Staff foram exercitadas no Expo Go. Segredos e códigos de recuperação foram relatados como armazenados em arquivos DPAPI locais; backup independente não foi confirmado.

### Staff 02 — fila externa de entrada

| Nº | Cenário | Resultado observado |
|---:|---|---|
| 01 | Visualização e ordem de espera | P2 → P3 → P4 → P5 no Expo Go; aprovado. |
| 02 | Chamar próximo | P2 chamado; P3, P4 e P5 aguardando; aprovado. |
| 03 | Ausência e retorno ao fim da fila | Após marcar P2 ausente: P3 → P4 → P5 → P2; aprovado. |
| 04 | Retomada após navegação | P3 continuou chamado ao voltar à tela; aprovado. |
| 05 | Remoção de chamado | P3 removido; fila P4 → P5 → P2; aprovado. |
| 06 | Confirmar entrada | P4 confirmado; fila P5 → P2; aprovado. |
| 07 | Bloqueio de nova chamada | “Chamar próximo” não apareceu enquanto P5 estava chamado; aprovado. |
| 08 | Reabrir aplicativo | P5 continuou chamado; aprovado. |
| 09 | Esvaziar fila | P5 e P2 confirmados; fila vazia; aprovado. |
| 10 | Desativar fila externa | O responsável confirmou que a ação foi concluída depois de a fila ficar vazia. Sem GET posterior ou captura; estado final não foi corroborado independentemente. |

Após os cenários, P1, P2, P4 e P5 tinham entrada confirmada; P3 foi removido. A fila foi desativada quando vazia; a campanha não testou desativação com pessoas aguardando nem chamada pendente.

### Staff 01 — fila da experiência e estações

| Nº | Cenário | Resultado observado |
|---:|---|---|
| 01 | Visualizar estações | Estações 01 e 02 visíveis no Expo Go; aprovado. |
| 02 | Entrar na fila interna | P1 ingressou via API, status `waiting`, posição 1; aprovado. |
| 03 | Ver primeiro da fila | P1 apareceu como primeiro aguardando; aprovado. |
| 04 | Chamar na Estação 01 | P1 chamado; aprovado. |
| 05 | Remover chamado | P1 removido e Estação 01 livre; aprovado. |
| 06 | Fila compartilhada | P2 posição 1 e P4 posição 2; chamados em estações diferentes; aprovado. |
| 07 | Independência das estações | P2 removido da Estação 01; P4 permaneceu chamado na Estação 02; aprovado. |
| 08 | Voltar à tela | P4 continuou chamado na Estação 02; aprovado. |
| 09 | Reabrir aplicativo | P4 continuou chamado; aprovado. |
| 10 | Liberação final | P4 removido; ambas as estações livres. Fila interna sem aguardando, conforme confirmação do responsável; aprovado. |

### Limites da homologação funcional

Os cenários acima são evidência funcional relatada pelo responsável, não resultado de execução automatizada nem prova exaustiva de segurança, concorrência, disponibilidade ou integridade. Permanecem sem evidência material anexada capturas/logs sanitizados e consulta final por API do estado da fila externa, chamada pendente e estações. O relatório funcional também recomendava confirmar backup independente das chaves/códigos de recuperação.

O documento de origem está consolidado aqui e deixa de ser um artefato separado. Esta consolidação não elimina as pendências da auditoria pré-commit nem libera publicação ou uso operacional adicional.
