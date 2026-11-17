# Reorganização documental ArenaGo

O Panorama permanece a referência principal de decisões, requisitos e diagnóstico do produto. O antigo planejamento v0.7.12 foi renomeado para `docs/DOCUMENTO_ARENAGO_HISTORICO_V0_7_12.md`, preservando seus bytes e registros. README e Arquitetura apontam para o Panorama; relatórios históricos indicam o arquivo arquivado e o nome usado na época. Patches históricos mantêm os caminhos originais para preservar sua aplicabilidade na base histórica.

O Panorama já tinha alterações locais antes desta tarefa e foi preservado sem edição adicional. O novo planejamento não foi alterado. A renomeação foi feita no sistema de arquivos, sem staging: o Git poderá reconhecê-la como renomeação quando o responsável preparar o commit.

Inspeções estáticas: estado Git, referências e SHA-256 do arquivo histórico. Nenhum teste, lint, typecheck, build, operação de banco ou validação manual pelo responsável foi executado nesta tarefa. Nenhum commit ou push foi realizado. A evidência única `qa-evidence/REORGANIZACAO_DOCUMENTAL-changes.diff` registra as alterações desta tarefa, sem incluir as alterações preexistentes do Panorama ou a si própria.
