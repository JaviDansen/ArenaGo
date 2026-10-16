# ArenaGo — Task 6.1: Planejamento e Arquitetura Técnica do Backend

**Versão do Documento:** 1.1
**Data:** 16/10/2026
**Status:** Especificação técnica consolidada e revisada após auditoria da equipe
**Branch:** `task-6.1-planejamento-backend` (criada a partir da `develop` atualizada)
**Escopo:** Backend de Usuários, Autenticação, Sessões, Perfil, Questionário e Catálogo de Jogos

---

## Sumário Executivo

Este documento estabelece a especificação arquitetural e o detalhamento técnico para a implementação do backend do **ArenaGo**, em estrita conformidade com as decisões aprovadas pelo projeto e consolidadas no Planejamento Geral (v0.5), integrando os ajustes técnicos decorrentes da auditoria e revisão de arquitetura.

A solução adota **Node.js com TypeScript** sob o framework **NestJS** (adaptador HTTP padrão Express), estruturado como um **Monólito Modular**. A persistência de dados utiliza **PostgreSQL** (com hospedagem preferencial no **Neon Serverless Postgres**), mapeado via **Drizzle ORM** com o driver nativo `pg` e controle rigoroso de esquemas por migrações SQL versionadas através do **Drizzle Kit**.

Principais diretrizes consolidadas nesta revisão técnica:
1. **Cadastro e Questionário Desacoplados:** O cadastro cria imediatamente uma conta válida e ativa; o questionário de 3 etapas pode permanecer pendente sem impedir o login ou o uso da conta, sendo consultável com status `200 OK` (`hasCompleted: false`).
2. **Catálogo de Jogos Canônico e Deduplicação Atômica:** Inserção concorrente segura via CTE atômica no PostgreSQL, garantindo que jogos existentes tenham seu ID reutilizado sem jamais sobrescrever sua grafia canônica original.
3. **Linhagem de Refresh Tokens e Detecção de Reuso:** Rotação de refresh tokens transacional com tabela dedicada para histórico da sessão, detecção imediata de reutilização de tokens antigos, revogação sumária da sessão comprometida e tratamento de concorrência com tolerância a corridas de rede legítimas.
4. **Sessão Única por Conta:** Garantida não apenas na lógica da aplicação, mas imposta a nível de banco de dados via índice único condicional no PostgreSQL (`idx_sessions_single_active_per_user`), com controle transacional via `SELECT ... FOR UPDATE` no login e validação por chave primária de sessão (`sid`) em cada requisição protegida.
5. **Recuperação de Senha Atômica:** Fluxo transacional estrito que consome o token, atualiza o hash Argon2id, invalida tokens anteriores e revoga todas as sessões ativas da conta em uma única transação ACID.
6. **Conexão Segura TLS:** Configuração rigorosa de conexão com PostgreSQL/Neon com verificação estrita de certificados (`rejectUnauthorized: true`), eliminando vulnerabilidades a ataques Man-in-the-Middle (MITM).
7. **Autenticação Administrativa e 2FA/TOTP:** Especificação completa do desafio de dois fatores (RFC 6238 e backup codes), onboarding do primeiro Admin com auditoria autêntica de sistema (`CLI_BOOTSTRAP`), e recuperação de credenciais restrita a outro Administrador. Preservada a compatibilidade cumulativa de papéis sem antecipar definições de negócio sobre elegibilidade de eventos.
8. **Padronização de Erros e Contratos:** Conformidade formal com a **RFC 7807** (`application/problem+json`) e detalhamento completo de payloads de entrada, saída, códigos HTTP e validações.

---

## 1. Visão Geral da Arquitetura

### 1.1 Estilo Arquitetural e Tecnologias Centrais

| Componente | Tecnologia Selecionada | Justificativa / Papel no Sistema | Situação |
|---|---|---|---|
| **Runtime & Linguagem** | Node.js 22 LTS + TypeScript 5.x | Tipagem estática fim a fim, alto desempenho de I/O assíncrono e ecossistema maduro. | **[DECISÃO APROVADA]** |
| **Framework Backend** | NestJS (adaptador padrão Express) | Arquitetura modular corporativa, injeção de dependências, controle de ciclo de vida e organização previsível. | **[DECISÃO APROVADA]** |
| **Padrão Arquitetural** | Monólito Modular | Módulos desacoplados compartilhando o mesmo processo de execução e banco relacional, minimizando sobrecarga operacional e viabilizando custo zero inicial. | **[DECISÃO APROVADA]** |
| **Banco de Dados** | PostgreSQL 16 (Neon Serverless) | Banco relacional robusto com suporte nativo a constraints, transações ACID, índices funcionais e parciais, tipos específicos (`DATE`, `UUID`, `JSONB`) e extensão serverless. | **[DECISÃO APROVADA]** |
| **ORM & Migrações** | Drizzle ORM + `pg` + Drizzle Kit | ORM leve e tipado em TypeScript sem sobrecarga de runtime, garantindo controle total sobre SQL gerado, transações interativas seguras e migrações versionadas. | **[DECISÃO APROVADA]** |
| **Segurança de Senhas** | Argon2id (`@node-rs/argon2`) | Algoritmo vencedor da Password Hashing Competition (PHC), recomendado pela OWASP para proteção contra ataques de GPU/ASIC. | **[PROPOSTA KALED]** |
| **Autenticação & Sessões** | JWT Stateless (15m) + Tabela de Sessões Indexada | Combinação ágil: token de acesso curto (15m) com validação de revogação imediata via chave primária de sessão (`sid`), garantindo sessão única ativa imposta por constraint no PostgreSQL. | **[DECISÃO APROVADA]** |
| **Linhagem de Tokens** | Tabela `refresh_tokens` associada à sessão | Rotação transacional de refresh tokens com preservação de histórico, detecção imediata de reutilização de credenciais antigas e revogação da sessão. | **[DECISÃO APROVADA]** |
| **Autenticação 2FA Admin** | TOTP (RFC 6238 via `otplib`) + Backup Codes | Segundo fator obrigatório para ações administrativas, segredo cifrado com AES-256-GCM e códigos de recuperação de uso único. | **[DECISÃO APROVADA]** |
| **Envio Transacional de E-mail** | Resend (SDK `@resend/node`) | Camada de entrega com cota gratuita generosa (3.000 e-mails/mês), compatível com domínio próprio e DNS configurado. | **[PROPOSTA KALED]** |

### 1.2 Diagrama Arquitetural de Alto Nível

```mermaid
graph TB
    subgraph MobileClient ["Aplicativo Móvel ArenaGo (React Native / Expo)"]
        UI["Telas de UI (Register, Login, ForgotPassword, Questionnaire)"]
        SecureStore["Armazenamento Seguro (expo-secure-store: Refresh Token)"]
        MemoryStore["Armazenamento em Memória (Access Token / Context)"]
        AxiosClient["Cliente HTTP (Interceptores de Refresh com Mutex e 401)"]
    end

    subgraph BackendAPI ["API NestJS — Monólito Modular"]
        Gateway["Reverse Proxy / SSL / Throttler Guard (Rate Limit por IP e Conta)"]
        AuthMod["AuthModule (Argon2id, JWT, Recuperação, 2FA/TOTP)"]
        UserMod["UsersModule (Gestão de Contas e Credenciais)"]
        SessMod["SessionsModule (Sessão Única, Rotação e Detecção de Reuso)"]
        RoleMod["RolesModule (RBAC: Ciente, Staff, Admin + Auditoria)"]
        ProfMod["ProfileModule (Dados Pessoais e Respostas)"]
        GameMod["GamesModule (Catálogo e Deduplicação Case-Insensitive Atômica)"]
        EmailMod["EmailModule (Serviço Transacional Resend)"]

        FutureMods["Módulos Futuros (Events, Queues, Attendances, Evaluations, BI)"]
    end

    subgraph DataLayer ["Camada de Persistência (Neon Serverless PostgreSQL)"]
        NeonPooler["Neon Connection Pooler (PgBouncer - TLS rejectUnauthorized: true)"]
        Drizzle["Drizzle ORM Engine + Driver 'pg'"]
        PostgresTables[("Tabelas Relacionais: users, sessions, refresh_tokens, profiles, games, roles, tokens")]
    end

    subgraph ExternalServices ["Serviços Externos"]
        EmailService["Provedor de E-mail (Resend API)"]
    end

    UI --> AxiosClient
    AxiosClient --> Gateway
    Gateway --> AuthMod
    Gateway --> UserMod
    Gateway --> ProfMod
    Gateway --> GameMod

    AuthMod --> SessMod
    AuthMod --> UserMod
    AuthMod --> RoleMod
    AuthMod --> EmailMod
    ProfMod --> GameMod

    EmailMod --> EmailService

    AuthMod --> Drizzle
    UserMod --> Drizzle
    SessMod --> Drizzle
    RoleMod --> Drizzle
    ProfMod --> Drizzle
    GameMod --> Drizzle

    Drizzle --> NeonPooler
    NeonPooler --> PostgresTables
```

---

## 2. Análise do Frontend Atual e Alinhamento de Requisitos

A análise dos fluxos de autenticação, perfil e questionário presentes no frontend atual estabelece os pontos de contato e as regras definitivas de integração:

### 2.1 Mapeamento Comparativo de Campos e Validações

| Fluxo / Tela | Campos Coletados no Frontend | Validação Atual no Frontend | Regra Aprovada para o Backend | Ação / Alinhamento Necessário |
|---|---|---|---|---|
| **Cadastro** (`RegisterScreen.js`) | `name`<br>`email`<br>`password`<br>`confirmPassword` | - `name`: obrigatório, trimmed.<br>- `email`: obrigatório, regex padrão.<br>- `password`: mínimo 6 caracteres.<br>- `confirmPassword`: estritamente igual à senha. | - Criação imediata de conta válida e ativa.<br>- `name`: obrigatório (máx 150 carac.).<br>- `email`: obrigatório, normalizado com `LOWER(TRIM(email))`.<br>- `password`: mínimo 8 caracteres (máx 128 carac.), bloqueio de senhas comuns.<br>- `confirmPassword` não é enviado ao backend.<br>- **Questionário permanece pendente**. A resposta indica `hasCompletedQuestionnaire: false`. | **Ajuste:** O backend criará a conta de `Participante` imediatamente e emitirá sessão ativa com indicador explícito de que o questionário está pendente. |
| **Login** (`LoginScreen.js`) | `email`<br>`password` | - `email`: obrigatório, formato válido.<br>- `password`: obrigatório. | - Autenticação por e-mail e hash seguro Argon2id.<br>- Criação de sessão única ativa com revogação da anterior sob transação atômica.<br>- Permite login normalmente mesmo com questionário incompleto.<br>- Retorna status do questionário (`hasCompletedQuestionnaire`). | O cliente recebe os tokens e o estado da conta. Se o questionário estiver pendente, o app poderá permitir navegação normal ou sugerir o preenchimento posterior. |
| **Recuperação de Senha** (`ForgotPasswordScreen.js`) | *Placeholder* (sem campos funcionais) | Apenas aviso visual "Em construção". | - Envio de e-mail com token de 32 bytes criptograficamente seguro (validade 30 min).<br>- Rate limit: 1 a cada 2 min por conta, máx 5/hora por conta, teto por IP.<br>- Resposta opaca sem revelar existência de conta.<br>- Redefinição atômica: consome token, atualiza senha, invalida tokens anteriores e revoga todas as sessões. | Implementação completa dos endpoints `POST /auth/forgot-password` e `POST /auth/reset-password`. |
| **Questionário — Etapa 1: Sobre você** (`ProfileQuestionnaireScreen.js`) | `birthDate`<br>`gender`<br>`otherGender`<br>`education` | - `birthDate`: máscara DD/MM/AAAA, conversão para civil `YYYY-MM-DD`, rejeita data futura e impossível.<br>- `gender`: 1 opção entre Feminino, Masculino, Outro, Prefiro não informar.<br>- `otherGender`: obrigatório apenas se `gender === 'Outro'`.<br>- `education`: 1 opção entre Fundamental, Médio, Superior, Pós-graduação, Prefiro não informar. | - `birthDate`: armazenar estritamente como tipo SQL `DATE` (sem horas, sem conversão de timezone).<br>- `gender` e `education`: enums padronizados.<br>- `otherGender`: `varchar(100)` anulável. | Preservar a integridade do formato civil de data. Endpoint autenticado `PUT /profile/questionnaire`. |
| **Questionário — Etapa 2: Seus jogos** (`ProfileQuestionnaireScreen.js`) | `selectedGames` (Array de strings) | - Mínimo 1 jogo selecionado.<br>- Sugestões de catálogo (20 jogos do `mockGames`).<br>- Inclusão manual livre digitada pelo usuário.<br>- Deduplicação local case-insensitive `toLowerCase().trim()`. | - Catálogo persistido em tabela `games` (`is_curated = true`).<br>- Jogos manuais persistidos em `games` (`is_curated = false`) com deduplicação case-insensitive via CTE atômica que **reutiliza o ID sem jamais modificar o nome canônico existente**.<br>- Vínculo N:N em `user_games` idempotente. | Disponibilizar endpoint `GET /games` para sugestões e aceitar novos nomes no payload do questionário. |
| **Questionário — Etapa 3: Mercado de games** (`ProfileQuestionnaireScreen.js`) | `marketKnowledge`<br>`marketInterest` | - `marketKnowledge`: 1 opção ('Sim, conheço.', 'Conheço um pouco.', 'Não conheço.').<br>- `marketInterest`: 1 opção ('Sim, tenho interesse.', 'Talvez — quero conhecer melhor.', 'Não tenho interesse.'). | - Campos obrigatórios persistidos no perfil do usuário.<br>- Integrados ao snapshot imutável em futuras participações de eventos. | Armazenar no perfil e compor a estrutura congelada na participação. |
| **Consulta do Questionário** | Consulta de estado e respostas | Não existe atualmente chamada de rede. | - Endpoint `GET /profile/questionnaire`.<br>- **Se não preenchido:** retorna `200 OK` com `hasCompleted: false` e campos em `null` (não retorna 404).<br>- **Se preenchido:** retorna `200 OK` com `hasCompleted: true` e todas as respostas. | Permite que o app identifique o estado sem tratar ausência de respostas como erro de rede ou conta inexistente. |
| **Consulta do Perfil** (`ProfileScreen.js`) | `id`, `name`, `email`, `roles`, `hasCompletedQuestionnaire` | Leitura de contexto em memória. | - Endpoint autenticado `GET /profile`.<br>- Retorna identidade da conta, verificação de e-mail, papéis e estado de conclusão do questionário. | Integração com endpoint autenticado para exibição na aba de Perfil. |
| **Atualização do Perfil** (`ProfileScreen.js`) | `name` | Edição local do nome. | - Endpoint autenticado `PATCH /profile`.<br>- Atualiza dados cadastrais permitidos do usuário (nome de exibição: 2 a 150 caracteres). | Integração com endpoint autenticado com validação e retorno atualizado. |


---

## 3. Estrutura de Módulos e Diretórios do NestJS

Para atender ao requisito de **Monólito Modular** expansível, o backend adota a separação por domínios de negócio com injeção de dependências estrita.

```text
backend/
├── src/
│   ├── common/                          # Utilitários compartilhados, decorators e filtros
│   │   ├── constants/                   # Constantes de sistema (tokens, tempos, limites)
│   │   ├── decorators/                  # @CurrentUser(), @Roles(), @Public(), @Require2FA()
│   │   ├── filters/                     # HttpExceptionFilter (padronização estrita RFC 7807)
│   │   ├── guards/                      # JwtAuthGuard, RolesGuard, SessionGuard, TotpGuard
│   │   ├── interceptors/                # LoggingInterceptor, SensitiveDataInterceptor
│   │   └── pipes/                       # ZodValidationPipe (validação tipada de DTOs)
│   │
│   ├── config/                          # Configuração centralizada e validação de ambiente
│   │   ├── env.schema.ts                # Schema Zod para variáveis de ambiente
│   │   └── configuration.ts             # Fábrica de configurações tipadas
│   │
│   ├── database/                        # Configuração do Drizzle ORM e migrações
│   │   ├── schema/                      # Schemas de tabelas por domínio
│   │   │   ├── users.schema.ts          # users, user_totp_credentials, user_backup_codes
│   │   │   ├── sessions.schema.ts       # sessions, refresh_tokens
│   │   │   ├── tokens.schema.ts         # password_reset_tokens, email_verification_tokens
│   │   │   ├── roles.schema.ts          # user_roles, role_audit_logs
│   │   │   ├── profiles.schema.ts       # profiles
│   │   │   ├── games.schema.ts          # games, user_games
│   │   │   └── index.ts                 # Exportação unificada do esquema
│   │   ├── drizzle.provider.ts          # Provedor do cliente Drizzle conectado ao pool pg seguro
│   │   └── database.module.ts           # Módulo global de banco de dados
│   │
│   ├── modules/                         # Módulos funcionais do domínio
│   │   ├── auth/                        # Módulo de Autenticação e Credenciais
│   │   │   ├── dto/                     # RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto
│   │   │   ├── strategies/              # JwtStrategy, RefreshStrategy
│   │   │   ├── auth.controller.ts       # Endpoints /auth/*
│   │   │   ├── auth.service.ts          # Regras de cadastro, login, redefinição atômica
│   │   │   ├── password-hasher.service.ts # Implementação de Argon2id e blacklist de senhas
│   │   │   └── auth.module.ts
│   │   │
│   │   ├── sessions/                    # Gerenciamento de Sessões Ativas e Linhagem de Tokens
│   │   │   ├── sessions.service.ts      # Sessão única, rotação, detecção de reuso e revogação
│   │   │   ├── sessions.repository.ts   # Operações com bloqueio transacional FOR UPDATE
│   │   │   └── sessions.module.ts
│   │   │
│   │   ├── users/                       # Gestão de Identidade e Contas
│   │   │   ├── users.service.ts         # Busca, criação e verificação de contas
│   │   │   ├── users.repository.ts      # Consultas de persistência de usuários com e-mail normalizado
│   │   │   └── users.module.ts
│   │   │
│   │   ├── roles/                       # Gestão de Papéis e Auditoria (RBAC)
│   │   │   ├── dto/                     # GrantRoleDto, RevokeRoleDto
│   │   │   ├── roles.service.ts         # Concessão, revogação e validação dinâmica no servidor
│   │   │   ├── audit.service.ts         # Registro imutável de trilha de auditoria
│   │   │   ├── roles.controller.ts      # Endpoints administrativos de permissões
│   │   │   └── roles.module.ts
│   │   │
│   │   ├── profile/                     # Perfil Pessoal e Questionário
│   │   │   ├── dto/                     # UpdateProfileDto, ProfileResponseDto, UpdateQuestionnaireDto, QuestionnaireResponseDto
│   │   │   ├── profile.controller.ts    # Endpoints /profile e /profile/questionnaire
│   │   │   ├── profile.service.ts       # Gestão cadastral de perfil, gravação em lote e consulta de estado
│   │   │   └── profile.module.ts
│   │   │
│   │   ├── games/                       # Catálogo de Jogos e Sugestões
│   │   │   ├── dto/                     # SearchGamesDto, CreateCustomGameDto
│   │   │   ├── games.controller.ts      # Endpoint /games (busca com deduplicação)
│   │   │   ├── games.service.ts         # Consulta e inserção atômica case-insensitive (CTE)
│   │   │   └── games.module.ts
│   │   │
│   │   ├── email/                       # Comunicação Transacional
│   │   │   ├── templates/               # Templates HTML de recuperação e verificação
│   │   │   ├── email.service.ts         # Integração com Resend / fallback de log local
│   │   │   └── email.module.ts
│   │   │
│   │   └── admin/                       # Administração e Segundo Fator (2FA)
│   │       ├── dto/                     # VerifyTotpDto, SetupTotpDto, ResetTotpDto
│   │       ├── admin.controller.ts      # Endpoints de 2FA, reset de TOTP e governança
│   │       ├── totp.service.ts          # Geração e validação de RFC 6238 e backup codes
│   │       └── admin.module.ts
│   │
│   │   # MÓDULOS RESERVADOS PARA FASES POSTERIORES (Não implementados nesta task):
│   │   # ├── events/                    # Eventos e Experiências
│   │   # ├── queues/                    # Filas Compartilhadas e Chamadas
│   │   # ├── attendances/               # Atendimentos nas Estações e Conclusões
│   │   # └── evaluations/               # Avaliações de Participações
│   │
│   ├── scripts/                         # Comandos de linha de comando (CLI)
│   │   └── promote-first-admin.ts       # Script seguro de bootstrap do 1º Admin (origem CLI)
│   │
│   ├── app.module.ts                    # Módulo raiz do NestJS
│   └── main.ts                          # Ponto de entrada da aplicação
│
├── drizzle/                             # Arquivos gerados pelo Drizzle Kit
│   ├── migrations/                      # Arquivos .sql versionados sequencialmente
│   └── meta/                            # Metadados de snapshots de esquema do Drizzle
│
├── tests/                               # Estrutura de testes do backend
│   ├── unit/                            # Testes unitários puros (services e utilitários)
│   ├── integration/                     # Testes de integração com banco PostgreSQL real
│   └── e2e/                             # Testes ponta a ponta de contratos HTTP (Supertest)
│
├── drizzle.config.ts                    # Configuração do Drizzle Kit
├── package.json
├── tsconfig.json
└── .env.example                         # Modelo documentado de variáveis de ambiente
```

---

## 4. Diagrama de Entidades e Relacionamentos (ERD)

O diagrama abaixo especifica todas as tabelas, tipos de dados, chaves primárias/estrangeiras e cardinalidades do núcleo de identidade, autenticação, sessões, linhagem de tokens e questionário, bem como os relacionamentos conceituais futuros de eventos e snapshots imutáveis.

```mermaid
erDiagram
    users ||--o| profiles : "possui (0..1 opcional)"
    users ||--o{ sessions : "possui histórico (1:N, max 1 ativa)"
    sessions ||--o{ refresh_tokens : "possui linhagem rotacionada (1:N)"
    users ||--o{ password_reset_tokens : "solicita (1:N)"
    users ||--o{ email_verification_tokens : "recebe (1:N)"
    users ||--o{ user_roles : "possui papéis únicos ativos (1:N)"
    users ||--o{ role_audit_logs : "é alvo de (1:N)"
    users ||--o| user_totp_credentials : "configura 2FA (1:1)"
    users ||--o{ user_backup_codes : "possui códigos backup (1:N)"
    users ||--o{ user_games : "joga (1:N)"
    games ||--o{ user_games : "selecionado em (1:N)"
    games ||--o| users : "adicionado por (N:1 opcional)"

    %% Relações conceituais futuras (não implementadas nesta task)
    users ||--o{ participations : "participa (1:N futuro)"
    participations ||--|| participation_questionnaire_snapshots : "congela perfil (1:1 futuro)"

    users {
        uuid id PK
        varchar_150 name
        varchar_255 email UK_lower
        text password_hash
        timestamp_tz email_verified_at
        boolean is_active
        timestamp_tz created_at
        timestamp_tz updated_at
    }

    profiles {
        uuid id PK
        uuid user_id FK,UK
        date birth_date
        varchar_30 gender
        varchar_100 other_gender
        varchar_30 education
        varchar_50 market_knowledge
        varchar_50 market_interest
        timestamp_tz completed_at
        timestamp_tz created_at
        timestamp_tz updated_at
    }

    games {
        uuid id PK
        varchar_100 name UK_case_insensitive
        boolean is_curated
        uuid created_by_user_id FK
        timestamp_tz created_at
    }

    user_games {
        uuid user_id PK,FK
        uuid game_id PK,FK
        timestamp_tz created_at
    }

    sessions {
        uuid id PK
        uuid user_id FK
        varchar_45 ip_address
        varchar_255 user_agent
        timestamp_tz expires_at
        timestamp_tz last_activity_at
        timestamp_tz revoked_at
        varchar_50 revocation_reason
        timestamp_tz created_at
    }

    refresh_tokens {
        uuid id PK
        uuid session_id FK
        varchar_64 token_hash UK
        boolean is_revoked
        timestamp_tz consumed_at
        timestamp_tz expires_at
        timestamp_tz created_at
    }

    password_reset_tokens {
        uuid id PK
        uuid user_id FK
        varchar_64 token_hash UK
        timestamp_tz expires_at
        timestamp_tz used_at
        varchar_45 ip_address
        timestamp_tz created_at
    }

    email_verification_tokens {
        uuid id PK
        uuid user_id FK
        varchar_255 email
        varchar_64 token_hash UK
        timestamp_tz expires_at
        timestamp_tz verified_at
        timestamp_tz created_at
    }

    user_roles {
        uuid id PK
        uuid user_id FK
        varchar_30 role
        uuid event_id
        uuid granted_by FK
        timestamp_tz granted_at
        timestamp_tz revoked_at
        uuid revoked_by FK
    }

    role_audit_logs {
        uuid id PK
        uuid actor_id FK_nullable
        uuid target_user_id FK
        varchar_30 action
        varchar_30 role
        uuid event_id
        text reason
        varchar_45 ip_address
        timestamp_tz created_at
    }

    user_totp_credentials {
        uuid id PK
        uuid user_id FK,UK
        text secret_encrypted
        boolean is_verified
        timestamp_tz created_at
        timestamp_tz updated_at
    }

    user_backup_codes {
        uuid id PK
        uuid user_id FK
        varchar_64 code_hash UK
        timestamp_tz used_at
        timestamp_tz created_at
    }

    participations {
        uuid id PK
        uuid user_id FK
        uuid event_id FK
        varchar_30 status
    }

    participation_questionnaire_snapshots {
        uuid id PK
        uuid participation_id FK,UK
        date birth_date
        integer age_at_event
        varchar_30 gender
        varchar_30 education
        varchar_50 market_knowledge
        varchar_50 market_interest
        jsonb games_snapshot
        timestamp_tz created_at
    }
```

---

## 5. Dicionário de Dados Relacional

Abaixo estão detalhadas todas as tabelas, colunas, tipos do PostgreSQL, restrições e índices.

### 5.1 Tabela `users`
Armazena a identidade principal de todas as contas do sistema.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `name`: `VARCHAR(150) NOT NULL` (nome de exibição informado no cadastro)
  - `email`: `VARCHAR(255) NOT NULL` (e-mail normalizado com `LOWER(TRIM(email))`)
  - `password_hash`: `TEXT NOT NULL` (hash Argon2id)
  - `email_verified_at`: `TIMESTAMP WITH TIME ZONE NULL` (data da confirmação do e-mail)
  - `is_active`: `BOOLEAN NOT NULL DEFAULT true` (controle de ativação da conta)
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `updated_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Restrições de Unicidade & Índices:**
  - `CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(TRIM(email)));` (Garante unicidade insensível a maiúsculas e espaços)

### 5.2 Tabela `profiles`
Armazena os dados pessoais e as respostas do questionário do usuário.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Cardinalidade com `users`:** Relação `0..1`. A ausência de registro na tabela `profiles` ou `completed_at IS NULL` indica formalmente que o questionário está **pendente**.
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`
  - `birth_date`: `DATE NOT NULL` (**Regra mandatória: sem hora, sem conversão de timezone**)
  - `gender`: `VARCHAR(30) NOT NULL` (Valores: `'Feminino'`, `'Masculino'`, `'Outro'`, `'Prefiro não informar'`)
  - `other_gender`: `VARCHAR(100) NULL` (obrigatório se `gender = 'Outro'`)
  - `education`: `VARCHAR(30) NOT NULL` (Valores: `'Fundamental'`, `'Médio'`, `'Superior'`, `'Pós-graduação'`, `'Prefiro não informar'`)
  - `market_knowledge`: `VARCHAR(50) NOT NULL` (Valores: `'Sim, conheço.'`, `'Conheço um pouco.'`, `'Não conheço.'`)
  - `market_interest`: `VARCHAR(50) NOT NULL` (Valores: `'Sim, tenho interesse.'`, `'Talvez — quero conhecer melhor.'`, `'Não tenho interesse.'`)
  - `completed_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `updated_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Índices:**
  - `CREATE INDEX idx_profiles_user_id ON profiles (user_id);`

### 5.3 Tabela `games`
Catálogo unificado de jogos disponíveis (curados e adicionados por usuários).
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `name`: `VARCHAR(100) NOT NULL` (Nome canônico original do jogo)
  - `is_curated`: `BOOLEAN NOT NULL DEFAULT false` (`true` para catálogo oficial, `false` para manual)
  - `created_by_user_id`: `UUID NULL REFERENCES users(id) ON DELETE SET NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Restrições de Unicidade & Índices:**
  - `CREATE UNIQUE INDEX idx_games_name_lower_unique ON games (LOWER(TRIM(name)));` (Garante unicidade case-insensitive absoluta)

### 5.4 Tabela `user_games`
Relação de muitos-para-muitos entre usuários e os jogos selecionados no questionário.
- **PK Composta:** `(user_id, game_id)`
- **Colunas:**
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `game_id`: `UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Índices:**
  - `CREATE INDEX idx_user_games_game_id ON user_games (game_id);`

### 5.5 Tabela `sessions`
Gerencia a sessão ativa do usuário e garante exatamente **uma sessão ativa por conta**.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `ip_address`: `VARCHAR(45) NULL` (IPv4 ou IPv6)
  - `user_agent`: `VARCHAR(255) NULL`
  - `expires_at`: `TIMESTAMP WITH TIME ZONE NOT NULL` (data fixa: `created_at + 30 dias`)
  - `last_activity_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `revoked_at`: `TIMESTAMP WITH TIME ZONE NULL` (preenchido no encerramento)
  - `revocation_reason`: `VARCHAR(50) NULL` (`'new_login'`, `'logout'`, `'password_reset'`, `'token_reuse'`, `'admin_action'`)
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Restrições de Integridade & Índices:**
  - `CREATE UNIQUE INDEX idx_sessions_single_active_per_user ON sessions (user_id) WHERE revoked_at IS NULL;` (**Garante a nível de banco que apenas UMA sessão pode estar ativa por usuário ao mesmo tempo**)
  - `CREATE INDEX idx_sessions_user_id ON sessions (user_id);`

### 5.6 Tabela `refresh_tokens`
Preserva a linhagem e o histórico de rotação de refresh tokens associados à sessão para viabilizar **detecção de reutilização de tokens consumidos**.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `session_id`: `UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`
  - `token_hash`: `VARCHAR(64) NOT NULL UNIQUE` (hash SHA-256 do token gerado)
  - `is_revoked`: `BOOLEAN NOT NULL DEFAULT false` (marcado como `true` após rotação ou revogação)
  - `consumed_at`: `TIMESTAMP WITH TIME ZONE NULL` (preenchido no momento da rotação)
  - `expires_at`: `TIMESTAMP WITH TIME ZONE NOT NULL` (limitado ao `sessions.expires_at`)
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Índices:**
  - `CREATE UNIQUE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);`
  - `CREATE INDEX idx_refresh_tokens_session_id ON refresh_tokens (session_id);`

### 5.7 Tabela `password_reset_tokens`
Tokens de uso único para recuperação de senha por e-mail.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `token_hash`: `VARCHAR(64) NOT NULL UNIQUE` (hash SHA-256 do token aleatório de 32 bytes)
  - `expires_at`: `TIMESTAMP WITH TIME ZONE NOT NULL` (`created_at + 30 minutos`)
  - `used_at`: `TIMESTAMP WITH TIME ZONE NULL`
  - `ip_address`: `VARCHAR(45) NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Índices:**
  - `CREATE INDEX idx_pwd_reset_user_active ON password_reset_tokens (user_id) WHERE used_at IS NULL;`

### 5.8 Tabela `email_verification_tokens`
Tokens para verificação de e-mail de usuários (obrigatório antes de conceder Staff ou Admin).
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `email`: `VARCHAR(255) NOT NULL`
  - `token_hash`: `VARCHAR(64) NOT NULL UNIQUE` (hash SHA-256)
  - `expires_at`: `TIMESTAMP WITH TIME ZONE NOT NULL` (`created_at + 24 horas`)
  - `verified_at`: `TIMESTAMP WITH TIME ZONE NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`

### 5.9 Tabela `user_roles`
Permissões atribuídas a uma conta, com prevenção rigorosa de papéis ativos duplicados.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `role`: `VARCHAR(30) NOT NULL` (Valores: `'participante'`, `'staff'`, `'admin'`)
  - `event_id`: `UUID NULL` (Obrigatório para `'staff'`, `NULL` para `'admin'` global e `'participante'`)
  - `granted_by`: `UUID NULL REFERENCES users(id)`
  - `granted_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `revoked_at`: `TIMESTAMP WITH TIME ZONE NULL`
  - `revoked_by`: `UUID NULL REFERENCES users(id)`
- **Restrições de Verificação (CHECK Constraints):**
  - `CONSTRAINT chk_user_roles_role CHECK (role IN ('participante', 'staff', 'admin'))`
  - `CONSTRAINT chk_user_roles_event CHECK ((role = 'staff' AND event_id IS NOT NULL) OR (role IN ('participante', 'admin') AND event_id IS NULL))`
- **Restrições de Unicidade & Índices:**
  - `CREATE UNIQUE INDEX idx_user_roles_unique_global ON user_roles (user_id, role) WHERE revoked_at IS NULL AND event_id IS NULL;` (Impede papel global duplicado ativo)
  - `CREATE UNIQUE INDEX idx_user_roles_unique_event ON user_roles (user_id, role, event_id) WHERE revoked_at IS NULL AND event_id IS NOT NULL;` (Impede atribuição duplicada do mesmo papel para o mesmo evento)
  - `CREATE INDEX idx_user_roles_active ON user_roles (user_id, role) WHERE revoked_at IS NULL;`

### 5.10 Tabela `role_audit_logs`
Trilha de auditoria imutável para concessões e revogações de privilégios.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `actor_id`: `UUID NULL REFERENCES users(id)` (Quem executou a ação; `NULL` estrito quando disparado pelo sistema/CLI de bootstrap)
  - `target_user_id`: `UUID NOT NULL REFERENCES users(id)` (Conta que recebeu ou perdeu o papel)
  - `action`: `VARCHAR(30) NOT NULL` (Valores: `'GRANT'`, `'REVOKE'`, `'CLI_BOOTSTRAP'`)
  - `role`: `VARCHAR(30) NOT NULL`
  - `event_id`: `UUID NULL`
  - `reason`: `TEXT NULL`
  - `ip_address`: `VARCHAR(45) NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`

### 5.11 Tabelas de Segundo Fator (`user_totp_credentials` e `user_backup_codes`)
Estrutura para 2FA obrigatório de administradores.
- **`user_totp_credentials`:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`
  - `secret_encrypted`: `TEXT NOT NULL` (Segredo base32 cifrado com AES-256-GCM)
  - `is_verified`: `BOOLEAN NOT NULL DEFAULT false` (marcado como `true` apenas após primeira validação)
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `updated_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **`user_backup_codes`:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `code_hash`: `VARCHAR(64) NOT NULL UNIQUE` (hash SHA-256 do código alfanumérico)
  - `used_at`: `TIMESTAMP WITH TIME ZONE NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`

### 5.12 Contratos Conceituais Futuros: Tabelas de Eventos, Participações e Snapshots

Em estrita conformidade com o escopo delimitado da Task 6.1, as tabelas abaixo **não serão criadas nas migrações SQL iniciais** (pertencem às fases subsequentes de Eventos e Filas). No entanto, seus contratos conceituais e restrições relacionais ficam formalizados para garantir compatibilidade estrutural imediata:

1. **Tabela `participations` (Conceitual Futura):**
   - **PK:** `id` (`UUID PRIMARY KEY DEFAULT gen_random_uuid()`)
   - **Colunas:**
     - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
     - `event_id`: `UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT`
     - `status`: `VARCHAR(30) NOT NULL` (`'registered'`, `'in_queue'`, `'attending'`, `'completed'`, `'cancelled'`)
     - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
   - **Restrições:** `UNIQUE (user_id, event_id)` (impede que um mesmo usuário crie registros concorrentes de participação no mesmo evento).

2. **Tabela `participation_questionnaire_snapshots` (Conceitual Futura):**
   - **PK:** `id` (`UUID PRIMARY KEY DEFAULT gen_random_uuid()`)
   - **Colunas:**
     - `participation_id`: `UUID NOT NULL UNIQUE REFERENCES participations(id) ON DELETE RESTRICT`
     - `birth_date`: `DATE NOT NULL` (sem conversão de timezone)
     - `age_at_event`: `INTEGER NOT NULL` (idade calculada no dia do evento)
     - `gender`: `VARCHAR(30) NOT NULL`
     - `education`: `VARCHAR(30) NOT NULL`
     - `market_knowledge`: `VARCHAR(50) NOT NULL`
     - `market_interest`: `VARCHAR(50) NOT NULL`
     - `games_snapshot`: `JSONB NOT NULL` (array imutável com os nomes canônicos dos jogos no instante da entrada)
     - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
   - **Garantia de Imutabilidade Estrita no PostgreSQL:**
     Para assegurar que dados analíticos de auditoria histórica e relatórios de BI jamais sejam alterados por edição posterior no perfil corrente do usuário, a tabela contará com gatilho de rejeição de mutações:
     ```sql
     CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
     RETURNS TRIGGER AS $$
     BEGIN
       RAISE EXCEPTION 'Snapshots de participação são estritamente imutáveis para integridade histórica.';
     END;
     $$ LANGUAGE plpgsql;

     CREATE TRIGGER trg_snapshots_immutable
     BEFORE UPDATE OR DELETE ON participation_questionnaire_snapshots
     FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();
     ```


---

## 6. Fluxos de Autenticação, Sessões e Autorização

### 6.1 Algoritmo e Parâmetros de Hash de Senha
- **Algoritmo Selecionado:** **Argon2id** (`@node-rs/argon2`), versão com bindings em Rust de alta performance.
- **Parâmetros Técnicos:**
  - `memoryCost`: `65536` (64 MiB de memória por hash)
  - `timeCost`: `3` iterações
  - `parallelism`: `4` threads
  - `outputLen`: `32` bytes
- **Fallback / Alternativa Documentada:** Caso o servidor possua restrições severas de memória em VPS de baixíssimo recurso (< 512 MB de RAM compartilhada), utilizar-se-á **bcrypt** com fator de custo `12`.
- **Proteção contra Senhas Comuns e Comprometidas:**
  - O backend executará checagem síncrona contra uma lista compilada em memória com as 100.000 senhas mais comuns (base SecLists / OWASP). Caso conste na lista, a requisição é rejeitada com código `422 Unprocessable Entity` e detalhamento RFC 7807.

### 6.2 Estratégia de Access Token e Refresh Token
1. **Access Token:**
   - Formato: JWT (JSON Web Token) assinado com segredo `JWT_ACCESS_SECRET` via algoritmo `HS256`.
   - Validade: **Exatamente 15 minutos**.
   - Payload:
     ```json
     {
       "sub": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
       "sid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
       "email": "jogador@exemplo.com",
       "roles": ["participante"],
       "iat": 1792080000,
       "exp": 1792080900
     }
     ```
2. **Refresh Token:**
   - Formato: String opaca gerada por gerador criptográfico pseudo-aleatório (`crypto.randomBytes(48).toString('base64url')`).
   - Persistência: Apenas o hash `SHA-256` do token é gravado na tabela `refresh_tokens.token_hash`. O token em texto claro nunca reside no banco de dados.
3. **Limite Absoluto da Sessão:**
   - A coluna `sessions.expires_at` é definida na criação da sessão como `NOW() + INTERVAL '30 days'`.
   - **Regra Aprovada:** Rotações periódicas do refresh token atualizam `sessions.last_activity_at`, mas **jamais estendem `sessions.expires_at`**. Ao atingir 30 dias corridos, a sessão expira compulsoriamente e um novo login com credenciais completas é exigido.

### 6.3 Garantia de Uma Sessão Ativa por Conta e Revogação Imediata

A regra fundamental de segurança do ArenaGo estabelece: **"Exatamente uma sessão ativa por conta. Um novo login revoga imediatamente a sessão anterior, inclusive access tokens ainda dentro da validade de 15 minutos."**

Para garantir esse comportamento sob concorrência e evitar corridas de login simultâneo em múltiplos aparelhos, a operação de autenticação adota **controle transacional com bloqueio explícito no PostgreSQL e restrição de integridade a nível de banco de dados**:

```sql
-- Executado atomicamente dentro de uma transação de login:
BEGIN;

-- 1. Serializa requisições concorrentes de login para o mesmo usuário
SELECT id FROM users WHERE id = :userId FOR UPDATE;

-- 2. Revoga compulsoriamente qualquer sessão ativa anterior
UPDATE sessions
SET revoked_at = NOW(), revocation_reason = 'new_login'
WHERE user_id = :userId AND revoked_at IS NULL;

-- 3. Cria a nova sessão (garantida como única pelo índice condicional)
INSERT INTO sessions (user_id, ip_address, user_agent, expires_at)
VALUES (:userId, :ip, :userAgent, NOW() + INTERVAL '30 days')
RETURNING id;

-- 4. Cria o refresh token inicial vinculado a esta sessão
INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
VALUES (:sessionId, :initialTokenHash, NOW() + INTERVAL '30 days');

COMMIT;
```

**Restrição de Integridade Inviolável:**
O PostgreSQL impõe fisicamente a unicidade através do índice:
```sql
CREATE UNIQUE INDEX idx_sessions_single_active_per_user ON sessions (user_id) WHERE revoked_at IS NULL;
```
Se duas requisições paralelas tentarem criar simultaneamente uma sessão sem revogar a anterior, o motor do banco rejeitará imediatamente com `unique_violation`.

```mermaid
sequenceDiagram
    autonumber
    actor UserB as Participante (Aparelho B)
    participant API as Backend (NestJS)
    participant DB as PostgreSQL (Neon)
    actor UserA as Aparelho A (Sessão Antiga)

    UserB->>API: POST /auth/login { email, password }
    API->>DB: Inicia Transação ACID
    API->>DB: SELECT id FROM users WHERE id = :userId FOR UPDATE
    API->>API: Valida senha via Argon2id
    API->>DB: UPDATE sessions SET revoked_at = NOW(), revocation_reason = 'new_login' WHERE user_id = :userId AND revoked_at IS NULL
    API->>DB: INSERT INTO sessions (...) RETURNING id (:newSid)
    API->>DB: INSERT INTO refresh_tokens (session_id = :newSid, ...)
    API->>DB: COMMIT
    API-->>UserB: 200 OK { accessToken (15m, sid=B), refreshToken, user }

    rect rgb(255, 235, 235)
    Note over UserA,API: Tentativa de uso pelo Aparelho A
    UserA->>API: GET /profile (Bearer AccessToken com sid=A)
    API->>API: Valida assinatura JWT e expiração (<15m) -> OK
    API->>DB: SELECT revoked_at, expires_at FROM sessions WHERE id = :sidA
    DB-->>API: Retorna revoked_at = 2026-10-16T... (não nulo)
    API-->>UserA: 401 Unauthorized (RFC 7807: "Sessão encerrada por login em outro dispositivo")
    end
```

**Validação Efetiva nos Endpoints Protegidos (`JwtAuthGuard`):**
1. O guard valida a assinatura criptográfica e a data de expiração do JWT.
2. Extrai o `sid` (Session ID) do payload.
3. Executa consulta indexada no banco: `SELECT revoked_at, expires_at FROM sessions WHERE id = :sid`.
4. Se a linha não existir, ou `revoked_at IS NOT NULL`, ou `expires_at < NOW()`, a requisição é sumariamente rejeitada com `401 Unauthorized`.
5. **Desempenho:** Por ser uma consulta direta por chave primária UUID (`id`), o tempo de resposta no PostgreSQL indexado é inferior a **1 milissegundo**, dispensando a sobrecarga operacional de gerenciar um cluster Redis dedicado no escopo inicial.

### 6.4 Rotação de Refresh Token e Detecção de Reuso

Para proteger contra roubo ou vazamento de credenciais móveis, o sistema adota **rotação estrita de refresh tokens com preservação da linhagem histórica na tabela `refresh_tokens`**:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente Móvel
    participant API as API (NestJS)
    participant DB as PostgreSQL

    Client->>API: POST /auth/refresh { refreshToken: "token_atual" }
    API->>API: Calcula token_hash = sha256(token_atual)
    API->>DB: Inicia Transação
    API->>DB: SELECT * FROM refresh_tokens WHERE token_hash = :hash FOR UPDATE

    alt Token NÃO encontrado ou Sessão expirada
        API->>DB: ROLLBACK
        API-->>Client: 401 Unauthorized ("Credencial de renovação inválida")
    else Token com consumed_at IS NOT NULL ou is_revoked = true (REUSO DETECTADO)
        rect rgb(255, 220, 220)
        Note over API,DB: Incidente de Segurança: Tentativa de reutilizar token antigo
        API->>DB: UPDATE sessions SET revoked_at = NOW(), revocation_reason = 'token_reuse' WHERE id = :sessionId
        API->>DB: UPDATE refresh_tokens SET is_revoked = true WHERE session_id = :sessionId
        API->>DB: COMMIT
        API-->>Client: 401 Unauthorized ("Sessão revogada por violação de segurança")
        end
    else Token Válido e Ativo (consumed_at IS NULL e is_revoked = false)
        API->>DB: SELECT revoked_at, expires_at FROM sessions WHERE id = :sessionId FOR UPDATE
        API->>DB: UPDATE refresh_tokens SET consumed_at = NOW(), is_revoked = true WHERE id = :tokenId
        API->>API: Gera novo refreshToken criptográfico e calcula novo_hash
        API->>DB: INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES (:sessionId, :novo_hash, :sessionExpiresAt)
        API->>DB: UPDATE sessions SET last_activity_at = NOW() WHERE id = :sessionId
        API->>DB: COMMIT
        API->>API: Emite novo accessToken (15m com sid da sessão)
        API-->>Client: 200 OK { accessToken, refreshToken: "novo_token", expiresIn: 900 }
    end
```

**Tratamento de Concorrência e Corridas de Rede (Network Races):**
- **Bloqueio Transacional:** A consulta com `FOR UPDATE` serializa qualquer requisição concorrente no nível da linha do token no banco.
- **Tolerância a Corridas de Rede Legítimas:** Em redes móveis instáveis, o aplicativo pode disparar duas requisições paralelas quase simultâneas com o mesmo refresh token ao receber múltiplos códigos 401 de endpoints distintos. Para evitar falsos positivos de ataque:
  1. O cliente HTTP (Axios) implementará um **mecanismo de fila / mutex local**: ao detectar um 401, enfileira chamadas pendentes e realiza apenas uma chamada a `POST /auth/refresh`.
  2. No servidor, define-se uma janela técnica estrita de carência de **5 segundos**: se uma requisição chegar com um token cujo `consumed_at` ocorreu há menos de 5 segundos a partir do mesmo IP e User-Agent, a requisição não revoga a sessão; em vez disso, retorna com segurança o par de tokens recém-gerado pela primeira requisição da corrida. Passados os 5 segundos, qualquer envio de token consumido caracteriza tentativa de reutilização de credencial vazada e dispara a revogação compulsória da sessão (`revocation_reason = 'token_reuse'`).

### 6.5 Armazenamento Seguro no Aplicativo Móvel
- **Dispositivos Físicos (iOS e Android):**
  - O `refreshToken` deve ser gravado exclusivamente via `expo-secure-store` (Apple Keychain no iOS; EncryptedSharedPreferences com Android Keystore no Android).
  - O `accessToken` é armazenado em memória (`AuthContext`), minimizando acessos a disco e descartando-se imediatamente caso a aplicação seja fechada.
- **Interceção de Rede (Axios Interceptor):**
  - Ao receber status `401 Unauthorized`, o cliente aciona o interceptor com trava de concorrência. Se a renovação for autorizada, reenvia a chamada original; se rejeitada, limpa o SecureStore e navega o usuário à tela de Login.

---

## 7. Fluxos de Recuperação de Senha e Verificação de E-mail

### 7.1 Recuperação de Senha Atômica

Para assegurar que falhas parciais ou requisições concorrentes não deixem a conta em estado inconsistente, o processo de redefinição de senha é executado sob uma **transação ACID atômica com bloqueio no PostgreSQL**:

```sql
BEGIN;

-- 1. Bloqueia o registro do token de recuperação para evitar uso simultâneo
SELECT id, user_id, expires_at, used_at
FROM password_reset_tokens
WHERE token_hash = :hash
FOR UPDATE;

-- Se o token não existir, ou used_at IS NOT NULL, ou expires_at < NOW() -> ROLLBACK e erro 400.

-- 2. Bloqueia a conta do usuário
SELECT id FROM users WHERE id = :userId FOR UPDATE;

-- 3. Consome o token utilizado
UPDATE password_reset_tokens
SET used_at = NOW()
WHERE id = :tokenId;

-- 4. Invalida imediatamente todos os outros tokens de recuperação pendentes do usuário
UPDATE password_reset_tokens
SET used_at = NOW()
WHERE user_id = :userId AND used_at IS NULL;

-- 5. Atualiza o hash de senha com o novo hash Argon2id
UPDATE users
SET password_hash = :newArgon2Hash, updated_at = NOW()
WHERE id = :userId;

-- 6. Revoga compulsoriamente TODAS as sessões ativas do usuário
UPDATE sessions
SET revoked_at = NOW(), revocation_reason = 'password_reset'
WHERE user_id = :userId AND revoked_at IS NULL;

-- 7. Revoga todos os refresh tokens das sessões revogadas
UPDATE refresh_tokens
SET is_revoked = true
WHERE session_id IN (SELECT id FROM sessions WHERE user_id = :userId);

COMMIT;
```

**Rate Limiting de Recuperação de Senha no Ambiente de Implantação:**
- **Controle Duplo (Por Conta e Por Rede):**
  1. **Por Conta (E-mail Normalizado):** Chave `forgot_pwd:email:${LOWER(TRIM(email))}`.
     - Limite de frequência: **1 solicitação a cada 2 minutos** (TTL: 120s, limit: 1).
     - Teto horário de segurança: **máximo de 5 solicitações por hora** (TTL: 3600s, limit: 5).
     - Como a chave utiliza o e-mail rigorosamente normalizado antes de qualquer consulta, tentativas de contorno variando maiúsculas ou espaços em branco colidem exatamente no mesmo bucket de restrição.
  2. **Por Rede (Endereço IP):** Chave `forgot_pwd:ip:${req.ip}`.
     - Teto de contenção configurado (até 10 requisições a cada 10 minutos) para bloquear ferramentas automatizadas de varredura ou abuso sem penalizar múltiplos participantes legítimos operando sob o mesmo IP compartilhado (redes corporativas, universidades ou Wi-Fi de eventos com CGNAT).
- **Execução Eficiente no Monólito sem Redis:**
  - O controle é executado pelo `@nestjs/throttler` através do storage em memória de alta performance embutido no processo Node.js.
  - Para o modelo de implantação em monólito modular adotado pelo projeto, a solução em memória garante precisão e resposta instantânea sem custos operacionais adicionais ou dependência de serviços externos como Redis. Caso o sistema venha a demandar escalabilidade horizontal multi-instância em fases posteriores, o adapter do Throttler permite migração transparente para um store persistente compartilhado.


### 7.2 Fluxo de Verificação de E-mail
- **Regra para Participantes:** Contas com perfil comum de participante não exigem verificação prévia de e-mail para utilizar o aplicativo, logar ou preencher o questionário.
- **Regra para Privilegiados:** Nenhuma conta pode ser promovida a **Staff** ou **Admin** sem que `email_verified_at` esteja devidamente preenchido.
- **Solicitação:** Chamada autenticada a `POST /auth/verify-email/request`. O backend gera um token aleatório válido por 24 horas e despacha e-mail com link de confirmação.
- **Confirmação:** Chamada a `POST /auth/verify-email/confirm` com o token recebido. O backend atualiza `users.email_verified_at = NOW()`.

### 7.3 Provedor de E-mail e Custo Zero
- **Serviço Proposto:** **Resend** (`https://resend.com`). Cota gratuita de 3.000 e-mails/mês e até 100/dia.
- **Fallback em Desenvolvimento:** Exibição do link e do token diretamente nos logs do console da API quando `NODE_ENV === 'development'`.

---

## 8. Modelo de Papéis, Permissões e Autenticação Administrativa (2FA)

### 8.1 Especificação dos Três Perfis (RBAC) e Permissões Cumulativas

1. **Participante (`participante`):**
   - Papel base atribuído automaticamente a qualquer cadastro público.
   - Permissões: autenticar-se, gerenciar próprio perfil e questionário, consultar catálogo de jogos.
2. **Staff (`staff`):**
   - Permissão vinculada **estritamente a eventos específicos** (`event_id` obrigatório).
   - Pré-requisito: e-mail confirmado (`email_verified_at IS NOT NULL`).
   - Permissões: operar filas e chamadas nas experiências daquele evento.
3. **Admin (`admin`):**
   - Permissão **global** (`event_id IS NULL`).
   - Pré-requisitos: e-mail confirmado e segundo fator (TOTP) configurado.
   - Permissões: criar/gerenciar eventos, conceder/revogar papéis de Staff e Admin, visualizar BI agregado e acionar encerramentos administrativos.

**Compatibilidade Cumulativa:** Uma conta pode acumular múltiplos registros ativos em `user_roles` (ex.: ser `participante` geral e `staff` no Evento A). As constraints parciais `idx_user_roles_unique_global` e `idx_user_roles_unique_event` impedem duplicidades ativas.

**Elegibilidade de Admin em Eventos (Decisão da Equipe):**
A definição sobre contas com papel Admin poderem ou não participar como competidores/jogadores em eventos foi formalmente postergada para o planejamento do backend de eventos e participações. Nesta fase:
- A arquitetura mantém suporte a permissões cumulativas.
- Não se estabelece autorização nem proibição definitiva de participação em eventos para contas Admin.
- Não se implementa alternância entre interfaces de Admin e Participante.
- Não se alteram regras de entrada ou participação em eventos.
- **O segundo fator (TOTP) permanece estritamente obrigatório para acesso a operações administrativas.**

### 8.2 Concessão, Revogação e Validação Dinâmica no Servidor
- **Localização de Contas:** Administradores realizam concessões exclusivamente buscando o e-mail de contas previamente existentes.
- **Validação Efetiva no Servidor (`RolesGuard`):** O backend **não confia exclusivamente nas claims de papéis contidas no JWT**. Em rotas protegidas por `@Roles('staff')` ou `@Roles('admin')`, o guard consulta em tempo real a tabela `user_roles` no banco de dados para checar se o papel permanece ativo (`revoked_at IS NULL`). Uma revogação de privilégio tem efeito **imediato na requisição seguinte**, mesmo que o access token ainda não tenha expirado.
- **Auditoria Imutável:** Todas as alterações geram inserção na tabela `role_audit_logs`.

### 8.3 Procedimento Restrito de Bootstrap do Primeiro Admin
Para garantir que não haja brechas de auto-promoção e manter a fidelidade da trilha de auditoria:
1. O desenvolvedor cadastra uma conta comum no app ou API e realiza a verificação de seu e-mail.
2. Acessa o terminal seguro do servidor e executa o comando CLI:
   ```bash
   npm run cli:promote-admin -- --email admin@arenago.com.br --reason "Bootstrap inicial do sistema"
   ```
3. O script valida a existência da conta e a verificação do e-mail.
4. Insere o papel `admin` em `user_roles` e registra a auditoria em `role_audit_logs` com:
   - `actor_id`: **`NULL`** (identificando categoricamente a ação como oriunda do sistema/console, **sem imputar falsamente ao usuário a autoria da própria concessão**).
   - `action`: `'CLI_BOOTSTRAP'`.
   - `reason`: Justificativa informada no comando CLI.
5. **Regra de Continuidade Operacional:** Antes de eventos reais com público, **ao menos dois administradores distintos** deverão estar ativos, com e-mail verificado e 2FA configurado.

### 8.4 Autenticação Administrativa de Dois Fatores (2FA via TOTP)

O acesso administrativo exige segundo fator baseado na RFC 6238 (tempo t ± 1 step de 30s, algoritmo SHA-1, código de 6 dígitos):

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrador
    participant API as API (NestJS)
    participant DB as PostgreSQL

    Admin->>API: POST /auth/login { email, password }
    API->>API: Valida credenciais Argon2id -> OK
    API->>DB: Consulta papéis do usuário
    alt Usuário possui papel 'admin' ativo
        API->>DB: Verifica se user_totp_credentials está configurado (is_verified = true)
        API->>API: Gera tempToken de curta duração (5 min, escopo '2fa_pending')
        API-->>Admin: 200 OK { requires2FA: true, tempToken, isTotpConfigured }
    end

    alt Admin precisa configurar TOTP pela 1ª vez (isTotpConfigured = false)
        Admin->>API: POST /auth/2fa/setup (Bearer tempToken)
        API->>API: Gera segredo base32, QR Code e 10 Backup Codes
        API->>DB: Salva segredo cifrado AES-256-GCM (is_verified = false) e hashes dos backup codes
        API-->>Admin: 200 OK { qrCodeUrl, secret, backupCodes }
        Admin->>API: POST /auth/2fa/verify (Bearer tempToken, { code: "123456" })
        API->>API: Valida código TOTP
        API->>DB: UPDATE user_totp_credentials SET is_verified = true WHERE user_id = :userId
    else Admin já possui TOTP configurado (isTotpConfigured = true)
        Admin->>API: POST /auth/2fa/verify (Bearer tempToken, { code: "123456" ou "XXXX-XXXX" })
    end

    API->>API: Valida código TOTP de 6 dígitos ou consome Backup Code
    API->>DB: Executa transação de criação de sessão autorizada (sessão única)
    API->>API: Emite tokens finais (claims: 'roles: ["admin"]', 'admin_2fa_verified: true', sid)
    API-->>Admin: 200 OK { accessToken (15m), refreshToken (30d), user }
```

**Detalhamento Técnico das Etapas do Fluxo Administrativo:**

1. **Emissão e Validação do Desafio Temporário (`tempToken`):**
   - Ao validar as credenciais em `POST /auth/login` para uma conta com papel `admin`, o servidor **não emite o token de acesso administrativo final**.
   - O backend emite um token provisório assinado via JWT (`tempToken`), com TTL restrito a **5 minutos** e payload com escopo delimitado:
     ```json
     {
       "sub": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
       "scope": "2fa_pending",
       "purpose": "admin_challenge",
       "isTotpConfigured": true,
       "iat": 1792080000,
       "exp": 1792080300
     }
     ```
   - O interceptor e o guard especializado `TotpChallengeGuard` asseguram que esse token temporário só seja aceito nas rotas de desafio (`/auth/2fa/setup` e `/auth/2fa/verify`), sendo rejeitado com `403 Forbidden` em qualquer endpoint funcional da API.

2. **Configuração Inicial do TOTP e Códigos de Recuperação:**
   - Se o Admin ainda não tiver o segundo fator ativado (`isTotpConfigured = false`), ele chama `POST /auth/2fa/setup` (Bearer `tempToken`).
   - O backend gera segredo criptográfico base32, cifra-o com **AES-256-GCM** (usando a chave `TOTP_ENCRYPTION_KEY`) e gera a URL canônica `otpauth://totp/ArenaGo:admin@arenago.com.br?secret=...&issuer=ArenaGo`.
   - Gera **10 códigos de backup alfanuméricos** de 8 caracteres (`XXXX-XXXX`) de uso único, gravando apenas o hash SHA-256 na tabela `user_backup_codes`.
   - O registro em `user_totp_credentials` permanece com `is_verified = false`. O Admin deve confirmar o primeiro código gerado no app chamando `POST /auth/2fa/verify`. Somente após a validação matemática bem-sucedida do primeiro código de 6 dígitos, o segredo é marcado como ativo (`is_verified = true`).

3. **Verificação do Segundo Fator e Emissão da Sessão Autorizada:**
   - Em `POST /auth/2fa/verify`, o Admin envia o código de 6 dígitos do app autenticador ou um dos códigos de backup.
   - O backend valida a janela de tempo RFC 6238 (tolerância de ±1 passo de 30s) ou verifica a colisão do hash SHA-256 em `user_backup_codes` (marcando `used_at = NOW()` para descarte imediato).
   - Validação concluída: o backend executa a transação atômica de criação de sessão única (`sessions` e `refresh_tokens`) e emite o Access Token administrativo final contendo as claims de privilégio:
     ```json
     {
       "sub": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
       "sid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
       "email": "admin@arenago.com.br",
       "roles": ["admin", "participante"],
       "admin_2fa_verified": true,
       "iat": 1792080000,
       "exp": 1792080900
     }
     ```

4. **Renovação e Revogação da Sessão Administrativa:**
   - **Renovação Segura (`POST /auth/refresh`):** Ao receber requisição de renovação para uma sessão administrativa, o serviço de sessão não confia cegamente nas claims do token anterior: consulta em tempo real a tabela `user_roles` para garantir que o papel `admin` permanece ativo (`revoked_at IS NULL`) e valida se `user_totp_credentials.is_verified = true`. Caso o papel de Admin tenha sido revogado por outro administrador durante o período da sessão, o novo Access Token emitido não recebe a claim `roles: ["admin"]` nem `admin_2fa_verified: true`, rebaixando o acesso imediatamente.
   - **Revogação da Sessão:** O encerramento voluntário (`POST /auth/logout`) ou administrativo preenche `sessions.revoked_at = NOW()` e invalida os refresh tokens vinculados. Em virtude da checagem em tempo real de `sid` executada pelo `JwtAuthGuard`, a sessão perde a validade no exato milissegundo da revogação.

5. **Recuperação de TOTP Perdido (Autorização Exclusiva por Outro Admin):**
   - Caso um administrador extravie o dispositivo autenticador e não disponha de códigos de backup, a recuperação técnica depende mandatoriamente de autorização expressa de **outro Administrador com 2FA ativo**.
   - O administrador executor chama `POST /admin/users/:id/reset-totp` enviando justificativa circunstanciada obrigatória.
   - A operação executa em transação ACID:
     1. Deleta/invalida o segredo em `user_totp_credentials` da conta-alvo (`is_verified = false`).
     2. Deleta todos os códigos de backup remanescentes em `user_backup_codes`.
     3. Revoga compulsoriamente todas as sessões ativas da conta-alvo (`revocation_reason = 'admin_totp_reset'`).
     4. Registra evento detalhado na tabela `role_audit_logs` contendo o `actor_id` do administrador que aprovou a redefinição, o `target_user_id` e o texto da justificativa.
   - No próximo login com senha, o sistema detecta que a conta necessita de novo onboarding de 2FA e emite o desafio para `POST /auth/2fa/setup`.

6. **Bootstrap do Primeiro Admin e Auditoria Fidedigna:**
   - O primeiro administrador da infraestrutura é provisionado via comando seguro no console do servidor (`npm run cli:promote-admin`).
   - A auditoria gerada em `role_audit_logs` registra estritamente `actor_id = NULL` e `action = 'CLI_BOOTSTRAP'`. Isso documenta formalmente a origem de infraestrutura da operação, sem imputar falsamente à conta promovida a responsabilidade de ter concedido privilégios a si mesma.


---

## 9. Estratégia de Persistência do Questionário, Jogos e Snapshots

### 9.1 Questionário do Usuário Autenticado e Estado Pendente
- O questionário pertence à conta autenticada (`profiles.user_id = users.id`).
- **Cadastro Imediato:** O usuário pode se cadastrar e efetuar login normalmente mesmo que decida não preencher o questionário de imediato.
- **Consulta do Questionário Pendente (`GET /profile/questionnaire`):**
  - Caso o usuário ainda não tenha preenchido o questionário (não há registro na tabela `profiles`), a API responde com status **`200 OK`** e payload estruturado indicando explicitamente `hasCompleted: false`:
    ```json
    {
      "hasCompleted": false,
      "aboutYou": null,
      "yourGames": [],
      "gamesMarket": null,
      "completedAt": null
    }
    ```
  - Em nenhuma hipótese a ausência do questionário deve ser tratada como erro `404 Not Found` ou inexistência da conta.
- **Envio Completo:** O questionário é enviado em uma única operação atômica através de `PUT /profile/questionnaire`, salvando simultaneamente as 3 etapas.

### 9.2 Catálogo de Jogos e Inclusão Manual Sem Duplicidades
O catálogo inicial contém os 20 jogos curados (`is_curated = true`). Quando um participante envia jogos personalizados na Etapa 2, o backend precisa garantir que grafias variadas não criem registros duplicados e que **o nome canônico existente jamais seja sobrescrito**.

Para assegurar consistência sob inserções concorrentes, utiliza-se a seguinte **Common Table Expression (CTE) atômica e idempotente no PostgreSQL**:

```sql
-- Inserção segura que retorna o ID sem jamais modificar o nome original já cadastrado
WITH inserted_game AS (
  INSERT INTO games (name, is_curated, created_by_user_id)
  VALUES (:trimmedName, false, :userId)
  ON CONFLICT (LOWER(TRIM(name))) DO NOTHING
  RETURNING id
)
SELECT id FROM inserted_game
UNION ALL
SELECT id FROM games WHERE LOWER(TRIM(name)) = LOWER(TRIM(:trimmedName))
LIMIT 1;
```

**Garantia de Não-Duplicação e Preservação Canônica sob Concorrência:**
Mesmo que duas ou mais requisições concorrentes tentem registrar simultaneamente o mesmo jogo com variações de caixa ou espaçamento (ex.: `"Valorant"`, `"valorant"` e `"  VALORANT  "`):
1. O PostgreSQL avalia o índice único funcional `idx_games_name_lower_unique ON games (LOWER(TRIM(name)))`.
2. Apenas uma das transações realiza a inserção física da linha. A transação concorrente colide no índice e aciona a cláusula `ON CONFLICT DO NOTHING`, descartando a inserção sem emitir erro de violação e sem alterar nenhuma coluna existente.
3. A segunda instrução da CTE (`UNION ALL SELECT id FROM games WHERE LOWER(TRIM(name)) = LOWER(TRIM(:trimmedName)) LIMIT 1`) recupera com exatidão o `id` canônico da linha.
4. **Preservação Canônica Absoluta:** O nome original registrado inicialmente é mantido intacto. Nenhuma cláusula `UPDATE SET name = ...` é executada, eliminando categoricamente o risco de sobrescrita de grafias estabelecidas.
5. Em seguida, a vinculação em `user_games` aplica `ON CONFLICT (user_id, game_id) DO NOTHING`, garantindo que um participante jamais possua vínculos duplicados com o mesmo jogo.


### 9.3 Snapshots Imutáveis de Participação e Privacidade (LGPD)

Conforme diretriz aprovada (D10): *"Registrar o snapshot das respostas do questionário em cada nova participação: eventos antigos permanecem com respostas da época, novas participações usam respostas atualizadas."*

```sql
CREATE TABLE participation_questionnaire_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participation_id UUID NOT NULL UNIQUE,
    birth_date DATE NOT NULL,
    age_at_event INTEGER NOT NULL,
    gender VARCHAR(30) NOT NULL,
    education VARCHAR(30) NOT NULL,
    market_knowledge VARCHAR(50) NOT NULL,
    market_interest VARCHAR(50) NOT NULL,
    games_snapshot JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Imutabilidade:** O snapshot é inserido uma única vez no momento da confirmação de entrada no evento. Atualizações posteriores em `profiles` alteram apenas o perfil corrente do usuário, preservando intacto o histórico analítico de edições anteriores.

**Privacidade e LGPD — Delimitação Técnica Estrita:**
- É importante ressaltar que a simples desvinculação do `user_id` de uma participação **não garante, por si só, anonimização técnica efetiva**, especialmente diante da permanência de atributos demográficos específicos e granulares (como data civil exata de nascimento, gênero detalhado e lista de jogos selecionados), que podem permitir a reidentificação indireta do titular por correlação.
- Mantém-se o requisito aprovado de snapshots para fins de integridade histórica dos eventos.
- **Ponto Pendente Formal:** As políticas definitivas de anonimização efetiva (como agrupamento em faixas etárias amplas e k-anonimato), prazos de retenção e procedimentos para atendimento a solicitações de exclusão de contas permanecem formalmente registradas como **especificações pendentes de aprovação futura pela equipe**, evitando suposições prematuras de conformidade.

---

## 10. Contratos da API (Especificação REST)

Todas as respostas de erro da API seguem estritamente a especificação **RFC 7807 (`application/problem+json`)**:
```json
{
  "type": "https://arenago.com.br/problems/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "A senha informada deve possuir no mínimo 8 caracteres.",
  "instance": "/api/v1/auth/register",
  "invalidParams": [
    {
      "name": "password",
      "reason": "A senha informada deve possuir no mínimo 8 caracteres."
    }
  ]
}
```

### 10.1 `POST /auth/register`
Criação pública de nova conta de participante.
- **Autenticação:** Nenhuma (Público).
- **Request Body:**
  ```json
  {
    "name": "Kaled Silva",
    "email": "kaled@exemplo.com",
    "password": "SenhaSegura123"
  }
  ```
- **Validações:**
  - `name`: string obrigatória, 2 a 150 caracteres.
  - `email`: string obrigatória, formato válido de e-mail (normalizado com `LOWER(TRIM(email))`).
  - `password`: string obrigatória, mínimo 8 e máximo 128 caracteres. Rejeitada se constar na lista de senhas comprometidas.
- **Response `201 Created`:**
  ```json
  {
    "user": {
      "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
      "name": "Kaled Silva",
      "email": "kaled@exemplo.com",
      "emailVerified": false,
      "roles": ["participante"],
      "hasCompletedQuestionnaire": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "v1.MR1B_x9kL42...",
    "expiresIn": 900
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request`: Dados inválidos ou senha menor que 8 caracteres.
  - `409 Conflict`: E-mail já cadastrado.
  - `422 Unprocessable Entity`: Senha comum ou comprometida.

### 10.2 `POST /auth/login`
Autenticação por credenciais com revogação transacional da sessão anterior.
- **Autenticação:** Nenhuma (Público).
- **Request Body:**
  ```json
  {
    "email": "kaled@exemplo.com",
    "password": "SenhaSegura123"
  }
  ```
- **Response `200 OK` (Participante / Staff):**
  ```json
  {
    "user": {
      "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
      "name": "Kaled Silva",
      "email": "kaled@exemplo.com",
      "emailVerified": false,
      "roles": ["participante"],
      "hasCompletedQuestionnaire": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "v1.MR1B_x9kL42...",
    "expiresIn": 900
  }
  ```
- **Response `200 OK` (Quando usuário possui papel `admin` ativo):**
  ```json
  {
    "requires2FA": true,
    "isTotpConfigured": true,
    "tempToken": "eyJhbGciOiJIUzI1NiIsIn...temp_2fa_token",
    "message": "Informe o código de segundo fator para concluir o acesso."
  }
  ```
- **Erros RFC 7807:**
  - `401 Unauthorized`: E-mail ou senha incorretos (mensagem opaca).
  - `429 Too Many Requests`: Mais de 5 falhas consecutivas em 15 minutos por IP/e-mail.

### 10.3 `POST /auth/refresh`
Renovação do token de acesso com rotação estrita e detecção de reuso.
- **Autenticação:** Nenhuma (Utiliza o refresh token no corpo).
- **Request Body:**
  ```json
  {
    "refreshToken": "v1.MR1B_x9kL42..."
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...novo_token",
    "refreshToken": "v1.NOVO_REFRESH_TOKEN...",
    "expiresIn": 900
  }
  ```
- **Erros RFC 7807:**
  - `401 Unauthorized`: Token expirado, sessão revogada ou detecção de reuso.

### 10.4 `POST /auth/logout`
Encerramento voluntário da sessão ativa.
- **Autenticação:** Bearer Token obrigatório.
- **Response `200 OK`:**
  ```json
  {
    "message": "Sessão encerrada com sucesso."
  }
  ```

### 10.5 `GET /auth/me`
Consulta os dados da conta associada à sessão ativa.
- **Autenticação:** Bearer Token obrigatório.
- **Response `200 OK`:**
  ```json
  {
    "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
    "name": "Kaled Silva",
    "email": "kaled@exemplo.com",
    "emailVerified": true,
    "roles": ["participante", "staff"],
    "hasCompletedQuestionnaire": false
  }
  ```

### 10.6 `POST /auth/forgot-password`
Solicitação de recuperação de senha por e-mail com resposta opaca.
- **Autenticação:** Nenhuma (Público, Rate Limited).
- **Request Body:**
  ```json
  {
    "email": "kaled@exemplo.com"
  }
  ```
- **Response `200 OK` (Opaca):**
  ```json
  {
    "message": "Se o e-mail informado estiver cadastrado, as instruções para redefinição foram enviadas."
  }
  ```
- **Erros RFC 7807:**
  - `429 Too Many Requests`: Mais de 1 solicitação a cada 2 minutos ou mais de 5 por hora por conta.

### 10.7 `POST /auth/reset-password`
Efetivação atômica da troca de senha.
- **Autenticação:** Nenhuma.
- **Request Body:**
  ```json
  {
    "token": "4a7f9b8c2e1d0...",
    "newPassword": "NovaSenhaSegura456"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "Senha redefinida com sucesso. Todas as sessões anteriores foram encerradas."
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request`: Token inválido, expirado ou senha inválida.

### 10.8 `POST /auth/verify-email/request` e `POST /auth/verify-email/confirm`
- **Solicitação (`POST /auth/verify-email/request`):**
  - **Autenticação:** Bearer AccessToken obrigatório.
  - **Headers:** `Authorization: Bearer <accessToken>`
  - **Response `200 OK`:**
    ```json
    {
      "message": "E-mail de confirmação enviado com sucesso. Verifique sua caixa de entrada."
    }
    ```
  - **Erros RFC 7807:**
    - `400 Bad Request` (`title: "E-mail Já Verificado"`): Quando `users.email_verified_at IS NOT NULL`.
    - `401 Unauthorized`: Sessão inválida ou expirada.
    - `429 Too Many Requests`: Limite de 1 reenvio a cada 2 minutos.
- **Confirmação (`POST /auth/verify-email/confirm`):**
  - **Autenticação:** Nenhuma (Público).
  - **Request Body:**
    ```json
    {
      "token": "d7b9a4c8e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8"
    }
    ```
  - **Validações:** `token`: string obrigatória com hash válido de 64 caracteres hexadecimais (SHA-256 do token gerado).
  - **Response `200 OK`:**
    ```json
    {
      "message": "E-mail verificado com sucesso. Sua conta está apta a receber papéis administrativos ou de equipe."
    }
    ```
  - **Erros RFC 7807:**
    - `400 Bad Request` (`title: "Token Inválido ou Expirado"`): Quando o token não existe, já foi consumido (`verified_at IS NOT NULL`), ou expirou (`expires_at < NOW()`).

### 10.9 `GET /profile`
Consulta a identidade cadastral da conta autenticada, seus privilégios ativos e o estado do questionário.
- **Autenticação:** Bearer AccessToken obrigatório (`JwtAuthGuard` + verificação indexada de `sid`).
- **Headers:** `Authorization: Bearer <accessToken>`
- **Response `200 OK`:**
  ```json
  {
    "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
    "name": "Kaled Silva",
    "email": "kaled@exemplo.com",
    "emailVerified": true,
    "roles": ["participante"],
    "hasCompletedQuestionnaire": false,
    "createdAt": "2026-10-15T12:00:00.000Z",
    "updatedAt": "2026-10-15T12:00:00.000Z"
  }
  ```
- **Erros RFC 7807:**
  - `401 Unauthorized` (`title: "Sessão Inválida ou Revogada"`): Token expirado ou sessão encerrada por login em outro dispositivo.

### 10.10 `PATCH /profile`
Atualização cadastral dos dados básicos permitidos do usuário autenticado (como o nome de exibição).
- **Autenticação:** Bearer AccessToken obrigatório.
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "name": "Kaled Trabuksi Silva"
  }
  ```
- **Validações:**
  - `name`: string obrigatória, mínimo 2 e máximo 150 caracteres, trimmed.
  - A rota não permite alteração de e-mail (que requer fluxo transacional dedicado com re-verificação para segurança da conta).
- **Response `200 OK`:**
  ```json
  {
    "message": "Perfil atualizado com sucesso.",
    "user": {
      "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
      "name": "Kaled Trabuksi Silva",
      "email": "kaled@exemplo.com",
      "updatedAt": "2026-10-16T14:30:00.000Z"
    }
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request` (`title: "Dados Cadastrais Inválidos"`): Nome fora do intervalo de 2 a 150 caracteres (`invalidParams: [{ "name": "name", "reason": "O nome deve ter entre 2 e 150 caracteres." }]`).
  - `401 Unauthorized`: Sessão inválida ou expirada.

### 10.11 `GET /profile/questionnaire`
Consulta as respostas do questionário de 3 etapas da conta autenticada.
- **Autenticação:** Bearer AccessToken obrigatório.
- **Headers:** `Authorization: Bearer <accessToken>`
- **Response `200 OK` (Quando o questionário AINDA NÃO foi preenchido / Estado Pendente):**
  - **Regra Aprovada pela Equipe:** Retorna `200 OK` com `hasCompleted: false` e campos em `null`/vazio. **Em nenhuma circunstância retorna `404 Not Found`**, assegurando que a ausência de questionário não seja tratada como falha de rede ou inexistência da conta.
  ```json
  {
    "hasCompleted": false,
    "aboutYou": null,
    "yourGames": [],
    "gamesMarket": null,
    "completedAt": null
  }
  ```
- **Response `200 OK` (Quando o questionário JÁ foi preenchido / Concluído):**
  ```json
  {
    "hasCompleted": true,
    "aboutYou": {
      "birthDate": "2000-05-15",
      "gender": "Masculino",
      "otherGender": null,
      "education": "Superior"
    },
    "yourGames": [
      "Valorant",
      "Counter-Strike 2",
      "EA Sports FC 24"
    ],
    "gamesMarket": {
      "marketKnowledge": "Sim, conheço.",
      "marketInterest": "Sim, tenho interesse."
    },
    "completedAt": "2026-10-15T18:00:00.000Z"
  }
  ```
- **Erros RFC 7807:**
  - `401 Unauthorized` (`title: "Não Autorizado"`): Token ausente, inválido ou sessão revogada.

### 10.12 `PUT /profile/questionnaire`
Salva ou atualiza as respostas completas do questionário em lote (todas as 3 etapas em uma única operação transacional).
- **Autenticação:** Bearer AccessToken obrigatório.
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
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
- **Validações Estritas:**
  - `birthDate`: formato `YYYY-MM-DD`, calendário civil gregoriano real, data estritamente no passado. Armazenada como tipo SQL `DATE` sem conversão de fuso horário.
  - `gender`: uma das opções `['Feminino', 'Masculino', 'Outro', 'Prefiro não informar']`. Se `'Outro'`, `otherGender` é obrigatório (1 a 100 caracteres). Se diferente de `'Outro'`, `otherGender` deve ser nulo.
  - `education`: uma das opções `['Fundamental', 'Médio', 'Superior', 'Pós-graduação', 'Prefiro não informar']`.
  - `selectedGames`: array com ao menos 1 elemento (strings com 1 a 100 caracteres). Os jogos são inseridos ou vinculados via CTE atômica sem modificar nomes canônicos existentes.
  - `marketKnowledge`: uma das opções `['Sim, conheço.', 'Conheço um pouco.', 'Não conheço.']`.
  - `marketInterest`: uma das opções `['Sim, tenho interesse.', 'Talvez — quero conhecer melhor.', 'Não tenho interesse.']`.
- **Response `200 OK`:**
  ```json
  {
    "message": "Questionário salvo com sucesso.",
    "hasCompleted": true,
    "updatedAt": "2026-10-16T18:05:00.000Z"
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request` (`title: "Questionário com Dados Inválidos"`): Falha de validação em qualquer campo (`invalidParams`).
  - `401 Unauthorized`: Sessão inválida ou expirada.

### 10.13 `GET /games`
Consulta o catálogo de jogos disponíveis para autocompletar na Etapa 2, com suporte a busca textual case-insensitive e limite configurável.
- **Autenticação:** Pública ou Bearer AccessToken opcional.
- **Query Params:**
  - `query` (opcional): string para busca textual parcial no catálogo (mínimo 1 caractere).
  - `limit` (opcional): inteiro entre 1 e 50 (padrão: 20).
- **Response `200 OK`:**
  ```json
  {
    "games": [
      {
        "id": "3b29c10a-7f1e-4c91-9e23-28942b10a911",
        "name": "Valorant",
        "isCurated": true
      },
      {
        "id": "8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
        "name": "Counter-Strike 2",
        "isCurated": true
      }
    ],
    "total": 2
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request` (`title: "Parâmetros de Busca Inválidos"`): Quando `limit` for menor que 1 ou maior que 50.

### 10.14 Endpoints Administrativos e de Segundo Fator (2FA/TOTP)

#### 10.14.1 `POST /auth/2fa/setup`
Inicia o onboarding de 2FA gerando o segredo base32 cifrado, URL do QR Code e 10 Backup Codes de uso único.
- **Autenticação:** Bearer `tempToken` (emitido no login para contas com papel `admin` ainda não configuradas).
- **Headers:** `Authorization: Bearer <tempToken>`
- **Response `200 OK`:**
  ```json
  {
    "secret": "JBSWY3DPEHPK3PXP",
    "qrCodeUrl": "otpauth://totp/ArenaGo:admin@arenago.com.br?secret=JBSWY3DPEHPK3PXP&issuer=ArenaGo",
    "backupCodes": [
      "A1B2-C3D4",
      "E5F6-G7H8",
      "J9K0-L1M2",
      "N3P4-Q5R6",
      "S7T8-U9V0",
      "W1X2-Y3Z4",
      "B5C6-D7E8",
      "F9G0-H1J2",
      "K3L4-M5N6",
      "P7Q8-R9S0"
    ]
  }
  ```
- **Erros RFC 7807:**
  - `401 Unauthorized` / `403 Forbidden` (`title: "Desafio 2FA Inválido"`): Token provisório ausente, expirado (> 5 min) ou com escopo inválido.

#### 10.14.2 `POST /auth/2fa/verify`
Valida o código TOTP de 6 dígitos ou backup code contra o desafio temporário, ativando as credenciais e emitindo a sessão autorizada de Admin.
- **Autenticação:** Bearer `tempToken`.
- **Headers:** `Authorization: Bearer <tempToken>`
- **Request Body:**
  ```json
  {
    "code": "583921"
  }
  ```
- **Validações:** `code`: string com 6 dígitos numéricos (TOTP RFC 6238) ou 9 caracteres no formato `XXXX-XXXX` (Backup Code).
- **Response `200 OK`:**
  ```json
  {
    "user": {
      "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
      "name": "Administrador Geral",
      "email": "admin@arenago.com.br",
      "emailVerified": true,
      "roles": ["admin", "participante"]
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...admin_token",
    "refreshToken": "v1.MR1B_x9kL42...",
    "expiresIn": 900
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request` (`title: "Código 2FA Inválido ou Já Utilizado"`): Código incorreto, fora do drift permitido de ±30s ou backup code previamente consumido.
  - `403 Forbidden`: Desafio temporário expirado.

#### 10.14.3 `POST /admin/roles/grant`
Concede permissão de `staff` (vinculada obrigatoriamente a um `eventId`) ou `admin` (global) para uma conta existente.
- **Autenticação:** Bearer AccessToken com papel `admin` e `admin_2fa_verified: true`.
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "email": "operador@arenago.com.br",
    "role": "staff",
    "eventId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "reason": "Escalação técnica para controle de filas no evento"
  }
  ```
- **Validações:**
  - `email`: e-mail de conta previamente cadastrada e **com e-mail confirmado** (`email_verified_at IS NOT NULL`). Rejeição imediata se não verificado.
  - `role`: `'staff'` ou `'admin'`. Se `'staff'`, `eventId` é obrigatório; se `'admin'`, `eventId` deve ser nulo.
  - `reason`: justificativa textual obrigatória (10 a 500 caracteres).
- **Response `200 OK`:**
  ```json
  {
    "message": "Papel concedido com sucesso.",
    "roleAssignmentId": "7f8e9d0a-1b2c-3d4e-5f6a-7b8c9d0e1f2a"
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request` (`title: "Conta Não Elegível"`): E-mail da conta de destino ainda não foi confirmado, ou parâmetros incompatíveis.
  - `403 Forbidden` (`title: "Acesso Restrito"`): Requisitante sem privilégios de Admin ativo com 2FA.
  - `404 Not Found` (`title: "Conta Não Encontrada"`): Nenhuma conta localizada para o e-mail informado.
  - `409 Conflict` (`title: "Papel Já Atribuído"`): Papel já ativo para este usuário (global ou no mesmo evento).

#### 10.14.4 `POST /admin/roles/revoke`
Revoga papel ativo de um usuário com efeito imediato na requisição seguinte e gravação de auditoria imutável.
- **Autenticação:** Bearer AccessToken com papel `admin` e `admin_2fa_verified: true`.
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "roleAssignmentId": "7f8e9d0a-1b2c-3d4e-5f6a-7b8c9d0e1f2a",
    "reason": "Fim da escala de operação do evento"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "Papel revogado com sucesso. Efeitos aplicados imediatamente."
  }
  ```
- **Erros RFC 7807:**
  - `403 Forbidden`: Requisitante não autorizado.
  - `404 Not Found`: Vínculo de papel não encontrado ou já revogado.

#### 10.14.5 `POST /admin/users/:id/reset-totp`
Procedimento excepcional de recuperação de 2FA de uma conta Admin, autorizado exclusivamente por **outro Administrador com 2FA ativo**.
- **Autenticação:** Bearer AccessToken com papel `admin` e `admin_2fa_verified: true`. O executor **não pode ser o próprio alvo** (`req.user.id !== req.params.id`).
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "reason": "Extravio do aparelho autenticador validado presencialmente pela coordenação técnica."
  }
  ```
- **Validações:** `reason`: string obrigatória com no mínimo 15 caracteres circunstanciando a perda.
- **Response `200 OK`:**
  ```json
  {
    "message": "Credenciais 2FA redefinidas e sessões revogadas com sucesso. O administrador deverá reconfigurar o TOTP no próximo login."
  }
  ```
- **Erros RFC 7807:**
  - `400 Bad Request` (`title: "Operação Inválida"`): Tentativa de auto-redefinição (`actor_id === target_user_id`), alvo sem papel Admin, ou justificativa insuficiente.
  - `403 Forbidden`: Requisitante sem 2FA verificado.
  - `404 Not Found`: Usuário alvo não encontrado.


---

## 11. Requisitos de Segurança, Proteção de Dados e Testes

### 11.1 Requisitos de Segurança e Resiliência
1. **Proteção Contra Acesso a Dados de Outros Usuários (IDOR):**
   - Endpoints de perfil e questionário utilizam estritamente o `sub` extraído do JWT verificado no backend (`req.user.id`). Nenhuma rota aceita `userId` via parâmetro de URL sem checagem de privilégio administrativo.
2. **Rate Limiting em Múltiplas Camadas (`@nestjs/throttler`):**
   - Rota de Login: 5 tentativas a cada 15 minutos por e-mail e IP.
   - Recuperação de senha: 1 a cada 2 min e 5 por hora por conta, mais teto por IP em memória.
3. **Prevenção de Ataques de Timing:**
   - Comparação de hashes e tokens utilizando algoritmos de tempo constante (`crypto.timingSafeEqual`).
4. **Isolamento de Variáveis de Ambiente:**
   - Segredos JWT e chave de cifra do TOTP (`TOTP_ENCRYPTION_KEY`) validadas rigorosamente na inicialização via schema Zod.

### 11.2 Estratégia de Testes do Backend

A validação da implementação do backend será executada em três níveis:

```mermaid
graph TD
    subgraph TestPyramid ["Pirâmide de Testes do Backend ArenaGo"]
        E2E["Testes E2E / Contratos de API (Supertest)"]
        Integration["Testes de Integração com PostgreSQL Real (Neon / Container)"]
        Unit["Testes Unitários (Jest / Vitest)"]
    end

    Unit --> Integration
    Integration --> E2E
```

1. **Testes Unitários:**
   - Validações de data civil sem timezone, normalização de e-mails, parser de DTOs e esquemas Zod.
   - Algoritmo de hash Argon2id e verificação de blacklist de senhas.
   - Geração e verificação matemática de tokens TOTP RFC 6238 e rotação de chaves.
2. **Testes de Integração com PostgreSQL Real:**
   - **Regra:** Testes de concorrência e integridade relacional **não serão feitos com mocks**, mas sim contra uma instância real de PostgreSQL.
   - Validação de migrações Drizzle Kit aplicadas do zero.
   - Validação de constraints de unicidade (`users.email` e `games.name` case-insensitive).
   - **Teste de Sessão Única e Revogação Imediata:** Simulação de dois logins simultâneos e verificação de que o primeiro é rejeitado no instante seguinte pela constraint parcial `idx_sessions_single_active_per_user`.
   - **Teste de Detecção de Reuso de Refresh Token:** Envio proposital de token antigo rotacionado e verificação da revogação imediata da sessão (`token_reuse`).
3. **Testes Ponta a Ponta (E2E / API):**
   - Cadastro -> Login com questionário pendente (`hasCompleted: false`) -> Preenchimento do Questionário -> Consulta com `hasCompleted: true` -> Logout.
   - Solicitação de redefinição de senha -> Troca de senha atômica -> Tentativa de uso de tokens antigos -> Confirmação de revogação de todas as sessões.

---

## 12. Infraestrutura, Dependências e Execução

### 12.1 Dependências Principais e Versões Recomendadas

```json
{
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/throttler": "^6.2.0",
    "@node-rs/argon2": "^2.0.0",
    "@resend/node": "^4.0.0",
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.38.2",
    "otplib": "^12.0.1",
    "pg": "^8.13.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.0",
    "@types/pg": "^8.11.10",
    "@types/supertest": "^6.0.2",
    "drizzle-kit": "^0.30.1",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.2"
  }
}
```

### 12.2 Variáveis de Ambiente (`.env.example`)

```bash
# Ambiente
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1

# Banco de Dados PostgreSQL (Neon Serverless)
DATABASE_URL="postgresql://arenago_owner:secret@ep-cool-pooler.us-east-2.aws.neon.tech/arenago?sslmode=require"
DATABASE_DIRECT_URL="postgresql://arenago_owner:secret@ep-cool.us-east-2.aws.neon.tech/arenago?sslmode=require"

# Autenticação e Criptografia
JWT_ACCESS_SECRET="substituir_por_chave_aleatoria_hex_com_minimo_64_caracteres"
JWT_REFRESH_SECRET="substituir_por_outra_chave_aleatoria_hex_com_minimo_64_caracteres"
TOTP_ENCRYPTION_KEY="32_bytes_hex_para_cifra_aes_256_gcm_exemplo_abcdef..."

# Provedor de E-mail (Resend)
RESEND_API_KEY="re_1234567890abcdef"
EMAIL_FROM="ArenaGo <nao-responda@arenago.com.br>"
APP_WEB_URL="https://app.arenago.com.br"
```

### 12.3 Configuração Segura de Conexão com o Neon (TLS)

A conexão com o Neon Serverless Postgres deve assegurar estrita verificação criptográfica do certificado do servidor em todos os ambientes (inclusive produção), eliminando riscos de interceptação maliciosa (*Man-in-the-Middle* / MITM):

- **Eliminação de `rejectUnauthorized: false`:**
  A configuração anterior que desabilitava a verificação de certificados foi formalmente corrigida. O backend adota estritamente `rejectUnauthorized: true`.
- **Cadeia de Confiança de Autoridades Certificadoras (CA):**
  O Neon utiliza certificados TLS assinados por autoridades certificadoras comerciais e públicas de raiz confiável (Let's Encrypt / Amazon Trust Services). Como o Node.js possui embutido o *trust store* de CAs raiz da Mozilla, a validação da identidade criptográfica do servidor Neon ocorre de forma automática e transparente.
- **Suporte a CA Customizada (Ambientes Corporativos):**
  Caso o ambiente de implantação utilize proxies reversos corporativos com inspeção TLS ou redes restritas, o driver suporta a passagem explícita da autoridade certificadora via variável de ambiente `DATABASE_CA_CERT`:

```typescript
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // Adequado para manter-se folgadamente dentro das cotas do Neon Free
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    // Verificação estrita de certificado de autoridade certificadora confiável
    rejectUnauthorized: true,
    // Permite injetar CA raiz customizada caso exigido pelo ambiente
    ca: process.env.DATABASE_CA_CERT ? process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : undefined
  }
});

export const db = drizzle(pool, { schema });
```

*Nota sobre Migrações:* Para DDL via Drizzle Kit (`drizzle-kit migrate`), utiliza-se a `DATABASE_DIRECT_URL` (conexão direta sem PgBouncer), pois comandos transacionais de schema exigem conexão dedicada.

### 12.4 Comandos Previstos para o Backend
```bash
# Instalação limpa
npm ci

# Geração de arquivos SQL de migração
npm run db:generate

# Aplicação das migrações SQL no banco Neon
npm run db:migrate

# Execução em modo de desenvolvimento
npm run start:dev

# Execução da suíte de testes
npm run test           # Unitários
npm run test:integration # Integração com banco real
npm run test:e2e       # Ponta a ponta
```

---

## 13. Quadro Consolidado de Decisões Técnicas

### 13.1 Decisões Já Aprovadas pelo Projeto (Requisitos Fixos)
1. **Stack Central:** Node.js + TypeScript + NestJS com adaptador padrão Express em Monólito Modular.
2. **Banco de Dados:** PostgreSQL hospedado no Neon Serverless.
3. **ORM & Migrações:** Drizzle ORM com driver `pg` e migrações SQL versionadas via Drizzle Kit.
4. **Perfis & Permissões:** Três perfis (Participante, Staff por evento, Admin global); permissões cumulativas; Staff e Admin exigem e-mail verificado; revogação com efeitos imediatos verificados no banco.
5. **Autenticação:** Login por e-mail e senha (mínimo de 8 caracteres, sem obrigatoriedade de maiúsculas/símbolos, bloqueio de senhas comuns).
6. **Sessões e Linhagem:** Access token de 15 minutos; sessão máxima de 30 dias (renovação não prolonga o teto); exatamente uma sessão ativa por conta garantida por constraint no banco (`idx_sessions_single_active_per_user`); rotação de refresh tokens com histórico para detecção de reuso.
7. **Recuperação de Senha:** Link com token único válido por 30 minutos; rate limit de 1 a cada 2 min e 5 por hora; execução atômica em transação ACID que revoga todas as sessões; respostas opacas.
8. **Questionário e Cadastro:** Cadastro cria conta válida de imediato; questionário pode permanecer pendente; `GET /profile/questionnaire` retorna `200 OK` com `hasCompleted: false` quando incompleto; salvamento em lote em `PUT /profile/questionnaire`; jogos deduplicados sem alteração do nome canônico existente.
9. **Administração & 2FA:** Admin exige 2FA por TOTP (RFC 6238) e backup codes; bootstrap do primeiro Admin via CLI com auditoria atribuída ao sistema (`actor_id = NULL`); recuperação de TOTP autorizada exclusivamente por outro Admin com 2FA ativo.

### 13.2 Decisões Técnicas Propostas pelo Kaled
1. **Algoritmo de Hash:** Adoção de **Argon2id** (`@node-rs/argon2`) com parâmetros OWASP (64 MB de memória, 3 iterações, 4 threads), com fallback para bcrypt (cost 12) caso haja restrição severa de memória.
2. **Estratégia de Validação Imediata de Sessão:** Inclusão do `sid` (Session ID) no payload do JWT e checagem indexada na tabela `sessions` (< 1ms), dispensando o custo operacional de manter Redis em infraestrutura gratuita.
3. **Deduplicação de Jogos via CTE Atômica:** Inserção idempotente com `DO NOTHING` e busca unificada do nome canônico existente, preservando a grafia original do catálogo.
4. **Provedor de E-mail Transacional:** Adoção do **Resend** pelo SDK limpo e cota gratuita suficiente para suportar as fases iniciais.
5. **Armazenamento Móvel:** Utilização do `expo-secure-store` para proteção de credenciais no Keychain (iOS) e Keystore (Android).
6. **Rate Limiting Eficiente no Monólito:** Aplicação de rate limiting duplo (por conta com e-mail normalizado e por IP) via storage em memória do `@nestjs/throttler`, garantindo proteção sem custo operacional ou necessidade prematura de Redis.
7. **Conexão Segura TLS com Neon:** Adoção mandatória de `rejectUnauthorized: true` com suporte a CA customizada, eliminando vulnerabilidades a ataques MITM em produção.


### 13.3 Pendências Formalmente Delimitadas (Não Bloqueantes para a Task 6.2)
1. **Domínio de E-mail para Envio:** Definir se a organização configurará registros DNS próprios no Resend antes do lançamento.
2. **Interface de Redirecionamento da Recuperação de Senha:** Definição entre página web responsiva (`https://app.arenago.com.br/redefinir-senha?token=...`) ou deep link universal móvel.
3. **Privacidade e Retenção sob a LGPD:** Especificação detalhada de bases legais, anonimização estatística (k-anonimato para relatórios de BI), rotinas periódicas de expurgo de tokens/sessões inativas e tratamento de solicitações de exclusão de titulares.
4. **Elegibilidade de Contas Admin em Eventos:** Definição da regra de negócio sobre participação de contas administrativas em competições (a ser tratada no planejamento de eventos e filas).

---

## 14. Próximos Passos Pós-Aprovação

Com a aprovação formal desta especificação revisada:
1. Iniciar a **Task 6.2 (Fundação do Backend)** com a inicialização limpa do projeto NestJS no diretório `backend/`.
2. Configuração do TypeScript, Drizzle ORM, Drizzle Kit e conexão segura TLS com o Neon.
3. Criação dos schemas Drizzle consolidados e geração da migração inicial `0001_initial_schema.sql`.
4. Implementação incremental e orientada a testes dos módulos de Sessões, Usuários, Autenticação, Perfil, Questionário e Catálogo de Jogos.
5. Execução da suíte de testes de integração contra instância real de PostgreSQL, validando sessão única, rotação de tokens, detecção de reuso e concorrência.
