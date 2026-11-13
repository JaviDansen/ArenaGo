# Isolamento da demonstração Staff

## Alteração

- O teste classifica explicitamente os arquivos da demonstração e o navegador de eventos real. Uma verificação da árvore exige a classificação de novos arquivos JavaScript da pasta Staff.
- Os módulos demonstrativos e sua fixture continuam sujeitos à proibição de `ParticipationContext`, serviços, cliente HTTP, `fetch` e armazenamento de tokens. O teste também bloqueia referências ao navegador Staff real.
- O navegador real pode importar o serviço de eventos; os testes existentes de descoberta e integração cobrem o uso do cliente autenticado. Componentes demonstrativos, navegação e código de produção não foram alterados.

## Validação

- Inspeção estática dos imports e da árvore Staff realizada durante a implementação.
- Testes, lint, typecheck e build não foram executados; a validação está reservada a Luna Medium.
- A validação anterior relatou 33 testes focados aprovados e falha da suíte completa na regra anterior; esta alteração ainda não foi validada por execução.
- Uma validação posterior por Luna identificou erro de sintaxe no fechamento da lista de padrões; o colchete ausente foi acrescentado. A correção ainda não foi executada em testes nem verificada por `node --check` nesta etapa, pois a política reserva verificações ao modelo de validação.
- Sugestão: com `NODE_ENV=test`, executar em `app` `node --test tests/staffDemoState.test.cjs tests/staffEventDiscovery.test.cjs tests/roleRoutingIntegration.test.cjs`, seguido de `npm.cmd --prefix app test` na raiz e `git diff --check`, após inspecionar os comandos e o ambiente.

## Limite

A classificação exige manutenção explícita quando arquivos Staff forem criados ou removidos. A verificação de isolamento é estática e deve permanecer acompanhada dos testes funcionais da demonstração e da consulta autenticada.
