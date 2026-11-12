# Task A3 — background compartilhado nas telas reais Staff

## Objetivo e implementação

A A3 aplica às telas reais Staff o recurso visual compartilhado já utilizado pelo aplicativo. O asset é `app/assets/images/auth/shared-background.png`, carregado pelo componente reutilizável `AuthBackground` em `app/components/ui/AuthBackground.js` e exportado por `app/components/ui/index.js`.

A primeira implementação envolveu `Stack.Navigator` em `AuthBackground`. Na homologação visual do responsável no Expo Go, a tela “Eventos Staff” apareceu branca/clara sob textos brancos. A versão instalada de `@react-navigation/native-stack` (7.19.2) cria uma superfície de tela com cor do tema; essa superfície pode cobrir um fundo colocado fora do Stack. A transparência da `SafeAreaView` interna não corrigia essa ordem de camadas.

A correção coloca `AuthBackground` com preset `login` dentro de cada rota real (`StaffEventsScreen` e `StaffEventHomeScreen`), envolvendo sua `ScrollView`. O componente fornece a SafeArea e mantém a imagem atrás do conteúdo. O `contentStyle` do Stack usa `#0c0a17` como base escura atrás das rotas, inclusive durante transições. Cada rota tem sua própria instância visível; Controle de Entrada e Estação são seções da rota de evento e não recebem outra camada de imagem. Os cartões e botões preservam suas cores. Modais, carregamento, erros, rolagem, operações e navegação não foram alterados.

## Arquivos da A3

- `app/screens/staff/StaffEventsNavigator.js`
- `app/tests/staffBackground.test.cjs`
- `docs/STAFF_A3_IMPLEMENTACAO.md`
- `qa-evidence/STAFF_A3-changes.diff`

Na revalidação após a correção do harness, os testes focados passaram: 29 aprovados, 0 falhos e 0 ignorados, exit code 0. A regressão completa do aplicativo também passou: 525 aprovados, 0 falhos e 0 ignorados, exit code 0. As 20 falhas anteriores ocorreram porque o loader não reconhecia a importação nomeada de `components/ui/AuthBackground`, causando `Element type is invalid`. O harness agora fornece um componente React passthrough, seguindo o stub de UI já usado pelo harness de questionário. Os testes continuam carregando as telas e serviços Staff reais; somente a camada visual é simulada.

Na homologação visual manual confirmada pelo responsável no Expo Go, a lista de Eventos Staff, o painel operacional, o Controle de Entrada e as Estações foram aprovados. Transições, legibilidade, SafeArea e botões também foram aprovados.

## Validação

Os resultados automatizados acima foram executados na campanha de validação da A3. Esta atualização documental não repetiu testes, builds ou typechecks. As verificações Git e da evidência foram executadas após a atualização.

Para Luna Medium validar:

```powershell
Set-Location app
$env:NODE_ENV = 'test'
node --test tests/staffBackground.test.cjs tests/staffRealNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Se aprovado, executar também os testes de regressão de navegação Staff definidos pelo responsável e conferir novamente `git diff --check` e a aplicação reversa de `qa-evidence/STAFF_A3-changes.diff`.

## Limites

A primeira homologação visual falhou com fundo branco/claro e textos brancos; a composição foi corrigida e a homologação visual posterior foi aprovada nos quatro contextos e itens acima. Essa homologação não substitui testes físicos de concorrência nem validação em todos os dispositivos e configurações de tela. Não foram alterados fluxos operacionais ou regras funcionais das Tasks A1/A2.
