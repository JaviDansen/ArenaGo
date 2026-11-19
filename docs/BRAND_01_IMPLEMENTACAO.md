# BRAND-01 — Identidade visual

Escopo definitivo: substituir a logo exclusivamente no cabeçalho da área Admin, mantendo splash animada, splash nativa, autenticação e demais áreas com os assets compartilhados originais. Base `2619a66790807a8502e37c3da7206fcb8804a15f`, branch `feature/admin-event-operations`. Testes da versão corrigida: 111/111 aprovados; capturas da Home Admin e de Gerenciar Eventos aprovadas visualmente pelo responsável.

## Investigação inicial

Referência localizada em `app/assets/Logo ArenaGO em Preto, Branco e Roxo.png`. O cabeçalho Admin e a splash animada utilizam `app/assets/images/logo-arenago.png`; a splash nativa usa `app/assets/splash-icon.png`. A fidelidade da remoção do fundo deve ser inspecionada antes da substituição.

## Resultado da inspeção e impedimento

O arquivo localizado tem **1024 × 341**, enquanto a referência solicitada é **2048 × 682**. A inspeção visual mostra ruídos e manchas brancas, azuis e roxas nos contornos e no interior da marca. Uma tentativa de remoção de fundo não produziu resultado que permita garantir fidelidade às formas, cores e bordas exigidas. Por isso nenhuma variante foi incorporada e nenhum asset existente foi substituído. É necessário obter o PNG original correto e limpo, preferencialmente já com transparência ou em formato vetorial, para concluir a task sem redesenhar a marca.

Além do cabeçalho e da splash animada, `app/screens/auth/AuthSessionGate.js` referencia a logo compartilhada. `app/app.json` configura a splash nativa com `app/assets/splash-icon.png`, que mostra uma versão anterior da marca; também deverá ser atualizada após disponibilização de um asset fiel. Há textos ArenaGO em telas de autenticação e telas demonstrativas que exigem avaliação no escopo, preservando as restrições de texto e fluxos.

## Verificações e pendências

Foram conferidos branch e HEAD, as referências por busca textual, dimensões com `System.Drawing`, o PNG encontrado e a splash nativa por inspeção visual. `git diff --check` e a verificação de índice passaram. Nenhum teste foi executado ou preparado nesta investigação; permanecem pendentes a implementação dos assets, testes de referências e regressão, execução por Luna Medium e homologação no Expo. O único arquivo da task criado até agora é este relatório. Não foi gerado changes. Nenhuma alteração de código ou asset foi realizada.

## Retomada com PNG oficial transparente

O responsável forneceu `app/assets/images/Logo ArenaGO render (admin-staff).png`, PNG RGBA de **2048 × 682**, com canto transparente. A inspeção visual mostrou a marca branca e roxa limpa, com tipografia e proporção compatíveis com a referência. O arquivo já possui transparência; não houve remoção de fundo, redesenho ou redimensionamento.

O PNG foi copiado integralmente para `app/assets/images/logo-arenago.png` e `app/assets/splash-icon.png`. Os três arquivos têm SHA-256 `28181211cb703993f6031ec3521f879534418c4fd3e6534ecfa64dc771a9f8ce`. O asset compartilhado aparece no cabeçalho Admin, na splash animada e no AuthSessionGate. A splash nativa continua com o caminho existente em `app.json`, modo `contain` e fundo `#1C0A35`, agora com a nova marca; o fallback da animação também utiliza o novo asset nativo. Os ícones de instalação e favicon não foram alterados.

O cabeçalho preserva logo à direita e retorno/logout à esquerda, com `resizeMode=contain`, largura de 38%, máximo 150 e altura 48. A splash animada mantém centralização, tempos e comportamento; sua proporção `1024/341` equivale exatamente a `2048/682`. A inspeção estática não substitui a conferência em telas pequenas nem uma compilação nativa Expo: escala e enquadramento da splash nativa devem ser homologados em aparelho pelo responsável.

`app/tests/splashScreen.test.cjs` foi preparado para conferir as novas dimensões, canal alfa, igualdade entre assets compartilhado e nativo, correspondência com o PNG fornecido e configuração dark. Os testes anteriores de animação, cabeçalho e navegação permanecem disponíveis. Nenhum teste ou build foi executado; a campanha será executada posteriormente com Luna Medium.

Inventário da retomada: `app/assets/images/Logo ArenaGO render (admin-staff).png` (novo, fornecido pelo responsável); `app/assets/images/logo-arenago.png` e `app/assets/splash-icon.png` (modificados); `app/tests/splashScreen.test.cjs` (modificado); `docs/BRAND_01_IMPLEMENTACAO.md` (novo). Foram conferidos referências, dimensões, canal alfa, igualdade SHA-256, layout por leitura e `git diff --check`. A task aguarda validação automatizada e homologação visual; changes definitivo não foi gerado.

## Campanha de testes e regressão — Luna Medium

Branch `feature/admin-event-operations`, HEAD `2619a66790807a8502e37c3da7206fcb8804a15f`. Índice inicialmente vazio e alterações BRAND-01 preservadas. O manifesto de `app` usa o runner Node `node --test`; as seis suítes selecionadas usam harnesses locais/simulados. Foram executadas as suítes solicitadas, sem acesso a backend, banco ou serviços externos.

Comando executado em PowerShell, diretório `app`, com `NODE_ENV=test`:

```powershell
$env:NODE_ENV='test'
node --test --test-reporter=spec tests/splashScreen.test.cjs tests/authVisualIntegration.test.cjs tests/adminNavigation.test.cjs tests/adminRealEvents.test.cjs tests/authNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
```

Resultado: **110 testes, 110 aprovados, 0 falhos, 0 ignorados, exit code 0**. As seis suítes foram incluídas: splash, integração visual de autenticação, navegação Admin, eventos Admin, navegação de autenticação e roteamento de papéis.

As verificações confirmaram PNGs de 2048 × 682, tipo de cor RGBA com alfa, e o mesmo SHA-256 para original fornecido, logo compartilhada e splash nativa (`28181211cb703993f6031ec3521f879534418c4fd3e6534ecfa64dc771a9f8ce`). `app.json` mantém splash `contain`, fundo claro/escuro configurado; os testes confirmaram duração de 2.500 ms, transições e aspecto horizontal. Os testes de Home e cabeçalho Admin confirmaram logout apenas na Home, botão Voltar nas telas internas, marca presente e navegação preservada. AuthSessionGate e rotas de autenticação/papéis passaram.

Avisos do React Test Renderer obsoleto e nomes default minúsculos nas telas do roteamento simulado foram emitidos pelo harness; não causaram falhas. `git diff --check` passou e o índice permaneceu vazio. Não houve correções durante a campanha. O teste de integridade não encontrou dependência dos pixels antigos; a referência PNG anterior continua preservada como material histórico, sem ser usada pelas telas.

Limites: a campanha não executou Expo nativo nem mediu renderização real em aparelho. A homologação visual pelo responsável continua necessária, especialmente para recorte, escala e alinhamento da splash nativa em telas pequenas. Nenhum teste ou build de distribuição foi executado. A BRAND-01 ainda aguarda essa homologação; o changes definitivo não foi gerado.

## Correção de escopo — logo exclusiva do Admin

O responsável restringiu a nova marca à área Admin. A substituição global anterior foi ampla demais e corrigida antes da aprovação. Os arquivos `app/assets/images/logo-arenago.png`, `app/assets/splash-icon.png` e `app/tests/splashScreen.test.cjs` foram restaurados byte a byte da base `2619a66790807a8502e37c3da7206fcb8804a15f`; splash animada, splash nativa e AuthSessionGate continuam usando suas referências anteriores. Os ícones de instalação e favicon não foram alterados.

O PNG transparente fornecido permanece em `app/assets/images/Logo ArenaGO render (admin-staff).png`; uma cópia byte a byte está em `app/assets/images/logo-arenago-admin.png`. `AdminLiveScreen.js` usa exclusivamente essa cópia no cabeçalho, preservando posição, `contain`, navegação e acessibilidade. O harness de roteamento reconhece os dois caminhos de imagens. `adminNavigation.test.cjs` contém verificações preparadas para o asset exclusivo, dimensões, alfa, referências da splash e autenticação; testes anteriores de navegação e cabeçalho continuam presentes.

A campanha histórica de **110/110** precedeu esta alteração e não valida a implementação atual. Nenhum teste foi executado nesta rodada. Permanecem pendentes a nova campanha Luna Medium e a homologação visual Expo. Inventário: `app/screens/admin/components/AdminLiveScreen.js`, `app/tests/adminNavigation.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs` modificados; `app/assets/images/logo-arenago-admin.png`, o PNG fornecido pelo responsável e este relatório novos. Nenhum changes foi gerado.

## Validação final pós-correção de escopo — Luna Medium

Executada na branch `feature/admin-event-operations`, HEAD `2619a66790807a8502e37c3da7206fcb8804a15f`, com o índice inicialmente vazio. A campanha histórica de **110/110** descrita acima ocorreu antes da correção de escopo e não é evidência desta versão.

Comando executado no PowerShell, diretório `app`, com `NODE_ENV=test`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec `
  tests/adminNavigation.test.cjs `
  tests/roleRoutingIntegration.test.cjs `
  tests/adminRealEvents.test.cjs `
  tests/authNavigation.test.cjs `
  tests/authVisualIntegration.test.cjs `
  tests/splashScreen.test.cjs
```

Resultado: **111 testes aprovados, 0 reprovados, 0 ignorados, exit code 0**. Foram executadas as seis suítes indicadas. Não foram observados avisos relevantes no log; não houve acesso a backend, banco, serviços externos ou build nativo.

A verificação de isolamento passou: `AdminLiveScreen.js` importa `logo-arenago-admin.png`; a única referência de produção ao nome exclusivo está no componente Admin. O teste `BRAND-01: Admin usa logo exclusiva e splash e autenticação mantêm assets originais` passou e verifica as referências Admin, splash e autenticação. A splash animada continua usando `logo-arenago.png` com fallback `splash-icon.png`; `app.json` mantém `splash-icon.png` na splash nativa; `AuthSessionGate.js` continua usando `logo-arenago.png`. A inspeção da imagem exclusiva confirmou **2048 × 682**, PNG RGBA com alfa (pixel transparente no canto superior esquerdo); SHA-256 da cópia Admin e do PNG fornecido: `28181211CB703993F6031EC3521F879534418C4FD3E6534ECFA64DC771A9F8CE`. `logo-arenago.png` e `splash-icon.png` correspondem aos objetos do commit-base, e `splashScreen.test.cjs` não difere da base.

Os testes aprovados cobrem o cabeçalho Admin, incluindo logout na Home, retorno nas telas internas e rotas por papel, além dos fluxos de eventos e autenticação das suítes selecionadas. `git diff --check` passou; `git diff --cached --exit-code` confirmou índice sem alterações. Nenhuma implementação foi alterada durante esta campanha; somente este relatório recebeu o resultado.

Inventário atual da BRAND-01: modificados `app/screens/admin/components/AdminLiveScreen.js`, `app/tests/adminNavigation.test.cjs` e `app/tests/roleRoutingIntegration.test.cjs`; novos `app/assets/images/logo-arenago-admin.png`, `app/assets/images/Logo ArenaGO render (admin-staff).png` (fornecido pelo responsável) e `docs/BRAND_01_IMPLEMENTACAO.md`. Assets compartilhados `app/assets/images/logo-arenago.png` e `app/assets/splash-icon.png`, bem como `app/tests/splashScreen.test.cjs`, permanecem inalterados em relação à base.

A validação automatizada não substitui a homologação visual no Expo. O responsável ainda deve conferir escala, alinhamento e enquadramento em aparelho. Nenhum changes definitivo foi gerado e a BRAND-01 não está declarada aprovada visualmente.
## Fechamento definitivo da BRAND-01

O escopo final é exclusivo do cabeçalho Admin. A tentativa inicial de substituir a marca globalmente foi ampla demais; foi revertida antes da aprovação. Esse histórico foi preservado acima. A nova logo não substitui os assets compartilhados da splash ou autenticação.

A versão atual passou em **111/111 testes**, com 0 falhas, 0 ignorados e exit code 0. Os **110/110** registrados anteriormente pertencem à implementação anterior à correção de escopo e são mantidos somente como histórico, não como evidência da versão final. O responsável aprovou visualmente as capturas fornecidas da Home Admin e de Gerenciar Eventos: marca nítida, sem cortes, alinhada à direita e sem sobreposição com logout ou retorno.

A homologação foi feita por capturas de tela, não em aparelho Expo. Ela confirma as telas e dimensões apresentadas, mas não substitui a avaliação em outros tamanhos, densidades, orientação ou renderização nativa. Não houve build nativo nesta task.

O isolamento foi verificado: `app/assets/images/logo-arenago.png`, `app/assets/splash-icon.png` e `app/tests/splashScreen.test.cjs` são idênticos à base. Splash animada, splash nativa e `AuthSessionGate` seguem usando os assets compartilhados anteriores. Ícones de instalação e favicon não foram alterados.

Inventário definitivo em relação à base `2619a66790807a8502e37c3da7206fcb8804a15f`:

- Modificados: `app/screens/admin/components/AdminLiveScreen.js`, `app/tests/adminNavigation.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs`.
- Novos: `app/assets/images/logo-arenago-admin.png`, `app/assets/images/Logo ArenaGO render (admin-staff).png` (PNG fornecido pelo responsável), `docs/BRAND_01_IMPLEMENTACAO.md`.

A revisão do inventário confirmou somente esses seis arquivos como alterações da BRAND-01. Aprovação para fechamento técnico e preparação do changes definitivo. Commit e push permanecem manuais, sob responsabilidade do responsável.