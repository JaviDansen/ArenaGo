import { createHash } from "node:crypto";
import { integrationBlocked } from "./integration-environment";

export const structuralSchemas = ["drizzle", "public"] as const;
const schemaSet = new Set<string>(structuralSchemas);
const supportedMajorVersion = 18;
const structuralFormatVersion = 2;

type ScalarFieldType = "text" | "nullableText" | "boolean" | "integer" | "nullableTextArray";
type FieldType = ScalarFieldType | "foreignKeyTriggers";

const foreignKeyTriggerFields = {
  tableSchema: "text", tableName: "text", relatedSchema: "nullableText", relatedName: "nullableText",
  functionSchema: "text", functionName: "text", functionSignature: "text",
  eventsAndTiming: "integer", enabled: "text", deferrable: "boolean", initiallyDeferred: "boolean",
} as const satisfies Record<string, ScalarFieldType>;

type ScalarFieldValue = string | boolean | number | null | readonly string[];
type ForeignKeyTrigger = Readonly<Record<keyof typeof foreignKeyTriggerFields, ScalarFieldValue>>;

const fields = {
  table: {
    relationKind: "text", persistence: "text", rowSecurity: "boolean", forceRowSecurity: "boolean",
  },
  column: {
    position: "integer", type: "text", notNull: "boolean", expression: "nullableText",
    identity: "text", generated: "text", collation: "nullableText",
  },
  constraint: {
    constraintType: "text", definition: "text", validated: "boolean", enforced: "boolean",
    deferrable: "boolean", initiallyDeferred: "boolean", foreignKeyTriggers: "foreignKeyTriggers",
  },
  index: {
    definition: "text", unique: "boolean", valid: "boolean", ready: "boolean", live: "boolean",
    predicate: "nullableText",
  },
  function: {
    definition: "text", language: "text", volatility: "text", securityDefiner: "boolean",
    leakproof: "boolean", strict: "boolean", parallel: "text", configuration: "nullableTextArray",
  },
  trigger: {
    definition: "text", enabled: "text", function: "text", eventsAndTiming: "integer",
    deferrable: "boolean", initiallyDeferred: "boolean",
  },
  sequence: {
    type: "text", start: "text", min: "text", max: "text", increment: "text", cache: "text",
    cycle: "boolean", ownedBy: "nullableText",
  },
} as const satisfies Record<string, Record<string, FieldType>>;

type Kind = keyof typeof fields;
type FieldValue = ScalarFieldValue | readonly ForeignKeyTrigger[];

export type StructuralObject = {
  kind: Kind;
  schema: string;
  name: string;
  relation: string | null;
  signature: string | null;
  properties: Readonly<Record<string, FieldValue>>;
};

type MigrationIdentity = { tag: string; migration: string; hash: string };

// JSON-serializable input. A trusted reference must be supplied by the caller.
export type StructuralReference = {
  formatVersion: typeof structuralFormatVersion;
  postgresVersionNum: number;
  schemas: readonly string[];
  migrations: readonly MigrationIdentity[];
  objects: readonly StructuralObject[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalarField(value: unknown, type: ScalarFieldType): value is ScalarFieldValue {
  switch (type) {
    case "text": return typeof value === "string";
    case "nullableText": return value === null || typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "integer": return Number.isSafeInteger(value);
    case "nullableTextArray": return value === null || (Array.isArray(value) && value.every(item => typeof item === "string"));
  }
}

function normalizeForeignKeyTriggers(value: unknown, object: StructuralObject, isForeignKey: boolean) {
  if (!isForeignKey && value === null) return null;
  const invalid = () => integrationBlocked("Projeção de triggers de chave estrangeira inválida em " + objectLabel(object) + ".");
  if (!isForeignKey || !Array.isArray(value)) throw invalid();
  const fields = Object.entries(foreignKeyTriggerFields);
  const entries = value.map((trigger: unknown) => {
    if (!isRecord(trigger) || Object.keys(trigger).length !== fields.length) throw invalid();
    const canonical = Object.fromEntries(fields.map(([key, type]) => {
      const field = trigger[key];
      if (!Object.hasOwn(trigger, key) || !isScalarField(field, type)) throw invalid();
      return [key, field];
    })) as ForeignKeyTrigger;
    return { key: JSON.stringify(canonical), trigger: canonical };
  });
  // Order is immaterial. Repeated entries are retained so multiplicity can be compared.
  entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return entries.map(entry => entry.trigger);
}

function objectKey(object: StructuralObject): string {
  const { kind, schema, relation, name, signature } = object;
  return JSON.stringify([kind, schema, relation, name, signature]);
}

function safeIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z_0-9]{0,62}$/u.test(name)
    ? name
    : "#" + createHash("sha256").update(name).digest("hex").slice(0, 12);
}

function objectLabel({ kind, schema, relation, name, signature }: StructuralObject): string {
  const identifier = [schema, ...(relation === null ? [] : [relation]), name].map(safeIdentifier).join(".");
  // Keep overloads distinguishable without interpolating deparsed definitions or signature text.
  const overload = signature === null ? "" : signature === "" ? "()" : "(#" +
    createHash("sha256").update(signature).digest("hex").slice(0, 12) + ")";
  return kind + " " + identifier + overload;
}

type Snapshot = { objects: ReadonlyMap<string, StructuralObject>; sha256: string };

export function structuralSnapshot(rows: unknown): Snapshot {
  if (!Array.isArray(rows)) throw integrationBlocked("Lista de objetos estruturais inválida.");

  const objects = new Map<string, StructuralObject>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.kind !== "string" || !Object.hasOwn(fields, row.kind)
        || typeof row.schema !== "string" || !schemaSet.has(row.schema)
        || typeof row.name !== "string" || !row.name.length) {
      throw integrationBlocked("Identidade de objeto estrutural inválida.");
    }
    const { schema, name, relation, signature } = row;
    const kind = row.kind as Kind;
    const needsRelation = kind === "column" || kind === "constraint" || kind === "trigger";
    if (!(needsRelation ? typeof relation === "string" && relation.length : relation === null)
        || !(kind === "function" ? typeof signature === "string" : signature === null)) {
      throw integrationBlocked("Identidade de objeto estrutural incompleta.");
    }

    const properties: Record<string, FieldValue> = {};
    const object: StructuralObject = {
      kind, schema, name, relation: relation as string | null, signature: signature as string | null, properties,
    };
    const source = row.properties;
    if (!isRecord(source) || Object.keys(source).length !== Object.keys(fields[kind]).length) {
      throw integrationBlocked("Projeção estrutural incompleta ou inválida em " + objectLabel(object) + ".");
    }
    for (const [property, type] of Object.entries(fields[kind])) {
      const value = source[property];
      if (type === "foreignKeyTriggers" && Object.hasOwn(source, property)) {
        properties[property] = normalizeForeignKeyTriggers(value, object, source.constraintType === "f");
        continue;
      }
      if (!Object.hasOwn(source, property) || type === "foreignKeyTriggers" || !isScalarField(value, type)) {
        throw integrationBlocked("Propriedade estrutural inválida em " + objectLabel(object) + " (" + property + ").");
      }
      properties[property] = Array.isArray(value) ? [...value] : value;
    }

    const key = objectKey(object);
    if (objects.has(key)) throw integrationBlocked("Objeto estrutural duplicado em " + objectLabel(object) + ".");
    objects.set(key, object);
  }

  const ordered = new Map([...objects.keys()].sort().map(key => [key, objects.get(key)!]));
  const sha256 = createHash("sha256").update(JSON.stringify([...ordered.values()])).digest("hex");
  return { objects: ordered, sha256 };
}

export function prepareStructuralReference(reference: unknown, migrations: readonly MigrationIdentity[]) {
  if (reference === undefined || reference === null) throw integrationBlocked("Referência estrutural confiável obrigatória.");
  if (!isRecord(reference) || reference.formatVersion !== structuralFormatVersion || typeof reference.postgresVersionNum !== "number"
      || !Number.isSafeInteger(reference.postgresVersionNum)
      || Math.floor(reference.postgresVersionNum / 10000) !== supportedMajorVersion) {
    throw integrationBlocked("Formato ou versão PostgreSQL incompatível na referência estrutural.");
  }
  if (!Array.isArray(reference.schemas) || reference.schemas.length !== schemaSet.size
      || !structuralSchemas.every(schema => (reference.schemas as unknown[]).includes(schema))) {
    throw integrationBlocked("Escopo de schemas incompatível na referência estrutural.");
  }

  if (!Array.isArray(reference.migrations) || reference.migrations.length !== migrations.length
      || !migrations.every(({ tag, migration, hash }, index) => {
        const entry: unknown = (reference.migrations as unknown[])[index];
        return isRecord(entry) && entry.tag === tag && entry.migration === migration && entry.hash === hash;
      })) {
    throw integrationBlocked("Referência estrutural incompatível com as migrations do checkout.");
  }
  const expected = structuralSnapshot(reference.objects);
  if (!expected.objects.size) throw integrationBlocked("Referência estrutural sem objetos.");
  for (const object of expected.objects.values()) {
    if (object.kind !== "constraint" || object.properties.constraintType !== "f") continue;
    // The current migrations use ordinary, nonpartitioned foreign keys, with two triggers on each side.
    const triggers = object.properties.foreignKeyTriggers as readonly ForeignKeyTrigger[];
    if (object.properties.enforced !== true || triggers.length !== 4
        || new Set(triggers.map(trigger => JSON.stringify(trigger))).size !== 4
        || triggers.some(trigger => trigger.enabled !== "O" || trigger.functionSchema !== "pg_catalog"
          || trigger.relatedSchema === null || trigger.relatedName === null)) {
      throw integrationBlocked("Referência com triggers de chave estrangeira incompatíveis em " + objectLabel(object) + ".");
    }
  }
  return { postgresVersionNum: reference.postgresVersionNum, expected };
}

export function compareStructuralCatalog(expected: Snapshot, rows: unknown): void {
  const actual = structuralSnapshot(rows);
  if (actual.sha256 === expected.sha256) return;

  for (const [key, object] of expected.objects) {
    const observed = actual.objects.get(key);
    if (!observed) throw integrationBlocked("Objeto estrutural obrigatório ausente: " + objectLabel(object) + ".");
    for (const [property, value] of Object.entries(object.properties)) {
      if (JSON.stringify(observed.properties[property]) !== JSON.stringify(value)) {
        throw integrationBlocked("Divergência estrutural em " + objectLabel(object) + " (" + property + ").");
      }
    }
  }

  for (const [key, object] of actual.objects) {
    if (!expected.objects.has(key)) throw integrationBlocked("Objeto estrutural inesperado: " + objectLabel(object) + ".");
  }
}
