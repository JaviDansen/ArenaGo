$ErrorActionPreference = 'Stop'
$subject = Join-Path $PSScriptRoot '..\infrastructure\inspect-postgres-windows.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($subject, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'O script de atestação contém erros de sintaxe.' }
$definition = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Confirm-LocalPath'
}, $false)
if (-not $definition) { throw 'Confirm-LocalPath ausente.' }
# Load only the function so the regression never inspects a running service.
. ([scriptblock]::Create($definition.Extent.Text))

$expected = (Get-Item -LiteralPath $PSScriptRoot).FullName
$forward = $expected.Replace('\', '/')
$mixed = $expected.Substring(0, 3).Replace('\', '/') + $expected.Substring(3)
foreach ($valid in @($expected, $forward, $mixed)) {
    if ((Confirm-LocalPath $valid) -cne $expected) { throw 'Diretório resolvido divergente.' }
}

$invalidPaths = @(
    'data/postgres'
    'C:data/postgres'
    '/data/postgres'
    '//server/share/data'
    '//?/C:/data'
    '//./C:/data'
    'FileSystem::C:/data'
    'C:/data:ads'
)
foreach ($invalid in $invalidPaths) {
    try {
        $null = Confirm-LocalPath $invalid
    } catch {
        if ($_.Exception.Message -eq 'Path') { continue }
        throw
    }
    throw "Caminho indevido aceito: $invalid"
}
Write-Output 'Normalizacao e rejeicao de caminhos: OK'
