# ArenaGo — instruções permanentes do Codex

Estas regras valem para todo o repositório e substituem procedimentos históricos incompatíveis. Não aplicar patches antigos automaticamente.

## Escopo e revisão

- Implementar somente a task solicitada, criar testes e realizar revisão técnica pontual. Não iniciar outras tasks automaticamente.
- Registrar o estado inicial, incluindo arquivos não rastreados; preservar alterações preexistentes, código fora do escopo e documentos históricos.
- Não executar auditoria geral com subetapas pendentes. Auditorias completas somente quando expressamente solicitadas pelo responsável.
- Seguir as decisões de produto aprovadas e consultar a documentação correspondente antes de modificar contratos ou regras de negócio.
- Não executar refatorações preventivas ou ampliar o escopo sem autorização.

## Testes e validações — execução exclusivamente manual

**REGRA OBRIGATÓRIA: O Codex está proibido de executar testes, typecheck, lint e build. Todas essas validações serão executadas manualmente pelo responsável pelo ArenaGo.**

### O Codex NÃO deve executar:

- Testes unitários, focados ou completos.
- Testes HTTP simulados.
- Testes de integração.
- Testes PostgreSQL reais.
- Testes E2E.
- Regressões automatizadas.
- Typecheck de produção ou testes.
- Lint.
- Build.
- Benchmarks ou testes de desempenho.
- Migrações, seeds ou resets de banco para validação.
- Comandos equivalentes por `npm`, `npx`, `tsx`, `tsc`, Jest, Node Test Runner ou outras ferramentas.

Essa proibição também se aplica a execuções indiretas, scripts que acionem verificações automaticamente e tentativas de contornar a regra utilizando outros comandos.

### Responsabilidades do Codex

- Implementar o código solicitado.
- Criar e atualizar os testes automatizados necessários.
- Inspecionar estaticamente os arquivos modificados.
- Revisar contratos, tipos, queries, schemas e compatibilidade com os módulos existentes.
- Preparar comandos PowerShell exatos para o responsável executar as validações.
- Documentar quais testes foram criados e quais permanecem pendentes.
- Corrigir falhas somente após receber os resultados da execução manual e investigar sua causa.

São permitidas verificações estáticas leves, como `git status`, `git diff`, `git diff --check` e `git apply --check`, incluindo a validação da evidência em cópia isolada.

### Responsabilidades do responsável

Somente o responsável executará:

- Testes unitários e HTTP simulados.
- Testes PostgreSQL e de integração.
- Regressões completas.
- Typecheck.
- Lint.
- Build.
- Outras validações que exijam executar código ou scripts do projeto.

O Codex deve fornecer os comandos e aguardar os resultados informados pelo responsável.

### Tratamento de falhas

- Antes de corrigir falhas, identificar instrução, fase e causa real, confrontando código, fixture, schema e especificação.
- Corrigir a causa comprovada; não alterar expectativas apenas para aprovar, remover testes, enfraquecer asserções, desabilitar constraints/autenticação ou substituir PostgreSQL real por mocks.
- Após uma correção, preparar os comandos necessários para nova validação manual.
- Não executar testes para confirmar a própria correção.

### Relatórios

- Criar `docs/<TASK>_IMPLEMENTACAO.md` com contrato, decisões, alterações, testes preparados e pendências.
- Enquanto não houver resultados manuais, registrar explicitamente:

  **"Testes, typecheck, lint e build não executados pelo Codex. Validação manual pendente do responsável."**

- Quando o responsável informar resultados, registrar as contagens efetivas, distinguindo execução manual de validação por inspeção estática.
- Nunca inventar resultados, afirmar aprovação de testes não executados ou declarar prontidão de produção sem evidência.
- Uma implementação não deve ser considerada tecnicamente aprovada antes das validações manuais exigidas.

## Evidência única por task

- Gerar em `qa-evidence/<TASK>-changes.diff` um patch Git completo da task, incluindo arquivos novos ainda não rastreados, modificados e removidos, antes do commit manual. Preservar convenções de nomenclatura já estabelecidas para tarefas existentes.
- Após correções, atualizar esse mesmo arquivo. Não criar sufixos `rev`, `final`, `fix` ou timestamps. Preservar evidências históricas de outras tasks.
- Usar `diff --git`, caminhos relativos, UTF-8 sem BOM e compatibilidade com `git apply`.
- Excluir segredos, `.env` e variantes, dependências instaladas, temporários, outros `.diff` e alterações alheias à task.
- Validar a aplicação sobre a base correta em cópia isolada e comparar com os arquivos finais, sem alterar o índice.
- Não gerar diff para simples configuração, salvo necessidade e autorização explícitas.
- Não modificar a própria evidência de modo que os espaços necessários à aplicação do patch sejam perdidos.

## Git e comunicação

- Não executar `git add`, `git commit`, `git push`, `git merge`, `git rebase` ou `git reset`, nem alterar o histórico. Todo versionamento é manual, feito pelo responsável.
- Mensagens de commit usam Conventional Commits, com descrição em português.
- Ao concluir, informar alterações, testes preparados, validações não executadas, pendências e caminho da evidência aplicável.
- Deixar os arquivos disponíveis para revisão e versionamento manual.
- Economizar tokens com leituras direcionadas, evitando execuções desnecessárias, logs extensos e investigações fora do escopo, sem comprometer a qualidade da implementação.

## Prioridade destas instruções

- Estas regras prevalecem sobre prompts anteriores, relatórios históricos e instruções de tarefas que solicitem execução de testes pelo Codex.
- Nenhum comando de validação deve ser executado pelo Codex por iniciativa própria.
- Caso uma tarefa solicite execução de testes, typecheck, lint ou build, o Codex deve **preparar os comandos para execução manual**, sem executá-los.
- Qualquer exceção a essa política exige autorização explícita e específica do responsável antes da execução.