# Vínculo estável de sessão autenticada

## Contrato e segurança

`GET /api/v1/auth/me` conserva os campos públicos existentes e acrescenta `sessionId`, UUID da sessão obtida do principal autenticado pelo guard. A resposta usa `Cache-Control: no-store` e `Pragma: no-cache`. Um parâmetro do cliente não escolhe a sessão. O UUID não é credencial: todas as consultas continuam exigindo Bearer válido, e Admin continua sujeito ao TOTP. Como identificador persistente da sessão, deve ser tratado como dado de correlação e não registrado desnecessariamente.

O backend cria o UUID ao abrir uma sessão; a rotação usa o ID da mesma sessão para emitir o novo access token. Um novo login cria outra sessão. Não há alteração no schema, nos contratos de login ou refresh, nem no mecanismo de revogação.

## Aplicativo

O cadastro, login e confirmação TOTP preservam os tokens e consultam `/auth/me` antes de publicar a identidade autenticada. A resposta deve conter `sessionId` UUID válido e a conta esperada. Uma revalidação da mesma geração não aceita outro identificador; falhas de rede ou de contrato abrem recuperação de identidade sem inferir autorização. O refresh revalida `/me`; após reinício, o vínculo vem da resposta autenticada, nunca de valor local. Logout, revogação e troca de conta invalidam as gerações existentes e removem a identidade da memória. `sessionEpoch`, geração de requisição e `identityRevision` continuam protegendo respostas atrasadas; mudança de vínculo também altera a revisão de identidade.

`AuthContext` expõe `sessionId` somente enquanto a identidade está verificada. Um futuro coordenador Staff deverá combinar conta, sessão, revisão, evento, estação e atendimento em `isCurrent`. Esta entrega não conecta operações, remove intenções, reconhece recibos nem substitui a reconciliação histórica ou a política de retenção. Os botões Staff permanecem desabilitados.

## Arquivos e validação

- Backend: `auth.types.ts`, `auth.controller.ts`, `auth.service.ts` e `backend/test/unit/auth-stable-session-http.test.ts`.
- App: `authService.js`, `AuthContext.js`, testes de autenticação, questionário e integração de navegação.
- Evidência: `qa-evidence/AUTH_STABLE_SESSION_BINDING-changes.diff`.

Foram preparados testes com transporte e armazenamento simulados para vínculo no login, refresh, restauração, mudança da mesma conta, logout, UUID ausente ou inválido e publicação somente após `/me`. O teste HTTP simulado cobre campo derivado do principal, resposta mínima, cabeçalho `no-store`, ausência de Bearer e sessão rejeitada. Os testes existentes cobrem TOTP, revogação, corridas, conta e navegação e tiveram fixtures ajustadas.

### Revisão de segurança e testes automatizados

A revisão estática realizada por Sol High não identificou problemas P0–P2. Na validação posterior executada por Luna Medium, a suíte unitária do backend registrou **1.154 testes aprovados, 0 falhos e 0 ignorados**; a suíte do aplicativo registrou **475 aprovados, 0 falhos e 0 ignorados**. Os typechecks de produção e de testes, a compilação temporária isolada e `git diff --check` foram aprovados. A compilação temporária permitiu executar os testes do backend com Node após a falha de inicialização do `tsx` associada a `uv_os_get_passwd` / `ENOMEM`. Nenhum teste PostgreSQL de integração foi executado nessa campanha.

Permanecem três lacunas P3 de cobertura automatizada:

1. Falta comparar o identificador nos fluxos reais de login, refresh, novo login e TOTP do backend com persistência simulada. O teste HTTP utiliza principal fixo e não comprova sozinho esse ciclo.
2. Faltam cenários completos de falha de rede, HTTP 500 e 401 em `/auth/me` após login, seguidos de recuperação e envolvendo a desmontagem da `LoginScreen` real.
3. Falta exercitar um `sessionId` divergente durante refresh após a rotação dos tokens e verificar a preservação do refresh token recém-gravado.

### Homologação HTTP real

Conforme os resultados informados pelo responsável, o runner HTTP utilizou o ambiente Neon `dev-shared` e limitou suas operações às necessárias para autenticação e consulta da sessão. `/auth/me` sem Bearer retornou 401. O login Staff retornou 200 e `/auth/me` retornou 200, UUID válido e `no-store`. O identificador permaneceu igual após dois refreshes. O logout retornou 200 e a tentativa subsequente com o token revogado retornou 401. Um novo login apresentou identificador diferente e a segunda sessão foi encerrada corretamente. Nenhum identificador, token ou credencial real é registrado neste relatório.

### Homologação visual no Expo Go

Conforme informado pelo responsável, o login Staff foi realizado, o aplicativo foi fechado completamente e reaberto, a sessão foi restaurada sem novo login e a primeira tela Staff foi apresentada. O logout retornou à autenticação. Essa verificação visual demonstra o comportamento observado do aplicativo; a comparação dos identificadores foi realizada na homologação HTTP.

As suítes não foram executadas novamente durante o fechamento documental. Os testes simulados não substituem a homologação real nem demonstram concorrência entre dispositivos.

A evidência reproduz literalmente as fixtures dos testes, incluindo UUIDs, senhas e tokens fictícios. Esses valores não são dados da homologação; mantê-los no patch preserva a correspondência com os arquivos de teste.

O backend deve ser implantado antes do aplicativo: versões antigas de `/auth/me` sem `sessionId` serão tratadas como erro de identidade, sem concessão de acesso. As dependências de sessão estável no fluxo operacional, reconciliação histórica, retenção de idempotência e identificação presencial continuam pendentes.
