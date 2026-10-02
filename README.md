# ArenaGo

ArenaGo é um aplicativo mobile desenvolvido para a BEAST MARAGAMES, voltado à participação do público em experiências e eventos.

## Funcionalidades atuais

- Navegação principal por abas: Início, Eventos e Perfil.
- Tela inicial da BEAST MARAGAMES.
- Fluxo de autenticação: Boas-vindas (`WelcomeScreen`), Login (`LoginScreen`), Cadastro (`RegisterScreen`) e Recuperação Provisória (`ForgotPasswordScreen`).
- Validação local de Cadastro: nome obrigatório, e-mail obrigatório e formato válido, senha obrigatória com no mínimo 6 caracteres e confirmação de senha idêntica.
- Validação local de Login: e-mail obrigatório com formato válido e senha obrigatória, bloqueando navegação quando inválidos.
- Acesso provisório à Home via Login restrito a credenciais localmente válidas para desenvolvimento, enquanto não há backend.
- Estrutura preparada para criação de conta, mensagens de erro do backend e Questionário de Perfil.
- Fluxo inicial de entrada em um evento.
- Entrada manual por código de evento.
- Eventos mockados para testes com e sem fila da Arena.
- Confirmação de entrada no evento.
- Gerenciamento do estado atual da participação através de `ParticipationContext`.
- Fila da Arena com posição mockada.
- Saída da fila.
- Simulação temporária de liberação individual.
- Simulação temporária da desativação da fila pelo staff.
- Participação ativa na Arena.
- Saída da Arena e retorno à Home.
- Acesso contínuo às abas Eventos e Perfil durante uma participação.

As ações de simulação são recursos temporários de desenvolvimento enquanto não há integração com backend.

## Tecnologias

- React Native.
- Expo.
- React.
- React Navigation.
  - Native Stack Navigator.
  - Bottom Tabs Navigator.

## Estrutura de navegação

O `NavigationContainer` contém um Stack Navigator com rota inicial na tela de `Welcome`.

Após o acesso provisório pelo Login, `MainTabs` disponibiliza as abas Início, Eventos e Perfil. Na aba Início, `HomeFlowScreen` escolhe o conteúdo exibido de acordo com o estado atual da participação.

```text
ParticipationProvider
└── NavigationContainer
    └── Stack.Navigator
        ├── Welcome → WelcomeScreen
        ├── Login → LoginScreen
        ├── Register → RegisterScreen
        ├── ForgotPassword → ForgotPasswordScreen
        ├── MainTabs
        │   └── Tab.Navigator
        │       ├── Início → HomeFlowScreen
        │       │   ├── sem participação → HomeScreen
        │       │   ├── waiting → ArenaQueueScreen
        │       │   └── active → ActiveArenaScreen
        │       ├── Eventos → EventsScreen
        │       └── Perfil → ProfileScreen
        ├── EventEntry → EventEntryScreen
        └── EventConfirmation → EventConfirmationScreen