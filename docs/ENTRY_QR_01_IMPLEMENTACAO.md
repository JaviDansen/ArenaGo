# ArenaGO — ENTRY-QR-01: Entrada em eventos por QR Code ou código manual

**Responsável:** Kaled
**Repositório:** `JaviDansen/ArenaGo`
**Branch:** `feature/event-entry-qr-code`
**Origem (HEAD base):** `1df82e17bc9e7cc24c84f1721031050c6cc442b9` (`develop`)
**Commits de referência:** `e4a6691e`, `f9a29a90`
**Status:** Em revisão de homologação; validações pendentes

---

## 1. Objetivo da Tarefa

Implementar a leitura de QR Code para ingresso em eventos no ArenaGO e atualizar a interface da tela de entrada para disponibilizar duas alternativas bem visíveis, acessíveis e independentes:

1. **Ler QR Code** (Câmera traseira com enquadramento visual, validação de payload e proteção contra leituras duplicadas).
2. **Digitar código** (Formulário manual existente preservado com opções de alternância e retorno).

Ambas as modalidades utilizam estritamente o mesmo fluxo unificado de consulta de evento (`lookupEvent`), elegibilidade e confirmação explícita na tela `EventConfirmationScreen`.

---

## 2. Arquivos Modificados e Novas Dependências

### Dependências
- `app/package.json` e `app/package-lock.json`:
  - Adicionado `expo-camera@~58.0.14` (instalado via `npx expo install expo-camera`, totalmente alinhado ao Expo SDK 58).

### Configurações Nativas
- `app/app.json`:
  - Permissão iOS configurada em `ios.infoPlist.NSCameraUsageDescription`: *"O ArenaGO precisa de acesso à câmera para ler o QR Code de acesso aos eventos."*
  - Permissão Android declarada em `android.permissions`: `["android.permission.CAMERA"]`.
  - Configuração do plugin `expo-camera`:
    ```json
    [
      "expo-camera",
      {
        "cameraPermission": "O ArenaGO precisa de acesso à câmera para ler o QR Code de acesso aos eventos.",
        "recordAudioAndroid": false
      }
    ]
    ```
  - Nenhuma permissão de microfone, gravação de vídeo ou galeria de fotos foi solicitada.

### Código e Interface
- `app/components/ui/Card.js`:
  - Recebe a propriedade opcional `accessibilityHint`.
  - Encaminha `accessibilityHint` diretamente ao `Pressable` nativo quando o card for interativo (`isClickable`).
  - Preserva integralmente o comportamento de `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, `disabled`, dimensões mínimas de 48dp e compatibilidade global.
- `app/screens/event-entry/EventEntryScreen.js`:
  - Interface estruturada em três modos visuais: `'select'` (menu inicial de seleção), `'qr'` (leitor de câmera com retículo visual) e `'manual'` (formulário de digitação manual).
  - **Correção Rules of Hooks:** Invocação de `useIsFocused()` diretamente no nível superior do componente (sem `try/catch`).
  - **Eliminação de botões aninhados:** Os cards de QR Code e código manual operam como controles interativos únicos (`Card` com `onPress`, `accessibilityRole="button"`, `accessibilityLabel` e `accessibilityHint`). No lugar de botões `<Button>` internos, utilizam indicadores visuais não interativos (`pointerEvents="none"`), garantindo que 1 toque na área confortável do card dispare apenas uma ação.
  - Implementação de `validateAndNormalizeQrCode(raw)` para higienização e validação de segurança do QR Code lido.
  - Integração com `CameraView` e `useCameraPermissions` de `expo-camera`.
  - Retículo visual de enquadramento (`reticleFrame`) com cantos destacados na cor da marca (`colors.brand.primaryLight`) e máscara de foco escurecida (`rgba(5, 5, 10, 0.72)`).
  - Tratamento de permissão concedida, negada e bloqueada permanentemente (com atalho para `Linking.openSettings()`).
  - Tratamento de indisponibilidade da câmera com retorno direto à digitação manual.
  - Proteção robusta contra concorrência e detecções duplicadas (`isScanningRef`, `scanned`, `scanSequenceRef`).
- `app/screens/home/HomeScreen.js`:
  - Atualizada a descrição da seção "Pronto para jogar?" para contemplar ambas as opções:
    *"Escaneie o QR Code ou digite o código de acesso disponibilizado pela equipe do evento para iniciar sua participação."*

### Testes
- `app/tests/helpers/questionnaireHarness.cjs`:
  - Repasse da propriedade `accessibilityHint` no stub compartilhado de `Card`.
- `app/tests/uiComponents.test.cjs`:
  - Cobertura de encaminhamento de `accessibilityHint` no Pressable interativo do `Card`.
- `app/tests/eventEntry.test.cjs`:
  - Regressão completa dos 7 testes preexistentes (fluxo manual e confirmação).
  - Testes cobrindo ausência de botões aninhados, presença das dicas `accessibilityHint` nos cards "Ler QR Code" e "Digitar código", encaminhamento no `Card.js` compartilhado, e desativação/recuperação da câmera ao alternar foco.

---

## 3. Arquitetura da Solução e Decisões de Design

### 3.1. Tela Inicial e Seleção de Método (`mode === 'select'`)
Ao entrar na tela, o participante encontra um cabeçalho oficial `ScreenHeader` com botão de retorno e duas opções apresentadas em cards interativos com tokens do Design System (`radii.md`, `spacing.xl`, `colors.background.surface`):
- **Card Opção A (Ler QR Code):** Badge "RÁPIDO", título, descrição explicativa e indicador visual de ação primário. A área de toque é o próprio `Card`, sem botões clicáveis aninhados.
  - `accessibilityRole="button"`
  - `accessibilityLabel="Ler QR Code. Aponte a câmera para o QR Code do evento."`
  - `accessibilityHint="Toque para abrir o leitor de QR Code"`
- **Card Opção B (Digitar código):** Badge "MANUAL", título, descrição e indicador visual outline. A área de toque é o próprio `Card`, sem botões clicáveis aninhados.
  - `accessibilityRole="button"`
  - `accessibilityLabel="Digitar código. Informe o código de acesso manualmente."`
  - `accessibilityHint="Toque para abrir a digitação manual de código"`
- **Acessibilidade:** Leitores de tela anunciam cada card como um único botão com rótulo descritivo e dica de ação.

### 3.2. Opção A — Leitor de QR Code (`mode === 'qr'`)
- **Câmera:** Utiliza `facing="back"` e `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`.
- **Foco e Ciclo de Vida:** Utiliza o hook `useIsFocused()` no nível superior do componente. A câmera é desmontada/desativada caso a tela perca o foco (ex.: ao navegar para a tela de confirmação ou trocar de aba). Ao recuperar o foco, a câmera é remontada e fica pronta para novas leituras.
- **Enquadramento Visual:** Sobreposição em 3 faixas com máscara semitransparente (`rgba(5, 5, 10, 0.72)`). A área central de 250x250dp possui borda sutil e 4 cantos reforçados (`borderWidth: 4`, `borderColor: colors.brand.primaryLight`), orientando o usuário a posicionar o código.
- **Permissões:**
  - Carregando: Indicador de progresso `ActivityIndicator`.
  - Negada temporariamente: Card explicativo com botão "Permitir acesso à câmera" (`requestPermission()`).
  - Negada permanentemente (`canAskAgain: false`): Card com orientação e botão "Abrir configurações" (`Linking.openSettings()`).
  - Em qualquer cenário de bloqueio, os botões "Digitar código manualmente" e "Voltar para opções" permanecem acessíveis.

### 3.3. Opção B — Digitar Código (`mode === 'manual'`)
- Preserva integralmente o formulário existente com `InputField`, botão "Continuar", tratamento de erros locais e remotos, e submissão via teclado.
- Adiciona botões de navegação "Ler QR Code" e "Voltar para opções", garantindo livre alternância entre os métodos.

### 3.4. Validação e Segurança do QR Code
A função `validateAndNormalizeQrCode(raw)` aplica as seguintes regras antes de consultar o backend:
1. Rejeita payloads vazios ou constituídos apenas por espaços.
2. Rejeita esquemas de URL (`http://`, `https://`, `ftp:`, `javascript:`, `data:`, `file:`) para evitar phishing ou redirecionamentos maliciosos.
3. Rejeita caracteres de quebra de linha (`\r`, `\n`, `\t`) para evitar injeções em logs ou formulários.
4. Exige de 4 a 64 caracteres após remover espaços externos.
5. Aceita apenas grupos ASCII alfanuméricos separados por um hífen (`/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/`); underscores são rejeitados.
6. Envia o código sem alterar sua caixa à consulta unificada; o backend normaliza a caixa na consulta.

### Revisão de homologação

- A câmera e a sobreposição usam `StyleSheet.absoluteFill`, exportado pela versão instalada do React Native 0.88.1. O mock e as verificações de posicionamento foram atualizados.
- A validação QR segue o contrato C-10 de comprimento e caracteres. Os testes preparados incluem limites, underscores, separadores e caracteres não ASCII.
- A consulta manual passou a bloquear submissões simultâneas e a descartar navegação após perda de foco, troca de modo ou desmontagem. Uma falha tardia de leitura QR não libera o bloqueio de uma consulta posterior.
- A inspeção estática confirmou alternativas para permissão negada, desligamento da câmera sem foco e navegação para confirmação explícita antes de criar participação. A consulta usa o `ParticipationContext` e o serviço existentes; o estado compartilhado da consulta pode ser atualizado após a saída da tela, embora a navegação tardia seja descartada.
- O comportamento nativo da câmera, permissões, layout em telas pequenas e tamanhos de fonte ampliados, acessibilidade e retorno das configurações ainda requerem homologação em aparelho. As alterações e testes preparados nesta revisão não foram executados.

### 3.5. Proteção contra Leituras Duplicadas
- `isScanningRef` e `scanned` garantem que múltiplos frames da câmera contendo o mesmo QR Code não disparem múltiplas consultas `lookupEvent()`.
- `scanSequenceRef` invalida qualquer resposta assíncrona recebida se o usuário trocar de modo ou sair da tela antes do término da requisição HTTP.
- O leitor de QR Code **não confirma a participação automaticamente**: ao encontrar o evento com sucesso (`{ kind: 'found' }`), navega para `EventConfirmationScreen`, onde o participante confirma expressamente a entrada.
- Se o evento não for encontrado ou houver erro de rede, o card exibe o erro e um botão "Escanear novamente" para permitir nova leitura de forma controlada.

### 3.6. Atualização de Texto na Tela Inicial (Home)
- A descrição do card de acesso à Arena em `HomeScreen.js` contempla ambas as opções disponíveis:
  *"Escaneie o QR Code ou digite o código de acesso disponibilizado pela equipe do evento para iniciar sua participação."*

---

## 4. Instruções de Validação Automatizada (Luna Medium)

Após seleção manual confirmada de Luna Medium pelo responsável, inspecionar previamente os scripts e comandos, confirmar branch e diretório, preservar alterações e usar ambiente isolado. Conforme a política do `AGENTS.md`, executar:

```bash
cd app
node --test tests/eventEntry.test.cjs
node --test tests/uiComponents.test.cjs
npm test
```

### Escopo das Verificações Preparadas:
1. `eventEntry.test.cjs`:
   - Cards de seleção de método encaminham `accessibilityHint` ao `Pressable` nativo (`"Toque para abrir o leitor de QR Code"` e `"Toque para abrir a digitação manual de código"`).
   - Componente compartilhado `Card.js` encaminha `accessibilityHint` quando interativo e permanece `undefined` quando omitido.
   - Navegação por cada card com apenas uma ação e ausência de `Pressables`/botões aninhados.
   - Suíte de leitura, permissões, concorrência e desativação fora de foco.
2. `uiComponents.test.cjs`:
   - Encaminhamento de `accessibilityHint` no Pressable interativo do `Card`.
3. `npm test`:
   - Regressão completa do aplicativo; registrar contagens e códigos de saída reais.

Nesta revisão: nenhuma validação automatizada foi executada pelo Codex ou relatada pelo responsável; houve apenas inspeção estática. Testes, lint, typecheck e build permanecem pendentes. Nenhuma homologação ou prontidão para merge é declarada.

---

## 5. Roteiro de Homologação em Dispositivo Android

Para testar no celular físico Android:

1. **Iniciar o aplicativo com conexão para a rede local:**
   ```bash
   cd app
   npx expo start
   ```
2. **Abrir o aplicativo pelo Expo Go** escaneando o QR Code do terminal no celular Android conectado à mesma rede Wi-Fi.
3. **Fluxo A — Leitura de QR Code e Acessibilidade:**
   - Faça login como participante.
   - Na tela Home, confira o texto atualizado: *"Escaneie o QR Code ou digite o código de acesso disponibilizado pela equipe do evento para iniciar sua participação."*
   - Toque em "Entrar em um evento".
   - Verifique com o leitor de tela (TalkBack / VoiceOver) que os cards são identificados como botões com seus respectivos rótulos e dicas de ação.
   - Toque no card "Ler QR Code".
   - Conceda permissão de câmera e aponte para um QR Code de evento (ex.: `ARENA123`).
   - Verifique a navegação para `EventConfirmationScreen` (sem confirmação automática).
4. **Fluxo B — Digitação Manual:**
   - Volte para a tela de ingresso e selecione o card "Digitar código".
   - Digite o código de acesso manualmente e toque em "Continuar".
5. **Fluxo C — Alternância e Retorno:**
   - No leitor de QR Code, toque em "Digitar código manualmente" para alternar.
   - No leitor de QR Code, toque em "Voltar para opções" para retornar.
6. **Fluxo D — Permissão Negada:**
   - Revogue a permissão de câmera nas configurações do aparelho e verifique a mensagem de orientação e botão para abrir configurações.
