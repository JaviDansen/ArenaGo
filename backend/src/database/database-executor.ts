import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

/** Transação PostgreSQL Drizzle aberta e controlada pelo chamador. */
export type DatabaseTransactionExecutor = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Executor Drizzle que pode ser a conexão principal ou a transação PostgreSQL corrente. */
export type DatabaseExecutor = NodePgDatabase<typeof schema> | DatabaseTransactionExecutor;
