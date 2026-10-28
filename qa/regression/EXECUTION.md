# Execução independente — commit 77381cf

**Resultado final:** 49 cenários executados, **30 RED**, **19 GREEN**, **0 BLOQUEADO**.
Todas as 30 falhas foram revisadas: são asserções do comportamento pretendido,
com pré-condições satisfeitas. Não há falha de importação/transpilação na execução
final. Código de saída: 1, preservado pelo runner.

**Referência:** branch `feature/auth-profile`,
`77381cf00f435f63063ef1d558c932aad5f9c472`.
Node.js 24.15.0; React 19.2.3; React Navigation core 7.22.1; routers 7.6.4.
Os fontes foram extraídos por `git archive` do commit. Todos os novos arquivos
ficam em `qa/regression`; não houve correção funcional.

Na mesma cópia, os **182 testes existentes do app passaram**. Os **5 subtestes
unitários existentes da guarda também passaram** (Node relata 6 contando o
agrupador). A guarda e seu teste foram transpilados apenas em memória, sem tsx
e sem setup de banco. Não foi executada nenhuma integração PostgreSQL.

Os logs completos são entregues em `delivery/evidence`:
`results.tap`, `results.jsonl`, `existing-app.tap` e `existing-guard.tap`.
Os IDs abaixo identificam exatamente os testes e suas mensagens nesses arquivos.
As saídas são de execução real; o runner não converte falhas em sucesso.

**A — interpretação de configuração PostgreSQL**

Arquivo: [postgres-guard.test.cjs](tests/postgres-guard.test.cjs).
Os destinos são calculados pelo parser real do driver, sem rede. A01–A05/A14
demonstram divergência concreta de interpretação; A06–A13 também exercitam
os requisitos conservadores de autorização descritos no README.

| Cenário | Resultado atual | Falha detectada / comportamento verificado | Evidência |
|---|---|---|---|
| A01 `localhost?...host=remote.example` | RED | Autoridade validada difere do host efetivo | Guarda retorna URL; parser aponta para `remote.example`; rejeição esperada não ocorre. |
| A02 parâmetro `h%6fst` | RED | Chave codificada também redireciona o driver | Parser decodifica para `host`; destino remoto autorizado. |
| A03 dois parâmetros `host` | RED | Último parâmetro remoto prevalece | Host efetivo `remote.example`, apesar de `host=127.0.0.1` anterior. |
| A04 `host` e `port` no query | RED | Redirecionamento conjunto não é validado | Host remoto e porta efetiva `443`, autoridade local/porta `55432`. |
| A05 protocolo `socket:` | RED | Driver interpreta outro host e outro banco | Guarda aceita `localhost/arenago_test`; driver usa `/arenago_test` e banco `production`. |
| A06 protocolo `https:` | RED | Protocolo incompatível autorizado | Nenhuma exceção de validação. |
| A07 protocolo `mysql:` | RED | Protocolo incompatível autorizado | Nenhuma exceção de validação. |
| A08 banco `arenago_k03_prod` | RED | Substring `k03` tratada como autorização | Nome não atestado pela fixture é aceito. |
| A09 banco `latest` | RED | Substring acidental `test` é suficiente | Nome efetivo `latest` aceito. |
| A10 banco `production_test_backup` | RED | Nome ambíguo aceito sem allowlist exata | Nenhuma rejeição. |
| A11 banco `arenago_descartavel_prod` | RED | Substring `descarta` é suficiente | Nenhuma rejeição. |
| A12 alias `postgres` não atestado | RED | Alias é aprovado sem prova de localidade | Host efetivo permanece o nome DNS; nenhum lookup foi executado. |
| A13 alias `arenago-local-pg` não atestado | RED | Nome sugestivo substitui prova de localidade | Host efetivo permanece o alias; nenhum lookup foi executado. |
| A14 socket via query `host=/shared/postgres` | RED | Outro endpoint local/compartilhado passa pela guarda | Driver seleciona diretório `/shared/postgres`, que a fixture não autoriza. |
| A15 autoridade remota direta | GREEN | Rejeição correta | A guarda lança erro para `remote.example`. |
| A16 banco `production` em loopback | GREEN | Rejeição correta | A guarda lança erro para o banco não autorizado. |
| A17 banco explicitamente permitido em 127.0.0.1 | GREEN | Configuração legítima continua disponível | URL preservada; host, banco e porta do parser correspondem à fixture. |
| A18 banco explicitamente permitido em localhost | GREEN | Configuração legítima continua disponível | URL preservada; host, banco e porta correspondem à fixture. |
| A19 query `database=production` | GREEN | Controle contra falso positivo | O parser mantém `arenago_test` do path; esse parâmetro não redireciona o banco. |

**B — React e navegação**

Arquivo: [navigation.test.cjs](tests/navigation.test.cjs).

| Cenário | Resultado atual | Falha detectada / comportamento verificado | Evidência |
|---|---|---|---|
| B01 concluir e renderizar MainTabs | RED | RESET perdido antes de registrar MainTabs | PUT resolvido; AuthContext publica concluído; `onUnhandledAction` recebe RESET; rotas são ampliadas; foco real e textos renderizados continuam em `ProfileQuestionnaire`, etapa 3. |
| B02 PUT falha | GREEN | Sem navegação ou desbloqueio indevido | Contexto continua pendente, rotas restritas, questionário e erro permanecem renderizados. |

B01 usa hooks, contexto e manager reais e o núcleo real de React Navigation.
O navigator de teste substitui a view nativa, mas não simula a decisão de aceitar
RESET, a reconciliação de rotas ou a execução dos efeitos. Não é teste E2E em
Android/iOS e não renderiza a implementação real das tabs de destino.

**C — sessões**

Arquivo: [session-isolation.test.cjs](tests/session-isolation.test.cjs).

| Cenário | Resultado atual | Falha detectada / comportamento verificado | Evidência |
|---|---|---|---|
| C01 etapa na instância retida | RED | Etapa de A mantida em B | Texto renderizado continua `Etapa 3 de 3`; `Sobre você` ausente. |
| C02 pesquisa já carregada na instância retida | RED | Query e sugestões de A mantidas | Input contém `A private`; um botão `Selecionar A private result` permanece. |
| C03 GET de A depois do GET de B | GREEN | Identidade protege respostas de perfil | Data `03/02/2001` de B e jogo `B Game` preservados; `A Game` ausente. |
| C04 rejeição tardia do PUT de A | RED | Erro de A publicado na interface de B | Banner `PRIVATE ERROR FROM A` e erro de campo aparecem. |
| C05 PUT de A ainda pendente | RED | Bloqueio de envio herdado por B | Após preencher os dados de B, botão continua `Salvando questionário...`. |
| C06 sucesso tardio do PUT de A, instância retida | GREEN | Callback de sucesso verifica usuário | B continua pendente e nenhuma navegação é chamada. |
| C07 resultado tardio de pesquisa de A | RED | Callback não é invalidado por troca de conta | Botão `Selecionar A LATE RESULT` surge somente após resolver a Promise de A. |
| C08 erros anteriores de validação | RED | Erros de A sobrevivem ao reset parcial | B recebe mensagens de data, gênero e escolaridade sem tentar validar seu formulário. |
| C09 feedback de inclusão de jogo | RED | Mensagem de sucesso de A aparece a B | Texto `"A Only Game" adicionado` permanece após troca. |
| C10 logout/remontagem pelo navegador; GET, busca e rejeição PUT tardios | GREEN | Fluxo normal isola instâncias | Navegador passa por Welcome; B começa na etapa 1; dados/erros de A não aparecem; finally de A não desbloqueia PUT de B; somente um PUT por conta. |
| C11 logout/remontagem pelo navegador; PUT tardio bem-sucedido | GREEN | Sucesso antigo não conclui B | B permanece pendente na etapa 1; nenhum RESET não tratado. |
| C12 loading de pesquisa na instância retida | RED | Spinner de A mantido em B | Texto `Buscando no catálogo...` aparece sem pesquisa de B. |
| C13 catálogo antigo de A após catálogo novo de B | RED | Callback antigo substitui dados mais novos | Botão de `A OLDER CATALOG` reaparece depois do catálogo de B. O catálogo é público; isto demonstra perda de atualização, não vazamento de dado pessoal. |

**Limite de alcance:** C01–C09 e C12–C13 mantêm o componente montado
intencionalmente. C10–C11 testam o fluxo normal que remove a rota no logout e
monta uma nova instância no login. Os resultados GREEN desse fluxo impedem
afirmar que todos os RED de instância retida são vazamentos reproduzidos no uso
normal do AppNavigation. Ambos os níveis são entregues para preservar esse limite.

**D — sugestões renderizadas**

Arquivo: [questionnaire-ui.test.cjs](tests/questionnaire-ui.test.cjs).

| Cenário | Resultado atual | Falha detectada / comportamento verificado | Evidência |
|---|---|---|---|
| D01 Roblox resolvido, Tetris pendente | RED | Sugestão incompatível continua selecionável | Árvore tem um `Selecionar Roblox` habilitado antes da resposta de Tetris. |
| D02 duas respostas fora de ordem | GREEN | Resposta antiga descartada | Tetris permanece selecionável, Roblox não aparece. |
| D03 limpar campo com busca pendente | GREEN | Limpeza invalida callback | Input vazio, sem sugestão tardia ou spinner. |
| D04 selecionar catálogo local durante busca | GREEN | Inclusão invalida busca em voo | Minecraft continua selecionado; input vazio; resposta tardia não reabre sugestões. |

**E — preload e intenção local**

Arquivo: [questionnaire-ui.test.cjs](tests/questionnaire-ui.test.cjs).

| Cenário | Resultado atual | Falha detectada / comportamento verificado | Evidência |
|---|---|---|---|
| E01 adicionar/remover Minecraft antes do GET | RED | Preload ressuscita jogo removido | Controle `Remover Minecraft` passa de 0 para 1 ao resolver o GET atrasado. |
| E02 local legítimo + remotos não editados | GREEN | Mesclagem preserva ambas as origens | Terraria, Minecraft e Stardew Valley têm exatamente um controle de remoção cada. |
| E03 duplicata local/remota com caixa diferente | GREEN | Mesclagem elimina duplicata | MINECRAFT/Minecraft geram apenas um controle selecionado. |

**F — código dos testes de integração, sem banco**

Arquivo: [k03-cleanup.test.cjs](tests/k03-cleanup.test.cjs).

| Cenário | Resultado atual | Falha detectada / comportamento verificado | Evidência |
|---|---|---|---|
| F01 activated_at originalmente NULL | RED | Cleanup reativa versão | Valor restaurado é Date, expectativa NULL. |
| F02 activated_at originalmente com data | GREEN | Data preservada exatamente | Mesmo timestamp em milissegundos após o finally. |
| F03 Apex originalmente FALSE | RED | Cleanup promove Apex | Estado final TRUE, expectativa FALSE; jogo customizado foi removido. |
| F04 Apex originalmente TRUE | GREEN | Cleanup mantém TRUE e remove fixture | TRUE preservado e mapa de jogos customizados vazio. |
| F05 falha principal e falha de cleanup em K03-F.1 | RED | Exceção principal perdida | Exceção observada é apenas `CLEANUP`; `PRIMARY` não é erro lançado, cause ou membro agregado. |
| F06 falha principal e falha de cleanup em K03-F.2 | RED | Exceção principal perdida | Mesmo comportamento de F05, no callback real K03-F.2. |
| F07 falha intermediária de K03-F.1 com cleanup funcionando | GREEN | Finally executa e preserva erro principal | Timestamp original restaurado; erro lançado é a instância PRIMARY. |
| F08 falha intermediária de K03-F.2 com cleanup funcionando | GREEN | Finally limpa fixture e preserva erro principal | TRUE original preservado, jogo customizado excluído, erro PRIMARY propagado. |

**Independência e qualidade**

Os testes de UI não usam o harness legado nem capturam setters internos.
As Promises controlam somente a disponibilidade das respostas; não calculam
o resultado de navegação, de reset local, de mesclagem ou de invalidação.
Os testes F executam callbacks existentes, extraídos por AST, em vez de reescrever
o algoritmo de restauração no teste.

Cada RED chegou à asserção apontada acima; os 19 GREEN são controles que verificam
comportamentos legítimos e proteções já funcionais. Não foram aplicadas correções,
nem feitas novas mutações de produção nesta entrega. Resultados de mutações da
auditoria anterior não são apresentados como execução desta suíte.

**Orientação ao Kaled**

Priorize A01–A14, B01, D01, E01 e F01/F03/F05/F06. Incorpore os pares de controle
GREEN junto com cada correção. Os testes C de instância retida devem acompanhar
o contrato escolhido para identidade/remontagem; mantenha C10/C11 em qualquer
caso. A meta é todos os comportamentos esperados passarem, sem alterar expectativas
para aceitar o defeito e sem mascarar RED com skip ou falha esperada.

**Correção do registro da auditoria anterior**

Ao iniciar esta tarefa, foi identificado que um comando de transpilação da
auditoria anterior havia sobrescrito `backend/test/integration/test-db-guard.ts`
no checkout original. Isso contradizia a afirmação anterior de checkout intacto.
A alteração era do próprio assistente e foi restaurada exatamente ao conteúdo
do commit antes de desenvolver esta suíte. Não foi uma correção funcional.
O estado final do checkout original e a integridade dos fontes da cópia são
registrados em `delivery/source-integrity.json`.
