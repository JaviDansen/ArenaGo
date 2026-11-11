# Diagnóstico da fixture de homologação Staff

A fixture informa, por mensagens fixas, divergência de confirmação, comprimento inválido, senha recusada pela política existente, reutilização na mesma execução, erro na leitura interativa ou falha na geração do hash. Erros inesperados mantêm a mensagem genérica. Mensagens de bibliotecas, senhas e hashes não são exibidos.

A validação de senhas, os parâmetros Argon2id, as guardas de destino e o fluxo transacional foram preservados. As categorias de leitura e hash abrangem apenas a preparação das senhas sintéticas; erros anteriores e posteriores continuam genéricos. As mensagens não identificam a causa da tentativa anterior.

Arquivos alterados: `backend/scripts/prepare-staff-homologation.cjs` e `backend/test/unit/staff-homolog-diagnostics.test.cjs`, além deste relatório e da evidência correspondente.

Em 11/11/2026, com `NODE_ENV=test` e variáveis de conexão removidas, `node --test test/unit/staff-homolog-diagnostics.test.cjs` executou 7 testes simulados: 7 aprovados, 0 falhos e 0 ignorados. Os typechecks de produção e dos testes do backend terminaram com código 0. O teste usa leitura e hash simulados, sem conexão PostgreSQL; não comprova o comportamento de um terminal real nem executa a fixture. O typecheck dos testes TypeScript não verifica o novo arquivo `.cjs`.

Nenhuma fixture, migration, seed ou operação PostgreSQL foi executada nesta alteração. Uma execução futura requer a autorização e as verificações de ambiente aplicáveis.
