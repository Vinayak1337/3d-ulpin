import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import type {Pool} from 'pg';
import {transaction,query} from '../packages/server/src/infrastructure/db';

// Execute the production helper with a controlled pg transport enforcing the
// documented late-isolation/read-only rules. This is SQL-order proof, not a live
// PostgreSQL isolation, lock, cancellation or durability qualification.
const modeSql="SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only";
const writeSql='UPDATE operations SET kind=kind WHERE false';
const lateSql='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY';
const readBegin='BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY';
const guardSql="SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true),clock_timestamp() < $2::timestamptz AS deadline_live";
const code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;

function connection(){
  const calls:string[]=[],releases:(boolean|undefined)[]=[];
  let active=false,queried=false,isolation='read committed',readOnly='off';
  const raw=Object.assign(new EventEmitter(),{
    query:async(sql:string,values:unknown[]=[])=>{
      calls.push(sql);
      if(sql==='BEGIN'||sql===readBegin){
        assert(!active);active=true;queried=false;
        isolation=sql===readBegin?'repeatable read':'read committed';readOnly=sql===readBegin?'on':'off';
        return {rows:[]};
      }
      assert(active,'No guarded/action SQL before BEGIN or after the scope closes.');
      if(sql==='COMMIT'||sql==='ROLLBACK'){active=false;return {rows:[]};}
      if(sql===lateSql){
        if(queried)throw Object.assign(new Error('SET TRANSACTION ISOLATION LEVEL must be called before any query'),{code:'25001'});
        isolation='repeatable read';readOnly='on';return {rows:[]};
      }
      queried=true;
      if(sql===guardSql){
        assert.match(String(values[0]),/^\d+ms$/);assert(Number.parseInt(String(values[0]))>0);
        return {rows:[{deadline_live:Date.now()<Date.parse(String(values[1]))}]};
      }
      if(sql===modeSql)return {rows:[{isolation,read_only:readOnly}]};
      if(sql===writeSql){
        if(readOnly==='on')throw Object.assign(new Error('cannot execute UPDATE in a read-only transaction'),{code:'25006'});
        return {rows:[]};
      }
      throw new Error(`Unexpected controlled SQL: ${sql}`);
    },release:(destroy?:boolean)=>{releases.push(destroy);},
  });
  return {raw,calls,releases};
}

test('real transaction helper establishes read mode before guards and preserves default read/write order',async t=>{
  const globals=globalThis as unknown as {ulpinPool?:Pool},prior=globals.ulpinPool;
  let c=connection(),direct=0;
  globals.ulpinPool={connect:async()=>c.raw,query:async()=>{direct++;return {rows:[{direct:true}]};}} as unknown as Pool;
  const deadline=()=>({deadlineAt:Date.now()+5000});
  const trace=()=>c.calls.map(sql=>sql===guardSql?'guard SELECT':sql===modeSql?'mode SELECT':sql===writeSql?'UPDATE':sql).join(' -> ');
  try{
    // The actual helper's first guard freezes the snapshot before a callback SET.
    await assert.rejects(transaction(client=>client.query(lateSql),deadline()),code('25001'));
    assert.deepEqual(c.calls,['BEGIN',guardSql,guardSql,lateSql,'ROLLBACK']);
    assert.deepEqual(c.releases,[undefined]);t.diagnostic(`late SET rejected 25001: ${trace()}`);

    c=connection();
    const saved=await transaction(async client=>{
      const result=await client.query(modeSql);
      assert.deepEqual(result.rows,[{isolation:'repeatable read',read_only:'on'}]);return result.rows[0];
    },deadline(),'repeatable_read_only');
    assert.equal(saved.read_only,'on');
    assert.deepEqual(c.calls,[readBegin,guardSql,guardSql,modeSql,guardSql,'COMMIT']);
    assert.deepEqual(c.releases,[undefined]);t.diagnostic(`requested read mode: ${trace()}`);

    c=connection();
    await assert.rejects(transaction(client=>client.query(writeSql),deadline(),'repeatable_read_only'),code('25006'));
    assert.deepEqual(c.calls,[readBegin,guardSql,guardSql,writeSql,'ROLLBACK']);
    assert.deepEqual(c.releases,[undefined]);

    c=connection();
    await transaction(async client=>{
      assert.deepEqual((await client.query(modeSql)).rows,[{isolation:'read committed',read_only:'off'}]);
      await client.query(writeSql);
    },deadline());
    assert.deepEqual(c.calls,['BEGIN',guardSql,guardSql,modeSql,guardSql,writeSql,guardSql,'COMMIT']);
    assert.deepEqual(c.releases,[undefined]);t.diagnostic(`bounded default read/write: ${trace()}`);

    c=connection();
    assert.equal((await query('SELECT true AS direct')).rows[0].direct,true);
    await transaction(client=>client.query(writeSql));
    assert.equal(direct,1);assert.deepEqual(c.calls,['BEGIN',writeSql,'COMMIT']);
    assert.deepEqual(c.releases,[undefined]);t.diagnostic(`unbounded default: ${trace()}`);
  }finally{if(prior===undefined)delete globals.ulpinPool;else globals.ulpinPool=prior;}
});
