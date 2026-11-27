# ADMIN-09 — BI individual do evento

## Escopo e preparação

Implementação de leitura agregada por evento, tela administrativa real, atualização periódica e testes preparados. Exportação e divulgação demográfica real permanecem fora da entrega. Não implementar ADMIN-08/10/11/12 nem retomar INFRA-01.

Base: `de1275143a9d23c9fdbdd1ac171ed1a6acc05bd2`, develop confirmada por `git ls-remote origin`. Branch criada: `feature/admin-analytics`. Working tree inicialmente limpo. Nenhuma alteração da branch INFRA-01 incorporada. AGENTS.md lido; app/AGENTS.md ausente. Testes, typecheck e builds reservados à validação posterior.

Diagnóstico: tela AdminEventBiScreen usa contexto demonstrativo e não está registrada na navegação real. Preservada como arquivo legado para as regressões demonstrativas; a nova AdminRealEventBiScreen é a única ligada à área analytics do painel real. Endpoint de configuração já dispõe de sessão, Admin global, TOTP e snapshot repeatable read.

## Implementação e contrato

`GET /api/v1/admin/events/:eventId/bi`, Cache-Control no-store. Controller usa RequireSessionAuth, UUID validado pelo contrato compartilhado, executeConfiguration e revalidação SQL de Admin global, conta ativa, sessão vinculada/vigente e TOTP. O serviço consulta em transação repeatable read/read only: autorização, projeção oficial do evento e agregados. Evento ausente gera erro do contrato existente; não há mutações. Permite fases abertas, futuras e encerradas. Resposta validada por Zod, sem comentários ou identificadores pessoais.

Resposta: `event {id,name,timezone,effectivePhase}`, `observedAt`, `overview {participations,arenaEntries,completed,absent}`, `ranking [{id,name,completed,percent}]`, `ratings {count,mean,distribution:[{stars,count,percent}]}`, `durationA/durationB {meanSeconds,population}` e `audience {available:false,reason:PRIVACY_POLICY_PENDING}`.

Fórmulas:

- Participações: todas as linhas do evento; entradas: arena_entered_at não nulo. Reentradas são linhas distintas.
- Conclusões e ausências: service_sessions do evento por experiences, filtradas por completed/absent. Agregações independentes evitam multiplicação entre avaliações, participações e atendimentos.
- Ranking: conclusões por experiência / todas as conclusões × 100; somente experiências com conclusão, sem limite arbitrário, ordem quantidade DESC e UUID ASC.
- Avaliações: uma linha atual por participação (unicidade persistida); média avg(rating), distribuição completa 1–5 e percentuais sobre avaliações enviadas. Média nula e contagem zero sem avaliações.
- A: avg(epoch(max(resolved_at completed) − arena_entered_at)), por participação com entrada, resolução válida e intervalo não negativo, inclusive ativa. Não soma sessões.
- B: avg(epoch(finished_at − arena_entered_at)), somente finished/voluntary com entrada e intervalo não negativo. Não exige conclusão; exclui encerramentos automáticos/administrativos e cancelamentos. Populações independentes, segundos sem arredondamento individual; média nula quando vazia.

## Privacidade e snapshots

Inspecionados participations.service.ts e schema persistido: answers.schemaVersion=1, gender, games_snapshot com gameId/name/isCurated; age_band_at_event é gravado nulo e nascimento não é congelado. Não usar perfil atual para reconstruir idade. A preparação sintética deduplica por usuário, primeira entrada efetiva, desempate por UUID; recusa mistura de versões, conta escolhas múltiplas e usa denominadores válidos por dimensão. Nomes de jogos livres não são divulgados. A supressão rejeita a dimensão inteira se qualquer célula ou complemento tiver menos de 10, sem publicar denominadores ou categorias suprimidas. Isso não equivale a anonimização ou aprovação D10.

O endpoint real não executa a preparação demográfica, não consulta snapshots pessoais e sempre responde indisponibilidade. Não existe parâmetro de cliente ou flag de ambiente para contornar o bloqueio. Faixa etária permanece nula também na preparação sintética. Nova autorização e revisão de privacidade são necessárias antes de qualquer divulgação real.

## Frontend e atualização

AdminRealEventBiScreen reutiliza cabeçalho Admin, tema, cards e abas. Retorna ao UUID selecionado, mantém logout somente na Home. Quatro métricas, ranking e distribuição por barras acessíveis, médias e populações A/B, horário no fuso do evento e aviso parcial/encerrado. Sem exportação e sem expressão tempo real. Não foi adicionada biblioteca gráfica; barras usam Views nativas. Layout flexível permite empilhamento em telas pequenas. A distribuição mantém cinco categorias em vez do agrupamento opcional 1+2 do protótipo.

useAdminBi consulta inicialmente, manualmente, a cada 30 segundos somente com foco/foreground, e ao recuperar foco/foreground. Bloqueia sobreposição no mesmo escopo, invalida resultados por geração/identidade/cliente/evento e encerra timers/listeners. Dados válidos são mantidos durante atualização e falha de rede, com aviso desatualizado e horário anterior. Negação 401/403/404 elimina dados. O transporte existente não é alterado: requests em andamento são invalidados logicamente, sem pressupor cancelamento físico. Nenhuma fixture serve como fallback.

## Fontes e limites

Consultados arquitetura backend, Panorama (seção 3.8 e D08/D10), consolidação do Panorama, relatórios administrativos, schemas e serviços reais. Planejamento separado não encontrado; suas decisões estão consolidadas no Panorama e documento histórico. Não há mudança em Staff/Participante, auth, migrations, INFRA-01 ou funcionalidades futuras. Homologação visual em aparelho, auditoria de segurança e execução automatizada permanecem pendentes.

## Testes preparados e validação necessária

- Unitários admin-bi: SQL parametrizado/escopo, fórmulas, contrato vazio, supressão, primeira entrada, deduplicação e snapshots.
- admin-configuration: BI em snapshot somente leitura, Admin/sessão/TOTP/revogação, evento vazio/ausente e fase oficial.
- HTTP simulado: rota incluída na matriz existente de contrato, UUID, autenticação, TOTP e recusa Staff. Índices históricos da matriz preservados.
- Frontend adminBi: contrato/UUID, vazios, indisponibilidade, navegação, foco/foreground, leitura pendente sem sobreposição, intervalo, erros/negação e respostas tardias por conta/evento/unmount. Harness ganhou mock AppState removível. Regressão de destino analytics atualizada; telas demo legadas preservadas.
- Integração admin-bi.integration: usa guarda legada de arenago_roles_test local 127.0.0.1:55432, três URLs idênticas/NODE_ENV=test, identidade/privilégios/migrations e ausência de Admins históricos. Executa o SQL sobre fixtures de sessão temporárias com tipos derivados das tabelas reais, sem gravar tabelas públicas. Rollback/finally fecha recursos. Cobre vazio, evento diferente, reentrada, entrada ausente, múltiplas sessões, ausência/cancelamento, edição de nota e populações A/B. Não valida constraints das fixtures (CREATE TABLE AS preserva tipos, não constraints) nem carga/planos de execução. Exige autorização separada e banco dedicado conferido; nunca usar arenago_events_test inconclusivo da INFRA-01.

Comandos preparados, **não executados** nesta implementação:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\app
$env:NODE_ENV='test'
node --test --test-reporter=spec tests/adminBi.test.cjs tests/adminRealEvents.test.cjs tests/adminNavigation.test.cjs tests/roleRoutingIntegration.test.cjs
npm.cmd test
Set-Location ..\backend
npm.cmd run typecheck:test
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json
node --import tsx --test test/unit/admin-bi.test.ts test/unit/admin-configuration.test.ts test/unit/admin-configuration-http.test.ts
# Somente em campanha PostgreSQL separadamente autorizada e URLs locais conferidas:
node --import tsx --test --test-concurrency=1 test/integration/admin-bi.integration.test.ts
```

As regressões preparadas não são resultados aprovados. Medição de desempenho, concorrência real e cobertura adicional de datas anômalas/ranking empatado devem ser conferidas na revisão independente. Nenhum banco foi acessado nesta rodada.

## Inventário da entrega

Modificados: app/screens/admin/AdminEventManagementInfoScreen.js; app/tests/adminRealEvents.test.cjs; app/tests/helpers/questionnaireHarness.cjs; backend/src/events/admin-configuration-query.service.ts; backend/src/events/admin-configuration.controller.ts; backend/test/unit/admin-configuration-http.test.ts; backend/test/unit/admin-configuration.test.ts.

Novos: app/screens/admin/AdminRealEventBiScreen.js; app/screens/admin/useAdminBi.js; app/services/adminBiService.js; app/tests/adminBi.test.cjs; backend/src/events/admin-bi.ts; backend/test/integration/admin-bi.integration.test.ts; backend/test/unit/admin-bi.test.ts; este relatório. Evidência: qa-evidence/ADMIN_09-changes.diff, excluindo a si própria.

## Verificações efetivamente realizadas

Inspeção sintática com TypeScript createSourceFile/parseDiagnostics e Babel parser JSX/CJS: zero erros nos arquivos de código alterados. Não é typecheck nem teste. git diff --check e validação de aplicação em índice/objetos isolados, reversão contra working tree e correspondência de blobs fazem parte da geração do patch. Índice real preservado, sem staging/commit/push. SHA-256 informado na entrega, sem autorreferência circular no patch. Aprovação final depende da validação independente e homologação do responsável.

## Correções após validação independente

Campanha anterior: frontend direcionado 119/120, uma falha; oito casos adminBi aprovados. Typechecks de aplicação e testes aprovados, exit 0. Backend direcionado não inicializou por ENOMEM; suíte completa frontend inconclusiva. Esses resultados antecedem esta correção.

Causa confirmada por inspeção: questionnaireHarness mantém um único vetor/cursor de hooks para toda a árvore. A troca por setProps de analytics para o placeholder reutilizava posições de useAdminBi em useAdminEventPanel, incluindo estado congelado em posição de ref. O teste agora desmonta BI em finally e monta a área inválida em harness independente, também com finally, mantendo UUID, retorno, autenticação e ausência de consultas na área inválida. Nenhum código de produção foi alterado.

A assertion reprovada interrompia o teste antes de unmount, deixando o intervalo de BI ativo. A limpeza agora ocorre mesmo em falha. Isso comprova uma retenção nesse caminho, sem atribuir toda a suíte completa inconclusiva a essa causa. Inspecionados timers, listeners AppState e promises dos demais testes novos: todos desmontam em finally; a limpeza do hook cancela intervalo e remove listeners. Promises deliberadamente pendentes simulam transporte sem resposta e não possuem recursos externos ou timers próprios.

Integração preparada ampliada: participação ativa com entrada às 11h e última conclusão às 10h não altera população A (1) nem média (1500 segundos); B permanece igual. Preservados cenário negativo B, populações independentes, empate por UUID e avaliação editada. Fórmula de produção preservada.

Verificações desta correção: inspeção sintática por Babel parser e TypeScript createSourceFile/parseDiagnostics; integridade do patch por aplicação em índice e objetos temporários, comparação de blobs e reversão contra working tree; git diff --check e índice real vazio. Testes, typecheck e builds não executados nesta rodada. Aprovação depende de nova campanha sem force-exit e homologação do responsável.

## Correção pontual de UTF-8 na assertion

O responsável informou nova campanha local com 119/120 e encerramento natural, sem recorrência do erro de hooks. A falha restante esperava literalmente `?rea indispon?vel`, enquanto o componente renderiza `Área indisponível`. Confirmados os pontos de interrogação ASCII nos bytes UTF-8 do teste, introduzidos pela passagem anterior de texto pelo pipeline do PowerShell. Corrigidas também a assertion de `Nome não confiável`, a mensagem de erro do mock e a seção histórica acima, atingidas pela mesma corrupção. Demais strings adicionadas no patch inspecionadas. Cenário de área inválida, montagens independentes e finally preservados; produção inalterada.

Parser Babel sem erros; patch regenerado e validado por aplicação isolada, blobs e reversão, com índice real vazio e git diff --check aprovado. Testes e typecheck não executados; a aprovação do teste corrigido permanece pendente.

## Encerramento aprovado pelo responsável

O responsável aprovou a ADMIN-09 dentro do escopo estabelecido e informou os resultados finais abaixo, posteriores às campanhas históricas registradas acima:

- Revisão estática independente favorável; correções do harness e das strings corrompidas validadas.
- Validação automatizada local concluída com sucesso. Suíte completa frontend aprovada; quantidade final não informada. Ambos os typechecks backend aprovados.
- Backend completo: 1.352/1.352, sem falhas, cancelamentos ou casos ignorados.
- Integração PostgreSQL: 1/1, sem falhas, utilizando a role e o banco dedicado `arenago_roles_test`. Qualificação prévia somente leitura aprovada; não foram necessárias alterações de permissões ou migrations.
- Homologação visual confirmada pelo responsável.

Permanecem as seguintes limitações e registros para trabalho posterior:

- Divulgação demográfica real bloqueada até aprovação da política de privacidade; faixa etária indisponível por ausência de snapshot histórico adequado.
- Exportação adiada conforme o escopo aprovado.
- A integração PostgreSQL valida agregações SQL; não cobre o fluxo HTTP completo com banco real.
- Durante a homologação foi observada ocorrência de ingresso pendente na conta de participante, sem vínculo comprovado com a ADMIN-09; investigar posteriormente, fora desta task.
- A formatação de datas ISO na confirmação de ingresso também foi identificada para revisão posterior.

Os resultados acima foram informados pelo responsável; esta atualização de encerramento não repetiu campanhas nem acessou bancos.
