# ArenaGo — Frontend

Este diretório contém o aplicativo mobile do ArenaGo, desenvolvido com React Native e Expo. Hoje ele demonstra o fluxo do participante com dados locais; cadastro, login e operações da Arena ainda não chamam uma API.

## Estado atual

- O cadastro valida os campos no cliente e segue para o questionário de perfil. Não cria uma conta no backend.
- O login valida e-mail e senha localmente e permite avançar para o aplicativo; não autentica um usuário.
- O questionário apresenta três etapas: dados pessoais, jogos e informações sobre o mercado de games.
- A entrada manual aceita os códigos de demonstração `FILA` e `LIVRE`, sem diferenciar maiúsculas de minúsculas. `FILA` inicia uma espera simulada na fila externa; `LIVRE` entra diretamente na Arena.
- Na Arena, o fluxo local simula filas de experiências, chamada, ausência, confirmação de atendimento e saída.
- A avaliação permite selecionar de uma a cinco estrelas e escrever um comentário opcional. O resultado não é persistido.

## Tecnologias

Versões declaradas em `package.json`:

- Expo ~57.0.25, React Native 0.86.3 e React 19.2.3.
- React Navigation 7 para abas e navegação em pilha.
- `@react-native-community/datetimepicker` 9.1.0 para seleção de data.
- React Native Web 0.21.x para execução no navegador.

## Pré-requisitos

- Node.js e npm instalados.
- Expo Go em um dispositivo compatível ou um emulador configurado.
- Para usar o modo web, um navegador compatível.
- Para executar o alvo iOS em emulador, um ambiente Apple compatível; em outros ambientes, use um dispositivo com Expo Go quando disponível.

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

Na validação mais recente deste README, o comando passou com **95 testes aprovados** e nenhum teste falhou.

## Organização

```text
app/
├── App.js                  # Navegação raiz e provider de participação
├── navigation/             # Abas principais
├── context/                # Estado atual da participação
├── screens/                # Autenticação, questionário, eventos e Arena
├── components/             # Componentes reutilizáveis
├── data/mockData.js        # Eventos, experiências, jogos e histórico simulados
├── utils/                  # Validações e regras de datas/participação
└── tests/                  # Testes automatizados
```

## Navegação e fluxos atuais

### Início

A aba Início renderiza o fluxo da Home conforme a participação mantida em `ParticipationContext`:

1. Sem participação, mostra a Home e permite informar um código de evento.
2. Uma participação `waiting` mostra a fila externa simulada, com posição local e ações de liberação ou saída.
3. Uma participação `active` mostra as experiências, suas filas simuladas e ações de chamada, ausência e confirmação de atendimento.
4. Ao sair da Arena, o fluxo abre a avaliação. Enviar ou escolher “Avaliar mais tarde” retorna à Home.

O formulário de cadastro verifica nome não vazio, formato do e-mail, senha com pelo menos seis caracteres e confirmação igual. O formulário de login verifica formato do e-mail e senha não vazia; essas verificações não confirmam credenciais com um servidor. O questionário de perfil é uma tela própria e não corresponde à aba Perfil.

### Eventos

`EventsScreen` exibe uma lista local de participações de exemplo, definida em `mockParticipations` dentro de `data/mockData.js`. Os cartões mostram evento, data, permanência quando há horários de entrada e saída registrados, experiências e avaliação disponível no mock. A lista não é carregada de uma conta ou API.

### Perfil

`ProfileScreen` atualmente exibe apenas o rótulo “Perfil”. A aba ainda não tem visualização ou edição de perfil.

## Dados e estado local

`data/mockData.js` contém os eventos de demonstração `FILA` e `LIVRE`, experiências, sugestões de jogos e histórico de participações. `ParticipationContext` guarda uma única participação em estado React (`useState`), sem persistência local: recarregar ou encerrar o aplicativo não restaura o estado. Chamadas da fila, posição, atendimento e avaliação são simulações do frontend.

## Limitações e integração com o backend

O repositório também contém uma fundação de backend NestJS/Drizzle/PostgreSQL, descrita em [`../backend/README.md`](../backend/README.md). Ela ainda não expõe endpoints funcionais de domínio, e este frontend não contém chamadas para essa API. Dados de cadastro, login, eventos, filas, experiências, histórico e avaliações não são sincronizados entre dispositivos nem persistidos no servidor. A integração deverá substituir gradualmente os mocks e o estado local quando os contratos e endpoints forem implementados.
