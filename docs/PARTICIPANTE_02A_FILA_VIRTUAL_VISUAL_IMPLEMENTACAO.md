# PARTICIPANTE-02A — Aprimoramento visual da fila virtual

**Task:** PARTICIPANTE-02A, antecipação **parcial e somente visual** da PARTICIPANTE-02 para a captura do paper acadêmico. Não conclui a PARTICIPANTE-02.
**Responsável pela implementação:** Heliom
**Módulo:** Participante (frontend Expo)
**Branch:** `feature/heliom-participante-ux`
**Base (SHA):** `94766a13c80bc3c91f0963c9db9acea35efac488` (local e `origin` sincronizados; último commit: registro da R02 da PARTICIPANTE-01)
**Estado atual:** entregue para validação. A documentação inicial (§1–§7) foi registrada **antes** de qualquer alteração de código, no commit próprio `43eb5fe` (ver §8.8). Implementação e resultados em §8.

> O documento indicado na task (`ProgramacaoMobile/docs/...`) corresponde, neste repositório, a `docs/PARTICIPANTE_02A_FILA_VIRTUAL_VISUAL_IMPLEMENTACAO.md` (não há pasta `ProgramacaoMobile`).

## 1. Objetivo e escopo

Melhorar a apresentação, a hierarquia visual e o acabamento da **tela real** de participação ativa (`app/screens/arena/RealArenaScreen.js`), com prioridade para o estado "participante aguardando atendimento na fila virtual de uma experiência, com a posição visível". O funcionamento atual deve ser preservado integralmente.

**Fora do escopo:** contadores de atendimentos concluídos, contratos de backend, regras de fila, chamadas, push, fila externa (`ExternalQueueScreen`), correções pendentes da PARTICIPANTE-01, outras telas do Participante e os fluxos demonstrativos (`ActiveArenaScreen`, `ArenaQueueScreen`). Também não haverá tela ou modo especial para o paper.

## 2. Referência visual

- `ArenaGO_02_Fila_Padronizada(4).png` **não está disponível neste computador**: não veio anexada à mensagem e a busca em Documentos, Downloads, Mesa e Imagens não encontrou o arquivo. A imagem foi solicitada ao responsável.
- Até o recebimento, a implementação segue a descrição textual detalhada da task (§4 e §6): posição em destaque, separação entre o estado do participante e a lista de experiências, organização dos cards, hierarquia e ícones equilibrados. A comparação com a imagem fica pendente e será registrada aqui quando houver acesso.
- Nenhuma imagem será usada como background, elemento estático ou evidência.

## 3. Diagnóstico visual da tela atual (base `94766a1`)

| Área | Situação atual | Problema visual |
|---|---|---|
| Cabeçalho | `ScreenHeader` "Minha Arena", subtítulo "Participação ativa · informações do servidor", `Badge` "ATIVA" (success). | Funcional, mas o subtítulo é genérico. **Fonte do nome do evento:** `GET /participations/current` (`participationView`, DTO estrito) só devolve `id`, `eventId`, `status`, horários e `externalQueue`, **sem nome do evento**. Não há fonte confiável no fluxo atual, e o título continua "Minha Arena" (6.1 da task). |
| Aviso de sucesso | Bloco com borda verde, `padding` grande, `Badge` "ATUALIZADO" e o texto "Entrada na fila confirmada pelo servidor." em linhas separadas. | Grande demais para uma frase curta; o selo e o texto competem. |
| Conexão instável | Faixa com cores fixas fora do tema (`#F59E0B`, `#2D2013`, `#FCD34D`). | Paleta divergente dos tokens `semantic.warning`/`warningBg`. |
| Card da fila (aguardando) | `Card` highlight; `Badge` "NA FILA"; título com o estilo de seção (`marginTop` de seção); nome da experiência em `body` secundário; "Posição Nº" em `titleMedium` (20 px, roxo claro); nota "A posição e a chamada são atualizadas automaticamente a cada 5 segundos." | A posição tem o mesmo peso de um título comum e não é o elemento dominante. O nome da experiência tem pouca ênfase. Informação principal e auxiliar não estão separadas. Não há iconografia. |
| Card da fila (chamado) | Mesmo card, `Badge` "SUA VEZ" (brand, igual ao estado de espera), "É a sua vez!", "Dirija-se à estação: X" no estilo da posição. | A chamada não se diferencia visualmente da espera. (A posição já não aparece quando chamado; o comportamento está correto.) |
| Tentativa pendente | `Card` elevated, `Badge` "TENTATIVA PENDENTE", texto e "Conferir / repetir a mesma tentativa". | Adequado; só falta alinhar o espaçamento ao novo padrão. |
| Lista de experiências | Título de seção; cards com nome + `Badge` ABERTA/ENCERRADA, "N pessoa(s) aguardando", nota "Recebendo entradas"/"Entrada na fila encerrada" e "Entrar na fila". | Pluralização "pessoa(s)". Sem ícone. Contagem e disponibilidade com o mesmo peso. Não indica em qual experiência o participante está (o dado `currentQueueEntry.experienceId` existe). |
| Ações | Três botões de largura total empilhados logo após a lista, mais uma nota sobre o Staff. | Visualmente pesados e misturados à lista (sem separação de seção). |
| Iconografia | Nenhum ícone; nenhum emoji. | — |

## 4. Componentes e recursos identificados

- `AuthBackground` (variant `login`, overlay 0,7): background da tela, **preservado**.
- `ScreenHeader`, `Card` (`default`, `highlight`, `elevated`), `Badge` (`brand`, `success`, `warning`, `danger`, `default`; `sm`/`md`) e `Button` (`primary`, `secondary`, `outline`, `dangerOutline`).
- `LineIcon` (PARTICIPANTE-01): `gamepad`, `queue`, `refresh`, `alert`, `door`, `clock` etc. Ícones desenhados com `View`, sem biblioteca.
- Tokens `colors`, `spacing`, `radii` e `typography` de `app/theme/`.
- Dados do backend, já validados por `arenaQueueService.js`. `currentQueueEntry` tem `experienceId`, `experienceName`, `status` (`waiting`/`called`), `position` (só em `waiting`) e `stationLabel` (só em `called`). `experiences[]` tem `id`, `name`, `waitingCount` e `acceptingNewQueueEntries`. O contrato não fornece contadores de conclusões.

## 5. Melhorias planejadas

1. **Cabeçalho (6.1):** manter "Minha Arena" e o selo "ATIVA"; subtítulo mais claro sobre a origem dos dados. Sem endpoint novo e sem nome fixo.
2. **Aviso de entrada confirmada (6.2):** componente compacto em linha, com indicador de sucesso (novo desenho `check` no `LineIcon`, no mesmo padrão de `View`) e o texto atual. A apresentação e a remoção continuam dependendo da confirmação real (lógica inalterada).
3. **Card principal (6.3):** cabeçalho com "NA FILA" e ícone de fila; título "Você está na fila"; linha da experiência com ícone e nome em destaque; **área interna destacada da posição** (fundo `brand.primaryDim`, borda `brand.primary`), com o número em tipografia grande e pesada. A frase "Posição Nº" é mantida como um único texto para leitores de tela. A posição vem do servidor.
4. **Atualização automática (6.4):** linha discreta com ícone `refresh` e o texto atual, intervalo inalterado (5 s). Com conexão instável, a área da posição passa a "Última posição confirmada" em tom de aviso, para não parecer recém-confirmada. O aviso de conexão instável é mantido e passa a usar os tokens de aviso do tema.
5. **Estado chamado (7):** selo "SUA VEZ" em verde e painel da estação; nenhuma posição de espera.
6. **Experiências disponíveis (6.5):** cabeçalho de seção com a quantidade; card com ícone em caixa, nome (até 2 linhas), contagem com plural correto ("0 pessoas", "1 pessoa", "2 pessoas aguardando"), selo ABERTA/ENCERRADA, divisor e linha de recebimento de entradas; marca "SUA FILA" na experiência da entrada atual (dado do servidor). A ordem recebida é mantida.
7. **Ações (6.8):** agrupadas numa seção própria, separadas da lista, com os mesmos títulos, estados e handlers.
8. **Sem contadores (6.6):** nenhum indicador "Concluídas".

## 6. Funcionalidades preservadas

Sem alteração em: contratos HTTP, `arenaQueueService`, intenções de fila, idempotência, polling de 5 s, `AppState`, foco, alertas de chamada (`queueAlertService`), saída da Arena, avaliação pós-saída, autenticação, isolamento de sessão, regras de disponibilidade, ordem e posição. Toda a lógica antes do `return` de `RealArenaScreen` fica intacta, inclusive a **ordem dos hooks**: os testes existentes simulam `useState` pela ordem das chamadas. Os títulos dos botões e os textos já verificados pelos testes ("Posição Nº", nota de 5 s, avisos) são mantidos.

## 7. Testes previstos

- Suítes existentes: `autoQueueSync`, `participationActionScreens`, `homeFlow`, `homeReturnEvaluation`, `arenaQueue`, `activeArena`, `arenaQueueService.integration`, `arenaAccessGuard.integration`, `roleRoutingIntegration`, `uiComponents`.
- Novo `app/tests/participante02aFilaVisual.test.cjs`, cobrindo a matriz do §10 da task: ativo sem fila; aguardando com posição em destaque; posição alterada; chamado sem posição; abertas/encerradas; conexão instável; tentativa pendente; atualização manual; saída; nome longo e posição de vários dígitos; plural; ausência de contadores.
- Suíte completa do app (`npm test` em `app/`) e `npx expo export` (Android/iOS) para verificar a compilação.
- **Captura real:** depende de aparelho/emulador e de backend com dados reais. Não há nenhum dos dois neste ambiente, então serão registrados os passos para o responsável.

## 8. Implementação e resultados

**Ambiente:** macOS 12.7.6 (x86_64), Node v22.23.5, dependências já instaladas em `app/` e `qa/regression/`. Implementação, testes, commit e push foram feitos pelo assistente (Claude Code) por pedido explícito do responsável. Nenhum backend, banco ou serviço externo foi usado.

### 8.1 Melhorias visuais realizadas

| Item da task | O que mudou |
|---|---|
| 6.1 Cabeçalho | Mantidos "Minha Arena" e o selo "ATIVA". Subtítulo mais curto, "Participação ativa · dados do servidor", que cabe em uma linha a 390 px. Sem nome de evento, porque o contrato não o fornece (§3). |
| 6.2 Aviso de entrada | Linha compacta (borda e fundo `semantic.success`), com indicador circular e ícone `check` + texto. O mesmo estado `notice`; apresentação e remoção inalteradas. |
| 6.3 Card da fila | Linha superior com "NA FILA" + ícone de fila; título "Você está na fila" (`titleMedium`); nome da experiência com ícone `gamepad` (`bodyLarge`, primário, até 2 linhas); **painel da posição** (fundo `brand.primaryDim`, borda `brand.primary`, `radii.lg`) com "Posição" e o número em 44 px / peso 800, o maior texto da tela. A frase "Posição Nº" segue como um único `Text` (rótulo e número aninhados), com `accessibilityLabel` "Posição na fila: Nº". |
| 6.4 Atualização automática | Divisor e linha discreta com ícone `refresh` e o texto existente (intervalo de 5 s inalterado). Com conexão instável: o painel passa a tom de aviso e rótulo "Última posição confirmada", o número fica em cor secundária e a nota diz "Exibindo as últimas informações confirmadas; reconectando automaticamente...". O aviso "INSTÁVEL" do topo foi mantido e passou a usar os tokens `semantic.warning`/`warningBg` no lugar das cores fixas. |
| 7 Chamado | Selo "SUA VEZ" em verde, ícone `door` e painel verde "Dirija-se à estação: X". Nenhuma posição de espera é exibida. |
| 7 Tentativa pendente | Mesmo conteúdo e botão "Conferir / repetir a mesma tentativa", agora com ícone de alerta e o mesmo espaçamento do card da fila. |
| 6.5 Experiências | Cabeçalho da seção com a quantidade ("3 experiências"); card com ícone `gamepad` em caixa (apagada quando encerrada), nome (até 2 linhas), ícone de fila + contagem com plural correto, selo ABERTA/ENCERRADA, divisor e linha com ponto de status + "Recebendo entradas"/"Entrada na fila encerrada". Na experiência da entrada atual (`currentQueueEntry.experienceId`), borda roxa e selo "SUA FILA". A ordem do servidor é mantida. |
| 6.6 Contadores | Não implementados (nenhum "Concluídas"). |
| 6.8 Ações | Seção própria após a lista: "Atualizar fila e experiências" e "Atualizar situação da participação" em tamanho `md`; divisor; "Sair da Arena"; nota do Staff com ícone. Títulos, `disabled` e handlers idênticos. |

### 8.2 Arquivos

| Arquivo | Alteração |
|---|---|
| `app/screens/arena/RealArenaScreen.js` | Imports (`LineIcon`, `radii`, utilitário) e o bloco visual (derivações de apresentação após `lockActions`, JSX e estilos). **Nenhuma linha de lógica alterada:** hooks, ordem dos `useState`, polling, `refresh`, `syncSilent`, `join`, `finish`, alertas e guardas de sessão continuam idênticos (o diff começa depois de `lockActions`). |
| `app/components/ui/LineIcon.js` | Novo desenho `check` (L de bordas girado 45°, mesmo padrão de `View`, sem dependência). |
| `app/utils/arenaQueuePresentation.js` (novo) | `formatWaitingCount`, `formatQueuePosition` e `formatExperienceCount`: só formatação de números do servidor. |
| `app/tests/participante02aFilaVisual.test.cjs` (novo) | 12 testes (§8.4). |
| `qa-evidence/PARTICIPANTE_02A-changes.diff` (novo) | Patch da task (§8.8). |

Sem alteração de backend, contratos, serviços, intenções, idempotência, polling, navegação, `ExternalQueueScreen`, `ActiveArenaScreen` ou `ArenaQueueScreen`.

### 8.3 Componentes reutilizados

`AuthBackground` (inalterado), `ScreenHeader`, `Card` (`highlight`, `elevated`, `default`), `Badge` (`brand`, `success`, `warning`, `danger`, `default`), `Button` (`primary`, `secondary`, `outline`, `dangerOutline`; tamanho `md` nas ações), `LineIcon` (`queue`, `gamepad`, `refresh`, `alert`, `door` e o novo `check`) e os tokens `colors`, `spacing`, `radii` e `typography`. Nenhuma biblioteca nova, nenhum emoji, nenhuma dimensão tirada de pixels do mockup.

### 8.4 Testes executados

| Comando (em `app/`) | SHA testado | Total | Aprov. | Falhas | Cancel. | Ignor. | Exit |
|---|---|---|---|---|---|---|---|
| Suítes da Arena antes dos testes novos: `autoQueueSync`, `participationActionScreens`, `homeFlow`, `homeReturnEvaluation`, `arenaQueue`, `activeArena`, `arenaQueueService.integration`, `arenaAccessGuard.integration`, `roleRoutingIntegration`, `uiComponents` | working tree sobre `43eb5fe` | 176 | 176 | 0 | 0 | 0 | 0 |
| `node --test tests/participante02aFilaVisual.test.cjs` | idem | 12 | 12 | 0 | 0 | 0 | 0 |
| `npm test` (suíte completa, com deps de `qa/regression`) | idem (idêntico ao commit da task) | **1009** | **1009** | 0 | 0 | 0 | 0 |
| `npx expo export --platform android` / `ios` | idem | — | — | — | — | — | 0 / 0 |
| `git diff --check` | idem | — | — | — | — | — | sem problemas |

- 1009 = 997 (campanha da PARTICIPANTE-01 R02) + 12 novos. Nenhum teste existente foi alterado ou removido: as 176 verificações da Arena passaram com a tela nova sem ajuste.
- Os testes novos cobrem a matriz do §10 da task: ativo sem fila (02A-02), aguardando com a posição como maior tipografia (02A-03), posição alterada (02A-04), chamado sem posição (02A-05), abertas/encerradas e encerramento global (02A-06), conexão instável identificando a última posição confirmada (02A-07), tentativa pendente (02A-08), atualização manual e saída com os mesmos handlers (02A-09), nome longo e posição de 4 dígitos (02A-10), aviso compacto só com aviso real (02A-11), sem contadores, sem emojis e só ícones do `LineIcon` (02A-12), plural e ordinal (02A-01).

### 8.5 Conferência visual local (não é evidência)

Para conferir o layout sem aparelho, a tela real foi renderizada com `react-native-web` (dependência já existente do app), usando os componentes e o tema reais e estados simulados. As capturas foram feitas no Chrome headless a 390 px de largura: aguardando, chamado, sem fila, conexão instável, nome longo/posição 1234 e tentativa pendente. A conferência levou a um ajuste: o subtítulo do cabeçalho foi encurtado porque ocupava duas linhas. O script e as imagens ficaram só na pasta temporária do assistente e **não foram versionados**. Também **não servem de evidência para o paper**: não rodam no app, não usam dados reais e não carregam o background de imagem nem as fontes do aparelho.

### 8.6 Captura real para o paper: PENDENTE (passos para o responsável)

Não há aparelho, emulador nem backend com banco neste ambiente. Para obter a captura real:

1. Backend em ambiente de teste autorizado, com um **evento aberto e fila externa desativada** (`externalQueueEnabled = false`). Assim o ingresso cria a participação já `active` (`participations.service.ts`, `status = externalQueueEnabled ? "waiting" : "active"`) e o app abre a Minha Arena (`RealArenaScreen`). Com a fila externa ativa, o participante vê primeiro a `ExternalQueueScreen` até a liberação pelo Staff.
2. Experiências e estações cadastradas e disponíveis (Admin).
3. Conta de teste de participante com questionário completo e **nome fictício**.
4. No aparelho: entrar no evento (QR Code ou código) → Confirmar entrada → abrir Minha Arena.
5. Para uma posição maior que 1º, outras contas de teste entram antes na mesma experiência.
6. Tocar em "Entrar na fila" na experiência escolhida. Aparece "Entrada na fila confirmada pelo servidor." e o card "Você está na fila" com a posição real.
7. O Staff **não** deve chamar o participante até a captura. Capturar com o atalho do aparelho, sem edição posterior. A tela não mostra dados pessoais; conferir a barra de notificações antes.

### 8.7 Limitações e decisões

- **Mockup:** `ArenaGO_02_Fila_Padronizada(4).png` continua indisponível. A comparação com ele fica pendente.
- **Nome do evento:** não exibido. `GET /participations/current` não o fornece, e a task proíbe endpoint novo.
- **Nota de 5 s:** mantida literalmente ("…atualizadas automaticamente a cada 5 segundos."). É verdadeira (o intervalo é 5 s) e já era verificada por teste existente.
- **Validação física** (Android/iOS, fonte ampliada, áreas seguras, navegação inferior): pendente, pelo mesmo motivo da §8.6. O `ScrollView` e os `paddings` existentes foram mantidos.
- Nenhuma necessidade de alteração funcional foi identificada.

### 8.8 Git e evidências

- `43eb5fe`: `docs(participante): iniciar documentacao da PARTICIPANTE-02A`, **somente** §1–§7 deste documento, antes de qualquer código.
- Commit seguinte: `feat(participante): aprimorar interface da fila virtual` (código, testes, esta seção e o patch).
- **Patch:** `qa-evidence/PARTICIPANTE_02A-changes.diff`, base `94766a13c80bc3c91f0963c9db9acea35efac488` (SHA de início da task). Escopo: todo o trabalho da task, isto é, documento inicial, código, testes e esta atualização, exceto o próprio patch. Verificado com `git apply --check` sobre a base.
- Push sem force em `feature/heliom-participante-ux`, com a conta `heliom13` (a mesma das entregas anteriores). Sem merge na `develop`. PARTICIPANTE-01 e o restante da PARTICIPANTE-02 não foram retomados.

**Estado da task:** PARTICIPANTE-02A entregue para validação. A captura real e a comparação com o mockup ficam pendentes com o responsável.
