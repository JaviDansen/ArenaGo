import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { assertSafeStaffEntryCallsSchemaDatabase } from './test-db-guard';

// Nunca integra a suíte unitária. Exige campanha e autorização próprias.
function destination() {
  if (process.env.NODE_ENV !== 'test' || process.env.STAFF_ENTRY_CALLS_SCHEMA_TEST !== 'authorized-local')
    throw new Error('Campanha PostgreSQL específica precisa de autorização explícita.');
  const urls=['DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL'].map(k=>assertSafeStaffEntryCallsSchemaDatabase(process.env[k]));
  const u=new URL(urls[0]);
  if (!urls.every(v=>v===urls[0]) || u.hostname!=='127.0.0.1' || u.port!=='55432' ||
    u.pathname!=='/arenago_staff_homolog_20261111' || u.search || u.hash)
    throw new Error('O teste exige configuração explícita para arenago_staff_homolog_20261111; arenago_events_test é histórico e proibido.');
  return urls[0];
}
test('0008: unicidade, FKs, terminais, cancelamento sistêmico e rollback físico de fixtures',async()=>{
  const connectionString=destination();const client=new Client({connectionString,connectionTimeoutMillis:2000,statement_timeout:5000});
  const observer=new Client({connectionString,connectionTimeoutMillis:2000,statement_timeout:5000});
  const actor=randomUUID(), event=randomUUID(), person=randomUUID(), call=randomUUID();
  await client.connect();
  try {
    await observer.connect();
    assert.deepEqual((await client.query('SELECT current_database() AS name,inet_server_port() AS port')).rows[0],{name:'arenago_staff_homolog_20261111',port:55432});
    assert.ok((await client.query("SELECT to_regclass('public.external_entry_calls') AS name")).rows[0].name,'0008 deve estar previamente aplicada e validada.');
    await client.query('BEGIN');
    try {
      await client.query("INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES($1,'Synthetic entry fixture',$2,'non-authenticating-fixture',clock_timestamp(),clock_timestamp())",[actor,`${actor}@example.test`]);
      await client.query(`INSERT INTO events(id,name,access_code_normalized,timezone,starts_at,official_ends_at,operational_deadline_at,status,external_queue_enabled,external_last_order,created_at,updated_at)
        VALUES($1,'Synthetic entry event',$2,'UTC',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '90 minutes','open',true,1,clock_timestamp(),clock_timestamp())`,[event,event.toUpperCase()]);
      await client.query("INSERT INTO participations(id,user_id,event_id,status,joined_at,external_queue_order) VALUES($1,$2,$3,'waiting',clock_timestamp(),1)",[person,actor,event]);
      const create=()=>client.query("INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",[call,event,person,actor]);
      await create();await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('SET CONSTRAINTS ALL DEFERRED');
      async function refused(work:()=>Promise<unknown>,expectedCode:string,expectedConstraints?:string[]) {
        await client.query('SAVEPOINT rejected_change');
        try {
          await assert.rejects(work,(e:unknown)=>{
            const object = !!e && typeof e === 'object';
            const code = object && 'code' in e ? e.code : undefined;
            const constraint = object && 'constraint' in e ? e.constraint : undefined;
            const codeMatches = code === expectedCode;
            const constraintMatches = !expectedConstraints || (typeof constraint === 'string' && expectedConstraints.includes(constraint));
            return object && codeMatches && constraintMatches;
          });
        }
        finally {await client.query('ROLLBACK TO SAVEPOINT rejected_change');await client.query('RELEASE SAVEPOINT rejected_change');}
      }
      await refused(()=>client.query("INSERT INTO external_entry_calls SELECT $1,event_id,participation_id,called_by_user_id,called_at,status,resolved_by_user_id,resolved_at,resolution_reason FROM external_entry_calls WHERE id=$2",[randomUUID(),call]),'23505',[
        'uq_external_calls_pending_event','uq_external_calls_pending_participation',
      ]);
      await refused(()=>client.query("INSERT INTO external_entry_calls(id,event_id,participation_id,called_by_user_id,called_at,status) VALUES($1,$2,$3,$4,clock_timestamp(),'pending')",[randomUUID(),randomUUID(),randomUUID(),actor]),'23503',[
        'fk_external_calls_event','fk_external_calls_participation_event',
      ]);
      await refused(()=>client.query('UPDATE external_entry_calls SET participation_id=$1 WHERE id=$2',[randomUUID(),call]),'P0001');
      await refused(()=>client.query("UPDATE participations SET status='active',arena_entered_at=clock_timestamp() WHERE id=$1",[person]),'P0001');
      await refused(async()=>{
        await client.query("UPDATE external_entry_calls SET status='confirmed',resolved_at=clock_timestamp(),resolved_by_user_id=$1,resolution_reason='staff_entry_confirmed' WHERE id=$2",[actor,call]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      },'P0001');
      await refused(async()=>{
        await client.query("UPDATE external_entry_calls SET status='canceled',resolved_at=clock_timestamp(),resolution_reason='wrong_reason' WHERE id=$1",[call]);
        await client.query("UPDATE participations SET status='finished',finished_at=clock_timestamp(),finish_reason='external_wait_withdrawal' WHERE id=$1",[person]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      },'P0001');
      await refused(async()=>{
        await client.query("UPDATE external_entry_calls SET status='canceled',resolved_at=clock_timestamp(),resolution_reason='external_wait_withdrawal' WHERE id=$1",[call]);
        await client.query("UPDATE participations SET status='finished',finished_at=clock_timestamp()+interval '1 second',finish_reason='external_wait_withdrawal' WHERE id=$1",[person]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      },'P0001');
      for(const reason of ['external_wait_withdrawal','admin_controlled_external_wait_closed','automatic_operational_deadline']) {
        await client.query('SAVEPOINT lifecycle');
        await client.query("UPDATE participations SET status=$1,finished_at=clock_timestamp(),finish_reason=$2 WHERE id=$3",[reason==='external_wait_withdrawal'?'canceled':'finished',reason,person]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        const terminal=(await client.query('SELECT status,resolution_reason FROM external_entry_calls WHERE id=$1',[call])).rows[0];
        assert.deepEqual(terminal,{status:'canceled',resolution_reason:reason});
        assert.equal(Number((await client.query("SELECT count(*) FROM audit_logs WHERE event_id=$1 AND action='external_call_canceled'",[event])).rows[0].count),1);
        await client.query('ROLLBACK TO SAVEPOINT lifecycle');await client.query('RELEASE SAVEPOINT lifecycle');
      }
      await client.query('UPDATE events SET external_queue_enabled=false WHERE id=$1',[event]);
      await client.query("UPDATE participations SET status='active',arena_entered_at=clock_timestamp() WHERE id=$1",[person]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      assert.equal((await client.query('SELECT resolution_reason FROM external_entry_calls WHERE id=$1',[call])).rows[0].resolution_reason,'external_queue_disabled');
      await refused(()=>client.query("UPDATE external_entry_calls SET status='pending',resolved_at=NULL,resolution_reason=NULL WHERE id=$1",[call]),'P0001');
      await refused(()=>client.query('DELETE FROM external_entry_calls WHERE id=$1',[call]),'P0001');
      await client.query('UPDATE events SET external_queue_enabled=true WHERE id=$1',[event]);
      assert.equal((await client.query('SELECT status FROM participations WHERE id=$1',[person])).rows[0].status,'active');
      assert.equal((await client.query('SELECT status FROM external_entry_calls WHERE id=$1',[call])).rows[0].status,'canceled');
    } finally {await client.query('ROLLBACK');}
    // Outra conexão confirma que as fixtures não persistiram. Nenhum DELETE global.
    assert.equal((await observer.query('SELECT id FROM users WHERE id=$1',[actor])).rows.length,0);
    assert.equal((await observer.query('SELECT id FROM events WHERE id=$1',[event])).rows.length,0);
    assert.equal((await observer.query('SELECT id FROM external_entry_calls WHERE id=$1',[call])).rows.length,0);
  } finally {await observer.end();await client.end();}
});
