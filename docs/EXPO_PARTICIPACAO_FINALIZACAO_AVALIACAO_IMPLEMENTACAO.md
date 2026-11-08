# Expo ↔ Backend — finalização e avaliação da participação

## Contratos utilizados

- `POST /api/v1/participations/:participationId/finish`: sessão autenticada, `Idempotency-Key` e corpo JSON `{}`. A resposta confirmada contém `{ participation }` com `status: finished`, `finishReason: voluntary`, contagem de atendimentos e elegibilidade para avaliação.
- `GET /api/v1/participations/:participationId`: consulta da própria participação para reconciliar uma resposta incerta da finalização.
- `GET /api/v1/participations/:participationId/evaluation-eligibility`: confirmação atual da elegibilidade antes do envio.
- `POST /api/v1/participations/:participationId/evaluation`: sessão autenticada, `Idempotency-Key` e corpo `{ rating, comment }`. O comentário pode ser `null`; a nota é de 1 a 5.
- `GET /api/v1/participations/:participationId/evaluation`: reconciliação de envio incerto e leitura da avaliação já registrada.
- `GET /api/v1/participations/current`, `return-state` e `history`: atualizam Home, Arena, pendências e aba Eventos após mutações confirmadas.

O cliente HTTP existente aplica o prefixo `/api/v1`, autenticação, refresh de sessão e tratamento de erros RFC 7807. Nenhuma rota foi adicionada ao backend.

## Implementação

- `RealArenaScreen` exibe **Sair da Arena**, exige confirmação e impede um segundo toque durante a operação. A ação também fica bloqueada enquanto uma entrada na fila tem resultado incerto.
- `participationActionService` grava uma intenção e sua chave em SecureStore antes de cada POST. O armazenamento é separado por conta e operação; no web, usa apenas memória. Um retry da mesma intenção conserva a chave. Respostas incertas são verificadas por GET; enquanto não forem confirmadas, a intenção continua armazenada.
- Após a saída confirmada, a consulta da participação é refeita. A Home deixa de apresentar a Arena ativa; a aba Eventos refaz o histórico quando recebe foco.
- A aba Eventos e os detalhes exibem **Avaliar evento** somente quando o histórico real informa `finished`, `eligible`, `pending` e ausência de envio. A tela de avaliação existente fornece o formulário também para a rota real; o fluxo de demonstração permanece separado.
- Antes de enviar, o serviço consulta novamente a elegibilidade no backend. Um envio incerto é reconciliado pela leitura da avaliação. Uma intenção pendente conserva nota, comentário e chave; a UI oferece **Conferir tentativa anterior**. Após a confirmação, a navegação retorna à aba Eventos para reler o histórico.
- As respostas tardias de outra sessão não atualizam a interface. A autorização e a elegibilidade definitivas permanecem no backend.

## Arquivos da tarefa

- `app/services/participationActionService.js`
- `app/screens/arena/RealArenaScreen.js`
- `app/screens/participation/EvaluationScreen.js`
- `app/screens/participation/RealEvaluationScreen.js`
- `app/screens/participation/ParticipationsRealScreen.js`
- `app/screens/participation/ParticipationRealDetailsScreen.js`
- `app/App.js`
- `app/tests/participationActions.test.cjs`
- `app/tests/participationActionScreens.test.cjs`
- Este relatório.

## Validação e pendências

Os testes e o bundle desta alteração **não foram executados nesta sessão**. O responsável selecionará Luna Medium para a campanha automatizada. Executar no diretório `app/`, após inspecionar os scripts:

```powershell
node.exe --test tests/participationActions.test.cjs tests/participationActionScreens.test.cjs tests/evaluation.test.cjs tests/homeFlow.test.cjs tests/participationHistoryService.integration.test.cjs
npm.cmd test
$env:EXPO_NO_DOTENV = '1'; $env:CI = '1'
$bundle = Join-Path $env:TEMP ('arenago-participation-actions-' + [guid]::NewGuid().ToString('N'))
& .\node_modules\.bin\expo.cmd export --platform ios --output-dir $bundle
```

Depois, realizar teste manual no Expo Go com participação ativa e com participação finalizada elegível. Conferir saída confirmada, atualização do histórico, envio único da avaliação, retorno após queda de rede e isolamento após troca de conta. A integração física desta alteração ainda está pendente.

O working tree já continha alterações não commitadas de outras etapas do Expo e backend antes desta implementação. Elas foram preservadas. Não houve teste PostgreSQL, migration, alteração de `.env`, commit ou push.
