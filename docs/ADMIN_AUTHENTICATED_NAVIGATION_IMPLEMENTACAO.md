# ADMIN_AUTHENTICATED_NAVIGATION

## Escopo e base

- Data: 13/11/2026.
- Branch: `feature/admin-authenticated-navigation`, criada a partir de `origin/develop` após `git fetch origin develop`.
- Base: `430b99f` (`merge: integrar implementacao Staff a develop`). Working tree limpo antes das alterações.
- O commit de `PROFILE_REAL_STATISTICS` (`40d8760`) não compõe esta base nem este patch.
- Recomendação: Sol High para implementação/revisão de autorização. A seleção efetiva do modelo não foi verificada nem alterada pelo Codex.

## Comportamento implementado

O fluxo de senha Admin continua produzindo um desafio temporário sem autenticar a conta. Após a verificação real em `/auth/2fa/verify`, o gerenciador existente confirma a identidade em `/auth/me`. Somente a sessão confirmada, com papel `admin`, recebe a rota raiz `AdminArea`, que carrega o `AdminDemoNavigator` existente do Heliom.

A restauração usa o contrato existente de refresh e `/auth/me`; não pede TOTP novamente para uma sessão que o servidor já reconhece como verificada. A inspeção de `backend/src/auth/auth.service.ts` confirmou que o backend rejeita autenticação e refresh Admin sem `admin_2fa_verified_at`. Nenhum arquivo do backend foi alterado e nenhuma operação de banco foi executada.

`canAccessAdminArea` exige autenticação, inicialização concluída, `sessionStatus=authenticated`, `identityStatus=verified`, identidade/sessão identificadas, ausência de desafio pendente, papéis conhecidos contendo `admin` e confirmação pelo getter vivo `isIdentityVerified()`. Parâmetros de navegação não concedem papel nem comprovam TOTP.

A precedência permanece `admin > staff > participante`, inclusive para contas com múltiplos papéis e questionário incompleto. A conta Admin não registra `MainTabs`, questionário, fluxos Participante ou Staff. Participante/Staff não registram `AdminArea` nem suas telas internas. `AdminDemo` foi removida da pilha Participante e seu atalho saiu da Home; `AdminPending` deixou de ser registrada. O navegador administrativo também recusa montagem sem a sessão autorizada.

As 14 telas existentes foram mantidas: Painel, Eventos, Criar Evento, Detalhe, Horários, Fila Externa, Encerramento, Experiências, Detalhe da Experiência, Estação, Staff do Evento, Histórico, BI do Evento e Visão Geral. Os retornos internos continuam dentro da pilha administrativa. No Painel, “Sair da conta” descarta o estado demonstrativo e chama `auth.logout()`. O gerenciador real limpa credenciais locais e tenta revogar a sessão no servidor; eventual falha remota mantém o encerramento local e o aviso existente, sem declarar revogação confirmada.

## Autenticação real e operações demonstrativas

| Recurso | Natureza |
| --- | --- |
| Login, desafio TOTP/código de recuperação, `/auth/me`, refresh, logout e tentativa de revogação | Contratos reais existentes, sem alterações criptográficas |
| Verificação de identidade e papel para selecionar a pilha | Estado confirmado pelo gerenciador real |
| Eventos, horários, fila externa e encerramento no painel | Simulados em memória |
| Experiências, estações e concessões Staff editadas pelo painel | Simulados em memória; não alteram permissões reais |
| Histórico, avaliações, BI, indicadores, relógio e falhas simuladas | Dados fictícios locais |

O layout e a navegação Heliom foram reutilizados. Foram corrigidos os avisos que negavam permissão Admin/TOTP; a faixa de demonstração e os avisos de ausência de persistência permanecem.

O estado local pertence à combinação conta + `sessionId` + geração de sessão + revisão de identidade. Logout, nova conta, nova sessão, perda de autorização, passagem por identidade não confirmada e renovação/refresh descartam os mocks. Mesmo quando React agrupa atualizações de refresh, a revisão da identidade muda e remonta o provedor/telas. Uma nova entrada começa com os dados fictícios originais. Não há migração desses dados para outra identidade. Uma consulta de `/auth/me` que confirma a mesma identidade e os mesmos papéis, sem invalidá-los, preserva o estado local.

Callbacks capturados por telas antigas verificam proprietário, getters vivos e montagem antes de executar transições. Ações antigas não alteram os mocks da próxima conta; um callback antigo de saída também não encerra a nova sessão.

## Arquivos

Produto:

- `app/App.js`: destino exclusivo Admin e chave da navegação incluindo sessão confirmada.
- `app/context/adminAccess.js`: condição compartilhada de acesso Admin.
- `app/screens/auth/AuthSessionGate.js`: resolução de `AdminArea` após confirmação.
- `app/screens/admin/AdminDemoNavigator.js`: reutilização das telas e proteção da montagem.
- `app/screens/admin/AdminDemoContext.js`: isolamento, invalidação de callbacks e descarte.
- `app/screens/admin/AdminPanelScreen.js`: aviso correto e logout real.
- `app/screens/admin/components/AdminScreen.js`: aviso acessível compatível com o acesso autenticado.
- `app/screens/home/HomeScreen.js`: remoção do atalho demonstrativo do Participante.

Testes e suporte:

- `app/tests/roleRoutingIntegration.test.cjs`: gerenciador, provedores, React Navigation e telas Admin reais com transporte/armazenamento/nativos simulados; login/TOTP, espera por identidade, restauração, todas as telas/retornos, logout, falha remota, revogação, papéis, contas, refresh e callbacks antigos.
- `app/tests/authNavigation.test.cjs`: pilhas, precedência, navegação manual, rotas antigas e matriz de estados incompletos/inválidos.
- `app/tests/adminNavigation.test.cjs`: rota exclusiva, Home preservada, montagem direta protegida, chave de proprietário real e registro das 14 telas.
- `app/tests/adminScreens.test.cjs`: mensagens, logout, fluxos existentes e isolamento dos mocks/callbacks.
- `app/tests/adminInsightsScreens.test.cjs` e `app/tests/adminStructureScreens.test.cjs`: fixtures Admin confirmadas para troca de conta e isolamento dos mocks.
- `app/tests/helpers/adminAuthFixture.cjs`: identidade Admin confirmada para testes de interface; não valida criptografia.
- `app/tests/helpers/adminHarness.cjs`: getters vivos e simulação de logout/troca de identidade para testes isolados.
- `app/tests/questionnaire.test.cjs` e `app/tests/splashScreen.test.cjs`: resolução da nova dependência de autorização e expectativa segura para Admin sem identidade confirmada.

## Validações e evidências

| Categoria | Execução nesta task |
| --- | --- |
| Inspeção estática | Realizada: fluxo de autenticação, contrato backend de segundo fator, rotas, importações, callbacks, mudanças e scripts de teste |
| `git diff --check` pelo Codex, autorizado no prompt | Executado com código de saída 0, sem problemas de whitespace |
| Testes focados por Luna na campanha anterior | 137 aprovados, 0 falhos, 0 ignorados; saída 0 |
| Regressão frontend anterior à correção | 750 aprovados, 2 falhos, 0 ignorados; saída 1 |
| Testes após a correção, lint, typecheck, build | Não executados nesta correção; aguardam validação independente |
| Validações manuais pelo responsável | Expo Go: login Admin com TOTP, abertura do painel Heliom e navegação pelas telas administrativas testadas, conforme relato do responsável |
| PostgreSQL, migrations, seeds, alterações em `.env`/chaves | Não executados |

As duas falhas anteriores ocorreram em `adminInsightsScreens.test.cjs` e `adminStructureScreens.test.cjs`: os testes trocavam para uma conta B sem papel Admin, sessão e identidade confirmada; o provedor corretamente retornava `session: null`. Os casos agora usam `verifiedAdminAuth` para a conta B, mantêm os testes de isolamento e logout e verificam a renovação e a recusa de identidade incompleta. A regressão após esta correção ainda não foi executada nem declarada aprovada. As operações administrativas continuam simuladas e sem persistência.

### Handoff para Luna Medium

O responsável deve selecionar e confirmar Luna Medium antes da execução. Reinspecionar comandos, diretório, branch e working tree, preservar alterações e usar ambiente isolado sem carregar `.env`. Os arquivos abaixo usam transporte HTTP e armazenamento simulados; não iniciar backend nem conectar PostgreSQL.

Diretório: `C:\DoJob\ProgramacaoMobile\app`.

Campanha focada proposta para revalidação após a correção (não executada após a correção):

```powershell
$env:NODE_ENV = 'test'
node --test tests/authNavigation.test.cjs tests/adminNavigation.test.cjs tests/adminScreens.test.cjs tests/adminInsightsScreens.test.cjs tests/adminStructureScreens.test.cjs tests/roleRoutingIntegration.test.cjs tests/questionnaire.test.cjs tests/splashScreen.test.cjs
```

Regressão de frontend proposta para verificar os fluxos existentes (não executada após a correção):

```powershell
node --test tests/*.test.cjs
```

O script `test` de `app/package.json` também chama diretamente `node --test tests/*.test.cjs`, sem lifecycle adicional declarado. A integração de papéis depende das bibliotecas já previstas em `qa/regression/package.json`; se estiverem ausentes, a suíte marca cenários como ignorados. Registrar esse motivo e não tratar uma campanha com esses cenários ignorados como validação completa. Não instalar dependências nem ampliar comandos sem a autorização aplicável.

Registrar comandos exatos, saída/código de saída, contagens de aprovados/falhos/ignorados e diagnóstico inicial. Em falhas de autorização, concorrência ou inconsistência, interromper correções especulativas e recomendar Sol/Astra High ou Extra High. Não alterar expectativas para obter aprovação.

O responsável informou homologação no Expo Go do login Admin/TOTP, abertura do painel Heliom e navegação pelas telas administrativas testadas. Resta validar, em ambiente autorizado, restauração e logout, bloqueio de Staff/Participante e rotas antigas, troca de contas e descarte dos mocks na renovação.

### Patch reversível

Evidência única: `qa-evidence/ADMIN_AUTHENTICATED_NAVIGATION-changes.diff`, patch Git UTF-8 com código, testes e este relatório; o patch não inclui a si próprio. Não há staging, commit, push, merge, reset ou alteração automática do histórico.

Para revisão/reversão futura pelo responsável, verificar primeiro o estado de trabalho e usar `git apply --check` ou `git apply --reverse --check` antes da operação correspondente. Nenhum patch foi aplicado/revertido pelo Codex nesta task. Aguardar validação independente e revisão do responsável.
