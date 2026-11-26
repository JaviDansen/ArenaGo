[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ExpectedBinDirectory,
    [Parameter(Mandatory)][string]$ExpectedDataDirectory
)

$ErrorActionPreference = 'Stop'
$serviceName = 'postgresql-x64-18'

function Confirm-LocalPath([string]$Path) {
    $normalizedPath = $Path.Replace('/', '\')
    if ($normalizedPath -notmatch '\A[A-Za-z]:\\[^:]+\z') { throw 'Path' }
    $item = Get-Item -LiteralPath $normalizedPath
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($item.FullName))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'Drive' }
    $ancestor = $item
    while ($null -ne $ancestor) {
        if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse' }
        $ancestor = if ($ancestor -is [IO.FileInfo]) { $ancestor.Directory } else { $ancestor.Parent }
    }
    return $item.FullName
}

function Get-LimitedProcessImage([int]$ProcessId) {
    if ($ProcessId -le 0) { throw 'ProcessId' }
    if (-not ('ArenaGO.ProcessImageQuery' -as [type])) {
        # Reflection.Emit avoids Add-Type/CodeDOM compiler processes and temporary files on PS 5.1.
        $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
            [Reflection.AssemblyName]::new('ArenaGO.ProcessImageQuery'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
        $module = $assembly.DefineDynamicModule('ProcessImageQuery')
        $builder = $module.DefineType('ArenaGO.ProcessImageQuery', [Reflection.TypeAttributes]'Public,Abstract,Sealed')
        $attributes = [Reflection.MethodAttributes]'Public,Static,PinvokeImpl'
        $methods = @(
            @{ Name='OpenProcess'; Return=[IntPtr]; Parameters=[type[]]@([uint32],[int],[uint32]) },
            @{ Name='QueryFullProcessImageNameW'; Return=[int]; Parameters=[type[]]@([IntPtr],[uint32],[Text.StringBuilder],[uint32].MakeByRefType()) },
            @{ Name='CloseHandle'; Return=[int]; Parameters=[type[]]@([IntPtr]) }
        )
        foreach ($method in $methods) {
            $native = $builder.DefinePInvokeMethod($method.Name,'kernel32.dll',$attributes,
                [Reflection.CallingConventions]::Standard,$method.Return,$method.Parameters,
                [Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::Unicode)
            $native.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
        }
        $null = $builder.CreateType()
    }
    # Only PROCESS_QUERY_LIMITED_INFORMATION; never VM_READ, ALL_ACCESS or SeDebugPrivilege.
    $handle = [ArenaGO.ProcessImageQuery]::OpenProcess(0x1000,0,[uint32]$ProcessId)
    if ($handle -eq [IntPtr]::Zero) { throw 'Process image access denied' }
    try {
        $buffer = [Text.StringBuilder]::new(32768)
        [uint32]$size = $buffer.Capacity
        if ([ArenaGO.ProcessImageQuery]::QueryFullProcessImageNameW($handle,0,$buffer,[ref]$size) -eq 0 -or
            $size -eq 0 -or $size -ge $buffer.Capacity) { throw 'Process image inconclusive' }
        return $buffer.ToString()
    } finally {
        if ([ArenaGO.ProcessImageQuery]::CloseHandle($handle) -eq 0) { throw 'Process handle closure inconclusive' }
    }
}

function Get-AttestedProcessImage($Process) {
    if (!$Process -or !$Process.CreationDate -or $Process.ProcessId -le 0) { throw 'Process evidence absent' }
    $image = $Process.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($image)) { $image = Get-LimitedProcessImage ([int]$Process.ProcessId) }
    return Confirm-LocalPath $image
}

$stage = 'caminhos aprovados'
try {
    $bin = Confirm-LocalPath $ExpectedBinDirectory
    $data = Confirm-LocalPath $ExpectedDataDirectory
    $postgres = Confirm-LocalPath (Join-Path $bin 'postgres.exe')

    $stage = 'listener local'
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 55432)
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') { throw 'Listener' }
    $listenerPid = [int]$listeners[0].OwningProcess
    if ($listenerPid -le 0) { throw 'PID' }

    $stage = 'serviço e processos'
    $services = @(Get-CimInstance Win32_Service -Filter "Name='$serviceName'")
    if ($services.Count -ne 1 -or $services[0].State -ne 'Running' -or $services[0].ProcessId -le 0) {
        throw 'Service'
    }
    $serviceInfo = $services[0]
    $servicePid = [int]$serviceInfo.ProcessId
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid"
    $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$servicePid"
    $listenerExe = Get-AttestedProcessImage $listenerProcess
    $serviceExe = Get-AttestedProcessImage $serviceProcess
    if ($listenerExe -ne $postgres) { throw 'Process' }
    if ($listenerPid -ne $servicePid) {
        if ($serviceExe -ne (Confirm-LocalPath (Join-Path $bin 'pg_ctl.exe')) -or
            $listenerProcess.ParentProcessId -ne $servicePid -or
            $listenerProcess.CreationDate -lt $serviceProcess.CreationDate) { throw 'Parent' }
    } elseif ($serviceExe -ne $postgres) { throw 'Executable' }

    # Accept the registered command only if both its executable and its single -D agree.
    $launcher = [regex]::Match($serviceInfo.PathName, '^\s*(?:"([^"]+)"|(\S+))\s+')
    if (!$launcher.Success) { throw 'Command' }
    $registeredExe = if ($launcher.Groups[1].Success) { $launcher.Groups[1].Value } else { $launcher.Groups[2].Value }
    $dataArgs = [regex]::Matches($serviceInfo.PathName.Substring($launcher.Length), '(?:^|\s)-D\s+(?:"([^"]+)"|([^"\s]+))(?=\s|$)')
    if ((Confirm-LocalPath $registeredExe) -ne $serviceExe -or $dataArgs.Count -ne 1) { throw 'Registration' }
    $registeredData = if ($dataArgs[0].Groups[1].Success) { $dataArgs[0].Groups[1].Value } else { $dataArgs[0].Groups[2].Value }
    if ((Confirm-LocalPath $registeredData) -ne $data) { throw 'Data' }

    $stage = 'diretório de dados e versão'
    $postmasterFile = Confirm-LocalPath (Join-Path $data 'postmaster.pid')
    $versionFile = Confirm-LocalPath (Join-Path $data 'PG_VERSION')
    $postmaster = @(Get-Content -LiteralPath $postmasterFile -TotalCount 4)
    $version = (Get-Item -LiteralPath $postgres).VersionInfo.ProductVersion
    if ($postmaster.Count -ne 4 -or $postmaster[0] -ne [string]$listenerPid -or
        (Confirm-LocalPath $postmaster[1]) -ne $data -or $postmaster[2] -notmatch '^\d+$' -or
        $postmaster[3] -ne '55432' -or (Get-Content -LiteralPath $versionFile -Raw).Trim() -ne '18' -or
        $version -notmatch '^18\.6(?:\.0){0,2}$') { throw 'Instance' }
    $processStart = $listenerProcess.CreationDate.ToUniversalTime()
    $postmasterStart = [DateTimeOffset]::FromUnixTimeSeconds([long]$postmaster[2]).UtcDateTime
    # postmaster.pid stores whole seconds, while process creation has subsecond precision.
    if ($postmasterStart.AddSeconds(1) -lt $processStart) { throw 'Stale postmaster' }

    $stage = 'fingerprint da instalação'
    $machineGuid = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
    if ($machineGuid -notmatch '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') { throw 'Machine' }
    $cluster = @($machineGuid.ToUpperInvariant(), $data.ToUpperInvariant())
    $identity = @(($cluster -join '|'), $postgres.ToUpperInvariant(), $serviceExe.ToUpperInvariant(),
        $listenerPid, $servicePid, $processStart.Ticks, $serviceProcess.CreationDate.ToUniversalTime().Ticks,
        $postmaster[2], $version, (Get-FileHash -LiteralPath $postgres -Algorithm SHA256).Hash,
        (Get-FileHash -LiteralPath $serviceExe -Algorithm SHA256).Hash)
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $clusterDigest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($cluster -join '|'))))
        $digest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($identity -join '|'))))
    } finally {
        $hash.Dispose()
    }

    $stage = 'reconferência do listener e do serviço'
    $current = @(Get-NetTCPConnection -State Listen -LocalPort 55432)
    $currentService = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    $currentListenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid"
    $currentServiceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$servicePid"
    if ($current.Count -ne 1 -or $current[0].LocalAddress -ne '127.0.0.1' -or $current[0].OwningProcess -ne $listenerPid -or
        $currentService.State -ne 'Running' -or $currentService.ProcessId -ne $servicePid -or
        $currentService.PathName -cne $serviceInfo.PathName -or
        $currentListenerProcess.CreationDate -ne $listenerProcess.CreationDate -or
        $currentServiceProcess.CreationDate -ne $serviceProcess.CreationDate -or
        $currentListenerProcess.ParentProcessId -ne $listenerProcess.ParentProcessId -or
        (Get-AttestedProcessImage $currentListenerProcess) -ne $listenerExe -or
        (Get-AttestedProcessImage $currentServiceProcess) -ne $serviceExe) { throw 'Changed' }

    [ordered]@{
        address = '127.0.0.1'
        port = 55432
        service = $serviceName
        listenerPid = $listenerPid
        servicePid = $servicePid
        postgresVersionNum = 180006
        clusterSha256 = $clusterDigest.Replace('-', '').ToLowerInvariant()
        instanceSha256 = $digest.Replace('-', '').ToLowerInvariant()
    } | ConvertTo-Json -Compress
} catch {
    $codes = @{ 'caminhos aprovados'='paths'; 'listener local'='listener'; 'serviço e processos'='processes';
        'diretório de dados e versão'='data'; 'fingerprint da instalação'='fingerprint'; 'reconferência do listener e do serviço'='recheck' }
    throw ("[INFRA_OBSERVER:" + $codes[$stage] + "] Atestacao operacional inconclusiva.")
}
