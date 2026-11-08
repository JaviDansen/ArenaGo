# E07.1 — ingresso interno em filas de experiências

Implementação de 30/10/2026 sobre `feature/events-participations`, base
`bb6df2d8152a03c4ee029e442a5a1feda8862dfc`. Sem commit ou push.

## Escopo e arquivos

| Arquivo | Alteração |
| --- | --- |
| `backend/src/events/queue-entry.service.ts` | Novo `QueueEntryService`, ingresso transacional. |
| `backend/src/events/queue-entry.types.ts` | Contrato de entrada, resultado e impedimentos. |
| `backend/src/events/events.module.ts` | Disponibiliza e exporta o serviço interno por DI. |
| `backend/src/participations/join-idempotency.ts` | Somente exporta o helper genérico existente; corpo e fluxo E03 preservados. |
| `backend/test/unit/queue-entry.test.ts` | 18 testes unitários novos. |
| `backend/test/integration/queue-entry.integration.test.ts` | 21 testes PostgreSQL, com concorrência e falhas fortalecidas após auditoria e novo cenário de corte antes do UPDATE. |
| `docs/PLANEJAMENTO_ARENAGO.md` | Complemento documental C-15 aprovado após a implementação inicial: desistência da fila interna sem finalizar a participação. |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | Corrige a delimitação da §16.2 para C-15/E07.3 e alinha a §16.4 à disponibilidade operacional C-14, sem definir rota HTTP nova. |
| `docs/E07_1_IMPLEMENTACAO.md` | Este registro. |
| `qa-evidence/e07-1-changes.diff` | Patch completo, incluindo novos arquivos; exclui o próprio artefato. |

Não foram criados controller, endpoint, migração, coluna de posição, fila por
estação ou fluxo mobile. Serviços E01–E06 e seus testes permanecem intactos, além
da exportação sem mudança de comportamento do helper E03 e do registro aditivo
no módulo. Autenticação, perfil e jogos não foram modificados. O diretório
`audit-1647dd6/`, remanescente da auditoria anterior, não pertence a esta entrega
e não está no patch.

## Compatibilidade com a decisão C-15 — complemento de 30/10/2026

Após a entrega inicial, o responsável aprovou a desistência voluntária de uma
entrada interna `waiting` ou `called`, mantendo a participação `active`. Essa
saída é distinta da saída externa que cancela a participação e da finalização
voluntária da participação. A E07.1 continua implementando **somente o ingresso**;
a operação de saída fica reservada à **E07.3**, com contrato específico futuro.
E07.2 e E07.3 não são implementadas neste complemento.

A saída futura deve preservar histórico e conclusões, liberar o ponteiro e
resolver eventual `service_sessions.pending` atomicamente, sem ausência/conclusão,
disputando corretamente com Staff e fechamento. Pode ocorrer após o corte de
novos ingressos enquanto estado e prazo operacional permitirem, mas não concede
reentrada após esse corte. Trocar de experiência exige novo ingresso, nova chave
e nova ordem FIFO; não transfere posição nem cria fila por estação.

Conferidos o schema atual e a migração `0004`: entradas admitem
`waiting|called|closed`; atendimentos admitem `pending|completed|absent|canceled`.
Os campos `close_reason` e `cancel_reason` são `varchar(40)`, sem lista fechada de
motivos. Não foi presumido estado ou código novo já disponível: os motivos
concretos serão especificados no contrato E07.3, respeitando os checks existentes.
Nenhuma migration foi criada. Ver planejamento C-15/seção 7 e arquitetura §16.2.

**Preservação da rodada documental C-15 (histórico):** `QueueEntryService`, tipos, testes,
E01–E06 e módulos do Kaled não foram alterados. Não houve execução de testes,
conexão a banco, commit ou push. Os resultados de validação registrados abaixo
pertencem à entrega inicial, sem nova execução naquele complemento; PostgreSQL
permanecia pendente naquele momento. O patch completo foi regenerado contra a mesma base
`bb6df2d8152a03c4ee029e442a5a1feda8862dfc`, incluindo os documentos atualizados e
os arquivos novos originais, sem incorporar o checkout auxiliar da auditoria.

Foram feitas somente verificações documentais: comparação SHA-256 dos 177
arquivos existentes em `backend/` e `app/` (incluindo os novos da entrega inicial),
sem diferenças; whitespace e correspondência reversa do patch; e aplicação
simulada por `git apply --check` em cópia temporária dos arquivos da base original.
Essas verificações não executam testes da aplicação nem acessam PostgreSQL.

## Inspeção e decisões

Foram examinados os serviços reais de experiências, eventos e participações,
helpers E03, executor Drizzle, schemas/FKs/checks/índices, testes E03/E05/E06 e
as seções 4, 16.1, 16.4 e 20.2 da arquitetura, juntamente com D02/D03/D05/D07 e
C-13/C-14 do planejamento. O código existente usa resultados discriminados por
`kind`, transações Drizzle e helpers de idempotência na conexão corrente.

O texto antigo da §16.4 que dispensa estação disponível não foi seguido:
C-14 e §20.2 exigem estação configurada `available` na experiência. Estação
ocupada por atendimento `pending` ainda pode estar configurada `available`;
ocupação não bloqueia ingresso na fila. Perda temporária de capacidade não
altera entradas existentes, não fecha evento e não registra ausência.

Não há serviço de escrita de estações/concessão/revogação Staff nos módulos
E01–E06 a adaptar nesta etapa. E03 e E05 usam `events FOR UPDATE` antes de
usuários/participações, compatível com o `FOR SHARE` da E07.1. Futuras escritas
de capacidade/fechamento precisam coordenar pelo evento, conforme a arquitetura.

## Assinatura e contrato

```ts
QueueEntryService.joinExperienceQueue(
  input: JoinExperienceQueueInput,
): Promise<JoinExperienceQueueResult>

interface JoinExperienceQueueInput {
  userId: string;
  participationId: string;
  experienceId: string;
  idempotencyKey: string;
  expiresAt: Date;
}
```

`userId` é fornecido por chamador confiável. Não substitui autenticação de uma
futura rota. UUIDs devem ter sintaxe válida, seguindo a convenção dos serviços
internos existentes. A chave deve conter texto e ter até 128 caracteres; sua
grafia exata é preservada. Expiração deve ser uma `Date` válida. `expiresAt` é
explícito, como na E03: não foi inventado TTL nem expurgo automático de produto.

Sucesso `created` ou `replay` retorna `queueEntryId`, `participationId`,
`experienceId`, `status: 'waiting'`, `queueOrder: string` decimal exata e
`enteredAt: Date` UTC, serializável como ISO 8601. O instante persistido usa
resolução de milissegundos do contrato Date. Ordem não é posição dinâmica.

| `kind` | Significado |
| --- | --- |
| `access_denied` | Participação ausente/alheia ou experiência ausente/de outro evento; não expõe titular nem dados da fila. |
| `participation_not_active` | Titular com participação externa `waiting` ou terminal. |
| `queue_occupied` | Há ponteiro corrente ou entrada `waiting`/`called`, inclusive em outra experiência. |
| `queue_closed` | `queue_accepting_entries=false`. |
| `experience_unavailable` | Nenhuma estação disponível protegida na experiência, embora as condições globais permitam ingresso. |
| `event_closed` | Janela temporal ainda não iniciada/encerrada ou fechamento operacional/Admin; `missing` distingue a causa. |
| `event_unavailable` | Prontidão/capacidade global insuficiente; `missing` distingue os requisitos. |
| `request_conflict` | Mesma chave/ator/operação com fingerprint de intenção diferente. |
| `in_progress` | Reserva anterior persistida ainda incompleta; não assume sua conclusão nem cria segunda entrada. |

A precedência de titularidade é intencional: um identificador alheio ou ausente
não permite consultar sequer detalhes da idempotência. Para titular confirmado,
replay/conflito são avaliados antes do estado atual de admissão. Se não há
estações em todo o evento, o resultado é `event_unavailable`; se só a experiência
perdeu capacidade, é `experience_unavailable`. O resultado histórico de replay
continua `waiting` mesmo se a entrada já foi encerrada: não é consulta de estado
atual da E07.2.

## Transação, locks e cronologia

Uma única transação `READ COMMITTED`, sem chamadas ao executor raiz dentro dela:

1. Descobrir o evento da participação titular sem lock. Essa leitura não autoriza
   mutação; evento/titularidade são novamente verificados após os locks.
2. `events FOR SHARE` → `experiences FOR UPDATE` (mesmo evento).
3. Proteger uma estação `available` da experiência por `FOR SHARE`, ordenada por
   UUID. O lock adicional fica antes da participação, compatível com a ordem
   experiência → estação → participação dos futuros comandos Staff.
4. `participations FOR UPDATE`, revalidando ID, usuário e evento. Reservar a
   intenção pelo helper E03, interpretando replay/conflito sem nova mutação.
5. Para intenção nova, exigir participação ativa, experiência válida e nenhuma
   entrada corrente. Ler `queue_entries waiting/called FOR UPDATE` após a
   participação; não depende somente do ponteiro.
6. Exigir fila aberta. Proteger um Staff apto por `FOR SHARE OF users,user_roles`,
   ordenado por UUID de usuário/papel: evento correto, role Staff, sem revogação,
   conta ativa e e-mail verificado. Manter as testemunhas até o commit impede
   remoção concorrente da capacidade usada para admitir, inclusive por UPDATE
   direto das linhas. Ausência de testemunha não é substituída por leitura
   posterior desprotegida, mesmo se ocorrer concessão concorrente.
7. Obter `clock_timestamp()` após essas possíveis esperas e chamar a avaliação
   real de prontidão/capacidade/janela da E02 no mesmo executor transacional.
8. Incrementar `experiences.last_queue_order` sob seu lock. O próprio UPDATE tem
   um CTE materializado com instante único `clock_timestamp()` e condições de
   início inclusivo, fim oficial exclusivo, corte Admin e estado operacional.
   Assim, expirar entre a avaliação e o UPDATE também rejeita o ingresso.
9. Inserir entrada `waiting`, atualizar o ponteiro e concluir a idempotência,
   com a resposta mínima, na mesma transação. Commit somente após tudo concluir.

Bloqueios de negócio são lançados internamente e convertidos em resultado após
ROLLBACK; a reserva recém-inserida também desaparece. Erros inesperados propagam
após rollback. Constraints/FKs e os índices únicos existentes não foram alterados.

Experiências diferentes compartilham apenas locks de leitura do evento/Staff,
permitindo avanço independente. FIFO segue a serialização no lock da experiência,
não a ordem de chegada de requisições em relógios externos. Não há `SKIP LOCKED`
nem contador vindo do frontend. Não se promete ausência universal de deadlocks
com escritores futuros ou precisão do instante de commit: ele pode suceder o
instante decisivo. Não há retentativa automática de transação com erro desconhecido.

## Idempotência

Reutilizados `reserveIdempotencyOperationWithTx`,
`completeIdempotencyOperationWithTx` e `createRequestFingerprint`, da E03.
Foi acrescentado apenas `export` ao helper genérico. Não se usa
`reserveJoinIntentWithTx`, pois ele é específico da criação de participação e
obteria `events FOR UPDATE`, contrariando o protocolo desta operação.

Namespace `join_experience_queue`, com unicidade existente por ator/operação/chave.
Fingerprint canônico inclui participação e experiência. Resposta guarda IDs,
estado, ordem decimal e instante ISO. Retry da intenção retorna a resposta
original, sem incremento, mesmo após encerramento histórico ou corte posterior.
Chave diferente disputa a participação e encontra `queue_occupied` se já houver
entrada corrente; sua reserva é revertida. Depois de encerramento legítimo e
ponteiro liberado, chave nova recebe nova entrada e ordem, preservando histórico.

## Testes e rastreabilidade dos cenários

18 testes unitários novos verificam contrato, fingerprint, executor transacional,
ordem dos locks, relógio decisivo, bigint seguro, impedimentos, replay/conflito,
in_progress, erros intermediários e rollback solicitado. Usam driver simulado
com Drizzle real: não são evidência de segurança concorrente PostgreSQL.

21 testes de integração escritos usam dois pools reais e conexões independentes,
esperas observadas em `pg_stat_activity` e, quando necessário, uma transação real
retida antes do commit. Nos cenários de chaves concorrentes, os PIDs são distintos
e `pg_blocking_pids` precisa identificar a primeira operação como bloqueadora da
segunda antes de liberar o commit. Proxy de teste apenas injeta falha após SQL
real; não substitui os locks nem a transação do banco. A revalidação PostgreSQL
da versão corrigida foi concluída pelo responsável em 30/10/2026, conforme o
registro final abaixo; a pendência existente na entrega das correções foi preservada
no histórico.

| Requisito da rodada | Cobertura PostgreSQL escrita |
| --- | --- |
| 1, 2, 3 | Ingresso válido; experiências independentes; múltiplas estações/estação adicionada compartilham a sequência. |
| 4 | Primeiro ingresso mantido antes de commit e quatro concorrentes bloqueados; ordens únicas, consecutivas e servidoras. |
| 5, 6 | Primeira transação retida antes de commit; segunda em PID independente, com bloqueador identificado; mesma chave/replay e chaves diferentes na mesma ou em outra experiência. Exige uma entrada, um incremento e nenhuma reserva rejeitada residual. |
| 7 | Entrada waiting e called impedem nova fila. |
| 8, 9 | Participação externa, terminal, ausente/alheia; experiência ausente/cruzada. |
| 10, 11, 12 | Fila pausada; capacidade individual/global; Staff revogado, inativo, não verificado ou em outro evento. |
| 13, 14 | Início, prontidão, corte oficial/Admin, estado operacional; corte durante espera na experiência e entre avaliação favorável e UPDATE decisivo real. |
| 15 | Perda de estação/role/conta Staff durante espera; desativação posterior aguarda testemunha; fechamento/pausa durante espera. |
| 16 | Falha após contador; após inserção e ponteiro, antes de concluir idempotência; e após conclusão idempotente. Estado interno e marcador exato de cada fase são exigidos, com snapshot integral revertido e chave reutilizável. |
| 17 | Encerramento histórico em fixture, nova chave/nova ordem e replay da resposta antiga sem mexer no ponteiro atual. |
| 18, 19 | Preservação de outros eventos/experiências/participações; snapshots antes/depois dos bloqueios abrangem contadores, filas, ponteiros, idempotência, estações, roles e serviços. |

Há também teste de progresso independente entre experiências e de ingresso com
estação `available` já ocupada. Fixture de encerramento/chamada apenas prepara
estados para testes; não implementa operações E08–E10 no serviço.

## Validações efetivamente executadas — implementação inicial (histórico)

| Verificação | Resultado em 30/10/2026 |
| --- | --- |
| `npm.cmd --prefix backend test` | 108 testes aprovados, zero falhas/skips, exit 0; 90 anteriores + 18 E07.1. |
| `npm.cmd --prefix backend run typecheck:test` | Aprovado, exit 0, incluindo os 20 testes PostgreSQL. |
| `npm.cmd --prefix backend run lint` | Aprovado, exit 0. |
| `npm.cmd --prefix backend run build` | Aprovado, exit 0. |
| `git diff --check` e `git apply --reverse --check qa-evidence/e07-1-changes.diff` | Aprovados, exit 0; patch corresponde aos arquivos entregues sem usar staging. |
| Integração E07.1 e regressão PostgreSQL | NÃO executadas pelo Codex nessa rodada inicial; execução posterior do responsável registrada abaixo. |

A primeira execução de tsx na sandbox falhou em `uv_os_get_passwd / ENOMEM`;
a execução autorizada fora dela passou. Durante desenvolvimento foram corrigidos
erros de tipagem e uma expectativa unitária que precisava examinar `Error.cause`
do Drizzle; os resultados acima se referem às versões corrigidas.

Na rodada inicial, as três URLs de integração estavam ausentes no processo. Uma sondagem TCP apenas
confirmou listener em `127.0.0.1:55432`; isso não comprova credenciais, schema ou
testes PostgreSQL. O responsável pediu expressamente deixar a execução pendente.
Nenhum pool real foi aberto nesta rodada; não foram lidos arquivos `.env`,
acessados outros bancos, executados DROP/TRUNCATE/reset/seed ou migrations.
Unitários executaram com carregamento dotenv direcionado a `NUL` e URL local
sem conexão. Build/typecheck/lint não inicializam a aplicação.

## Validação posterior informada pelo responsável — antes das correções atuais

Em 30/10/2026, o responsável informou que executou a versão anterior aos ajustes
pós-auditoria, em `127.0.0.1:55432/arenago_events_test`, sobre a mesma base original:

| Execução do responsável | Resultado informado |
| --- | --- |
| Preflight das três URLs explícitas | Aprovado para o destino local autorizado. |
| Testes específicos E07.1 da versão anterior | 20/20 aprovados, zero falhas e zero skips. |
| Regressão completa da versão anterior | 128/128 aprovados, zero falhas e zero skips. |

Esses resultados são atribuídos exclusivamente ao responsável. Não são execução
do Codex nem do auditor, não substituem análise independente e **não validam os
testes corrigidos ou o cenário novo desta rodada**. O relato inicial de ausência
de execução PostgreSQL pelo Codex foi preservado acima.

## Correções pós-auditoria — 30/10/2026 (histórico da rodada corrigida)

A auditoria estática terminou como **APROVADO COM RESSALVAS**, sem P0/P1 e sem
defeito funcional confirmado no serviço. Os quatro achados foram tratados assim:

1. **Sobreposição real:** `holdBeforeCommit` informa o PID da primeira transação;
   `overlapJoins` reserva outra conexão, verifica PID distinto e só libera o commit
   após `pg_stat_activity` e `pg_blocking_pids` identificarem a segunda operação
   aguardando a primeira. A observação usa polling do estado do banco, sem assumir
   concorrência a partir de Promise.all ou de atraso fixo. Os cenários verificam
   criação/replay ou criação/queue_occupied, ponteiro correto, uma entrada corrente,
   um incremento na experiência escolhida, contador intacto na outra experiência,
   uma intenção concluída e zero reservas da chave rejeitada. Operações são drenadas
   e a conexão devolvida mesmo quando a observação de espera falha.
2. **Fases de falha:** `counter`, `entry` e `all_writes` possuem marcadores exclusivos,
   comparados por identidade após desembrulhar `Error.cause`. Antes de injetar,
   consulta na própria transação verifica contador incrementado, quantidade de
   entradas, ponteiro e estado/referência da idempotência. `counter` tem zero entradas
   e ponteiro nulo; `entry` tem entrada/ponteiro, com intenção ainda in_progress;
   `all_writes` exige idempotência completed. Não alcançar uma fase gera erro que
   não satisfaz seu marcador. Depois, snapshot integral e retry da mesma chave
   exigem rollback e reutilização sem resíduo.
3. **C-14 na §16.4:** removida a orientação antiga; ingresso exige estação configurada
   available, que pode estar ocupada por pending. Perda de capacidade preserva
   entradas existentes e restauração não reabre inscrições após os cortes.
   C-15 e a reserva da saída interna à E07.3 foram preservadas.
4. **Histórico de execução:** resultados 20/20 e 128/128 do responsável registrados
   separadamente da execução inicial do Codex e da revalidação corrigida pendente.

**Cenário adicional viável:** adicionado o 21º teste específico, de corte oficial
entre avaliação favorável e UPDATE decisivo. Um wrapper apenas no teste configura
o prazo da fixture na mesma transação, depois dos locks e **antes** da avaliação
real, a partir do instante PostgreSQL fornecido ao avaliador. Assim a avaliação
é explicitamente favorável no instante observado, independentemente de demora
de agendamento no Node. Em seguida, espera o prazo do próprio banco e verifica
`clock_timestamp() >= official_ends_at` antes de devolver a avaliação original.
O UPDATE de produção precisa rejeitar a entrada. O snapshot também exige que a
configuração temporária da fixture e a reserva sejam revertidas, seguido de retry
normal com a mesma chave. Não há relógio simulado, resultado SQL fabricado nem
mudança no serviço; o teste não representa um Admin atravessando o lock do evento.

| Verificação efetiva da rodada corrigida | Resultado |
| --- | --- |
| `npm.cmd --prefix backend test` | 108/108 aprovados, zero falhas/skips, exit 0. |
| `npm.cmd --prefix backend run typecheck:test` | Aprovado, exit 0, incluindo os 21 testes PostgreSQL. |
| `npm.cmd --prefix backend run lint` | Aprovado, exit 0. |
| `npm.cmd --prefix backend run build` | Aprovado, exit 0. |
| Integração específica corrigida e regressão completa | PENDENTES naquele momento, sem aprovação antecipada; concluídas posteriormente conforme registro final abaixo. |

Conferência SHA-256 dos 177 arquivos de `backend/` e `app/`, antes e depois dos
ajustes, identificou somente a alteração autorizada em
`backend/test/integration/queue-entry.integration.test.ts`; nenhuma alteração no
serviço, tipos, módulos, helper E03, unitários ou demais fontes/testes anteriores.
O diff completo continua baseado em `bb6df2d8152a03c4ee029e442a5a1feda8862dfc`,
com arquivos novos e sem alterações externas. Whitespace, correspondência reversa
e aplicação simulada à base original foram verificados sem usar staging.

As três URLs explícitas continuam ausentes no processo desta rodada; nenhum
PostgreSQL foi acessado, nem sequer para sondagem de conexão. Unitários usaram
dotenv direcionado a NUL e URL local sem conexão, como na entrega inicial.
Serviço, tipos, módulos, helper E03, demais fontes e testes anteriores foram
preservados; só a suíte de integração E07.1 e os documentos/evidência foram editados.
Sem E07.2/E07.3, endpoints, migrations, resets, seed ou commit/push/PR/merge.

## Procedimento de revalidação PostgreSQL — histórico da pendência

Na entrega das correções, o responsável deveria executar novamente os **21 testes
específicos** e a regressão completa. Os 20/20 e 128/128 anteriores não aprovavam
essa versão corrigida. A nova execução foi concluída posteriormente, conforme
registro final a seguir. O procedimento utilizado para orientar a revalidação
permanece documentado abaixo, sem solicitar nova execução neste fechamento.

O banco autorizado deve estar previamente preparado. Não executar migrations,
reset ou seed como parte desta validação. Na sessão PowerShell, definir
explicitamente `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL`
com credenciais locais, todas idênticas, para
`127.0.0.1:55432/arenago_events_test`, sem query parameters. Não obter URLs de
`.env`. O teste novo valida as três antes de importar serviços/configuração ou
criar pools, e impede carregamento dotenv. Confirmar previamente o destino no
processo antes da regressão completa, pois as suítes antigas têm inicialização
própria; manter `DOTENV_CONFIG_PATH=NUL` para toda a execução.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
# Definir explicitamente as três variáveis autorizadas nesta sessão.
$env:DOTENV_CONFIG_PATH = 'NUL'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/queue-entry.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Revisar falha E07.1 antes da regressão.' }
npm.cmd run test:integration
```

Fixtures têm eventos/usuários UUID próprios e limpeza transacional limitada a
esses IDs, na ordem das FKs, inclusive idempotência. Não removem dados externos
ao conjunto criado. Pools são encerrados mesmo com erro na limpeza.

## Encerramento da E07.1 — revalidação concluída em 30/10/2026

Após as correções pós-auditoria, o responsável informou que revalidou a **versão
corrigida**, incluindo os testes fortalecidos e o cenário adicional de corte,
exclusivamente em `127.0.0.1:55432/arenago_events_test`, com os resultados:

| Verificação da versão corrigida | Executor | Resultado final |
| --- | --- | --- |
| Testes específicos E07.1 | Responsável | **21/21 aprovados**, zero falhas, cancelamentos ou testes ignorados. |
| Regressão completa PostgreSQL | Responsável | **129/129 aprovados**, zero falhas, cancelamentos ou testes ignorados. |
| Testes unitários | Codex, na rodada corrigida anterior | **108/108 aprovados**, zero falhas, cancelamentos ou testes ignorados, exit 0. |
| Typecheck, lint e build | Codex, na rodada corrigida anterior | Aprovados, exit 0 em cada comando. |

Os resultados PostgreSQL finais pertencem exclusivamente à execução do
responsável; não são execuções do Codex nem do auditor. Complementam, sem
substituir, os registros iniciais de não execução PostgreSQL pelo Codex e os
resultados anteriores de 20/20 e 128/128. A pendência de revalidação da versão
corrigida está concluída conforme esse relato.

A auditoria independente anterior identificou **um P2 e três P3**, tratados com
reforço de testes e documentação, sem P0/P1 ou defeito funcional confirmado no
serviço E07.1. Não se atribui uma nova auditoria independente a este encerramento.
E07.1 permanece restrita ao ingresso; C-15 e a saída futura E07.3 foram preservadas.

Neste fechamento foram atualizados somente este documento, os trechos necessários
do planejamento e o diff da entrega contra
`bb6df2d8152a03c4ee029e442a5a1feda8862dfc`. Nenhum código ou teste foi alterado,
nenhum teste foi reexecutado e nenhum `.env` ou banco foi acessado. Sem migrations,
remoção de arquivos, staging, commit ou push. O checkout auxiliar
`audit-1647dd6/` é estranho à E07.1, foi preservado e deve ficar fora do commit.

## Riscos e referências para próximas etapas

- A revalidação dos 21 testes específicos corrigidos e da regressão completa
  foi concluída pelo responsável, com 21/21 e 129/129 aprovados. Os resultados
  históricos 20/20 e 128/128 continuam separados dos resultados finais.
- Revisar especialmente a ordem ampliada de locks: evento → experiência →
  estação → participação → idempotência/entradas → testemunha Staff. Novos
  escritores de disponibilidade/roles devem coordenar pelo evento primeiro.
  A proteção de testemunhas pode aguardar updates de conta e revogação por
  transações curtas; ela não proíbe revogar o último Staff.
- Validar as bordas temporais após espera, atomicidade entre contador/entrada/
  ponteiro/idempotência e independência entre experiências no PostgreSQL real.
- TTL, retenção/expurgo e conversão pública dos resultados para HTTP permanecem
  fora desta entrega. Replay representa resultado original, não estado atual.

Sem commit, push, PR ou merge. Conferência de fechamento concluída; staging e
commit permanecem sob controle do responsável.
