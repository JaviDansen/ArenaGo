# ADMIN-F1-FIX-01 — Atualização do Painel Individual após mutações

## Contexto e diagnóstico preliminar

A auditoria da Fase 1 identificou que o Painel Individual pode exibir dados anteriores a um encerramento ou a uma revogação Staff quando o administrador retorna enquanto a escrita ainda está em andamento. A consulta por foco pode terminar antes da escrita. A sessão administrativa publica a conclusão, mas atualmente apenas as telas filhas usam essas notificações para reconsultar seus dados.

A base é `6acaf37feb452f6999c3e5296b636bcdd58958dd` na branch `feature/admin-event-operations`. O escopo é a atualização do Painel Individual para o achado F1-01. Os relatórios e evidências das entregas anteriores permanecem como histórico. Referências de implementação e revisão: [ADMIN-02](ADMIN_02_IMPLEMENTACAO.md), [ADMIN-06](ADMIN_06_IMPLEMENTACAO.md) e [ADMIN-07](ADMIN_07_IMPLEMENTACAO.md).

## Implementação

As sessões Staff e Operação sinalizam a confirmação após validar o recibo e conferir se o envio ainda pertence ao contexto original. Os assinantes existentes das telas filhas continuam recebendo os avisos de releitura que já usavam para tratar sucesso, recusa e resultado incerto. Somente o Painel Individual usa a confirmação para invalidar detalhe e prontidão.

O painel assina as duas sessões existentes no provedor de autenticação, limita a notificação ao UUID selecionado e remove os assinantes no encerramento do efeito. A invalidação no painel focado substitui o identificador lógico de qualquer leitura anterior e inicia um par de GETs. As respostas anteriores perdem permissão de publicar. Durante a perda de foco, a consulta oficial do próximo foco cobre as confirmações ocorridas nesse intervalo. Edição e estrutura continuam com seus fluxos próprios de leitura. A recuperação explícita das intenções e as chaves de idempotência continuam nas sessões de origem.

## Critérios de aceite

- Atualizar fase e prontidão quando um encerramento ou uma revogação terminar depois do retorno ao painel.
- Preservar as respostas mais recentes de detalhe e prontidão diante de respostas fora de ordem.
- Isolar as notificações e resultados por evento e contexto de autenticação.
- Preservar uma única escrita, a recuperação explícita e o tratamento de falhas existente.
- Remover assinaturas ao desmontar e consultar pelo foco sem ciclos de atualização.
- Registrar as verificações e consolidar o patch da task.

## Verificações da implementação — Sol High

Em `app`, com `NODE_ENV=test` e transporte simulado pelo harness de roteamento:

```powershell
node --test --test-reporter=spec --test-name-pattern='^F1-R' tests/roleRoutingIntegration.test.cjs
node --test --test-reporter=spec tests/adminRealEvents.test.cjs tests/adminEventStaff.test.cjs tests/adminEventOperation.test.cjs tests/adminEventSetup.test.cjs tests/roleRoutingIntegration.test.cjs
node --check tests/roleRoutingIntegration.test.cjs
```

| Execução | Aprovados | Falhos | Ignorados | Exit code |
| --- | ---: | ---: | ---: | ---: |
| Casos F1 antes da alteração funcional | 5 | 3 | 0 | 1 |
| Casos F1 após a correção | 8 | 0 | 0 | 0 |
| Cinco suítes diretamente afetadas, incluindo os casos F1 | 164 | 0 | 0 | 0 |

Antes da correção, F1-R01 e F1-R02 receberam o estado anterior na volta ao painel, mas o harness registrou a ausência dos dois GETs após confirmar a escrita. F1-R03 também falhou pela ausência das novas leituras enquanto o par anterior permanecia pendente. Após a correção, os casos conferiram atualização de fase e prontidão, descarte dos dois resultados antigos, uma única escrita em cada cenário, isolamento para outro UUID e uma sessão substituída, tratamento de resultado incerto e recusa, além de retorno ao foco e remontagem sem consultas extras. Os testes das sessões também exercitaram a preservação da chave e do corpo no reenvio explícito.

`node --check` retornou 0 para o CJS modificado. A leitura sintática dos quatro módulos JS com `@babel/parser` (`sourceType: module`, plugin JSX) e `git diff --check HEAD` retornaram 0. O harness emitiu avisos de depreciação do React Test Renderer e de nomes de componentes simulados. O Git emitiu aviso de conversão LF/CRLF da cópia de trabalho.

## Validação independente — Luna Medium

**Parecer A — Correção validada.** As campanhas foram executadas em `app` com `NODE_ENV=test` e transporte simulado. As duas primeiras usaram os comandos direcionados acima e a regressão completa usou `npm.cmd test`.

| Campanha | Aprovados | Falhos | Cancelados | Ignorados | Exit code |
| --- | ---: | ---: | ---: | ---: | ---: |
| Oito casos F1 isolados | 8 | 0 | 0 | 0 | 0 |
| Cinco suítes diretamente afetadas | 164 | 0 | 0 | 0 | 0 |
| Frontend completo | 986 | 0 | 0 | 0 | 0 |

O total corresponde aos 978 testes anteriores mais oito casos F1. As campanhas direcionadas estão incluídas na regressão completa. A validação confirmou o uso dos endpoints oficiais, o descarte de respostas obsoletas, o isolamento por evento, sessão e provedor e o retorno ao foco. Confirmou também que resultados ambíguos preservam a intenção e que a atualização automática não repete a escrita. Os testes de sessão conferiram a preservação da chave de idempotência e do corpo no reenvio explícito. A remoção das assinaturas no fim do efeito foi confirmada por inspeção.

As verificações de sintaxe, de whitespace, de aplicação isolada e de reversão do patch passaram. Os avisos de depreciação do React Test Renderer, nomes de componentes simulados, tipo de módulo e conversão LF/CRLF foram registrados como não bloqueantes.

## Revisão final do F1-01 — Astra High

**Parecer A — Fase 1 apta para merge.** A revisão estática confirmou que os dois cenários que bloqueavam a integração foram resolvidos:

- **Encerramento tardio.** O painel exibe o evento aberto enquanto a escrita está pendente. Após o recibo confirmado, novas consultas oficiais de detalhe e prontidão atualizam a fase para encerrado. O teste verifica uma única escrita.
- **Revogação tardia do último Staff elegível.** O painel exibe a prontidão anterior até o recibo da revogação. Em seguida, as consultas oficiais exibem configuração pendente e o motivo correspondente. O teste verifica uma única escrita com o `grantId` selecionado.
- **Respostas obsoletas.** Após `Promise.allSettled`, o painel verifica o ticket antes de interpretar o resultado de detalhe ou prontidão. Sucesso e rejeição antigos são descartados pela mesma guarda. O caso de uma rejeição GET antiga após a invalidação foi avaliado por inspeção estática, sem execução de um teste dedicado. A lacuna de cobertura foi classificada como não bloqueante.

O Astra não identificou impedimentos técnicos remanescentes para a integração em `develop` e não recomendou repetir campanhas antes do merge.

## Limitações e decisões de escopo

A concorrência foi exercitada de forma determinística pelo harness frontend. O responsável aceitou essa evidência automatizada para a correção localizada. A correção não passou por nova homologação em aparelho. Não houve alteração de backend, campanha backend ou PostgreSQL, nem acesso a banco ou serviço externo durante as campanhas de testes.

Os achados F1-02 (LF/CRLF dos patches), F1-03 (cobertura de chamadas externas pendentes), F1-04 (referência temporal do aparelho na edição) e F1-05 (aquisição de locks anterior a parte da autorização) mantêm suas classificações não bloqueantes. A sincronização automática do Participante fica para outra branch. A INFRA-01 permanece uma task independente, posterior à integração em `develop`.

## Aprovação formal e publicação

O responsável aprovou formalmente a ADMIN-F1-FIX-01 e autorizou staging, commit e push dos sete arquivos do inventário em `origin/feature/admin-event-operations`. A validação independente da Luna e a revisão final do Astra sustentam o fechamento técnico da Fase 1, sem bloqueantes identificados. O merge em `develop` depende de autorização separada.

Na conferência anterior à publicação, `develop` local e no `origin` apontavam para `5758fe1dcda104f6bfacf3ddb922a3711b088298`. A branch de entrega e sua referência no `origin` apontavam para a base da correção, `6acaf37feb452f6999c3e5296b636bcdd58958dd`. O índice real estava vazio e o working tree continha apenas os sete arquivos do inventário.

## Inventário

- `app/screens/admin/AdminRealEventScreen.js` e `app/screens/admin/useAdminEventPanel.js` — assinatura, revisão do estado e ciclo de vida.
- `app/screens/admin/adminStaffSession.js` e `app/screens/admin/adminOperationSession.js` — notificação de recibo confirmado no canal existente.
- `app/tests/roleRoutingIntegration.test.cjs` — oito casos de regressão F1 com respostas controladas.
- `docs/ADMIN_F1_FIX_01_IMPLEMENTACAO.md` — diagnóstico, implementação e evidências.
- `qa-evidence/ADMIN_F1_FIX_01-changes.diff` — patch consolidado dos seis arquivos anteriores sobre o HEAD indicado.

O patch anterior à consolidação continha seis arquivos, 293 inserções e 14 remoções. Na implementação e na validação independente, a aplicação em índice e diretório de objetos temporários sobre a base reconstruiu os seis blobs, e a verificação reversa contra o working tree passou. A publicação incorpora este fechamento documental à evidência consolidada.
