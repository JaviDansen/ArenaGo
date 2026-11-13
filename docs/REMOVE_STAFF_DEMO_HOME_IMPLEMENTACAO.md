# Remoção do acesso demonstrativo Staff da Home

A Home do participante não apresenta mais o botão “Área do Staff (demonstração)”. O registro `StaffDemo` foi removido da pilha do participante, impedindo que uma ação de navegação para esse nome abra a demonstração. A entrada em eventos e as demais rotas do participante foram mantidas. Os arquivos da demonstração Staff permanecem disponíveis para a futura integração, que continuará dependendo de autorização do backend por evento.

## Evidências e validações

- Inspeção estática: o único acionador de `StaffDemo` na aplicação estava na Home e o único registro ficava na pilha do participante. As telas Staff demonstrativas permanecem no repositório.
- Testes preparados: ausência do botão e do registro em sessões públicas e de participante; rotas de participação preservadas; tentativa de navegar para `StaffDemo` rejeitada pelo React Navigation e pilha reiniciada ao trocar de conta. A cobertura existente das telas demonstrativas é mantida em `staffScreens.test.cjs`.
- Testes específicos executados por Luna Medium com `NODE_ENV=test`: `node --test tests/staffNavigation.test.cjs tests/staffRealNavigation.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs`; 24 aprovados, 0 falhos e 0 ignorados. A tentativa de navegar manualmente para `StaffDemo` foi rejeitada, e a tela não carregou; entrada em evento e troca de conta também foram verificadas.
- Suíte completa executada por Luna Medium com `NODE_ENV=test` via `npm.cmd --prefix app test`: 404 aprovados, 0 falhos e 0 ignorados, incluindo autenticação, TOTP, refresh, questionário, participação, fila, eventos e avaliações.
- `git diff --check`: executado sem apontamentos.
- Lint, typecheck e build: não há scripts nem configurações correspondentes no pacote `app`; não executados.
- Validação manual informada pelo responsável, anterior a esta alteração: login encaminhou Admin, Staff e Participante às respectivas áreas no Expo Go. A remoção do botão ainda requer validação.
- Avisos: o React Navigation emite alertas do harness de teste sobre nomes `default` nos componentes mockados, e o `react-test-renderer` informa depreciação. Não causaram falhas.
