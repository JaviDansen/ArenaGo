import { Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { environment } from "../config/environment";
import * as schema from "./schema";

export const POSTGRES_POOL = Symbol("POSTGRES_POOL");
export const DRIZZLE_DATABASE = Symbol("DRIZZLE_DATABASE");

function createPool(): Pool {
  const connectionUrl = environment.DATABASE_URL;
  const hostname = new URL(connectionUrl).hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const ca = environment.DATABASE_CA_CERT?.replace(/\\n/g, "\n");

  return new Pool({
    connectionString: connectionUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: isLocal ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  });
}

@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  providers: [
    { provide: POSTGRES_POOL, useFactory: createPool },
    {
      provide: DRIZZLE_DATABASE,
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
      inject: [POSTGRES_POOL],
    },
    DatabaseLifecycle,
  ],
  exports: [DRIZZLE_DATABASE, POSTGRES_POOL],
})
export class DatabaseModule {}
