# Staff — remoção na tela da estação

A tela apresenta pessoas aguardando com posição e nome, sem ação de remoção. A pessoa chamada conserva as ações de conclusão, ausência e remoção, com confirmação e coordenação de intenção existentes. O backend e a rota de remoção de espera não foram alterados nesta tarefa.

O teste de navegação real foi ampliado com três pessoas aguardando e uma chamada. Os testes focados do aplicativo executados em `NODE_ENV=test` registraram 98 aprovados, 0 falhos e 0 ignorados. O Expo Go e a concorrência PostgreSQL real não foram homologados nesta tarefa.

A evidência contém o diff acumulado dos dois arquivos do aplicativo, incluindo alterações locais anteriores da Correção Staff 01, para preservar um patch aplicável ao estado anterior do Git.
