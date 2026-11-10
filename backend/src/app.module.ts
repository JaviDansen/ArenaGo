import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module";
import { ProblemDetailsExceptionFilter } from "./common/errors/problem-details.filter";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { AdminEventsModule } from "./events/admin-events.module";
import { GamesModule } from "./games/games.module";
import { ProfileModule } from "./profile/profile.module";
import { AdminRoleManagementModule } from "./auth/admin-role-management.module";
import { ParticipationsModule } from "./participations/participations.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    EventsModule,
    ParticipationsModule,
    AdminEventsModule,
    GamesModule,
    ProfileModule,
    AdminRoleManagementModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemDetailsExceptionFilter,
    },
  ],
})
export class AppModule {}
