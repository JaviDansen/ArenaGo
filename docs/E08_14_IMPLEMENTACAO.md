# E08.14 — Controle operacional da fila interna por experiência

## Preparação e escopo

Implementação na branch `feature/events-participations`, base inicial
`3f191d96b31380fac78ee2e26eb2d69ad57a7f95`
(`feat(events): implementar configuração administrativa da Arena`). Conferidos
branch, HEAD, índice, working tree e arquivos não rastreados antes das edições:
E08.13 commitada, árvore e índice limpos. Snapshot inicial em
`%TEMP%/arenago-e0814-before-G5Ptp4/snapshot.json`.

Consultados AGENTS.md, arquitetura §§16/18/20, planejamento D01/D04/D05/D07/D09
e C-13/C-14/C-15, relatórios E07.1–E07.6/E08.1–E08.13, schema/migrações e os
serviços correspondentes. A rota ainda não existia. As guardas de ingresso,
resolução, ausência e os três GETs já usavam a flag ou sua semântica efetiva;
não foi necessário alterar esses serviços ou respostas públicas anteriores.

Base aprovada anteriormente pelo responsável: 722 unitários e 1.029 PostgreSQL,
além de typecheck/lint/build. Não representam aprovação antecipada desta task.
Sem mudanças de schema, migrações, dependências, fixtures compartilhadas ou
evidências históricas.

## Contrato HTTP e permissões

`PATCH /api/v1/staff/events/:eventId/experiences/:experienceId/queue`

Bearer, sessão válida e `Idempotency-Key` obrigatórios. Corpo JSON estrito:

```json
{ "acceptingEntries": false }
```

`true` solicita reabertura. Ausência, null, strings, números, arrays, campos
extras e identidades/reason/timestamps do cliente são rejeitados. Os dois IDs
são UUIDs validados e normalizados; a experiência deve pertencer ao evento.
Ator e sessão vêm exclusivamente do principal autenticado; query/JWT não
substituem a verificação atual de concessões no PostgreSQL.

**Decisão expressa aprovada pelo responsável:** esta rota admite Staff apto do
evento **ou Admin global**. Supera a lacuna de ownership da arquitetura §18.2.
Não amplia permissões nas rotas Staff de chamar, concluir, ausentar ou consultar.

| Ator | Requisitos revalidados no banco |
| --- | --- |
| Staff | Conta ativa, e-mail verificado, concessão Staff vigente para o evento e sessão própria vigente/não revogada |
| Admin global | Conta ativa, concessão global vigente, sessão própria vigente e 2FA confirmado; sem concessão Staff adicional |
| Admin também Staff | Continua exigindo 2FA; não há fallback para fugir do segundo fator |

Autorização dual segue os mesmos predicados e ordem da E08.5. Os helpers somente
Admin não foram aplicados a Staff, pois exigiriam um papel adicional indevido;
os serviços anteriores foram preservados. Conta, concessões e sessão são
protegidas por locks e a validade temporal da sessão é consultada novamente
depois das esperas/reserva e antes do commit/replay.

HTTP 200 com mudança efetiva:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "experienceId": "550e8400-e29b-41d4-a716-446655440301",
  "queueAcceptingEntries": false,
  "changedAt": "2026-11-04T15:00:00.123456Z"
}
```

Em no-op, omite `changedAt`; não inventa um instante de alteração. O campo
`queueAcceptingEntries` é configuração persistida, **não** autorização efetiva
para novas entradas. Replay mantém exatamente a resposta histórica: o cliente
deve consultar os GETs atuais para observar decisões posteriores.

| Situação | HTTP / código RFC 7807 |
| --- | --- |
| IDs/corpo/chave inválidos | 400 `VALIDATION_ERROR` |
| JSON inválido/primitivo rejeitado pelo parser | 400 `BAD_REQUEST` |
| Bearer/sessão ausente ou inválida | 401, códigos existentes de autenticação |
| Conta inativa | 401 `ACCOUNT_DEACTIVATED` |
| Sessão revogada/expirada | 401 `SESSION_REVOKED` / `SESSION_EXPIRED` |
| Admin sem confirmação de 2FA | 401 `ADMIN_2FA_REQUIRED` |
| Recurso ausente, cadeia errada ou sem concessão apta | 404 `RESOURCE_NOT_FOUND` indistinguível, padrão dual E08.5 |
| Mudança efetiva após encerramento definitivo | 409 `EVENT_OPERATION_ENDED` |
| Mesma chave com outra intenção/recurso | 409 `IDEMPOTENCY_KEY_REUSED` |
| Intenção persistida em andamento | 409 `IDEMPOTENCY_IN_PROGRESS` |
| Erro interno/integridade | 500 `INTERNAL_SERVER_ERROR` |

## Efeitos, pausa e reabertura

Uma mudança efetiva altera somente `experiences.queue_accepting_entries` e seu
`updated_at`, além dos registros técnicos de auditoria/idempotência. Preserva
`last_queue_order`, FIFO, posições, waiting/called, ponteiros de participação,
pending, disponibilidade de estações, fila externa, participações e avaliações.
Não exige ausência de histórico e não é um PATCH estrutural E08.13.

Pausa bloqueia novos ingressos E07.1/E08.2 apenas nessa experiência. Esperas e
chamadas existentes continuam consultáveis e podem ser chamadas/resolvidas,
conforme suas próprias permissões e prazos. Complete/absent, C-15, saída da Arena,
Admin e job mantêm seus contratos. Ausência durante pausa resolve a ocorrência
sem nova entrada FIFO, conforme o predicado já presente na E07.6.

Reabertura não cria entradas, não reinicia contadores e não reativa tentativas.
Não altera estação, fila externa ou estado Admin. Novos ingressos ainda exigem
participação active própria, ausência de outra fila corrente, cadeia correta,
prontidão/Staff apto, estação disponível na experiência, início e cortes válidos.
Outra experiência apta segue funcionando independentemente desta flag.

Os GETs Staff, participante e Admin refletem a alteração sem modificações:

- GET Staff de queue combina a flag em `acceptingNewEntries`, mas preserva
  `canCallWaitingEntries`, `waitingCount` e `firstWaitingQueueEntryId` residuais.
- GET participante de experiências combina a flag em `acceptingNewQueueEntries`.
- GET Admin de experiências expõe `queueAcceptingEntries` persistido.

Prontidão global C-05/C-14 não depende de pausar a entrada: capacidade é estação
available e Staff apto. Não houve mudança no cálculo global, novas consultas N+1
ou campo redundante de ocupação/fila por estação.

## Tempo, locks e consistência

Transação `READ COMMITTED`, ordem: evento `FOR UPDATE` → experiência `FOR UPDATE`
→ conta `FOR SHARE` → concessões vigentes ordenadas `FOR SHARE` → sessão
`FOR SHARE`. O mutex do evento é o padrão de configuração operacional E08.5 e
conflita corretamente com ingresso/chamada/resolução e encerramentos existentes.
Não são adquiridos locks de participação/fila/estação em ordem inversa.

Após os locks, revalidam-se pertencimento, papel, sessão, flag e intenção. O
UPDATE decisivo usa um `clock_timestamp()` materializado no próprio comando,
posterior a todas as esperas. Reutiliza `effectiveEventDeadline()` da E08.9:
`LEAST(operational_deadline_at, admin_deadline_at)`. Mudança exige evento não
closed e instante estritamente anterior ao prazo definitivo, além da sessão
válida e 2FA quando Admin. Não usa relógio do aparelho/JavaScript para negócio.

Configuração é permitida antes do início e durante a janela residual após corte
oficial/fechamento controlado, mas não libera novos ingressos após esses cortes.
No instante exato do prazo definitivo a mudança é recusada. Fechamento imediato
ou estado closed também recusam. Histórico, perda de capacidade ou fila pausada
não são bloqueios adicionais para configurar a flag durante prazo válido.

Mesmo valor já persistido é no-op, inclusive após fechamento/prazo. Não faz UPDATE
da experiência, não muda `updated_at`, não audita; conclui somente a nova intenção.
Isso não autoriza uma mudança real após o corte.

Se ingresso vencer, sua entrada permanece; se pausa vencer, o ingresso posterior
recebe fila fechada. Chamada/conclusão/ausência/C-15/saída se serializam no protocolo
existente. Ausência que vencer antes da pausa pode criar sua reentrada legítima;
se a pausa vencer, não cria. Encerramento que vencer impede mudança efetiva da
flag, sem sobrescrever seus motivos nem fabricar ausência/conclusão.

## Idempotência durável e auditoria

Escolhida idempotência **durável por chave**, em vez da natural E08.5. Patch por
estado desejado sem memória permitiria que um retry antigo de pausa desfizesse
uma reabertura posterior. A reserva existente resolve esse risco sem nova tabela.

Namespace estável `set_experience_queue_acceptance`; fingerprint com versão,
evento, experiência e booleano desejado; ator na chave única existente. Mesmo
ator/chave/intenção devolve histórico, inclusive quando a flag atual mudou ou o
TTL venceu. Outra intenção/recurso conflita. Operadores distintos não compartilham
resultados. `in_progress` preexistente conflita, sem reexecução por expiração.

Reutilizado `STAFF_IDEMPOTENCY_TTL_SECONDS` para esta rota operacional, também
quando o operador é Admin. Não há novo TTL ou fallback; a escolha é por operação,
não por papel. Os quatro TTLs obrigatórios da aplicação continuam necessários.
`Date.now()` aparece apenas no helper existente de expiração técnica, nunca nos
cortes de negócio. Não há expurgo ou política nova de retenção.

Auditoria somente em mudança efetiva: categoria `experience`, ação
`experience_queue_acceptance_changed`, ator, evento, experiência, booleanos antes/
depois e instante copiado de `experiences.updated_at` no PostgreSQL. Não há motivo
humano inventado, dado de participante ou texto de fila no registro. UPDATE,
auditoria e intenção comitam ou revertem juntos. Contagens/DTO histórico são
verificados; no-op, replay e recusa não duplicam auditoria.

Sessão é revalidada depois do UPDATE e antes do commit. Falha/expiração tardia
reverte também o efeito e a reserva. Erro inesperado usa mensagem constante
`EXPERIENCE_QUEUE_CONTROL_INTERNAL_ERROR`, com causa interna preservada e filtro
HTTP existente sem exposição de SQL ou identidades pessoais.

## Arquivos

| Arquivo | Alteração |
| --- | --- |
| `backend/src/events/experience-queue-control.dto.ts` | DTOs estritos de entrada e resposta/replay |
| `backend/src/events/experience-queue-control.controller.ts` | PATCH, identidade, validação, TTL e erros |
| `backend/src/events/experience-queue-control.service.ts` | Autorização dual, locks, UPDATE decisivo, auditoria e idempotência |
| `backend/src/events/events.module.ts` | Registro e exportação dos novos componentes |
| `backend/test/unit/experience-queue-control.test.ts` | 35 testes de DTO/serviço/SQL |
| `backend/test/unit/experience-queue-control-http.test.ts` | 20 HTTP simulados e DI sem conexão |
| `backend/test/integration/experience-queue-control.integration.test.ts` | 99 testes PostgreSQL preparados |
| `backend/test/integration/profile-games.integration.test.ts` | Fixture K03-F.1 isola/restaura todas as versões |
| `backend/test/unit/k03-cleanup.unit.test.ts` | Robustez do cleanup do catálogo completo |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | Atualizações pontuais de §§16.2, 18.2 e 20.4 |
| `docs/E08_14_IMPLEMENTACAO.md` | Este relatório |

Nenhum serviço de produção ou fixture compartilhada foi alterado. O único teste
anterior ajustado é a preparação do cenário histórico K03-F.1 descrita acima.

## Verificações executadas pelo Codex

| Verificação | Resultado |
| --- | --- |
| Específicos | **55/55 aprovados**, sendo 35 serviço/DTO/SQL e 20 HTTP simulados |
| Regressão unitária completa | **777/777 aprovados**, 0 falhas, cancelamentos ou skips |
| Typecheck produção/testes | Aprovado (`npm.cmd run typecheck:test`) |
| Lint | Aprovado |
| Build | Aprovado |

Os 55 novos unitários somam-se aos 722 anteriores. Execução usou dotenv desativado
e URL local inoperante; DI real verificou zero conexões. Não houve execução de
PostgreSQL real pelo Codex, solicitação de credenciais ou validação de produção.

### Validação PostgreSQL manual concluída

**99 testes novos**, contados estaticamente pela AST sem executar o arquivo.
O responsável confirmou a regressão completa: **1.128/1.128 aprovados**, zero
falhas, cancelamentos ou ignorados, código de saída zero. Os 99 testes novos da
E08.14 estão incluídos nesse total; não foi informado um total isolado da suíte
focada. A suíte histórica corrigida `profile-games.integration.test.ts` também
passou: **23/23**, incluindo K03-F.1, código de saída zero. PostgreSQL foi
executado manualmente pelo responsável, não pelo Codex.

Os testes novos usam guardas locais e fixtures reais, sem substituição por mocks.

Cobrem Staff/Admin, 2FA inclusive com Staff acumulado, conta/e-mail/concessão e
sessão, entrada estrita/cadeia, pausa/reabertura, no-op com xmin, histórico,
isolamento, três GETs, chamada/resoluções durante pausa, ausência sem reentrada,
avaliações/elegibilidade, capacidade e cortes. As duas ordens das concorrências
incluem ingresso/reabertura, chamada, complete, absent, C-15, saída, estação,
Admin imediato, job, dois operadores e revogação de papéis.

Usam transações/conexões independentes e `pg_blocking_pids`. Um helper local
retém o lock da primeira operação mesmo se ela terminar em recusa/rollback, para
cobrir ingresso que observa fila fechada antes da reabertura. Snapshot Staff é
mantido durante pausa real. Há espera que atravessa corte e expiração durante
lock de sessão, além de perda de autorização/2FA enquanto espera.

Seis bordas de ±1 microssegundo/no instante exato exercitam o mesmo UPDATE
decisório com expressão de relógio SQL interna ao helper; HTTP/serviço de produção
nunca recebem esse relógio alternativo. Essas transações são revertidas após as
asserções para não deixar UPDATE sem auditoria. Os demais cenários HTTP exercitam
a composição completa. Oito falhas SQL reais preparadas, após reserva/UPDATE/
auditoria/conclusão para Staff/Admin, executam o SQL nativo antes de `SELECT 1/0`
na mesma conexão e verificam rollback integral e retry.

Comandos usados para a execução manual (podem ser repetidos pelo responsável):

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_DIRECT_URL = $env:DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/profile-games.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Falha na suíte histórica K03-F' }
```

Preencher as credenciais somente localmente. Este comando não executa a regressão
completa.

### Diagnóstico posterior da regressão PostgreSQL

Na execução inicial, o responsável informou regressão de **1.128 testes: 1.126
aprovados, 2 falhas contabilizadas, zero cancelamentos/ignorados**. O erro foi reproduzido também na
execução isolada de `profile-games.integration.test.ts` (**23 contabilizados,
21 aprovados, 2 falhas**, teste filho K03-F.1 e seu agrupamento): ao salvar o
questionário, a resposta observada foi HTTP 200 em vez do 422 esperado. O Codex
não acessou o PostgreSQL e não executou essas suítes.

A causa é a preparação incompleta do teste histórico K03-F.1, não uma falha
funcional confirmada da E08.14. O teste verificava que somente `1.0.0` tinha
`activated_at = NULL`, mas `resolvePublishedQuestionnaireVersionId()` seleciona
qualquer versão ativa. A gravação retorna 200 quando encontra outra versão ativa;
portanto o resultado observado implica que uma existia naquele momento. O schema
permite múltiplas versões ativas e não tem exclusividade por `activated_at`.
O teste não identifica qual versão; seu pressuposto de catálogo global sem versão
ativa dependia do estado residual do banco e das execuções anteriores.

A inicialização foi inspecionada: `seedPublishedQuestionnaireVersion()` usa
`ON CONFLICT (version) DO NOTHING` e depois apenas lê a versão existente. Não
reativa `1.0.0`. O endpoint lança 422 `QUESTIONNAIRE_VERSION_UNAVAILABLE` somente
quando não encontra versão ativa e já existe ao menos uma versão no catálogo.
Imediatamente antes da requisição, o teste já havia confirmado `1.0.0` inativa.
K03-F.1 foi introduzido em `00cfbc13`; os contratos de publicação e a regra 422
permanecem coerentes. A E08.14 não modifica o módulo Profile, serviço, schema,
migrações ou seed; seus testes de integração usam versões próprias e a fixture
compartilhada registra os IDs para removê-los no cleanup. Não há evidência que
atribua a falha a uma mudança de produção E08.14.

Correção pontual da fixture: capturar IDs e timestamps originais de todo o
catálogo, desativar temporariamente todas as versões ativas, verificar após
`onModuleInit()` que nenhuma foi reativada e então preservar a expectativa HTTP
422/código. O `finally` restaura os timestamps originais por ID, inclusive os
valores nulos. A regra de produção e as asserções do contrato não foram alteradas.
O teste unitário de robustez do cleanup K03-F.1 foi alinhado à restauração do
catálogo completo. Na validação final, o responsável confirmou 23/23 nessa suíte
e 1.128/1.128 na regressão completa. A expectativa 422 passou sem alterações na
regra de produção.

Validação local após a correção da fixture: **7/7** testes unitários K03-F,
typecheck, lint e build aprovados. PostgreSQL não foi executado pelo Codex; a
regressão unitária completa não foi repetida nesta investigação.

Limites técnicos: a configuração usa mutex exclusivo do evento, serializando
mutações durante a curta transação; não há teste de carga ou promessa de
throughput. Concessão/revogação concorrente é preparada por SQL transacional sob
o mutex do evento, pois os endpoints de papéis ausentes já foram registrados na
E08.13; não foram implementados novos endpoints de permissões nesta task.
Retenção/expurgo e reconciliação visual de uma resposta histórica são dependências
dos blocos correspondentes; os GETs atuais fornecem a observação mais recente.

### Comandos PowerShell da execução manual

Banco local descartável já preparado com as migrações. Guardas exigem três URLs
idênticas, `NODE_ENV=test`, host `127.0.0.1`, porta `55432` e
`arenago_events_test`, sem redirecionamentos. Preencher placeholders apenas na
sessão do responsável; não compartilhar nem gravar credenciais no repositório.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:EVENT_CLOSURE_INTERVAL_MS = '30000'

# Suíte focada E08.14; total isolado não informado pelo responsável.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/experience-queue-control.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Falha na integração PostgreSQL E08.14' }

# Regressão completa; o resultado manual final registrado acima foi 1.128/1.128.
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Falha na regressão PostgreSQL completa' }
```

## Evidência e estado final

Único patch: `qa-evidence/e08-14-changes.diff`, completo dos **11 arquivos** acima,
incluindo sete novos, contra a base inicial `3f191d9`. UTF-8 sem BOM, caminhos
relativos e cabeçalhos `diff --git`, compatível com `git apply`. Aplicação verificada
em cópia isolada da base, com comparação integral dos onze arquivos finais,
normalizando somente CRLF/LF conforme Git. Sem omissões/divergências, credenciais,
`.env`, dependências instaladas, temporários, outros `.diff` ou mudanças alheias.
HEAD, índice e evidências históricas preservados.

Pendências de validação da E08.14: nenhuma. Resta somente revisão e versionamento
manual pelo responsável.
Sugestão sem execução: `feat(events): implementar controle operacional da fila por experiência`.

Nenhum add, commit, push, merge ou rebase. E08.15 não iniciada. Sem auditoria
geral da E08, Expo, BI, notificações, implantação, fila por estação ou cancelamento
em massa ao pausar.
