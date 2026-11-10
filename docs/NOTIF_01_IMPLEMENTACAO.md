# ArenaGo — TASK NOTIF-01: Alerta vibratório silencioso ao ser chamado na fila

## 1. Identificação da Entrega

- **Repositório:** `JaviDansen/ArenaGo`
- **Branch-base:** `develop` (`41b231f`)
- **Branch de trabalho:** `feature/queue-call-vibration`
- **Expo SDK:** 58 (Expo ~58.0.23, React 19.3.0, React Native 0.88.1)
- **Commit de correção:** `fix(queue): reforçar isolamento de sessão e confiabilidade dos alertas`

---

## 2. Seleção de Modelos e Níveis de Raciocínio (`AGENTS.md`)

- **Modelo Recomendado para Implementação e Correções:** **GPT-6.1 Sol com raciocínio High**
  *Justificativa:* Correções estruturais de confiabilidade transacional e concorrência na outbox PostgreSQL, autenticação e isolamento de sessão no cliente HTTP, parsing de `NotificationTaskPayload` do Expo SDK 58 em modo headless e deduplicação persistente no `SecureStore`.
- **Modelo Recomendado para Revisão Crítica:** **GPT-6 Astra com raciocínio High / Extra High**
  *Justificativa:* Verificação de invariantes de reserva atômica (`FOR UPDATE SKIP LOCKED`), isolamento entre contas após logout/troca de sessão e fidelidade das limitações reais do Android.
- **Executor Designado para Validações Rotineiras:** **GPT-6 Luna com raciocínio Medium**.

---

## 3. Correções Implementadas (P1 e P2)

### 3.1. Autenticação, Isolamento e Prevenção de Condições de Corrida no Registro do Dispositivo — P1 (`app/services/devicePushService.js`, `app/services/queueCallVibrationService.js` e `app/context/AuthContext.js`)
- **`POST /devices/push-token`:** envia explicitamente `{ auth: true }` para que `httpClient.js` inclua o cabeçalho `Authorization: Bearer <accessToken>`.
- **`DELETE /devices/push-token`:** envia `{ auth: true, body: { pushToken } }`, respeitando o contrato de `httpClient.delete(path, options)` em `app/services/httpClient.js`.
- **Proteção determinística contra condições de corrida entre login, logout e troca de conta:**
  - `syncDevicePushToken` revalida a geração monotônica (`syncGeneration`), `getSessionEpoch()` e `isCurrent()` antes e após **cada** operação assíncrona (`ensureAndroidSilentChannel`, `getPermissionsAsync`, `requestPermissionsAsync`, `getExpoPushTokenAsync`, `client.post`, `secureStore.setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY)` e `setActiveQueueCallUser`).
  - `setActiveQueueCallUser` possui seu próprio controle monotônico de geração (`activeUserStateGeneration`) e callback `shouldAbort`, revertendo imediatamente qualquer escrita em `arenago_push_active_user_id` caso o logout ou troca de conta ocorra enquanto o `SecureStore` está pendente.
  - Em caso de logout durante `POST /devices/push-token`, `secureStore.setItemAsync` ou `setActiveQueueCallUser`, a função `compensateAndCleanup` remove qualquer gravação tardia no `SecureStore`, limpa o usuário ativo e envia compensação `DELETE /devices/push-token`.
  - Em caso de troca direta de contas (`User A -> User B`), `compensateAndCleanup` preserva integralmente o token e o usuário ativo da nova conta (`latestCommittedSync`) no `SecureStore` e em memória, compensando apenas o registro obsoleto da conta anterior.
  - Em caso de falha de rede durante `DELETE /devices/push-token` no logout, `unregisterDevicePushToken` captura o erro sem bloquear o fluxo de logout e limpa obrigatoriamente o token e o usuário ativo no `SecureStore` e em memória.

### 3.2. Processamento do Payload em Background (Expo SDK 58 `NotificationTaskPayload`) — P1 (`app/services/queueCallVibrationService.js` e `app/index.js`)
- **Interpretação real de `NotificationTaskPayload`:**
  - `extractNotificationTaskPayload` interpreta `data.data.dataString` (formato nativo produzido por `RemoteMessageSerializer.java` no Android) e `data.dataString` (formato documentado no `NotificationTaskPayload` do Expo SDK 58), fazendo `JSON.parse` seguro e validando o conteúdo.
  - Rejeita mensagens malformadas, `NotificationResponse` (`'actionIdentifier' in data`), erros da task e qualquer payload que contenha campos visuais ou sonoros (`title`, `body`, `message`, `subtitle`, `sound`, `alert`, `badge`) sem produzir vibração.
- **Inicialização Headless:**
  - `TaskManager.defineTask(BACKGROUND_QUEUE_CALL_TASK, ...)` e `Notifications.registerTaskAsync(BACKGROUND_QUEUE_CALL_TASK)` são executados no escopo de inicialização do módulo `queueCallVibrationService.js`, que é importado diretamente no topo de `app/index.js` antes de `registerRootComponent(App)`. Isso garante que a task esteja definida e registrada quando o Android carregar o bundle JS em segundo plano sem montar a árvore React.

### 3.3. Confiabilidade, Reserva Atômica, Associação Ticket-Token e Timeouts da Outbox — P1/P2 (`backend/src/notifications/queue-call-push.service.ts`)
- **Reserva atômica por registro:**
  - Substituído o `SELECT ... FOR UPDATE SKIP LOCKED` avulso por uma reserva atômica em instrução única:
    ```sql
    UPDATE queue_call_outbox
    SET status = 'processing',
        attempts = attempts + 1,
        locked_at = clock_timestamp()
    WHERE id IN (
      SELECT id
      FROM queue_call_outbox
      WHERE (
        (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp()))
        OR
        (status = 'processing' AND locked_at <= clock_timestamp() - (60 * INTERVAL '1 second'))
      )
      AND attempts < 3
      ORDER BY created_at ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    )
    RETURNING ...
    ```
  - Evita que múltiplas instâncias do backend processem o mesmo registro simultaneamente.
- **Revogação exclusiva do dispositivo inválido (`DeviceNotRegistered`) — P1:**
  - A associação entre `ticketId` e `pushToken` é preservada em `payload._ticketTokens` (persistida no banco para sobreviver a reinícios e múltiplas instâncias) e em cache em memória (`ticketTokenCache`).
  - Quando um recibo `/api/v2/push/getReceipts` retorna `DeviceNotRegistered`, o serviço revoga **exclusivamente** o token correspondente àquele recibo (`deviceTokensService.revokeInvalidToken(invalidToken)`), preservando intactos outros dispositivos válidos do mesmo usuário.
- **Rejeição de tickets `ok` sem ID válido — P2:**
  - Não são gerados identificadores fictícios como `accepted-0`.
  - Se a Expo Push API retornar `{ status: "ok" }` sem `id` válido (ausente ou vazio), o ticket é classificado como resposta inconclusiva/inválida e submetido à política de retry (`pending` com backoff progressivo até 3 tentativas), preservando o mesmo `serviceSessionId` para deduplicação lógica.
- **Timeouts HTTP explícitos, renovação de lease (heartbeat) e fencing por tentativa — P2:**
  - `performHttpPost` aplica timeout explícito (`EXPO_HTTP_TIMEOUT_MS = 10_000` ms, compatível com o lease de 60s) via `AbortController` e `Promise.race`. Quando a resposta do provedor é incerta por timeout, a requisição é abortada e o registro agenda retry sem ser marcado como `accepted` ou `delivered`.
  - Antes de iniciar o envio HTTP e durante sua execução (dentro do limite de timeout), a instância valida e renova periodicamente `locked_at = clock_timestamp()` (`WHERE id = ... AND status = 'processing' AND attempts = currentAttempt`), impedindo que outra instância assuma a mesma entrega enquanto a requisição ainda está em andamento.
  - Todas as transições de estado pós-envio utilizam *fencing* por número de tentativa (`WHERE id = ${entry.id} AND status = 'processing' AND attempts = ${currentAttempt}`), garantindo que uma resposta tardia de uma instância cujo lease expirou jamais sobrescreva o estado de outra instância.
- **Retomada após reinício e agendador periódico:**
  - `QueueCallPushService` implementa `OnApplicationBootstrap` e `BeforeApplicationShutdown`.
  - Na inicialização (`recoverOnStartup()`), recupera registros pendentes, libera/reprocessa registros órfãos em `processing` cujo lock de 60s expirou durante uma queda e verifica recibos de registros `accepted`.
  - Mantém ciclo periódico não sobreposto (`startScheduler`, intervalo padrão de 5s com `.unref()`), não dependendo exclusivamente de `triggerDispatch()`.
- **Retries com intervalo e limite definidos:**
  - Limite máximo: `MAX_OUTBOX_ATTEMPTS = 3`.
  - Backoff progressivo via `next_attempt_at`: `5 segundos` após a 1ª falha e `15 segundos` após a 2ª falha; na 3ª falha, o registro transita definitivamente para `status = 'failed'`.
- **Distinção estrita de estados de envio e entrega:**
  - `no_device`: quando o participante não possui nenhum token ativo (`tokens.length === 0`). **Nunca é marcado como `delivered`.**
  - `accepted`: quando a Expo Push API (`/api/v2/push/send`) aceita ao menos um ticket (`status: "ok"`) com `id` válido, persistindo o `ticket_id`.
  - `delivered`: somente quando a API de recibos (`/api/v2/push/getReceipts`) confirma `{ status: "ok" }` para o `ticket_id`.
  - `expired`: quando a `service_session` não está mais `pending` antes do envio ou da confirmação do recibo.
  - `failed`: quando todos os tickets/recibos falham com erro não recuperável (ex.: `DeviceNotRegistered`, revogando apenas o token inválido) ou após esgotar as 3 tentativas.

### 3.4. Isolamento de Sessão, Deduplicação Persistente e Validação de Estado — P1 (`app/services/queueCallVibrationService.js`)
- **Deduplicação persistente por usuário (`SecureStore`):**
  - Os identificadores `serviceSessionId` já vibrados são persistidos no `SecureStore` (`arenago_alerted_service_sessions_v1`) indexados pelo `userId`, sobrevivendo ao reinício do processo.
  - O usuário autenticado ativo é persistido em `arenago_push_active_user_id` no `SecureStore`, permitindo que a task em background valide a titularidade do alerta mesmo quando `AuthContext` não está montado.
- **Proteções implementadas:**
  - **Nenhum alerta de conta anterior:** alertas cujo `userId` divirja do usuário ativo ou recebidos após logout (`clearActiveQueueCallUser`) são descartados.
  - **Nenhuma vibração duplicada foreground/background:** trava síncrona `inFlightSessionIds` impede execução concorrente quando o listener de primeiro plano e a task de segundo plano recebem o mesmo evento simultaneamente.
  - **Nenhuma vibração de chamada já encerrada (quando verificável):** quando o cliente autenticado possui `accessToken` em memória, o validador registrado em `AuthContext` consulta `GET /participations/:participationId/queue` e cancela a vibração se a chamada não estiver mais `called`/`pending`. Alertas atrasados com `calledAt` superior a 5 minutos (`MAX_ALERT_STALENESS_MS`) também são descartados.
  - **Falha de execução de hardware:** `serviceSessionId` só é marcado como executado após `vibrationEngine.vibrate(QUEUE_CALL_VIBRATION_PATTERN, false)` retornar sem erro. Se o hardware lançar exceção ou estiver indisponível, o ID não é marcado como processado.
- **Situações em que a confirmação online do estado atual não é possível:**
  1. **Execução headless após reinício do processo:** por regra de segurança da arquitetura de autenticação (K02), o JWT `accessToken` é mantido exclusivamente em memória RAM (apenas o `refreshToken` fica no `SecureStore`). Portanto, quando o processo inicia em background sem montar o `AuthContext`, não há `accessToken` em memória para consultar `GET /participations/:id/queue`.
  2. **Indisponibilidade momentânea de rede / timeout na consulta GET:** caso a entrega do push ocorra durante oscilação de conectividade HTTP.
  *Mitigação nessas situações:* o backend valida `service_sessions.status = 'pending'` imediatamente antes do disparo na outbox, e o cliente aplica a janela de expiração por `calledAt` (5 minutos), isolamento por `userId` no `SecureStore` e deduplicação persistida por `serviceSessionId`.

### 3.5. Configuração Android e Justificativa do `app.json` — P2
- **Canal Android silencioso:** `ensureAndroidSilentChannel` cria o canal `arenago-silent-queue-calls` (`importance: LOW`, `sound: null`, `enableVibrate: false`, `showBadge: false`, `lockscreenVisibility: SECRET`) antes de requisitar permissões ou chamar `getExpoPushTokenAsync`.
- **Validação do `projectId` EAS:** `resolveEasProjectId` valida que o `projectId` é um UUID válido antes de invocar `Notifications.getExpoPushTokenAsync({ projectId })`.
- **Supressão visual no SDK 58:** `Notifications.setNotificationHandler` utiliza `shouldShowBanner: false`, `shouldShowList: false`, `shouldPlaySound: false` e `shouldSetBadge: false`.
- **Justificativa das alterações em `app/app.json`:**
  - `name: "app"`, `slug: "app"`, `userInterfaceStyle: "light"` e `backgroundColor: "#ffffff"` foram **preservados exatamente como na branch `develop`** para evitar quebra de identidade com configurações preexistentes do projeto Expo.
  - `android.package: "com.arenago.app"` e `ios.bundleIdentifier: "com.arenago.app"` foram adicionados porque `expo-notifications` (`getExpoPushTokenAsync`) exige `Application.applicationId` nativo (lançando `ERR_NOTIFICATIONS_NO_APPLICATION_ID` se ausente) e o EAS Build / `expo prebuild` exige ambos os identificadores para gerar os projetos nativos e vincular credenciais FCM/APNs.
  - `android.permissions: ["android.permission.VIBRATE"]` e o plugin `expo-notifications` habilitam o controle nativo do motor de vibração e o serviço receptor de mensagens remotas.
  - Nenhuma credencial (`google-services.json` ou chaves privadas) foi incluída no repositório.

---

## 4. Migração de Banco de Dados e Contratos de API

### 4.1. Migração Drizzle (`backend/drizzle/0007_queue_call_vibration_outbox.sql`)
- Tabela `device_push_tokens`: `id`, `user_id`, `push_token` (UNIQUE), `platform`, `created_at`, `updated_at`, `revoked_at`.
- Tabela `queue_call_outbox`: `id`, `service_session_id` (UNIQUE), `user_id`, `event_id`, `experience_id`, `payload` (JSONB), `status` (`pending`, `processing`, `accepted`, `delivered`, `no_device`, `expired`, `failed`), `attempts`, `next_attempt_at`, `locked_at`, `ticket_id`, `last_error`, `created_at`, `processed_at`.

### 4.2. Endpoints de Dispositivo
- `POST /api/v1/devices/push-token` (`@RequireSessionAuth()`): recebe `{ pushToken, platform }` e retorna `{ status: "registered" | "updated" }`.
- `DELETE /api/v1/devices/push-token` (`@RequireSessionAuth()`): recebe `{ pushToken }` no `body` e retorna `{ unlinked: boolean }`.

---

## 5. Resultados das Validações Automatizadas Executadas

| Escopo | Comando Executado | Resultado Observado | Exit Code |
| :--- | :--- | :--- | :--- |
| **Testes Unitários Mobile (App completo)** | `npm.cmd --prefix app test` | **387/387 aprovados** (incluindo 7 suítes completas em `queue-call-vibration.test.cjs`) | `0` |
| **Testes Unitários Backend (Notificações, Fila e CallNext)** | `cd backend; $env:NODE_ENV="test"; $env:STAFF_IDEMPOTENCY_TTL_SECONDS="60"; $env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS="60"; $env:EVALUATION_IDEMPOTENCY_TTL_SECONDS="60"; npx.cmd tsx --test test/unit/call-next*.test.ts test/unit/notifications*.test.ts test/unit/queue-call*.test.ts test/unit/staff-http.test.ts test/unit/participant-queue-http.test.ts` | **82/82 aprovados** (0 falhas) | `0` |
| **Build TypeScript do Backend** | `npm.cmd --prefix backend run build` | **Compilado sem erros** (`nest build`) | `0` |
| **Typecheck de Testes do Backend** | `npm.cmd --prefix backend run typecheck:test` | **0 erros** (`tsc --project tsconfig.test.json`) | `0` |
| **Verificação de Dependências Expo** | `cd app; npx.cmd expo install --check` | **Dependencies are up to date** | `0` |
| **Diagnóstico Expo Doctor** | `cd app; npx.cmd expo-doctor` | **20/20 checks passed. No issues detected!** | `0` |
| **Higiene do Git** | `git diff --check` | **0 erros** | `0` |

> **Nota sobre testes de integração PostgreSQL (`call-next.integration.test.ts` / `staff-http.integration.test.ts`):**
> No ambiente local desta execução, o daemon do Docker Desktop estava desligado (`127.0.0.1:55432` inacessível) e, conforme a seção 2 do `AGENTS.md` (*Integrações PostgreSQL*), campanhas contra banco PostgreSQL real e aplicação de novas migrations (`0007_queue_call_vibration_outbox.sql`) exigem instância ativa e autorização explícita do responsável. As validações de banco nesta etapa foram comprovadas via suítes unitárias e HTTP simuladas (`call-next.test.ts`, `call-next-outbox.test.ts`, `staff-http.test.ts`, `queue-call-push.test.ts` e `notifications-device-tokens.test.ts`).

---

## 6. Validação em Android Real e Limitações do Sistema Operacional

> **Declaração de transparência (Seção 5 do `AGENTS.md` e Item 6 da revisão):**
> Nenhum cenário abaixo foi marcado como `PASSOU` sem execução física comprovada em aparelho Android real. No ambiente de desenvolvimento atual, `adb devices` não possui dispositivo físico conectado e o repositório não contém credenciais privadas do Firebase (`google-services.json`) nem `projectId` EAS vinculado a conta de nuvem.

### 6.1. Descoberta Técnica Crítica sobre `Vibration.vibrate()` em Segundo Plano no Android 9+
A inspeção direta da implementação nativa do React Native (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/vibration/VibrationModule.kt`, linhas 36–48) demonstra que `Vibration.vibrate(pattern, repeat)` executa:
```kotlin
v.vibrate(VibrationEffect.createWaveform(patternLong, repeat))
```
sem fornecer `AudioAttributes` ou `VibrationAttributes` com `USAGE_NOTIFICATION` / `USAGE_ALARM`. No AOSP (Android 9+ / API 28+), o serviço `VibratorManagerService` do sistema operacional aplica a regra `shouldIgnoreVibrationLocked`: quando o processo da aplicação não está em `IMPORTANCE_FOREGROUND` (aplicativo em segundo plano ou tela bloqueada), o Android **ignora silenciosamente** chamadas diretas a `Vibrator.vibrate()` que não possuam atributos de sistema ou que não sejam disparadas pela apresentação de uma notificação visível na barra de status.

Portanto, a exigência simultânea de **(a) zero notificação visível no sistema** e **(b) vibração via API JS `Vibration.vibrate()` em segundo plano** sofre bloqueio nativo do próprio sistema operacional Android na maioria dos aparelhos modernos quando a Activity sai de primeiro plano.

### 6.2. Matriz de Status Real por Cenário

| # | Cenário | Status em Hardware Real | Status em Testes Automatizados | Explicação Técnica do Comportamento Real |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Aplicativo aberto (Foreground)** | **PENDENTE DE HOMOLOGAÇÃO FÍSICA** *(sem aparelho conectado ao ADB)* | **VALIDADO EM TESTE AUTOMATIZADO** | Com a Activity em primeiro plano (`IMPORTANCE_FOREGROUND`), o Android permite `Vibration.vibrate([0, 500, 200, 500, 200, 500], false)` (1,9s) sem som e sem banner (`shouldShowBanner: false`, `shouldShowList: false`), atualizando a `RealArenaScreen`. |
| **2** | **Aplicativo em segundo plano** | **LIMITAÇÃO DO SISTEMA ANDROID** | **CALLBACK HEADLESS VALIDADO EM TESTE** | Embora a task `ARENAGO_QUEUE_CALL_VIBRATION_TASK` interprete `data.dataString` e invoque `Vibration.vibrate`, o `VibratorManagerService` do Android 9+ suprime vibrações diretas de processos em background que não exibam notificação visual do sistema. |
| **3** | **Tela bloqueada** | **LIMITAÇÃO DO SISTEMA ANDROID** | **CALLBACK HEADLESS VALIDADO EM TESTE** | Com a tela desligada/bloqueada, o processo não detém foco de primeiro plano e sofre a mesma restrição do `VibratorManagerService` e do Doze Mode sem notificação visual. |
| **4** | **Aplicativo removido dos recentes** | **LIMITAÇÃO DO SISTEMA ANDROID** | **N/A (Comportamento do SO)** | No Android 12+ e em OEMs (Samsung OneUI, Xiaomi MIUI), remover o app dos recentes encerra o processo ou atrasa broadcasts FCM de dados até reabertura. |
| **5** | **Force-stop** | **LIMITAÇÃO DO SISTEMA ANDROID** | **N/A (Comportamento do SO)** | O Android bloqueia terminantemente qualquer receptor, job ou serviço de aplicativos em estado *stopped* (`FLAG_STOPPED`) até que o usuário abra o app manualmente. |
| **6** | **Nova chamada após outra já atendida** | **PENDENTE DE HOMOLOGAÇÃO FÍSICA** | **VALIDADO EM TESTE AUTOMATIZADO** | Cada chamada gera um novo `serviceSessionId` único; a deduplicação bloqueia apenas IDs já processados e permite que a nova chamada vibre normalmente. |
| **7** | **Retry e entrega duplicada** | **PENDENTE DE HOMOLOGAÇÃO FÍSICA** | **VALIDADO EM TESTE AUTOMATIZADO** | A trava síncrona `inFlightSessionIds` e a persistência em `SecureStore` (`arenago_alerted_service_sessions_v1`) garantem disparo único mesmo com recebimento simultâneo foreground/background ou após reinício do processo. |
| **8** | **Logout e troca de conta** | **PENDENTE DE HOMOLOGAÇÃO FÍSICA** | **VALIDADO EM TESTE AUTOMATIZADO** | O logout envia `DELETE /devices/push-token` autenticado, cancela registros pendentes, remove o usuário ativo do `SecureStore` e impede alertas da conta anterior. |

### 6.3. Procedimento para Homologação em Dispositivo Físico (Development Build)
Para executar o teste de campo no celular Android:
1. Configurar um projeto EAS (`npx eas-cli project:init`) e definir `EXPO_PUBLIC_EAS_PROJECT_ID=<uuid>` no `.env` local (não versionado), além de configurar as credenciais FCM V1 no painel EAS.
2. Gerar e instalar a Development Build no aparelho:
   ```powershell
   npx expo run:android
   ```
   *(ou `npx eas-cli build --profile development --platform android`).*
3. Conectar o aparelho via USB (`adb devices`) e monitorar os logs do vibrador e do FCM:
   ```powershell
   adb logcat | findstr /i "Vibrator FirebaseMessaging expo-notifications"
   ```
4. **Recomendação Operacional:** A chamada presencial pelo Staff permanece obrigatória em todas as experiências da Arena, pois o alerta vibratório silencioso está sujeito às restrições de segundo plano do Android descritas acima.
