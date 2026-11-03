# ArenaGo — instruções permanentes do Codex

Estas regras valem para todo o repositório e substituem procedimentos históricos
incompatíveis. Não aplicar patches antigos automaticamente.

## Escopo e revisão

- Implementar somente a task solicitada, criar testes e realizar revisão técnica
  pontual. Não iniciar outras tasks automaticamente.
- Registrar o estado inicial, incluindo arquivos não rastreados; preservar
  alterações preexistentes, código fora do escopo e documentos históricos.
- Não executar auditoria geral com subetapas pendentes. A auditoria completa da
  E08 ocorrerá somente após finalizar todas as E08.x.

## Testes e relatório

- Executar unitários relevantes, HTTP simulados quando aplicável, typecheck,
  lint e build, mantendo a cobertura necessária.
- PostgreSQL real é executado manualmente pelo responsável, sem compartilhamento
  de credenciais. Não solicitar credenciais nem presumir aprovação da integração.
- Antes de corrigir falhas, identificar instrução, fase e causa real, confrontando
  código, fixture, schema e especificação. Corrigir a causa comprovada; não alterar
  expectativas apenas para aprovar, remover testes, enfraquecer asserções,
  desabilitar constraints/autenticação ou substituir PostgreSQL real por mocks.
- Criar `docs/<TASK>_IMPLEMENTACAO.md` com contrato, decisões, resultados reais e
  pendências. Distinguir execução do Codex de aprovação manual; não declarar
  testes não executados ou validação de produção sem evidência.

## Evidência única por task

- Gerar em `qa-evidence/eXX-X-changes.diff` um patch Git completo da task, incluindo
  arquivos novos ainda não rastreados, modificados e removidos, antes do commit manual.
- Após correções, atualizar esse mesmo arquivo. Não criar sufixos `rev`, `final`,
  `fix` ou timestamps. Preservar evidências históricas de outras tasks.
- Usar `diff --git`, caminhos relativos, UTF-8 sem BOM e compatibilidade com
  `git apply`. Excluir segredos, `.env` e variantes, dependências instaladas,
  temporários, outros `.diff` e alterações alheias à task.
- Validar a aplicação sobre a base correta em cópia isolada e comparar com os
  arquivos finais, sem alterar o índice. Não gerar diff para simples configuração,
  salvo necessidade e autorização explícitas.

## Git e comunicação

- Não executar `git add`, `git commit`, `git push`, merge ou rebase, nem alterar
  o histórico. Todo versionamento é manual, feito pelo responsável.
- Mensagens de commit usam Conventional Commits, com descrição em português.
- Ao concluir, informar alterações, testes realizados, resultados, pendências e
  caminho da evidência aplicável; deixar os arquivos disponíveis para revisão manual.
- Economizar tokens com leituras direcionadas e logs resumidos, sem comprometer
  investigação, qualidade ou cobertura dos testes.
