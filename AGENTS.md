# ArenaGo — Atualização das instruções permanentes do Codex

## Objetivo

Atualizar exclusivamente o arquivo `AGENTS.md` da raiz do repositório para estabelecer uma nova política permanente de seleção de modelos e execução controlada de validações.

Preservar as regras existentes de escopo, segurança, Git, evidências, documentação e integridade do banco de dados, exceto pelos trechos que precisam ser substituídos pela nova política.

**Não executar testes durante a alteração deste documento.**

## 1. Seleção inteligente de modelos

Adicionar uma seção permanente chamada:

`## Seleção de modelos e níveis de raciocínio`

Antes de iniciar cada tarefa, recomendar a combinação mais econômica que ofereça capacidade adequada ao risco.

Referências:

- GPT-6 Luna: inspeções simples, documentação, pequenas alterações e tarefas mecânicas.
- GPT-6.1 Terra: bugs delimitados, interfaces e alterações intermediárias.
- GPT-6.1 Sol: funcionalidades completas, integração entre módulos e refatorações complexas.
- GPT-6 Astra: revisões críticas, arquitetura, segurança e concorrência.

Níveis de raciocínio:

- Low: tarefas mecânicas.
- Medium: operações rotineiras.
- High: múltiplas dependências ou riscos.
- Extra High: investigação profunda de problemas especialmente difíceis.

Essas classificações são heurísticas, não garantias absolutas de desempenho.

A recomendação deve considerar complexidade, risco de regressão, segurança, escopo, custos e possibilidade de retrabalho.

Não recomendar automaticamente o modelo mais poderoso.

O Codex não pode trocar o modelo por conta própria nem afirmar que verificou sua seleção se não houver mecanismo confiável para isso.

A escolha final do modelo pertence ao responsável.

## 2. Política permanente de execução de validações

Substituir a proibição absoluta de testes, lint, typecheck e build pela seguinte política.

### Executor padrão de validações

**GPT-6 Luna com raciocínio Medium será o modelo designado para executar validações automatizadas rotineiras no ArenaGo.**

Quando outro modelo estiver realizando uma implementação ou revisão, ele deverá preparar as instruções de validação, mas não executar as verificações.

O responsável selecionará manualmente Luna Medium para a etapa de execução.

Se a seleção do modelo não estiver confirmada pelo responsável, não iniciar testes com base apenas em suposições.

### Validações permitidas com Luna Medium

Permitir:

- Testes unitários.
- Testes HTTP simulados.
- Testes focados.
- Regressões unitárias.
- Typecheck de produção.
- Typecheck de testes.
- ESLint.
- Build local não destinado a distribuição.
- Verificações estáticas Git.

Antes da execução:

1. Inspecionar os comandos e scripts envolvidos.
2. Confirmar que não executam migrations, seeds, limpeza de banco, scripts destrutivos ou operações externas inesperadas.
3. Confirmar o diretório de trabalho e a branch.
4. Preservar alterações não commitadas.
5. Configurar ambiente de testes isolado.
6. Não imprimir segredos nem URLs com credenciais.

É proibido executar testes indiretamente por comandos aparentemente inofensivos para contornar as restrições.

### Integrações PostgreSQL

Integrações que utilizam PostgreSQL real exigem autorização explícita do responsável para cada campanha de validação.

Antes de executar:

1. Identificar o banco dedicado autorizado.
2. Confirmar `NODE_ENV=test`.
3. Confirmar a identidade das URLs exigidas.
4. Confirmar host, porta e nome exato do banco.
5. Confirmar `current_database()`.
6. Verificar a presença das migrations necessárias, sem executá-las automaticamente.
7. Confirmar que as fixtures não realizarão limpeza global.
8. Preservar registros preexistentes, inclusive Admins históricos.
9. Registrar snapshots quando a validação envolver dados históricos importantes.

Não usar banco de produção, homologação ou banco compartilhado sem autorização específica.

Não executar migrations, seeds, `DROP`, `TRUNCATE`, resets ou exclusões abrangentes.

Se qualquer confirmação falhar, interromper a execução.

## 3. Responsabilidades por tipo de tarefa

### Implementação

O modelo selecionado para implementar deve:

- Desenvolver exclusivamente a task.
- Criar testes necessários.
- Revisar estaticamente os arquivos.
- Preservar contratos e decisões existentes.
- Informar quais validações são necessárias.
- Não executar testes quando não estiver designado para a etapa de validação.

### Validação

Luna Medium deve:

- Executar somente os comandos autorizados.
- Registrar comandos, resultados e códigos de saída.
- Informar contagem de testes aprovados, falhos e ignorados.
- Identificar falhas sem modificar expectativas para forçar aprovação.
- Não corrigir automaticamente bugs complexos fora da tarefa.
- Não modificar migrations ou regras de negócio durante a validação.
- Não fazer commits ou push.

Se um teste falhar, apresentar o diagnóstico inicial e indicar se a correção exige outro modelo.

### Revisão crítica

Para segurança, autenticação, permissões, concorrência, idempotência, transações ou integridade de dados, recomendar GPT-6.1 Sol ou GPT-6 Astra, com nível High ou Extra High conforme a dificuldade.

Essa revisão deve analisar contratos, código, invariantes, transações e testes preparados.

O uso de um modelo mais poderoso não autoriza mudanças adicionais de escopo.

Quando a revisão terminar, retornar a Luna Medium para executar as validações necessárias.

## 4. Política de escalonamento

Se Luna Medium identificar:

- Deadlocks.
- Condições de corrida.
- Falhas de autorização.
- Inconsistência transacional.
- Corrupção ou perda potencial de dados.
- Contradições arquiteturais.
- Falhas persistentes sem causa evidente.

Deverá interromper correções especulativas e recomendar uma investigação com Sol ou Astra.

Não gastar recursos repetindo testes sem uma hipótese técnica justificável.

## 5. Relatórios e evidências

Preservar a obrigação de gerar:

- `docs/<TASK>_IMPLEMENTACAO.md`
- `qa-evidence/<TASK>-changes.diff`

Os relatórios devem diferenciar:

- Validações não executadas.
- Validações executadas pelo Codex com autorização.
- Validações executadas manualmente pelo responsável.
- Inspeções estáticas.

Nunca inventar resultados ou declarar testes aprovados sem execução comprovada.

Manter a política de evidência única por task e de patches compatíveis com `git apply`.

## 6. Git e segurança

Manter proibidos:

- `git add`.
- `git commit`.
- `git push`.
- `git reset`.
- `git merge`.
- `git rebase`.
- Alterações automáticas do histórico.

Os commits permanecem sob responsabilidade do usuário, utilizando o VSCode.

Preservar todas as restrições existentes sobre operações destrutivas, bancos, migrations e dados sensíveis.

## 7. Prioridade das instruções

A nova política substitui exclusivamente a antiga proibição absoluta de execução de testes, lint, typecheck e build.

As demais restrições do `AGENTS.md` continuam válidas.

Prompts específicos podem restringir ainda mais as operações permitidas.

Nenhuma instrução pode ampliar permissões sobre bancos, produção, operações destrutivas ou publicação sem autorização explícita do responsável.

## 8. Execução desta atualização

Nesta solicitação:

1. Modificar somente o `AGENTS.md` da raiz.
2. Preservar o conteúdo existente que não conflite com a nova política.
3. Eliminar contradições entre seções antigas e novas.
4. Não modificar `app/AGENTS.md` nem outros arquivos.
5. Não executar testes, lint, typecheck, build ou banco.
6. Não fazer staging, commit ou push.
7. Executar apenas inspeção estática e `git diff --check`.
8. Apresentar o diff e um resumo das regras alteradas.

Não gerar evidência de task para esta simples atualização de configuração.

Aguardar revisão do responsável.