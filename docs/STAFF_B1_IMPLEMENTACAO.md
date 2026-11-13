# Staff B1 — atualização automática operacional

## Implementação

As telas reais Staff consultam somente leituras existentes. Controle de Entrada consulta `GET /staff/events/:eventId/entry-control` a cada 5 segundos. Estação selecionada consulta `GET /staff/events/:eventId/experiences/:experienceId/stations/:stationId/operational-state`, a lista de estações e o resumo de fila da experiência selecionada a cada 5 segundos. O painel consulta a lista de estações a cada 5 segundos. A lista de eventos e o painel selecionado consultam `GET /staff/events` a cada 60 segundos para atualizar `effectivePhase` sem usar a projeção B2 em cada ciclo operacional.

O timer só existe com a rota em foco, seção visível, sessão corrente e app em primeiro plano. O próximo ciclo é agendado após o término da leitura. A retomada em primeiro plano não agenda outro timer quando uma leitura segue pendente; sua conclusão agenda um único ciclo. Mudanças de foco, evento, estação, usuário, época ou revisão da identidade limpam o timer; respostas tardias são descartadas pelas gerações e verificações de contexto dos stores. As leituras silenciosas preservam dados, seleção, modais, feedback e intenções. Falhas transitórias exibem aviso de desatualização e bloqueiam mutações sensíveis até leitura confirmada. Falhas de autorização limpam dados operacionais.

Os botões manuais e os coordenadores de intenção persistida permanecem. O polling usa apenas GET e não inicia reconciliação ou repete mutações. A atualização da estação utiliza o estado operacional nominal, que inclui espera e chamada pendente; o resumo separado da experiência alimenta o indicador do painel de atendimento. A lista de experiências é carregada ao entrar no painel e não é consultada a cada ciclo.

## Verificação

Na primeira validação Luna Medium, os testes focados registraram 137 aprovados e 1 falho: a fixture usava `waitingCount: 2` com `firstWaitingQueueEntryId: null`, resposta recusada corretamente por `parseStaffQueue`. A fixture foi corrigida sem alterar o parser. Na validação posterior, os testes direcionados tiveram 141 aprovados, incluindo 3 do hook com relógio controlado. A regressão então apontou 532 aprovados e 1 falho, pois o inventário de `staffDemoState.test.cjs` não incluía `useStaffPolling.js`. Após a correção da lista, o teste de inventário teve 21 aprovados e a regressão completa teve **533 aprovados, 0 falhos e 0 ignorados**. As verificações anteriores de `git diff --check` e reversibilidade da evidência passaram. Estes são resultados automatizados previamente obtidos, sem nova execução nesta atualização documental.

## Limites

A revalidação anterior havia sido interrompida após o runner deixar de produzir saída; a interferência dos timers globais era uma hipótese não comprovada. O hook passou a aceitar um agendador opcional, preservando os timers de produção, e os testes usam relógio isolado e limpam os recursos. A execução isolada posterior terminou e aprovou os 3 testes do hook.

A fase e a concessão da lista Staff podem levar até 60 segundos para atualizar na interface; os endpoints operacionais continuam revalidando autorização em cada leitura. O intervalo de 5 segundos não representa comunicação em tempo real. Não há dependência da sincronização automática do participante.

## HOMOLOGAÇÃO FUNCIONAL (Expo Go)

O responsável homologou a B1 no banco local isolado `arenago_staff_a4_20261112`, no evento Multiestações, com as experiências Just Dance e PlayStation. O teste principal utilizou Just Dance — Estação 01.

Um participante sintético, com sessão autenticada e questionário completo, ingressou no evento pela API oficial via PowerShell. Ele apareceu automaticamente no Controle de Entrada, sem acionar Atualizar. Após chamada e confirmação pelo Staff, a participação ficou ativa e pôde ingressar na fila interna.

A entrada na fila interna de Just Dance pelo endpoint oficial apareceu na tela Staff sem atualização manual, após aproximadamente 2 segundos. A retirada pelo endpoint oficial também atualizou a tela automaticamente. Na repetição, o botão Chamar próximo desapareceu praticamente de imediato após a retirada, enquanto a contagem mudou aproximadamente 4 segundos depois. A diferença visual transitória foi aceita na homologação, sem impacto funcional observado; sua causa técnica não foi investigada.

Não foram observadas piscadas ou perda aparente dos dados. Ao colocar o Expo Go em segundo plano e retornar, a tela e a seleção permaneceram preservadas, sem anomalias observadas. A suspensão das requisições não foi verificada instrumentalmente nessa campanha; o comportamento é coberto pelos testes automatizados do hook.

O inspector de rede do Expo DevTools estava indisponível por múltiplos React Native hosts. A evidência principal é o comportamento funcional observado. A B1 foi homologada e aprovada, sem necessidade de correções adicionais antes do commit, conforme confirmação do responsável.
