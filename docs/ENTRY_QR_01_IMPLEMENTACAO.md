# ArenaGO — ENTRY-QR-01: Entrada em eventos por QR Code ou código manual

**Responsável:** Kaled  
**Repositório:** `JaviDansen/ArenaGo`  
**Branch:** `feature/event-entry-qr-code`  
**Origem (HEAD base):** `1df82e17bc9e7cc24c84f1721031050c6cc442b9` (`develop`)  
**Status:** Implementado e validado

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
- `app/screens/event-entry/EventEntryScreen.js`:
  - Interface estruturada em três modos visuais: `'select'` (menu inicial de seleção), `'qr'` (leitor de câmera com retículo visual) e `'manual'` (formulário de digitação manual).
  - Implementação de `validateAndNormalizeQrCode(raw)` para higienização e validação de segurança do QR Code lido.
  - Integração com `CameraView` e `useCameraPermissions` de `expo-camera`.
  - Integração com `useIsFocused` de `@react-navigation/native` para garantir que a câmera permaneça ativa apenas quando a tela estiver visível e focada.
  - Retículo visual de enquadramento (`reticleFrame`) com cantos destacados na cor da marca (`colors.brand.primaryLight`) e máscara de foco escurecida (`rgba(5, 5, 10, 0.72)`).
  - Tratamento de permissão concedida, negada e bloqueada permanentemente (com atalho para `Linking.openSettings()`).
  - Tratamento de indisponibilidade da câmera com retorno direto à digitação manual.
  - Proteção robusta contra concorrência e detecções duplicadas (`isScanningRef`, `scanned`, `scanSequenceRef`).

### Testes
- `app/tests/eventEntry.test.cjs`:
  - Regressão completa dos 7 testes preexistentes (fluxo manual e confirmação).
  - 11 novos testes automatizados cobrindo todos os cenários da TASK ENTRY-QR-01.

---

## 3. Arquitetura da Solução e Decisões de Design

### 3.1. Tela Inicial e Seleção de Método (`mode === 'select'`)
Ao entrar na tela, o participante encontra um cabeçalho oficial `ScreenHeader` com botão de retorno e duas opções apresentadas em cards interativos com tokens do Design System (`radii.md`, `spacing.xl`, `colors.background.surface`):
- **Card Opção A (Ler QR Code):** Badge "RÁPIDO", título, descrição explicativa e botão primário para abrir o leitor.
- **Card Opção B (Digitar código):** Badge "MANUAL", título, descrição e botão outline para acessar o formulário manual.

### 3.2. Opção A — Leitor de QR Code (`mode === 'qr'`)
- **Câmera:** Utiliza `facing="back"` e `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`.
- **Foco e Ciclo de Vida:** Utiliza o hook `useIsFocused()`. A câmera é desmontada/desativada caso a tela perca o foco (ex.: ao navegar para a tela de confirmação ou trocar de aba).
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
4. Limita o comprimento a 64 caracteres.
5. Valida o alfabeto alfanumérico com hífens e underscores (`/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/`).
6. Trata e normaliza o código sem alterar sua caixa externa antes de enviar para a consulta unificada.

### 3.5. Proteção contra Leituras Duplicadas
- `isScanningRef` e `scanned` garantem que múltiplos frames da câmera contendo o mesmo QR Code não disparem múltiplas consultas `lookupEvent()`.
- `scanSequenceRef` invalida qualquer resposta assíncrona recebida se o usuário trocar de modo ou sair da tela antes do término da requisição HTTP.
- O leitor de QR Code **não confirma a participação automaticamente**: ao encontrar o evento com sucesso (`{ kind: 'found' }`), navega para `EventConfirmationScreen`, onde o participante confirma expressamente a entrada.
- Se o evento não for encontrado ou houver erro de rede, o card exibe o erro e um botão "Escanear novamente" para permitir nova leitura de forma controlada.

---

## 4. Testes Automatizados

Comandos de execução executados no projeto:
```bash
cd app
node --test tests/eventEntry.test.cjs
npm test
```

### Resultados dos Testes de Entrada em Evento (`eventEntry.test.cjs`):
- `✔ consulta real envia o código sem mudar sua caixa e navega somente após resposta válida`
- `✔ código vazio não consulta o backend nem navega`
- `✔ consulta inexistente e resposta tardia após logout não navegam`
- `✔ ineligibilidade mostra motivo real e impede POST`
- `✔ ingresso confirmado navega uma vez; toque duplo não duplica POST`
- `✔ ingresso confirmado sem sincronização só repete GET`
- `✔ erro HTTP na confirmação preserva a tela e informa o problema`
- `✔ ENTRY-QR-01: tela inicial apresenta as duas opções visíveis e independentes`
- `✔ ENTRY-QR-01: selecionar Digitar código exibe formulário manual e permite voltar para seleção`
- `✔ ENTRY-QR-01: selecionar Ler QR Code ativa a câmera com enquadramento e instruções`
- `✔ ENTRY-QR-01: permissão de câmera negada exibe aviso e botão para solicitar permissão`
- `✔ ENTRY-QR-01: permissão bloqueada permanentemente orienta a abrir configurações`
- `✔ ENTRY-QR-01: validação e normalização de QR Code rejeita códigos inválidos ou perigosos`
- `✔ ENTRY-QR-01: leitura de QR Code executa lookupEvent e navega para EventConfirmation sem confirmar automaticamente`
- `✔ ENTRY-QR-01: proteção contra leitura duplicada ignora detecções múltiplas durante consulta em andamento`
- `✔ ENTRY-QR-01: erro na consulta por QR Code exibe mensagem de erro e permite nova leitura`
- `✔ ENTRY-QR-01: resposta tardia após troca de modo ou desmontagem é descartada`
- `✔ ENTRY-QR-01: câmera é desativada quando a tela não está em foco`

**Total em `eventEntry.test.cjs`:** 18 aprovados / 0 falhas.  
**Total na suite completa (`npm test`):** 411 aprovados / 0 falhas.

---

## 5. Roteiro de Homologação em Dispositivo Android

Para testar no celular físico Android:

1. **Iniciar o aplicativo com conexão para a rede local:**
   ```bash
   cd app
   npx expo start
   ```
2. **Abrir o aplicativo pelo Expo Go** escaneando o QR Code do terminal no celular Android conectado à mesma rede Wi-Fi.
3. **Fluxo A — Leitura de QR Code:**
   - Faça login como participante.
   - Na tela inicial, acesse "Entrar em um evento".
   - Verifique a exibição dos dois cards: "Ler QR Code" e "Digitar código".
   - Toque em "Ler QR Code".
   - Se for a primeira execução, conceda a permissão de câmera no diálogo do Android.
   - Aponte a câmera para um QR Code contendo o código de um evento cadastrado (ex.: `ARENA123`).
   - Verifique que o retículo enquadra o código e que a consulta é realizada sem disparos múltiplos.
   - Verifique a transição automática para a tela `EventConfirmationScreen` com os dados do evento.
   - Verifique que o ingresso **não** foi confirmado automaticamente: o botão "Confirmar entrada" aguarda o toque voluntário.
4. **Fluxo B — Digitação Manual:**
   - Volte para a tela de ingresso e selecione "Digitar código".
   - Digite o código de acesso manualmente no campo de texto e toque em "Continuar".
   - Confirme a navegação para a tela de confirmação.
5. **Fluxo C — Alternância e Retorno:**
   - No leitor de QR Code, toque em "Digitar código manualmente" para trocar diretamente de modo.
   - No leitor de QR Code, toque em "Voltar para opções" para retornar à seleção inicial.
   - No formulário manual, toque em "Ler QR Code" e em "Voltar para opções".
6. **Fluxo D — Permissão Negada:**
   - Nas configurações do Android, revogue a permissão de câmera do Expo Go.
   - Abra o leitor de QR Code e verifique a exibição do aviso de permissão necessária ou bloqueada, com o botão para abrir configurações ou usar a digitação manual.
