# T6.1-A1 — Núcleo interno de verificação de e-mail

## Estado e base

Implementação e validação PostgreSQL manual **aprovadas**.
Base original da implementação: `57ff480478b79c42fe4a2cdc6a96a7018516abcf`.
Base da evidência final: `f48ba31ca9027378aee61dcd51eada3adb6a28ad`,
branch `feature/events-participations`, após o commit independente do `AGENTS.md`.
Índice e histórico preservados.

Esta etapa disponibiliza apenas um serviço interno no AuthModule. O usuário final
**ainda não dispõe de verificação de e-mail**: não há endpoints, envio de mensagens
ou mudanças no Expo. Cadastro/login existentes continuam permitindo participantes
sem verificação. Verificar e-mail não concede Staff/Admin nem substitui TOTP.

## Contrato interno

`EmailVerificationService`, exportado pelo `AuthModule`, recebe o pool existente
por `POSTGRES_POOL` e a política por injeção explícita compatível com Nest/tsx.

| Método | Entrada | Resultado |
| --- | --- | --- |
| `issue(userId)` | UUID da conta selecionada pelo chamador interno confiável | `issued` com `token`, `email` atual e `expiresAt` em texto PostgreSQL; ou `account_unavailable`, `already_verified`, `cooldown`, `rate_limited` |
| `confirm(token)` | Apenas o token opaco; não aceita identidade, e-mail ou horário | `verified` ou `invalid_token` |

Conta inexistente/inativa não recebe token. Conta já verificada retorna
`already_verified`, sem inserir ou invalidar registros. Na confirmação, formato
inválido, hash inexistente, conta ausente/inativa/já verificada, e-mail antigo,
token expirado, consumido ou substituído recebem o mesmo resultado
`invalid_token`. Falhas de infraestrutura provocam rollback e são propagadas,
sem converter erro SQL em sucesso ou recusa funcional.

O token bruto só é entregue ao chamador interno após COMMIT. Não é resposta HTTP.
As APIs futuras devem autenticar/autorizar a solicitação e definir respostas
públicas que não exponham a existência ou o estado de outra conta.

## Políticas aprovadas e configuração

Configuração central em `email-verification.policy.ts`, lida do ambiente ao criar
o provider, com valores padrão que mantêm os módulos existentes operacionais:

| Variável | Padrão |
| --- | --- |
| `EMAIL_VERIFICATION_TTL_SECONDS` | `86400` (24 horas) |
| `EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS` | `120` (2 minutos) |
| `EMAIL_VERIFICATION_MAX_PER_HOUR` | `5` |

Somente inteiros decimais positivos até 2147483647, limite técnico do inteiro SQL.
Vazio, whitespace, sinal negativo, zero, decimal, notação exponencial, infinito e
valores fora do intervalo são rejeitados sem reproduzir o valor recebido no erro.
A política é imutável após inicialização e não usa parâmetros enviados pelo cliente.
Instâncias do serviço devem usar a mesma configuração.

As decisões temporais usam `clock_timestamp()` no PostgreSQL após os locks.
Cooldown bloqueia quando existe emissão com `created_at > decisão - cooldown`.
A janela móvel conta **todas** as emissões com
`created_at > decisão - interval '1 hour'`, incluindo a primeira, substituídas,
consumidas e expiradas. No limite exato, uma emissão antiga sai da janela.
Se cooldown e limite horário forem atingidos juntos, o resultado é `cooldown`.
Quando o cooldown termina, o limite por hora continua sendo aplicado.

A política futura de recuperação de senha foi aprovada com TTL de **30 minutos**;
não há implementação de recuperação nesta etapa.

## Diagnóstico do schema e retenção

Conferidos `access.schema.ts` e `0003_credentials_roles.sql`.
`email_verification_tokens` já tem UUID, usuário, e-mail, hash único, criação,
expiração e `verified_at`. Não foi necessária alteração de schema ou migration.

Substituição antecipa `expires_at` para o instante da decisão apenas em tokens
não consumidos cuja validade ainda está aberta. `verified_at` permanece NULL
nesses registros: não se registra falsamente uma confirmação. Na confirmação,
`verified_at` marca exclusivamente o consumo do token apresentado.

Nenhum token é apagado. `created_at` permanece intacto e sustenta a contagem,
inclusive quando todos os tokens recentes foram invalidados. Um expurgo futuro
deve preservar pelo menos os registros necessários à maior janela configurada
(cooldown e uma hora) e a política de retenção ainda a definir. A invalidação por
expiração antecipada não distingue historicamente “substituído” de “expirado”;
essa distinção não é necessária para o contrato interno seguro.

## Transações, concorrência e relógio

Cada operação abre uma transação READ COMMITTED em uma conexão do pool:

1. Na confirmação, localizar o usuário pelo hash sem lock, apenas para descoberta.
2. Bloquear a conta com `users FOR UPDATE`.
3. Bloquear os tokens daquela conta por ID em ordem determinística, `FOR UPDATE`.
4. Revalidar conta/endereço/token/limites e consultar o relógio após as esperas.
5. Gravar os efeitos e efetivar COMMIT; qualquer falha causa ROLLBACK e release.

A ordem usuário → tokens é compatível com o AuthService, que inicia seus
bloqueios pela conta. Não há lock global nem aquisição de eventos, sessões ou
papéis. Contas diferentes podem prosseguir independentemente.

Na emissão, a decisão PostgreSQL é transportada como texto timestamptz, preservando
microssegundos; expiração é calculada no INSERT por intervalo SQL. Na confirmação,
o UPDATE decisivo exige hash/conta/endereço atual, conta ativa não verificada,
token não consumido e `expires_at > clock_timestamp()`. O instante retornado é
copiado exatamente para `email_verified_at` e `updated_at`, e outros tokens
utilizáveis são invalidados na mesma transação.

Emissão concorrente à confirmação tem duas ordens legítimas: se reemissão comitar
primeiro, o token antigo é recusado; se confirmação comitar primeiro, nova emissão
retorna `already_verified`. Duas confirmações não consomem duas vezes. O mutex de
usuário também serializa limites de emissões concorrentes.

A validade corresponde ao instante decisivo após locks, não à recepção HTTP futura
nem ao instante físico do COMMIT. Nenhuma tolerância de expiração é adicionada.
Escritores futuros de e-mail e expurgo devem respeitar a ordem de locks e a retenção.

## Proteção e limites

- Token aleatório nativo Node.js de 32 bytes (256 bits), base64url canônico de 43
  caracteres; validação de tipo, tamanho, alfabeto e representação canônica.
- Persistência exclusiva de SHA-256 hexadecimal; sem JWT ou segredo compartilhado.
- Token bruto não é parâmetro SQL, não é gravado em logs/auditoria e não é retornado
  por nenhum controller. Não há serviço de envio fictício.
- Sessões, refresh tokens, concessões e regras E07/E08 permanecem intactos.
- O pool é compartilhado; o serviço não encerra o pool nem abre outro banco.
- Não existe expurgo, garantia de entrega, provedor, interface pública ou proteção
  completa contra abuso distribuído nesta etapa. A tabela não tem índice por
  usuário/criação; avaliar desempenho e retenção antes de produção, sem migração
  preventiva aqui.
- Se o COMMIT tiver resultado desconhecido por perda de conexão, não se promete
  reentrega do mesmo token bruto; uma nova solicitação deve respeitar os limites.

## Cobertura e resultados

| Verificação executada pelo Codex | Resultado |
| --- | --- |
| Unitários focados, tsconfig.test | **32/32 aprovados** |
| Regressão unitária `npm.cmd test` | **1024/1024 aprovados**, 992 anteriores + 32 novos |
| Typecheck produção: `tsc --project tsconfig.build.json --noEmit --incremental false` | Aprovado |
| Typecheck testes: `npm.cmd run typecheck:test` | Aprovado |
| `npm.cmd run lint` | Aprovado |
| `npm.cmd run build` | Aprovado |
| PostgreSQL específico | **25/25 aprovados manualmente pelo responsável**, zero falhas, cancelados ou ignorados; exit code 0 |
| Regressão PostgreSQL completa | **1.254/1.254 aprovados manualmente pelo responsável**, zero falhas, cancelados ou ignorados; exit code 0; 612334.9898 ms |

Zero falhas, cancelamentos ou ignorados nas execuções locais aprovadas.
A primeira tentativa de tsx na sandbox falhou antes dos testes com
`uv_os_get_passwd/ENOMEM`; execução autorizada fora da sandbox passou, com
`DOTENV_CONFIG_PATH=NUL` e URL fictícia sem banco real.

Os unitários, typechecks, lint e build acima foram executados pelo Codex durante a
implementação original, antes da política atual do `AGENTS.md`. Não foram
reexecutados nesta consolidação e não são execuções manuais do responsável. O
PostgreSQL real foi executado exclusivamente pelo responsável. Esses resultados
validam o ambiente de desenvolvimento/testes; não constituem homologação ou
prontidão de produção.

Os unitários cobrem política, formato/hash, respostas internas, parâmetros SQL,
retenção, ordem de escrita, falhas/rollback/release, não exposição em logs e DI
real do Nest sem conexão. Os testes de SQL simulado não certificam semântica,
concorrência ou integridade PostgreSQL; essas provas pertencem à suíte abaixo.

## Matriz PostgreSQL aprovada — 25 testes

`backend/test/integration/email-verification.integration.test.ts` utiliza serviços
reais e conexões independentes. Reutiliza a guarda A04 antes de criar pools:
três URLs idênticas, credenciais presentes, sem query/fragmento e exclusivamente
`127.0.0.1:55432/arenago_events_test`. Não executa seed ou migrations.

Cobertura: emissão/hash/TTL padrão e customizado; cooldown; substituição sem
exclusão; sexta emissão; janela móvel com usados/expirados; duas emissões
simultâneas e disputa da quinta; confirmação/precisão/consumo único; duas
confirmações simultâneas; reemissão versus confirmação nas duas ordens; token
expirado/usado/endereço antigo/conta inativa; formato e conta/token inexistentes;
conta já verificada; isolamento entre usuários; expiração e inatividade alteradas
durante espera por lock; três falhas SQL reais após escritas com rollback integral
e retry; preservação de sessões, refresh e papéis.

A sobreposição é comprovada por `pg_stat_activity` e `pg_blocking_pids`, com
timeout, antes de liberar o bloqueio. A instrumentação de falha executa primeiro
o SQL real do serviço e depois `SELECT 1/0` na mesma transação. Não há mocks de
resultado PostgreSQL. A limpeza afeta somente UUIDs criados pela própria suíte.
Fixtures temporais envelhecem somente seus próprios registros para testar limites
sem aguardar horas.

Resultado definitivo da regressão: **1.254/1.254 aprovados**, correspondendo aos
1.229 testes anteriores mais os 25 testes novos desta etapa. A execução manual
terminou com exit code 0, sem falhas, cancelamentos ou ignorados.

## Comandos PowerShell para o responsável

As três URLs devem estar configuradas localmente pelo responsável para o banco
autorizado, sem compartilhar ou registrar credenciais:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EMAIL_VERIFICATION_TTL_SECONDS = '86400'
$env:EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = '120'
$env:EMAIL_VERIFICATION_MAX_PER_HOUR = '5'
foreach ($name in @('DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name precisa estar configurada localmente."
  }
}
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/email-verification.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração focada falhou; investigar antes da regressão.' }
# Somente após aprovação focada:
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Regressão PostgreSQL falhou; preservar saída para investigação.' }
```

## Inventário e evidência

1. `backend/src/auth/auth.module.ts`
2. `backend/src/auth/email-verification.policy.ts`
3. `backend/src/auth/email-verification.service.ts`
4. `backend/test/unit/email-verification.test.ts`
5. `backend/test/integration/email-verification.integration.test.ts`
6. `docs/T6_1_A1_IMPLEMENTACAO.md`

Evidência única: `qa-evidence/t6-1-a1-changes.diff`, contendo os seis arquivos,
sem incluir a própria evidência. Aplicação validada em cópia isolada da base final e
comparação byte a byte dos **6/6 arquivos**, sem divergências. Sem alterações externas ao escopo,
schema, dependências, histórico ou índice.

## Pendências e T6.1-A2

A T6.1-A1 não possui pendências de validação. A T6.1-A2 deverá definir os contratos
HTTP, entrega real, política de erro/retry do distribuidor, proteção de respostas/logs e
limites de abuso na borda. Retenção e desempenho precisam de avaliação antes de
produção. Nenhuma decisão adicional de produto foi necessária para este núcleo.
Não houve implementação de recuperação, bootstrap, TOTP ou papéis nesta etapa.

Sugestão para versionamento manual após aprovação:
`feat(auth): implementar núcleo de verificação de e-mail`.
