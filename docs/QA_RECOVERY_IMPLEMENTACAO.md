# QA_RECOVERY — Recuperação do QA independente

Data: 2026-11-12. Campanha executada pelo Codex com autorização excepcional expressa do responsável para Sol High. Nenhuma validação manual do responsável foi comunicada.

## Resultado

**GO técnico para revisão/publicação da manutenção QA e avanço do fechamento Admin.** Publicação, push, PR e merge continuam sem autorização e não foram executados. Este parecer não representa teste físico nem compilação nativa.

| Comando | Ambiente | Resultado | Exit code |
| --- | --- | --- | --- |
| npm.cmd --prefix qa/regression run test:report | qa-recovery, primeira execução após adaptação | 49 aprovados, zero falhos/ignorados/cancelados | 0 |
| npm.cmd --prefix qa/regression run test:report | qa-recovery, versão final | 51 aprovados, zero falhos/ignorados/cancelados | 0 |
| npm.cmd --prefix qa/regression run test:report | qa-admin-check, versão final | 51 aprovados, zero falhos/ignorados/cancelados | 0 |
| npm.cmd --prefix qa/regression run test:existing-guard | qa-recovery | 14 testes aprovados, zero falhos/ignorados/cancelados | 0 |
| npm.cmd --prefix app test | qa-admin-check | 588 aprovados, zero falhos/ignorados/cancelados | 0 |
| git diff --check | qa-recovery | Sem erros de whitespace | 0 |

## Isolamento e referências

- Base conferida por fetch: origin/develop f9c908471d93890899cd0888ca1aadc49b3db116.
- Manutenção: .worktrees/qa-recovery, branch maintenance/independent-qa.
- Comparação Admin: .worktrees/qa-admin-check, HEAD destacado na base, com o patch preparado em admin-final aplicado apenas nessa cópia.
- Origem Admin: 56d4f86cfb2f457f44ede9930a617a5629ea05e9.
- Worktrees preexistentes admin-final, admin-baseline e a raiz preservadas. Nenhum código de app/backend foi alterado pela manutenção. Nenhum commit Admin foi criado.
- Node v24.15.0, Windows x64. Ambas as cópias usam junctions para as mesmas dependências locais de app/backend/QA; nenhuma instalação ou alteração de lockfile. NODE_ENV=test, CI=1, EXPO_NO_DOTENV=1 em ambas.
- AGENTS.md, scripts, runner, carregadores e fronteiras de transporte foram inspecionados. Não houve PostgreSQL real, Neon, migrations, seeds reais ou publicação. Os callbacks K03 são transpilados e avaliados isoladamente contra pool em memória; o módulo de integração e seus hooks não são importados.

## Causas e soluções das oito falhas

| Falha anterior | Causa | Solução |
| --- | --- | --- |
| F01 | Prefixo K03-F.1 passou a identificar dois callbacks legítimos; fixture desatualizada para snapshot de catálogo inteiro | Selecionar univocamente o callback de reinicialização e modelar SELECT/snapshot/restore por IDs |
| F02 | Mesmas mudanças de callback e restauração | Manter igualdade exata do timestamp original; usar texto com microssegundos, sem conversão para Date |
| F05 | A seleção ambígua impedia alcançar o finally real | Executar o callback real com a constante SQL literal extraída do mesmo AST; falhas de corpo e cleanup continuam injetadas e o erro primário precisa permanecer observável |
| F07 | Mesmo bloqueio antes da execução | Executar o finally real e exigir restauração após falha do corpo e preservação da exceção primária |
| navigation.test.cjs | Imports legítimos atuais ausentes no harness | Carregar AuthBackground e tema reais, reconhecer Image/assets e caminhos atuais do App, mantendo React Navigation real |
| questionnaire-ui.test.cjs | Mesmo import AuthBackground bloqueava o arquivo inteiro | Mesmo harness corrigido; nenhuma asserção da suíte alterada |
| session-isolation.test.cjs | Mesmo bloqueio de importação | Mesmo harness corrigido; nenhuma asserção da suíte alterada |
| A19 | Guarda atual proíbe explicitamente database/dbname no query, ainda que o parser ignore database | Manter a pré-condição do parser e exigir a rejeição de segurança correta. Não alterar a guarda |

O extrator continua exigindo exatamente um callback. A constante restoreQuestionnaireActivationSql é extraída do código real somente se for template literal sem interpolação; não há fallback arbitrário nem callback artificial. A fixture reconhece a restauração em lote e verifica casts, unnest e correspondência por ID. Não executa SQL real e não substitui integração PostgreSQL.

Os mocks limitam-se às fronteiras de transporte, armazenamento, componentes nativos/assets e telas de destino não exercitadas. AuthBackground, tema, questionário, sessão e construção/reconciliação de rotas usam as implementações reais. Não foram introduzidos skips, filtros de exclusão, conversão de erros em aprovação ou mocks de hooks/transições funcionais. O carregador continua recusando imports não declarados.

## Cobertura recuperada

Antes: 22 aprovações e 8 falhas, sendo três falhas de arquivo antes dos seus casos internos. Agora: 51 testes reais aprovados em cada ambiente.

- Recuperados 22 casos antes abortados: B01–B02 (navegação), D01–D04 (busca), E01–E03 (preload/edição local) e C01–C13 (isolamento, callbacks e navegação entre sessões).
- Corrigidas as quatro execuções K03 F01/F02/F05/F07 e a expectativa A19. F03/F04/F06/F08 e A01–A18 permanecem executados.
- Acrescentados F09 (restauração de todas as versões por ID, NULL e microssegundos) e F10 (falha de leitura não pode restaurar snapshot inexistente nem suprimir o erro original).
- A passagem de 30 resultados para 51 é +21: três placeholders de aborto foram substituídos por 22 casos internos e somaram-se dois novos testes. Não são 21 casos anteriormente reprovados corrigidos na aplicação.

Os 51 nomes e resultados foram comparados individualmente e coincidem. Os quatro arquivos executáveis de manutenção têm hashes SHA-256 idênticos nos dois ambientes. Não surgiram falhas funcionais escondidas após remover os abortos. comparison.json enumera os 22 casos recuperados e todos os resultados, além dos hashes.

## Arquivos e evidências

Mudanças executáveis exclusivamente em:

- qa/regression/helpers/source.cjs
- qa/regression/helpers/react-app.cjs
- qa/regression/tests/k03-cleanup.test.cjs
- qa/regression/tests/postgres-guard.test.cjs

Documentação: qa/regression/EXECUTION.md (identificação do registro histórico), este relatório e patch único qa-evidence/QA_RECOVERY-changes.diff. As evidências versionadas são comparison.json (resultados individuais e hashes) e preservation.json (comparação dos arquivos do aplicativo). Os logs brutos de comandos, TAP/JSONL/stderr, testes da guarda e suíte do aplicativo permanecem disponíveis somente no disco em qa-evidence/QA_RECOVERY/. Não há exigência de versionar esses logs, e os resumos estruturados preservam os resultados da auditoria. O patch contém código, documentação e os dois resumos; não contém a si mesmo ou logs. O manifesto SHA256SUMS.json antigo permanece como evidência histórica, sem apresentar seus hashes como os atuais.

O responsável autorizou expressamente git add com caminhos explícitos e git commit, como exceção pontual ao AGENTS.md, exclusivamente nesta worktree e branch. O registro local desta entrega usa a mensagem test(qa): restore independent regression coverage; seu SHA é informado no chat e consultável por git log -1 na branch maintenance/independent-qa. A seleção compreende somente nove arquivos: quatro executáveis QA, EXECUTION.md, este relatório, o patch e os dois resumos JSON. A integração Admin preparada permanece separada; o hash agregado dos 639 arquivos conferidos nela permaneceu idêntico antes e depois da tentativa anterior. A autorização não inclui push, PR, merge ou alteração da develop.

## Limites

Não foram repetidos os bundles: nenhuma fonte, configuração ou dependência Expo mudou; a campanha anterior gerou web/Android/iOS com sucesso. Não houve inspeção física de câmera/QR, teste em aparelho, Gradle ou Xcode. A aprovação recupera a campanha automatizada independente; a revisão e autorização de publicação pertencem ao responsável.
