import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CURATED_GAMES } from "../../src/games/games.types";
import { DEFAULT_QUESTIONNAIRE_DEFINITION, DEFAULT_QUESTIONNAIRE_VERSION } from "../../src/profile/profile-questionnaire.types";

const identifier = String.raw`(?:"([a-z_][a-z_0-9]*)"|([a-z_][a-z_0-9]*))`;
const qualified = String.raw`(?:(?:public|"public")\.)?` + identifier;
const ddl = new RegExp(
  String.raw`^(CREATE TABLE|CREATE FUNCTION|CREATE (?:UNIQUE )?INDEX|CREATE (?:CONSTRAINT )?TRIGGER|ALTER TABLE)\s+` + qualified,
  "iu",
);
const namedConstraint = new RegExp(String.raw`\bCONSTRAINT\s+` + identifier + String.raw`\s+(PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b`, "giu");

export type CatalogObject = { kind: string; name: string };

export function checkoutSchema(directory = resolve(__dirname, "../../drizzle")) {
  const journal: { dialect?: string; entries?: { idx: number; when: number; tag: string }[] } =
    JSON.parse(readFileSync(join(directory, "meta", "_journal.json"), "utf8"));
  const entries = journal.entries;
  if (journal.dialect !== "postgresql" || !Array.isArray(entries) || !entries.length || entries.some((entry, index) =>
    entry.idx !== index || !Number.isSafeInteger(entry.when) || entry.when <= (entries[index - 1]?.when ?? 0)
    || !/^\d+_[a-z_0-9]+$/u.test(entry.tag))) throw new Error("Journal PostgreSQL inválido.");

  const expectedFiles = new Set(entries.map(entry => entry.tag + ".sql"));
  const files = readdirSync(directory).filter(file => file.endsWith(".sql"));
  if (expectedFiles.size !== entries.length || files.length !== expectedFiles.size || files.some(file => !expectedFiles.has(file))) {
    throw new Error("Arquivos SQL divergem do journal PostgreSQL.");
  }

  const objects: CatalogObject[] = [
    { kind: "table", name: "drizzle.__drizzle_migrations" },
    { kind: "sequence", name: "drizzle.__drizzle_migrations_id_seq" },
    { kind: "index", name: "drizzle.__drizzle_migrations_pkey" },
    { kind: "constraint", name: "drizzle.__drizzle_migrations.__drizzle_migrations_pkey" },
  ];
  const tables: string[] = [];
  const foreignKeys: string[] = [];
  const add = (kind: string, name: string) => objects.push({ kind, name: "public." + name });
  const addConstraint = (table: string, name: string, type: string) => {
    add("constraint", table + "." + name);
    if (type === "FOREIGN KEY") foreignKeys.push("public." + table + "." + name);
    if (type === "PRIMARY KEY" || type === "UNIQUE") add("index", name);
  };

  const migrations = entries.map(entry => {
    const sql = readFileSync(join(directory, entry.tag + ".sql"), "utf8");
    // Inventories the current migration grammar. New DDL shapes require an explicit review.
    const statements = sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/gu, "''")
      .replace(/'(?:''|[^'])*'/gu, "''")
      .replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//gu, "").split(";").map(value => value.trim()).filter(Boolean);
    for (const statement of statements) {
      const matched = ddl.exec(statement);
      if (!matched) throw new Error("DDL sem reconhecimento no checkout.");
      const [, operation, quoted, bare] = matched;
      const name = quoted ?? bare;
      if (operation === "CREATE TABLE" || operation === "ALTER TABLE") {
        if (operation === "CREATE TABLE") {
          tables.push(name);
          add("table", name);
        } else if (!tables.includes(name) || !/^\s+ADD (?:COLUMN|CONSTRAINT)\b/u.test(statement.slice(matched[0].length))) {
          throw new Error("ALTER TABLE sem reconhecimento no checkout.");
        }
        const constraints = [...statement.matchAll(namedConstraint)];
        if (operation === "ALTER TABLE" && !constraints.length && !/^\s+ADD COLUMN\b/u.test(statement.slice(matched[0].length))) {
          throw new Error("Constraint sem reconhecimento no checkout.");
        }
        for (const [, quotedConstraint, bareConstraint, type] of constraints) {
          addConstraint(name, quotedConstraint ?? bareConstraint, type);
        }
        if (operation === "CREATE TABLE" && /\bPRIMARY KEY\b/u.test(statement)
            && !constraints.some(constraint => constraint[3] === "PRIMARY KEY")) addConstraint(name, name + "_pkey", "PRIMARY KEY");
      } else if (operation.endsWith("INDEX")) {
        add("index", name);
      } else if (operation === "CREATE FUNCTION") {
        if (!/^\s*\(\s*\)/u.test(statement.slice(matched[0].length))) throw new Error("Assinatura de função sem reconhecimento.");
        add("function", name + "()");
      } else {
        const parent = new RegExp(String.raw`\sON\s+` + qualified + String.raw`(?=\s)`, "u").exec(statement);
        if (!parent) throw new Error("Trigger sem tabela reconhecida.");
        const trigger = (parent[1] ?? parent[2]) + "." + name;
        add("trigger", trigger);
        // PostgreSQL records user-defined constraint triggers in both catalogs.
        if (operation === "CREATE CONSTRAINT TRIGGER") add("constraint", trigger);
      }
    }
    return { tag: entry.tag, migration: String(entry.when), hash: createHash("sha256").update(sql).digest("hex") };
  });
  if (!tables.length || new Set(objects.map(object => object.kind + ":" + object.name)).size !== objects.length) {
    throw new Error("Catálogo vazio ou duplicado nas migrations.");
  }
  return { objects, tables, foreignKeys, migrations, migrationTags: entries.map(entry => entry.tag) };
}

export function canonicalCatalogMatches(games: unknown, questionnaires: unknown): boolean {
  if (!Array.isArray(games) || !Array.isArray(questionnaires) || games.length !== CURATED_GAMES.length
      || questionnaires.length !== 1) return false;
  const titles = new Set(CURATED_GAMES);
  if (!games.every(row => row?.curated === true && titles.delete(row.name)) || titles.size) return false;
  const questionnaire = questionnaires[0];
  return questionnaire?.version === DEFAULT_QUESTIONNAIRE_VERSION && questionnaire.published === true
    && isSameJson(questionnaire.definition, DEFAULT_QUESTIONNAIRE_DEFINITION);
}

// Ignore object key order from jsonb but preserve array order.
function isSameJson(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
      && expected.every((entry, index) => isSameJson(actual[index], entry));
  }
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return false;
  const fields = Object.entries(expected);
  return fields.length === Object.keys(actual).length && fields.every(([key, value]) =>
    Object.hasOwn(actual, key) && isSameJson((actual as Record<string, unknown>)[key], value));
}
