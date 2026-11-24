# ADMIN-07 — Operação do evento e encerramentos

## Escopo e decisões iniciais

Branch `feature/admin-event-operations`, base local e remota confirmada em `95a550943b326e2fdd6f52dcb6100576f6d6d570`, com índice vazio. Os três utilitários de homologação da ADMIN-06 não estavam presentes neste checkout na inspeção inicial.

- Substituir o destino informativo de Operação na pilha Admin existente. Reutilizar o sistema visual, a identidade verificada, o formulário de datas com fuso do evento e os contratos HTTP existentes.
- Adicionar uma leitura administrativa por evento. As consultas atuais não retornam os dois totais; as rotas Staff de fila têm outro escopo de autorização e não são fonte para esta área.
- Usar os comandos existentes de fila externa (D06) e fechamento (D07/D09), que decidem autorização, cortes, idempotência, auditoria e efeitos sobre Staff e Participante. C-04, C-12 e C-14 permanecem regras do domínio.
- Guardar uma intenção de operação por evento no escopo autenticado e preservar a chave e o corpo para recuperação explícita. A consulta real mostra a situação atual; coincidência de estado sozinha não confirma autoria de uma operação incerta.
- O backend ainda recusa outra intenção de fechamento após o início do controlado. Antecipação, mudança de prazo e reabertura ficam fora da ADMIN-07.

Referências lidas: [panorama e decisões](PANORAMA_ARENAGO_IMPLEMENTACAO.md), [arquitetura D06/D07/D09](ARQUITETURA_BACKEND_ARENAGO.md) e controllers/DTOs em `backend/src/events`.

## Implementação e contratos

A área **Painel Individual do Evento → Operação do evento** abre a tela real para o UUID selecionado, na mesma pilha e com as abas existentes. A tela usa o cabeçalho, os cards, os botões e o diálogo de confirmação do Admin. BI continua no destino informativo.

| Contrato | Uso |
| --- | --- |
| `GET /api/v1/admin/events/:eventId/operation` | Leitura nova com `Cache-Control: no-store`, Admin global e TOTP. Revalida conta e sessão antes de consultar o evento. Fase, configuração, instante observado, prazos, indicadores e disponibilidade das ações são devolvidos no mesmo snapshot somente leitura. |
| `PATCH /api/v1/admin/events/:eventId/external-queue` | Contrato existente com `{ enabled, reason }`. Valida evento, estado e contagem retornados. `changedAt` é opcional no no-op. |
| `POST /api/v1/admin/events/:eventId/close` | Contrato existente com `{ mode, reason }` e `controlledUntilAt` somente no modo controlado. O recibo traz modo, fase no momento da confirmação, corte de ingressos, prazo efetivo e quantidade finalizada da espera externa. |

A consulta reutiliza a projeção administrativa e agrega somente participações `active` e `waiting` do evento, em campos distintos. Não retorna identificação dos participantes, histórico individual ou código de acesso. Zero é exibido quando retornado no snapshot. Um indicador ausente ou inválido aparece como indisponível. Se a fase já for encerrada e ainda houver registros abertos persistidos, a tela qualifica o significado da contagem enquanto o backend conclui a transição.

A fila externa só oferece mudanças quando a leitura indica disponibilidade e o evento está antes do corte. Desativar libera os `waiting` pelo comando D06. A reconciliação de chamadas pendentes integra a mesma escrita via trigger já existente da migration `0008`. Reativar altera novos ingressos elegíveis e preserva quem já está ativo.

O encerramento imediato informa o efeito sobre ingressos, filas, chamadas e participações. O controlado exige prazo no fuso do evento, futuro, limitado a uma hora a partir do instante estimado do servidor e ao prazo operacional original. O servidor valida novamente o instante efetivo após os locks. A espera externa é finalizada pelo servidor no início do controlado e as operações internas admissíveis já existentes podem prosseguir. D07/C-04, C-12 e C-14 seguem nos serviços existentes. A UI bloqueia novas ações de encerramento quando a fase efetiva já é `closing` ou `closed`. Não há ação de antecipar, reabrir ou alterar o prazo de um encerramento em curso. A divergência conhecida de D09 permanece aberta para decisão separada.

As duas escritas exigem justificativa de até 500 caracteres e uma confirmação contextual. O componente revalida o snapshot, o prazo e o foco antes de enviar. Reconsultas ocorrem ao entrar, recuperar foco, solicitar atualização ou chegar a uma transição temporal prevista. O estado do servidor continua sendo a fonte da fase efetiva. A tela não decreta fechamento com base no relógio local.

## Idempotência e recuperação

A sessão de operação reutiliza o vínculo de identidade administrativa mantido pelo `AuthProvider`, com um registro próprio por evento. Staff mantém seu registro e os critérios anteriores. A intenção é reservada antes do transporte e guarda chave e corpo imutáveis. Enquanto houver envio, resultado incerto ou conflito de chave, uma nova intenção no mesmo evento fica bloqueada. Nenhuma escrita é repetida automaticamente.

Timeout, resultado em processamento e resposta incompatível disparam uma nova leitura do estado e mantêm a intenção recuperável. O reenvio explícito exige leitura válida do mesmo evento e usa a chave e o corpo originais. Um estado coincidente na leitura não confirma autoria. Um recibo válido é exibido separadamente e permanece visível se a reconsulta falhar por conectividade. A perda de acesso oculta os dados e ações. Uma revalidação transitória conserva a intenção da mesma sessão, enquanto logout, perda efetiva de papel ou troca de sessão, conta ou cliente descartam os resultados antigos. O registro fica em memória durante a vida do provedor. Após encerramento do app, a recuperação disponível é a consulta do estado persistido.

## Arquivos da entrega

| Área | Arquivos |
| --- | --- |
| Tela, formulário e registro | `app/screens/admin/AdminEventOperationScreen.js`, `app/screens/admin/adminOperationForm.js`, `app/screens/admin/adminOperationSession.js`, `app/screens/admin/components/AdminOperationCards.js` |
| Apresentação compartilhada do Admin | `app/screens/admin/components/AdminLiveScreen.js`, `app/screens/admin/components/AdminLiveUI.js` |
| Integração com navegação e sessão | `app/context/AuthContext.js`, `app/screens/admin/AdminEventManagementInfoScreen.js`, `app/screens/admin/AdminRealEventScreen.js`, `app/screens/admin/adminStaffSession.js`, `app/screens/admin/components/AdminSelectedEvent.js` |
| Cliente e leitura persistida | `app/services/adminEventOperationService.js`, `backend/src/events/admin-configuration.controller.ts`, `backend/src/events/admin-configuration-query.service.ts`, `backend/src/events/admin-configuration.dto.ts` |
| Testes frontend | `app/tests/adminEventOperation.test.cjs`, `app/tests/adminRealEvents.test.cjs`, `app/tests/roleRoutingIntegration.test.cjs` |
| Testes backend | `backend/test/unit/admin-configuration.test.ts`, `backend/test/unit/admin-configuration-http.test.ts`, `backend/test/integration/admin-external-queue-http.integration.test.ts`, `backend/test/integration/admin-close-http.integration.test.ts` |
| Relatório e evidência | Este relatório e `qa-evidence/ADMIN_07-changes.diff`. O patch não inclui a si próprio. |

## Evidências e validações pendentes

- **Inspeção estática nesta rodada:** parser Babel em 12 arquivos JS/JSX/CJS e parser TypeScript em sete TS, com 102 referências relativas conferidas. `git diff --check` passou. A evidência usa o HEAD indicado na abertura. A conferência do patch consiste em inventário, varredura de segredos, aplicação em modo de checagem contra a base e verificação reversa contra o working tree, sem tocar no índice real.
- **Testes preparados:** cliente HTTP, prazo e fuso, ausência de contagem fictícia, idempotência, falhas e isolamento de sessão no frontend. A integração simulada de navegação cobre cancelar, ativar/desativar, imediato/controlado, reentrada, mensagens, reconsulta e respostas antigas. Backend cobre autorização, validação do UUID, TOTP, falha de consulta, snapshot e projeção mínima. Nas suítes D06/D09 foram preparados casos e asserções da leitura antes e depois das escritas, com isolamento entre eventos.
- **Execuções automatizadas, validação pelo responsável e Expo Go:** pendentes para esta versão. Nenhuma suíte, typecheck, migration, seed ou banco foi executado nesta rodada.

### Campanha Luna Medium sem banco

Com as dependências já instaladas, rodar a partir de `app`:

```powershell
$env:NODE_ENV = 'test'
node --test --test-reporter=spec tests/adminEventOperation.test.cjs tests/adminRealEvents.test.cjs tests/roleRoutingIntegration.test.cjs tests/adminEventSettings.test.cjs tests/adminEventStructure.test.cjs tests/adminEventStaff.test.cjs tests/auth.test.cjs tests/httpClientTimeout.test.cjs
```

O harness de navegação usa as dependências do snapshot de `qa/regression`. Expandir a campanha para `npm.cmd test` em `app` e registrar a contagem, falhas, skips e código de saída.

Em um PowerShell separado, em `backend`, usar configuração de teste isolada e endpoints locais sem serviço para os testes simulados. Conferir que a sonda `os.userInfo()` funciona no Node compatível antes de invocar `tsx`. Não imprimir o retorno da sonda.

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/arenago_unit'
$env:DATABASE_DIRECT_URL = $env:DATABASE_URL
$env:EVENTS_TEST_DATABASE_URL = $env:DATABASE_URL
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '60'
Remove-Item Env:RESEND_API_KEY, Env:RESEND_FROM, Env:EMAIL_VERIFICATION_CONFIRMATION_URL -ErrorAction SilentlyContinue
npm.cmd run typecheck:test
& .\node_modules\.bin\tsc.cmd --noEmit --incremental false
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts test/unit/admin-external-queue.test.ts test/unit/admin-external-queue-http.test.ts test/unit/admin-close.test.ts test/unit/admin-close-http.test.ts
```

### PostgreSQL e Expo Go

Exigir autorização própria para a campanha. As duas suítes existentes D06/D09 aceitam `127.0.0.1:55432/arenago_events_test`. Antes da execução, conferir por leitura o listener PostgreSQL local, a identidade do banco e da role, as três URLs idênticas, as migrations já aplicadas e o estado anterior. Usar apenas uma instância dedicada e descartável. Configurar `NODE_ENV=test`, `DOTENV_CONFIG_PATH=NUL`, os quatro TTLs de teste e o scheduler de fechamento desabilitado. O `AppModule` pode inserir dados canônicos de jogos e questionário. Conferir a limpeza por UUID após a execução e restaurar o ambiente. Nenhuma instância Neon ou base com dados de homologação persistentes faz parte desse plano.

```powershell
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-external-queue-http.integration.test.ts test/integration/admin-close-http.integration.test.ts
```

A campanha cobre fila ocupada, reativação sem retorno à espera, imediato com chamadas internas pendentes e atendimento concluído, controlado com operação interna residual, auditoria, idempotência, concorrência e rollback. O caso físico com chamada externa pendente deve ser conferido em ambiente autorizado, assim como o corte visto pelo Participante, a resolução residual pelo Staff, o prazo no fuso do evento e o retorno à tela após queda de rede.

O aceite depende dos resultados dessas validações e da revisão do responsável.

## Refinamento visual da Operação do evento

A referência fornecida na rodada de refinamento organiza a operação em quatro cards. A versão inicial usava seções genéricas, contagens em texto corrido e botões de encerramento independentes, incluindo um botão vermelho preenchido. O ajuste planejado aproxima a hierarquia da referência com identificação horizontal do evento, indicadores em cartões, badge e ação roxa da fila e itens de encerramento com descrições, ícones e chevrons.

O cabeçalho compartilhará a marca e o retorno do Admin, com o sobretítulo **PAINEL DO EVENTO**. A barra de abas existente continua sendo a referência de navegação. O snapshot oficial continua sendo a única fonte dos estados e números da tela. A projeção do servidor só usa `open` se o evento estiver pronto e usa `not_ready` quando, após o início previsto, há configuração pendente. As demais fases não permitem deduzir prontidão, portanto o card exibirá somente a fase e os prazos nesses casos.

### Ajustes realizados

- O cabeçalho recebeu o sobretítulo e o subtítulo próprios da Operação. O layout compartilhado mantém o retorno à esquerda, a marca Admin à direita e logout na Home. A barra segue com as três abas Home, Histórico e BI.
- `AdminOperationCards` reutiliza `AdminIcon`, `AdminIconTile`, `AdminEventPhaseBadge`, `AdminButton` e os estilos e cores do Admin. O card do evento combina calendário, nome com quebra, badge da fase e prontidão quando inferível pelo contrato atual. Os prazos e a atualização manual permanecem no rodapé do card.
- As duas contagens oficiais aparecem em indicadores independentes, com zero preservado e rótulo **Indisponível** para valores ausentes. A disposição lado a lado se adapta por quebra de linha conforme o espaço. A ressalva para registros abertos em evento encerrado foi preservada.
- A fila tem badge de estado, descrição e ação roxa disponível conforme os mesmos controles. As duas opções de encerramento viraram linhas com descrição, ícone e chevron. A ação imediata usa destaque vermelho no ícone. O aviso sobre justificativa e confirmação fica abaixo do card.
- As consultas, sessão, condições de exibição das ações, formulário, confirmações, idempotência e recuperação continuam na tela existente. Nenhuma chamada ou contrato foi acrescentado. As ações e o formulário continuam no mesmo `ScrollView`, acima das abas fixas.

### Arquivos e verificações desta rodada

- Apresentação em `app/screens/admin/AdminEventOperationScreen.js`, `app/screens/admin/components/AdminOperationCards.js` (novo), `app/screens/admin/components/AdminLiveScreen.js` e `app/screens/admin/components/AdminLiveUI.js`. Assertivas ajustadas em `app/tests/roleRoutingIntegration.test.cjs`. Relatório e evidência consolidados nos caminhos originais.
- Os testes de integração simulada agora conferem valores e rótulos dentro dos respectivos indicadores, badges de fase e fila, prontidão ausente quando a fase não confirmar, abas e ancestrais de rolagem das ações. As verificações de UUID, métodos, justificativas, confirmação, prazo, bloqueios, isolamento e idempotência foram preservadas.
- Inspeção estática com resultado satisfatório: parser de 15 arquivos JS/JSX/CJS e sete TS, resolução de 113 referências relativas, comparação dos trechos de consulta, sessão, retornos de estado e formulário com a evidência anterior e `git diff --check`. A evidência usa a mesma base e representa 23 arquivos, sem incluir o próprio patch. Foi conferida por `git apply --cached --check --whitespace=error` em índice isolado e por `git apply --reverse --check` contra o working tree. O índice real permaneceu vazio.
- Nenhuma suíte automatizada foi executada na rodada visual. Na campanha com Luna Medium, a partir de `app`, usar `NODE_ENV=test` e `node --test --test-reporter=spec --test-name-pattern 'ADMIN-07' tests/roleRoutingIntegration.test.cjs` para a integração focada, além da regressão já documentada.
- A abertura anterior no Expo Go foi informada pelo responsável e antecede este refinamento. A comparação visual em aparelho segue pendente, incluindo legibilidade e contraste, quebra de nome e indicadores, interação, rolagem até o aviso, área segura da barra e comportamento em iPhones e Android com larguras e escalas de texto diferentes.

### Acabamento visual dos formulários

O responsável informou ter aprovado a composição principal no Expo Go. Nesta rodada, os ajustes se concentraram nos formulários que aparecem após escolher uma ação.

- **Desativar fila externa** usa o ícone de pausa. **Encerrar imediatamente** usa o ícone de parada em vermelho e apresenta as consequências existentes em um aviso discreto de ação crítica, no estilo de atenção do Admin. **Encerramento controlado** usa o relógio.
- No encerramento controlado, data e hora passam a ocupar linhas separadas quando o espaço do card é insuficiente para os dois campos lado a lado. Os textos dos seletores podem quebrar linha e a área de toque de 44 pontos foi preservada. O ajuste de largura é específico desse formulário.
- Arquivos de interface alterados: `app/screens/admin/AdminEventOperationScreen.js`, `app/screens/admin/components/AdminScheduleFields.js` e `app/screens/admin/components/AdminLiveUI.js`. A composição principal, os seletores nativos, as validações, o fluxo de confirmação e o envio das operações foram preservados.
- Inspeção estática de sintaxe JSX e imports relativos, comparação com a evidência anterior, `git diff --check` e verificações de aplicação e reversão do patch. A evidência continua na base `95a550943b326e2fdd6f52dcb6100576f6d6d570` e representa 24 arquivos da ADMIN-07. O índice real permaneceu vazio.
- Esta rodada teve revisão estática. A aprovação visual final dos formulários em aparelho fica com o responsável.

## Correções delimitadas após a auditoria crítica

### Pré-verificação PostgreSQL para D06 e D09

A auditoria confirmou que as suítes podiam iniciar o Nest sem checar o ambiente de teste, o scheduler ou os privilégios da conexão efetiva. A guarda compartilhada segue o padrão de identidade da ADMIN-06 e fecha o pool de pré-verificação antes de permitir a importação do `AppModule`.

1. Exige `NODE_ENV=test`, as três URLs textualmente idênticas e o destino `127.0.0.1:55432/arenago_events_test` com credenciais explícitas e sem parâmetros. A política real do scheduler é validada antes de abrir o pool. Em ambiente de teste, a opção `EVENT_CLOSURE_JOB_TEST_ENABLED` ausente ou igual a `false` mantém o scheduler desligado. O valor `true` e opções inválidas bloqueiam a suíte.
2. Abre uma conexão em transação `REPEATABLE READ READ ONLY`. Compara banco, endereço, porta, `current_user` e `session_user` com o destino declarado. Exige uma role dedicada sem `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS` ou associação a outras roles.
3. Confere tabelas físicas, a ordem e os hashes do histórico Drizzle para as oito migrations do checkout e a ausência de registros nas tabelas operacionais usadas pelas fixtures. Jogos e versões de questionário podem conter dados de referência. Os hashes correspondem ao conteúdo dos arquivos SQL usados pelo Drizzle, inclusive seus finais de linha.
4. Encerra a transação, libera o cliente, fecha o pool e reconfirma a configuração declarada. A suíte redireciona o dotenv para o dispositivo nulo antes de iniciar uma conexão de fixtures e importar o Nest. Falhas da guarda usam mensagens sem detalhes do driver ou credenciais. O hook de limpeza só é habilitado após a guarda. A limpeza existente segue os UUIDs das fixtures, incluindo quando o bootstrap falha após a autorização. A inicialização ainda pode inserir jogos e versões de questionário canônicos.

A futura campanha depende de autorização específica e da identificação independente do processo que escuta a porta `55432`. As consultas do PostgreSQL, sozinhas, não detectam todo túnel ou encaminhamento. O destino deve ser local, dedicado e descartável. `arenago_roles_test` não é aceito.

### Recuperação de recusa definitiva

A condição anterior tratava todo erro no reenvio como resultado desconhecido. Em D09, o servidor autoriza, reserva ou procura replay pela chave e pelo fingerprint, revalida a sessão e só então decide se o evento já foi encerrado ou se o prazo está fora do limite. Se a mesma intenção já tiver sido confirmada, o serviço devolve o recibo gravado antes de verificar o prazo novamente. `409 CLOSURE_DEADLINE_INVALID` no modo controlado e `409 EVENT_ALREADY_CLOSED` são recusas definitivas nesse contrato. A sessão libera o formulário, apresenta o motivo já padronizado e solicita nova confirmação antes de qualquer nova escrita.

Erros ambíguos, status inesperados, falhas de transporte e `IDEMPOTENCY_IN_PROGRESS` ainda preservam a intenção. Uma validação ou um 404 durante a recuperação também conserva a chave e o corpo. As recusas de prontidão e janela da fila só encerram a intenção na primeira tentativa, pois essas condições podem mudar e permitir uma chamada atrasada. Conflito de chave e bloqueio de acesso seguem seus fluxos próprios. A reconsulta ajuda o operador a decidir e o estado lido, por si só, continua insuficiente para atribuir sucesso à intenção.

### Pontos reservados para avaliação posterior

- D06 e D09 ainda adquirem locks de domínio antes da autorização transacional de Admin. A contenção é possível e ainda não foi medida sob carga. Uma futura análise pode avaliar uma pré-checagem de Admin antes dos locks e manter a autorização transacional como decisão final.
- A divergência de precisão entre `called_at` no PostgreSQL e o `Date` usado na liberação D06 continua uma hipótese. Para a campanha futura, preparar uma fixture transacional descartável com chamada pendente em um instante com microssegundos não nulos. Comparar a resolução com `called_at` usando um caso em que a liberação arredondada cai no mesmo milissegundo e um controle no milissegundo seguinte. Verificar status, auditoria e rollback, sem aguardar uma corrida casual do relógio. A fixture deve ficar em transação revertida ou em banco isolado próprio, pois o histórico de chamadas externas bloqueia exclusão de registros.
- Antecipação e reabertura do encerramento continuam fora da entrega.

### Validação e histórico

A campanha da versão anterior registrou 976/976 testes frontend e typechecks backend aprovados. A suíte backend local do responsável obteve 1.316/1.316 após o `ENOMEM` observado na inicialização do `tsx` na outra estação de execução. Esses resultados antecedem as correções acima.

O teste simulado da guarda cobre política e URLs, identidade e privilégios, migrations e estado inicial, sanitização de falhas e ordem entre fechamento do pool, bootstrap e limpeza. Os testes da sessão e da rota reproduzem timeout, reconsulta, reenvio com a chave e o corpo originais, recusa, mensagem e nova revisão. Também cobrem respostas que ainda exigem preservar a intenção.

Nesta rodada de implementação, a validação foi estática. Foram conferidos sintaxe e imports relativos, `git diff --check` e a aplicação e reversão da evidência Git. A execução de testes e typechecks fica para a etapa Luna Medium. Nenhuma conexão PostgreSQL foi aberta.

Na validação autorizada com Luna Medium, em `app`, executar a regressão focada com `node --test --test-reporter=spec --test-name-pattern 'ADMIN-07' tests/adminEventOperation.test.cjs tests/roleRoutingIntegration.test.cjs`. No backend, seguir a configuração isolada da seção de validação sem banco, executar `npm.cmd run typecheck:test`, o typecheck de produção e incluir `test/unit/admin-event-operations-db-guard.test.ts` na seleção do `tsx`. A validação simulada e a auditoria posterior não substituem a autorização independente para PostgreSQL.

O patch atualizado em `qa-evidence/ADMIN_07-changes.diff` contém as correções, seus testes e o relatório, sobre a mesma base da ADMIN-07.

### Ajuste da comparação no teste de reenvio ambíguo

Na campanha pós-auditoria com Luna Medium, o frontend registrou 977 aprovados de 978, com uma falha, nenhum teste ignorado e código de saída 1. O cenário de recusa definitiva após o reenvio do encerramento controlado passou. A falha em `adminEventOperation.test.cjs` foi reproduzida isoladamente. Os dois typechecks do backend passaram, e a suíte unitária/HTTP ficou pendente após a sonda de `os.userInfo()` retornar `ERR_SYSTEM_ERROR` antes da execução.

O stack apontou para `assert.deepEqual(plain(session.snapshot(eventId).intent.body), command.body)`. O harness executa o módulo em um contexto separado do Node. O primeiro operando foi convertido em um objeto do contexto do teste, enquanto `command.body` conservou o protótipo do contexto do módulo. A comparação estrita considera o protótipo e falhou mesmo com conteúdo idêntico. A comparação anterior com `[calls[0], calls[0]]` já havia sido superada.

O teste captura o corpo esperado como JSON antes do primeiro envio. Depois do reenvio explícito, exige exatamente duas chamadas e compara separadamente a rota, a chave de idempotência e todo o corpo de cada chamada com a expectativa original. Também confere que a intenção continua com status `unknown`, a mesma chave e o mesmo corpo, sem recibo de sucesso. As contagens antes do reenvio e após uma nova tentativa de início continuam protegendo contra envios adicionais, e os sete casos da matriz foram preservados.

Nesta rodada, a revisão é estática. A regressão frontend e a suíte unitária/HTTP do backend ficam para a campanha com Luna Medium, com o backend em ambiente local compatível. A homologação funcional permanece pendente.

## Reorganização do PostgreSQL local para D06 e D09

O responsável informou a aprovação visual, 978/978 testes frontend, 1.343/1.343 testes backend e os dois typechecks aprovados. A integração D06/D09 continua pendente. A autorização desta etapa cobre somente o PostgreSQL local em `127.0.0.1:55432`, para as operações abaixo.

| Banco | Operação autorizada | Referência ou finalidade |
| --- | --- | --- |
| `arenago_staff_a4_20261112` | Excluir | Destino fixo de `prepare-staff-a4-homologation.cjs` e dos procedimentos Staff A4. |
| `arenago_staff_homolog_20261111` | Excluir | Destino fixo de `external-entry-calls-schema.integration.test.ts`. Essa suíte ficará sem seu destino até revisão específica. |
| `arenago_staff_homolog_geral_20261111` | Excluir | Destino fixo de `prepare-staff-homologation.cjs` e dos procedimentos Staff geral. |
| `arenago_test` | Excluir | A guarda compartilhada ainda aceita esse nome. Configurações locais que o selecionem deixarão de conectar. |
| `arenago_events_test` | Excluir e recriar com as migrations 0001 a 0008 | Nome fixo das guardas D06/D09 e destino de outras suítes de eventos. |
| `arenago_roles_test` | Preservar | Destino exclusivo da guarda de gestão de papéis da ADMIN-06. |
| `arenago_homologacao` | Preservar | Homologação manual local. |

O inventário acima foi informado pelo responsável. A inspeção manual anterior também encontrou sete migrations em `arenago_events_test`, sem `external_entry_calls`, com resíduos operacionais e permissões incompletas em duas tabelas. Nesta sessão, `netstat` identificou o listener IPv4 local no processo `postgres` de PID 10908, o serviço `postgresql-x64-18` estava ativo e o cliente `psql` informou a versão 18.6. O responsável havia identificado o executável em `C:\Program Files\PostgreSQL\18\bin\postgres.exe`. Nesta sessão o Windows não expôs o caminho do processo e a consulta `portproxy` não exibiu regras.

**Parecer C — preparação bloqueada por falta de credencial administrativa local autorizada nesta sessão.** Nenhuma conexão SQL foi aberta. Proprietários, conexões ativas, privilégios, estado atual das tabelas e inventário final aguardam conferência autenticada. Nenhum banco foi excluído ou recriado, nenhuma role foi modificada e nenhuma migration, seed, inicialização Nest ou suíte de integração foi executada. Os bancos designados para preservação não foram acessados. As configurações locais e remotas ficaram intactas.

### Operação manual no PowerShell local

Use um PowerShell dedicado sem perfil. Confira que o PID atual do listener corresponde ao executável local antes de autenticar. Se o caminho estiver indisponível, faça a conferência no terminal Windows com acesso ao processo. Use somente credenciais locais conhecidas e digite as senhas nos prompts ocultos.

```powershell
Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 55432 |
  ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object Id, ProcessName, Path }
netsh interface portproxy show all
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
Get-ChildItem Env: | Where-Object Name -like 'PG*' | Remove-Item
$env:PGSSLMODE = 'disable'
$env:PGCONNECT_TIMEOUT = '5'
$adminRole = Read-Host 'Role administrativa local autorizada'
if ($adminRole -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Nome de role inválido.' }
& $psql -X -W -h 127.0.0.1 -p 55432 -U $adminRole -d postgres
```

Na sessão administrativa, confira identidade, versão, proprietários e uso dos bancos. A conta administrativa deve conseguir ver as conexões dos demais processos. Registre os proprietários e a identidade dos dois bancos preservados para comparação no final.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), current_user, session_user,
       inet_server_addr(), inet_server_port(), current_setting('server_version');
SELECT oid, datname, pg_get_userbyid(datdba) AS owner, datallowconn
FROM pg_database WHERE datname LIKE 'arenago%' ORDER BY datname;
SELECT datname, pid, usename, application_name, client_addr, state, backend_type
FROM pg_stat_activity
WHERE datname IN ('arenago_staff_a4_20261112', 'arenago_staff_homolog_20261111',
                  'arenago_staff_homolog_geral_20261111', 'arenago_test', 'arenago_events_test')
ORDER BY datname, pid;
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls,
       EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS member_of_role
FROM pg_roles r WHERE rolname IN (session_user, 'arenago');
SELECT d.datname, pg_get_userbyid(d.datdba) AS owner,
       has_database_privilege(r.oid, d.oid, 'CONNECT') AS can_connect,
       has_database_privilege(r.oid, d.oid, 'CREATE') AS can_create_schema
FROM pg_database d CROSS JOIN pg_roles r
WHERE d.datname LIKE 'arenago%' AND r.rolname = 'arenago' ORDER BY d.datname;
ROLLBACK;
```

Confirme `postgres` como banco administrativo, a role esperada nas duas identidades e o endpoint `127.0.0.1:55432`. Confira o inventário contra a autorização. Identifique processos locais da aplicação pela configuração ativa e por `pg_stat_activity`. Se houver sessão ativa, interrompa a operação sobre o banco correspondente e combine a parada normal do processo. Antes de recriar, confirme que `arenago` pode autenticar com a credencial conhecida, tem `LOGIN`, possui todos os cinco atributos administrativos como falsos e não é membro de outras roles. Avalie o uso da mesma role pelos bancos preservados e pela aplicação. Se a reutilização comprometer o isolamento ou exigir alteração global, pare antes de excluir `arenago_events_test` e solicite autorização específica.

Na mesma sessão administrativa já conferida, execute as instruções autorizadas uma a uma. Interrompa se houver erro. Os comandos usam nomes literais e a forma padrão de `DROP DATABASE`, que recusa a exclusão se ainda houver conexões.

```sql
DROP DATABASE arenago_staff_a4_20261112;
DROP DATABASE arenago_staff_homolog_20261111;
DROP DATABASE arenago_staff_homolog_geral_20261111;
DROP DATABASE arenago_test;
DROP DATABASE arenago_events_test;
CREATE DATABASE arenago_events_test WITH OWNER arenago TEMPLATE template0;
REVOKE CONNECT, TEMPORARY ON DATABASE arenago_events_test FROM PUBLIC;
```

Repita a consulta ao catálogo e confira a continuidade de OID e proprietário dos dois bancos preservados. Saia com `\q`. Abra uma sessão no banco recriado, agora como `arenago`, e confirme por leitura identidade, endereço, porta e proprietário antes da migration.

```powershell
& $psql -X -W -h 127.0.0.1 -p 55432 -U arenago -d arenago_events_test -v ON_ERROR_STOP=1 -c "
BEGIN READ ONLY;
SELECT current_database(), current_user, session_user, inet_server_addr(), inet_server_port(),
       pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database();
ROLLBACK;"
if ($LASTEXITCODE -ne 0) { throw 'A conferência da role dedicada falhou.' }
```

### Migrations e conferência do banco recriado

O comando oficial é `npm.cmd run db:migrate`, em `backend`. `drizzle.config.ts` lê primeiro `DATABASE_DIRECT_URL`, carrega dotenv e usa a pasta `drizzle`. O leitor instalado do Drizzle confirmou as oito entradas do journal em ordem, de `0001_identity_profile` a `0008_external_entry_calls`, e calculou os hashes do checkout para compará-los após a execução. As migrations criam tabelas, constraints, índices e funções e triggers PL/pgSQL. Não foi encontrada exigência de extensão ou de superusuário. Rodar como proprietária do banco permite que `arenago` seja também proprietária dos objetos. Uma falha deve interromper a preparação sem ajuste manual de schema ou journal.

Após conferir a conexão acima, no mesmo PowerShell dedicado, restrinja o ambiente e informe a senha da role por prompt. A URI é montada localmente com o destino literal e não deve ser impressa ou persistida. Mantenha o terminal aberto somente até as conferências da preparação.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
Get-ChildItem Env: | Where-Object { $_.Name -match '^(DATABASE_|DRIZZLE_|DOTENV_CONFIG_|EVENTS_TEST_DATABASE_URL$|NODE_OPTIONS$|RESEND_|EMAIL_VERIFICATION_CONFIRMATION_URL$)' } | Remove-Item
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:EVENT_CLOSURE_JOB_TEST_ENABLED = 'false'
$env:EVENT_CLOSURE_INTERVAL_MS = '30000'
$secret = Read-Host 'Senha local de arenago' -AsSecureString
try {
  if ($secret.Length -eq 0) { throw 'Senha obrigatória.' }
  $env:DATABASE_URL = 'postgresql://arenago:' +
    [uri]::EscapeDataString([System.Net.NetworkCredential]::new('arenago', $secret).Password) +
    '@127.0.0.1:55432/arenago_events_test'
} finally { $secret.Dispose(); Remove-Variable secret }
$env:DATABASE_DIRECT_URL = $env:DATABASE_URL
$env:EVENTS_TEST_DATABASE_URL = $env:DATABASE_URL
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migration interrompida. Inspecione a causa antes de tentar novamente.' }
```

Use o hook real da guarda com callbacks vazios. O comando importa a guarda e executa a transação somente leitura, sem invocar a suíte ou o Nest. A guarda compara endereço, porta, banco, usuário, sessão, atributos e associações da role, as 19 tabelas exigidas, as oito entradas e hashes, e exige que as 16 tabelas operacionais de fixtures estejam vazias. Se o `tsx` falhar antes de carregar, use um terminal Windows com o Node compatível e a sonda de `os.userInfo()` funcional. Registre qualquer bloqueio sem atribuir aprovação à guarda.

```powershell
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json -e "import { adminEventOperationsTestHooks } from './test/integration/admin-event-operations-db-guard'; adminEventOperationsTestHooks(async () => {}, async () => {}).start().then(() => console.log('Guarda D06/D09 aprovada'), err => { console.error(err.message); process.exitCode = 1; });"
if ($LASTEXITCODE -ne 0) { throw 'A guarda da ADMIN-07 não foi confirmada.' }
& $psql -X -W -h 127.0.0.1 -p 55432 -U arenago -d arenago_events_test
```

Na sessão de `arenago`, tire o snapshot inicial. Registre o journal efetivo, os proprietários e os privilégios de DML, os mecanismos da migration 0008 e as contagens de todas as tabelas públicas, incluindo os catálogos de jogos e questionário. Em um banco recriado sem bootstrap, espera-se que as tabelas públicas estejam vazias, salvo caso alguma migration insira dados de referência. A contagem real é a evidência.

```sql
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), current_user, session_user, inet_server_addr(), inet_server_port();
SELECT created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
       has_table_privilege(c.oid, 'SELECT') AS sel, has_table_privilege(c.oid, 'INSERT') AS ins,
       has_table_privilege(c.oid, 'UPDATE') AS upd, has_table_privilege(c.oid, 'DELETE') AS del
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname;
SELECT conname FROM pg_constraint WHERE conrelid = 'public.external_entry_calls'::regclass;
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'external_entry_calls';
SELECT tgrelid::regclass AS relation, tgname, tgenabled FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid IN ('public.external_entry_calls'::regclass,
  'public.events'::regclass, 'public.participations'::regclass) ORDER BY tgrelid, tgname;
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I',
              tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
ROLLBACK;
```

Após sair do `psql`, feche o PowerShell dedicado para descartar as credenciais do processo. Para uma campanha posterior especificamente autorizada, repita a conferência do listener e a pré-verificação da guarda. Monte as mesmas três URLs locais, preserve o scheduler desligado e configure `ADMIN_IDEMPOTENCY_TTL_SECONDS`, `STAFF_IDEMPOTENCY_TTL_SECONDS`, `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS` e `EVALUATION_IDEMPOTENCY_TTL_SECONDS` em `60`. Use o comando serial da seção PostgreSQL e Expo Go, com previsão estática de 41 casos D06 e 70 D09. Compare a identidade, o journal e as contagens após a campanha. As suítes limpam por UUID em transação. O bootstrap pode acrescentar dados canônicos de jogos e questionário, e o histórico de chamadas externas é protegido contra exclusão. Qualquer resíduo operacional exige diagnóstico separado antes de reutilizar o banco.

A centralização de destinos e guardas fica na INFRA-01. A ADMIN-07 ainda depende da preparação efetiva, da campanha PostgreSQL autorizada e da decisão do responsável sobre homologação.

## Consolidação final da implementação e homologação

Esta seção registra o estado final de Operação do Evento e Encerramentos. As seções anteriores preservam as evidências de cada rodada, inclusive a auditoria crítica, as falhas intermediárias e o impedimento de preparar o banco pela sessão do Codex. O responsável concluiu a preparação no PowerShell local e informou os resultados das campanhas PostgreSQL e da homologação no Expo Go.

### Regressão automatizada final

| Campanha | Aprovados | Falhas | Ignorados | Exit code |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 978 | 0 | 0 | 0 |
| Backend unitário | 1.343 | 0 | 0 | 0 |
| Integração PostgreSQL D06 | 41 | 0 | 0 | 0 |
| Integração PostgreSQL D09 | 70 | 0 | 0 | 0 |
| **Total** | **2.432** | **0** | **0** | — |

Os typechecks de produção e de testes foram aprovados. O total soma as quatro campanhas finais e exclui reexecuções isoladas, typechecks e verificações manuais.

- A campanha frontend pós-auditoria anterior registrou 977/978, com falha na comparação estrita de objetos de contextos distintos do Node e exit code 1. Após a correção da assertion, o caso passou isoladamente e a regressão completa com `npm.cmd test` em `app` passou com 978/978. O caso percorreu os sete itens da matriz de recuperação. Conferiu rota, chave e corpo nas duas tentativas e a preservação da intenção `unknown` sem recibo ou novo envio. [Caso de reenvio ambíguo](../app/tests/adminEventOperation.test.cjs#L132).
- O histórico do backend inclui uma tentativa bloqueada antes de carregar os testes por `ERR_SYSTEM_ERROR` em `os.userInfo()` e `ENOMEM` na inicialização do `tsx`. Nas tentativas com configuração incompleta do processo, a configuração exigida pelo backend também impediu uma execução válida. Esses bloqueios não demonstraram regressão funcional. No PowerShell local, o responsável resolveu a configuração com uma URL PostgreSQL fictícia em porta local sem serviço e com os quatro TTLs de idempotência definidos explicitamente em 60 segundos. `queue-entry-di.test.ts` passou isoladamente e a suíte unitária completa terminou com 1.343/1.343. O código não precisou ser alterado para resolver os bloqueios de ambiente.

### Reorganização e preparação do PostgreSQL local

O responsável executou manualmente as operações administrativas autorizadas. Confirmou PostgreSQL 18.6, serviço `postgresql-x64-18`, listener `127.0.0.1:55432` e o processo `postgres.exe` da instalação local. Autenticou-se com a role administrativa e conferiu que os bancos destinados à exclusão não tinham conexões ativas.

| Operação confirmada | Bancos |
| --- | --- |
| Excluídos | `arenago_staff_a4_20261112`, `arenago_staff_homolog_20261111`, `arenago_staff_homolog_geral_20261111`, `arenago_test` |
| Excluído e recriado com o mesmo nome | `arenago_events_test` |
| Preservados | `arenago_homologacao`, `arenago_roles_test` |

O inventário final ficou com três bancos ArenaGO, ante sete. Nenhuma role foi excluída nem teve privilégios globais alterados. O banco `arenago_events_test` foi recriado com `TEMPLATE template0` e a role proprietária `arenago`. A consulta de identidade confirmou o banco, as duas identidades da sessão e o endereço e porta efetivos. A role tinha `LOGIN`, sem `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS` ou associação a outras roles.

Em `backend`, `npm.cmd run db:migrate` aplicou as migrations `0001` a `0008`, com exit code 0. Os oito hashes SHA-256 registrados corresponderam aos arquivos do checkout. As 26 tabelas públicas, inclusive `external_entry_calls`, foram criadas sob propriedade de `arenago` e estavam inicialmente vazias. Nenhum seed foi executado. A recriação resolveu os resíduos operacionais, o schema incompleto e a propriedade inconsistente das tabelas constatados na inspeção anterior.

### Integração PostgreSQL real e reutilização

O responsável executou as suítes separadamente no PowerShell local, a partir de `backend`. Usou `NODE_ENV=test`, `DOTENV_CONFIG_PATH=NUL` e `EVENT_CLOSURE_JOB_TEST_ENABLED=false`. As variáveis `DATABASE_URL`, `DATABASE_DIRECT_URL` e `EVENTS_TEST_DATABASE_URL` eram textualmente idênticas e indicavam o destino local dedicado. `ADMIN_IDEMPOTENCY_TTL_SECONDS`, `STAFF_IDEMPOTENCY_TTL_SECONDS`, `PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS` e `EVALUATION_IDEMPOTENCY_TTL_SECONDS` estavam em 60 segundos.

```powershell
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-external-queue-http.integration.test.ts
```

**D06:** 41 aprovados, 0 falhos, 0 ignorados, exit code 0, duração de 26.351,8558 ms.

```powershell
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-close-http.integration.test.ts
```

**D09:** 70 aprovados, 0 falhos, 0 ignorados, exit code 0, duração de 60.510,1741 ms.

As duas suítes passaram pela guarda obrigatória antes de inicializar o `AppModule`. Os testes PostgreSQL exercitaram as consultas e os efeitos persistidos. D06 conferiu os contadores por evento antes e após alternar a fila, a liberação da espera, o isolamento do outro evento e casos de replay, auditoria, concorrência e rollback. D09 conferiu os estados e contadores após os dois modos, a preservação do histórico e de operações internas admitidas no controlado, além de validação temporal, idempotência, serialização e rollback nos casos preparados. A suíte sem banco cobriu contratos e fluxos simulados. [D06](../backend/test/integration/admin-external-queue-http.integration.test.ts#L150) e [D09](../backend/test/integration/admin-close-http.integration.test.ts#L234).

O responsável conferiu as contagens em transações somente leitura.

| Tabelas | Antes de D06 | Após D06 | Após D09 |
| --- | ---: | ---: | ---: |
| `games` | 0 | 20 | 20 |
| `questionnaire_versions` | 0 | 1 | 1 |
| Demais 24 tabelas públicas, cada uma | 0 | 0 | 0 |

Os jogos e a versão do questionário são efeitos esperados da inicialização do Nest. As contagens mostram ausência de resíduos operacionais após ambas as suítes. D09 reutilizou o mesmo banco de D06, sem recriação ou limpeza manual intermediária. O resultado apoia a padronização futura para essas duas suítes. Cada suíte adicional ainda precisa de avaliação de isolamento e limpeza. `arenago_events_test` fica reservado para integração automatizada.

### Homologação funcional no Expo Go

O responsável aprovou as **23 verificações funcionais** em ambiente de homologação. Elas são independentes da contagem automatizada.

| Bloco | Resultado | Verificações aprovadas |
| --- | ---: | --- |
| HF-01 — Consulta operacional | 4/4 | Acesso pela gestão do evento. Conferência de status, horários e indicadores. Contagem de participantes ativos e aguardando ingresso. Atualização ao retornar à tela. |
| HF-02 — Controle da fila externa | 6/6 | Justificativa obrigatória. Cancelamento sem alteração. Desativação. Efeito sobre quem aguarda. Reativação. Persistência após sair e voltar. |
| HF-03 — Encerramento controlado | 6/6 | Justificativa obrigatória. Limites de data e hora. Cancelamento da confirmação. Confirmação válida. Novo estado e prazo operacional. Disponibilidade das ações posteriores. |
| HF-04 — Encerramento imediato | 7/7 | Alerta e confirmação. Cancelamento sem alteração. Confirmação do imediato. Estado encerrado. Indicadores após encerrar. Bloqueio de operações incompatíveis. Persistência ao sair e voltar. |

Durante a homologação, dois participantes que ainda não haviam participado de experiências permaneceram temporariamente na tela do evento após o encerramento. Nenhum conseguiu ingressar em estação. Após atualização manual, ambos saíram corretamente da tela. A observação caracteriza uma limitação de sincronização da interface do Participante, sem operação incompatível bem-sucedida no cenário relatado. O relato não comprova o mecanismo técnico responsável. A melhoria é futura e não bloqueia a ADMIN-07. Avaliar revalidação periódica do estado da participação, atualização automática no prazo operacional, tratamento das respostas indicativas de encerramento e comunicação com redirecionamento apropriado.

### Limitações residuais e INFRA-01

- **Risco de contenção:** D06/D09 ainda podem adquirir locks de domínio antes de determinadas verificações transacionais de autorização. A campanha passou nos cenários preparados e não mediu a contenção sob carga.
- **Hipótese temporal:** permanece aberta a possibilidade de divergência de precisão entre `called_at` e o instante de liberação em D06. A campanha não reproduziu a condição específica descrita pela auditoria.
- **Lacuna de cobertura:** os testes exercitaram concorrência de ingresso, fechamento, autorização e operações internas nos cenários preparados. A concorrência com chamadas externas pendentes ainda exige casos próprios.
- **Limitação conhecida do contrato:** antecipar, alterar o prazo ou reabrir um encerramento controlado já iniciado está fora do escopo. O backend continua recusando uma segunda intenção de encerramento nessa situação.

A INFRA-01 deverá avaliar o reaproveitamento de `arenago_events_test`, a centralização das guardas, a padronização das variáveis de ambiente e a automação da preparação e conferência. O desenho deve prever restauração segura do estado-base, revisão de limpeza das fixtures, tratamento dos históricos protegidos e adaptação das guardas legadas aos destinos que permanecem. A eventual exclusão de `arenago_roles_test` depende da migração das suítes de gestão de papéis e de autorização própria. A política de infraestrutura no `AGENTS.md` será tratada nessa task.

### Fechamento documental

O patch consolidado representa 26 arquivos sobre a base `95a550943b326e2fdd6f52dcb6100576f6d6d570`, com o relatório final e sem incluir o próprio patch. Esta rodada consolida evidências existentes. A ADMIN-07 está documentalmente pronta para aprovação formal pelo responsável e posterior commit e push mediante autorização.

### Aprovação formal do responsável

Em 24/11/2026, o responsável aprovou formalmente a ADMIN-07 — Operação do Evento e Encerramentos, com base nas evidências consolidadas de 2.432 testes automatizados, nos dois typechecks, nas 23 verificações funcionais no Expo Go e na auditoria independente. Também aceitou as limitações residuais documentadas como não bloqueantes e autorizou o staging, o commit e o push dos arquivos exclusivos da task para `origin/feature/admin-event-operations`.
