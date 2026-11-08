# ArenaGo — Integração Expo ↔ Backend, Etapa 4

## Escopo

As telas de consulta e confirmação de evento do Expo passaram a usar os contratos HTTP reais preparados na Etapa 3. A autenticação, o refresh de sessão, o SecureStore de tokens, o perfil, o questionário e os demais fluxos de demonstração foram preservados. O backend, o schema e os bancos não foram alterados nesta etapa.

## Contratos e fluxo

1. `EventEntryScreen` envia o código digitado, após remover espaços externos, em `POST /api/v1/events/lookup`, com autenticação. O cliente HTTP existente acrescenta `/api/v1` uma vez. O backend normaliza o código; o app não altera sua caixa. A navegação só ocorre com resposta válida e sessão ainda corrente.
2. `EventConfirmationScreen` mostra os campos efetivamente retornados: nome, fuso, início, término oficial, prazo operacional e se há fila externa. Exibe os `blockingReasons` e desabilita a confirmação quando `eligible` é falso. A elegibilidade é revalidada pelo servidor no ingresso, pois pode mudar entre as duas requisições.
3. Ao confirmar, o app envia `POST /api/v1/participations` com `{ eventId }`, Bearer e `Idempotency-Key`. `expo-crypto` fornece `randomUUID()` para uma chave segura; a dependência foi adicionada pelo mecanismo oficial `expo install`. A intenção e a chave são salvas antes do POST, separadas pelo UUID da conta. No iOS/Android usa-se `expo-secure-store`; na web o fallback é somente em memória. Nenhum token ou senha é gravado nessa intenção.
4. Duplos toques compartilham a mesma operação. Falha de rede, timeout, erro 5xx, resposta inválida ou operação idempotente em andamento preservam a chave para repetir o mesmo pedido com segurança. Uma intenção incerta para outro evento bloqueia um novo ingresso até que seja esclarecida; não é trocada silenciosamente por uma nova chave.
5. Depois de uma resposta de ingresso com `participationId`, o app atualiza `GET /participations/current` e `GET /participations/return-state` pelo `ParticipationStore` existente. Só navega ao fluxo principal quando a participação da própria conta, com o mesmo ID e evento, aparecer como `waiting` ou `active`. A posição da fila é exibida apenas se vier dessa leitura do servidor.
6. Se o ingresso for confirmado mas a leitura falhar, o app mantém o estado `confirmed_unsynced` e oferece “Atualizar participação”, que repete apenas a sincronização. A participação nunca é criada localmente. A intenção confirmada só é descartada depois de uma leitura coerente.

O `ParticipationProvider` compartilha o cliente HTTP e a identidade da sessão com o serviço de ingresso. O `userId`, o epoch da sessão e uma geração interna impedem que consultas e confirmações atrasadas de uma sessão antiga alterem a sessão atual. Ao restaurar uma sessão, a participação é consultada novamente pelo fluxo existente. A chave pendente da conta continua disponível para um retry da mesma intenção após reabrir o app.

## Erros e limites

Os problemas RFC 7807 são tratados pelo `httpClient` existente; o serviço traduz códigos conhecidos, 401/403, falhas de rede e timeout em mensagens de ingresso. Respostas de sucesso fora do contrato são recusadas. A tela não usa os campos simulados `location`, `hasArenaQueue` nem uma posição fictícia.

O cliente HTTP atual entrega somente o corpo de respostas bem-sucedidas; portanto o serviço verifica o `participationId` válido, mas não lê diretamente o status 201. O contrato de status continua garantido pelo endpoint backend. Na web, a intenção em memória não sobrevive a uma recarga; a participação confirmada ainda é recuperada pela leitura da sessão. Uma intenção incerta de outro evento exige retomada ou resolução específica; esta etapa não cria fluxo para abandoná-la. A proteção de replay do backend possui TTL configurável; uma tentativa muito tardia, após a expiração dessa reserva e depois do encerramento da primeira participação, exige avaliação operacional antes de novo ingresso. As demais telas demonstrativas de eventos/filas ainda não foram integradas. Não há validação de produção ou do iPhone após esta alteração.

## Arquivos

- `app/services/eventAdmissionService.js`: validação das respostas, intenção segura por identidade, chave idempotente, consulta, confirmação, retry e sincronização.
- `app/context/ParticipationContext.js`: ligação do serviço ao contexto e isolamento por sessão.
- `app/screens/event-entry/EventEntryScreen.js` e `EventConfirmationScreen.js`: consulta e confirmação reais.
- `app/package.json` e `app/package-lock.json`: `expo-crypto` compatível com o SDK 58.
- `app/tests/eventAdmissionService.test.cjs`, `eventEntry.test.cjs` e `participationProvider.test.cjs`: cenários preparados sem chamadas reais ao backend.
- Este relatório e `qa-evidence/expo-backend-etapa4-changes.diff`.

## Validação

Os testes automatizados foram preparados para consulta válida/inválida, elegibilidade, POST único, duplo toque, retry com a mesma chave, erro de rede/timeout/HTTP, resposta inválida, sincronização após ingresso, falha de sincronização, logout e troca de conta. A regressão do frontend **não foi executada nesta implementação**. Conforme o `AGENTS.md`, a execução rotineira deve ocorrer em campanha separada com GPT-6 Luna Medium selecionado pelo responsável. Nenhum teste PostgreSQL, migration, seed ou criação real de participação foi executado.

Com a branch e o ambiente conferidos, o responsável pode executar em `app/`:

```powershell
node.exe --test tests/eventAdmissionService.test.cjs tests/eventEntry.test.cjs tests/participationProvider.test.cjs
npm.cmd test
```

O script `npm test` usa `node --test tests/*.test.cjs`; os novos testes usam clientes HTTP simulados, sem requisições de criação reais. Após esses testes, conferir `git diff --check` e a inicialização do app. Resultados, contagens e códigos de saída devem ser registrados somente após execução.

## Validação manual no Expo Go

1. Configurar `EXPO_PUBLIC_API_BASE_URL` com a origem HTTP do backend acessível pelo iPhone na mesma rede, sem `/api/v1` duplicado e sem credenciais. `127.0.0.1` no iPhone aponta para o próprio aparelho. No terminal `backend/`, com o ambiente de desenvolvimento já preparado pelo responsável, iniciar com `$env:API_BIND_HOST = '0.0.0.0'; npm.cmd run start:dev`. Não apontar para banco histórico ou de produção.
2. Em outro terminal, dentro de `app/`, executar `npm.cmd start`, abrir o QR code no Expo Go 58 e recarregar o app após alterar a URL. Usar uma conta de participante de teste com questionário e jogos completos, e um evento de teste ativo, preparado pelo responsável.
3. Consultar um código inexistente e depois um válido. Conferir dados, elegibilidade e motivos apresentados; confirmar ingresso uma vez. Verificar `waiting` ou `active` e eventual posição somente a partir da resposta real.
4. Fechar e reabrir o app para verificar restauração; repetir com logout e outra conta para verificar isolamento. Simular perda de rede na confirmação e repetir a mesma tentativa, observando a sincronização sem novo ingresso quando o servidor já tiver confirmado.

O teste físico no iPhone continua pendente. Não usar dados históricos ou de produção para criar participações durante essa validação.
