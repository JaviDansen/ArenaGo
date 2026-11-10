# Descoberta de experiências Staff

## Contrato HTTP

`GET /api/v1/staff/events/:eventId/experiences` exige uma sessão Bearer válida. Para evento com concessão Staff vigente da conta autenticada, responde `200`, `Cache-Control: no-store`:

```json
{
  "eventId": "00000000-0000-4000-8000-000000000001",
  "experiences": [
    { "id": "00000000-0000-4000-8000-000000000002", "name": "Experiência" }
  ]
}
```

O resultado contém todas as experiências do evento, inclusive sem estação, ordenadas por nome e ID. Um evento autorizado sem experiências retorna `experiences: []`. O UUID do evento é validado e normalizado pela validação existente; formato inválido resulta em `400 VALIDATION_ERROR`. Evento inexistente e falta de autorização recebem o mesmo `404 RESOURCE_NOT_FOUND`. Sessão ausente, inválida ou incompatível com as regras de autenticação recebe o 401 correspondente. Um Admin sem concessão Staff não ganha acesso ao evento por seu papel Admin; as regras existentes de TOTP continuam em vigor.

A resposta não contém participantes, códigos, dados de concessão ou campos de fila. A identidade vem de `CurrentUserId` após `SessionAuthGuard`; parâmetros de consulta enviados pelo cliente não definem a conta.

## Arquitetura

O endpoint foi acrescentado a `StaffQueriesController` e `StaffQueriesService`, reutilizando a autorização por evento das leituras Staff existentes. A consulta de autorização exige conta ativa, e-mail verificado e concessão `staff` não revogada para o evento. Autorização e seleção usam uma transação `REPEATABLE READ READ ONLY`; a consulta seleciona somente `id` e `name` diretamente de `experiences`, sem junção com estações. O schema existente já possui os campos e o índice por evento; não há migration ou endpoint substituído.

O snapshot pode refletir uma concessão revogada após o início da leitura; a próxima consulta verifica a concessão novamente. O resultado não é autorização para operações futuras, que devem continuar autorizadas no backend. Não há paginação; volumes grandes podem exigir contrato posterior. A interface Staff ainda precisa integrar este novo endpoint; a implementação atual baseada nas estações permanece inalterada nesta entrega.

## Arquivos e testes preparados

- `backend/src/events/staff-queries.controller.ts`, `staff-queries.service.ts` e `staff-queries.types.ts`: rota, consulta e tipo de resposta.
- `backend/test/unit/staff-queries.test.ts`: SQL parametrizado, conta e concessão, transação de leitura, projeção, lista vazia e acesso negado.
- `backend/test/unit/staff-queries-http.test.ts`: autenticação, UUID inválido e normalizado, identidade da sessão, projeção mínima, lista vazia, recusa neutra e erro 500 sem dados privados para a rota de experiências.
- `backend/test/integration/staff-queries-http.integration.test.ts`: cenários preparados com contas e eventos isolados, múltiplas experiências com e sem estação, revogação, conta inativa, e-mail não verificado, Admin com 2FA sem concessão e snapshot concorrente.
- Esta documentação e `qa-evidence/STAFF_EXPERIENCE_DISCOVERY-changes.diff` acompanham a entrega.

## Validação e segurança

Na implementação inicial, foi realizada inspeção estática de contratos, schema, guard e alterações. Na validação final pelo Codex com Luna Medium, os testes focados tiveram **26 aprovados, 0 falhos e 0 ignorados**; a suíte unitária completa teve **1.153 aprovados, 0 falhos e 0 ignorados**. A correção P3 foi executada: o teste HTTP 500 percorreu `/experiences` e confirmou `INTERNAL_SERVER_ERROR` sem o marcador `PRIVATE`, além dos cenários existentes de estações e filas. O `git diff --check` passou nessa campanha.

O runner `tsx` falhou no carregamento por `uv_os_get_passwd`/`ENOMEM`, antes de executar testes. Para concluir a validação, o código e os testes foram compilados em diretório temporário e executados com Node, com `NODE_ENV=test` e `EVALUATION_IDEMPOTENCY_TTL_SECONDS=60`. Os typechecks de produção e de testes e a compilação isolada haviam passado na campanha anterior. Nenhum teste PostgreSQL de integração foi executado e não houve acesso ao Neon na validação final unitária.

Em homologação HTTP real separada no Neon `dev-shared`, conforme informado pelo responsável, o endpoint retornou HTTP 401 sem autenticação; `/auth/me` retornou HTTP 200 com papéis `participante,staff`; a consulta de experiências retornou HTTP 200 com uma experiência, `Experiencia de Homologacao 01`, e somente `eventId` e `experiences` com `id` e `name`; o logout retornou HTTP 200. Essa homologação ocorreu antes da correção P3, que altera apenas o teste.

Os testes PostgreSQL preparados exigem autorização específica para uma campanha em banco dedicado e **não devem ser executados no Neon compartilhado**. A integração do frontend permanece para etapa posterior.
