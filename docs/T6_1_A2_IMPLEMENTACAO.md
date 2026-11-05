# T6.1-A2 — endpoints HTTP e entrega de confirmação por Resend

## Base e escopo

Base registrada: branch `feature/events-participations`, HEAD `a5835a1b98e94c7a931ba4fd10047d5b255c6b35`; índice e working tree limpos antes da task. A T6.1-A1 existente foi consultada. Seu `EmailVerificationService.issue(userId)` e `confirm(token)`, schema, transações, hash, TTL de 24 horas, cooldown de 120 segundos e máximo de cinco emissões por hora permanecem sem alterações.

O escopo é a borda HTTP, configuração/envio Resend e testes. Nenhuma fila, outbox, webhook, worker, migration, dependência nova, alteração Expo ou página pública foi criada.

## Contrato HTTP

Prefixo global existente: `/api/v1`.

| Rota | Autenticação | Contrato |
| --- | --- | --- |
| `POST /api/v1/auth/verify-email/request` | Bearer e sessão atual obrigatórios | Body opcional estrito vazio; identidade vem exclusivamente de `@CurrentUser`. Responde `202` com mensagem genérica para emissão aceita, conta indisponível/verificada, cooldown ou limite. |
| `POST /api/v1/auth/verify-email/confirm` | Pública | Body estrito `{ "token": "..." }`; resultado `{ "verified": true/false }`. Nunca cria sessão nem altera papéis. |

Falha de configuração ou entrega retorna Problem Details `503 EMAIL_DELIVERY_UNAVAILABLE`, sem detalhes do provedor. Como A1 já comitou a emissão antes do envio, o erro não desfaz o token. A nova chamada não consegue recuperar o token anterior e fica sujeita ao cooldown. Contas não elegíveis e limites não revelam estado na resposta pública. Token inválido, expirado, usado ou inexistente compartilham `verified: false`.

## Resend e configuração

Implementação via `fetch` HTTPS para `POST https://api.resend.com/emails`; não foi adicionada SDK. Transporte é injetável e pode ser substituído por fake em testes. Payload contém remetente, destinatário, assunto e versões texto/HTML em português. Inclui chave `Idempotency-Key` SHA-256 derivada do token, sem expor o token na chave. Nenhuma repetição automática ocorre: timeout pode ter resultado incerto, e A1 não retém token bruto para retry. Nova solicitação cria novo token apenas depois dos limites permitirem.

Variáveis:

- `RESEND_API_KEY`: chave privada do backend.
- `RESEND_FROM`: remetente; padrão `onboarding@resend.dev`.
- `RESEND_TEST_RECIPIENT`: obrigatório no modo `onboarding@resend.dev`; somente esse endereço recebe a mensagem de teste.
- `EMAIL_VERIFICATION_CONFIRMATION_URL`: URL-base absoluta explicitamente configurada, HTTPS obrigatório, exceto HTTP em localhost. Não aceita credenciais, query ou fragmento. Token é adicionado como parâmetro `token`.

Com configuração ausente, o backend inicia sem habilitar envio e a rota responde indisponível antes de emitir token. Configuração parcial ou inválida causa erro de inicialização. Nenhuma chave ou token é registrado pela integração.

O remetente Resend de teste é restrito pela aplicação ao destinatário configurado; configure `RESEND_TEST_RECIPIENT` com o e-mail da própria conta Resend, conforme a restrição do remetente de onboarding. A Resend também disponibiliza endereços reservados como `delivered@resend.dev` para simulação. O envio não é ativado para destinatários gerais por `onboarding@resend.dev`; para isso será necessário domínio validado na Resend, remetente correspondente em `RESEND_FROM` e chave de API do backend. Não há compra de domínio/plano ou infraestrutura de produção exigida nesta task. Referências oficiais: [API de e-mail e modo de teste](https://resend.com/features/email-api), [chaves de idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Link, privacidade e dependências futuras

O link aponta para `EMAIL_VERIFICATION_CONFIRMATION_URL` e inclui o token opaco como query parameter. Ele não é derivado de `Host`/`Origin`. **O fluxo do usuário final ainda não é funcional ponta a ponta:** esta etapa não hospeda página pública HTTPS que receba o token e peça confirmação explícita via POST ao endpoint da API.

A futura página deve evitar analytics e recursos de terceiros, usar `Referrer-Policy: no-referrer`, não registrar a URL/token em access logs, remover o token do histórico após capturá-lo e só então enviar POST explícito `{token}`. Até essa página e seu domínio HTTPS existirem, o destino configurado pode ser apenas local/de demonstração e o usuário não deve ser informado de que o link já confirma por si só. GET/pré-visualização de link nunca consome token.

## Escopo funcional local e limites externos

Com configuração válida, o backend pode emitir token no PostgreSQL, enviar mensagem via Resend e aceitar POST de confirmação. Para testar sem mensagens reais, testes usam transporte simulado. Com `onboarding@resend.dev`, o destinatário está limitado ao `RESEND_TEST_RECIPIENT` configurado; a conta Resend/chave ainda precisam existir para chamadas reais. A confirmação de usuário por e-mail depende da página HTTPS acima. Envio para endereços de usuários em geral depende de domínio remetente verificado e das regras/cotas vigentes do plano Resend. Nenhum comportamento de entrega é tratado como garantia de recebimento.

## Testes preparados e validação pendente

A revisão confirmou que o construtor seguia parcialmente o padrão de DI explícita da A1; agora os dois parâmetros usam `@Inject(...)`. Criados `backend/test/unit/email-verification-mailer.test.ts` e `backend/test/unit/email-verification-http.test.ts`. A cobertura adicional verifica resolução de `EmailVerificationHttpService` real pelo Nest com as dependências injetadas, respostas genéricas para conta já verificada/cooldown/limite, configuração ausente sem emissão, respostas Resend não 2xx e sem ID, timeout/falha de rede convertidos em 503 sem dados sensíveis e envio do cabeçalho `Idempotency-Key`. O `fetch` é simulado; nenhum teste envia e-mail. `backend/test/integration/email-verification-http.integration.test.ts` cobre as rotas com PostgreSQL e entrega simulada.

Comandos PowerShell para o responsável executar manualmente:

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
Set-Location C:\Users\Débora Jansen\Desktop\Davi\ArenaGo\backend
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/email-verification-mailer.test.ts test/unit/email-verification-http.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Testes HTTP/e-mail falharam.' }
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck de testes falhou.' }
npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }
# Integração HTTP + PostgreSQL; requer as três URLs de teste idênticas e autorizadas
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/email-verification-http.integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Integração HTTP/PostgreSQL falhou.' }
# A integração exige DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL configuradas localmente
```

Testes, typecheck, lint e build não executados pelo Codex. Validação manual pendente do responsável.

## Arquivos e evidência

Alterações da implementação: `backend/src/auth/auth.controller.ts`, `backend/src/auth/auth.module.ts`, `backend/src/auth/email-verification.dto.ts`, `backend/src/auth/email-verification-http.service.ts`, `backend/src/auth/email-verification-mailer.ts`, `backend/src/auth/email-verification.types.ts`, `backend/test/unit/email-verification-http.test.ts`, `backend/test/unit/email-verification-mailer.test.ts`, `backend/test/integration/email-verification-http.integration.test.ts` e este relatório.

Evidência única: `qa-evidence/t6-1-a2-changes.diff`, baseada no HEAD registrado, sem alterações alheias e sem incluir a si própria. Aprovação técnica depende das validações manuais acima.
