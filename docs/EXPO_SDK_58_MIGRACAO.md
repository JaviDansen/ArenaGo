# Migração do aplicativo ArenaGo para Expo SDK 58

## Base e escopo

- Branch: `feature/events-participations`.
- HEAD inicial: `51d9605a798e0bd050095c4c1145ea1e10d502ab` (árvore e índice limpos).
- Ambiente local: Node.js 24.15.0, npm 11.12.1. O [SDK 58 exige Node 24.3 ou superior na linha 24](https://expo.dev/changelog/sdk-58).
- Alterações restritas a dependências e configuração Expo em `app/`, atualização do README do app e este relatório. Nenhum código do backend, fluxo de autenticação, sessão, perfil, questionário, tela, mock ou arquivo `AGENTS.md` foi alterado. A branch `feature/participant-ui` não foi incorporada.

## Dependências principais

| Pacote | Antes | Depois |
| --- | --- | --- |
| `expo` | `~57.0.25` | `~58.0.23` |
| `react` e `react-dom` | `19.2.3` | `19.3.0` |
| `react-native` | `0.86.3` | `0.88.1` |
| `react-native-web` | `^0.21.0` | `^0.21.4` |
| `expo-secure-store` | `~57.0.4` | `~58.0.2` |
| `expo-splash-screen` | `~57.0.10` | `~58.0.13` |
| `expo-status-bar` | `~57.0.1` | `~58.0.4` |
| `@react-native-community/datetimepicker` | `9.1.0` | `9.2.1` |
| `react-native-safe-area-context` | `~5.7.0` | `~5.11.1` |
| `react-native-screens` | `~4.26.0` | `~4.30.1` |

React Navigation 7 permaneceu nas versões declaradas. O alinhamento com `expo install --fix` atualizou `app/package.json` e `app/package-lock.json` e acrescentou o plugin `expo-status-bar` em `app/app.json`. Não foram usados `--force`, `--legacy-peer-deps`, versões beta ou canary. As versões finais seguem a [matriz oficial do SDK 58](https://docs.expo.dev/versions/latest/) e o verificador local do Expo.

## Compatibilidade

- A auditoria estática não encontrou uso das APIs removidas pelo React Native 0.88 (`InteractionManager`, export raiz `Touchable`, prop `Modal.animated` ou imports profundos `react-native/Libraries/*`). O app usa `expo-status-bar`, sem as props removidas do `StatusBar` de React Native. Não há `ios/` ou `android/` versionados nem configuração de Expo Router. Ver [breaking changes do SDK 58](https://expo.dev/changelog/sdk-58).
- As versões instaladas de [`expo-secure-store`](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/), [`@react-native-community/datetimepicker`](https://docs.expo.dev/versions/v58.0.0/sdk/date-time-picker/), [`react-native-safe-area-context`](https://docs.expo.dev/versions/v58.0.0/sdk/safe-area-context/) e [`react-native-screens`](https://docs.expo.dev/versions/v58.0.0/sdk/screens/) constam como incluídas no Expo Go. O seletor de data existente usa `DateTimePickerAndroid.open()`, por isso foi mantido o pacote community compatível, sem substituí-lo por `@expo/ui`.
- A prévia de splash screen no Expo Go não representa fielmente o splash de um build próprio. Nenhuma dependência direta identificada exige development build para os fluxos atuais; a execução nativa no iPhone ainda precisa de validação manual.
- O app é JavaScript e não possui `tsconfig.json` ou script de typecheck; essa verificação não se aplica.

## Comandos e resultados locais

| Comando em `app/` | Resultado |
| --- | --- |
| `npm.cmd install expo@^58.0.0 --ignore-scripts --no-audit --no-fund --fetch-retries=0` | Exit code 0; instalação inicial do SDK 58. |
| `expo.cmd install --fix --npm` com lifecycle scripts desabilitados | Exit code 0; versões recomendadas alinhadas. |
| `expo.cmd install --check` | Exit code 0; dependências atualizadas. |
| `npx.cmd --yes expo-doctor@latest` | Exit code 0; 20/20 verificações aprovadas. |
| `npm.cmd test` | Exit code 0; 208/208 testes aprovados, sem falhas, cancelamentos ou skips. |
| `expo.cmd export --platform ios --output-dir <diretório temporário>` com `EXPO_OFFLINE=1` | Exit code 0; bundle iOS concluído, 919 módulos. Arquivos temporários removidos. |

Nenhum teste PostgreSQL, SQL, migration, seed, build nativo ou teste no iPhone foi executado nesta tarefa.

## Teste manual no iPhone com Expo Go 58

1. No `app/.env.local` (ignorado pelo Git), configure apenas `EXPO_PUBLIC_API_BASE_URL=http://<IP-LAN-DO-PC>:3000`. Não use `localhost` nem inclua credenciais: variáveis `EXPO_PUBLIC_*` ficam visíveis no bundle.
2. Inicie o backend local já configurado pelo responsável, com o PostgreSQL de desenvolvimento disponível. No terminal do backend, defina `$env:API_BIND_HOST = '0.0.0.0'` e execute `npm.cmd run start:dev`. Garanta que a porta 3000 esteja acessível na rede local.
3. Em outro terminal, dentro de `app/`, execute `npm.cmd start`. Conecte iPhone e computador à mesma rede, abra o projeto no Expo Go 58.0.5 pelo QR code e recarregue completamente após mudanças na URL.
4. Verifique abertura das telas, cadastro, login, restauração após reiniciar o app, perfil/questionário e logout. Confira erros de rede ou versão no console do Metro. O teste físico ainda não foi informado como concluído.

## Pendências

- Validar a execução e a conexão real com o iPhone informado pelo responsável. O export Metro e o Expo Doctor não substituem essa prova.
- A integração da interface visual e dos demais fluxos locais permanece para tarefas futuras.
- O `AGENTS.md` da raiz ainda contém uma seção de execução referente à sua própria atualização pontual e uma restrição de executor de validações. Nenhuma instrução foi editada nesta migração; o pedido atual autorizou explicitamente as validações locais acima.
