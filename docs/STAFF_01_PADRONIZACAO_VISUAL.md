# STAFF-01 | Padronização visual do Staff

## Objetivo e base Git

Alinhar a Seleção de Eventos e o Painel Operacional ao Admin real. Aplicar o mesmo cabeçalho ao Controle de Entrada e à Estação, dentro da navegação existente. A entrega parte de `feature/staff-operacional-v2`, no merge `18925ba5682621d121e21d5573f8b8ed56b98bfd`, com working tree limpo. A campanha anterior à mudança visual registrou 919 testes aprovados.

## Escopo e critérios de aceite

- Mostrar Sair da conta na Home e Voltar nas telas internas, com a logo oficial à direita e um único controle de retorno por tela.
- Reaproveitar a paleta e o padrão de layout de `AdminLiveScreen` e `AdminLiveUI`, incluindo área segura, contêineres dos ícones e hierarquia de textos. Preservar a leitura semântica de fases, disponibilidade e erros.
- Manter seleção, autorização, polling, estados de erro, métricas e operações do Staff. Conservar as etiquetas acessíveis e o retorno do sistema.
- Manter a referência da nova logo centralizada no Staff. A adoção pelo Admin depende de autorização posterior.

## Diagnóstico e decisões iniciais

A Home e o Painel usam `AuthBackground` e uma composição textual da marca. O logout está no rodapé da Home, e a Estação e o Controle de Entrada exibem seu retorno perto dos controles da operação. O padrão Admin usa fundo próprio com decoração, área segura e cabeçalho fixo acima da rolagem. A adaptação será local ao Staff real.

## Implementação

- `app/screens/staff/components/StaffLiveScreen.js` centraliza fundo, áreas seguras, rolagem e cabeçalho. A Home mostra **Sair da conta**. O Painel mostra **Voltar aos eventos**. Controle de Entrada e Estação mostram **Voltar ao painel**. Os quatro cabeçalhos mostram a mesma imagem à direita com o nome acessível ArenaGO.
- `app/assets/images/logo-arenago-staff.png` é uma cópia byte a byte do PNG oficial fornecido pelo responsável, com 2048 × 682 px, canal alfa RGBA e proporção de 3:1. O componente centraliza a referência e usa `resizeMode="contain"`, largura de 38%, máximo de 150 dp e altura de 48 dp. `logo-arenago.png` segue inalterada no Admin.
- `app/screens/staff/StaffEventsNavigator.js` reaproveita `liveColors`, `liveStyles`, `AdminIcon` e `AdminIconTile` de `AdminLiveUI.js`. Fundo `#090412`, superfície `#151020`, borda `#C476ED`, acento `#B960F5`, texto secundário `#C7B9D9`, fundo dos ícones `#38204F` e ação primária `#7C3AED`. Os estados de abertura, agendamento, encerramento, disponibilidade e falha conservam cores semânticas. Os cards distribuem indicadores e etiquetas em linhas que podem quebrar em telas menores.
- O retorno pelo cabeçalho e a interceptação `beforeRemove` convergem para a mesma transição ao Painel. A volta à lista limpa a seleção. O logout continua condicionado à identidade Staff vigente e uma ação capturada em sessão anterior é descartada. O Painel mantém as métricas e a revalidação na volta. `app/screens/staff/StaffEntryControlRealScreen.js` perde apenas as duas cópias do botão de retorno realocado no cabeçalho. A Estação mantém seus controles operacionais.
- Os testes `staffBackground`, `staffDemoState`, `staffEventDiscovery` e `roleRoutingIntegration` registram o novo contêiner, a classificação do componente real, a imagem acessível e o retorno pelo cabeçalho e pelo navegador. Os cenários de perda de acesso, troca de sessão, polling, filas e métricas continuam cobertos pelos testes existentes.

## Validação e homologação

A primeira campanha após a padronização aprovou nove das dez suítes prioritárias, com 174 testes aprovados, dois falhos, zero ignorados e zero cancelados. A regressão completa ficou suspensa. Os dois casos de `staffRealNavigation` falharam durante a carga de `StaffLiveScreen`, antes das asserções de isolamento e remontagem. O resolvedor substituía `AdminLiveUI` por um componente com apenas o export `default`. A leitura de `liveColors.background` falhava, embora o módulo de produção exporte a paleta. Na segunda campanha, os dois cenários passaram após o harness carregar os módulos visuais reais.

Inspeção estática de sintaxe, escopo e whitespace. A evidência `qa-evidence/STAFF-01-visual-standardization.diff` parte de `18925ba`, inclui o PNG e exclui o próprio arquivo do patch. Os patches históricos permanecem como registro das campanhas anteriores.

### Correção e refinamento após a inspeção no Expo

- Em `app/tests/staffRealNavigation.test.cjs`, o resolvedor carrega os arquivos reais de `AdminLiveUI` e `adminTheme`, como no harness de integração. Ele resolve o caminho exato do PNG Staff, representa a imagem no ambiente simulado e rejeita imports visuais relativos desconhecidos no cabeçalho e em `AdminLiveUI`. Os dois cenários continuam usando o roteador real, incluindo a tentativa de abrir StaffDemo e a remontagem após trocar de conta.
- Em `app/screens/staff/StaffEventsNavigator.js`, os cards de entrada e estação têm uma linha interna com ícone, coluna flexível de informações e chevron à direita. Os badges quebram linha dentro dessa coluna. O espaçamento vertical passou de 16 para 12 dp, com altura mínima de 64 dp e crescimento para texto ampliado. O resumo mostra nome, fase em um único badge, situação operacional, período e local quando disponíveis e os três indicadores com seus rótulos.
- A pendência da logo foi resolvida com o arquivo oficial `C:\Users\JaviDansen\Downloads\Logo ArenaGO render (admin-staff).png`. O arquivo tem 2048 × 682 px, formato RGBA de 32 bits e transparência verdadeira. Foi copiado sem transformação para o asset Staff, preservando a arte, as cores, o gradiente e a transparência. A referência e o `resizeMode="contain"` de `StaffLiveScreen.js` foram mantidos. A logo Admin não foi alterada.
- Esta rodada altera o navegador Staff, o teste de navegação real, este documento e a evidência visual acumulada. A inspeção estática abrange sintaxe JS/JSX/CJS, marcadores de conflito, whitespace e compatibilidade reversa do patch com o working tree.

A segunda campanha foi executada com GPT-6 Luna Medium. As dez suítes prioritárias passaram, com 176 testes aprovados e nenhum falho, ignorado ou cancelado. A regressão completa `npm.cmd test` retornou código 0, com 919 aprovados, zero falhos, ignorados ou cancelados. Os avisos não bloqueantes foram a depreciação de `react-test-renderer` e avisos do React Navigation sobre componentes exportados como `default`. A substituição posterior da logo não alterou código funcional e não exigiu nova campanha automatizada.

```powershell
node --test tests/staffRealNavigation.test.cjs
node --test tests/staffBackground.test.cjs
node --test tests/staffDemoState.test.cjs
node --test tests/staffEventDiscovery.test.cjs
node --test tests/roleRoutingIntegration.test.cjs
node --test tests/staffDashboard.test.cjs
node --test tests/staffEntryControl.test.cjs
node --test tests/staffPolling.test.cjs
node --test tests/staffScreens.test.cjs
node --test tests/staffNavigation.test.cjs
```

### Homologação manual informada pelo responsável

O responsável informou que concluiu a homologação visual e funcional no emulador Android com Expo. Na inspeção visual, comparou a Seleção de Eventos e o Painel ao padrão Admin e considerou satisfatórios a paleta, os cabeçalhos e a logo, a ausência do retângulo preto, os cards, ícones, badges, chevrons, resumo, indicadores, agrupamento das estações e rolagem. Na verificação funcional, confirmou a abertura do Controle de Entrada e de uma Estação pelo Painel, os retornos pelo cabeçalho e pelo botão físico/sistema Android e a preservação da navegação e do Painel.

Esse registro é homologação manual informada pelo responsável. Não representa testes executados pelo Codex. Não houve confirmação de homologação iOS nem de cenários além dos descritos.

## Estado de fechamento

Concluídos: implementação visual Staff, correções técnicas, campanha automatizada, homologação visual e funcional Android e adoção da logo transparente de 2048 × 682 px em RGBA. A logo Admin permanece inalterada.

Pendentes: revisão final dos arquivos pelo responsável, commit e push manuais, conferência da publicação no GitHub e aprovação formal de encerramento da STAFF-01. A STAFF-02 permanece bloqueada até essa aprovação. A homologação iOS não foi confirmada.
