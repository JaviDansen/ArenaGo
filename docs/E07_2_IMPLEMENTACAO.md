# E07.2 — consulta da fila interna do participante

Implementação de 30/10/2026 em `feature/events-participations`, iniciada sobre
`5d7fae1217eb28a4be2610660245a6b8dacc4f7a`, HEAD real após o commit da E07.1.
O working tree inicial continha somente `audit-1647dd6/`, preservado e excluído
da entrega. Sem commit, push ou auditoria independente nesta rodada.

**Fechamento posterior — 30/10/2026:** a validação PostgreSQL foi concluída pelo
responsável e a auditoria consolidada terminou APROVADA COM RESSALVAS. O registro
final ao fim deste documento distingue executores e resultados. As pendências,
contagens previstas e comandos nas seções originais preservam o contexto da
entrega inicial; não são o estado atual da validação.

## Arquivos e escopo

| Arquivo | Alteração |
| --- | --- |
| `backend/src/events/queue-state.service.ts` | Novo QueueStateService, exclusivamente leitura. |
| `backend/src/events/queue-state.types.ts` | União discriminada e tipos internos de espera/chamada. |
| `backend/src/events/events.module.ts` | Registro/exportação aditivos do serviço. |
| `backend/test/unit/queue-state.test.ts` | 18 testes próprios E07.2. |
| `backend/test/integration/queue-state.integration.test.ts` | 20 testes PostgreSQL próprios E07.2, ainda pendentes de execução. |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | §16.5 alinhada ao contrato interno, contagem inclusiva e projeção temporal. |
| `docs/PLANEJAMENTO_ARENAGO.md` | Atualiza apenas o trabalho atual; preserva o histórico E07.1/C-15. |
| `docs/E07_2_IMPLEMENTACAO.md` | Este registro. |
| `qa-evidence/e07-2-changes.diff` | Patch contra o HEAD inicial, incluindo novos arquivos; exclui a si próprio e arquivos externos. |

Foram inspecionados arquitetura §§16.1/16.2/16.5, planejamento C-14/C-15,
relatório E07.1, serviço/tipos de ingresso, E06, E04, schemas, migrações/FKs e
testes existentes. E07.1, E01–E06, módulos do Kaled e testes anteriores foram
preservados, salvo o registro aditivo no módulo de eventos. Sem migrations,
controllers, DTOs públicos, Expo, polling, WebSocket, notificações ou E07.3.

## Contrato interno

```ts
QueueStateService.getParticipationQueue(
  userId: string,
  participationId: string,
): Promise<ParticipationQueueResult>
```

Nome recomendado mantido, em serviço separado do mutador E07.1. O chamador
confiável fornece userId e UUID com sintaxe válida; autenticação HTTP não é
implementada aqui. Participação inexistente ou alheia retorna exatamente
`{ kind: 'access_denied' }`, sem consulta posterior à fila ou dados de terceiros.

Sucesso contém somente `kind: 'ok'`, `participationId`, `observedAt: Date` UTC
serializável como ISO 8601 e `currentQueueEntry`. A entrada pode ser:

- `null`: sem entrada corrente ou projeção após encerramento efetivo.
- `waiting`: `id`, `experienceId`, `experienceName`, `status`, `queueOrder: string`,
  `position: number` positivo e `serviceSession: null`.
- `called`: mesmos identificadores e ordem histórica, `status`, `position: null`
  e `serviceSession: { id, status: 'pending', calledAt: Date, station: { id, label } }`.

Retornar queueOrder também para called mantém a identidade histórica sem dar
posição de espera a quem já foi chamado. Não expõe Staff, usuários, perfis,
jogos, snapshots, credenciais ou motivos administrativos. Datas têm resolução
de milissegundos do contrato Date. Não consulta idempotência ou replay do ingresso.

## Snapshot, consultas e posição

Uma transação `REPEATABLE READ READ ONLY`, com duas instruções de leitura,
independentemente do tamanho da fila, usando exclusivamente o executor tx:

1. Validar `participations.id/user_id`, carregar evento/ponteiro/estado e prazos
   operacionais e obter observedAt de `statement_timestamp()` na primeira leitura,
   como na E06. Este é o instante de referência da projeção, não o horário do app.
2. Ler a entrada apontada, experiência, atendimento/estação e as contagens no
   mesmo snapshot. Não buscar a última entrada histórica. Os dois counts são
   subconsultas escalares para uma única participação, sem N+1 por pessoa/estação.

Posição = `count(*)` de queue_entries com mesmo evento e experiência,
`status='waiting'` e `queue_order <=` ordem própria. Inclui a pessoa; exclui
called, closed, outras experiências, fila externa e participações sem entrada.
Estações múltiplas não multiplicam a contagem: não há join de estações no count.
Encerrar alguém à frente pode reduzir a posição sem renumerar ordens históricas.

PostgreSQL retorna ordens e counts como texto. queueOrder não é convertido para
number; posição é validada por BigInt e só convertida se positiva e <=
Number.MAX_SAFE_INTEGER. Contagem corrente também exige decimal seguro. Os
índices existentes da fila FIFO e da entrada corrente continuam disponíveis;
nenhuma coluna de posição ou índice novo foi criado.

Não há locks de linha, escrita em tabelas, incremento, reserva idempotente ou
limpeza. Locks normais de leitura do PostgreSQL não são usados como mutex de
ingressos/chamadas. Nova consulta inicia novo snapshot e vê commits posteriores.

## Estados e decisão técnica de encerramento

| Situação no snapshot/observedAt | Projeção |
| --- | --- |
| Titular ativo, externo waiting, finished ou canceled sem fila corrente | Sucesso com null. |
| Entrada waiting vigente | Posição positiva, sem serviceSession. |
| Entrada called vigente | Atendimento pending e estação coerentes, posição null. |
| Estação indisponível, Staff revogado ou fila pausada | Preserva leitura da entrada preexistente; capacidade C-14 é guarda de novo ingresso. |
| Corte oficial de inscrições ou início controlado; prazo residual ainda vigente | Preserva waiting/called. |
| `events.status='closed'` | null, mesmo se o job não atualizou as linhas. |
| observedAt >= menor prazo operacional/administrativo | null; igualdade já é encerramento efetivo. |
| Fechamento imediato | Prazo administrativo coincide com closure_requested_at; null a partir dele. |

Decisão técnica mínima: **null significa ausência de fila operacional atual no
instante observedAt**, sem criar estado persistido novo nem fingir execução de
limpeza. A participação não é reativada/finalizada; os registros ficam intactos.
O contrato não adiciona um motivo de encerramento ou estado efetivo de
participação; E04/histórico/E06 continuam necessários para essa navegação.
Null não implica permissão de novo ingresso. Se o relógio ultrapassar o prazo
durante uma leitura longa, a resposta ainda descreve seu observedAt; não é uma
garantia de estado corrente no momento de entrega ao cliente.

Relações e ponteiro são conferidos antes dessa projeção. Após encerramento,
dados operacionais atrasados não são apresentados como chamada vigente. Enquanto
o prazo permite operação, called sem pending ou waiting com atendimento é erro,
não um estado aparentemente válido. Participação não ativa com entrada corrente
também é erro enquanto operacionalmente vigente. A exceção de projeção temporal
não corrige nenhuma dessas linhas nem produz resultado de atendimento.

## Privacidade e integridade

Primeira consulta filtra titularidade antes de acessar fila. A segunda repete
participação/usuário/evento e correlaciona ponteiro com entrada, participação e
evento; experiência deve pertencer ao evento, atendimento à entrada/experiência
e estação à mesma experiência. Campos extras não são repassados ao resultado.

`QueueStateIntegrityError` é falha interna explícita, com mensagem sem IDs:
ponteiro quebrado/para closed, entrada corrente sem ponteiro, multiplicidade,
vínculos inconsistentes, ausência de pending/estação/horário, estados desconhecidos,
contagens inseguras e datas inválidas. Constraints e FKs compostas não foram
alteradas. Situações que o DDL ainda permite, mas os serviços normais não produzem,
têm fixtures próprias de erro, sem desabilitar constraints para construí-las.

## Testes e resultados

18 unitários cobrem titularidade, contratos exatos, consultas/params, transação
somente leitura, posição inclusiva, bigint, limites de contagem/data, privacidade,
projeção temporal e integridade. Drizzle usa driver simulado: esses testes não
demonstram segurança concorrente PostgreSQL.

20 testes de integração escritos cobrem os 18 requisitos da rodada: ausência de
fila, ingresso real E07.1/posição 1, posições 1–3, queda de posição após close,
called/closed fora da espera, experiências/estações, chamada/estação/horário,
indisponibilidade, estados da participação, histórico/C-15, acesso neutro,
snapshots concorrentes, consultas posteriores, cortes oficial/controlado,
encerramento definitivo com job atrasado, nenhuma escrita, privacidade e
inconsistências. Ainda não foram executados nesta rodada.

Nos dois testes de snapshot, uma barreira depois da primeira consulta REAL
mantém a transação aberta. Outra conexão confirma chamada ou encerramento da
fixture antes de liberar a segunda leitura. A leitura antiga deve retornar
waiting; uma nova deve retornar called ou null. O writer precisa comitar com o
reader pausado, demonstrando também que a leitura não o bloqueia. Não se presume
concorrência por Promise.all ou sleep fixo. Comandos de chamada/saída existem
somente nos helpers de fixture; não implementam E08/E07.3 no serviço.

| Validação executada pelo Codex | Resultado |
| --- | --- |
| `npm.cmd --prefix backend test` | **126/126 aprovados**, zero falhas/cancelamentos/skips, exit 0: 108 anteriores + 18 novos. |
| `npm.cmd --prefix backend run typecheck:test` | Aprovado, exit 0, incluindo integração nova. |
| `npm.cmd --prefix backend run lint` | Aprovado após remover dois tipos não utilizados, exit 0. |
| `npm.cmd --prefix backend run build` | Aprovado, exit 0. |
| Whitespace, correspondência reversa do patch e aplicação em memória contra o HEAD inicial | Aprovados; não usam staging ou checkout. |
| PostgreSQL específico e regressão completa | Pendentes; nenhuma conexão efetuada nesta rodada. |

Conferência SHA-256 dos 179 arquivos existentes de backend/app e da evidência E07.1
identificou somente o registro aditivo em `events.module.ts`; os demais, incluindo
o mutador, tipos e testes E07.1 e os módulos do Kaled, permanecem intactos.

Unitários foram executados com carregamento dotenv direcionado a NUL e URL local
sem conexão. Foi usado o acesso de execução já necessário ao tsx nesta sessão
para contornar a falha conhecida `uv_os_get_passwd / ENOMEM` da sandbox Windows.
Não se atribuem à E07.2 os resultados PostgreSQL 21/21 e 129/129 da E07.1.

## Execução manual pendente e segurança

DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL estão ausentes no
processo. Não foram lidos arquivos .env, acessados bancos ou executadas migrations,
reset, DROP, TRUNCATE ou seed. Nenhum outro banco é fallback permitido.

O responsável deve configurar as três URLs explicitamente, idênticas, com
credenciais locais para `127.0.0.1:55432/arenago_events_test`, sem query params.
O teste novo valida todas antes de importar serviços/configuração ou abrir pools;
dotenv é direcionado ao dispositivo nulo. O banco deve estar previamente pronto.
Não preparar schema ou dados globais como parte da execução.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
# Definir DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL explicitamente.
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/queue-state.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar falha E07.2 antes da regressão.' }
npm.cmd run test:integration
```

Contagem esperada, ainda não validada em execução: **20 testes específicos** e
**149 na regressão completa** (129 anteriores + 20 novos). Antes da regressão,
confirmar o mesmo preflight explícito no processo; manter dotenv desabilitado
para as suítes anteriores. Nenhuma credencial deve ser exibida no relatório.

Fixtures são isoladas por UUID de evento/usuário, incluindo idempotência criada
pelo ingresso real E07.1. Limpeza transacional remove somente seus registros na
ordem das FKs; pools são encerrados mesmo com erro na limpeza. O cenário de
estação indisponível usa configuração direta de fixture para testar a leitura;
não concede permissão a uma futura operação Staff para desativar estação pendente.

## Continuidade

E07.3 deverá fechar a entrada e resolver pending/limpar ponteiro atomicamente,
mantendo participação active conforme C-15. A leitura já aceita esse resultado
como null e observa nova entrada E07.1 como uma tentativa distinta. Não foi criada
operação de saída nesta etapa.

A revisão técnica consolidada E07.1–E07.3 está reservada pelo responsável para
depois da implementação da E07.3. Esta rodada entrega implementação e validações,
sem abrir auditoria independente e sem commit/push/PR/merge/reset/stash.

## Fechamento documental E07.1–E07.3 — registro posterior de 30/10/2026

Após as rodadas acima, o responsável informou a execução no PostgreSQL local
autorizado `127.0.0.1:55432/arenago_events_test`. Separadamente, o Codex reexecutou
as verificações locais durante a auditoria consolidada:

| Verificação final | Executor | Resultado |
| --- | --- | --- |
| PostgreSQL específico E07.2 | Responsável | **20/20 aprovados**, zero falhas, cancelamentos ou skips. |
| PostgreSQL específico E07.3, após correção das fixtures | Responsável | **27/27 aprovados**, zero falhas, cancelamentos ou skips. |
| Regressão completa PostgreSQL E07.1–E07.3 e suítes anteriores | Responsável | **176/176 aprovados**, zero falhas, cancelamentos ou skips. |
| Unitários completos | Codex, na auditoria consolidada | **145/145 aprovados**, zero falhas, cancelamentos ou skips, exit 0. |
| Typecheck | Codex, na auditoria consolidada | Exit 0. |
| Lint | Codex, na auditoria consolidada | Exit 0. |
| Build | Codex, na auditoria consolidada | Exit 0. |

As execuções PostgreSQL são externas, realizadas pelo responsável; não são
execuções do Codex nem do auditor. Na auditoria, as três URLs explícitas estavam
ausentes e o Codex não acessou PostgreSQL. A contagem inicial de 149 era uma
previsão anterior à E07.3, não uma execução comprovada; o resultado final da
regressão é 176/176. Os 126/126 unitários da entrega inicial e demais resultados
históricos não foram substituídos. A primeira execução E07.3 com 23/27 e quatro
falhas 42P08, sua correção e revalidação estão em `E07_3_IMPLEMENTACAO.md`.

Parecer consolidado: **E07.1 aprovada; E07.2 aprovada; E07.3 aprovada; integração
aprovada com ressalvas**. Nenhum defeito funcional bloqueante foi confirmado.
O achado documental de ausência do registro da revalidação externa é tratado
neste fechamento, sem promover nova auditoria ou alterar o parecer anterior.

Dependências futuras preservadas:

1. Definir e validar a política de expurgo/idempotência antes de implementar
   remoção de registros, incluindo o comportamento de retries após o expurgo.
2. Homologar os escritores Staff reais e suas interações com E07.1–E07.3 quando
   forem desenvolvidos. As emulações SQL de fixture não homologam esses serviços.

Essas dependências não são falhas funcionais atuais nem funcionalidades já
homologadas. Este registro posterior é exclusivamente documental: nenhum código,
teste, schema ou migration foi alterado; nenhum teste ou auditoria foi reexecutado
neste fechamento. Evidência documental final no patch cumulativo E07.3 contra
`5d7fae1217eb28a4be2610660245a6b8dacc4f7a`; o patch histórico E07.2 foi preservado.
