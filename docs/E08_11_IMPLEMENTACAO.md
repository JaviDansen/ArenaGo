# E08.11 — Envio e edição de avaliações

## Estado e escopo

Implementação de POST e PATCH entregue conjuntamente na branch
`feature/events-participations`. Base inicial da evidência:
`4f130953ee1f5dc00cf6118c0e0383b17786c91e`, com a E08.10 já versionada,
working tree limpo, índice sem alterações e nenhum arquivo não rastreado.
Verificações e implementação realizadas em 04/11/2026.

O backend reutiliza o contrato de leitura da E08.10 e a infraestrutura durável
de idempotência existente. Não há migrações, novas dependências, tabelas ou
alterações nos serviços de produção E07.1–E07.6 e nas finalizações E08.8/E08.9.
A configuração de `EventsModule` registra os novos providers com injeção explícita.

## Contratos HTTP

Ambas as rotas usam o prefixo `/api/v1`, Bearer, sessão válida, identidade
autenticada, titularidade atual e `Idempotency-Key` válida de até 128 caracteres.
Staff e Admin não recebem acesso às avaliações de terceiros. Admin participante
segue a mesma titularidade e a verificação de 2FA já existente.

| Operação | Payload | Sucesso, inclusive replay |
| --- | --- | --- |
| `POST /participations/:participationId/evaluation` | `{"rating":5,"comment":"Experiência muito boa"}` | `201 Created` |
| `PATCH /evaluations/:evaluationId` | `{"rating":4}`, `{"comment":"Texto atualizado"}` ou ambos | `200 OK` |

DTOs estritos: nota inteira de 1 a 5, obrigatória no POST; ao menos um campo no
PATCH. Campos extras, identidade, permissões, estados e timestamps fornecidos
pelo cliente são rejeitados. Parâmetros de rota são UUIDs válidos; query strings
não fornecem identidade ou campos da intenção e são ignoradas.

A resposta é `{"evaluation":{...}}`, com exatamente o contrato `OwnEvaluation`
da E08.10: `id`, `participationId`, `rating`, `comment`, `submittedAt`, `updatedAt`,
`editableUntilAt`, `commentAddUntilAt` e `permissions` (`canEditRating`,
`canEditComment`, `canAddFirstComment`). Datas públicas preservam seis casas de
microssegundos em UTC. Não são expostos autor, perfil, sessão, intenção interna
ou `first_comment_at`.

| Falha | HTTP / código |
| --- | --- |
| Entrada, UUID ou chave inválida | `400 VALIDATION_ERROR`, conforme validação compartilhada |
| Sessão ausente, inválida, revogada ou 2FA exigido | `401`, conforme autenticação existente |
| Participação/avaliação ausente ou de terceiro | `404 RESOURCE_NOT_FOUND` indistinguível |
| Participação não elegível | `409 EVALUATION_NOT_ELIGIBLE` |
| Prazo do primeiro envio encerrado | `409 EVALUATION_SUBMISSION_EXPIRED` |
| Outra intenção já enviou a avaliação | `409 EVALUATION_ALREADY_SUBMITTED` |
| Edição não permitida na janela atual | `409 EVALUATION_EDIT_WINDOW_CLOSED` |
| Primeiro comentário tardio já utilizado | `409 COMMENT_ALREADY_ADDED` |
| Mesma chave com intenção diferente | `409 IDEMPOTENCY_KEY_REUSED` |
| Intenção durável preexistente em andamento | `409 IDEMPOTENCY_IN_PROGRESS` |
| Falha interna | `500`, pelo filtro RFC 7807 existente |

## Comentários e limite técnico

| Entrada | POST | PATCH |
| --- | --- | --- |
| Ausente | Grava `NULL` | Preserva o valor atual |
| `null`, `""` ou somente espaços/brancos | Grava `NULL` | Solicita remoção, permitida apenas na janela integral |
| Texto não vazio | Preserva integralmente | Substitui/adiciona conforme a janela |

O limite técnico de entrada é **2.000 pontos de código Unicode**, contado com
`Array.from`, uniformemente nas duas rotas. Emojis fora do BMP contam como um
ponto; caracteres combinantes contam separadamente. Não é contagem de grafemas.
Entradas acima do limite são rejeitadas, inclusive quando contêm apenas espaços.
NUL e surrogates isolados são rejeitados porque não representam texto UTF-8
armazenável pelo PostgreSQL. Não há truncamento silencioso.

Texto não vazio conserva espaços nas extremidades, acentos e conteúdo fornecido,
inclusive marcação como texto simples. Futuras interfaces devem escapar o texto
na exibição. Este limite de entrada não define a futura política de moderação,
que continua pendente de produto; não há detecção de PII ou moderação automática.

Comentários não entram em logs, auditorias ou mensagens de erro. Falhas internas
recebem mensagem constante `EVALUATION_WRITE_INTERNAL_ERROR`, com causa mantida
internamente; o filtro existente registra somente a mensagem, sem a causa.
A resposta própria, persistida para replay, contém o comentário por contrato.

## Elegibilidade e prazos exatos

O primeiro envio exige participação `finished` e ao menos uma sessão
`service_sessions.completed` real. Sessões ausentes/canceladas não contam;
participações `waiting`, `active` ou `canceled` não são elegíveis. Finalização
administrativa ou automática não dispensa a conclusão real.

O envio é permitido até `finished_at + interval '720 hours'`, inclusive.
Uma nova intenção após o prazo retorna `EVALUATION_SUBMISSION_EXPIRED`, mesmo
se já existir avaliação; dentro do prazo, a duplicidade retorna
`EVALUATION_ALREADY_SUBMITTED`. Replay histórico mantém a resposta original.
`UNIQUE(participation_id)` continua garantindo uma avaliação por participação.
Uma reentrada com outro `participationId` pode ter sua própria avaliação.

| Janela após `submitted_at` | Alterações permitidas |
| --- | --- |
| Até 168 horas, inclusive | Nota, comentário, ambos ou remoção explícita |
| Mais de 168 até 720 horas, inclusive | Somente primeiro comentário não vazio; nenhum campo `rating`, nem com o valor atual; `first_comment_at IS NULL` e comentário atual nulo |
| Mais de 720 horas | Nenhuma nova alteração |

O primeiro envio usa o mesmo instante para `submitted_at` e `updated_at`, e para
`first_comment_at` quando houver comentário não vazio. Edições jamais alteram
`submitted_at` ou reiniciam prazos. `first_comment_at` é histórico: uma remoção
na primeira semana não o apaga e não libera nova inclusão tardia.

Uma edição permitida sem mudança material retorna `200` e conclui sua intenção,
sem executar UPDATE da avaliação ou alterar `updated_at`. Uma tentativa proibida
não se torna válida por repetir o valor atual.

## Transação, relógio e concorrência

As duas operações usam `READ COMMITTED`. A sequência é: descoberta filtrada pelo
titular sem lock exclusivo; reserva/reconhecimento da intenção; participação
`FOR UPDATE`; avaliação `FOR UPDATE` no PATCH; revalidação do vínculo e da
titularidade; replay autorizado ou decisão/escrita; conclusão da intenção com a
resposta pública na mesma transação.

A reserva precede os locks de domínio em ambas as operações, evitando inversão
quando a mesma chave disputa recursos diferentes. Não são adquiridos locks de
evento/experiência em ordem inversa às finalizações. O lock da participação
serializa POSTs e PATCHs concorrentes, incluindo patches parciais distintos sem
perda de campos e duas inclusões tardias com apenas um vencedor.

A decisão captura **um `clock_timestamp()` PostgreSQL**, em CTE materializada,
depois das esperas relevantes. INSERT/UPDATE condicionais usam esse mesmo
instante e verificam o identificador afetado; falhas revertem domínio e intenção.
A resposta é consultada dentro da transação com o mesmo instante decisório.
Nenhum prazo de negócio usa `Date`, arredondamento a milissegundos ou horário
recebido por HTTP. `Date.now()` é usado apenas para metadados técnicos do TTL.

Elegibilidade, permissões e intervalos vêm da mesma `evaluationReadProjection`
oficial. Sua única alteração foi ampliar o argumento interno de observação de
`string` para `string | SQL`, permitindo referenciar o relógio da CTE sem duplicar
a política. Chamadores de leitura e respostas anteriores permanecem iguais.

## Idempotência e configuração

Namespaces estáveis: `submit_evaluation` e `edit_evaluation`. O fingerprint
inclui operação, versão semântica, recurso e payload normalizado; o ator integra
a chave única da infraestrutura existente. POST ausente/nulo/vazio/branco tem a
mesma intenção. PATCH ausente e remoção explícita são intenções diferentes;
campos omitidos não são preenchidos artificialmente.

Mesma chave/recurso/payload devolve exatamente a resposta histórica e o status
original. Outra intenção ou recurso no mesmo namespace gera conflito. Atores
diferentes não compartilham resultados; POST e PATCH têm namespaces distintos.
`in_progress` persistido segue o conflito existente. TTL vencido não apaga a
intenção nem permite reexecução. Replay exige titularidade atual, mas não reabre
as regras temporais nem altera linha, timestamps ou intenção concluída.

**Nova configuração obrigatória:** `EVALUATION_IDEMPOTENCY_TTL_SECONDS`, inteiro
positivo explícito, sem valor padrão ou fallback dos TTLs Staff, participante e
Admin. Ela é validada na inicialização de `EventsModule`/`AppModule`; fornecer os
quatro TTLs também nos processos de teste anteriores que iniciam esses módulos.
Não há expurgo ou nova política de retenção. `backend/README.md` documenta a
variável; arquivos `.env` não foram lidos nem alterados nesta task.

## Compatibilidade e arquivos

Os cinco GETs da E08.10 permanecem o contrato oficial: elegibilidade, pendências,
avaliação própria, histórico e retomada. Após POST, a avaliação aparece, a
pendência desaparece, `submitted=true` e `pending=false`; o histórico conserva uma
linha por participação. Após PATCH, GET mostra valores atuais e permissões sem
reiniciar prazos. Leituras não escrevem dados ou versões.

| Arquivos da task | Finalidade |
| --- | --- |
| `backend/src/evaluations/evaluation-write.controller.ts` | Rotas, erros e política explícita de TTL |
| `backend/src/evaluations/evaluation-write.dto.ts` | Validação estrita, normalização e resposta histórica |
| `backend/src/evaluations/evaluation-write.types.ts` | Entradas e resultados internos |
| `backend/src/evaluations/evaluation-write.policy.ts` | SQL decisório e mutações condicionais |
| `backend/src/evaluations/evaluation-write.service.ts` | Transação, locks, autorização e idempotência |
| `backend/src/evaluations/evaluation-read.policy.ts` | Reuso do instante SQL, sem segunda política |
| `backend/src/events/events.module.ts` | Registro dos novos componentes |
| `backend/test/unit/evaluation-write.test.ts` | DTOs, SQL, transação e idempotência |
| `backend/test/unit/evaluation-write-http.test.ts` | Contrato HTTP simulado, autenticação e DI |
| `backend/test/integration/evaluation-write.integration.test.ts` | PostgreSQL real preparado para execução manual |
| `backend/README.md` | Configuração obrigatória |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | Atualizações pontuais de §§17.4 e 17.6 |
| `docs/E08_11_IMPLEMENTACAO.md` | Este relatório |

## Validações efetivamente executadas pelo Codex

| Verificação | Resultado |
| --- | --- |
| Unitários específicos, incluindo HTTP simulado | **61/61 aprovados**: 36 de DTO/serviço/SQL e 25 HTTP |
| Regressão unitária completa (`npm.cmd test`) | **517/517 aprovados**, 0 falhas, cancelamentos ou skips |
| `npm.cmd run typecheck:test` | Aprovado, incluindo código e testes PostgreSQL sem executá-los |
| `npm.cmd run lint` | Aprovado |
| `npm.cmd run build` | Aprovado |

Foram adicionados **61 testes unitários**, sobre a base de 456. Os testes usam
doubles apenas nas suítes unitárias/HTTP simuladas. Sua URL de banco apontou
para porta local inoperante, com `.env` desativado; não houve conexão PostgreSQL.
O lint detectou inicialmente a necessidade de preservar a causa da exceção;
a correção manteve a causa interna e a mensagem externa constante. As validações
acima foram aprovadas após essa correção. Uma invocação adicional com o nome
inexistente `typecheck` foi corrigida para o script real `typecheck:test`.

### PostgreSQL real: aprovação manual definitiva

Em 04/11/2026, o responsável confirmou a execução manual no PostgreSQL local:

| Suíte | Executados | Aprovados | Falhas | Cancelamentos | Ignorados |
| --- | --- | --- | --- | --- | --- |
| E08.11 | 103 | **103** | 0 | 0 | 0 |
| Regressão PostgreSQL completa | 752 | **752** | 0 | 0 | 0 |

Os 103 testes novos somam-se aos 649 anteriores. A contagem, inicialmente
prevista por análise estática, foi confirmada pela execução manual. Permanecem
registradas as aprovações anteriores do Codex: **517/517 unitários**, **61/61
específicos**, typecheck, lint e build.

A primeira tentativa foi bloqueada antes de validar as funcionalidades por
recusa de autenticação do usuário local `admin`, SQLSTATE **28P01**. Tratou-se
de um problema de ambiente, sem resultado de validação funcional nessa tentativa.
O responsável restabeleceu a conexão com o usuário local `arenago`, sem alterar
o banco, e executou ambas as suítes com sucesso. Não foi necessária alteração
de código ou testes para resolver esse bloqueio.

Nesta finalização, o Codex atualizou somente a documentação e a evidência;
nenhum teste foi reexecutado, nenhuma credencial real foi acessada ou registrada
e nenhuma validação de produção é declarada. Os resultados PostgreSQL acima
foram fornecidos pelo responsável, não executados pelo Codex.

A suíte cobre payloads, matrizes de elegibilidade/conclusões/finalizações,
duplicidade, reentrada, replay/TTL/conflitos, janelas, comentário histórico,
no-op com `xmin`, autenticação/titularidade/2FA e isolamento de conta/evento.
Inclui os cinco GETs, snapshots concorrentes, finalizações E08.8/E08.9 com locks
reais, processamento automático atrasado e decisão após espera que cruza prazo.
Usa as fixtures existentes sem modificá-las.

As fronteiras de ±1 microssegundo executam os mesmos INSERT/UPDATE de produção
com uma expressão SQL de relógio interna ao helper; esse parâmetro não existe na
API ou no serviço. Os testes de espera usam o relógio real do banco. Concorrência
usa conexões/transações independentes e `pg_blocking_pids`. Falhas após reserva,
escrita de domínio e conclusão de intenção provocam `SELECT 1/0` na mesma conexão
PostgreSQL, **depois da escrita real**, e verificam rollback integral e retry.
Não substituem o banco por mocks.

### Comandos PowerShell de referência para o responsável

Usar banco local descartável já preparado com o schema do projeto. O exemplo
contém somente placeholders; credenciais reais ficam na sessão do responsável.
As fixtures validam as três URLs idênticas, `NODE_ENV=test`, host `127.0.0.1`,
porta `55432`, banco `arenago_events_test` e ausência de redirecionamentos.
As guardas permanecem ativas; não usar banco remoto ou de produção.

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

# Focado: 103 testes, aprovados na execução manual confirmada.
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/evaluation-write.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Falha na validação PostgreSQL E08.11' }

# Regressão completa: 752 testes, aprovados na execução manual confirmada.
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Falha na regressão PostgreSQL completa' }
```

## Evidência e pendências

Evidência única: `qa-evidence/e08-11-changes.diff`, patch completo dos 13 arquivos
listados, contra o HEAD inicial acima, incluindo os nove arquivos novos. UTF-8
sem BOM, caminhos relativos e cabeçalhos `diff --git`. Aplicação validada com
`git apply --check` e `git apply` em cópia isolada da base, seguida de comparação
integral dos 13 arquivos finais, normalizando apenas CRLF/LF conforme o Git.
Nenhuma omissão ou divergência; índice e HEAD preservados. O patch exclui a si
próprio, outros `.diff`, `.env`, credenciais, dependências instaladas, temporários
e alterações de outras tasks. Evidências anteriores foram preservadas.

Não há pendências de validação da E08.11. Resta somente o commit manual pelo
responsável; nenhum comando de versionamento foi executado nesta finalização.
Sugestão de mensagem, sem executá-la:
`feat(events): implementar envio e edição de avaliações`.

Permanecem fora do escopo: controller de `GET /participations/current`, CRUD
Admin estrutural, finalização voluntária, telas Expo, BI/exportações, moderação
automatizada e histórico completo de versões. Não houve auditoria geral da E08,
início da E08.12 ou execução de add, commit, push, merge ou rebase.
