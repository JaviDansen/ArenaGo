# ArenaGo

ArenaGo é um aplicativo mobile em React Native com Expo para participantes dos eventos BEAST MARAGAMES. O projeto oferece um fluxo local de cadastro, perfil, entrada em eventos, participação na Arena e avaliação. As informações usadas no fluxo atual são simuladas e ficam somente em memória.

## Estado atual

O aplicativo já contém:

- Tela de boas-vindas, cadastro, login e recuperação de senha provisórios.
- Validação local de cadastro e login. O cadastro exige nome, e-mail válido, senha com pelo menos seis caracteres e confirmação; o login exige e-mail válido e senha preenchida.
- Questionário de perfil em três etapas: dados pessoais, jogos selecionados e mercado de games.
- Validação de data de nascimento, incluindo máscara, calendário nativo/web e rejeição de datas incompletas, inválidas ou futuras.
- Entrada manual em eventos pelos códigos simulados `FILA` e `LIVRE`, sem distinção entre maiúsculas e minúsculas.
- Confirmação de entrada com participação em `waiting` para eventos com fila externa e `active` para eventos sem fila.
- Fila externa com posição simulada, liberação, desativação simulada e saída.
- Filas individuais das experiências, chamada simulada, saída, ausência e bloqueio de filas simultâneas.
- Confirmação simulada do staff, que incrementa `experienceParticipations` e libera a entrada em outra experiência.
- Finalização da participação, limpeza da fila ou experiência ativa e navegação para a avaliação.
- Avaliação local com estrelas, comentário opcional, envio simulado e opção “Avaliar mais tarde”. Nenhuma avaliação é persistida.
- Tela Minhas Participações (aba Eventos) com histórico simulado: nome do evento, data e tempo de permanência quando a saída foi registrada, além de estado vazio quando não há participações.

As ações de login, filas, staff, avaliação e os eventos são recursos de desenvolvimento. Não representam integração com serviços de produção.

## Abas principais

- **Início:** fluxo do participante implementado com simulações locais, incluindo cadastro/login provisórios, questionário de perfil, entrada em eventos, filas, experiências, finalização e avaliação.
- **Eventos:** `EventsScreen` exibe Minhas Participações, a lista do histórico de participações simuladas (`mockParticipations`). Cada item mostra evento, data e permanência; quando a saída não foi registrada, mostra “Permanência não registrada”. Ainda não há tela de detalhes.
- **Perfil:** aba ainda em desenvolvimento no frontend. `ProfileScreen` atualmente exibe apenas o rótulo da aba; as funcionalidades futuras não estão implementadas.

O questionário de perfil citado no fluxo inicial é uma tela própria (`ProfileQuestionnaireScreen`) e já possui interface e validações locais. Ele não representa a aba Perfil, que permanece em desenvolvimento.

## Tecnologias

As dependências principais, conforme `package.json`, são:

- React 19.2.3 e React Native 0.86.3.
- Expo ~57.0.25.
- React Navigation 7, com Native Stack e Bottom Tabs.
- `@react-native-community/datetimepicker` para seleção de data.
- `react-native-safe-area-context`, `react-native-screens` e `expo-status-bar`.
- React Native Web e React DOM para execução web.

## Pré-requisitos

- Node.js e npm instalados no Windows.
- Expo Go em um dispositivo físico, ou um emulador Android/iOS configurado.
- Para execução web, um navegador compatível.

O projeto não fixa uma versão de Node.js neste momento. A versão do Expo e das demais bibliotecas deve ser obtida do `package.json` e do `package-lock.json`.

## Instalação e execução

Todos os comandos desta seção devem ser executados na raiz do projeto Expo: `C:\DoJob\ProgramacaoMobile\app`. Se o terminal estiver em `C:\DoJob\ProgramacaoMobile`, entre nessa pasta uma vez com `cd app`; se já estiver em `C:\DoJob\ProgramacaoMobile\app`, não é necessário executar `cd app` novamente.

Na raiz `app`, execute:

```powershell
npm.cmd ci
npm.cmd start
```

O comando `npm.cmd start` abre o servidor do Expo. A partir dele, o projeto pode ser aberto no Expo Go usando o QR Code ou em um emulador.

Também estão disponíveis os scripts:

```powershell
npm.cmd run android
npm.cmd run ios
npm.cmd run web
```

O script de iOS depende de um ambiente Apple compatível. No Windows, a execução mais direta é pelo Expo Go em um iPhone ou pela versão web.

## Organização do projeto

```text
app/
├── App.js                 # Navegação raiz e Provider da participação
├── navigation/            # Abas principais
├── context/               # Estado compartilhado da participação
├── screens/               # Telas de autenticação, perfil, eventos e Arena
├── components/            # Componentes reutilizáveis, como data de nascimento
├── data/                  # Eventos, experiências e jogos simulados
├── utils/                 # Validações e tratamento de datas
└── tests/                 # Testes automatizados Node.js
```

O `ParticipationContext` mantém a participação atual em memória. Não há Context de autenticação nem armazenamento local de usuário.

## Fluxo do participante

1. `WelcomeScreen` encaminha para cadastro ou login.
2. `RegisterScreen` valida os dados localmente e encaminha nome e e-mail ao `ProfileQuestionnaireScreen`. `LoginScreen` possui acesso provisório à `MainTabs` após a validação local.
3. O questionário coleta dados pessoais, jogos e respostas sobre o mercado de games. Ao concluir, retorna para `MainTabs`.
4. Na aba Início, o `HomeFlowScreen` escolhe `HomeScreen`, `ArenaQueueScreen` ou `ActiveArenaScreen` conforme o estado da participação.
5. `EventEntryScreen` recebe `FILA` ou `LIVRE` e abre `EventConfirmationScreen`.
6. A confirmação cria uma participação. Eventos `FILA` começam em `waiting`, com posição externa simulada; eventos `LIVRE` começam em `active`.
7. Na Arena, o participante pode entrar em uma fila de experiência. Enquanto estiver em uma fila ou em uma experiência ativa, as demais filas ficam indisponíveis.
8. A chamada simulada move a experiência para `activeExperience`. O staff simulado registra a conclusão, incrementa o contador da experiência e libera uma nova entrada.
9. A ausência remove a experiência ativa e coloca o participante no fim simulado da fila correspondente. Sair da Arena marca a participação como `finished`, limpa estados temporários e abre a avaliação.
10. A avaliação aceita uma nota de uma a cinco estrelas e comentário opcional. O envio e “Avaliar mais tarde” retornam à Home sem criar pendência persistente.

## Dados simulados

`data/mockData.js` contém os eventos `FILA` e `LIVRE`, a lista de experiências, sugestões de jogos e o histórico simulado de participações (`mockParticipations`). As posições das filas, chamadas do staff, conclusão de experiências e credenciais são simuladas no cliente. O histórico resumido de experiências usa o objeto local `experienceParticipations` dentro da participação atual.

## Testes automatizados

Os testes usam o test runner nativo do Node.js e não exigem dependências adicionais:

```powershell
npm.cmd test
```

Esse comando também deve ser executado dentro de `C:\DoJob\ProgramacaoMobile\app`.

A suíte cobre validações, cadastro e login, datas, questionário, entrada e confirmação de eventos, fila externa, seleção da Home, exclusividade de filas, chamadas, ausências, finalização e avaliação. O estado atual do projeto possui 86 testes passando.

## Limitações atuais

- Não existe backend, API ou autenticação real.
- Não há banco de dados, armazenamento local ou persistência de participação e avaliação.
- Eventos, experiências, posições e credenciais são mocks locais.
- As filas não são compartilhadas entre participantes e não há controle centralizado de capacidade ou ordem.
- Chamadas, confirmação do staff, ausência e desativação da fila são simulações locais.
- Não há comunicação em tempo real, notificações ou sincronização entre dispositivos.
- A opção “Avaliar mais tarde” não registra uma pendência recuperável.

## Próximos passos

Antes de transformar as simulações em funcionalidades de produção, será necessário definir o modelo de usuários, eventos, experiências, filas, participações e avaliações; estabelecer autenticação e autorização; escolher a persistência; e definir a sincronização das filas, chamadas e estados da Arena. A integração deve substituir gradualmente os mocks e estados locais por uma API, mantendo as regras de interface já cobertas pelos testes.
