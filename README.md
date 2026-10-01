# ArenaGo

ArenaGo é um aplicativo mobile desenvolvido para a BEAST MARAGAMES, voltado à participação do público em experiências e eventos.

## Funcionalidades atuais

- Navegação principal por abas: Início, Eventos e Perfil.
- Tela inicial da BEAST MARAGAMES.
- Fluxo inicial de entrada em um evento.
- Entrada manual por código de evento.
- Armazenamento do código digitado usando estado local.
- Validação local que impede o envio de código vazio ou composto apenas por espaços.
- Navegação entre telas com React Navigation.

## Tecnologias

- React Native.
- Expo.
- React.
- React Navigation.
  - Native Stack Navigator.
  - Bottom Tabs Navigator.

## Estrutura de navegação

O `NavigationContainer` contém um Stack Navigator. O Stack possui as rotas `MainTabs` e `EventEntry`. Dentro de `MainTabs`, há um Bottom Tab Navigator com as abas Início, Eventos e Perfil.

```text
NavigationContainer
└── Stack.Navigator
    ├── MainTabs
    │   └── Tab.Navigator
    │       ├── Início → HomeScreen
    │       ├── Eventos → EventsScreen
    │       └── Perfil → ProfileScreen
    └── EventEntry → EventEntryScreen
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

O projeto está em desenvolvimento. A validação real do código do evento, leitura de QR Code, integração com backend e outras funcionalidades ainda serão desenvolvidas.
