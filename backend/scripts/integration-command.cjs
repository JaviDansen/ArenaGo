'use strict';
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.argv.length !== 3 || process.argv[2] !== '--legacy') {
  console.error('Integração completa indisponível durante a migração. D06/D09 exigem pilot-executor. Para as 41 suítes legadas, use npm run test:integration -- --legacy, em campanha isolada e autorizada.');
  process.exitCode = 2;
} else {
  const excluded = new Set(['admin-close-http.integration.test.ts', 'admin-external-queue-http.integration.test.ts']);
  const files = readdirSync(join(__dirname, '../test/integration')).filter(file => file.endsWith('.integration.test.ts') && !excluded.has(file));
  if (files.length !== 41) throw Error('Inventário legado divergente.');
  console.log('Campanha LEGADA, 41 suítes. D06 e D09 excluídas explicitamente. Execução exclusiva, sem piloto simultâneo.');
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--tsconfig', 'tsconfig.test.json', '--test',
    '--test-concurrency=1', ...files.map(file => join('test/integration', file))], {
    cwd: join(__dirname, '..'), stdio: 'inherit', shell: false,
  });
  process.exitCode = result.error || result.status === null ? 2 : result.status;
}
