# Retomada após encerramento — C-04/D09

## Escopo e estado

Branch de implementação: `develop`. A correção C-04/D09 foi implementada, corrigida após a primeira bateria e validada em campanha focada, regressão frontend e homologação manual delimitada no Expo Go. As evidências e limites de cada etapa estão registrados abaixo; não se declara prontidão para produção nem aprovação integral do backend.

Foram alterados quatro arquivos de produção: `HomeFlowScreen.js`, `ParticipationContext.js`, `participationService.js` e `participationHistoryService.js`. `HomeScreen`, `RealEvaluationScreen`, `ParticipationsRealScreen` e backend foram inspecionados e reutilizados sem edição. As decisões C-04/D09 permanecem iguais.

Este relatório e o patch único `qa-evidence/RETURN_AFTER_CLOSURE_C04_D09-changes.diff` atendem à obrigação de evidências do AGENTS.md. Os cinco documentos canônicos aprovados não foram editados nesta task.

## Contratos e decisão de apresentação

`GET /participations/return-state` retorna a última participação finalizada por motivo de sistema, ordenada por `finished_at` e ID, sem janela adicional de recência. `recentFinalization` não é uma lista de todas as avaliações pendentes nem um recibo de apresentação. `pendingEvaluationParticipationIds` contém pendências elegíveis calculadas pelo backend e pode conter outras participações.

A retomada automática exige ausência de participação corrente e demonstração, estado de leitura `ready`, foco e identidade autenticada/verificada. O mesmo ID deve aparecer na finalização recente e nas pendências. São reconsultados elegibilidade e histórico paginado pelos serviços reais existentes. A navegação exige elegível, pendente, não enviada, participação `finished`, conclusão Staff positiva e correspondência de ID/evento/instante/motivo com a finalização recente. O backend determina o prazo; não foi inventada janela de recência nem decisão temporal pelo relógio do aparelho.

O destino é a rota raiz `RealEvaluation`, com o item real validado. A opção existente “Avaliar mais tarde” usa `goBack()`. Uma marca em memória no store da participação é consumida antes de navegar e sobrevive à remontagem da Home e ao refresh comum. Ela é reiniciada na troca de identidade/sessão e em uma nova retomada do aplicativo. Não há gravação de adiamento no backend nem envio automático de avaliação.

No segundo plano/inatividade, as leituras anteriores são invalidadas. Ao voltar ao primeiro plano, `/current` e `/return-state` são reconsultados. Uma versão de leitura impede que respostas anteriores sejam usadas mesmo se o objeto de retorno for reutilizado. Conta, epoch, cliente, foco e getter vivo de identidade são conferidos durante as leituras e imediatamente antes da navegação.

Sem elegibilidade, a Home informa o encerramento; uma pendência recente recusada na revalidação deixa de ser anunciada nessa apresentação. Outras pendências permanecem acessíveis pela aba Eventos. Erro ou inconsistência nas leituras bloqueia a abertura e oferece nova tentativa por consulta. Participação ativa e espera externa mantêm seus destinos existentes.

## Testes automatizados e correção

Foram acrescentados 18 testes declarados, com cenários negativos agrupados por dados:

- `homeReturnEvaluation.test.cjs`: navegação real, dados de rota, adiamento pela tela real, ausência de loop após refresh/foco, nova retomada, aviso sem elegibilidade, pendências antigas, falhas de leitura, sessão/conta/foco/identidade, respostas de retomada anterior, logout durante histórico e participação corrente.
- `participationHistoryService.integration.test.cjs`: correlação, paginação, autenticação das leituras, finalização inválida, inconsistência de histórico, ausência de conclusão, envio anterior e prazo expirado. Apesar do nome do arquivo, são contratos com transporte simulado, sem banco.
- `participationService.test.cjs`: marca única, versões, sessão, participação real/demo e nova retomada.
- `participationProvider.test.cjs`: ciclo AppState e estado nativo inicial desconhecido.
- `homeFlow.test.cjs`: adaptação dos stubs de hooks e manutenção dos testes de seleção das telas existentes.

Na primeira campanha focada, foram executados 99 testes: 98 aprovados, 1 falho, 0 ignorados, exit code 1. Os 18 testes novos passaram. O teste existente `HomeFlow renders HomeScreen when there is no participation` revelou acesso a `returnCheck.version` com `returnCheck` nulo. A correção exige a presença de `returnCheck` antes de ler propriedades e de `returnState` antes da comparação; o teste antigo foi preservado.

Após a correção, a Luna Medium reexecutou a bateria focada: 99 testes, 99 aprovados, 0 falhos, 0 ignorados, exit code 0. O teste que havia falhado passou, assim como os 18 testes novos. A regressão completa do frontend executou 773 testes: 773 aprovados, 0 falhos, 0 ignorados, exit code 0. `git diff --check` retornou exit code 0. Essas são validações automatizadas; não comprovam por si só o comportamento em dispositivo físico.

## Inspeções estáticas

Revisados o diff, os contratos de retorno/elegibilidade e os caminhos de navegação/adiamento. `git diff --check` retornou exit code 0. A leitura estrutural do patch com `git apply --stat` retornou exit code 0, sem aplicar alterações. A inspeção dos arquivos de código, testes e relatório não encontrou marcadores de conflito ou espaços finais. Não houve alteração de dependências, autenticação, endpoints, banco, migrations, seeds, `.env`, READMEs ou decisões de negócio.

## Validação proposta para etapa autorizada

Executor: Luna Medium, selecionado pelo responsável. Inspecionar os scripts antes da execução e registrar contagens, skips e exit codes. No diretório `app`, executar primeiro:

```powershell
$env:NODE_ENV = 'test'
node --test tests/homeReturnEvaluation.test.cjs tests/homeFlow.test.cjs tests/participationService.test.cjs tests/participationProvider.test.cjs tests/participationHistoryService.integration.test.cjs tests/participationEvaluations.test.cjs tests/evaluation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Após aprovação focada e autorização, executar `npm.cmd test` em `app`. Os testes usam transporte/armazenamento simulados; não iniciar banco, backend ou Expo para essa campanha. Registrar dependências QA ausentes e skips sem declarar regressão integral aprovada.

## Homologação manual no Expo Go

Ambiente observado: Expo Go em celular físico, backend A4 e PostgreSQL local de homologação; Staff operado no emulador Android. No evento A4 Multiestações foram observados: ingresso do Participante por QR Code; entrada pela fila externa após confirmação Staff; atendimento concluído na estação Just Dance; encerramento administrativo real pela API com `status: closed` e `closureMode: immediate`; abertura automática da avaliação ao retomar o aplicativo; “Avaliar mais tarde” sem reapresentação ao trocar de abas; avaliação ainda acessível na aba Eventos; nova apresentação automática em outra retomada; envio da avaliação e reconhecimento do estado enviado no histórico; ausência de nova apresentação após o envio.

Não foram homologados fisicamente nesta campanha o encerramento automático pelo scheduler, retomada sem elegibilidade ou todos os cenários negativos de rede e sessão. Esses casos têm cobertura automatizada, mas não são declarados fisicamente aprovados. A recriação posterior do evento Multiestações 2 é uma operação de homologação separada e não integra esta implementação.

## Limites

A homologação física cobre o fluxo principal descrito acima, não todos os cenários do produto. O backend pode mudar entre a última leitura e a navegação; os comandos reais de avaliação continuam sujeitos à elegibilidade transacional existente. Adiamento é local ao ciclo autenticado/retomada e não é persistido entre reinicializações do aplicativo. Não se declara prontidão para produção nem aprovação integral do backend.

Parecer de implementação: PRONTO PARA VALIDAÇÃO.
