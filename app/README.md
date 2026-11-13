# ArenaGo — Aplicativo

Aplicativo React Native/Expo para Participante, Staff e Admin. O cliente HTTP compartilhado consome a API NestJS/PostgreSQL sob `/api/v1`, com autenticação, renovação de sessão e erros Problem Details. A navegação é escolhida pela identidade confirmada; componentes demonstrativos remanescentes não devem ser usados como prova de integração real.

## Tecnologias

Versões declaradas em [package.json](package.json):

| Dependência | Versão |
| --- | --- |
| Expo | `~58.0.23` (SDK 58) |
| React Native / React / React DOM | `0.88.1` / `19.3.0` / `19.3.0` |
| React Navigation native / native-stack / bottom-tabs | `^7.4.1` / `^7.19.2` / `^7.19.2` |
| expo-secure-store / expo-camera / expo-crypto | `~58.0.2` / `~58.0.14` / `~58.0.7` |
| expo-splash-screen | `~58.0.13` |
| DateTimePicker | `9.2.1` |
| react-native-safe-area-context / react-native-screens | `~5.11.1` / `~4.30.1` |
| React Native Web | `^0.21.4` |

Use Node.js 24.15.0 ou superior para alinhar o ambiente ao backend e às campanhas documentadas. O manifest do app não declara `engines`. Expo Go precisa ser compatível com SDK 58; emuladores/simuladores e ferramentas nativas dependem da plataforma. O script iOS requer ambiente compatível, não um simulador iOS no Windows.

## Autenticação, sessão e navegação

- Cadastro real envia somente `{ name, email, password }` a `/auth/register`; a confirmação da senha é local. Valida nome de 2 a 150 caracteres, e-mail até 255 e senha de 8 a 128 caracteres. Cadastro cria sessão e direciona ao questionário.
- Login usa `/auth/login`, sem fallback demonstrativo. Após login, refresh ou restauração, `/auth/me` confirma identidade e papéis. Falhas de verificação bloqueiam a área protegida e oferecem recuperação/saída.
- O access token fica em memória. No Android/iOS, somente o refresh token é persistido no SecureStore; no web, ambos ficam em memória. `localStorage`, `sessionStorage` e AsyncStorage não são usados para guardar esses tokens.
- A renovação é coordenada em uma única requisição por vez. Uma resposta incerta de refresh não autoriza repetir automaticamente o token que pode já ter sido consumido. Logout limpa o acesso local e tenta revogar a sessão no backend; falha remota é informada, sem declarar revogação confirmada.
- A precedência é `admin > staff > participante`. Admin recebe somente `AdminArea`; Staff usa `StaffEventsNavigator` pela rota raiz interna `StaffPending`; Participante recebe questionário pendente ou `MainTabs` com Início, Eventos e Perfil. Papéis ausentes/inválidos vão para recuperação de identidade.
- Mudanças de conta, sessão e autorização invalidam respostas/callbacks antigos e descartam as telas anteriores. Parâmetros de navegação não concedem acesso. `AdminDemo`, `AdminPending` e atalhos administrativos não são oferecidos ao Participante.

O questionário incompleto direciona o Participante à sua conclusão; não altera o destino de Admin/Staff. A Home mantém um aviso para completar o questionário quando esse estado estiver presente. A recuperação automática de senha por e-mail ainda está indisponível; sua tela informa essa limitação e não simula envio.

## Participante: serviços reais e estado local

| Fluxo | Integração atual |
| --- | --- |
| Perfil e questionário | Leitura/edição de nome em `/profile`; três etapas em `/profile/questionnaire`; catálogo persistido em `/games`. Edição de e-mail/papéis não é oferecida como atualização cadastral. |
| Entrada no evento | Código manual ou conteúdo do QR é validado e consultado em `POST /events/lookup`. A confirmação cria participação em `POST /participations`, com chave de idempotência. Não há códigos especiais `FILA`/`LIVRE` com ingresso simulado nesse serviço. |
| Participação atual | `/participations/current` e `/participations/return-state` alimentam a Home; espera externa e Arena real são distinguidas pelo estado recebido do servidor. |
| Experiências e filas | `/events/:eventId/experiences`, consulta da própria fila, ingresso e retirada usam a API real. Resultado incerto preserva a intenção e impede novo ingresso indevido. |
| Histórico e detalhes | Aba Eventos usa `/participations/history`; detalhes e pendências vêm dos contratos de leitura, sem histórico fictício como fallback de erro. |
| Saída e avaliação | Saída confirmada por `/participations/:participationId/finish`; elegibilidade é reconsultada antes da nota de 1 a 5 e comentário opcional. Envio incerto é conferido por leitura, preservando a intenção. |
| Estatísticas | `/profile/statistics` fornece contagem de participações que entraram na Arena e minutos de participações finalizadas. A espera externa não soma tempo. |

O Perfil refaz a consulta de estatísticas ao ganhar foco, separada da carga de identidade/questionário. Mostra `—` durante carregamento/erro, oferece nova tentativa e descarta respostas de outro usuário, cliente ou geração de sessão. A duração é exibida em minutos/horas; os indicadores não são demonstrativos.

O leitor QR usa `expo-camera`, solicita permissão e valida texto de código; não abre URLs arbitrárias como destino de autenticação. Sua presença no código e testes simulados não comprovam operação física da câmera; consulte [ENTRY_QR_01](../docs/ENTRY_QR_01_IMPLEMENTACAO.md).

Formulários, navegação e seleções são estado local de interface. Componentes antigos de Arena/avaliação, `mockData` e o suporte a participação `source: 'demo'` continuam no repositório, separados da participação `source: 'server'`. Não devem receber dados reais por substituição silenciosa nem ser confundidos com a jornada persistida. Consulte [finalização e avaliação](../docs/EXPO_PARTICIPACAO_FINALIZACAO_AVALIACAO_IMPLEMENTACAO.md).

## Staff autenticado

A lista consulta `/staff/events` e mostra somente eventos autorizados pelo servidor. A seleção real conduz ao painel, experiências e estações daquele evento; IDs recebidos por rota não substituem a seleção e a autorização. A fase operacional é apresentada separadamente do status persistido.

O Controle de Entrada consulta a fila nominal, chama o próximo, confirma entrada, registra ausência/remoção e permite controlar a fila externa conforme o contrato. Chamadas externas são persistidas por `callId`, permitindo consultar o chamado ao voltar à tela. A estação consulta a fila compartilhada da experiência e seu atendimento pendente; chamada, conclusão, ausência e remoção usam operações reais com confirmação e chaves de idempotência.

Há carregamento, erro, atualização manual e indisponibilidade por sessão, concessão, estado do evento ou armazenamento. O polling operacional consulta leituras a cada 5 segundos; a lista/fase dos eventos é atualizada a cada 60 segundos. Os ciclos dependem de foco, visibilidade, primeiro plano e sessão corrente. Não há sincronização em tempo real nem repetição automática de mutações pelo polling.

Intenções e recibos são separados por conta, sessão, evento e operação. Respostas de outra identidade não atualizam a tela. Uma intenção `dispatching` com resultado desconhecido continua bloqueada até reconciliação confiável; estado atual da fila não prova o resultado de uma ação passada. O armazenamento é serializado no runtime, sem garantir exclusão entre aparelhos. A versão web não oferece a mesma persistência segura necessária às reservas operacionais Staff.

Há homologações funcionais delimitadas de Controle de Entrada, estações e polling no Expo Go, descritas em [Staff 02](../docs/STAFF_ENTRY_CALL_FLOW_IMPLEMENTACAO.md), [estação operacional](../docs/STAFF_STATION_OPERATIONAL_IMPLEMENTACAO.md) e [Staff B1](../docs/STAFF_B1_IMPLEMENTACAO.md). Elas não certificam todos os fluxos, recuperação de falhas, concorrência física ou uso operacional geral.

## Admin: acesso real, painel demonstrativo

O login de Admin exige senha e, quando recebido o desafio, TOTP pelo endpoint `/auth/2fa/verify`. O token temporário fica privado no gerenciador: não é access token, não é persistido como refresh token e não concede sessão antes da verificação. A interface oferece TOTP numérico; o contrato do gerenciador também reconhece o formato de código de recuperação suportado pelo backend.

Após o segundo fator, `/auth/me` confirma a identidade. `canAccessAdminArea` exige autenticação concluída, sessão `authenticated`, identidade `verified`, usuário e sessão identificados, papel Admin conhecido, ausência de desafio pendente e confirmação pelo getter vivo. Somente então a raiz oferece `AdminArea`. Participante/Staff não recebem essa rota; Admin não recebe suas pilhas. Restauração de sessão já verificada usa refresh e identidade, sem exigir novo TOTP arbitrariamente no cliente.

`AdminArea` reutiliza as 14 telas Heliom: Painel, Eventos, Criar Evento, Detalhe, Horários, Fila Externa, Encerramento, Experiências, Experiência, Estação, Staff do Evento, Histórico, BI do Evento e Visão Geral. **As operações internas são demonstrativas, em memória e sem persistência administrativa real.** Criar eventos, alterar horários, atribuir Staff e consultar BI nessas telas não altera o backend, mesmo que existam endpoints administrativos correspondentes.

O logout é real e descarta os mocks. Conta, `sessionId`, geração e revisão da identidade definem o proprietário do estado; troca de conta, perda de papel, identidade não confirmada e refresh descartam a demonstração e invalidam callbacks antigos. A Home do Participante não oferece o botão “Área Admin (demonstração)”. Veja [ADMIN_AUTHENTICATED_NAVIGATION](../docs/ADMIN_AUTHENTICATED_NAVIGATION_IMPLEMENTACAO.md).

Uma conta Admin sem TOTP configurado recebe orientação e permanece sem acesso. A ativação exige procedimento administrativo autorizado e `activationToken`, além do desafio de login. O aplicativo não faz bootstrap nem resolve o onboarding geral de Admins promovidos. Não copie segredos TOTP entre computadores; use o ambiente autorizado descrito no [README do backend](../backend/README.md).

## Instalação e Expo Go

A partir da raiz do clone, no PowerShell:

```powershell
Set-Location app
npm.cmd ci
```

Prepare o backend e o PostgreSQL local conforme [backend/README.md](../backend/README.md). Em `app/.env.local` (ignorado pelo Git), configure somente a origem pública da API. [config/apiConfig.js](config/apiConfig.js) aceita `EXPO_PUBLIC_API_BASE_URL` e o alias legado `EXPO_PUBLIC_API_URL`, acrescentando `/api/v1` quando omitido.

Sem configuração, o cliente usa `http://127.0.0.1:3000/api/v1`, adequado somente ao mesmo host. Há um modelo público em [.env.example](.env.example).

| Destino | URL de desenvolvimento |
| --- | --- |
| Navegador/simulador no mesmo host | `http://127.0.0.1:3000` |
| Emulador Android AVD | `http://10.0.2.2:3000` |
| Celular físico na mesma rede | IP LAN do computador; substitua o endereço ilustrativo abaixo pelo seu |

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.100:3000
```

O endereço acima é apenas um exemplo. No celular, `localhost`/`127.0.0.1` aponta para o aparelho. Computador e dispositivo precisam compartilhar uma rede que permita comunicação; VPN, isolamento do Wi-Fi e firewall podem bloquear o acesso. O backend deve escutar na interface LAN ou em `0.0.0.0` (`API_BIND_HOST`) e sua porta deve estar acessível. O servidor Expo e a API são serviços distintos: ler o QR do Expo não garante conectividade com a API.

Inicie o aplicativo nesta pasta e abra o projeto no Expo Go compatível:

```powershell
npm.cmd start
```

Outros scripts disponíveis:

```powershell
npm.cmd run android
npm.cmd run ios
npm.cmd run web
```

Após trocar a URL, reinicie o Expo e recarregue o aplicativo. Confira bind/porta e a rede se houver erro de conexão; confira relógio do autenticador e configuração do ambiente se o TOTP falhar. Falhas de API não devem ser contornadas habilitando demonstrações. Nunca coloque senhas, tokens, JWT ou chaves TOTP em `EXPO_PUBLIC_*`: essas variáveis entram no aplicativo distribuído. HTTPS é necessário para ambientes externos de produção; HTTP LAN serve ao desenvolvimento local.

## Testes e evidências

O runner é o nativo do Node.js. Execute em `app/`, após inspecionar os scripts e selecionar o executor conforme as instruções do repositório:

```powershell
$env:NODE_ENV = 'test'
npm.cmd test
```

O script chama `node --test tests/*.test.cjs`. Para os casos de integração simulada de navegação, instale também as dependências já declaradas em [qa/regression/package.json](../qa/regression/package.json), a partir da raiz do clone:

```powershell
npm.cmd --prefix qa/regression ci
```

Esses casos procuram React Navigation e `react-test-renderer` no pacote QA; sem eles, podem ser ignorados. Registre skips e motivos e não trate uma execução incompleta como validação integral. Os testes frontend simulam transporte/armazenamento; não exigem iniciar PostgreSQL ou backend real. Não há script de lint ou typecheck no manifest do app.

O último resultado informado pelo responsável para a integração Perfil + Admin foi **755 aprovados, 0 falhos e 0 ignorados**, exit code 0. Não é uma nova execução desta atualização documental. O responsável confirmou manualmente login Admin com TOTP e redirecionamento ao painel Heliom no Expo Go. O [Perfil](../docs/PROFILE_REAL_STATISTICS_IMPLEMENTACAO.md) registra homologação de conta sem participação e de histórico com contagem/tempo positivos. Esses relatos não aprovam todos os casos SQL nem toda a aplicação em dispositivo físico.

## Organização e limites

```text
App.js          Navegação raiz e provedores
config/         URL base e configuração do cliente
services/       HTTP, autenticação, participação, filas e intenções Staff
context/        Sessão, autorização e estado da participação
navigation/     Abas do Participante
screens/        auth, home, profile, event-entry, arena, participation, staff e admin
components/     Componentes compartilhados e design system
data/           Dados de demonstração
utils/          Validações e formatação
tests/          Suíte automatizada e harnesses
```

Pendências relevantes: persistência do painel Admin, onboarding TOTP além do primeiro Admin, recuperação de senha, reconciliação de operações incertas, validação física de câmera/concorrência e infraestrutura de produção. A implementação e as homologações delimitadas não representam prontidão para produção.
