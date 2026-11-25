# ArenaGo — STAFF-03 | Controle de Entrada e Integração da Chamada Externa

## 1. Objetivo e Escopo da STAFF-03

- **Projeto:** ArenaGo — ProgramacaoMobile (`JaviDansen/ArenaGo`)
- **Task:** STAFF-03 — Controle de Entrada e Integração da Chamada Externa
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base de referência (`HEAD` original):** `efe21a8492a056d08a8c61799f7a66636c830a63` (`docs(staff): registra encerramento formal da STAFF-02`)
- **Commit auditado (Rodada 1):** `29029f0328ecb02bf6e016abda1b2c4ed371dffe` (`Controle de Entrada e Integração da Chamada Externa`)
- **Status atual:** Correções dos sete achados da Auditoria Independente — Rodada 1 (`STAFF03-AUD-01` a `STAFF03-AUD-07`) implementadas na branch `feature/staff-operacional-v2` (acumuladas desde `efe21a8492a056d08a8c61799f7a66636c830a63`). **Ainda não aprovada nem homologada**; pendentes publicação para nova auditoria independente, execução automatizada com **GPT-6 Luna — Medium** conforme [AGENTS.md](../AGENTS.md), integração visual do Participante pelo Heliom e homologação no Expo Go.

### Objetivos principais
1. **Entrega A — Reformulação do Controle de Entrada (App Staff):** modernizar visualmente e funcionalmente [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) na identidade aprovada nas STAFF-01 e STAFF-02, preservando integralmente contratos HTTP, polling, autorização por evento, fila FIFO do servidor, modais responsivos e persistência de intenções no `SecureStore`.
2. **Entrega B — Contrato de Chamada Externa para o Participante (Backend + Propagação em Store):** estender a projeção autenticada da participação em `GET /api/v1/participations/current` e `GET /api/v1/participations/:participationId` para expor com segurança `externalEntryCall` (identificada por `callId` estável) somente ao titular autenticado, além de atualizar a detecção de mudança silenciosa em [participationService.js](../app/services/participationService.js) sem modificar as telas visuais do Participante (frente do Heliom).
3. **Entrega C — Documentação, Evidências e Campanha de Testes:** documentar o contrato definitivo para o Heliom, reforçar suítes unitárias e de integração simulada (backend + app), gerar [qa-evidence/STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) sobre `efe21a8492a056d08a8c61799f7a66636c830a63` e preparar o roteiro de homologação presencial no Expo Go e instruções exatas para execução com **GPT-6 Luna — Medium**.

### Seleção de modelos e níveis de raciocínio (conforme [AGENTS.md](../AGENTS.md))
- **Implementação da STAFF-03:** **GPT-6.1 Sol — High** (envolve projeção SQL transacional somente leitura, invariantes estritos de isolamento/privacidade em backend, reformulação visual completa no módulo Staff, propagação reativa na store do Participante e cobertura de regressões concorrentes).
- **Revisão crítica opcional de backend/segurança:** **GPT-6 Astra — High** sobre [participation-query.service.ts](../backend/src/participations/participation-query.service.ts) e [participation-lifecycle.dto.ts](../backend/src/participations/participation-lifecycle.dto.ts).
- **Execução da campanha de validações automatizadas:** **GPT-6 Luna — Medium** (executor padrão designado pelo [AGENTS.md](../AGENTS.md); nenhum teste `node --test`, `npm test` ou contra PostgreSQL será executado pelo modelo de implementação).

---

## 2. Estado Inicial Encontrado no Repositório (`efe21a8`)

1. **Backend — Persistência e Fluxo Staff já existentes:**
   - A tabela `external_entry_calls` ([0008_external_entry_calls.sql](../backend/drizzle/0008_external_entry_calls.sql) e [participations.schema.ts](../backend/src/database/schema/participations.schema.ts)) já garante unicidade de chamada `pending` por evento (`uq_external_calls_pending_event`) e por participação (`uq_external_calls_pending_participation`), imutabilidade terminal (`protect_external_entry_call`), cancelamento sistêmico por trigger ao sair de `waiting` (`resolve_external_call_on_participation`, cobrindo D06 desligamento da fila externa, desistência `cancel`, encerramento administrativo imediato/controlado e finalização automática) e integridade transacional diferida (`check_external_call_integrity`).
   - Os serviços [staff-entry-call.service.ts](../backend/src/participations/staff-entry-call.service.ts), [staff-entry.service.ts](../backend/src/participations/staff-entry.service.ts) e [staff-entry.controller.ts](../backend/src/participations/staff-entry.controller.ts) já expõem todas as rotas operacionais `/api/v1/staff/events/:eventId/entry-control*` com `Idempotency-Key`, FIFO do servidor, cortes temporais e auditoria.
2. **Backend — Projeção do Participante (`GET /participations/current` e `GET /participations/:participationId`):**
   - [participation-lifecycle.controller.ts](../backend/src/participations/participation-lifecycle.controller.ts) delega exclusivamente a [ParticipationQueryService](../backend/src/participations/participation-query.service.ts) (`participationProjection` + `publicParticipation`), validado por [participationView](../backend/src/participations/participation-lifecycle.dto.ts).
   - Atualmente, `participationView` retorna apenas `id`, `eventId`, `status`, `joinedAt`, `arenaEnteredAt`, `finishedAt`, `finishReason` e `externalQueue` (`position`, `observedAt`), **sem consultar `external_entry_calls`**.
   - As rotas `GET /participations/current` e `GET /participations/:participationId` não declaravam cabeçalho explícito `Cache-Control: no-store`.
   - Observação adicional: [ParticipationsService](../backend/src/participations/participations.service.ts) ainda contém métodos legados internos (`getCurrentParticipation`/`getParticipationById`) cobertos por testes específicos de leitura E04 que validam as chaves exatas antigas; os endpoints HTTP públicos oficiais usam `ParticipationQueryService`.
3. **Aplicativo Participante — Store e Contexto:**
   - [ParticipationContext.js](../app/context/ParticipationContext.js) e [participationService.js](../app/services/participationService.js) consomem `GET /participations/current` (em carregamento inicial, retomada do `AppState` e `syncCurrentSilent`).
   - **Lacuna identificada no app Participante:** `syncCurrentSilent` em [participationService.js](../app/services/participationService.js#L120-L123) calculava `changed` comparando apenas `id`, `status` e `externalQueue?.position`. Se o Staff chamasse o participante na posição `1` (`status: 'waiting'`), `id`, `status` e `position` continuariam iguais e a atualização silenciosa ignoraria a chegada de `externalEntryCall`!
4. **Aplicativo Staff — Controle de Entrada:**
   - [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js) envolve [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) em [StaffLiveScreen.js](../app/screens/staff/components/StaffLiveScreen.js) (`Voltar ao painel` + logo transparente).
   - [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) possui lógica robusta em [staffEntryService.js](../app/services/staffEntryService.js) e [staffEntryIntentStorage.js](../app/services/staffEntryIntentStorage.js), mas apresentava visual legado (cores `#191330`/`#34265a`, sem card de resumo operacional estruturado, sem priorização visual da chamada pendente com horário, itens da fila em texto simples `1. Ana`, sem indicador fiel de polling, modal sem `SafeAreaView` + `ScrollView` e sem separação clara entre botões semânticos de confirmar/ausência/remover/desativar).
   - **Inventário estático Staff:** [staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs) exige que todo arquivo `.js` dentro de `app/screens/staff/` esteja listado em `realStaffScreens` ou `demoStaffScreens`.

---

## 3. Contratos Existentes e Lacunas Identificadas

| Área | Situação em `efe21a8` | Lacuna / Ação STAFF-03 |
|---|---|---|
| Projeção HTTP Participante | `ParticipationView` sem campo de chamada externa | Estender de forma aditiva com `externalEntryCall` (`callId`, `participationId`, `eventId`, `kind: 'external_entry'`, `status: 'pending'`, `calledAt`) ou `null`. |
| SQL `participationProjection` | Não faz join com `external_entry_calls` | Adicionar `LEFT JOIN external_entry_calls c` qualificando `scoped.*`, filtrando `c.status='pending'`, `c.participation_id=scoped.id`, `c.event_id=scoped.event_id`, `scoped.status='waiting'` e `NOT scoped.ended`, mantendo snapshot único `repeatable read` `read only` sem N+1. |
| Headers de resposta Participante | `GET /current` e `GET /:id` sem `Cache-Control: no-store` | Adicionar `@Header('Cache-Control', 'no-store')` em ambos os `@Get` de `ParticipationLifecycleController`. |
| `participationService.js` | `syncCurrentSilent` não detectava mudança de `externalEntryCall` | Validar estrutura quando presente e comparar `externalEntryCall.{callId,status,calledAt}` em `changed` (compatível com fixtures antigas em que o campo é `null` ou omitido). |
| `StaffEntryControlRealScreen.js` | Layout legado e feedback pouco hierarquizado | Reformular com tokens STAFF-01/STAFF-02 via [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js), mantendo todos os contratos de `staffEntryService.js` e `staffEntryIntentStorage.js` e registrando no inventário de `staffDemoState.test.cjs`. |

---

## 4. Proposta Definitiva e Contrato de Integração com o Heliom

Esta especificação é a fonte oficial para que **Heliom** implemente o aviso e eventuais alertas no aplicativo do Participante sem suposições.

### 4.1. Endpoints definitivos
- **Principal (uso contínuo / polling / carga inicial):** `GET /api/v1/participations/current`
- **Consulta por participação específica:** `GET /api/v1/participations/:participationId`
- **Autenticação obrigatória:** `Authorization: Bearer <accessToken>` (sessão ativa verificada; `401` em ausência, token inválido, sessão revogada/expirada ou admin sem 2FA).
- **Autorização e privacidade:** o titular é extraído exclusivamente de `@CurrentUserId()` (token/sessão). Nunca aceita `userId` em query/body/params. Em `GET /:participationId`, participação inexistente ou de outra conta retorna identicamente `404 RESOURCE_NOT_FOUND`. Nunca expõe `calledByUserId`, `resolvedByUserId`, nomes de terceiros, credenciais ou `externalQueueOrder`.
- **Cabeçalho HTTP de resposta:** `Cache-Control: no-store`.

### 4.2. Formato exato do campo `externalEntryCall` (aditivo em `participation`)

Quando `participation` estiver presente no payload:
- **Tipo:** objeto `ExternalEntryCallView | null` (nunca omitido pela API; retorna explicitamente `null` quando não há chamada externa ativa).
- **Campos do objeto `externalEntryCall` (todos obrigatórios quando não `null`):**
  - `callId` (`string` UUID): identificador único e estável desta ocorrência em `external_entry_calls`.
  - `participationId` (`string` UUID): idêntico a `participation.id`.
  - `eventId` (`string` UUID): idêntico a `participation.eventId`.
  - `kind` (`'external_entry'`): literal fixo que identifica tratar-se de chamada do **Controle de Entrada**, diferenciando-a inequivocamente de chamadas de estação/experiência dentro da Arena.
  - `status` (`'pending'`): apenas chamadas externas pendentes aguardando comparecimento presencial são projetadas em `externalEntryCall`.
  - `calledAt` (`string` ISO-8601 UTC com 6 casas de microssegundos, ex.: `"2026-11-24T15:00:00.123456Z"`): instante oficial da chamada registrado pelo PostgreSQL.

### 4.3. Exemplos completos de resposta HTTP (`200 OK`)

**Caso 1 — Participante na fila externa com chamada pendente (deve exibir o aviso ao Participante):**
```json
{
  "participation": {
    "id": "22222222-2222-4222-8222-222222222222",
    "eventId": "11111111-1111-4111-8111-111111111111",
    "status": "waiting",
    "joinedAt": "2026-11-24T14:50:00.000000Z",
    "arenaEnteredAt": null,
    "finishedAt": null,
    "finishReason": null,
    "externalQueue": {
      "position": 1,
      "observedAt": "2026-11-24T15:00:05.000000Z"
    },
    "externalEntryCall": {
      "callId": "66666666-6666-4666-8666-666666666666",
      "participationId": "22222222-2222-4222-8222-222222222222",
      "eventId": "11111111-1111-4111-8111-111111111111",
      "kind": "external_entry",
      "status": "pending",
      "calledAt": "2026-11-24T15:00:00.123456Z"
    }
  }
}
```

**Caso 2 — Participante aguardando na fila externa sem chamada ativa:**
```json
{
  "participation": {
    "id": "22222222-2222-4222-8222-222222222222",
    "eventId": "11111111-1111-4111-8111-111111111111",
    "status": "waiting",
    "joinedAt": "2026-11-24T14:50:00.000000Z",
    "arenaEnteredAt": null,
    "finishedAt": null,
    "finishReason": null,
    "externalQueue": {
      "position": 2,
      "observedAt": "2026-11-24T15:00:05.000000Z"
    },
    "externalEntryCall": null
  }
}
```

**Caso 3 — Entrada confirmada pelo Staff (ou liberação por desativação da fila D06):**
- Em `GET /participations/current` e `GET /participations/:participationId`:
```json
{
  "participation": {
    "id": "22222222-2222-4222-8222-222222222222",
    "eventId": "11111111-1111-4111-8111-111111111111",
    "status": "active",
    "joinedAt": "2026-11-24T14:50:00.000000Z",
    "arenaEnteredAt": "2026-11-24T15:01:10.000000Z",
    "finishedAt": null,
    "finishReason": null,
    "externalQueue": null,
    "externalEntryCall": null
  }
}
```

**Caso 4 — Ausência antes do corte (participante reinserido no fim da fila externa):**
- Ocorrência anterior vai para `absent`, `participation.status` continua `"waiting"`, `externalQueue.position` reflete o fim da fila e `externalEntryCall` volta imediatamente para `null` (como no Caso 2, sem reapresentar a chamada antiga).
- Se o Staff voltar a chamar essa mesma participação posteriormente, será criado um **novo registro** com um **novo `callId`** distinto do anterior, reativando `externalEntryCall` como objeto `pending`.

**Caso 5 — Ausência após o corte / Remoção pelo Staff / Desistência / Encerramento do evento:**
- Em `GET /api/v1/participations/current`: retorna `{ "participation": null }` (pois estados terminais não são correntes).
- Em `GET /api/v1/participations/:participationId`:
```json
{
  "participation": {
    "id": "22222222-2222-4222-8222-222222222222",
    "eventId": "11111111-1111-4111-8111-111111111111",
    "status": "finished",
    "joinedAt": "2026-11-24T14:50:00.000000Z",
    "arenaEnteredAt": null,
    "finishedAt": "2026-11-24T15:05:00.000000Z",
    "finishReason": "external_absence_after_entry_cutoff",
    "externalQueue": null,
    "externalEntryCall": null
  }
}
```
*(No caso de remoção pelo Staff, `status` é `"canceled"` e `finishReason` é `"staff_external_wait_removed"`; na desistência voluntária, `"canceled"` e `"external_wait_withdrawal"`; no encerramento controlado, `"finished"` e `"admin_controlled_external_wait_closed"`; todos com `"externalEntryCall": null`.)*

### 4.4. Regras de consumo para a interface do Heliom
1. **Exibição da mensagem obrigatória e validação defensiva:** apresentar **“É sua vez! Dirija-se ao Controle de Entrada.”** somente quando o payload validado satisfizer integralmente:
   - `participation?.status === 'waiting'` **e**
   - `participation?.externalEntryCall` é um objeto completo com os 6 campos obrigatórios (`callId`, `participationId`, `eventId`, `kind`, `status`, `calledAt`), sem campos extras inesperados **e**
   - `callId`, `participationId` e `eventId` são UUIDs válidos **e**
   - `participation.externalEntryCall.participationId === participation.id` **e**
   - `participation.externalEntryCall.eventId === participation.eventId` **e**
   - `participation.externalEntryCall.kind === 'external_entry'` **e**
   - `participation.externalEntryCall.status === 'pending'` **e**
   - `calledAt` está em formato ISO-8601 UTC com precisão de microssegundos (`YYYY-MM-DDTHH:MM:SS.ffffffZ`).
2. **Semântica de `callId` (chave estável e deduplicação de alertas):**
   - Utilizar `callId` em chave isolada por sessão/participação (ex.: `${userId}:${epoch}:external:${participation.id}:${callId}`) para distinguir primeira chamada, re-renderização/polling repetido da mesma chamada (não vibrar de novo), chamada resolvida e **nova chamada após ausência + reinserção** (`callId` diferente).
   - Nunca usar apenas `externalQueue.position === 1` ou booleano local para inferir chamada, nem suprimir futuras chamadas após ausência.
3. **Diferenciação de chamada de estação:**
   - Chamadas externas vêm em `participation.externalEntryCall` com `kind: 'external_entry'` (enquanto `participation.status === 'waiting'`).
   - Chamadas de estação pertencem às filas internas de experiências quando `participation.status === 'active'` (`/participations/:participationId/queue`). Os dois avisos são mutuamente exclusivos pelo próprio ciclo de estado.
4. **Tratamento de `syncStale`, respostas inválidas, `401`/`403` e reconexão:**
   - **Falha transitória de rede ou resposta malformada (`syncStale: true`):** [participationService.js](../app/services/participationService.js) preserva o último estado confirmado sem fabricar nem apagar a participação, mas **sinaliza `syncStale: true`** (inclusive quando um payload malformado é rejeitado). A interface do Heliom **nunca** deve tratar um estado marcado com `syncStale: true` como uma nova chamada ou disparar novo alerta/vibração; deve indicar visualmente que os dados podem estar desatualizados até a próxima leitura válida (`syncStale: false`).
   - **Negativas de autorização (`HTTP 401` / `HTTP 403`):** tanto em `refresh()` quanto em `syncCurrentSilent()` (incluindo leitura de `/participations/return-state` durante transição), a store limpa imediatamente `participation`, `returnState` e `demoParticipation`, avança a geração para descartar respostas atrasadas e publica `status: 'error'`, `error: 'authorization'`, `syncStale: false`. O aviso de chamada externa desaparece imediatamente e não é mascarado como falha transitória de rede.
   - **Reconexão e retorno do segundo plano:** `ParticipationContext` reexecuta `refresh()` automaticamente ao retomar `AppState === 'active'` e `syncCurrentSilent()` detecta mudanças em `externalEntryCall` (`callId`, `status` ou `calledAt`). Ao retomar do segundo plano com chamada já `pending`, exibir o banner imediatamente respeitando deduplicação por `callId` sem disparar alerta retroativo indevido (análoga a [queueAlertService.js](../app/services/queueAlertService.js)).
   - **Isolamento entre contas/sessões:** trocas de `userId` ou `epoch` invalidam leituras em voo; respostas atrasadas de uma conta A nunca alteram o estado da conta B.

---

## 5. Decisões de Arquitetura e Justificativas

1. **Extensão aditiva em `ParticipationQueryService` em vez de novo endpoint ou migration:** reutiliza `external_entry_calls` (`0008`), evita duplicação de consultas de rede no polling do Participante e mantém o mesmo snapshot transacional `REPEATABLE READ` `READ ONLY` para `status`, `position`, `ended` e `externalEntryCall`.
2. **Proteção dupla SQL + DTO (`ended` e `status === 'waiting'`):** impede que uma janela expirada antes do scheduler físico exiba chamada pendente fantasma.
3. **Preservação integral de `staffEntryService.js` e `staffEntryIntentStorage.js`:** garante que nenhuma regra de idempotência, `callId`, `Idempotency-Key`, D06 ou isolamento de sessões/eventos seja enfraquecida na reformulação da tela Staff.
4. **Componentização alinhada à STAFF-02 (`StaffEntrySections.js`):** aplica tokens de [AdminLiveUI.js](../app/screens/admin/components/AdminLiveUI.js) e [StaffStationSections.js](../app/screens/staff/components/StaffStationSections.js), evitando duplicar o header compartilhado de [StaffLiveScreen.js](../app/screens/staff/components/StaffLiveScreen.js) e mantendo compatibilidade de modais acessíveis com `SafeAreaView` e `ScrollView`.
5. **Projeção exclusivamente observacional no Participante:** nenhuma rota de leitura do Participante altera linhas no banco nem aciona retentativas de mutação Staff.

---

## 6. Modificações de Interface (Aplicativo Staff e Store Participante)

1. **[StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js)** (novo componente modular):
   - Aplica integralmente a paleta ArenaGO escura (`#090412` / `#151020`), bordas e acentos roxo-violeta de [AdminLiveUI.js](../app/screens/admin/components/AdminLiveUI.js) e reutiliza `ElapsedCallBadge` de [StaffStationSections.js](../app/screens/staff/components/StaffStationSections.js).
   - `formatEntryCallTimestamp`: formata o instante ISO da chamada externa no padrão legível `"Chamado às HH:MM"` com fallback seguro sem alterar timestamps oficiais.
   - `EntryHeaderCard` e `EntryStatusBadge`: cabeçalho claro com título, contexto do evento e badge semântica `FILA ATIVA` / `FILA INATIVA`.
   - `EntrySummaryCard`: card de resumo operacional com contadores (`waitingCount` aguardando, chamada pendente / livre), estado da fila externa e alerta explícito quando `canManage === false`.
   - `EntryCurrentCallCard`: card prioritário destacado para a chamada pendente (`displayName`, badge `CHAMADA PENDENTE`, `Chamado às HH:MM` + `ElapsedCallBadge`) e botões semânticos independentes para `Confirmar entrada` (`canConfirm`), `Marcar ausência` (`canMarkAbsent`) e `Remover da fila` (`canRemove`), com nota informativa automática quando houver restrição de corte; quando não há chamada pendente, apresenta estado vazio claro e botão principal `Chamar próximo` (`canCall`).
   - `EntryQueueListCard`: fila oficial em ordem FIFO com badge numérico por posição, rótulo `PRÓXIMO` para o primeiro participante quando não há chamada pendente, zero duplicidade do participante chamado e estado vazio amigável (`"Ninguém está aguardando na fila de entrada."`).
   - `EntryQueueToggleCard`: card dedicado ao controle D06 (`Desativar fila externa` / `Reativar fila externa`) com resumo objetivo do impacto antes do toque.
   - `EntryConfirmModal`: modal responsivo com `SafeAreaView`, `maxHeight: '100%'` e `ScrollView`, exibindo o nome do participante selecionado em ações sobre a chamada pendente e a contagem de participantes liberados ao desativar a fila.

2. **[StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js)**:
   - Preserva integralmente `createStaffEntryStore`, `defaultStaffEntryIntentStorage`, `getContext`, `dialogRef`, `autoAttempt`, `useStaffPolling` (5s), guarda contra duplo toque em `Chamar próximo`, limpeza imediata de dados nominais em `401`/`403`/`404` e preservação da intenção no `SecureStore`.
   - Integra `useIsFocused()` e `AppState` ao indicador honesto de sincronização automática (`Atualização automática ativa · a cada 5s`, `Atualização temporariamente pausada`, `Dados desatualizados · tentando atualizar a cada 5s` e `Atualização indisponível · aguardando recuperação`).

3. **[participationService.js](../app/services/participationService.js)**:
   - Extrai `isValidExternalEntryCall`, `isValidCurrentParticipationResponse` e `externalCallSignature`.
   - Garante compatibilidade retroativa com mocks que omitem ou enviam `externalEntryCall: null` e valida integridade (`waiting`, `kind === 'external_entry'`, `status === 'pending'`, `calledAt` válido, mesmo `participationId` e `eventId`).
   - Atualiza `syncCurrentSilent()` para detectar mudanças em `externalEntryCall` (`null ↔ pending` e troca de `callId` após ausência/reinserção) mesmo quando `id`, `status` e `externalQueue.position` não se alteram.

---

## 7. Modificações de Backend

1. **[participation-lifecycle.dto.ts](../backend/src/participations/participation-lifecycle.dto.ts)**:
   - Define `externalEntryCallView` (`callId`, `participationId`, `eventId`, `kind: "external_entry"`, `status: "pending"`, `calledAt` com precisão de microssegundos) e exporta `ExternalEntryCallView`.
   - Estende `participationView` com `externalEntryCall: externalEntryCallView.nullable().default(null)`.

2. **[participation-query.service.ts](../backend/src/participations/participation-query.service.ts)**:
   - Atualiza `participationProjection` qualificando todas as colunas de `scoped.*`, projetando `e.external_queue_enabled AS event_external_queue_enabled` e realizando `LEFT JOIN external_entry_calls c ON c.participation_id=scoped.id AND c.event_id=scoped.event_id AND c.status='pending' AND scoped.status='waiting' AND NOT scoped.ended AND scoped.event_external_queue_enabled`.
   - Preserva snapshot único em `REPEATABLE READ` + `READ ONLY`, `clock_timestamp()` único e ausência de N+1 ou mutações.
   - Atualiza `ParticipationProjectionRow` e `publicParticipation` com verificação defensiva (`PARTICIPATION_EXTERNAL_CALL_INTEGRITY`) para rejeitar projeções inconsistentes sem vazar credenciais ou identificadores do Staff.

3. **[participation-lifecycle.controller.ts](../backend/src/participations/participation-lifecycle.controller.ts)**:
   - Adiciona `@Header("Cache-Control", "no-store")` nos endpoints `@Get("current")` e `@Get(":participationId")`.

---

## 8. Arquivos Efetivamente Alterados

- **Backend:**
  - [participation-lifecycle.dto.ts](../backend/src/participations/participation-lifecycle.dto.ts)
  - [participation-query.service.ts](../backend/src/participations/participation-query.service.ts)
  - [participation-lifecycle.controller.ts](../backend/src/participations/participation-lifecycle.controller.ts)
  - [participation-lifecycle.test.ts](../backend/test/unit/participation-lifecycle.test.ts)
  - [participation-lifecycle-http.test.ts](../backend/test/unit/participation-lifecycle-http.test.ts)
  - [staff03-external-call-projection.integration.test.ts](../backend/test/integration/staff03-external-call-projection.integration.test.ts) *(novo)*
- **App (Staff, Store Participante e Testes):**
  - [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js) *(novo)*
  - [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js)
  - [participationService.js](../app/services/participationService.js)
  - [participationService.test.cjs](../app/tests/participationService.test.cjs)
  - [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) *(novo)*
  - [staffDemoState.test.cjs](../app/tests/staffDemoState.test.cjs)
  - [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs)
- **Documentação e Evidências:**
  - [STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md](./STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md)
  - [STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) *(patch acumulado a partir de `efe21a8492a056d08a8c61799f7a66636c830a63`, excluindo a si próprio)*

---

## 9. Testes e Resultados Reais

### 9.1. Inspeções estáticas realizadas na etapa de implementação (sem execução de suítes)
- Verificação sintática (`node --check`) dos arquivos `.cjs` e revisão estática dos módulos `.ts`/`.js` criados ou modificados.
- Conferência de integridade de patch via `git diff --check -- app backend docs`, `git apply --stat qa-evidence/STAFF-03-changes.diff` e `git apply --check --reverse qa-evidence/STAFF-03-changes.diff`.
- Validação de inventário Staff (`realStaffScreens` + ausência de imports de demonstração) e uso exclusivo de links relativos na documentação.

### 9.2. Campanha automatizada pendente para **GPT-6 Luna — Medium** (NÃO EXECUTADA nesta rodada)
Conforme [AGENTS.md](../AGENTS.md), o modelo de implementação **não** executou testes automatizados, lint, typecheck, build ou acesso ao PostgreSQL. Comandos ordenados a partir dos diretórios corretos (garantindo resolução Babel a partir de `app/` e scripts isolados em `backend/` e `qa/regression/`):

1. **Testes focados da STAFF-03 no App (executar a partir de `app/`):**
   - `Push-Location app`
   - `node --test tests/participationService.test.cjs tests/staffDemoState.test.cjs tests/staffEntryControl.test.cjs tests/staffEntryControlScreen.test.cjs tests/staffRealNavigation.test.cjs tests/roleRoutingIntegration.test.cjs`
   - `Pop-Location`
2. **Typecheck de produção e testes, lint, build e testes unitários/HTTP do Backend (executar a partir de `backend/`):**
   - `Push-Location backend`
   - `npm run typecheck:test`
   - `npm run lint`
   - `npm run build`
   - `npm test`
   - `Pop-Location`
3. **Regressão completa do aplicativo (executar a partir de `app/`):**
   - `Push-Location app`
   - `node --test tests/*.test.cjs`
   - `Pop-Location`
4. **Regressão independente em `qa/regression` (executar a partir de `qa/regression/`):**
   - `Push-Location qa/regression`
   - `node run.cjs`
   - `Pop-Location`
5. **Integração PostgreSQL dedicada (SOMENTE com autorização explícita do responsável, `NODE_ENV=test`, `current_database() = arenago_staff_homolog_20261111`, migration `0008` aplicada em `127.0.0.1:55432`, três URLs idênticas confirmadas e `STAFF03_POSTGRES_PROJECTION_TEST=authorized-local`, executando a partir de `backend/`):**
   - `npx tsx --tsconfig tsconfig.test.json --test test/integration/staff03-external-call-projection.integration.test.ts`
   - Regressões relacionadas (mesmos critérios de autorização e banco): `test/integration/participations-read.integration.test.ts`, `test/integration/participation-lifecycle.integration.test.ts` e `test/integration/external-entry-calls-schema.integration.test.ts`.
6. **Homologação funcional e visual no Expo Go** (roteiro da Seção 12).

---

## 10. Riscos, Limitações e Pendências

- **Frente do Heliom:** a exibição visual no aplicativo do Participante (*“É sua vez! Dirija-se ao Controle de Entrada.”*), vibração dedicada e homologação conjunta ponta a ponta dependem da implementação pelo Heliom usando o contrato da Seção 4.
- **Execução automatizada e homologação no Expo Go:** pendentes de execução autorizada com **GPT-6 Luna — Medium** e conferência presencial pelo responsável antes da aprovação final.
- **Não executar migrations, seeds ou testes contra PostgreSQL real** sem autorização explícita e verificação do ambiente (`NODE_ENV=test` e banco dedicado).

---

## 11. Dependências com Heliom

1. Entregar ao Heliom a Seção 4 completa logo no início desta task (`GET /api/v1/participations/current` + `externalEntryCall` + regras de `callId` + texto obrigatório).
2. Confirmar que [participationService.js](../app/services/participationService.js) já propaga reativamente alterações de `externalEntryCall` em `ParticipationContext`.
3. Não editar nenhuma tela do Participante nesta task.

---

## 12. Roteiro e Evidências de Homologação (Expo Go)

1. Preparar evento com `externalQueueEnabled = true` em janela ativa e um Participante real aguardando na fila externa (posição 1).
2. No app Staff, acessar `Eventos Staff → Painel Operacional → Controle de Entrada` e conferir cabeçalho, resumo operacional, status `FILA ATIVA` e participante na posição `1` com badge `PRÓXIMO`.
3. Acionar **Chamar próximo** e verificar no card destacado da chamada pendente: nome do participante, badge de chamada pendente, horário e botões (`Confirmar entrada`, `Marcar ausência`, `Remover da fila`), enquanto a fila restante não duplica o chamado e **Chamar próximo** fica oculto/indisponível.
4. Consultar `GET /api/v1/participations/current` com o token do Participante (e inspecionar o payload na integração conjunta com a tela do Heliom), confirmando presença de `externalEntryCall` com `callId`, `kind: "external_entry"`, `status: "pending"`, `calledAt`, `participationId` e `eventId` corretos.
5. Testar **Marcar ausência** antes do corte: verificar reinserção ao final da fila, desaparecimento temporário da chamada (`externalEntryCall: null`) e geração de novo `callId` distinto ao chamar novamente.
6. Testar **Confirmar entrada**: verificar retorno para fila sem pendente e saída da fila externa do Participante (`status: "active"`, `externalEntryCall: null`).
7. Repetir fluxo para **Remover da fila** (`status: "canceled"`, `externalEntryCall: null`) e **Desativar / Reativar fila externa** (conferir no card D06 e no modal que a contagem observada inclui `waitingCount + (pendingCall ? 1 : 0)` e que o aviso pós-operação exibe exclusivamente `releasedCount` confirmado pelo servidor).
8. Validar **janela residual após corte de entrada**: confirmar que `Confirmar entrada` fica desabilitado enquanto `Marcar ausência` e `Remover da fila` continuam habilitados com orientação neutra coerente.
9. Validar **invalidação de modal obsoleto**: abrir modal de confirmação em um dispositivo Staff enquanto outro Staff resolve/substitui a chamada ou enquanto a contagem da fila muda, conferindo fechamento automático com aviso contextual e zero mutações sobre a chamada seguinte.
10. Testar reconexão, troca de evento, perda de autorização (`401`/`403`) tanto no Staff quanto no Participante e visualização em dispositivo menor/fonte ampliada com rolagem nos modais de confirmação.

---

## 13. Histórico de Revisões, Correções e Commits

- **24/11/2026:** Criação inicial do documento `STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md` na branch `feature/staff-operacional-v2` (base `efe21a8492a056d08a8c61799f7a66636c830a63`) antes de qualquer alteração em código, formalizando o contrato da chamada externa para o Heliom e o plano técnico da STAFF-03.
- **24/11/2026:** Conclusão da implementação inicial e cobertura de testes da STAFF-03 (publicada no commit `29029f0328ecb02bf6e016abda1b2c4ed371dffe`).
- **25/11/2026:** Abertura da seção **Auditoria Independente — Rodada 1** antes das correções de código, registrando os sete achados (`STAFF03-AUD-01` a `STAFF03-AUD-07`), causas confirmadas e plano de correção.

---

## Auditoria Independente — Rodada 1

Auditoria estática independente realizada sobre o commit `29029f0328ecb02bf6e016abda1b2c4ed371dffe` (base original da STAFF-03: `efe21a8492a056d08a8c61799f7a66636c830a63`). Todos os sete achados abaixo foram confirmados por inspeção direta do código antes de qualquer alteração.

### Resumo dos achados, riscos e plano de correção

| ID | Prioridade | Causa técnica confirmada | Risco | Plano de correção |
|---|---|---|---|---|
| `STAFF03-AUD-01` | P1 | Em [participationService.js](../app/services/participationService.js), `syncCurrentSilent()` retornava silenciosamente sem publicar `syncStale: true` quando `isValidCurrentParticipationResponse()` falhava, e o `catch` genérico mantinha a participação anterior (e `externalEntryCall`) mesmo diante de HTTP `401`/`403` em `/current` ou `/return-state`. | Chamada externa revogada ou desatualizada poderia permanecer ativa na interface do Participante como se estivesse atualizada. | Diferenciar em `syncCurrentSilent()`: (A) falha transitória preserva estado + `syncStale: true`; (B) resposta inválida não substitui estado + sinaliza `syncStale: true`; (C) HTTP `401`/`403` (em `/current` ou `/return-state`) limpa `participation`, `returnState`, `demoParticipation`, avança `generation` e publica `status: 'error'`, `error: 'authorization'`, `syncStale: false`. |
| `STAFF03-AUD-02` | P1 | O parser de [participationService.js](../app/services/participationService.js) aceitava `externalEntryCall` sem `participationId`/`eventId`, aceitava strings arbitrárias em `callId` e usava apenas `Date.parse`. No backend, `publicParticipation()` em [participation-query.service.ts](../backend/src/participations/participation-query.service.ts) permitia campos `undefined` e reconstruía `participationId`/`eventId`/`status` em vez de exigi-los da linha projetada. | Objetos parciais ou malformados passavam pela validação, podendo vincular uma chamada a contexto inconsistente. | Exigir no app os 6 campos obrigatórios (sem extras), validação UUID para `callId`/`participationId`/`eventId`, correspondência estrita com `participation.id` e `participation.eventId`, `kind === 'external_entry'`, `status === 'pending'`, `participation.status === 'waiting'` e timestamp UTC com microssegundos (`YYYY-MM-DDTHH:MM:SS.ffffffZ`). No backend, exigir todos os campos projetados em `publicParticipation()` sem reconstrução artificial e adicionar `.superRefine()` compartilhado em [participation-lifecycle.dto.ts](../backend/src/participations/participation-lifecycle.dto.ts) mantendo compatibilidade com respostas sem `externalEntryCall` ou `null`. |
| `STAFF03-AUD-03` | P1 | [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js) e [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) exibiam apenas `waitingCount` no card de controle D06 e no modal de desativação, omitindo a pessoa em `pendingCall`, que também é liberada pelo backend em D06. | Staff recebia contagem subestimada (ex.: 2 em vez de 3 quando há 2 aguardando e 1 chamado). | Calcular `affectedCount = waitingCount + (pendingCall ? 1 : 0)` para o card D06 e o modal de desativação, esclarecendo que se trata do estado observado antes da execução; preservar `waitingCount` e lista FIFO sem duplicação e exibir exclusivamente `releasedCount` confirmado pelo servidor após a operação. |
| `STAFF03-AUD-04` | P1 | [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js) não invalidava nem fechava o modal quando `pendingCall`, permissões ou contagem observada mudavam por polling ou leitura em voo, nem apresentava feedback contextual ao invalidar. | Modal antigo para participante A permanecia aberto após resolução/substituição por participante B, ou modal de desativação exibia contagem obsoleta. | Associar o diálogo ao escopo, `callId` original, permissões observadas e `affectedCount` observado; invalidar e fechar automaticamente o modal via `useEffect` e revalidação síncrona em `confirm()` com aviso contextual quando ocorrer mudança na chamada, permissões, fila ou contagem, neutralizando callbacks antigos com zero mutações. **Observação técnica documentada sobre polling durante modal:** em [StaffEventsNavigator.js](../app/screens/staff/StaffEventsNavigator.js) (linhas 551 e 565), quando `section === 'entry'`, o navegador não executa polling de `/stations` nem de `/entry-control`; somente `StaffEntryControlRealScreen` realiza o polling de 5s. Além disso, a regressão aprovada `AUD-01 + AUD-05` em [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs) (linhas 1932–1944) exige que `GET /entry-control` no ciclo de 5s detecte `403` com o modal de desativação aberto. Portanto, mantém-se o polling ativo durante modais em `StaffEntryControlRealScreen`, acoplado à invalidação automática imediata do diálogo em qualquer mudança de chamada/permissão/contagem/autorização e mantendo o indicador honesto de polling alinhado ao estado real. |
| `STAFF03-AUD-05` | P2 | `hasCutoffRestriction` em [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js) verificava `canConfirm && (!canMarkAbsent || !canRemove)`, exatamente o inverso do contrato real em [staff-entry.service.ts](../backend/src/participations/staff-entry.service.ts) (linhas 90–101), onde na janela residual após o corte ocorre `canManage: false`, `canCall: false`, `canConfirm: false`, `canMarkAbsent: true`, `canRemove: true`. | Mensagem incorreta para o Staff e cenário de teste invertido. | Corrigir condição para `!canConfirm && (canMarkAbsent || canRemove)` com mensagem neutra (*"A confirmação de entrada está indisponível. Ainda é possível registrar ausência ou remover o participante chamado."*) e mensagem separada quando todas as ações estiverem bloqueadas; cobrir os 6 estados reais em [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs). |
| `STAFF03-AUD-06` | P1 | Em [staff03-external-call-projection.integration.test.ts](../backend/test/integration/staff03-external-call-projection.integration.test.ts): (1) criava duas participações `waiting` para o mesmo `user1Id`, violando `uq_participations_one_current_user`; (2) atualizava `participations` antes de `external_entry_calls` em cenários de resolução explícita, colidindo com `resolve_external_call_on_participation`; (3) chamava `SET CONSTRAINTS ALL IMMEDIATE` sem restaurar `SET CONSTRAINTS ALL DEFERRED` antes dos cenários compostos. | Bloqueio de validação da campanha PostgreSQL quando autorizada. | Reorganizar a fixture com `user3Id` para evento 2 + participação terminal histórica de `user1Id`; espelhar a ordem real de escrita de [staff-entry-call.service.ts](../backend/src/participations/staff-entry-call.service.ts) (`external_entry_calls` primeiro, `participations` copiando `c.resolved_at` com `resolution_reason` real); encapsular cada cenário em `SAVEPOINT` com `SET CONSTRAINTS ALL DEFERRED` → transições → `SET CONSTRAINTS ALL IMMEDIATE` → projeção → `ROLLBACK TO SAVEPOINT`; adicionar encerramentos controlado e imediato sem alterar migration `0008` nem persistir dados. |
| `STAFF03-AUD-07` | P1 | Em [participation-lifecycle-http.test.ts](../backend/test/unit/participation-lifecycle-http.test.ts), a fixture `value` atribuída a `LifecycleResult` omitia `externalEntryCall: null` (incompatibilidade de tipagem com `ParticipationView`), e o teste HTTP de isolamento reutilizava um único `userId` e um booleano `found`. | Falha de `typecheck:test` no backend e comprovação insuficiente de isolamento HTTP entre contas distintas. | Incluir `externalEntryCall: null` na fixture tipada `value`; verificar compatibilidade de replay histórico via `.default(null)` no DTO com teste dedicado em [participation-lifecycle.test.ts](../backend/test/unit/participation-lifecycle.test.ts); aplicar guarda `Cache-Control: no-store` no [participation-lifecycle.controller.ts](../backend/src/participations/participation-lifecycle.controller.ts) cobrindo respostas de sucesso e erro; reestruturar o teste HTTP com dois titulares distintos (`uid` e `uidB`), mapa de titularidade real, checagem de query `?userId=`, `404` neutro e `401` em sessão revogada. |

### Registro detalhado pós-correção (Rodada 1)

- **`STAFF03-AUD-01` (P1 — Estado de chamada desatualizado no Participante):**
  - **Causa confirmada:** `syncCurrentSilent()` em [participationService.js](../app/services/participationService.js) retornava sem marcar `syncStale: true` em payload inválido e o `catch` genérico mantinha a participação anterior mesmo em HTTP `401`/`403`.
  - **Solução aplicada:** diferenciados explicitamente (A) falha transitória (preserva estado + `syncStale: true`), (B) payload inválido em `/current` ou `/return-state` (rejeita dados inválidos + `syncStale: true`), e (C) HTTP `401`/`403` em `/current` ou `/return-state` (limpa `participation`, `returnState`, `demoParticipation`, limpa `presentedReturnEvaluations`, incrementa `generation` e publica `status: 'error'`, `error: 'authorization'`, `syncStale: false`). Também incrementada `generation` em `401`/`403` de `refresh()`.
  - **Arquivos modificados:** [participationService.js](../app/services/participationService.js), [participationService.test.cjs](../app/tests/participationService.test.cjs), [STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md](./STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md).
  - **Testes preparados:** `STAFF03-AUD-01 syncCurrentSilent diferencia falha transitória, payload malformado (syncStale) e 401/403 (limpeza total)` (incluindo `/return-state` e isolamento conta A/B).
  - **Verificação realizada:** revisão estática e `node --check` em `participationService.test.cjs`.
  - **Limitações / pendências:** execução automatizada pendente com GPT-6 Luna — Medium e consumo visual pelo Heliom.

- **`STAFF03-AUD-02` (P1 — Validação incompleta do contrato da chamada externa):**
  - **Causa confirmada:** `isValidExternalEntryCall` aceitava ausência de `participationId`/`eventId`, `callId` não-UUID e `Date.parse` genérico; `publicParticipation()` no backend permitia campos `undefined` e reconstruía vínculos a partir de `row.id`/`row.eventId`.
  - **Solução aplicada:** no app, exigidas exatamente as 6 chaves do contrato, validação UUID estrita para `callId`/`participationId`/`eventId`, vínculo exato com `participation.id`/`eventId`, `kind === 'external_entry'`, `status === 'pending'`, `participation.status === 'waiting'` e UTC com 6 casas de microssegundos validado no calendário (`YYYY-MM-DDTHH:MM:SS.ffffffZ`), mantendo compatibilidade com `undefined`/`null`. No backend, exigidos todos os campos projetados em `publicParticipation()` sem reconstrução artificial e adicionada validação cruzada `.superRefine()` em `participationView` e `finishedParticipationView`.
  - **Arquivos modificados:** [participationService.js](../app/services/participationService.js), [participation-query.service.ts](../backend/src/participations/participation-query.service.ts), [participation-lifecycle.dto.ts](../backend/src/participations/participation-lifecycle.dto.ts), [participationService.test.cjs](../app/tests/participationService.test.cjs), [participation-lifecycle.test.ts](../backend/test/unit/participation-lifecycle.test.ts).
  - **Testes preparados:** todos os cenários positivos/negativos no app (com UUIDs reais) e no backend (`publicParticipation`, `participationView` e `finishedParticipationView`).
  - **Verificação realizada:** revisão estática e `node --check` nos `.cjs`.
  - **Limitações / pendências:** execução de `npm run typecheck:test` e suítes unitárias com GPT-6 Luna — Medium.

- **`STAFF03-AUD-03` (P1 — Contagem incorreta ao desativar a fila externa):**
  - **Causa confirmada:** card D06 e modal de desativação exibiam apenas `waitingCount`, omitindo a pessoa em `pendingCall`.
  - **Solução aplicada:** exportado `getDisableAffectedCount(waitingCount, pendingCall)` (`waitingCount + (pendingCall ? 1 : 0)`) e aplicado em `EntryQueueToggleCard` e `EntryConfirmModal` (via `describeObservedDisableImpact`), explicitando que a contagem é do estado observado antes da execução e preservando `waitingCount`, lista FIFO sem duplicação e `releasedCount` confirmado pelo servidor após a operação.
  - **Arquivos modificados:** [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js), [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js), [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs), [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs).
  - **Testes preparados:** teste unitário puro de `getDisableAffectedCount` e renderização real dos 4 cenários (`0`, `2`, `3`, `1` afetados) com verificação de `releasedCount`.
  - **Verificação realizada:** revisão estática e `node --check` nos `.cjs`.
  - **Limitações / pendências:** execução automatizada com GPT-6 Luna — Medium e conferência visual no Expo Go.

- **`STAFF03-AUD-04` (P1 — Modal de confirmação obsoleto):**
  - **Causa confirmada:** a tela não invalidava o diálogo quando `pendingCall`, permissões ou contagem observada mudavam enquanto o modal estava aberto nem apresentava aviso contextual.
  - **Solução aplicada:** implementada `evaluateEntryDialog` verificando escopo, `callId`, `participationId`, permissões específicas (`canConfirm`/`canMarkAbsent`/`canRemove`/`canManage`), estado `stale` e `observedAffectedCount`/`observedHasPendingCall` em `open()`, na visibilidade do modal, reativamente via `useEffect` e sincronamente em `confirm()`, fechando automaticamente o diálogo com aviso contextual e garantindo zero mutações para callbacks antigos. Justificativa técnica documentada para manter o polling de 5s ativo na subtela durante modais: `StaffEventsNavigator.js` (linhas 551 e 565) não faz polling de `/entry-control` nem `/stations` quando `section === 'entry'`, e a regressão aprovada `AUD-01 + AUD-05` (`roleRoutingIntegration.test.cjs:1932-1944`) exige detecção de `403` no ciclo de 5s com modal aberto.
  - **Arquivos modificados:** [StaffEntryControlRealScreen.js](../app/screens/staff/StaffEntryControlRealScreen.js), [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs), [roleRoutingIntegration.test.cjs](../app/tests/roleRoutingIntegration.test.cjs).
  - **Testes preparados:** troca Ana → Bruno em polling, leitura em voo iniciada antes do modal com mudança de permissão (corte), mudança de contagem D06 durante modal, cancelamento sem mutação e teste integrado com `manualTimers`.
  - **Verificação realizada:** revisão estática e `node --check` nos `.cjs`.
  - **Limitações / pendências:** execução automatizada com GPT-6 Luna — Medium e validação em dois dispositivos no Expo Go.

- **`STAFF03-AUD-05` (P2 — Mensagem de restrição temporal invertida):**
  - **Causa confirmada:** `hasCutoffRestriction` testava `canConfirm && (!canMarkAbsent || !canRemove)`, invertendo o contrato de [staff-entry.service.ts](../backend/src/participations/staff-entry.service.ts) (janela residual tem `canManage: false`, `canCall: false`, `canConfirm: false`, `canMarkAbsent: true`, `canRemove: true`).
  - **Solução aplicada:** substituído por `showConfirmUnavailableNote` (`!canConfirm && (canMarkAbsent || canRemove)`) exibindo a orientação neutra *"A confirmação de entrada está indisponível. Ainda é possível registrar ausência ou remover o participante chamado."* e `showAllActionsUnavailableNote` quando todas estiverem bloqueadas, mantendo botões independentes pelas flags oficiais.
  - **Arquivos modificados:** [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js), [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs).
  - **Testes preparados:** `STAFF03-AUD-05` cobrindo todas permitidas, janela residual (`!canConfirm && canMarkAbsent && canRemove`), todas bloqueadas, fila inativa, indisponibilidade (`503`) e estado `stale`.
  - **Verificação realizada:** revisão estática e `node --check` nos `.cjs`.
  - **Limitações / pendências:** execução automatizada com GPT-6 Luna — Medium e conferência no Expo Go.

- **`STAFF03-AUD-06` (P1 — Fixture PostgreSQL incompatível com o schema):**
  - **Causa confirmada:** (1) duas participações `waiting` para o mesmo `user1Id` violando `uq_participations_one_current_user`; (2) atualização de `participations` antes de `external_entry_calls` colidindo com `resolve_external_call_on_participation`; (3) `SET CONSTRAINTS ALL IMMEDIATE` sem restauração para `DEFERRED`.
  - **Solução aplicada:** introduzidos `user3Id` para evento 2 e `p1HistoricalId` (`finished`) para `user1Id`; adotada exatamente a ordem de escrita de [staff-entry-call.service.ts](../backend/src/participations/staff-entry-call.service.ts) (`external_entry_calls` primeiro com `resolution_reason` real, seguido de `participations` copiando `c.resolved_at`); encapsulados os cenários em `withScenario` (`SAVEPOINT` + `SET CONSTRAINTS ALL DEFERRED` → transições → `SET CONSTRAINTS ALL IMMEDIATE` → `ROLLBACK TO SAVEPOINT` + `DEFERRED`); adicionados encerramentos controlado e imediato preservando migration `0008`, guards do ambiente e rollback integral.
  - **Arquivos modificados:** [staff03-external-call-projection.integration.test.ts](../backend/test/integration/staff03-external-call-projection.integration.test.ts).
  - **Testes preparados:** 11 cenários físicos SQL/projeção/triggers da migration `0008` (claramente distinguidos dos testes HTTP de controller).
  - **Verificação realizada:** revisão estática integral contra `0008_external_entry_calls.sql`, `participations.schema.ts` e `staff-entry-call.service.ts`.
  - **Limitações / pendências:** execução PostgreSQL bloqueada até autorização explícita do responsável com GPT-6 Luna — Medium em `arenago_staff_homolog_20261111`.

- **`STAFF03-AUD-07` (P1 — Tipagem e isolamento das fixtures HTTP):**
  - **Causa confirmada:** fixture `value` em [participation-lifecycle-http.test.ts](../backend/test/unit/participation-lifecycle-http.test.ts) omitia `externalEntryCall: null` frente a `LifecycleResult` / `ParticipationView`, e o teste HTTP de isolamento reutilizava um único `userId` e um booleano `found`.
  - **Solução aplicada:** `value` tipada explicitamente como `ParticipationView` com `externalEntryCall: null`; replay histórico sem `externalEntryCall` validado e coberto em [participation-lifecycle.test.ts](../backend/test/unit/participation-lifecycle.test.ts) (normalizado via `.default(null)`); guarda `participationNoStoreGuard` aplicada no [participation-lifecycle.controller.ts](../backend/src/participations/participation-lifecycle.controller.ts) emitindo `Cache-Control: no-store` em sucesso e erro (`401`/`404`/`409`/`500`); teste HTTP reestruturado com dois titulares distintos (`uid` e `uidB` via `participant-b`), mapa real de titularidade `recordsByUser`, verificação de `?userId=`, `404` neutro, `401` revogado e ausência de vazamento de campos de Staff.
  - **Arquivos modificados:** [participation-lifecycle.controller.ts](../backend/src/participations/participation-lifecycle.controller.ts), [participation-lifecycle.dto.ts](../backend/src/participations/participation-lifecycle.dto.ts), [participation-lifecycle-http.test.ts](../backend/test/unit/participation-lifecycle-http.test.ts), [participation-lifecycle.test.ts](../backend/test/unit/participation-lifecycle.test.ts).
  - **Testes preparados:** `STAFF03-AUD-07` replay histórico em `participation-lifecycle.test.ts` e isolamento HTTP entre titulares A e B + `no-store` em `participation-lifecycle-http.test.ts`.
  - **Verificação realizada:** revisão estática de todos os consumidores de `ParticipationView`, `FinishedParticipationView`, `LifecycleResult` e `participationView`.
  - **Limitações / pendências:** execução de `npm run typecheck:test`, `npm run lint`, `npm run build` e `npm test` com GPT-6 Luna — Medium.

- **25/11/2026 (Rodada 1 concluída para nova auditoria):** Todas as correções dos sete achados aplicadas, documentação atualizada e evidência acumulada [STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) regenerada a partir de `efe21a8492a056d08a8c61799f7a66636c830a63`. Aguardando publicação por Kaled, nova auditoria independente e execução da campanha automatizada por **GPT-6 Luna — Medium**.
