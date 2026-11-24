# ArenaGo — STAFF-03 | Controle de Entrada e Integração da Chamada Externa

## 1. Objetivo e Escopo da STAFF-03

- **Projeto:** ArenaGo — ProgramacaoMobile (`JaviDansen/ArenaGo`)
- **Task:** STAFF-03 — Controle de Entrada e Integração da Chamada Externa
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base de referência (`HEAD`):** `efe21a8492a056d08a8c61799f7a66636c830a63` (`docs(staff): registra encerramento formal da STAFF-02`)
- **Status atual:** Implementação e suíte de testes preparadas na branch `feature/staff-operacional-v2` (base `efe21a8492a056d08a8c61799f7a66636c830a63`). Pendentes: execução automatizada com **GPT-6 Luna — Medium** conforme [AGENTS.md](../AGENTS.md), integração visual no app do Participante pelo Heliom, homologação no Expo Go e revisão formal do responsável.

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
1. **Exibição da mensagem obrigatória:** apresentar **“É sua vez! Dirija-se ao Controle de Entrada.”** somente quando:
   - `participation?.status === 'waiting'` **e**
   - `participation?.externalEntryCall?.kind === 'external_entry'` **e**
   - `participation?.externalEntryCall?.status === 'pending'` **e**
   - `participation.externalEntryCall.participationId === participation.id` **e**
   - `participation.externalEntryCall.eventId === participation.eventId`.
2. **Semântica de `callId` (chave estável e deduplicação de alertas):**
   - Utilizar `callId` em chave isolada por sessão/participação (ex.: `${userId}:${epoch}:external:${participation.id}:${callId}`) para distinguir primeira chamada, re-renderização/polling repetido da mesma chamada (não vibrar de novo), chamada resolvida e **nova chamada após ausência + reinserção** (`callId` diferente).
   - Nunca usar apenas `externalQueue.position === 1` ou booleano local para inferir chamada, nem suprimir futuras chamadas após ausência.
3. **Diferenciação de chamada de estação:**
   - Chamadas externas vêm em `participation.externalEntryCall` com `kind: 'external_entry'` (enquanto `participation.status === 'waiting'`).
   - Chamadas de estação pertencem às filas internas de experiências quando `participation.status === 'active'` (`/participations/:participationId/queue`). Os dois avisos são mutuamente exclusivos pelo próprio ciclo de estado.
4. **Reconexão, retorno do segundo plano e erros:**
   - `ParticipationContext` já reexecuta `refresh()` automaticamente ao retomar `AppState === 'active'` e atualiza `participation` em `syncCurrentSilent()` quando `externalEntryCall` muda (`callId`, `status` ou `calledAt`).
   - Ao retomar do segundo plano ou abrir o app com chamada já `pending`, exibir o banner/aviso visual imediatamente, porém respeitar a política de alerta sonoro/vibração sem disparar alerta retroativo indevido (análoga a [queueAlertService.js](../app/services/queueAlertService.js)).
   - Em `401` / `403`, limpar o estado do Participante; em falha de conexão/rede (`syncStale`), preservar o último estado conhecido com sinalização transitória sem fabricar nem cancelar chamada localmente.

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

### 9.2. Validações automatizadas pendentes para **GPT-6 Luna — Medium** (NÃO EXECUTADAS ainda)
Conforme [AGENTS.md](../AGENTS.md), o modelo de implementação **não** executou testes automatizados, lint, typecheck, build ou acesso ao PostgreSQL. Comandos ordenados para execução pelo responsável com **GPT-6 Luna — Medium**:

1. **Testes unitários e de integração simulada do App (`app/`):**
   - `node --test app/tests/participationService.test.cjs app/tests/staffDemoState.test.cjs app/tests/staffEntryControl.test.cjs app/tests/staffEntryControlScreen.test.cjs app/tests/staffRealNavigation.test.cjs app/tests/roleRoutingIntegration.test.cjs`
   - Cobertura completa do app: `node --test app/tests/*.test.cjs`
2. **Testes unitários e HTTP simulados do Backend (`backend/`):**
   - `npm --prefix backend run typecheck:test`
   - `npm --prefix backend run lint`
   - `npm --prefix backend run build`
   - `npm --prefix backend test`
3. **Integração PostgreSQL (SOMENTE com autorização explícita do responsável, `NODE_ENV=test`, migration `0008` aplicada em `127.0.0.1:55432/arenago_staff_homolog_20261111` e três URLs idênticas confirmadas, executando a partir de `backend/`):**
   - `npx tsx --tsconfig tsconfig.test.json --test test/integration/staff03-external-call-projection.integration.test.ts` (exige `STAFF03_POSTGRES_PROJECTION_TEST=authorized-local`)
   - Regressões relacionadas (mesmos critérios de autorização e banco): `test/integration/participations-read.integration.test.ts`, `test/integration/participation-lifecycle.integration.test.ts` e `test/integration/external-entry-calls-schema.integration.test.ts`.

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
7. Repetir fluxo para **Remover da fila** (`status: "canceled"`, `externalEntryCall: null`) e **Desativar / Reativar fila externa** (D06 liberando fila e reativação sem recolocar liberados).
8. Testar reconexão, troca de evento, perda de autorização e visualização em dispositivo menor/fonte ampliada com rolagem nos modais de confirmação.

---

## 13. Histórico de Revisões, Correções e Commits

- **24/11/2026:** Criação inicial do documento `STAFF_03_CONTROLE_ENTRADA_CHAMADA_EXTERNA.md` na branch `feature/staff-operacional-v2` (base `efe21a8492a056d08a8c61799f7a66636c830a63`) antes de qualquer alteração em código, formalizando o contrato da chamada externa para o Heliom e o plano técnico da STAFF-03.
- **24/11/2026:** Conclusão da implementação e cobertura de testes da STAFF-03:
  - Backend: projeção `externalEntryCall` em `ParticipationQueryService` / `participationView` + `@Header("Cache-Control", "no-store")` em `GET /participations/current` e `GET /participations/:participationId`.
  - App Staff & Participante: novo `StaffEntrySections.js`, reformulação visual/funcional de `StaffEntryControlRealScreen.js` e detecção reativa de `externalEntryCall` em `participationService.js`.
  - Testes adicionados em unit/HTTP/simulação e integração PostgreSQL dedicada (`staff03-external-call-projection.integration.test.ts`), além de atualização de `qa-evidence/STAFF-03-changes.diff`. Validação automatizada aguardando execução autorizada com **GPT-6 Luna — Medium**.
