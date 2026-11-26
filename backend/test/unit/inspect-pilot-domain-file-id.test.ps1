$ErrorActionPreference = 'Stop'
$subject = Join-Path $PSScriptRoot '..\infrastructure\inspect-pilot-domain.ps1'
$tokens=$null
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($subject,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Observer syntax invalid' }
foreach ($name in @('ConvertFrom-JournalFileId','Get-JournalNativeFileId')) {
    $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)
    if (!$definition) { throw 'Function absent' }
    . ([scriptblock]::Create($definition.Extent.Text))
}
# Synthetic little-endian bytes for the previously homologated file ID, not an injected observation.
$bytes=[byte[]]@(0xe6,0xac,0x02,0x00,0x00,0x00,0xaf,0x01,0,0,0,0,0,0,0,0)
if ((ConvertFrom-JournalFileId $bytes) -cne '0x000000000000000001af00000002ace6') { throw 'Homologated representation regression' }
if ((ConvertFrom-JournalFileId ([byte[]](0..15))) -cne '0x0f0e0d0c0b0a09080706050403020100') { throw '128-bit byte order regression' }
if ($bytes[0] -ne 0xe6) { throw 'Input mutation' }
foreach ($invalid in @([byte[]]@(),[byte[]]@(1),[byte[]](0..16))) {
    try { $null=ConvertFrom-JournalFileId $invalid; throw 'Invalid length accepted' }
    catch { if ($_.Exception.Message -ne 'FileId layout') { throw } }
}
# OS-only read of this existing checkout directory. Does not inspect service or protected journal.
# Compare two independent methods when executed by Luna/responsible in a normal Windows console.
$native=Get-JournalNativeFileId $PSScriptRoot
$original=& (Join-Path $env:SystemRoot 'System32\fsutil.exe') file queryfileid $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'Independent fsutil comparison unavailable; not an approved regression' }
$match=[regex]::Match(($original -join ''),'0x[0-9a-fA-F]{32}')
if (!$match.Success -or $match.Value.ToLowerInvariant() -cne $native) { throw 'Native/fsutil identity differs' }
try { $null=Get-JournalNativeFileId $subject; throw 'Regular file accepted' }
catch { if ($_.Exception.Message -ne 'Directory redirected or absent') { throw } }
Write-Output 'FileId byte-order, native/fsutil equivalence and directory checks: OK'
