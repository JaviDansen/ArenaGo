# ArenaGo — entrega E05

Data: 28/10/2026. Branch: `feature/events-participations`. Base inspecionada: `cdb5247`.

## Implementação e contrato interno

`ParticipationsService.setExternalQueueEnabled(eventId: string, enabled: boolean)` retorna
`Promise<SetExternalQueueEnabledResult>`. O tipo exportado distingue:

| `kind` | Significado e campos adicionais |
| --- | --- |
| `event_not_found` | Evento não encontrado; nenhuma escrita. |
| `blocked` | Nenhuma escrita; `availability` contém o resultado das guardas existentes. |
| `unchanged` | Estado já persistido; `eventId`, `externalQueueEnabled`, `releasedCount: 0`. |
| `changed` | Alteração concluída; `eventId`, `externalQueueEnabled`, `releasedCount`, `changedAt`. |

É um contrato interno de domínio, sem controller ou autorização HTTP implícita.
Nenhuma interface de ingresso/leitura foi alterada. Não foram criadas migrations.

## Transação e ordem de locks

Cada chamada abre uma única transação PostgreSQL `READ COMMITTED`, na conexão Drizzle
existente. A ordem é:

1. `events FOR UPDATE` no evento solicitado.
2. Se o evento não existe, retorna `event_not_found`. Se a configuração já corresponde
   ao pedido, retorna `unchanged`, sem novo relógio, atualização ou efeito de domínio.
3. Ao desligar, bloqueia as participações desse evento ainda `waiting`, com
   `FOR UPDATE` em UUID crescente. Não usa `SKIP LOCKED` nem liberação individual FIFO.
4. Obtém `clock_timestamp()` após os locks e valida o instante retornado. Usa o mesmo
   padrão de epoch em milissegundos/`Date` da E03.
5. Reutiliza `EventsService.evaluateEventAvailabilityById()` com o executor da mesma
   transação: prontidão/capacidade, início inclusivo, corte oficial/Admin exclusivo,
   estados `closing`/`closed`. A hora operacional residual não estende esse corte.
6. Atualiza `events.external_queue_enabled` e `updated_at`. Ao desligar, um único
   UPDATE muda `waiting → active` e preenche `arena_entered_at` com o instante decisivo
   comum. O predicado inclui o evento e `status = 'waiting'`.
7. COMMIT publica as duas alterações juntas. Exceções abortam toda a transação.

Não é necessário bloquear usuários, perfis ou questionários nesta operação. A ordem
evento → participações é compatível com os fluxos que adquirem o lock de evento antes
de chegar às participações. A consulta de disponibilidade também usa a transação,
sem recorrer à conexão raiz.

Repetições são no-op inclusive após o corte. Mudanças reais nos dois sentidos exigem
que o evento ainda aceite ingressos; não reabrem eventos nem executam encerramentos.

## Histórico, E03 e E04

A atualização das participações contém somente `status` e `arena_entered_at`.
Preserva IDs, `joined_at`, ordens históricas, snapshots, ponteiros e campos de
finalização. `active`, `finished` e `canceled` ficam intactos, assim como outros eventos.
O contador `external_last_order` não é zerado ou alterado pela E05.

Reativar modifica somente o evento. Os ingressos seguintes continuam passando pela
E03: com fila desligada são `active`, com `arena_entered_at` preenchido e sem nova
ordem externa; após reativar voltam a ser `waiting`, com o contador FIFO continuado.
Participações liberadas permanecem `active`.

As leituras E04 não foram duplicadas ou modificadas. Após o commit, as consultas
atual e por ID devolvem `active`, `arenaEnteredAt` preenchido e `externalQueue: null`.
Não são criados atendimentos, ausências, entradas internas ou avaliações.

## Concorrência e limites

E03 e E05 disputam o mesmo `events FOR UPDATE`. Se E03 confirmar primeiro, o novo
`waiting` faz parte da liberação. Se E05 confirmar primeiro, E03 lê a fila desligada
e cria diretamente `active`. Alternâncias administrativas também se serializam;
uma segunda desativação observa o estado já aplicado e não regrava timestamps.

O relógio só é lido após eventuais esperas pelos locks de evento e participação.
A decisão usa o tempo do banco; o commit ocorre posteriormente. Os escritores
futuros de fechamento, capacidade e participações devem respeitar os protocolos
de locks do projeto. Na sessão original de 28/10/2026, a validação de concorrência
com PostgreSQL real ficou pendente; os unitários não comprovam essas garantias.
O histórico posterior e a validação pós-auditoria estão registrados abaixo.

## Arquivos

- Modificado: `backend/src/participations/participations.service.ts` — contrato e operação E05.
- Criado: `backend/test/unit/external-queue.test.ts` — 5 testes unitários.
- Criado: `backend/test/integration/external-queue.integration.test.ts` — 10 testes originais e 1 novo teste de cleanup pós-auditoria (11 no arquivo atual).
- Criado: `docs/E05_IMPLEMENTACAO.md` — este relatório.
- Gerado: `qa-evidence/e05-changes.diff` — diff completo dos quatro arquivos acima, incluindo arquivos novos.

## Cobertura e validação original — 28/10/2026

| Verificação | Resultado nesta sessão |
| --- | --- |
| `npm.cmd run typecheck:test` | Aprovado, incluindo os novos testes de integração. |
| `npm.cmd test` | 84 testes aprovados: 79 anteriores + 5 novos. |
| `npm.cmd run lint` | Aprovado. |
| `npm.cmd run build` | Aprovado. |
| `git diff --check` e whitespace dos arquivos novos | Aprovados. |
| `npm.cmd run test:integration` | Não executado: conexão de teste autorizada indisponível. |

O `tsx` inicialmente falhou dentro da sandbox com `uv_os_get_passwd / ENOMEM`.
A execução autorizada fora da sandbox concluiu os 84 unitários com sucesso.
Nenhum teste unitário abriu conexão PostgreSQL.

Os 10 testes de integração originais cobrem os 14 cenários solicitados, agrupados:
liberação de três esperas; preservação de IDs, ingresso, snapshots e FIFO; horário
de entrada; estados active/finished/canceled intactos; ingresso direto; reativação;
repetição; rollback após ambas as gravações; ingresso concorrente nas duas ordens;
alternâncias concorrentes nas duas ordens e dupla desativação; impedimentos temporais
e administrativos; isolamento entre eventos; leituras E04. Também há casos para
evento ausente, fechamento durante espera por lock de evento e corte oficial durante
espera por lock de participação. A sincronização concorrente observa locks reais em
`pg_stat_activity`, e não presume ordem de execução por sleeps arbitrários.

## Banco e comando pendente

As três variáveis não estavam definidas no ambiente herdado. A inspeção sanitizada
de `.env` confirmou que `DATABASE_URL` e `DATABASE_DIRECT_URL` disponíveis não apontam
para o destino autorizado, e `EVENTS_TEST_DATABASE_URL` está ausente. Nenhuma URL ou
credencial foi exibida e nenhuma conexão real de teste foi aberta.

Antes de executar a integração no PowerShell, configure **nesta sessão do terminal**
as três variáveis para o banco descartável já preparado
`127.0.0.1:55432/arenago_events_test`, com suas credenciais locais. Não reutilize as
URLs atuais de outros ambientes. O arquivo novo valida as três URLs e reutiliza a
barreira contra redirecionamentos de host/porta/banco antes de criar pools.

Os comandos manuais com preflight das três URLs estão na seção pós-auditoria abaixo.

O script permanece `--test-concurrency=1`. Não foi executada preparação destrutiva,
migração, reset, TRUNCATE, ou acesso a `arenago_homologacao`, `arenago_dev` ou bancos remotos.
A limpeza dos testes novos remove somente os UUIDs criados por esse arquivo.

## Revisão pós-auditoria — 29/10/2026

A auditoria independente concluiu **SIM COM RESSALVAS**, sem defeito funcional
confirmado. Esta revisão trata somente as três lacunas P2 dos testes e as evidências.
`setExternalQueueEnabled()` e os cinco testes unitários E05 foram preservados.
O hash Git do serviço permanece `779bd3a327464e7091906bb8323865b2c93e6d84`.

### Correções e eliminação dos falsos positivos

- **Corte durante lock de participação:** identifica a conexão bloqueadora por
  `pg_backend_pid()` e verifica `pg_blocking_pids()`/`pg_stat_activity`. Na mesma
  observação, exige `clock_timestamp() < official_ends_at`. O corte usa margem de
  15 segundos, com até 10 segundos para observar a espera; perder essa precondição
  causa falha, nunca aprovação ou skip. Mantém o lock até ultrapassar o corte,
  usando espera calculada pelo horário PostgreSQL, e confirma que a operação ainda
  está bloqueada. Observa, delegando à guarda real, o instante usado para decidir:
  deve ser posterior à observação imediatamente anterior ao desbloqueio. Exige
  evento existente, `blocked` com `EVENT_ENTRY_CLOSED` e snapshot integral intacto.
  Os intervalos de polling não são usados como prova de sincronização.
- **Rollback:** cria três waiting e exige resultado `changed` com três liberações.
  Antes da exceção, consulta pelo próprio `tx` a flag desligada e todos os IDs
  ativos, com horários preenchidos iguais a `changedAt`. Outra conexão deve ainda
  observar o snapshot anterior. Só então injeta a falha; depois compara o estado
  integral ao anterior. Um callback sem mutação ou com resultado `blocked` falha.
- **Cleanup:** usa transação própria e escopos de eventos, participações e usuários
  rastreados. Zera `current_queue_entry_id` antes de remover serviços, avaliações,
  entradas e snapshots; depois remove participações e demais pais na ordem das FKs.
  Inclui auditoria vinculada aos eventos. Qualquer falha reverte aquele escopo;
  outros escopos ainda são tentados. O hook agrega erros e aguarda o encerramento
  de ambos os pools com `Promise.allSettled`, inclusive quando a limpeza falha.
- **Regressão de cleanup:** acrescenta um único teste com entrada concluída,
  chamada pendente, dois atendimentos, avaliação, snapshot, auditoria e ponteiro
  circular. Verifica a remoção do grafo alvo e dos dados próprios de conta/perfil,
  jogos, versão e idempotência. Compara integralmente o grafo de outro evento
  sentinela e confirma que sua participação continua consultável. Os dois escopos
  ficam registrados no hook final mesmo se a preparação ou uma asserção falhar.
- **Casts SQL:** os casts `$2::varchar(20)` da fixture de estados já estavam no
  arquivo ao iniciar esta revisão. Foram preservados e incluídos no diff atualizado;
  o artefato anterior ainda mostrava a versão sem os casts. Nenhuma expectativa
  foi reduzida.

### Rastreabilidade das execuções

Após a sessão original, o responsável informou **98 testes de integração aprovados,
incluindo os 10 E05**. Esse resultado anterior não foi reproduzido pela auditoria
somente de leitura nem por esta revisão. O arquivo agora contém 11 testes; não se
atribui uma nova contagem aprovada à suíte de integração sem executá-la.

| Verificação executada em 29/10/2026 | Resultado |
| --- | --- |
| `npm.cmd test` | 84 aprovados, zero falhas/skips. A primeira tentativa na sandbox falhou em `uv_os_get_passwd / ENOMEM` antes dos testes; a mesma execução fora da sandbox passou. |
| `npm.cmd run typecheck:test` | Aprovado após corrigir a tipagem explícita do array de IDs no teste de rollback. |
| `npm.cmd run lint` | Aprovado. |
| `npm.cmd run build` | Aprovado. |
| `git diff --check` e inspeção de whitespace dos arquivos da entrega | Aprovados. |
| Integração PostgreSQL | Não executada: `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL` ausentes no processo. Nenhum pool de integração foi aberto. |

Arquivos alterados nesta revisão: teste de integração, este documento e
`qa-evidence/e05-changes.diff`. O diff é o pacote completo E05 contra `cdb5247`,
incluindo o serviço e o unitário preexistentes, sem novas alterações nesses dois.

### Execução manual pendente

No PowerShell, configure explicitamente as três variáveis com suas credenciais
locais para `127.0.0.1:55432/arenago_events_test`. Não reutilize outro destino nem
conte com fallback de `.env`. O preflight abaixo não abre conexão nem imprime URLs:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
# Configure DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL nesta sessão.
$preflight = @'
const { assertSafeTestDatabase } = require("./test/integration/test-db-guard.ts");
for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"]) {
  const url = new URL(assertSafeTestDatabase(process.env[name]));
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/arenago_events_test") {
    throw new Error(`${name}: destino não autorizado.`);
  }
}
console.log("Três URLs validadas para 127.0.0.1:55432/arenago_events_test.");
'@
node --import tsx --input-type=commonjs -e $preflight
if ($LASTEXITCODE -ne 0) { throw 'Preflight rejeitado; integração não iniciada.' }
npm.cmd run test:integration
```

Permanece pendente comprovar em PostgreSQL os testes alterados e o novo cleanup.
O teste temporal leva aproximadamente 15 segundos; atrasos que impeçam observar
a espera antes do corte geram falha explícita de precondição. Não houve execução
de migrations, DROP, TRUNCATE, reset, integração em outro banco, commit, push, PR
ou merge nesta revisão.

## Dependências seguintes

A API Admin depende de autenticação Admin/TOTP, validação de justificativa e auditoria
atômica. Antes de expor a operação em HTTP, será necessário compor a alteração de
domínio e a auditoria na mesma transação, seguindo o padrão de executor transacional
já usado no projeto. O método atual possui a própria transação e não implementa
esse contrato administrativo completo.

Encerramentos E07/E08/E09/E11, alterações em Auth/perfil e integração do aplicativo
permanecem fora desta entrega. Não houve commit, push, PR ou merge.

## Encerramento documental da E05 — validações posteriores

### Validação PostgreSQL após a auditoria e as correções

Posteriormente à implementação original e à revisão pós-auditoria registradas
acima, o responsável executou e informou a aprovação dos **11 testes de integração
da E05** no PostgreSQL local autorizado
`127.0.0.1:55432/arenago_events_test`, com **zero falhas e zero testes ignorados
(skips)**. Essa validação inclui os testes corrigidos e o teste adicional de cleanup.

### Encerramento definitivo da entrega E05

Com essa validação posterior informada pelo responsável, fica concluída a pendência
PostgreSQL da entrega E05 após as correções de auditoria. A implementação já havia
sido versionada na branch `feature/events-participations` antes deste encerramento
documental. Os registros originais de integração pendente permanecem como histórico
das respectivas sessões; não representam uma pendência atual da entrega validada.
As dependências futuras de autenticação, auditoria administrativa e demais etapas
continuam sendo as descritas neste relatório.

### Regressão posterior à implementação da E06

Após a implementação da E06, o responsável executou e informou a aprovação da
regressão completa mais recente no mesmo PostgreSQL autorizado:

| Validação posterior executada pelo responsável | Resultado informado |
| --- | --- |
| Regressão completa de integração após a E06 | 108/108 aprovados, zero falhas e zero testes ignorados (skips). |
| Testes E05 incluídos nessa regressão | 11 testes aprovados. |
| Testes E06 incluídos nessa regressão | Nove testes aprovados. |

Os 108 testes correspondem à regressão completa do backend, não exclusivamente
à E05. Conforme a regressão relatada, a E05 permaneceu compatível com as
funcionalidades anteriores e com a E06 nos cenários exercitados.

A execução de **84 testes unitários** registrada nas sessões anteriores corresponde
à entrega E05. A suíte atual contém **90 testes unitários** após a inclusão dos
seis unitários da E06; essa ampliação não altera a contagem histórica da E05.

### Atribuição dos resultados e rastreabilidade

Os resultados PostgreSQL desta seção foram **executados e informados pelo
responsável**, não pelo Codex nesta rodada. As execuções próprias do Codex nas
sessões anteriores continuam identificadas nas respectivas tabelas. Neste
encerramento exclusivamente documental, o Codex não executou testes nem abriu
conexões com bancos.

Foram atualizados somente `docs/E05_IMPLEMENTACAO.md` e o trecho documental de
`qa-evidence/e05-changes.diff`. O artefato mantém sua finalidade de evidência E05
em relação à base original `cdb5247`: seus trechos de código e testes foram
preservados integralmente, sem incorporar código ou testes da E06. Nenhum arquivo
da E06 foi alterado. Não houve alteração de código, testes, contratos ou regras de
negócio, nem execução de migrations, commit, push, PR ou merge nesta rodada.
