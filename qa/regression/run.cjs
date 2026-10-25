const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// Only test-artifact writes inside this QA directory. No shell, source rewrites,
// database setup, .env imports or network operations.
const out = path.join(__dirname, 'artifacts');
fs.mkdirSync(out, { recursive: true });
const tests = fs.readdirSync(path.join(__dirname, 'tests'))
  .filter(name => name.endsWith('.test.cjs'))
  .sort().map(name => path.join(__dirname, 'tests', name));
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1',
  '--test-reporter=tap', '--test-reporter-destination=stdout',
  '--test-reporter=' + pathToFileURL(path.join(__dirname, 'helpers/json-reporter.cjs')).href,
  '--test-reporter-destination=' + path.join(out, 'results.jsonl'),
  ...tests,
], { cwd: __dirname, env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(out, 'results.tap'), result.stdout || '');
fs.writeFileSync(path.join(out, 'runner-stderr.txt'), result.stderr || '');
const jsonPath = path.join(out, 'results.jsonl');
const events = fs.existsSync(jsonPath)
  ? fs.readFileSync(jsonPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse)
  : [];
const outcomes = events.filter(e => /^test:(pass|fail)$/.test(e.event));
for (const item of outcomes) {
  // A failed assertion still needs human review: it is RED only if the intended
  // behavior was reached and the failure is evidence of the specified defect.
  console.log((item.event === 'test:pass' ? 'PASS ' : 'FAIL ') + item.name);
}
console.log('Artifacts: ' + out);
if (result.error) console.error(result.error);
process.exitCode = result.status === null ? 2 : result.status;
