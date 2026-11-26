import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { integrationManifest, integrationProfiles, type IntegrationSuite } from "./integration-manifest";

const testExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const integrationName = /\.integration\.test\./u;

// Explicitly covers connection helpers whose filenames are not test suite names.
const connectionHelpers = new Set([
  "backend/test/integration/admin-event-operations-db-guard.ts",
  "backend/test/integration/event-closure-fixture.ts",
  // Campaign entry point owns supervisor connections, but registers no test cases.
  "backend/test/infrastructure/pilot-executor.ts",
]);

function usesPgConstructor(source: ts.SourceFile): boolean {
  const named = new Set(["Pool", "Client"]);
  const namespaces = new Set(["pg"]);
  let importsPg = false;
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "pg") {
      importsPg = true;
      const clause = node.importClause;
      if (clause?.name) namespaces.add(clause.name.text);
      const imports = clause?.namedBindings;
      if (imports && ts.isNamespaceImport(imports)) namespaces.add(imports.name.text);
      if (imports && ts.isNamedImports(imports)) {
        for (const item of imports.elements) {
          if (named.has((item.propertyName ?? item.name).text)) named.add(item.name.text);
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === "require"
        && node.arguments.length === 1 && node.arguments[0].getText(source).slice(1, -1) === "pg") {
      importsPg = true;
      if (ts.isVariableDeclaration(node.parent)) {
        const binding = node.parent.name;
        if (ts.isIdentifier(binding)) namespaces.add(binding.text);
        if (ts.isObjectBindingPattern(binding)) {
          for (const item of binding.elements) {
            if (ts.isIdentifier(item.name) && named.has((item.propertyName ?? item.name).getText(source))) {
              named.add(item.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!importsPg) return false;

  function constructsPool(node: ts.Node): boolean {
    if (ts.isNewExpression(node)) {
      const ctor = node.expression;
      if (ts.isIdentifier(ctor) && named.has(ctor.text)) return true;
      if (ts.isPropertyAccessExpression(ctor) && named.has(ctor.name.text)
          && namespaces.has(ctor.expression.getText(source))) return true;
    }
    return ts.forEachChild(node, child => constructsPool(child) ? true : undefined) === true;
  }
  return constructsPool(source);
}

export function discoverIntegrationFiles(root = resolve(__dirname, "../../..")): string[] {
  const found = new Set<string>();
  function walk(directory: string, allTests: boolean): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      const path = relative(root, file).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(file, allTests || path === "backend/test/integration");
      } else if (entry.isFile() && testExtension.test(entry.name)) {
        if (integrationName.test(entry.name) || (allTests && /\.test\./u.test(entry.name))
            || usesPgConstructor(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true))) {
          if (!connectionHelpers.has(path)) found.add(path);
        }
      }
    }
  }
  walk(join(root, "backend", "test"), false);
  return [...found].sort();
}

export function validateIntegrationManifest(
  suites: readonly IntegrationSuite[] = integrationManifest,
  files: readonly string[] = discoverIntegrationFiles(),
): string[] {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const discovered = new Set(files);
  const issues: string[] = [];

  for (const suite of suites) {
    if (!/^[a-z][a-z0-9-]*$/u.test(suite.id) || ids.has(suite.id)) issues.push("Identificador inválido ou duplicado: " + suite.id);
    if (paths.has(suite.file)) issues.push("Arquivo duplicado: " + suite.file);
    if (!discovered.has(suite.file)) issues.push("Arquivo indisponível ou fora do inventário: " + suite.file);
    ids.add(suite.id);
    paths.add(suite.file);
    if (!Object.hasOwn(integrationProfiles, suite.profile)) {
      issues.push("Perfil inválido: " + suite.id);
      continue;
    }
    const profile = integrationProfiles[suite.profile];
    if (!Number.isSafeInteger(suite.cases) || suite.cases <= 0
        || !["A", "B", "C", "D"].includes(suite.group)
        || suite.schema.baseline !== "checkout-migrations"
        || suite.schema.specificMigration !== (suite.preconditions.protectedHistory ? "0008_external_entry_calls"
          : suite.id === "staff-idempotency-schema-preparation" ? "0007_staff_idempotency_preparation" : null)
        || !suite.scope || !suite.legacyGuard || !suite.legacyTarget || !suite.fixtures || !suite.cleanup || !suite.baselineEffect
        || suite.specializedIsolation !== !profile.enabled || suite.specializedIsolation !== (suite.group === "D")
        || suite.scheduler !== profile.scheduler || suite.ddl !== (suite.profile === "isolated-ddl")
        || suite.seed !== (suite.profile === "isolated-seed")
        || suite.preconditions.protectedHistory !== (suite.profile === "isolated-history")
        || suite.preconditions.canonicalCatalog !== (profile.baseline === "canonical")
        || !suite.preconditions.noOperationalRows || !suite.preconditions.noUnexpectedDdl
        || suite.migration !== (suite.group === "A" ? "legacy-compatible" : "legacy-pending")) {
      issues.push("Requisitos inconsistentes: " + suite.id);
    }
  }

  for (const file of discovered) {
    if (!paths.has(file)) issues.push("Integração sem classificação: " + file);
  }
  return issues;
}

export function selectIntegrationSuite(id: string): IntegrationSuite {
  const suite = integrationManifest.find(item => item.id === id);
  if (!suite) throw new Error("[SEGURANÇA BLOQUEADA] Suíte de integração desconhecida.");
  if (validateIntegrationManifest([suite], [suite.file]).length) {
    throw new Error("[SEGURANÇA BLOQUEADA] Requisitos inconsistentes para a suíte selecionada.");
  }
  if (!integrationProfiles[suite.profile].enabled) {
    throw new Error("[SEGURANÇA BLOQUEADA] Perfil especializado indisponível nesta etapa.");
  }
  return suite;
}
