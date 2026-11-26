$ErrorActionPreference = 'Stop'
$subject = Join-Path $PSScriptRoot '..\infrastructure\inspect-postgres-windows.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($subject,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Observer syntax invalid' }
foreach ($name in @('Confirm-LocalPath','Get-LimitedProcessImage','Get-AttestedProcessImage')) {
    $definition = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name },$false)
    if (!$definition) { throw ('Missing function: ' + $name) }
    . ([scriptblock]::Create($definition.Extent.Text))
}
# Query this PowerShell only; no service observation, database or privilege adjustment.
$process = [Diagnostics.Process]::GetCurrentProcess()
$expected = Confirm-LocalPath $process.MainModule.FileName
$savedTemp = $env:TEMP
$savedProfile = $env:USERPROFILE
try {
    $env:TEMP = ''
    $env:USERPROFILE = ''
    if ((Confirm-LocalPath (Get-LimitedProcessImage $process.Id)) -ne $expected) { throw 'Native image mismatch' }
} finally {
    $env:TEMP = $savedTemp
    $env:USERPROFILE = $savedProfile
    $process.Dispose()
}
$script:fallbackCalls = 0
function Get-LimitedProcessImage([int]$ProcessId) {
    $script:fallbackCalls++
    if ($ProcessId -ne 123) { throw 'Unexpected process' }
    return $expected
}
$fixture = [pscustomobject]@{ ProcessId=123; CreationDate=[datetime]::UtcNow; ExecutablePath=$expected }
if ((Get-AttestedProcessImage $fixture) -ne $expected -or $script:fallbackCalls -ne 0) { throw 'CIM path regression' }
$fixture.ExecutablePath = $null
if ((Get-AttestedProcessImage $fixture) -ne $expected -or $script:fallbackCalls -ne 1) { throw 'Fallback absent' }
$fixture.CreationDate = $null
try { $null = Get-AttestedProcessImage $fixture; throw 'Accepted absent creation time' }
catch { if ($_.Exception.Message -ne 'Process evidence absent') { throw } }
$fixture.CreationDate = [datetime]::UtcNow
function Get-LimitedProcessImage([int]$ProcessId) { throw 'Native failure fixture' }
try { $null = Get-AttestedProcessImage $fixture; throw 'Accepted native failure' }
catch { if ($_.Exception.Message -ne 'Native failure fixture') { throw } }
Write-Output 'Restricted process image, empty environment, CIM/fallback and fail-closed regressions: OK'
