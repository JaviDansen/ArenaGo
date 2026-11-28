# ArenaGo — STAFF-03 | Controle de Entrada e Integração da Chamada Externa

## 1. Objetivo e Escopo da STAFF-03

- **Projeto:** ArenaGo — ProgramacaoMobile (`JaviDansen/ArenaGo`)
- **Task:** STAFF-03 — Controle de Entrada e Integração da Chamada Externa
- **Responsável pela implementação:** Kaled
- **Prioridade:** P0
- **Branch obrigatória:** `feature/staff-operacional-v2`
- **Commit-base de referência (`HEAD` original):** `efe21a8492a056d08a8c61799f7a66636c830a63` (`docs(staff): registra encerramento formal da STAFF-02`)
- **Commits auditados:** `29029f0328ecb02bf6e016abda1b2c4ed371dffe` (Rodada 1) e `330cc28548234072891a4321be27f939ef8ab2eb` (Rodada 2)
- **Status atual (27/11/2026):** campanha automatizada local conjunta STAFF-03/STAFF-04 aprovada conforme resultados finais registrados ao fim deste documento: Backend 1.299/1.299, App 995/995 e QA independente 51/51. Correções de VAL-09/VAL-10 e o bloqueio ambiental ENV-VAL-01 foram revalidados ou superados conforme a atribuição de cada resultado. Homologação Expo, validação PostgreSQL dedicada e aprovação formal permanecem pendentes.

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

### 9.2. Plano original de campanha (historico; resultados atuais na secao Revalidacao conjunta de 27/11/2026)
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

- **25/11/2026 (Rodada 1 concluída para nova auditoria):** Todas as correções dos sete achados aplicadas, documentação atualizada e evidência acumulada [STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) regenerada a partir de `efe21a8492a056d08a8c61799f7a66636c830a63` (publicada no commit `330cc28548234072891a4321be27f939ef8ab2eb`).
- **25/11/2026 (Rodada 2 aberta antes das alterações de código):** Registrado o parecer da segunda auditoria independente (`AUD-01`, `AUD-02`, `AUD-03`, `AUD-04`, `AUD-05` na chamada atual e `AUD-07` considerados corrigidos por inspeção estática; `AUD-06` parcialmente corrigido; novo achado `AUD-08`) e definido o plano pontual de correção antes de editar código.

---

## Auditoria Independente — Rodada 2

Segunda auditoria estática independente realizada sobre o commit `330cc28548234072891a4321be27f939ef8ab2eb` (base acumulada da STAFF-03: `efe21a8492a056d08a8c61799f7a66636c830a63`).

### Parecer da segunda auditoria

| Achado | Parecer da Rodada 2 |
|---|---|
| `STAFF03-AUD-01` | Corrigido (preservar integralmente) |
| `STAFF03-AUD-02` | Corrigido (preservar integralmente) |
| `STAFF03-AUD-03` | Corrigido (preservar integralmente) |
| `STAFF03-AUD-04` | Corrigido com justificativa técnica aceita (manter polling ativo durante modais com invalidação automática) |
| `STAFF03-AUD-05` | Corrigido na chamada atual (preservar integralmente) |
| `STAFF03-AUD-06` | Parcialmente corrigido — 3 pendências pontuais na fixture PostgreSQL |
| `STAFF03-AUD-07` | Corrigido (preservar integralmente) |
| `STAFF03-AUD-08` | Novo achado P2 — mensagem contraditória no `EntrySummaryCard` quando `canManage === false` |

### Pendências registradas e plano de correção (Rodada 2)

| Achado | Prioridade | Causa técnica confirmada | Plano de correção |
|---|---|---|---|
| `STAFF03-AUD-06.1` | P1 | Em [staff03-external-call-projection.integration.test.ts](../backend/test/integration/staff03-external-call-projection.integration.test.ts), `projectCurrent(user1Id)` e `projectById(user1Id, p1Id)` rodavam separadamente usando `clock_timestamp()` distinto para `externalQueue.observedAt`, tornando `assert.deepEqual(calledCurrent, calledDetail)` suscetível a falha por microssegundos. | Capturar um único instante `observedRef` no PostgreSQL e passá-lo pelo parâmetro `at` de `participationProjection()` nas duas consultas comparadas, além de conferir separadamente que a consulta padrão (sem `at` fixo) emite `observedAt` com 6 casas de microssegundos e os mesmos dados da chamada. |
| `STAFF03-AUD-06.2` | P1 | No cenário `sp_absent_requeue`, `p1Id` era chamado novamente enquanto `p2Id` permanecia na posição 1, e `external_last_order` do evento (`10`) ficava incoerente com as ordens atribuídas (`1`, `2`, `3`). | Alinhar `external_last_order` inicial com as filas criadas (`2` no evento 1 e `1` no evento 2); incrementar `external_last_order` ao reinserir `p1Id` no fim da fila (`position: 2`); resolver legitimamente `p2Id` (chamada `callBId` + confirmação para `active`); confirmar que `p1Id` voltou à posição `1`; então criar `call2Id !== call1Id` respeitando a ordem FIFO real e mantendo `call1Id` em `absent`. |
| `STAFF03-AUD-06.3` | P1 | O cenário `sp_absent_cutoff` marcava `external_absence_after_entry_cutoff` sem configurar `official_ends_at` anterior a `resolved_at` e anterior a `operational_deadline_at`. | Configurar dentro do savepoint `official_ends_at = called_at + 1s`, `operational_deadline_at = called_at + 30m` e `resolved_at = called_at + 5m` (respeitando `ck_events_time` e `ck_external_calls_resolution`), provando `starts_at <= called_at < official_ends_at <= resolved_at < operational_deadline_at`, projetando antes de `operational_deadline_at` sem reinserção e documentando explicitamente que o teste SQL valida projeção/integridade física do estado persistido (enquanto a decisão temporal do serviço é validada nos unitários de `StaffEntryCallService`). Também padronizar D06 e encerramentos controlado/imediato para atualizar toda a espera do evento e usar um único `clock_timestamp()` no encerramento controlado. |
| `STAFF03-AUD-08` | P2 | `EntrySummaryCard` em [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js) exibia *"O evento não permite entradas ou alterações da fila neste momento."* para `!canManage`, contradizendo a janela residual em que `canMarkAbsent` e `canRemove` continuam autorizados no card da chamada atual. | Substituir por mensagem coerente com o significado real de `canManage` (*"O ingresso de novos participantes e alterações da fila externa estão indisponíveis. As ações sobre chamadas pendentes dependem das permissões atuais."*) e ampliar [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) para validar ausência de contradição entre resumo e card da chamada nos 5 cenários exigidos. |

### Registro detalhado pós-correção (Rodada 2)

- **`STAFF03-AUD-06.1` (Comparação temporal determinística):**
  - **Solução aplicada:** adicionado helper `captureObservedInstant()` em [staff03-external-call-projection.integration.test.ts](../backend/test/integration/staff03-external-call-projection.integration.test.ts) para reutilizar um único instante `at` via `participationProjection()` ao comparar `projectCurrent` e `projectById` (nos blocos inicial, chamada 1 e chamada 2), mantendo também uma leitura adicional no caminho padrão de produção (`clock_timestamp()`) verificando formato de microssegundos e igualdade dos campos determinísticos de `externalEntryCall` sem comparar `observedAt` entre execuções distintas.
  - **Verificação realizada:** revisão estática de todos os `assert.deepEqual` da suíte (nenhuma comparação instável remanescente).
- **`STAFF03-AUD-06.2` (Nova chamada em ordem FIFO legítima e `external_last_order` coerente):**
  - **Solução aplicada:** alinhados os valores iniciais de `external_last_order` (`2` no evento 1 e `1` no evento 2); no cenário `sp_absent_requeue`, `p1Id` é reinserido incrementando `external_last_order` para `3` (`position: 2`), `p2Id` assume legitimamente a posição `1`, passa por chamada (`callBId`) + confirmação para `active`, devolvendo `p1Id` legitimamente à posição `1`, e só então `call2Id !== call1Id` é criada mantendo `call1Id` em `absent`.
  - **Verificação realizada:** conferência estática da ordem de atualização e de `uq_external_calls_pending_*`, `check_external_call_integrity` e `observer` cobrindo `[call1Id, callBId, call2Id]`.
- **`STAFF03-AUD-06.3` (Cenário temporal após o corte oficial e antes do prazo operacional):**
  - **Solução aplicada:** em `sp_absent_cutoff`, a janela do evento é ancorada deterministicamente em `call1.called_at` (`official_ends_at = called_at + 1s`, `operational_deadline_at = called_at + 30m`, `resolved_at = called_at + 5m`), respeitando integralmente `ck_events_time` e `ck_external_calls_resolution`, verificando em SQL `starts_at <= called_at < official_ends_at <= resolved_at < operational_deadline_at`, ausência de incremento em `external_last_order` (`'2'`), projeção terminal de `user1Id` e permanência de `user2Id` em `waiting` na janela residual. Documentado explicitamente no teste e nesta seção que o cenário SQL valida projeção e integridade do estado persistido no PostgreSQL, enquanto a decisão temporal do serviço (`requeued: false`) é validada em [staff-entry-call.test.ts](../backend/test/unit/staff-entry-call.test.ts).
  - **Conferência adicional (AUD-06.4):** D06 (`sp_d06`) e encerramentos controlado/imediato (`sp_controlled_closure`, `sp_immediate_closure`) atualizados para cobrir toda a fila `waiting` do evento (`user1Id` e `user2Id`) com `WITH now_at AS (SELECT clock_timestamp() AS at)` garantindo instante único também no encerramento controlado.
- **`STAFF03-AUD-08` (Mensagem contraditória no resumo operacional):**
  - **Solução aplicada:** `EntrySummaryCard` em [StaffEntrySections.js](../app/screens/staff/components/StaffEntrySections.js) passou a exibir *"O ingresso de novos participantes e alterações da fila externa estão indisponíveis. As ações sobre chamadas pendentes dependem das permissões atuais."* quando `!canManage`, eliminando contradição com `EntryCurrentCallCard` na janela residual sem presumir corte oficial nem alterar permissões do backend.
  - **Testes atualizados:** [staffEntryControlScreen.test.cjs](../app/tests/staffEntryControlScreen.test.cjs) atualizado (`STAFF03-AUD-05 + STAFF03-AUD-08`) cobrindo operação normal, janela residual, todas as ações bloqueadas, dados desatualizados (`stale`), fila inativa e indisponibilidade operacional (`503`), validando explicitamente a ausência da redação contraditória anterior.
- **Verificações estáticas e limitações remanescentes:** executadas apenas verificações estáticas permitidas pelo [AGENTS.md](../AGENTS.md) (`git diff --check`, `git apply --stat`, `git apply --check --reverse`, `node --check` nos `.cjs`, conferência de links relativos e ausência de auto-referência no patch). Nenhuma suíte automatizada (`node --test`, `npm test`, `typecheck`, `lint`, `build`, `qa/regression` ou PostgreSQL) foi executada nesta rodada; campanha completa pendente com **GPT-6 Luna — Medium** e posterior homologação no Expo Go.
- **25/11/2026 (Rodada 2 concluída para nova auditoria):** Correções de `STAFF03-AUD-06` e `STAFF03-AUD-08` aplicadas sem reabrir os seis achados aprovados na Rodada 1; [STAFF-03-changes.diff](../qa-evidence/STAFF-03-changes.diff) regenerado desde `efe21a8492a056d08a8c61799f7a66636c830a63`. Aguardando publicação por Kaled e nova auditoria independente.

## Campanha de Validação Automatizada Conjunta — STAFF-03 + STAFF-04

**Execução parcial — 27/11/2026 — GPT-6 Luna Medium.** O HEAD validado foi `9ee8789fdf22fd38b4f1d8303d2012706b4586d4` na branch `feature/staff-operacional-v2`.

O cenário `STAFF04-AUD-06 + AUD-04 (integrado)` falhou duas vezes antes da correção textual. A primeira execução isolada (0 aprovados, 1 falho) revelou que a fixture capturava `slowPhase` antes da Promise pendente ser resolvida. O resolvedor foi alterado para receber explicitamente `closing`; a asserção permaneceu forte, mas inicialmente esperava o texto incorreto `Status: Encerrando`. Após inspeção do `STATUS_LABELS`, a expectativa foi corrigida para `Status: Em encerramento`, com verificação inicial de `Status: Aberto`.

A revalidação isolada passou: 1 aprovado, 0 falhos, 0 ignorados ou cancelados, código 0. A suíte integral `roleRoutingIntegration.test.cjs` terminou sem travar, com 63 aprovados, 1 falho, 0 ignorados e 0 cancelados, código 1 (42.944 ms). A falha remanescente é em `STAFF04-AUD-01/02/04/05`, linha 4178: o teste esperava encontrar o botão `Cancelar` depois de abrir o modal de conclusão, mas o harness encontrou zero botões. Classificação inicial: fixture ou contrato visual do modal, ainda não determinada. A campanha foi interrompida conforme o critério de falha; backend, demais suítes focadas e regressões completas não foram executados.

PostgreSQL/Neon, migrations, seeds e homologação Expo não foram executados. STAFF-03 e STAFF-04 permanecem sem parecer de aprovação automatizada conjunta e sem aprovação formal nesta campanha.

### Retomada da campanha conjunta — 27/11/2026

Após a correção `STAFF04-VAL-02`, o teste isolado do cancelamento do modal passou (1/1, código 0). A suíte completa `roleRoutingIntegration.test.cjs` também passou integralmente: 64 aprovados, zero falhas, ignorados ou cancelados, código 0 (33.458 ms).

Na retomada das demais suítes focadas, `staffPolling.test.cjs` passou com 6/6 (código 0). A suíte seguinte, `staffEventDiscovery.test.cjs`, falhou com 13 aprovados e 1 falho, zero ignorados/cancelados, código 1 (2.551 ms). A falha é `STAFF04-AUD-02`, linha 1396: após a fixture receber 403 no polling de eventos e o teste confirmar a limpeza de experiências, estações e Controle de Entrada, `latestEventsPolling()?.enabled` continuou `true` quando se esperava `false`. Diagnóstico inicial inconclusivo entre comportamento do hook/polling e sincronização da fixture; nenhuma correção foi aplicada. As demais suítes focadas e todas as validações de backend/regressão permanecem pendentes por interrupção no primeiro erro.

### Retomada da campanha conjunta — STAFF04-VAL-03

O harness `createStaffUiHarness` agora mantém `pollingRegistrations` como histórico e um mapa separado de registros ativos associados a instâncias React via `useRef`/`useEffect`; o cleanup remove cada registro ativo no unmount ou na troca de configuração. Os helpers de polling atual consultam registros ativos, priorizando o escopo `:events:` do evento selecionado. O teste STAFF04-AUD-02 confirma um único polling atual habilitado no Painel antes do 403 e ausência de registros acionáveis após o bloqueio/desmontagem.

Revalidações: cenário isolado STAFF04-AUD-02, 1/1 aprovado; `staffEventDiscovery.test.cjs`, 14/14; `staffDashboard.test.cjs`, 25/25. A suíte `staffOperationsService.integration.test.cjs` retornou código 1, com 68 aprovados, 1 falho e nenhum ignorado/cancelado. O caso `STAFF04-AUD-04 (coordenador)` falhou na linha 1114: esperava `['post:401', 'onAuthError:session', 'recordTerminal:start']`, mas recebeu `[]`. A campanha foi interrompida; esta falha ainda requer diagnóstico e nenhuma alteração foi aplicada a ela. Entry Control, telas, Estação, navegação, background, demo, participação, backend e regressões completas seguem pendentes.

### Retomada da campanha conjunta — STAFF04-VAL-04

**Correção da sincronização:** o teste `STAFF04-AUD-04 (coordenador)` passou a aguardar sinais explícitos de início de `recordTerminal()`, `clear()`, `reserve()` e `dispatch()`, com timeout diagnóstico limitado e liberação dos gates em `finally`. Isso preserva as verificações intermediárias da ordem entre POST, `onAuthError`, gravação do recibo e limpeza. A hipótese para a falha anterior foi confirmada pela aprovação do cenário isolado e da suíte completa após a troca das esperas arbitrárias.

**Resultados desta retomada:** teste isolado STAFF04-AUD-04: 1 aprovado, 0 falhos, 0 ignorados/cancelados, código 0 (627 ms). `staffOperationsService.integration.test.cjs`: 69 aprovados, 0 falhos, 0 ignorados/cancelados, código 0 (1.607 ms). `staffEntryControl.test.cjs`: 35 aprovados, 1 falho, 0 ignorados/cancelados, código 1 (906 ms). A campanha foi interrompida nessa primeira falha posterior.

**Diagnóstico da falha seguinte:** `STAFF04-AUD-04` em `staffEntryControl.test.cjs:536` recebeu `blocked` em vez de `rejected`/404. A fixture `stateWithCall` mantém a participação `id(4)` na lista `waiting` herdada de `body()` e também a coloca em `pendingCall`. O parser real rejeita esse estado inconsistente (participação duplicada entre chamada pendente e fila), então o store não fica pronto para mutação e retorna `blocked`. Diagnóstico estático aponta fixture incompatível com o contrato; nenhuma alteração foi feita nessa suíte ou em produção. As demais suítes focadas, backend e regressões App/QA não foram executadas.
### Retomada da campanha conjunta — STAFF04-VAL-05

A fixture do teste STAFF04-AUD-04 de recusa 404 foi corrigida exclusivamente em `app/tests/staffEntryControl.test.cjs`: a chamada pendente agora não duplica a participante na fila, com `waitingCount`/FIFO coerentes; foi acrescentada cobertura explícita para rejeitar a duplicidade no parser. O código HTTP e `RESOURCE_NOT_FOUND` são conferidos no resultado e no recibo terminal persistido; o teste usa chaves sequenciais distintas (`id(30)`, `id(31)` e `id(32)`) e controla o GET de revalidação efetivamente acionado após cada POST para os resultados 200, 403 e 404.

Resultados desta retomada: o cenário isolado passou 1/1 (código 0; 528 ms) e `staffEntryControl.test.cjs` passou 36/36 (código 0; 1.152 ms). A suíte seguinte, `staffEntryControlScreen.test.cjs`, falhou com 10 aprovados, 3 falhos, zero ignorados/cancelados, código 1 (4.221 ms). Falhas: (1) linha 1004 espera trecho de acesso ao evento, mas `describeStationFeedback()` retorna texto específico de indisponibilidade da operação; (2) linha 1152 e (3) linha 1324 tentam resolver `postDeferred` após `onPost` já capturar o deferred e definir a variável compartilhada como `null`. Diagnóstico estático aponta expectativa incompatível e sincronização/fixture dos testes, respectivamente. Nenhuma alteração foi feita em `staffEntryControlScreen.test.cjs` ou produção. A campanha foi interrompida: `staffStationOperational`, `staffRealNavigation`, `staffBackground`, `staffDemoState`, `participationService`, backend e regressões completas seguem pendentes.
### Retomada da campanha conjunta — STAFF04-VAL-06

Em `app/tests/staffEntryControlScreen.test.cjs`, as expectativas de pré-condição 401/403/404/409 foram alinhadas às mensagens e ao tom `warning` de `StaffSyncFeedback`, mantendo separados os textos de recusa de mutação. Os cenários de ausência e confirmação usam referências estáveis aos deferreds de POST, sinais de início com timeout e gates liberados no `finally`; operações pendentes são aguardadas e os renderers alterados são desmontados dentro de `act()`.

O filtro efetivamente selecionou os três testes solicitados. Primeira execução: `StaffSyncFeedback` e recuperação do Controle de Entrada passaram; STAFF04-AUD-03 falhou inicialmente por timeout esperando o início do reconhecimento. Após separar a resolução do POST da espera pelo efeito de reconhecimento, a segunda execução passou os mesmos dois primeiros cenários, mas STAFF04-AUD-03 avançou e falhou em `staffEntryControlScreen.test.cjs:1434`: a mensagem de erro de armazenamento esperada não estava presente após a falha de persistência simulada. A suíte completa terminou com 12 aprovados e 1 falho, código 1, 3.913 ms, na mesma asserção. Avisos React de updates fora de `act()` e depreciação de `react-test-renderer` persistiram na suíte.

As suítes restantes foram consolidadas mesmo com essa falha. `staffStationOperational.test.cjs` não finalizou em 30 s; o processo foi encerrado após observar 5 aprovações e 3 falhas (sem resumo final/exit code). A execução ficou sem saída após STAFF04-AUD-04/AUD-07; o próximo caso declarado é AUD-08. A execução diagnóstica isolada dos três testes já marcados falhos confirmou: `STAFF-04 tela Estação` falha com `postDeferred` nulo em `staffStationOperational.test.cjs:869`; `STAFF04-AUD-01` espera o botão acessível `Cancelar`, que não foi encontrado (`:1030`); `STAFF04-AUD-03` falha com `postDeferred` nulo (`:1149`). A inspeção de `StaffStationSections.js` encontrou o rótulo real `CANCELAR OPERAÇÃO`. O provável cenário do travamento é o primeiro caso AUD-08, que aguarda a chamada enquanto o GET de `/stations` permanece pendente; causa do travamento não confirmada.

As demais suítes restantes passaram: `staffRealNavigation` 2/2, `staffBackground` 1/1, `staffDemoState` 22/22 e `participationService` 13/13 (todas código 0, sem ignorados/cancelados). Não foram executados backend, regressão completa App ou QA independente devido às falhas focadas. STAFF-03/04 permanecem sem aprovação formal ou homologação.

### Implementação final e preparação pré-merge — 27/11/2026

**Somente implementação e inspeção estática, sem execução de validações.** Referência: `9ee8789fdf22fd38b4f1d8303d2012706b4586d4`. Resultados anteriores preservados (275/276 focados); não validam estas mudanças.

**STAFF03-VAL-01:** removido `ConstructorParameters<typeof drizzle>`, incorreto para uma função. A chamada agora é `drizzle(client, { schema })`; o driver instalado declara NodePgClient como união incluindo pg.Client. Mantida a mesma conexão transacional, sem pool substituto, preservando BEGIN/ROLLBACK, savepoints, observer, relógio, guards e projeções. Evidência complementar `qa-evidence/STAFF-03-typecheck-fix.diff` desde o HEAD de referência. O patch histórico original STAFF-03 não foi regenerado. Typecheck e PostgreSQL não executados.

**STAFF04-VAL-09:** renderização passa a preservar o aviso da tentativa anterior usando feedback storage existente, mesmo após storageError recuperar; sem mudança de store, formato, permissões ou idempotência. Aviso de disponibilidade atual e aviso histórico são distinguíveis; knownOutcome mantém feedback específico e autorização tem prioridade. Refresh/polling preservam histórico; nova operação válida/resolução local verificada/troca de contexto limpam ou substituem. Testes preparados de reserve/dispatch antes/depois de escrita, sem POST/PATCH, persistência do aviso, bloqueio conservador, nova chave e troca de sessão; a asserção originalmente falha foi mantida. Não executados. Detalhamento e matriz A–I no documento STAFF-04.

**PREMERGE-VAL-01:** correções mínimas nos três arquivos reportados: predicado por caracteres substitui regex de controles mantendo normalização, limites e surrogates inválidos; fixtures usam createRequire(__filename) para os mesmos módulos CommonJS, mantendo os exports dinâmicos existentes e guards dos scripts intactos. Evidência separada `qa-evidence/PREMERGE-VAL-01-changes.diff`; não misturada ao patch funcional STAFF-04. Lint não executado.

**ENV-VAL-01:** log anterior aponta os.userInfo chamado pelo tsx na escolha do temp no Windows, antes de qualquer teste. Node 24.15.0 do log atende engines >=24.15.0. Não concluir falta de memória física a partir de ENOMEM. Preparado plano para Luna conferir versão, chamadas os.userInfo/os.tmpdir com saída sanitizada, diretório temporário e permissão de escrita em arquivo exclusivo, presença (sem valores) das variáveis relevantes, recursos e inicialização do tsx. Nenhuma instalação ou configuração permanente alterada.

**Estação, cobertura complementar:** preparado teste de troca de estação durante POST não-auth, verificando ausência de busy herdado, intenção original protegida e callbacks tardios. Inspeção identificou que refresh espalha previous sem limpar busy/busyKind para novo contexto e retorno antigo é descartado; potencial trava permanece sem correção de produção nesta rodada. Proposta mínima: limpar busy/busyKind apenas na nova visita/contexto sem liberar a intenção persistida. AUD-09 passou a verificar o texto real de recusa com reconhecimento local pendente. Nova campanha deve começar por essa reprodução e por VAL-09; não presumir os totais anteriores.

Plano registrado antes da campanha desta rodada: filtros VAL-09/VAL-10, suites afetadas, backend e regressao condicionada a ausencia de bloqueios. A execucao e os bloqueios atuais estao registrados na secao Revalidacao conjunta de 27/11/2026 abaixo.

Inspeções estáticas realizadas: sintaxe CJS/JSX dos arquivos alterados, `git diff --check -- app backend docs`, leitura dos contratos instalados e dos diffs; três evidências passaram em `git apply --stat` e `git apply --reverse --check`. Patch histórico STAFF-03 idêntico ao HEAD (SHA-256 `9CB0BEE61A0CC5037A4F793E7E3FEECC13EE58EE2C72C2F9E5EB74E6B598B183`). Nenhuma aprovação automatizada foi inferida dessas inspeções. Avisos Git LF/CRLF permanecem não bloqueantes.

### Escopo da rodada final de implementação — 27/11/2026

Rodada aberta antes da implementação: corrigir o feedback histórico de armazenamento (STAFF04-VAL-09), corrigir a tipagem transacional do teste SQL (STAFF03-VAL-01), aplicar ajustes mínimos de lint nos três arquivos reportados (PREMERGE-VAL-01) e preparar diagnóstico de infraestrutura (ENV-VAL-01). Preservar VAL-01 a VAL-08. Somente implementação e inspeção estática; testes, lint, typecheck, build e banco não serão executados nesta rodada. As evidências complementares de STAFF-03 e pré-merge serão separadas do patch STAFF-04.

### STAFF04-VAL-07/08/09 — Retomada em 27/11/2026

VAL-07 corrigiu apenas as fixtures da Estação: referências estáveis para gates de POST e estações, sinais explícitos de início, e cancelamento acessível com CANCELAR OPERAÇÃO. O modal permanece montado e muda visible de true para false; polling e ausência de mutação no cancelamento continuam cobertos.

VAL-08 alterou a sincronização do AUD-08. O teste sinaliza o início de /queue, /stations e do GET operacional após 503, mantém esse GET pendente enquanto o 403 revoga acesso e remove os dados, e só então resolve a resposta 200 atrasada. O cenário paralelo de 401 com a consulta irmã pendente também passou. A sequência anterior era suscetível a espera circular; a correção impediu que o teste aguardasse pCall antes de liberar a leitura de que pCall dependia.

VAL-09 permanece aberta. A falha focada de staffEntryControlScreen.test.cjs:1434 reproduziu: 0 aprovados, 1 falho, código 1. O mutate retornou storage_error e o aviso não estava renderizado após refresh. A instrumentação temporária foi removida. O gate de SecureStore rejeitou antes de gravar a nova reserva; a intenção antiga acknowledged permaneceu, e não houve POST/PATCH durante a tentativa que falhou. O refresh GET/SecureStore foi bem-sucedido, deixou storageError false e feedback storage; a tela renderiza o aviso somente sob storageError. Uma nova reserva pode ser tentada após revalidação GET 200, leitura local bem-sucedida, ausência de intenção ativa e contexto autenticado atual. Isso não se aplica a falhas após despacho ou resultado incerto.

A proposta para futura correção, ainda não autorizada, é manter um aviso de falha anterior separado do indicador atual de disponibilidade do SecureStore. O aviso não deve, sozinho, bloquear nova tentativa quando a revalidação comprovar que ela é segura. Intenções, recibos e knownOutcome devem permanecer preservados; não limpar dados automaticamente.

Resultados desta rodada: os três cenários anteriormente falhos da Estação passaram (3/3, código 0, 1.501 ms); AUD-08 isolado 1/1 (1.146 ms); AUD-09 1/1 (1.710 ms); AUD-10 1/1 (851 ms); a suíte staffStationOperational.test.cjs passou 11/11 (0 falhas, ignorados ou cancelados, código 0, 5.880 ms). Os runners emitiram apenas o aviso não bloqueante de depreciação de react-test-renderer.

As 12 suítes focadas ficam registradas assim: roleRoutingIntegration 64/64; staffPolling 6/6; staffEventDiscovery 14/14; staffDashboard 25/25; staffOperationsService.integration 69/69; staffEntryControl 36/36; staffEntryControlScreen 12/13 na execução completa anterior e 0/1 na revalidação direcionada desta rodada; staffStationOperational 11/11 nesta rodada; staffRealNavigation 2/2; staffBackground 1/1; staffDemoState 22/22; participationService 13/13. Exceto Estação e o teste direcionado de Controle de Entrada, os resultados são anteriores e não foram repetidos.

Validações backend autorizadas: typecheck:test falhou com código 2, TS2344 em test/integration/staff03-external-call-projection.integration.test.ts:67 (typeof drizzle não satisfaz a restrição de construtor); lint falhou com código 1 em src/events/admin-configuration.dto.ts:51 (no-control-regex) e em test/unit/staff-a4-homolog-fixture.test.ts:4 e test/unit/staff-homolog-fixture.test.ts:4 (no-require-imports); build passou com código 0; npm test terminou com código 1 antes de iniciar os unitários por uv_os_get_passwd returned ENOMEM em node:os.userInfo chamado pelo tsx.

As regressões completas do App e QA seguem suspensas enquanto VAL-09 falhar. Nenhum PostgreSQL/Neon, test:integration, migration ou seed foi executado. Não houve homologação nem aprovação formal de STAFF-03/04.


## Revalidacao conjunta de 27/11/2026: resultados atuais

Execucao autorizada por GPT-6 Luna Medium, Node v24.15.0 e NODE_ENV=test. Resultados antigos, inclusive 275/276, sao historicos e nao validam esta rodada.

- **STAFF04-VAL-09, store:** filtro de persistencia reserved/dispatching e recibo: 6 aprovados, 0 falhos/ignorados/cancelados, exit 0, 897 ms.
- **STAFF04-VAL-09, tela:** filtro dos quatro casos novos mais AUD-03: 5 aprovados, 0 falhos/ignorados/cancelados, exit 0, 2.211 ms. Suite staffEntryControl completa: 36/36, exit 0, 1.099 ms; staffEntryControlScreen: 17/17, exit 0, 6.191 ms.
- **STAFF04-VAL-10 / Estacao:** teste isolado: 0 aprovados, 1 falho, exit 1, 1.228 ms. O POST controlado foi alcancado e a intencao persistida estava em dispatching. Apos trocar ST_1 por ST_2, a fila B aparece, mas permanece Processando operacao no servidor... (app/tests/staffStationOperational.test.cjs:2039). Suite completa: 11 aprovados, 1 falho, exit 1, 7.292 ms, na mesma assercao. Hipotese de heranca de busy/busyKind confirmada. As verificacoes seguintes de intencao bloqueante, zero POST extra e descarte do retorno tardio nao foram alcancadas. A leitura estatica de refresh, que preserva estado anterior ao trocar scope, e consistente com defeito de producao. Nenhuma correcao foi aplicada. Correcao recomendada: limpar busy/busyKind apenas na troca de contexto/visita, preservando intencao e guards.
- **STAFF03-VAL-01 e PREMERGE-VAL-01:** backend typecheck:test, lint e build passaram, exit 0 (9.779 ms, 6.856 ms, 9.532 ms). Typecheck incluiu tipos do teste PostgreSQL sem executa-lo; lint nao reportou os tres achados; nenhuma conexao a banco ocorreu.
- **ENV-VAL-01 / unitarios backend:** npm test falhou antes de iniciar testes: 0 casos coletados, exit 1, 662 ms. os.userInfo() e tsx --version reproduziram ERR_SYSTEM_ERROR/uv_os_get_passwd returned ENOMEM; os.tmpdir() e escrita/remocao de arquivo temporario exclusivo passaram. TEMP/TMP/USERPROFILE presentes, NODE_OPTIONS ausente. Sem evidencia de falta de memoria fisica; nenhuma dependencia/configuracao foi alterada.
- Regressao completa App e QA nao executadas porque VAL-10 falhou. Avisos: depreciacao react-test-renderer e atualizacoes React fora de act() na suite de tela; nao impediram 17/17.
- Nenhum PostgreSQL/Neon, test:integration, migration, seed ou operacao Git de publicacao foi executado. STAFF-03/04 nao estao homologadas nem formalmente aprovadas.

### STAFF04-VAL-10 — atualização de implementação em 27/11/2026

A falha reproduzida de busy herdado na troca de estação foi corrigida localmente no ciclo de vida da visita da Estação. O novo contexto inicia sem busy/busyKind, dados, pending em memória, feedback ou modal da visita anterior e relê o armazenamento existente; não há remoção de intenções persistidas. Refresh no mesmo contexto preserva o processamento. Acrescentadas guards de visita ao catch de refresh e ao retorno de cancelamento para impedir que callbacks de uma visita anterior afetem o retorno à mesma estação. Dispatch, estágios e reconhecimento mantêm suas guards de visita/operação/escopo/autorização.

Dez casos STAFF04-VAL-10 foram preparados na suíte da Estação para resposta definitiva ou incerta tardia, conta/sessão, nova operação legítima B após término da mutação A no coordenador, refresh no mesmo contexto e 401/403 após retorno à mesma estação. A asserção originalmente falha foi mantida. Detalhes e próximos comandos no documento STAFF-04.

Nenhum teste, lint, typecheck ou build foi executado nesta implementação. Os resultados anteriores (Entrada 36/36 e tela 17/17; Estação 11/12; backend typecheck/lint/build aprovados) permanecem históricos e não validam a alteração atual. ENV-VAL-01 continua aberto: a inspeção do tsx 4.23.15 mostra que CLI e loader importam o módulo que consulta os.userInfo(); node --import tsx não é um desvio comprovado. Preparado procedimento comparativo Codex/PowerShell normal com o mesmo Node, cwd e NODE_ENV=test, priorizando npm.cmd test oficial onde o ambiente funcionar. Equivalência de resolução/decorators/metadados/preflight do loader não foi declarada. Inventário exato dos unitários está registrado na STAFF-04, sem incluir integrações.

Evidências STAFF-03 histórica, STAFF-03-typecheck-fix e PREMERGE-VAL-01 preservadas; a evidência acumulada STAFF-04 inclui esta documentação e exclui backend e o próprio patch. Homologação Expo, execução PostgreSQL autorizada separadamente e aprovação formal seguem pendentes.

### PREMERGE-VAL-02 — fixture HTTP de avaliação

A fixture fixa o TTL em 60 segundos durante a aplicação Nest e restaura EVALUATION_IDEMPOTENCY_TTL_SECONDS após teardown ou falha de inicialização/fechamento, removendo a variável se estava ausente. As duas asserções originais de expiresAt e os testes de política inválida permanecem intactos. Resultados manuais prévios do responsável e bloqueio ambiental do Codex constam no documento STAFF-04; a correção aguarda revalidação manual.

### Consolidação final da campanha local — 27/11/2026

Resultados de backend e das sete suítes App adicionais foram fornecidos pelo responsável e não devem ser atribuídos à execução do Codex. PREMERGE-VAL-02 passou evaluation-write-http 25/25 tanto com TTL externo original quanto com TTL 120 temporário; typecheck, lint, build e regressão unitária backend 1.299/1.299 passaram. O caso TTL ausente após dotenv não foi exercitado. A regressão App informada foi 995/995 e QA independente 51/51. As 12 suítes focadas totalizaram 290/290 (incluindo as quatro executadas pelo Codex e oito fornecidas pelo responsável); VAL-10 isolada 10/10 é cobertura complementar e não é somada novamente. A falha anterior da suíte experiences-http não se reproduziu e sua causa não foi determinada. A causa específica do ENOMEM no Codex permanece desconhecida; o runner oficial funcionou no PowerShell convencional.

A campanha automatizada local está aprovada com base nos resultados registrados, mas não equivale à homologação Expo ou à aprovação formal. Integração PostgreSQL dedicada ainda depende de autorização explícita e verificações do guard. Homologação Expo e aprovação formal permanecem pendentes.

### Estado individual dos achados — fechamento automatizado de 27/11/2026

Este quadro complementa, sem substituir, os históricos de auditoria, falhas e correções acima. “Sem falha na campanha final” descreve os resultados das suítes finais e não significa que cada achado tenha sido executado isoladamente. Os testes físicos PostgreSQL permanecem fora da campanha.

| Registro | Estado documental após a campanha |
|---|---|
| STAFF03-AUD-01 | Sem falha reportada nas regressões finais de App/Backend; validação física PostgreSQL permanece pendente. |
| STAFF03-AUD-02 | Os sete casos identificados como STAFF-03/AUD-02/AUD-07 passaram conforme informação do responsável; regressões finais App/Backend também aprovadas. |
| STAFF03-AUD-03 | Sem falha reportada nas regressões finais; não foi fornecido resultado isolado por identificador. |
| STAFF03-AUD-04 | Sem falha reportada nas regressões finais; não foi fornecido resultado isolado por identificador. |
| STAFF03-AUD-05 | Sem falha reportada nas regressões finais; não foi fornecido resultado isolado por identificador. |
| STAFF03-AUD-06 | Sem falha reportada nas regressões finais; não foi fornecido resultado isolado por identificador. |
| STAFF03-AUD-07 | Os sete casos identificados como STAFF-03/AUD-02/AUD-07 passaram conforme informação do responsável; regressões finais App/Backend também aprovadas. |
| STAFF03-AUD-08 | Sem falha reportada nas regressões finais; não foi fornecido resultado isolado por identificador. |
| STAFF03-VAL-01 | `typecheck:test`, lint e build aprovados; regressão Backend 1.299/1.299 informada pelo responsável. O teste PostgreSQL incluído para tipagem não foi executado. |
| STAFF04-AUD-01 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-02 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-03 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-04 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-05 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-06 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-07 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-08 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-09 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-AUD-10 | Sem falha reportada na regressão App final; o resultado isolado por achado permanece conforme o histórico. |
| STAFF04-VAL-01 | Correção validada no teste isolado (1/1); não houve falha na regressão App final. |
| STAFF04-VAL-02 | Correção validada isoladamente e na integração completa (64/64); não houve falha na regressão App final. |
| STAFF04-VAL-03 | Cenário isolado, `staffEventDiscovery` (14/14) e `staffDashboard` (25/25) aprovados; regressão App final sem falhas. |
| STAFF04-VAL-04 | Cenário isolado e `staffOperationsService.integration` (69/69) aprovados; regressão App final sem falhas. |
| STAFF04-VAL-05 | Cenário isolado e `staffEntryControl` (36/36) aprovados; regressão App final sem falhas. |
| STAFF04-VAL-06 | Resultados finais das suítes App e regressão sem falhas; detalhes individuais permanecem no histórico. |
| STAFF04-VAL-07 | Resultados finais das suítes App e regressão sem falhas; detalhes individuais permanecem no histórico. |
| STAFF04-VAL-08 | Resultados finais das suítes App e regressão sem falhas; detalhes individuais permanecem no histórico. |
| STAFF04-VAL-09 | `staffEntryControl` (36/36) e `staffEntryControlScreen` (17/17) aprovados, conforme campanha registrada; regressão App final sem falhas. |
| STAFF04-VAL-10 | Isolado 10/10 e `staffStationOperational` 21/21 aprovados, conforme campanha registrada; regressão App final sem falhas. |
| PREMERGE-VAL-01 | Typecheck, lint e build aprovados na campanha Backend final informada pelo responsável. |
| PREMERGE-VAL-02 | `evaluation-write-http` aprovada 25/25 com TTL externo original e 25/25 com TTL temporário de 120s; o cenário de TTL ausente após dotenv não foi executado. |
| ENV-VAL-01 | Bloqueio do runner superado no PowerShell convencional; causa específica do `ENOMEM` dentro do Codex permanece indeterminada. |

Homologação funcional/visual no Expo, integração PostgreSQL autorizada em campanha separada e aprovação formal de STAFF-03/04 continuam pendentes.

### Preflight PostgreSQL dedicado — 27/11/2026 — BLOQUEADO

Inspeção local autorizada, sem conexão PostgreSQL e sem consulta a Neon. Branch/HEAD permaneceram `feature/staff-operacional-v2` / `9ee8789fdf22fd38b4f1d8303d2012706b4586d4`; o índice continuou limpo. O teste, o guard, a migration `backend/drizzle/0008_external_entry_calls.sql`, os documentos das duas tasks e as dependências locais (`tsx`, `pg`, `drizzle-orm`) foram inspecionados. A tipagem local usa `drizzle(client, { schema })`, com o mesmo `Client` usado pelos comandos SQL transacionais.

**Destino e ambiente:** o serviço Windows `postgresql-x64-18` aparece como iniciado, mas não havia listener em `127.0.0.1:55432`. O Docker CLI tentou consultar o daemon, mas não conseguiu acesso; nenhum container foi iniciado. As três variáveis não estavam no ambiente do processo. A inspeção sanitizada do `backend/.env` encontrou apenas `DATABASE_URL` e `DATABASE_DIRECT_URL`; elas apontam para destinos não permitidos, não são iguais e não correspondem ao destino autorizado. `EVENTS_TEST_DATABASE_URL` está ausente. Os valores completos e credenciais não foram exibidos. Nenhuma conexão ou consulta foi tentada. Portanto, identidade efetiva (`current_database()`, porta interna), schema instalado e permissões não puderam ser confirmados.

**Inspeção estática do contrato:** o guard exige `NODE_ENV=test`, a flag `STAFF03_POSTGRES_PROJECTION_TEST=authorized-local`, três URLs válidas e iguais, protocolo PostgreSQL, loopback autorizado, porta efetiva 55432 e caminho `arenago_staff_homolog_20261111`, sem redirecionamento de host/porta/banco. A migration 0008 declara `external_entry_calls`, FKs para `events`, `participations` e `users`, checks de status/resolução, índices únicos parciais por evento e participação pendente, índice de histórico e triggers de imutabilidade, resolução, integridade diferida e bloqueio de `TRUNCATE`. O teste requer também as tabelas `users`, `events`, `user_roles`, `participations` e `audit_logs`. Isso descreve o contrato esperado; a presença e compatibilidade do schema do banco não foram verificadas. Privilégios efetivos de leitura/escrita também permanecem desconhecidos.

**Isolamento da fixture:** os IDs são UUIDs aleatórios. `drizzle(client, { schema })` e as escritas usam a mesma conexão `client`. A fixture abre `BEGIN`, usa savepoints por cenário, alterna `SET CONSTRAINTS ALL DEFERRED/IMMEDIATE`, não contém `COMMIT` e solicita `ROLLBACK` no `finally`; uma segunda conexão confere que os IDs temporários não persistiram. Ambas as conexões são encerradas com `Promise.allSettled`. Limitação: se o próprio `ROLLBACK` falhar, a exceção pode substituir a falha original; o fechamento da conexão deve provocar rollback pelo servidor, mas a confirmação observadora pode não ser alcançada. A conexão observadora e as consultas de catálogo somente poderão ser usadas depois do preflight do destino.

**Bloqueio e retomada:** não configurar automaticamente `.env`, iniciar/reiniciar serviço ou container, nem usar os valores atuais. Para novo preflight, o responsável deve fornecer no processo temporário três URLs das credenciais locais previamente autorizadas, integralmente iguais e destinadas exclusivamente a `127.0.0.1:55432/arenago_staff_homolog_20261111`; então confirmar os campos sem imprimir segredo, identificar o listener dedicado e fazer a conferência SQL estritamente read-only com timeout. Esta etapa não autorizou nem executou o teste transacional. Após novo preflight aprovado, ainda será necessária autorização específica para suas escritas temporárias.

**Comando individual preparado para uma etapa futura autorizada**, executado manualmente pelo responsável em PowerShell convencional a partir de `backend/` (não executado nesta etapa):

```powershell
$previous = @{}
$names = @('NODE_ENV','DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL','STAFF03_POSTGRES_PROJECTION_TEST')
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $env:NODE_ENV = 'test'
  # Definir as três URLs temporárias somente com credenciais locais autorizadas,
  # após validar destino, igualdade e ausência de parâmetros de redirecionamento.
  $env:STAFF03_POSTGRES_PROJECTION_TEST = 'authorized-local'
  .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/integration/staff03-external-call-projection.integration.test.ts
  if ($LASTEXITCODE -ne 0) { throw "Integração terminou com código $LASTEXITCODE" }
} finally {
  foreach ($name in $names) {
    if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
  }
}
```

O script acima é apenas um roteiro; as URLs não foram preenchidas. Antes de executá-lo, deve-se repetir o preflight read-only e obter a autorização separada para a fixture. Capturar saída em arquivo local com acesso restrito, revisar o conteúdo para evitar credenciais antes de compartilhá-lo e registrar o código de saída. Estado final: **BLOQUEADO para o preflight read-only e não autorizado para a execução funcional**.

## Recuperação PostgreSQL e procedimento de migration — revisão de 27/11/2026

### Evidência fornecida pelo responsável e diagnóstico do bloqueio anterior

O responsável informou que recuperou manualmente PostgreSQL 18.6, serviço `postgresql-x64-18`, listener TCP local `127.0.0.1:55432` e acesso administrativo. O banco `arenago_staff_homolog_20261111` estava inexistente na instância consultada; a causa dessa ausência não foi determinada. O responsável o criou com owner `arenago_staff_homolog` e `template0`. A conexão posterior com a role dedicada confirmou, segundo o responsável, `current_database() = arenago_staff_homolog_20261111`, `current_user = arenago_staff_homolog`, endereço `127.0.0.1`, porta 55432 e transação read-only. Esses são resultados fornecidos pelo responsável; não foram reproduzidos pelo Codex.

A primeira tentativa em `qa/regression` retornou `Missing script` e não aplicou migrations. A tentativa seguinte, no diretório `backend/`, terminou em `CHECK_FAILED`, com a mensagem de que migrations não foram executadas. A hipótese apresentada é a comparação de `inet_server_addr()::text` com `127.0.0.1` poder divergir por representação de máscara; `host(inet_server_addr())` é a expressão proposta para obter o endereço sem máscara. O script auxiliar que produziu `CHECK_FAILED` não está versionado no repositório e a mensagem genérica não identifica qual guarda falhou. Portanto, a hipótese é plausível, mas **não confirmada**; a tentativa não comprova falha ou sucesso de conexão, autenticação ou identidade, e nenhuma migration foi aplicada.

### Inspeção estática da configuração oficial

Foram relidos `backend/package.json`, `backend/drizzle.config.ts`, `backend/drizzle/meta/_journal.json` e os arquivos SQL `0001_identity_profile` a `0008_external_entry_calls`. O script `db:migrate` é `drizzle-kit migrate`; a configuração importa `dotenv/config`, prioriza `DATABASE_DIRECT_URL` sobre `DATABASE_URL`, usa `./drizzle` como saída e pode trocar o schema via `DRIZZLE_SCHEMA`. O journal local possui exatamente oito entradas, tags `0001_identity_profile` até `0008_external_entry_calls`; todos os oito arquivos estão presentes. Migrations, configuração e `package.json` não apresentam alterações locais. Não há `CREATE EXTENSION` nas migrations inspecionadas; a migration 0008 cria a tabela, FKs/checks, índices parciais, funções e triggers já descritos no preflight anterior. A existência dessas estruturas no banco só poderá ser confirmada depois da aplicação oficial.

### Procedimento PowerShell completo para execução manual posterior

O bloco abaixo é preparação documental e **não foi executado**. Deve ser copiado integralmente para uma sessão PowerShell convencional, com diretório atual `C:\DoJob\ProgramacaoMobile\backend`. Ele verifica branch/HEAD, integridade dos arquivos de migration e configuração, a sequência local 0001–0008 e os scripts npm; solicita a senha por prompt seguro; forma URLs iguais codificando usuário e senha; cria um arquivo dotenv temporário único, vazio e sem credenciais; define `DOTENV_CONFIG_PATH`, `DOTENV_CONFIG_OVERRIDE=false` e o schema Drizzle esperado; limpa opções externas de dotenv, Node, Drizzle e `PG*`; valida a URL e a identidade em transação `READ ONLY`; exige banco sem objetos/journal prévios e privilégios de criação; pede confirmação manual literal; e só então invoca o script oficial. A flag da fixture de integração PostgreSQL não é definida nem exigida neste procedimento. Qualquer guarda divergente interrompe a sequência. Não imprimir nem salvar a URL.

```powershell
& {
$priorErrorActionPreference = $ErrorActionPreference
try {
$ErrorActionPreference = 'Stop'
$expectedBranch = 'feature/staff-operacional-v2'
$expectedHead = '9ee8789fdf22fd38b4f1d8303d2012706b4586d4'
$expectedDatabase = 'arenago_staff_homolog_20261111'
$expectedRole = 'arenago_staff_homolog'
$expectedTags = @(
  '0001_identity_profile','0002_events_base','0003_credentials_roles','0004_event_operations',
  '0005_idempotency','0006_admin_2fa_login','0007_staff_idempotency_preparation','0008_external_entry_calls'
)
$stage = 'STATIC_GUARDS'
$repo = (Resolve-Path '..').Path
if ((Split-Path -Leaf (Get-Location).Path) -ne 'backend') { throw 'BLOCKED stage=WORKDIR' }
$branch = (& git -C $repo branch --show-current).Trim()
$head = (& git -C $repo rev-parse HEAD).Trim()
if ($branch -ne $expectedBranch -or $head -ne $expectedHead) { throw 'BLOCKED stage=GIT_IDENTITY' }
& git -C $repo diff --quiet HEAD -- backend/drizzle backend/drizzle.config.ts backend/package.json
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED stage=PROTECTED_FILES_DIRTY' }
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
if ($pkg.scripts.'db:migrate' -ne 'drizzle-kit migrate' -or $pkg.scripts.'predb:migrate' -or $pkg.scripts.'postdb:migrate') { throw 'BLOCKED stage=NPM_SCRIPT_CONTRACT' }
if (-not (Test-Path 'node_modules/.bin/tsx.cmd') -or -not (Test-Path 'node_modules/.bin/drizzle-kit.cmd')) { throw 'BLOCKED stage=DEPENDENCIES' }
$npmPath = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $npmPath) { throw 'BLOCKED stage=NPM_NOT_FOUND' }
$journal = Get-Content 'drizzle/meta/_journal.json' -Raw | ConvertFrom-Json
$tags = @($journal.entries | ForEach-Object { $_.tag })
if ($tags.Count -ne 8 -or (($tags -join '|') -ne ($expectedTags -join '|'))) { throw 'BLOCKED stage=JOURNAL_SEQUENCE' }
foreach ($tag in $expectedTags) { if (-not (Test-Path (Join-Path 'drizzle' ($tag + '.sql')))) { throw 'BLOCKED stage=MIGRATION_FILE_MISSING' } }

$credential = Get-Credential -UserName $expectedRole -Message 'Credencial local exclusiva do banco STAFF-03'
if ($null -eq $credential -or $credential.UserName -ne $expectedRole) {
  if ($credential -and $credential.Password) { $credential.Password.Dispose() }
  throw 'BLOCKED stage=CREDENTIAL_IDENTITY'
}
$passwordPtr = [IntPtr]::Zero
$plainPassword = $null
$connectionUrl = $null
$temporaryDotenvFile = $null
$envSnapshot = @{}
$managedNames = @()

try {
  $managedNames = @('NODE_ENV','DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL',
    'STAFF03_POSTGRES_PROJECTION_TEST','DRIZZLE_SCHEMA','NODE_OPTIONS','DOTENV_CONFIG_PATH',
    'DOTENV_CONFIG_OVERRIDE','DOTENV_KEY','DOTENV_CONFIG_DOTENV_KEY','npm_config_node_options')
  $managedNames += (Get-ChildItem Env: | Where-Object { $_.Name -match '^(PG|DOTENV)[A-Z0-9_]*$' } | ForEach-Object { $_.Name })
  $managedNames = @($managedNames | Sort-Object -Unique)
  foreach ($name in $managedNames) {
    $item = Get-Item "Env:$name" -ErrorAction SilentlyContinue
    if ($null -eq $item) { $envSnapshot[$name] = @{ Exists = $false; Value = $null } }
    else { $envSnapshot[$name] = @{ Exists = $true; Value = $item.Value } }
  }

  $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  $encodedUser = [Uri]::EscapeDataString($credential.UserName)
  $encodedPassword = [Uri]::EscapeDataString($plainPassword)
  $connectionUrl = "postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:55432/${expectedDatabase}"
  $temporaryDotenvFile = [IO.Path]::GetTempFileName()
  if ((Get-Item -LiteralPath $temporaryDotenvFile).Length -ne 0) { throw 'BLOCKED stage=DOTENV_TEMP_NOT_EMPTY' }
  foreach ($name in $managedNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $env:NODE_ENV = 'test'
  $env:DATABASE_URL = $connectionUrl
  $env:DATABASE_DIRECT_URL = $connectionUrl
  $env:EVENTS_TEST_DATABASE_URL = $connectionUrl
  $env:DOTENV_CONFIG_PATH = $temporaryDotenvFile
  # dotenv 16.6.1 converte a string 'false' em true; o arquivo vazio é a barreira efetiva contra override.
  $env:DOTENV_CONFIG_OVERRIDE = 'false'
  $env:DRIZZLE_SCHEMA = './src/database/schema/index.ts'

  function Invoke-NativeCaptured {
    param([string]$FileName, [string[]]$Arguments, [AllowNull()][string]$StandardInputText)
    $previousActionPreference = $ErrorActionPreference
    $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope 1 -ErrorAction SilentlyContinue
    $nativePreferenceScope = 1
    if ($null -eq $nativePreference) {
      $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue
      $nativePreferenceScope = 'Global'
    }
    try {
      $ErrorActionPreference = 'Continue'
      if ($null -ne $nativePreference) {
        Set-Variable -Name PSNativeCommandUseErrorActionPreference -Scope $nativePreferenceScope -Value $false
      }
      if ($null -ne $StandardInputText) {
        $output = @($StandardInputText | & $FileName @Arguments 2>&1)
      } else {
        $output = @(& $FileName @Arguments 2>&1)
      }
      $exitCode = $LASTEXITCODE
      [pscustomobject]@{ ExitCode = $exitCode; Output = @($output) }
    } finally {
      $ErrorActionPreference = $previousActionPreference
      if ($null -ne $nativePreference) {
        Set-Variable -Name PSNativeCommandUseErrorActionPreference -Scope $nativePreferenceScope -Value $nativePreference.Value
      }
    }
  }
  function Write-SanitizedProcessOutput {
    param([object[]]$Output)
    foreach ($line in $Output) {
      $safeLine = [string]$line
      if ($connectionUrl) { $safeLine = $safeLine.Replace($connectionUrl, '[DATABASE_URL_REDACTED]') }
      if ($plainPassword) { $safeLine = $safeLine.Replace($plainPassword, '[PASSWORD_REDACTED]') }
      $safeLine = $safeLine -replace '(?i)postgres(?:ql)?://\S+', '[DATABASE_URL_REDACTED]'
      $safeLine = $safeLine -replace '(?i)(password|pwd)\s*[:=]\s*\S+', '$1=[REDACTED]'
      Write-Output $safeLine
    }
  }

  $stage = 'READ_ONLY_PREFLIGHT'
  $preflight = @'
const { Client } = require('pg');
const names = ['DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL'];
const urls = names.map(n => process.env[n]);
let stage = 'URL_GUARD'; let client; let inTransaction = false;
const fail = (code) => { const e = new Error(); e.code = code; throw e; };
(async () => {
  try {
    if (process.env.NODE_ENV !== 'test') fail('ENVIRONMENT_INVALID');
    if (!urls.every(Boolean) || !urls.every(v => v === urls[0])) fail('URL_MISMATCH');
    const u = new URL(urls[0]);
    if (!['postgres:','postgresql:'].includes(u.protocol) || decodeURIComponent(u.username) !== 'arenago_staff_homolog'
      || !decodeURIComponent(u.password) || u.hostname !== '127.0.0.1' || u.port !== '55432'
      || u.pathname !== '/arenago_staff_homolog_20261111' || u.search || u.hash) fail('DESTINATION_REJECTED');
    stage = 'CONNECT';
    client = new Client({ connectionString: urls[0], connectionTimeoutMillis: 2500, statement_timeout: 5000, query_timeout: 7000 });
    await client.connect();
    stage = 'READ_ONLY_IDENTITY';
    await client.query('BEGIN READ ONLY'); inTransaction = true;
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('transaction_read_only') AS read_only,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
      (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS createdb,
      has_database_privilege(current_user,current_database(),'CONNECT') AS can_connect,
      has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema,
      has_schema_privilege(current_user,'public','USAGE') AS public_usage,
      has_schema_privilege(current_user,'public','CREATE') AS public_create,
      to_regclass('drizzle.__drizzle_migrations')::text AS migration_journal,
      current_setting('server_version') AS server_version`)).rows[0];
    if (identity.database !== 'arenago_staff_homolog_20261111' || identity.role !== 'arenago_staff_homolog'
      || identity.host !== '127.0.0.1' || identity.port !== 55432 || identity.read_only !== 'on'
      || !identity.server_version.startsWith('18.6')
      || identity.superuser !== false || identity.createdb !== false || identity.can_connect !== true
      || identity.can_create_schema !== true || identity.public_usage !== true || identity.public_create !== true
      || identity.migration_journal !== null) fail('IDENTITY_OR_PERMISSION_MISMATCH');
    stage = 'EMPTY_DATABASE_GUARD';
    const state = (await client.query(`SELECT
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r','p','S','v','m','f')) AS relations,
      (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'
       AND nspname NOT IN ('information_schema','public')) AS extra_schemas`)).rows[0];
    if (state.relations !== 0 || state.extra_schemas !== 0) fail('DATABASE_NOT_EMPTY');
    await client.query('ROLLBACK'); inTransaction = false;
    console.log('PREFLIGHT_OK ' + JSON.stringify({ database: identity.database, role: identity.role, host: identity.host,
      port: identity.port, readOnly: true, relations: state.relations, extraSchemas: state.extra_schemas,
      canCreateSchema: identity.can_create_schema, publicCreate: identity.public_create, serverVersion: identity.server_version }));
  } catch (e) {
    const c = e && e.code ? String(e.code) : 'CHECK_FAILED';
    const category = c === '28P01' || c === '28000' ? 'AUTHENTICATION_FAILED'
      : ['ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENOTFOUND'].includes(c) ? 'CONNECTION_FAILED' : c;
    console.error('PREFLIGHT_FAILED stage=' + stage + ' category=' + category);
    process.exitCode = 1;
  } finally {
    if (client) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => console.error('PREFLIGHT_CLEANUP=ROLLBACK_FAILED'));
      await client.end().catch(() => console.error('PREFLIGHT_CLEANUP=CONNECTION_CLOSE_FAILED'));
    }
  }
})();
'@
  $nodePath = (Get-Command node.exe -CommandType Application).Source
  $preflightResult = Invoke-NativeCaptured -FileName $nodePath -Arguments @('-') -StandardInputText $preflight
  Write-SanitizedProcessOutput $preflightResult.Output
  if ($preflightResult.ExitCode -ne 0) { throw "BLOCKED stage=READ_ONLY_PREFLIGHT exit=$($preflightResult.ExitCode)" }

  $approval = Read-Host 'Guards passaram. Para autorizar a migration oficial local, digite APPLY-STAFF03-MIGRATIONS-0001-0008'
  if ($approval -cne 'APPLY-STAFF03-MIGRATIONS-0001-0008') { throw 'STOPPED stage=HUMAN_APPROVAL_NOT_GIVEN' }
  $stage = 'OFFICIAL_MIGRATION'
  $migrationResult = Invoke-NativeCaptured -FileName $npmPath.Source -Arguments @('run','db:migrate') -StandardInputText $null
  $migrationExit = $migrationResult.ExitCode
  Write-SanitizedProcessOutput $migrationResult.Output
  $migrationResult = $null
  if ($migrationExit -ne 0) { throw "MIGRATION_FAILED stage=OFFICIAL_MIGRATION exit=$migrationExit; interrompido, sem retry automático" }
  Write-Output 'MIGRATION_OK command=npm.cmd run db:migrate'
} finally {
  try {
    foreach ($name in $managedNames) {
      try {
        if ($envSnapshot.ContainsKey($name)) {
          if ($envSnapshot[$name].Exists) { [Environment]::SetEnvironmentVariable($name, $envSnapshot[$name].Value, 'Process') }
          else { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        }
      } catch { [Console]::Error.WriteLine("ENV_RESTORE_FAILED name=$name") }
    }
  } finally {
    try {
      if ($temporaryDotenvFile -and (Test-Path -LiteralPath $temporaryDotenvFile)) {
        Remove-Item -LiteralPath $temporaryDotenvFile -Force -ErrorAction Stop
      }
    } catch { [Console]::Error.WriteLine('DOTENV_TEMP_CLEANUP_FAILED') }
  if ($passwordPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr); $passwordPtr = [IntPtr]::Zero }
    if ($credential) { $credential.Password.Dispose() }
  $plainPassword = $null; $encodedUser = $null; $encodedPassword = $null; $connectionUrl = $null
    $preflight = $null; $preflightResult = $null; $migrationResult = $null
    Remove-Variable credential -ErrorAction SilentlyContinue
  }
}
} finally {
  $ErrorActionPreference = $priorErrorActionPreference
}
}
```

**Compatibilidade dotenv e proteções do bloco:** a dependência instalada é dotenv 16.6.1. A inspeção de `lib/env-options.js` e `lib/main.js` confirmou que `DOTENV_CONFIG_OVERRIDE=false` chega como string, e `Boolean('false')` é verdadeiro nessa versão. Por isso, o bloqueio contra leitura de configurações externas não depende desse valor: `DOTENV_CONFIG_PATH` aponta para um arquivo temporário novo, verificado vazio, e `DOTENV_KEY`/todas as demais opções `DOTENV_*` são limpas antes de definir apenas o caminho e `false`. Assim dotenv só pode ler zero chaves; mesmo que a opção seja truthy, não há valores para sobrepor. O arquivo é removido no `finally`; o `.env` original não é alterado. As três URLs continuam iguais e o config usa explicitamente `DRIZZLE_SCHEMA=./src/database/schema/index.ts` e prioriza `DATABASE_DIRECT_URL`.

O endereço é comparado por `host(inet_server_addr())`; o erro anterior não prova que a máscara tenha sido a causa. A URL é validada antes de `Client.connect()`. A flag `STAFF03_POSTGRES_PROJECTION_TEST` é removida temporariamente e restaurada, mas não é definida nem exigida para migrations; permanece exclusiva da execução posterior da fixture. O processo de migration só é alcançado após a confirmação literal manual. A captura chama o `.cmd` em primeiro plano com `2>&1` sob `ErrorActionPreference=Continue`; em PowerShell 7, `PSNativeCommandUseErrorActionPreference` é temporariamente desativada quando existir. Assim, stderr entra na coleção para sanitização, e `$LASTEXITCODE` é lido imediatamente após o comando sem deixar um erro nativo interromper a coleta. Só depois de sanitizar URLs/senhas a saída é exibida; não há arquivo de log bruto. `ErrorActionPreference` e a preferência nativa são restauradas em `finally`; as funções auxiliares estão em um scriptblock e não persistem na sessão. O bloco restaura as variáveis do processo e remove o dotenv temporário em `finally`; strings .NET não podem ser zeradas byte a byte, então não use transcript ou histórico persistente.

Se o próprio `npm.cmd run db:migrate` falhar, parar e preservar somente saída já sanitizada para diagnóstico. Não repetir automaticamente, não usar `drizzle-kit push`, `db:generate`, seeds ou SQL manual. A role esperada não deve ser superuser nem ter `CREATEDB`; o preflight exige `CONNECT`, `CREATE` no banco (para o schema do journal Drizzle), `USAGE` e `CREATE` em `public`. As permissões das tabelas/funções após as migrations serão verificadas separadamente em read-only.

### Verificações read-only posteriores às migrations

Executar somente depois de uma migração manual aprovada e concluída, novamente com as três URLs validadas e sem exibi-las. Abrir `BEGIN READ ONLY`, aplicar `SET LOCAL statement_timeout='5s'`, executar as consultas abaixo e finalizar com `ROLLBACK`. Não selecionar linhas de dados das tabelas operacionais.

Confirmar que o journal contém exatamente oito registros e mapear `created_at` ao `_journal.json` oficial (ordem/tag):

```sql
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at, id;

SELECT count(*) AS migration_count,
       count(DISTINCT created_at) AS distinct_timestamps,
       min(created_at) AS first_created_at,
       max(created_at) AS last_created_at
FROM drizzle.__drizzle_migrations;
```

Os oito `created_at` esperados do journal local são `1792459201217`, `1792459202525`, `1792459203911`, `1792459205348`, `1792459206746`, `1794000000000`, `1794200000000` e `1794412800000`, na ordem dos tags 0001 a 0008. Inspeção estática do `drizzle-orm` instalado confirma que o hash é SHA-256 do texto completo da migration lido como string, e que `created_at` recebe `journalEntry.when`. Para comparar, executar localmente (não conecta ao banco) e comparar por tag os hashes/timestamps com o resultado SQL acima:

```powershell
node -e "const fs=require('node:fs'),c=require('node:crypto');const j=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));for(const e of j.entries){const q=fs.readFileSync('drizzle/'+e.tag+'.sql').toString();console.log(e.tag+' '+e.when+' '+c.createHash('sha256').update(q).digest('hex'));}"
```

Conferir que há exatamente um hash/registro por timestamp e nenhum registro extra; divergência interrompe a validação. Não editar o journal ou aplicar SQL para forçar correspondência.

Confirmar presença das tabelas da fixture e objetos centrais da migration 0008 sem consultar registros:

```sql
SELECT name, to_regclass('public.' || quote_ident(name)) IS NOT NULL AS present
FROM (VALUES ('users'),('events'),('user_roles'),('participations'),('audit_logs'),
             ('external_entry_calls')) AS required(name)
ORDER BY name;

SELECT conname, contype, condeferrable, condeferred
FROM pg_constraint
WHERE conrelid = 'public.external_entry_calls'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='external_entry_calls'
ORDER BY indexname;

SELECT c.relname AS table_name, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND t.tgname IN (
  'protect_external_entry_call','resolve_external_call_on_participation',
  'check_external_call_integrity','check_external_call_participation',
  'check_external_call_event','prevent_external_calls_truncate')
ORDER BY c.relname,t.tgname;
```

Verificar os privilégios que a fixture precisa sem alterar ACLs. A fixture insere em `users`, `events`, `user_roles`, `participations` e `external_entry_calls`; atualiza `events`, `participations` e `external_entry_calls`; e as triggers precisam inserir em `audit_logs`. As projeções leem `users`, `events`, `participations` e `external_entry_calls`. Confirmar `SELECT` nas tabelas consultadas, `INSERT`/`UPDATE` nas tabelas correspondentes, `INSERT` em `audit_logs` e privilégios `USAGE`/`CREATE` já mencionados. Exemplo de catálogo (uma linha por tabela/privilégio; não altera ACL):

```sql
SELECT current_user,
  has_table_privilege(current_user,'public.users','SELECT') AS users_select,
  has_table_privilege(current_user,'public.users','INSERT') AS users_insert,
  has_table_privilege(current_user,'public.events','SELECT') AS events_select,
  has_table_privilege(current_user,'public.events','INSERT') AS events_insert,
  has_table_privilege(current_user,'public.events','UPDATE') AS events_update,
  has_table_privilege(current_user,'public.user_roles','INSERT') AS roles_insert,
  has_table_privilege(current_user,'public.participations','SELECT') AS participations_select,
  has_table_privilege(current_user,'public.participations','INSERT') AS participations_insert,
  has_table_privilege(current_user,'public.participations','UPDATE') AS participations_update,
  has_table_privilege(current_user,'public.external_entry_calls','SELECT') AS calls_select,
  has_table_privilege(current_user,'public.external_entry_calls','INSERT') AS calls_insert,
  has_table_privilege(current_user,'public.external_entry_calls','UPDATE') AS calls_update,
  has_table_privilege(current_user,'public.audit_logs','INSERT') AS audit_insert;
```

Consulta sem privilégios necessários, journal diferente de 8, ausência de tabela/constraint/index/trigger obrigatório ou identidade diferente bloqueia a integração. As consultas pós-migration são plano futuro, não executado. Só depois do preflight e da migration aprovados será solicitada nova autorização explícita para rodar o teste PostgreSQL transacional individual.
