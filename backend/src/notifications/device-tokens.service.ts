import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DRIZZLE_DATABASE } from "../database/database.module";
import type * as schema from "../database/schema";
import type { RegisterPushTokenDto, UnregisterPushTokenDto } from "./device-tokens.dto";

export interface ActiveDeviceToken {
  pushToken: string;
  platform: string;
}

@Injectable()
export class DeviceTokensService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async registerToken(
    userId: string,
    dto: RegisterPushTokenDto,
  ): Promise<{ status: "registered" | "updated" }> {
    const existing = await this.database.execute<{ id: string; userId: string }>(
      sql`SELECT id, user_id AS "userId" FROM device_push_tokens WHERE push_token = ${dto.pushToken}`,
    );

    if (existing.rows.length > 0) {
      await this.database.execute(
        sql`UPDATE device_push_tokens
            SET user_id = ${userId},
                platform = ${dto.platform},
                revoked_at = NULL,
                updated_at = clock_timestamp()
            WHERE push_token = ${dto.pushToken}`,
      );
      return { status: "updated" };
    }

    const id = randomUUID();
    await this.database.execute(
      sql`INSERT INTO device_push_tokens (id, user_id, push_token, platform, created_at, updated_at, revoked_at)
          VALUES (${id}, ${userId}, ${dto.pushToken}, ${dto.platform}, clock_timestamp(), clock_timestamp(), NULL)`,
    );
    return { status: "registered" };
  }

  async unregisterToken(
    userId: string,
    dto: UnregisterPushTokenDto,
  ): Promise<{ unlinked: boolean }> {
    const result = await this.database.execute(
      sql`UPDATE device_push_tokens
          SET revoked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE push_token = ${dto.pushToken} AND user_id = ${userId} AND revoked_at IS NULL`,
    );
    return { unlinked: (result.rowCount ?? 0) > 0 };
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.database.execute(
      sql`UPDATE device_push_tokens
          SET revoked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE user_id = ${userId} AND revoked_at IS NULL`,
    );
  }

  async getActiveTokensForUser(userId: string): Promise<ActiveDeviceToken[]> {
    const result = await this.database.execute<{ pushToken: string; platform: string }>(
      sql`SELECT push_token AS "pushToken", platform
          FROM device_push_tokens
          WHERE user_id = ${userId} AND revoked_at IS NULL`,
    );
    return result.rows;
  }

  async revokeInvalidToken(pushToken: string): Promise<void> {
    await this.database.execute(
      sql`UPDATE device_push_tokens
          SET revoked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE push_token = ${pushToken} AND revoked_at IS NULL`,
    );
  }
}
