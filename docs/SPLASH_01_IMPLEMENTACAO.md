# SPLASH-01 — Inicialização visual ArenaGO

## Objetivo e identidade visual

A SPLASH-01 apresenta a identidade ArenaGO durante a inicialização do aplicativo e faz a transição para a área definida pela autenticação. O ajuste visual final define o fundo `#1C0A35` na Splash nativa, na animação, no contêiner da transição e na interface de restauração ou recuperação de sessão. A cor global do Design System permanece independente.

A configuração nativa do plugin `expo-splash-screen` usa `app/assets/splash-icon.png`, com `resizeMode: contain` e o mesmo fundo nos modos normal e escuro. A Splash animada usa a logo oficial `app/assets/images/logo-arenago.png`, com fallback para `splash-icon.png`. Os assets PNG não foram alterados neste ajuste.

## Arquitetura e comportamento

`app/index.js` solicita a retenção da Splash nativa antes da montagem da árvore. `SplashScreenGate` envolve `AuthSessionGate` e a navegação. `AnimatedSplashScreen` oculta a Splash nativa após a preparação do layout, com timeout defensivo, e apresenta a logo centralizada com zoom suave.

A animação padrão usa fade-in de 700 ms, permanência de 1.500 ms e fade-out de 300 ms, com duração-alvo de 2.500 ms. A revelação da tela de destino é sincronizada com a saída por cross-fade; a camada de sobreposição permanece transparente. Se a autenticação demorar, há limites de espera e segurança, portanto o tempo observado pode diferir do alvo. O estado de conclusão impede a reapresentação da Splash em navegações posteriores no mesmo processo. A árvore de autenticação é preservada durante a transição.

## Arquivos deste ajuste final

- `app/app.json`: fundo nativo normal e escuro.
- `app/screens/splash/AnimatedSplashScreen.js` e `app/screens/splash/SplashScreenGate.js`: fundo animado e raiz da transição.
- `app/screens/auth/AuthSessionGate.js`: fundo das interfaces de restauração e recuperação de sessão.
- `app/tests/splashScreen.test.cjs`: expectativas da cor e verificações da raiz, transparência, restauração e recuperação.
- Este relatório e `qa-evidence/SPLASH-01-changes.diff`.

A evidência é o patch deste ajuste final sobre o `HEAD` existente na branch, que já contém a implementação inicial da Splash. Não inclui o próprio arquivo de evidência.

## Validação e pendências

O responsável informou que a Splash foi testada no iOS antes deste ajuste: logo centralizada, animação e transição funcionaram conforme o esperado. Esse relato não comprova a nova cor, que ainda precisa ser conferida após a alteração.

Não há evidência de homologação Android identificada nesta tarefa. A aparência da Splash nativa e a nova cor devem ser conferidas em builds apropriadas de iOS e Android; a prévia no Expo Go não representa necessariamente a Splash de um build próprio. Verificar também a transição para autenticação lenta e para a tela de recuperação.

Testes automatizados, build e typecheck não foram executados nesta etapa. Para Luna Medium, após inspecionar o ambiente e os scripts, executar em `app` com `NODE_ENV=test`:

```text
node --test tests/splashScreen.test.cjs
```

Executar depois a regressão do aplicativo conforme a política do projeto e registrar aprovações, falhas e testes ignorados separadamente. A inspeção estática deste ajuste conferiu que as cores configuradas coincidem e que a sobreposição conserva `transparent`.
