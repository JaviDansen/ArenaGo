# ArenaGo — Frontend

Este diretório contém o aplicativo mobile do ArenaGo, desenvolvido com React Native e Expo. Cadastro, login, restauração de sessão, renovação de tokens, logout e questionário usam a API NestJS/PostgreSQL. As telas de entrada em eventos, Arena, filas e avaliações ainda utilizam dados ou estado locais, mesmo quando já existem endpoints correspondentes no backend.

## Estado atual

- **Autenticação e sessões reais (K02):**
  - Cadastro real via `POST /api/v1/auth/register` enviando estritamente `{ name, email, password }` (com validação local de nome entre 2 e 150 caracteres após `trim`, e-mail válido até 255 caracteres, senha entre 8 e 128 caracteres e confirmação local `confirmPassword`).
  - Criação imediata de sessão no cadastro e redirecionamento direto para `ProfileQuestionnaire` (`hasCompletedQuestionnaire: false`).
  - Login real via `POST /api/v1/auth/login`, sem fallback simulado em caso de falha. Contas com questionário pendente (`hasCompletedQuestionnaire: false`) têm acesso permitido à área autenticada e visualizam na `HomeScreen` o atalho para concluir o questionário.
  - Tratamento seguro do desafio administrativo `requires2FA: true` sem conceder sessão autenticada nem armazenar `tempToken` como `accessToken`/`refreshToken`.
  - Armazenamento seguro do `refreshToken` opaco no `expo-secure-store` (iOS/Android) e manutenção do `accessToken` JWT exclusivamente em memória. No alvo `web`, ambos permanecem apenas em memória (sem uso de `localStorage`, `sessionStorage` ou `AsyncStorage`).
  - Restauração automática de sessão ao reabrir o app (`POST /api/v1/auth/refresh` + `GET /api/v1/auth/me`) e renovação coordenada em modo *single-flight* ao receber `401` por expiração do `accessToken`, evitando reenvio concorrente ou *replay* automático após falha de transporte inconclusiva ou timeout incerto no refresh.
  - Logout real via `POST /api/v1/auth/logout` com limpeza local imediata e invalidação de respostas antigas em voo (`sessionEpoch`).
- **Navegação de autenticação:**
  - A navegação é declarativa: enquanto desautenticado, o navegador disponibiliza somente as telas públicas (`Welcome`, `Login`, cadastro e recuperação de senha); enquanto autenticado, disponibiliza somente as telas do aplicativo.
  - Login e restauração de sessão abrem `MainTabs` automaticamente. Cadastro cria a sessão e abre `ProfileQuestionnaire`; logout retorna à área pública. A remoção da rota anterior impede voltar à tela de Login após autenticar.
  - O estado de autenticação controla a árvore de rotas sem navegação manual nas telas de login, cadastro ou logout.
- **Fluxos ainda locais:**
  - O questionário apresenta três etapas: dados pessoais, jogos e informações sobre o mercado de games. `ProfileQuestionnaireScreen` consulta e grava em `/profile/questionnaire`; `ProfileScreen` também consulta o perfil persistido. A navegação e o preenchimento das etapas são estado de interface local.
  - A entrada manual aceita os códigos de demonstração `FILA` e `LIVRE`, sem diferenciar maiúsculas de minúsculas. `FILA` inicia uma espera simulada na fila externa; `LIVRE` entra diretamente na Arena.
  - Na Arena, o fluxo local simula filas de experiências, chamada, ausência, confirmação de atendimento e saída.
  - A avaliação permite selecionar de uma a cinco estrelas e escrever um comentário opcional.

## Tecnologias

Versões declaradas em `package.json`:

- Expo ~57.0.25, React Native 0.86.3 e React 19.2.3.
- `expo-secure-store` ~57.0.4 para armazenamento seguro do `refreshToken` em dispositivos móveis.
- React Navigation 7 para abas e navegação em pilha.
- `@react-native-community/datetimepicker` 9.1.0 para seleção de data.
- React Native Web 0.21.x para execução no navegador.

## Pré-requisitos

- Node.js e npm instalados.
- Backend NestJS (`../backend`) em execução com PostgreSQL acessível para os fluxos de autenticação.
- Expo Go em um dispositivo compatível ou um emulador configurado.
- Para usar o modo web, um navegador compatível.

## Configuração da URL da API (`EXPO_PUBLIC_API_BASE_URL`)

O cliente HTTP compartilhado (`config/apiConfig.js` e `services/httpClient.js`) lê `EXPO_PUBLIC_API_BASE_URL` (ou o alias existente `EXPO_PUBLIC_API_URL`) por acesso estático compatível com o Expo e acrescenta automaticamente `/api/v1` quando omitido. Sem configuração, mantém o padrão `http://127.0.0.1:3000/api/v1`, útil apenas quando o app e a API compartilham o mesmo host. Consulte `app/.env.example`:

- **Web ou simulador iOS local (padrão em desenvolvimento):**
  ```env
  EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000
  ```
- **Emulador Android (AVD):**
  ```env
  EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000
  ```
- **Dispositivo físico com Expo Go (mesma rede Wi-Fi da máquina de desenvolvimento):**
  `127.0.0.1` e `localhost` no celular apontam para o próprio aparelho. Informe o IP da sua máquina na LAN:
  ```env
  EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000
  ```

Para testar em celular físico, configure o IP LAN real do computador em `app/.env.local` (ignorado pelo Git), conecte computador e celular à mesma rede e permita a porta 3000 no firewall. No backend, `API_BIND_HOST` deve ser `0.0.0.0` para aceitar conexões da rede; o padrão `127.0.0.1` aceita somente conexões locais. No emulador Android, use `10.0.2.2`; no navegador no mesmo computador, use `127.0.0.1`. Reinicie ou recarregue completamente o app no Expo Go após alterar a variável. Nunca coloque senhas ou tokens em `EXPO_PUBLIC_*`.

Em dois terminais PowerShell, após preparar manualmente o backend local conforme `backend/README.md`:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:API_BIND_HOST = '0.0.0.0' # somente para o teste em celular físico na LAN
npm.cmd run start:dev
```

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\app
npm.cmd start
```

O Expo Go precisa alcançar tanto o servidor Expo quanto o endereço da API informado no `.env.local`. A execução automatizada local não comprova conectividade com um aparelho físico.

## Instalação e execução

Execute os comandos abaixo nesta pasta (`app/`):

```powershell
npm.cmd ci
npm.cmd start
```

Os demais scripts disponíveis em `package.json` são:

```powershell
npm.cmd run android
npm.cmd run ios
npm.cmd run web
```

## Testes

Os testes usam o runner nativo do Node.js. Execute em `app/`:

```powershell
npm.cmd test
```

Na validação local desta etapa, o comando passou com **208 testes aprovados** e nenhuma falha.
Também foram reportados **11 testes manuais aprovados em iPhone físico**, cobrindo cadastro, login imediato, logout, restauração da sessão, troca de contas, validações e falhas de conexão.

## Organização

```text
app/
├── App.js                  # Navegação raiz integrada ao AuthSessionGate e ParticipationProvider
├── config/apiConfig.js     # Resolução centralizada da URL base da API (/api/v1)
├── services/               # Cliente HTTP (RFC 7807), armazenamento seguro de token e gerenciador de sessão
├── navigation/             # Abas principais
├── context/                # AuthContext (sessão real) e ParticipationContext (estado da participação)
├── screens/                # Telas agrupadas por fluxo: auth, arena, event-entry, home, participation e profile
├── components/             # Componentes reutilizáveis e compartilhados
├── data/mockData.js        # Eventos, experiências, jogos e histórico simulados
├── utils/                  # Validações e regras de datas/participação
└── tests/                  # Testes automatizados
```
