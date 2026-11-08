import { sql, type SQL } from "drizzle-orm";
import { effectiveEventDeadline } from "./event-closure.projection";
const trimCharacters="\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/** Prontidão e fase em um único snapshot PostgreSQL; não materializa estado ou ocupação. */
export function configurationProjection(condition:SQL=sql`true`,clock:SQL=sql`clock_timestamp()`):SQL{
  return sql`WITH observation AS MATERIALIZED (SELECT ${clock} AS at), checks AS (
    SELECT e.*,d.at,
      (length(btrim(e.name,${trimCharacters}))>0 AND length(e.access_code_normalized) BETWEEN 4 AND 64
        AND (e.access_code_normalized COLLATE "C") ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$') AS "nameAndAccessCode",
      (e.starts_at<e.official_ends_at AND e.official_ends_at<=e.operational_deadline_at
        AND e.operational_deadline_at<=e.official_ends_at+interval '1 hour'
        AND EXISTS(SELECT 1 FROM pg_timezone_names tz WHERE lower(tz.name)=lower(e.timezone))) AS "validScheduleAndTimezone",
      (e.external_queue_enabled IS NOT NULL) AS "externalQueueConfigured",
      EXISTS(SELECT 1 FROM experiences x JOIN stations s ON s.experience_id=x.id WHERE x.event_id=e.id AND s.availability='available') AS "hasExperienceWithAvailableStation",
      EXISTS(SELECT 1 FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.event_id=e.id AND r.role='staff'
        AND r.revoked_at IS NULL AND u.is_active AND u.email_verified_at IS NOT NULL) AS "hasVerifiedActiveStaff"
    FROM events e CROSS JOIN observation d WHERE ${condition}
  ), readiness AS (SELECT c.*,("nameAndAccessCode" AND "validScheduleAndTimezone" AND "externalQueueConfigured"
    AND "hasExperienceWithAvailableStation" AND "hasVerifiedActiveStaff") AS ready FROM checks c),
  projected AS (SELECT e.*,
    CASE WHEN e.status='closed' OR ${effectiveEventDeadline()}<=e.at THEN 'closed'
      WHEN e.status='closing' OR e.closure_requested_at IS NOT NULL OR e.official_ends_at<=e.at THEN 'closing'
      WHEN e.at<e.starts_at THEN 'scheduled' WHEN NOT e.ready THEN 'not_ready' ELSE 'open' END AS phase,
    (e.ready AND e.status NOT IN ('closing','closed') AND e.closure_requested_at IS NULL AND e.starts_at<=e.at AND e.at<e.official_ends_at) AS accepting
    FROM readiness e)
  SELECT id,name,access_code_normalized AS "accessCode",timezone,status AS "statusStored",phase AS "effectivePhase",external_queue_enabled AS "externalQueueEnabled",
    closure_mode AS "closureMode",
    to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startsAt",
    to_char(official_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "officialEndsAt",
    to_char(operational_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "operationalDeadlineAt",
    to_char(closure_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "closureRequestedAt",
    to_char(admin_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "adminDeadlineAt",
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
    to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
    to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt",
    ready,"nameAndAccessCode","validScheduleAndTimezone","externalQueueConfigured","hasExperienceWithAvailableStation","hasVerifiedActiveStaff",
    accepting AS "acceptingNewParticipations" FROM projected`;
}
export interface ConfigurationRow extends Record<string,unknown>{id:string;name:string;accessCode:string;timezone:string;statusStored:string;effectivePhase:string;
  startsAt:string;officialEndsAt:string;operationalDeadlineAt:string;closureMode:string|null;closureRequestedAt:string|null;adminDeadlineAt:string|null;
  externalQueueEnabled:boolean;createdAt:string;updatedAt:string;observedAt:string;ready:boolean;acceptingNewParticipations:boolean;
  nameAndAccessCode:boolean;validScheduleAndTimezone:boolean;externalQueueConfigured:boolean;hasExperienceWithAvailableStation:boolean;hasVerifiedActiveStaff:boolean;}
export function readinessView(row:ConfigurationRow){
  const checks={nameAndAccessCode:row.nameAndAccessCode,validScheduleAndTimezone:row.validScheduleAndTimezone,externalQueueConfigured:row.externalQueueConfigured,
    hasExperienceWithAvailableStation:row.hasExperienceWithAvailableStation,hasVerifiedActiveStaff:row.hasVerifiedActiveStaff};
  const missing=[...(!checks.nameAndAccessCode?['EVENT_NAME_OR_ACCESS_CODE_INVALID']:[]),...(!checks.validScheduleAndTimezone?['EVENT_SCHEDULE_INVALID']:[]),
    ...(!checks.externalQueueConfigured?['EVENT_EXTERNAL_QUEUE_NOT_CONFIGURED']:[]),...(!checks.hasExperienceWithAvailableStation?['EXPERIENCE_WITH_AVAILABLE_STATION']:[]),...(!checks.hasVerifiedActiveStaff?['VERIFIED_ACTIVE_STAFF']:[])];
  return {ready:row.ready,missing,checks};
}
export function configurationEventView(row:ConfigurationRow){
  return {id:row.id,name:row.name,accessCode:row.accessCode,timezone:row.timezone,startsAt:row.startsAt,officialEndsAt:row.officialEndsAt,operationalDeadlineAt:row.operationalDeadlineAt,
    statusStored:row.statusStored,closureMode:row.closureMode,closureRequestedAt:row.closureRequestedAt,adminDeadlineAt:row.adminDeadlineAt,externalQueueEnabled:row.externalQueueEnabled,
    effectivePhase:row.effectivePhase,readiness:readinessView(row),acceptingNewParticipations:row.acceptingNewParticipations,createdAt:row.createdAt,updatedAt:row.updatedAt};
}
export const experienceSelection=sql`SELECT id,event_id AS "eventId",name,queue_accepting_entries AS "queueAcceptingEntries",last_queue_order::text AS "lastQueueOrder",
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM experiences`;
export const stationSelection=sql`SELECT s.id,s.experience_id AS "experienceId",s.label,s.availability,
  (SELECT p.id FROM service_sessions p WHERE p.station_id=s.id AND p.status='pending') AS "pendingServiceSessionId",
  to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM stations s`;
