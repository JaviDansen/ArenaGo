# E08.3 — HTTP de consulta das experiências

Base: `cb8045562da4d96cf2807e44ddc0c0fedf1bbaaa`, branch
`feature/events-participations`. Antes da implementação, conferidos branch, HEAD,
status limpo e commit E08.2 `cb80455`. O relatório E08.2 versionado registra
22/22 HTTP e 285/285 PostgreSQL aprovados manualmente, além dos 232 unitários
anteriores. Esses resultados são históricos e não aprovam antecipadamente E08.3.
Estado inicial registrado em
`%TEMP%/arenago-e083-before-e27d71f9188b4e66994846f5c977166f/snapshot.json`.

## Contrato HTTP efetivo

`GET /api/v1/events/:eventId/experiences`, registrado em `EventsModule` por
`ExperiencesController`. Exige `RequireSessionAuth`, obtém o ator exclusivamente
de `CurrentUserId` e valida/normaliza o UUID com os validadores HTTP existentes.
Não exige Staff nem introduz proibição para Admin jogar; segundo fator Admin
continua obrigatório pela autenticação existente.

O controller delega exclusivamente a
`ExperiencesService.getEventExperiences(userId, eventId)` da E06. A participação
deve ser `active` e pertencer ao usuário no mesmo evento. Evento ausente,
participação ausente, não ativa ou de outro evento retornam o mesmo 404
`RESOURCE_NOT_FOUND`, sem confirmar a existência do recurso.

Sucesso 200, sem discriminante interno `kind`:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440101",
  "observedAt": "2026-11-03T15:00:00.000Z",
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

O controller seleciona explicitamente os campos públicos em todos os níveis,
sem recalcular disponibilidade ou contagens. `observedAt` é Date fornecida pela
E06 e serializa em ISO UTC. `waitingCount` permanece inteiro seguro validado no
serviço; não há posições individuais, nomes/e-mails de participantes, identidades
Staff, snapshots, credenciais ou listas de pessoas no JSON.

Sem experiências, responde 200 com `experiences:[]` e indicador global false,
conforme o contrato real E06. Sem estações, a experiência retorna `stations:[]`
e não recebe novas entradas; outra experiência apta pode manter o indicador
global true. Uma estação `available` pode estar ocupada por atendimento pending:
o campo expressa configuração, não desocupação. Uma fila por experiência continua
compartilhada pelas estações, sem multiplicação da contagem.

Durante a janela residual, a leitura autorizada conserva os dados existentes,
com novos ingressos bloqueados conforme E06. Essa observação não reserva vaga;
o POST E08.2 continua revalidando todas as condições na transação de mutação.

## Consistência, ausência de efeitos e erros

Preservada a implementação SQL E06: `REPEATABLE READ READ ONLY`, autorização e
dados no mesmo snapshot, relógio PostgreSQL da primeira consulta, contagem apenas
de `waiting` e agrupamento antes do join de estações. O controller não cria outra
consulta ou serviço, não limpa linhas nem modifica filas, participações, estações,
contadores ou idempotência.

Não há `Idempotency-Key`, TTL novo, expiração ou idempotência no GET. As duas
configurações já obrigatórias, `STAFF_IDEMPOTENCY_TTL_SECONDS` e
`PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS`, continuam necessárias quando o
processo inicia `AppModule`/`EventsModule`, devido aos providers dos POSTs existentes.

| HTTP | Tratamento |
| --- | --- |
| 400 | UUID inválido: `VALIDATION_ERROR` pelo validador compartilhado |
| 401 | Códigos atuais de Bearer, sessão, conta e segundo fator Admin |
| 404 | `access_denied` vira `RESOURCE_NOT_FOUND`, sem detalhes de titularidade/evento |
| 500 | Filtro RFC 7807 existente retorna erro genérico, sem SQL ou dados sensíveis |

## Falha de DI comprovada e correção mínima

Antes da correção, o teste com providers reais de `EventsModule` sob
`tsx --tsconfig tsconfig.test.json` aprovou os nove cenários HTTP simulados e
falhou na asserção de identidade de `ExperiencesService.eventsService` com
`app.get(EventsService)`. O banco e o controller já eram injetados, mas a segunda
dependência do serviço E06 usava somente metadados automáticos. A classificação
é erro de ligação de dependências de produção sob esse runner, sem divergência
de regra de negócio ou de expectativa do teste.

Foi adicionado somente `@Inject(EventsService)` ao parâmetro existente de
`ExperiencesService`. O teste permanece com a mesma asserção e verifica também
o mesmo banco Drizzle real nos serviços e zero conexões no Pool: não chama
`init/listen` nesse teste de DI. Nenhum SQL, regra de autorização, prontidão,
contagem ou isolamento da E06 foi alterado. Serviços E07.1–E07.6 permanecem intactos.

## Testes e resultados efetivamente executados

- **242/242 unitários aprovados**, zero falhas, cancelamentos ou skips: 232
  anteriores e 10 novos de HTTP/DI em `experiences-http.test.ts`.
- **10/10 focados aprovados** após a correção de DI, executados novamente com
  `tsx --tsconfig tsconfig.test.json` e a asserção original preservada.
- Os novos testes cobrem sessão/ator sem Staff, UUID inválido/normalizado,
  serialização de datas, resposta com experiências/vazia, recusa neutra, erro
  inesperado, lista exata de campos, preservação de contagens/indicadores e DI real.
- Typecheck (`npm run typecheck:test`), lint (`npm run lint`) e build
  (`npm run build`) aprovados, exit 0, incluindo a compilação da suíte PostgreSQL.
- Sem acesso PostgreSQL, solicitação de credenciais ou leitura de `.env` pelo
  agente. Unitários usaram URL fictícia sem conexão, `DOTENV_CONFIG_PATH=NUL` e
  ambos os TTLs explícitos. `tsx` foi executado fora da sandbox devido à limitação
  `uv_os_get_passwd` já conhecida no ambiente.

## PostgreSQL real — aprovação manual em 03/11/2026

O responsável confirmou a execução no PostgreSQL local e a aprovação da E08.3
após a implementação e a correção pontual de DI registradas acima:

| Suíte | Executados | Aprovados | Falhas | Cancelamentos | Ignorados |
| --- | --- | --- | --- | --- | --- |
| HTTP PostgreSQL E08.3 | 23 | 23 | 0 | 0 | 0 |
| Regressão PostgreSQL completa | 308 | 308 | 0 | 0 | 0 |

Resultados atribuídos exclusivamente à execução manual do responsável. Permanecem
válidos os resultados anteriores do Codex: **242/242 unitários**, **10/10 focados**,
typecheck, lint e build aprovados. A validação PostgreSQL desta entrega está
concluída; não há testes de integração pendentes. Não houve validação de produção.
Esta finalização alterou somente este relatório e o único arquivo de evidência,
preservando código, testes, schema e dependências já validados. Nenhum teste
adicional foi executado nesta rodada documental.

### Cobertura validada e procedimentos de reprodução

Os **23 testes HTTP Supertest + PostgreSQL real** foram aprovados manualmente,
sem execução PostgreSQL pelo agente, em
`test/integration/experiences-http.integration.test.ts`. Cobrem os 18 grupos
solicitados e casos adicionais relevantes da E06:

- Ativo do próprio evento, Bearer ausente, sessão revogada/expirada, token expirado,
  waiting externo, finished/canceled, outro evento, nenhuma participação e evento
  inexistente; UUID inválido e maiúsculo; Admin com/sem segundo fator.
- Múltiplas experiências ordenadas por UUID, nomes repetidos, ausência de estações,
  lista vazia, várias estações sem multiplicar a fila; exclusão de called/closed,
  estação disponível ocupada e inteiro seguro no JSON.
- Estação indisponível, fila pausada, cortes oficial/Admin, janela residual, evento
  futuro e revogação Staff: mantêm leitura/contagens e bloqueiam novas entradas.
- Privacidade com pessoas, Staff e snapshot de perfil realmente persistidos;
  seleção fechada de campos, sem vazamento de nomes privados, e-mails ou IDs de pessoas.
- Leituras repetidas verificam `transaction_isolation=repeatable read` e
  `transaction_read_only=on` na transação real e comparam estado persistido antes/depois,
  incluindo dados de domínio, contas/sessões, idempotência e snapshots.
- Dois cenários sincronizam commits reais em outra conexão entre leituras da E06:
  um muda fila/estação/configuração/Staff; outro remove o acesso active. O mesmo
  GET deve manter a visão anterior, e o próximo GET observar o commit, inclusive 404
  após perda de acesso. A sincronização envolve o método real de avaliação e é
  restaurada em `finally`; nenhuma consulta PostgreSQL ou resposta é substituída
  por mock, e as escritas concorrentes pertencem ao fixture, não ao GET.

As fixtures foram conferidas contra schema e constraints: estados terminais
preenchem seus campos, parâmetros reutilizados têm tipos explícitos, há uma única
sessão por usuário e o segundo fator Admin é preparado nessa sessão; timestamps
obrigatórios são fornecidos, e a versão do questionário usa prefixo `e83-` para
respeitar `varchar(40)`. A revisão estática não substitui a validação real.
Nenhuma expectativa foi relaxada para obter aprovação. Falhas reais futuras devem
ser investigadas por instrução/fase e confrontadas com schema e contrato antes
de qualquer correção, conforme a regra solicitada.

Preflight exige as três URLs idênticas, exclusivamente
`127.0.0.1:55432/arenago_events_test`, sem parâmetros; nunca usa `.env` ou Neon.
Limpeza transacional é limitada aos UUIDs das fixtures. Sem migration, seed ou reset.
Regressão completa aprovada manualmente: **308/308 testes** (285 anteriores + 23
novos), sem falhas, cancelamentos ou ignorados. A aprovação refere-se às suítes
locais informadas pelo responsável, sem declaração de validação de produção.

Comandos de reprodução para o responsável, substituindo apenas os placeholders locais:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$env:EVENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/arenago_events_test'
$env:DATABASE_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DATABASE_DIRECT_URL = $env:EVENTS_TEST_DATABASE_URL
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/experiences-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Investigar HTTP E08.3 antes da regressão.' }
npm.cmd run test:integration
if ($LASTEXITCODE -ne 0) { throw 'Investigar falhas da regressão PostgreSQL.' }
```

## Arquivos, evidência e limites

| Arquivo | Alteração |
| --- | --- |
| `backend/src/events/experiences.controller.ts` | Rota GET, autenticação, UUID, recusa neutra e campos públicos |
| `backend/src/events/events.module.ts` | Registra o controller |
| `backend/src/events/experiences.service.ts` | Somente token explícito de DI |
| `backend/test/unit/experiences-http.test.ts` | 10 testes HTTP/DI novos |
| `backend/test/integration/experiences-http.integration.test.ts` | 23 testes PostgreSQL HTTP novos, aprovados manualmente |
| `docs/ARQUITETURA_BACKEND_ARENAGO.md` | Nota de implementação atual na §16.3 |
| `docs/E08_3_IMPLEMENTACAO.md` | Este relatório |

A arquitetura mistura contratos propostos e registros históricos. A nota na §16.3
explicita a implementação atual e remete à E06, sem consolidar outros capítulos
ou alterar decisões de produto. Não foi encontrada divergência que exija mudança
de negócio nesta task. Nenhuma auditoria geral da E08 foi executada.

Única evidência: `qa-evidence/e08-3-changes.diff`, completa contra o commit-base,
incluindo arquivos novos ainda não rastreados. Aplicação verificada em cópia
isolada da base e resultado comparado aos arquivos finais, com normalização Git
de linhas. Exclui `.diff`, credenciais, `.env`, dependências instaladas, temporários
e alterações E08.1/E08.2 ou de outras tasks. Índice e histórico não são alterados.

Sem novas dependências, migrations, telas, endpoints Staff/Admin, finalização,
avaliações, WebSocket/polling/notificações ou refatoração geral. Não foi criada
outra política de TTL. Próxima task não iniciada. **Sem `git add`, commit, push,
merge ou rebase**: versionamento fica exclusivamente com o responsável.
