# PROFILE_REAL_STATISTICS

## Implementação

O Perfil consulta `GET /api/v1/profile/statistics`, autenticado pela sessão existente. O controlador recebe o identificador exclusivamente de `CurrentUserId`; a consulta é de leitura, parametrizada por usuário e não recebe identificadores do cliente. Resposta: `{ "participationCount": number, "totalMinutes": number }`.

`participationCount` conta cada linha de participação com `arena_entered_at` preenchido, inclusive ativa ou cancelada que já entrou. A fila externa sem entrada confirmada não conta. `totalMinutes` soma a duração de participações `finished` com ambos os instantes finitos e fim não anterior à entrada. A soma dos segundos é dividida por 60 e arredondada para baixo uma única vez; valores ausentes geram zero. O intervalo começa na entrada na Arena, sem incluir espera externa.

O Perfil atualiza as estatísticas ao ganhar foco, separadamente da identidade e do questionário. Durante carregamento ou erro mostra `—`; erro oferece nova tentativa. Resultados são associados ao usuário, cliente e geração de sessão e descartados ao trocar contexto, perder foco ou desmontar. A apresentação usa minutos e horas, sem indicador demonstrativo.

## Validação preparada

- Backend: `test/unit/profile-statistics.unit.test.ts`, com verificação do parâmetro autenticado, estrutura da consulta e cenários simulados de estados e tempos.
- Aplicativo: `tests/profile.test.cjs` e `tests/profileEditing.test.cjs`, cobrindo apresentação, recuperação, foco e isolamento de sessão, além da edição existente.
- Executar os testes direcionados e os typechecks do backend com Luna Medium, em ambiente isolado, após inspecionar os scripts. Testes, lint, build e typechecks não foram executados nesta implementação.

Os testes backend simulam a resposta do banco: eles não executam a agregação no PostgreSQL. Uma campanha física em banco dedicado, autorizada separadamente, é necessária para confirmar a semântica SQL com timestamps reais e infinitos. Nenhuma migration é necessária.

## Homologação funcional no Expo Go

1. **Conta sem participações — aprovado:** o Perfil apresentou 0 participações e 0min; os indicadores demonstrativos anteriores foram removidos.
2. **Conta com histórico — aprovado:** o histórico mostrou duas participações com permanências de 5min e 36min. O Perfil apresentou 2 participações e 41min, coerentes com o histórico observado.
3. **Atalho Admin — aprovado:** a remoção do botão “Área Admin (demonstração)” da Home foi confirmada visualmente. A rota AdminDemo permanece no projeto.

Não houve campanha SQL independente executando diretamente a agregação no PostgreSQL. A observação de valores positivos fornece evidência funcional, mas não comprova todos os casos possíveis da consulta. O problema de autenticação Admin/TOTP será investigado separadamente e não integra esta task.

## Campanhas automatizadas

Na validação automatizada anterior ao ajuste da Home, passaram 113 testes focados do aplicativo, 17 testes backend pelo fallback Node e 745 testes na regressão do aplicativo; os dois typechecks backend passaram. A consulta SQL real não foi executada nessa validação.

Na última campanha Luna Medium, após o ajuste da Home, passaram 117 testes focados e 745 testes na regressão completa do frontend, sem falhas e com exit 0 em ambos. `git diff --check` e a verificação reversa do patch tiveram exit 0. O parecer dessa campanha foi **APROVADO PARA COMMIT**.
