import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { resolve } from 'node:path';
import { eventBiQuery } from '../../src/events/admin-bi';
import { assertAdminRoleManagementTestDatabaseUrls, startAdminRoleManagementAfterPreflight } from './admin-role-management-db-guard';

// Legacy dedicated local target only. Never the inconclusive INFRA-01 events database.
test('ADMIN-09 PostgreSQL agrega sem multiplicar, isola evento, reentradas, notas atuais e populações A/B',async()=>{
  const connectionString=assertAdminRoleManagementTestDatabaseUrls(process.env);
  const pool=new Pool({connectionString,ssl:false,max:1,connectionTimeoutMillis:2000,statement_timeout:10000});
  try {
    const migrations=readMigrationFiles({migrationsFolder:resolve(__dirname,'../../drizzle')}).map(m=>String(m.folderMillis));
    await startAdminRoleManagementAfterPreflight(pool,migrations,async()=>{
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        // PostgreSQL aggregates execute over real column types, in session-local fixtures.
        // No mutation of public tables, no global cleanup, automatic rollback on assertion failure.
        for(const table of ['participations','experiences','service_sessions','queue_entries','evaluations'])
          await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
        const event=randomUUID(),other=randomUUID(),user=randomUUID(),x=randomUUID(),y=randomUUID();
        const query=new PgDialect().sqlToQuery(eventBiQuery(event));
        const get=async()=> (await client.query(query.sql,query.params)).rows[0].metrics;
        const empty=await get();assert.equal(empty.overview.participations,0);assert.equal(empty.ratings.mean,null);assert.equal(empty.durationA.meanSeconds,null);
        await client.query('INSERT INTO experiences(id,event_id,name) VALUES($1,$2,\'A\'),($3,$2,\'B\')',[x,event,y]);
        const p=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
        for(let i=0;i<4;i++)await client.query(`INSERT INTO participations(id,event_id,user_id,status,arena_entered_at,finished_at,finish_reason)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[p[i],i===3?other:event,user,i===0?'active':'finished',i===2?null:'2026-01-01T10:00:00Z',
            i===0?null:'2026-01-01T10:30:00Z',i===0?null:i===1?'voluntary':'operational_deadline']);
        for(const [index,status,experience,minutes] of [[0,'completed',x,10],[0,'completed',x,20],[0,'absent',y,25],[1,'canceled',y,30]] as const){
          const q=randomUUID();await client.query('INSERT INTO queue_entries(id,participation_id) VALUES($1,$2)',[q,p[index]]);
          await client.query('INSERT INTO service_sessions(id,queue_entry_id,experience_id,status,resolved_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),q,experience,status,`2026-01-01T10:${minutes}:00Z`]);
        }
        const note=randomUUID();await client.query('INSERT INTO evaluations(id,participation_id,rating) VALUES($1,$2,2)',[note,p[1]]);
        await client.query('UPDATE evaluations SET rating=5 WHERE id=$1',[note]);
        const result=await get();
        assert.deepEqual(result.overview,{participations:3,arenaEntries:2,completed:2,absent:1});
        assert.equal(result.ranking.length,1);assert.equal(result.ranking[0].percent,100);
        assert.deepEqual(result.durationA,{population:1,meanSeconds:1200});
        assert.deepEqual(result.durationB,{population:1,meanSeconds:1800});
        assert.equal(result.ratings.count,1);assert.equal(result.ratings.mean,5);
        assert.equal(result.ratings.distribution[4].count,1);
        // Tied ranking remains deterministic; absent/canceled never enter the denominator.
        for(let n=0;n<2;n++){
          const q=randomUUID();await client.query('INSERT INTO queue_entries(id,participation_id) VALUES($1,$2)',[q,p[0]]);
          await client.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,status,resolved_at) VALUES($1,$2,$3,'completed','2026-01-01T10:25:00Z')",[randomUUID(),q,y]);
        }
        const tied=await get();assert.deepEqual(tied.ranking.map((r:{id:string})=>r.id),[x,y].sort());
        assert.ok(tied.ranking.every((r:{percent:number})=>r.percent===50));
        assert.equal(tied.durationA.meanSeconds,1500);
        const invalidA=randomUUID(), invalidQueue=randomUUID();
        await client.query("INSERT INTO participations(id,event_id,user_id,status,arena_entered_at) VALUES($1,$2,$3,'active','2026-01-01T11:00:00Z')",[invalidA,event,randomUUID()]);
        await client.query('INSERT INTO queue_entries(id,participation_id) VALUES($1,$2)',[invalidQueue,invalidA]);
        await client.query("INSERT INTO service_sessions(id,queue_entry_id,experience_id,status,resolved_at) VALUES($1,$2,$3,'completed','2026-01-01T10:00:00Z')",[randomUUID(),invalidQueue,x]);
        const negativeA=await get();
        assert.equal(negativeA.durationA.population,1);
        assert.equal(negativeA.durationA.meanSeconds,1500);
        assert.deepEqual(negativeA.durationB,tied.durationB);
        await client.query(`INSERT INTO participations(id,event_id,user_id,status,arena_entered_at,finished_at,finish_reason)
          VALUES($1,$2,$3,'finished','2026-01-01T11:00:00Z','2026-01-01T10:00:00Z','voluntary')`,[randomUUID(),event,user]);
        const invalid=await get();assert.equal(invalid.durationB.population,1);assert.equal(invalid.durationB.meanSeconds,1800);
      }finally{await client.query('ROLLBACK');client.release();}
    });
  }finally{await pool.end();}
});
