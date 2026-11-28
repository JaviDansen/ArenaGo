# PARTICIPANTE-02A — Aprimoramento visual da fila virtual

**Task:** PARTICIPANTE-02A, antecipação **parcial e somente visual** da PARTICIPANTE-02 para a captura do paper acadêmico. Não conclui a PARTICIPANTE-02.
**Responsável pela implementação:** Heliom
**Módulo:** Participante (frontend Expo)
**Branch:** `feature/heliom-participante-ux`
**Base (SHA):** `94766a13c80bc3c91f0963c9db9acea35efac488` (local e `origin` sincronizados; último commit: registro da R02 da PARTICIPANTE-01)
**Estado atual:** documentação inicial registrada **antes** de qualquer alteração de código (commit próprio). Implementação ainda não iniciada.

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

_Pendente: será preenchido ao final._
