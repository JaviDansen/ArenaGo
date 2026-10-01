# ArenaGo

ArenaGo é um aplicativo mobile desenvolvido para a BEAST MARAGAMES, voltado à participação do público em experiências e eventos.

## Funcionalidades atuais

- Navegação principal por abas: Início, Eventos e Perfil.
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

`HomeFlowScreen` escolhe o conteúdo da aba Início de acordo com o estado atual da participação.

```text
ParticipationProvider
└── NavigationContainer
    └── Stack.Navigator
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
```

## Como executar

Pré-requisitos básicos:

- Node.js e npm instalados.
- Expo Go instalado no dispositivo físico, caso queira executar no celular.

Na pasta que contém o arquivo `package.json`, execute:

```bash
npm install
npm run start
```

Como alternativa, também é possível iniciar o Expo com:

```bash
npx expo start
```

Para executar em um dispositivo físico, abra o Expo Go e escaneie o QR Code exibido pelo Expo.

## Status do projeto

O projeto está em desenvolvimento. O fluxo básico de participação na Arena já funciona com dados mockados. Leitura real de QR Code, backend, comunicação em tempo real e demais funcionalidades ainda serão desenvolvidos.
