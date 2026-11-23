# ADMIN-06 — Correções complementares

[Estado atual — campanha complementar concluída](#consolidação-final-da-campanha-complementar). As seções anteriores registram o histórico das rodadas e suas pendências à época.

## Escopo e diagnóstico inicial

Complementar os testes da listagem Staff e corrigir separadamente dois casos HTTP de E08.11, do módulo de avaliações. A [campanha PostgreSQL anterior](./ADMIN_06_IMPLEMENTACAO.md#registro-final-da-campanha-de-integração-postgresql) registrou 47/47 aprovados. As novas asserções precisam de uma nova campanha.

Em E08.11, os casos de `submit` e `edit` deixavam a política real do Nest ler o TTL do processo e exigiam que a expiração estivesse exatamente 60 segundos à frente da janela da requisição. Com os 86.400 segundos informados pelo responsável, os dois endpoints encaminham uma expiração de 24 horas e a mesma asserção falha. A política converte segundos em milissegundos. O defeito identificado é a dependência ambiental dos testes, sem evidência de defeito na configuração ou na implementação de avaliações. O diagnóstico parte da falha reportada e da inspeção do código.

O GET Staff já ordena por data de concessão e, em caso de empate, por UUID do vínculo, ambos em ordem crescente. Os testes simulados cobrem lista vazia e recusa de Admin sem e-mail verificado antes da leitura de existência. A extensão prevista prova esses casos também em PostgreSQL real, junto do ciclo HTTP de concessão e revogação, da leitura a partir de uma nova instância Nest e do cenário de 80 vínculos persistidos.

## Correção de E08.11

A suíte HTTP agora configura o TTL de avaliação em 73 segundos antes de criar o módulo Nest e restaura o ambiente no encerramento, mesmo se o fechamento do servidor falhar. O teste de injeção do `EventsModule` também recebe TTLs controlados para as demais políticas que instancia. Cada caso afetado fixa `Date.now()` apenas durante o teste e exige o valor exato de `expiresAt` produzido pela política real. Permanecem as asserções de status, corpo, ator da sessão, chave de idempotência e normalização do payload. O TTL de produção e a implementação de avaliações foram preservados. [Suíte E08.11](../backend/test/unit/evaluation-write-http.test.ts).

## Seis cenários adicionais do GET Staff

| Cenário | Asserção | Referência |
| --- | --- | --- |
| Ciclo de mutações por HTTP | `POST grant → GET → POST revoke → GET`, com o mesmo `grantId` e remoção confirmada na leitura posterior. O instante de concessão é comparado na precisão comum aos contratos de POST e GET. | [Integração de papéis](../backend/test/integration/admin-role-management.integration.test.ts) |
| Equipe vazia | Evento existente retorna `200` com `{ eventId, items: [] }`. Evento ausente retorna `404 RESOURCE_NOT_FOUND`. | Mesma suíte |
| Empate de timestamp | Dois vínculos persistidos com o mesmo timestamp são inseridos na ordem inversa dos UUIDs. O GET devolve os UUIDs em ordem crescente e o mesmo timestamp com microssegundos. | Mesma suíte |
| Nova instância | Uma segunda instância Nest com pool próprio lê a mesma concessão enquanto a instância original permanece disponível para o restante da suíte. A instância adicional é fechada em `finally`. | Mesma suíte |
| E-mail do Admin não verificado | O GET retorna `403 ADMIN_EMAIL_UNVERIFIED` e o mesmo corpo de erro para o evento que tem Staff e para o UUID inexistente. | Mesma suíte |
| 80 vínculos persistidos | Identifica cada vínculo por `grantId`, verifica a forma da resposta e rejeita perdas, duplicatas e a presença de Staff do segundo evento. Mede a duração do GET local para diagnóstico e consulta usuários, papéis, sessões e eventos pelos UUIDs das fixtures após a limpeza. | Mesma suíte |

A verificação de volume usa dados sintéticos em PostgreSQL, sem limite fixo de latência. Ela mede a requisição HTTP local, sem medir renderização, rolagem ou desempenho da interface em aparelho com 80 integrantes. A limpeza reaproveita a transação existente. O `afterEach` continua responsável pela limpeza quando o teste falha antes da checagem posterior. A guarda de banco, o contrato de ordenação e os serviços usados no app permanecem inalterados.

## Verificações desta rodada

- Inspeção estática do fluxo HTTP, do cálculo de expiração, das asserções novas e do cleanup por UUID.
- `git diff --check` com exit code 0. O Git emitiu avisos LF/CRLF em arquivos preexistentes.
- A política do `AGENTS.md` reserva a execução de testes e typechecks para a etapa de validação com Luna Medium. Nesta rodada de implementação, não foram executados testes unitários, regressão geral, typechecks ou integração. A confirmação dinâmica das alterações fica pendente.
- A evidência de integração 47/47 e o resultado geral 1.296/1.298 do relatório principal são anteriores a esta rodada. A suíte PostgreSQL agora tem 53 casos previstos por inspeção, incluindo os seis novos.

## Comandos para a validação pendente

No PowerShell local, na pasta `backend`, usar um processo de teste isolado com Node compatível (`>=24.15.0`). Para rodar os testes simulados, manter o `.env` fora do carregamento e usar um destino local sem serviço. O valor de 86.400 segundos no processo é deliberado para verificar o cenário que antes causava as falhas de E08.11. O valor controlado de 73 segundos existe apenas dentro da suíte.

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/arenago_unit'
$env:DATABASE_DIRECT_URL = $env:DATABASE_URL
$env:EVENTS_TEST_DATABASE_URL = $env:DATABASE_URL
$env:EVALUATION_IDEMPOTENCY_TTL_SECONDS = '86400'
$env:ADMIN_IDEMPOTENCY_TTL_SECONDS = '60'
$env:STAFF_IDEMPOTENCY_TTL_SECONDS = '60'
$env:PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS = '60'
Remove-Item Env:RESEND_API_KEY, Env:RESEND_FROM, Env:EMAIL_VERIFICATION_CONFIRMATION_URL -ErrorAction SilentlyContinue
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/unit/evaluation-write-http.test.ts test/unit/admin-configuration-http.test.ts test/unit/admin-configuration.test.ts test/unit/admin-role-management-http.test.ts
& .\node_modules\.bin\tsc.cmd --project tsconfig.json --noEmit --incremental false
npm.cmd run typecheck:test
npm.cmd test
```

Registrar o exit code de cada execução e o resultado da suíte geral separadamente. Se `tsx` falhar na inicialização com `ENOMEM`, usar o PowerShell local do responsável, onde `os.userInfo()` já funcionou. A ausência de execução não equivale a aprovação.

A integração requer **nova autorização expressa**. Em outro processo PowerShell, validar o host, a porta, o banco `arenago_roles_test`, o papel conectado, as três URIs idênticas e o journal das oito migrations. Conferir por consultas somente leitura que o ambiente continua dedicado e sem Admin preexistente. Reutilizar a [preparação protegida da T6.1-D](./T6_1_D_IMPLEMENTACAO.md#preparação-e-comandos-powershell--somente-responsável), sem rodar migrations ou seeds, com o cuidado adicional de usar o journal atual de `0001` a `0008`. A inicialização do Nest pode inserir jogos canônicos e a versão inicial do questionário, como na campanha anterior. Após autorizar as escritas da suíte e confirmar o destino, executar somente o arquivo dedicado:

```powershell
$env:NODE_ENV = 'test'
$env:DOTENV_CONFIG_PATH = 'NUL'
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test --test-concurrency=1 test/integration/admin-role-management.integration.test.ts
```

Registrar exit code, contagens, diagnóstico do GET com 80 vínculos e as contagens finais das entidades de teste. Encerrar os processos isolados ao terminar. A aprovação formal da ADMIN-06 permanece sob decisão expressa do responsável.

## Correções após auditoria independente

A auditoria apontou que a validação textual das URLs não confirma a identidade da sessão PostgreSQL nem os atributos da role conectada. A correção deve verificar esses dados no catálogo antes de importar e iniciar o `AppModule`, que pode escrever jogos e questionários. A identificação física do processo que atende a porta local continua sendo uma conferência operacional independente.

A auditoria também apontou diferença entre a contagem anunciada e a contagem estática. A referência é a campanha histórica de 47 casos, que já incluía o GET de vínculos ativos e inelegíveis. A reconciliação compara os registros individuais do Git, esse cenário documentado e a expansão dos casos parametrizados.

### Pré-verificação do destino PostgreSQL

- [Guarda da integração](../backend/test/integration/admin-role-management-db-guard.ts). Mantém `NODE_ENV=test` e três URIs explicitamente iguais, com credenciais e destino `127.0.0.1:55432/arenago_roles_test`. Uma única sessão de pré-verificação executa quatro consultas `SELECT`. Elas conferem `current_database()`, `current_user`, `session_user`, endereço e porta do servidor, os cinco atributos de privilégio da role, as tabelas exigidas, as marcas `created_at` do histórico Drizzle frente ao journal do checkout e a ausência de concessões Admin, inclusive revogadas. O histórico é conferido pelas marcas do journal. A inspeção não recalcula hashes de migrações aplicadas nem prova a integridade de todos os dados.
- [Suíte de integração](../backend/test/integration/admin-role-management.integration.test.ts). Lê o journal local sem aplicar migrations. Só carrega a configuração do Nest e importa o `AppModule` após passar pela pré-verificação. A configuração do Nest é comparada com a URI validada antes de iniciar a aplicação. Se a pré-verificação falhar, a guarda libera o cliente, encerra o pool e emite diagnóstico fixo, sem repassar a exceção do driver. As fixtures e sua limpeza por UUID foram preservadas.
- [Testes da guarda](../backend/test/unit/admin-role-management-db-guard.test.ts). Usam um pool simulado e conferem a ordem das consultas, a ausência de inicialização após bloqueio, o fechamento dos recursos e a sanitização. Exercitam banco, usuário corrente, usuário da sessão, endereço, porta, cada atributo de privilégio, falhas de conexão e consulta, tabelas ou journal incompatíveis e Admin histórico. O caminho de sucesso verifica que a inicialização só ocorre depois das leituras.

O endereço, a porta e a identidade informados pelo SQL não comprovam a identidade física do servidor. Antes de autorizar a campanha, identificar de forma independente o processo que atende a porta `55432` e confrontá-lo com o serviço PostgreSQL local dedicado. Um túnel ou proxy invalida essa conferência. Após a guarda, o `AppModule` ainda pode inserir os jogos canônicos e o questionário inicial, que não pertencem à limpeza das fixtures. A campanha deve usar somente o banco dedicado autorizado.

### Contagem reconciliada da integração

| Referência | Chamadas diretas | Casos parametrizados | Total |
| --- | ---: | ---: | ---: |
| Arquivo no HEAD `5758fe1dcda104f6bfacf3ddb922a3711b088298` | 42 | 4 | 46 |
| Campanha anterior reconstituída pelo checkout e pelo relato | 43 | 4 | 47 |
| Suíte atual | 49 | 4 | **53** |

O `test()` indentado dentro dos dois loops está fora das 49 chamadas diretas. Ele registra quatro casos, com as combinações `grant/audit`, `grant/sql-after-write`, `revoke/audit` e `revoke/sql-after-write`. O cálculo anterior de 52 descontava uma chamada que já estava fora da contagem direta.

Na comparação individual, todos os 46 casos do HEAD permanecem e o GET de vínculos ativos e inelegíveis completa os 47 da campanha histórica. Esse GET aparece como adição em relação ao HEAD porque ainda não está commitado. Os outros seis testes são os da tabela de cenários adicionais deste relatório. Nenhum caso anterior foi removido ou precisou ser restaurado. Neste ajuste, mudou apenas a preparação da integração, sem alterações nos corpos dos cenários, nas fixtures ou nas asserções de E08.11. A versão histórica foi reconstituída pelo código e pelo relatório da campanha anterior. A saída nominal daquela execução não foi usada como evidência.

Para conferir nominalmente os registros a partir da raiz, as duas listagens abaixo mostram o HEAD e a suíte atual. A linha parametrizada deve ser expandida nas quatro combinações indicadas acima. Ao inventário do HEAD, somar o teste histórico `ADMIN-06 PostgreSQL lista apenas vínculos ativos do evento, inclusive contas inelegíveis`.

```powershell
$suite = 'backend/test/integration/admin-role-management.integration.test.ts'
git show "HEAD:$suite" | Select-String '^\s*test\s*\('
Select-String '^\s*test\s*\(' -LiteralPath $suite
```

### Validações sem banco nesta rodada

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run typecheck:test` em `backend` | Exit code 0, sem emissão de arquivos. |
| Sonda isolada `os.userInfo()` no Node v24.15.0 | Exit code 1, `ERR_SYSTEM_ERROR ENOMEM`. O `tsx` instalado usa essa chamada. |
| Guarda compilada para JavaScript temporário e executada com `node --test` | 18 aprovados, 0 falhas, 0 ignorados, exit code 0. |
| HTTP simulado de configuração Admin, papéis e E08.11, compilado para JavaScript temporário | 89 aprovados, 0 falhas, 0 ignorados, exit code 0 do runner. Os dois casos de TTL passaram com 86.400 segundos no processo antes do `before` da suíte. |
| `git diff --check` | Exit code 0, com avisos preexistentes de LF/CRLF. |

Para a guarda, `tsc.cmd` recebeu `--ignoreConfig --rootDir test --outDir $guardTemp --module commonjs --target es2022 --types node --esModuleInterop --strict --skipLibCheck` e os dois arquivos da guarda e de seu teste. A primeira tentativa, sem `--types node`, retornou exit code 2 na compilação e não iniciou o runner. A compilação corrigida retornou 0. O runner executou `node --test` sobre `unit/admin-role-management-db-guard.test.js` na pasta temporária.

Para HTTP, `tsc.cmd` recebeu as mesmas opções, com `--rootDir .`, saída `$httpTemp` e as opções `--experimentalDecorators --emitDecoratorMetadata`. Os arquivos foram `test/unit/admin-configuration-http.test.ts`, `test/unit/admin-role-management-http.test.ts` e `test/unit/evaluation-write-http.test.ts`. `node --test --test-concurrency=1 --test-reporter=spec` executou os três arquivos emitidos. O processo usou as configurações simuladas da seção anterior, incluindo `DOTENV_CONFIG_PATH=NUL`, URIs fictícias em `127.0.0.1:1`, TTL explícito e configuração Resend removida. `NODE_PATH` apontou para as dependências locais. O primeiro comando de remoção da pasta temporária HTTP recusou o caminho por diferença de barra final. A saída foi removida após conferir o caminho absoluto e o diretório pai. Os dois runners retornaram 0.

Os resultados de **1.298/1.298** em `npm.cmd test` e de exit code 0 em `npm.cmd run typecheck:test` foram informados pelo responsável para a versão anterior a esta correção. A suíte geral ainda precisa ser revalidada na versão atual. A integração real de 53 casos continua pendente e exige autorização expressa. Nenhum banco foi acessado nesta rodada.

### Procedimento para a integração posterior

Em uma sessão PowerShell local isolada, após autorização específica, listar os processos que escutam na porta com `Get-NetTCPConnection -LocalPort 55432 -State Listen` e consultar o executável com `Get-Process -Id` para cada processo responsável pelo listener pertinente. Conferir o caminho e o serviço contra a instalação local dedicada autorizada. Se houver túnel, proxy, processo desconhecido ou falta de evidência, interromper. Confirmar por leitura a identidade, o journal e o estado inicial do banco, preparar as três URIs idênticas sem exibi-las, retirar as variáveis de e-mail externo e executar somente o comando de integração documentado acima. Ao terminar, conferir as entidades persistidas e restaurar o ambiente do processo. A aprovação formal permanece com o responsável.

## Consolidação final da campanha complementar

### Regressão geral do backend

O responsável executou `npm.cmd test` no PowerShell local após as correções da guarda. A suíte registrou **1.312/1.312 aprovados**, 0 falhas, 0 ignorados, exit code 0 e duração total de aproximadamente 18,48 s. Os dois casos de E08.11 passaram sem reincidência das falhas. A correção isolou o TTL do ambiente e fixou o relógio nos testes para verificar a expiração exata.

Os resultados de 1.296/1.298 e 1.298/1.298 pertencem a versões anteriores da suíte geral. A integração histórica de 47/47 antecedeu a ampliação da cobertura do GET Staff.

### Auditoria independente e conferência do servidor

A Luna Medium revisou a guarda por inspeção. Confirmou que as consultas SQL são somente leitura e precedem a inicialização do Nest, que a guarda valida a identidade e os privilégios da conexão e que divergências interrompem o fluxo antes das escritas. Também confirmou a liberação do cliente e a tentativa de encerramento do pool nos caminhos de falha. A contagem estática reconciliou 47 casos históricos preservados e seis novos, totalizando 53. A auditoria liberou a execução condicionada à conferência operacional do PostgreSQL local.

O responsável confirmou o listener em `127.0.0.1:55432`, atendido pelo processo `postgres`, PID `9144`. O comando `netsh interface portproxy show all` não exibiu entradas. O caminho do executável não foi exibido. A checagem tem alcance limitado ao processo identificado e às regras de portproxy exibidas. A ausência de outras formas de túnel ou encaminhamento não foi comprovada.

### Integração PostgreSQL ampliada

O responsável executou exclusivamente `test/integration/admin-role-management.integration.test.ts` em ambiente isolado, com as três URLs apontando para o banco local dedicado `127.0.0.1:55432/arenago_roles_test`. As variáveis de ambiente originais foram restauradas ao final.

| Executados | Aprovados | Falhas | Ignorados | Exit code | Duração total |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 53 | 53 | 0 | 0 | 0 | Aproximadamente 4,90 s |

Os seis novos cenários do GET Staff passaram: concessão e revogação por HTTP com leitura após cada operação, equipe vazia, ordenação determinística com desempate por UUID, persistência em nova instância Nest, recusa de Admin sem e-mail verificado e listagem de 80 vínculos sintéticos persistidos. Os 4,90 s correspondem à suíte inteira. Este registro não dispõe da duração individual do GET com 80 vínculos.

### Conferência posterior do banco

O responsável consultou o banco em transação `READ ONLY` e encerrou a transação com `ROLLBACK`. O banco e o usuário conectado foram confirmados como `arenago_roles_test`.

| Tabela ou indicador | Resultado |
| --- | ---: |
| `users` | 0 |
| `events` | 0 |
| `user_roles` | 0 |
| `audit_logs` | 0 |
| `idempotency_operations` | 0 |
| `staff_idempotency_epochs` | 0 |
| Concessões Admin, inclusive revogadas | 0 |
| Migrations aplicadas | 8 |

As consultas não identificaram resíduos nas tabelas verificadas. A conferência se limitou às entidades da tabela acima.

### Estado técnico para avaliação de aceite

As campanhas técnicas planejadas foram concluídas com sucesso. A regressão geral encerrou a pendência de E08.11. A integração ampliada validou a cobertura adicional do GET Staff, inclusive o cenário automatizado de 80 vínculos persistidos no PostgreSQL real. Permanece a limitação de evidência sobre desempenho da interface em aparelho físico com 80 integrantes reais.

A ADMIN-06 reúne **403/403 testes frontend**, **1.312/1.312 testes da suíte geral do backend**, **53/53 testes de integração PostgreSQL** e homologação funcional anterior no Expo Go com **8/8 verificações funcionais e 5/5 complementares**. A entrega está **tecnicamente apta à avaliação de aceite**. A aprovação formal depende da manifestação expressa do responsável. [Registro consolidado no relatório principal](./ADMIN_06_IMPLEMENTACAO.md#consolidação-final-das-correções-complementares).
