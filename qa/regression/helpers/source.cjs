const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../../..');
// Only dependency resolution may point outside the isolated copy.
// Source code is ALWAYS loaded from root, never from this override.
const dependencyRoot = process.env.ARENAGO_REFERENCE_DEPENDENCIES || root;
const appRequire = createRequire(path.join(dependencyRoot, 'app/package.json'));
const backendRequire = createRequire(path.join(dependencyRoot, 'backend/package.json'));

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function evaluate(code, filename, imports = {}, globals = {}) {
  const module = { exports: {} };
  const controlledRequire = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error('Unexpected import in isolated test: ' + name + ' from ' + filename);
  };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: controlledRequire,
    console, Date, URL, AbortController, setTimeout, clearTimeout, ...globals,
  }, { filename });
  return module.exports;
}

function loadJs(relative, imports) {
  const babel = appRequire('@babel/core');
  const filename = path.join(root, relative);
  const { code } = babel.transformSync(read(relative), {
    filename, configFile: false, babelrc: false,
    plugins: [
      [appRequire('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }],
      appRequire('@babel/plugin-transform-modules-commonjs'),
    ],
  });
  return evaluate(code, filename, imports);
}

function loadTs(relative, imports) {
  const ts = backendRequire('typescript');
  const code = ts.transpileModule(read(relative), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
      esModuleInterop: true },
  }).outputText;
  return evaluate(code, path.join(root, relative), imports);
}

// Extract an existing integration-test callback by its AST, without importing
// the integration module, dotenv, NestFactory, Pool or any setup hook.
function integrationCallback(prefix, globals) {
  const relative = 'backend/test/integration/profile-games.integration.test.ts';
  const ts = backendRequire('typescript');
  const contents = read(relative);
  const ast = ts.createSourceFile(relative, contents, ts.ScriptTarget.Latest, true);
  const matches = [];
  const constants = [];
  function visit(node) {
    // Include only this real SQL literal, never module setup or arbitrary code.
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'restoreQuestionnaireActivationSql') {
      if (!node.initializer || !ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
        throw new Error('Expected a literal restoration SQL constant');
      }
      constants.push(node.getText(ast));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'test' &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.startsWith(prefix)) {
      matches.push(node.arguments[1]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (matches.length !== 1) {
    throw new Error('Expected exactly one integration callback for ' + prefix);
  }
  if (constants.length !== 1) throw new Error('Expected exactly one restoration SQL constant');
  const code = ts.transpileModule('const ' + constants[0] + '; module.exports = (' + matches[0].getText(ast) + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return evaluate(code, path.join(root, relative), {}, globals);
}

module.exports = { root, read, appRequire, backendRequire, loadJs, loadTs, integrationCallback };
