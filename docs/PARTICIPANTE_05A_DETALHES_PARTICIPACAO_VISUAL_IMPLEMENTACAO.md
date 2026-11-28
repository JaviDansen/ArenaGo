# PARTICIPANTE-05A — Detalhes da participação: antecipação visual

## Diagnóstico e estratégia antes da implementação

Base efetiva: `52dfe6309e6f9ed6898164796427e4638c482b18`, branch `feature/heliom-participante-ux`. Antecipação exclusivamente visual; não conclui a PARTICIPANTE-05. PARTICIPANTE-01 permanece suspensa.

A rota ParticipationDetails habilita um header nativo, expondo o nome da rota de origem no iOS. A tela real exibe status e motivo brutos, datas com segundos e resumo distribuído em linhas altas. A intervenção desabilitará apenas esse header nativo e usará ScreenHeader com goBack, inclusive para detalhes indisponíveis. Permanência e atendimentos terão cards flexíveis; os campos temporais serão compactos, com data completa sem segundos e indicação do fuso do dispositivo. Estados e motivos serão traduzidos após inspeção dos valores de domínio. A avaliação usará cinco ícones gráficos existentes, em leitura, com nota real, preservando consulta, erro, carregamento e pendência.

Nenhum endpoint, timestamp, cálculo, dado histórico, permissão ou regra de avaliação será alterado. A duração continuará utilizando o mecanismo atual. Nome do evento e data da participação usarão exclusivamente o contrato real, sem tratar ingresso como data oficial do evento.

## Validação planejada

Preparar testes de apresentação, retorno, estados, motivos, datas diferentes, duração longa, nota/comentário, pendência, erro e indisponibilidade; preservar cenários existentes de Home/Eventos. A execução cabe a Luna Medium conforme AGENTS.md. A aprovação anterior de 1009 testes não valida esta revisão. Capturas finais para o paper dependem de execução real conectada ao backend pelo responsável.

## Implementação concluída localmente

- Header nativo desativado exclusivamente em ParticipationDetails. ScreenHeader com título e goBack presente nos estados válido e indisponível; origem Home/Eventos preservada sem reset ou navegação fixa.
- Evento com nome completo, status real traduzido, inclusive Cancelada, e Data da participação identificada pelo ingresso. Não há data oficial do evento inventada.
- Cards de Permanência e Atendimentos concluídos em flex com quebra, sem altura fixa. Cálculo original intacto, incluindo durações superiores a um dia. Linhas temporais flexíveis, datas completas sem segundos e indicação explícita do fuso do dispositivo.
- Status finished/active/waiting/canceled e oito motivos reais traduzidos. Fontes: participation-lifecycle.service.ts, staff-entry-call.service.ts, admin-close.service.ts e event-closure.projection.ts. Valores desconhecidos têm fallback neutro; valores de contrato não são modificados.
- Sua avaliação utiliza a representação gráfica ★/☆ já empregada por EvaluationScreen, com cores do tema, sem Pressable, nota real e comentário opcional. O grupo tem rótulo acessível e cinco estrelas; erro/carregamento não exibem estrelas fictícias. Pendência mantém RealEvaluation e o item original.
- Não houve modificação de autenticação, serviços, backend, timestamps ou regras de avaliação. Não houve novas dependências.

## Testes preparados e verificações

Criado `app/tests/participante05aDetalhesVisual.test.cjs` para retorno, estados, duração longa (135h 53min), contagem real, datas de dias distintos sem segundos, motivos, fallback, consulta da avaliação com carregamento/erro/comentário, leitura das estrelas e ação pendente. A inspeção das origens Home/Eventos e da rota é estática; não substitui a validação do retorno em navegação real. Adaptada a expectativa anterior de header nativo em participationDetails.test.cjs sem remover suas demais asserções.

O implementador realizou inspeção sintática e integridade Git/evidência. Nenhum teste, lint, build ou typecheck foi executado, conforme separação de executor do AGENTS.md. Não existe novo resultado de aprovação automatizada. Para Luna Medium, após inspecionar os comandos e configurar NODE_ENV=test em ambiente isolado, executar na raiz:

```powershell
node --test app/tests/participante05aDetalhesVisual.test.cjs
node --test app/tests/participationDetails.test.cjs
node --test app/tests/participationActionScreens.test.cjs
node --test app/tests/participationEvaluations.test.cjs
npm.cmd --prefix app test
```

A regressão completa deve seguir a aprovação das suítes focadas. Não conectar a banco real. Evidência: `qa-evidence/PARTICIPANTE_05A-changes.diff`, base `52dfe6309e6f9ed6898164796427e4638c482b18`, restrita a App.js, tela real de detalhes, dois arquivos de teste relacionados e este documento, excluindo o próprio patch.

## Limitações e entrega

Consulta remota tentada e indisponível por falha de conexão ao GitHub; o SHA de origem foi confirmado localmente. As capturas iPhone citadas no pedido não estão disponíveis no anexo acessível. Nenhuma renderização nativa ou captura real foi produzida nesta execução. Verificar no Expo: 375–430 dp, nomes extensos, fonte ampliada, quebra dos cards, cinco estrelas, comentários longos, retorno a partir da Home e de Eventos, inclusive detalhes indisponíveis. A captura do paper deve ser obtida pelo responsável no aplicativo real conectado ao backend.

A engrenagem flutuante não foi identificada nestas telas pelo código; o controle de configurações de câmera em EventEntry é distinto. Não foi removida funcionalidade global nem atribuída a origem externa sem evidência.

Estado: antecipação visual implementada localmente, aguardando campanha Luna Medium e validação no aparelho. Não conclui a PARTICIPANTE-05. Sem staging, commit, push ou merge.

Conferência final: análise sintática dos JS/CJS alterados e `git diff --check -- app docs` aprovados. A evidência passou em `git apply --reverse --check`. A verificação Git global sinaliza uma linha de contexto vazia com espaço no patch acumulado da 02A, sem whitespace incorreto nos arquivos de código/documentação. Isso não representa execução dos testes preparados.

## Correção complementar — identidade visual e paleta

A revisão consultou os tokens oficiais sem modificá-los globalmente. Cards de informações, permanência, atendimentos e avaliação agora usam superfície neutra `colors.background.base`, evitando o tom azulado herdado de elevated. Contornos suaves usam primaryLight com alfa 40 hexadecimal; a avaliação tem borda primary, os ícones de resumo têm fundo primaryDim e os valores de resumo usam primaryLight. O estado indisponível mantém contorno amarelo; participação ativa e finalizada usam verde, cancelada permanece neutra e aguardando mantém aviso amarelo. Erros mantêm vermelho.

As estrelas preenchidas usam `colors.semantic.warning`, como `EvaluationScreen` e a indicação do próprio colors.js para avaliações; as vazias continuam neutras. Essa exceção preserva a convenção gráfica existente, mantendo a identidade roxa nos cards, ícones e destaques. Não houve alteração do background original, rotas, handlers, dados, cálculos ou contratos. O restante da revisão anterior foi preservado.

Verificações desta rodada: inspeção estática de sintaxe, diff e integridade dos patches. Nenhum teste, lint, typecheck ou build executado; a campanha aguarda confirmação manual de Luna Medium. A validação visual definitiva das cores e contraste permanece com o responsável no iPhone antes das capturas reais. Evidências únicas 02A/05A regeneradas com as bases e escopos documentados anteriormente.
