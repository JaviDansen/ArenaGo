# Staff B2 — fase operacional dos eventos

A lista Staff retorna `status` persistido e `effectivePhase` separadamente. A consulta reutiliza `configurationProjection`, com concessão Staff vigente no mesmo comando e seleção externa restrita a ID, nome, status e fase. A projeção existente observa horários, encerramento e prontidão C-05/C-14; nenhuma atualização de estado é realizada.

Lista e painel apresentam a fase: Agendado, Aberto, Em encerramento, Encerrado ou Não está pronto. Respostas antigas sem fase mostram Situação indisponível, sem presumir que o status persistido representa a situação operacional. A fase é a observada na última atualização manual da lista; não há polling.

Foram preparados testes de contrato, fases e apresentação, preservando verificações de seleção e identidade existentes. Cenários de datas e prontidão também dependem dos testes existentes da projeção administrativa. Inspeção estática apenas: testes e typechecks não foram executados nesta implementação. Nenhuma homologação manual foi realizada nesta task.

Para Luna Medium, em ambiente de teste isolado sem banco real: executar os testes backend simulados `staff-queries.test.ts`, `staff-queries-http.test.ts` e `admin-configuration.test.ts`, além dos typechecks; no app executar `node --test tests/staffEventDiscovery.test.cjs tests/roleRoutingIntegration.test.cjs tests/staffRealNavigation.test.cjs`. Inspecionar previamente os runners e scripts. A validação física da projeção com PostgreSQL exige campanha e autorização próprias.

Riscos: a projeção faz verificações de prontidão por evento, com custo de leitura superior ao da consulta anterior. A fase pode ficar desatualizada até a atualização manual. A resposta Staff não inclui detalhes administrativos de prontidão.
