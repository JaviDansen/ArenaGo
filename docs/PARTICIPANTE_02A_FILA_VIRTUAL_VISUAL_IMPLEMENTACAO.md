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

## Revisão 01 — Refinamento visual após validação em aparelho

### Diagnóstico e estratégia antes da implementação

Base efetiva: `52dfe6309e6f9ed6898164796427e4638c482b18`, branch `feature/heliom-participante-ux`, working tree inicialmente limpo. Consulta remota tentada, indisponível por falha de conexão ao GitHub. O pedido relata capturas reais em iPhone; as imagens não acompanham este anexo acessível, portanto o diagnóstico foi confrontado com os componentes reais, sem alegar inspeção dessas capturas.

O cabeçalho centralizado, o padding padrão dos cards e os divisores repetidos consomem área vertical. A revisão utilizará cabeçalho local alinhado à esquerda, posição oficial em painel roxo compacto, experiências com menos separadores e ações de recuperação com menor ênfase. Preservará estados, handlers, polling, regras de ingresso e encerramento. Nomes longos e fontes ampliadas continuarão com rolagem e expansão natural. Não será criado dado ou fluxo para captura.

### Implementação e revisão estática

- Cabeçalho local com título à esquerda, subtítulo discreto e ATIVA à direita, sem alteração global do ScreenHeader.
- Card de fila com padding de 12 dp, menos divisores e painel roxo mais compacto; posição oficial continua em 44 dp/800. SUA VEZ mantém a estação do servidor sem posição antiga. Aviso de ingresso mantém seu ciclo de vida.
- Experiências com ícone genérico de bandeira, padding de 12 dp (8 dp vertical durante participação em fila), sem divisores redundantes e sem truncar nomes. Disponibilidade não é repetida quando já há fila; SUA FILA permanece.
- Ingresso usa Button sm, cujo componente real garante toque mínimo de 48 dp. Atualizações usam ghost, com handlers distintos preservados; saída continua separada, com confirmação original. Nenhuma alteração na lógica acima das derivações de apresentação.
- Testes existentes adaptados ao cabeçalho local e nomes sem truncamento; acrescentada verificação da compactação e da hierarquia das ações. Cenários prévios de espera/chamada, posição, polling, pendência, aviso e recuperação preservados.
- Inspeção sintática estática e Git realizadas; testes não executados nesta etapa de implementação (AGENTS.md exige Luna Medium para a execução). Não há nova contagem de aprovados. A campanha anterior não é evidência desta revisão.
- Renderização nativa, dimensões de 375–430 dp, fontes ampliadas e capturas reais no backend continuam pendentes no Expo. Nenhuma imagem ilustrativa foi criada como evidência do paper.

### Engrenagem e limites

A busca estática em screens/components/navigation não encontrou um controle circular flutuante de engrenagem nestas telas. O botão Abrir configurações de EventEntryScreen abre os ajustes de permissão de câmera e não tem a composição relatada. A origem do controle sobreposto não pode ser confirmada pelo código nem pelas imagens deste anexo, que não estão disponíveis. Pode ser overlay externo ou de desenvolvimento, mas isso não está comprovado. Nenhum controle global foi removido. Antes da captura, verificar os overlays ativos do dispositivo/Expo e ocultar somente a ferramenta identificada pelo responsável.

### Validação preparada para Luna Medium

Após inspecionar scripts e configurar NODE_ENV=test em ambiente isolado, executar separadamente, na raiz:

```powershell
node --test app/tests/participante02aFilaVisual.test.cjs
node --test app/tests/autoQueueSync.test.cjs
node --test app/tests/participationActionScreens.test.cjs
```

Confirmar também os nomes das demais suítes afetadas no inventário local antes da campanha. A regressão geral autorizada é `npm.cmd --prefix app test`, após aprovação dos testes focados. Sem PostgreSQL, migrations, seeds ou publicação Git. Evidência única da task atualizada em `qa-evidence/PARTICIPANTE_02A-changes.diff`, preservando a base acumulada `94766a13c80bc3c91f0963c9db9acea35efac488` e o escopo original de cinco arquivos, sem o próprio patch.

Estado: refinamento implementado localmente, aguardando execução automatizada e validação visual pelo responsável. Não conclui a Task 02.

Conferência final: análise sintática dos JS/CJS alterados aprovada; comparação estática confirmou o corpo dos handlers de RealArenaScreen idêntico ao SHA de origem. `git diff --check -- app docs` passou. A verificação global inclui um aviso de espaço final numa linha de contexto vazia do patch acumulado (o prefixo de contexto do formato diff); o conteúdo fonte está limpo. O patch passou em `git apply --reverse --check`. Nenhuma validação funcional foi executada.

### Correção complementar — identidade visual e paleta

Revisada a paleta oficial de `app/theme/colors.js` antes da campanha automatizada. A aplicação anterior herdava `background.surface`/`background.elevated` dos cards, cuja composição tem tom azulado. Os estilos locais da Minha Arena agora usam `background.base` como superfície neutra, contornos suaves derivados de `primaryLight` com alfa 40 hexadecimal e `primary` nos destaques. SUA FILA e fundos de ícones usam `primaryDim`; posição e rótulos de recuperação usam `primaryLight`. Os botões primários mantêm primary/primaryHover do componente compartilhado. Experiências encerradas ficam neutras; sucesso/ATIVA/ABERTA e chamada permanecem verdes, erros/saída vermelhos e instabilidade/pendência amarelas.

O AuthBackground e seus parâmetros foram preservados, assim como os tokens globais, handlers, polling e regras. A modificação complementar ficou restrita a cores/estilos das duas telas e a esta documentação/evidências. Inspeção estática de sintaxe e diff realizada; não foram executados testes, lint, typecheck ou build. A campanha continua condicionada à confirmação manual de GPT-6 Luna Medium. A percepção final das cores deve ser conferida pelo responsável no iPhone, incluindo contraste, estados semânticos e interação pressionada, antes das capturas do paper.

### Ajustes complementares após conferência Android — nome oficial e recuperação contextual

O título passa a usar o nome oficial do evento. Fonte existente: `GET /participations/history?limit=50`, autenticado, com paginação quando necessária. `EvaluationReadController` exige autenticação; `EvaluationReadService.getHistory` seleciona participações da própria conta, inclui status active e obtém `event.name` de `events` por JOIN. O frontend confere simultaneamente participationId, event.id igual ao eventId corrente e status active. Não usa o nome salvo no ingresso. Não houve extensão de contrato nem modificação de backend.

`fetchCurrentArenaEventName` foi acrescentado ao serviço de histórico como leitura dedicada. A tela busca novamente ao montar/restaurar, ao trocar participação/evento/conta/sessão e ao tentar recuperar uma falha. Não há cache persistente ou global de nomes. Chave local inclui conta, epoch, participação e evento; cleanup e guarda de identidade descartam respostas antigas. Antes de uma resposta válida, mostra Carregando evento...; na indisponibilidade, Evento indisponível. O título permite quebra natural sem número fixo de linhas, com espaço flexível ao lado de ATIVA. O subtítulo, background e paleta anteriores foram preservados.

Removido o botão permanente Atualizar fila e experiências. A função interna refresh permanece; não foi alterado o intervalo de 5000 ms, a atualização de posição/disponibilidade/chamadas nem o tratamento de foco e primeiro plano. Tentar novamente aparece contextualmente para erro de ação/leitura, conexão instável ou nome indisponível, acionando a leitura da fila e uma nova consulta do título. Atualizar situação da participação e Sair da Arena preservam os handlers e regras. O nome não é incluído no polling de cinco segundos, evitando uma consulta de histórico por ciclo; uma renomeação no servidor será refletida na próxima montagem, troca de contexto ou tentativa contextual, e não necessariamente em tempo real.

Testes preparados/adaptados: `participante02aEventHeader.test.cjs` cobre consulta autenticada, nova montagem, nome extenso, descarte de resposta antiga após troca de conta/evento, paginação, incompatibilidade de evento e recuperação de falha. `participante02aFilaVisual.test.cjs` verifica o título e ausência do botão normal; `autoQueueSync.test.cjs` mantém os cenários de polling/primeiro plano, com expectativas ajustadas à recuperação contextual. A campanha deve começar por esses três arquivos, seguida das regressões relacionadas e da suíte completa já documentada. Nenhum teste executado nesta implementação: aguarda confirmação manual de Luna Medium conforme AGENTS.md.

Inspeção estática de sintaxe e Git/evidência realizada. O patch único 02A mantém a base `94766a13c80bc3c91f0963c9db9acea35efac488`; seu escopo foi ampliado apenas para incluir o serviço de histórico, o teste do cabeçalho e a adaptação da regressão de polling. Exclui o próprio patch. A tela de detalhes e sua evidência 05A não foram modificadas nesta correção. A próxima conferência visual permanece necessária no emulador e no celular real.

### Segunda validação física — revisão da composição e legibilidade

As duas imagens foram analisadas diretamente no chat antes da alteração: referência com card violeta/posição dominante e captura real iOS com número ilegível como retângulo, bandeiras nas experiências, superfície quase preta, texto auxiliar apagado e saída parcialmente fora do viewport. A referência orienta hierarquia e contraste; suas proporções distorcidas e contadores de conclusões não foram reproduzidos.

**Diagnóstico da posição:** formatQueuePosition continua produzindo uma string numérica seguida de U+00BA (`º`), exclusivamente a partir da posição inteira validada do servidor. A fonte configurada no iOS é System (Android sans-serif); não há fonte de ícones no texto. O componente anterior encaixava rótulo de 16 dp/lineHeight 22 e número de 44 dp/lineHeight 52 num Text pai sem métricas explícitas. A captura comprova a falha visual, e a inspeção identifica mistura de métricas de texto aninhado como hipótese concreta de clipping/fragmentação da linha nativa. Não foi reproduzida instrumentadamente no iOS, portanto não se afirma causa raiz confirmada, falha de glyph ou bug específico de fonte/React Native.

A composição foi alterada para dois Texts irmãos dentro de View flexível: rótulo em 22 dp/700, ordinal em 44 dp/800, altura intrínseca, sem lineHeight forçado, sem limite de linhas nem tamanho fixo do número. O painel mantém rótulo acessível único com a posição completa; aceita quebra natural para valores longos e fontes ampliadas. O estado chamado continua substituindo a posição pela estação oficial. A instabilidade mantém identificação de última posição confirmada e amarelo semântico.

**Direção visual aplicada localmente:** superfície principal #191326, secundária #181626, seleção #241632, painel #503078, borda #A855F7 e destaques #B56CFF. Painel com pessoas, separador vertical e textos brancos; isso reforça contraste em vez de copiar o texto violeta de baixo contraste da referência. O ícone duplicado no canto do card foi retirado. O gamepad existente em LineIcon é desenhado por Views/bordas nativas e foi reutilizado, sem alterar seus desenhos globais ou inferir categorias específicas. As bandeiras eram a seleção explícita de `name="flag"`, e não um defeito comprovado do desenho gamepad. O selo SUA FILA acompanha o conteúdo da experiência, sem footer extra. Disponibilidade e ingresso são mantidos onde cabíveis.

O subtítulo e a nota automática ganharam contraste. Mantido nome oficial do evento e ATIVA; optou-se por não acrescentar logo/barra para preservar espaço e prioridade do nome. Aviso verde e seu ciclo de vida não foram alterados. As ações inferiores têm margens menores; ScrollView recebe flex:1/minHeight:0 para ter viewport limitado, conteúdo natural e padding inferior de 32 dp. As áreas seguras existentes de AuthBackground e a barra inferior não foram modificadas. A saída permanece rolável e exige conferência real no dispositivo.

**Validações e limites:** preparados testes de Texts irmãos, posições 1/12/1234, rótulo acessível, ausência de clipping por lineHeight herdado, superfícies, iconografia e estrutura rolável. A regressão automática mantém as demais verificações e passa a ler a posição no grupo de apresentação. Análise sintática estática e conferência Git/evidência realizadas; não equivalem à renderização nativa. Nenhum teste, build, lint ou typecheck executado pelo implementador. A execução continua reservada a Luna Medium com confirmação manual. A única renderização real examinada é a captura anterior fornecida pelo responsável; não foi produzida captura posterior à correção. Portanto a resolução visual no iOS permanece pendente de nova execução física, principalmente para ordinal, um/múltiplos dígitos, nomes longos, escala de fonte, sem fila/chamado/instabilidade e rolagem até Sair da Arena. Não há nova contagem de testes aprovados.

Campanha preparada: participante02aFilaVisual, participante02aEventHeader, autoQueueSync, arenaQueueService.integration e participationActionScreens, seguida da regressão app quando aprovadas as focadas. Backend, dados, contratos, polling, autenticação e detalhes da participação foram preservados. Evidência acumulada única 02A regenerada com a mesma base e escopo da correção anterior.

### Ajuste final — compactação do painel da posição

Reduzida a altura mínima do painel de 80 para 56 dp (30%), com padding vertical de 12 para 4 dp, ícone de 28 para 22 dp, divisor de altura mínima esticada de 36 dp para altura decorativa de 28 dp e número de 44 para 34 dp/800. O rótulo permanece em 22 dp; o número continua sendo o principal destaque. O espaço até a informação de atualização automática caiu de 8 para 4 dp. Cores, bordas e o restante da composição foram preservados.

Ícone, divisor e textos continuam em composição horizontal com alinhamento vertical central. Rótulo e número permanecem Texts irmãos, sem Text pai, sem lineHeight forçado ou altura fixa para o conteúdo. A altura mínima permite crescimento para fontes ampliadas, nomes/valores extensos e instabilidade, em vez de recortar o texto; portanto a redução visual exata depende da escala de fonte no aparelho. Mantidos os testes de ordinal com um e múltiplos dígitos; ajustado apenas o limite tipográfico anterior de 40 dp, incompatível com a redução solicitada, preservando a verificação de maior destaque que os demais textos.

Rodada restrita à apresentação: nenhuma regra funcional alterada. Inspeção sintática, diff de código/documentação e consistência reversa da evidência realizadas; não foram executados testes ou renderização nativa. A confirmação visual final no iPhone continua necessária e a campanha automatizada permanece condicionada à seleção manual de Luna Medium. Patch acumulado 02A atualizado com a mesma base e escopo.

### Fechamento da interface — somente saída no estado normal

A compactação de aproximadamente 30% já estava aplicada: painel com minHeight 56 dp (antes 80), padding vertical 4 dp, ícone 22 dp, divisor 28 dp, número 34 dp e intervalo de 4 dp até o texto de atualização. Essas medidas foram preservadas, sem aplicar outra redução cumulativa. Permanecem Texts irmãos, altura intrínseca do número, composição horizontal e alinhamento central, com expansão para acessibilidade.

Removido Atualizar situação da participação do estado normal. A área abaixo das experiências mantém apenas Sair da Arena como botão permanente; foi retirado o divisor e zerada a margem superior do botão de saída. Tentar novamente permanece contextual em falhas da fila/sincronização/nome do evento. Não houve remoção de refresh interno, da sincronização automática de participação, do polling de cinco segundos ou da recuperação de HomeFlowScreen (onRetry=refreshParticipation). O refreshParticipation após finalização continua presente. Nenhuma alteração de contrato, negócio ou tela de detalhes.

Adaptadas as expectativas dos testes visuais e de cabeçalho para ausência de ambos os botões de atualização, preservando verificações da ação de saída e recuperação contextual. Feitas apenas inspeção sintática e verificações estáticas de diff/evidência; nenhum teste, lint, build ou typecheck executado. Conferência física final e campanha com Luna Medium continuam pendentes. Markdown e patch acumulado atualizados, sem staging, commit ou push.

### Refinamento exclusivo da chamada — É a sua vez!

No estado confirmado `called`, o card mantém #191326 e passa a borda externa para verde semântico. Sino no canto superior direito e mensagem O Staff está aguardando você. abaixo do título reforçam a chamada. O painel da estação usa localização, divisor e dois Texts independentes: Dirija-se à estação e o stationLabel oficial, sem truncamento ou altura fixa. Rodapé substituído por Apresente-se ao Staff para iniciar sua experiência. A experiência correspondente troca SUA FILA por CHAMADO em verde apenas durante called; as outras experiências não recebem o selo.

Adicionados desenhos opt-in bell/location ao LineIcon, com Views/bordas nativas, sem dependências, emojis ou alteração dos ícones existentes. Estado waiting permanece com borda/painel violeta e texto automático; a chamada não exibe posição anterior. O aviso superior de conexão instável continua disponível quando necessário, mesmo durante a chamada. A mudança do rodapé não altera polling, vibração, sincronização, fonte do nome da estação ou qualquer ação operacional. Não foram criados cronômetros ou novas ações.

Expectativas dos testes de apresentação e retomada ajustadas para rótulo/estação separados, nome oficial acessível, borda/superfície, ícones e selo exclusivo. Executadas somente inspeção sintática, diff e consistência do patch; nenhuma execução automatizada ou renderização nativa nesta rodada. Campanha continua pendente com Luna Medium e conferência física necessária para estação longa, fontes ampliadas e instabilidade. Patch único 02A regenerado na base acumulada existente; alterações locais preservadas, sem staging/commit/push.

### Harmonização cromática do chamado — estrutura aprovada preservada

Ajuste exclusivamente local de cores: borda externa volta a #A855F7; sino/localização e divisor usam #B56CFF. Painel da estação passa a #241632 com contorno violeta discreto (#A855F7 a 50%); nome oficial da estação permanece branco com a mesma tipografia. Ícone e texto da orientação inferior usam cinza claro #C4BBD2. CHAMADO passa à variante brand roxa; SUA VEZ, ATIVA e ABERTA permanecem verdes. Superfície externa, composição, hierarquia, textos, medidas e handlers não foram alterados.

A saída mantém variante dangerOutline e confirmação destrutiva, com substituições locais da borda por #A84E66 e texto #E58A9D, reduzindo a saturação/intensidade do vermelho sem transformá-la numa ação da marca. O componente mantém os estados pressionado e desabilitado existentes. Nenhum token global foi modificado. Espera continua roxa e instabilidade mantém seu aviso semântico.

A expectativa de borda no teste visual foi adaptada à cor solicitada; as verificações de chamada, estação e texto permanecem. Inspeção estática de sintaxe, diff e integridade do patch realizada. Nenhum teste ou renderização nativa executado; conferir as cores finais e os estados de interação no aparelho. Mantida a exigência de confirmação Luna Medium para a campanha, sem staging, commit ou push.

### Cabeçalho final — logo oficial e ATIVA em coluna

Reutilizado diretamente `app/assets/images/Logo ArenaGO render (admin-staff).png`, PNG RGBA existente de 2048 × 682. A inspeção visual confirmou a arte branca/roxa e o SHA-256 é idêntico ao asset logo-arenago-admin.png já utilizado pelo módulo Admin (28181211CB703993F6031EC3521F879534418C4FD3E6534ECFA64DC771A9F8CE). Nenhum asset foi criado, editado ou substituído; não há texto redesenhando o logo, tintColor ou imagem externa.

No único cabeçalho da RealArenaScreen, coluna à direita com Image de 96 × 32 dp, resizeMode contain, rótulo acessível ArenaGO e ATIVA abaixo, com intervalo de 4 dp. Nome oficial e subtítulo seguem à esquerda, em contêiner flexível com minWidth:0; a coluna da marca não encolhe, e o nome pode quebrar sem sobreposição. O mesmo cabeçalho antecede todos os estados: carga, indisponibilidade, sem fila, espera, chamado e falhas. Conteúdo dos cards, textos, paleta, fluxo e fontes de dados foram preservados.

A expectativa de cabeçalho verifica o Image e contain. O helper Node recebeu apenas o mapeamento explícito desse PNG nessa tela, confirmando a existência do arquivo antes de retornar recurso simulado; não houve fallback genérico para imports desconhecidos. Isso permite preparar a campanha sem interpretar bytes PNG como JavaScript. A evidência 02A inclui essa pequena adaptação do helper, sem outras mudanças preexistentes nesse arquivo desde a base.

Inspeção sintática e integridade Git/patch realizadas; nenhum teste ou build executado. Conferir no emulador/celular a legibilidade do logo e a quebra de nomes longos/fontes ampliadas antes das capturas. Campanha permanece condicionada à confirmação manual de Luna Medium. Mantida a branch feature/heliom-participante-ux e as alterações locais, sem staging/commit/push.

### Último ajuste do cabeçalho — título e logo alinhados, sem ATIVA

Removido integralmente o selo ATIVA da apresentação da RealArenaScreen, sem modificar o status da participação. Nome oficial e logo compartilham agora a primeira linha, com alinhamento vertical central; o subtítulo Sua participação em tempo real permanece à esquerda abaixo dessa linha. A imagem oficial existente continua em 96 × 32 dp, contain e sem tintColor/recorte/distorção. A altura do logo e os paddings existentes foram mantidos; eliminar a coluna logo+selo evita crescimento desnecessário do cabeçalho. Nome longo ocupa espaço flexível (minWidth:0) e pode quebrar, enquanto o logo não encolhe nem se sobrepõe. Fontes ampliadas e nomes extensos mantêm expansão natural para legibilidade, sem altura fixa limitante.

O cabeçalho único permanece em todos os estados ativos e preserva a leitura autenticada do nome, fallback e subtítulo. Nenhum elemento restante da tela, cor ou regra operacional foi alterado. Adaptada a expectativa existente de teste para ausência do selo. Inspeção sintática, diff de código/documentação e consistência reversa do patch realizadas; nenhum teste ou build executado. Conferência visual com nome longo/fonte ampliada pendente no aparelho. Evidência única 02A atualizada na base e escopo acumulados, sem staging, commit ou push.
