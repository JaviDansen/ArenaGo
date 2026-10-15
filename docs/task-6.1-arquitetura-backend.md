# ArenaGo — Task 6.1: Planejamento e Arquitetura Técnica do Backend

**Versão do Documento:** 1.0  
**Data:** 15/10/2026  
**Status:** Proposta técnica consolidada para revisão e aprovação da equipe  
**Branch:** `task-6.1-planejamento-backend` (criada a partir da `develop` atualizada)  
**Escopo:** Backend de Usuários, Autenticação, Sessões, Perfil, Questionário e Catálogo de Jogos  

---

## Sumário Executivo

Este documento estabelece a especificação arquitetural e o detalhamento técnico para a implementação do backend do **ArenaGo**, em estrita conformidade com as decisões já aprovadas pelo projeto e com as diretrizes consolidadas no Planejamento Geral (v0.5).

A solução adota **Node.js com TypeScript** sob o framework **NestJS** (adaptador HTTP padrão Express), estruturado como um **Monólito Modular**. A persistência de dados utiliza **PostgreSQL** (com hospedagem preferencial no **Neon Serverless Postgres**), mapeado via **Drizzle ORM** com o driver nativo `pg` e controle rigoroso de esquemas por migrações SQL versionadas através do **Drizzle Kit**.

Todo o design aqui apresentado foi projetado para assegurar integridade transacional, isolamento entre domínios e suporte futuro direto aos módulos de **Eventos, Filas Compartilhadas, Arena, Avaliações e Painel Administrativo de BI**, sem necessidade de refatorações estruturais no núcleo de identidade.

---

## 1. Visão Geral da Arquitetura

### 1.1 Estilo Arquitetural e Tecnologias Centrais

| Componente | Tecnologia Selecionada | Justificativa / Papel no Sistema | Situação |
|---|---|---|---|
| **Runtime & Linguagem** | Node.js 22 LTS + TypeScript 5.x | Tipagem estática fim a fim, alto desempenho de I/O assíncrono e ecossistema maduro. | **[DECISÃO APROVADA]** |
| **Framework Backend** | NestJS (adaptador padrão Express) | Arquitetura modular corporativa, injeção de dependências, controle de ciclo de vida e organização previsível. | **[DECISÃO APROVADA]** |
| **Padrão Arquitetural** | Monólito Modular | Módulos desacoplados compartilhando o mesmo processo de execução e banco relacional, minimizando sobrecarga operacional e viabilizando custo zero inicial. | **[DECISÃO APROVADA]** |
| **Banco de Dados** | PostgreSQL 16 (Neon Serverless) | Banco relacional robusto com suporte nativo a constraints, transações ACID, tipos específicos (`DATE`, `UUID`, `JSONB`) e extensão serverless. | **[DECISÃO APROVADA]** |
| **ORM & Migrações** | Drizzle ORM + `pg` + Drizzle Kit | ORM leve e tipado em TypeScript sem sobrecarga de runtime, garantindo controle total sobre SQL gerado e migrações versionadas. | **[DECISÃO APROVADA]** |
| **Segurança de Senhas** | Argon2id (`@node-rs/argon2`) | Algoritmo vencedor da Password Hashing Competition (PHC), recomendado pela OWASP para proteção contra ataques de GPU/ASIC. | **[PROPOSTA KALED]** |
| **Autenticação & Sessões** | JWT Stateless (15m) + Tabela de Sessões Indexada | Combinação ágil: token de acesso curto (15m) com validação de revogação imediata via chave primária de sessão (`sid`), garantindo sessão única ativa. | **[DECISÃO APROVADA]** |
| **Autenticação 2FA Admin** | TOTP (RFC 6238 via `otplib`) + Backup Codes | Segundo fator obrigatório para ações administrativas, com códigos de recuperação de uso único. | **[DECISÃO APROVADA]** |
| **Envio Transacional de E-mail** | Resend (SDK `@resend/node`) | Camada de entrega com cota gratuita generosa (3.000 e-mails/mês), compatível com domínio próprio e DNS configurado. | **[PROPOSTA KALED]** |

### 1.2 Diagrama Arquitetural de Alto Nível

```mermaid
graph TB
    subgraph MobileClient ["Aplicativo Móvel ArenaGo (React Native / Expo)"]
        UI["Telas de UI (Register, Login, ForgotPassword, Questionnaire)"]
        SecureStore["Armazenamento Seguro (expo-secure-store: Refresh Token)"]
        MemoryStore["Armazenamento em Memória (Access Token / Context)"]
        AxiosClient["Cliente HTTP (Interceptores de Refresh e 401)"]
    end

    subgraph BackendAPI ["API NestJS — Monólito Modular"]
        Gateway["Reverse Proxy / SSL / Throttler Guard (Rate Limit)"]
        AuthMod["AuthModule (Argon2id, JWT, Recuperação, 2FA/TOTP)"]
        UserMod["UsersModule (Gestão de Contas e Credenciais)"]
        SessMod["SessionsModule (Sessão Única, Rotação e Revogação)"]
        RoleMod["RolesModule (RBAC: Ciente, Staff, Admin + Auditoria)"]
        ProfMod["ProfileModule (Dados Pessoais e Respostas)"]
        GameMod["GamesModule (Catálogo e Deduplicação Case-Insensitive)"]
        EmailMod["EmailModule (Serviço Transacional Resend)"]
        
        FutureMods["Módulos Futuros (Events, Queues, Attendances, Evaluations, BI)"]
    end

    subgraph DataLayer ["Camada de Persistência (Neon Serverless PostgreSQL)"]
        NeonPooler["Neon Connection Pooler (PgBouncer - Porta 5432)"]
        Drizzle["Drizzle ORM Engine + Driver 'pg'"]
        PostgresTables[("Tabelas Relacionais: users, sessions, profiles, games, roles, tokens")]
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

A análise minuciosa dos arquivos `screens/auth/*`, `screens/ProfileQuestionnaireScreen.js`, `utils/validation.js` e `utils/birthDate.js` revelou a seguinte parametrização e regras de negócio locais:

### 2.1 Mapeamento Comparativo de Campos e Validações

| Fluxo / Tela | Campos Coletados no Frontend | Validação Atual no Frontend | Regra Aprovada para o Backend | Ação / Alinhamento Necessário |
|---|---|---|---|---|
| **Cadastro** (`RegisterScreen.js`) | `name`<br>`email`<br>`password`<br>`confirmPassword` | - `name`: obrigatório, trimmed.<br>- `email`: obrigatório, regex padrão.<br>- `password`: **mínimo 6 caracteres**.<br>- `confirmPassword`: estritamente igual à senha. | - `name`: obrigatório (máx 150 carac.).<br>- `email`: obrigatório, normalizado em minúsculas.<br>- `password`: **mínimo 8 caracteres** (máx 128 carac.). Bloqueio de senhas comuns.<br>- Sem exigência de maiúscula/símbolo obrigatório.<br>- `confirmPassword` **não é enviado ao backend**. | **Ajuste de Requisito:** Aumentar validação de senha para 8 caracteres. O backend aceitará apenas `{ name, email, password }`. Criação de conta como `Participante` comum. |
| **Login** (`LoginScreen.js`) | `email`<br>`password` | - `email`: obrigatório, formato válido.<br>- `password`: obrigatório. | - Autenticação por e-mail e hash seguro.<br>- Criação de sessão única ativa com revogação da anterior.<br>- Resposta com Access Token (15m) e Refresh Token (30d). | O redirecionamento provisório local para `MainTabs` será substituído pelo consumo de `POST /auth/login` e persistência do token no `expo-secure-store`. |
| **Recuperação de Senha** (`ForgotPasswordScreen.js`) | *Placeholder* (sem campos funcionais) | Apenas aviso visual "Em construção". | - Envio de e-mail com token aleatório único (validade 30 min).<br>- Rate limit: 1 a cada 2 min por conta, máx 5/hora.<br>- Resposta opaca sem revelar existência de conta.<br>- Redefinição revoga todas as sessões ativas. | Implementação completa dos endpoints `POST /auth/forgot-password` e `POST /auth/reset-password`. |
| **Questionário — Etapa 1: Sobre você** (`ProfileQuestionnaireScreen.js`) | `birthDate`<br>`gender`<br>`otherGender`<br>`education` | - `birthDate`: máscara DD/MM/AAAA, conversão para civil `YYYY-MM-DD`, rejeita data futura e impossível.<br>- `gender`: 1 opção entre Feminino, Masculino, Outro, Prefiro não informar.<br>- `otherGender`: obrigatório apenas se `gender === 'Outro'`.<br>- `education`: 1 opção entre Fundamental, Médio, Superior, Pós-graduação, Prefiro não informar. | - `birthDate`: armazenar estritamente como tipo SQL `DATE` (sem horas, sem conversão de timezone).<br>- `gender` e `education`: enums padronizados.<br>- `otherGender`: `varchar(100)` anulável. | Preservar exatamente a integridade do formato civil de data. Endpoint autenticado `PUT /profile/questionnaire`. |
| **Questionário — Etapa 2: Seus jogos** (`ProfileQuestionnaireScreen.js`) | `selectedGames` (Array de strings) | - Mínimo 1 jogo selecionado.<br>- Sugestões de catálogo (20 jogos do `mockGames`).<br>- Inclusão manual livre digitada pelo usuário.<br>- Deduplicação local case-insensitive `toLowerCase().trim()`. | - Catálogo persistido em tabela `games` (`is_curated = true`).<br>- Jogos manuais persistidos em `games` (`is_curated = false`) com deduplicação case-insensitive via `LOWER(TRIM(name))`.<br>- Vínculo N:N em `user_games`. | Disponibilizar endpoint `GET /games` para sugestões e aceitar novos nomes no payload do questionário. |
| **Questionário — Etapa 3: Mercado de games** (`ProfileQuestionnaireScreen.js`) | `marketKnowledge`<br>`marketInterest` | - `marketKnowledge`: 1 opção ('Sim, conheço.', 'Conheço um pouco.', 'Não conheço.').<br>- `marketInterest`: 1 opção ('Sim, tenho interesse.', 'Talvez — quero conhecer melhor.', 'Não tenho interesse.'). | - Campos obrigatórios persistidos no perfil do usuário.<br>- Integrados ao snapshot imutável em futuras participações de eventos. | Armazenar no perfil e compor a estrutura congelada na participação. |

---

## 3. Estrutura de Módulos e Diretórios do NestJS

Para atender ao requisito de **Monólito Modular** expansível, o backend adota a separação por domínios de negócio com injeção de dependências estrita.

```text
backend/
├── src/
│   ├── common/                          # Utilitários compartilhados, decorators e filtros
│   │   ├── constants/                   # Constantes de sistema (tokens, tempos, limites)
│   │   ├── decorators/                  # @CurrentUser(), @Roles(), @Public(), @Require2FA()
│   │   ├── filters/                     # AllExceptionsFilter (padronização RFC 7807)
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
│   │   │   ├── sessions.schema.ts       # sessions
│   │   │   ├── tokens.schema.ts         # password_reset_tokens, email_verification_tokens
│   │   │   ├── roles.schema.ts          # user_roles, role_audit_logs
│   │   │   ├── profiles.schema.ts       # profiles
│   │   │   ├── games.schema.ts          # games, user_games
│   │   │   └── index.ts                 # Exportação unificada do esquema
│   │   ├── drizzle.provider.ts          # Provedor do cliente Drizzle conectado ao pool pg
│   │   └── database.module.ts           # Módulo global de banco de dados
│   │
│   ├── modules/                         # Módulos funcionais do domínio
│   │   ├── auth/                        # Módulo de Autenticação e Credenciais
│   │   │   ├── dto/                     # RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto
│   │   │   ├── strategies/              # JwtStrategy, RefreshStrategy
│   │   │   ├── auth.controller.ts       # Endpoints /auth/*
│   │   │   ├── auth.service.ts          # Regras de negócio de cadastro, login e redefinição
│   │   │   ├── password-hasher.service.ts # Implementação de Argon2id e blacklist de senhas
│   │   │   └── auth.module.ts
│   │   │
│   │   ├── sessions/                    # Gerenciamento de Sessões Ativas e Rotação
│   │   │   ├── sessions.service.ts      # Controle de sessão única, rotação e reuso
│   │   │   ├── sessions.repository.ts   # Operações no banco de dados sobre sessions
│   │   │   └── sessions.module.ts
│   │   │
│   │   ├── users/                       # Gestão de Identidade e Contas
│   │   │   ├── users.service.ts         # Busca, criação e verificação de contas
│   │   │   ├── users.repository.ts      # Consultas de persistência de usuários
│   │   │   └── users.module.ts
│   │   │
│   │   ├── roles/                       # Gestão de Papéis e Auditoria (RBAC)
│   │   │   ├── dto/                     # GrantRoleDto, RevokeRoleDto
│   │   │   ├── roles.service.ts         # Concessão, revogação e validação de privilégios
│   │   │   ├── audit.service.ts         # Registro imutável de trilha de auditoria
│   │   │   ├── roles.controller.ts      # Endpoints administrativos de permissões
│   │   │   └── roles.module.ts
│   │   │
│   │   ├── profile/                     # Perfil Pessoal e Questionário
│   │   │   ├── dto/                     # UpdateQuestionnaireDto, ProfileResponseDto
│   │   │   ├── profile.controller.ts    # Endpoints /profile e /profile/questionnaire
│   │   │   ├── profile.service.ts       # Gravação e consulta do questionário em 3 etapas
│   │   │   └── profile.module.ts
│   │   │
│   │   ├── games/                       # Catálogo de Jogos e Sugestões
│   │   │   ├── dto/                     # SearchGamesDto, CreateCustomGameDto
│   │   │   ├── games.controller.ts      # Endpoint /games (busca com deduplicação)
│   │   │   ├── games.service.ts         # Consulta e inserção case-insensitive de jogos
│   │   │   └── games.module.ts
│   │   │
│   │   ├── email/                       # Comunicação Transacional
│   │   │   ├── templates/               # Templates HTML de recuperação e verificação
│   │   │   ├── email.service.ts         # Integração com Resend / fallback SMTP
│   │   │   └── email.module.ts
│   │   │
│   │   └── admin/                       # Administração e Segundo Fator (2FA)
│   │       ├── dto/                     # VerifyTotpDto, SetupTotpDto
│   │       ├── admin.controller.ts      # Endpoints de 2FA e governança
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
│   │   └── promote-first-admin.ts       # Script seguro de promoção do 1º Admin
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
│   └── e2e/                             # Testes ponta a ponta de contratos HTTP
│
├── drizzle.config.ts                    # Configuração do Drizzle Kit
├── package.json
├── tsconfig.json
└── .env.example                         # Modelo documentado de variáveis de ambiente
```

---

## 4. Diagrama de Entidades e Relacionamentos (ERD)

O diagrama abaixo especifica todas as tabelas, tipos de dados, chaves primárias/estrangeiras e cardinalidades do núcleo de usuários, autenticação e questionário, bem como sua ligação conceitual com as entidades futuras de eventos e snapshots imutáveis.

```mermaid
erDiagram
    users ||--o| profiles : "possui (1:1)"
    users ||--o{ sessions : "possui sessões (1:N)"
    users ||--o{ password_reset_tokens : "solicita (1:N)"
    users ||--o{ email_verification_tokens : "recebe (1:N)"
    users ||--o{ user_roles : "possui papéis (1:N)"
    users ||--o{ role_audit_logs : "é alvo ou autor de (1:N)"
    users ||--o| user_totp_credentials : "configura 2FA (1:1)"
    users ||--o{ user_backup_codes : "possui códigos backup (1:N)"
    users ||--o{ user_games : "joga (1:N)"
    games ||--o{ user_games : "selecionado em (1:N)"
    games ||--o| users : "adicionado por (N:1 opcional)"

    %% Relações futuras para contexto de snapshot (não implementadas nesta task)
    users ||--o{ participations : "participa (1:N futuro)"
    participations ||--|| participation_questionnaire_snapshots : "congela perfil (1:1 futuro)"

    users {
        uuid id PK
        varchar_150 name
        varchar_255 email UK
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
        varchar_64 refresh_token_hash UK
        varchar_45 ip_address
        varchar_255 user_agent
        timestamp_tz expires_at
        timestamp_tz last_activity_at
        timestamp_tz revoked_at
        varchar_50 revocation_reason
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
        uuid actor_id FK
        uuid target_user_id FK
        varchar_20 action
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
  - `email`: `VARCHAR(255) NOT NULL` (e-mail normalizado em minúsculas)
  - `password_hash`: `TEXT NOT NULL` (hash Argon2id)
  - `email_verified_at`: `TIMESTAMP WITH TIME ZONE NULL` (data da confirmação do e-mail)
  - `is_active`: `BOOLEAN NOT NULL DEFAULT true` (controle de desativação)
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `updated_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Restrições de Unicidade & Índices:**
  - `UNIQUE (email)` (índice único sobre e-mail)
  - `CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(TRIM(email)));`

### 5.2 Tabela `profiles`
Armazena os dados pessoais e as respostas do questionário do usuário.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`
  - `birth_date`: `DATE NOT NULL` (**Regra mandatória: sem conversão de timezone**)
  - `gender`: `VARCHAR(30) NOT NULL` (Valores: `'Feminino'`, `'Masculino'`, `'Outro'`, `'Prefiro não informar'`)
  - `other_gender`: `VARCHAR(100) NULL` (obrigatório somente quando `gender = 'Outro'`)
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
  - `name`: `VARCHAR(100) NOT NULL` (Nome original do jogo)
  - `is_curated`: `BOOLEAN NOT NULL DEFAULT false` (`true` para catálogo padrão, `false` para manual)
  - `created_by_user_id`: `UUID NULL REFERENCES users(id) ON DELETE SET NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Restrições de Unicidade & Índices:**
  - `CREATE UNIQUE INDEX idx_games_name_lower_unique ON games (LOWER(TRIM(name)));` (Garante unicidade case-insensitive absoluta)

### 5.4 Tabela `user_games`
Relação de muitos-para-muitos entre usuários e os jogos selecionados na Etapa 2 do questionário.
- **PK Composta:** `(user_id, game_id)`
- **Colunas:**
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `game_id`: `UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Índices:**
  - `CREATE INDEX idx_user_games_game_id ON user_games (game_id);`

### 5.5 Tabela `sessions`
Gerencia a sessão ativa, rotação de refresh tokens e garante sessão única por conta.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `refresh_token_hash`: `VARCHAR(64) NOT NULL UNIQUE` (hash SHA-256 do refresh token emitido)
  - `ip_address`: `VARCHAR(45) NULL` (suporte a IPv4 e IPv6)
  - `user_agent`: `VARCHAR(255) NULL`
  - `expires_at`: `TIMESTAMP WITH TIME ZONE NOT NULL` (data fixa: `created_at + 30 dias`)
  - `last_activity_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `revoked_at`: `TIMESTAMP WITH TIME ZONE NULL` (preenchido na revogação)
  - `revocation_reason`: `VARCHAR(50) NULL` (`'new_login'`, `'logout'`, `'password_reset'`, `'token_reuse'`, `'admin_action'`)
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **Índices:**
  - `CREATE INDEX idx_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;`
  - `CREATE UNIQUE INDEX idx_sessions_refresh_hash ON sessions (refresh_token_hash);`

### 5.6 Tabela `password_reset_tokens`
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

### 5.7 Tabela `email_verification_tokens`
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

### 5.8 Tabela `user_roles`
Permissões cumulativas atribuídas a uma conta.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `role`: `VARCHAR(30) NOT NULL` (Valores: `'participante'`, `'staff'`, `'admin'`)
  - `event_id`: `UUID NULL` (Obrigatório para `'staff'`, `NULL` para `'admin'` que é global)
  - `granted_by`: `UUID NULL REFERENCES users(id)`
  - `granted_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `revoked_at`: `TIMESTAMP WITH TIME ZONE NULL`
  - `revoked_by`: `UUID NULL REFERENCES users(id)`
- **Índices:**
  - `CREATE INDEX idx_user_roles_active ON user_roles (user_id, role) WHERE revoked_at IS NULL;`

### 5.9 Tabela `role_audit_logs`
Trilha de auditoria imutável para todas as concessões e revogações de privilégios.
- **PK:** `id` (`uuid`, `gen_random_uuid()`)
- **Colunas:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `actor_id`: `UUID NOT NULL REFERENCES users(id)` (Quem executou a ação)
  - `target_user_id`: `UUID NOT NULL REFERENCES users(id)` (Quem recebeu/perdeu o papel)
  - `action`: `VARCHAR(20) NOT NULL` (Valores: `'GRANT'`, `'REVOKE'`)
  - `role`: `VARCHAR(30) NOT NULL`
  - `event_id`: `UUID NULL`
  - `reason`: `TEXT NULL`
  - `ip_address`: `VARCHAR(45) NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`

### 5.10 Tabelas de Segundo Fator (`user_totp_credentials` e `user_backup_codes`)
Estrutura para 2FA obrigatório de administradores.
- **`user_totp_credentials`:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`
  - `secret_encrypted`: `TEXT NOT NULL` (Segredo base32 cifrado com AES-256-GCM)
  - `is_verified`: `BOOLEAN NOT NULL DEFAULT false`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
  - `updated_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`
- **`user_backup_codes`:**
  - `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `code_hash`: `VARCHAR(64) NOT NULL UNIQUE` (hash SHA-256 do código alfanumérico)
  - `used_at`: `TIMESTAMP WITH TIME ZONE NULL`
  - `created_at`: `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`

---

## 6. Fluxos de Autenticação, Sessões e Autorização

### 6.1 Algoritmo e Parâmetros de Hash de Senha
- **Algoritmo Selecionado:** **Argon2id** (`@node-rs/argon2`), versão com bindings em Rust de alta performance.
- **Parâmetros Técnicos:**
  - `memoryCost`: `65536` (64 MiB de memória alocada por hash)
  - `timeCost`: `3` iterações
  - `parallelism`: `4` threads
  - `outputLen`: `32` bytes
- **Fallback / Alternativa Documentada:** Caso o servidor possua restrições severas de memória no plano gratuito (ex.: instâncias com menos de 512 MB de RAM compartilhada), utilizar-se-á **bcrypt** com fator de custo `12`.
- **Proteção contra Senhas Comuns e Comprometidas:**
  - O backend executará checagem síncrona contra uma lista compilada em memória com as 100.000 senhas mais comuns (base SecLists / OWASP). Caso a senha candidata conste na lista, a requisição é rejeitada com código `422 Unprocessable Entity` e mensagem orientando a escolha de uma senha mais segura.

### 6.2 Estratégia de Access Token e Refresh Token
1. **Access Token:**
   - Formato: JWT (JSON Web Token) assinado com algoritmo `HS256` (ou `RS256` se houver necessidade de validação externa descentralizada).
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
   - Persistência: Apenas o hash `SHA-256` do token é gravado na tabela `sessions.refresh_token_hash`. O token em texto claro nunca reside no banco de dados.
3. **Limite Absoluto da Sessão:**
   - A coluna `expires_at` é definida na criação da sessão como `NOW() + INTERVAL '30 days'`.
   - **Regra Aprovada:** As renovações periódicas do refresh token atualizam `last_activity_at`, mas **jamais estendem `expires_at`**. Ao atingir 30 dias corridos, a sessão expira compulsoriamente e um novo login com credenciais completas é exigido.

### 6.3 Garantia de Uma Sessão Ativa por Conta e Revogação Imediata
O requisito fundamental do ArenaGo é: **"Uma sessão ativa por conta. Novo login revoga a sessão anterior, inclusive access tokens ainda não expirados."**

```mermaid
sequenceDiagram
    autonumber
    actor User as Participante (Dispositivo B)
    participant API as Backend (NestJS)
    participant DB as PostgreSQL (Neon)
    actor OldDevice as Dispositivo A (Sessão Antiga)

    User->>API: POST /auth/login { email, password }
    API->>DB: Busca usuário por e-mail
    API->>API: Valida senha via Argon2id
    
    rect rgb(240, 220, 220)
    Note over API,DB: Revogação imediata da sessão anterior
    API->>DB: UPDATE sessions SET revoked_at = NOW(), revocation_reason = 'new_login' WHERE user_id = :userId AND revoked_at IS NULL
    end

    API->>DB: INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES (...) RETURNING id
    API-->>User: Retorna 200 OK { accessToken (15m), refreshToken, user }

    rect rgb(255, 235, 235)
    Note over OldDevice,API: Tentativa de uso pelo Dispositivo A
    OldDevice->>API: GET /profile (Bearer AccessToken da sessão antiga com sid=SessaoA)
    API->>API: Valida assinatura JWT e expiração (<15m) -> OK
    API->>DB: SELECT revoked_at FROM sessions WHERE id = :sid
    DB-->>API: Retorna revoked_at != NULL
    API-->>OldDevice: Retorna 401 Unauthorized { message: "Sessão encerrada por novo login em outro dispositivo" }
    end
```

**Mecanismo de Validação nos Endpoints Protegidos (`JwtAuthGuard`):**
1. O guard valida a assinatura criptográfica e a data de expiração do JWT.
2. O guard extrai o `sid` (Session ID) do payload do JWT.
3. Executa consulta indexada no banco: `SELECT revoked_at, expires_at FROM sessions WHERE id = :sid`.
4. Se `revoked_at IS NOT NULL` ou `expires_at < NOW()`, a requisição é rejeitada imediatamente com código `401 Unauthorized`.
5. **Impacto de Desempenho:** Por ser uma consulta por chave primária UUID (`id`), o tempo de resposta no PostgreSQL indexado é inferior a **1 milissegundo**. Isso garante revogação em tempo real sem complexidade de sincronização distribuída de blacklist em cache.

### 6.4 Rotação de Refresh Token e Detecção de Reuso
A rotação ocorre em cada chamada a `POST /auth/refresh`:
1. O cliente envia o `refreshToken` atual.
2. O servidor calcula `hash = sha256(refreshToken)`.
3. Consulta `sessions WHERE refresh_token_hash = :hash`.
4. **Cenário Normal (Válido):**
   - Se `revoked_at IS NULL` e `expires_at > NOW()`:
     - Gera um novo refresh token.
     - Atualiza a sessão: `refresh_token_hash = sha256(novo)`, `last_activity_at = NOW()`.
     - Emite novo Access Token (15m).
     - Retorna ambos ao cliente.
5. **Cenário de Reuso de Token (Ataque / Vazamento):**
   - Se o token apresentado já foi rotacionado anteriormente (ou seja, seu hash já foi substituído ou pertence a sessão revogada):
     - O sistema detecta potencial vazamento de credencial.
     - **Ação Imediata:** Revoga compulsoriamente a sessão correspondente (`revoked_at = NOW(), revocation_reason = 'token_reuse'`).
     - Emite alerta de segurança nos logs e retorna `401 Unauthorized`.

### 6.5 Armazenamento Seguro no Aplicativo Móvel
- **Dispositivos Físicos (iOS e Android):**
  - O `refreshToken` deve ser armazenado exclusivamente através da biblioteca `expo-secure-store`.
    - No **iOS:** os dados são gravados na **Apple Keychain** com atributos de acessibilidade restritos ao desbloqueio do dispositivo.
    - No **Android:** os dados são cifrados via **EncryptedSharedPreferences** com chave mestra gerenciada pelo **Android Keystore**.
  - O `accessToken` (duração de apenas 15 minutos) pode ser mantido em memória no estado global do aplicativo (`AuthContext`), minimizando acessos ao storage seguro e garantindo descarte imediato ao fechar o app se a sessão for inválida.
- **Interceção de Rede (Axios Interceptor):**
  - Ao receber status `401 Unauthorized`, o cliente tenta renovar a sessão via `POST /auth/refresh`. Se bem-sucedido, repete a chamada original de forma transparente ao usuário. Se a renovação falhar (sessão revogada ou expirada), limpa o SecureStore e navega o usuário para a tela de Login com mensagem amigável.

---

## 7. Fluxos de Recuperação de Senha e Verificação de E-mail

### 7.1 Fluxo de Recuperação de Senha

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário
    participant API as API (NestJS)
    participant RateLimiter as Throttler (Memória/Redis)
    participant DB as PostgreSQL
    participant EmailSvc as Resend (E-mail)

    User->>API: POST /auth/forgot-password { email }
    API->>RateLimiter: Verifica limite (1 a cada 2 min / máx 5 por hora)
    alt Limite excedido
        API-->>User: 429 Too Many Requests
    else Limite respeitado
        API->>DB: Busca usuário por LOWER(email)
        alt Usuário NÃO existe
            Note over API: Resposta opaca para evitar enumeração de e-mails
            API-->>User: 200 OK ("Se o e-mail estiver cadastrado, as instruções foram enviadas.")
        else Usuário existe
            API->>DB: Invalida tokens anteriores (UPDATE password_reset_tokens SET used_at = NOW() ...)
            API->>API: Gera token criptográfico (32 bytes aleatórios)
            API->>DB: INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            API->>EmailSvc: Envia e-mail com link contendo token em claro
            API-->>User: 200 OK ("Se o e-mail estiver cadastrado, as instruções foram enviadas.")
        end
    end

    Note over User,EmailSvc: Usuário recebe e-mail e clica no link dentro de 30 minutos

    User->>API: POST /auth/reset-password { token, newPassword }
    API->>DB: Busca token por sha256(token) WHERE used_at IS NULL AND expires_at > NOW()
    alt Token inválido ou expirado
        API-->>User: 400 Bad Request ("Token inválido ou expirado.")
    else Token válido
        API->>API: Valida nova senha (mínimo 8 caracteres, blacklist)
        API->>API: Gera novo hash Argon2id
        API->>DB: UPDATE users SET password_hash = :hash WHERE id = :userId
        API->>DB: UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :tokenId
        rect rgb(255, 230, 230)
        Note over API,DB: Revogação obrigatória de todas as sessões
        API->>DB: UPDATE sessions SET revoked_at = NOW(), revocation_reason = 'password_reset' WHERE user_id = :userId AND revoked_at IS NULL
        end
        API-->>User: 200 OK ("Senha redefinida com sucesso. Faça login novamente.")
    end
```

### 7.2 Fluxo de Verificação de E-mail
- **Regra Aprovada:** Contas com perfil **Participante (Ciente)** podem utilizar o aplicativo e preencher o questionário sem necessidade de verificação prévia de e-mail.
- **Regra para Privilegiados:** Nenhuma conta pode ser promovida a **Staff** ou **Admin** sem que `email_verified_at` esteja preenchido no banco de dados.
- **Solicitação:** Usuário autenticado chama `POST /auth/verify-email/request`. O backend gera um token aleatório válido por 24 horas e despacha e-mail com o link de confirmação.
- **Confirmação:** Chamada a `POST /auth/verify-email/confirm` com o token. O backend valida a assinatura e a expiração, atualiza `users.email_verified_at = NOW()` e registra a operação.

### 7.3 Provedor de E-mail e Considerações de Custo Zero
- **Serviço Proposto:** **Resend** (`https://resend.com`).
  - **Cota Gratuita:** 3.000 e-mails por mês e até 100 e-mails por dia, plenamente suficiente para fases de desenvolvimento, homologação e pilotos com centenas de participantes.
  - **Vantagens:** SDK oficial em TypeScript (`@resend/node`), compatibilidade total com NestJS, suporte nativo a SPF/DKIM/DMARC com domínio próprio e alta taxa de entrega na caixa de entrada.
  - **Fallback em Desenvolvimento Local:** Exibição do link de recuperação diretamente nos logs do console da API quando `NODE_ENV === 'development'`.

---

## 8. Modelo de Papéis, Permissões e Autenticação Administrativa (2FA)

### 8.1 Especificação dos Três Perfis (RBAC)

1. **Participante (`participante`):**
   - Papel base atribuído automaticamente a qualquer cadastro público.
   - Permissões: autenticar-se, gerenciar próprio perfil e questionário, consultar catálogo de jogos, e futuramente entrar em eventos públicos.
2. **Staff (`staff`):**
   - Permissão vinculada **estritamente a eventos específicos** (`event_id` obrigatório).
   - Não possui acesso global.
   - Pré-requisito: e-mail confirmado (`email_verified_at IS NOT NULL`).
   - Permissões: operar filas daquele evento, chamar participantes na estação, registrar ausência e confirmar atendimento.
3. **Admin (`admin`):**
   - Permissão **global** (`event_id IS NULL`).
   - Pré-requisitos: e-mail confirmado e segundo fator (TOTP) configurado.
   - Permissões: criar/editar eventos, conceder e revogar papéis de Staff e Admin, visualizar BI agregado e disparar encerramentos administrativos.

**Permissões Cumulativas:** Uma conta mantém múltiplos registros ativos na tabela `user_roles`. Um operador pode ser `participante` comum em geral, `staff` no evento X e `staff` no evento Y simultaneamente.

### 8.2 Concessão, Revogação e Trilha de Auditoria
- **Localização de Contas:** Administradores realizam concessões exclusivamente informando o e-mail de uma conta previamente existente. Não há criação de contas privilegiadas "do zero".
- **Validação Prévia:** O serviço rejeita qualquer concessão se o e-mail da conta não estiver verificado.
- **Revogação Imediata:** Ao revogar um papel (`UPDATE user_roles SET revoked_at = NOW()`), o `RolesGuard` rejeita requisições privilegiadas a partir do exato instante da revogação.
- **Auditoria Imutável:** Todas as alterações são inseridas na tabela `role_audit_logs` contendo quem concedeu/revogou (`actor_id`), o alvo (`target_user_id`), o papel, o evento, o endereço IP e a justificativa textual informada.

### 8.3 Procedimento Restrito de Bootstrap do Primeiro Admin
Para garantir que não haja endpoints abertos de auto-promoção e manter a conformidade:
1. O desenvolvedor cria uma conta comum normalmente no app ou API.
2. Realiza a verificação de e-mail da conta.
3. Acessa o terminal do servidor backend e executa o script de linha de comando:
   ```bash
   npm run cli:promote-admin -- --email admin@arenago.com.br --reason "Bootstrap inicial do sistema"
   ```
4. O script valida:
   - Que a conta existe.
   - Que o e-mail está verificado.
   - Se já existirem outros Admins, exige confirmação explícita.
5. Insere o papel `admin` em `user_roles` e grava o registro em `role_audit_logs` com `actor_id` igual ao próprio usuário (ação de bootstrap).
6. **Regra de Continuidade Operacional:** Antes de eventos reais com público, **ao menos dois administradores distintos** deverão estar ativos, com e-mail verificado e 2FA/TOTP configurado.

### 8.4 Autenticação Administrativa de Dois Fatores (2FA via TOTP)
- **Padrão:** RFC 6238 via biblioteca `otplib`. Janela de tempo de 30 segundos, algoritmo SHA-1 com código de 6 dígitos.
- **Armazenamento Seguro do Segredo:**
  - O segredo TOTP (base32) é encriptado em repouso com algoritmo **AES-256-GCM** utilizando a variável de ambiente `TOTP_ENCRYPTION_KEY`.
- **Códigos de Recuperação (Backup Codes):**
  - Na ativação do 2FA, o sistema gera **10 códigos de backup de uso único** (formato `XXXX-XXXX`, 8 caracteres alfanuméricos).
  - Apenas o hash `SHA-256` de cada código é armazenado na tabela `user_backup_codes`.
- **Fluxo de Login Administrativo:**
  1. O Admin informa e-mail e senha em `POST /auth/login`.
  2. A API valida a senha e detecta que a conta possui papel `admin`.
  3. O endpoint **não emite o token administrativo final**, mas sim um token temporário com escopo restrito `2fa_pending` (validade de 5 minutos).
  4. O Admin chama `POST /auth/2fa/verify` enviando o código do app autenticador ou um código de backup.
  5. Sendo validado, o backend emite o token final com a claim `admin:2fa_verified`.
- **Recuperação de TOTP Perdido:**
  - Caso o Admin perca o dispositivo e os códigos de backup, a recuperação técnica deve ser autorizada por **outro Admin ativo** através do endpoint `POST /admin/users/:id/reset-totp`. A ação revoga o segredo anterior e gera registro circunstanciado de auditoria.

---

## 9. Estratégia de Persistência do Questionário, Jogos e Snapshots

### 9.1 Questionário do Usuário Autenticado
- O questionário é vinculado ao usuário logado (`profiles.user_id = users.id`).
- O usuário pode consultar suas respostas salvas via `GET /profile/questionnaire` e atualizá-las quando desejar via `PUT /profile/questionnaire`.

### 9.2 Catálogo de Jogos e Inclusão Manual Sem Duplicidades
O frontend permite escolher jogos sugeridos ou digitar um novo jogo livremente.
- O catálogo oficial (os 20 jogos identificados em `mockData.js`, como *Apex Legends*, *Valorant*, *CS2*, etc.) será populado via seed de migração inicial com a flag `is_curated = true`.
- Quando um participante envia na Etapa 2 um jogo digitado manualmente que não existia no catálogo:
  1. A transação normaliza a string: `trimmed = name.trim()`.
  2. O banco possui o índice único funcional:
     ```sql
     CREATE UNIQUE INDEX idx_games_name_lower_unique ON games (LOWER(TRIM(name)));
     ```
  3. A aplicação utiliza inserção idempotente:
     ```sql
     INSERT INTO games (name, is_curated, created_by_user_id)
     VALUES (:trimmed, false, :userId)
     ON CONFLICT (LOWER(TRIM(name))) DO UPDATE SET name = EXCLUDED.name
     RETURNING id;
     ```
  4. Isso impede categoricamente que grafias como `"valorant"`, `"Valorant"` e `"  VALORANT  "` gerem linhas duplicadas na base.
  5. Em seguida, vincula-se o ID resultante na tabela associativa `user_games`.

### 9.3 Snapshots Imutáveis de Participação e Privacidade (LGPD)
Conforme aprovado na **D10**: *"Registrar o snapshot das respostas do questionário em cada nova participação: eventos antigos permanecem com respostas da época, novas participações usam respostas atualizadas."*

Embora a implementação completa de eventos ocorra nas fases seguintes, a modelagem técnica já estabelece o contrato do snapshot:
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
    games_snapshot JSONB NOT NULL, -- Array com os nomes exatos dos jogos: ["Valorant", "CS2"]
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```
- **Imutabilidade:** O snapshot é inserido uma única vez no momento da confirmação de entrada no evento. Qualquer edição posterior feita pelo participante em `profiles` ou `user_games` atualizará apenas seu perfil corrente, mantendo o histórico de eventos intacto.
- **Privacidade & BI:** O snapshot calcula e persiste diretamente a `age_at_event` (idade calculada no dia do evento). Se futuramente o titular exercer seu direito de exclusão de conta (LGPD), a participação é desvinculada do `user_id`, mas a linha do snapshot permanece para alimentar as métricas demográficas agregadas do evento, garantindo anonimização técnica efetiva sem perda de dados estatísticos.

---

## 10. Contratos da API (Especificação REST)

Todas as respostas de erro seguem o padrão estruturado do NestJS (em conformidade com a RFC 7807):
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Mensagem detalhada ou array de validações",
  "timestamp": "2026-10-15T17:30:00.000Z",
  "path": "/auth/register"
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
- **Regras de Validação:**
  - `name`: string obrigatória, 2 a 150 caracteres.
  - `email`: string obrigatória, formato de e-mail válido, normalizado para minúsculas.
  - `password`: string obrigatória, mínimo 8 e máximo 128 caracteres. Rejeição se constar na blacklist de senhas comprometidas.
- **Response `201 Created`:**
  ```json
  {
    "user": {
      "id": "b2f6d2b4-7f1e-4c91-9e23-28942b10a911",
      "name": "Kaled Silva",
      "email": "kaled@exemplo.com",
      "emailVerified": false,
      "roles": ["participante"]
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "v1.MR1B_x9kL42...",
    "expiresIn": 900
  }
  ```
- **Erros:**
  - `400 Bad Request`: Dados inválidos ou senha menor que 8 caracteres.
  - `409 Conflict`: E-mail já cadastrado no sistema.
  - `422 Unprocessable Entity`: Senha muito comum ou comprometida.

### 10.2 `POST /auth/login`
Autenticação por credenciais com revogação da sessão anterior.
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
      "roles": ["participante"]
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "v1.MR1B_x9kL42...",
    "expiresIn": 900
  }
  ```
- **Response `200 OK` (Quando usuário possui papel `admin`):**
  ```json
  {
    "requires2FA": true,
    "tempToken": "eyJhbGciOiJIUzI1NiIsIn...temp_2fa_token",
    "message": "Informe o código de segundo fator para concluir o acesso."
  }
  ```
- **Erros:**
  - `401 Unauthorized`: E-mail ou senha incorretos (mensagem opaca).
  - `429 Too Many Requests`: Mais de 5 falhas consecutivas em 15 minutos.

### 10.3 `POST /auth/refresh`
Renovação do token de acesso com rotação do refresh token.
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
- **Erros:**
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
    "hasCompletedQuestionnaire": true
  }
  ```

### 10.6 `POST /auth/forgot-password`
Solicitação de recuperação de senha.
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
- **Erros:**
  - `429 Too Many Requests`: Mais de 1 solicitação a cada 2 minutos ou mais de 5 por hora.

### 10.7 `POST /auth/reset-password`
Efetivação da redefinição de senha com token de uso único.
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
- **Erros:**
  - `400 Bad Request`: Token inválido, expirado ou senha inválida.

### 10.8 `POST /auth/verify-email/request` e `POST /auth/verify-email/confirm`
- **Request (`POST /auth/verify-email/request`):** Requer Bearer Token. Dispara e-mail com token de 24h.
- **Confirm (`POST /auth/verify-email/confirm`):**
  - Body: `{ "token": "token_recebido_no_email" }`
  - Response `200 OK`: `{ "message": "E-mail confirmado com sucesso." }`

### 10.9 `GET /profile/questionnaire`
Retorna as respostas atuais do questionário do usuário autenticado.
- **Autenticação:** Bearer Token obrigatório.
- **Response `200 OK`:**
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
- **Response `404 Not Found`:** Caso o usuário ainda não tenha preenchido o questionário.

### 10.10 `PUT /profile/questionnaire`
Salva ou atualiza as respostas do questionário em lote (todas as 3 etapas).
- **Autenticação:** Bearer Token obrigatório.
- **Request Body:**
  ```json
  {
    "birthDate": "2000-05-15",
    "gender": "Outro",
    "otherGender": "Não-binário",
    "education": "Superior",
    "selectedGames": ["Valorant", "Meu Jogo Indie Customizado"],
    "marketKnowledge": "Conheço um pouco.",
    "marketInterest": "Talvez — quero conhecer melhor."
  }
  ```
- **Regras de Validação:**
  - `birthDate`: formato `YYYY-MM-DD`, calendário real, não futura.
  - `gender`: um de `['Feminino', 'Masculino', 'Outro', 'Prefiro não informar']`. Se `'Outro'`, `otherGender` obrigatório e não vazio.
  - `education`: um de `['Fundamental', 'Médio', 'Superior', 'Pós-graduação', 'Prefiro não informar']`.
  - `selectedGames`: array com ao menos 1 item (strings não vazias).
  - `marketKnowledge`: uma das 3 opções válidas.
  - `marketInterest`: uma das 3 opções válidas.
- **Response `200 OK`:**
  ```json
  {
    "message": "Questionário salvo com sucesso.",
    "updatedAt": "2026-10-15T18:05:00.000Z"
  }
  ```

### 10.11 `GET /games`
Consulta catálogo de jogos para autocompletar na Etapa 2.
- **Autenticação:** Opcional / Pública ou Bearer Token.
- **Query Params:** `?query=val&limit=20`
- **Response `200 OK`:**
  ```json
  {
    "games": [
      { "id": "3b29c...", "name": "Valorant", "isCurated": true }
    ]
  }
  ```

### 10.12 Endpoints Administrativos e de 2FA
- `POST /auth/2fa/setup`: Inicia configuração de TOTP para Admin (gera QR Code / segredo e códigos de backup).
- `POST /auth/2fa/verify`: Valida código de 6 dígitos ou backup code para concluir login ou ativar 2FA.
- `POST /admin/roles/grant`: Concede papel Staff (com `eventId`) ou Admin global para uma conta existente localizada por e-mail.
- `POST /admin/roles/revoke`: Revoga papel ativo de um usuário com registro de auditoria.

---

## 11. Requisitos de Segurança, Proteção de Dados e Testes

### 11.1 Requisitos de Segurança e Resiliência
1. **Proteção Contra Acesso a Dados de Outros Usuários (IDOR):**
   - Endpoints de perfil e questionário utilizam estritamente o `sub` extraído do JWT verificado no backend (`req.user.id`). Nenhuma rota aceita `userId` via parâmetro de URL sem que haja checagem de autorização administrativa correspondente.
2. **Rate Limiting em Múltiplas Camadas (`@nestjs/throttler`):**
   - Rota de Login: limite de 5 tentativas a cada 15 minutos por combinação de e-mail e IP.
   - Recuperação de senha: 1 requisição a cada 2 minutos por conta, teto de 5 por hora por conta, e teto por faixa de IP para evitar negação de serviço sem bloquear redes universitárias/corporativas com NAT compartilhado.
3. **Prevenção de Ataques de Timing:**
   - A verificação de senha e a resposta de e-mail não existente utilizam computação de tempo constante, impedindo enumeração de usuários por medição de latência.
4. **Isolamento de Variáveis de Ambiente:**
   - Chaves privadas, segredos JWT (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) e a chave de cifra do TOTP (`TOTP_ENCRYPTION_KEY`) validadas rigorosamente na inicialização via schema Zod. Se alguma variável obrigatória estiver ausente, a aplicação aborta a inicialização imediatamente.

### 11.2 Estratégia de Testes do Backend

A validação da implementação do backend será executada em três níveis obrigatórios:

```mermaid
graph TD
    subgraph TestPyramid ["Pirâmide de Testes do Backend ArenaGo"]
        E2E["Testes E2E / Contratos de API (Supertest)"]
        Integration["Testes de Integração com PostgreSQL Real (Neon / Docker)"]
        Unit["Testes Unitários (Jest / Vitest)"]
    end
    
    Unit --> Integration
    Integration --> E2E
```

1. **Testes Unitários:**
   - Cobertura de regras de negócio isoladas (validações de data civil, formatação de e-mails, parser de DTOs).
   - Teste do algoritmo de hash Argon2id e da blacklist de senhas comuns.
   - Cálculo de idade civil na data do evento para o snapshot.
   - Geração e verificação matemática de tokens TOTP e rotação de chaves.
2. **Testes de Integração com PostgreSQL Real:**
   - **Regra do Projeto:** Testes de concorrência e integridade referencial **não serão feitos com mocks**, mas sim contra uma instância real de PostgreSQL (container de teste ou banco de teste dedicado no Neon).
   - Validação de migrações Drizzle Kit aplicadas do zero.
   - Validação de constraints de unicidade (`email` em minúsculas e nomes de jogos case-insensitive).
   - **Teste de Sessão Única e Revogação Imediata:** Simulação de dois logins simultâneos e verificação de que o primeiro é rejeitado no instante seguinte.
   - **Teste de Detecção de Reuso de Refresh Token:** Envio proposital de token antigo rotacionado e verificação da revogação imediata da sessão.
3. **Testes Ponta a Ponta (E2E / API):**
   - Cadastro completo de usuário -> Login -> Preenchimento do Questionário (3 etapas) -> Consulta do Perfil -> Logout.
   - Solicitação de redefinição de senha -> Troca de senha -> Tentativa de uso de tokens antigos -> Confirmação de revogação de todas as sessões.
   - Tentativa de concessão de papel privilegiado para conta sem e-mail verificado (esperando `400 Bad Request`).

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
# Utilizar o endpoint com pooling (porta 5432) fornecido pelo painel do Neon
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

### 12.3 Configuração de Conexão com o Neon e Limites do Plano Gratuito
- **Connection Pooling Mandatório:** O plano gratuito do Neon possui limite de conexões ativas simultâneas. Portanto, a aplicação configurará o driver `pg` para conectar através da string de conexão com **Pooler (PgBouncer)** do Neon, limitando o pool local da aplicação NestJS a um tamanho adequado:
  ```typescript
  import { Pool } from 'pg';
  import { drizzle } from 'drizzle-orm/node-postgres';
  import * as schema from './schema';

  export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10, // Adequado para manter-se folgadamente dentro das cotas do Neon Free
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false }
  });

  export const db = drizzle(pool, { schema });
  ```
- **Execução de Migrações:** Para operações de DDL via Drizzle Kit (`drizzle-kit migrate`), deve-se utilizar a `DATABASE_DIRECT_URL` (conexão direta sem PgBouncer), pois certas instruções transacionais de esquema exigem conexão não multiplexada.

### 12.4 Comandos Previstos para o Backend
```bash
# Instalação limpa
npm ci

# Geração de arquivos SQL de migração a partir dos schemas TypeScript
npm run db:generate

# Aplicação das migrações SQL no banco Neon
npm run db:migrate

# Execução em modo de desenvolvimento com hot-reload
npm run start:dev

# Execução da suíte de testes
npm run test           # Unitários
npm run test:integration # Integração com banco real
npm run test:e2e       # Ponta a ponta
```

---

## 13. Quadro Consolidado de Decisões Técnicas

Para assegurar total transparência e alinhamento com a equipe, as decisões de projeto estão categorizadas abaixo em três blocos bem definidos:

### 13.1 Decisões Já Aprovadas pelo Projeto (Requisitos Fixos)
1. **Stack Central:** Node.js + TypeScript + NestJS com adaptador padrão Express em Monólito Modular.
2. **Banco de Dados:** PostgreSQL com preferência por hospedagem no Neon (plano gratuito condicionado a cotas).
3. **ORM & Migrações:** Drizzle ORM com driver `pg` e migrações SQL versionadas via Drizzle Kit.
4. **Perfis & Permissões:** Três perfis (Participante, Staff por evento, Admin global); permissões cumulativas; Staff e Admin exigem e-mail confirmado prévio; alterações auditadas; revogação de efeitos imediatos.
5. **Autenticação:** Login por e-mail e senha (mínimo de 8 caracteres, sem obrigatoriedade de maiúsculas/símbolos, bloqueio de senhas comuns).
6. **Sessões:** Access token de 15 minutos; sessão máxima de 30 dias (renovação não prolonga o teto); exatamente uma sessão ativa por conta com revogação imediata da anterior em novo login; logout revoga sessão.
7. **Recuperação de Senha:** Link com token único válido por 30 minutos; limite de 1 requisição a cada 2 min por conta e 5 por hora; redefinição revoga todas as sessões; respostas opacas sem revelar existência de conta.
8. **Questionário:** Pertence ao usuário autenticado e permite atualização; jogos catalogados e adicionados manualmente sem duplicidades; data de nascimento armazenada como tipo SQL `DATE` sem conversão de timezone; snapshots imutáveis vinculados a participações futuras.
9. **Administração:** Admin exige 2FA por TOTP com backup codes; primeiro Admin criado via comando restrito de backend; exigência de ao menos dois Admins ativos antes de eventos reais.

### 13.2 Decisões Técnicas Propostas pelo Kaled
1. **Algoritmo de Hash:** Adoção de **Argon2id** (`@node-rs/argon2`) com parâmetros OWASP (64 MB de memória, 3 iterações, 4 threads), com fallback para bcrypt (cost 12) caso a memória da VPS/free tier seja insuficiente.
2. **Estratégia de Validação Imediata de Sessão:** Inclusão do `sid` (Session ID) no payload do JWT e checagem indexada na tabela `sessions` (< 1ms), dispensando o custo operacional de manter Redis em infraestrutura gratuita.
3. **Armazenamento de Refresh Tokens:** Gravação estrita do hash `SHA-256` na tabela de sessões, garantindo que mesmo em caso de vazamento do banco o token permaneça inacessível.
4. **Provedor de E-mail Transacional:** Adoção do **Resend** pelo SDK limpo e cota gratuita suficiente para suportar as fases iniciais com taxa de entrega comprovada.
5. **Unicidade de Jogos:** Criação de índice único funcional `LOWER(TRIM(name))` no PostgreSQL para assegurar deduplicação sem risco de concorrência.
6. **Armazenamento Móvel:** Utilização do `expo-secure-store` para proteção de credenciais no Keychain (iOS) e Keystore (Android).

### 13.3 Pendências Submetidas à Aprovação da Equipe
1. **Domínio de E-mail para Envio:** Definir se a equipe já possui domínio próprio para configurar os registros DNS (SPF, DKIM) no Resend, ou se utilizaremos subdomínio de teste provisório durante a homologação.
2. **Esquema de Redirecionamento da Recuperação de Senha (Deep Link vs. Web):**
   - *Opção A (Recomendada):* O link no e-mail direciona para uma página web simples responsiva (`https://app.arenago.com.br/redefinir-senha?token=...`) que efetua a chamada à API.
   - *Opção B:* O link utiliza Deep Link universal direcionando diretamente para o aplicativo móvel (`arenago://reset-password?token=...`).
3. **Termos de Uso e Política de Privacidade na Criação da Conta (LGPD):** Definir o texto e a obrigatoriedade do checkbox de consentimento de tratamento de dados no cadastro de novos participantes.
4. **Política de Retenção de Tokens Expirados:** Definição de rotina periódica (cron job) para expurgo no banco de tokens de recuperação e sessões revogadas há mais de 60 dias.

---

## 14. Próximos Passos Pós-Aprovação

Com a aprovação formal desta arquitetura pela equipe:
1. Criação do diretório do backend (`backend/`) e inicialização do projeto NestJS.
2. Configuração do TypeScript, ESLint, Prettier e Drizzle Kit.
3. Definição dos schemas Drizzle e geração da primeira migração SQL (`0001_initial_schema.sql`).
4. Provisionamento do banco de teste no Neon e validação da conexão com pooling.
5. Implementação incremental e orientada a testes dos módulos de Sessões, Usuários, Autenticação, Perfil e Questionário.
6. Integração com o aplicativo móvel Expo sem alteração das regras de negócio do frontend.
