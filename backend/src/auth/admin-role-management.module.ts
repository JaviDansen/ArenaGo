import { Module } from "@nestjs/common";
import { AuthModule } from "./auth.module";
import { DatabaseModule } from "../database/database.module";
import { AdminIdempotencyPolicy } from "../events/admin-idempotency.policy";
import { AdminRoleManagementController } from "./admin-role-management.controller";
import { AdminRoleManagementService } from "./admin-role-management.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AdminRoleManagementController],
  providers: [AdminIdempotencyPolicy, AdminRoleManagementService],
})
export class AdminRoleManagementModule {}
