# Preparação do schema de idempotência Staff — Etapa A

## Escopo e estado

Preparação local para origem e retenção futuras, conforme `docs/STAFF_IDEMPOTENCY_ORIGIN_RETENTION_DESIGN.md` e revisão Sol High. Na redação original deste documento, a migration `0007_staff_idempotency_preparation` estava **preparada e ainda não aplicada**. A atualização operacional abaixo registra uma campanha local posterior. A proteção completa de origem, a ativação de marcos, tombstones, compactação e reconciliação automática continuam não implementados ou habilitados.

## Atualização operacional — campanha local de 10/11/2026

A expansão preparatória das migrations `0006_admin_2fa_login` e `0007_staff_idempotency_preparation` foi aplicada e validada **somente no PostgreSQL local** `127.0.0.1:55432/arenago_events_test`, PostgreSQL 18.6. O journal Drizzle ficou com sete entradas e hashes compatíveis; o SHA-256 da migration `0007` foi `ad6e28f3bc1bf235986a66fefab201da05512acf58f875307918567e2917a00c`. Nenhuma migration foi aplicada no Neon.

Antes da aplicação foi produzido um backup PostgreSQL em formato customizado, com 1.179.941 bytes e SHA-256 `1D7D4A93499DD6E706008DB459945E620347CD3A240FAB12503ABDDECE1F1D38`. O catálogo e o conteúdo do dump foram lidos com sucesso; **não foi feito ensaio de restauração**, portanto a capacidade de recuperação não está comprovada.

Na campanha foram aprovados 1 teste PostgreSQL específico e 6 testes unitários, sem falhas. A suíte unitária anterior de 1.173 testes e os typechecks documentados adiante pertencem a campanhas anteriores; não foram repetidos nesta campanha.

A preservação foi verificada: 3.316 usuários e 604 operações de idempotência permaneceram com as mesmas impressões MD5 anteriores; não houve alteração nos registros legados. O teste confirmou rollback das fixtures por consulta independente (`ROLLBACK_FIXTURES_VALIDADO`). Ao final, `staff_idempotency_epochs` permanecia vazia e nenhuma operação tinha campos preparatórios ativados.

O resultado comprova a expansão preparatória neste banco local e os cenários exercitados nesta campanha. Não ativa `verified_v1`, epochs, tombstones, compactação, proteção completa por papéis ou reconciliação automática. O trigger instalado é preparatório, não impede `DELETE` ou `TRUNCATE` e não substitui controles futuros de privilégios. Operações Staff reais permanecem desabilitadas.

### Pendência de snapshots

`0005_snapshot.json` continua ausente. `0006_snapshot.json` representa o estado após as migrations `0006` e `0007`; seu `prevId` corresponde ao `id` de `0004_snapshot.json`. A comparação recursiva, removendo em memória as alterações esperadas, resultou em `SNAPSHOT_DELTA_ESPERADO`, além da validação offline anterior com Drizzle Kit registrada abaixo. Não criar snapshots artificiais nem alterar os existentes nesta atualização. Considerar a numeração e a cadeia antes de gerar futuras migrations.

Arquivos da entrega:

- `backend/src/database/schema/idempotency.schema.ts`: campos, tabela e checks preparatórios.
- `backend/drizzle/0007_staff_idempotency_preparation.sql`: DDL aditivo e trigger de atualização limitado.
- `backend/drizzle/meta/_journal.json` e `backend/drizzle/meta/0006_snapshot.json`: registro da migration e snapshot preparado.
- `backend/test/unit/schema.test.ts` e `backend/test/unit/staff-idempotency-schema-preparation.test.ts`: inventário e verificações de metadados/DDL.
- `backend/test/integration/staff-idempotency-schema-preparation.integration.test.ts`: teste PostgreSQL executado na campanha local descrita acima; preservar esse resultado separado dos testes unitários.
- Este relatório e `qa-evidence/STAFF_IDEMPOTENCY_SCHEMA_PREPARACAO-changes.diff`.

O documento arquitetural anterior pode existir como alteração local independente; não integra o patch desta etapa.

## Campos e controles preparados

`idempotency_operations` recebe `origin_session_id` UUID nullable, `origin_assurance` varchar(20) `NOT NULL DEFAULT 'legacy'`, `origin_epoch_id` UUID nullable, `result_state` varchar(20) nullable, e `completed_at` / `result_retain_until` timestamptz nullable. A constraint existente `(actor_user_id, operation, idempotency_key)` e os checks existentes de status e HTTP são preservados; a sessão não entra na chave única.

O check `ck_idempotency_staff_preparation_disabled` exige, para **todas** as operações, `origin_assurance='legacy'` e os outros cinco campos novos nulos. Assim o mesmo INSERT dos escritores atuais recebe o default conservador, e o UPDATE habitual de `in_progress` para `completed` continua previsto. O check rejeita `verified_v1`, origem, marco, estados de resultado e datas de retenção nesta etapa. Esse bloqueio é intencionalmente temporário e deverá ser substituído por migration revisada quando houver controles e autorização para a próxima etapa. Não há backfill de sessão, FK para sessão ou marco, nem índice adicional.

`staff_idempotency_epochs` prepara UUID, versão dos controles, referência de mudança, criação e campos de ativação/invalidação. A tabela começa vazia: não há INSERT na migration. O default é `pending`; `ck_staff_idempotency_epoch_pending` aceita somente `pending` com datas de ativação/invalidação nulas, e `ck_staff_idempotency_epoch_version` exige versão não vazia. A simples existência de uma linha pendente não constitui prova. Nenhum grant ou função de ativação foi criado.

O trigger `tr_staff_idempotency_preparation_guard`, `BEFORE UPDATE` e `SECURITY INVOKER`, compara `OLD` e `NEW` quando a operação antiga ou nova pertence às três operações Staff. Rejeita alteração de ID, ator, operação, chave ou fingerprint, inclusive mudança de namespace em qualquer direção. Para uma linha Staff já `completed`, também rejeita reabertura ou alteração do HTTP, referência ou payload terminal. Permite a conclusão normal de uma reserva `in_progress` e não muda `expires_at`; operações não Staff permanecem fora do filtro. A função não usa GUC, papéis inexistentes ou `SECURITY DEFINER` e não faz consultas de domínio nem altera a ordem de locks.

Na redação original, esses controles estavam **preparados no arquivo**, sem aplicação em banco. Em 10/11/2026, os checks e o trigger preparatórios foram instalados e validados no PostgreSQL local `127.0.0.1:55432/arenago_events_test`. Essa validação não os instala em outros ambientes. O mecanismo completo de segurança, prova de origem e retenção continua não implementado. Os checks impedem a gravação de `verified_v1` enquanto estiverem íntegros e sujeitos à fiscalização PostgreSQL; eles não impedem `DELETE` ou `TRUNCATE`, não protegem contra proprietário/superusuário que possa alterar DDL e não estabelecem retenção ou imutabilidade contra privilégios administrativos. Também não provam qual Bearer originou uma reserva. Correções manuais que antes alteravam identidade ou resultado terminal Staff seriam recusadas pelo trigger; sua compatibilidade operacional precisa de revisão antes de qualquer implantação adicional.

## Compatibilidade e metadados

O helper compartilhado não foi alterado; seus escritores Staff, Admin e participante não fornecem os campos novos e devem continuar utilizando os defaults. O trigger não exige papel Staff dedicado, nem modifica a semântica de replay ou executa compactação. Os endpoints históricos continuam retornando `originSession: "unavailable"` e `automaticReconciliation: false`. Essa compatibilidade é uma conclusão de inspeção estática e precisa ser demonstrada com os testes; mocks e DDL não comprovam permissões reais ou comportamento transacional no PostgreSQL.

A migration qualifica `public.idempotency_operations` nos dois `ALTER TABLE`, `public.staff_idempotency_epochs` no `CREATE TABLE`, e a função e a tabela do trigger no mesmo schema. As referências `OLD`/`NEW` são campos da linha alvo; o `search_path` da função permanece fixo em `pg_catalog`. Isso elimina a dependência do schema corrente para escolher essas tabelas.

O Drizzle instalado enumera todas as colunas do schema no INSERT, mesmo quando o chamador omite os campos novos e usa `DEFAULT`. Portanto **não iniciar nem liberar o backend atualizado contra banco sem a expansão 0007**: Staff, Admin, participante e avaliações podem falhar com coluna inexistente. O `SELECT 1` atual da inicialização do pool não comprova compatibilidade do schema; recomenda-se a conferência operacional de leitura abaixo em vez de alterar o startup nesta etapa.

A última migration registrada era `0006_admin_2fa_login` (índice 5); a nova é `0007` (índice 6), com timestamp do journal posterior. Antes desta entrega o último snapshot disponível era `0004_snapshot.json`, embora `0006` já estivesse no journal. `0006_snapshot.json` foi preparado manualmente a partir de `0004_snapshot.json`, incorporando os objetos da migration `0006` e desta `0007`; sua equivalência com o schema representado pelo gerador foi conferida offline conforme abaixo.

Uma tentativa anterior de `drizzle-kit generate` usou configuração temporária e ambiente de variáveis reduzido, mas foi iniciada com diretório de trabalho `backend`. A inspeção posterior do binário mostrou que ele inicializa `dotenv` automaticamente e pode ter lido `backend/.env`; nenhuma credencial foi impressa, o arquivo não foi modificado e não houve conexão com banco. A tentativa repetida usou diretório de trabalho temporário sem `.env` e também falhou com `uv_os_get_passwd / ENOMEM`. Em nova investigação, `os.userInfo()` falhou da mesma forma no isolamento e funcionou fora dele: a causa provável é a obtenção da identidade de usuário pelo ambiente isolado, antes da leitura do snapshot.

Com Node 24.15.0, TypeScript 6.0.3, Drizzle ORM 0.45.4 e Drizzle Kit 0.31.11 instalados, a comparação offline foi executada fora desse isolamento, em cópias temporárias sem `.env` ou credenciais e sem conexão ao banco. O gerador não produziu delta a partir do snapshot atual; um snapshot gerado do zero coincidiu recursivamente com o manual em todas as propriedades, exceto `id` e `prevId`, que identificam sua geração e cadeia. `drizzle-kit check` aprovou a cadeia na cópia. O delta gerado a partir de `0004` corresponde aos objetos representáveis das migrations `0006` e `0007`; o snapshot `0004` contém a tabela e os objetos da migration `0005`. As qualificações SQL explícitas em `public` e a escrita das expressões diferem textualmente da saída gerada. A função e a trigger personalizadas da `0007` foram inspecionadas separadamente e não são representadas pelo snapshot. Nenhum SQL foi executado.

O bloqueio específico de equivalência offline dos metadados representados pelo Drizzle foi resolvido. O ensaio físico autorizado já foi realizado no PostgreSQL local em 10/11/2026: um teste de integração foi aprovado e o rollback das fixtures foi validado por conexão independente. Esse resultado não prova o estado ou o comportamento em outros bancos. A aplicação em qualquer outro ambiente depende de validação própria, plano de implantação e aprovações necessárias.

O check aditivo e o trigger foram exercitados no PostgreSQL local 18.6 durante o ensaio de 10/11/2026. Permanecem pendentes ensaios adicionais de privilégios efetivos, concorrência avançada, restauração do backup, outros volumes e outros ambientes. A adição de coluna com default não prova, por si só, ausência de rewrite em qualquer versão. Não aplicar em outro ambiente sem plano de janela, timeout, backup e rollback aprovado. Como há nova tabela, campos e dados potencialmente futuros, remover a migration ou seus objetos não é rollback seguro automático; preservar dados/constraints e revisar um procedimento específico antes de qualquer execução.

## Ordem futura de implantação e pré-verificação em outros ambientes

1. Revisar código, DDL, snapshot e resultado das campanhas; obter aprovação específica da migration, destino, janela e rollback antes de qualquer aplicação. Confirmar independentemente identidade do banco/branch autorizados, sem imprimir connection strings.
2. Para um ambiente ainda não expandido, manter o backend novo parado ou sem tráfego de escrita. Após aprovação, expandir primeiro o banco autorizado com a `0007`; preservar os escritores antigos durante a expansão somente depois de demonstrar que continuam compatíveis com o trigger e os defaults. A campanha de 10/11/2026 expandiu somente o PostgreSQL local indicado acima; ela não autoriza expandir outros ambientes. Controlar locks e coordenar conexões antigas; não presumir compatibilidade ou disponibilidade.
3. Antes de liberar o backend novo, verificar por conexão **somente de leitura**, autorizada para essa campanha, a identidade do banco, os objetos em `public`, seus tipos/defaults/checks, a constraint única existente, o trigger e sua função, e a presença da entrada da `0007` no journal de migrations aplicado. O responsável deve comparar o hash registrado com o SHA-256 do arquivo SQL exato incluído no artefato implantado e o `when` do journal da entrega. Um journal sem objeto, objeto divergente, hash distinto ou visibilidade insuficiente é falha fechada, não prova de compatibilidade.
4. Somente após a pré-verificação, liberar o backend novo e validar, em campanha autorizada e com dados apropriados, Staff, Admin, participante e avaliações. Monitorar erros de schema/locks e preservar a versão anterior compatível disponível conforme o plano de rollback aprovado.
5. Se a expansão falhar, interromper a liberação do backend novo e qualquer tentativa automática de migration/retry. Verificar estado real da transação, journal, objetos e dados; não presumir rollback integral nem executar DDL destrutivo como recuperação. A retomada de escritores antigos exige confirmação de schema e compatibilidade pelo responsável; se houver dúvida, manter a escrita suspensa e investigar.

Exemplo de consultas **para futura campanha de leitura autorizada**; não foram executadas nesta tarefa. Execute-as no alvo previamente identificado e compare com a migration e o schema revisados. A primeira consulta da tabela de migrations falha se ela não existir, situação que deve interromper a liberação.

```sql
SELECT pg_catalog.current_database() AS database_name, current_user;
SELECT created_at, hash FROM drizzle.__drizzle_migrations WHERE created_at = 1794200000000;
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('idempotency_operations', 'staff_idempotency_epochs')
ORDER BY table_name, ordinal_position;
SELECT c.conname, c.convalidated, pg_catalog.pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid IN ('public.idempotency_operations'::regclass, 'public.staff_idempotency_epochs'::regclass)
ORDER BY c.conname;
SELECT t.tgname, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid) AS trigger_definition,
       pg_catalog.pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_catalog.pg_trigger t
WHERE t.tgrelid = 'public.idempotency_operations'::regclass
  AND t.tgname = 'tr_staff_idempotency_preparation_guard' AND NOT t.tgisinternal;
```

A conferência deve exigir todas as seis colunas de idempotência, os campos da tabela de marcos, defaults `legacy` e `pending`, nulabilidade e tipos esperados; os checks preparatórios validados, checks e unicidade existentes; e o trigger habilitado apontando à função correta com corpo revisado. Um registro no journal ou um nome de objeto isolado não comprova o conteúdo. A identidade do banco e a correção dos privilégios são verificações adicionais, e esse procedimento não autoriza executar a migration.

## Procedimento para conferir o snapshot offline

No terminal PowerShell, a partir de `backend`, com as dependências já instaladas, o trecho abaixo cria cópias temporárias dos metadados e executa somente `drizzle-kit generate`, sem URL ou credenciais no config e com diretório de trabalho temporário sem `.env`. Não usa `NODE_OPTIONS` nem conecta ao PostgreSQL. A primeira comparação usa o snapshot atual; a segunda usa os snapshots até `0004` e journal até a migration `0005` para gerar, em cópia, o delta esperado das migrations `0006` e `0007`.

```powershell
@'
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const backend = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arenago-0007-offline-'));
const sourceMeta = path.join(backend, 'drizzle/meta');
const original = JSON.parse(fs.readFileSync(path.join(sourceMeta, '_journal.json'), 'utf8'));
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'test' };
for (const mode of ['atual', 'base0004']) {
  const work = path.join(root, mode), out = path.join(work, 'drizzle'), meta = path.join(out, 'meta');
  fs.mkdirSync(meta, { recursive: true });
  for (const name of fs.readdirSync(sourceMeta)) {
    if (name === '_journal.json' || !name.endsWith('_snapshot.json')) continue;
    if (mode === 'base0004' && name > '0004_snapshot.json') continue;
    fs.copyFileSync(path.join(sourceMeta, name), path.join(meta, name));
  }
  const journal = structuredClone(original);
  if (mode === 'base0004') journal.entries = journal.entries.filter((entry) => entry.idx <= 4);
  fs.writeFileSync(path.join(meta, '_journal.json'), JSON.stringify(journal, null, 2));
  const cfg = path.join(work, 'drizzle.config.ts');
  const config = { dialect: 'postgresql', schema: path.join(backend, 'src/database/schema/index.ts').replace(/\\/g, '/'), out: './drizzle' };
  fs.writeFileSync(cfg, 'export default ' + JSON.stringify(config) + ';\n');
  const cli = path.join(backend, 'node_modules/drizzle-kit/bin.cjs');
  const result = spawnSync(process.execPath, [cli, 'generate', '--config', cfg, '--name', 'offline_equivalence'],
    { cwd: work, env, encoding: 'utf8', timeout: 40000 });
  console.log(mode + ': exit=' + result.status + '\n' + (result.stdout || '') + (result.stderr || ''));
  if (result.error || result.status !== 0) process.exitCode = 1;
}
console.log('Cópias e eventual DDL gerado: ' + root);
'@ | node
```

Para repetir a conferência, confirmar que a comparação `atual` não gera delta, validar a cadeia de IDs/journal com `drizzle-kit check` em cópia igualmente isolada, e comparar integralmente o DDL gerado de `base0004` com os objetos declarados pelas migrations `0006` e `0007`, incluindo tipos, defaults, constraints, FKs e índices. Usar saída relativa: a versão instalada combinou incorretamente caminho absoluto de saída no Windows. Ela também retornou código 0 para uma tentativa que exibiu erro de arquivo; conferir a saída e os artefatos, não apenas o código de saída. A função e o trigger da `0007` são SQL personalizado e exigem comparação/revisão separada. Nenhuma saída deve ser copiada automaticamente para o repositório ou aplicada ao banco.

## Testes e validação

Os testes unitários verificam tipos, defaults, constraint única, checks, journal, aspectos do snapshot e conteúdo da migration. Os testes existentes cobrem regressões de Staff, histórico, Admin e participante; os testes de histórico verificam que a reconciliação permanece desativada. Esses testes não comprovam a equivalência integral do snapshot nem o comportamento físico do DDL no PostgreSQL.

O teste PostgreSQL separado exige `NODE_ENV=test`, três URLs explicitamente iguais apontando a `localhost:55432/arenago_events_test`, sem parâmetros de redirecionamento; verifica `current_database()` e porta antes de iniciar a transação. Ele exige a migration previamente aplicada por responsável autorizado, cria apenas fixtures próprias dentro de uma transação Drizzle revertida e não executa migrations nem limpeza global. Usa o helper real para reserva, conflito de fingerprint, conclusão e replay em `call_next`, `complete_service_session`, `absent_service_session`, Admin e participante; prepara casos para unicidade, rejeição de prova/tombstone, alteração de identidade/namespace e marco ativo. Esses namespaces simulam operações do helper, não autenticação HTTP ou os serviços Staff completos. A asserção exige que o servidor veja a porta 55432; uma campanha com proxy ou mapeamento diferente precisa revisar a verificação de identidade antes de executar. O teste não verifica grants, ownership, papéis nem resistência a administrador. Uma campanha separada deve também testar registros criados **antes** da migration, preservando snapshots e dados preexistentes, mediante autorização específica.

Na campanha autorizada, o Codex com Luna executou os typechecks de produção e de testes: ambos passaram com código de saída 0. A tentativa inicial de executar os testes com `tsx` falhou na inicialização com `uv_os_get_passwd / ENOMEM`, antes de qualquer teste iniciar.

Posteriormente, o responsável executou manualmente o procedimento corrigido de compilação temporária e execução com Node. Conforme o resultado informado no terminal, o script executou primeiro os arquivos focados e, após sucesso, a suíte unitária completa, com **1.173 testes aprovados, 0 falhos, 0 cancelados, 0 ignorados e 0 pendentes (`todo`)**, seguido de `VALIDATION_SUCCEEDED`. Não foi informada uma contagem individual dos testes focados. Esta atualização documental não repetiu as suítes ou os typechecks.

Na campanha local de 10/11/2026 foi executado o teste PostgreSQL específico, com 1 aprovado e 0 falhas, após aplicação autorizada das migrations `0006` e `0007`. O teste confirmou seus cenários simulados com persistência real local e rollback das fixtures observado por consulta independente. Isso não comprova grants, ownership, resistência a administrador, coordenação entre dispositivos ou comportamento em Neon. Os resultados anteriores de 1.173 testes unitários e dos dois typechecks pertencem a outra campanha e não foram repetidos. Nenhum ensaio de restauração do backup foi realizado. Qualquer nova integração PostgreSQL exige campanha e autorização próprias; Neon não foi acessado.

## Dependências ainda não comprovadas

- Não foram verificados papéis, privilégios efetivos, ownership, heranças, separação de credenciais ou capacidade de criar funções/trigger no provedor. Um runtime proprietário pode contornar o check/trigger; a existência dos arquivos não cria uma fronteira de segurança.
- Faltam função de reserva/conclusão protegida, trigger de transições completo com `OLD`/`NEW` e autoridade por papel, proteção contra exclusão, marco durável ativável apenas após barreira verificada, executor transacional Staff e tratamento de versões antigas. A trigger atual é parcial e deverá ser revista/substituída, não confundida com esses controles futuros.
- Retenção, remoção ou pseudonimização de resultados, duração de tombstones, exclusão de conta e política de recuperação manual continuam sujeitos a decisão de produto, operação, segurança e privacidade. A FK atual para usuário permanece intacta.
- Antes de solicitar aplicação em Neon `dev-shared`, são necessárias revisão Sol High, consideração dos resultados do ensaio PostgreSQL local de 10/11/2026, aprovação específica da migration/rollback e confirmação independente de branch, banco, privilégios e preservação de dados. Esta atualização documental não autoriza nem executa essa aplicação.
