# ADMIN-01 — Home Admin e Gerenciar Eventos

Implementação funcional concluída, com revisão visual aprovada pelo responsável e evidência final registrada na seção final. Base develop ea0b614f5926123ec9e5d659e9f540588bed9a37, inicialmente limpa e igual à referência local origin/develop. ADMIN-00 incorporada. Após interrupção, branch feature/admin-core-management confirmada nesse HEAD, limpa. Sem consulta remota.

Escopo: Home, três abas Admin, listagem real com busca/filtro/paginação e detalhe contextual mínimo. Referências: ADMIN-00, Panorama §3.4 e Arquitetura §§18/27. Planejamento e PNGs não disponíveis no repositório; reutilizar tema Admin sem alegar comparação visual.

Plano: extensão compatível de GET /admin/events com search e excludeClosed; serviço de leitura autenticado; controle de resultados obsoletos/conta; destinos reais ou informativos sem mutações demonstrativas. Preservar fontes da demo para migrações posteriores.

Validação frontend final: 63/63 aprovados, exit 0. O responsável informou 144 testes backend aprovados em terminal Windows; dois typechecks backend foram aprovados anteriormente. Histórico e limitações constam nas seções posteriores.

## Alterações efetivas e decisões

- Navegador mantém nome de entrada `AdminDemoNavigator` usado por `App.js`, mas registra somente `AdminTabs`, `AdminEvents` e `AdminRealEvent`. Abas Home/Histórico/BI; Histórico e BI têm estados informativos. Provider e fontes demonstrativas permanecem em disco, sem rota registrada nessa área real. Isso preserva suas transições e testes para futuras migrações e impede mutações locais com UUIDs reais.
- `AdminHomeScreen` substitui a Home registrada, sem alterar a antiga `AdminPanelScreen` demonstrativa. Central com destaque Gerenciar, atalhos futuros desabilitados, Histórico/Visão Geral com destino informativo e logout pelo gerenciador existente. Mesmo princípio para `AdminRealEventsScreen`: antiga tela demonstrativa não foi apagada.
- Novos componentes Admin reutilizam tema, cards, campos, opções, botões e notices existentes. Layout escuro/roxo, títulos e nomes quebram linha; sem dependências novas ou alterações no design system compartilhado. PNGs indisponíveis: não houve comparação visual com mockups nem homologação em aparelho.
- `GET /api/v1/admin/events` recebe `search` opcional (até 180 caracteres antes de normalizar espaços; rejeita controles residuais e Unicode inválido) e `excludeClosed=true|false` opcional. Sem parâmetros novos, comportamento anterior mantido. Busca literal case-insensitive por nome/código usa `strpos(lower(...),lower(parâmetro))`; `%`, `_`, barra e aspas não viram padrões ou SQL. Nome pesquisado também normaliza espaços PostgreSQL. Critérios antes de LIMIT, filtro pela fase projetada, keyset `(created_at,id)` descendente e contrato `{items,nextCursor}` mantidos. Não há alteração de fases, prontidão, autorização ou mutações.
- Lista envia `excludeClosed=true` sempre; Todos inclui `not_ready`, rotulado Não pronto. Agendados/Abertos/Encerrando enviam exatamente scheduled/open/closing. Busca ocorre no servidor antes da paginação, não apenas nos cards carregados.
- Serviço novo usa `auth.httpClient` com `auth:true`, sem tokens/cache próprios. Loader invalida gerações na troca de consulta, bloqueia páginas simultâneas, ignora respostas obsoletas e limpa estado no descarte. Erro em próxima página preserva os itens para retry; 401/403 remove itens anteriores. Troca de conta/sessão/revisão remonta a stack; comparações vivas também protegem callbacks. Transporte compartilhado tem timeout; não foi alterado para aceitar abort externo, portanto requisições antigas podem terminar, mas não publicar dados.
- `AdminRealEventScreen` consulta detalhe oficial por UUID, rejeita ID divergente e apresenta apenas nome, fase, horários e prontidão com aviso ADMIN-02. Erro/404 tem recuperação. Nenhuma opção demonstrativa é acessível; voltar preserva instância da lista.

## Arquivos envolvidos

Frontend: `app/screens/admin/AdminDemoNavigator.js`; novos `AdminHomeScreen.js`, `AdminPendingScreen.js`, `AdminRealEventsScreen.js`, `AdminRealEventScreen.js`, `useAdminEvents.js`, `components/AdminLiveScreen.js`, `components/AdminEventSummary.js`; novo `app/services/adminEventsService.js`.

Backend: `backend/src/events/admin-configuration.dto.ts` e `admin-configuration-query.service.ts`.

Testes: novo `app/tests/adminRealEvents.test.cjs`; atualizados `app/tests/adminNavigation.test.cjs`, `roleRoutingIntegration.test.cjs`, `backend/test/unit/admin-configuration.test.ts` e `admin-configuration-http.test.ts`. Casos de mocks permanecem nas suítes da demo; navegação real passa a verificar destinos seguros, isolamento, refresh, logout, troca de papéis e revogação. Testes novos cobrem serviço, paginação, sobreposição, erros/retry, descarte de conta, datas, seleção, Home e detalhe. Backend usa transporte/Drizzle simulados; asserts de SQL não substituem execução PostgreSQL.

Não foram modificados `app/App.js`, `MainTabs.js`, autenticação, cliente HTTP, Staff, Participante, schema, migrations ou dependências. A alteração no harness de integração compartilhado limita-se aos cenários Admin e suporte de TabRouter.

## Validações e limitações

**Inspeções estáticas executadas:** branch/HEAD/status, leitura de contratos e testes, revisão do diff e `git diff --check`. O primeiro diff-check detectou linha vazia extra ao final do service backend; corrigida. A conferência posterior retornou sem erros. Aviso Git de conversão LF→CRLF é configuração existente.

**Automatizadas não executadas:** testes, lint, typecheck e build. A política do `AGENTS.md` determina: “O responsável selecionará manualmente Luna Medium para a etapa de execução”. A seleção não foi confirmada nesta sessão; a instrução genérica de executar testes não comprova essa seleção. Nenhuma contagem de testes aprovados/falhos/ignorados está disponível. Nenhuma validação manual do responsável foi informada nesta task. Não atribuir sucesso de campanhas anteriores a este código.

### Campanha preparada para Luna Medium

Antes de executar, confirmar branch/diretório, inspecionar comandos e scripts de novo, preservar o working tree e manter ambiente isolado sem URLs de banco ou segredos. Não executar integration, db:*, start ou scripts remotos. Comandos direcionados, após confirmação do executor:

```powershell
$env:NODE_ENV = 'test'
# Diretório app: transporte e armazenamento simulados
node --test tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
# Diretório backend: consultas Drizzle simuladas e HTTP local com dependências substituídas
.\node_modules\.bin\tsx.cmd --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts
.\node_modules\.bin\tsc.cmd --noEmit --project tsconfig.json
.\node_modules\.bin\tsc.cmd --project tsconfig.test.json
```

Registrar comandos, códigos de saída, contagens e diagnósticos aqui. Integração React Navigation pode ser ignorada pelo teste caso dependências opcionais de `qa/regression` não estejam instaladas; não instalar automaticamente. Não executar PostgreSQL para tentar completar esta campanha. Após esses checks, regressão mais ampla apenas se houver risco concreto ainda não coberto.

## Evidência e entrega

Patch único: `qa-evidence/ADMIN_01-changes.diff`, incluindo arquivos novos e alterações rastreadas, sem incluir o próprio patch. Sem staging, commit, push, merge, rebase ou reset. Branch `feature/admin-core-management`, base ea0b614. A tentativa inicial de criar branch em sandbox falhou por permissão; após interrupção, a branch correta já estava ativa e foi conferida antes de alterar código.

Verificações Git finais: `git diff --check` e `git apply --reverse --check -- qa-evidence/ADMIN_01-changes.diff`, ambos com código de saída 0. A segunda apenas verifica compatibilidade do patch com o working tree atual, sem aplicá-lo. Working tree contém somente os sete arquivos rastreados alterados, nove arquivos novos de frontend/testes, este relatório e o patch; nenhum arquivo foi staged.

ADMIN-01 está implementada para revisão estática, mas o critério de testes executados permanece pendente da campanha Luna Medium. ADMIN-02/03 não foram iniciadas. ADMIN-02 deve integrar o Painel Individual a partir de `AdminRealEventScreen`, mantendo UUID oficial, reconsulta, sessão e bloqueio de acesso às transições demonstrativas. Busca/paginação têm ordenação determinística; alterações de fases/dados durante páginas distintas continuam sujeitas ao estado vivo do servidor (não há snapshot persistido entre requisições).

## Correções posteriores à campanha informada

- A busca usava `String.isWellFormed()`, ausente nas bibliotecas TypeScript configuradas. Agora percorre pontos de código e rejeita surrogates isolados, preservando pares válidos, normalização, limite e rejeição de controles. Foram acrescentados casos de surrogates isolados e emoji válido em `admin-configuration.test.ts`.
- O harness compartilhado `questionnaireHarness.cjs` delegava `expo-secure-store` ao carregador real. Foi acrescentado armazenamento simulado em memória, isolado por harness, com leitura, gravação e exclusão assíncronas. O relatório disponível não contém os rastros nem identifica os quatro testes da campanha informada; a relação com as quatro falhas e sua resolução permanecem a confirmar na próxima execução.
- O erro relatado `uv_os_get_passwd returned ENOMEM` ocorreu, segundo a solicitação, antes da execução normal de testes via tsx. Isso sugere falha ambiental na inicialização, mas a causa específica não está comprovada sem o comando e o rastreio completos. Não se classifica a suíte como aprovada ou reprovada. Na próxima campanha, investigar recursos e identidade do processo e tentar novamente o comando focado já documentado em terminal local autorizado; não foram instaladas dependências nem alterado código para contornar o erro.
- Nesta etapa: inspeção estática; nenhuma campanha automatizada executada. Pendente Luna Medium: typechecks, testes frontend e backend focados, registrar contagens e códigos de saída, confirmar os quatro rastros e investigar ENOMEM caso persista. Patch único permanece aguardando atualização após revisão final.

## Segunda campanha de validação — Luna Medium

Ambiente conferido antes da execução: branch `feature/admin-core-management`, HEAD `ea0b614f5926123ec9e5d659e9f540588bed9a37`; working tree já continha as alterações pendentes da ADMIN-01, sem outras mudanças identificadas. Node `v24.15.0`. Nenhum banco ou serviço externo foi consultado. Não houve alteração de código ou testes nesta campanha.

### Typechecks backend

- Em `backend`: `.\node_modules\.bin\tsc.cmd --noEmit --project tsconfig.json` — exit 0.
- Em `backend`: `.\node_modules\.bin\tsc.cmd --project tsconfig.test.json` — exit 0.
- `String.isWellFormed()` não é mais usado no DTO. A validação manual de surrogates é compatível com libs TypeScript atuais. **A compilação estática passou**, embora os novos testes de runtime Unicode estejam bloqueados pela inicialização do runner backend abaixo; casos executáveis desta campanha não foram contados.

### Testes frontend

Comando em `app`, `NODE_ENV=test`: `node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs` — exit 1, 63 testes, 60 aprovados, 3 reprovados, 0 ignorados.

| Teste reprovado | Arquivo/linha | Resultado observado e causa |
| --- | --- | --- |
| `lista monta HTTP real, estado vazio, not_ready e seleção por UUID` | `app/tests/adminRealEvents.test.cjs:92` (falha em 97) | Assert esperava “Nenhum evento encontrado”; a tela ainda não havia chegado ao estado vazio quando o harness verificou. Falha de sincronização/espera do teste é hipótese; confirmado apenas que a assertion não encontrou o texto. |
| `lista exibe falha de rede e recupera pelo botão de retry` | `app/tests/adminRealEvents.test.cjs:108` (falha em 114) | Assert esperava “Não foi possível carregar”; a assertion ocorreu antes do estado de erro observável. Hipótese de sincronização do harness; causa não comprovada. |
| `detalhe real consulta somente UUID selecionado e trata recurso inacessível` | `app/tests/adminRealEvents.test.cjs:118` (falha em 126) | Assert não encontrou “Arena Norte” após uma única microtask. Hipótese de que o flush não aguardou `getAdminEvent`/efeito do harness; a stack aponta assertion, não import de `expo-secure-store`. |

Os três testes chamam `createHarness()` de `tests/helpers/questionnaireHarness.cjs`; esse harness carrega `AuthContext` e serviços de autenticação. Inspeção confirma que o mock de `expo-secure-store` foi adicionado em `questionnaireHarness.cjs` após a campanha anterior. Nesta execução os erros anteriores `ERR_MODULE_NOT_FOUND` não se repetiram; os três rastros novos são falhas de assertion descritas acima. O relatório anterior citava quatro falhas de import, mas não preservava os nomes/rastros, então não é possível mapear individualmente as quatro para as atuais.

Os 60 testes restantes passaram, incluindo contratos do loader (busca, cursor, concorrência, sessão/descartar, 401/403, data), navegação protegida, testes de autenticação e casos de integração de roteamento disponibilizados pelo harness. Saída também contém avisos preexistentes do `react-test-renderer` e componentes mockados chamados `default`; não causaram as três falhas.

### Testes backend e alternativa ao ENOMEM

1. Comando previsto, em `backend`, `NODE_ENV=test`: `.\node_modules\.bin\tsx.cmd --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts` — exit 1 antes dos testes. Node `v24.15.0`; `tsx` falhou em `node:os` com `SystemError [ERR_SYSTEM_ERROR]`, `uv_os_get_passwd returned ENOMEM (not enough memory)`, `syscall: getpwuid`/`Object.userInfo`, dentro de `temporary-directory-*.mjs`. Nenhum teste chegou a executar.
2. Alternativa local, sem mudar dependências/configuração: `NODE_OPTIONS='--import tsx' node --test test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts` — exit 1. Ambos arquivos falharam durante carregamento do preloader em `tsx/dist/client-*.cjs`, novamente em `node:os` → `Object.userInfo` → `uv_os_get_passwd returned ENOMEM`. Contagem do processo: dois arquivos falhos ao carregar, zero testes executados/aprovados/reprovados/ignorados. A alternativa confirma que o bloqueio ocorre ao carregar tsx, antes da suíte.

Não foi tentada compilação temporária nem alterado ambiente global/dependências; seria necessário contornar a consulta ao usuário do sistema por fora do runner e não há alternativa instalada que preserve execução direta dos testes TypeScript sem iniciar `tsx`. A causa específica do ENOMEM permanece ambiental e sem diagnóstico. Não classificar testes backend como aprovados ou como falhas de assertion.

### Regressão e conclusão da campanha

O conjunto frontend já incluiu `adminNavigation`, `authNavigation` e `roleRoutingIntegration`, cobrindo login/TOTP, identidade, isolamento da pilha, refresh, logout, revogação e papéis; 60 cenários passaram no processo. Como há 3 falhas de renderização ainda sem diagnóstico fechado, não foi ampliada a regressão além do escopo focado. Contratos backend não foram exercitados em runtime devido ao ENOMEM.

Typechecks: 2/2 aprovados. Frontend: 60 aprovados, 3 reprovados, 0 ignorados. Backend: 0 testes iniciados; dois arquivos de teste não carregaram por falha do `tsx`. As falhas frontend pertencem a testes recém-adicionados da ADMIN-01, mas se são apenas sincronização do harness ou comportamento da tela ainda precisa ser confirmado numa rodada Terra Medium. Correções recomendadas: aguardar explicitamente o estado/efeito assíncrono nos três testes usando suporte determinístico do harness, sem relaxar assertions; investigar ENOMEM no ambiente local do responsável com `tsx`/`node:os`. Nenhuma correção de produção feita nesta validação.

Estado Git ao fim: branch permanece `feature/admin-core-management`; alterações ADMIN-01 e documentação pendentes preservadas. Esta campanha modificou somente este relatório. Sem staging, commit, push, merge, acesso a banco ou regeneração do patch. ADMIN-01 não está aprovada e aguarda revisão formal.

## Investigação e correção — Terra Medium

Inspeção de `questionnaireHarness.cjs`: `actAsync` aguarda o callback e chama `flush()` uma vez; `flush()` só processa atualizações já enfileiradas e `h.nodes` reflete a última renderização. A lista percorre `client.get` → `listAdminEvents` → `load` → subscriber → setter; o detalhe percorre `client.get` → `getAdminEvent` → `.then` → setter. Uma única microtask seguida de flush não garante que essas cadeias tenham enfileirado suas atualizações. Assim, para as três falhas (lista vazia, erro/retry e detalhe), a hipótese é sincronização insuficiente no teste; a inspeção não prova que a renderização em produção esteja correta nem descarta outro defeito. As assertions de conteúdo e navegação foram preservadas.

Em `app/tests/adminRealEvents.test.cjs`, `waitForText` aguarda condição observável por até 20 ciclos de `setImmediate`, chamando `actAsync` para aplicar atualizações a cada ciclo. Limite finito, sem atraso em tempo fixo. Também aguarda o resultado após retry e após troca de conta. Não foi alterado código de produção nem o harness compartilhado. Testes não foram executados por Terra nesta etapa, conforme política; Luna Medium deverá confirmar cada cenário e investigar qualquer falha remanescente.

Diagnóstico local, Node v24.15.0: `node -e` chamou `require('node:os').userInfo()` sem imprimir retorno ou identidade; falhou com `ERR_SYSTEM_ERROR`, syscall `uv_os_get_passwd`. Logo, a falha não é exclusiva da inicialização do tsx. Sua relação causal com restrições do ambiente não foi comprovada. As campanhas anteriores já tentaram duas formas de inicializar tsx e falharam antes de testes; não foram repetidas. TypeScript instalado pode compilar para diretório temporário, mas tal alternativa exige preparar resolução de módulos e saída isolada; não foi executada nem comprovada nesta investigação. Recomenda-se execução posterior em terminal local apropriado, com o mesmo comando de diagnóstico sem divulgar retorno e com o executor Luna autorizado.

Verificações realizadas: inspeção estática das telas, hook, testes e harness; diagnóstico isolado de `os.userInfo()`; `git diff --check`. Não houve testes, typecheck, banco, operações Git de escrita ou regeneração do patch. Pendência: Luna Medium deve executar testes focados frontend e, quando o ambiente permitir, backend e casos Unicode, registrando contagens e códigos de saída. ADMIN-01 permanece aguardando aprovação formal.

## Terceira campanha de validação — Luna Medium

Preparação: lidos `AGENTS.md` e este relatório. Branch confirmada como `feature/admin-core-management`; working tree já continha as alterações pendentes ADMIN-01. Nenhuma alteração em código foi feita nesta campanha. Node `v24.15.0`; os testes frontend usam harnesses/mocks locais. Nenhum banco ou serviço remoto foi acessado.

### Frontend focado

Em `app`, comando executado:

```powershell
$env:NODE_ENV = "test"; node --test --test-reporter=spec tests/adminRealEvents.test.cjs
```

Exit 0. 11 testes aprovados, 0 reprovados, 0 ignorados. Os três casos da campanha anterior passaram: lista real com estado vazio/`not_ready`/UUID, falha de rede com retry, e detalhe por UUID com recurso inacessível. Assim, a espera determinística por condição observável no teste resolveu a sincronização reproduzida, sem alteração das assertions nem do código de produção.

### Campanha frontend completa

Em `app`, comando executado:

```powershell
$env:NODE_ENV = "test"; node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Exit 0. 63 testes aprovados, 0 reprovados, 0 ignorados. Não foram identificadas regressões nesta campanha nos testes cobertos de listagem/busca/paginação, navegação Admin, autenticação/sessão e roteamento de papéis. O processo emitiu avisos de depreciação de `react-test-renderer` e avisos dos componentes `default` mockados; nenhum causou falha.

### Backend e limites

Testes backend: **não executados por impedimento ambiental**. Não há nesta execução um terminal local diferente previamente autorizado em que `os.userInfo()` funcione. O diagnóstico anterior já comprovou `ERR_SYSTEM_ERROR`/`uv_os_get_passwd` em chamada isolada, além das falhas anteriores do carregamento de `tsx`; conforme instruído, não foram repetidas tentativas com `tsx`. Os typechecks de produção e de testes permanecem aprovados na campanha anterior (exit 0 cada). Testes runtime do backend, incluindo casos Unicode de surrogates isolados e pares válidos, seguem pendentes em terminal apropriado; não são classificados como falha funcional.

### Estado da validação

Comandos e resultados desta campanha estão registrados acima. `git diff --check` executado após atualizar este relatório — resultado registrado no resumo final desta execução. Nenhum teste foi ignorado; nenhuma validação backend foi iniciada. A cobertura segue limitada a suites frontend direcionadas e aos typechecks previamente executados; não houve integração PostgreSQL, validação física ou comparação visual com mockups. ADMIN-01 permanece aguardando aprovação formal do responsável.

## Refinamento visual pós-homologação manual

### Referências e histórico

Comparadas as duas referências anexadas (`Admin - Home.png` e `Admin - gerenciar eventos.png`) com as duas capturas reais fornecidas nesta solicitação. As capturas confirmaram cabeçalho reduzido a ARENAGO · ADMIN, atalhos empilhados, filtros quebrados e cards sem a hierarquia das referências. O pedido menciona referências com sufixo `(2)`; foram utilizadas as imagens efetivamente anexadas e visíveis nesta conversa.

Preservado o histórico das campanhas: 63 testes frontend aprovados pelo Codex antes deste refinamento e dois typechecks backend aprovados. O responsável informou nesta solicitação **144 testes backend aprovados em terminal local**; esse resultado é registrado como validação externa informada pelo responsável, sem novo comando, rastros ou execução pelo Codex nesta etapa. As limitações ambientais registradas nas campanhas anteriores continuam documentadas como histórico, sem invalidar a execução local informada.

### Componentes e alterações

- `AdminLiveScreen.js`: marca ArenaGO branca/roxa, logout contornado com ícone e rótulo Sair da conta, identificação administrativa, título/subtítulo, voltar compacto e curvas decorativas discretas. A verificação de identidade e montagem do callback de logout foi preservada. Safe areas superiores/laterais, rolagem e KeyboardAvoidingView mantidos; busca permite dispensar teclado por arraste.
- `AdminHomeScreen.js`: card principal com área de navegação acessível, calendário em bloco roxo e dois atalhos internos lado a lado. Removido o CTA duplicado Gerenciar eventos. Histórico e Visão geral em cards de largura equivalente com adaptação para uma coluna quando não couberem. Usuários e permissões passou a card informativo sobre administradores globais, sem concessão Staff ou operação ativa. Acesso restrito ganhou card com ícone e texto completo.
- `AdminRealEventsScreen.js`: introdução e voltar contextual, atalhos em duas colunas, pesquisa com lupa/placeholder, chips arredondados em faixa horizontal rolável e cards inteiros tocáveis. Removido o aviso grande de fim da listagem; Carregar mais, vazio, erros/retry e estados de carregamento permanecem condicionados ao loader existente. Não há contagem total inventada a partir de páginas parciais.
- `AdminEventSummary.js`: variante compacta para a lista, calendário, nome, selo de fase colorido, datas em pt-BR, divisor, prontidão e seta. Datas de início e término continuam completas, respeitando o fuso e eventos que atravessam dias. Fase e prontidão permanecem independentes e derivadas dos campos oficiais. A variante padrão do detalhe foi preservada.
- Novos `AdminLiveUI.js` e `AdminBottomBar.js`: tokens visuais locais, ícones de linhas desenhados com Views nativas, atalhos pendentes e barra Home/Histórico/BI com ícones próprios e destaque ativo. Nenhuma dependência adicionada; reutilizadas cores do tema Admin sem mudar o tema dos fluxos demonstrativos.
- `AdminDemoNavigator.js`: barra compartilhada nas três abas com eventos tabPress/tabLongPress; rotas e chave de identidade preservadas. A lista, que está fora das abas na stack existente, mostra a mesma barra e usa `popTo('AdminTabs', { screen })` para retornar à instância das abas. API confirmada por inspeção da versão instalada de StackRouter, sem executar a biblioteca.

### Responsividade e funcionalidades futuras

Conteúdo com largura fluida limitada em telas grandes, sem alturas fixas nos cards/textos; cabeçalho pode quebrar linha e títulos extensos não são truncados. Cards de Histórico/BI usam flex wrap e largura mínima; atalhos mantêm duas colunas com texto quebrável. Filtros preservam tamanho legível por rolagem horizontal. Selos podem cair para a linha seguinte. Alvos interativos têm pelo menos 44 pontos de altura; barra inferior trata safe area inferior. Ornamentos possuem dimensões fixas apenas em camada decorativa recortada, sem influenciar a largura do conteúdo.

Criar evento e Catálogo de experiências permanecem desabilitados, com estado acessível e legenda curta Em breve. Usuários e permissões é informativo, sem handler. Histórico e BI continuam levando aos destinos informativos existentes. Nenhuma operação demonstrativa foi ativada.

### Testes preparados e verificações efetivas

Atualizados somente os testes afetados pelos rótulos/composição: `app/tests/adminRealEvents.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs`. Preservadas as assertions HTTP, UUID, retry, TOTP, sessão e revogação. A antiga assertion de botão de usuários desabilitado foi adaptada para exigir card informativo sem onPress e ausência de botão acionável. O harness de integração de abas passa a renderizar a barra customizada; o cenário existente foi estendido com o retorno da lista à aba Histórico, BI e Home.

Inspeções realizadas: leitura de instruções, relatório, telas, tema, harnesses, testes e StackRouter instalado; comparação das quatro imagens fornecidas; revisão estática dos fluxos e alterações. Comando estático em `app`: script via here-string PowerShell `@' ... '@ | node -`, usando `@babel/parser.parse` com plugin JSX, leitura dos nove arquivos de interface/testes alterados e resolução dos imports relativos com `fs.existsSync`/`statSync`. Exit 0: **9 arquivos analisados, 24 imports locais resolvidos**, sem carregar módulos da aplicação ou executar testes. `git diff --check`: exit 0; aviso preexistente de conversão LF/CRLF no navegador. Não houve testes, lint, typecheck, build, banco ou serviços externos nesta implementação.

Repetir com Luna Medium, após inspecionar comandos e preservar ambiente isolado, em `app`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

A aprovação prévia dos 63 testes não valida automaticamente esta revisão. Validar também a barra customizada, rótulos e o percurso entre lista e abas. Backend, serviços HTTP, autenticação, Staff, Participante, hooks de dados e migrations não foram alterados nesta etapa.

### Limitações e estado final

Não houve execução do aplicativo, captura nova ou homologação física nesta etapa. Gradientes, textura e proporções exatas das imagens não foram reproduzidos pixel a pixel; foram priorizados organização, hierarquia, cores e legibilidade com componentes nativos. Safe areas, fonte ampliada, teclado e espaçamentos devem ser revisados em iOS/Android com capturas reais, incluindo aparelhos estreitos, nomes longos e listagem paginada.

Branch `feature/admin-core-management`; alterações anteriores preservadas. Esta rodada modifica os sete arquivos visuais acima, os dois testes e este relatório. Sem staging, commit, push, merge, reset/rebase ou atualização de `qa-evidence/ADMIN_01-changes.diff`. ADMIN-02 não iniciada. Refinamento pronto para revisão do código e campanha Luna, com aprovação visual e formal pendentes do responsável.

## Validação do refinamento visual — Luna Medium

Em `app`, com `NODE_ENV=test`, foi executado o comando solicitado:

```powershell
$env:NODE_ENV = 'test'; node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Exit code 0. Resultado do Node: 63 aprovados, 0 falhos, 0 ignorados (0 cancelados/todo). Passaram os cenários da Home e seus cards, abas Home/Histórico/BI, retorno da lista às abas, logout, TOTP, sessão e proteção, busca/filtros/paginação, seleção por UUID, erro/retry e isolamento dos destinos demonstrativos. O teste da integração percorreu Histórico, BI e Home via barra customizada. Avisos existentes de `react-test-renderer` e componentes `default` nos mocks foram emitidos, sem reprovações.

Verificações estáticas desta campanha: `git diff --check` — exit 0 (aviso Git LF→CRLF preexistente no navegador); branch `feature/admin-core-management` confirmada. Não foram executados backend, lint, typecheck, build, banco ou serviços externos. Limitação: os testes usam harness/mock e não substituem execução em aparelho; revisão visual física continua pendente.

Histórico preservado: typechecks backend 2/2 e 144 testes backend aprovados em terminal Windows local conforme informado pelo responsável na campanha anterior; não repetidos nesta campanha frontend. Nenhuma falha ou regressão identificada na suite executada. Nenhum código de produção foi alterado nesta validação; documentação registra os resultados. Sem staging, commit, push, merge ou regeneração de `qa-evidence/ADMIN_01-changes.diff`. ADMIN-01 aguarda conferência visual em aparelho e aprovação formal.

## Polimento visual final

O cabeçalho compartilhado `AdminLiveScreen.js` passou a usar o asset existente `app/assets/images/logo-arenago.png`, que corresponde ao render fornecido, com `resizeMode="contain"`, transparência preservada e caixa de 150 × 48 pontos. A imagem tem rótulo acessível ArenaGO. A ação de retorno compartilhada recebeu seta roxa um pouco maior, texto mais claro e com maior peso, altura mínima de toque de 48 pontos, espaçamento lateral e feedback ao pressionar. Os destinos e o logout não foram alterados; a mudança vale para a listagem e o detalhe ADMIN-01 que usam esse componente.

Arquivos alterados nesta etapa: `app/screens/admin/components/AdminLiveScreen.js`, `app/tests/roleRoutingIntegration.test.cjs` (mock de `Image` e do asset para a próxima execução) e este relatório. O PNG existente foi reutilizado sem alteração.

Verificações estáticas: em `app`, script Node com `@babel/parser` analisou os dois arquivos JS/CJS alterados e confirmou a existência do PNG, exit 0; `git diff --check`, exit 0, com aviso preexistente LF/CRLF. Não foram executados testes, lint, typecheck, build ou banco nesta etapa. Os 63 testes frontend e 144 testes backend documentados anteriormente antecedem este polimento; recomenda-se revalidar com Luna Medium após esta alteração de asset e mock. Tamanho percebido, contraste e transparência ainda precisam de conferência no aparelho. ADMIN-01 continua aguardando revisão final e aprovação do responsável; patch de evidência não regenerado.

## Fechamento da ADMIN-01

A implementação funcional está concluída, com Home Admin, listagem real, busca, filtros, paginação e navegação por UUID. O refinamento visual incluiu o logo oficial existente e maior destaque ao Voltar. O responsável informou aprovação visual em aparelho. A última campanha frontend, executada pelo Codex com Luna Medium, terminou com 63 aprovados, 0 falhos, 0 ignorados e exit 0. O responsável informou 144 testes backend aprovados anteriormente em terminal Windows; os dois typechecks backend também passaram anteriormente. Essas execuções não foram repetidas nesta etapa.

A validação não constitui homologação de produção nem comprova comportamento com PostgreSQL real. Criar evento, catálogo, histórico, BI e gestão de permissões permanecem reservados às tasks posteriores; ADMIN-02 não foi iniciada.

Arquivos rastreados modificados: `app/screens/admin/AdminDemoNavigator.js`, `app/tests/adminNavigation.test.cjs`, `app/tests/helpers/questionnaireHarness.cjs`, `app/tests/roleRoutingIntegration.test.cjs`, `backend/src/events/admin-configuration-query.service.ts`, `backend/src/events/admin-configuration.dto.ts`, `backend/test/unit/admin-configuration-http.test.ts` e `backend/test/unit/admin-configuration.test.ts`. Arquivos novos: `app/screens/admin/AdminHomeScreen.js`, `AdminPendingScreen.js`, `AdminRealEventScreen.js`, `AdminRealEventsScreen.js`, `components/AdminBottomBar.js`, `components/AdminEventSummary.js`, `components/AdminLiveScreen.js`, `components/AdminLiveUI.js`, `useAdminEvents.js` (todos sob `app/screens/admin`), `app/services/adminEventsService.js`, `app/tests/adminRealEvents.test.cjs` e este relatório.

Evidência pendente: `app/assets/images/logo-arenago.png` já existe no commit-base `ea0b614f5926123ec9e5d659e9f540588bed9a37` e não possui alteração no working tree. Um patch fiel a essa base não contém diferença binária para esse arquivo; um patch que o adicionasse como novo não se aplicaria à base. A exigência de incluir o binário no patch conflita com a exigência de representar fielmente as diferenças e aplicar na base. Não foi substituído o patch anterior por um arquivo incompleto. A referência ao logo consta no código e o arquivo já está disponível na base.

Branch `feature/admin-core-management`, HEAD `ea0b614f5926123ec9e5d659e9f540588bed9a37`; alterações pendentes preservadas e nenhum arquivo staged. Sem commit, push, merge, reset ou rebase. Aprovação formal permanece com o responsável.

## Evidência definitiva

O changes `qa-evidence/ADMIN_01-changes.diff` representa os 20 arquivos listados no fechamento: oito rastreados modificados e doze novos, incluindo este relatório. O logo `app/assets/images/logo-arenago.png` é rastreado e idêntico ao commit-base, portanto não integra as diferenças; o componente referencia esse asset existente. O responsável esclareceu que não é necessário incluí-lo artificialmente no patch.

O patch foi gerado com `git diff --binary` em relação à base, incluindo os arquivos que passaram a constar no índice durante a execução, e excluindo a própria evidência. O índice estava vazio na conferência inicial e passou a conter arquivos staged durante o fechamento; esta execução não efetuou staging nem alterou esse estado. A validação empregou inventário, `git apply --reverse --check` e `git diff --check`. A ADMIN-01 está pronta para revisão e commit do responsável; resultados anteriores de 63 testes frontend, 144 backend informados pelo responsável, dois typechecks e aprovação visual permanecem registrados acima.
