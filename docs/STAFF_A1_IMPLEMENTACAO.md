# Staff A1 — simplificação das confirmações prévias

## Escopo

Controle de Entrada e Estação operacional passam a executar **Chamar próximo** com um toque. **Reativar fila externa** também executa com um toque. Não há alteração de contrato HTTP, backend, armazenamento, navegação ou regras de negócio.

Continuam com confirmação prévia: no Controle de Entrada, **Confirmar entrada**, **Marcar ausência**, **Remover da fila** e **Desativar fila externa**; na Estação, **Concluir atendimento**, **Registrar ausência** e **Remover da fila**. O reconhecimento terminal **Entendi** permanece como antes.

## Implementação e proteção

- `StaffEntryControlRealScreen.js`: as duas ações diretas chamam `store.mutate` após verificar contexto atual, estado pronto, disponibilidade da operação, ausência de intenção pendente, falha de armazenamento e diálogo aberto. O store mantém trava de voo síncrona, intenção persistida antes da requisição, Idempotency-Key e bloqueio de resultado incerto.
- `StaffStationOperationalScreen.js`: o despacho antes usado apenas pelo diálogo é compartilhado com a chamada direta. A função revalida conta, sessão, evento, estação, epoch, revisão, estado pronto, ausência de pendência e disponibilidade da chamada. Uma ref síncrona impede dois despachos entre toques rápidos, inclusive antes de React publicar `busy`. O coordenador continua responsável pela reserva persistente e pela decisão de envio.
- Respostas obsoletas continuam descartadas após mudança de contexto. Timeout ou resultado incerto não disparam retry automático nem liberam nova operação. SecureStore, recibos terminais e reconhecimento não foram alterados.

## Validação automatizada

`app/tests/roleRoutingIntegration.test.cjs` foi adaptado para verificar chamada externa e de estação sem modal, reativação sem modal, dois toques rápidos com uma mutação, persistência anterior ao POST, bloqueio após logout e ausência de reenvio após resposta incerta e atualização. Os cenários existentes continuam verificando os diálogos sensíveis e o reconhecimento terminal. Os testes de store/coordenador em `staffEntryControl.test.cjs` e `staffOperationsService.integration.test.cjs` continuam cobrindo reserva, idempotência, armazenamento e reconciliação.

Luna Medium executou a regressão completa do aplicativo: **523 aprovados, 0 falhos, 0 ignorados, exit code 0**. Os quatro arquivos focados foram executados antes da regressão, mas a contagem e o exit code individuais não foram preservados integralmente; não são inferidos neste relatório.

A primeira campanha focada registrou 117 aprovados, 1 falho, 0 ignorados e exit code 1. O teste de callback após logout parava antes de encontrar o botão: seu mock de SecureStore não implementava `deleteItemAsync`, embora o adaptador exija esse método. A fixture foi corrigida adicionando a operação simulada; a regressão completa posterior passou.

## Homologação funcional no Expo Go

O responsável observou os cenários abaixo no banco local isolado `arenago_staff_homolog_geral_20261111`, no evento ArenaGo — Homologação Geral, com conta Staff sintética, participante fictício P3 e Estação 01. As contas já existiam; não foram reexecutados criação de contas, migrations, seed ou fixture.

1. Reativar a fila externa ocorreu com um toque e sem diálogo prévio.
2. P3 foi chamado na fila externa com um toque e sem diálogo prévio; continuou chamado após **Entendi**.
3. Confirmar entrada, marcar ausência e remover o chamado mantiveram confirmação prévia. O cenário observado prosseguiu com **Confirmar entrada**, que tornou a entrada de P3 efetiva.
4. Após o ingresso de P3 na fila da experiência pela API oficial, **Chamar próximo** na Estação 01 ocorreu com um toque e sem diálogo prévio; P3 continuou chamado após **Entendi**.

O estado final informado é P3 chamado na Estação 01, com atendimento ainda pendente. Essa homologação manual registra o fluxo observado; não comprova exaustivamente concorrência, resultados incertos, recuperação de falhas ou todas as operações sensíveis.

Os resultados automatizados e as observações manuais são evidências diferentes: os primeiros cobrem os cenários executados nos harnesses do aplicativo; a segunda confirma o percurso funcional descrito no Expo Go.

## Limites

Esta A1 não altera o protocolo de intenções nem resolve recuperação histórica de operações incertas. A homologação funcional anterior de Staff 01/02 não substitui a validação automatizada desta alteração. A Task A2 e demais melhorias continuam separadas.
