[CmdletBinding()]
param([Parameter(Mandatory)][string]$Directory, [Parameter(Mandatory)][string]$Authority)
$ErrorActionPreference = 'Stop'
function ConvertFrom-JournalFileId([byte[]]$Bytes) {
    if ($null -eq $Bytes -or $Bytes.Length -ne 16 -or ![BitConverter]::IsLittleEndian) { throw 'FileId layout' }
    # fsutil displays the 128-bit integer most-significant byte first, not a GUID.
    $copy = [byte[]]$Bytes.Clone()
    [Array]::Reverse($copy)
    return '0x' + [BitConverter]::ToString($copy).Replace('-','').ToLowerInvariant()
}
function Get-JournalNativeFileId([string]$Path) {
    if (-not ('ArenaGO.JournalFileQuery' -as [type])) {
        $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
            [Reflection.AssemblyName]::new('ArenaGO.JournalFileQuery'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
        $module = $assembly.DefineDynamicModule('JournalFileQuery')
        $builder = $module.DefineType('ArenaGO.JournalFileQuery',[Reflection.TypeAttributes]'Public,Abstract,Sealed')
        $methods = @(
            @{ Name='CreateFileW'; Return=[IntPtr]; Parameters=[type[]]@([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr]) },
            @{ Name='GetFileInformationByHandleEx'; Return=[int]; Parameters=[type[]]@([IntPtr],[int],[IntPtr],[uint32]) },
            @{ Name='CloseHandle'; Return=[int]; Parameters=[type[]]@([IntPtr]) }
        )
        foreach ($method in $methods) {
            $native = $builder.DefinePInvokeMethod($method.Name,'kernel32.dll',[Reflection.MethodAttributes]'Public,Static,PinvokeImpl',
                [Reflection.CallingConventions]::Standard,$method.Return,$method.Parameters,
                [Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::Unicode)
            $native.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
        }
        $null = $builder.CreateType()
    }
    # FILE_READ_ATTRIBUTES only; share read/write/delete; OPEN_EXISTING;
    # BACKUP_SEMANTICS opens a directory, OPEN_REPARSE_POINT prevents following its final entry.
    $handle = [ArenaGO.JournalFileQuery]::CreateFileW($Path,0x80,7,[IntPtr]::Zero,3,0x02200000,[IntPtr]::Zero)
    if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr]::new(-1)) { throw 'Directory handle inconclusive' }
    $buffer = [IntPtr]::Zero
    try {
        $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal(24)
        # FileAttributeTagInfo=9: verify directory and reject reparse on the opened object itself.
        if ([ArenaGO.JournalFileQuery]::GetFileInformationByHandleEx($handle,9,$buffer,8) -eq 0) { throw 'Directory attributes inconclusive' }
        $attributes = [Runtime.InteropServices.Marshal]::ReadInt32($buffer)
        if (!($attributes -band 0x10) -or ($attributes -band 0x400)) { throw 'Directory redirected or absent' }
        # FileIdInfo=18: ULONGLONG VolumeSerialNumber followed by 16 opaque FILE_ID_128 bytes.
        if ([ArenaGO.JournalFileQuery]::GetFileInformationByHandleEx($handle,18,$buffer,24) -eq 0) { throw 'Native FileId inconclusive' }
        $bytes = New-Object byte[] 16
        [Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($buffer,8),$bytes,0,16)
        return ConvertFrom-JournalFileId $bytes
    } finally {
        if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
        if ([ArenaGO.JournalFileQuery]::CloseHandle($handle) -eq 0) { throw 'Directory handle closure inconclusive' }
    }
}
$script:domainStage = 'identity'
$script:domainArea = 'journal'
try {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $script:domainStage = 'elevation'
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevated' }
    $expected = Join-Path $env:ProgramData 'ArenaGO\integration\127.0.0.1-55432-arenago_events_test'
    $trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
    $systemVolumeRoot = [IO.Path]::GetPathRoot($env:SystemRoot)
    $script:domainStage = 'arguments'
    if ($Directory -cne $expected -or $Authority -cne (Join-Path $env:ProgramData 'ArenaGO\integration-authority')) { throw 'Path' }
    function Inspect-Path([string]$Path, [bool]$Writable) {
        $script:domainStage = 'path'
        $item = Get-Item -LiteralPath $Path -Force
        $script:domainStage = 'volume'
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($item.FullName))
        if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Volume' }
        $current = $item
        while ($null -ne $current) {
            $script:domainStage = 'reparse'
            if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse' }
            $script:domainStage = 'acl-read'
            $acl = Get-Acl -LiteralPath $current.FullName
            $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
            # TrustedInstaller is admitted only on the system volume root as an ancestor,
            # never on the authority, journal, records or their application parents.
            $systemAncestor = $current.FullName -ieq $systemVolumeRoot -and $current.FullName -ine $item.FullName
            $script:domainStage = 'owner'
            if ($owner -notin @('S-1-5-18','S-1-5-32-544') -and !($Writable -and $owner -eq $sid.Value) -and
                !($systemAncestor -and $owner -eq $trustedInstallerSid)) { throw 'Owner' }
            $mask = if ($current.FullName -eq $item.FullName) {
                [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
            } else { [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
            $script:domainStage = 'rights'
            foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
                if ($ace.AccessControlType -eq 'Allow' -and !($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
                    ($ace.FileSystemRights -band $mask) -and
                    $ace.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -and
                    !($Writable -and $ace.IdentityReference.Value -eq $sid.Value)) { throw 'Acl' }
            }
            $current = if ($current -is [IO.FileInfo]) { $current.Directory } else { $current.Parent }
        }
        $script:domainStage = 'inheritance'
        if ($Path -in @($Directory,$Authority) -and !(Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw 'Inheritance' }
    }
    $script:domainArea = 'authority'
    Inspect-Path $Authority $false
    foreach ($name in @('reference-v2.json','reference-v2.approval.json','pilot-domain.json')) {
        $script:domainArea = @{ 'reference-v2.json'='reference'; 'reference-v2.approval.json'='approval'; 'pilot-domain.json'='domain-record' }[$name]
        Inspect-Path (Join-Path $Authority $name) $false
    }
    $script:domainArea = 'journal'
    Inspect-Path $Directory $true
    function Inspect-Children([string]$Parent) {
        $script:domainStage = 'children'
        foreach ($entry in Get-ChildItem -LiteralPath $Parent -Force) {
            $script:domainArea = 'child'
            Inspect-Path $entry.FullName $true
            if ($entry -is [IO.DirectoryInfo]) { Inspect-Children $entry.FullName }
        }
    }
    Inspect-Children $Directory
    $script:domainArea = 'journal'
    $script:domainStage = 'file-id'
    $fileId = Get-JournalNativeFileId $Directory
    $script:domainStage = 'cim'
    $volume = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + [IO.Path]::GetPathRoot($Directory).TrimEnd('\') + "'")
    if (!$volume.VolumeSerialNumber) { throw 'VolumeId' }
    $script:domainStage = 'approval-read'
    $approvalJson = Get-Content -Raw -LiteralPath (Join-Path $Authority 'pilot-domain.json')
    $script:domainStage = 'approval-json'
    $approved = $approvalJson | ConvertFrom-Json
    # Preserve the homologated CIM volume serial representation; the API's 64-bit
    # volume serial must not silently replace this existing 32-bit prefix.
    $physical = $volume.VolumeSerialNumber + ':' + $fileId
    $script:domainStage = 'approval-path'
    if ($approved.path -cne $Directory) { throw 'Approval' }
    $script:domainStage = 'approval-id'
    if ($approved.directoryId -cne $physical) { throw 'Approval' }
    $script:domainStage = 'approval-sid'
    if ($approved.operatorSid -cne $sid.Value) { throw 'Approval' }
    $script:domainStage = 'serialization'
    [ordered]@{ path=$Directory; directoryId=$physical; operatorSid=$sid.Value } | ConvertTo-Json -Compress
} catch { throw ('[INFRA_OBSERVER:domain] [INFRA_DOMAIN:' + $script:domainStage + ':' + $script:domainArea + '] Dominio Windows inconclusivo.') }
