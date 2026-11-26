# INFRA-01 — Infraestrutura de integração PostgreSQL

## INFRA-01.D1.3 — Correção sintática da regressão de entrypoints

O responsável encontrou TS1005 na linha 689 de `integration-campaign.test.ts`. O bloco `test(..., async () => { ... })` terminava incorretamente em `}));`, como se também fechasse um wrapper externo. Corrigido somente para `});`, preservando todas as assertions e a instrumentação. O parser TypeScript (`createSourceFile`/`parseDiagnostics`) examinou os seis arquivos TS alterados na rodada de instrumentação e retornou zero erros sintáticos em cada um, exit 0. Não foram executados testes, typecheck, campanhas, SQL ou recuperação. Patch de entrada: `BB57630A2C32AE821CD2C8081C7EF7D6418F0E606F9B4E3539AD23C15A93862B`. A validação automatizada da versão corrigida permanece pendente.

## INFRA-01.D1.3 — Instrumentação temporária do piloto real

Os dois incidentes D06 continuam inconclusivos; nenhum defeito causal foi comprovado por inspeção. A combinação `journal-admission` no console com registro `running/launched` não descreve uma única admissão normal. Esta rodada acrescenta rastros sanitizados para correlacionar processos e etapas **antes** de qualquer nova campanha autorizada, sem alterar a guarda, o banco, a referência, o journal ou os contratos de negócio. Patch de entrada: `898EFBB437960D36BE25F369BBEE947A8DB20A181677848D294800BCA2E4B0DD`.

O executor registra linhas `[INFRA_PILOT_TRACE]` com evento fixo, `executionId` UUID por processo, PID, PPID, campanha conhecida, contagens de `main`/`executePilotCampaign` e, no catch, apenas etapa e código já sanitizados. O orquestrador registra criação da campanha, admissão, lançamento, gravação `running`, autorização, resultado, catch, tentativas de persistência terminal e conclusão. O worker envia pelo IPC apenas eventos de uma lista fechada, UUID de execução próprio, PID/PPID, ID da campanha e contagem de entrada; o supervisor confere campanha e PID do filho antes de publicar a linha no console. Esses eventos são **informativos**, não concedem autorização, não substituem `ready/started/result` e não mudam o estado do journal. Falha ao emitir um rastro não deve alterar o resultado da campanha. Não são registrados senha, URI, argumentos, ambiente, exceção bruta, stdout/stderr do worker ou payload de testes. O rastro `executor-process-exit` cobre encerramento normal do Node; sua ausência não prova causa específica, mas indica que a saída normal não foi observada.

Regressão preparada em `integration-campaign.test.ts` usa `node --require pilot-loader.cjs` com os **entrypoints reais** do executor e do worker, processos reais e supervisor IPC real. A ação/suíte são deliberadamente inválidas e o ambiente omite URLs, garantindo rejeição antes de PostgreSQL, pools, fixtures e Nest. Ela confere as entradas, PIDs, UUIDs e contagens, além de recusar exposição de URI. A cobertura anterior de admissão concorrente com journal de arquivos temporários permanece. A nova regressão não exercita autorização e runner reais; estes exigem a campanha PostgreSQL separadamente autorizada. Nenhum teste/typecheck foi executado nesta rodada.

### Sequência operacional única — condicionada a autorizações separadas

1. **Validação local pela Luna Medium:** no diretório `backend`, executar `npm.cmd run typecheck:test` e `npm.cmd test` após inspecionar os scripts; registrar resultados. Não avançar se falharem. Conferir `git diff --check` e o SHA do patch informado na entrega. Esses comandos não executam integração PostgreSQL.
2. **Recuperação do segundo incidente:** obter autorização nominal específica para `7389cbd9-5932-42c7-a188-e838d40b974f` e seguir integralmente o roteiro BC-07 da seção de investigação logo abaixo, substituindo UUID, PIDs e tokens de confirmação ali listados. Reconfirmar processos ausentes, exclusividade SQL, identidade, baseline, arquivo protegido, ACLs e hashes antes de retirar somente o registro deste UUID e `occupied` por último. Preservar a limitação de continuidade integral sem snapshot pré-incidente. O Codex não executou essa recuperação.
3. **Check sem elevação:** somente depois da reconciliação autorizada, em PowerShell 5.1 sem elevação e `C:\DoJob\ProgramacaoMobile\backend`, com variáveis sensíveis removidas conforme o runbook anterior: `$env:NODE_ENV='test'; $infraBin='C:\Program Files\PostgreSQL\18\bin'; $infraData='C:\Program Files\PostgreSQL\18\data'; $infraFingerprint='d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180'; node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts check $infraBin $infraData $infraFingerprint`. Exigir exit 0, autoridade/domínio aprovados e nenhum SQL. Check não autoriza campanha.
4. **Nova D06 instrumentada:** solicitar autorização explícita para **essa campanha**. Na mesma conta sem elevação, janela exclusiva e ambiente conferido, executar somente `node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts D06 $infraBin $infraData $infraFingerprint`. Fornecer senha apenas ao prompt sem eco. Registrar o exit code, todas as linhas `[INFRA_PILOT_TRACE]`, o diagnóstico final e o JSON do registro por ID, com dados sanitizados; não gravar senha nem usar transcript de terminal. Correlacionar `executionId`/PID/PPID e `campaignId`: mais de um `executor-entry` com IDs distintos aponta para mais de um processo; contagem >1 no mesmo ID aponta para reentrada; `journal-claim-start` sem `passed` localiza rejeição; `running-saved` seguido de `worker-entry`, `ipc-ready`, `ipc-started`, `runner-enter` distingue avanço do worker; `campaign-catch`/`terminal-save-*` e `executor-process-exit` distinguem tratamento controlado de perda de supervisão. Ausência de evento não prova isoladamente que a etapa não ocorreu, pois saída abrupta pode perder rastros em buffer. **Não iniciar D09 ou both** até D06 e recuperação estarem concluídas e analisadas.

Se o segundo incidente não for recuperado com evidência suficiente, se a validação local falhar ou se a autorização nominal não for concedida, interromper antes da nova D06. Nenhuma operação desta sequência foi executada pelo Codex nesta rodada. A instrumentação é temporária e deverá ser removida ou revista após o diagnóstico conclusivo, com nova validação.

## INFRA-01.D1.3 — Investigação integrada do segundo incidente D06

Evidência local informada pelo responsável: typecheck aprovado; infraestrutura/orquestração 225/225, guardas legadas 81/81, três regressões PowerShell e três checagens de sintaxe aprovadas, sem falhas, skips, cancelamentos ou TODO. Esses resultados pertencem ao patch de entrada `090720F869BAE70E2C0963067CFB20546240D823C18676FAFA0240FA26D01159`; não foram repetidos pelo Codex nesta rodada. A segunda D06 foi iniciada uma vez explicitamente por `Invoke-InfraPilot` em PowerShell sem elevação, com `node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts D06` e os três argumentos de identidade locais. O check anterior passou. D09/both não iniciadas.

Campanha `7389cbd9-5932-42c7-a188-e838d40b974f`, supervisor 39420, worker 36400: a saída foi `campaign-stage=journal-admission; code=unavailable`, enquanto o JSON sanitizado e persistido tem `phase=running`, `preflight=passed`, `lock=acquired`, tentativa `launched`, postflight/resources pendentes e `recoveryPending=true`, sem campos `failure`, `diagnosis` ou `terminalPersistence`. A pesquisa posterior de processos por linha de comando foi vazia. O primeiro incidente, de estado semelhante, já havia sido recuperado e arquivado antes desta tentativa.

### Conclusões por inspeção do código

- `pilot-executor.ts` só chama `main()` quando `require.main === module`; `pilot-worker.ts` tem seu próprio entrypoint, e a árvore de imports das suítes D06/D09 e de `admin-event-operations-db-guard.ts` não importa o executor. `pilot-loader.cjs` apenas transpila módulos TS. Não foi encontrado caminho estático que reexecute `main()` no worker. A árvore completa de processos não foi capturada, portanto duplicação externa/interna não está descartada.
- Na mesma chamada de `executeCampaign`, a única admissão (`campaign-orchestrator.ts`) ocorre antes de preflight, `save("running")` e lançamento. `pilot-executor.ts` envolve essa chamada novamente com `campaignStep('journal-admission')`. `campaignFailure` preserva a etapa original de um `CampaignDiagnosticError`; não existe remapeamento posterior de falha do worker para `journal-admission`. Portanto **o diagnóstico exibido não pode ser a falha de admissão inicial da mesma execução que persistiu este registro `running/launched`**, no fluxo normal inspecionado.
- Uma segunda tentativa concorrente ou reentrante encontra `occupied`, recebe `journal-admission` e deixa intacto o registro `running` da primeira. Foi preparada regressão inofensiva com journal real de arquivos temporários e dependências SQL/worker simuladas que reproduz precisamente essa combinação. Isso demonstra uma explicação *possível*, não prova que ocorreu na máquina do responsável. A função PowerShell documentada invoca o comando uma vez por ação; não há segunda invocação explícita informada.
- Uma exceção controlada após `launch` passa pelo `catch` do orquestrador, que tenta salvar fase terminal inconclusiva antes/depois de fechar o lease. A falta desses campos no último JSON significa que nenhuma gravação terminal foi confirmada. As causas possíveis incluem encerramento abrupto do supervisor, falha nas duas tentativas de salvar ou saída de diagnóstico pertencente a outro processo. Sem árvore/process exit, saída correlacionada por PID e evidência da tentativa de persistência, nenhuma delas está comprovada. `launched` não prova se houve autorização IPC ou execução de testes, porque `authorized` só é persistido na transição seguinte.

**Decisão de correção:** nenhuma guarda, timeout, entrypoint ou regra de journal foi modificada por hipótese. O bloqueio é fail-closed e o segundo registro permanece inconclusivo. A regressão preparada cobre a distinção entre uma admissão concorrente e o registro anterior, sem acessar PostgreSQL. O defeito causal dos dois incidentes continua **não identificado**; não autorizar nova D06 apenas com a aprovação simulada. Para uma investigação conclusiva após recuperação autorizada, correlacionar PID/horário/exit code do único Node invocado, árvore de processos capturada durante a execução e evidência protegida de `failure`, `cleanupFailures` e `terminalPersistence`; nenhuma dessas evidências foi inventada.

### Reconciliação e recuperação do segundo incidente — não executadas

Reutilizar o roteiro BC-07 completo desta documentação, na seção “Recuperação específica do incidente 2d4efb12-e625-40c2-8784-dfd71c703e40”, **somente em nova cópia local revisada e após autorização nominal específica para `7389cbd9-5932-42c7-a188-e838d40b974f`**. Substituir exclusivamente: UUID antigo pelo novo em caminho, `infraIncident` e evidências; PIDs 42084/27264 por 39420/36400; tokens de confirmação `ARQUIVAR-2d4efb12` e `RECUPERAR-2d4efb12` por `ARQUIVAR-7389cbd9` e `RECUPERAR-7389cbd9`. Preservar os fingerprints, digest e identidade física homologados. Não executar o roteiro antigo diretamente, pois ele aponta para outro incidente.

Antes de arquivar, reconfirmar identidade física/ACL/SID do domínio e autoridade, exclusividade operacional, ausência dos **dois processos e de PID reutilizado**, ausência de outras sessões, transações preparadas e advisory locks, e qualificação D1.1 somente leitura do baseline, migrations e estrutura. Registrar a limitação de continuidade integral caso não exista snapshot pré-incidente. Arquivar integralmente o journal fora do domínio ativo, em área administrativa protegida, conferindo inventário, ACLs e SHA-256 de originais e cópias. Obter confirmação nominal separada para retirar **somente** o JSON deste UUID, `occupied/owner` e `occupied` por último; preservar a raiz física, `campaigns`, autoridade, referência e `pilot-domain.json`. Se houver outros registros inconclusivos, mudança de identidade ou qualquer verificação inconclusiva, interromper sem retirada. Conferir domínio e arquivo após a ação; executar `check` em console sem elevação, sem conexão SQL. Não converter o resultado arquivado em `clean` e não iniciar D06/D09/both automaticamente.

Nesta rodada, não foram executados testes, typecheck, campanha, SQL, recuperação ou operações de permissão. Arquivos alterados: regressão simulada em `integration-campaign.test.ts`, este relatório e patch acumulado. A regressão preparada requer execução posterior pela Luna Medium; não implica homologação real.

## INFRA-01.D1.3 — Assertion do diagnóstico sanitizado da autoridade

O responsável informou typecheck aprovado e regressão simulada com 224/225 testes aprovados, zero cancelados, skips ou TODO. A única falha foi `D1.2 recusa autoridade sintética antes da primeira conexão real`, em `integration-campaign.test.ts`: a assertion esperava a mensagem antiga `sem aprovação`, mas a D1.3 encapsula a recusa como `[SEGURANÇA BLOQUEADA] campaign-stage=reference; code=unavailable.`. O comportamento de bloqueio ocorreu; a divergência é do contrato de diagnóstico do teste.

A assertion agora exige `CampaignDiagnosticError`, etapa `reference`, código `unavailable` e a mensagem sanitizada exata. O teste também confere zero leituras da fonte e zero solicitações de conexão, pool, journal ou worker, além do registro de eventos vazio. Assim, a autoridade sintética continua rejeitada antes da primeira conexão e sem recursos de escrita solicitados. A inspeção estática das demais assertions relacionadas mostrou que as verificações diretas de `loadCampaignReference` continuam usando seu contrato próprio, enquanto as demais assertions de `executePilotCampaign` tratam seleção inválida ou resultados de campanha, sem expectativa equivalente de mensagem pré-D1.3. Nenhum código funcional foi alterado.

Patch de entrada: `34251C9B4E411A0CC3045F3D56FE245D6E5AFFF96AF18844494ADF4F3DC113C6`. Nesta rodada, Codex alterou apenas o teste, este relatório e o patch acumulado; não executou testes, typecheck, campanhas ou SQL. A versão corrigida aguarda revalidação pela Luna Medium ou pelo responsável. A recuperação administrativa aprovada e a limitação de continuidade integral do baseline descritas abaixo permanecem válidas.

## INFRA-01.D1.3 — Recuperação aprovada e correção pontual TS18048

O responsável confirmou a conclusão bem-sucedida da recuperação administrativa do incidente 2d4efb12-e625-40c2-8784-dfd71c703e40. Manifesto SHA-256: C21CF97C86F3DEEBF49236DC2056A1D98AD892B953CF276EC80AEC216BE3D982. O check posterior foi aprovado, sem conexão SQL. Essas são evidências de execução local informadas pelo responsável; o Codex não executou recuperação, check ou consultas nesta rodada. As descrições anteriores de journal running/occupied são histórico anterior à recuperação, não o estado atual confirmado.

Permanece a limitação histórica: não existia snapshot integral das linhas imediatamente anterior ao incidente, portanto continuidade integral do baseline não foi comprovada pela recuperação. A aprovação da recuperação/check não aprova uma campanha D06, D09 ou both nem transforma o resultado inconclusivo arquivado em clean.

O typecheck local apontou um único TS18048 em campaign-orchestrator.ts: a variável handle, mutável e opcional, perdia o estreitamento dentro do callback de journal-finish. A correção captura o valor em const finishingHandle e verifica sua presença antes de passá-lo ao callback. finish continua obrigatório e aguardado, sem coerção, optional chaining ou supressão de diagnóstico. Ausência ou rejeição continua passando pelo catch existente, preservando recuperação e tratamento de falhas. Nenhuma outra alteração funcional ou de teste foi realizada nesta rodada.

Patch de entrada FA61DB482D01CAA20BC38990D87D89A0914CA64FE4A73209B6FDE6578091DB79. Arquivos alterados: campaign-orchestrator.ts, este relatório e patch acumulado. Inspeção estática e integridade Git/patch apenas; testes e typecheck não executados. O typecheck da versão corrigida permanece pendente da Luna/responsável: em backend, `npm.cmd run typecheck:test`. Nenhum acesso a banco, alteração de permissões/journal, campanha ou commit foi executado. Branch/HEAD e índice real preservados.

## INFRA-01.D1.3 — Recuperação específica do incidente 2d4efb12-e625-40c2-8784-dfd71c703e40

Evidências informadas pelo responsável: supervisor 42084 e worker 27264 ausentes; SQL com identidade correta, zero outras sessões/transações preparadas/advisory locks; 20 jogos e um questionário; qualificação estrutural D1.1 exit 0, 608 objetos e 40 FKs conferidos, tabelas operacionais vazias, fingerprints e digest homologados preservados. O journal continua running/launched/recoveryPending=true e occupied preservado. **Não há snapshot integral das linhas imediatamente anterior ao incidente: continuidade integral das linhas não está comprovada.** A recuperação aceita somente o baseline atual qualificado, com essa limitação registrada expressamente. Não converte o registro em clean nem declara testes reais executados/aprovados.

Patch de entrada 07404CB9B8E6BB2CD57E0B371258C772228B9852B2CE7704A9A605663FA67017. Nesta rodada foram preparados somente documentação e patch; nenhum comando abaixo foi executado. O roteiro é pontual para este UUID/PIDs, em PowerShell administrativo 5.1, sob janela exclusiva e autorização expressa. Não é ferramenta de recuperação automática. Fecha-se API/campanhas/escritores antes da execução; não se matam processos por nome/PID. PID reutilizado também interrompe para revisão. Se qualquer condição falhar após arquivamento, preservar o arquivo e os resíduos ativos; não repetir limpezas por tentativa. A retirada de owner é penúltima, occupied por último. Não há Remove-Item -Recurse, DROP, DELETE SQL ou exclusão abrangente.

### Roteiro único — executar manualmente somente após autorização

O snapshot SQL abaixo é somente leitura e solicita senha local diretamente por psql -W. Usa destino fixo e sessão READ ONLY. Nenhuma credencial é gravada ou passada em argumento. Não lê .env. O administrador deve informar caminhos bin/data convencionais aprovados e o SID da conta executora do domínio. A área de arquivo será um novo filho da autoridade já protegida, fora do journal; os arquivos de referência/aprovação não são modificados. A ACL do arquivo contém somente SYSTEM/Administradores. ACLs originais do journal ficam registradas no inventário, não são transplantadas para o arquivo, evitando conceder escrita do operador às evidências.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$ErrorActionPreference='Stop'
$infraPrincipal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$infraPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Roteiro de recuperacao exige administrador' }
$infraIncident='2d4efb12-e625-40c2-8784-dfd71c703e40'
$infraAuthority=Join-Path $env:ProgramData 'ArenaGO\integration-authority'
$infraDomain=Join-Path $env:ProgramData 'ArenaGO\integration\127.0.0.1-55432-arenago_events_test'
$infraRecord=Join-Path $infraDomain ('campaigns\' + $infraIncident + '.json')
$infraMarker=Join-Path $infraDomain 'occupied'
$infraOwner=Join-Path $infraMarker 'owner'
$infraApprovalPath=Join-Path $infraAuthority 'pilot-domain.json'
$infraBin=Read-Host 'Diretorio bin convencional aprovado'
$infraData=Read-Host 'Diretorio data convencional aprovado'
$infraOperator=Read-Host 'SID conferido da conta executora sem elevacao'
$infraExpectedFingerprint='d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180'
$infraExpectedPhysical='80F647C1:0x000000000000000001af00000002ace6'
$infraExpectedReference='C96BB176BDE7F3F8A4108EDC5418AED756CD9E2C405908C86A8C5076B60C3C1D'
if ($infraOperator -notmatch '^S-1-5-21-(\d+-){3}\d+$') { throw 'SID invalido' }
$infraTrust='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
function Assert-RecoveryPath([string]$Path,[bool]$Writable) {
    $item=Get-Item -LiteralPath $Path -Force
    $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($item.FullName))
    if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Volume invalido' }
    $current=$item
    while ($null -ne $current) {
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point' }
        $acl=Get-Acl -LiteralPath $current.FullName
        $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        $systemAncestor=$current.FullName -ieq [IO.Path]::GetPathRoot($env:SystemRoot) -and $current.FullName -ine $item.FullName
        if ($owner -notin @('S-1-5-18','S-1-5-32-544') -and !($Writable -and $owner -eq $infraOperator) -and !($systemAncestor -and $owner -eq $infraTrust)) { throw 'Proprietario nao autorizado' }
        $mask=if ($current.FullName -eq $item.FullName) { [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' } else { [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
        foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($ace.AccessControlType -eq 'Allow' -and !($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and ($ace.FileSystemRights -band $mask) -and $ace.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -and !($Writable -and $ace.IdentityReference.Value -eq $infraOperator)) { throw 'ACL nao autorizada' }
        }
        $current=if ($current -is [IO.FileInfo]) { $current.Directory } else { $current.Parent }
    }
}
function Set-RecoveryArchiveAcl([string]$Path,[bool]$Directory) {
    $acl=if ($Directory) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $inherit=if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    Assert-RecoveryPath $Path $false
    if (!(Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw 'Arquivo sem protecao de heranca' }
}
# Load only native file-ID functions. Do not run the unelevated observer body as administrator.
$infraTokens=$null; $infraParseErrors=$null
$infraAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'test\infrastructure\inspect-pilot-domain.ps1'),[ref]$infraTokens,[ref]$infraParseErrors)
if ($infraParseErrors.Count) { throw 'Sintaxe do observador inconclusiva' }
foreach ($name in @('ConvertFrom-JournalFileId','Get-JournalNativeFileId')) {
    $definition=$infraAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)
    if (!$definition) { throw 'Funcao nativa ausente' }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$infraApprovalHash=(Get-FileHash -LiteralPath $infraApprovalPath -Algorithm SHA256).Hash
$infraReferenceApproval=Join-Path $infraAuthority 'reference-v2.approval.json'
$infraReferenceApprovalHash=(Get-FileHash -LiteralPath $infraReferenceApproval -Algorithm SHA256).Hash
function Confirm-RecoveryIdentity {
    Assert-RecoveryPath $infraAuthority $false
    foreach ($p in @($infraApprovalPath,$infraReferenceApproval,(Join-Path $infraAuthority 'reference-v2.json'))) { Assert-RecoveryPath $p $false }
    Assert-RecoveryPath $infraDomain $true
    if (!(Get-Acl -LiteralPath $infraDomain).AreAccessRulesProtected) { throw 'Dominio sem ACL protegida' }
    $approval=Get-Content -Raw -LiteralPath $infraApprovalPath | ConvertFrom-Json
    if ($approval.path -cne $infraDomain -or $approval.operatorSid -cne $infraOperator) { throw 'Aprovacao de caminho/SID divergente' }
    $volume=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + [IO.Path]::GetPathRoot($infraDomain).TrimEnd('\') + "'")
    $physical=$volume.VolumeSerialNumber + ':' + (Get-JournalNativeFileId $infraDomain)
    if ($physical -cne $infraExpectedPhysical -or $physical -cne $approval.directoryId) { throw 'Identidade fisica divergente' }
    if ((Get-FileHash -LiteralPath $infraApprovalPath -Algorithm SHA256).Hash -ne $infraApprovalHash -or (Get-FileHash -LiteralPath $infraReferenceApproval -Algorithm SHA256).Hash -ne $infraReferenceApprovalHash -or (Get-FileHash -LiteralPath (Join-Path $infraAuthority 'reference-v2.json') -Algorithm SHA256).Hash -ne $infraExpectedReference) { throw 'Autoridade/referencia mudou' }
    $windows=& .\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
    if (($windows | ConvertFrom-Json).instanceSha256 -cne $infraExpectedFingerprint) { throw 'Instancia PostgreSQL mudou' }
    foreach ($id in @(42084,27264)) {
        if (Get-CimInstance Win32_Process -Filter "ProcessId=$id") { throw 'PID presente ou reutilizado: revisar sem encerrar automaticamente' }
    }
}
function Get-RecoveryInventory([string]$Root,[bool]$Source) {
    $rows=New-Object 'System.Collections.Generic.List[object]'
    function Visit-RecoveryEntry([string]$Path,[string]$Relative) {
        Assert-RecoveryPath $Path $Source
        $e=Get-Item -LiteralPath $Path -Force
        $directory=$e -is [IO.DirectoryInfo]
        $rows.Add([pscustomobject]@{ Relative=$Relative; Kind=$(if ($directory) {'D'} else {'F'}); Length=$(if ($directory) {0} else {$e.Length}); Hash=$(if ($directory) {''} else {(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}); Sddl=(Get-Acl -LiteralPath $Path).Sddl })
        if ($directory) { foreach ($child in Get-ChildItem -LiteralPath $Path -Force) { Visit-RecoveryEntry $child.FullName $(if ($Relative -eq '.') {$child.Name} else {Join-Path $Relative $child.Name}) } }
    }
    Visit-RecoveryEntry $Root '.'
    return $rows.ToArray() | Sort-Object Relative
}
function Get-RecoveryContentSignature($Rows) { return ($Rows | Select-Object Relative,Kind,Length,Hash | ConvertTo-Json -Compress -Depth 5) }
function Confirm-RecoveryExclusiveSql {
    # Fixed SELECT-only snapshot. No .env, URLs, PGOPTIONS or credential logging.
    $tables=@('users','profiles','user_games','events','experiences','stations','participations','queue_entries','service_sessions','evaluations','participation_profile_snapshots','external_entry_calls','sessions','refresh_tokens','password_reset_tokens','email_verification_tokens','user_roles','user_totp_credentials','admin_2fa_challenges','user_backup_codes','totp_activation_tokens','audit_logs','idempotency_operations','staff_idempotency_epochs')
    $occupied=($tables | ForEach-Object { 'EXISTS (SELECT 1 FROM public."' + $_ + '")' }) -join ' OR '
    $sql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('database',current_database(),'role',current_user,'session_role',session_user,'address',host(inet_server_addr()),'port',inet_server_port(),'other_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'prepared',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()),'locks',(SELECT count(*) FROM pg_catalog.pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())),'games',(SELECT count(*) FROM public.games),'questionnaires',(SELECT count(*) FROM public.questionnaire_versions),'operational_occupied',($occupied)); ROLLBACK;"
    $saved=@{}
    foreach ($e in Get-ChildItem Env: | Where-Object { $_.Name -match '^PG' }) { $saved[$e.Name]=$e.Value }
    try {
        foreach ($name in $saved.Keys) { Remove-Item -LiteralPath ('Env:'+$name) }
        $result=& (Join-Path $infraBin 'psql.exe') -X -W -h 127.0.0.1 -p 55432 -U arenago -d arenago_events_test -qAt -v ON_ERROR_STOP=1 -c $sql
        if ($LASTEXITCODE -ne 0) { throw 'Snapshot SQL inconclusivo' }
        $r=($result -join '') | ConvertFrom-Json
    } finally { foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') } }
    if ($r.database -ne 'arenago_events_test' -or $r.role -ne 'arenago' -or $r.session_role -ne 'arenago' -or $r.address -ne '127.0.0.1' -or $r.port -ne 55432 -or $r.other_sessions -ne 0 -or $r.prepared -ne 0 -or $r.locks -ne 0 -or $r.games -ne 20 -or $r.questionnaires -ne 1 -or $r.operational_occupied -ne $false) { throw 'Identidade, exclusividade ou baseline incompatível' }
    return $r
}
Confirm-RecoveryIdentity
if ((Read-Host 'Confirme janela exclusiva, qualificacao estrutural aprovada e autorizacao de arquivar: ARQUIVAR-2d4efb12') -cne 'ARQUIVAR-2d4efb12') { throw 'Sem autorizacao' }
$infraSqlBefore=Confirm-RecoveryExclusiveSql
$infraOriginal=@(Get-RecoveryInventory $infraDomain $true)
$infraRecordObject=Get-Content -Raw -LiteralPath $infraRecord | ConvertFrom-Json
if ($infraRecordObject.id -cne $infraIncident -or $infraRecordObject.phase -ne 'running' -or $infraRecordObject.preflight -ne 'passed' -or $infraRecordObject.postflight -ne 'pending' -or $infraRecordObject.resources -ne 'pending' -or $infraRecordObject.lock -ne 'acquired' -or $infraRecordObject.recoveryPending -ne $true -or $infraRecordObject.supervisor.pid -ne 42084 -or @($infraRecordObject.attempts).Count -ne 1 -or $infraRecordObject.attempts[0].pid -ne 27264 -or $infraRecordObject.attempts[0].suite -ne 'admin-external-queue-http' -or $infraRecordObject.attempts[0].state -ne 'launched') { throw 'Registro diferente do incidente aprovado' }
$infraOwnerText=[IO.File]::ReadAllText($infraOwner)
if ($infraOwnerText -cnotmatch ('^' + [regex]::Escape($infraIncident) + ':[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')) { throw 'Owner diferente do incidente' }
foreach ($row in $infraOriginal) {
    if ($row.Kind -eq 'D' -and $row.Relative -notin @('.','campaigns','occupied')) { throw 'Subdiretorio inesperado: revisar inventario' }
    if ($row.Kind -eq 'F' -and $row.Relative -notin @('occupied\owner',('campaigns\'+$infraIncident+'.json'))) {
        if ($row.Relative -notmatch '^campaigns\\[a-f0-9-]{36}\.json$') { throw 'Arquivo inesperado: nao ha autorizacao para remove-lo' }
        $other=Get-Content -Raw -LiteralPath (Join-Path $infraDomain $row.Relative) | ConvertFrom-Json
        if ($other.phase -notin @('clean','test-failure') -or $other.recoveryPending -ne $false) { throw 'Outro incidente exige autorizacao separada' }
    }
}
$infraArchive=Join-Path $infraAuthority ('recovery-'+$infraIncident+'-'+[guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $infraArchive) { throw 'Arquivo preexistente' }
[void](New-Item -ItemType Directory -Path $infraArchive)
Set-RecoveryArchiveAcl $infraArchive $true
$infraCopy=Join-Path $infraArchive 'journal-original'
[void](New-Item -ItemType Directory -Path $infraCopy)
Set-RecoveryArchiveAcl $infraCopy $true
foreach ($row in $infraOriginal | Where-Object { $_.Relative -ne '.' } | Sort-Object @{Expression={$_.Relative.Split('\').Length}},Relative) {
    $target=Join-Path $infraCopy $row.Relative
    if ($row.Kind -eq 'D') { [void](New-Item -ItemType Directory -Path $target); Set-RecoveryArchiveAcl $target $true }
    else { [IO.File]::Copy((Join-Path $infraDomain $row.Relative),$target,$false); Set-RecoveryArchiveAcl $target $false }
}
$infraCopied=@(Get-RecoveryInventory $infraCopy $false)
if ((Get-RecoveryContentSignature $infraOriginal) -cne (Get-RecoveryContentSignature $infraCopied)) { throw 'Copia difere do original' }
if (($infraOriginal | ConvertTo-Json -Compress -Depth 5) -cne (@(Get-RecoveryInventory $infraDomain $true) | ConvertTo-Json -Compress -Depth 5)) { throw 'Original mudou durante arquivo' }
$infraEvidence=[ordered]@{ incident=$infraIncident; archivedAt=[DateTimeOffset]::UtcNow.ToString('o'); administratorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; operatorSid=$infraOperator; physicalId=$infraExpectedPhysical; sourcePatch='07404CB9B8E6BB2CD57E0B371258C772228B9852B2CE7704A9A605663FA67017'; structuralQualification='Responsavel: D1.1 exit 0, 608 objetos, 40 FKs'; limitation='Sem snapshot integral imediatamente anterior; continuidade integral nao comprovada'; sqlBefore=$infraSqlBefore; inventory=$infraOriginal }
$infraManifest=Join-Path $infraArchive 'evidence.json'
[IO.File]::WriteAllText($infraManifest,($infraEvidence | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Set-RecoveryArchiveAcl $infraManifest $false
$infraManifestHash=(Get-FileHash -LiteralPath $infraManifest -Algorithm SHA256).Hash
Write-Output ('Arquivo verificado: '+$infraArchive)
Write-Output ('Manifest SHA256: '+$infraManifestHash)
Write-Output $infraRecord
Write-Output $infraOwner
Write-Output $infraMarker
Confirm-RecoveryIdentity
if ((Read-Host 'Autoriza retirar SOMENTE os tres caminhos exibidos, aceitando a limitacao: RECUPERAR-2d4efb12') -cne 'RECUPERAR-2d4efb12') { throw 'Arquivo preservado; retirada nao autorizada' }
# Last verification before any removal; do not overwrite or normalize old results.
Confirm-RecoveryIdentity
$infraSqlFinal=Confirm-RecoveryExclusiveSql
if ((Get-FileHash -LiteralPath $infraManifest -Algorithm SHA256).Hash -cne $infraManifestHash -or
    (Get-RecoveryContentSignature @(Get-RecoveryInventory $infraCopy $false)) -cne (Get-RecoveryContentSignature $infraOriginal) -or
    ($infraOriginal | ConvertTo-Json -Compress -Depth 5) -cne (@(Get-RecoveryInventory $infraDomain $true) | ConvertTo-Json -Compress -Depth 5)) { throw 'Evidencia ou fonte mudou' }
$infraDecision=Join-Path $infraArchive 'authorization.json'
[IO.File]::WriteAllText($infraDecision,([ordered]@{ incident=$infraIncident; decision='Retirada pontual autorizada apos reconciliacao; resultado inconclusivo preservado no arquivo'; at=[DateTimeOffset]::UtcNow.ToString('o'); administratorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; evidenceSha256=$infraManifestHash; sqlFinal=$infraSqlFinal; paths=@($infraRecord,$infraOwner,$infraMarker) } | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Set-RecoveryArchiveAcl $infraDecision $false
# No recursion, wildcard or deletion of campaigns/root/approval files.
Remove-Item -LiteralPath $infraRecord
if ((Get-ChildItem -LiteralPath $infraMarker -Force).Count -ne 1 -or [IO.File]::ReadAllText($infraOwner) -cne $infraOwnerText) { throw 'Marcador mudou: parar e preservar residuos' }
Remove-Item -LiteralPath $infraOwner
[IO.Directory]::Delete($infraMarker,$false) # occupied LAST; refuses a nonempty directory.
Confirm-RecoveryIdentity
$infraAfter=@(Get-RecoveryInventory $infraDomain $true)
$infraExpectedAfter=@($infraOriginal | Where-Object { $_.Relative -notin @('occupied','occupied\owner',('campaigns\'+$infraIncident+'.json')) })
if ((Get-RecoveryContentSignature $infraAfter) -cne (Get-RecoveryContentSignature $infraExpectedAfter)) { throw 'Inventario final divergente' }
foreach ($row in $infraAfter) {
    $prior=$infraExpectedAfter | Where-Object { $_.Relative -ceq $row.Relative }
    if ($row.Sddl -cne $prior.Sddl) { throw 'ACL ativa mudou' }
}
if ((Get-FileHash -LiteralPath $infraManifest -Algorithm SHA256).Hash -cne $infraManifestHash -or (Get-RecoveryContentSignature @(Get-RecoveryInventory $infraCopy $false)) -cne (Get-RecoveryContentSignature $infraOriginal)) { throw 'Arquivo final divergente' }
$infraCompletion=Join-Path $infraArchive 'completion.json'
[IO.File]::WriteAllText($infraCompletion,([ordered]@{ incident=$infraIncident; completedAt=[DateTimeOffset]::UtcNow.ToString('o'); physicalRootPreserved=$true; approvalPreserved=$true; markerAbsent=!(Test-Path -LiteralPath $infraMarker); remainingInventory=$infraAfter; status='Recuperacao pontual concluida; nao constitui aprovacao de campanha' } | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Set-RecoveryArchiveAcl $infraCompletion $false
Get-ChildItem -LiteralPath $infraArchive -File | Get-FileHash -Algorithm SHA256
Write-Output 'Recuperacao verificada. Executar check em novo console SEM elevacao; campanhas continuam aguardando autorizacao.'
```

O administrador deve guardar o SHA-256 de evidence.json fora do arquivo como referência independente. Em caso de erro após retirada parcial, preservar o arquivo e os caminhos ainda presentes; o domínio fica bloqueado até revisão, sem autorizar uma segunda limpeza. A janela exclusiva deve permanecer sob controle do responsável entre snapshots e retirada; esse roteiro não promete isolamento contra processo malicioso da mesma identidade ou administrador concorrente.

Após o roteiro administrativo, em console SEM elevação e com as condições de leitura de processos previamente autorizadas ainda válidas, preparar somente check (sem campanha):

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts check (Read-Host 'Diretorio bin aprovado') (Read-Host 'Diretorio data aprovado') d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
if ($LASTEXITCODE -ne 0) { throw 'Check inconclusivo: nao iniciar campanha' }
```

Não se declara recuperação executada nesta preparação. Não houve teste/typecheck, banco, alteração de ACL, arquivo administrativo ou retirada real pelo Codex. Inventário, scripts e permissões de produção permanecem preservados. Apenas este relatório e o patch acumulado foram atualizados; índice Git real permanece vazio.

## INFRA-01.D1.3 — Primeira D06: supervisão, IPC e persistência excepcional

O responsável confirmou para DBDDED82A6C6D496AC6266ADCB63D9A1B8DF82DAFE85E952A6D9DE8639C82997: productionPassed, fingerprintMatches, domainValid, matchesNative e complete-check.passed verdadeiros, sonda exit 0. Ambos os observadores e check estão operacionalmente aprovados. Não foram reabertas as investigações Windows.

A primeira D06 foi expressamente autorizada e falhou após entrada protegida da senha com mensagem genérica. D09/both não iniciadas. Campanha 2d4efb12-e625-40c2-8784-dfd71c703e40, supervisor 42084, worker 27264, suíte admin-external-queue-http. Journal informado: running, preflight passed, lock acquired, attempt launched, postflight/resources pending, recoveryPending true; occupied/owner preservados. Isso comprova avanço além da credencial até o lançamento. Não é evidência de senha inválida, falha inicial de conexão ou testes não executados. O estado authorized era atualizado apenas em memória e só persistido na próxima transição; portanto launched no último snapshot NÃO prova ausência de autorização IPC.

### Defeitos comprovados e correções delimitadas

1. Prazo IPC incompatível: runAsCampaignChild aguardava só 10 segundos pela permissão, mas o supervisor, após spawn, precisava salvar running através de duas atestações PowerShell de até 30 segundos cada, depois verificar o lock. O worker podia expirar durante uma operação obrigatória legítima do supervisor. O prazo pré-autorização passou a 120 segundos, ainda limitado e sem permitir pools/fixtures/Nest antes da permissão. O timeout de execução/reconciliação permanece. Isso corrige uma corrida permitida pelo código; não comprova retrospectivamente que ela foi a causa única da campanha reportada.

2. Persistência excepcional silenciosa: o catch do orquestrador usava save(...).catch(() => undefined), permitindo que um JSON running permanecesse no disco sem revelar falha de atualização. As duas tentativas de persistir interrupção/inconsistência agora registram cleanupFailures e terminalPersistence; erro de persistência produz exit 2 e recoveryPending true. O resultado impresso diferencia memória de evidência durável. Nenhum sucesso ou liberação é fabricado quando a escrita falha, e o marcador permanece. O journal existente não foi aberto ou modificado nesta implementação.

3. Worker opaco: erros de bootstrap, ambiente e saída eram descartados. Agora mensagens IPC informativas contêm somente stage/code de allowlists fechadas. Elas não autorizam execução, não satisfazem ready/started/result e não produzem aprovação. O supervisor conserva a última etapa reportada e, na saída inconclusiva, exit code/sinal permitidos. Bootstrap do loader emite só token fixo e erro sanitizado; stdout/stderr continuam drenados sem publicação. Falhas do worker anteriores ao finally do protocolo também encerram o canal IPC, evitando filho fracassado mantido vivo apenas pelo canal.

4. Diagnóstico da campanha inteira: reutilizadas as estruturas existentes de ambiente, supervisão e evidência. campaignStep/campaignFailure preservam etapa fixa e códigos OS/SQLSTATE allowlisted, nunca message/detail/hint/cause/query/URI/stack do driver. Cobrem credencial, configuração, revisão Git, referência, atestação pré-conexão, conexão/autenticação, identidade SQL, aquisição/verificação/fechamento do lock, admissão/save/finish do journal, preflight/postflight, launch, IPC, instalação de pools, conexões físicas do worker, runner/resumo/reconciliação e recursos. Campos failure/cleanupFailures são diagnósticos opcionais, não relaxam terminalEvidence. Read/identity do SQL preservam somente códigos sanitizados para que 28P01/42501/ECONNREFUSED e semelhantes sejam distinguíveis quando realmente ocorrerem. SIGTERM passa pelo mesmo cancelamento controlado de SIGINT quando o runtime o entrega; término forçado do Windows não garante finally.

5. Releitura da referência no fluxo real usa observe() (duas chamadas Windows) e tinha limite externo de apenas 5 segundos, apesar de cada subprocesso permitir 30 segundos. O orçamento real dessa leitura passou a 90 segundos, mantendo 5 segundos nas simulações. A campanha reportada já ultrapassou esse ponto, portanto essa incompatibilidade não é atribuída ao incidente.

### O que permanece inconclusivo no incidente existente

O fluxo normal de erro do orquestrador deveria devolver um registro interrupted/inconsistent; running no disco pode resultar de persistência excepcional recusada, encerramento forçado/crash ou outra falha antes da conclusão do catch. A mensagem genérica isolada não distingue essas alternativas e não prova qual aconteceu. Esta revisão torna as falhas tratadas observáveis, mas não promete persistência após kill, desligamento ou falha irrecuperável do processo. Não foram acessados os PIDs históricos, arquivos reais de campanha ou banco. A etapa informativa do worker é o último ponto observado, não prova de execução integral ou ausência de execução dos testes. Recuperação continua exigindo reconciliação independente, arquivamento protegido e autorização nominal conforme BC-07.

### Regressões preparadas e revalidação

Preparados três cenários sem banco: sanitização de todas as etapas e SQLSTATE, falha nas duas gravações terminais com recuperação conservada, e saída do worker antes de ready preservando diagnóstico sem autorizar por mensagem informativa. Regressões anteriores preservadas. Não executados testes/typecheck pelo implementador; os resultados históricos não aprovam automaticamente esta revisão.

Para Luna/responsável em PowerShell local saudável, após inspeção dos comandos, sem PostgreSQL:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck falhou' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.3 ' test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Regressoes direcionadas falharam' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Regressao simulada falhou' }
node --check test/infrastructure/pilot-loader.cjs
if ($LASTEXITCODE -ne 0) { throw 'Sintaxe do loader falhou' }
git diff --check
```

Não repetir D06 com occupied/histórico inconclusivo. Primeiro realizar revisão e recuperação separadamente autorizadas pelo procedimento BC-07, preservando a campanha 2d4efb12-e625-40c2-8784-dfd71c703e40. Somente após validação simulada, prova de recursos encerrados, reconciliação e autorização expressa de nova campanha, o comando preparado é:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts D06 (Read-Host 'Diretorio bin aprovado') (Read-Host 'Diretorio data aprovado') d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
# Registrar exit code, campaign-stage em falha precoce e JSON failure/cleanupFailures/terminalPersistence.
# Nao iniciar D09/both automaticamente.
```

Nenhum comando de campanha, banco, teste/typecheck ou recuperação foi executado pelo Codex. Nenhuma permissão, referência ou journal real foi alterado. Arquivos desta rodada: integration-environment.ts, integration-db-guard.ts, campaign-lock.ts, campaign-child-protocol.ts, campaign-process.ts, campaign-orchestrator.ts, campaign-journal.ts, pilot-worker.ts, pilot-loader.cjs, pilot-executor.ts, integration-campaign.test.ts, relatório e patch. Patch regenerado em índice/objetos temporários, com índice real preservado.

## INFRA-01.D1.3 — Identidade do journal por handle nativo

Evidências do responsável para 6570BD0CABC349FDFC68F8F70B4F5179EFA1EACC4D9EEB96936AA53C7BDD7420: productionPassed/fingerprintMatches verdadeiros, PostgreSQL/engine/módulos/interop aprovados; journal-observer code=1, domainStage=[fsutil,journal], domainValid=false, sonda exit 2. Isso localiza a falha na invocação de fsutil ou no seu exit status, antes da regex file-id, CIM e comparação do registro. O código anterior invocava fsutil.exe por resolução de PATH, argumentos file/queryfileid/Directory e dependia de LASTEXITCODE=0. O erro original/exit próprio do utilitário não foi preservado; a aprovação direta anterior não demonstra o motivo específico de sua falha no subprocesso. Não se presume negação de ACL ou erro de interpretação do hexadecimal.

Substituída somente a dependência operacional do observador por GetFileInformationByHandleEx(FileIdInfo=18). Get-JournalNativeFileId utiliza o mesmo padrão Reflection.Emit em memória validado para processos, sem Add-Type/csc/arquivos temporários. Abre o diretório existente com FILE_READ_ATTRIBUTES (0x80), compartilhamento read/write/delete, OPEN_EXISTING e flags BACKUP_SEMANTICS|OPEN_REPARSE_POINT. Não solicita escrita ou privilégio de backup: a flag permite abrir diretórios. Confere FileAttributeTagInfo no mesmo handle e rejeita arquivo comum/reparse point. Consulta FILE_ID_INFO (24 bytes), copia os 16 bytes em offset 8 e fecha handle/libera buffer em finally, inclusive em falhas. Qualquer falha de API/fechamento bloqueia a etapa file-id. Mantidas as inspeções prévias de NTFS, ACLs, ancestrais, SID e reparse points.

Representação: os 16 bytes do inteiro little-endian são copiados e invertidos para exibição hexadecimal de 32 dígitos, minúscula, prefixo 0x; não usar conversão GUID e suas inversões parciais. O prefixo continua sendo Win32_LogicalDisk.VolumeSerialNumber, como na homologação original: não substituir pelo ULONGLONG VolumeSerialNumber da API, que não é o mesmo contrato de representação. A comparação literal final permanece com pilot-domain.json, sem nenhuma alteração do arquivo. Nenhum identificador esperado é usado para fabricar a observação.

Preparada regressão inspect-pilot-domain-file-id.test.ps1: fixture de bytes e hexadecimal previamente homologado, vetor assimétrico de 128 bits, ausência de mutação, rejeição de tamanhos inválidos, consulta real somente do próprio diretório de testes, comparação independente com fsutil absoluto e rejeição de arquivo comum. Não executada nesta rodada. A compatibilidade operacional com 80F647C1:0x000000000000000001af00000002ace6 será confirmada somente quando a consulta real passar na comparação inalterada do registro. Não se declara comprovada por teste ainda não executado.

A sonda existente continua executando ambos os observadores e check. Após o journal nativo passar, acrescenta fsutil-compatibility: lança o executável absoluto SystemRoot/System32/fsutil.exe, com os mesmos argumentos e ambiente aprovado, informa existência, código/hex/timeout e booleanos de parsing/equivalência, sem saída bruta. Falha do utilitário é registrada sem impedir a solução nativa homologada; sucesso do utilitário com ID diferente bloqueia. Esse passo permite distinguir a antiga dependência de resolução/execução da nova observação por handle, sem recolocar fsutil como requisito de produção. A allowlist Windows permanece inalterada.

Comando único operacional sem elevação, delegação temporária ativa e domínio previamente provisionado; não executa SQL nem campanha:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'; node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/probe-pilot-windows-observer.cjs (Read-Host 'Diretorio bin aprovado') (Read-Host 'Diretorio data aprovado') d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
```

Exigir journal-observer.domainValid=true, complete-check.passed=true e exit 0. Se approval-id divergir, parar: não alterar pilot-domain.json ou reprovisionar. Registrar fsutil-compatibility separadamente. Para Luna/responsável, a regressão preparada pode ser executada em PowerShell 5.1 por `powershell.exe -NoProfile -File .\backend\test\unit\inspect-pilot-domain-file-id.test.ps1` a partir da raiz, sem banco; se a comparação independente não puder executar, a regressão não é considerada aprovada.

Referências oficiais consultadas: https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info e https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-file_id_128. Arquivos desta rodada: inspect-pilot-domain.ps1, probe-pilot-windows-observer.cjs, nova regressão PowerShell, relatório e patch. Inspeção estática e integridade do patch realizadas; testes/typecheck/sonda/campanhas não executados. Nenhuma permissão, referência, journal ou banco foi alterado. Histórico anterior preservado; conclusão operacional depende da revalidação local.

## INFRA-01.D1.3 — Journal observado pelo supervisor e check encadeado

Evidência informada pelo responsável para EC7A2ECB92D0CA1066AA083E43267A092B3735B36F8B82C185D4AE7916647A10: sonda comparativa aprovada, configurações profile e full-windows funcionais, productionPassed/fingerprintMatches verdadeiros, engine/módulos/interop aprovados, RemoteSigned/FullLanguage, exit 0. Considera-se resolvida a inicialização PowerShell nessa máquina; allowlist de produção preservada. O check avançou até journal-observer e recebeu code=1, timeout=false, observer=domain, exit 2. Isso comprova execução do corpo do script e seu catch; não é erro de spawn/engine nem evidencia falha do observador PostgreSQL.

Defeito comprovado: inspect-pilot-domain.ps1 reduzia qualquer falha interna ao mesmo marcador domain, perdendo a condição rejeitada. A execução direta anterior não permite reconstruir a etapa falha da chamada pelo Node. Não há prova para alterar ACLs, paths aprovados, fsutil, CIM ou o registro. A causa operacional específica ainda depende da nova sonda; não foi aplicada correção especulativa às guardas.

O script agora preserva marcadores fechados por etapa: identity/elevation/arguments; path/volume/reparse/acl-read/owner/rights/inheritance/children; fsutil/file-id/cim; approval-read/approval-json/approval-path/approval-id/approval-sid; serialization. Também identifica área fixa authority/reference/approval/domain-record/journal/child. As três comparações do registro foram separadas para distinguir path, directoryId e SID sem imprimir valores. O supervisor e a sonda só extraem essas enumerações allowlisted, sem mensagens/streams brutos. A política de proprietários, máscaras de direitos, reparse, SID, identidade física e aprovação permanece igual.

pilotJournalObserverInvocation é agora a fábrica compartilhada entre supervisor e sonda: mesmo exe absoluto, argumentos Directory/Authority calculados de ProgramData, script absoluto, cwd herdado backend, opções execFile e allowlist aprovada. Não há bypass de política de execução. O comando padrão da sonda usa somente full-windows, sem repetir a investigação comparativa encerrada; --compare-windows preserva o modo anterior apenas para investigação explicitamente solicitada. Após o observador Windows e a verificação do fingerprint passarem, executa o journal pela mesma chamada de produção. Se o JSON do domínio for válido, lança exclusivamente check, usando ambiente Windows filtrado mais NODE_ENV=test. Nenhum segredo do pai é repassado, nenhum argumento permite selecionar campanha e check retorna antes da senha/conexão SQL/claim. Qualquer falha interrompe a sequência com exit 2. O sucesso exige os dois observadores e complete-check.passed=true, exit 0.

Comando único, em console NÃO elevado com delegação temporária ativa e journal já provisionado:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'; node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/probe-pilot-windows-observer.cjs (Read-Host 'Diretorio bin aprovado') (Read-Host 'Diretorio data aprovado') d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
```

Registrar linhas journal-observer e complete-check, incluindo domainStage/checkDomainStage/checkStage e exit code. arguments aponta divergência literal Directory/Authority; path/volume/reparse/ACLs apontam inspeção do domínio/ancestrais; fsutil/file-id e cim distinguem consultas físicas; approval-path/id/sid identificam precisamente qual conferência divergiu. Não editar automaticamente pilot-domain.json para corresponder a um resultado não aprovado. Se houver owner/rights/reparse, preservar evidência e revisar a condição sem flexibilização. A sonda não remove marcadores ou escreve no domínio.

Regressões preparadas para preservação da etapa interna através de PowerShell → diagnóstico Node → sonda, recusa de tokens arbitrários/segredos e uso da chamada compartilhada. Não executadas nesta rodada. Arquivos: inspect-pilot-domain.ps1, pilot-executor.ts, probe-pilot-windows-observer.cjs, integration-campaign.test.ts, relatório e patch. Nenhuma sonda/check/campanha, teste/typecheck, banco ou alteração de permissões foi executado pelo Codex. Os resultados 220/220 históricos não validam esta correção automaticamente.

## INFRA-01.D1.3 — Allowlist Windows compatível e sonda comparativa

O responsável executou a sonda anterior: executável/script presentes, caminhos absolutos corretos, spawn confirmado, status 4294901760/0xFFFF0000, sem timeout e sem marco engine tanto no observador como na sonda de componentes. A falha ocorre antes da inicialização observável do PowerShell; não demonstra falha de CIM, NetTCPIP ou Reflection.Emit. O precedente oficial PowerShell/PowerShell#3545 documenta falha de inicialização com ambiente reduzido e recuperação após restaurar ProgramFiles/ProgramFiles(x86): https://github.com/PowerShell/PowerShell/issues/3545. É evidência de compatibilidade relevante, mas o conjunto mínimo necessário nesta máquina ainda depende da comparação local.

windowsObserverEnvironment agora conserva valores legítimos por nomes explicitamente enumerados em quatro grupos: installation (ProgramFiles, ProgramFiles(x86), ProgramW6432, CommonProgramFiles e variantes), profile (USERPROFILE, HOMEDRIVE/HOMEPATH, APPDATA/LOCALAPPDATA, PUBLIC/ALLUSERSPROFILE), temporary (TEMP/TMP) e identity (USERNAME, USERDOMAIN/USERDOMAIN_ROAMINGPROFILE, LOGONSERVER, COMPUTERNAME, SESSIONNAME, OS, PROCESSOR_ARCHITECTURE/PROCESSOR_ARCHITEW6432, ComSpec). Mantém SystemRoot/WINDIR/SYSTEMDRIVE e ProgramData; PATH continua composto somente por System32 e WindowsPowerShell/v1.0. Nomes são lidos sem distinção de caixa e emitidos na capitalização canônica. Não são incluídos PSModulePath, PSExecutionPolicyPreference, NODE*, dotenv, URLs/credenciais PostgreSQL, JWT, TOTP ou configurações da aplicação. NODE_V8_COVERAGE continua bloqueado. Valores ausentes necessários à supressão do preenchimento implícito da libuv continuam vazios; valores Windows presentes na allowlist são preservados, sem obrigar perfil/temp válidos a ficarem vazios.

A correção alcança os observadores de supervisor e worker via o mesmo helper. Foi necessário também encaminhar essa lista Windows pelo ambiente filtrado da campanha: antes o worker não recebia ProgramFiles/APPDATA e outros nomes, portanto alterar somente o helper do observador não resolveria sua inicialização. campaignSpawnEnvironment agora apenas preenche defaults ausentes, sem sobrescrever valores Windows previamente filtrados. A validação de bootstrap reconhece esses nomes explicitamente. Não foi herdado o ambiente inteiro e as demais entradas permanecem proibidas.

A sonda existente agora executa sete configurações fixas: previous-restricted (reprodução anterior), installation, profile, temporary, identity, installation-profile e full-windows. Para cada uma, chama o observador completo e a sonda engine/política/módulos/interop com o mesmo executável, cwd, argumentos/opções e ambiente daquele grupo. O resumo comparison informa functional, firstFunctional e productionPassed. A configuração de produção é full-windows; não é alterada automaticamente com base no primeiro sucesso. Exit 0 exige que full-windows passe integralmente, incluindo fingerprint original; sucesso somente de um grupo não libera o piloto. Só nomes fixos/resultados sanitizados são publicados, nunca valores de ambiente. A execução comparativa pode demorar alguns minutos (14 subprocessos sequenciais com timeout individual de 30 segundos), sem repetições ilimitadas.

Regressões atualizadas para conferir o ambiente realmente recebido, preservação das variáveis Windows fictícias, PATH controlado e exclusão explícita de credenciais/URLs/Node/dotenv/PSModulePath. Conferem também seleção de grupos e encaminhamento equivalente ao worker no Windows. O teste de variável de bootstrap proibida usa OTHER_SECRET em vez de USERDOMAIN, agora legítimo; a assertion de rejeição permanece. Nove casos D1.2 e diagnósticos D1.3 preservados. Testes/typecheck não executados pelo implementador; 220/220 é resultado histórico anterior.

Comando único de validação operacional, no computador principal, console sem elevação, delegação temporária ativa e cwd backend. Ele não altera política de execução, permissões, autoridade ou journal, não pede senha e não conecta SQL:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'; node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/probe-pilot-windows-observer.cjs (Read-Host 'Diretorio bin aprovado') (Read-Host 'Diretorio data aprovado') d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
```

Registrar JSON comparison, resultados por configuração e exit code. Se full-windows passar, repetir check conforme roteiro já documentado, sem executar campanhas automaticamente. Se só engine passar e módulos/interop falharem, o resumo conserva essa distinção. Se todas falharem antes de engine, preservar status/política sanitizados e parar; não ampliar a lista por tentativa aleatória nem elevar o executor. O fato de installation funcionar e previous-restricted falhar demonstrará o efeito do grupo de instalação nessa máquina; não permite atribuir o requisito a uma única variável sem ensaio adicional.

Arquivos desta rodada: integration-environment.ts, campaign-child-protocol.ts, pilot-executor.ts (opção de grupos somente para comparação), probe-pilot-windows-observer.cjs, integration-campaign.test.ts, relatório e patch. Nenhum teste/typecheck, sonda, campanha, acesso SQL ou alteração de permissões foi executado pelo Codex. Referência homologada, journal e índice real preservados.

## INFRA-01.D1.3 — Sonda exata do observador Windows pelo Node

Revalidação informada pelo responsável para C2B7E49432953E1253F406BB5DC491BE62CD0882B80A9DB49889C78E15C6C294: windows-observer, code=unavailable, timeout=false, observer=unavailable, exit 2. Observadores diretos haviam passado sem elevação e com delegação ativa. A etapa agora confirma que a falha ocorreu na chamada execFile, antes do processamento JSON/fingerprint/autoridade. O loader e os imports iniciais chegaram a main. Não foi acessado banco nem ocupado/removido journal pelo check.

Defeito adicional comprovado: o formatador anterior aceitava códigos numéricos somente entre 0 e 255. Exit status Windows usa DWORD, podendo aparecer como número unsigned de 32 bits ou representação signed; valores maiores/negativos eram convertidos para unavailable. Alguns códigos de lançamento como EINVAL também eram descartados. O formatador agora preserva números inteiros de -2147483648 a 4294967295 e mais códigos fixos de spawn, mantendo sanitização. Isso explica uma forma concreta de perda do diagnóstico, mas NÃO prova qual foi o código ou a causa operacional daquela execução: o erro original foi descartado e não é recuperável retrospectivamente.

Preparada probe-pilot-windows-observer.cjs. A primeira chamada reutiliza pilotWindowsObserverInvocation, agora também usado pelo supervisor: mesmo caminho absoluto de powershell.exe derivado de SystemRoot validado, mesmo -NoProfile/-NonInteractive/-File, script absoluto, bin/data, timeout, buffers, encoding e ambiente mínimo. A sonda exige cwd backend para reproduzir o diretório operacional. Não solicita senha, não importa fixtures nem inicializa Nest/pools/SQL; importar o executor não chama main. Confere existência dos dois arquivos e distingue evento spawn, erro do runtime, exit code DWORD/hex, execução do script, JSON e comparação do fingerprint.

A segunda chamada, isolada da atestação, usa o mesmo executável/opções/env e código público fixo -EncodedCommand. Base64 aqui contém somente instruções públicas de diagnóstico e o caminho público escapado do script; jamais credencial. Não se usa ExecutionPolicy Bypass nem override. Os marcos engine/modules/interop distinguem inicialização do PowerShell, importação CimCmdlets/NetTCPIP e Reflection.Emit consultando somente a imagem do próprio PowerShell. A sonda lê política efetiva/por escopo e LanguageMode, emitindo apenas enums validados. Os erros não publicam message/cmd/args/environment/stack/stdout/stderr brutos. Tokens conhecidos identificam PSSecurityException/ParserError/CommandNotFoundException, sem reproduzir texto. TEMP/USERPROFILE continuam vazios, nenhum PSModulePath do pai foi adicionado e nenhum segredo é herdado. A chamada diagnóstica -Command não substitui o sucesso da chamada exata -File: ambas precisam passar.

Não há evidência suficiente para atribuir a falha a módulos, Reflection.Emit, política de execução ou ambiente mínimo sem executar a sonda no computador afetado. Nenhum desses componentes foi flexibilizado. Se a engine falhar antes do primeiro marco, registrar code/statusHex; se engine passar e faltar modules/interop, a fronteira fica identificada. Se o comando exato falhar com securityException e a engine indicar Restricted/AllSigned, submeter assinatura/política de execução a decisão administrativa específica, sem executar bypass. Se a atestação falhar em processes, conferir se a delegação ainda está ativa. Nenhuma dessas hipóteses é declarada causa confirmada nesta rodada.

Comando único da sonda local, no console sem elevação com delegação temporária ativa e com os caminhos convencionais aprovados. Não usar credenciais. O comando também define NODE_ENV apenas no processo do console:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV='test'; node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/probe-pilot-windows-observer.cjs (Read-Host 'Diretorio bin aprovado') (Read-Host 'Diretorio data aprovado') d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
```

Registrar as três linhas JSON sanitizadas e exit code. Sucesso exige exact-observer sem erro, JSON válido, fingerprintMatches=true, marcos engine/modules/interop e exit 0. Sonda exit 0 não qualifica banco nem autoriza campanha. Repetir então o check já documentado. Se faltar invocation, distinguir probe-entry/probe-cwd/probe-bootstrap-or-environment ou erro anterior ao carregamento da sonda; não compartilhar stack/ambiente bruto sem revisão.

Preparada regressão para DWORD/signed exit status, EINVAL, classificação de spawn, política e recusa de texto sensível; regressões anteriores preservadas, ajustando somente a assertion da chamada Windows agora compartilhada. Arquivos desta rodada: pilot-executor.ts, probe-pilot-windows-observer.cjs, integration-campaign.test.ts, relatório e patch. Nenhuma sonda, teste, typecheck, campanha, ACL ou banco foi executado/alterado pelo Codex. A origem operacional exata permanece pendente da sonda, sem promessa de resolução por hipótese. Histórico 220/220 permanece referente à versão anterior.

## INFRA-01.D1.3 — Diagnóstico sanitizado do check operacional

Evidências informadas pelo responsável: Probe anterior retornou Win32=5 em ambos os processos; regressões PowerShell de processos e caminhos aprovadas; delegação temporária 0x1000 realizada; Probe posterior identificou ambos os executáveis; atestação Windows sem elevação aprovada com fingerprints originais; journal provisionado e inspect-pilot-domain.ps1 direto sem elevação aprovado, directoryId 80F647C1:0x000000000000000001af00000002ace6. A restauração final das DACLs não foi informada nesta mensagem e permanece sujeita ao roteiro administrativo. O check via Node falhou com mensagem genérica e exit 2. Patch de entrada: 0EE71157BFA09852F6D2AC78BCCABB009A91D73E41E4020FE874FA9022E669A3.

Defeito comprovado por inspeção: o catch de main descartava a etapa e todas as informações do erro. A mensagem exata recebida era emitida somente após main rejeitar: o loader e os imports iniciais já haviam sido carregados nessa execução. O check não chega à senha, pg.Client, advisory lock, claim ou campanha, pois retorna antes desses caminhos. Portanto esse erro do check não demonstra criação de marcador nem justifica removê-lo. Execução direta dos observadores não demonstra equivalência ao subprocesso com ambiente mínimo. Não há stderr original ou indicação de etapa nas evidências fornecidas: a causa operacional específica NÃO pode ser confirmada retrospectivamente. Não foi presumida falha de TEMP, USERPROFILE, ACL ou fingerprint nem aplicada flexibilização especulativa.

O executor agora distingue entry, observer-environment, windows-observer, windows-json, windows-fingerprint, journal-observer, journal-json, journal-continuity e reference-authority. Só imprime etapa fixa, código numérico de 0 a 255 ou códigos de lançamento allowlisted, indicador killed/timeout e marcador fixo do observador. Não publica mensagens originais, causas, stacks, stdout/stderr, argumentos, ambiente ou credenciais. Os scripts PowerShell emitem marcadores limitados INFRA_OBSERVER (paths/listener/processes/data/fingerprint/recheck/domain); o Node só extrai esses tokens. O domínio recebido também é validado como JSON com path, directoryId e SID antes de estabelecer continuidade, mantendo a aprovação física/ACL feita pelo script. A referência continua sendo carregada pelo mesmo loadIndependentReference, com independência, digest, UTF-8 estrito, limites e migrations exigidos. O ambiente mínimo e o fallback nativo permanecem inalterados.

Preparada uma regressão D1.3 de diagnóstico: preserva etapas/códigos permitidos e recusa mensagens, streams, URLs/tokens fictícios e códigos não allowlisted. A assertion da regressão existente das três chamadas PowerShell foi ajustada somente para reconhecer o wrapper de diagnóstico, preservando a verificação do env explícito e das duas chamadas do supervisor. Nove casos D1.2 preservados. Não foi executado teste/typecheck nem comando operacional. Os 220/220 históricos antecedem esta correção; não constituem aprovação automática da nova versão.

### Revalidação local objetiva, sem SQL

Manter a delegação temporária ativa no console administrativo durante a atestação; se já foi restaurada, nova delegação exige autorização pontual. O journal e pilot-domain.json já provisionados devem ser preservados. Executar em console sem elevação, na raiz backend. Não apagar variáveis nesta primeira reprodução: se entry falhar, conferir as condições abaixo sem imprimir valores secretos. Nenhum desses comandos autoriza campanhas.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$infraBin = Read-Host 'Diretorio bin convencional aprovado'
$infraData = Read-Host 'Diretorio data convencional aprovado'
$infraFingerprint = 'd1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180'
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts check $infraBin $infraData $infraFingerprint
$infraCheckExit = $LASTEXITCODE
Write-Output ('Check exit code: ' + $infraCheckExit)
if ($infraCheckExit -ne 0) { throw 'Registrar somente o diagnostico sanitizado; nao executar campanhas' }
```

Interpretação: entry requer Windows, NODE_ENV=test, ProgramData/SystemRoot presentes, argumentos completos/fingerprint lowercase 64 hex e ausência de nomes PG*, NODE_OPTIONS, NODE_PATH, NODE_DEBUG* e NODE_PG_FORCE_NATIVE; não listar seus valores. observer-environment indica SystemRoot fora do contrato. windows-observer/journal-observer distinguem lançamento/timeout/erro do PowerShell; observer=processes aponta a etapa nativa/CIM, domain aponta validações do domínio. windows-json/journal-json indicam saída não consumível pelo contrato; não publicar a saída bruta sem revisão. windows-fingerprint indica identidade diferente da aprovada ou alterada entre observações: parar, sem trocar o fingerprint. journal-continuity indica mudança da saída/identidade do domínio. reference-authority indica leitura/JSON/aprovação/digest/procedência/migrations incompatíveis: preservar os arquivos e investigar pelo diagnóstico restrito, sem re-homologação automática. Se falhar antes de qualquer check-stage, registrar falha de bootstrap separadamente. A origem operacional exata continua pendente da reprodução local com esses diagnósticos; esta rodada resolve a perda comprovada da evidência.

Para Luna/responsável, após revisão dos comandos e em ambiente local saudável, preparar execução sem banco:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck falhou' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.3 ' test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Diagnosticos falharam' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Regressao simulada falhou' }
```

Arquivos desta rodada: pilot-executor.ts, inspect-postgres-windows.ps1, inspect-pilot-domain.ps1, integration-campaign.test.ts, relatório e patch. Nenhuma permissão, journal, autoridade ou referência foi modificada; nenhum banco/campanha/teste/typecheck foi acessado/executado pelo Codex. Índice real preservado. A aplicação isolada e reversão do patch são verificadas na geração.

## INFRA-01.D1.3 — Proprietário do ancestral Windows e confirmação de reversão

A revisão operacional identificou TrustedInstaller como proprietário legítimo de C:\. As duas guardas, prepare-process-query-delegation.ps1 e inspect-pilot-domain.ps1, rejeitavam esse proprietário. Agora admitem seu SID fixo S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464 exclusivamente na raiz do volume do Windows, identificada por SystemRoot, quando ela é ancestral do caminho inspecionado. Não se admite TrustedInstaller como proprietário da autoridade, arquivos publicados, journal, evidências ou pais da aplicação. O pai imediato das evidências continua restrito a SYSTEM/Administradores. Não há allowlist genérica de proprietários para toda a árvore.

As máscaras e verificações de ACE de escrita, exclusão, substituição, mudança de permissões e propriedade não foram relaxadas; reparse points continuam rejeitados. A exceção trata somente o proprietário: qualquer ACE antes proibida continua bloqueando, mesmo quando o dono da raiz é TrustedInstaller. Caso a verificação seguinte encontre uma ACE incompatível, registrar a evidência específica e interromper; esta alteração não autoriza ajustes de permissões reais.

Restore agora informa se uma DACL foi realmente alterada e restaurada. O finally só emite “Original DACLs restored and byte-verified; handles closed” com a lista de PIDs após verificar a igualdade byte a byte e encerrar os handles sem erro. Se nada foi alterado, informa explicitamente que não houve restauração necessária. Qualquer falha continua produzindo bloqueio, sem mensagem de sucesso. Isso é comportamento preparado, não evidência de reversão já executada.

Ordem consolidada obrigatória do roteiro: (1) Probe sem elevação para capturar Win32; (2) delegação administrativa temporária, mantendo seu console aberto; (3) atestação Windows sem elevação; (4) provisionamento administrativo autorizado do domínio vazio e pilot-domain.json pelo bloco 1 abaixo, se ainda não existirem; (5) inspeção do domínio e check sem elevação; (6) somente então campanhas individualmente autorizadas; (7) restauração no console administrativo ao finalizar a janela. O bloco de delegação é complementar: seu passo 3 de check pressupõe o provisionamento do domínio concluído. Se o domínio já existe, conferir e reutilizar sem sobrescrever; não repetir o provisionamento. Atestação Windows e Probe não dependem do journal; inspect-pilot-domain e check dependem dele. Não executar check como tentativa de substituir provisionamento.

Arquivos desta rodada: as duas guardas PowerShell, relatório e patch acumulado. Nenhum teste/typecheck, provisionamento, alteração de ACL ou acesso a banco foi executado. Os 220 testes históricos antecedem esta correção. Luna/responsável deverão validar em console local a aceitação da raiz legítima, a recusa de TrustedInstaller nos caminhos de aplicação, manutenção das rejeições de ACE/reparse, ordem provisionamento/check e mensagem de restauração; a confirmação operacional permanece pendente.

## INFRA-01.D1.3 — Delegação temporária de consulta aos objetos de processo

O responsável confirmou que OpenProcess retornou handle nulo no fallback, enquanto as demais verificações preliminares passaram. Isso não comprova retrospectivamente ERROR_ACCESS_DENIED=5: o interop anterior não capturava LastError com SetLastError=true. O modo Probe do roteiro novo repete exatamente OpenProcess(0x1000,false,pid), captura Marshal.GetLastWin32Error pela declaração PInvoke correta e informa NativeErrorCode. Deve ser executado pela conta sem elevação antes da delegação; registrar o número real. Não assumir o código 5 nem executar delegação se a causa exigir outra investigação.

Preparado backend/test/infrastructure/prepare-process-query-delegation.ps1, utilitário administrativo pontual, independente do executor. Não foi executado ou testado nesta rodada. Usa GetSecurityInfo/SetSecurityInfo por handles, SE_KERNEL_OBJECT e apenas DACL_SECURITY_INFORMATION na escrita. O administrador abre READ_CONTROL|WRITE_DAC|PROCESS_QUERY_LIMITED_INFORMATION (0x61000); a única ACE adicionada ao SID executor é Allow 0x1000, explícita e não herdável. Não altera proprietário, SACL, memberships, privilégios Windows ou ACLs de instalação/serviço. Preserva a DACL original e a ordem/bytes das ACEs, recusa DACL nula, ACEs não suportadas, herança ou ordem incompatível; não remove DENY para obter sucesso. A presença de DENY aplicável pode manter o acesso bloqueado; nesse caso reverter e apresentar o impedimento, sem aumentar direitos.

Antes de qualquer escrita, a atestação administrativa completa exige fingerprint aprovado, serviço, listener, horários, executáveis efetivos/hashes e diretório. O utilitário obtém os PIDs atuais dessa atestação, mantém handles para esses mesmos objetos e compara imagem/CreationDate nativa com CIM (tolerância exclusiva de 9 ticks de 100 ns pela resolução de microssegundos do CIM). Repete a atestação antes de cada concessão. Não fixa os PIDs históricos 6496/10572. Armazena descritor original, identidade e descritor concedido em diretório novo protegido Administradores/SYSTEM; imprime SHA-256 das evidências. Compara a DACL escrita byte a byte com original mais uma única ACE. Há janela de concorrência inerente entre leitura e escrita da DACL: realizar sob administração exclusiva, sem outro gerenciador de permissões. Mudança concorrente detectada bloqueia a restauração automática para não sobrescrever direitos de terceiros.

O roteiro mantém o console administrativo aberto enquanto o operador verifica a atestação sem elevação. Ao pressionar Enter no console administrativo, ou diante de falha normal do script, finally restaura a DACL original através dos mesmos handles e confere os bytes, depois fecha os handles. A janela pode permanecer aberta até terminar uma atividade operacional autorizada separadamente. Não há opção de retenção permanente. Não fechar à força o console administrativo: kill, desligamento ou falha do host não garantem execução de finally. Nesse caso preservar os descritores e a identidade, bloquear campanhas e exigir revisão administrativa para restaurar a DACL original no objeto ainda identificado; se o processo reiniciou, não aplicar backup ao PID reutilizado. A concessão vale somente para os objetos atuais e deve ser reavaliada após reinício do PostgreSQL.

### Comandos preparados — somente após autorização expressa de alteração de permissões

1. PowerShell 5.1 NÃO elevado da conta executora, em console normal com TEMP gravável. O utilitário de preparação usa Add-Type/CodeDOM; ele não é chamado no ambiente mínimo do observador. Se a política impedir compilação local, parar e revisar o impedimento sem executar bypass. Probe só consulta processos Windows, sem conexão SQL.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
whoami /user
$infraBin = Read-Host 'Diretorio bin convencional aprovado'
$infraData = Read-Host 'Diretorio data convencional aprovado'
$infraFingerprint = 'd1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180'
& .\test\infrastructure\prepare-process-query-delegation.ps1 -Mode Probe -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData -ExpectedFingerprint $infraFingerprint
# Registrar PID e Win32 real. Nenhuma permissao foi alterada no Probe.
```

2. Novo PowerShell administrativo, autorização pontual. A pasta-pai das evidências deve existir, pertencer a Administradores/SYSTEM e impedir escrita/substituição por outras contas; pode ser a autoridade previamente protegida, sem tocar nos arquivos da referência. Não modificar ACLs de ancestrais para fazer o roteiro passar. O SID informado é o da conta executora, não o do administrador.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$infraBin = Read-Host 'Diretorio bin convencional aprovado'
$infraData = Read-Host 'Diretorio data convencional aprovado'
$infraFingerprint = 'd1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180'
$infraSid = Read-Host 'SID conferido da conta executora nao elevada'
$infraEvidence = Join-Path $env:ProgramData ('ArenaGO\integration-authority\process-delegation-' + [guid]::NewGuid().ToString('N'))
& .\test\infrastructure\prepare-process-query-delegation.ps1 -Mode Delegate -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData -ExpectedFingerprint $infraFingerprint -OperatorSid $infraSid -EvidenceDirectory $infraEvidence
# Confirmar GRANT-0x1000 somente apos revisar evidencias/autorizar.
# Manter aberto no prompt final enquanto o operador executa o bloco seguinte.
# Enter no prompt final restaura ambas as DACLs; falha de restauracao bloqueia o piloto.
```

3. No console NÃO elevado inicial, repetir Probe e a atestação completa. Antes de check, concluir o provisionamento autorizado do domínio e pilot-domain.json pelo bloco 1 da preparação D1.3 abaixo, se ainda pendente. Depois usar o check D1.3 para repetir a mesma atestação dentro do ambiente mínimo do observador. Não iniciar campanhas automaticamente.

```powershell
& .\test\infrastructure\prepare-process-query-delegation.ps1 -Mode Probe -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData -ExpectedFingerprint $infraFingerprint
& .\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
if (!$?) { throw 'Atestacao inconclusiva; solicitar reversao administrativa' }
$env:NODE_ENV = 'test'
if (!(Test-Path -LiteralPath (Join-Path $env:ProgramData 'ArenaGO\integration\127.0.0.1-55432-arenago_events_test') -PathType Container) -or
    !(Test-Path -LiteralPath (Join-Path $env:ProgramData 'ArenaGO\integration-authority\pilot-domain.json') -PathType Leaf)) {
    throw 'Concluir provisionamento administrativo autorizado antes de check'
}
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts check $infraBin $infraData $infraFingerprint
if ($LASTEXITCODE -ne 0) { throw 'Check inconclusivo; solicitar reversao administrativa' }
# Finalizada a janela, pressionar Enter no console administrativo.
# Repetir Probe aqui e comparar com a evidencia ANTERIOR, confirmando reversao.
```

Critérios: erro Win32 real registrado antes; atestação administrativa aprovada; somente ACE 0x1000 acrescentada; consulta/imagem e fingerprint equivalentes sem elevação; check aprovado; reversão byte a byte confirmada e Probe coerente com estado anterior. Sem direitos administrativos suficientes para READ_CONTROL/WRITE_DAC ou se consulta limitada continuar negada, interromper e reverter. Não ativar SeDebugPrivilege, tomar propriedade, conceder ALL_ACCESS/VM_READ/VM_WRITE ou alterar a arquitetura. Confirmar concessão efetiva apenas após esses comandos; nenhuma delegação ou atestação foi executada pelo Codex.

Referências: https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo e https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo. Alterações desta rodada: roteiro administrativo novo, relatório e patch acumulado. Testes/typecheck pendentes de Luna; campanhas/bancos não acessados.

## INFRA-01.D1.3 — Caminho efetivo do processo sem elevação

O responsável confirmou serviço ativo, pg_ctl PID 6496 e postgres PID 10572 com parentesco e CreationDate corretos; ExecutablePath/CommandLine ausentes pelo CIM sem elevação. postmaster.pid/PG_VERSION legíveis, fsutil/NTFS/ACLs e autoridade aprovados. A falha ocorria na exigência de ExecutablePath no bloco serviço/processos. Esses PIDs são evidência histórica, não valores fixados no código.

A atestação necessita PID, ParentProcessId, CreationDate e caminho efetivo; não consulta CommandLine do processo. Continua conferindo Win32_Service.PathName e seu único -D contra executável efetivo e diretório aprovado. Quando o CIM não informa ExecutablePath, Get-AttestedProcessImage chama QueryFullProcessImageNameW com flag 0 (caminho Win32), abrindo handle somente com PROCESS_QUERY_LIMITED_INFORMATION (0x1000), sem herança. Falha/vazio/truncamento ou falha ao fechar handle bloqueia a atestação. O handle é fechado em finally. Caminho retornado atravessa as mesmas validações de unidade, reparse points e comparação com instalação. A reconferência final repete caminhos efetivos, CreationDate e parentesco para detectar substituição/PID reutilizado. Serviço, listener, diretórios, versões e hashes anteriores permanecem exigidos. A fórmula do fingerprint não muda; evidências equivalentes produzem o mesmo resultado. Reinício real exige nova aprovação da identidade.

Foi usado Reflection.Emit/PInvoke em memória do .NET Framework para compatibilidade PowerShell 5.1. Evita Add-Type/CodeDOM, csc e dependência de arquivos temporários/perfil; TEMP e USERPROFILE continuam vazios no observador. Não há concessão de privilégios, alteração de ACL ou tentativa de elevação. Política de execução/ConstrainedLanguage que impeça Reflection.Emit ou ACL do processo que negue até consulta limitada continua sendo impedimento fail-closed; eventual ajuste requer decisão específica, sem fallback para caminho presumido. Compatibilidade real com a conta/PowerShell instalado aguarda execução local.

Referência oficial consultada: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew — permite PROCESS_QUERY_LIMITED_INFORMATION e flag 0 para formato Win32. Alterações: inspect-postgres-windows.ps1, nova regressão inspect-postgres-windows-process.test.ps1, relatório e patch acumulado. Regressões preparam consulta real apenas do próprio PowerShell com TEMP/USERPROFILE vazios, caminho CIM sem fallback, fallback ausente no CIM, recusa de CreationDate ausente e falha nativa simulada. Nenhum teste/typecheck ou atestação foi executado nesta correção; os 220/220 anteriores não validam automaticamente esta versão.

Comandos para Luna/responsável, em PowerShell 5.1 NÃO elevado. A regressão não consulta PostgreSQL. A atestação operacional observa Windows/arquivos, sem conexão SQL. Usar caminhos convencionais já aprovados e comparar os fingerprints existentes; se divergirem, parar e investigar antes de qualquer campanha.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile
powershell.exe -NoProfile -File .\backend\test\unit\inspect-postgres-windows-process.test.ps1
if ($LASTEXITCODE -ne 0) { throw 'Regressao de processos falhou' }
powershell.exe -NoProfile -File .\backend\test\unit\inspect-postgres-windows-path.test.ps1
if ($LASTEXITCODE -ne 0) { throw 'Regressao de caminhos falhou' }
# No console sem elevacao; caminhos efetivamente aprovados, nunca presumidos.
$infraBin = Read-Host 'Diretorio bin convencional aprovado'
$infraData = Read-Host 'Diretorio data convencional aprovado'
& .\backend\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
if (!$?) { throw 'Atestacao inconclusiva' }
# Depois, usar o check do roteiro D1.3: ele repete a atestacao no ambiente minimo real.
Set-Location backend
$env:NODE_ENV = 'test'
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts check $infraBin $infraData d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180
if ($LASTEXITCODE -ne 0) { throw 'Check inconclusivo; nao iniciar campanha' }
```

O check exige o domínio e pilot-domain.json previamente provisionados conforme autorização separada. Os comandos não concedem autorização de campanhas ou banco. Inspeção estática e integridade Git/patch são as únicas verificações efetuadas pelo Codex nesta rodada.

## INFRA-01.D1.3 — Preparação operacional e recuperação autorizada

O responsável confirmou typecheck e **220/220 testes aprovados**, incluindo os nove focados D1.2, sem falhas, skips, cancelamentos ou TODO, para o patch AAC431058A179275E310625ACA34C788EB1370064858D6F32DE617D3051116F2. Luna: parecer A. Astra: parecer B, favorável à homologação controlada, com complemento documental de recuperação BC-07. Esses resultados antecedem esta atualização documental; nenhum comando operacional abaixo foi executado pelo Codex.

BC-05: lock dedicado, heartbeat, IPC e provas de encerramento implementados; comportamento real pendente. BC-06: contagens estritas simuladas; comprovar 41 D06, 70 D09 e 111 sequenciais. BC-07: domínio físico/ACLs implementados; recuperação detalhada abaixo. BC-08: autorização anterior aos pools/Nest e gates de conexões físicas implementados; substituições e carregamento real pendentes. Escopo definitivo: duas piloto e 41 legadas, D2/D3 adiadas. IPC não protege contra processos maliciosos da mesma identidade; lock depende de cooperação; memória gerenciada não garante apagamento das credenciais. A exceção administrativa D1.1 não se aplica ao executor.

### 1. Provisionamento administrativo — autorização específica necessária

Usar PowerShell administrativo somente neste bloco. Obter previamente o SID por `whoami /user` no console NÃO elevado da conta executora. Preservar a referência v2 e aprovação publicadas. Não reutilizar a VM.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$ErrorActionPreference = 'Stop'
$infraOperator = Read-Host 'SID da conta executora sem elevacao'
if ($infraOperator -notmatch '^S-1-5-21-(\d+-){3}\d+$') { throw 'SID invalido' }
$infraAuthority = Join-Path $env:ProgramData 'ArenaGO\integration-authority'
$infraParent = Join-Path $env:ProgramData 'ArenaGO\integration'
$infraJournal = Join-Path $infraParent '127.0.0.1-55432-arenago_events_test'
$infraApprovalPath = Join-Path $infraAuthority 'pilot-domain.json'
function Confirm-InfraPath([string]$Path) {
    $e = Get-Item -LiteralPath $Path -Force
    $d = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($e.FullName))
    if ($d.DriveType -ne 'Fixed' -or $d.DriveFormat -ne 'NTFS') { throw 'Volume inadequado' }
    while ($null -ne $e) {
        if ($e.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirecionamento' }
        Get-Acl -LiteralPath $e.FullName | Format-List Path,Owner,Access
        $e = if ($e -is [IO.FileInfo]) { $e.Directory } else { $e.Parent }
    }
}
function Set-InfraAcl([string]$Path,[bool]$Directory,[bool]$Writable) {
    $acl = if ($Directory) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18','S-1-5-32-544',$infraOperator)) {
        $rights = if ($sid -ne $infraOperator) { 'FullControl' } elseif ($Writable) { 'Modify' } else { 'ReadAndExecute' }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]$rights,
            $inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Confirm-InfraPath $infraAuthority
if ((Get-FileHash (Join-Path $infraAuthority 'reference-v2.json') -Algorithm SHA256).Hash -ne 'C96BB176BDE7F3F8A4108EDC5418AED756CD9E2C405908C86A8C5076B60C3C1D') { throw 'Referencia divergente' }
if ((Test-Path -LiteralPath $infraJournal) -or (Test-Path -LiteralPath $infraApprovalPath)) { throw 'Dominio/registro existente: revisar sem sobrescrever' }
if (!(Test-Path -LiteralPath $infraParent)) {
    [void](New-Item -ItemType Directory -Path $infraParent)
    Set-InfraAcl $infraParent $true $false
}
Confirm-InfraPath $infraParent
if ((Read-Host 'Confirme ACLs dos ancestrais e autorizacao: PROVISIONAR') -cne 'PROVISIONAR') { throw 'Sem autorizacao' }
[void](New-Item -ItemType Directory -Path $infraJournal)
Set-InfraAcl $infraJournal $true $true
Confirm-InfraPath $infraJournal
$infraFileIdText = & fsutil.exe file queryfileid $infraJournal
if ($LASTEXITCODE -ne 0) { throw 'FileId indisponivel' }
$infraFileId = [regex]::Match(($infraFileIdText -join ''),'0x[0-9a-fA-F]{16,32}')
$infraVolume = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + [IO.Path]::GetPathRoot($infraJournal).TrimEnd('\') + "'")
if (!$infraFileId.Success -or !$infraVolume.VolumeSerialNumber) { throw 'Identidade inconclusiva' }
$infraApproval = [ordered]@{ path=$infraJournal; directoryId=($infraVolume.VolumeSerialNumber + ':' + $infraFileId.Value.ToLowerInvariant()); operatorSid=$infraOperator }
[IO.File]::WriteAllText($infraApprovalPath,($infraApproval | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Set-InfraAcl $infraApprovalPath $false $false
Get-Acl -LiteralPath $infraApprovalPath | Format-List Owner,Access
$infraApproval | ConvertTo-Json
```

Sucesso: domínio vazio, identidade registrada, operador com Modify no journal e somente leitura na autoridade. Revisar todos os ancestrais pela política da guarda. Não substituir ACLs de ProgramData/unidade indiscriminadamente. ACL/proprietário incompatível exige ajuste mínimo separado e autorizado.

### 2. Conta sem elevação — check e campanhas autorizadas

Abrir console dedicado NÃO administrativo. Se a instância convencional foi reiniciada, interromper e obter nova atestação/aprovação do fingerprint; não trocar silenciosamente o valor abaixo. API, suítes legadas e outros escritores devem estar parados. O preflight também recusa sessões concorrentes.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$ErrorActionPreference = 'Stop'
$infraPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($infraPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Executor elevado' }
whoami /user
$infraBin = Read-Host 'Diretorio bin aprovado PostgreSQL 18.6'
$infraData = Read-Host 'Diretorio data convencional aprovado'
$infraFingerprint = 'd1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180'
$infraJournal = Join-Path $env:ProgramData 'ArenaGO\integration\127.0.0.1-55432-arenago_events_test'
$infraAuthority = Join-Path $env:ProgramData 'ArenaGO\integration-authority'
& .\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
& .\test\infrastructure\inspect-pilot-domain.ps1 -Directory $infraJournal -Authority $infraAuthority
# Conferem CIM/ExecutablePath, listeners, fsutil, ACLs, SID e identidade fisica.
Get-ChildItem Env: | Where-Object { $_.Name -match '^(PG|DATABASE|EVENTS_TEST_DATABASE_URL$|JWT|TOTP|NODE_OPTIONS$|NODE_PATH$|NODE_DEBUG|NODE_PG_FORCE_NATIVE$|DOTENV_CONFIG)' } |
    ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:NODE_ENV = 'test'
function Invoke-InfraPilot([string]$Action) {
    & node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts $Action $infraBin $infraData $infraFingerprint
    if ($LASTEXITCODE -ne 0) { throw ('Piloto inconclusivo: ' + $Action + '. Preservar dominio.') }
}
Invoke-InfraPilot 'check'
foreach ($infraAction in @('D06','D09','both')) {
    if ((Read-Host ('Confirme janela exclusiva e autorizacao especifica: ' + $infraAction)) -cne $infraAction) { throw 'Sem autorizacao' }
    Invoke-InfraPilot $infraAction
}
Get-ChildItem -LiteralPath (Join-Path $infraJournal 'campaigns') -Filter *.json | ForEach-Object {
    $r = Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json
    $r | Select-Object id,phase,preflight,postflight,resources,lock,recoveryPending
    $r.attempts | Select-Object suite,state,result
    if ($r.phase -ne 'clean' -or $r.recoveryPending -or $r.postflight -ne 'passed' -or $r.resources -ne 'passed' -or $r.lock -ne 'closed') { throw 'Registro inconclusivo' }
}
if (Test-Path -LiteralPath (Join-Path $infraJournal 'occupied')) { throw 'Marcador residual' }
```

Exigir exit 0 e totais 41/70/111 sem skips/cancelamentos/TODO, preflight/postflight/resources passed, lock closed e recoveryPending false. O check não conecta SQL. Se CIM/fsutil/ACLs falharem sem elevação, interromper: a solução proporcional é avaliar delegação administrativa mínima de leitura à conta executora, autorizada separadamente. A viabilidade ainda precisa ser demonstrada; não elevar o executor nem enfraquecer a guarda.

### 3. Interrupção, reconciliação e arquivamento por incidente

Após campanhas normais aprovadas, obter autorização específica para interrupção. Registrar snapshot anterior protegido fora da árvore ativa: linhas integrais de games/questionnaire_versions, identidade, tabelas operacionais vazias, processos e horários. A consulta abaixo é somente leitura, usa senha solicitada por psql -W e deve ser repetida após a interrupção. Conferir banco/role/endpoint antes de aceitar o snapshot e comparar integralmente o JSON do baseline, inclusive UUIDs/timestamps.

```powershell
$infraSql = @'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(),current_user,session_user,inet_server_addr(),inet_server_port();
SELECT jsonb_build_object('games',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.games g),'questionnaires',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM public.questionnaire_versions q));
SELECT pid,application_name,state,xact_start FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();
SELECT gid,owner,database FROM pg_catalog.pg_prepared_xacts WHERE database=current_database();
SELECT pid,classid,objid,granted FROM pg_catalog.pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database());
ROLLBACK;
'@
& (Join-Path $infraBin 'psql.exe') -X -W -h 127.0.0.1 -p 55432 -U arenago -d arenago_events_test -v ON_ERROR_STOP=1 -c $infraSql
if ($LASTEXITCODE -ne 0) { throw 'Snapshot inconclusivo' }
# Guardar evidencia local protegida. Em outro console observar campaigns/*json.
Invoke-InfraPilot 'D06'
# Ao confirmar registro running, pressionar Ctrl+C UMA vez no console executor.
# Esperar encerramento e parar este bloco. Nao iniciar outra campanha automaticamente.
```

Conferir PIDs/instantes de criação do supervisor, worker e observadores: nenhum processo remanescente. Repetir o snapshot SQL: nenhuma outra sessão, transação preparada ou lock de campanha. Comparar baseline anterior/posterior. Repetir atestação/check. Uma tentativa de reutilização especificamente autorizada deve ser recusada pelo marcador/histórico. Interrupção anterior ao claim ou posterior à conclusão não demonstra esse cenário. Fixtures ou processos residuais bloqueiam recuperação: reconciliar por UUID em operação separada explicitamente autorizada, sem exclusões abrangentes. Executar então a qualificação somente leitura D1.1 documentada, com nova autorização, para comprovar estrutura/migrations/baseline operacional vazio; não substitui a comparação integral das linhas.

**Complemento BC-07 obrigatório:** claim recusa registros interrupted/inconsistent mesmo sem occupied. Depois de comprovar encerramento, baseline e reconciliação, o administrador deve criar arquivo protegido FORA do domínio ativo, com ACL Administradores/SYSTEM FullControl e operador ReadAndExecute, utilizando Set-InfraAcl do bloco 1 com Writable=false. Copiar integralmente o domínio, incluindo occupied/owner, JSONs e temporários, sem atravessar reparse points. Gerar manifesto SHA-256 por caminho relativo e conferir cada cópia byte a byte. Registrar campanha, SID/responsável, instante, motivo, autorização, snapshots e decisão. Preservar permanentemente os registros originais no arquivo; nunca editar interrupted/inconsistent para clean.

Somente após conferir arquivo/ACLs/hashes e obter autorização nominal da lista de caminhos, retirar da árvore ativa os registros inconclusivos e resíduos reconciliados. Preservar os registros terminais válidos. Retirar occupied por último. Não recriar a raiz do journal ou modificar pilot-domain.json, pois directoryId deve permanecer. Não colocar o arquivo de evidências dentro de campaigns. Usar operações manuais por caminhos absolutos verificados; nenhuma limpeza automática ou abrangente está autorizada por este roteiro. Se não houver prova suficiente, preservar tudo e manter bloqueado. A lista concreta depende do incidente, portanto não há comando genérico de remoção.

Após arquivamento autorizado, conferir novamente identidade física/ACLs, histórico ativo terminal e ausência do marcador; executar check sem elevação e nova D06 expressamente autorizada. Exigir conclusão limpa e relacionar sua evidência ao incidente arquivado. Isso demonstra recuperação; D1.3 permanece pendente até execução real. Esta rodada altera somente documentação/patch, sem banco, provisionamento, testes ou typecheck; branch/HEAD e índice preservados.

## INFRA-01.D1.2 — Classificação do executor no inventário

O responsável informou typecheck aprovado, nove casos focados aprovados e regressão simulada com 218/220 aprovados, sem skips ou cancelamentos. Duas falhas apontaram descoberta de 44 arquivos para um manifesto de 43 suítes. Esses resultados antecedem esta correção.

O arquivo adicional é backend/test/infrastructure/pilot-executor.ts, introduzido na D1.2. discoverIntegrationFiles percorre backend/test e também descobre arquivos por análise AST de importação pg e construção de Pool/Client. O executor importa Client e cria new Client no adaptador supervisor, satisfazendo esse critério mesmo fora da pasta de integração. Ele fornece a entrada operacional main/check/D06/D09/both e não registra casos de teste. Trata-se de auxiliar de infraestrutura legítimo, sem nova suíte funcional ou artefato gerado. A inspeção direta da pasta backend/test/integration confirmou os 43 arquivos *.integration.test.ts históricos.

A correção classifica o caminho exato do executor no conjunto connectionHelpers já utilizado para auxiliares de conexão. A descoberta continua analisando construtores PostgreSQL no restante da árvore e validateIntegrationManifest mantém a recusa de arquivos sem classificação. Não houve exclusão genérica da pasta infrastructure nem ajuste das contagens. O inventário continua com 43 suítes, duas piloto e 41 legadas. A assertion existente do inventário agora verifica expressamente a ausência do executor na lista de suítes, além da contagem 43 e correspondência completa com o manifesto. As nove regressões focadas e as correções de Client e ambiente permanecem preservadas.

Arquivos desta rodada: integration-inventory.ts, integration-infrastructure.test.ts, este relatório e patch acumulado. Inspeção estática e git diff --check realizados. Testes e typecheck aguardam Luna Medium. Patch regenerado em índice e objetos temporários, conferido por aplicação sobre a base, reversão e igualdade dos 32 blobs. Índice real vazio e preservado. Nenhum banco foi acessado.

## INFRA-01.D1.2 — Defaults nativos de ambiente Windows

O responsável confirmou typecheck aprovado sem diagnósticos após a correção TS4058. A campanha local focada executou nove casos, com oito aprovados e uma falha em “D1.2 observador recebe ambiente mínimo sem credenciais no subprocesso”, por variável TEMP inesperada. A regressão completa não foi iniciada. Esses resultados antecedem esta correção.

A origem foi conferida no código nativo da libuv distribuído com Node v24.15.0, deps/uv/src/win/process.c, required_vars e make_program_env. O runtime completa variáveis Windows ausentes a partir do pai, incluindo TEMP e USERPROFILE, além de HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, USERDOMAIN, USERNAME e WINDIR. A inspeção de child_process do Node instalado também confirmou a propagação especial de NODE_V8_COVERAGE, já bloqueada pelo helper existente. Fonte consultada: https://github.com/nodejs/node/blob/v24.15.0/deps/uv/src/win/process.c.

windowsObserverEnvironment agora fornece TEMP e USERPROFILE explicitamente vazios, impedindo sua cópia automática. As demais entradas dessa lista já são fixadas ou esvaziadas pelo mecanismo existente. A mudança limita-se ao ambiente dos observadores. O ambiente de campanha e a compatibilidade do PilotClient ficam preservados. A regressão continua inspecionando process.env efetivamente recebido pelo subprocesso, exige TEMP/USERPROFILE vazios, recusa TMP e outras variáveis inesperadas, e usa caminhos fictícios no pai para comprovar que não são propagados. A lista permitida foi ampliada somente pelos dois defaults documentados, com valores estritamente vazios. As credenciais permanecem excluídas. Os nove casos previstos foram preservados e aguardam reexecução pela Luna Medium.

Nesta rodada foram realizadas inspeção de código e verificações de integridade Git. Testes, typecheck e atestação operacional não foram executados. O uso real do PowerShell com esse ambiente mínimo permanece sujeito à homologação local autorizada. Arquivos alterados: campaign-child-protocol.ts, integration-campaign.test.ts, este relatório e patch acumulado. A evidência foi regenerada com índice e objetos temporários, aplicação sobre a base, reversão e conferência dos 32 blobs, preservando o índice real vazio.

## INFRA-01.D1.2 — Assinatura pública e emissão de declarações

O responsável executou localmente o typecheck após a correção de connect. Os quatro diagnósticos anteriores deixaram de aparecer, mas a inferência do retorno exportado de createPilotClient produziu dois TS4058, relativos a StaticEventEmitterIteratorOptions e StaticEventEmitterOptions herdados pela classe anônima. A assinatura agora declara explicitamente typeof Client, tipo público importado de pg, incluindo construtor, contratos Promise/callback e membros estáticos. Isso evita expor o tipo inferido da classe anônima na declaração exportada.

A alteração de código limita-se à anotação de retorno de createPilotClient. A implementação da atestação, conexão, encerramento e isolamento de credenciais e as nove regressões preparadas permanecem preservadas. Não foram alteradas dependências ou configurações de emissão de declarações. Testes e typecheck desta versão aguardam Luna Medium. A validação local anterior foi informada pelo responsável e não comprova aprovação desta revisão.

Arquivos desta rodada: pilot-worker.ts, este relatório e qa-evidence/INFRA_01-changes.diff. Inspeção estática e git diff --check realizados. Patch acumulado regenerado com aplicação isolada sobre a base, reversão e correspondência dos 32 blobs. Índice e objetos Git reais preservados. Para validar em backend com NODE_ENV=test, executar npm.cmd run typecheck:test e os comandos focados e de regressão simulada documentados. Nenhum banco foi acessado.

## INFRA-01.D1.2 — Compatibilidade do PilotClient

A Luna executou npm.cmd run typecheck:test na versão 20B392C546C635D3EC11F82C67C91BA35481F24E03DD181E5649B283E0120E11 e encontrou quatro diagnósticos em PilotClient.connect (TS2416 em três declarações e TS2322 na configuração do pool), exit code 2. As tentativas focada e simulada completa pararam no bootstrap tsx com os.userInfo/ENOMEM, Node 24.15.0, exit code 1, sem testes carregados.

A inspeção das versões efetivamente instaladas confirmou pg 8.23.1, pg-pool 3.14.0 e @types/pg 8.23.1. Client.connect() resolve com o próprio Client. As tipagens declaram os callbacks de erro e sucesso separadamente. O pool utiliza callback e aguarda onConnect antes de disponibilizar cada cliente físico.

A implementação agora declara Promise<Client>, retorna this após atestação e super.connect, e invoca o callback de sucesso com null e o cliente. O callback de erro recebe somente erro sanitizado. Reflect.apply permite invocar as duas formas declaradas com seus argumentos documentados, sem coerções de tipo. A falha da atestação ou conexão encerra o cliente antes de publicar a rejeição. O factory createPilotClient permite simular essas dependências herdadas, mantendo a mesma classe e o gate onConnect no caminho normal do worker. A allowlist explícita dos três subprocessos PowerShell permanece preservada.

Duas regressões focadas adicionais verificam identidade do retorno Promise, callback e retorno void, ordem atestação/connect, ausência de conexão após falha na atestação e encerramento anterior ao erro nos contratos Promise/callback, incluindo falha física simulada. Total previsto do filtro D1.2 passa de sete para nove. Testes e typecheck desta correção aguardam Luna Medium. Nenhuma campanha ou conexão real foi executada.

Arquivos alterados nesta correção: pilot-worker.ts, integration-campaign.test.ts, este relatório e qa-evidence/INFRA_01-changes.diff. Inspeção estática e git diff --check efetuados. A evidência acumulada é regenerada e validada em índice/objetos temporários, com conferência reversa e dos blobs. O índice real permanece vazio. Comandos de validação, em backend com NODE_ENV=test: npm.cmd run typecheck:test; tsx.cmd --tsconfig tsconfig.test.json --test --test-name-pattern="^D1\.2 " test/unit/integration-campaign.test.ts; regressão completa simulada com integration-infrastructure.test.ts, integration-campaign.test.ts e as guardas legadas documentadas. Em caso de ENOMEM anterior ao carregamento, executar no PowerShell local saudável. Aprovação e homologação continuam pendentes.

## INFRA-01.D1.2 — Correção do ambiente dos observadores Windows

A revisão independente anterior emitiu parecer C e identificou propagação desnecessária de credenciais para o PowerShell. O worker herdava as URLs PostgreSQL e as chaves JWT/TOTP do ambiente de campanha. A inspeção desta correção encontrou a mesma herança nas duas chamadas do supervisor: atestação da instância e conferência do domínio do journal.

As três chamadas agora fornecem env explicitamente por windowsObserverEnvironment, reutilizando campaignSpawnEnvironment para bloquear defaults herdados pelo Node/libuv no Windows. A allowlist contém SystemRoot, WINDIR, SYSTEMDRIVE, ProgramData quando disponível e PATH construído exclusivamente com System32 e WindowsPowerShell/v1.0. Demais defaults Windows ficam vazios. Não são herdados PATH ou PSModulePath do chamador, URLs, PGPASSWORD, JWT, TOTP ou outras variáveis da aplicação. Os scripts usam módulos Windows e fsutil; o comportamento efetivo sem elevação continua sujeito à homologação local. O isolamento não altera autorizações, pools, fixtures ou o protocolo do piloto.

Foram preparadas duas regressões D1.2 em integration-campaign.test.ts: conferência do ambiente realmente recebido por subprocesso Node inofensivo com segredos fictícios no ambiente de entrada e conferência das três chamadas PowerShell, normalização dos nomes Windows e recusa de SystemRoot ausente. Os cinco casos anteriores permanecem, totalizando sete casos focados previstos. Não foram executados testes ou typecheck nesta correção. Luna Medium deverá executar os comandos já documentados com o filtro ^D1\.2 e a regressão simulada completa, incluindo as guardas legadas. Não há nova evidência de aprovação automatizada.

**Limitação residual aceita no desenho:** o IPC protege o fluxo oficial contra execução direta acidental; não constitui fronteira de segurança contra processos maliciosos sob a mesma identidade Windows. Esta correção não amplia a arquitetura para resolver esse risco. Permanecem pendentes a validação automatizada e a homologação operacional autorizada, inclusive CIM, fsutil, ACLs e pilot-domain.json sem elevação. Nenhum banco, diretório protegido ou ACL foi acessado ou alterado.

Arquivos desta correção: campaign-child-protocol.ts, pilot-worker.ts, pilot-executor.ts, integration-campaign.test.ts, este relatório e a evidência acumulada. Inspeção estática e git diff --check realizados; patch regenerado com índice e objetos temporários, sem alterar o índice real ou os objetos originais. A aplicação isolada, reversão e correspondência dos blobs são verificadas na geração. O SHA-256 final é informado na entrega para evitar referência circular.

## INFRA-01.D1.2 — Piloto D06/D09 implementado para validação

O responsável reduziu o escopo da INFRA-01 ao piloto de duas suítes. D2 e D3 foram adiadas e E/F passam à homologação e encerramento do piloto. A base acumulada de entrada tem SHA-256 BC913E4DBC50F85C3099933851515957FF20F551F95C668CD23766554C6CCEA3. O histórico abaixo permanece preservado.

### Integração entregue

O executor `backend/test/infrastructure/pilot-executor.ts` conecta o orquestrador existente ao PostgreSQL convencional e à autoridade ProgramData. A entrada aceita exclusivamente `check`, `D06`, `D09` e `both`. O comando check verifica Windows, autoridade e journal sem conectar ao banco. As campanhas usam senha sem eco, ambiente filho pela allowlist existente, scheduler desligado e referência homologada por digest. O fingerprint convencional é exigido como argumento sem credenciais.

As duas suítes migradas exigem permissão em memória antes de criar pools, fixtures ou inicializar Nest. Seus casos e assertions funcionais foram preservados. O worker recebe a permissão pelo protocolo IPC existente, instala o pool protegido antes de importar a suíte e usa `node:test.run` com isolamento none e concorrência 1. Um carregador TypeScript em memória evita subprocessos do compilador e arquivos gerados. O worker recusa lançamentos arbitrários de subprocessos. A única chamada de processo capturada previamente é a atestação Windows com script e argumentos fixados pelo executor.

Cada conexão física do pool, inclusive substituições, reatesta Windows antes do connect e passa por `onConnect` aguardado pelo pg-pool instalado. O gate SQL confere endpoint, banco, usuário de sessão, proprietário, versão, membership nas duas direções, privilégios e replication_role=origin antes de devolver o cliente. Isso alcança o pool de fixtures, a guarda legada e o pool independente do DatabaseModule antes dos hooks do Nest. Os limites de conexão consideram o tempo de atestação Windows.

O supervisor mantém o advisory lock da infraestrutura até concluir as verificações. Preflight e postflight usam a guarda completa e repetem a atestação Windows e do domínio. Os snapshots conferem a sessão logo após BEGIN e trabalham em REPEATABLE READ READ ONLY. O digest das linhas integrais ordenadas de games e questionnaire_versions preserva UUIDs, conteúdo e timestamps por JSON PostgreSQL. As comparações ocorrem entre todos os preflights/postflights, incluindo a transição D06 para D09. O encerramento inclui resposta estruturada, close do processo, pools vazios no worker e conferência independente de sessões e transações preparadas. As sessões supervisoras dedicadas são encerradas pelo protocolo existente. Falha de identidade, contagem, exclusividade, baseline ou recursos conserva a evidência de recuperação.

O resultado do runner é reconciliado com o manifesto: 41 casos D06, 70 D09 e 111 no conjunto. TODO, skips, cancelamentos, ausência de resumo ou contagem diferente impedem aprovação. As falhas funcionais completas recebem resultado test-failure após postflight e encerramento confirmados. A campanha para após a primeira suíte que falhar.

### Domínio Windows e permissões

O destino do journal é `%ProgramData%\ArenaGO\integration\127.0.0.1-55432-arenago_events_test`. A autoridade permanece em `%ProgramData%\ArenaGO\integration-authority`. O executor exige token sem elevação administrativa. O script `inspect-pilot-domain.ps1` verifica NTFS local, reparse points, donos, permissões de escrita/substituição dos ancestrais, volume e ID físico da pasta. O domínio é reconferido antes de claim, save e finish. A árvore é inspecionada sem atravessar uma entrada redirecionada.

O provisionamento prévio do domínio exige autorização específica do responsável. Administradores/SYSTEM administram a autoridade, arquivos da referência e o novo registro `pilot-domain.json`. A conta executora recebe leitura nessa área e Modify no domínio do journal. A pasta deve ser preexistente, protegida contra substituição por outras contas e ter identidade aprovada. O registro pilot-domain.json contém exatamente os valores aprovados de `path`, `directoryId` e `operatorSid`. directoryId usa `VolumeSerialNumber:0xFILEID`, com o FILEID hexadecimal minúsculo retornado por `fsutil file queryfileid`. O executor compara os valores efetivos com esse registro protegido. O domínio deve estar vazio na primeira campanha.

**Impedimento operacional a verificar.** A exceção administrativa usada na D1.1 não se aplica a este executor. Se a conta sem elevação não conseguir CIM, consulta de identidade física por fsutil, leitura das ACLs ou atestação da instalação, o check interrompe. O responsável precisa autorizar e preparar permissões Windows adequadas antes da homologação. Nenhuma permissão ou arquivo ProgramData foi alterado nesta implementação. A política conservadora também rejeita ancestrais com proprietários/permissões fora dos admitidos. Divergências exigem revisão das evidências, sem elevação automática ou flexibilização silenciosa.

### Recuperação manual e coexistência

Marcador occupied, histórico parcial/inconsistente, arquivos inesperados ou identidade divergente bloqueiam reutilização. Após interrupção, preservar o domínio, a autoridade e os registros. Em atividade autorizada separadamente, conferir processos remanescentes, sessões/transações e locks do banco, revisão do checkout, estrutura, migrations, linhas do baseline e recursos das fixtures por UUID. Registrar responsável, instante, evidências e decisão. Retirada de marcador exige autorização expressa após confirmar encerramento e reconciliação. O executor não oferece recuperação automática.

`npm run test:integration` agora interrompe antes de executar qualquer suíte e explica a migração. `npm run test:integration -- --legacy` identifica explicitamente a campanha das outras 41 suítes e exclui D06/D09. O comando exige as autorizações e destinos legados pertinentes e nunca constitui campanha completa das 43. O piloto e as suítes legadas não podem coexistir em execução sobre o destino convencional. O advisory lock protege os participantes do protocolo. As guardas legadas não adotam esse lock, portanto o responsável deve garantir janela exclusiva e ausência de API ou outros escritores.

### Comandos preparados

Executar em backend com Node compatível, instalação local de dependências e NODE_ENV=test. Informar os caminhos e o fingerprint convencional já aprovados. Os comandos de campanha exigem autorização expressa por execução. O executor lê a senha no próprio console.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
$infraBin = Read-Host 'Diretório bin aprovado'
$infraData = Read-Host 'Diretório de dados aprovado'
$infraFingerprint = Read-Host 'instanceSha256 convencional aprovado'

# Somente inspeção operacional, sem SQL
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts check $infraBin $infraData $infraFingerprint

# Selecionar uma campanha autorizada
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts D06 $infraBin $infraData $infraFingerprint
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts D09 $infraBin $infraData $infraFingerprint
node --require ./test/infrastructure/pilot-loader.cjs ./test/infrastructure/pilot-executor.ts both $infraBin $infraData $infraFingerprint
```

Para a Luna Medium, executar primeiro as verificações simuladas abaixo, após inspeção dos comandos. Elas não abrem banco. Em caso de ENOMEM no tsx, concluir no PowerShell local saudável, preservando os resultados.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw 'Typecheck falhou.' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.2 ' test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Regressões D1.2 falharam.' }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Regressão da infraestrutura falhou.' }
node --check test/infrastructure/pilot-loader.cjs
node --check scripts/integration-command.cjs
git diff --check
```

### Evidência e limites desta implementação

Foram preparados cinco casos simulados adicionais para seleção fora do piloto, recusa de autoridade sintética, execução completa e recusa de contagem parcial/skips com marcador conservado. Os cenários anteriores de perda de lock, protocolo IPC, postflight, recursos e journal permanecem. O carregamento do Nest, a substituição física dos clientes, a atestação Windows por conta sem elevação, os totais efetivos 41/70 e a continuidade real precisam ser demonstrados pela homologação autorizada. A transpilação do carregador também deve ser conferida com a aplicação completa durante o piloto. As contagens históricas são preservadas e nenhuma execução desta versão é declarada aprovada.

Arquivos modificados nesta etapa: backend/package.json, as duas suítes piloto, campaign-orchestrator.ts, read-postgres-preparation.ts, integration-campaign.test.ts e este relatório. Arquivos novos: scripts/integration-command.cjs, pilot-authorization.ts, pilot-loader.cjs, pilot-worker.ts, pilot-executor.ts e inspect-pilot-domain.ps1 em test/infrastructure, além da atualização da evidência acumulada. Não houve alteração de funcionalidade do aplicativo, referência homologada ou banco. Testes, typecheck e campanhas não foram executados pelo implementador, conforme AGENTS.md.

**Estado consolidado em 26/11/2026.** D1.1 aprovada operacionalmente pelo responsável e BC-04 encerrado no escopo de preparação, procedência, publicação e qualificação somente leitura. O registro final ao término deste documento substitui as pendências históricas dessas operações. A integração operacional das campanhas e demais entregas da D1.2 seguem em etapa própria.

## INFRA-01.A — Diagnóstico de referência

O inventário estático identificou 43 suítes e 1.388 registros de testes e subtestes, incluindo contêineres. As 2 suítes do grupo A já compartilham um destino demonstrado. As 35 do grupo B requerem adaptação de configuração ou guarda. As 2 do grupo C exigem tratamento de resíduos de fixtures. As 4 do grupo D exigem isolamento especializado por DDL, seed, varredura de scheduler ou histórico protegido.

A ADMIN-07 documentou D06 e D09 em sequência sobre PostgreSQL local dedicado. Em oito migrations e 26 tabelas públicas, o bootstrap deixou 20 jogos e uma versão de questionário. O estado remanescente foi conferido nas outras 24 tabelas daquela campanha. Esse resultado é histórico.

## INFRA-01.B — Fundação compartilhada

Base `de1275143a9d23c9fdbdd1ac171ed1a6acc05bd2` em `develop`. O checkout inicial estava na feature administrativa, limpa e com árvore idêntica à base aprovada. A branch `chore/integration-test-infrastructure` foi criada a partir de `develop`.

Esta etapa entrega manifesto, configuração isolada, validação anterior à conexão, atestação somente leitura por dependência injetada e testes com objetos simulados. O destino principal planejado é `127.0.0.1:55432/arenago_events_test`, role `arenago`. O grupo especializado permanece desabilitado. As guardas e suítes atuais continuam em uso durante a transição.

O aceite desta etapa exige inventário completo, rejeição anterior ao pool, encerramento seguro, conferência diferencial de schema e baseline em testes simulados, documentação e patch acumulado. A atestação do processo Windows, a aprovação do baseline vivo e a campanha real dependem de uma etapa autorizada separadamente.

### Manifesto e limites da descoberta estática

`backend/test/infrastructure/integration-manifest.ts` identifica os 43 arquivos e seus perfis. A contagem mantém os registros de contêineres e exclui duas combinações impossíveis de `participation-lifecycle`. D06 e D09 são marcadas como compatíveis sob o mecanismo legado. As demais permanecem pendentes de adaptação.

O inventário verifica nomes reconhecidos e as construções diretas de `Pool` e `Client` em fontes de teste com import ou require de `pg`. As exceções são os dois auxiliares existentes que abrem pools, cada um identificado pelo caminho. A análise não é um rastreador de chamadas interprocedural. Uma futura conexão indireta, dinâmica ou via outro driver exige revisão e atualização do inventário.

Os perfis isolados distinguem DDL de login Admin, execução deliberada do scheduler, seed de perfil e histórico protegido da migration 0008. Todos retornam erro antes de qualquer pool. Os requisitos de ausência de Admin global histórico, ausência de registros operacionais e presença do catálogo canônico são declarados. A suíte de idempotência Staff também declara a migration 0007. Nenhuma suíte existente foi redirecionada.

### Ambiente, atestação e baseline

A configuração filha nasce de uma lista de variáveis do SO, das três URLs textualmente idênticas, de quatro TTLs positivos de 60 s, de chaves sintéticas independentes e do dispositivo nulo da plataforma para dotenv. A URI exige destino literal local, role `arenago`, credenciais completas e ausência de query ou fragmento. O ambiente não propaga configurações herdadas de PG, Drizzle, dotenv, execução Node ou entrega de e-mail. A futura CLI deve construir esse ambiente antes de carregar a aplicação.

A atestação recebe somente uma fábrica de pool. A validação declarativa e a leitura dos artefatos precedem a solicitação do pool. As consultas usam transação repetível somente leitura e prazos de conexão, consulta e inatividade. Os erros têm mensagens fixas e a guarda tenta descartar conexões de sessão incerta e fechar o pool. A atestação verifica a identidade SQL, flags administrativas, memberships, proprietários, ACLs, schemas, catálogo e journal. Ela exige tabelas, índices válidos, constraints validadas, funções e triggers. O inventário cobre nomes e estados do catálogo esperado e não compara o corpo de cada função, trigger ou expressão de índice com o SQL original. A verificação do processo Windows e a exclusão mútua continuam necessárias.

Os timestamps e hashes vêm do journal e dos SQL do checkout. A gramática reconhece as formas DDL atuais. Um formato novo exige revisar o leitor e a expectativa do catálogo. O SQL é lido com os finais de linha materializados, conforme o cálculo do Drizzle. A assinatura semântica canônica compara nome e flag de curadoria dos jogos, versão, definição JSON e publicação do questionário. IDs e instantes de criação gerados no bootstrap ficam fora da assinatura. As demais tabelas são verificadas por existência de registros. O baseline vazio e o canônico são estados distintos. Nenhuma assinatura do banco vivo foi coletada.

### Validação da etapa B

| Inspeção executada | Resultado |
|---|---|
| Parser TypeScript por `node` e API `createSourceFile`, com conferência dos imports relativos | 6 fontes e 13 imports, exit code 0 |
| Comparação estática dos IDs do manifesto com os arquivos de integração | 43 arquivos, 1.388 registros e grupos 2/35/2/4, sem divergências, exit code 0 |
| Inspeção do journal e das formas DDL do checkout | 8 migrations e 26 tabelas públicas em artefatos, exit code 0 |
| `git diff --check`, `git diff --cached --exit-code` e conferência do inventário Git | Exit code 0, índice vazio e arquivos novos exclusivos da etapa |
| Geração por `git diff --no-index --binary --full-index` | Evidência `qa-evidence/INFRA_01-changes.diff` com sete arquivos novos, incluindo este relatório. O exit code 1 de cada diff indica a diferença esperada entre arquivo ausente e novo |
| `git read-tree` da base em índice temporário e `git apply --cached --check --whitespace=error` | Exit code 0. O hash do índice real permaneceu idêntico |
| `git apply --reverse --check` e `git apply --numstat` | Exit code 0. Reversão aplicável ao working tree e inventário dos sete arquivos confirmado |

A suíte preparada contém 54 casos estáticos com dependências simuladas. Testes e typecheck ficam pendentes de execução com Luna Medium, conforme o AGENTS.md. Comandos preparados para execução em `backend`:

```powershell
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts
npm.cmd run typecheck:test
```

Nenhum servidor PostgreSQL, serviço de e-mail, backend ou acesso ao Neon foi iniciado. A etapa não constitui homologação do ambiente real.

## Correção da atestação estrutural após o Parecer B

A validação independente da Luna aprovou `npm.cmd run typecheck:test` (exit code 0), a checagem de sintaxe da suíte e a aplicação reversa do patch. Os 54 casos simulados e os testes das guardas legadas ficaram sem execução. O `tsx` encerrou antes dos testes com `uv_os_get_passwd returned ENOMEM`. O erro ambiental não demonstra defeito na suíte. A Luna emitiu **Parecer B — Fundação condicionada** e apontou que objetos com os mesmos nomes e estados podiam ter definições diferentes. Também registrou a ausência de uma verificação independente de aplicação do patch sobre a base.

A correção usa uma referência estrutural versionável, independente do banco candidato. Seu conteúdo deve ser coletado futuramente de um schema limpo, preparado com as migrations oficiais e revisado sob autorização específica. O catálogo do candidato será lido dentro da transação somente leitura e comparado à referência. A ausência de referência válida deve bloquear a atestação. A descoberta de conexões permanece auxiliar, e o isolamento de processos filhos continua na INFRA-01.C.

### Contrato histórico da referência estrutural (v1)

O quarto argumento de `attestIntegrationDatabase` recebe uma referência previamente aprovada. O formato JSON v1 exige `formatVersion: 1`, `postgresVersionNum`, `schemas`, `migrations` e `objects`. O escopo é `drizzle` e `public`. Cada migration registra tag, timestamp decimal do journal e SHA-256 do SQL materializado, na ordem do checkout. Cada objeto registra tipo, schema, nome, relação quando aplicável, assinatura de argumentos para funções e propriedades estruturais. O contrato admite PostgreSQL 18 e exige o mesmo `server_version_num` da referência, inclusive na versão menor. Uma atualização que altere esse valor exige nova referência aprovada.

Uma referência ausente, vazia, malformada, com objetos duplicados ou incompatível com os artefatos falha antes da criação do pool. Após confirmar identidade, versão, permissões, inventário e migrations do candidato, a guarda projeta sua estrutura na mesma transação somente leitura. Um resultado compatível segue para os checks de precondições e de dados. Divergências encerram a atestação com rollback e seguem o tratamento de liberação e descarte de conexões já existente.

| Objeto | Propriedades comparadas |
|---|---|
| Relação e coluna | Tipo e persistência da relação, RLS, posição, tipo PostgreSQL, nulabilidade, expressão default ou de geração, identidade, geração e nome qualificado da collation |
| Constraint | Tipo, definição com colunas, tabela de referência e ações de FK, aplicação, validação, diferibilidade e estado inicial |
| Índice | Definição com método, colunas e expressões, unicidade, predicado parcial, validade, prontidão e estado ativo |
| Função | Schema, assinatura de tipos de entrada, definição com corpo, linguagem, volatilidade, modo de segurança, tratamento de NULL, paralelismo e configurações próprias |
| Trigger | Tabela, definição, identidade da função associada, eventos e momento, habilitação, diferibilidade e estado inicial |
| Sequência | Tipo, início, limites, incremento, cache, ciclo e coluna proprietária, incluindo a sequência do journal Drizzle |

As definições vêm de `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef`, `pg_get_functiondef` e `pg_get_expr`. A consulta usa OIDs para localizar os objetos e projeta nomes e definições sem transportar esses identificadores. O inventário anterior também passou a representar a entrada que cada trigger de constraint cria em `pg_constraint`. [Introspecção nativa do PostgreSQL 18](https://www.postgresql.org/docs/18/functions-info.html) · [Catálogo de constraints](https://www.postgresql.org/docs/18/catalog-pg-constraint.html)

O JSON canônico ordena objetos por identidade e propriedades pelo formato fixo. A assinatura SHA-256 resume esse JSON e a comparação detalhada identifica o primeiro objeto e propriedade divergentes. O diagnóstico omite valores observados e esperados, além de resumir identificadores fora do formato usual por hash. As definições permanecem textualmente exatas. A conexão fixa `search_path=pg_catalog` e configurações de apresentação, como UTC e a ordem de datas. A coleta da referência deverá usar a mesma projeção e a mesma configuração. Diferenças legítimas no deparser podem exigir recaptura e revisão da referência.

Comparar apenas hashes do journal deixaria passar alterações posteriores à migração. Interpretar todo o SQL em TypeScript duplicaria a semântica do servidor. A referência materializada preserva a semântica que o PostgreSQL expõe e permite revisar mudanças no catálogo. O inventário leve existente continua como verificação independente dos nomes, proprietários e estados, incluindo a rejeição de objetos inesperados nas classes que já cobre. Formas novas de DDL ainda podem exigir ajuste explícito nesse inventário.

O escopo exclui OIDs, estatísticas, espaço físico, valor corrente de sequência, colunas de sistema e triggers internos gerados por constraints. A comparação de collation registra a identidade associada à coluna, sem atestar bibliotecas de locale do host. Definições de tipos, extensões e objetos ainda ausentes nas migrations da aplicação exigirão avaliação de escopo quando forem introduzidos. A compatibilidade de catálogo tampouco comprova a identidade operacional do listener.

### Evidências e validação independente

Os 54 casos anteriores foram preservados. A inspeção estática contou 36 novos, totalizando 90 casos preparados. As adições cobrem referência ausente ou inválida, versão real, mudança de propriedades mantendo o nome, sobrecargas, objetos extras ou ausentes, ordem, OIDs, sanitização e inspeção na transação de leitura.

| Verificação desta correção | Resultado |
|---|---|
| Parser TypeScript e conferência de imports relativos | 8 fontes e 17 imports, exit code 0 |
| Conferência estática das propriedades da projeção SQL | 7 tipos de objeto conferidos contra o contrato v1, exit code 0 |
| `git diff --check` e índice real | Exit code 0, índice vazio |
| Patch acumulado | Nove arquivos de conteúdo. Aplicação sobre a base em índice e objetos isolados, reversão e comparação dos blobs com o working tree aprovadas |

Os 90 casos ficaram preparados para Luna Medium. O typecheck aprovado na rodada anterior pertence à versão anterior à correção. A validação posterior deve executar em `backend` os comandos da seção anterior em um terminal Windows saudável. A geração da referência é uma atividade separada. Antes da primeira campanha real, deve-se autorizar o preparo do schema limpo, coletar e versionar a referência revisada, testar a projeção contra o PostgreSQL compatível e atestar a identidade operacional do destino. A INFRA-01.C depende da validação da fundação e deverá fornecer a referência aprovada ao preflight sob exclusão mútua.

## Consolidação da validação independente da INFRA-01.B

**Parecer A — Fundação validada para implementar a INFRA-01.C.** O responsável executou as duas campanhas abaixo no PowerShell local, em `backend`, com Node v24.15.0 e `NODE_ENV=test`. As suítes não se sobrepõem.

| Campanha | Aprovados | Falhos | Cancelados | Ignorados | Exit code | Duração |
|---|---:|---:|---:|---:|---:|---:|
| Infraestrutura compartilhada | 90 | 0 | 0 | 0 | 0 | 2137.6751 ms |
| Seis suítes das guardas legadas | 81 | 0 | 0 | 0 | 0 | 1441.037 ms |
| Total | 171 | 0 | 0 | 0 | — | — |

A Luna realizou a revisão independente, o typecheck atualizado, a inspeção de sintaxe e a validação do patch, com aplicação isolada, reversão e correspondência dos nove blobs. No ambiente Codex, o runner parou em `uv_os_get_passwd returned ENOMEM` antes de carregar os testes. A execução local do responsável supriu essa pendência.

A referência real, as projeções no PostgreSQL, a identidade operacional da instância e o baseline vivo ainda aguardam verificação. A descoberta estática de conexões é limitada e as 43 suítes existentes continuam nos caminhos legados.

## Etapas posteriores

A INFRA-01.C deverá conectar a fundação ao futuro executor, adquirir advisory lock de sessão antes do preflight definitivo e manter a sessão até a verificação posterior. A perda da sessão deve interromper o processo filho e deixar o destino indisponível até comprovar a recuperação. A proteção da execução direta dependerá da migração das suítes. O banco legado permanece preservado e `arenago_isolated_test` é apenas uma proposta.

O executor precisa verificar o listener local por evidência operacional independente, capturar os erros de processo sem a configuração de credenciais e registrar recuperação fora do processo que detém o advisory lock. Se o lock se perder, a disponibilidade só volta após verificar encerramento dos filhos e baseline restaurado. Preservar os dez casos ADMIN-03 já preparados. A prova concorrente de chamada externa pendente e a hipótese de precisão temporal são cobertura funcional posterior.

## INFRA-01.C — Orquestração e isolamento de campanhas

A etapa foi implementada em `chore/integration-test-infrastructure`, sobre `de1275143a9d23c9fdbdd1ac171ed1a6acc05bd2`, para validação independente com Luna Medium. A entrada interna de execução rejeita o modo real antes de usar dependências. As 43 suítes permanecem legadas. Até a migração, não usar runners legados em simultâneo com a infraestrutura que adotar esse protocolo.

### Componentes

| Arquivo em `backend/test/infrastructure` | Responsabilidade |
|---|---|
| `campaign-selection.ts` | Inspeção de suíte individual, conjunto explícito, campanha nomeada, lista completa ou perfil pelo manifesto. Rejeita seleções inválidas, duplicidade e perfis indisponíveis para execução simulada. A inspeção lista os 43 itens com execução real desabilitada. |
| `campaign-reference.ts` | Obtém aprovação por um adaptador separado da leitura, verifica SHA-256 sobre uma cópia dos bytes e valida formato, versão, journal e hashes do checkout. |
| `campaign-lock.ts` e `campaign-deadline.ts` | Identidade da sessão dedicada, advisory lock, confirmação de posse, detecção de desconexão e limites de espera. |
| `campaign-journal.ts` | Marcador exclusivo por destino, relatórios atômicos e transições de estado. |
| `campaign-child-protocol.ts` | Contrato IPC para as futuras suítes migradas verificarem a permissão antes de criar pools ou inicializar Nest. |
| `campaign-process.ts` e `campaign-simulation-child.ts` | Lançador Node e único filho conectado nesta etapa. O filho é inofensivo e exercita o protocolo sem importar suítes de integração. |
| `campaign-orchestrator.ts` | Ordena seleção, sessão de lock, journal, atestações, processos, evidência e encerramento. Usa adaptadores injetados. |
| `integration-db-guard.ts` | Expõe a mesma atestação de identidade usada pela guarda completa para validar a sessão dedicada do lock. |

### Referência, ambiente e entrada supervisionada

O chamador escolhe suítes por ID, sem fornecer caminho de referência, digest de aprovação ou arquivo executável. A autoridade de referência fornece uma identidade de fonte, um SHA-256 previamente aprovado e a classificação sintética ou homologada. A leitura recebe a identidade registrada. O hash é comparado antes do parse, e a mesma cópia é validada contra as migrations e congelada recursivamente. Todos os preflights e postflights da campanha usam essa cópia. Alterações posteriores no arquivo não substituem a referência. O hash prova integridade em relação ao registro de aprovação. A procedência depende de controlar esse registro e a fonte auditada. Não há registro operacional homologado nesta etapa, e referências sintéticas só entram na simulação.

O processo usa `process.execPath`, carregador local resolvido no backend, worker fixo, ID do manifesto como argumento separado, `shell: false` e diretório `backend`. O ambiente da INFRA-01.B aplica allowlist com capitalização do Windows, dispositivo nulo para dotenv, três URLs idênticas, quatro TTLs, chaves sintéticas e scheduler desabilitado. Variáveis de carregadores, PostgreSQL, Neon, Drizzle e e-mail ficam de fora. O lançador bloqueia também a propagação automática de `NODE_V8_COVERAGE` pelo Node. Saídas brutas são drenadas e descartadas sem acumular conteúdo ou gravar segredos.

O filho comprova a presença de um canal IPC e envia um desafio. O supervisor responde somente após persistir a autorização e o lançamento com PID, e reconfirmar a posse do lock. A permissão vincula desafio, campanha, suíte, perfil, destino e SHA-256. O filho valida seu ambiente antes de liberar o callback. A perda do canal encerra o filho enquanto a execução está em curso. As mensagens de início e resultado devem corresponder ao desafio. As contagens são conferidas junto com a saída efetiva do processo. O protocolo protege os caminhos oficiais contra execução direta acidental. Um processo sob a mesma identidade do SO pode forjar um supervisor. D06 e D09 ainda não usam esse contrato. Seus hooks de Nest podem escrever no bootstrap de jogos e questionário, por isso a proteção deverá anteceder o bootstrap e os pools de escrita.

### Exclusividade, journal e verificação posterior

A configuração e a referência são verificadas antes de abrir a sessão dedicada. A identidade SQL, a versão e os privilégios dessa sessão antecedem `pg_try_advisory_lock(1095911241, 1229866578)`, reserva distinta dos locks de negócio. A aquisição recusa concorrência e tem prazo. O supervisor confirma a posse em `pg_locks` para seu próprio backend, com sondas periódicas e antes das autorizações e verificações. O encerramento confirmado da sessão dedicada libera o lock. Os pools de atestação são separados, somente leitura e fechados após cada consulta de integridade. O lock coordena campanhas cooperativas. Atestar o processo que escuta na porta exige evidência operacional independente.

O journal usa um diretório de ocupação criado atomicamente e um JSON por campanha, gravado em arquivo temporário, sincronizado e renomeado. O nome do destino é estável entre checkouts. O diretório recomendado fica fora do checkout, na pasta de usuário. Uma campanha real com múltiplos operadores precisará de um diretório protegido, compartilhado e provisionado para o destino. Os testes usam pastas temporárias. A morte do processo entre a criação do marcador e a gravação do relatório mantém o destino bloqueado. Um marcador ausente não atesta o estado do banco. O registro não pretende garantir recuperação de falha física de armazenamento ou de manipulação por usuários com acesso ao diretório.

Sob lock, o supervisor registra preparação, executa a guarda completa, registra autorização, lança o filho e libera o callback só após persistir o lançamento. Para cada suíte, exige resultado de IPC compatível com a saída do processo e prova independente de liberação de recursos. Repete a guarda completa após o filho, incluindo catálogo, ACLs, migrations e baseline. Em uma seleção múltipla, revalida antes da próxima suíte e encerra a seleção no primeiro resultado reprovado ou interrompido.

| Evidência | Destino operacional |
|---|---|
| Aprovado e verificações posteriores confirmadas | Relatório `clean`, sessão fechada e marcador removido. |
| Reprovado e verificações posteriores confirmadas | Relatório `test-failure`, sessão fechada e marcador removido. |
| Resultado recebido e baseline, schema ou recursos divergentes | Relatório `inconsistent` e marcador retido. |
| Cancelamento, prazo, perda do lock ou supervisão inconclusiva | Relatório `interrupted` quando gravável e marcador retido. |

Sem evidência válida do runner, as contagens ficam ausentes. O relatório registra UUID, revisão, Node, destino sem credenciais, referência, exclusividade, preflight, instantes, duração, PID quando conhecido, resultados, estado dos recursos e necessidade de recuperação. Falhas recebem categorias fixas. Obter o PID e encerrar o processo filho imediato não confirma o fim dos descendentes, conexões ou transações. No Windows, o adaptador desta etapa solicita encerramento apenas ao filho que iniciou. O futuro adaptador de execução real precisa demonstrar supervisão de descendentes e liberação desses recursos. A ausência dessa prova mantém o marcador.

A recuperação exige autorização específica, identidade dos processos e conexões conferida por evidências além de PID, ausência de transações remanescentes, schema e baseline íntegros e uma reconciliação do registro sob exclusividade. O procedimento de recuperação real será implementado em etapa posterior.

### Interface e validação

`inspectCampaign` é a interface interna de inspeção de manifesto e seleção. O comando legado `npm.cmd run test:integration` conserva seu comportamento. Planeja-se habilitar `test:integration:check` e `test:integration:verify` após conectar os adaptadores de leitura e homologar o destino. A execução supervisionada depende da migração das entradas. `test:integration:prepare` e `test:integration:restore` exigem procedimento próprio e autorização. Nenhum alias de npm foi acrescentado nesta etapa.

`backend/test/unit/integration-campaign.test.ts` prepara 41 casos para seleção, aprovação da referência, ambiente, lock, journal, supervisão, estado posterior e ordem de operações. A suíte anterior mantém seus 90 testes simulados. O novo arquivo usa conexões simuladas, estado temporário e um filho Node que responde apenas ao protocolo. Para Luna Medium, em PowerShell no diretório `backend`:

```powershell
$env:NODE_ENV = 'test'
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts test/unit/integration-campaign.test.ts
npm.cmd run typecheck:test
```

Testes e typecheck da etapa C aguardam execução. Se o runner falhar em `os.userInfo()` com `uv_os_get_passwd returned ENOMEM`, registrar a falha anterior ao carregamento e usar um terminal Windows saudável para repetir os comandos. A inspeção desta implementação usou parser e resolução de 56 imports relativos das 18 fontes TypeScript, além de `node --experimental-strip-types --check` nessas fontes e verificações de integridade Git. O patch acumulado inclui as etapas B e C, com 19 arquivos de conteúdo, e exclui a própria evidência. Não houve acesso a PostgreSQL ou execução de migração, seed ou suíte.

### Condições da INFRA-01.D1 e da primeira campanha real

Revisar e validar C com Luna, auditar a infraestrutura em conjunto com Astra e obter autorização operacional específica do responsável. Atestar a instância local, gerar a referência em ambiente limpo autorizado, homologar separadamente sua fonte e digest, validar as projeções e conferir os oito hashes das migrations e o baseline vivo. D06 e D09 deverão aderir ao protocolo antes do bootstrap, com proteção nos pontos de entrada e demonstração prática de exclusividade, encerramento dos recursos e verificação posterior. Nenhuma dessas condições foi cumprida por simulação.

## Correção da INFRA-01.C após o Parecer B

A validação independente emitiu **Parecer B — Orquestrador condicionado**. O `tsx` encerrou antes de carregar a suíte C com `uv_os_get_passwd returned ENOMEM` no Node v24.15.0 (exit code 1). Os 41 casos preparados ficaram sem execução, assim como as regressões da fundação e das guardas legadas nessa rodada. A sintaxe das 18 fontes e a aplicação isolada e reversa do patch passaram.

O typecheck anterior falhou (exit code 2) com seis diagnósticos. Em `campaign-child-protocol.ts`, o callback lia `suite.profile` antes de inicializar a variável local que sombreava a suíte esperada: TS2448, TS2454 e TS2339. A construção da permissão aceitava um perfil potencialmente indefinido no tipo inferido (TS2345). Em `campaign-process.ts`, as chamadas a `resume()` nos dois pipes tinham TS18047.

### IPC e supervisão

O filho compara a mensagem com o desafio vigente, a suíte e o perfil do manifesto validados no ambiente, o destino fixo, o ID da campanha e o SHA-256 da referência fixados no lançamento. Só então constrói a permissão com os valores esperados e libera o callback. O perfil é obrigatório. Uma segunda mensagem de autorização não volta a chamar o callback. A supervisão mantém a reconfirmação do lock antes do envio e exige resultado estruturado compatível com o encerramento efetivo.

O processo inicia com pipes explícitos para stdout e stderr. A supervisão drena os pipes disponíveis, descarta seu conteúdo e trata erros de processo, de stream e desconexão prematura com diagnósticos fixos. Um pipe ausente inviabiliza a autorização e solicita o encerramento do filho quando há PID. A ausência de PID impede registrar o lançamento como válido. O fechamento do filho precisa ser confirmado para a supervisão produzir um resultado.

### Admissão do journal

Sob o advisory lock, o supervisor cria `occupied` atomicamente antes de ler `campaigns`. A posse é registrada com um token da campanha. A admissão exige que todo registro do diretório seja um JSON regular, identificável pelo nome e associado ao destino. Registros históricos só liberam uma nova admissão quando comprovam fase `clean` ou `test-failure`, sem recuperação pendente, com preflight, postflight e recursos confirmados, sessão encerrada e tentativas e contagens compatíveis com a fase. Em `test-failure`, suítes posteriores à primeira falha devem constar como não iniciadas.

Histórico ativo, interrompido, inconsistente, ausente de evidência, ilegível ou corrompido impede a autorização. Arquivos temporários residuais também bloqueiam por ambiguidade. Falhas de leitura ou gravação depois da aquisição preservam a ocupação. A finalização confirma propriedade e valida o registro terminal persistido antes de remover o marcador. Entre a liberação da sessão e a remoção do marcador, uma segunda campanha ainda encontra o destino ocupado. Registros terminais válidos são preservados.

O diretório operacional deve ter proteção contra alteração externa e ser comum aos supervisores do mesmo destino. O marcador coordena processos que seguem o protocolo e não oferece proteção contra alterações arbitrárias no sistema de arquivos. A recuperação requer autorização específica, comprovação de encerramento dos filhos e recursos PostgreSQL, conferência de schema, migrations e baseline e reconciliação das evidências sob exclusividade.

### Regressões e validação pendente

Os 41 casos iniciais da etapa C foram mantidos, com ajustes nas fixtures de propriedade e persistência e assertions sobre o contexto do lançamento. Foram preparados mais 30 casos, totalizando 71 casos na suíte C por contagem estática. Eles cobrem a autorização efetiva em filho Node inofensivo, divergências de contexto, duplicidade, desconexão, drenagem e falhas nos pipes, histórico residual, conclusões íntegras, propriedade e disputa entre processos. A suíte de 90 casos da fundação ficou intocada nesta correção. A preservação byte a byte dos 90 casos na transição de B para C foi informada pelo Sol e não pôde ser reconfirmada pela Luna sem uma referência pré-C independente.

Nesta correção, `node --experimental-strip-types --check` passou nas 18 fontes TypeScript. A inspeção estática conferiu os imports e a contagem dos casos da etapa C. O patch acumulado mantém o inventário de 19 arquivos de conteúdo, com aplicação verificada em índice e objetos temporários, comparação dos arquivos reconstruídos, reversão e whitespace. Testes e typecheck desta versão aguardam Luna Medium. Em PowerShell local saudável, a partir da raiz:

```powershell
Set-Location backend
$env:NODE_ENV = 'test'
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-campaign.test.ts
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-event-operations-db-guard.test.ts test/unit/admin-role-management-db-guard.test.ts test/unit/first-admin-bootstrap-db-guard.test.ts test/unit/participant-admission-db-guard.test.ts test/unit/participations-read-db-guard.unit.test.ts test/unit/test-db-guard.unit.test.ts
npm.cmd run typecheck:test
```

Antes da integração de um runner real na INFRA-01.D1, sua evidência deverá distinguir execução integral de execução parcial, filtros, skips, testes não iniciados e resultados incompletos. Os 1.388 registros do manifesto incluem contêineres e exigem reconciliação com a semântica do runner. As 43 suítes permanecem indisponíveis para execução real pelo orquestrador, inclusive D06 e D09. As condições operacionais da seção anterior e a auditoria conjunta continuam pendentes.

## Correções após a campanha no PowerShell local

A Luna confirmou o typecheck com exit code 0. No ambiente Codex, o `tsx` ainda encerrou durante o bootstrap com `uv_os_get_passwd returned ENOMEM`, antes de iniciar a suíte. O responsável executou o typecheck e as três campanhas simuladas no PowerShell local com Node v24.15.0. O typecheck local também retornou 0. A tabela registra apenas a execução do responsável.

| Campanha | Total | Aprovados | Falhos | Cancelados | Ignorados | Exit code | Duração (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| INFRA-01.C | 71 | 58 | 13 | 0 | 0 | 1 | 8210.6789 |
| INFRA-01.B | 90 | 90 | 0 | 0 | 0 | 0 | 1280.1754 |
| Guardas legadas | 81 | 81 | 0 | 0 | 0 | 0 | 801.9313 |
| Total | 242 | 229 | 13 | 0 | 0 | — | — |

Dez casos de IPC encerraram antes de `ready`. Eles cobriam a execução única após uma permissão válida, oito entradas inválidas e a desconexão antes da autorização. O cenário integrado com journal persistente e filho Node retornou `interrupted` em vez de `clean`. Os dois casos de reutilização persistente retornaram `interrupted` em vez de `clean` e `test-failure`.

### Inicialização do filho no Windows

Dois caminhos compartilham a validação de ambiente anterior a `ready`. Os dez casos carregam o protocolo via `node --require <tsx/cjs> --eval`. O cenário integrado usa `node --require <tsx/cjs>` com o arquivo fixo `campaign-simulation-child.ts`. Ambos usam `process.execPath`, o diretório `backend`, argumentos separados e um canal IPC explícito. O loader CommonJS resolve o TypeScript com a configuração do backend, sem depender das opções de execução do processo pai. A rejeição na guarda ocorre antes de registrar o listener de autorização.

Uma sonda com Node v24.15.0, sem o loader e com ambiente explícito e sintético, demonstrou que o libuv repõe `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`, `USERNAME` e `WINDIR` quando ausentes. O canal IPC funcionou e o filho encerrou com código 0 e sem sinal. A guarda compartilhada, inspecionada separadamente nesse ambiente, rejeitou as variáveis fora da allowlist. Uma segunda sonda mostrou que valores vazios explícitos impedem a herança dos sete valores e preservam o IPC. As sondas emitiram somente nomes conhecidos, estados e códigos. Ao iniciar o loader anterior no ambiente Codex com as duas formas de entrada, o preload parou antes do worker com ENOMEM, código 1 e sem sinal. Esse erro do ambiente Codex é distinto da rejeição de ambiente identificada no caminho do filho.

O launcher e a fixture IPC agora usam a mesma preparação de ambiente. No Windows, o spawn recebe entradas vazias para os sete nomes. O filho retira somente as entradas vazias da cópia que passa à guarda compartilhada. Valores não vazios e demais nomes fora da allowlist seguem rejeitados. O launcher continua bloqueando a propagação de cobertura do Node, sem shell e sem credenciais nos argumentos. O protocolo conserva o desafio e a validação de campanha, suíte, perfil, destino e referência. No cenário integrado, a falta de `ready` impedia o supervisor de conceder a permissão em `authorize`, e o orquestrador registrava a interrupção na supervisão. A fixture IPC agora indica código, sinal ou falha de spawn quando o filho encerra antes da mensagem esperada, sem capturar saídas.

### Campanhas concluídas com journal persistente

Nos dois casos de reutilização, a fixture trocava o journal de memória pelo persistente. O filho simulado continuava consultando a lista de gravações do journal de memória durante `authorize`. A lista ficava vazia, a validação da suíte lançada e da referência falhava e o orquestrador registrava `interrupted` na supervisão, antes da persistência terminal ou da remoção do marcador.

A fixture pode agora delegar a um journal persistente e registra as evidências observadas apenas após as gravações concluírem. As validações durante a autorização foram preservadas. Os casos de reutilização verificam que uma segunda campanha adquire a exclusividade, conclui com `clean` e mantém os bytes do registro anterior. O cenário integrado também verifica as evidências persistidas de liberação de recursos e postflight. O contrato de escrita, propriedade e remoção do marcador no journal permaneceu intacto.

### Evidências e nova validação

Foram preservados os 71 casos da suíte C e acrescentado um caso que injeta um valor não vazio em uma variável de bootstrap e exige encerramento antes de `ready`. São 72 casos preparados. A suíte B e as seis guardas legadas ficaram intactas. A inspeção de sintaxe cobriu as 18 fontes TypeScript. A aplicação e a reversão da evidência acumulada foram verificadas em índice e objetos temporários, com comparação integral dos blobs e checagem de whitespace.

As campanhas e o typecheck desta revisão ficam pendentes para Luna Medium. Em PowerShell local saudável, a partir do diretório `backend`, revalidar primeiro o typecheck e a suíte C:

```powershell
$env:NODE_ENV = 'test'
npm.cmd run typecheck:test
if ($LASTEXITCODE -eq 0) {
    & .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-campaign.test.ts
}
```

Após aprovação integral da suíte C, executar:

```powershell
& .\node_modules\.bin\tsx.cmd --test test/unit/integration-infrastructure.test.ts
& .\node_modules\.bin\tsx.cmd --test test/unit/admin-event-operations-db-guard.test.ts test/unit/admin-role-management-db-guard.test.ts test/unit/first-admin-bootstrap-db-guard.test.ts test/unit/participant-admission-db-guard.test.ts test/unit/participations-read-db-guard.unit.test.ts test/unit/test-db-guard.unit.test.ts
```

O bloqueio de PostgreSQL real continua vigente. A validação com um filho inofensivo ainda depende da campanha efetiva e não demonstra a liberação de descendentes, conexões e transações reais. Continuam pendentes a recuperação autorizada, a auditoria conjunta e a comprovação da integralidade dos resultados do runner futuro.

## Correção pontual da desconexão IPC antes da autorização

Antes desta correção, o responsável executou o typecheck e a suíte C no PowerShell local com Node v24.15.0. O typecheck retornou 0. A suíte executou 72 casos em 17765.6936 ms, com 71 aprovados, 1 reprovado, 0 cancelados, 0 ignorados, 0 TODO e exit code 1. Doze das treze falhas anteriores foram resolvidas, e a nova regressão da allowlist passou. As suítes B e das guardas legadas não foram repetidas porque C ainda não passou integralmente.

O único caso reprovado, `desconexão antes da autorização impede execução posterior`, levou 10428.1967 ms e recebeu `[SEGURANÇA BLOQUEADA] Prazo da operação excedido.` em `campaign-deadline.ts:16`. O runner iniciou e executou a suíte local.

### Causa e correção

A fixture aguardava `close` tanto no teste quanto no bloco de limpeza. No Node v24.15.0, o caminho de desconexão iniciado pelo pai fecha o canal IPC e emite `disconnect`. Nesse caminho, a rotina interna não contabiliza o fechamento do canal para emitir `close`. Uma sonda isolada em Windows, com um processo Node inofensivo, IPC e stdio ignorado, reproduziu a sequência `ready`, `disconnect`, `ERR_IPC_CHANNEL_CLOSED` no envio tardio e `exit` com código 2 e sinal nulo. O pai encerrou sem receber `close`. O contador interno registrou um fechamento de dois esperados. Nenhum arquivo da suíte foi carregado pela sonda.

O listener de desconexão do protocolo já estava registrado antes de `ready` e encerra o filho com código 2. Esse encerramento elimina a espera e o timer de autorização no filho. A operação pendente era a Promise de `close` no pai, primeiro na assertion e novamente na limpeza, o que explica dois prazos de cinco segundos. O defeito estava na expectativa da fixture sobre o ciclo de vida do IPC. O protocolo, a supervisão e o worker permanecem idênticos ao patch anterior.

A fixture agora registra `exit` logo após o spawn. O caso corrigido exige `ready`, desconexão observada no pai, recusa do envio tardio, saída do filho com código 2 e sem sinal e somente a mensagem `ready`. A limpeza aceita `exit` ou `close`, inclusive `close` após falha de spawn. Os cinco segundos continuam como limite de espera. O encerramento forçado permanece apenas na limpeza de processos que ainda estão ativos, depois das asserções. O caso comprova o encerramento do filho imediato e não atesta a liberação de descendentes, conexões ou transações.

### Evidências e revalidação

A revisão confirmou os mesmos 72 registros de teste, incluindo as matrizes geradas por loops. A checagem de sintaxe com `node --experimental-strip-types --check` passou na suíte alterada e o parser TypeScript passou nas 18 fontes do pacote. Comparando com o patch anterior, somente a suíte C e este relatório mudaram dentro dos 19 arquivos de conteúdo. A allowlist do Windows, a vinculação da permissão ao contexto, a execução única, o journal, o advisory lock, a verificação posterior, a sanitização e o bloqueio das 43 suítes reais foram preservados. O patch acumulado usa a mesma base e a conferência inclui aplicação e reversão em índice e objetos isolados, igualdade dos blobs com o working tree e checagem de whitespace.

O typecheck e os testes após esta correção aguardam Luna Medium. Se o ambiente Codex parar antes de carregar a suíte com `uv_os_get_passwd returned ENOMEM`, executar os mesmos comandos no PowerShell local saudável. Esse erro de inicialização é distinto do timeout reproduzido pela sonda. A auditoria conjunta pelo Astra e as condições operacionais para campanhas reais continuam pendentes.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'

npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw "Typecheck: $LASTEXITCODE" }

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^desconexão antes da autorização impede execução posterior$' test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw "Teste de desconexão: $LASTEXITCODE" }

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw "INFRA-01.C: $LASTEXITCODE" }

& .\node_modules\.bin\tsx.cmd --test test/unit/integration-infrastructure.test.ts
Write-Host "INFRA-01.B: $LASTEXITCODE"

& .\node_modules\.bin\tsx.cmd --test test/unit/admin-event-operations-db-guard.test.ts test/unit/admin-role-management-db-guard.test.ts test/unit/first-admin-bootstrap-db-guard.test.ts test/unit/participant-admission-db-guard.test.ts test/unit/participations-read-db-guard.unit.test.ts test/unit/test-db-guard.unit.test.ts
Write-Host "Guardas legadas: $LASTEXITCODE"
```

## Correções dos bloqueantes da auditoria conjunta AUDIT-INFRA-01-BC

### Consolidação da validação independente

A Luna Medium emitiu **Parecer A para a INFRA-01.C**, após a correção da fixture de desconexão IPC. O responsável executou as campanhas no PowerShell local. A Luna realizou a revisão independente. O teste isolado de desconexão passou e já integra os 72 casos de C. O typecheck atualizado foi aprovado pela Luna e pelo responsável, ambos com exit code 0. Os resultados de 58/71 e 71/72 acima pertencem às rodadas anteriores.

| Campanha histórica | Aprovados | Falhos | Cancelados | Ignorados | Exit code |
|---|---:|---:|---:|---:|---:|
| INFRA-01.B | 90 | 0 | 0 | 0 | 0 |
| INFRA-01.C | 72 | 0 | 0 | 0 | 0 |
| Seis guardas legadas | 81 | 0 | 0 | 0 | 0 |
| Total | 243 | 0 | 0 | 0 | 0 |

O Astra High emitiu **Parecer B — Infraestrutura condicionada** após a auditoria estática conjunta. A implementação desta correção abrange os três bloqueantes comprovados na guarda e a consolidação documental. A revalidação independente e a reauditoria direcionada seguem pendentes.

| Achado | Gravidade | Classificação e encaminhamento |
|---|---|---|
| INFRA-BC-01 — Membership da role proprietária em uma direção | Alta | Grupo 1. Correção da guarda compartilhada nesta rodada. |
| INFRA-BC-02 — Triggers internos de integridade referencial fora da projeção | Alta | Grupo 1. Correção da referência e da projeção nesta rodada. |
| INFRA-BC-03 — Questionário com ativação futura aprovado pelo baseline | Moderada | Grupo 1. Correção do predicado de vigência nesta rodada. |
| INFRA-BC-04 — Procedência da referência e da instância | Alta | Grupo 2. INFRA-01.D1, antes da campanha real. |
| INFRA-BC-05 — Exclusividade e liberação de recursos | Alta | Grupo 2. INFRA-01.D1, antes da campanha real. |
| INFRA-BC-06 — Integralidade do runner | Alta | Grupo 2. INFRA-01.D1. |
| INFRA-BC-07 — Domínio do journal e recuperação | Alta | Grupo 2. INFRA-01.D1, antes da campanha real. |
| INFRA-BC-08 — Entradas legadas | Moderada | Grupo 2. INFRA-01.D1. |
| INFRA-BC-09 — Limites da descoberta estática | Moderada | Grupo 3. INFRA-01.D2/D3. |
| INFRA-BC-10 — Matriz de cobertura Windows | Baixa | Grupo 4. Melhoria não bloqueante. |
| INFRA-BC-11 — Consolidação histórica pendente no relatório | Baixa | Grupo 4. Registrada nesta seção. |

O estado inicial conferido foi a branch `chore/integration-test-infrastructure` no HEAD `de1275143a9d23c9fdbdd1ac171ed1a6acc05bd2`, com índice vazio e 20 arquivos não rastreados. O patch auditado tinha 19 arquivos, 3.396 inserções e nenhuma remoção. Seu SHA-256 coincidiu com o registrado pelo Astra, `ADE0A22CE927B428693BBDB6C09295C956CE6568AF8F258AA92D17BFDC24CC60`.

### Guarda compartilhada após a correção

**INFRA-BC-01.** `attestIntegrationIdentity` consulta `pg_auth_members` em duas projeções independentes. `member_of_role` verifica `m.member = r.oid` e `granted_to_role` verifica `m.roleid = r.oid`, para o OID da role identificada por `session_user`. Qualquer vínculo explícito direto bloqueia a atestação, inclusive com as opções de herança, assunção e administração desabilitadas. Isso exclui cadeias explícitas que atravessem a role dedicada. Permanecem os direitos implícitos do proprietário e os poderes administrativos de superusuários. A identificação preliminar da sessão dedicada precede o advisory lock. O preflight definitivo e o postflight chamam a mesma função pela guarda de leitura. As guardas legadas ainda seguem seus contratos anteriores.

**INFRA-BC-02.** A categoria `constraint` da referência agora inclui `foreignKeyTriggers`. Para FKs, a consulta agrupa apenas triggers internos vinculados por `pg_trigger.tgconstraint` à linha de `pg_constraint`. A própria constraint fornece o agrupamento lógico por schema, tabela e nome. Cada elemento identifica, por schema e nome, a relação de instalação e a relação associada ao trigger, além da função qualificada e sua assinatura. Inclui máscara de eventos e momento, estado de habilitação, diferibilidade e diferibilidade inicial. A comparação ordena os elementos em TypeScript e conserva a multiplicidade. OIDs servem aos joins e os nomes físicos dos triggers ficam fora do formato. Como a coleção está associada à FK, mover um trigger para outra constraint altera as duas coleções. Os triggers explícitos das migrations continuam na categoria `trigger`, inclusive os de integridade e histórico de `external_entry_calls`. [Catálogo pg_trigger do PostgreSQL 18](https://www.postgresql.org/docs/18/catalog-pg-trigger.html)

O formato **v2** exige a propriedade em todas as constraints, com `null` para os demais tipos. Uma FK de referência precisa ser aplicada e ter quatro triggers logicamente distintos, em estado normal `O`, com relação associada e função em `pg_catalog`. Isso corresponde às FKs não particionadas do checkout. Um catálogo observado com zero triggers projeta uma coleção vazia e diverge da referência. A guarda recusa v1 e referências v2 com projeções incompletas, sem converter ou completar valores ausentes. DDL com outra topologia, como tabelas particionadas, requer revisão explícita antes da adoção. A coleta da referência real continua separada e depende de fonte limpa e aprovação independente. [Implementação de FKs do PostgreSQL 18](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/commands/tablecmds.c#L13539)

O estado no catálogo e a configuração da sessão são controles distintos. A identidade compartilhada exige `session_replication_role = 'origin'` nas conexões atestadas, incluindo a sessão do lock e as transações de leitura. O futuro adaptador real precisa garantir a mesma política para suas próprias conexões de escrita e de bootstrap, além de comprovar a efetividade da projeção em PostgreSQL 18.6. [Configuração de sessão no PostgreSQL 18](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE)

**INFRA-BC-03.** A consulta calcula `published` por `activated_at IS NOT NULL AND activated_at <= CURRENT_TIMESTAMP`. O instante é o início da transação de atestação, consistente com o snapshot. A versão, o JSON, a exclusão de versões adicionais e o restante do baseline conservam as verificações anteriores. A aplicação continua usando seu instante de seleção. A compatibilidade operacional entre os relógios permanece uma verificação da futura campanha real.

### Regressões preparadas e divisão de validação

| Suíte | Casos históricos preservados | Novos casos preparados | Total previsto |
|---|---:|---:|---:|
| INFRA-01.B | 90 | 22 | 112 |
| INFRA-01.C | 72 | 3 | 75 |
| Seis guardas legadas | 81 | 0 | 81 |
| Total | 243 | 25 | 268 |

A contagem é estática. As fixtures antigas de identidade e de referência foram adaptadas ao novo contrato. O caso antigo de versão arbitrária incompatível agora usa v3, e um caso independente recusa v1 e referências v2 incompletas. As declarações anteriores foram preservadas. Os testes de B verificam os dois predicados de membership e simulam vínculos, inclusive com todas as opções desabilitadas. Os testes de C verificam recusa anterior ao lock, recusa no preflight e bloqueio de reutilização no postflight. A estrutura é exercitada com triggers divergentes, ausentes, adicionais, transferidos entre FKs, desabilitados e repetidos, além de ordem diferente e sessão incompatível. Os casos de questionário incluem ativação anterior, igual, futura e nula e conteúdo incompatível.

Além de verificar as decisões da guarda, os testes examinam as consultas que ela envia. A projeção anterior de membership não fornece os dois predicados. A projeção anterior de constraints não tem a coleção correlacionada nem as propriedades exigidas. A projeção anterior do questionário não compara o timestamp. As regressões de contrato falhariam nesses três casos mesmo com linhas simuladas favoráveis. Os testes simulados não executam nem interpretam SQL completo e não atestam o catálogo ou os relógios de uma instância real.

A inspeção da implementação usou o parser TypeScript nas 18 fontes acumuladas, conferiu 57 imports relativos e comparou as declarações de teste com o patch auditado. `git diff --check` e a conferência do índice real retornaram 0. A evidência acumulada é validada por aplicação sobre a base em índice e objetos isolados, reversão, verificação de whitespace e igualdade dos blobs com o working tree. O SHA-256 do arquivo entregue é registrado junto à entrega para evitar referência circular, pois o relatório integra o patch.

Para esta revisão foram preparados os comandos históricos abaixo, com dependências já instaladas. Os resultados da execução posterior estão consolidados na seção da D1.1.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'

npm.cmd run typecheck:test
Write-Host "Typecheck: $LASTEXITCODE"

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^BC-0[123] ' test/unit/integration-infrastructure.test.ts test/unit/integration-campaign.test.ts
Write-Host "Regressões focadas: $LASTEXITCODE"

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts
Write-Host "INFRA-01.B: $LASTEXITCODE"

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-campaign.test.ts
Write-Host "INFRA-01.C: $LASTEXITCODE"

& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-event-operations-db-guard.test.ts test/unit/admin-role-management-db-guard.test.ts test/unit/first-admin-bootstrap-db-guard.test.ts test/unit/participant-admission-db-guard.test.ts test/unit/participations-read-db-guard.unit.test.ts test/unit/test-db-guard.unit.test.ts
Write-Host "Guardas legadas: $LASTEXITCODE"
```

O manifesto, a supervisão, o IPC, o journal e o bloqueio do modo real permanecem em vigor. A atestação prática da projeção e do baseline em PostgreSQL 18.6, a comparação dos relógios e a qualificação do adaptador real continuam pendentes. D06 e D09 permanecem nos caminhos legados até a etapa de migração autorizada.

## INFRA-01.D1.1 — Preparação operacional e referência estrutural v2

### Validação consolidada dos bloqueantes BC

O responsável executou no PowerShell local com Node v24.15.0 e `NODE_ENV=test`. INFRA-01.B passou com 112/112, INFRA-01.C com 75/75 e guardas legadas com 81/81. As três execuções tiveram exit code 0, sem falhas, cancelamentos ou ignorados. O total foi 268/268 e já inclui os 25/25 casos direcionados (BC-01 8, BC-02 12 e BC-03 5). O typecheck de testes retornou 0.

A Luna registrou **Parecer A — Correções validadas**. O Astra registrou **Parecer A — Infraestrutura apta para migração piloto** na reauditoria. BC-01, BC-02 e BC-03 foram encerrados no escopo arquitetural. O formato vigente é v2. A descrição de v1 acima documenta o contrato anterior. Este registro resolve BC-11.

A D1.1 prepara a atestação operacional, a qualificação somente leitura, a procedência da referência, a avaliação do baseline e dos relógios e o domínio do journal. BC-04 depende das evidências operacionais da D1. BC-07 começa nesta etapa e será integrado em D1.2. BC-05 segue para D1.2/D1.3, BC-06 e BC-08 para D1.2, BC-09 para D2/D3. BC-10 é uma melhoria não bloqueante.

### Identidade Windows e destino fixo

O destino convencional permanece `127.0.0.1:55432/arenago_events_test`, role `arenago`, PostgreSQL 18.6 e serviço `postgresql-x64-18`. A ADMIN-07 registrou oito migrations, 26 tabelas públicas, 20 jogos, uma versão de questionário e as outras 24 tabelas vazias ao final. Esses dados são históricos. Nesta rodada, `netstat -ano -p tcp` mostrou o listener IPv4 local no PID 10976, `sc.exe queryex postgresql-x64-18` informou serviço em execução no PID 6320, e `Get-Process` identificou respectivamente `postgres` e `pg_ctl`. O binário no caminho histórico apresentou versão de produto 18.6. As consultas CIM e de conexões TCP retornaram acesso negado no ambiente Codex. Faltaram o caminho efetivo do processo, a relação de parentesco e a confirmação do diretório de dados. A instância segue inconclusiva.

O script Windows compara os caminhos previamente confirmados pelo responsável com o executável do listener, o executável e registro do serviço, a relação entre o serviço e o postmaster, `postmaster.pid` e `PG_VERSION`. O PID do serviço pode coincidir com o listener ou corresponder ao `pg_ctl` da mesma instalação, pai do postmaster. O script exige caminhos locais em disco fixo sem pontos de redirecionamento, confirma a porta, a versão do binário e os instantes de criação dos processos, e reconfere listener e serviço. Sua saída é uma identidade reduzida com fingerprint SHA-256, sem linhas de comando ou caminhos internos. O fingerprint inclui os PIDs e tempos de início para invalidar a atestação após reinício. Permissão insuficiente, topologia inesperada ou evidência parcial interrompem o procedimento. [Propriedades de Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)

O comando abaixo é exclusivamente de leitura do Windows. Execute no terminal local autorizado. Informe caminhos absolutos obtidos de registro de instalação independente e conferidos pelo responsável. O registro do serviço é uma evidência a comparar com esses valores. A consulta deve ser bem-sucedida em todas as etapas antes da fase SQL. A simulação exige a mesma identidade antes de criar o pool, antes de conectar e antes de devolver evidência. A futura operação real deverá repetir essa verificação. Isso reduz a janela de troca do listener e ainda depende do controle operacional da máquina e da exclusividade.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile
$infraBin = Read-Host 'Diretório bin confirmado da instalação PostgreSQL 18.6'
$infraData = Read-Host 'Diretório de dados confirmado da instância dedicada'
& .\backend\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
```


### Qualificação e procedência da referência v2

A guarda e a preparação compartilham `REPEATABLE READ READ ONLY`, validação anterior ao pool, rollback, descarte de conexão se o rollback falhar e encerramento do pool. As consultas verificam identidade SQL exata, versão, owner, privilégios, membership em ambas as direções, schemas, ACLs, inventário de objetos e hashes do journal. A preparação exige ausência de Admin global histórico inclusive revogado, baseline operacional vazio e catálogo canônico integral. A mesma sessão confere `transaction_read_only`, `transaction_isolation`, `search_path`, UTC e `session_replication_role=origin`. O histórico das oito migrations é comparado por ordem e SHA-256 do SQL materializado. Em caso de divergência, investigar bytes e finais de linha com o checkout que produziu o journal. Preservar os arquivos sem normalização e os hashes persistidos. A política geral de portabilidade fica em INFRA-01.F.

| Operação | Entrada e evidência |
|---|---|
| Atestar Windows | Script somente leitura. Gera identidade reduzida e fingerprint |
| Inspecionar PostgreSQL e verificar baseline | Guarda injetável em snapshot somente leitura. A futura execução real exige autorização e adaptador revisado |
| Extrair candidata | A simulação devolve bytes JSON canônicos v2 e SHA-256. Sem registro de aprovação, arquivo automático ou conexão real |
| Qualificar projeções | A simulação compara a projeção com a referência independente fornecida, verifica relações e contagem de categorias e devolve os hashes ordenados das consultas executadas. Qualificação e extração são operações distintas |
| Homologar | Decisão independente do responsável, registrada junto a procedência, evidências da revisão estrutural e digest exato |
| Consumir | A autoridade de `campaign-reference.ts` fixa fonte, classe e SHA-256. O consumidor copia uma vez, compara o digest, decodifica e congela os mesmos bytes. Rejeita v1, ausência, incompatibilidade, substituição e referência sintética em finalidade real |
| Preparar baseline, executar campanhas e recuperar | Operações futuras distintas, cada qual sujeita a autorização específica |
| Verificar resultado posterior | Operação somente leitura. Em D1.2 deverá repetir a guarda e confrontar a continuidade das linhas |

O inventário da extração confere as FKs nominalmente descobertas nas migrations e a presença de colunas nas relações esperadas. As constraints `NOT NULL` do PostgreSQL 18 permanecem na projeção v2, embora o inventário DDL anterior já trate a nulabilidade pela definição das colunas. A estrutura inclui tabelas, colunas, constraints, índices, funções, triggers e sequências. Cada FK ordinária precisa de quatro descritores lógicos distintos em estado `O`, com função em `pg_catalog` e relação associada. A revisão independente confrontará o conjunto com as ações de integridade previstas nas migrations, incluindo a migration 0008, e com uma descrição independente de colunas, constraints, funções e triggers. Distinguir consulta concluída, propriedades esperadas presentes, projeção correspondente à estrutura independente e aprovação formal do artefato. A simulação só comprova os contratos observados no adaptador.

A fonte proposta é uma instância local descartável limpa, reproduzível, preparada sob autorização separada com PostgreSQL 18.6, as oito migrations do checkout e o baseline canônico documentado. Seu uso precisará de decisão expressa sobre provisionamento e autorização do destino. Nenhum banco auxiliar está autorizado agora. A comparação posterior do destino convencional com essa referência independente evita usar o próprio estado candidato como prova de origem. Reutilizar o banco convencional como fonte só é aceitável se houver cadeia independente completa de preparação e conferência estrutural. O histórico da ADMIN-07 serve para reconstruir os requisitos, mas sozinho não comprova essa cadeia no estado atual.

Após auditoria dos objetos de schema e do conteúdo de suas definições, armazenar a candidata em pasta local protegida fora do checkout. O JSON inclui apenas metadados estruturais, definições e hashes de migrations. Definições SQL podem conter literais, portanto a revisão independente deve reprovar uma fonte com credenciais ou dados operacionais nas definições antes de depositar o artefato. O responsável, separado da extração, deve fixar em configuração protegida a origem, caminho absoluto, versão, digest, fingerprint operacional, hashes de migrations, evidências de correspondência estrutural, data e decisão. A implementação futura deve carregar a aprovação desse registro controlado pelo operador, sem aceitar flags ou digest autodeclarados pela chamada de campanha. Verificar ACLs, identidade e ausência de redirecionamento da fonte e do artefato. Referência ausente, antiga ou divergente bloqueia o consumo. A autoridade real e seu adaptador permanecem por implementar após revisão. O desenho depende da integridade das contas autorizadas e do sistema operacional.

### Baseline, relógios e sessões futuras

Uma divergência do baseline encerra a inspeção e preserva a evidência. A correção do banco exige procedimento e autorização próprios. Para D06 e D09, propõe-se digest local separado de projeções ordenadas dos UUIDs dos jogos, UUID e timestamps da versão canônica, capturado antes e depois de cada suíte. O digest demonstra continuidade das mesmas linhas quando comparado na mesma instalação. UUIDs e timestamps da instalação ficam fora da assinatura estrutural portátil e do patch. O histórico de 41 casos D06 e 70 D09 é referência para reconciliação posterior do runner.

A amostra registra `clock_timestamp()` como instante do servidor, `CURRENT_TIMESTAMP` como início da transação, o instante de ativação e os limites do relógio civil do Node imediatamente antes/depois do round-trip, medido também por relógio monotônico. O offset do servidor fica entre `server − after − 1 ms` e `server − before + 1 ms`. A folga de 1 ms em cada extremo cobre a quantização do `Date.now()`. Divergência maior que 2 ms entre os intervalos civil e monotônico torna a amostra inconclusiva. Para o baseline, a tolerância operacional decorre do intervalo observado e da margem real até a ativação. A ativação deve preceder ou coincidir com o corte SQL e estar pelo menos 1 ms antes da leitura inicial do Node. Uma medição atrasada alarga os limites e não justifica um valor fixo de offset. Na qualificação real, repetir as amostras imediatamente antes das etapas que dependem da vigência. Investigar intervalos oscilantes ou deslocados antes da campanha. A seleção persistente no serviço usa um instante do PostgreSQL capturado com `clock_timestamp()` e convertido em `Date` antes de comparar com `$1`. O Node é uma observação complementar e a conferência preserva a regra da aplicação. [Relógios do PostgreSQL](https://www.postgresql.org/docs/18/functions-datetime.html)

- **Supervisor e guarda.** A conexão exclusiva do lock já chama a verificação de identidade, incluindo `origin`. As conexões de atestação revalidam `origin` e a configuração de leitura em cada snapshot.
- **D06 e D09.** Cada suíte tem pool próprio de fixtures. Na D1.2, verificar endpoint, banco, role e `origin` no estabelecimento de cada conexão física antes de permitir o primeiro comando de escrita. Preservar esse gate nas rotas de aquisição e substituição de clientes.
- **Nest.** O pool de `DatabaseModule` é independente dos pools de fixtures. Seu gate deve anteceder `app.init()` e alcançar toda conexão que os hooks puderem adquirir. A inicialização de jogos e questionário pode escrever. O scheduler deve continuar desligado para o piloto. Os caminhos legados também devem ser bloqueados antes da primeira conexão.

### Domínio do journal e recuperação

Proposta para decisão do responsável: uma subpasta fixa de `ProgramData\ArenaGO\integration\127.0.0.1-55432-arenago_events_test` em NTFS local. Fixar caminho absoluto, identificação do volume e ID físico da pasta, SID do operador e ACLs após provisionamento autorizado. Evitar caminhos por checkout ou perfil pessoal. A verificação deve abranger ancestrais, diretório, registros e marcador, com ACL protegida contra substituição por outras contas. Aceitar somente a raiz aprovada, sem links simbólicos, junctions, montagem redirecionada ou aliases. A comparação deve usar a identidade física da pasta e reatestar o diretório imediatamente antes de ocupar o domínio. A D1.1 fornece o contrato puro e fixtures simuladas. O adaptador de Windows e a integração do journal precisam de D1.2. O journal existente permanece reservado a simulações nessa arquitetura.

Após aprovar e provisionar o caminho em atividade separada, as primeiras conferências são somente leitura. Percorrer os componentes do caminho e a árvore apenas depois de conferir que cada entrada inspecionada é regular. O ID deve ser associado ao volume e às ACLs, incluindo as permissões de substituição nos diretórios pais. [Comando queryfileid](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-file)

```powershell
$infraJournal = Read-Host 'Caminho absoluto aprovado do domínio de journal'
Get-Item -LiteralPath $infraJournal | Select-Object FullName,Attributes
Get-Acl -LiteralPath $infraJournal | Select-Object Owner,AreAccessRulesProtected,Access
fsutil.exe file queryfileid $infraJournal
[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
```

Marcador órfão ou histórico inconclusivo bloqueia retomada a partir de qualquer checkout. A recuperação proposta exige identificação da instância e do domínio, preservação do journal e do marcador, identificação de processos remanescentes, verificação de sessões, transações e locks, reconciliação de estrutura, migrations e baseline e decisão expressa do responsável. Registrar quem autorizou, quando, evidências e ação executada. Uma eventual retirada de marcador somente pode ocorrer por procedimento manual autorizado depois da revisão das evidências. A D1.1 não fornece comando de remoção.

### Validação independente e etapa futura

Alterações da D1.1: `integration-db-guard.ts` e `integration-schema.ts` reutilizam o ciclo somente leitura e o inventário de FKs. `integration-preparation.ts` concentra as operações simuladas e a verificação de evidência. `inspect-postgres-windows.ps1` coleta identidade do sistema operacional. `integration-infrastructure.test.ts` preserva as declarações anteriores e adiciona 17 casos sobre candidata, qualificação, identidade, recusa de modo real, baseline, configuração de sessão, relógios e journal. O orquestrador continua bloqueando a execução real. Evolução da D1.2 e homologação da D1.3 ficam pendentes.

Nesta rodada foram feitas inspeção do contrato, análise sintática TypeScript e PowerShell, resolução estática dos imports relativos, consultas de metadados do Windows sem conexão ao banco e verificações Git. A primeira análise sintática Windows PowerShell apontou operadores quebrados em linhas distintas. A forma corrigida passou no parser. Os testes, typecheck e comprovação operacional ficam para as etapas autorizadas. O SHA-256 da evidência acumulada é registrado na entrega para evitar referência circular.

Comandos para a Luna Medium em ambiente isolado, com dependências já instaladas. As suítes abaixo usam mocks e opções sintéticas. Os 17 casos focados já fazem parte da suíte de infraestrutura.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
npm.cmd run typecheck:test
Write-Host "Typecheck: $LASTEXITCODE"
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.1 ' test/unit/integration-infrastructure.test.ts
Write-Host "D1.1 focado: $LASTEXITCODE"
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts test/unit/integration-campaign.test.ts
Write-Host "Infraestrutura: $LASTEXITCODE"
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-event-operations-db-guard.test.ts test/unit/admin-role-management-db-guard.test.ts test/unit/first-admin-bootstrap-db-guard.test.ts test/unit/participant-admission-db-guard.test.ts test/unit/participations-read-db-guard.unit.test.ts test/unit/test-db-guard.unit.test.ts
Write-Host "Guardas legadas: $LASTEXITCODE"
Set-Location ..
git diff --check
git diff --cached --exit-code
```

Para a futura preparação real, executar primeiro a atestação Windows documentada e obter aprovação da fonte, do domínio do journal e do adaptador de leitura. A entrada da credencial segue o procedimento de terminal descrito na seção do adaptador operacional. O ambiente deverá usar `NODE_ENV=test`, dotenv desativado e scheduler desligado. Após autorização específica, o adaptador poderá qualificar a projeção, verificar o baseline e extrair uma candidata como operações de leitura separadas. Provisionamento, escrita, campanhas e recuperação exigem autorizações próprias. Não houve conexão com PostgreSQL ou Neon.

### Correção da assertion do contrato somente leitura

A Luna Medium emitiu **Parecer B — Preparação condicionada**. O typecheck retornou 0. Em Node v24.15.0, o bootstrap do `tsx` falhou com `uv_os_get_passwd returned ENOMEM`, exit code 1, antes de carregar os testes.

O responsável executou as suítes em PowerShell local, com Node v24.15.0, na versão cujo patch tinha SHA-256 `04AEFF6E231359752B6A8D65115B171BC87FFF2C1187B728762B1D9337BC3D45`. O typecheck local retornou 0.

| Suíte | Aprovados | Falhos | Cancelados | Ignorados | Duração | Exit code |
|---|---:|---:|---:|---:|---:|---:|
| Fundação e preparação D1.1 | 128 | 1 | 0 | 0 | 1.849,9176 ms | 1 |
| Orquestrador | 75 | 0 | 0 | 0 | 10.265,545 ms | 0 |
| Total executado | 203 | 1 | 0 | 0 | — | — |

Dos 129 testes da fundação, passaram os 112 anteriores e 16 dos 17 novos. As seis suítes de guardas legadas, com 81 casos, ficaram fora dessa campanha. Os casos direcionados D1.1 foram executados como parte da fundação. A campanha anterior de 268/268 permanece registrada no histórico.

O teste `D1.1 extrai bytes v2 canônicos após a guarda e qualifica a mesma projeção em operação distinta` falhou com `AssertionError [ERR_ASSERTION]` em 37,3051 ms. A assertion `statements.slice(1, -1).every(sql => sql.startsWith("SELECT "))` reprovou a consulta emitida por `inspectPreparationSnapshot` para ler `clock_timestamp()`, `CURRENT_TIMESTAMP`, `activated_at` e a configuração efetiva da sessão, incluindo isolamento, somente leitura, `search_path`, UTC e modo de replicação. Seu texto começa com `SELECT` seguido imediatamente por quebra de linha. O `WITH` da projeção estrutural está dentro de uma consulta que começa com `SELECT * FROM (`. As opções iniciais da sessão são passadas na criação do pool.

Na primeira extração, a sequência é `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, identidade, schemas, ACLs, catálogo, migrations, projeção estrutural, histórico Admin, baseline operacional, jogos, questionário, relógio e configuração efetiva, e `ROLLBACK`. A leitura de relógio é a última consulta antes do rollback. O cliente é liberado e o pool encerrado em seguida. A falha é de assertion textual. Naquele ponto, a coleta só continha a primeira extração. A qualificação ocorria mais tarde e reutilizava a mesma fixture, o que passou a ser evitado para conferir cada ciclo isoladamente.

O teste agora confere o SQL completo e a ordem das instruções. As consultas fixas usam SHA-256 do texto revisado, com normalização exclusiva de CRLF para LF. A consulta de baseline tem expectativa construída com as tabelas das migrations do checkout. Abertura, rollback, liberação e encerramento têm verificações explícitas. Mantive as verificações do digest do artefato, do determinismo sob reordenação e da recusa de estrutura divergente. A mesma regressão demonstra que `SELECT set_config('search_path', 'public', false)` seria rejeitado pela assertion mesmo na posição de uma leitura legítima. Esse SQL aparece apenas como texto de controle no teste. Extração, extração com projeção reordenada, qualificação válida e qualificação recusada usam coletas próprias. Nenhuma consulta ou configuração da implementação foi alterada.

Foram conferidos a sequência SQL por inspeção estática, os digests das consultas fixas, a sintaxe TypeScript e o inventário de declarações de teste. A validação do patch usa aplicação em índice e diretório de objetos temporários, reversão sem aplicar ao checkout, comparação dos blobs e verificação de whitespace. Testes e typecheck da versão corrigida aguardam a Luna Medium. O modo real permanece bloqueado e BC-04 segue pendente de validação operacional.

A sequência de revalidação mantém o filtro `^D1\.1 `. Execute em PowerShell local com as dependências instaladas e interrompa no primeiro exit code diferente de zero. A previsão consolidada segue em 285 casos (129 da fundação, 75 do orquestrador e 81 das guardas legadas). O teste isolado e os 17 direcionados já estão incluídos nos 129.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw "Typecheck: $LASTEXITCODE" }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.1 extrai bytes v2 canônicos após a guarda e qualifica a mesma projeção em operação distinta$' test/unit/integration-infrastructure.test.ts
if ($LASTEXITCODE -ne 0) { throw "Teste isolado: $LASTEXITCODE" }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.1 ' test/unit/integration-infrastructure.test.ts
if ($LASTEXITCODE -ne 0) { throw "D1.1 focado: $LASTEXITCODE" }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-infrastructure.test.ts
if ($LASTEXITCODE -ne 0) { throw "Fundação: $LASTEXITCODE" }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/integration-campaign.test.ts
if ($LASTEXITCODE -ne 0) { throw "Orquestrador: $LASTEXITCODE" }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test test/unit/admin-event-operations-db-guard.test.ts test/unit/admin-role-management-db-guard.test.ts test/unit/first-admin-bootstrap-db-guard.test.ts test/unit/participant-admission-db-guard.test.ts test/unit/participations-read-db-guard.unit.test.ts test/unit/test-db-guard.unit.test.ts
if ($LASTEXITCODE -ne 0) { throw "Guardas legadas: $LASTEXITCODE" }
```

### Adaptador operacional somente leitura

Na versão simulada de SHA-256 `B92DEC9B7F02650ABFF0537080CCA875403FBBBDFED405F34146981572CD789A`, o responsável completou no PowerShell local o teste isolado (1/1), a D1.1 focada (17/17), a fundação (129/129), o orquestrador (75/75), as guardas legadas (81/81) e o typecheck. O total consolidado foi 285/285, sem falhas, cancelamentos ou skips. A Luna aprovou a implementação simulada para auditoria direcionada. O Astra emitiu **Parecer A — apta para avançar à preparação operacional controlada**. Esses resultados antecedem o adaptador e a nova validação está pendente.

O ponto de entrada `backend/test/infrastructure/read-postgres-preparation.ts` exige Windows, `NODE_ENV=test`, indicação explícita da operação de leitura autorizada e fingerprint previamente conferido pelo responsável. O processo usa as três URLs fixas e idênticas, credencial recebida pela entrada padrão e um único cliente `pg`, sem reconexão. A identidade Windows é conferida antes de preparar o cliente, novamente imediatamente antes de conectar e após encerrar a sessão, antes da emissão da evidência. A consulta de configurações efetivas acontece logo após o `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, antes das leituras de catálogo, migrations ou baseline. Divergência encerra a transação por rollback e fecha o cliente. O orquestrador continua recusando modo real.

As duas inspeções de listeners examinam todas as escutas da porta 55432 e exigem um único endereço, `127.0.0.1`. O fingerprint de execução inclui processos, instantes de criação, caminhos e hashes dos binários. O identificador estável da instalação combina o identificador da máquina e o diretório de dados sem expor os valores originais. A qualificação recusa a referência identificada como oriunda da mesma instalação, inclusive após reinício. O identificador não substitui o registro de procedência. O processo auditor é executado no próprio Windows do servidor, em janela exclusiva e sem proxy ou túnel. A política de autenticação do servidor dedicado deve exigir SCRAM, com credencial própria de teste.

A medição usa três amostras consecutivas no mesmo snapshot. Confere a estabilidade do instante da transação e da ativação, a progressão do relógio do servidor, o cruzamento dos intervalos de offset e o limite de ida e volta de 250 ms por amostra. Cada amostra exige 1 ms de margem no corte convertido para `Date`, além dos limites do relógio civil do Node e da transação. A folga torna inconclusivos os casos limítrofes em vez de inferir equivalência entre microssegundos do PostgreSQL e milissegundos da aplicação.

#### Atestação Windows pelo responsável

Executar em Windows PowerShell local com acesso a TCP/CIM e aos caminhos aprovados. Abrir o terminal como administrador se as permissões locais impedirem a consulta. Obter os diretórios dos registros independentes da instalação e confrontar com a saída CIM. Não publicar caminhos, linhas de comando ou dados brutos do relatório local.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile
$infraBin = Read-Host 'Diretório bin aprovado do PostgreSQL 18.6'
$infraData = Read-Host 'Diretório de dados aprovado da instância dedicada'
$infraListeners = @(Get-NetTCPConnection -State Listen -LocalPort 55432 -ErrorAction Stop)
$infraListeners | Select-Object LocalAddress,LocalPort,OwningProcess
if ($infraListeners.Count -ne 1 -or $infraListeners[0].LocalAddress -ne '127.0.0.1') {
    throw 'A porta 55432 deve ter um único listener em 127.0.0.1.'
}
$infraService = Get-CimInstance -ClassName Win32_Service -Filter "Name='postgresql-x64-18'" -ErrorAction Stop
if ($infraService.State -ne 'Running' -or $infraService.ProcessId -le 0) {
    throw 'Serviço PostgreSQL não confirmado.'
}
$infraService | Select-Object Name,State,ProcessId,PathName
@($infraListeners[0].OwningProcess, $infraService.ProcessId) | Sort-Object -Unique | ForEach-Object {
    Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $_) -ErrorAction Stop
} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate
$infraIdentityJson = & .\backend\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
if (-not $infraIdentityJson) { throw 'Atestação inconclusiva.' }
$infraIdentity = $infraIdentityJson | ConvertFrom-Json -ErrorAction Stop
$infraIdentity | Select-Object clusterSha256,instanceSha256
```

#### Fonte independente e domínio do journal

**Decisão proposta para provisionamento.** Usar uma VM Windows descartável e isolada, com instalação PostgreSQL 18.6 de procedência verificada, serviço `postgresql-x64-18`, data directory novo e escuta exclusiva no loopback do convidado. Uma segunda instância no mesmo Windows só seria atestável com a guarda atual se a instância convencional cedesse serviço e porta, o que exigiria interrupção e troca controlada. Executá-las simultaneamente em outra porta ou endereço alteraria o contrato de atestação. A VM mantém o endpoint idêntico em outro sistema sem interferência na instância convencional.

Em autorização separada, preparar dentro da VM o banco `arenago_events_test` com role proprietária `arenago` sem privilégios elevados nem memberships, sem acesso público ao banco e sem dados copiados de ambientes reais. Autorizar expressamente a aplicação das oito migrations com bytes e hashes do checkout e o preenchimento mínimo do baseline canônico (20 jogos e uma versão ativa do questionário). Registrar versão do instalador, revisão, hashes, atestação e evidência de preparação. O adaptador não executa essas escritas. A primeira extração exige autorização de leitura da fonte. O responsável revisa o catálogo contra as migrations e as definições esperadas, incluindo as ações de FK, e confere que as definições não contêm literais sensíveis.

**Registro de homologação.** Depositar os bytes UTF-8 exatos da candidata independente em `%ProgramData%\ArenaGO\integration-authority\reference-v2.json`. O responsável grava separadamente `reference-v2.approval.json` com `kind: "homologated"`, `sha256` dos bytes, `sourceClusterSha256` e `sourceInstanceSha256` da extração. Os três digests são hexadecimais minúsculos. Manter no dossiê de aprovação o histórico das migrations, os resultados da revisão, data, origem e decisão. Provisionar pasta, arquivos e ancestrais com ACLs verificadas e sem redirecionamento. Somente o responsável homologador pode publicar ou substituir os arquivos. O executor de leitura recebe apenas leitura. O adaptador rejeita links detectáveis e verifica o digest, a versão e as migrations pela autoridade de referência. A conferência de ACLs, dos demais pontos de redirecionamento e da procedência continua sendo responsabilidade operacional antes do uso.

**Journal convencional.** Reservar `%ProgramData%\ArenaGO\integration\127.0.0.1-55432-arenago_events_test` em volume NTFS local. No provisionamento autorizado fixar caminho absoluto, volume, ID físico da pasta e SID do operador. Proteger ACLs dos componentes e entradas contra substituição, com escrita do journal restrita à identidade operacional aprovada e administração do domínio sob controle do responsável. Conferir os ancestrais, volume, ACLs e identidade com `Get-Item`, `Get-Acl`, `fsutil.exe file queryfileid` e o SID do terminal conforme o procedimento acima. Conferir a ausência de redirecionamento, marcador órfão e registros inconclusivos. Resíduos exigem preservação das evidências e decisão expressa de recuperação. A preparação não ocupa esse domínio. A validação automática da identidade física no momento de ocupar o journal, o gate dos pools de fixtures/Nest e a comparação de continuidade do baseline por suíte pertencem à D1.2.

#### Execução de leitura após autorização específica

Escolher `extract-candidate` na fonte aprovada ou `qualify` no destino convencional, após homologar a referência independente e autorizar essa segunda leitura. Usar o mesmo terminal e as variáveis da atestação correspondente. Usar ambiente limpo de `PG*`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_DEBUG*` e `NODE_PG_FORCE_NATIVE` antes de iniciar o Node. Digitar a senha somente no prompt sem eco do adaptador. O adaptador exige entrada e saída de diagnóstico ligadas ao terminal, exibe o prompt em stderr e mantém o JSON em stdout. Enter confirma, Backspace corrige e Ctrl+C cancela.

```powershell
$infraOperation = Read-Host 'Operação de leitura autorizada: extract-candidate ou qualify'
if ($infraOperation -notin @('extract-candidate', 'qualify')) { throw 'Operação inválida.' }
$env:NODE_ENV = 'test'
$infraEvidenceJson = & .\backend\node_modules\.bin\tsx.cmd --tsconfig backend/tsconfig.test.json backend/test/infrastructure/read-postgres-preparation.ts --authorized-read $infraOperation $infraBin $infraData $infraIdentity.instanceSha256
if ($LASTEXITCODE -ne 0) { throw "Leitura inconclusiva (exit code $LASTEXITCODE)." }
$infraEvidence = $infraEvidenceJson | ConvertFrom-Json -ErrorAction Stop
$infraEvidence | Select-Object operation,clusterSha256,instanceSha256,referenceSha256
```

Na extração, a propriedade `candidate.bytes` pode ser exportada por `[IO.File]::WriteAllBytes` com `[Text.Encoding]::UTF8.GetBytes($infraEvidence.candidate.bytes)` para o destino de revisão previamente aprovado. Conferir o SHA-256 antes de transferir para a área de homologação. O operador de extração não grava o registro de aprovação. Na qualificação, preservar a evidência do digest consumido e o resultado da conferência de estrutura, baseline, relógios e encerramento. A homologação operacional e o BC-04 continuam pendentes dessas etapas.

#### Correção do fornecimento da credencial

O parecer condicionado da Luna registrou typecheck aprovado na versão anterior e apontou a passagem em Base64 pelo PowerShell. A senha agora entra diretamente no processo consumidor, sem argumentos, arquivos, histórico do shell, logs ou gravação em `process.env`. O adaptador zera os buffers mutáveis que manipula. A decodificação, a URI e o driver ainda usam strings gerenciadas. O runtime pode manter cópias até depois da liberação e não há garantia de apagamento em memória. A proteção contra eco não protege contra captura de teclado, depuração ou dumps em uma máquina comprometida.

A Luna Medium pode validar as três novas regressões do prompt com entradas simuladas, sem conexão ao banco. Se o `tsx` falhar durante a inicialização com ENOMEM, repetir a sequência em PowerShell local saudável.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
npm.cmd run typecheck:test
if ($LASTEXITCODE -ne 0) { throw "Typecheck: $LASTEXITCODE" }
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.1 ' test/unit/integration-infrastructure.test.ts
if ($LASTEXITCODE -ne 0) { throw "D1.1: $LASTEXITCODE" }
```

#### Validação local da correção e preparação operacional

O SHA-256 conferido antes desta atualização foi `AB4467B28CC603D30633403FA91B829CDF66B790F08F3B5CAC69DFC9347AB499`. Nessa versão, o responsável informou typecheck aprovado e 23/23 direcionados, 135/135 da fundação, 75/75 do orquestrador e 81/81 das guardas legadas. O total é **291/291 casos distintos**. Os 23 direcionados, incluindo as três novas regressões de credenciais, já fazem parte dos 135 casos da fundação. O total de 308 mencionado anteriormente não corresponde a esse escopo consolidado.

A revisão estática aprovou a correção do mecanismo de credenciais e confirmou a preservação das garantias de leitura. A homologação do console Windows e a preparação operacional ainda estão pendentes. Use a sequência da seção **Atestação Windows pelo responsável** para a inspeção completa, incluindo TCP, CIM e a geração do fingerprint.

**Conferência do prompt com senha fictícia.** No PowerShell 5.1 com Node v24.15.0, o responsável confirmou entrada direta de `Demo-@` e restauração do terminal. A sequência com `é` e Backspace falhou repetidamente. As regressões simuladas anteriores, a regressão de caminhos e a atestação Windows passaram. Ctrl+C e redirecionamento ainda aguardam confirmação no console.

O código aceita BS (`08`) e DEL de um byte (`7F`), mesmo quando um ponto de código UTF-8 chega em mais de um evento. A tecla física Delete pode chegar como `ESC [ 3 ~`, que a entrada protegida rejeita. No libuv incluído no Node dessa versão, o caminho de console converte eventos Unicode do Windows e pode prefixar ESC quando Alt é usado fora de uma composição. A evidência disponível não identifica qual sequência chegou. Outra hipótese é `é` em forma de dois pontos de código. Um Backspace remove a marca combinante e deixa o `e` nesse caso. A comparação anterior só esperava o resultado da forma composta. Nenhuma dessas hipóteses justifica mudar a edição de senhas sem confirmar o evento recebido. [Código do libuv no Node v24.15.0](https://github.com/nodejs/node/blob/v24.15.0/deps/uv/src/win/tty.c)

Execute os comandos abaixo em PowerShell local com stdin e stderr ligados ao console. Apenas a função do prompt é importada. Nenhum caso inicia o adaptador ou acessa o banco. Use somente os valores fictícios e confirme visualmente que não há eco. A sonda imprime resultados booleanos. `composedMatch` e `decomposedMatch` servem para a entrada Unicode sem edição. `baseLetterRemained` na edição identifica o resultado compatível com a remoção da marca combinante.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$infraConsoleProbe = @'
const { readTerminalPassword } = require('./test/infrastructure/read-postgres-preparation.ts');
const mode = process.argv[1];
const rawBefore = process.stdin.isRaw;
const terminalRestored = () => process.stdin.isRaw === rawBefore;
const keyKinds = { bs: false, del: false, escape: false };
const classify = bytes => {
  keyKinds.bs ||= bytes.includes(8);
  keyKinds.del ||= bytes.includes(127);
  keyKinds.escape ||= bytes.includes(27);
};
const reading = readTerminalPassword(process.stdin, message => process.stderr.write(message));
if (mode.endsWith('-erase')) process.stdin.prependListener('data', classify);
reading.then(result => {
  const composedMatch = mode === 'unicode' && result === 'Demo-%C3%A9';
  const decomposedMatch = mode === 'unicode' && result === 'Demo-e%CC%81';
  const baseLetterRemained = mode === 'unicode-erase' && result === 'Demo-e%40';
  const encodedMatch = mode === 'unicode' ? composedMatch || decomposedMatch
    : ['direct', 'ascii-erase', 'unicode-erase'].includes(mode) && result === 'Demo-%40';
  console.log(JSON.stringify({ encodedMatch, composedMatch, decomposedMatch, baseLetterRemained,
    terminalRestored: terminalRestored(), keyKinds }));
  if (!encodedMatch || !terminalRestored()) process.exitCode = 1;
}, error => {
  const inputRejected = error.message.includes('cancelada ou inv');
  console.log(JSON.stringify({ inputRejected, terminalRestored: terminalRestored(), keyKinds }));
  if (!['cancel', 'redirect'].includes(mode) || !inputRejected || !terminalRestored()) process.exitCode = 1;
}).finally(() => process.stdin.off('data', classify));
'@
# Digite Demo-@ e pressione Enter.
node --require tsx/cjs -e $infraConsoleProbe direct
# Digite Demo-x, pressione Backspace, digite @ e pressione Enter.
node --require tsx/cjs -e $infraConsoleProbe ascii-erase
# Digite Demo-é e pressione Enter.
node --require tsx/cjs -e $infraConsoleProbe unicode
# Digite Demo-é, pressione Backspace, digite @ e pressione Enter.
node --require tsx/cjs -e $infraConsoleProbe unicode-erase
# Pressione Ctrl+C no prompt.
node --require tsx/cjs -e $infraConsoleProbe cancel
'' | node --require tsx/cjs -e $infraConsoleProbe redirect
```

A regressão adicionada cobre BS e DEL com UTF-8 dividido entre eventos e a rejeição da sequência da tecla física Delete. Execute-a com a Luna Medium em `backend`, sem acesso ao banco:

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$env:NODE_ENV = 'test'
& .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.test.json --test '--test-name-pattern=^D1\.1 trata BS e DEL' test/unit/integration-infrastructure.test.ts
```

**Pré-requisitos da VM descartável.** Execute no host Windows, em PowerShell com permissão para consultar os recursos opcionais. A sequência abaixo considera Hyper-V e usa apenas consultas. Se estiver desabilitado ou indisponível, registre a pendência antes de qualquer provisionamento. As propriedades de virtualização do processador podem ficar ocultas com o hipervisor já ativo. Nesse caso, verifique a disponibilidade com `Get-VMHost`. Defina a memória e o espaço do convidado antes de comparar com a capacidade disponível.

```powershell
Get-CimInstance Win32_OperatingSystem -ErrorAction Stop |
    Select-Object Caption,Version,OSArchitecture,FreePhysicalMemory
Get-CimInstance Win32_ComputerSystem -ErrorAction Stop |
    Select-Object HypervisorPresent,TotalPhysicalMemory
Get-CimInstance Win32_Processor -ErrorAction Stop |
    Select-Object Name,VMMonitorModeExtensions,VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction Stop |
    Select-Object DeviceID,FileSystem,FreeSpace,Size
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop |
    Select-Object FeatureName,State
if (Get-Command Get-VMHost -ErrorAction SilentlyContinue) {
    Get-VMHost -ErrorAction Stop | Select-Object Name,VirtualMachinePath,VirtualHardDiskPath
}
$infraWindowsIso = Read-Host 'Caminho local da ISO Windows aprovada'
$infraPgInstaller = Read-Host 'Caminho local do instalador PostgreSQL 18.6 aprovado'
Get-FileHash -LiteralPath $infraWindowsIso,$infraPgInstaller -Algorithm SHA256 -ErrorAction Stop
Get-AuthenticodeSignature -LiteralPath $infraPgInstaller | Select-Object Status,SignerCertificate
```

Confronte os hashes com os valores obtidos de uma fonte independente e verifique a assinatura e o publicador do instalador. Antes de autorizar a criação, confirme a instalação limpa, o armazenamento local, a operação sem encaminhamento de porta ou ponte com a rede externa e a disponibilidade no convidado do checkout com os bytes aprovados e das dependências locais. A primeira leitura, as migrations e a preparação do baseline continuam sujeitas às autorizações específicas descritas acima.

#### Provisionamento manual autorizado da fonte na VM

O responsável confirmou Windows 11 no VirtualBox, Node 24.15.0, npm 11.12.1, PostgreSQL 18.6, serviço ativo e listener exclusivo em 127.0.0.1:55432. O backend foi copiado para C:\DoJob\ProgramacaoMobile\backend, com 347 arquivos conferidos por SHA-256 e zero divergências. Oito migrations estão presentes e `npm ci --ignore-scripts` terminou com exit code 0. A pasta compartilhada foi removida, a rede virtual desconectada e o clipboard compartilhado desabilitado. A atestação Windows passou na instalação independente, com clusterSha256 `ce943f39bc2664f35ce5f28d75f1b16485d959c45fdb8dadd085590971c188e3` e instanceSha256 `0b32cd37d8532a2d0dba6e62caba0c0ea37950a5aef4d0728341de1bf8cdde7a`.

A autorização recebida cobre criação da role, banco, oito migrations e baseline somente nessa VM. As operações abaixo permanecem pendentes de execução pelo responsável. Use PowerShell administrativo dentro da VM, sem transcrição ou rastreamento, com checkout e dependências já conferidos. A senha administrativa é solicitada pelo psql com `-W`. A nova senha é definida por `\password`, que faz prompt protegido. Use credenciais exclusivas desta VM e prefira caracteres ASCII para esta etapa, considerando a investigação de edição Unicode do console.

O roteiro usa o migrador oficial `drizzle-orm/node-postgres/migrator`, com a pasta de migrations usada pelo `db:migrate`, e a função existente `runDatabaseSeed`, dentro de uma transação. Não inicia Nest, API ou scheduler. As importações TypeScript dependem do carregador tsx/esbuild. Em Windows, o pacote opcional da plataforma normalmente entrega o executável esbuild mesmo com scripts ignorados. A verificação de carga abaixo decide a suficiência real dentro da VM, sem instalação ou acesso à rede. Argon2 não participa desse fluxo.

O roteiro é deliberadamente de primeira preparação. Se role ou banco já existirem, pare e investigue o estado, sem sobrescrever ou apagar. Uma interrupção pode deixar role, banco ou migrations aplicadas. O seed tem rollback próprio e o migrador Drizzle controla sua transação. Preserve o diagnóstico e solicite revisão antes de retomar.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$ErrorActionPreference = 'Stop'
$infraBin = Read-Host 'Diretório bin aprovado do PostgreSQL 18.6 nesta VM'
$infraData = Read-Host 'Diretório de dados aprovado desta VM'
$infraAdmin = Read-Host 'Role administrativa exclusiva da VM (normalmente postgres)'
if ($infraAdmin -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Role administrativa inválida.' }
$infraPsql = Join-Path $infraBin 'psql.exe'
if (!(Test-Path -LiteralPath $infraPsql)) { throw 'psql ausente.' }
$infraSavedEnv = @{}
$infraKeys = @('NODE_ENV','DOTENV_CONFIG_PATH','DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL')
foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Name -match '^(PG|NODE_OPTIONS$|NODE_PATH$|NODE_DEBUG|NODE_PG_FORCE_NATIVE$)' -or $entry.Name -in $infraKeys) {
        $infraSavedEnv[$entry.Name] = $entry.Value
    }
}
try {
    foreach ($key in $infraSavedEnv.Keys) { Remove-Item -LiteralPath ('Env:' + $key) }
    $env:NODE_ENV = 'test'
    $env:DOTENV_CONFIG_PATH = 'NUL'
    # Placeholder local apenas para permitir a validação de configuração nas importações.
    $env:DATABASE_URL = 'postgresql://arenago:preflight-only@127.0.0.1:55432/arenago_events_test'
    $env:DATABASE_DIRECT_URL = $env:DATABASE_URL
    $env:EVENTS_TEST_DATABASE_URL = $env:DATABASE_URL
    function Confirm-InfraVm {
        $json = & .\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
        $id = $json | ConvertFrom-Json -ErrorAction Stop
        if ($id.clusterSha256 -ne 'ce943f39bc2664f35ce5f28d75f1b16485d959c45fdb8dadd085590971c188e3' -or
            $id.instanceSha256 -ne '0b32cd37d8532a2d0dba6e62caba0c0ea37950a5aef4d0728341de1bf8cdde7a') { throw 'Identidade VM divergente.' }
    }
    Confirm-InfraVm
    node --require tsx/cjs -e "require('pg'); require('drizzle-orm/node-postgres/migrator'); require('./src/database/seed.ts'); const s=require('./test/infrastructure/integration-schema.ts').checkoutSchema(); if(s.migrations.length!==8) throw Error('Migrations'); console.log('Dependencias e oito migrations: OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Dependências offline insuficientes. Pare antes das escritas.' }
    $infraCheckSql = @'
DO $guard$
BEGIN
 IF current_database() <> 'postgres' OR inet_server_addr() <> '127.0.0.1'::inet
    OR inet_server_port() <> 55432 OR current_setting('server_version_num') <> '180006'
    OR current_user <> session_user THEN RAISE EXCEPTION 'Destino administrativo divergente'; END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'arenago')
    OR EXISTS (SELECT FROM pg_database WHERE datname = 'arenago_events_test')
 THEN RAISE EXCEPTION 'Role ou banco existente; requer revisao'; END IF;
END $guard$;
CREATE ROLE arenago LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
'@
    & $infraPsql -X -W -h 127.0.0.1 -p 55432 -U $infraAdmin -d postgres -v ON_ERROR_STOP=1 -c $infraCheckSql
    if ($LASTEXITCODE -ne 0) { throw 'Criação da role interrompida.' }
    Confirm-InfraVm
    & $infraPsql -X -W -h 127.0.0.1 -p 55432 -U $infraAdmin -d postgres -v ON_ERROR_STOP=1 -c "SET password_encryption = 'scram-sha-256'" -c '\password arenago'
    if ($LASTEXITCODE -ne 0) { throw 'Definição de senha interrompida.' }
    Confirm-InfraVm
    & $infraPsql -X -W -h 127.0.0.1 -p 55432 -U $infraAdmin -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE arenago_events_test WITH OWNER arenago TEMPLATE template0' -c 'REVOKE ALL ON DATABASE arenago_events_test FROM PUBLIC'
    if ($LASTEXITCODE -ne 0) { throw 'Criação/proteção do banco interrompida.' }
    Confirm-InfraVm
    $infraPrepare = @'
const { Client } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { runDatabaseSeed } = require('./src/database/seed.ts');
const { checkoutSchema, canonicalCatalogMatches } = require('./test/infrastructure/integration-schema.ts');
const { readTerminalPassword } = require('./test/infrastructure/read-postgres-preparation.ts');
async function run() {
  const password = await readTerminalPassword(process.stdin, m => process.stderr.write(m));
  const url = 'postgresql://arenago:' + password + '@127.0.0.1:55432/arenago_events_test';
  for (const key of ['DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL']) process.env[key] = url;
  const client = new Client({connectionString:url, ssl:false, connectionTimeoutMillis:5000,
    statement_timeout:30000, options:'-c search_path=public,pg_catalog'});
  client.on('error', () => {});
  try {
    const path = require('node:path');
    const identity = JSON.parse(require('node:child_process').execFileSync(
      path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoProfile','-NonInteractive','-File',path.resolve('test/infrastructure/inspect-postgres-windows.ps1'),
       '-ExpectedBinDirectory',process.argv[1],'-ExpectedDataDirectory',process.argv[2]],
      {encoding:'utf8',windowsHide:true,timeout:30000}));
    if (identity.clusterSha256 !== 'ce943f39bc2664f35ce5f28d75f1b16485d959c45fdb8dadd085590971c188e3'
      || identity.instanceSha256 !== '0b32cd37d8532a2d0dba6e62caba0c0ea37950a5aef4d0728341de1bf8cdde7a') throw Error();
    await client.connect();
    const id = (await client.query("SELECT current_database() AS db, current_user AS role, session_user AS session, inet_server_addr()::text AS host, inet_server_port() AS port, current_setting('server_version_num') AS version")).rows[0];
    if (id.db !== 'arenago_events_test' || id.role !== 'arenago' || id.session !== 'arenago'
      || id.host !== '127.0.0.1/32' && id.host !== '127.0.0.1' || id.port !== 55432 || id.version !== '180006') throw Error();
    const roles = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    if (!roles || Object.values(roles).some(Boolean)) throw Error();
    if ((await client.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname=current_user")).rowCount) throw Error();
    if ((await client.query("SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND (pg_get_userbyid(d.datdba)<>'arenago' OR a.grantee<>d.datdba)")).rowCount) throw Error();
    if ((await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'")).rowCount) throw Error();
    const schema = checkoutSchema();
    if (schema.migrations.length !== 8) throw Error();
    await migrate(drizzle(client), {migrationsFolder:'./drizzle'});
    console.log('Oito migrations aplicadas.');
    await client.query('BEGIN');
    try { await runDatabaseSeed(client, client); await client.query('COMMIT'); }
    catch { await client.query('ROLLBACK'); throw Error(); }
    const applied = (await client.query('SELECT hash, created_at::text AS migration FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
    if (applied.length !== 8 || applied.some((r,i)=>r.hash!==schema.migrations[i].hash || r.migration!==schema.migrations[i].migration)) throw Error();
    const owners = (await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND pg_get_userbyid(c.relowner)<>'arenago'")).rowCount;
    if (owners) throw Error();
    const games = (await client.query('SELECT name,is_curated AS curated FROM public.games')).rows;
    const questionnaires = (await client.query('SELECT version,definition,(activated_at IS NOT NULL AND activated_at <= CURRENT_TIMESTAMP) AS published FROM public.questionnaire_versions')).rows;
    if (!canonicalCatalogMatches(games,questionnaires)) throw Error();
    for (const table of schema.tables.filter(t=>!['games','questionnaire_versions'].includes(t))) {
      if ((await client.query('SELECT EXISTS (SELECT 1 FROM public."' + table + '") AS occupied')).rows[0].occupied) throw Error();
    }
    console.log('Hashes e owners: OK; 20 games; 1 questionnaire_version ativa; tabelas operacionais vazias.');
  } finally { await client.end(); }
}
run().catch(() => { console.error('Preparacao interrompida. Preserve o estado e solicite revisao.'); process.exitCode=1; });
'@
    node --require tsx/cjs -e $infraPrepare $infraBin $infraData
    if ($LASTEXITCODE -ne 0) { throw 'Preparação/validação interrompida.' }
    Confirm-InfraVm
} finally {
    foreach ($key in @($infraKeys + @($infraSavedEnv.Keys) | Sort-Object -Unique)) {
        Remove-Item -LiteralPath ('Env:' + $key) -ErrorAction SilentlyContinue
    }
    foreach ($key in $infraSavedEnv.Keys) { Set-Item -LiteralPath ('Env:' + $key) -Value $infraSavedEnv[$key] }
}
```

O roteiro não foi executado pelo Codex. As senhas são solicitadas nos processos consumidores, com as limitações de memória gerenciada já registradas. As URLs reais são criadas somente no processo Node e encerradas com ele. O ambiente do PowerShell é restaurado em `finally`. A referência estrutural ainda exige extração e homologação em etapa autorizada própria.

#### Revisão da candidata independente e roteiro de homologação

O responsável informou provisionamento concluído na VM, oito migrations com hashes e proprietários conferidos, role restrita, baseline com 20 jogos e um questionário ativo e tabelas operacionais vazias. A extração somente leitura foi concluída. A exportação inicial foi corrigida com UTF-8 no PowerShell 5.1 e uso de `candidate.sha256`. A transferência foi conferida e o compartilhamento temporário removido. Essas evidências foram informadas pelo responsável, sem nova conexão pelo Codex.

A inspeção local confirmou 227.598 bytes no arquivo `D:\ArenaGO-Reference-Export\reference-v2.json`, UTF-8 legível, formato 2, PostgreSQL `180006` e SHA-256 `c96bb176bde7f3f8a4108edc5418aed756cd9e2c405908c86a8c5076b60c3c1d`. A cadeia informada identifica cluster da fonte `ce943f39bc2664f35ce5f28d75f1b16485d959c45fdb8dadd085590971c188e3` e instância `0b32cd37d8532a2d0dba6e62caba0c0ea37950a5aef4d0728341de1bf8cdde7a`. O JSON contém estrutura e hashes de migrations. A procedência operacional é sustentada pelo histórico de preparação e extração, pois o JSON isolado não autentica a instância.

| Elementos revisados | Resultado da inspeção |
|---|---|
| Oito migrations | Tags, ordem, timestamps e SHA-256 exatos dos arquivos do checkout |
| 27 tabelas | 26 públicas e journal Drizzle, permanentes, sem RLS |
| 216 colunas | 213 públicas comparadas quanto a posição, tipo, nulabilidade, default, collation, identidade e geração. As três do journal correspondem ao migrador Drizzle: id serial, hash text obrigatório e created_at bigint |
| 276 constraints | 153 NOT NULL, 27 PK, 17 UNIQUE, 36 CHECK, 40 FK e três constraints dos triggers diferidos. Conferidas colunas, chaves compostas, predicados, ações, validação, enforcement e diferibilidade |
| 74 índices | Índices de PK/UNIQUE e explícitos, incluindo expressões, ordem de colunas, filtros parciais e unicidade. Todos válidos, prontos e ativos |
| Seis funções | Corpo integral comparado com o SQL das migrations, normalizando apenas CRLF/LF. Linguagem plpgsql, invoker, volatilidade, flags e configurações coerentes |
| Oito triggers explícitos | Função, tabela, eventos, momento e estado habilitado coerentes. Três constraints de integridade externa são diferíveis e inicialmente diferidas |
| 160 triggers internos das 40 FKs | Conferidas as duas relações, funções RI_FKey_check_ins/upd, RI_FKey_noaction_upd e ações no DELETE (NO ACTION ou SET NULL), eventos, estado O e ausência de diferimento |
| Uma sequência | Sequência inteira do journal, início/minimum 1, máximo 2147483647, incremento/cache 1, sem ciclo e propriedade da coluna drizzle.__drizzle_migrations.id |

Foram examinados integralmente os CHECKs, defaults, expressões e predicados. As formas deparsed `ANY(ARRAY)`, casts de texto, expansão de BETWEEN e intervalos 00:05:00/01:00:00 correspondem ao SQL original. As definições das migrations 0007 e 0008 preservam os controles Staff e a integridade/histórico das chamadas externas. Não foram identificados objetos ou definições inesperados, credenciais, endpoints privados ou literais operacionais sensíveis. Nomes de colunas como password_hash e secret_encrypted são metadados previstos. O total é de 608 objetos. A revisão estática considera a candidata **apta para homologação pelo responsável**. A qualificação do banco convencional e a decisão formal continuam pendentes.

**Roteiro único em duas fases autorizadas.** O bloco abaixo fica no relatório para execução manual. Escolha `publicar` em PowerShell administrativo somente após aprovar expressamente a candidata. Escolha `qualificar` em terminal da conta executora depois da autorização expressa de leitura do banco convencional. A conta executora deve ter permissão suficiente para a atestação CIM e acesso de leitura à instalação, sem escrita na área da autoridade. Cada fase confere o fingerprint convencional aprovado pelo responsável. A publicação usa os bytes originais e um registro JSON separado, sem transformação da candidata. Os arquivos de referência ficam fora do checkout e do patch.

Antes da publicação, conferir o dono e as ACLs de ProgramData e ancestrais da área ArenaGO, incluindo permissão de exclusão de filhos. Somente SYSTEM e Administradores devem conseguir substituir a pasta da autoridade. O roteiro exige aprovação expressa dessa conferência. Se já existir autoridade, ele interrompe para preservar a versão anterior. Uma falha parcial exige revisão manual antes da repetição. A fase de qualificação confere novamente as ACLs, o volume NTFS, ausência de redirecionamentos, fingerprints e integridade dos arquivos.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile\backend
$ErrorActionPreference = 'Stop'
$infraPhase = Read-Host 'Fase autorizada: publicar ou qualificar'
if ($infraPhase -notin @('publicar','qualificar')) { throw 'Fase inválida.' }
$infraHash = 'c96bb176bde7f3f8a4108edc5418aed756cd9e2c405908c86a8c5076b60c3c1d'
$infraSourceCluster = 'ce943f39bc2664f35ce5f28d75f1b16485d959c45fdb8dadd085590971c188e3'
$infraSourceInstance = '0b32cd37d8532a2d0dba6e62caba0c0ea37950a5aef4d0728341de1bf8cdde7a'
$infraArea = Join-Path $env:ProgramData 'ArenaGO\integration-authority'
$infraReference = Join-Path $infraArea 'reference-v2.json'
$infraApproval = Join-Path $infraArea 'reference-v2.approval.json'
$infraBin = Read-Host 'Diretório bin aprovado do PostgreSQL convencional'
$infraData = Read-Host 'Diretório de dados aprovado do PostgreSQL convencional'
$infraExpectedCluster = Read-Host 'clusterSha256 convencional aprovado'
$infraExpectedInstance = Read-Host 'instanceSha256 convencional aprovado'
if ($infraExpectedCluster -notmatch '^[a-f0-9]{64}$' -or $infraExpectedInstance -notmatch '^[a-f0-9]{64}$') {
    throw 'Fingerprints inválidos.'
}
function Confirm-InfraConventional {
    $json = & .\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
    $id = $json | ConvertFrom-Json -ErrorAction Stop
    if ($id.clusterSha256 -ne $infraExpectedCluster -or $id.instanceSha256 -ne $infraExpectedInstance -or
        $id.clusterSha256 -eq $infraSourceCluster -or $id.instanceSha256 -eq $infraSourceInstance) {
        throw 'Instância convencional divergente ou coincidente com a fonte.'
    }
}
function Confirm-InfraRegularPath([string]$Path) {
    $entry = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($entry.FullName))
    if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Volume local NTFS obrigatório.' }
    while ($null -ne $entry) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirecionamento detectado.' }
        $entry = if ($entry -is [IO.FileInfo]) { $entry.Directory } else { $entry.Parent }
    }
}
function Set-InfraAuthorityAcl([string]$Path, [bool]$Directory, [string]$ReaderSid) {
    $acl = if ($Directory) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18','S-1-5-32-544',$ReaderSid) | Select-Object -Unique) {
        $rights = if ($sid -eq $ReaderSid) { [Security.AccessControl.FileSystemRights]::ReadAndExecute } else { [Security.AccessControl.FileSystemRights]::FullControl }
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid), $rights, $inherit,
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Confirm-InfraConventional
if ($infraPhase -eq 'publicar') {
    if ((Read-Host 'Digite HOMOLOGAR para confirmar a aprovação expressa desta candidata') -cne 'HOMOLOGAR') { throw 'Sem aprovação.' }
    $infraReader = Read-Host 'SID da conta executora aprovada (S-1-5-21-...)'
    if ($infraReader -notmatch '^S-1-5-21-(\d+-){3}\d+$') { throw 'SID inválido.' }
    $infraCandidate = 'D:\ArenaGO-Reference-Export\reference-v2.json'
    Confirm-InfraRegularPath $infraCandidate
    if ((Get-FileHash -LiteralPath $infraCandidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $infraHash) { throw 'Candidata divergente.' }
    $infraParent = Split-Path -Parent $infraArea
    if (!(Test-Path -LiteralPath $infraParent)) {
        [void](New-Item -ItemType Directory -Path $infraParent)
        Set-InfraAuthorityAcl $infraParent $true $infraReader
    }
    Confirm-InfraRegularPath $infraParent
    Get-Acl -LiteralPath $env:ProgramData | Format-List Owner,Access
    Get-Acl -LiteralPath $infraParent | Format-List Owner,Access
    if ((Read-Host 'Após conferir ancestrais e proteção contra substituição, digite ACL-CONFERIDA') -cne 'ACL-CONFERIDA') {
        throw 'ACL dos ancestrais pendente.'
    }
    if (Test-Path -LiteralPath $infraArea) { throw 'Autoridade preexistente. Revisão necessária.' }
    [void](New-Item -ItemType Directory -Path $infraArea)
    Set-InfraAuthorityAcl $infraArea $true $infraReader
    Confirm-InfraRegularPath $infraArea
    [IO.File]::Copy($infraCandidate, $infraReference, $false)
    Set-InfraAuthorityAcl $infraReference $false $infraReader
    if ((Get-FileHash -LiteralPath $infraReference -Algorithm SHA256).Hash.ToLowerInvariant() -ne $infraHash) { throw 'Cópia divergente.' }
    $infraRecord = [ordered]@{
        kind = 'homologated'
        sha256 = $infraHash
        sourceClusterSha256 = $infraSourceCluster
        sourceInstanceSha256 = $infraSourceInstance
        approvedAt = [DateTimeOffset]::UtcNow.ToString('o')
        approvedBy = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        executorSid = $infraReader
        review = 'INFRA-01.D1.1: oito migrations, 608 objetos revisados'
    }
    [IO.File]::WriteAllText($infraApproval, ($infraRecord | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Set-InfraAuthorityAcl $infraApproval $false $infraReader
    Write-Host 'Referência e aprovação publicadas. Qualificação requer autorização própria.'
} else {
    Confirm-InfraRegularPath $infraArea
    Confirm-InfraRegularPath $infraReference
    Confirm-InfraRegularPath $infraApproval
    $infraRecord = [IO.File]::ReadAllText($infraApproval, [Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($path in @($infraArea,$infraReference,$infraApproval)) {
        $acl = Get-Acl -LiteralPath $path
        if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') { throw 'ACL/proprietário divergente.' }
        $writeMask = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
        foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $writeMask) -and
                $ace.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Escrita por conta não autorizada.' }
        }
    }
    if ((Get-FileHash -LiteralPath $infraReference -Algorithm SHA256).Hash.ToLowerInvariant() -ne $infraHash -or
        $infraRecord.kind -ne 'homologated' -or $infraRecord.sha256 -ne $infraHash -or
        $infraRecord.sourceClusterSha256 -ne $infraSourceCluster -or $infraRecord.sourceInstanceSha256 -ne $infraSourceInstance) { throw 'Registro/bytes divergentes.' }
    if ((Read-Host 'Digite LEITURA-AUTORIZADA para confirmar autorização expressa do banco convencional') -cne 'LEITURA-AUTORIZADA') { throw 'Sem autorização de leitura.' }
    $infraSaved = @{}
    $infraRemoved = @('NODE_ENV','DOTENV_CONFIG_PATH','DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL')
    foreach ($e in Get-ChildItem Env:) {
        if ($e.Name -match '^(PG|NODE_OPTIONS$|NODE_PATH$|NODE_DEBUG|NODE_PG_FORCE_NATIVE$)' -or $e.Name -in $infraRemoved) { $infraSaved[$e.Name] = $e.Value }
    }
    try {
        foreach ($name in $infraSaved.Keys) { Remove-Item -LiteralPath ('Env:' + $name) }
        $env:NODE_ENV = 'test'
        $env:DOTENV_CONFIG_PATH = 'NUL'
        Confirm-InfraConventional
        foreach ($arg in @($infraBin,$infraData)) { if ($arg.Contains('"')) { throw 'Aspas em caminho.' } }
        $infraStart = New-Object Diagnostics.ProcessStartInfo
        $infraStart.FileName = (Get-Command node.exe -ErrorAction Stop).Source
        $infraStart.WorkingDirectory = (Get-Location).Path
        $infraStart.UseShellExecute = $false
        $infraStart.RedirectStandardOutput = $true
        $infraStart.StandardOutputEncoding = [Text.UTF8Encoding]::new($false,$true)
        $infraStart.Arguments = '--require tsx/cjs test/infrastructure/read-postgres-preparation.ts --authorized-read qualify "' + $infraBin + '" "' + $infraData + '" ' + $infraExpectedInstance
        # stdin/stderr herdados mantêm o prompt sem eco no console.
        $infraProcess = [Diagnostics.Process]::Start($infraStart)
        try {
            $infraJson = $infraProcess.StandardOutput.ReadToEnd()
            $infraProcess.WaitForExit()
            if ($infraProcess.ExitCode -ne 0) { throw 'Qualificação inconclusiva.' }
        } finally { $infraProcess.Dispose() }
        $infraEvidence = $infraJson | ConvertFrom-Json -ErrorAction Stop
        if ($infraEvidence.operation -ne 'qualify' -or $infraEvidence.referenceSha256 -ne $infraHash -or
            $infraEvidence.clusterSha256 -ne $infraExpectedCluster -or $infraEvidence.instanceSha256 -ne $infraExpectedInstance) { throw 'Evidência divergente.' }
        Confirm-InfraConventional
        $infraEvidence | Select-Object operation,referenceSha256,clusterSha256,instanceSha256,clock
    } finally {
        foreach ($name in @($infraRemoved + @($infraSaved.Keys) | Select-Object -Unique)) { Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue }
        foreach ($name in $infraSaved.Keys) { Set-Item -LiteralPath ('Env:' + $name) -Value $infraSaved[$name] }
    }
}
```

O roteiro usa captura UTF-8 explícita de stdout por `System.Diagnostics.Process`. A qualificação confere `referenceSha256`, que identifica a referência homologada consumida. `candidate.sha256` pertence à operação de extração já concluída e não é esperado nessa resposta. O administrador publica e a conta executora lê. Caso a conta executora só consiga CIM com elevação administrativa, registrar essa limitação de separação de privilégios e revisar a conta antes de executar. Nenhuma fase foi executada nesta revisão, a candidata não foi alterada e nenhum acesso SQL ocorreu. A publicação, homologação formal e qualificação operacional permanecem decisões e operações do responsável.

#### Normalização de caminhos na atestação Windows

Na atestação local, o responsável confirmou escuta exclusiva em `127.0.0.1:55432`, serviço ativo, relação correta entre os processos, PostgreSQL e `ProductVersion` 18.6, `PG_VERSION` igual a 18, PID e horários consistentes e diretórios resolvidos equivalentes. A execução sem elevação não retornou `ExecutablePath`. O PowerShell administrativo permitiu obter essa informação.

A guarda rejeitava `C:/Program Files/PostgreSQL/18/data`, caminho legítimo gravado pelo PostgreSQL em `postmaster.pid`. Agora `Confirm-LocalPath` troca `/` por `\` antes de exigir um caminho absoluto com letra de unidade. Permanecem as verificações do disco fixo, dos pontos de redirecionamento e da igualdade com os caminhos aprovados. Caminhos relativos, UNC, dispositivos e caminhos com dois-pontos adicionais continuam rejeitados.

Para a Luna Medium, execute a regressão de normalização em Windows. Ela carrega apenas a função de validação de caminho e verifica as três grafias equivalentes e as rejeições, sem chamar a atestação ou acessar o banco. Em seguida, o responsável pode repetir a atestação completa em PowerShell administrativo, usando os caminhos já aprovados. O JSON final deve indicar a versão `180006` e os dois fingerprints. O resultado da nova atestação permanece pendente.

```powershell
Set-Location C:\DoJob\ProgramacaoMobile
powershell.exe -NoProfile -File .\backend\test\unit\inspect-postgres-windows-path.test.ps1
if ($LASTEXITCODE -ne 0) { throw 'Falha na regressão de caminhos.' }

# No PowerShell administrativo
Set-Location C:\DoJob\ProgramacaoMobile
$infraBin = Read-Host 'Diretório bin aprovado do PostgreSQL 18.6'
$infraData = Read-Host 'Diretório de dados aprovado da instância dedicada'
& .\backend\test\infrastructure\inspect-postgres-windows.ps1 -ExpectedBinDirectory $infraBin -ExpectedDataDirectory $infraData
```

## Encerramento operacional da INFRA-01.D1.1

Em 26/11/2026, o responsável aprovou operacionalmente a D1.1. As operações registradas nesta seção foram executadas e confirmadas pelo responsável. O Codex consolidou a documentação e o patch, sem executar consultas SQL, provisionamento ou campanhas nesta rodada. As seções anteriores preservam as decisões, bloqueios e procedimentos de cada momento. Suas indicações de pendência ficam superadas somente pelas evidências expressamente concluídas abaixo.

- **Fonte independente concluída.** Provisionamento na VM Windows 11/VirtualBox com PostgreSQL 18.6, role arenago restrita, banco arenago_events_test, oito migrations aplicadas com hashes e proprietários conferidos, 20 jogos canônicos, um questionário ativo e tabelas operacionais vazias. A cópia do backend teve 347 arquivos conferidos sem divergência. A instalação offline por npm ci --ignore-scripts teve exit code 0. Atestação Windows e extração somente leitura foram concluídas. Rede virtual, clipboard e compartilhamento temporário foram desabilitados ou removidos conforme as evidências anteriores.
- **Revisão e integridade concluídas.** Revisados 608 objetos estruturais contra as oito migrations, incluindo colunas, constraints, índices, seis funções, uma sequência, oito triggers explícitos e os 160 triggers internos das 40 FKs. A divergência inicial de exportação foi corrigida com UTF-8 no PowerShell 5.1 e uso de candidate.sha256. A transferência ao computador principal preservou o SHA-256. O compartilhamento temporário foi removido.
- **Homologação e publicação concluídas.** A referência v2 foi homologada pelo responsável e publicada, com seu registro de aprovação, em ProgramData\ArenaGO\integration-authority. Foram verificadas as ACLs dos ancestrais e da autoridade, abrangendo a proteção contra substituição dos arquivos e do diretório.
- **Bloqueio de ACL PostgreSQL resolvido.** A primeira qualificação foi recusada pela guarda porque o banco convencional concedia CONNECT e TEMPORARY a PUBLIC. O responsável autorizou expressamente a revogação desses privilégios exclusivamente no banco convencional. Após a execução autorizada, a qualificação somente leitura foi concluída. A guarda permaneceu exigindo as mesmas restrições.
- **Exceção operacional registrada.** A execução utilizou excepcionalmente PowerShell administrativo para satisfazer o acesso necessário à atestação Windows/CIM. Nesse contexto, a conta administrativa possui capacidade de alteração da autoridade, limitando a separação de privilégios entre homologação e consumo. O responsável concedeu a aprovação operacional com essa limitação explicitamente registrada.

### Evidência final da qualificação informada pelo responsável

| Campo | Valor |
|---|---|
| operation | qualify |
| referenceSha256 | c96bb176bde7f3f8a4108edc5418aed756cd9e2c405908c86a8c5076b60c3c1d |
| clusterSha256 convencional | be8565ed44d1e57a13333fe5a62a8f8837f10753500280568eb2d2cd7798b6c9 |
| instanceSha256 convencional | d1709ee68f3e06e0bccd34ccc997f34c4b430d869ac79bdf7f18c778000a0180 |
| offsetMinMs | 0.510986328125 |
| offsetMaxMs | 2.362060546875 |
| activationMarginMs | 179497037.64013672 |
| clusterSha256 fonte independente | ce943f39bc2664f35ce5f28d75f1b16485d959c45fdb8dadd085590971c188e3 |
| instanceSha256 fonte independente | 0b32cd37d8532a2d0dba6e62caba0c0ea37950a5aef4d0728341de1bf8cdde7a |

A resposta qualify comprova o consumo do digest homologado e a conclusão das verificações do adaptador para a instância convencional identificada, incluindo estrutura, baseline, configuração da sessão e medições temporais. O intervalo final de offset é compatível entre as amostras e a margem de ativação foi aceita pelo mecanismo. A fonte e o destino têm identidades distintas.

### Escopo encerrado e limites preservados

**D1.1 e BC-04 encerrados no respectivo escopo.** Foram concluídas a preparação da fonte independente, extração, revisão estrutural v2, homologação, publicação protegida e qualificação somente leitura do banco convencional. As evidências de atestação Windows, normalização dos caminhos e regressão de caminhos já confirmadas pelo responsável passam a integrar este encerramento.

Permanece o histórico de 291/291 casos distintos aprovados localmente e typecheck aprovado, com os 23 casos direcionados incluídos nos 135 da fundação, além de 75 do orquestrador e 81 das guardas legadas. Esta consolidação não acrescenta resultado de teste ou homologação específica do console além dos já informados. A investigação de edição Unicode, o cancelamento e o redirecionamento no console conservam o último estado registrado.

O bloqueio das campanhas reais do orquestrador continua vigente. A integração do domínio físico do journal, os gates das conexões de fixtures/Nest, a continuidade de baseline entre suítes e os procedimentos operacionais de recuperação ficam para as etapas seguintes. O encerramento da D1.1 não amplia a autorização para campanhas, publicação Git ou execução da D1.2.

O checkout permanece em chore/integration-test-infrastructure, HEAD de1275143a9d23c9fdbdd1ac171ed1a6acc05bd2, com índice Git real vazio. Esta rodada altera exclusivamente o relatório acumulado e sua evidência qa-evidence/INFRA_01-changes.diff.
