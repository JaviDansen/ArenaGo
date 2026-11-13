# Descoberta de eventos Staff

## Contrato para o aplicativo

`GET /api/v1/staff/events` exige `Authorization: Bearer <accessToken>` de sessão válida. Retorna HTTP 200 e `Cache-Control: no-store`:

```json
{
  "events": [
    { "id": "00000000-0000-4000-8000-000000000001", "name": "Arena", "status": "open" }
  ]
}
```

Uma conta sem concessão Staff válida recebe `{ "events": [] }`. `id` é o UUID a usar nas consultas Staff vinculadas ao evento. `status` é um dos valores existentes: `scheduled`, `open`, `closing` ou `closed`. A ordenação é por nome e ID. O endpoint ignora parâmetros de identidade do cliente; o guard fornece o usuário da sessão. Credenciais ausentes ou inválidas retornam 401 conforme o contrato de autenticação existente.

A consulta usa um snapshot de uma instrução e inclui somente concessões `staff` do próprio usuário com `revoked_at IS NULL`, conta ativa e e-mail verificado. O resultado pode incluir eventos em qualquer status, inclusive encerrados: as consultas Staff já existentes autorizam por concessão e tratam condições operacionais separadamente. Uma concessão revogada depois da resposta pode tornar a lista desatualizada; cada operação subsequente continua verificando a autorização no servidor. O papel Admin isolado não concede acesso Staff. A listagem não retorna códigos de acesso, dados de conta, participantes ou informações de concessão.

## Arquitetura e riscos

- Inspeção estática: `user_roles` já contém usuário, evento e revogação, e `events` possui os três campos necessários. Nenhum endpoint de listagem Staff correspondente foi encontrado. `GET /staff/events` não conflita com as rotas existentes com `:eventId`.
- Nenhuma migration ou alteração de schema é necessária. Os arquivos de backend tocados não tinham alterações locais no início desta tarefa; não foi encontrado conflito local com o trabalho Admin. Integração simultânea em outra cópia ainda deve ser coordenada pelo responsável.
- A listagem não é paginada; um volume muito grande de concessões pode exigir paginação em etapa futura. Não há polling nem integração do painel nesta etapa.
- Testes preparados: HTTP com guard, identidade de sessão, tentativa de escolher outro usuário, lista vazia e projeção; teste unitário da consulta parametrizada e das condições de concessão; integração PostgreSQL para duas contas, concessão adicional, isolamento, revogação e autenticação.
- Testes focados executados por Luna Medium (`NODE_ENV=test`): `staff-queries.test.ts` e `staff-queries-http.test.ts`, 21 aprovados, 0 falhos e 0 ignorados. Cobrem Bearer obrigatório, uso do ID da sessão apesar de `userId` enviado pelo cliente, lista vazia, projeção, SQL parametrizado, concessão Staff ativa e operações existentes.
- Suíte unitária completa executada por Luna Medium (`npm.cmd --prefix backend test`): primeira execução teve 1.146 aprovados e 2 falhos em `evaluation-write-http.test.ts`, pois o teste presume TTL de 60 segundos e a variável `EVALUATION_IDEMPOTENCY_TTL_SECONDS` estava ausente. Com a variável configurada em `60`, a suíte repetida teve 1.148 aprovados, 0 falhos e 0 ignorados. Os testes unitários não abriram conexão PostgreSQL.
- Typecheck de produção (`tsconfig.build.json`) e typecheck de testes (`tsconfig.test.json`): aprovados, sem erros.
- Compilação de produção: `tsc --project tsconfig.build.json --outDir <diretório temporário novo> --incremental false` concluiu sem erros, preservando o `backend/dist` existente. O comando Nest `nest build` não foi executado: a configuração padrão está com `deleteOutDir: true`, e a revisão da execução rejeitou o comando que incluía a remoção recursiva do diretório temporário criado para evitar tocar no `dist` preexistente.
- Nenhum teste PostgreSQL foi executado e nenhuma conexão ou alteração de banco foi feita. A integração em `staff-queries-http.integration.test.ts` continua pendente de campanha autorizada com confirmação do banco dedicado.
- `git diff --check`: executado na raiz sem apontamentos. `git status --short` preservou as alterações locais já existentes e mostra as alterações não commitadas deste endpoint.
- `tsx` falhou inicialmente porque `os.userInfo()` retornou `uv_os_get_passwd ENOMEM` no Windows. Os testes foram executados com um preloader temporário que fornece apenas um identificador estável à criação de diretório temporário pelo `tsx`; lógica e asserções dos testes não foram alteradas.
- Lint: não executado nesta campanha. Validação manual pelo responsável: nenhuma informada para este endpoint.
