import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

/** Executor Drizzle que pode ser a conexão principal ou a transação PostgreSQL corrente. */
export type DatabaseExecutor =
  | NodePgDatabase<typeof schema>
  | NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;
