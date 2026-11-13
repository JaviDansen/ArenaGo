# Reutilização de senha na fixture Staff

A fixture de homologação aceita uma senha sintética exclusiva para a conta Admin e permite reutilizar uma senha sintética entre a conta Staff e os cinco participantes. Cada conta ainda pede a digitação duas vezes, aplica a política existente com o contexto daquela conta e gera hash Argon2id com os parâmetros do cadastro. Nenhuma senha foi fixada no código; autenticação, cadastro, guardas de banco e transação não foram alterados.

Arquivos desta alteração: `backend/scripts/prepare-staff-homologation.cjs`, `backend/test/unit/staff-homolog-diagnostics.test.cjs`, `docs/STAFF_HOMOLOG_FIXTURE_IMPLEMENTACAO.md` e este relatório. A evidência correspondente é `qa-evidence/STAFF_HOMOLOG_PASSWORD_REUSE-changes.diff`.

Validação em 11/11/2026, com `NODE_ENV=test` e variáveis de conexão removidas:

- Teste simulado direcionado: 9 aprovados, 0 falhos, 0 ignorados.
- Typecheck de produção: aprovado.
- Typecheck dos testes: aprovado.
- `git diff --check`: aprovado.

Os testes simulam leitura e hash; não executam a fixture e não acessam PostgreSQL ou Neon. Migrations e seed também não foram executados.
