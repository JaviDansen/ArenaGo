# ArenaGo — Arquitetura Backend unificada e dicionário PostgreSQL

**Versão:** v0.6.17 — desistência voluntária da fila interna, C-15; contrato futuro E07.3 (30/10/2026).
**Fonte funcional prevalente:** `PLANEJAMENTO_ARENAGO.md` (v0.7.10).
**Estado atual:** fundação NestJS/Drizzle e cinco migrações existentes; função TypeScript de normalização e consultas internas `EventsService.findById()`/`findByAccessCode()` implementadas. Nenhum endpoint HTTP de produto foi criado. Neon não foi criada.
**Escopo desta revisão (30/10/2026):** complemento documental C-15 após a entrega inicial da E07.1, com saída isolada da fila interna reservada à E07.3. Preservados os registros históricos; nenhum código, teste ou migração alterado.

> **Legenda de evidência:** **[APROVADO]** = decisão de produto já tomada; **[IMPLEMENTADO/RELATADO]** = execução informada pelo Codex, não verificada independentemente nesta revisão; **[PROPOSTA]** = contrato/lógica de serviço ainda sem implementação; **[PENDENTE]** = decisão/validação futura. O texto do dicionário representa o **desenho-alvo** que guiou a Task 6.2; detalhes exatos do SQL são autoridade do `backend/` e das migrations versionadas, sujeitos a conferência no próprio repositório.

## 0. Resumo executivo — o que existe e o que falta

| Item | Situação | Evidência/limite |
|---|---|---|
| Estrutura `backend/` | NestJS, TS, `pg`, Drizzle, configuração, README e módulo Events | Código local inspecionado nesta revisão |
| Modelo de dados | **[IMPLEMENTADO/RELATADO]** 23 tabelas, 5 migrações versionadas | Aplicadas em dois bancos locais novos pelo migrador; reexecução reconheceu o histórico |
| SQL de regras fundamentais | **[IMPLEMENTADO/RELATADO]** trigger de código de acesso imutável em `0002`; FK circular `ALTER TABLE` em `0004`; cinco checks de perfil | Catálogo reportado: 35 FKs, 104 constraints, 65 índices, 9 parciais |
| E01.2B — normalização/consulta de eventos | Função TypeScript compartilhada, consulta Drizzle por igualdade exata, testes unitários e cenários de integração adicionados | Verificações desta revisão registradas no histórico §24; integração somente com `arenago_events_test` local confirmado |
| APIs descritas nos capítulos 14–18 | **[PROPOSTA — NÃO IMPLEMENTADA]** | As rotas, DTOs, RFC 7807, Staff/Admin, avaliações e outros fluxos aguardam futura task |
| Neon, hospedagem, LGPD e piloto | **[NÃO CONFIGURADO / PENDENTE]** | Não usar dados pessoais reais nem declarar prontidão de produção |
| Commit da Task 6.2 | **[REGISTRADO LOCALMENTE]** | `4c4acbb` está no histórico da branch `develop` |

**Limite de escopo atual:** preservar a fundação; **não executar Task 6.3A nem implementar endpoints**. O documento descreve a API futura para evitar perda de decisões, não autoriza sua construção nesta etapa. Quatro vulnerabilidades moderadas no tooling foram reportadas por `npm audit` e aguardam triagem sem atualizações forçadas.

## 1. Arquitetura e fronteira de responsabilidade

- **Stack [APROVADO]:** Node.js + TypeScript, NestJS com Express padrão, monólito modular, PostgreSQL (Neon a provisionar), Drizzle ORM com `pg`, Drizzle Kit e migrações SQL versionadas. Sem Redis/microsserviços ou push obrigatório no MVP.
- **Transporte PostgreSQL remoto [APROVADO]:** usar TLS com verificação completa do certificado (`rejectUnauthorized: true`); nunca desativar a validação. A conexão remota/Neon ainda não está configurada.
- **Domínios:** Identity/Auth (identidade, sessão, tokens, TOTP e papéis); Profile/Games; Events; Participations; Queues/Services; Evaluations; BI/Privacy; Audit. Todos compartilham **um** esquema e **uma** história de migrações.
- **Relógio:** instantes em `timestamptz` (UTC no trânsito/API), apresentados usando `events.timezone` IANA. `birth_date` é `date` civil, sem timezone. Limites são validados no banco/backend, nunca pelo relógio do telefone.
- **Chaves:** `uuid` (preferência UUIDv7 sujeita à viabilidade real no stack) e contadores `bigint` por fila. `CHECK` limita estados estáticos; regras de elegibilidade, prontidão e janelas de tempo exigem transações/serviços.
- **Referência de nomenclatura:** `sessions` (não `auth_sessions`); `refresh_tokens`; `password_reset_tokens`; `email_verification_tokens`; `user_roles` (não duas tabelas de grants); `user_totp_credentials`, `user_backup_codes`, `totp_activation_tokens`; `audit_logs` (não `role_audit_logs`); `participation_profile_snapshots`.
- **Contagem:** **22 tabelas de domínio + `idempotency_operations` (23ª tabela técnica, presente nas migrações segundo Codex)**. Agregados de BI não são incluídos sem política e contrato de anonimização. Nenhum número de tabelas é limite de expansão.

## 2. Dicionário relacional de referência — 23 tabelas [DESENHO-ALVO]

### 2.1 Identidade e perfil (5)

#### 01. `users`

`id uuid PK`; `name varchar(150) NOT NULL`; `email varchar(255) NOT NULL`; `password_hash text NOT NULL`; `email_verified_at timestamptz NULL`; `is_active boolean NOT NULL DEFAULT true`; `created_at timestamptz NOT NULL`; `updated_at timestamptz NOT NULL`.

**Índices:** `UNIQUE (lower(btrim(email)))`; pesquisa por `id` já usa PK. E-mail é normalizado antes de inserir e a expressão protege concorrência. Senha mínimo 8 caracteres, sem regra artificial de composição, com bloqueio de senhas comprometidas. Exclusão depende de fluxo LGPD, não de `DELETE users` isolado.

#### 02. `profiles`

`user_id uuid PK FK → users(id)`; `birth_date date NOT NULL` (**Drizzle `date({mode:'string'})` recomendado para evitar serialização por fuso**); `gender varchar(30) NOT NULL`; `other_gender varchar(100) NULL`; `education varchar(30) NOT NULL`; `market_knowledge varchar(50) NOT NULL`; `market_interest varchar(50) NOT NULL`; `questionnaire_version_id uuid NOT NULL FK → questionnaire_versions(id)`; `completed_at timestamptz NOT NULL`; `created_at`, `updated_at timestamptz NOT NULL`.

**Índices e regras:** `PK(user_id)` assegura perfil atual 0..1. Tipos enumerados declarados apenas para inferência TypeScript no Drizzle **não** substituem validação efetiva via `CHECK`/DTO no PostgreSQL e API. `CHECK` para respostas válidas da versão conhecida, quando opções estáveis; regra condicional de `other_gender`. Questão não respondida significa **ausência de `profiles`**; consulta retorna `200` com `hasCompleted=false`. **Regra incorporada no esquema da Task 6.2 segundo relatório:** como a tabela representa somente questionários completos, `questionnaire_version_id` é `NOT NULL`; a versão deve estar publicada/válida antes de persistir o perfil e ser copiada para cada snapshot. Não persistir linha marcada como completa com jogos ausentes: `profiles` + `user_games` são mantidos em transação. Se opções mudarem, validação por versão no serviço evita `CHECK` global obsoleto. Cadastro/login independem de perfil; ingressar exige perfil válido e jogos ≥ 1. **Validação de `birth_date` [APROVADO]:** data civil real, não futura; aceitar até **hoje inclusive**, sem idade mínima presumida. Rejeitar conversões timezone que transformem a data de nascimento em outro dia. Backend é autoridade; alinhar a comparação do cliente ao calendário civil adotado pelo servidor, sem confiar no relógio do celular. Requisito de tratamento de dados de menores e limites etários permanece **[PILOTO]**, não uma regra presumida do DTO.

#### 03. `questionnaire_versions`

`id uuid PK`; `version varchar(40) UNIQUE NOT NULL`; `definition jsonb NOT NULL`; `activated_at timestamptz NULL`; `created_at timestamptz NOT NULL`.

**Regras:** o conteúdo publicado de uma versão não sofre reescrita retroativa; snapshots referenciam versão. Publicação e eventual troca de perguntas exigem estratégia de compatibilidade de respostas, **não** obrigam o app a gerar telas dinamicamente.

#### 04. `games`

`id uuid PK`; `name varchar(100) NOT NULL`; `is_curated boolean NOT NULL DEFAULT false`; `created_by_user_id uuid NULL FK → users(id) ON DELETE SET NULL`; `created_at timestamptz NOT NULL`.

**Índices:** `UNIQUE (lower(btrim(name)))`; `CHECK (length(btrim(name)) >= 1)`. O nome canônico já existente nunca deve ser sobrescrito por nova grafia. Usar `INSERT ... ON CONFLICT DO NOTHING RETURNING id` e, quando necessário, `SELECT` em **comando separado** sob `READ COMMITTED`, com retry delimitado e testes de concorrência real.

#### 05. `user_games`

`user_id uuid NOT NULL FK → users(id)`; `game_id uuid NOT NULL FK → games(id)`; `created_at timestamptz NOT NULL`; **`PK(user_id, game_id)`**; índice adicional `(game_id)` se usado em consultas. Substituição de seleção ocorre na mesma transação da atualização do perfil e sob serialização por usuário.

### 2.2 Autenticação, papéis e auditoria (9)

#### 06. `sessions`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `expires_at timestamptz NOT NULL`; `last_activity_at timestamptz NOT NULL`; `revoked_at timestamptz NULL`; `revocation_reason varchar(50) NULL`; `admin_2fa_verified_at timestamptz NULL`; `ip_address inet NULL` **[VALIDAR política de retenção]**; `user_agent varchar(255) NULL` **[VALIDAR minimização]**; `created_at timestamptz NOT NULL`.

**Índices:** `UNIQUE(user_id) WHERE revoked_at IS NULL`; índice `(user_id, created_at DESC)` opcional para suporte. O índice conta sessões expiradas mas ainda não revogadas: login precisa revogar a anterior **antes** de criar outra. JWT access 15 min + `sid` verificado em requisição protegida; sessão termina em prazo absoluto de 30 dias (refresh não o prolonga). Sessão Admin exige 2FA comprovado e papel ativo na consulta atual, não apenas claim JWT.

#### 07. `refresh_tokens`

`id uuid PK`; `session_id uuid NOT NULL FK → sessions(id)`; `token_hash char(64) NOT NULL UNIQUE`; `consumed_at timestamptz NULL`; `is_revoked boolean NOT NULL DEFAULT false`; `expires_at timestamptz NOT NULL`; `created_at timestamptz NOT NULL`.

**Índices:** `(session_id)`; índice único parcial candidato `UNIQUE(session_id) WHERE consumed_at IS NULL AND is_revoked = false` para impedir dois tokens correntes. Tokens opacos: somente hashes no banco. Todo token consumido reapresentado revoga a sessão (política **aprovada**); cliente Expo faz refresh *single-flight*, evita replay após timeout incerto e solicita login caso perca o token novo. Perda de login **não** cancela participação ou marca ausência.

#### 08. `password_reset_tokens`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `token_hash char(64) NOT NULL UNIQUE`; `expires_at timestamptz NOT NULL`; `used_at timestamptz NULL`; `created_at timestamptz NOT NULL`; `ip_address inet NULL` **[VALIDAR]**. Uso único; 30 minutos; resposta genérica; limite por conta (1 a cada 2 minutos, até 5/hora) e IP; reset consome token, atualiza senha e revoga sessões e tokens em transação.

#### 09. `email_verification_tokens`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `email varchar(255) NOT NULL`; `token_hash char(64) NOT NULL UNIQUE`; `expires_at timestamptz NOT NULL`; `verified_at timestamptz NULL`; `created_at timestamptz NOT NULL`.

**Regras:** token de uso único; confirmar o endereço ao qual foi emitido, não um e-mail alterado depois. Participante comum pode usar app sem e-mail verificado; Staff e Admin não podem obter privilégio antes da verificação. Validade de 24h proposta pela Task 6.1.

#### 10. `user_roles`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `role varchar(20) NOT NULL`; `event_id uuid NULL FK → events(id)`; `granted_by uuid NULL FK → users(id) ON DELETE SET NULL`; `granted_at timestamptz NOT NULL`; `revoked_at timestamptz NULL`; `revoked_by uuid NULL FK → users(id) ON DELETE SET NULL`.

**CHECK:** `role IN ('participante','staff','admin')` e `((role='staff' AND event_id IS NOT NULL) OR (role IN ('participante','admin') AND event_id IS NULL))`. **Índices:** `UNIQUE(user_id,role) WHERE revoked_at IS NULL AND event_id IS NULL`; `UNIQUE(user_id,role,event_id) WHERE revoked_at IS NULL AND event_id IS NOT NULL`; índice `(event_id,role) WHERE revoked_at IS NULL`. **Decisão técnica:** manter `participante` como papel base explícito da Task 6.1, sem impedir Admin/Staff de ter papéis cumulativos; participação de Admin como jogador continua **[PENDENTE produto]**, não bloquear por inferência. Conceder Staff somente se `events.id` existir e e-mail estiver verificado. Ao menos dois Admins ativos/verificados/TOTP antes de evento real; proteção da revogação dos dois últimos no serviço, com lock.

#### 11. `user_totp_credentials`

`id uuid PK`; `user_id uuid NOT NULL UNIQUE FK → users(id)`; `secret_encrypted text NOT NULL`; `is_verified boolean NOT NULL DEFAULT false`; `verified_at timestamptz NULL`; `created_at`, `updated_at timestamptz NOT NULL`.

**CHECK:** coerência entre `is_verified` e `verified_at`. Segredo cifrado com chave fora do banco; TOTP pendente não concede privilégio. Bootstrap CLI restrito só para o primeiro Admin ainda sem TOTP ativado; reset de TOTP já confirmado exige outro Admin com TOTP.

#### 12. `user_backup_codes`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `code_hash char(64) NOT NULL UNIQUE`; `used_at timestamptz NULL`; `created_at timestamptz NOT NULL`. Códigos de uso único; rotacionar/remover de forma atômica durante reset, depois de validar permissão e estado da credencial. **[VALIDAR nos services]** Preferir códigos suficientemente aleatórios e hash com chave do servidor (HMAC-SHA-256) ou hash lento; evitar SHA-256 puro com códigos curtos ou previsíveis.

#### 13. `totp_activation_tokens`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `token_hash char(64) NOT NULL UNIQUE`; `issued_by uuid NULL FK → users(id) ON DELETE SET NULL`; `expires_at timestamptz NOT NULL`; `used_at timestamptz NULL`; `revoked_at timestamptz NULL`; `created_at timestamptz NOT NULL`.

**Regra:** token independente de senha/tempToken, uso único, expiração curta (Task 6.1 propõe 30 minutos). Ativação do primeiro Admin e reinício de setup pendente têm origem restrita/auditável; CLI nunca redefine TOTP já ativado.

#### 14. `audit_logs`

`id uuid PK`; `actor_user_id uuid NULL FK → users(id) ON DELETE SET NULL`; `target_user_id uuid NULL FK → users(id) ON DELETE SET NULL`; `event_id uuid NULL FK → events(id)`; `origin varchar(12) NOT NULL`; `category varchar(40) NOT NULL`; `action varchar(80) NOT NULL`; `reason text NULL`; `metadata jsonb NOT NULL DEFAULT '{}'`; `occurred_at timestamptz NOT NULL`; `redacted_at timestamptz NULL`.

**CHECK:** `origin IN ('user','system','cli')`; índice `(event_id,occurred_at)`, `(actor_user_id,occurred_at)`, `(target_user_id,occurred_at)` para busca autorizada. Ação sensível + auditoria **na mesma transação**; não registrar senhas, refresh, QR/TOTP, ativação ou payload integral. `actor_user_id=NULL` e `origin='cli'` no bootstrap. Auditoria imutável pelas rotas comuns, mas com expurgo/desidentificação controlados por política de privacidade **[PILOTO]**; sem trigger de imutabilidade física irrestrita.

### 2.3 Eventos, filas e avaliação (8)

#### 15. `events`

`id uuid PK`; `name varchar(180) NOT NULL`; `access_code_normalized varchar(64) NOT NULL`; `timezone varchar(80) NOT NULL`; `starts_at timestamptz NOT NULL`; `official_ends_at timestamptz NOT NULL`; `operational_deadline_at timestamptz NOT NULL` (**prazo originalmente configurado/atualmente programado, antes de antecipação Admin**); `status varchar(20) NOT NULL`; `external_queue_enabled boolean NOT NULL`; `external_last_order bigint NOT NULL DEFAULT 0`; `closure_mode varchar(20) NULL`; `closure_requested_at timestamptz NULL`; `admin_deadline_at timestamptz NULL` (**novo ajuste proposto: prazo antecipado pelo Admin**); `created_at`, `updated_at timestamptz NOT NULL`.

**CHECK atualmente implementado:** status, horários, contador externo, `access_code_normalized = upper(btrim(access_code_normalized))` e coerência do fechamento Admin. Para código, esse CHECK somente exige a representação compatível com `upper(btrim(...))`; não restringe ASCII, 4–64 caracteres, posição de hífens, nem equivale ao conjunto de whitespace de `String.trim()` do JavaScript.

**Índice:** `UNIQUE(access_code_normalized)` sobre **todo histórico**, sem reutilização. Eventos arquivados não são apagados fisicamente na primeira versão; se exclusão física futura for aprovada, código precisa de *tombstone*/reserva permanente. `timezone` IANA não pode ser validado apenas com `CHECK` simples: validar biblioteca/serviço. Prontidão aprovada: nome/código/horários/fuso/fila externa configurada, ≥1 experiência com estação disponível e ≥1 Staff ativo/verificado do evento, **sem exigir Staff online**.

**C-10 [APROVADO] e normalização:** somente ASCII `A–Z`, `0–9` e hífen; 4–64 caracteres depois de `String.trim()`; hífens apenas entre grupos alfanuméricos, sem começo/final/consecutivos. A pesquisa ignora caixa e whitespace externo reconhecido por JavaScript `String.trim()`. Espaços internos, acentos, símbolos e demais caracteres Unicode não ASCII são inválidos. `backend/src/events/access-code.ts` valida o alfabeto antes de converter para maiúsculas e exporta `normalizeEventAccessCode()`, compartilhada pela consulta atual e pela futura criação. O `UNIQUE` preserva unicidade da chave já normalizada; trigger `0002` protege imutabilidade. O SQL atual não garante sozinho todo o formato aprovado. Uma restrição SQL adicional poderá ser avaliada após auditoria dos dados e exigirá migração incremental; **nenhuma migração foi criada agora**.

**Dois cortes diferentes:** parar **entradas** em `min(official_ends_at, closure_requested_at se existir)`; parar **chamadas e conclusões** em `min(operational_deadline_at, admin_deadline_at se existir)`. Um Admin imediato cancela pendências e finaliza participações; modo controlado deixa apenas serviços de pessoas já na fila até prazo antecipado. Armazenar justificativa e alterações em `audit_logs`, inclusive valores anteriores. `status` persistido não substitui avaliação da hora/prontidão. Abertura automática a partir de `starts_at` somente quando pronto; admitir configuração completada depois do início enquanto ainda antes do corte oficial.

#### 16. `experiences`

`id uuid PK`; `event_id uuid NOT NULL FK → events(id)`; `name varchar(160) NOT NULL`; `queue_accepting_entries boolean NOT NULL DEFAULT true`; `last_queue_order bigint NOT NULL DEFAULT 0`; `created_at`, `updated_at timestamptz NOT NULL`.

**Índices:** `UNIQUE(id,event_id)` auxiliar para FKs compostas; `(event_id)` para listagens; `CHECK(last_queue_order >= 0)`. Uma experiência por evento e uma fila compartilhada entre suas estações. Lock curto da **linha da experiência** serializa atribuição de ordem e chamada FIFO; não usa contador global para todas as filas.

#### 17. `stations`

`id uuid PK`; `experience_id uuid NOT NULL FK → experiences(id)`; `label varchar(120) NOT NULL`; `availability varchar(20) NOT NULL`; `created_at`, `updated_at timestamptz NOT NULL`.

**CHECK:** `availability IN ('available','unavailable')`; `UNIQUE(id,experience_id)` auxiliar; índice `(experience_id,availability)`. Estação indisponível não deve ter pendência nova. Desativação bloqueada enquanto existir `service_sessions.status='pending'`. Não duplicar estado de ocupação ou atribuição permanente de Staff à estação.

#### 18. `participations`

`id uuid PK`; `user_id uuid NOT NULL FK → users(id)`; `event_id uuid NOT NULL FK → events(id)`; `status varchar(20) NOT NULL`; `joined_at timestamptz NOT NULL`; `external_queue_order bigint NULL`; `arena_entered_at timestamptz NULL`; `finished_at timestamptz NULL`; `finish_reason varchar(40) NULL`; `current_queue_entry_id uuid NULL` (**FK composta posterior**).

**CHECK:** `status IN ('waiting','active','finished','canceled')`; `status='waiting'` implica que ainda não entrou na Arena (`arena_entered_at IS NULL`); terminal requer `finished_at` e `finish_reason`; corrente não os possui; `external_queue_order > 0` quando não nulo. **Índices:** `UNIQUE(user_id) WHERE status IN ('waiting','active')`; `UNIQUE(event_id, external_queue_order)` para todas as ordens, `UNIQUE(id,event_id)` para FK composta; `(event_id,status)`; `(user_id,joined_at DESC)`. Ao cancelar espera externa voluntariamente: `canceled`, sem avaliação; ao terminar Arena voluntariamente ou após encerramento automático: `finished`, com `finish_reason` distinto. Não inferir presença até cutoff como saída voluntária.

#### 19. `queue_entries`

`id uuid PK`; `participation_id uuid NOT NULL`; `event_id uuid NOT NULL`; `experience_id uuid NOT NULL`; `queue_order bigint NOT NULL`; `status varchar(20) NOT NULL`; `entered_at timestamptz NOT NULL`; `closed_at timestamptz NULL`; `close_reason varchar(40) NULL`.

**CHECK:** `status IN ('waiting','called','closed')`; `queue_order > 0`; `closed` requer hora e motivo; `waiting/called` não possuem motivo/hora terminal. **FKs compostas:** `(participation_id,event_id) → participations(id,event_id)`; `(experience_id,event_id) → experiences(id,event_id)`; `UNIQUE(id,participation_id)` e `UNIQUE(id,experience_id)` auxiliares. **Índices:** `UNIQUE(experience_id,queue_order)` histórico; `UNIQUE(participation_id) WHERE status IN ('waiting','called')`; índice `(experience_id,queue_order,id) WHERE status='waiting'` para selecionar o próximo FIFO. Nova tentativa, inclusive após ausência antes do **corte efetivo de novas entradas** (o mais cedo entre horário oficial e encerramento Admin), gera **nova linha e nova ordem**. Depois desse corte, ausência não cria fila nova.

**FK circular:** depois de criar `queue_entries`, adicionar `(participations.current_queue_entry_id,participations.id) → queue_entries(id,participation_id)` (coluna de referência opcional), através de `ALTER TABLE`. O serviço atualiza referência e estado da entrada na mesma transação; presença de coluna não substitui parcial unique.

#### 20. `service_sessions`

`id uuid PK`; `queue_entry_id uuid NOT NULL UNIQUE`; `experience_id uuid NOT NULL`; `station_id uuid NOT NULL`; `called_by_user_id uuid NULL FK → users(id) ON DELETE SET NULL`; `called_at timestamptz NOT NULL`; `status varchar(20) NOT NULL`; `resolved_by_user_id uuid NULL FK → users(id) ON DELETE SET NULL`; `resolved_at timestamptz NULL`; `cancel_reason varchar(40) NULL`.

**CHECK:** `status IN ('pending','completed','absent','canceled')`; `pending` sem resolução; terminal requer `resolved_at`; cancelamento precisa de motivo e a resolução manual é associada a Staff quando aplicável. **FKs compostas:** `(queue_entry_id,experience_id) → queue_entries(id,experience_id)`; `(station_id,experience_id) → stations(id,experience_id)`. **Índices:** `UNIQUE(station_id) WHERE status='pending'`; `UNIQUE(queue_entry_id)`; `(experience_id,status,called_at)` e `resolved_at` para métricas conforme consultas. Resultado `completed` é o único que conta como experiência concluída. Ausência não é conclusão; cancelamento por desistência/limite/admin não é ausência. Staff autorizado pelo evento da experiência e estação selecionada na operação.

#### 21. `evaluations`

`id uuid PK`; `participation_id uuid NOT NULL UNIQUE FK → participations(id)`; `rating smallint NOT NULL`; `comment text NULL`; `submitted_at timestamptz NOT NULL`; `updated_at timestamptz NOT NULL`; `first_comment_at timestamptz NULL`.

**CHECK:** `rating BETWEEN 1 AND 5`. Somente participação finalizada com ≥1 sessão `completed`, uma avaliação por participação. Primeiro envio até 30 dias após `finished_at`. Edição integral até 7 dias após o primeiro envio; dias 8–30 só acrescentar **uma vez** comentário se nunca houve, sem alterar nota. Após 30 dias fica final. Elegibilidade calculada sob transação/consulta, sem tabela `pending_evaluations`.

#### 22. `participation_profile_snapshots`

`participation_id uuid PK FK → participations(id)`; `questionnaire_version_id uuid NOT NULL FK → questionnaire_versions(id)`; `answers jsonb NOT NULL`; `games_snapshot jsonb NOT NULL`; `age_band_at_event varchar(30) NULL` (**candidato sujeito a minimização**); `captured_at timestamptz NOT NULL`.

**Índices:** `PK(participation_id)`, `(questionnaire_version_id)` se consultas requererem. Snapshot da **mesma versão e respostas** efetivas no instante de ingressar, com nomes canônicos dos jogos. Não duplicar data completa de nascimento quando não necessária. Imutável contra edições comuns de perfil, porém **excluível por procedimento LGPD autorizado**: não instalar trigger indiscriminada `BEFORE UPDATE OR DELETE RAISE EXCEPTION`. Exigir criação atômica junto de `participations`.

### 2.4 Tabela técnica de idempotência (1)

#### 23. `idempotency_operations`

`id uuid PK`; `actor_user_id uuid NOT NULL FK → users(id)` (**exclusão controlada: apagar a linha auxiliar junto com a conta**); `operation varchar(80) NOT NULL`; `idempotency_key varchar(128) NOT NULL`; `request_hash char(64) NOT NULL`; `status varchar(20) NOT NULL` (`in_progress`/`completed`); `http_status smallint NULL` (**nulo apenas durante reserva não publicada**); `result_reference uuid NULL`; `result_payload jsonb NULL` (**somente resposta mínima não sensível**); `created_at timestamptz NOT NULL`; `expires_at timestamptz NOT NULL`. **CHECK** coerência: `status='in_progress'` exige `http_status IS NULL`; `status='completed'` exige `http_status IS NOT NULL`. A linha incompleta não deve ficar visível após `COMMIT` de uma operação de sucesso.

**Índices:** `UNIQUE(actor_user_id, operation, idempotency_key)` e `(expires_at)` para expurgo. Inserir reserva `in_progress`, efeito de negócio e atualização da reserva para `completed` + resultado **na mesma transação**, ou reverter tudo; não deixar `in_progress` persistido indefinidamente. Transação concorrente com a mesma chave aguarda/respeita a unicidade e então valida `request_hash`: mesmo hash devolve resultado estável, hash diferente recebe `409`. Uma intenção nova usa chave nova. Expiração/expurgo precisa de prazo por contrato **[VALIDAR]**; não permitir replay indevido de efeitos depois do expurgo sem também validar estados de domínio. Não utilizar essa tabela em `/auth/refresh` (reuso estrito aprovado). Não persistir segredos ou payload pessoal completo.

## 3. Mapa de integridade cruzada e restrições

| Relação/risco | Garantia relacional proposta | Limite do banco |
|---|---|---|
| Participação pertence a evento | `UNIQUE(participations.id,event_id)` | Não verifica abertura do evento |
| Experiência pertence a evento | `UNIQUE(experiences.id,event_id)` | Não verifica prontidão |
| Entrada de fila cruza eventos | `queue_entries(participation_id,event_id)` e `(experience_id,event_id)` como FKs compostas | Precisa DDL em ordem correta |
| Atendimento usa estação de outra experiência | FKs `(queue_entry_id,experience_id)` e `(station_id,experience_id)` | Não substitui autorização Staff |
| Ponteiro de fila aponta para outra participação | FK `(current_queue_entry_id,id) → queue_entries(id,participation_id)` | Validar estado/pointer atomicamente |
| Duas participações correntes do mesmo usuário | Partial unique `(user_id)` onde `status IN ('waiting','active')` | Reentrada legítima cria nova participação após finalizar anterior |
| Fila duplicada do mesmo participante | Partial unique `(participation_id)` em entradas `waiting/called` | Retorno após ausência gera nova linha fechando anterior primeiro |
| Uma chamada pendente em estação | Partial unique `(station_id)` onde `status='pending'` | Disponibilidade é regra transacional |
| Duas chamadas para uma tentativa | `UNIQUE(service_sessions.queue_entry_id)` | Chamadas diferentes requerem novas entradas |
| Avaliação/snapshot duplicados | `UNIQUE(participation_id)`/`PK(participation_id)` | Eligibility e prazo são regra backend |
| Código de evento reutilizado | `UNIQUE(events.access_code_normalized)` sem hard-delete de evento | Tombstone obrigatório se houver hard-delete futuro |
| Duas sessões não revogadas | Partial unique `(user_id)` em sessões `revoked_at IS NULL` | Revogação de sessão expirada deve ocorrer no novo login |
| Duas credenciais refresh utilizáveis | Unique parcial por `session_id` consumido/revogado = false | Confirmar DDL e concorrência em PG real |

**Chaves compostas:** FKs como `(queue_entry_id,experience_id)` devem apontar a **restrições UNIQUE completas (não parciais)** nas colunas referenciadas; índices únicos parciais servem às exclusividades de estado, **não** como alvo de FK. A ordem dos elementos das FKs deve corresponder exatamente à ordem das colunas referenciadas.

**Null e estados:** todas as FKs compostas de ponteiro usam a regra `MATCH SIMPLE` padrão: quando `current_queue_entry_id IS NULL`, o vínculo é opcional. `CHECK` não referencia outras tabelas: prontidão, elegibilidade, contagem de Admins e transições são regras de serviço + locks + índices.

## 4. Transações críticas de serviços futuros [PROPOSTA A VALIDAR]

**Princípio:** usar `READ COMMITTED` com bloqueios curtos, invariantes únicos no banco e retentativas limitadas apenas onde for seguro. Fazer todos os fluxos que se cruzam seguir ordem compatível; **não** prometer “zero deadlocks” sem testes reais.

| Operação | Ordem indicada | Efeito atômico |
|---|---|---|
| Ingresso + snapshot | `events FOR UPDATE` → `users FOR UPDATE` → `profiles`/`user_games` consistentes → `participations`/snapshot | Checar relógio e prontidão, criar participação e snapshot ou nenhum; unicidade global por usuário |
| Atualizar questionário | `users FOR UPDATE` → `profiles` → `user_games` | Previne snapshot híbrido, sempre com read do conjunto após user lock |
| Ingressar/sair fila interna | `events FOR SHARE` → `experiences FOR UPDATE` → `participations FOR UPDATE` → `queue_entries`; se chamada, incluir `stations FOR UPDATE` antes de participação e `service_sessions` depois da entrada | Incrementar ordem somente no ingresso; desistência C-15 encerra a entrada e limpa o ponteiro sem finalizar a participação; ver §16.2 para chamada pendente |
| Chamar próximo na estação | `events FOR SHARE` → `experiences FOR UPDATE` → `stations FOR UPDATE` → `participations`/`queue_entries FOR UPDATE` | FIFO estrito, reservar uma pessoa para uma estação; duas estações chamam pessoas distintas |
| Concluir/ausência/desistência | `events FOR SHARE` → `experiences FOR UPDATE` → `stations FOR UPDATE` quando chamada → `participations`/`queue_entries` → `service_sessions` | Um único resultado terminal; ausência reentra no fim **somente antes** do corte efetivo de novas entradas (oficial ou Admin) |
| Encerramento Admin | `events FOR UPDATE` → avançar nos registros por lotes sob locks compatíveis | Bloqueio lógico efetivo imediatamente no commit; limpeza idempotente sem falsos completados |
| Novo login | `users FOR UPDATE` → sessões anteriores → nova sessão/refresh | Sessão única com revogação da anterior |
| Reset de senha | identificar token sem lock → `users FOR UPDATE` → `sessions` → `refresh_tokens` e token de reset sob lock, revalidado | Senha, consumo de token e revogações atômicos |
| Refresh token | identificar `user_id/session_id` **sem lock** pelo hash → `users FOR UPDATE` → `sessions FOR UPDATE` → `refresh_tokens FOR UPDATE`, **revalidando** token após bloqueio | Consumo estrito e detecção de reuso com ordem compatível com reset/login |
| TOTP ativação/reset | `users` → `user_totp_credentials` → `totp_activation_tokens` → `user_backup_codes` (conforme Task 6.1) | Não ativar TOTP indevidamente nem permitir reset via CLI após confirmação |

**Correção em relação à Task 6.1:** a versão da Task propõe `refresh_tokens FOR UPDATE` antes de `sessions`, enquanto redefinição de senha trava `users`/`sessions` antes de tokens. Isso pode gerar espera circular. A ordem acima é **recomendação de compatibilização a implementar e validar**; o lookup inicial sem lock **não autoriza** renovar, apenas identifica linhas a travar. Validar que `session_id/user_id` não mudou e que o token não foi consumido depois dos locks. O resultado de reuso continua revogando a sessão.

**Conflitos de Arena:** operações sobre uma estação/participação podem requerer leitura prévia de IDs para estabelecer ordem (evento/experiência/estação), seguida de **revalidação após locks**. Nunca fazer `participations FOR UPDATE` antes de `experiences FOR UPDATE` em um fluxo que concorre com Staff, e o contrário em outro. Não aplicar `SKIP LOCKED` ao primeiro da fila se isso quebrar FIFO.

**Fechamento vs chamadas:** os ensaios DB-11/DB-12/V11-09 usaram `events FOR UPDATE` para serializar **ingresso, revalidação temporal e concorrência com edição estrutural**, não para homologar esse mesmo lock em todos os serviços. Para entrar em fila, chamar próximo e concluir atendimento, a proposta mantém `events FOR SHARE` + `experiences FOR UPDATE`: isso permite transações em experiências diferentes sem travamento exclusivo global do evento, mas ainda precisa de testes dos services (T19). Fechamento Admin adquire `events FOR UPDATE`, aguardando operações relevantes; após seu commit, bloqueia as futuras. A data de corte também deve ser revalidada **após adquirir locks e o mais próximo possível da mutação decisiva**, com relógio atual (`clock_timestamp()` no PostgreSQL; `now()` é fixado no início da transação). Para alterações críticas, preferir uma condição temporal no próprio `UPDATE`/`INSERT ... SELECT` relevante, conferindo linhas afetadas, sem confiar no horário informado pelo app. O instante de commit pode ocorrer depois da verificação; limitar duração de transações e testar bordas, **sem prometer precisão em milissegundos que o banco não garante**.

**Jobs:** periódicos e na inicialização, reexecutáveis/idempotentes. O guard temporal por requisição continua funcionando caso o job fique atrasado ou o servidor caia.

## 5. Estados, cronologia e contratos operacionais [APROVADO]

- **Evento:** `scheduled → open → closing → closed` como estados de exibição persistida; horários/prontidão prevalecem se estado defasado. Abre automaticamente a partir de `starts_at` apenas estando pronto; se ficar pronto mais tarde, pode aceitar entradas até o início do corte oficial.
- **Participação:** `waiting`, `active`, `finished`, `canceled`; `finish_reason` distingue finalização voluntária, automática, administrativa e cancelamento de espera externa.
- **Fila interna:** `waiting`, `called`, `closed`; `close_reason` preserva resultado. Atendimento: `pending`, `completed`, `absent`, `canceled`.
- **Horário oficial:** depois de `official_ends_at`, nenhuma nova participação/reentrada/entrada interna/retorno após ausência. Janela operacional **opcional** até 60 minutos apenas para chamadas/atendimentos já aguardando; no prazo definitivo, cancelar pendências e finalizar participações, preservando conclusões.
- **Admin imediato:** bloquear agora, cancelar pendências e finalizar todos os atuais; **Admin controlado:** encerrar novas entradas agora, finalizar também a fila externa preexistente naquele instante (sem avaliação), mantendo filas e atendimentos internos preexistentes até o prazo antecipado permitido.
- **Fim automático no app:** ao reabrir consultar servidor; encaminhar à avaliação **apenas se elegível, pendente e no prazo**, com “Avaliar mais tarde”; não enviar indiscriminadamente à Home.
- **Avaliações:** primeira até 30 dias depois da finalização, integralmente editável por 7 dias após submissão, depois possibilidade de adicionar comentário antes inexistente uma única vez até dia 30, sem alterar nota, passado isso bloqueada.
- **BI:** distinguir entrada Arena→última conclusão Staff de entrada Arena→saída **voluntária**; jamais considerar limpeza como saída voluntária.

## 6. API futura: mapa de contratos [NÃO IMPLEMENTADO]

| Domínio | Rotas/capacidades | Pontos a verificar no código real |
|---|---|---|
| Conta/sessão | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` | Estado de sessão após reabrir app; single-flight; `401` real vs falha de rede |
| Recuperação/email | `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email/request`, `/confirm` | Deep link versus página web e envio real de e-mails |
| Perfil/jogos | `GET/PATCH /profile`, `GET/PUT /profile/questionnaire`, `GET /games` | `birthDate`, `gender`, `otherGender`, `education`, `selectedGames`, `marketKnowledge`, `marketInterest`, enums reais, validação de jogos |
| Admin | `/auth/2fa/setup`, `/auth/2fa/verify`, concessões/revogações e reset/reemissão TOTP | Permissões atuais, 2FA no acesso, auditoria e justificativas |
| Eventos | Consulta por código, cadastro, edição pré-corte e status | Normalização do código, prontidão, fuso horário, abertura automática |
| Participações | Ingressar, consultar participação atual, finalizar/desistir, histórico | Snapshot atômico; reingresso; não redirecionar cegamente à Home |
| Fila/Staff | Ingressar fila, sair, posição, chamar próximo, concluir, ausência | FIFO por experiência, duas estações, estado de estação, idempotência |
| Avaliações | Consultar elegibilidade/pendências, enviar/editar | Prazos, comentário tardio e fluxo pós-fechamento |
| BI | Totais, indicadores e futura exportação manual | Dados agregados, métricas distintas, LGPD e controle de acesso |

**Base externa:** Task 6.1 tem DTOs propostos para identidade/questionário e API RFC 7807; são insumo técnico, não prova de que os arquivos Expo atuais ainda correspondam exatamente. **[VALIDAR]** extrair campos e fluxo de navegação do repositório real antes de congelar contratos DTO.

## 7. Privacidade e exclusão [PENDENTE ANTES DO PILOTO]

- **Aprovado:** preservar apenas agregados estatísticos **efetivamente seguros** após exclusão quando cabível; não manter histórico individual identificável só para facilitar BI.
- **Pendente e bloqueante antes do piloto real:** base legal, política de retenção, supressão de grupos pequenos, comentários e textos livres, métricas depois da exclusão, snapshots, backups, auditoria e comprovação de expurgo.
- `participations.user_id` e snapshots identificáveis **não** devem permanecer ligados ao titular após processo de exclusão quando não houver base legítima para retenção. Projeto relacional suporta limpeza controlada; procedimento final precisa de desenho e testes (a exclusão direta de `users` sob FKs `RESTRICT` seria incorreta).
- Mecanismo de agregados seguros, se necessário (`bi_aggregates` ou equivalente), **não está aprovado como tabela**. Desenhar contagens sem duplicação, edições de avaliações e supressão conforme política, antes de implementar exclusão real.
- `audit_logs` guarda razão/metadata mínimos e exige redaction/retention; tokens de sessão são revogados, filas/atendimentos fechados coerentemente com evento.

## 8. Histórico único de cinco migrações [IMPLEMENTADO/RELATADO]

| Ordem | Arquivo | Conteúdo |
|---|---|---|
| 0001 | `0001_identity_profile.sql` | `users`, `questionnaire_versions`, `profiles`, `games`, `user_games` |
| 0002 | `0002_events_base.sql` | `events` e proteção versionada de **imutabilidade do código de ingresso** |
| 0003 | `0003_credentials_roles.sql` | `sessions`, tokens, papéis, TOTP e auditoria |
| 0004 | `0004_event_operations.sql` | experiências, estações, participações, filas, serviços, snapshots, avaliações e **FK circular por `ALTER TABLE`** |
| 0005 | `0005_idempotency.sql` | operações idempotentes e índices/restrições |

A Task 6.2 informou aplicação em **dois bancos PostgreSQL locais 16.15 vazios** pelo mecanismo de migrações do projeto (Drizzle), com segunda execução sobre o primeiro banco sem reaplicação indevida; `drizzle-kit check`, compilação e lint passaram. Preservar **SQL, metadata/snapshots e journal** como um único histórico. **Não reescrever migrações já aplicadas**; futuras mudanças devem gerar novas migrações incrementais. Trigger e FK circular versionados foram reportados, mas o SQL real não foi disponibilizado para conferência nesta revisão. A migração `0002` imobiliza o código de ingresso, em conformidade com C-10.

A Neon permanece sem projeto. O banco local foi de teste; esta validação não comprova comportamento de uma API ainda inexistente nem libera a operação com dados pessoais reais.

## 9. Testes de aceitação dos serviços futuros [NÃO EXECUTADOS INTEGRALMENTE]

| ID | Cenário | Esperado |
|---|---|---|
| T01 | Duas estações Just Dance chamam simultaneamente | João e Maria distintos, em FIFO, sem chamada dupla |
| T02 | Um usuário tenta ingressar simultaneamente em eventos diferentes | Apenas uma participação corrente |
| T03 | Dois cliques “Entrar na fila” / retry da mesma chave | Uma entrada, sem quebrar reentrada legítima posterior |
| T04 | Staff conclui enquanto usuário finaliza voluntariamente | Uma transição terminal coerente, sem concluir cancelado |
| T05 | Staff registra ausência antes/depois do corte oficial ou Admin antecipado | Retorno ao fim **só antes** do primeiro corte efetivo de novas entradas |
| T06 | Chamadas e conclusão na fronteira do limite operacional | Nunca autorizar com base apenas no horário de início da requisição |
| T07 | Admin encerra imediatamente às 18h num evento T=20h | Corte imediato, pendências canceladas, participações finalizadas, histórico concluído preservado |
| T08 | Admin controlado às 18h com T=20h, deadline original 21h | Nova entrada bloqueada 18h; serviços até no máximo 19h; hora oficial e programada preservadas |
| T09 | Tarefa automática atrasa/falha/reexecuta | API segue bloqueios, limpeza idempotente, sem ausência falsa |
| T10 | Login concorrente, reset de senha, refresh sob concorrência | Sessão única e sem deadlock persistente; refresh consumido revoga sessão |
| T11 | Resposta de refresh perdida e depois login | Login recupera a mesma participação/posição, sem ausência |
| T12 | Conta Admin perde celular TOTP / setup incompleto | Fluxos formalmente autorizados; CLI não redefine fator já ativado |
| T13 | FK de serviço com estação de outra experiência | Banco rejeita cross-reference |
| T14 | Questionário incompleto/concurrentemente editado | Ingresso bloqueado ou snapshot integral da mesma versão; nunca híbrido |
| T15 | Evento agendado, sem Staff/estação pronta vs após configurar | Não abre sem prontidão; abre automaticamente quando pronto e em horário válido |
| T16 | Código evento duplicado com case/espaços | Banco rejeita; histórico não reutiliza |
| T17 | Avaliação criada/editada por requisições simultâneas | Apenas uma avaliação, prazos e nota corretos |
| T18 | Exclusão de conta após serviços e BI histórico | Processo definido por LGPD preserva somente agregados seguros; sem FKs bloqueando procedimentos legítimos |
| T19 | Duas experiências diferentes processam chamadas | Não bloquear todas as filas via lock exclusivo de evento |
| T20 | Dois `401` simultâneos no Expo | No máximo um refresh por sessão no cliente; sem replay automático inseguro |

## 10. Pendências efetivas (após a Task 6.2)

**Sem autorização para implementar agora:** contratos REST dos capítulos 14–18; segurança de sessão/TOTP; validação dinâmica de prontidão, locks cross-table, gerenciamento de filas, fechamento automático e Admin, avaliações, recuperação do Expo e BI. Os testes DB da Task 6.2 são de banco/protocolos mínimos, não equivalem às suítes completas T/EV/ST/AV/AD/OP.

**A detalhar quando o módulo correspondente for retomado:** contas Admin como jogadores (**decisão de produto pendente**), calendário civil de referência para validação de nascimento, retenção da tabela de idempotência e dos IPs/user-agent, catálogo único de DTOs/erros e integração com telas atuais. A decisão C-10 e a normalização da consulta estão definidas; criação de eventos deve reutilizar a função existente.

**Antes do piloto real:** política e base legal LGPD, tratamento de menores, expurgo/deleção de snapshots identificáveis, anonimização/BI, retenção/auditoria/backups, dois Admins verificados com TOTP, segurança operacional, e testes E2E/dispositivos/carga. Nenhuma dessas questões é resolvida apenas por DDL.

## 11. Histórico de análise [RESUMO, NÃO ESTADO ATUAL]

- v0.6.1–v0.6.3: inspeção estática, conciliação com Task 6.1 e auditoria do frontend relatada pelo Codex (95 testes locais, não serviços remotos). São **evidências históricas**.
- v0.6.4–v0.6.10: proposta dos contratos REST e validação das regras C-01 a C-14. Essas regras de produto permanecem aprovadas, mas **nenhuma rota foi implementada**.
- v0.6.11: laboratório PostgreSQL/Drizzle criou 23 tabelas e executou DB-01 a DB-16; o relatório não provava NestJS.
- v0.6.12: cinco migrações SQL foram aplicadas em sequência em PostgreSQL temporário via `psql`, ainda **antes** da fundação.
- **Task 6.2 (estado vigente):** backend, cinco migrações e integridade local implementados conforme relatório mais recente; detalhes no §23. O histórico detalhado permanece recuperável nas versões anteriores do Git, sem necessidade de duplicação integral neste arquivo.

## 12. Compatibilidade com o frontend e decisões já fechadas

A auditoria do Expo reportou cadastro/login mocks, senha mínima cliente de 6 vs backend planejado de 8, formulário de três etapas com sete campos, 20 jogos exemplificativos, fila externa/interna simuladas, avaliação exibida sem elegibilidade real e três cartões de histórico mockados. Esses comportamentos não foram rechecados diretamente na revisão documental atual. **Nenhuma integração deve ser apresentada como implementada.**

Continuam **[APROVADAS]**: `birthDate` válido até hoje inclusive (não há idade mínima inventada), cadastro encaminhando imediatamente ao questionário sem botão para pular, login permitido apesar do questionário pendente e bloqueio apenas no ingresso, refresh estrito, código de ingresso único e imutável, ausência após corte sem reentrada e C-13/C-14. A Task 6.1 antiga não prevalece sobre essas decisões.

## 13. Convenções de interpretação dos contratos a seguir

As seções 14–18 são **especificações técnicas candidatas**. Exemplos JSON são ilustrativos; endpoints, DTOs, respostas, idempotência, métodos de autorização e telas Staff/Admin permanecem **não implementados**. O prefixo proposto é `/api/v1`, erros RFC 7807. Nenhuma delas representa autorização para executar Tasks 6.3 ou seguintes neste momento.

## 14. Contratos de integração v0.1 — identidade, perfil, questionário e jogos (19/10/2026)

**Estado:** contrato técnico proposto para revisão conjunta (backend + Expo). Este capítulo **não é código**, não altera migrações e não significa que os endpoints existam. Consolida a Task 6.1 v1.1, as decisões de produto do Planejamento v0.7.4 e os achados do relatório do Codex (95 testes locais, 0 de integração). Os contratos de eventos, filas, atendimentos, avaliações e administração estão documentados nas seções seguintes como propostas, não como endpoints existentes.

### 14.1 Convenções de API e fonte da verdade

- **Prefixo:** `/api/v1`. A tabela abaixo apresenta as rotas sem esse prefixo por brevidade.
- **Payload:** JSON com nomes `camelCase`; representação relacional interna `snake_case` não vaza para a interface.
- **Instantes:** ISO 8601 UTC (`2026-10-19T18:00:00.000Z`). **Nascimento:** data civil `YYYY-MM-DD`, sem conversão para `Date` com timezone.
- **Erro padrão:** RFC 7807, `Content-Type: application/problem+json` e campos `type`, `title`, `status`, `detail`; `invalidParams` para violações de campos, quando pertinente. Não revelar a existência de conta em recuperação de senha.
- **Credenciais:** Access token JWT com duração de 15 min; refresh token opaco, rotativo e persistido no banco apenas por hash; duração absoluta da sessão de 30 dias; apenas uma sessão não revogada por usuário. O Expo deverá usar armazenamento seguro do refresh e manter access token em memória.
- **Autorização:** o servidor verifica sessão pelo `sid` a cada requisição protegida e permissões atuais no banco; claims do JWT não são a fonte exclusiva de autorização. Admin exige fluxo separado de TOTP; não emitir tokens finais com privilégio Admin após senha apenas.
- **Campos de pendência:** o objeto da conta usa `hasCompletedQuestionnaire`; o endpoint do formulário usa `hasCompleted`. Trata-se de nomes *diferentes, intencionalmente*, herdados dos contratos da Task 6.1.
- **Ciclo de cadastro:** cadastro bem-sucedido **cria conta e sessão antes do questionário**; o aplicativo navega diretamente às três etapas **sem botão “Preencher depois”**. Interromper o formulário não desfaz a conta. Login posterior continua possível; **ingresso em evento** só será autorizado com questionário completo. Não inventar redirecionamento obrigatório no login que torne a conta inutilizável enquanto o questionário estiver pendente.
- **Dados completos:** a existência da linha `profiles` só indica formulário completo se ela e os vínculos `user_games` estiverem consistentes. `PUT` grava/atualiza as respostas + jogos de forma integral e transacional. Mudanças posteriores de perfil não alteram snapshots antigos de participações.

### 14.2 Matriz de endpoints do primeiro fluxo integrado

| Método e rota | Autenticação | Sucesso | Uso | Situação |
|---|---|---|---|---|
| `POST /auth/register` | Público | `201` conta + tokens | Cadastro | Especificado abaixo |
| `POST /auth/login` | Público | `200` conta + tokens, **ou** desafio 2FA Admin | Login | Especificado abaixo |
| `GET /auth/me` | Bearer | `200` conta atual | Restauração/sessão | Especificado abaixo |
| `POST /auth/refresh` | Refresh opaco no body | `200` par rotacionado | Interceptor HTTP | Especificado abaixo |
| `POST /auth/logout` | Bearer | `200` confirmação | Logout | Herdado da Task 6.1 |
| `GET /profile` | Bearer | `200` cadastro/perfil | Aba Perfil | Herdado, alinhado abaixo |
| `PATCH /profile` | Bearer | `200` nome atualizado | Edição de nome | Herdado, alinhado abaixo |
| `GET /profile/questionnaire` | Bearer | `200` formulário completo ou pendente | Inicialização formulário | Especificado abaixo |
| `PUT /profile/questionnaire` | Bearer | `200` confirmação | Envio das três etapas | Especificado abaixo |
| `GET /games` | Público ou autenticação opcional [Task 6.1] | `200` sugestões/catálogo | Seleção de jogos | Especificado abaixo |

**Rotas não congeladas neste bloco:** recuperação de senha/verificação de email, configuração/redefinição TOTP e permissões administrativas têm especificação de origem na Task 6.1, mas exigem revisão própria de entrega do link, desafios e casos de uso antes de integrar essas telas; não são alteradas por este capítulo. Para eventos e filas, nomes de endpoints anteriormente citados permanecem *candidatos*, não definitivos.

### 14.3 `POST /auth/register`

**Request (JSON):**

```json
{
  "name": "Participante Exemplo",
  "email": "participante@exemplo.com",
  "password": "senha-de-exemplo-com-mais-de-8-caracteres"
}
```

**Regras:** `name` após trim entre 2 e 150 caracteres; email válido e normalizado para busca/unicidade (`lower(trim(email))`); senha de 8 a 128 caracteres, barrar senhas comuns/comprometidas; não impor símbolo/maiúscula obrigatórios. `confirmPassword` é validação **exclusiva no Expo**, não campo da API. Criar `users`, papel `participante` e sessão em uma unidade transacional coerente. Não criar `profiles` falso ou com respostas ausentes. Retornar token mesmo com questionário pendente.

**Resposta `201 Created`:**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Participante Exemplo",
    "email": "participante@exemplo.com",
    "emailVerified": false,
    "roles": ["participante"],
    "hasCompletedQuestionnaire": false
  },
  "accessToken": "<JWT_de_exemplo>",
  "refreshToken": "<TOKEN_OPACO_de_exemplo>",
  "expiresIn": 900
}
```

**Erros:** `400` entrada inválida (incluindo senha curta), `409` e-mail já cadastrado, `422` senha comum/comprometida, `429` limite de solicitações. Cliente não deve confundir qualquer erro com cadastro efetivado. Em caso de timeout de resposta de cadastro, preferir verificar o resultado por login, em vez de gerar registros adicionais de maneira cega.

**Navegação:** somente após `201` guardar credenciais de modo seguro e direcionar diretamente ao questionário. **Sem** botão “Preencher depois”. Se app fechar, cadastro já existe.

### 14.4 `POST /auth/login`

**Request:** `{"email":"participante@exemplo.com","password":"..."}`.

**Resposta `200 OK` para Participante/Staff:** igual ao shape de cadastro (`user`, `accessToken`, `refreshToken`, `expiresIn`), mas `hasCompletedQuestionnaire` e papéis refletem os dados correntes. `emailVerified` pode ser `false` em conta de participante, nunca dispensando verificação para exercer Staff. Não enviar senha ou hash ao cliente.

**Resposta `200 OK` alternativa para Admin (antes do TOTP):**

```json
{
  "requires2FA": true,
  "isTotpConfigured": true,
  "tempToken": "<TOKEN_TEMPORARIO_ESCOPADO>",
  "message": "Informe o segundo fator para concluir o acesso."
}
```

Não retornar sessão privilegiada nem refresh token definitivo antes do TOTP. `tempToken` não serve para chamar as APIs comuns. A aprovação da possibilidade de um Admin atuar como participante **continua pendente**, não presumir comportamento na UI nem permissão pelo tipo de conta.

**Erros:** `401` credenciais inválidas sem revelar se e-mail existe; `429` excesso de tentativas. **Regra aprovada:** login novo revoga sessão anterior; isso não apaga participação em evento, posição ou conclusões.

### 14.5 `GET /auth/me` e recuperação de estado

**Request:** `Authorization: Bearer <accessToken>`.

**Resposta `200 OK` (campos de referência):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Participante Exemplo",
  "email": "participante@exemplo.com",
  "emailVerified": false,
  "roles": ["participante"],
  "hasCompletedQuestionnaire": true
}
```

`401` para token inválido/expirado ou sessão revogada. Papéis apresentados não conferem autorização isoladamente: autorização Staff é por evento, e Admin depende de TOTP. **Restauração no Expo:** ler refresh do armazenamento seguro, realizar uma única tentativa coordenada de renovação quando pertinente, consultar `/auth/me` e só então reconstruir navegação/estado. Eventos/participação serão consultados em endpoints próprios no bloco futuro; **não** tratá-los como campos de `/auth/me` nem cancelar a participação quando houver `401`.

### 14.6 `POST /auth/refresh` e `POST /auth/logout`

**Refresh:** `{"refreshToken":"<TOKEN_OPACO>"}`. Sucesso `200`:

```json
{
  "accessToken": "<NOVO_JWT>",
  "refreshToken": "<NOVO_TOKEN_OPACO>",
  "expiresIn": 900
}
```

O novo token substitui imediatamente o anterior; reuso confirmado de token consumido revoga a sessão. O Expo implementa *single-flight* para evitar disparos paralelos, evita replay após timeout com resultado incerto, e apresenta novo login se perdeu definitivamente o token novo. **Falha de conectividade não é automaticamente erro de credencial.** Nenhuma dessas ocorrências cancela participação nem gera ausência.

**Logout:** `POST /auth/logout` com Bearer; `200` corpo `{ "message": "Sessão encerrada com sucesso." }`. Falha de rede ao efetivar logout exige estado local seguro, sem supor que o servidor revogou a sessão se não confirmou.

### 14.7 `GET /profile` e `PATCH /profile`

**GET:** dados cadastrais (`id`, `name`, `email`, `emailVerified`, `roles`, `hasCompletedQuestionnaire`, `createdAt`, `updatedAt`), com Bearer. **PATCH:** `{ "name": "Novo Nome" }` (2 a 150 caracteres após trim); retorna `200` com `message` e `user` atualizado. Atualizar e-mail exige fluxo próprio de nova verificação, **não** permitido por esse PATCH. Não incluir respostas demográficas completas nesse endpoint: são consultadas em `/profile/questionnaire`.

### 14.8 `GET /profile/questionnaire`

**Bearer obrigatório.** Ausência de linha completa do perfil **nunca** deve produzir `404`; retornar `200`:

```json
{
  "hasCompleted": false,
  "aboutYou": null,
  "yourGames": [],
  "gamesMarket": null,
  "completedAt": null
}
```

**Resposta `200` quando completo:**

```json
{
  "hasCompleted": true,
  "aboutYou": {
    "birthDate": "2000-05-15",
    "gender": "Masculino",
    "otherGender": null,
    "education": "Superior"
  },
  "yourGames": ["Valorant", "Counter-Strike 2"],
  "gamesMarket": {
    "marketKnowledge": "Sim, conheço.",
    "marketInterest": "Talvez — quero conhecer melhor."
  },
  "completedAt": "2026-10-19T18:00:00.000Z"
}
```

Retornar nomes **canônicos** de jogos já persistidos. O frontend deve preencher o formulário a partir desses dados ao editar respostas. A classificação `hasCompleted` é derivada de um perfil válido + ao menos um `user_game`, não da simples existência de uma conta.

### 14.9 `PUT /profile/questionnaire`

**Bearer obrigatório. Enviar as três etapas juntas:**

```json
{
  "birthDate": "2000-05-15",
  "gender": "Outro",
  "otherGender": "Não-binário",
  "education": "Superior",
  "selectedGames": ["Valorant", "Meu Jogo Customizado Indie"],
  "marketKnowledge": "Conheço um pouco.",
  "marketInterest": "Talvez — quero conhecer melhor."
}
```

**Validações do DTO (compatíveis com os sete campos reais identificados pelo Codex):**

| Campo | Contrato |
|---|---|
| `birthDate` | `YYYY-MM-DD` civil gregoriano real; `<= hoje`, **hoje inclusive**, sem idade mínima inventada; não converter com timezone. **[VALIDAR]** fixar calendário civil de referência do servidor para fronteiras de dia. |
| `gender` | Uma de `Feminino`, `Masculino`, `Outro`, `Prefiro não informar`. |
| `otherGender` | Obrigatório (1–100 caracteres) somente para `gender="Outro"`; caso contrário `null`/omitido normalizado para `null`. |
| `education` | `Fundamental`, `Médio`, `Superior`, `Pós-graduação`, `Prefiro não informar`. |
| `selectedGames` | Array com >=1 nome não vazio; cada nome após trim entre 1–100 caracteres; deduplicação case-insensitive; preservação do nome canônico do catálogo. |
| `marketKnowledge` | `Sim, conheço.`, `Conheço um pouco.`, `Não conheço.`. |
| `marketInterest` | `Sim, tenho interesse.`, `Talvez — quero conhecer melhor.`, `Não tenho interesse.`. |

**Resposta de sucesso `200`:**

```json
{
  "message": "Questionário salvo com sucesso.",
  "hasCompleted": true,
  "updatedAt": "2026-10-19T18:05:00.000Z"
}
```

O servidor registra `questionnaire_version_id`, mantém `profiles` e substitui a seleção `user_games` **na mesma transação**, com trava de conta compatível com criação de snapshots no ingresso. Qualquer falha reverte o conjunto inteiro. Atualizar questionário **não modifica** `participation_profile_snapshots` já criados. Erros `400` (incluindo valores inválidos); `401` não autenticado; `429` em limites antiabuso se houver.

**Decisão de interface já aprovada:** pós-cadastro direciona imediatamente ao questionário, sem botão de pular; usuário não precisa responder novamente a cada evento, mas ingressar exige status completo verificado no backend. A API não salva uma etapa parcial automaticamente; até que exista função aprovada para rascunhos, a gravação remota é do envio final.

### 14.10 `GET /games`

**Query:** `GET /api/v1/games?query=valor&limit=20` para pesquisar, ou `GET /api/v1/games` sem filtros (caso ilustrado na resposta abaixo). `query` opcional (mínimo 1 caractere quando presente) e `limit` entre 1 e 50, padrão 20. A Task 6.1 propõe rota pública ou com Bearer opcional — não utilizar informação privada nessa resposta.

**Resposta `200`:**

```json
{
  "games": [
    { "id": "d92a20a9-4c00-4378-a562-a7b64c616600", "name": "Valorant", "isCurated": true },
    { "id": "ac2af048-caae-4256-a82f-cd0e314b6872", "name": "Meu Jogo Customizado Indie", "isCurated": false }
  ],
  "total": 2
}
```

**Nota:** os registros da resposta são **exemplos de formato**, não dados efetivamente pesquisados no servidor. `400` para filtros inválidos. Catálogo começa com 20 jogos curados da UI; nomes livres adicionados pelo questionário passam a integrar o catálogo persistido. Impor unicidade no PostgreSQL por `lower(btrim(name))`; usar o algoritmo de `INSERT ... ON CONFLICT DO NOTHING RETURNING id` seguido, se necessário, de `SELECT` em **comando SQL separado** sob `READ COMMITTED`, preservando a grafia canônica e evitando duplicações entre usuários concorrentes.

**Contrato de identificação:** `selectedGames` no PUT permanece array de **nomes**, como no frontend auditado/Task 6.1. A persistência associa `games.id` e `user_games`; não exigir que a interface envie UUIDs sem decisão posterior.

### 14.11 Forma dos erros e comportamento do cliente

**Exemplo de `400 Bad Request`** (RFC 7807):

```json
{
  "type": "https://arenago.com.br/problems/validation-error",
  "title": "Dados inválidos",
  "status": 400,
  "detail": "Confira as informações enviadas.",
  "invalidParams": [
    { "name": "birthDate", "reason": "Informe uma data civil válida, não futura." }
  ]
}
```

- Validação inválida => marcar campo sem descartar respostas de outras etapas.
- `409` de e-mail já cadastrado => explicar que cadastro não foi criado de novo; permitir login/recuperação.
- `401` de sessão => distinguir token inválido/revogado da ausência de conectividade; não apagar `ParticipationContext` por mero problema de autenticação; buscar participação no backend após novo login.
- `429` => mensagem de excesso de tentativas; respeitar instruções de espera quando enviadas.
- Admin `requires2FA=true` => rota de desafio TOTP, **não** interpretar como login final nem armazenar `tempToken` como refresh.
- Rotas participantes não são autorização de Staff/Admin, mesmo se o usuário tiver essas funções cumulativas.

### 14.12 Matriz de integração do Expo (derivada da auditoria do Codex)

| Local reportado | Adaptação futura, sem implementação agora |
|---|---|
| `screens/auth/RegisterScreen.js`, `utils/validation.js` | Trocar validação mínima 6 → 8; cadastro via `/auth/register`; enviar `name/email/password`, não `confirmPassword`; criar sessão e abrir questionário sem botão de pular. |
| `screens/auth/LoginScreen.js` | Usar `/auth/login`, distinguir `requires2FA`, registrar sessão e considerar `hasCompletedQuestionnaire`. |
| `App.js`, `context/ParticipationContext.js` | Adicionar `AuthContext` e cliente HTTP; restaurar sessão ao iniciar; recuperar participação por API quando contrato de evento existir; preservar estado ao reautenticar. |
| `screens/ProfileQuestionnaireScreen.js`, `utils/validation.js` | Manter sete campos/opções; `GET` e `PUT` de questionário; aceitar nascimento hoje inclusive; não persistir etapa remota parcial. |
| `data/mockData.js` | Migrar 20 sugestões locais para catálogo persistido via seed e consulta `/games`; manter jogo manual. |
| `screens/home/HomeScreen.js`, `screens/eventEntry/EventEntryScreen.js` | Antes de criar participação, validar no servidor perfil completo; definir API específica no próximo bloco. |

### 14.13 Testes de contrato mínimos (futura implementação, **não executados**)

| ID | Teste | Resultado esperado |
|---|---|---|
| C01 | Cadastrar e obter conta com questionário pendente | `201`; usuário, sessão e `hasCompletedQuestionnaire=false` persistidos |
| C02 | Fechar app durante questionário, fazer login | Conta preservada; login permitido; ingressar em evento ainda bloqueado |
| C03 | Cadastrar email com caixa/espaços diferentes | `409` de duplicação; nenhum segundo usuário |
| C04 | Senhas de 6 ou 7 caracteres / senha comprometida | Rejeitadas pelo servidor e sinalizadas na UI |
| C05 | Primeiro GET questionário | `200`, `hasCompleted=false`, sem `404` |
| C06 | Salvar sete campos + jogos | Persistência atômica em `profiles`/`games`/`user_games` e `hasCompleted=true` |
| C07 | Erro em um campo do PUT | Rollback de todos os campos/vínculos da mesma tentativa |
| C08 | Data de nascimento válida igual a hoje / amanhã | Hoje aceito; amanhã rejeitado no calendário de referência definido |
| C09 | `gender='Outro'` sem `otherGender` | `400`; outros gêneros não persistem texto antigo por engano |
| C10 | Dois usuários adicionam `Valorant`, ` valorant ` e `VALORANT` | Um jogo canônico, dois vínculos distintos, grafia preservada |
| C11 | Editar questionário depois de participação antiga | `profiles` muda; snapshot antigo continua com respostas anteriores |
| C12 | Dois logins concorrentes da mesma conta | Apenas uma sessão não revogada; tokens antigos sem acesso |
| C13 | Dois refresh simultâneos com o mesmo token | Reuso detectado e sessão revogada conforme política rigorosa |
| C14 | Resposta de refresh perdida e novo login | Participação/posição **não** canceladas; recuperação via módulo de participação |
| C15 | Login de Admin com TOTP configurado | `requires2FA=true`, sem sessão privilegiada antes do segundo fator |
| C16 | POST cadastro com confirmação de senha no payload | Cliente não envia `confirmPassword`; DTO rejeita propriedades extras conforme política de validação |
| C17 | `GET /auth/me` com `sid` revogado | `401`, apesar de JWT ainda não expirado |
| C18 | Sem perfil completo ao tentar ingressar | Evento não cria participação/snapshot; erro de negócio a definir no bloco de eventos |

### 14.14 Ajustes finais pendentes sem nova decisão de produto

1. **[VALIDAR]** Escolher calendário civil/timezone de referência para o teste `birthDate <= hoje`, documentar regra de datas sem conversões, compatibilizar frontend e API. Não impor limite mínimo de idade antes de discussão de privacidade.
2. **[VALIDAR]** Definir política do provedor de e-mail, envio de links de redefinição e deep link/página web; isso não altera os DTOs aqui definidos.
3. **[VALIDAR]** Especificar URLs e DTOs de eventos/participações/filas/avaliações/BI no próximo bloco; não deduzir rotas do frontend mockado.
4. **[VALIDAR]** Confirmar semântica de `total`, ordenação do catálogo e eventual paginação além de `limit`, conforme volume real. A Task 6.1 só define o formato de resposta e parâmetros básicos.
5. **[VALIDAR]** Compatibilizar as rotas de Admin/Staff com fluxo TOTP e com a questão ainda aberta sobre Admin participar como jogador; não usar a tela de Participante como prova de privilégio.
6. **[VALIDAR]** Executar compilação Drizzle, migrações de zero e testes HTTP/PG reais **apenas na futura fundação**, após criação do ambiente de desenvolvimento; testes locais do Expo (95 na auditoria) não substituem esses ensaios.

**Resultado deste bloco:** primeiro contrato horizontal de identidade/perfil/jogos documentado, com DTOs, exemplos, erros, navegação e testes rastreáveis. **Ainda proposta em revisão, sem alterações de código, commits, Neon ou backend.**

---

## 15. Contratos de integração v0.2 — eventos e participações (19/10/2026)

**Natureza:** [PROPOSTA TÉCNICA DE CONTRATO]. Este capítulo acrescenta DTOs e respostas para os fluxos de ingresso, fila externa, participação corrente e histórico, respeitando o Planejamento v0.7.4 e as decisões D01–D11. **Não implica que as rotas existam no código Expo ou NestJS.** A auditoria anterior do Codex encontrou mocks `FILA`/`LIVRE` em `EventEntryScreen.js`, `EventConfirmationScreen.js`, `ArenaQueueScreen.js` e histórico mockado em `EventsScreen.js`; a integração futura deve substituir a autoridade do mock pela API, sem alterar o comportamento aprovado.

### 15.1 Convenções comuns

- Prefixo de API existente: `/api/v1`. Exemplos abaixo mostram rotas sem prefixo para facilitar leitura.
- **Autenticação:** todos os endpoints deste bloco exigem access token Bearer com `sid` de sessão ativa; privilégio de Staff ou Admin **não é requisito** para consultas e ações de participação do próprio usuário. A elegibilidade futura de contas Admin para jogar segue [PENDENTE]; não criar uma proibição implícita neste bloco.
- **Privacidade:** `participationId` identifica o objeto, mas **não autoriza acesso por si só**. Consultas, histórico, cancelamento e saída sempre verificam `participations.user_id = req.user.id`, independente de UUID difícil de adivinhar. Staff/Admin terão contratos próprios, sem usar endpoints privados de outro participante.
- **Formato:** JSON em `camelCase` no HTTP; `snake_case` no PostgreSQL. `timestamptz` exposto como ISO 8601 UTC (`Z`); `birthDate` nunca é retornada em respostas de evento/participação. Posições e horários são calculados pelo backend; o app apenas apresenta dados recebidos.
- **Estados aprovados:** participação `waiting` = fila externa; `active` = dentro da Arena; `finished` = participação encerrada; `canceled` = desistência da fila externa. Estado de evento armazenado `scheduled|open|closing|closed`; `acceptingEntries` é derivado dos horários, prontidão e fechamento administrativo e pode divergir temporariamente do campo `status` persistido.
- **Razões legíveis por máquina:** a API usa códigos estáveis de erro/encerramento em inglês (`PROFILE_INCOMPLETE`, `EVENT_REGISTRATION_CLOSED` etc.) como extensão `code` de RFC 7807; mensagens em português são de apresentação, não fonte para decisões da interface. **Nomes exatos são candidatos técnicos** a congelar com DTOs e testes.
- **Sem reserva na consulta:** `lookup` e `GET` não criam participação nem garantem ingresso futuro. Toda decisão definitiva é revalidada na transação do `POST`.
- **Relógio e limites:** ingresso permitido somente após `starts_at`, com prontidão válida, e estritamente antes de `min(official_ends_at, closure_requested_at se existir)`. Hora recebida do aparelho nunca autoriza operação. Após bloqueios, validar tempo atual no servidor/PG conforme seção 4. A janela operacional residual permite apenas operações anteriormente aprovadas sobre pessoas já na fila, não novas participações.
- **Idempotência:** mutações de ingresso/cancelamento/saída exigem `Idempotency-Key` gerada uma vez por **intenção** do usuário. Reenvio da mesma chave/payload retorna o resultado original, sem duplicar efeitos; chave reutilizada com payload distinto gera conflito. Usar `idempotency_operations` da seção 2.4, com retenção/expurgo e coerência de estado ainda [VALIDAR]. **Não** aplicar tolerância semelhante ao `POST /auth/refresh`.
- **Perfil:** consulta do evento não exige questionário completo; o ingresso **exige** perfil completo, ≥1 jogo e snapshot versionado inserido atomicamente com a participação. Cadastro/login continuam possíveis com questionário pendente.

### 15.2 Matriz de endpoints propostos

| Método e rota | Autorização | Sucesso | Aplicação | Situação |
|---|---|---|---|---|
| `POST /events/lookup` | Bearer | `200` resumo do evento identificado | `EventEntryScreen` | [PROPOSTA] |
| `GET /events/:eventId` | Bearer | `200` detalhes operacionais seguros | `EventConfirmationScreen`/retomada | [PROPOSTA] |
| `POST /events/:eventId/participations` | Bearer + `Idempotency-Key` | `201` participação recém-criada | confirmação de ingresso | [PROPOSTA] |
| `GET /participations/current` | Bearer | `200` participação ou `null` | `App.js`, Home e retomada | [PROPOSTA] |
| `GET /participations/:id` | Bearer, titular | `200` participação atualizada | fila externa/Arena | [PROPOSTA] |
| `POST /participations/:id/cancel` | Bearer, titular + `Idempotency-Key` | `200` participação cancelada | saída da fila externa | [PROPOSTA] |
| `POST /participations/:id/finish` | Bearer, titular + `Idempotency-Key` | `200` participação finalizada | botão Sair da Arena | [PROPOSTA] |
| `GET /participations/history` | Bearer | `200` histórico paginado do titular | aba Eventos | [PROPOSTA] |

**Detalhe de roteamento NestJS:** registrar/documentar as rotas literais `GET /participations/current` e `GET /participations/history` sem colisão com `GET /participations/:id`; validar `:id` como UUID. Testar resolução das três rotas com Supertest.

**Fronteira:** não há endpoints públicos de chamar participante, concluir atendimento, liberar fila externa ou configurar estações neste capítulo. São operações autenticadas de **Staff/Admin**, a detalhar no próximo bloco. Não inferir permissão de Staff a partir de controles simulados dentro de `ActiveArenaScreen.js`.

### 15.3 `POST /events/lookup` — consulta por código

**Request:**

```json
{ "accessCode": " fila " }
```

**Validação [C-10 APROVADO]:** `accessCode` deve passar por `normalizeEventAccessCode()` no servidor. A função aplica `String.trim()`, exige 4–64 caracteres ASCII `A–Z`/`a–z`/`0–9` com hífens somente entre grupos e retorna maiúsculas. A mesma função deve ser usada na futura criação e na consulta. O SQL `upper(btrim(...))` continua sendo proteção parcial de forma canônica, não substitui essa validação. O código literal do exemplo é fictício e não depende de um evento realmente existente.

**Exemplo de resposta `200 OK` (evento com fila externa habilitada):**

```json
{
  "event": {
    "id": "550e8400-e29b-41d4-a716-446655440101",
    "name": "ArenaGo — Evento de demonstração",
    "timezone": "America/Sao_Paulo",
    "startsAt": "2026-11-05T17:00:00.000Z",
    "officialEndsAt": "2026-11-05T23:00:00.000Z",
    "status": "open",
    "acceptingEntries": true,
    "externalQueueEnabled": true
  },
  "entryStatus": {
    "canAttemptJoin": true,
    "reason": null
  }
}
```

`canAttemptJoin` é orientação no instante da consulta, **não promessa de ingresso**; pode mudar quando horário, configuração, participação atual ou estado administrativo mudarem. Restrições específicas da conta são validadas no `POST` definitivo. `status="open"` não garante prontidão atual por si só. Um evento encontrado mas ainda não iniciado, temporariamente não pronto ou fechado pode responder `200` com `acceptingEntries=false` e `entryStatus.reason` apropriado, permitindo mensagem útil sem criar participação.

**Erros candidatos:** `400` código malformado/ausente; `401` sessão inválida; `404` `EVENT_CODE_NOT_FOUND`; `429` abuso de tentativas de códigos (medidas de limitação e enumeração a especificar). Evitar divulgar e-mails, nomes ou escala de Staff em respostas ao participante. **[VALIDAR]** necessidade de rate limit persistente entre instâncias na implantação futura.

### 15.4 `GET /events/:eventId` — detalhes operacionais seguros

**Bearer obrigatório;** `eventId` UUID. Retorna o resumo de `event` com `status`, `acceptingEntries`, `externalQueueEnabled` e `observedAt` UTC. Não expor a justificativa do Admin nem credenciais internas. O identificador de evento só pode ser obtido no fluxo legítimo de consulta/participação; qualquer UUID aleatório não concede privilégios.

**Uso:** atualização da confirmação de ingresso ou apresentação de fechamento. **`GET` não modifica estado**, não cria posição e não depende de presença do usuário em uma participação. `404` para evento inexistente/inacessível por política, `401` para sessão inválida. O servidor precisa calcular a disponibilidade a partir do horário/prontidão atuais, ainda que o campo `events.status` não tenha sido sincronizado pelo job.

### 15.5 `POST /events/:eventId/participations` — ingresso definitivo

**Request:** corpo `{}` (ou sem corpo); `Authorization: Bearer <accessToken>`; `Idempotency-Key: <id-da-intencao-de-ingresso>`.

**Transação e invariantes:**

1. Resolver evento, obter locks na ordem da seção 4 e verificar que a configuração está pronta e o instante atual ainda permite ingresso; revalidar **após** qualquer espera em locks.
2. Verificar que a conta não tem participação corrente **em nenhum evento**, incluindo espera externa (`UNIQUE(user_id) WHERE status IN ('waiting','active')`), sem confiar apenas em consulta anterior.
3. Verificar questionário completo e coerente com ≥1 jogo; bloquear leituras com atualização concorrente de perfil conforme a ordem de locks definida; obter versão, respostas e jogos canônicos consistentes.
4. Se `external_queue_enabled=true`, alocar nova ordem FIFO em `events.external_last_order` e criar `participations.status='waiting'`, `arena_entered_at=null`. Caso contrário, criar `status='active'` e `arena_entered_at` no ingresso.
5. Inserir `participation_profile_snapshots` da mesma participação, com versão e respostas congeladas; concluir idempotência no **mesmo commit** da participação e do snapshot. Se qualquer etapa falhar, nenhuma participação/posição/snapshot parcial ficará persistida.

**Resposta `201 Created` — fila externa ativa:**

```json
{
  "participation": {
    "id": "550e8400-e29b-41d4-a716-446655440201",
    "eventId": "550e8400-e29b-41d4-a716-446655440101",
    "status": "waiting",
    "joinedAt": "2026-11-05T17:18:00.000Z",
    "arenaEnteredAt": null,
    "finishedAt": null,
    "finishReason": null,
    "externalQueue": { "position": 4, "observedAt": "2026-11-05T17:18:00.000Z" }
  }
}
```

**Resposta alternativa com fila externa desabilitada:** id/horários próprios, `status="active"`, `arenaEnteredAt` preenchido, `externalQueue=null`. Se desligarem a fila externa **depois** de João entrar em `waiting`, a liberação altera essa mesma participação para `active` (D06), **sem criar outra**. Reabilitar a fila externa não recoloca quem já está ativo em espera.

**Erros de negócio:** `409 PROFILE_INCOMPLETE`, `409 PARTICIPATION_ALREADY_CURRENT`, `409 EVENT_NOT_STARTED`, `409 EVENT_NOT_READY`, `409 EVENT_REGISTRATION_CLOSED`; `404 EVENT_NOT_FOUND`; `401` sessão inválida; `429` limitação de abuso. Para `PARTICIPATION_ALREADY_CURRENT`, devolver na extensão `currentParticipationId` **somente da própria conta**, para que o aplicativo possa restaurar a Arena em vez de criar outra participação. Requisições com mesma chave/payload devolvem o `201` original; **intenção distinta** após finalizar legitimamente cria nova participação, até o encerramento oficial.

### 15.6 `GET /participations/current` — recuperar a participação da conta

**Bearer obrigatório.** Nunca utilizar `currentParticipationId` de armazenamento local como autoridade.

**Resposta `200 OK` quando existe participação corrente:**

```json
{
  "participation": {
    "id": "550e8400-e29b-41d4-a716-446655440201",
    "eventId": "550e8400-e29b-41d4-a716-446655440101",
    "status": "waiting",
    "joinedAt": "2026-11-05T17:18:00.000Z",
    "arenaEnteredAt": null,
    "finishedAt": null,
    "finishReason": null,
    "externalQueue": { "position": 3, "observedAt": "2026-11-05T17:19:25.000Z" }
  }
}
```

**Resposta `200 OK` quando não existe participação corrente:**

```json
{ "participation": null }
```

Não usar `404` para ausência de participação. O backend deve refletir o **efeito temporal de encerramentos vencidos** mesmo que o job de limpeza física esteja atrasado; nunca devolver uma participação artificialmente ativa além do limite operacional como se estivesse aberta. Persistir a finalização idempotentemente quando necessário, ou calcular uma projeção efetiva segura até o job regularizar a linha. Reentradas legítimas têm IDs próprios, nunca reutilizam o ID anterior.

**Navegação:** após login/reabertura, consultar este endpoint antes de escolher a tela; `waiting` → fila externa; `active` → Arena; `null` → consultar pendências elegíveis de avaliação (contrato posterior), podendo apresentar avaliação ou mensagem de encerramento em vez de enviar automaticamente à Home. `GET current` **não** substitui a consulta de avaliações pendentes.

### 15.7 `GET /participations/:id` — estado da participação do titular

**Bearer obrigatório e titularidade obrigatória**, inclusive para histórico de participação terminada. Mantém os campos do item anterior e, quando `active`, devolve `externalQueue=null`. **[PROPOSTA]** incluir `event` público reduzido (`id`, `name`, `status`, `acceptingEntries`) para renderizar a tela sem duplicar consultas.

**Posição externa:** calculada no instante da consulta contando apenas participações `waiting` no mesmo evento cuja ordem esteja à frente ou igual à do usuário; **não** manter posições físicas em massa, pois saídas e liberações alteram o número exibido. Campos `observedAt` explicitam que a posição é uma fotografia. `404` tanto para ID inexistente quanto para ID de terceiro (não revelar a existência), `401` para autenticação inválida.

**Atualização da interface [VALIDAR]:** refetch ao retornar para o app e enquanto estiver aguardando; decidir intervalo/custo e eventual WebSocket em validação de infraestrutura. Não inferir presença ou ausência pela queda de conexão; servidor é fonte de verdade.

### 15.8 `POST /participations/:id/cancel` — sair voluntariamente da fila externa

**Bearer + titularidade + `Idempotency-Key`.** Somente participação `status='waiting'`. **Sem corpo** (motivo fixo de produto `external_wait_withdrawal`).

**Efeito atômico:** `waiting → canceled`; `finishedAt` (instante terminal) preenchido; `finishReason='external_wait_withdrawal'`; eliminar sua presença da posição calculada e preservar a linha histórica. Não gerar avaliação; não converter em ausência de Staff; não cancelar/alterar a participação de outros usuários. Se houve liberação simultânea para `active`, não executar desistência externa sobre `active`: responder conflito e estado atualizado, oferecendo ao usuário o fluxo adequado de saída da Arena.

**Resposta `200 OK`:**

```json
{
  "participation": {
    "id": "550e8400-e29b-41d4-a716-446655440201",
    "eventId": "550e8400-e29b-41d4-a716-446655440101",
    "status": "canceled",
    "finishedAt": "2026-11-05T17:22:00.000Z",
    "finishReason": "external_wait_withdrawal",
    "externalQueue": null
  }
}
```

**Erros:** `409 PARTICIPATION_NOT_WAITING` se já ativa/terminal por outro motivo; `404` titularidade/inexistência; `401` inválido. Uma repetição com **a mesma chave/payload** devolve o resultado original sem criar efeitos. Uma nova tentativa de ingresso depois do cancelamento cria participação **nova**, se o evento ainda aceitar inscrições.

### 15.9 `POST /participations/:id/finish` — saída voluntária da Arena

**Bearer + titularidade + `Idempotency-Key`.** Somente participação `status='active'`; não exigir nenhuma conclusão Staff, mas isso determina a possibilidade de avaliar posteriormente. **Sem corpo** (motivo `voluntary`).

**Efeito atômico:** `active → finished`, `finishedAt` e `finishReason='voluntary'`; se houver entrada na fila interna `waiting`, encerrá-la com motivo apropriado sem ausência; se a entrada estiver `called` e existir atendimento `pending`, cancelá-lo por desistência e liberar a estação se disponível; preservar todas as `service_sessions` já `completed` do titular. Competição entre Staff concluir e usuário finalizar: serializar locks em ordem aprovada; se Staff concluir primeiro, conclusão permanece; se saída vencer, atendimento pendente torna-se `canceled` e não pode ser concluído tardiamente.

**Resposta `200 OK` (exemplo):**

```json
{
  "participation": {
    "id": "550e8400-e29b-41d4-a716-446655440201",
    "eventId": "550e8400-e29b-41d4-a716-446655440101",
    "status": "finished",
    "finishedAt": "2026-11-05T18:42:00.000Z",
    "finishReason": "voluntary",
    "completedServicesCount": 2,
    "evaluationEligibility": { "eligible": true, "hasSubmitted": false }
  }
}
```

`evaluationEligibility` é uma **projeção calculada** de `participations`, `service_sessions` e `evaluations`, não tabela de pendências. A tela de avaliação só abre quando houve >=1 atendimento `completed`, ainda não existe avaliação e o prazo não venceu; o usuário pode escolher “Avaliar mais tarde”. Contrato completo de avaliação e pendências virá no bloco correspondente.

**Erros:** `409 PARTICIPATION_NOT_ACTIVE` se continua em fila externa ou já foi finalizada por outro motivo; `404` titularidade/inexistência; `401` token inválido. Se um encerramento automático/administrativo ganhou a disputa, retornar estado terminal efetivo sem sobrescrever `finishReason`, evitando transformar fechamento automático em saída voluntária. Reenvio da mesma intenção usa idempotência.

### 15.10 `GET /participations/history` — histórico do titular

**Bearer obrigatório.** `GET /participations/history?limit=20&cursor=<cursor-opaco>`; `limit` padrão 20, máximo 50 [PROPOSTA]. Ordenar por `joined_at DESC, id DESC` para paginação estável (*keyset*), usando cursor opaco validado no servidor. Retornar apenas participações do próprio titular, inclusive reentradas distintas no mesmo evento. Nunca transformar evento fechado em exclusão do histórico por padrão; o tratamento posterior de LGPD continua prevalecendo.

**Resposta `200 OK` (exemplo):**

```json
{
  "items": [
    {
      "participationId": "550e8400-e29b-41d4-a716-446655440201",
      "event": {
        "id": "550e8400-e29b-41d4-a716-446655440101",
        "name": "ArenaGo — Evento de demonstração"
      },
      "status": "finished",
      "joinedAt": "2026-11-05T17:18:00.000Z",
      "finishedAt": "2026-11-05T18:42:00.000Z",
      "finishReason": "voluntary",
      "completedServicesCount": 2,
      "evaluation": { "eligible": true, "submitted": false, "pending": true }
    }
  ],
  "nextCursor": null
}
```

`evaluation.eligible/submitted/pending` são **derivados** da elegibilidade, prazo e avaliação existente; não expor `pending=true` após os 30 dias de primeira submissão. Histórico inclui participações `canceled` da fila externa como não elegíveis, e `finished` automaticamente como elegíveis **somente com conclusão Staff**. Não excluir as participações de mesma pessoa no mesmo evento após reentrada; contar por `participationId`, não só por `eventId`. `404` não se aplica a histórico vazio: retornar `items:[]`; `401` sessão inválida. **[PILOTO]** exclusão de conta pode apagar/desidentificar histórico individual conforme política aprovada; não transformar histórico identificável em retenção ilimitada.

### 15.11 Erros HTTP e tratamento pelo Expo

**Forma RFC 7807, com extensão estável `code`:**

```json
{
  "type": "https://arenago.com.br/problems/participation-already-current",
  "title": "Você já está participando de um evento",
  "status": 409,
  "code": "PARTICIPATION_ALREADY_CURRENT",
  "detail": "Continue sua participação atual antes de tentar ingressar novamente.",
  "currentParticipationId": "550e8400-e29b-41d4-a716-446655440201"
}
```

| Status/código | Quando ocorre | Ação esperada do app |
|---|---|---|
| `401` | Sessão revogada ou inválida | Reautenticar/renovar conforme política; preservar intenção e participação no banco |
| `400` | Código/UUID/payload malformado | Orientar correção; nunca tratar como evento inexistente automaticamente |
| `404 EVENT_CODE_NOT_FOUND` | Código inexistente | Informar código não encontrado, sem criar participação |
| `404` | ID de evento/participação inexistente ou não autorizado | Exibir indisponibilidade genérica, sem revelar dados de outros |
| `409 PROFILE_INCOMPLETE` | Perfil/jogos insuficientes para ingressar | Abrir questionário existente; sem botão de pular; voltar à confirmação depois de concluir |
| `409 PARTICIPATION_ALREADY_CURRENT` | Já há espera ou Arena ativa, até em outro evento | Abrir participação atual, não criar registro duplicado |
| `409 EVENT_NOT_STARTED` | Antes do começo | Informar horário local do evento |
| `409 EVENT_NOT_READY` | Evento sem configuração mínima | Informar indisponibilidade; sem fingir que Staff está online |
| `409 EVENT_REGISTRATION_CLOSED` | Hora oficial/Admin encerrou novas entradas | Informar encerramento de ingressos; não permitir reentrada |
| `409 PARTICIPATION_NOT_WAITING/NOT_ACTIVE` | Concorrência liberação/saída ou estado terminal | Reconsultar estado e exibir navegação correta |
| `409 IDEMPOTENCY_KEY_REUSED` | Chave repetida com payload/intenção diferente | Gerar nova chave para intenção nova, jamais repetir efeito no banco |
| `429` | Muitas tentativas de busca/ingresso | Aplicar espera comunicada por `Retry-After`, se fornecida |
| `5xx`/timeout | Erro/desconexão sem certeza de commit | Consultar `/participations/current` ou reexecutar com **mesma** chave, nunca gerar outra automaticamente |

**Regra geral:** erros de rede não cancelam a fila; reconectar não gera ausência; a interface não inventa uma posição a partir do mock. Código e descrição ficam separados para evitar condicionais frágeis sobre frases.

### 15.12 Navegação e persistência de estado após retomada

| Estado consultado | Tela/fluxo esperado |
|---|---|
| Sessão inválida, participação possivelmente ativa | Login/recuperação da sessão; após autenticado consultar `/participations/current` |
| `current.waiting` | Exibir fila externa com posição atualizada pelo servidor |
| `current.active` | Exibir Arena ativa; posição/entrada em fila interna virão do contrato futuro de filas |
| `current=null` com avaliação elegível pendente | Exibir avaliação e permitir “Avaliar mais tarde”; não forçar Home |
| `current=null` com participação recém-finalizada automaticamente sem elegibilidade | Informar que o evento terminou; não solicitar avaliação |
| `current=null`, sem avaliação/aviso pendente | Navegação usual do aplicativo |

**Detalhe ainda a especificar nos contratos de encerramento/avaliação:** `GET current` sozinho não permite distinguir *nenhuma participação* de *participação recentemente finalizada pelo sistema*. A inicialização deve fazer uma **consulta adicional de desfechos recentes/avaliações pendentes**, ou futuramente receber resposta agregada de *bootstrap* construída sem duplicar a autoridade dos dados. Não enviar diretamente à Home antes de resolver esse estado; não inventar que `participation=null` já indica o motivo de finalização.

### 15.13 Cenários de aceitação propostos para PostgreSQL real e cliente

| ID | Cenário | Resultado esperado |
|---|---|---|
| EV01 | Consultar código válido com variações de caixa/espaços externos | Mesmo evento retornado; sem reservar vaga |
| EV02 | Consultar código desconhecido/inválido | `404`/`400` sem criar usuário, participação ou posição |
| EV03 | Consultar antes do início e tentar ingressar | Consulta informativa; ingresso negado antes de `starts_at` |
| EV04 | Chegar ao instante oficial de encerramento | Ingresso rejeitado no corte, inclusive após espera em lock |
| EV05 | Evento no horário mas sem prontidão mínima | Sem ingresso; UI informa indisponibilidade |
| EV06 | Conta sem questionário completo/jogos | `409 PROFILE_INCOMPLETE`; nenhuma participação ou snapshot criado |
| EV07 | Fila externa habilitada | Ingresso cria `waiting`, ordem FIFO e snapshot atômicos |
| EV08 | Fila externa desabilitada | Ingresso cria `active`, `arenaEnteredAt` preenchido; sem fila externa |
| EV09 | Duas requisições de ingresso simultâneas do mesmo usuário | No máximo uma participação `waiting/active` em qualquer evento |
| EV10 | Retry de ingresso com mesma chave após timeout | Resposta coerente com um único ID; nenhum snapshot duplicado |
| EV11 | Ingressos válidos distintos após desistência, antes do corte | Nova participação/ordem, sem recuperar posição anterior |
| EV12 | Desistência da fila externa concorre com desativação D06 | Apenas um estado final coerente; não cancelar participação já ativa como se fosse espera externa |
| EV13 | Desativação e reativação da fila externa | Liberar atuais para `active`; reativação afeta só ingressos futuros |
| EV14 | Dois participantes saem da fila externa | Posições restantes recalculadas sem regravar toda a fila |
| EV15 | Desistência `waiting` | Status `canceled`, histórico preservado, sem elegibilidade a avaliar |
| EV16 | Saída `active` com chamada pendente | Chamada cancelada por desistência; nenhuma ausência/conclusão extra |
| EV17 | Saída `active` com conclusões anteriores | Todas as conclusões preservadas; elegibilidade conforme D08 |
| EV18 | Reabrir app ou reautenticar com sessão revogada | Participação corrente do backend restaurada; sem perda de posição |
| EV19 | Limite operacional ocorre com app offline | `current` não retorna estado falsamente ativo; consultar histórico/desfecho depois |
| EV20 | Encerramento Admin imediato | Todas as abertas terminam; pendências canceladas, sem registro de ausência |
| EV21 | Histórico com reentradas no mesmo evento | Uma linha por participação, sem colapsar por evento |
| EV22 | Outra conta consulta/cancela `participationId` alheio | Bloqueio por titularidade, sem exposição de existência/dados |
| EV23 | Atualização do questionário concorre com ingresso | Snapshot corresponde a uma versão completa, sem mistura de jogos antigos e novos |
| EV24 | Encerramento automático após uma conclusão | Avaliação pendente elegível na retomada; sem conclusão, não forçar avaliação |

Os testes funcionais de API/Expo deste capítulo seguem não executados. Os casos específicos de normalização C-10 e consulta interna de eventos foram adicionados na E01.2B (§24); permanecem pendentes comportamento de tempo, idempotência após expurgo e reconexão real em dispositivos móveis.

### 15.14 Pendências pontuais de integração

1. **[VALIDAR antes de congelar DDL/API]** Formato/normalização canônica dos códigos de ingresso (sem contrariar regra aprovada de caixa e espaços externos), tempo de retenção de chaves de idempotência e códigos RFC 7807 definitivos.
2. **[VALIDAR integração]** Estado de encerramento recente/avaliação pendente necessário ao *bootstrap* do Expo; não tratar `GET current=null` como navegação obrigatória à Home. Contratos de avaliação virão adiante.
3. **[RESOLVIDO — C-12]** Ao iniciar fechamento controlado antecipado, todas as participações ainda na fila externa são finalizadas imediatamente por motivo administrativo específico, sem avaliação; a fila interna preexistente segue até o limite controlado. Não reabrir essa decisão por trechos históricos.
4. **[VALIDAR técnica]** Se evento abrir tardiamente por ter ficado pronto depois do horário de início, conferir as mensagens de situação da interface; isso não permite ingresso depois do fechamento oficial.
5. **[PRÓXIMO BLOCO]** Contratos das filas internas/estações e comandos de Staff (uma fila FIFO por experiência, uma chamada por estação, conclusão/ausência/desistência e janela residual), seguidos pelos de avaliações e encerramento/Admin.

**Estado da implementação:** nenhuma rota neste capítulo foi criada, nenhuma alteração no frontend ou no repositório foi realizada, nenhuma migração foi gerada naquela etapa documental; a Task 6.2 posterior criou as cinco migrações e o banco na Neon continua **não criado**.


---

## 16. Contratos de integração v0.3 — filas internas, estações e operações Staff (19/10/2026)

**Natureza:** [PROPOSTA TÉCNICA DE CONTRATO] construída sobre as decisões de produto [APROVADO] D01–D07, D09, D11 e as seções 2–5 e 15 desta arquitetura. **Nenhum endpoint está implementado**; o frontend Expo ainda utiliza simulações, conforme a auditoria do Codex. Este capítulo não adiciona novos direitos de acesso nem funcionalidades não aprovadas. A autorização de Staff é **por evento**, não por estação; duas estações da mesma experiência compartilham uma única fila FIFO. A política de encerramento controlado para a fila externa foi **aprovada (opção A) e consolidada na §16.13 e no capítulo 17**.

### 16.1 Invariantes que prevalecem sobre qualquer DTO

1. **Participação ativa:** ingressar em fila interna exige `participations.status='active'`, titularidade do usuário e evento ainda aceitando novas entradas internas; o estado `waiting` da *fila externa* não dá acesso à fila interna.
2. **Uma entrada corrente:** uma participação tem no máximo uma entrada interna `queue_entries.status IN ('waiting','called')`, inclusive quando a pessoa já foi chamada. Outra experiência só pode ser escolhida depois de a entrada anterior tornar-se terminal; repetir uma experiência é permitido como nova tentativa.
3. **Fila por experiência:** `queue_order bigint` é atribuído exclusivamente pelo servidor, sob lock da linha da experiência, sem prioridades ou transferência de posições. Várias estações competem **pela mesma fila**, não por filas individuais.
4. **Uma ocorrência pendente por estação:** `service_sessions` `pending` ocupa exclusivamente a estação por índice único parcial. Estação pode estar `available` mas ocupada; disponibilidade e ocupação são conceitos distintos.
5. **Staff vinculado ao evento:** chamadas, conclusão e ausência exigem `user_roles` ativo de `staff` com `event_id` igual ao da estação/experiência. A sessão pode conter também outros papéis. **Ter papel Admin não concede automaticamente permissão operacional de chamada/conclusão**; a eventual operação por Admin dependerá de Staff também atribuído ou decisão futura, sem implícita promoção. A alteração de disponibilidade pode ser feita por Staff autorizado para o evento ou Admin global, conforme D01/D04.
6. **Resultado terminal único:** cada `service_session` passa de `pending` a exatamente um entre `completed`, `absent`, `canceled`; somente `completed` pontua, e nenhuma falha de rede cria `absent`.
7. **Corte de entradas:** após o primeiro corte aplicável (`official_ends_at` ou início de fechamento Admin), nenhuma **nova** entrada de fila interna ou participação; também não há reentrada após ausência. Durante prazo operacional residual ainda podem ocorrer chamadas de entradas `waiting` **já existentes** e resoluções pendentes, até seu prazo efetivo.
8. **Corte definitivo:** ao chegar a `min(events.operational_deadline_at, events.admin_deadline_at quando existir)`, não há novas chamadas ou resoluções manuais; pendências são canceladas, entradas encerradas e participações finalizadas automaticamente. Encerramento Admin imediato tem efeito no instante próprio, conforme D09.
9. **Segurança e privacidade:** `queueEntryId`, `serviceSessionId`, `stationId` e IDs difíceis de adivinhar **não** substituem validação de titularidade/papel e coerência de `eventId`/`experienceId`. A API pública nunca expõe a lista nominal dos demais participantes.
10. **Idempotência:** operações mutantes usam `Idempotency-Key` por intenção (exceto se uma política específica de ação idempotente for posteriormente justificada). Uma tentativa nova de entrar novamente na mesma fila usa chave nova. `idempotency_operations` persiste efeito/resposta no mesmo commit; token de refresh não usa esse mecanismo.
11. **Desistência interna C-15:** o titular pode abandonar a entrada `waiting` ou `called` mantendo a participação `active`. Resolver eventual `pending` sem ausência/conclusão, preservar histórico e não transferir posição. A saída isolada é futura E07.3; nova entrada continua sujeita a todos os cortes e guardas de admissão.

### 16.2 Matriz de endpoints propostos

| Endpoint relativo a `/api/v1` | Acesso | Finalidade | Efeito |
|---|---|---|---|
| `GET /events/:eventId/experiences` | Conta com participação `active` no evento | Listar experiências e estações/estatísticas seguras | Leitura |
| `GET /participations/:id/queue` | Participante titular | Recuperar espera/chamada interna atual | Leitura |
| `POST /participations/:id/queue-entries` | Participante titular | Entrar em fila interna, inclusive repetir experiência após conclusão | Cria `queue_entries` |
| `GET /staff/events/:eventId/stations` | Staff autorizado no evento (Admin com acesso de gestão conforme regra) | Consultar estações, disponibilidade e pendências | Leitura operacional |
| `PATCH /staff/events/:eventId/stations/:stationId/availability` | Staff autorizado no evento **ou Admin global** | Marcar estação disponível/indisponível | Atualiza `stations` |
| `GET /staff/events/:eventId/experiences/:experienceId/queue` | Staff autorizado no evento | Consultar tamanho/primeiro lugar e situação da fila | Leitura operacional |
| `POST /staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next` | Staff autorizado no evento | Reservar primeiro da FIFO e chamar na estação escolhida | Cria `service_sessions.pending` |
| `POST /staff/events/:eventId/service-sessions/:serviceSessionId/complete` | Staff autorizado no evento | Confirmar experiência concluída | Resolve `completed` |
| `POST /staff/events/:eventId/service-sessions/:serviceSessionId/absent` | Staff autorizado no evento | Registrar ausência; eventual nova posição antes do corte | Resolve `absent`, pode criar nova `queue_entry` |

**Delimitação atualizada — C-15 aprovada em 30/10/2026:** o participante poderá sair apenas da fila interna e continuar com participação `active` na Arena. Esta decisão substitui a delimitação anterior que excluía a saída isolada. A operação exige **contrato específico futuro na E07.3**; a matriz acima não define seu método ou caminho HTTP. O contrato já proposto `POST /participations/:id/finish` continua destinado à finalização da participação; saída externa, finalização e desistência interna têm efeitos distintos. A alteração manual de `experiences.queue_accepting_entries` e a desativação da fila externa continuam sendo capacidades de gestão a detalhar no contrato de Admin, não permissões extras de Staff por inferência.

#### Requisitos da futura desistência interna — E07.3

- **Escopo e acesso:** validar titularidade, participação `active` e vínculo entre evento, experiência, entrada e eventual atendimento dentro da transação. O contrato deve identificar a tentativa alvo e vincular a idempotência a essa intenção; retry antigo não pode atingir uma entrada posterior. Não apagar histórico nem finalizar/cancelar a participação.
- **Entrada `waiting`:** encerrar a entrada com instante e motivo identificável de desistência voluntária e liberar `participations.current_queue_entry_id` correspondente, atomicamente. Não renumerar `queue_order`, decrementar `last_queue_order` nem mudar a posição relativa de outros participantes.
- **Entrada `called`:** se houver `service_sessions.pending`, resolver a chamada e encerrar a entrada no mesmo commit da limpeza do ponteiro, sem ausência ou conclusão. A estação deixa de estar ocupada por esse atendimento e pode receber novas chamadas se sua disponibilidade configurada e as regras operacionais permitirem. Não marcar estação `available` automaticamente nem criar chamada seguinte automática.
- **Concorrência:** usar `READ COMMITTED` e o protocolo comum de locks: `events FOR SHARE` → `experiences FOR UPDATE` → `stations FOR UPDATE` quando houver chamada → `participations FOR UPDATE` → `queue_entries FOR UPDATE` → `service_sessions FOR UPDATE` quando existir. Leituras preliminares para descobrir IDs não autorizam a operação; revalidar relações, titularidade, estados e a necessidade de lock da estação após as esperas, mantendo essa ordem. Disputar chamada Staff, conclusão, ausência e fechamento pelo mesmo protocolo. Transições condicionadas ao estado corrente não podem sobrescrever `completed`, `absent`, `canceled` ou entrada já encerrada. Se outra operação vencer, preservar seu resultado; o contrato futuro definirá a resposta de estado já resolvido/conflito.
- **Cronologia:** usar relógio PostgreSQL atual após eventuais esperas. O corte de **novos ingressos** não impede, por si só, desistência de entrada existente: ela pode ocorrer após esse corte enquanto participação/entrada e prazo operacional/administrativo ainda permitirem. Fechamento definitivo não é contornado e participação terminal não é reativada. Sair da fila nunca autoriza nova entrada após o corte.
- **Depois da saída:** o titular pode permanecer na Arena sem fila ou solicitar ingresso em outra experiência antes dos cortes e sob todas as guardas de admissão. Cada novo ingresso é outra intenção, com nova chave e nova ordem, sem transferência FIFO. Permanece uma fila por experiência compartilhada entre suas estações, sem filas ou transferência por estação.
- **Atomicidade e idempotência:** reutilizar o mecanismo existente; reservar/concluir a intenção e persistir resultado junto com os efeitos em `queue_entries`, `participations` e `service_sessions`, com rollback integral em falha. Retry retorna o resultado original sem novo cancelamento ou alteração de ocorrência posterior. Preservar todas as conclusões anteriores.

**Conferência do schema atual, sem alteração:** `backend/src/database/schema/participations.schema.ts` e `backend/drizzle/0004_event_operations.sql` permitem somente `waiting|called|closed` em `queue_entries` e `pending|completed|absent|canceled` em `service_sessions`. Portanto, o encerramento da entrada usa o estado existente `closed`; a resolução por desistência de um atendimento ainda `pending` usa o estado existente `canceled`, sem inventar estado `withdrawn` ou equivalente. `closed` exige `closed_at` e `close_reason`; `canceled` exige `resolved_at` e `cancel_reason`, respeitando os demais checks e FKs. `close_reason` e `cancel_reason` são `varchar(40)` sem enum ou CHECK de lista de motivos. Isso oferece campos para identificar a desistência, mas **não significa que um código de motivo específico já tenha sido definido ou implementado**: os valores concretos, autoria da resolução, resultados/erros e contrato ficam para E07.3. Nenhuma migration foi criada ou presumida necessária neste complemento.

**Limite da entrega:** E07.1 continua implementando somente ingresso, E07.2 permanece consulta futura e a saída será E07.3. Este registro de negócio/requisitos não altera serviços, tipos ou testes nem valida a futura operação no PostgreSQL.

### 16.3 `GET /events/:eventId/experiences` — visão do participante

**Requisitos:** Bearer válido, titular com participação `active` no evento. `200 OK` mesmo durante operação residual para que usuários já presentes vejam o estado; não implica que possam entrar novamente. `eventId` no path deve corresponder à participação atual. Não divulgar nomes, e-mails, escalas de Staff ou identidades na fila.

**Exemplo `200`:**

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "observedAt": "2026-11-05T21:15:00.000Z",
  "acceptingNewQueueEntries": true,
  "experiences": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440301",
      "name": "Just Dance",
      "acceptingNewQueueEntries": true,
      "waitingCount": 3,
      "stations": [
        { "id": "550e8400-e29b-41d4-a716-446655440401", "label": "Estação 1", "available": true },
        { "id": "550e8400-e29b-41d4-a716-446655440402", "label": "Estação 2", "available": true }
      ]
    }
  ]
}
```

Os campos `available` expressam configuração manual da estação, **não necessariamente que esteja desocupada**; opcionalmente apresentar `canCallNext` derivado separadamente, se o contrato de UX exigir. `waitingCount` contabiliza somente entradas internas `waiting`, não `called`, fechadas, fila externa nem total de participação. Durante a margem residual: `acceptingNewQueueEntries=false` embora `waitingCount>0` e chamadas possam continuar.

### 16.4 `POST /participations/:id/queue-entries` — ingressar na fila interna

**Headers:** `Authorization: Bearer <accessToken>` e `Idempotency-Key: <uuid-ou-chave-da-intencao>`.

**Body:**

```json
{ "experienceId": "550e8400-e29b-41d4-a716-446655440301" }
```

**Transação [PROPOSTA]:** resolver e bloquear `events` (`FOR SHARE`), `experiences` (`FOR UPDATE`) e `participations` (`FOR UPDATE`) na ordem declarada na §4, revalidando após as esperas e protegendo as testemunhas de capacidade conforme o protocolo da E07.1. Validar titularidade, `status='active'`, experiência do mesmo evento, `queue_accepting_entries=true`, inexistência de outra entrada interna atual, prontidão/Staff autorizado e que **ambos** os cortes (oficial e administrativo) ainda permitem entradas. **C-14 exige ao menos uma estação da experiência configurada como `available` para admitir novas entradas. Isso não exige estação desocupada: ela pode estar `available` e possuir `service_sessions.pending`.** A perda de todas as estações operacionalmente disponíveis bloqueia novos ingressos nessa experiência, preservando entradas existentes e sem afetar outras experiências aptas. Restaurar capacidade não reabre inscrições após os cortes. Essas regras seguem C-14, §20.2 e a visão informativa E06, que não substitui a revalidação na mutação. Incrementar `experiences.last_queue_order` e inserir uma entrada `queue_entries.status='waiting'`, atualizando `participations.current_queue_entry_id`; efetivar tudo, com a idempotência, no mesmo commit. `queue_order` jamais virá do telefone. A desistência interna C-15 permanece reservada à E07.3 e não é implementada por esse ingresso.

**Resposta `201 Created`:**

```json
{
  "queueEntry": {
    "id": "550e8400-e29b-41d4-a716-446655440501",
    "participationId": "550e8400-e29b-41d4-a716-446655440201",
    "experienceId": "550e8400-e29b-41d4-a716-446655440301",
    "status": "waiting",
    "queueOrder": "24",
    "position": 3,
    "enteredAt": "2026-11-05T21:16:00.000Z"
  }
}
```

`queueOrder` será transmitido em **string decimal** por compatibilidade com `bigint` do PostgreSQL (sem perda de precisão JavaScript); `position` é um inteiro **dinâmico**, nunca coluna persistida. Mesma chave + mesmo corpo após resposta perdida devolve a mesma operação; chave nova para nova tentativa legítima após fechamento da anterior. A API também checa as restrições únicas do banco; *frontend desatualizado* não pode criar duas filas.

**Erros candidatos:** `401` sessão inválida; `404` participação/experiência não encontrada ou não pertencente ao evento; `409 PARTICIPATION_NOT_ACTIVE`, `409 ALREADY_IN_INTERNAL_QUEUE`, `409 EXPERIENCE_QUEUE_CLOSED`, `409 EVENT_REGISTRATION_CLOSED`, `409 IDEMPOTENCY_KEY_REUSED`; `429` limitações de abuso quando aplicáveis. `403` somente se o usuário autenticado tentar ação não autorizada e o contrato de política optar por distinguir de `404` sem vazamento. Timeout: reconsultar `/participations/:id/queue` ou reenviar com **mesma** chave.

### 16.5 `GET /participations/:id/queue` — fila ou chamada atual

**Bearer + titular.** Consulta não cria nem remove entradas. O backend deve computar `position` pelo número de entradas `waiting` à frente da mesma experiência (e ordem), sempre que `status='waiting'`. Entrada `called` deixa de ocupar posição na espera; o participante verá a estação escolhida. O histórico é consultado pelas participações/atendimentos, não por esta rota de estado corrente.

**Resposta em espera:**

```json
{
  "participationId": "550e8400-e29b-41d4-a716-446655440201",
  "observedAt": "2026-11-05T21:18:00.000Z",
  "currentQueueEntry": {
    "id": "550e8400-e29b-41d4-a716-446655440501",
    "experienceId": "550e8400-e29b-41d4-a716-446655440301",
    "experienceName": "Just Dance",
    "status": "waiting",
    "position": 2,
    "queueOrder": "24",
    "serviceSession": null
  }
}
```

**Resposta após chamada:**

```json
{
  "participationId": "550e8400-e29b-41d4-a716-446655440201",
  "observedAt": "2026-11-05T21:19:00.000Z",
  "currentQueueEntry": {
    "id": "550e8400-e29b-41d4-a716-446655440501",
    "experienceId": "550e8400-e29b-41d4-a716-446655440301",
    "experienceName": "Just Dance",
    "status": "called",
    "position": null,
    "serviceSession": {
      "id": "550e8400-e29b-41d4-a716-446655440601",
      "status": "pending",
      "calledAt": "2026-11-05T21:19:00.000Z",
      "station": { "id": "550e8400-e29b-41d4-a716-446655440401", "label": "Estação 1" }
    }
  }
}
```

**Sem fila interna atual:** `200 OK` com `currentQueueEntry:null`; não retornar `404`, pois a participação existe. Se a participação tiver terminado por tempo/Admin, resposta deve representar seu estado efetivo; `GET /participations/current` e histórico/avaliações seguem sendo necessários para a navegação pós-fechamento. **Não prometer polling em tempo real nem push nesta fase**; o intervalo de consulta e eventual WebSocket ficam para testes do piloto. Queda de rede ou app em segundo plano não registra ausência.

### 16.6 `GET /staff/events/:eventId/stations` — operação por evento

**Staff ativo e autorizado para `eventId`**, com e-mail verificado e sessão válida. Admin global pode ter rota de administração própria; a consulta Staff por si não deve implicar capacidade automática de concluir chamadas. **Resposta:** experiências/estações do evento com `availability` e, de forma operacional mínima, `pendingServiceSessionId` e instante da chamada. Staff pode selecionar estação no momento da operação; não existe relação permanente Staff↔estação.

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "stations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440401",
      "experienceId": "550e8400-e29b-41d4-a716-446655440301",
      "label": "Estação 1",
      "availability": "available",
      "pendingServiceSessionId": null
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440402",
      "experienceId": "550e8400-e29b-41d4-a716-446655440301",
      "label": "Estação 2",
      "availability": "available",
      "pendingServiceSessionId": "550e8400-e29b-41d4-a716-446655440602"
    }
  ]
}
```

Expor somente informações operacionais necessárias e auditáveis; o método presencial de identificação do participante durante a chamada (nome, apelido, senha/identificador visual) **não foi definido** e será alinhado com as telas Staff antes do piloto. Não adicionar dados pessoais às respostas por conveniência.

### 16.7 `PATCH /staff/events/:eventId/stations/:stationId/availability`

**Staff ativo do evento OU Admin global autorizado;** mesma política no guard e serviço. Corpo:

```json
{ "availability": "unavailable" }
```

Validar que `stationId` pertence a uma experiência do evento. Na transação, bloquear evento → experiência → estação; revalidar disponibilidade e pendências. **Não permitir alterar `available → unavailable` enquanto existir uma chamada `pending` nessa estação:** `409 STATION_HAS_PENDING_CALL` e resposta com estado atual. Após confirmar conclusão ou ausência, ela pode ser desativada. `unavailable → available` pode ocorrer se evento permitir operação; não reabre evento encerrado nem aceita chamadas após limite. Repetir mesmo estado pode retornar `200` sem nova mutação, mantendo idempotência natural; manter trilha de auditoria para mudanças efetivas.

**Resposta `200`:** `{ "stationId": "...", "availability": "unavailable", "pendingServiceSessionId": null }`.

Uma estação disponível porém ocupada não pode receber novo chamado. Desativar estação não fecha fila da experiência nem transfere participantes; nenhuma permissão de mudar `queue_accepting_entries` decorre desta rota.

### 16.8 `GET /staff/events/:eventId/experiences/:experienceId/queue`

**Staff por evento.** Validar que a experiência pertence ao evento e consultar informações de fila sem mutá-la. Exemplo:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "experienceId": "550e8400-e29b-41d4-a716-446655440301",
  "observedAt": "2026-11-05T21:18:00.000Z",
  "waitingCount": 3,
  "acceptingNewEntries": true,
  "canCallWaitingEntries": true,
  "firstWaitingQueueEntryId": "550e8400-e29b-41d4-a716-446655440501"
}
```

O primeiro ID é **somente indicação de leitura**; o endpoint de chamada sempre seleciona novamente o primeiro da FIFO dentro da transação. `canCallWaitingEntries` derivado do estado temporal e de operação; a disponibilidade da estação concreta ainda é verificada no `call-next`. Não retornar listagem nominal ou ordem pessoal completa por padrão.

### 16.9 `POST /staff/events/:eventId/experiences/:experienceId/stations/:stationId/call-next`

**Staff ativo com escopo de evento; `Idempotency-Key` obrigatória; corpo `{}`.** O Staff seleciona a estação que está operando naquele momento. A API não delega ao telefone a seleção de qual participante chamar.

**Transação [PROPOSTA]:** bloquear `events FOR SHARE` → `experiences FOR UPDATE` (mutex por fila) → `stations FOR UPDATE`. Localizar o primeiro candidato FIFO por consulta não bloqueante, então bloquear `participations FOR UPDATE` → `queue_entries FOR UPDATE`, **revalidando** que a entrada continua sendo a primeira elegível da fila e que a participação segue `active`. Todos os comandos conflitantes devem seguir essa mesma ordem de locks. Verificar permissão Staff no instante da operação, estação `available` e **sem chamada pendente**, não haver prazo operacional vencido ou encerramento imediato, e a primeira entrada ser do mesmo evento e participação `active`. Inserir `service_sessions.pending`, alterar a entrada para `called`, e finalizar idempotência no mesmo commit. A constraint parcial em `(station_id) WHERE status='pending'` é a última barreira de integridade. **Não usar `SKIP LOCKED` no primeiro da FIFO** quando isso permitir furar fila.

**Resposta `201 Created`:**

```json
{
  "serviceSession": {
    "id": "550e8400-e29b-41d4-a716-446655440601",
    "queueEntryId": "550e8400-e29b-41d4-a716-446655440501",
    "experienceId": "550e8400-e29b-41d4-a716-446655440301",
    "station": { "id": "550e8400-e29b-41d4-a716-446655440401", "label": "Estação 1" },
    "status": "pending",
    "calledAt": "2026-11-05T21:19:00.000Z"
  }
}
```

**Caso duas estações chamem ao mesmo tempo:** A primeira transação bloqueia a fila e chama João na Estação 1; a segunda aguarda o lock da experiência e chama Maria na Estação 2, respeitando FIFO. João nunca recebe duas chamadas. **Caso a fila esteja vazia:** `409 QUEUE_EMPTY`, sem atendimento criado; **estação ocupada:** `409 STATION_HAS_PENDING_CALL`; **indisponível:** `409 STATION_UNAVAILABLE`; **prazo final atingido:** `409 EVENT_OPERATION_ENDED`; **escopo errado:** `403 STAFF_EVENT_FORBIDDEN`; **mesma chave repetida:** resultado idempotente, sem segunda chamada. Alteração de disponibilidade e chamadas disputam os mesmos locks.

### 16.10 `POST /staff/events/:eventId/service-sessions/:serviceSessionId/complete`

**Staff ativo por evento; `Idempotency-Key`; body `{}`.** Resolver o ID → experiência/estação/entrada/participação **sem assumir autorização**, adquirir locks na ordem comum (`events` → `experiences` → `stations` → `participations`/`queue_entries` → `service_sessions`), revalidar Staff, evento, cronologia, `pending` e participação ainda `active` após os locks. Se válida, marcar `service_sessions.status='completed'`, `resolved_at`, `resolved_by_user_id`, encerrar `queue_entries` com `close_reason='completed'` e limpar `participations.current_queue_entry_id`, tudo atomicamente. A estação disponível fica pronta para **outra chamada posterior**, sem autochamada ou marcação automática de presença.

**Resposta `200`:**

```json
{
  "serviceSession": {
    "id": "550e8400-e29b-41d4-a716-446655440601",
    "status": "completed",
    "resolvedAt": "2026-11-05T21:25:00.000Z"
  },
  "queueEntry": { "status": "closed", "closeReason": "completed" },
  "participation": { "status": "active", "currentQueueEntryId": null }
}
```

**Erros:** `409 SERVICE_NOT_PENDING` ou `409 EVENT_OPERATION_ENDED` (com estado atualizado e sem sobrescrever resultado), `403 STAFF_EVENT_FORBIDDEN`, `404` por recurso inexistente/não correspondente ao evento, `401` por sessão inválida. Mesmo token de idempotência devolve resposta anterior; se a operação venceu antes de um concorrente, resultado é mantido. Essa confirmação, e **somente ela**, conta para elegibilidade futura de avaliação.

### 16.11 `POST /staff/events/:eventId/service-sessions/:serviceSessionId/absent`

**Staff ativo por evento; `Idempotency-Key`; body `{}`.** Usar o mesmo conjunto e ordem de locks de `complete`. Registrar **manualmente** `service_sessions.status='absent'`, `resolved_at`, `resolved_by_user_id`; fechar a entrada original com `close_reason='absent'`, sem contar conclusão.

**Se o evento ainda aceita novas entradas internas** (`clock_timestamp() < official_ends_at` **e** antes de fechamento Admin e fila da experiência aberta): alocar **nova** posição no final da mesma fila, criando outra `queue_entries.waiting` e substituindo `participations.current_queue_entry_id` na mesma transação. A entrada antiga continua no histórico. Não se faz reabertura da antiga entrada nem alteração em massa das posições dos demais.

**Se o corte oficial/Admin já ocorreu, mesmo existindo janela operacional residual:** resolver a ausência **sem reentrada**; `participations.status` continua `active` até sua finalização voluntária ou limite operacional, e `current_queue_entry_id=null`. Não forçar ausência extra nem concluir experiência. Se o limite operacional definitivo já foi alcançado, não registrar ausência tardiamente: a chamada pendente é cancelada pelo encerramento.

**Exemplo `200` antes do corte:**

```json
{
  "serviceSession": { "id": "550e8400-e29b-41d4-a716-446655440601", "status": "absent" },
  "previousQueueEntry": { "id": "550e8400-e29b-41d4-a716-446655440501", "status": "closed", "closeReason": "absent" },
  "requeued": true,
  "newQueueEntry": {
    "id": "550e8400-e29b-41d4-a716-446655440502",
    "status": "waiting",
    "queueOrder": "27",
    "position": 3
  }
}
```

**Exemplo após o corte, durante prazo residual:** `{ "serviceSession": { "id": "...", "status": "absent" }, "requeued": false, "newQueueEntry": null }`. A UI não deve inferir que ausência implica automaticamente fim da Arena: essa participação pode continuar `active` até seu término. O Staff não consegue redefinir o resultado após confirmação.

### 16.12 Corridas, prazo efetivo e interoperabilidade com `finish`

**Operações mutuamente excludentes:**

| Corrida | Garantia verificável |
|---|---|
| Duas estações chamam a mesma fila simultaneamente | Lock em `experiences` serializa seleção, primeiro chama João, segundo Maria; nunca João nas duas. |
| Mesmo Staff repete `call-next` após timeout | A mesma `Idempotency-Key` recupera o resultado anterior, sem chamar outra pessoa. |
| Staff tenta chamar estação indisponível/ocupada | Nenhuma entrada passa a `called`; resposta com erro e situação atual. |
| Staff conclui e outro Staff registra ausência | Apenas um estado terminal; a segunda ação não muda `completed` ou `absent`. |
| Participante finaliza enquanto Staff confirma | Transação que vencer define cancelamento ou conclusão; a outra lê estado efetivo e não substitui um resultado terminal. |
| Encerramento Admin imediato vs chamada | Ao commit do fechamento, nenhuma nova chamada é admitida; pendências são canceladas pelo fechamento, não por ausência. |
| Corte por horário ocorre enquanto operação espera lock | Revalidar `clock_timestamp()` depois da espera; não aceitar chamada/conclusão após prazo efetivo; job posterior só regulariza o estado físico. |
| Staff registra ausência durante operação residual | `absent`, sem `requeued`; nenhum `queue_entries` criado depois do corte de inscrições. |
| Queda do aplicativo do Staff/participante | Chamada pendente persiste sem timeout individual; backend é autoridade; reconexão apenas consulta, não registra ausência. |
| Retentativa chega após expurgo da chave de idempotência | Constraints e estados de domínio ainda impedem conclusão/call duplicado impossível; política de TTL a fixar antes de migrações. |

**Cuidado implementacional:** a seleção FIFO estrita e a ordem `events → experiences → stations → participations/entries → sessions` requerem pré-resolução não bloqueante e **revalidação após locks**; uma implementação que bloqueie primeiro a entrada/participação para só então travar experiência pode gerar deadlocks entre Staff e saída voluntária. `READ COMMITTED` com locks curtos e índices únicos é a hipótese de implementação a provar por teste real. A janela residual não garante que um atendimento individual possa ser concluído *depois* do limite: verificação temporal feita próxima à alteração decisiva no banco, sem prometer exatidão de commit em milissegundos.

### 16.13 Fechamento Admin controlado: fila externa preexistente — **OPÇÃO A APROVADA**

**[APROVADO — opção A, 19/10/2026]** No instante em que o Admin inicia um encerramento *controlado*, novas participações e novas inscrições em filas internas deixam de ser aceitas. Todas as participações ainda `waiting` na fila externa são **finalizadas imediatamente**, com `status='finished'`, `finish_reason='admin_controlled_external_wait_closed'` e `finished_at` do encerramento. **Não** marcar como desistência voluntária (`canceled`) nem oferecer avaliação, pois não houve conclusão Staff.

As participações `active` e as filas/chamadas internas preexistentes continuam submetidas ao prazo operacional controlado, no máximo 1h e nunca além do limite original. No prazo definitivo, finalizar restantes e cancelar pendências sem ausência ou conclusão artificial. A troca de estado de `waiting` externa deve ser atômica com a efetivação do encerramento, ou oferecer garantia transacional equivalente, de modo que ninguém permaneça com participação corrente bloqueando outro evento depois da decisão. Preservar histórico e expor aviso padronizado no retorno do aplicativo. **O horário de entrada em filas é cortado também pela antecipação Admin**, não apenas pelo horário oficial; registrar ausência depois dessa antecipação nunca gera reentrada.

**Limite de escopo:** não mexer em D06 quando o evento continua aberto: desligar a fila externa em operação normal ainda libera o grupo de espera externa para `active` e não encerra suas participações. Não criar avaliação nem serviço concluído fictício para pessoas que estavam aguardando fora da Arena.

### 16.14 Cenários de aceitação adicionais (futuros; não executados)

| Caso | Cenário | Resultado esperado |
|---|---|---|
| ST01 | João entra no Just Dance, Estação 1 e 2 disponíveis | Uma única entrada por experiência; ordem compartilhada, sem inscrição por estação. |
| ST02 | Estações 1 e 2 chamam simultaneamente, João e Maria no topo | João para uma estação e Maria para a outra, sem duplo chamado. |
| ST03 | Apenas João aguarda, duas estações chamam | Uma chamada criada; outra recebe `QUEUE_EMPTY`. |
| ST04 | Dois `call-next` com mesma chave por perda de resposta | Mesmo resultado sem novo atendimento. |
| ST05 | Participante tenta entrar em duas filas simultaneamente | Uma entrada corrente; outra operação rejeitada. |
| ST06 | João termina Just Dance e entra de novo | Nova `queue_entry`/ordem e segundo atendimento possível. |
| ST07 | Staff conclui atendimento pendente | `completed` uma vez, contador de conclusões consistente, entrada fechada. |
| ST08 | Staff registra ausência antes do corte e fila aberta | Nova entrada no fim, não conta conclusão. |
| ST09 | Staff registra ausência na margem residual | Sem reentrada; participação continua ativa se o limite não ocorreu. |
| ST10 | Staff tenta desativar estação com chamada pendente | `409 STATION_HAS_PENDING_CALL`, estado íntegro. |
| ST11 | Staff desativa uma estação livre | Não fecha experiência nem altera outra estação. |
| ST12 | Staff de outro evento tenta chamar, concluir, ver fila operacional | `403`/`404` sem dados ou mutação entre eventos. |
| ST13 | Staff perde conexão durante chamada pendente | Não ocorre ausência ou timeout automático. |
| ST14 | Participante finaliza durante fila interna `waiting` | Entrada fechada sem ausência; participação finalizada voluntariamente. |
| ST15 | Participante finaliza durante chamada `pending` | `service_session.canceled` por desistência, sem conclusão/ausência. |
| ST16 | Staff concluir vs participante sair concorrentemente | Só um terminal; conclusão preservada se venceu primeiro. |
| ST17 | Admin fecha imediatamente com duas pendências em estações | Todas canceladas e participações finalizadas; nenhuma conclusão inventada. |
| ST18 | Deadline vence enquanto Staff aguarda lock | Nenhuma chamada/resolução aceita após corte; job idempotente regulariza. |
| ST19 | Fila da experiência fechada para inscrições, porém há usuários esperando | Novas entradas bloqueadas; chamadas existentes seguem permitidas se operação temporal ainda aberta. |
| ST20 | Evento ainda em fila externa sem perfil completo | Não ingressa; fila interna também rejeita participação não `active`. |
| ST21 | Repetir operação com chave igual e payload diferente | `409 IDEMPOTENCY_KEY_REUSED`, sem nova mutação. |
| ST22 | Desligamento da fila externa concorre com encerramento do evento | Fechamento bloqueia liberação que contrariaria o corte; estados terminalizados coerentemente. |
| ST23 | Usuário abre aplicativo após fechamento automático | Consulta estado no servidor, avaliação só se elegível; sem Home forçada. |
| ST24 | Fechamento Admin controlado com participantes `waiting` externos | **Ao início controlado, todas as participações externas ficam `finished`, motivo administrativo; nenhum participante externo permanece aguardando ou recebe avaliação.** |

### 16.15 Dependências do contrato de Staff

- **Não há nova tabela obrigatória** para os endpoints deste capítulo: `experiences`, `stations`, `participations`, `queue_entries`, `service_sessions`, `user_roles` e `idempotency_operations` já constam do dicionário.
- A situação temporal e a disponibilidade efetiva devem ser calculadas no backend; a camada de UI não se torna autoridade pela presença de botões Staff simulados no `ActiveArenaScreen.js`.
- **[VALIDAR antes de congelar contratos]:** formato de `queueOrder` (`bigint` serializado), error codes e TTL de idempotência; frequência de atualização do app/Staff em conexão móvel; política de identificação operacional de pessoas chamadas; direito de modificar `experiences.queue_accepting_entries` (não pressupor Staff); teste concorrente das FKs/locks no PostgreSQL real.
- **[APROVADO]:** opção A para fila externa ao iniciar fechamento controlado antecipado, §16.13. Não há nova decisão pendente neste ponto.
- **[CONSOLIDADO na v0.6.7]:** contratos de avaliações, pendências/retomada e encerramentos/ações administrativas, com auditoria e prazos, no capítulo 17.

**Registro histórico do capítulo v0.6.6:** à época não havia backend nem migrações. **Estado atual diferente:** Task 6.2 implementou a fundação e aplicou migrations em PostgreSQL local (§23); Neon e endpoints de Staff continuam inexistentes. A auditoria do Expo teve 95 testes locais/harness, não valida estes contratos.


## 17. Contratos de integração v0.4 — avaliações, retomada e encerramentos administrativos (19/10/2026)

**Natureza:** contratos HTTP e regras transacionais **propostos** para implementar D07–D10 e as decisões aprovadas. A escolha **A para espera externa durante fechamento controlado já está aprovada** e não necessita nova consulta. Nenhum endpoint abaixo está implementado; exemplos e formatos de erro devem ser confirmados por testes de integração.

### 17.1 Base temporal e estados — duas janelas distintas de avaliação

Uma participação pode ser avaliada somente se `participations.status='finished'` **e** possuir ao menos uma `service_sessions.status='completed'` confirmada por Staff. Participações externas `canceled` voluntariamente ou `finished` administrativamente sem conclusões **não** são elegíveis. Nova participação do mesmo usuário no mesmo evento dá direito a outra avaliação, caso elegível. `evaluations.participation_id` é `UNIQUE`.

- **Primeiro envio:** até **30 dias contados de `participations.finished_at`**. Antes disso, `pending=true` quando elegível e ainda sem avaliação. Expirado esse prazo, não oferecer pendência.
- **Edição integral:** até **7 dias contados de `evaluations.submitted_at`** (nota 1–5 e comentário). A data de atualização não reinicia prazo.
- **Apenas adicionar comentário:** de 7 até 30 dias contados de `evaluations.submitted_at`, se **nenhum comentário jamais foi enviado** (`first_comment_at IS NULL`); nota não muda e essa inclusão só pode acontecer uma vez.
- **Depois de 30 dias contados do primeiro envio:** avaliação congelada.

Esses são **dois relógios independentes**: o prazo inicial começa na finalização da participação; os prazos de edição começam no primeiro envio. **[VALIDAR BORDA SQL]** Definir a implementação de intervalos como comparações precisas em `timestamptz`, e testar o exato instante-limite. No desenho, utilizar `clock_timestamp()` no momento da validação de negócio sob locks; nunca depender do relógio do telefone. `first_comment_at` deve ser preenchido quando um comentário não vazio for enviado pela primeira vez, e **jamais retornar a NULL** mesmo que seja apagado/editado durante a janela integral.

### 17.2 `GET /participations/:participationId/evaluation-eligibility`

**Bearer do próprio titular.** Consulta somente; não cria tabela de pendências. `404` quando participação inexiste/não pertence ao titular; `401` sessão inválida. **`200 OK` ilustrativo:**

```json
{
  "participationId": "550e8400-e29b-41d4-a716-446655440201",
  "participationStatus": "finished",
  "completedServicesCount": 2,
  "eligible": true,
  "submitted": false,
  "pending": true,
  "firstSubmissionDeadlineAt": "2026-12-05T18:42:00.000Z",
  "reason": null
}
```

Para participação não elegível, retornar `eligible=false`, `pending=false` e um `reason` estável, como `NO_COMPLETED_SERVICE`, `NOT_FINISHED` ou `EXTERNAL_WAIT_CLOSED`. Não considerar ausência como conclusão; não confundir `pending=false` por expiração com avaliação já enviada.

### 17.3 `GET /evaluations/pending` — aba Eventos e retomada

**Bearer do titular**. Consultar participações encerradas que tenham serviço concluído, **não** possuam avaliação e estejam dentro do prazo inicial de 30 dias. Ordenar por término recente (proposta) e retornar participação e evento com informações suficientes para abrir a tela correta. Exemplo `200 OK`:

```json
{
  "items": [
    {
      "participationId": "550e8400-e29b-41d4-a716-446655440201",
      "event": { "id": "550e8400-e29b-41d4-a716-446655440101", "name": "ArenaGo — Evento demonstrativo" },
      "finishedAt": "2026-11-05T18:42:00.000Z",
      "firstSubmissionDeadlineAt": "2026-12-05T18:42:00.000Z",
      "completedServicesCount": 2
    }
  ]
}
```

Quando não houver pendências: `items: []`, **não** `404`. Não retornar pessoas nominadas nem respostas do questionário. Considerar várias participações no mesmo evento como itens independentes.

### 17.4 `POST /participations/:participationId/evaluation` — primeiro envio

**Bearer, titularidade, `Idempotency-Key`**, payload `{ "rating": 5, "comment": "Experiência muito boa" }`. `comment` opcional; `rating` inteiro entre 1 e 5. **[PROPOSTA TÉCNICA]** Limite de tamanho de comentário, sanitização e prevenção contra PII indevida devem ser definidos antes de liberar comentários em produção. Não aceitar nota zerada ou ausência de nota.

**Transação:** bloquear participação do titular; revalidar estado terminal e o horário vigente, consultar ao menos uma sessão `completed`, inserir `evaluations` com `participation_id UNIQUE` e, quando há comentário inicial, preencher `first_comment_at` com horário do envio. Gravar a operação idempotente na mesma transação. Corrida de dois POSTs distintos: apenas um cria a avaliação; o segundo recebe `409 EVALUATION_ALREADY_SUBMITTED`, sem sobrescrever. Reenvio da **mesma intenção/chave** retorna o resultado anterior.

**Resposta `201 Created` (exemplo):**

```json
{
  "evaluation": {
    "id": "550e8400-e29b-41d4-a716-446655440801",
    "participationId": "550e8400-e29b-41d4-a716-446655440201",
    "rating": 5,
    "comment": "Experiência muito boa",
    "submittedAt": "2026-11-06T12:00:00.000Z",
    "updatedAt": "2026-11-06T12:00:00.000Z",
    "editableUntilAt": "2026-11-13T12:00:00.000Z",
    "commentAddUntilAt": "2026-12-06T12:00:00.000Z"
  }
}
```

**Erros RFC 7807 (com `code` estável):** `409 EVALUATION_NOT_ELIGIBLE`, `409 EVALUATION_ALREADY_SUBMITTED`, `409 EVALUATION_SUBMISSION_EXPIRED`, `400 INVALID_EVALUATION`, `401`, `404`. Quando a operação for repetida com mesma chave e hash, não criar segunda linha.

### 17.5 `GET /participations/:participationId/evaluation` — visualizar avaliação do titular

**Bearer/titular**. `200 OK` com `{ "evaluation": null, "eligibility": { ... } }` quando ainda não houve envio (não tratar inexistência como erro), ou com avaliação já registrada e permissões de edição calculadas. `404` se a participação não existir ou não pertencer à conta. Não retornar dados pessoais de terceiros.

### 17.6 `PATCH /evaluations/:evaluationId` — edição de avaliação

**Bearer/titular, `Idempotency-Key`**. `rating` e/ou `comment` podem ser informados na janela integral. Depois dessa janela e até 30 dias **após `submitted_at`**, **somente** `{ "comment": "..." }` é permitido se `first_comment_at IS NULL`, exigindo comentário novo e não vazio; proibir qualquer campo `rating` nessa fase (mesmo igual ao anterior). Atualizar `updated_at` sem alterar `submitted_at`.

**Locks sugeridos:** primeiro localizar `participation_id` por consulta sem lock, depois `participations FOR UPDATE` e `evaluations FOR UPDATE`, revalidando titularidade, prazo e `first_comment_at`; atualizar com predicados condicionais, evitando que duas inclusões tardias sejam aceitas. Para `PATCH` repetido com mesma chave, devolver o mesmo resultado; para nova intenção fora da janela, `409 EVALUATION_EDIT_WINDOW_CLOSED` / `409 COMMENT_ALREADY_ADDED`.

**BI:** usar sempre a nota mais recente da avaliação, sem criar versões obrigatórias ou duas contagens da mesma participação. Histórico completo de edição não é requisito aprovado (MD-10); logs de segurança só quando justificados e sem comentários livres.

### 17.7 `GET /participations/return-state` — decisão de navegação após reabrir

**Bearer do titular.** Projeção de leitura para o aplicativo consultar **junto com** `/participations/current` e `/evaluations/pending`, sem persistir outro estado de domínio. Informa se ocorreu finalização automática/administrativa e seu motivo, incluindo eventos encerrados enquanto o app estava fechado, evitando que `current=null` seja confundido com ausência total de histórico.

**Exemplo ilustrativo:**

```json
{
  "recentFinalization": {
    "participationId": "550e8400-e29b-41d4-a716-446655440201",
    "eventId": "550e8400-e29b-41d4-a716-446655440101",
    "finishReason": "admin_immediate",
    "finishedAt": "2026-11-05T18:42:00.000Z"
  },
  "pendingEvaluationParticipationIds": ["550e8400-e29b-41d4-a716-446655440201"]
}
```

**UX aprovada:** se ocorreu finalização automática/administrativa, **não redirecionar cegamente à Home**; apresentar avaliação somente quando elegível, ainda não enviada e no prazo. Permitir “Avaliar mais tarde” e consultar pendências pela aba Eventos. Quando não houve serviço `completed`, informar que o evento foi encerrado sem avaliação. **[VALIDAR CLIENTE]** Como mostrar aviso uma única vez ou quanto tempo considerar um desfecho recente precisa de contrato de apresentação/acknowledgment, sem inventar tabela de notificações. O endpoint de leitura não deve inventar eventos novos ou marcar uma avaliação como enviada.

### 17.8 `POST /admin/events/:eventId/close` — encerramento antecipado

**Bearer Admin global + sessão com TOTP validado, justificativa obrigatória e auditoria.** `Idempotency-Key` recomendado para evitar múltiplos fechamentos por retry. Corpo proposto:

```json
{
  "mode": "controlled",
  "reason": "Interrupção operacional registrada pela organização",
  "controlledUntilAt": "2026-11-05T19:00:00.000Z"
}
```

`mode='immediate'`: não aceitar `controlledUntilAt`; iniciar bloqueio de novas entradas/chamadas, cancelar `service_sessions.pending`, fechar filas internas/externas e finalizar todas as participações abertas **no mesmo encerramento lógico**, preservando `completed`. Ao retornar ao app, avaliação só se elegível. **`mode='controlled'`**: `controlledUntilAt` deve ser futuro, no máximo `clock_timestamp()+1h` e nunca além do `operational_deadline_at` originalmente autorizado; a operação corta **imediatamente** novos ingressos e inscrições internas; todas as participações `waiting` na fila externa vão a `finished` com motivo `admin_controlled_external_wait_closed` **no início do controlado**. Manter as filas internas já existentes e chamadas pendentes da Arena ativa até o prazo antecipado. Se nenhuma janela operacional viável restar, exigir modo imediato ou retornar erro de validação, sem criar prazo passado.

**Atomicidade:** obter `events FOR UPDATE`, serializar contra chamadas e criação de participações, revalidar relógio/limites após locks; atualizar motivo/mode/datas no evento e `audit_logs`, e aplicar finalização dos participantes externos na **mesma transação** para que suas participações não permaneçam correntes após o fechamento. No modo imediato, cancelamento e liberação coerentes são igualmente exigidos. Escalar via lotes apenas se houver desenho de projeção/garantia equivalente validado, sem estado parcialmente publicado. O job de encerramento faz cleanup idempotente no prazo, inclusive após falha da API.

**Resposta ilustrativa `200 OK`:** `{ "eventId": "...", "status": "closing", "closureMode": "controlled", "newEntriesClosedAt": "...", "effectiveOperationalDeadlineAt": "...", "externalWaitingFinalized": 12 }`. Um encerramento imediato pode retornar `status='closed'`. `409 EVENT_ALREADY_CLOSED` quando fechado; `409 CLOSURE_DEADLINE_INVALID` quando solicitado prazo fora do teto; `403` sem Admin/TOTP; `400` justificativa ou payload inválidos. **Encurtar** uma operação controlada já iniciada somente para instante anterior (inclusive encerramento imediato) é compatível com a proibição de reabertura, devendo auditar ação e não ampliar o prazo. **[VALIDAR]** Contrato de edição controlado→controlado e limites exatos para ação repetida diferente não estão aprovados como regras de produto adicionais.

**Auditoria obrigatória:** `actor_user_id`, alvo `event_id`, `action`, `reason`, modo, horário de solicitação, limite anterior, novo limite, origem de operação, timestamp, sem expor a justificativa ao participante como mensagem personalizada. Em caso de erro transacional, não gravar ação de fechamento fictícia.

### 17.9 `PATCH /admin/events/:eventId/schedule` — alteração do horário oficial antes do corte

**Bearer Admin/TOTP + justificativa + auditoria.** Corpo propõe `officialEndsAt` e `operationalDeadlineAt` **juntos**, para preservar a margem opcional de 0–60min de maneira explícita. Não alterar horários **quando** o horário oficial vigente já foi alcançado, nem quando o evento iniciou encerramento Admin, e nunca reabrir evento fechado. Novo `officialEndsAt` deve ser futuro, posterior a `startsAt`; novo `operationalDeadlineAt` entre o novo horário oficial e no máximo 60 minutos depois. Revalidar `clock_timestamp()` após lock, guardar valores antigos/novos em auditoria. `409 EVENT_TIME_CHANGE_CLOSED` se já passou a janela autorizada.

### 17.10 `PATCH /admin/events/:eventId/external-queue` — ligar/desligar fila externa

**Bearer Admin/TOTP + justificativa/auditoria**. Corpo `{ "enabled": false, "reason": "..." }`. Enquanto o evento ainda admite ingressos, **desligar** a fila externa libera atomicamente os participantes `waiting` existentes para `active`; **religar** afeta somente as **novas** participações futuras e não recoloca aqueles já ativos em espera. Depois do corte oficial/Admin, nenhuma alternância pode reabrir ingressos nem liberar fila externa; no fechamento controlado, as esperas externas foram finalizadas conforme §16.13. `409 EVENT_REGISTRATION_CLOSED` para mutação que implicaria reabertura. Usar `events FOR UPDATE` contra novas entradas e auditar transição.

### 17.11 Erros e cenários de aceitação adicionais — futuros, não executados

| ID | Cenário de teste | Resultado esperado |
|---|---|---|
| AV01 | Encerrar participação sem serviço confirmado e tentar avaliar | `eligible=false`, sem POST de avaliação |
| AV02 | Fila externa finalizada por fechamento controlado | Participação `finished`, motivo Admin, zero avaliação |
| AV03 | Participação com uma conclusão confirmada e sem nota | `GET /evaluations/pending` retorna item no prazo |
| AV04 | Duas submissões concorrentes para a mesma participação | Exatamente uma linha `evaluations` |
| AV05 | Avaliar no limite de 30 dias da finalização | Prazo verificado pelo banco; não aceitar fora da janela |
| AV06 | Editar nota antes/depois de 7 dias do primeiro envio | Permitir antes; não permitir depois |
| AV07 | Inserir primeiro comentário entre dias 8 e 30 | Permitir uma vez; rejeitar segundo ou mudança de nota |
| AV08 | Comentário enviado e apagado na primeira semana | `first_comment_at` permanece; não reabilitar inclusão tardia |
| AV09 | Avaliação atualizada no BI | Última nota contribui uma única vez |
| AV10 | Admin encerra imediatamente com pendências em estações | Pendências canceladas, sem ausência/conclusão fictícia; participações finalizadas |
| AV11 | Admin controla às 18h, limite às 19h, externa com 12 pessoas | 12 externas finalizadas às 18h; internas prosseguem; sem novas inscrições |
| AV12 | Admin fecha no instante da confirmação Staff | Uma única ordem/resultado terminal; nenhuma conclusão após corte |
| AV13 | Job de limpeza falha e reinicia | Estado efetivo fechado pelo relógio; replay idempotente |
| AV14 | Admin tenta aumentar horário oficial após o corte vigente | Negado, sem reabrir evento |
| AV15 | Alternar fila externa durante fechamento Admin | Não liberar nem reabrir inscrições |
| AV16 | App reabre após fechamento com avaliação pendente | Fluxo de avaliação e “Avaliar mais tarde”, não Home forçada |
| AV17 | App reabre após fechamento sem conclusão Staff | Aviso de encerramento, sem oferta de avaliação |
| AV18 | Operação repetida com mesma chave de idempotência | Mesmo resultado; sem segunda mutação/auditoria duplicada |

### 17.12 Pendências remanescentes do módulo futuro

**Não são decisões de produto já aprovadas:** mecanismos de aviso visual apresentado uma vez, limites de comentário/moderação, TTL da tabela de idempotência, semântica SQL de bordas de tempo, paginação/supressão de BI, desenho de exclusão LGPD/retention e existência de eventual tabela de agregados realmente anônimos. A conduta em fechamento controlado para pessoas `active` **sem nenhuma fila interna pendente** permanece sendo mantê-las `active` até finalização voluntária ou limite; **não** presumir finalização antecipada delas por equipará-las a `waiting` externas. Reexaminar somente se a operação real demonstrar necessidade.

**Registro histórico do capítulo v0.6.7:** os contratos administrativos foram posteriormente escritos e o DDL local foi executado na Task 6.2 (§23). Atualmente nenhuma API de avaliação/encerramento foi implementada; Neon continua não criada e privacidade/retention permanecem pendentes antes de dados reais.



## 18. Contratos de integração v0.5 — configuração administrativa de eventos, experiências e estações (19/10/2026)

**Natureza:** [PROPOSTA TÉCNICA]. As capacidades decorrem das decisões de produto já aprovadas. **Não** são endpoints existentes; o schema de banco já foi aplicado na Task 6.2; as rotas deste capítulo não foram implementadas. Não duplicar controles de papéis, encerramento, horários ou fila externa já definidos nas seções 14–17. Todos os endpoints abaixo usam prefixo `/api/v1` no deployment e respostas de erro `application/problem+json` (RFC 7807, como a Task 6.1). Os nomes de erro são códigos propostos para integração, não enums previamente homologados.

### 18.1 Autorização, isolamento e responsabilidades

- **Somente Admin global, sessão válida e TOTP ativado/verificado** pode criar eventos, experiências, estações ou editar suas configurações. Papel `staff` de um evento **não** concede CRUD administrativo. As operações de disponibilidade de estação seguem a rota operacional existente `PATCH /staff/events/:eventId/stations/:stationId/availability` (§16.7), autorizada também para Admin. Não criar duas implementações dessa regra.
- A concessão/revogação de Staff continua sendo responsabilidade do **módulo de papéis** da Task 6.1 reconciliada: `POST /admin/roles/grant` com `role='staff'` e `eventId`, e `POST /admin/roles/revoke` com ID da concessão. **Não** criar `POST /admin/events/:id/staff` duplicado. E-mail verificado é pré-requisito para conceder Staff; prontidão exige ainda conta ativa e concessão Staff não revogada.
- Todos os IDs aninhados devem ser validados em sua **cadeia de pertencimento**: estação → experiência → evento. Nunca confiar em `eventId` enviado pelo cliente se a relação persistida disser outra coisa; verificar pelo banco.
- Alterações administrativas relevantes recebem justificativa quando exigida pela operação; registrar ator, objeto, tipo de alteração, antes/depois mínimo e instante na tabela `audit_logs`, na transação da mutação. Não registrar payloads secretos nem permitir que uma falha de escrita produza auditoria fictícia.
- Idempotência durável (mesma chave + mesmo ator + rota/operação + hash de payload) em criação e mutações críticas. Reuso da mesma chave com payload diferente deve ser `409 IDEMPOTENCY_KEY_REUSED`; nunca criar duas experiências ao repetir a mesma requisição.

### 18.2 Inventário de rotas de configuração (proposta)

| Método e rota | Responsabilidade | Observação de compatibilidade |
|---|---|---|
| `GET /admin/events` | Listagem paginada e filtros de eventos do Admin | Não substitui consulta participante `/events/lookup` |
| `POST /admin/events` | Cadastrar evento inicialmente `scheduled` | Evento pode existir ainda **não pronto** para abrir |
| `GET /admin/events/:eventId` | Ler configuração e estado efetivo do evento | Incluir deadlines original e administrativo, sem expor dados pessoais |
| `PATCH /admin/events/:eventId` | Editar campos cadastrais **permitidos** | Campos mutáveis por fase ainda devem ser congelados antes do SQL |
| `GET /admin/events/:eventId/readiness` | Mostrar critérios de prontidão e falhas | Cálculo derivado; não acrescenta tabela `event_readiness` |
| `GET /admin/events/:eventId/experiences` | Listar experiências/estações para gestão | Não confundir com a visão do participante (§16.3) |
| `POST /admin/events/:eventId/experiences` | Cadastrar experiência específica do evento | Fila compartilhada; contador inicia em zero |
| `PATCH /admin/events/:eventId/experiences/:experienceId` | Editar nome/configuração estrutural autorizada | Alteração estrutural após uso exige validação especial |
| `POST /admin/events/:eventId/experiences/:experienceId/stations` | Cadastrar estação para experiência | Nova estação não cria fila separada |
| `PATCH /admin/events/:eventId/experiences/:experienceId/stations/:stationId` | Editar identificação estrutural da estação | Disponibilidade permanece em §16.7 |

**Rotas já existentes no contrato e que não devem ser recriadas:** `PATCH /admin/events/:id/schedule` (§17.9); `PATCH /admin/events/:id/external-queue` (§17.10); `POST /admin/events/:id/close` (§17.8); `PATCH /staff/events/:id/stations/:id/availability` (§16.7); operações de concessão/revogação de Staff/Admin da Task 6.1. **[LACUNA IDENTIFICADA]** a v0.6.7 ainda não detalhava o comando para abrir/fechar a entrada de **uma fila de experiência** (`experiences.queue_accepting_entries`). Ele pode ser especificado como `PATCH /staff/events/:eventId/experiences/:experienceId/queue` com `{ "acceptingEntries": false }`, com verificação Staff do evento ou Admin global. **Não implementar automaticamente** até confirmar ownership/permissões na etapa dos contratos Staff: fechar entrada não cancela quem já aguarda e reabrir nunca supera os cortes temporal/Admin.

### 18.3 `POST /admin/events` — evento cadastrado, não necessariamente operacional

Corpo ilustrativo, UTC para instantes, IANA para horário local de exibição:

```json
{
  "name": "BEAST MARAGAMES — Dia 1",
  "accessCode": "BEAST-D1",
  "timezone": "America/Sao_Paulo",
  "startsAt": "2026-11-05T17:00:00.000Z",
  "officialEndsAt": "2026-11-05T23:00:00.000Z",
  "operationalDeadlineAt": "2026-11-06T00:00:00.000Z",
  "externalQueueEnabled": true,
  "reason": "Cadastro e preparação do evento"
}
```

**Validações:** `name` não vazio; código único em todo o histórico, normalizado de modo consistente entre cliente e PostgreSQL; fuso IANA real; `startsAt < officialEndsAt ≤ operationalDeadlineAt ≤ officialEndsAt + 60min`. Validar formato e intervalos no backend e `CHECK`/índices no PostgreSQL, sem aceitar arredondamentos silenciosos. A regra dos **60 minutos é um máximo opcional**, não valor automático. Campos de fechamento Admin começam nulos; `external_last_order=0`; estado persistido inicial `scheduled`.

**Resposta `201 Created` ilustrativa:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440101",
  "status": "scheduled",
  "accessCode": "BEAST-D1",
  "readiness": {
    "ready": false,
    "missing": ["EXPERIENCE_WITH_AVAILABLE_STATION", "VERIFIED_ACTIVE_STAFF"]
  }
}
```

Permitir criação antes de cadastrar experiências e conceder Staff é **necessário**: essas entidades dependem da existência do evento. O evento incompleto permanece consultável na interface Admin, mas não aceita participações. `409 ACCESS_CODE_ALREADY_USED` para código já reservado, inclusive por evento encerrado. Não expor a consulta pública como ferramenta de enumeração desnecessária.

**[APROVADO] Código de ingresso imutável:** `accessCode` só pode ser informado na criação do evento e **jamais** alterado depois, inclusive antes da abertura. Seu valor normalizado deve permanecer reservado por todo o histórico dos eventos. `PATCH /admin/events/:eventId` e quaisquer outros comandos rejeitam tentativa de mudar o código; não existe rota de alteração nem tabela adicional de reserva de códigos. O índice `UNIQUE` e a preservação histórica protegem a não reutilização. A função `normalizeEventAccessCode()` é a normalização canônica do backend e deve ser compartilhada pela criação futura e pela consulta. Excluir fisicamente o evento para liberar o código é proibido. A regra de exclusão/anônimos de dados pessoais não é autorização para apagar registros históricos.

### 18.4 `GET /admin/events/:eventId/readiness` — prontidão de abertura automática

**Resposta `200 OK` ilustrativa:**

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "statusStored": "scheduled",
  "effectivePhase": "scheduled",
  "ready": false,
  "missing": ["VERIFIED_ACTIVE_STAFF"],
  "checks": {
    "nameAndAccessCode": true,
    "validScheduleAndTimezone": true,
    "externalQueueConfigured": true,
    "hasExperienceWithAvailableStation": true,
    "hasVerifiedActiveStaff": false
  },
  "acceptingNewParticipations": false
}
```

Prontidão aprovada (§2.3 e Planejamento C-05): nome, código, horários válidos, fuso IANA, fila externa configurada, ≥1 experiência do evento com estação disponível e ≥1 `user_roles` Staff vigente de conta ativa e e-mail verificado, **sem exigir Staff conectado agora**. O usuário deve poder receber orientação clara sobre critérios faltantes, mas os detalhes de configuração ficam **exclusivamente** em resposta Admin. A abertura é automática quando `startsAt` foi alcançado, ainda não ocorreu corte de novos ingressos e o evento está pronto. Se a configuração só ficar pronta depois de `startsAt`, aceitar abertura ainda dentro da janela originalmente válida; se o horário de corte já passou, **não reabrir**. Não é necessário endpoint `POST /admin/events/:id/open`.

**Rechecagem transacional obrigatória:** `POST /events/:eventId/participations` deve avaliar estado, hora efetiva e prontidão sob controle concorrente, mesmo que `GET /readiness` tenha respondido `ready=true` antes. Status persistido atrasado e tarefas de abertura atrasadas **não** liberam inscrições indevidas. O teste de prontidão, por si, não reserva estação ou Staff. Conforme C-14 e §20.2, se todos os Staff aptos ou todas as estações disponíveis forem perdidos, suspender novas participações sem alterar as existentes, filas ou `events.status`; não encerrar o evento automaticamente. A restauração de capacidade permite novas admissões somente enquanto os cortes temporal e administrativo ainda não as tiverem encerrado. Esta disponibilidade deve ser reavaliada dinamicamente.

### 18.5 Gestão de experiências e estações — estrutura, não operação física

`POST /admin/events/:eventId/experiences` recebe, por exemplo, `{ "name": "Just Dance" }`. Retorna `201` com `id`, `eventId`, `name`, `queueAcceptingEntries` inicial e contador de ordem inicializado em zero. A experiência nasce **vinculada ao evento**, não existe catálogo global de experiências. Toda experiência possui uma fila única, mesmo com várias estações.

`POST /admin/events/:eventId/experiences/:experienceId/stations` recebe `{ "label": "Estação 1" }` e retorna `201` com `id`, `experienceId`, `label`, `availability: "available"` (valor inicial **proposto**, não regra de produto). Uma estação cadastrada não é automaticamente ocupada nem exige Staff fixo. `GET` administrativo lista os relacionamentos e o resumo de chamada pendente derivado de `service_sessions`, nunca um campo duplicado `stations.current_service_id`.

`PATCH` estrutural de experiência ou estação deve atuar somente nos campos permitidos, fazer `SELECT ... FOR UPDATE` nos objetos relacionados e gravar auditoria. **Não incluir exclusão física de experiências/estações utilizadas por filas/atendimentos** na primeira versão: seus IDs são referências históricas de BI e auditoria. Se houver demanda por ocultação/arquivamento antes do primeiro uso, definir `archived_at` em nova revisão e seus efeitos na prontidão. Sem exigência operacional documentada, não acrescentar DELETE estrutural ou `archived_at` por suposição.

A alteração de disponibilidade é **comando operacional** (§16.7), inclusive quando iniciada pelo Admin: uma estação `available` com `service_sessions.pending` não pode ser desativada até a ocorrência pendente ser resolvida; várias estações compartilham a fila da experiência; nenhuma alteração estrutural substitui confirmação manual de conclusão/ausência.

**[VALIDAR]** Limitar edição de nome de experiência, nome/label de estação e demais configurações depois do início do evento ou da primeira participação, pois nomes mudados podem afetar relatórios históricos. Manter `id` e relacionamento imutáveis; reparentar estação/experiência é fora do escopo do MVP e deve ser rejeitado. Não presumir que apagar estação livre elimine dados históricos.

### 18.6 `PATCH /admin/events/:eventId` — campos do evento, sem contornar operações críticas

**[PROPOSTA]** aceitar alteração de `name`/metadados administrativos não críticos enquanto a política de imutabilidade estrutural permitir. **Não** aceitar em PATCH genérico: `accessCode` ([APROVADO] imutável após criação; ver 18.3), `officialEndsAt`, `operationalDeadlineAt` (usar §17.9), `externalQueueEnabled` (usar §17.10), `status`, `closureMode`, `closureRequestedAt` ou `adminDeadlineAt` (usar §17.8). Proibir cliente de preencher contadores FIFO, relógios internos ou campos de auditoria.

Não definir comportamento de exclusão/cancelamento do evento como sinônimo de `DELETE /events`: o fluxo aprovado para parar funcionamento é o **encerramento administrativo auditável**. Arquivar visualmente eventos fechados, se solicitado depois, não deve remover a reserva vitalícia do código de ingresso.

### 18.7 Corridas administrativas e transações de prontidão

- **Criação/edição estrutural:** transação, bloquear `events` e depois `experiences` e `stations` quando aplicável; validar relacionamento, fase/tempo após locks, e auditar somente mudança efetiva. Mudanças de Staff por `user_roles` exigem checagem atualizada e testes para evitar leituras inconsistentes durante uma concessão/revogação simultânea.
- **Mudança de horário/fechamento Admin:** seguir exclusivamente §17.8–17.10, sem promover uma edição de DTO genérico a atalho para reabrir, ampliar prazo após corte ou mudar fila externa durante fechamento.
- **Códigos:** mesmo `accessCode` enviado simultaneamente por dois Admins resulta em no máximo um cadastro (`UNIQUE`) e resposta previsível ao outro. C-10 define alfabeto ASCII e 4–64 caracteres após `String.trim()`; a função TypeScript valida antes de converter para maiúsculas. `upper(btrim())` não implementa integralmente essas regras; eventual CHECK adicional exige auditoria e migração futura.
- **Prontidão e ativação:** não persistir `is_ready` como fonte de verdade. `events.status` é observação persistida, mas o aceite efetivo usa tempo, encerramentos, configuração e permissões. Não criar um job cujo atraso autorize entrada após horário oficial.
- **Idempotência e auditoria:** criação repetida pela mesma chave retorna resultado original sem duplicar evento/estação nem ações auditadas; chaves diferentes e mesmo código violam `UNIQUE`, não geram duas linhas.

### 18.8 Matriz adicional de erros (proposta)

| Operação | Código HTTP e problema | Conduta |
|---|---|---|
| Admin sem TOTP | `403 ADMIN_2FA_REQUIRED` | Negar qualquer mutação de configuração |
| Identificador de outro evento | `404 RESOURCE_NOT_FOUND` | Não revelar dados cruzados sem necessidade |
| Código de ingresso já usado | `409 ACCESS_CODE_ALREADY_USED` | Manter reserva histórica |
| Evento incompleto quando abre | `409 EVENT_NOT_READY` na tentativa de ingresso | Expor ao participante mensagem neutra; detalhes só no painel Admin |
| Nova inscrição no corte oficial/Admin | `409 EVENT_REGISTRATION_CLOSED` | Nunca autorizar por cache `status=open` |
| Estação com chamada pendente | `409 STATION_HAS_PENDING_CALL` | Resolver ocorrência antes de desativar |
| Mutação estrutural proibida pela fase | `409 EVENT_CONFIGURATION_LOCKED` | Não apagar/reatribuir estruturas com histórico |
| Reuso de chave idempotente com novo corpo | `409 IDEMPOTENCY_KEY_REUSED` | Não executar uma segunda operação |
| Campo/horário/formato inválido | `400 BAD_REQUEST` ou `422 VALIDATION_ERROR`, padronizar | RFC 7807 com campo/razão e sem vazamento |

### 18.9 Testes adicionais — contratos administrativos (a executar com PostgreSQL real)

| ID | Cenário | Resultado esperado |
|---|---|---|
| AD01 | Admin cria evento antes de qualquer experiência/Staff | Evento cadastrado `scheduled`, prontidão `false`, ingresso negado |
| AD02 | Cadastra Just Dance e duas estações para mesmo evento | Uma experiência/uma fila FIFO, duas estações com IDs distintos |
| AD03 | Staff ativo/verificado de evento A não existe em B | Prontidão B não considera Staff A; acesso operacional em B negado |
| AD04 | Admin concede Staff verificado e uma estação fica disponível | Critério de prontidão passa a verdadeiro, sem exigir conexão Staff |
| AD05 | Horário de início alcançado e prontidão true | Aceitar ingresso sem clique administrativo e sem depender de cron |
| AD06 | Hora inicial passou, prontidão só ficou true depois | Abrir se ainda dentro do período válido; nunca depois do corte oficial |
| AD07 | Admin tenta duplicar código antigo de evento encerrado | Violação de unicidade; não reutilizar código |
| AD08 | Dois cadastros simultâneos do mesmo código com chaves diferentes | Uma linha; outro recebe `409`, sem duplicação de auditoria |
| AD09 | Staff tenta criar/editar experiência pelo endpoint Admin | `403`; papel Staff não significa Admin |
| AD10 | Admin tenta desativar estação ocupada por chamada pendente | `409 STATION_HAS_PENDING_CALL`, estado preservado |
| AD11 | Admin tenta alterar horário após corte vigente via PATCH genérico | Campo rejeitado; usar rota específica, que também nega após corte |
| AD12 | Admin tenta atribuir estação à experiência de outro evento | FK/validação recusa associação cruzada |
| AD13 | Retry idempotente de criação de estação após resposta perdida | Uma estação, mesmo resultado, sem contagem/auditoria duplicada |
| AD14 | Evento perde seu último Staff ou estação depois de abrir | Cobrir política pendente de suspensão operacional sem inferir decisão |
| AD15 | Repetir auditoria depois de falha de transação | Não criar log de evento/edição que não comitou |

### 18.10 Checklist de privacidade e retenção **antes do primeiro banco com dados reais**

O modelo foi construído para permitir descarte controlado de informações identificáveis. Isso **não** constitui conformidade automática com a LGPD nem aprova prazos que ainda não foram discutidos. A política deve especificar, antes do piloto público, pelo menos:

1. **Inventário e finalidade:** `users`, `profiles`, `user_games`, `participations`, `participation_profile_snapshots`, `service_sessions`, `evaluations.comment`, auditoria, IP/User-Agent, tokens e logs de API; identificar bases legais, transparência e minimização por finalidade, considerando dados de crianças/adolescentes.
2. **Retenção e expurgo:** prazos por categoria, sessões expiradas/tokens consumidos, comentários livres, logs de segurança, backups e recuperação de desastre; separar dado pessoal operacional de estatística efetivamente anônima.
3. **Exclusão controlada de conta:** impedir novos comandos/revogar sessões; terminar filas/chamadas ativas sem inventar ausência ou conclusão; processar relacionamentos por transação/etapas idempotentes; preservar somente agregados estatísticos que passem pela avaliação de anonimização; eliminar ou tornar irrecuperáveis snapshots, avaliações identificáveis e referências pessoais sem base legítima de retenção; registrar prova mínima do processamento sem perpetuar o identificador em log analítico.
4. **BI:** definir grupos mínimos/supressão, granularidade de datas/idades e comentários, recomputação de métricas com avaliações editadas, exportação controlada, revisão de possibilidade de reidentificação e exclusão de pequenas amostras; `user_id=NULL` sozinho não anonimiza.
5. **Auditoria e incidentes:** procedimentos de acesso restrito, integridade das ações administrativas, redação/expurgo compatíveis com obrigações legais; nunca bloquear o direito de exclusão com trigger genérico de snapshot `BEFORE DELETE RAISE EXCEPTION`.
6. **Testes reais:** solicitar exclusão após usuário estar em fila externa, após chamada pendente, após duas participações em eventos distintos, com avaliação e dados no BI; verificar nenhuma referência pessoal remanescente indevida, nenhuma estação presa e ausência de retenção oculta em exportações/logs/backups.

**Dependência de migrações:** `audit_logs` com FKs opcionais que possam ser desvinculadas conforme a política; `games.created_by_user_id ON DELETE SET NULL`; snapshots com exclusão controlada (sem indelével); não executar `DELETE FROM users` diretamente sem planejar `participations` e efeitos em filas. **[VALIDAR]** Agregados seguros de BI podem requerer tabela extra após política; não criá-la com dimensões ainda não avaliadas. Se a equipe decidir por histórico estatístico durável após exclusão, desenhar mecanismo antes de processar pedidos reais para evitar perda indevida ou reidentificação.

### 18.11 Pendências remanescentes após o detalhamento

**Concluído neste documento:** contratos propostos de CRUD Admin de preparação; prontidão calculada; reuso dos comandos existentes para Staff, horário, fila externa, estação e fechamento; casos de erro e testes; dependências de privacidade.

**Resolvido posteriormente:** mudanças estruturais e perda do último Staff/estação foram aprovadas por C-13/C-14 (ver §20); o DDL foi compilado e aplicado localmente na Task 6.2 (§23). **Ainda necessário:** autorização/contrato para pausar uma fila de experiência quando o serviço futuro for criado e políticas de retenção/anonimização antes do piloto com dados pessoais.

**Evolução posterior:** a validação estrutural e a fundação NestJS já ocorreram em PostgreSQL local na Task 6.2, sem Neon (§23). Não interpretar a antiga recomendação de construção como trabalho pendente ou autorização de endpoints.

## 19. Resolução documental anterior — código de ingresso

A decisão C-10 estabelece código **único, imutável e não reutilizável** desde a criação. A migração `0002` inclui trigger de imutabilidade e índice único histórico. A regra aprovada de formato/normalização está detalhada no §2.3 e implementada para a consulta interna da E01.2B. A integração do cliente e a validação da criação de eventos continuam trabalho futuro; o CHECK SQL existente oferece proteção parcial e não substitui a função TypeScript. Uma restrição SQL completa poderá exigir migração incremental futura após auditoria dos dados.

## 20. Regras operacionais aprovadas — alterações estruturais e perda de capacidade

**Hierarquia:** as decisões deste §20 substituem expressamente as antigas marcações de **[VALIDAR]** e **[PENDENTE]** sobre mudança estrutural e perda da última estação/Staff em §18. Não modificam D01–D11, código de ingresso imutável, limite temporal oficial, fechamento Admin ou a exigência de autenticação Staff/Admin. A fundação Drizzle foi implementada posteriormente; as regras operacionais ainda dependem dos services futuros (§23).

### 20.1 Matriz de operações e momento permitido

| Operação | Antes da primeira participação histórica | Após a primeira participação histórica, se o evento não está encerrado | Regras independentes |
|---|---|---|---|
| Criar experiência no evento | Sim | **Não** | `409 EVENT_CONFIGURATION_LOCKED`; código do evento permanece imutável |
| Alterar nome de experiência ou identificação/label de estação | Sim | **Não** | Mesmo se a primeira participação já foi finalizada/cancelada |
| Adicionar estação à **experiência existente** | Sim | **Sim**, durante a operação | Mesmo `experience_id`, sem nova fila; sem mover estação de outra experiência/evento |
| Excluir experiência/estação que já teve uso | **Não** se houver uso | **Não** | IDs de histórico preservados; delete estrutural geral não está especificado para MVP |
| Alternar disponibilidade de estação | Sim | Sim | Bloquear se houver `service_sessions.pending` nela; disponibilidade não implica ocupação |
| Conceder/revogar Staff no evento | Sim | Sim | Regras de conta verificada e Admin TOTP; remoção do último Staff não pode ser impedida por segurança |
| Alterar hora/encerrar/controlar filas | Regras próprias | Regras próprias | Somente D07/D09 e contratos já aprovados; nenhuma rota estrutural contorna cortes |

**Definição técnica do marco de bloqueio:** `EXISTS (SELECT 1 FROM participations WHERE event_id = :eventId)` — qualquer participação histórica conta, inclusive `waiting`, `finished` ou `canceled`. Uma descontinuação da fila externa não reabilita mudança de nome ou criação de experiência. Não confundir com `participations.status IN ('waiting', 'active')`.

**Concorrência com o primeiro ingresso:** no contrato de ingresso `POST /events/:eventId/participations`, e nos PATCH/POST estruturais, serializar no **mesmo registro `events`** (ou mecanismo transacional equivalente), revalidando a existência de qualquer participação depois do lock. Se o primeiro ingresso for registrado antes, o comando estrutural posterior deve falhar; se a mutação estrutural comitar antes, o ingresso deve enxergar a nova configuração e validar prontidão novamente. É proibido decidir apenas com a observação prévia de `GET /admin/events/:id/readiness`.

### 20.2 Prontidão e perda de Staff ou estações — sem fechamento artificial

- **Admissão de novas participações:** além dos horários, estado Admin, questionário completo e demais condições, verificar **no momento da transação** se existe `user_roles` Staff vigente e apto (conta ativa e e-mail verificado) no evento e **alguma experiência com estação disponível**. Se a última atribuição Staff for revogada ou a última estação disponível deixar de estar operacional, `POST /events/:id/participations` nega novas admissões com um motivo neutro como `409 EVENT_TEMPORARILY_UNAVAILABLE` (código proposto para contrato). **Não** gravar `events.status='closed'` por falta de recursos nem cancelar participações existentes.
- **Entrada na fila de uma experiência:** se **nenhuma estação desta experiência** estiver disponível, negar **novas** `queue_entries`, mantendo as que já aguardam e sem alterar seus contadores de ordem. Outras experiências com capacidade continuam aptas. A estação pode ser reativada enquanto o corte temporal/administrativo ainda permitir novas inscrições.
- **Revogação do último Staff:** não condicionar a operação de revogação à capacidade mínima; a segurança prevalece. Revalidar a autorização Staff na operação seguinte, inclusive chamada/conclusão/ausência. Ocupações pendentes continuam registradas até resolução autorizada ou encerramento definitivo — não marcar ausente nem completar automaticamente por falta de Staff.
- **Estação com chamada pendente:** a tentativa de desativação é rejeitada (`409 STATION_HAS_PENDING_CALL`) até ser resolvida pela operação normal. Assim, a perda da última estação disponível por desativação voluntária somente ocorre se a estação não tem pendência; o bloqueio é anterior à alteração.
- **Retomada automática da capacidade:** restabelecer Staff ou estação não requer novo botão de abertura, mas novas entradas só são permitidas se o horário corrente ainda for **anterior ao corte oficial**, nenhuma conclusão/fechamento Admin tiver encerrado admissões e a prontidão continuar verdadeira. A fila interna da experiência volta a aceitar entradas apenas quando também estiver `queue_accepting_entries=true` e demais guardas forem cumpridos.
- **Participantes existentes:** preservar espera externa e entradas internas, sequência FIFO, serviço concluído e elegibilidade de avaliação. Não emitir evento de ausência/cancelamento nem navegar à Home por essa suspensão temporária.

### 20.3 Transações e restrições SQL de proteção — especificação para validação

1. **Serialização de ingresso e configuração:** bloquear `events` por `FOR UPDATE` em todas as mutações estruturais e em todo ingresso para decidir a elegibilidade estrutural. Alteração de nome não deve ser permitida mesmo que não haja **participações atuais**; vale o histórico inteiro.
2. **Disponibilidade + ingressos:** sincronizar o bloqueio de `events` com desativação da última estação e revogação do último Staff, para que a checagem de prontidão não observe uma configuração que foi removida concorrentemente. As rotas de `user_roles` da Task 6.1 precisam participar do protocolo de coordenação do **evento afetado**, com uma ordem de bloqueios comum à operação de ingresso, sem comprometer a capacidade de revogação por segurança. Não basta uma simples leitura de Staff/estações sem proteção contra atualização concorrente.
3. **Bloqueios por estação:** respeitar o comando de disponibilidade em §16.7, checar `service_sessions` pendentes transacionalmente, não criar ponteiro redundante `stations.current_service_id`.
4. **Adicionar estação:** `INSERT` na experiência existente, garantir FKs/escopo do evento, manter contadores e `queue_entries` atuais intactos. Nenhuma fila compartilhada adicional.
5. **Tempo e capacidade:** o retorno da disponibilidade não reabre evento já encerrado. Verificar horas com relógio autoritativo do DB depois de eventuais esperas por locks.

### 20.4 Complementos aos contratos administrativos

| Endpoint já proposto | Alteração de regra |
|---|---|
| `POST /admin/events/:eventId/experiences` | Negar se `EXISTS(participations)`; inclusive histórico cancelado |
| `PATCH /admin/events/:eventId/experiences/:experienceId` | Campos estruturais de nome bloqueados após primeira participação |
| `POST /admin/events/:eventId/experiences/:experienceId/stations` | Permitir adicionar estações à experiência existente durante operação, mesmo após primeira participação, mantendo fila única |
| `PATCH /admin/events/:eventId/experiences/:experienceId/stations/:stationId` | Identificação estrutural bloqueada após primeira participação |
| `PATCH /staff/events/:eventId/stations/:stationId/availability` | Manter bloqueio de desativação com chamada pendente; ao perder última estação, suspender novos ingressos sem alterar participações |
| `POST /admin/roles/revoke` e `/grant` | Manter autorização por evento da Task 6.1; coordenar perda/restauração do último Staff com a verificação de prontidão do evento |
| `POST /events/:eventId/participations` | Verificar prontidão atual e cortes temporais/Admin sob transação; retomar apenas antes do fechamento |
| `POST /participations/:id/queue-entries` (ou rota equivalente do §16) | Negar novas entradas na experiência sem estação disponível; preservar quem já aguarda |

**Código HTTP e erro:** a rejeição por indisponibilidade temporária deve ser distinguível da rejeição definitiva por corte do evento. `EVENT_TEMPORARILY_UNAVAILABLE` e `EXPERIENCE_TEMPORARILY_UNAVAILABLE` são sugestões de nomes RFC 7807, a confirmar com o catálogo único de erros no momento de congelar DTOs. `EVENT_CONFIGURATION_LOCKED` já estava proposto em §18.8.

### 20.5 Matriz de testes novos para PostgreSQL real

| ID | Cenário de integração/concorrência | Esperado |
|---|---|---|
| OP01 | Admin cria experiência antes do primeiro ingresso | Operação permitida |
| OP02 | Usuário cria a primeira participação externa; Admin tenta criar experiência após o commit | `409`; bloqueio vale também para primeira participação `waiting` |
| OP03 | Primeira participação cancelada; Admin tenta mudar label de estação | `409`, histórico impede mudança |
| OP04 | Primeira participação e mudança de nome concorrentes | Apenas a operação que obteve serialização primeiro decide; estado final consistente |
| OP05 | Admin adiciona terceira estação ao Just Dance após várias participações | Estação adicionada à experiência; FIFO permanece única; contadores/posições não reiniciam |
| OP06 | Admin tenta excluir estação/experiência com histórico de serviços | Exclusão física rejeitada |
| OP07 | Admin desativa a única estação com chamada pendente | `409 STATION_HAS_PENDING_CALL`; chamada preservada |
| OP08 | Desativa última estação desocupada do evento | Novos ingressos negados; filas existentes, posições e conclusões preservadas |
| OP09 | Revoga único Staff com evento aberto | Revogação permitida; novos ingressos negados; nenhuma ausência/cancelamento automática |
| OP10 | Concessão de Staff ou reativação de estação antes do corte oficial | Novo ingresso permitido se todos os critérios de prontidão estiverem novamente satisfeitos |
| OP11 | Capacidade retorna após corte oficial ou administrativo | Nenhuma nova participação/fila; evento não reabre |
| OP12 | Experiência A perde todas as estações, experiência B mantém estação | Entradas novas em A negadas; em B continuam sob as demais regras |
| OP13 | Nova admissão concorre com revogação do último Staff | Não aceitar admissão sob prontidão desatualizada; serializar decisão |
| OP14 | Nova admissão concorre com desativação da última estação | Não aceitar admissão sob prontidão desatualizada; respeitar pendências |
| OP15 | App reinicia durante indisponibilidade temporária | Participação/posição recuperáveis; nenhuma ausência por desconexão |

### 20.6 Situação e próxima etapa

As duas decisões operacionais anteriormente pendentes no §18 estão **resolvidas** por C-13/C-14. A consolidação do esquema, as cinco migrações e as verificações locais foram concluídas segundo o relatório da Task 6.2 (§23). Os cenários operacionais OP01–OP15 permanecem pendentes como serviços futuros. Concluir os procedimentos LGPD antes de usar dados pessoais reais.

## 21. Histórico de validação estrutural v0.6.11 [ANTES DA FUNDAÇÃO]

O Codex informou que o esquema experimental compilou, gerou SQL e criou 23 tabelas PostgreSQL, com DB-01–DB-16 aprovados em protocolos mínimos. Foram identificados ajustes: versão não nula do questionário, default de bigint serializável, FK circular posterior, nomes curtos de constraints, idempotência transacional, relógio relido após locks e códigos de recuperação seguros. Todos foram dirigidos ao ciclo de migração subsequente. Essa validação **não abrangia API NestJS nem dados reais**; seu relato completo existe no arquivo da auditoria anterior.

## 22. Histórico de validação incremental v0.6.12 [ANTES DA FUNDAÇÃO]

No experimento anterior à Task 6.2, o Codex gerou cinco SQLs e os aplicou em sequência via `psql` em PostgreSQL 16.15 descartável (23 tabelas); confirmou a FK circular em `0004`, os checks de perfil e os 16 testes DB. O experimento ainda não validava o ciclo do migrador dentro do repositório. A Task 6.2 posteriormente testou o histórico Drizzle e duas instalações locais (§23). **Esses resultados anteriores não devem ser confundidos com endpoints implementados.**

## 23. Marco da Task 6.2 — fundação implementada [RELATO DO CODEX]

**Origem:** resultado de execução enviado pelo usuário nesta conversa. O diretório `backend/` não foi enviado para auditoria independente; as conclusões abaixo são **reportadas**, não inspeção própria do código.

### 23.1 Entregas da fundação

- NestJS + TypeScript em `backend/`, configuração de ambiente, conexão PostgreSQL via `pg`, schemas Drizzle das **23 tabelas** e scripts de migração/testes.
- SQL versionado em cinco etapas: `0001_identity_profile`, `0002_events_base`, `0003_credentials_roles`, `0004_event_operations`, `0005_idempotency`.
- Trigger de imutabilidade do código em `0002` e FK circular via `ALTER TABLE` em `0004`; regras de gênero “Outro” e cinco opções válidas do questionário reportadas como checks do banco.
- Banco PostgreSQL **local 16.15**: cinco migrações aplicadas via histórico Drizzle em **dois bancos novos** e reaplicação no primeiro sem duplicação.
- `npm run db:check`, `npm run build`, `npm run lint`: passaram; `npm test` = **1** teste aprovado; `npm run test:integration` = **21** casos aprovados (DB-01–DB-17, V11-01, V11-05, V11-09 e imutabilidade do código).
- Smoke NestJS inicializado e retornando `404` em `/`, **esperado porque ainda não há rotas de negócio**. `git diff --check` aprovado.
- Catálogo informado: **23 tabelas, 35 FKs, 104 constraints, 65 índices, 9 índices parciais e 5 checks de perfil**.
- Sem Neon nem alterações Expo. No momento do relatório, ainda não havia commit da fundação e o `HEAD` era `63fd0bb`; posteriormente, a Task 6.2 foi registrada localmente no commit `4c4acbb`, branch `develop`.
- `npm audit` reportou **4 vulnerabilidades moderadas** no ferramental de desenvolvimento/migrações: triagem pendente, sem aplicar `--force` sem análise.

### 23.2 Critério de aceitação e limites

A fundação pode ser considerada **concluída segundo o relatório**, sem certificar prontidão de produção. Os testes reais foram de schema, integridade e protocolos mínimos; não houve implementação/validação HTTP de cadastro, login, sessão JWT, 2FA, permissões Staff/Admin, fila/encerramento, avaliações, BI, LGPD ou comunicação Expo–API.

**Os arquivos da fundação são fonte técnica de verdade do DDL efetivamente aplicado.** Este dicionário é referência de intenção e revisão; se algum campo, índice ou trigger divergir, **não editar retroativamente migrations existentes**: diagnosticar no repositório e planejar migração incremental após aprovação específica.

### 23.3 Decisão de escopo vigente

O responsável pelo ArenaGo definiu a E01.2B para normalização e consulta interna de eventos. A Task 6.3A (cadastro/login/refresh/logout/me) segue proposta, sem autorização registrada nesta etapa. Endpoints HTTP, integração frontend, deploy/Neon e procedimentos com dados pessoais reais continuam fora do escopo documentado aqui.

**Estado após E01.2B:** função de normalização, consulta interna e testes focados registrados em §24. Este documento e o Planejamento v0.7.9 registram a decisão; endpoints HTTP continuam não implementados. Git será controlado manualmente pelo responsável.

## 24. E01.2B — normalização e consulta de eventos por código

`backend/src/events/access-code.ts` exporta `normalizeEventAccessCode()` e `EventAccessCodeValidationError`. A função remove whitespace externo com `String.trim()`, valida comprimento de 4–64 caracteres e padrão ASCII alfanumérico separado opcionalmente por hífens, então retorna maiúsculas. Validar antes de `toUpperCase()` evita aceitar expansões Unicode como `ß` para `SS`. A mesma função é a autoridade para consulta implementada e criação futura.

`EventsService.findByAccessCode()` normaliza a entrada e usa `eq(events.accessCodeNormalized, normalizedCode)` com Drizzle. Código válido sem evento retorna `null`; entrada malformada lança erro de domínio antes da consulta. O método é interno: não adiciona Controller/rota, não grava no PostgreSQL e não verifica prontidão, horário, participação ou fila. `findById()` permanece disponível.

Os testes unitários cobrem caixa, whitespace ASCII/Unicode externo reconhecido pelo `trim()`, hífens, limites de tamanho, caracteres inválidos, erro tipado e idempotência. O teste PostgreSQL cobre busca exata/lowercase/whitespace, ausência válida, rejeição de entrada inválida, preservação da linha e manutenção de `findById()`. A suíte de integração só pode ser executada quando `EVENTS_TEST_DATABASE_URL` comprovar localhost e o banco descartável `arenago_events_test`.

**Validação desta revisão:** `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd run typecheck:test` e `git diff --check` passaram. `npm.cmd test` não concluiu porque o ambiente lançou `uv_os_get_passwd returned ENOMEM`; portanto, a aprovação dos testes unitários permanece pendente e o comando deve ser reproduzido manualmente no PowerShell. A integração não foi executada: `EVENTS_TEST_DATABASE_URL` não estava configurada para comprovar o banco descartável.

O CHECK existente `access_code_normalized = upper(btrim(access_code_normalized))`, o índice `UNIQUE` e o trigger de imutabilidade são proteções distintas e parciais: não implementam o conjunto de regras de formato C-10. Não reescrever as cinco migrações aplicadas. Uma restrição SQL mais completa poderá ser proposta depois de auditar dados e exigirá migração incremental; nenhuma migração foi criada pela E01.2B.

**Histórico de versão:** v0.6.15 (21/10/2026) registra a decisão C-10 aprovada, a normalização compartilhada e consulta E01.2B, corrige afirmações antigas de pendência, distingue função TypeScript das garantias SQL, registra os resultados/limites das validações e não altera decisões históricas não relacionadas.

## 25. Correção documental de C-14 — perda de capacidade após abertura

**v0.6.16 (21/10/2026):** removida da seção 18.4 a marcação histórica `[VALIDAR]` que tratava como indefinido o efeito da perda de Staff/estações após abertura. C-14 e §20 já aprovam bloquear dinamicamente novos ingressos, preservar participações e filas, não alterar o status nem encerrar automaticamente o evento; a restauração só permite novas entradas antes dos cortes. Nenhuma regra de produto nova foi criada.

## 26. Complemento C-15 — desistência interna sem finalizar participação

**v0.6.17 (30/10/2026):** decisão de negócio aprovada pelo responsável após a entrega inicial da E07.1. Corrigida a delimitação da §16.2: titular pode abandonar a fila interna, inclusive após chamada, e continuar com participação `active`. Registrados requisitos de locks, resolução atômica de `pending` sem ausência/conclusão, idempotência, preservação de histórico/FIFO e distinção entre corte de ingressos e prazo da saída. Conferidos estados e campos de motivo no schema/migração existentes; nenhum código novo de motivo ou rota HTTP foi arbitrado. Operação reservada à E07.3, sem implementar E07.2/E07.3, alterar código/testes, criar migrations, executar testes ou conectar a bancos nesta rodada.
