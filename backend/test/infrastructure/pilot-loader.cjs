'use strict';
const fs = require('node:fs');
const ts = require('typescript');
let bootstrapReported = false;
// In-memory transpilation avoids compiler subprocesses and generated checkout files.
require.extensions['.ts'] = (module, filename) => {
  try {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
  } catch {
    // Public fixed diagnostic only; nested imports must not leak exception/query/URI through IPC.
    if (!bootstrapReported && process.connected && process.send) {
      bootstrapReported = true;
      process.send({ type: 'diagnostic', stage: 'worker-bootstrap', code: 'unavailable', failure: true }, () => {});
    }
    throw Error('[SEGURANÇA BLOQUEADA] Bootstrap TypeScript inconclusivo.');
  }
};
