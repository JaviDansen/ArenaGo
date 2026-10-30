# ArenaGo — entrega E06

Data: 29/10/2026. Branch: `feature/events-participations`. Base: `24ecf02`.

## Resultado e decisões do contrato

A E06 implementa a consulta interna das experiências e estações de um evento para
um usuário com participação `active` nesse mesmo evento. Mostra a quantidade de
entradas internas em espera e se cada experiência pode receber novas entradas.
A consulta continua disponível aos ativos após o corte, inclusive na margem residual.

O contrato usa uma união discriminada por `kind`, consistente com os resultados de
domínio das E03/E05. O sucesso acrescenta `kind: "ok"` à estrutura sugerida na tarefa;
a recusa retorna somente `{ kind: "access_denied" }`. Não distingue evento ausente,
participação inexistente, estado não ativo ou participação em outro evento.

O indicador **global** `acceptingNewQueueEntries` significa que existe pelo menos
uma experiência apta. Assim, retorna `false` quando todas as filas estão pausadas,
quando nenhuma experiência tem estação disponível ou quando a coleção está vazia,
mesmo que as demais condições globais do evento estejam satisfeitas. O indicador
individual exige também todas as condições globais. Essa semântica explicita a
diferença entre a configuração de uma fila e sua capacidade de receber entradas.

## Serviço e tipos

`ExperiencesService.getEventExperiences(userId: string, eventId: string)` retorna
`Promise<EventExperiencesResult>`. O serviço é provider exportado de `EventsModule`,
que já integra o aplicativo. Não foram criados controller, rota nem guard HTTP.
O chamador interno deve fornecer um `userId` confiável; o método não autentica tokens.

Tipos exportados de `experiences.types.ts`:

- `ExperienceStationState`: `id`, `label`, `available`.
- `ExperienceState`: `id`, `name`, `acceptingNewQueueEntries`, `waitingCount`, `stations`.
- `EventExperiencesState`: `eventId`, `observedAt`, indicador global e `experiences`.
- `EventExperiencesResult`: sucesso com os dados acima ou recusa sem dados adicionais.

Exemplo de sucesso serializado:

```json
{
  "kind": "ok",
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "observedAt": "2026-10-29T15:00:00.000Z",
  "acceptingNewQueueEntries": true,
  "experiences": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440301",
      "name": "Just Dance",
      "acceptingNewQueueEntries": true,
      "waitingCount": 3,
      "stations": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440401",
          "label": "Estação 1",
          "available": true
        }
      ]
    }
  ]
}
```

`observedAt` é `Date` no serviço e serializa em ISO 8601. `waitingCount` é `number`
inteiro não negativo e seguro: o SQL retorna a contagem decimal em texto, validada
antes da conversão. Valores inválidos ou acima de `Number.MAX_SAFE_INTEGER` geram
erro, sem arredondamento silencioso. Nenhum `bigint` é retornado.

## Contagem, disponibilidade e ordenação

Uma CTE agrupa `queue_entries` por `experience_id`, filtrando simultaneamente o
evento solicitado e `status = 'waiting'`. A agregação ocorre antes do join de estações,
evitando multiplicar contagens. Experiências sem entradas têm `waitingCount = 0`.
Não contam fila externa, participações sem entrada, entradas `called`/`closed` ou
atendimentos concluídos. Há somente uma contagem por experiência.

`EventsService.evaluateEventAvailabilityById(eventId, observedAt, tx)` é reutilizado
sem alterações: verifica configuração/prontidão, Staff vigente do evento com conta
ativa e e-mail verificado, alguma estação disponível no evento, início inclusivo,
corte oficial/Admin exclusivo e estado administrativo. `closing` e `closed` impedem
novas entradas. Os prazos operacional e Admin residuais nunca estendem o corte.

Cada experiência aceita novas entradas quando a disponibilidade global permite,
`queue_accepting_entries = true` e pelo menos uma de suas estações tem
`availability = 'available'`. A indisponibilidade de uma experiência não bloqueia
as demais aptas. O serviço não avalia ocupação: uma estação `available` com chamada
pendente continua sendo apresentada como disponível na configuração. Não há novos
estados de estação nem alteração em filas, participações ou contadores.

A ordenação é `experiences.id ASC`, seguida de `stations.id ASC`, usando a comparação
UUID do PostgreSQL. Um `Map` mantém essa ordem ao agrupar as linhas. Nomes/labels
repetidos não introduzem empates; experiências sem estações retornam `stations: []`.

## Titularidade, privacidade e consistência

A primeira consulta exige simultaneamente `participations.user_id = userId`,
`event_id = eventId` e `status = 'active'`. Sem esse registro, termina com recusa
neutra antes de consultar disponibilidade ou estrutura do evento. Participações
`waiting`, `finished` e `canceled` não autorizam a leitura interna. Não é aceito
um ID de participação fornecido pelo chamador como substituto de titularidade.

A resposta é construída por seleção explícita de campos operacionais. Não inclui
nomes/e-mails de participantes, identidades de Staff, listas de fila, snapshots,
respostas de questionário, tokens ou dados de outros eventos. Os identificadores
retornados são apenas os do evento, experiências e estações.

Toda a operação usa uma transação PostgreSQL **REPEATABLE READ READ ONLY** na
mesma conexão Drizzle. A autorização estabelece o snapshot compartilhado também
pela leitura de evento, Staff, capacidade, experiências, estações e contagens.
O relógio vem de `statement_timestamp()` nessa primeira consulta, convertido de
epoch em milissegundos para `Date`, com validação. Não se usa o relógio do aplicativo.

São cinco SELECTs no caminho de sucesso: acesso/relógio, evento, Staff, estação
global e estrutura/contagens. O número é constante; não há N+1 por experiência.
Não há locks explícitos de linha nem instruções de gravação. `READ ONLY` também
impede gravações acidentais no banco pela transação. Locks normais de leitura de
relação do PostgreSQL continuam existindo.

O snapshot pode ficar desatualizado durante ou após a consulta. Mudanças confirmadas
depois de seu estabelecimento aparecem na próxima chamada, incluindo perda de
acesso, revogação de Staff e alterações de fila. O relógio representa o começo da
observação, não a hora de envio da resposta. Nenhum indicador reserva vaga ou
autoriza uma mutação futura, e não se promete atualização em tempo real.

## Arquivos da entrega

| Arquivo | Alteração |
| --- | --- |
| `backend/src/events/experiences.service.ts` | Novo serviço interno E06. |
| `backend/src/events/experiences.types.ts` | Novos contratos de domínio. |
| `backend/src/events/events.module.ts` | Registra e exporta `ExperiencesService`. |
| `backend/test/unit/experiences.test.ts` | 6 testes unitários novos. |
| `backend/test/integration/experiences.integration.test.ts` | 9 testes PostgreSQL novos, com cenários agrupados. |
| `docs/E06_IMPLEMENTACAO.md` | Este relatório. |
| `qa-evidence/e06-changes.diff` | Diff completo dos seis arquivos acima contra a base, incluindo arquivos novos. |

## Cobertura e validação original — 29/10/2026

| Verificação em 29/10/2026 | Resultado |
| --- | --- |
| `npm.cmd run typecheck:test` | Aprovado, incluindo a suíte de integração nova. |
| `npm.cmd test` | 90 aprovados, zero falhas/skips: 84 anteriores + 6 E06. |
| `npm.cmd run lint` | Aprovado. |
| `npm.cmd run build` | Aprovado. |
| `git diff --check` e whitespace dos arquivos novos | Aprovados. |
| `npm.cmd run test:integration` | Não executado: variáveis do banco autorizado ausentes. |

A primeira tentativa de `npm.cmd test` na sandbox falhou em
`uv_os_get_passwd / ENOMEM` antes de executar testes. A mesma execução autorizada
fora da sandbox concluiu os 90 testes. Os unitários usam cliente PostgreSQL simulado
e não abrem conexão real. Uma correção de tipagem do resultado SQL foi feita antes
da aprovação final do typecheck.

Os nove testes de integração agrupam os 19 cenários obrigatórios: titularidade e
isolamento; todos os estados de participação; múltiplas experiências/estações;
fila compartilhada; exclusão de `called`, `closed`, espera externa e serviços
concluídos; estação ocupada ainda configurada como disponível; perda/restauração
de capacidade; Staff revogado/inativo/não verificado/de outro evento; fila pausada;
cortes oficial/Admin e margem residual; coleção vazia; consultas sem escritas;
alterações entre consultas; ordenação com nomes repetidos e inserção inversa;
contrato com campos permitidos e ausência de dados privados.

Dois desses testes confirmam mudanças por outra conexão entre etapas da consulta:
um após a guarda de disponibilidade, outro após a autorização. As asserções exigem
o estado do snapshot antigo e o estado novo na consulta seguinte. Não usam sleeps
para presumir concorrência. A suíte nova tem UUIDs próprios, limpeza transacional
limitada às fixtures e encerramento dos dois pools mesmo se a limpeza falhar.
Não modifica expectativas, fixtures ou scripts das suítes K01/K03/K04/E03/E04/E05.

**Limite da evidência na sessão original:** os nove testes PostgreSQL foram escritos e passaram pelo
typecheck/lint, mas não foram executados. Portanto, a consistência e o SQL real
ainda dependem da validação no banco permitido; os unitários não a substituem.

## Segurança do banco e execução manual pendente

O preflight sanitizado confirmou `DATABASE_URL`, `DATABASE_DIRECT_URL` e
`EVENTS_TEST_DATABASE_URL` ausentes no processo. Os arquivos `.env` e `.env.neon.local`
têm URLs de destinos não autorizados para esta tarefa. Não foram exibidas URLs ou
credenciais, abertos pools reais nem acessados esses destinos.

Configure explicitamente as três variáveis na sessão PowerShell com as credenciais
locais do banco **já preparado** em `127.0.0.1:55432/arenago_events_test`. Não reutilize
os valores dos arquivos de ambiente. Execute então o preflight abaixo antes dos testes:

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
console.log("Três URLs validadas para o PostgreSQL de teste autorizado.");
'@
node --import tsx --input-type=commonjs -e $preflight
if ($LASTEXITCODE -ne 0) { throw 'Preflight rejeitado; integração não iniciada.' }
npm.cmd run test:integration
```

O preflight não importa a configuração do backend nem carrega `.env`. O teste novo
também valida as três URLs e rejeita parâmetros de redirecionamento antes de criar
pools. O script existente mantém `--test-concurrency=1`; não executar as suítes de
integração em paralelo. Não foram executados DROP, TRUNCATE, reset ou migrations.

## Dependências para E07, E14 e revisão

A E07 deverá revalidar titularidade, estado ativo, experiência do mesmo evento,
ausência de outra entrada interna corrente, relógio PostgreSQL após eventuais
esperas, cortes e capacidade dentro de sua própria transação de mutação. Deve
seguir os protocolos de locks/FIFO/idempotência do projeto; não confiar nos
indicadores informativos da E06 como autorização definitiva.

Para E14 e validação integrada posterior, permanece pendente executar esta suíte
e as regressões no PostgreSQL autorizado e validar a composição com as operações
futuras. Antes de exposição HTTP, será necessário obter o titular de autenticação
confiável e definir o mapeamento HTTP da recusa neutra. A E06 não implementa essa
camada, encerramento automático, entrada interna, chamada, confirmação, ausência,
CRUD, cache, polling, WebSocket ou push. E01–E05 foram preservadas.

O diff completo está em `qa-evidence/e06-changes.diff`; o artefato não inclui a si
próprio. Não houve commit, push, PR ou merge. Entrega local para revisão técnica e
auditoria, com a integração PostgreSQL expressamente pendente.

## Revisão pós-auditoria — 29/10/2026

A auditoria retornou **SIM COM RESSALVAS**, sem defeito funcional confirmado no
serviço. Esta revisão corrige somente os dois achados P2 de cobertura e o registro
P3 de validação. Foram modificados o unitário E06, a integração E06, este relatório
e `qa-evidence/e06-changes.diff`. Continuam sendo seis unitários E06 e nove testes
de integração E06; nenhuma expectativa anterior foi removida ou reduzida.

### Eliminação dos falsos positivos

- **U3 — configuração temporal:** a fixture deriva início e prazo operacional do
  encerramento oficial do cenário. O início padrão fica duas horas antes, e o prazo
  operacional uma hora depois; o início explícito do cenário continua preservado.
  A própria fixture exige prontidão estática válida. U3 exige exatamente um código
  de impedimento em cada cenário. Nos cortes exatos oficial/Admin, exige também
  `ready=true`, janela fechada e corte igual ao instante observado. O corte oficial
  não pode mais passar por configuração inválida. O início inclusivo mantém a
  aceitação e exige janela aberta e ausência de impedimentos.
- **I5 — cenários independentes:** antes de cada caso, a fixture restaura estado
  `open`, início passado, encerramento oficial futuro, prazo operacional válido e
  todos os campos de fechamento Admin nulos. Confirma então aceitação e uma espera
  existente. Só depois aplica o impedimento específico. Corte oficial e corte Admin
  são testados com estado `open`; `closing` e `closed` são testados dentro da janela
  temporal e sem corte Admin. As guardas devem retornar prontidão válida, o estado
  temporal esperado e exatamente o código daquele impedimento. O teste verifica
  os prazos residuais ainda futuros, preserva acesso ativo/contagem e compara o
  estado persistido integral antes e depois da consulta.
- **I2 — conteúdo dos campos permitidos:** participantes, Staff, espera externa e
  usuários do outro evento recebem nomes pessoais distintos e reconhecíveis. Os
  demais usuários da suíte têm nomes distintos associados ao UUID. O teste exige
  os nomes operacionais exatos das três experiências e os labels exatos de todas
  as estações retornadas. Também proíbe no JSON todos os nomes pessoais das fixtures,
  mantendo as verificações anteriores de IDs, ordem, campos permitidos, contagens,
  snapshots e isolamento. Substituir `e.name` por um nome de participante ou `s.label`
  por um nome de Staff viola tanto o valor operacional esperado quanto a proibição
  do nome pessoal. Não há proibição genérica de nomes próprios.

### Histórico posterior informado pelo responsável

Após a implementação original, o responsável informou os seguintes resultados para
a versão anterior às correções desta revisão:

| Validação informada pelo responsável | Resultado informado |
| --- | --- |
| Testes unitários | 90/90 aprovados. |
| Integração específica E06 | 9/9 aprovados em `127.0.0.1:55432/arenago_events_test`. |
| Regressão completa de integração | 108/108 aprovados no PostgreSQL autorizado. |
| Typecheck, lint e build | Aprovados. |

Esses resultados são atribuídos ao responsável, sem nova execução PostgreSQL pelo
agente nesta rodada. O registro original de indisponibilidade do banco foi mantido
acima. As aprovações anteriores não são apresentadas como validação dos testes
I2/I5 fortalecidos nesta revisão.

### Execuções efetivas desta revisão

| Verificação executada pelo agente em 29/10/2026 | Resultado |
| --- | --- |
| `npm.cmd test` | 90 aprovados, zero falhas/skips, incluindo os seis E06 com U3 corrigido. |
| `npm.cmd run typecheck:test` | Aprovado, incluindo os testes de integração modificados. |
| `npm.cmd run lint` | Aprovado. |
| `npm.cmd run build` | Aprovado. |
| Whitespace, diff completo e correspondência dos arquivos | Aprovados. |
| Integração específica E06 e regressão PostgreSQL | Não executadas: as três variáveis estão ausentes no processo. |

A primeira tentativa de unitários na sandbox falhou antes dos testes em
`uv_os_get_passwd / ENOMEM`. A execução autorizada do mesmo comando fora da sandbox
passou. Não foi usado fallback de `.env` para integrar, nem aberto pool PostgreSQL
real pelo agente nesta revisão.

`ExperiencesService`, `EventsService`, tipos e registro no módulo foram preservados.
Os hashes Git dos serviços permanecem, respectivamente,
`456e404ad6812fbfed5e181e275d7ba848ce1690` e
`2247d6e52993172ff0199ee9e28c74f8a519fe6c`. Não foram alterados E01–E05, Kaled,
contrato, autenticação ou migrations; não houve commit, push, PR ou merge.

### Execução manual pendente e riscos restantes

Permanece pendente executar os nove testes E06 com I2/I5 fortalecidos e a regressão
completa. Configure explicitamente as três variáveis no PowerShell para o mesmo
destino autorizado e execute o preflight da seção anterior. Depois, no diretório
`backend`, execute sequencialmente:

```powershell
npx.cmd tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/experiences.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração E06 falhou; revisar antes da regressão completa.' }
npm.cmd run test:integration
```

Não atribuir uma nova aprovação PostgreSQL à versão corrigida antes dessa execução.
Os limites de snapshot, atualização após a observação e revalidação pela E07 seguem
os já documentados. O diff atualizado contém a entrega E06 completa contra `24ecf02`,
incluindo os arquivos novos e este histórico; não inclui o próprio artefato.
