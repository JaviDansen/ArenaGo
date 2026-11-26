[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Probe','Delegate')][string]$Mode,
    [Parameter(Mandatory)][string]$ExpectedBinDirectory,
    [Parameter(Mandatory)][string]$ExpectedDataDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedFingerprint,
    [string]$OperatorSid,
    [string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
# Administrative preparation only. Never imported or invoked by the pilot worker.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
public sealed class ArenaProcessQueryLease : IDisposable {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
    static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(IntPtr h, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr sd);
    [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(IntPtr h, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    IntPtr handle;
    byte[] originalAcl, grantedAcl;
    bool changed;
    public readonly uint Pid;
    public readonly DateTime CreatedUtc;
    public readonly string Image;
    public readonly byte[] OriginalDescriptor;
    static Exception Error() { return new Win32Exception(Marshal.GetLastWin32Error()); }
    static byte[] Bytes(GenericAcl acl) { var b=new byte[acl.BinaryLength]; acl.GetBinaryForm(b,0); return b; }
    static bool Equal(byte[] a, byte[] b) {
        if(a.Length!=b.Length) return false;
        for(int i=0;i<a.Length;i++) if(a[i]!=b[i]) return false;
        return true;
    }
    public static string Probe(uint pid) {
        IntPtr h=OpenProcess(0x1000,false,pid);
        if(h==IntPtr.Zero) throw Error();
        try { uint size=32768; var b=new StringBuilder((int)size);
            if(!QueryFullProcessImageNameW(h,0,b,ref size)) throw Error();
            if(size==0 || size>=32768) throw new Exception("Image inconclusive");
            return b.ToString();
        } finally { if(!CloseHandle(h)) throw Error(); }
    }
    public ArenaProcessQueryLease(uint pid) {
        Pid=pid;
        // Administrator requests READ_CONTROL | WRITE_DAC | QUERY_LIMITED_INFORMATION only.
        handle=OpenProcess(0x61000,false,pid);
        if(handle==IntPtr.Zero) throw Error();
        try {
            CheckAlive();
            long c,e,k,u;
            if(!GetProcessTimes(handle,out c,out e,out k,out u)) throw Error();
            CreatedUtc=DateTime.FromFileTimeUtc(c);
            uint size=32768; var b=new StringBuilder((int)size);
            if(!QueryFullProcessImageNameW(handle,0,b,ref size)) throw Error();
            if(size==0 || size>=32768) throw new Exception("Image inconclusive");
            Image=b.ToString();
            OriginalDescriptor=ReadDescriptor();
            var sd=new RawSecurityDescriptor(OriginalDescriptor,0);
            if(sd.DiscretionaryAcl==null) throw new Exception("Null DACL refused");
            originalAcl=Bytes(sd.DiscretionaryAcl);
        } catch { Dispose(); throw; }
    }
    void CheckAlive() {
        uint code;
        if(!GetExitCodeProcess(handle,out code)) throw Error();
        if(code!=259) throw new Exception("Process exited; do not reuse PID");
    }
    byte[] ReadDescriptor() {
        IntPtr o,g,d,s,sd;
        uint rc=GetSecurityInfo(handle,6,7,out o,out g,out d,out s,out sd); // SE_KERNEL_OBJECT, OWNER|GROUP|DACL
        if(rc!=0) throw new Win32Exception((int)rc);
        try { var b=new byte[checked((int)GetSecurityDescriptorLength(sd))]; Marshal.Copy(sd,b,0,b.Length); return b; }
        finally { LocalFree(sd); }
    }
    byte[] ReadAcl() { var sd=new RawSecurityDescriptor(ReadDescriptor(),0);
        if(sd.DiscretionaryAcl==null) throw new Exception("Null DACL refused"); return Bytes(sd.DiscretionaryAcl); }
    void WriteAcl(byte[] acl) {
        IntPtr p=Marshal.AllocHGlobal(acl.Length);
        try { Marshal.Copy(acl,0,p,acl.Length);
            uint rc=SetSecurityInfo(handle,6,4,IntPtr.Zero,IntPtr.Zero,p,IntPtr.Zero); // DACL only, no inheritance/protection flags
            if(rc!=0) throw new Win32Exception((int)rc);
        } finally { Marshal.FreeHGlobal(p); }
    }
    public byte[] Grant(string sid) {
        CheckAlive();
        if(!Equal(ReadAcl(),originalAcl)) throw new Exception("DACL changed since snapshot");
        var acl=new RawAcl(originalAcl,0);
        // Append one explicit non-inheritable allow ACE. Preserve all existing ACE bytes/order;
        // refuse noncanonical or inherited ACLs rather than reorder or override DENY.
        bool allowed=false;
        for(int i=0;i<acl.Count;i++) {
            if((acl[i].AceFlags & AceFlags.Inherited)!=0) throw new Exception("Inherited ACL requires separate review");
            var q=acl[i] as QualifiedAce;
            if(q==null) throw new Exception("Unsupported ACE requires separate review");
            if(q.AceQualifier==AceQualifier.AccessAllowed) allowed=true;
            else if(q.AceQualifier!=AceQualifier.AccessDenied || allowed) throw new Exception("Noncanonical ACL requires review");
        }
        acl.InsertAce(acl.Count,new CommonAce(AceFlags.None,AceQualifier.AccessAllowed,0x1000,new SecurityIdentifier(sid),false,null));
        grantedAcl=Bytes(acl);
        WriteAcl(grantedAcl);
        changed=true;
        if(!Equal(ReadAcl(),grantedAcl)) throw new Exception("Written ACL differs; preserve evidence");
        return ReadDescriptor();
    }
    public bool Restore() {
        if(!changed) return false;
        CheckAlive();
        if(!Equal(ReadAcl(),grantedAcl)) throw new Exception("Concurrent ACL change: automatic restore refused");
        WriteAcl(originalAcl);
        if(!Equal(ReadAcl(),originalAcl)) throw new Exception("Restore unconfirmed");
        changed=false;
        return true;
    }
    public void Dispose() { if(handle!=IntPtr.Zero) { var h=handle; handle=IntPtr.Zero; if(!CloseHandle(h)) throw Error(); } }
}
'@
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($Mode -eq 'Probe') {
    if ($elevated) { throw 'Probe must run without elevation' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 55432)
    $service = Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-18'"
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $service.State -ne 'Running') { throw 'Instance inconclusive' }
    foreach ($id in @($service.ProcessId,$listeners[0].OwningProcess) | Select-Object -Unique) {
        try { [ArenaProcessQueryLease]::Probe([uint32]$id) }
        catch {
            $e=$_.Exception
            while ($e.InnerException) { $e=$e.InnerException }
            if ($e -is [ComponentModel.Win32Exception]) { Write-Output ('PID {0}: Win32={1}' -f $id,$e.NativeErrorCode) }
            else { throw }
        }
    }
    return
}
if (!$elevated -or $OperatorSid -notmatch '^S-1-5-21-(\d+-){3}\d+$') { throw 'Administrative session and executor SID required' }
# EvidenceDirectory must be a fresh child of an existing administrator-owned, protected directory.
if (!$EvidenceDirectory -or ![IO.Path]::IsPathRooted($EvidenceDirectory) -or (Test-Path -LiteralPath $EvidenceDirectory)) { throw 'Fresh absolute evidence path required' }
$ancestor = Get-Item -LiteralPath (Split-Path -Parent $EvidenceDirectory) -Force
$evidenceParent = $ancestor.FullName
$trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$systemVolumeRoot = [IO.Path]::GetPathRoot($env:SystemRoot)
while ($null -ne $ancestor) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse' }
    $acl=Get-Acl -LiteralPath $ancestor.FullName
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    # Only the system volume root may use this Windows servicing owner.
    # The evidence parent and all application directories retain the stricter policy.
    $systemAncestor = $ancestor.FullName -ieq $systemVolumeRoot -and $ancestor.FullName -ine $evidenceParent
    if ($owner -notin @('S-1-5-18','S-1-5-32-544') -and !($systemAncestor -and $owner -eq $trustedInstallerSid)) { throw 'Evidence ancestor owner' }
    $mask = if ($ancestor.FullName -eq $evidenceParent) { [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
        else { [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
    foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($ace.AccessControlType -eq 'Allow' -and !($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
            ($ace.FileSystemRights -band $mask) -and
            $ace.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Evidence ancestor writable' }
    }
    $ancestor=$ancestor.Parent
}
$observer = Join-Path $PSScriptRoot 'inspect-postgres-windows.ps1'
function Confirm-DelegationInstance {
    $json = & $observer -ExpectedBinDirectory $ExpectedBinDirectory -ExpectedDataDirectory $ExpectedDataDirectory
    $identity=$json | ConvertFrom-Json
    if ($identity.instanceSha256 -cne $ExpectedFingerprint) { throw 'Fingerprint mismatch' }
    return $identity
}
$identity=Confirm-DelegationInstance
[void](New-Item -ItemType Directory -Path $EvidenceDirectory)
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
}
Set-Acl -LiteralPath $EvidenceDirectory -AclObject $acl
$leases=@()
try {
    foreach ($id in @($identity.servicePid,$identity.listenerPid) | Select-Object -Unique) {
        $lease=[ArenaProcessQueryLease]::new([uint32]$id)
        $leases+= $lease
        $cim=Get-CimInstance Win32_Process -Filter "ProcessId=$id"
        # CIM datetime has microsecond precision; native FILETIME uses 100 ns.
        if (!$cim.CreationDate -or [Math]::Abs($cim.CreationDate.ToUniversalTime().Ticks - $lease.CreatedUtc.Ticks) -gt 9 -or
            $lease.Image -ine $cim.ExecutablePath) { throw 'Held process identity mismatch' }
        [IO.File]::WriteAllBytes((Join-Path $EvidenceDirectory "$id.original.sd"),$lease.OriginalDescriptor)
        [ordered]@{ pid=$id; createdUtc=$lease.CreatedUtc.ToString('o'); image=$lease.Image; operatorSid=$OperatorSid; fingerprint=$ExpectedFingerprint } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "$id.identity.json") -Encoding UTF8
    }
    $null=Confirm-DelegationInstance
    if ((Read-Host 'Explicit permission change authorization: GRANT-0x1000') -cne 'GRANT-0x1000') { throw 'Not authorized' }
    foreach ($lease in $leases) {
        $null=Confirm-DelegationInstance
        $descriptor=$lease.Grant($OperatorSid)
        [IO.File]::WriteAllBytes((Join-Path $EvidenceDirectory "$($lease.Pid).granted.sd"),$descriptor)
    }
    Get-ChildItem -LiteralPath $EvidenceDirectory -File | Get-FileHash -Algorithm SHA256
    Write-Output 'Run Probe and full observer in the unelevated executor console now. Keep this administrative console open.'
    # Default and failures restore through the SAME held process handles.
    $null=Read-Host 'Press Enter ONLY when the authorized operational window is finished: original DACLs will be restored'
} finally {
    $errors=@()
    $restored=@()
    foreach ($lease in $leases) { try { if ($lease.Restore()) { $restored += $lease.Pid } } catch { $errors += $_ } }
    foreach ($lease in $leases) { try { $lease.Dispose() } catch { $errors += $_ } }
    if ($errors.Count) { throw 'Process ACL cleanup inconclusive: preserve evidence, do not run pilot; administrative review required' }
    if ($restored.Count) { Write-Output ('Original DACLs restored and byte-verified; handles closed. PIDs: ' + ($restored -join ', ')) }
    else { Write-Output 'No process DACL changes required restoration; handles closed.' }
}
