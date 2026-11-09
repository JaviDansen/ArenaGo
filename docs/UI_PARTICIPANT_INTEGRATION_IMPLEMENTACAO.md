# ArenaGo — integração visual da Participant UI

Base: `a3f235436b2cb5d35b71958fed3f6bbf43a5cb1f` (`origin/develop`).
Branch de trabalho: `feature/participant-ui-integration`.

## Implementação

- Reutilizados o tema, os componentes de UI e `AuthBackground` da entrega UI-09/10, com uma única cópia de `shared-background.png`.
- Aplicado o visual a Home, estados de participação, entrada e confirmação de eventos, Arena real, histórico, detalhes e avaliação. As abas Início/Eventos/Perfil preservam seus destinos reais.
- Incorporado o redesign UI-11/12 de Perfil com cartões, badges, jogos em chips e ações acessíveis. A tela continua buscando `/profile` e `/profile/questionnaire`, permite editar o questionário e encerra a sessão pelo contexto de autenticação.
- As estatísticas de participação exibidas no Perfil continuam explicitamente identificadas como demonstrativas, conforme a implementação preexistente; não foram adicionados mocks aos fluxos reais.
- Incorporado o visual do Kaled ao Welcome, Login, Cadastro e Recuperação de Senha, com a arte exclusiva do Welcome e o fundo compartilhado existente. Login mantém o fluxo real de sessão e segundo fator; a recuperação continua explicitamente indisponível.
- Aplicado o visual das três etapas e dos estados de edição/carregamento do Questionário, preservando as consultas, validações e o salvamento reais. O seletor nativo de data recebeu os ajustes visuais e de área de toque correspondentes.
- O estado de avaliação real indisponível também utiliza o fundo e os cartões compartilhados, sem alterar o coordenador de avaliação.
- Corrigido o posicionamento do indicador de carregamento do botão compartilhado para a API de estilo presente no React Native instalado.
- Os componentes legados `ActiveArenaScreen` e `ArenaQueueScreen` conservam o visual anterior no ramo demonstrativo de `HomeFlowScreen`; a participação recebida do servidor continua usando as telas reais integradas.
- Mantidos os coordenadores e serviços da base para consulta/entrada em eventos, filas, saída da Arena, histórico e avaliação. Nenhum serviço, contrato HTTP, backend ou dependência foi alterado.
- Incluído teste de renderização do Perfil UI-11/12 em `app/tests/profile.test.cjs`.
- Ajustados os testes de entrada, avaliações, navegação e ações reais para inspecionar `InputField.error` e fornecer stubs de componentes, StatusBar, tema, React Native e Safe Area ao harness Node.

## Validação

Validação final automatizada executada por Luna Medium após a correção JSX do Login:

- Testes focados de autenticação, navegação, visual e questionário: 97 aprovados, 0 falhos.
- Regressão completa do app: 367 aprovados, 0 falhos.
- Bundle Expo iOS (`CI=1`, `EXPO_NO_DOTENV=1`): aprovado, com 20 arquivos exportados para diretório temporário fora do repositório.
- `git diff --check`: aprovado.
- O erro de sintaxe JSX no condicional do atalho para Cadastro em `LoginScreen.js` foi corrigido com o ramo `: null`; a correção está incluída nesta entrega.

O visual atualizado foi integrado ao Welcome, Login, Cadastro, Recuperação de Senha e às três etapas do Questionário, incluindo edição e estados de carregamento/erro. Permanecem os fluxos reais de sessão e segundo fator, validação dos formulários e consulta/salvamento do questionário. Os serviços de eventos, filas, Arena, histórico, finalização e avaliação e seus contratos existentes foram preservados.

A homologação visual no Expo Go foi realizada parcialmente. A homologação ponta a ponta de eventos, Arena, filas e avaliações continua pendente: o banco Neon consultado não possui eventos cadastrados para exercitar esses fluxos. As telas demonstrativas legadas `ActiveArenaScreen` e `ArenaQueueScreen` ainda usam o visual anterior; as rotas operacionais reais recebidas do servidor usam as telas integradas.

Os resultados acima não representam homologação completa nem aprovação para merge. Antes do merge, ainda é necessária a conferência ponta a ponta dos fluxos reais de eventos, Arena, filas e avaliações com dados disponíveis, além da revisão de merge pelo responsável.
