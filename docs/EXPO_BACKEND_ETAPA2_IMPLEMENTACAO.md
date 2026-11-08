# Expo ↔ Backend — Etapa 2: participação corrente

## Escopo e contratos

Branch `feature/events-participations`, base `526ed2d260968c4a65a4df3b377bc17c346ee333`. O app consulta com autenticação e o cliente HTTP já existente:

- `GET /api/v1/participations/current`: `{ participation: null }` ou participação corrente com `id`, `eventId`, `status`, datas e `externalQueue`. Para espera, `externalQueue.position` é exibida. O contrato não inclui nome do evento ou experiências.
- `GET /api/v1/participations/return-state`: `recentFinalization` e `pendingEvaluationParticipationIds`. A tela inicial sinaliza finalização recente e quantidade de avaliações pendentes quando não há participação corrente.

O serviço conserva os dois resultados em memória somente para a identidade e geração da sessão autenticada. O provedor aciona a consulta depois da restauração ou do login, mascara dados de outra identidade durante a renderização e descarta respostas antigas após logout, mudança de conta, nova geração ou outra consulta. O cliente existente continua responsável por access token, refresh e RFC 7807. Carregamento, erro de rede, autorização e erro de resposta têm tratamento explícito com nova tentativa; erro não é interpretado como ausência de participação.

A participação real é apresentada em modo somente leitura, com atualização manual. As telas de Arena e ingresso por código existentes continuam simuladas, identificadas como demonstração, e não substituem uma participação real. O histórico e a avaliação simulados também estão identificados. Nenhuma operação de ingresso ou mutação foi integrada nesta etapa.

## Arquivos

- `app/services/participationService.js` e `app/context/ParticipationContext.js`: consultas e isolamento por sessão.
- `app/screens/home/HomeFlowScreen.js` e `HomeScreen.js`: carregamento, erros, participação real e estado de retorno.
- `app/screens/event-entry/EventEntryScreen.js`, `EventConfirmationScreen.js`, `app/screens/arena/ActiveArenaScreen.js`, `ArenaQueueScreen.js`, `app/screens/participation/ParticipationsScreen.js` e `EvaluationScreen.js`: identificação das simulações existentes.
- `app/tests/participationService.test.cjs`, `participationProvider.test.cjs`, `homeFlow.test.cjs` e `auth.test.cjs`: contratos, isolamento, recuperação e navegação. O teste histórico que afirmava que o contexto não era limpo na expiração foi atualizado para refletir o novo requisito; testes novos verificam a limpeza e o descarte de respostas atrasadas.

## Validações executadas pelo Codex

- `node.exe --test tests/participationService.test.cjs tests/homeFlow.test.cjs tests/auth.test.cjs`: 39/39 aprovados.
- `node.exe --test tests/participationProvider.test.cjs`: inicialmente 1/2; o teste detectou uso do cliente anterior à autenticação. Após a correção, 2/2 aprovados.
- `npm.cmd test`: 220/220 aprovados, sem falhas, cancelamentos ou skips. Após a inclusão de um aviso textual na avaliação, `node.exe --test tests/evaluation.test.cjs` passou 6/6.
- `expo install --check`: consulta online bloqueada com `EACCES`; em `EXPO_OFFLINE=1`, não apontou divergências, mas informou que a validação offline é limitada.
- `expo export --platform ios` com `EXPO_OFFLINE=1`: bundle iOS gerado com sucesso, 920 módulos; diretório temporário removido.
- Não há script ou configuração de typecheck em `app/`. Nenhum PostgreSQL, SQL ou migration foi executado.

## Validação manual pendente no Expo Go

1. Com o backend local já preparado pelo responsável, use em `app/.env.local` uma URL pública para o IP LAN do computador; mantenha segredos no ambiente privado do backend. Inicie o backend com `API_BIND_HOST=0.0.0.0` quando necessário e `npm.cmd run start:dev`. Em `app/`, execute `npm.cmd start`.
2. No iPhone com Expo Go 58, entre com uma conta sem participação corrente e confira a tela inicial; com uma conta que já tenha participação real ativa ou em espera, confira o estado e, se houver, a posição. Esta tarefa não cria participação por código.
3. Feche e reabra o app para verificar a restauração. Faça logout e entre com outra conta para conferir que nenhum dado anterior aparece. Teste indisponibilidade do backend e nova tentativa, sem alterar registros ou executar limpeza de banco.

O teste físico posterior a estas alterações ainda não foi realizado. A experiência real não disponibiliza ações de fila ou saída nesta etapa. Consultas dos dois endpoints são independentes e podem refletir instantes distintos; não há atualização automática em tempo real. Histórico real, nomes dos eventos e ingresso por código permanecem para próximas etapas.
