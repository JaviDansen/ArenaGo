import { sql, type SQL } from "drizzle-orm";
import type { ConfigOperation } from "./admin-configuration.dto";
import { effectiveEventDeadline } from "./event-closure.projection";

/** Todos os predicados temporais/históricos e o efeito usam o mesmo relógio após os locks. */
export function configurationMutation(operation:Exclude<ConfigOperation,'create_event'>,eventId:string,id:string,experienceId:string|undefined,body:Record<string,string|boolean|undefined>):SQL{
  const allowed=sql`NOT f.ended AND (${operation==='create_station'}::boolean OR NOT f.history)`;
  let write:SQL;
  if(operation==='create_experience')write=sql`INSERT INTO experiences(id,event_id,name,queue_accepting_entries,last_queue_order,created_at,updated_at)
    SELECT ${id}::uuid,${eventId}::uuid,${body.name}::varchar(160),true,0,f.at,f.at FROM facts f WHERE ${allowed} RETURNING id`;
  else if(operation==='create_station')write=sql`INSERT INTO stations(id,experience_id,label,availability,created_at,updated_at)
    SELECT ${id}::uuid,${experienceId}::uuid,${body.label}::varchar(120),'available',f.at,f.at FROM facts f WHERE ${allowed} RETURNING id`;
  else if(operation==='update_event')write=sql`UPDATE events e SET name=${body.name}::varchar(180),updated_at=f.at FROM facts f WHERE e.id=${id}::uuid AND ${allowed} RETURNING e.id`;
  else if(operation==='update_experience')write=sql`UPDATE experiences x SET name=${body.name}::varchar(160),updated_at=f.at FROM facts f
    WHERE x.id=${id}::uuid AND x.event_id=${eventId}::uuid AND ${allowed} RETURNING x.id`;
  else write=sql`UPDATE stations s SET label=${body.label}::varchar(120),updated_at=f.at FROM facts f
    WHERE s.id=${id}::uuid AND s.experience_id=${experienceId}::uuid AND ${allowed} RETURNING s.id`;
  return sql`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at),facts AS MATERIALIZED (
    SELECT d.at,(e.status='closed' OR ${effectiveEventDeadline()}<=d.at) AS ended,
      EXISTS(SELECT 1 FROM participations p WHERE p.event_id=e.id) AS history FROM events e CROSS JOIN decision d WHERE e.id=${eventId}::uuid
  ),written AS (${write}) SELECT f.ended,f.history,to_char(f.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,w.id AS "writtenId"
    FROM facts f LEFT JOIN written w ON true`;
}
