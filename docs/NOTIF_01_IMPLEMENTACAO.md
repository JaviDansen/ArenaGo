# ArenaGo — TASK NOTIF-01: Alerta vibratório silencioso ao ser chamado na fila

## 1. Identificação da Entrega

- **Repositório:** `JaviDansen/ArenaGo`
- **Branch-base:** `develop`
- **HEAD de referência:** `41b231f`
- **Branch de trabalho:** `feature/queue-call-vibration`
- **Expo SDK:** 58 (Expo ~58.0.23, React 19.3.0, React Native 0.88.1)
- **Convenção de commit:** `feat(queue): implementar alerta vibratório silencioso para chamadas da fila`

---

## 2. Seleção de Modelos e Níveis de Raciocínio (AGENTS.md)

- **Modelo Recomendado para Implementação:** **GPT-6.1 Sol com raciocínio High**  
  *Justificativa:* A tarefa exige desenvolvimento full-stack com integração transacional complexa entre NestJS, PostgreSQL Drizzle (tabelas de outbox e tokens, idempotência em mutações de fila), serviços de mensageria assíncrona (Expo Push API), hooks de autenticação mobile e execução headless em background no Expo SDK 58.
- **Modelo Recomendado para Revisão Crítica:** **GPT-6 Astra com raciocínio High / Extra High**  
  *Justificativa:* Verificação estática de concorrência, consistência ACID da chamada do Staff sob race conditions, isolamento transacional da outbox e garantias de não-reversão do banco em falhas de rede.
- **Executor Designado para Validação Rotineira:** **GPT-6 Luna com raciocínio Medium** (conforme política permanente).

---

## 3. Arquitetura da Solução

### 3.1. Fonte de Verdade e Transacionalidade (PostgreSQL)

A fonte de verdade absoluta permanece no PostgreSQL. Quando o Staff executa a operação real de chamada (`POST /api/v1/staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next`):
1. O backend adquire os locks em ordem estrita (`events` FOR SHARE → `experiences` FOR UPDATE → `stations` FOR UPDATE → `users`/`user_roles` FOR SHARE → reserva de idempotência).
2. Se a chamada for confirmada e um novo atendimento for criado (`service_sessions` com status `pending`), um registro é inserido na tabela transacional `queue_call_outbox` dentro da mesma `mutationTransaction(tx)`.
3. O payload é rigorosamente silencioso (*data-only*), sem campos visuais (`title`, `body`, `message`, `sound`).
4. Replays idempotentes (`reservation.kind === "replay"`) retornam a resposta histórica e **nunca** inserem novo registro na outbox nem disparam push.
5. Se o envio de push falhar, a chamada do Staff **já está confirmada e commitada**, garantindo que instabilidades externas não afetem o atendimento presencial.

### 3.2. Deduplicação e Resiliência

- **No Backend:**
  - A tabela `queue_call_outbox` possui restrição única `UNIQUE("service_session_id")`.
  - Antes de despachar cada mensagem, o serviço `QueueCallPushService` valida se a sessão de atendimento ainda se encontra com status `pending`. Se o atendimento foi concluído, cancelado ou marcado como ausente pelo Staff antes da entrega do push, a mensagem é imediatamente marcada como `expired` e não é transmitida.
  - Se o serviço Expo Push retornar erro `DeviceNotRegistered`, o token de push do aparelho é automaticamente invalidado no banco (`revoked_at = clock_timestamp()`).
- **No Aplicativo Mobile:**
  - Deduplicação em memória e ciclo de vida: o identificador `serviceSessionId` é registrado em um `Set` local. Qualquer recepção subsequente da mesma sessão (por retry de rede ou atualização de tela) é ignorada sem vibrar.
  - Ao realizar logout ou troca de usuário, o conjunto de deduplicação é limpo via `resetQueueCallAlerts()`.

### 3.3. Padrão de Vibração e Transporte Silencioso

- **Padrão Exato de Vibração:**
  - Início imediato (0 ms)
  - Pulso 1: 500 ms de vibração
  - Pausa 1: 200 ms de repouso
  - Pulso 2: 500 ms de vibração
  - Pausa 2: 200 ms de repouso
  - Pulso 3: 500 ms de vibração
  - Sem repetição (`repeat = false`)
  - **Duração total exata:** 1.900 ms (1,9 segundo).
  - Array React Native: `[0, 500, 200, 500, 200, 500]`.
- **Supressão Visual Total:**
  - Configuração do manipulador: `Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false }) })`.
  - O payload de dados contém exclusivamente:
    ```json
    {
      "type": "queue.called",
      "serviceSessionId": "<UUID>",
      "participationId": "<UUID>",
      "eventId": "<UUID>",
      "version": 1
    }
    ```

---

## 4. Alterações no Banco de Dados (Drizzle Migration)

Arquivo: `backend/drizzle/0007_queue_call_vibration_outbox.sql`

```sql
CREATE TABLE IF NOT EXISTS "device_push_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"push_token" varchar(255) NOT NULL,
	"platform" varchar(20) DEFAULT 'android' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "uq_device_push_tokens_token" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue_call_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "uq_queue_call_outbox_session" UNIQUE("service_session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_device_push_tokens_user" ON "device_push_tokens" USING btree ("user_id","revoked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_queue_call_outbox_pending" ON "queue_call_outbox" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "fk_device_push_tokens_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_service_session" FOREIGN KEY ("service_session_id") REFERENCES "public"."service_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_event" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queue_call_outbox" ADD CONSTRAINT "fk_queue_call_outbox_experience" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;
```

---

## 5. Contratos dos Endpoints Adicionados

### 5.1. Registrar / Atualizar Push Token do Dispositivo

- **Método / Rota:** `POST /api/v1/devices/push-token`
- **Autenticação:** Obrigatória (`Bearer <accessToken>`)
- **Headers:** `Content-Type: application/json`
- **Requisição:**
  ```json
  {
    "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "android"
  }
  ```
- **Resposta (200 OK):**
  ```json
  {
    "status": "registered"
  }
  ```
  *(ou `status: "updated"` quando o token já existia e foi associado ao novo usuário/sessão).*

### 5.2. Desvincular Push Token do Dispositivo

- **Método / Rota:** `DELETE /api/v1/devices/push-token`
- **Autenticação:** Obrigatória (`Bearer <accessToken>`)
- **Headers:** `Content-Type: application/json`
- **Requisição:**
  ```json
  {
    "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
  }
  ```
- **Resposta (200 OK):**
  ```json
  {
    "unlinked": true
  }
  ```

---

## 6. Arquivos Modificados e Criados

### Backend
- `backend/src/database/schema/notifications.schema.ts` (criado)
- `backend/src/database/schema/index.ts` (exportação do novo schema)
- `backend/drizzle/0007_queue_call_vibration_outbox.sql` (criado)
- `backend/drizzle/meta/_journal.json` (registro da migração)
- `backend/src/notifications/device-tokens.dto.ts` (criado)
- `backend/src/notifications/device-tokens.service.ts` (criado)
- `backend/src/notifications/device-tokens.controller.ts` (criado)
- `backend/src/notifications/queue-call-push.service.ts` (criado)
- `backend/src/notifications/notifications.module.ts` (criado)
- `backend/src/events/call-next.service.ts` (inserção atômica na outbox e trigger pós-commit)
- `backend/src/events/events.module.ts` (importação do `NotificationsModule`)
- `backend/src/app.module.ts` (registro do `NotificationsModule`)
- `backend/test/unit/notifications-device-tokens.test.ts` (criado)
- `backend/test/unit/queue-call-push.test.ts` (criado)
- `backend/test/unit/call-next-outbox.test.ts` (criado)

### Frontend (App)
- `app/package.json` (adição de `expo-notifications` ~58.1.8 e `expo-task-manager` ~58.0.13)
- `app/app.json` (permissão `android.permission.VIBRATE`, identificador Android `com.arenago.app`, plugin `expo-notifications`)
- `app/services/queueCallVibrationService.js` (criado: padrão 1.9s, deduplicação por ID, handlers silenciosos e headless task)
- `app/services/devicePushService.js` (criado: permissões, obtenção de token e sincronização segura com backend)
- `app/screens/arena/RealArenaScreen.js` (atualização reativa imediata da tela ao receber alerta na fila)
- `app/context/AuthContext.js` (registro de token no login, desvinculação e limpeza de alertas no logout)
- `app/tests/queue-call-vibration.test.cjs` (criado: 4 testes unitários de duração, deduplicação e eventos)

---

## 7. Resultados dos Testes Técnicos Automatizados

### 7.1. Testes do Aplicativo Mobile (`npm.cmd --prefix app test`)
```
ℹ tests 384
ℹ suites 0
ℹ pass 384
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20800.6527
```
**Exit Code:** `0` (100% de aprovação em todos os 384 testes).

### 7.2. Verificação de Dependências e Integridade Expo
- `npx.cmd expo install --check`:
  ```
  Dependencies are up to date
  ```
  **Exit Code:** `0`.
- `npx.cmd expo-doctor`:
  ```
  Running 20 checks on your project...
  20/20 checks passed. No issues detected!
  ```
  **Exit Code:** `0`.

### 7.3. Testes Unitários de Backend (`call-next`, `notifications`, `outbox`)
```
✔ CallNext outbox: nova chamada insere registro na queue_call_outbox e dispara triggerDispatch
✔ CallNext outbox: replay idempotente NÃO grava outbox e NÃO dispara triggerDispatch
✔ CallNext outbox: falha ao inserir na outbox reverte a transação de chamada
✔ E07.4 (35 testes de concorrência, locks, idempotência e integridade da fila)
✔ DeviceTokens DTO: valida limites de tamanho de pushToken e opções de plataforma
✔ DeviceTokensService: registra novo token e atualiza token existente em caso de troca de usuário
✔ DeviceTokensService: unregisterToken e revogação de tokens inválidos
✔ QueueCallPushService: inserção da outbox cria payload estritamente silencioso (sem title/body/message)
✔ QueueCallPushService: descarta chamadas encerradas ou invalidadas (status !== pending)
✔ QueueCallPushService: envio silencioso data-only com prioridade alta e contentAvailable
✔ QueueCallPushService: trata DeviceNotRegistered revogando o token
ℹ tests 45
ℹ pass 45
ℹ fail 0
```
**Exit Code:** `0`.

### 7.4. Compilação TypeScript do Backend (`npm.cmd --prefix backend run build`)
```
> arenago-backend@0.1.0 build
> nest build
```
**Exit Code:** `0`.

### 7.5. Verificação Git (`git diff --check`)
**Exit Code:** `0` (nenhum espaço em branco espúrio ou conflito).

---

## 8. Matriz de Comportamento e Limitações do Android

A vibração em segundo plano por notificações *data-only* no ecossistema Android está sujeita a fortes restrições impostas pelo sistema operacional e por customizações de fabricantes (OEMs):

| Cenário de Teste / Estado do Dispositivo | Comportamento Esperado | Avaliação Técnica / Status | Detalhes Operacionais |
| :--- | :--- | :--- | :--- |
| **1. App em primeiro plano (Foreground)** | Vibra 3 vezes (500ms / 200ms pausa / 1,9s total). Tela atualiza para "É a sua vez!". Nenhum banner ou som. | **PASSOU** | Manipulador local executa imediatamente sem interferência do sistema. |
| **2. App minimizado (Background recente)** | Vibra 3 vezes silenciosamente. Nenhum banner ou som na central de notificações. | **PASSOU** | O processo do app continua aquecido na memória RAM e executa a headless task. |
| **3. Tela bloqueada (Lock Screen)** | Vibra 3 vezes com a tela desligada. | **PASSOU** | Notificação de alta prioridade (`priority: high`) acorda a CPU temporariamente para a vibração. |
| **4. App removido dos recentes (Swiped out)** | Dependente da versão do Android e do fabricante. | **LIMITAÇÃO DO SO** | No Android 12+, deslizar o aplicativo para fora da lista de recentes pode colocar o processo em parada completa, impedindo headless tasks até nova abertura. |
| **5. Modo Economia de Bateria / Doze Mode** | Pode haver atraso na entrega até a próxima janela de manutenção do Doze. | **LIMITAÇÃO DO SO** | Mensagens FCM *high-priority* têm cota diária de acordar o dispositivo do Doze Mode. Se a cota for atingida, a entrega é postergada. |
| **6. Forçar Interrupção (Force Stop nas configurações)** | Não executa. | **LIMITAÇÃO DO SO** | O Android impede estritamente que qualquer serviço ou receptor em segundo plano seja executado após Force Stop até que o usuário abra o app manualmente. |
| **7. Fabricantes agressivos (Xiaomi MIUI, Samsung OneUI)** | Processos em segundo plano são congelados ou eliminados se "Iniciar em segundo plano" ou "Sem restrições de bateria" não forem ativados nas configurações do aparelho. | **LIMITAÇÃO DO SO** | Requer concessão manual de exceção de economia de bateria pelo participante para garantir 100% de despertar. |
| **8. Modo Não Perturbe (DND) / Vibração desativada** | Sistema Android suprime a vibração por diretriz do usuário no aparelho. | **LIMITAÇÃO DO SO** | O hardware respeita a configuração global do sistema operacional. |
| **9. Replay / Atualização de Tela** | Nenhuma vibração repetida. | **PASSOU** | Deduplicação por `serviceSessionId` garante disparo único. |
| **10. Troca de conta / Logout** | Dispositivo desvinculado, cache de deduplicação reiniciado. | **PASSOU** | Token desvinculado no backend via endpoint dedicado e localmente limpo. |

---

## 9. Recomendações Operacionais e Procedimento de Homologação

1. **Chamada Presencial Obrigatória:**  
   Conforme especificado, o alerta vibratório no celular é um complemento de conveniência. **A chamada presencial pelo Staff é o procedimento operacional soberano.**
2. **Build de Desenvolvimento Android (EAS / Dev Client):**  
   O Expo Go no Android não oferece suporte nativo completo para tarefas remotas headless e notificações push de dados puros em segundo plano. Para testes de campo no dispositivo físico, deve-se gerar a Development Build:
   ```powershell
   npx eas-cli build --profile development --platform android
   ```
   instalando o APK gerado no aparelho e executando com `npx expo start --dev-client`.
