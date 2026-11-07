# ArenaGo — Integração Expo ↔ Backend, Etapa 3

## Escopo e estado

Foram preparados dois contratos HTTP autenticados para o ingresso real. A interface Expo e os fluxos demonstrativos permanecem para a Etapa 4. O código de autenticação, os serviços de domínio, o schema e as dependências não foram alterados. A execução local automatizada e a validação PostgreSQL ainda estão pendentes; este relatório não afirma que os endpoints foram homologados em dispositivo ou produção.

## Contratos definitivos

| Rota | Requisição | Resposta de sucesso |
| --- | --- | --- |
| `POST /api/v1/events/lookup` | `Authorization: Bearer <accessToken>`, JSON `{ "accessCode": "BEAST-2026" }` | HTTP 200, `{ "event": { "id", "name", "timezone", "startsAt", "officialEndsAt", "operationalDeadlineAt", "externalQueueEnabled" }, "eligibility": { "eligible", "blockingReasons" } }` |
| `POST /api/v1/participations` | Bearer, `Idempotency-Key: <chave>`, JSON `{ "eventId": "<UUID>" }` | HTTP 201, `{ "participationId": "<UUID>" }` |

A chave idempotente segue o validador HTTP existente: valor opaco, não vazio, até 128 caracteres, sem caracteres de controle, em um único cabeçalho. UUID é o formato recomendado para o cliente, mas a API aceita outras chaves opacas válidas. O corpo de ambas as rotas é estrito; `userId` e campos adicionais são recusados. O participante é identificado somente pelo Bearer validado pelo `SessionAuthGuard`.

Exemplo de consulta bem-sucedida:

```json
{
  "event": {
    "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "name": "Arena Exemplo",
    "timezone": "America/Sao_Paulo",
    "startsAt": "2026-11-07T12:00:00.000Z",
    "officialEndsAt": "2026-11-07T18:00:00.000Z",
    "operationalDeadlineAt": "2026-11-07T19:00:00.000Z",
    "externalQueueEnabled": true
  },
  "eligibility": { "eligible": true, "blockingReasons": [] }
}
```

O código é validado e normalizado por `normalizeEventAccessCode`; `EventsService.findByAccessCode` consulta por igualdade exata da coluna canônica. A resposta expõe apenas os campos necessários para confirmar o evento. Não há campo de localização no schema atual. `ParticipationsService.evaluateJoinEligibility` informa impedimentos sem escrever ou reservar uma vaga. O resultado pode mudar entre consulta e ingresso.

O ingresso chama `ParticipationsService.createParticipation`, que revalida elegibilidade, janela e disponibilidade dentro de uma transação PostgreSQL `READ COMMITTED`, na ordem de locks evento → usuário. A criação de participação, snapshot do perfil e conclusão da operação idempotente compartilham a transação. A fila externa inicia `waiting` quando habilitada; caso contrário, a participação inicia `active`. A rota retorna o identificador mínimo, sem fabricar posição na fila interna.

A expiração usa `ParticipantQueueIdempotencyPolicy`, já validada pelo backend, configurada por `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS`. Essa política evita uma segunda variável de TTL para operações do participante. Um replay concluído da mesma chave e do mesmo `eventId` devolve o HTTP 201 e o mesmo corpo. O serviço persiste a referência e o payload mínimo; a camada HTTP verifica sua consistência antes de responder. Chave igual com outro `eventId` retorna conflito; uma operação persistida em andamento retorna conflito específico. Não foi criado endpoint de criação por código: o cliente consulta o código e envia o UUID retornado.

## Erros

Todos os erros HTTP utilizam `application/problem+json` no formato RFC 7807, com `status`, `code`, `title`, `detail` e `type`. A falha inesperada de infraestrutura é convertida pelo filtro global em HTTP 500 `INTERNAL_SERVER_ERROR` sem expor detalhes internos.

| Condição | HTTP | `code` |
| --- | ---: | --- |
| Bearer ausente ou inválido | 401 | `MISSING_ACCESS_TOKEN` ou código de autenticação existente |
| JSON, código, UUID ou chave inválidos | 400 | `VALIDATION_ERROR` |
| Código ou evento inexistente | 404 | `EVENT_NOT_FOUND` |
| Conta inativa | 403 | `USER_INACTIVE` |
| Questionário, versão ou jogos incompletos | 422 | `PROFILE_INCOMPLETE` |
| Evento não iniciado, indisponível, encerrado ou participação corrente | 409 | motivo de domínio `EVENT_NOT_STARTED`, `EVENT_NOT_READY`, `EVENT_REGISTRATION_CLOSED` ou `PARTICIPATION_ALREADY_CURRENT` |
| Chave reutilizada com outro pedido | 409 | `IDEMPOTENCY_KEY_REUSED` |
| Operação idempotente ainda em andamento | 409 | `IDEMPOTENCY_IN_PROGRESS` |

Na consulta por código, elegibilidade desfavorável ainda produz HTTP 200 com `eligible: false` e todos os motivos. A tentativa definitiva de ingresso usa uma prioridade estável para escolher um único problema HTTP, preservando os motivos calculados pelo domínio. A validação da sessão ocorre na entrada HTTP; o serviço de ingresso existente não recebe um contexto adicional de revalidação transacional da sessão. Essa janela temporal é uma limitação preexistente a considerar em revisão de segurança futura, sem alterar o serviço nesta etapa.

## Arquivos da etapa

- `backend/src/participations/participant-admission.controller.ts`: rotas, validação e tradução dos resultados do domínio.
- `backend/src/participations/participations.module.ts` e `backend/src/app.module.ts`: registro das rotas e dependências.
- `backend/test/unit/participant-admission-http.test.ts`: contratos HTTP simulados, autenticação, erros, payload e replay.
- `backend/test/unit/participant-admission-db-guard.test.ts`: validação estática da guarda do banco dedicado.
- `backend/test/integration/participant-admission-db-guard.ts`: guarda restrita às três URLs idênticas de `arenago_admission_test`.
- `backend/test/integration/participant-admission-http.integration.test.ts`: cenários PostgreSQL reais preparados para leitura, estados inicial `waiting`/`active`, concorrência, replay, rollback, autenticação e isolamento da fixture.
- Este relatório e `qa-evidence/expo-backend-etapa3-changes.diff`.

## Validação e segurança PostgreSQL

Foram preparados 10 cenários PostgreSQL. **Nenhum foi executado pelo Codex**. A suíte exige um banco descartável exclusivo `arenago_admission_test` em `127.0.0.1:55432`, com schema atualizado, sem copiar dados de `arenago_events_test` ou de qualquer outro banco. A criação do banco, a aplicação manual das migrações e a execução da suíte dependem de autorização e preparação do responsável. Nenhuma credencial deve ser registrada no repositório. A guarda exige `NODE_ENV=test`, `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL` idênticas, protocolo PostgreSQL, usuário e senha explícitos, sem query ou fragmento. Antes de escrever, a suíte confere `current_database()` e exige zero usuários e eventos preexistentes. O cleanup limita as exclusões aos identificadores gerados pela própria suíte.

Após a preparação aprovada, o responsável pode definir as três URLs na sessão PowerShell, sem gravá-las em arquivo, e executar em `backend/`:

```powershell
$env:NODE_ENV = 'test'
# Definir as três URLs idênticas do banco dedicado na sessão, sem imprimi-las no terminal.
node.exe --import tsx --test --test-concurrency=1 test/integration/participant-admission-http.integration.test.ts
```

Conferir antes que as migrações necessárias já estejam aplicadas e que as demais variáveis de teste obrigatórias da configuração local estejam presentes. Não executar a suíte genérica `test:integration` com apenas esse banco: há outras suítes com guardas e bancos distintos. A regressão global PostgreSQL deverá ser planejada separadamente pelo responsável. Os bancos históricos `arenago_events_test`, `arenago_bootstrap_test`, `arenago_roles_test` e o banco remoto `arenago_dev` não são destinos desta suíte.

## Validações locais e próxima etapa

### Resultados locais desta campanha

Executados sem conectar a bancos: os 11 testes específicos (10 HTTP simulados e um teste da guarda), **11/11 aprovados**, zero falhas, zero skips, exit code 0. A regressão unitária completa cobriu 62 arquivos e aprovou **1.145/1.145**, sem falhas ou skips, exit code 0. Os 11 testes focados também estão incluídos nessa regressão e não devem ser somados novamente ao total.

Typecheck de produção (`tsc --noEmit --incremental false --project tsconfig.json`): aprovado, exit code 0. Typecheck de testes (`tsc --project tsconfig.test.json`): aprovado, exit code 0. ESLint (`npm run lint`): aprovado, exit code 0. Build NestJS: aprovado, exit code 0; foi direcionado a uma pasta temporária, com `deleteOutDir` desativado na configuração temporária, para preservar `backend/dist` e evitar interferir em eventual servidor local.

A primeira tentativa do runner `tsx` falhou antes de carregar os casos com `uv_os_get_passwd returned ENOMEM`, durante a consulta de identidade do sistema. A reexecução usou um preload temporário limitado ao processo do teste para fornecer a identidade usada pelo diretório de cache do `tsx`; não alterou arquivos do projeto. O teste HTTP também exige que o módulo de configuração valide `DATABASE_URL`; foi usada uma URL fictícia em `127.0.0.1:1`, sem conexão possível, e as URLs `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL` foram removidas do ambiente do processo. Nenhuma variável ou credencial de `.env` foi lida ou modificada.

A integração PostgreSQL continua pendente e deve ser executada somente pelo responsável no banco dedicado aprovado, após sua preparação manual. A suíte preparada contém 10 cenários; os resultados desta campanha não a validam.

Na Etapa 4, a tela Expo poderá consultar o código, exibir nome e horários reais, tratar os motivos de elegibilidade e solicitar confirmação. O cliente deverá gerar uma `Idempotency-Key` por intenção de ingresso, reutilizá-la nos retries da mesma intenção e obter o `eventId` do lookup. Após HTTP 201, deverá atualizar `GET /participations/current`/estado de retorno. Erros RFC 7807 e falhas de rede devem preservar a possibilidade de repetir a mesma intenção com a mesma chave. A validação no iPhone físico permanece pendente.
