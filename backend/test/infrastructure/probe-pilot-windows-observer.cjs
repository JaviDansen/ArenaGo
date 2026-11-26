'use strict';
// Operational OS-only probe, never loaded by the runner. Invoke with pilot-loader.cjs.
const { execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

function errorMetadata(error, spawned, stderr) {
  const integer = v => Number.isInteger(v) && v >= -2147483648 && v <= 4294967295 ? v : null;
  const names = new Set(['Error','TypeError','RangeError','SyntaxError','SystemError']);
  const codes = new Set(['ENOENT','EACCES','EPERM','EINVAL','UNKNOWN','ERR_INVALID_ARG_VALUE','ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
  const status = integer(error && error.code);
  return {
    spawned,
    errorType: error && names.has(error.name) ? error.name : error ? 'other' : null,
    codeType: error ? typeof error.code : null,
    code: status !== null ? status : error && codes.has(error.code) ? error.code : null,
    statusHex: status !== null ? '0x' + (status >>> 0).toString(16).padStart(8, '0') : null,
    errno: integer(error && error.errno),
    killed: !!(error && error.killed),
    signal: error && ['SIGTERM','SIGKILL','SIGINT','SIGABRT'].includes(error.signal) ? error.signal : null,
    // Only known fixed tokens, never raw text, command, paths, stack or arbitrary error properties.
    scriptStage: /\[INFRA_OBSERVER:(paths|listener|processes|data|fingerprint|recheck)\]/u.exec(stderr || '')?.[1] || null,
    domainStage: /\[INFRA_DOMAIN:(identity|elevation|arguments|path|volume|reparse|acl-read|owner|rights|inheritance|children|fsutil|file-id|cim|approval-read|approval-json|approval-path|approval-id|approval-sid|serialization):(authority|reference|approval|domain-record|journal|child)\]/u.exec(stderr || '')?.slice(1) || null,
    checkStage: /check-stage=(entry|observer-environment|windows-observer|windows-json|windows-fingerprint|journal-observer|journal-json|journal-continuity|reference-authority);/u.exec(stderr || '')?.[1] || null,
    checkDomainStage: /domain-stage=(identity|elevation|arguments|path|volume|reparse|acl-read|owner|rights|inheritance|children|fsutil|file-id|cim|approval-read|approval-json|approval-path|approval-id|approval-sid|serialization); area=(authority|reference|approval|domain-record|journal|child)\./u.exec(stderr || '')?.slice(1) || null,
    securityException: /PSSecurityException|UnauthorizedAccess/u.test(stderr || ''),
    parserError: /ParserError/u.test(stderr || ''),
    commandMissing: /CommandNotFoundException/u.test(stderr || ''),
  };
}
function execute(file, args, options) {
  return new Promise(resolveResult => {
    let spawned = false;
    try {
      const child = execFile(file, args, options, (error, stdout, stderr) =>
        resolveResult({ error, stdout, metadata: errorMetadata(error, spawned, stderr) }));
      child.once('spawn', () => { spawned = true; });
    } catch (error) { resolveResult({ error, stdout: '', metadata: errorMetadata(error, false, '') }); }
  });
}
async function main() {
  const [bin, data, fingerprint, ...extra] = process.argv.slice(2);
  const compareWindows = extra.length === 1 && extra[0] === '--compare-windows';
  if (process.platform !== 'win32' || process.env.NODE_ENV !== 'test' || !bin || !data || (extra.length && !compareWindows) || !/^[a-f0-9]{64}$/u.test(fingerprint || '')) {
    throw Error('probe-entry');
  }
  if (resolve(process.cwd()) !== resolve(__dirname, '../..')) throw Error('probe-cwd');
  // Bootstrap is observable without printing a loader exception or stack.
  let factory;
  try { factory = require('./pilot-executor.ts').pilotWindowsObserverInvocation; }
  catch { throw Error('probe-bootstrap-or-environment'); }
  const configurations = compareWindows ? [
    ['previous-restricted', []], ['installation', ['installation']], ['profile', ['profile']],
    ['temporary', ['temporary']], ['identity', ['identity']],
    ['installation-profile', ['installation','profile']],
    ['full-windows', ['installation','profile','temporary','identity']],
  ] : [['full-windows', ['installation','profile','temporary','identity']]];
  const functional = [];
  for (const [configuration, groups] of configurations) {
  const invocation = factory(bin, data, groups);
  console.log(JSON.stringify({ phase: 'invocation', configuration, executableExists: existsSync(invocation.file),
    observerExists: existsSync(invocation.args[3]), absoluteExecutable: require('node:path').isAbsolute(invocation.file),
    cwdIsBackend: true, shell: false, noProfile: true, nonInteractive: true,
    tempEmpty: invocation.options.env.TEMP === '', profileEmpty: invocation.options.env.USERPROFILE === '' }));
  const exact = await execute(invocation.file, invocation.args, invocation.options);
  let jsonValid = false, fingerprintMatches = false;
  if (!exact.error) {
    try { const identity = JSON.parse(exact.stdout); jsonValid = !!identity && typeof identity === 'object';
      fingerprintMatches = jsonValid && identity.instanceSha256 === fingerprint;
    } catch { /* Report parsing failure independently from script exit. */ }
  }
  console.log(JSON.stringify({ phase: 'exact-observer', configuration, ...exact.metadata, jsonValid, fingerprintMatches }));
  // A separate -Command probe distinguishes engine initialization/policy/modules/interop.
  // Uses the SAME exe/options/env/cwd. No execution-policy override or inherited secrets.
  const command = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Write-Output 'PROBE:engine'
try {
  $known=@('Undefined','Restricted','AllSigned','RemoteSigned','Unrestricted','Bypass','Default')
  $effective=[string](Get-ExecutionPolicy)
  $language=[string]$ExecutionContext.SessionState.LanguageMode
  $policies=@(Get-ExecutionPolicy -List | ForEach-Object {
    if ([string]$_.ExecutionPolicy -notin $known) { throw 'Policy' }
    [ordered]@{scope=[string]$_.Scope;policy=[string]$_.ExecutionPolicy}
  })
  if ($effective -notin $known -or $language -notin @('FullLanguage','ConstrainedLanguage','RestrictedLanguage','NoLanguage')) { throw 'Policy' }
  [ordered]@{effective=$effective;language=$language;policies=$policies} | ConvertTo-Json -Compress -Depth 4
  Import-Module CimCmdlets -ErrorAction Stop
  Import-Module NetTCPIP -ErrorAction Stop
  Write-Output 'PROBE:modules'
  # Load ONLY image/path functions via the AST, never the service/listener body.
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors)
  if ($errors.Count) { throw 'Syntax' }
  foreach ($name in @('Confirm-LocalPath','Get-LimitedProcessImage')) {
    $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)
    if (!$definition) { throw 'Function' }
    . ([scriptblock]::Create($definition.Extent.Text))
  }
  $null=Get-LimitedProcessImage $PID
  Write-Output 'PROBE:interop'
} catch { Write-Output 'PROBE:component-failed'; exit 3 }
`;
  // -Command arguments are parsed as PowerShell source; encode only this PUBLIC probe code,
  // including an escaped public script path. No password or credential is ever encoded.
  const scriptPath = invocation.args[3].replace(/'/g, "''");
  const fixedCommand = command.replace('$args[0]', "'" + scriptPath + "'");
  const boot = await execute(invocation.file, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(fixedCommand, 'utf16le').toString('base64')], invocation.options);
  const milestones = ['engine','modules','interop','component-failed'].filter(x => boot.stdout.includes('PROBE:' + x));
  let policy = null;
  for (const line of boot.stdout.split(/\r?\n/u)) {
    try {
      const value = JSON.parse(line);
      const allowed = ['Undefined','Restricted','AllSigned','RemoteSigned','Unrestricted','Bypass','Default'];
      const scopes = ['MachinePolicy','UserPolicy','Process','CurrentUser','LocalMachine'];
      if (allowed.includes(value.effective) && ['FullLanguage','ConstrainedLanguage','RestrictedLanguage','NoLanguage'].includes(value.language)
          && Array.isArray(value.policies) && value.policies.length === 5
          && value.policies.every(x => scopes.includes(x.scope) && allowed.includes(x.policy))) policy = value;
    } catch { /* Never print unvalidated stdout. */ }
  }
  console.log(JSON.stringify({ phase: 'engine-components', configuration, ...boot.metadata, milestones, policy }));
  if (!exact.error && jsonValid && fingerprintMatches && !boot.error && milestones.includes('interop')) functional.push(configuration);
  }
  console.log(JSON.stringify({ phase: 'comparison', functional, firstFunctional: functional[0] || null,
    productionConfiguration: 'full-windows', productionPassed: functional.includes('full-windows') }));
  if (!functional.includes('full-windows')) { process.exitCode = 2; return; }
  const journalCall = require('./pilot-executor.ts').pilotJournalObserverInvocation();
  const journal = await execute(journalCall.file, journalCall.args, journalCall.options);
  let domainValid = false;
  if (!journal.error) {
    try {
      const value = JSON.parse(journal.stdout);
      domainValid = value.path === journalCall.args[5] && /^[a-f0-9]+:0x[a-f0-9]{16,32}$/iu.test(value.directoryId)
        && /^S-1-5-21-(\d+-){3}\d+$/u.test(value.operatorSid);
    } catch { /* Sanitized failure only. */ }
  }
  console.log(JSON.stringify({ phase: 'journal-observer', ...journal.metadata, domainValid }));
  if (journal.error || !domainValid) { process.exitCode = 2; return; }
  // Independent compatibility evidence only: production no longer depends on this utility.
  const fsutil = resolve(journalCall.options.env.SystemRoot, 'System32/fsutil.exe');
  const old = await execute(fsutil, ['file', 'queryfileid', journalCall.args[5]], journalCall.options);
  const oldId = /0x[0-9a-fA-F]{32}/u.exec(old.stdout)?.[0].toLowerCase();
  const nativeId = JSON.parse(journal.stdout).directoryId.split(':')[1];
  console.log(JSON.stringify({ phase: 'fsutil-compatibility', executableExists: existsSync(fsutil),
    ...old.metadata, parsed: !!oldId, matchesNative: !!oldId && oldId === nativeId }));
  if (!old.error && oldId && oldId !== nativeId) { process.exitCode = 2; return; }
  // Run ONLY check, in an explicitly filtered environment; it returns before credential/SQL/journal claim.
  const checked = await execute(process.execPath, ['--require', resolve(__dirname, 'pilot-loader.cjs'),
    resolve(__dirname, 'pilot-executor.ts'), 'check', bin, data, fingerprint], {
    ...journalCall.options, env: { ...journalCall.options.env, NODE_ENV: 'test' }, timeout: 120_000,
  });
  console.log(JSON.stringify({ phase: 'complete-check', ...checked.metadata, passed: !checked.error }));
  process.exitCode = checked.error ? 2 : 0;
}
if (require.main === module) void main().catch(error => {
  const reason = ['probe-entry','probe-cwd','probe-bootstrap-or-environment'].includes(error.message) ? error.message : 'probe-inconclusive';
  console.error('[SEGURANÇA BLOQUEADA] ' + reason);
  process.exitCode = 2;
});
module.exports = { errorMetadata };
