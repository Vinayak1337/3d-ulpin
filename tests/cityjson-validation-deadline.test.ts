import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {transaction,query,DbCommitOutcomeUnknown} from '../packages/server/src/infrastructure/db';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {claimUspJobAttempt,acceptUspJobAttempt} from '../packages/server/src/modules/usp/jobs';
import {runCityJSONValidationJob} from '../packages/server/src/modules/registry/cityjson-validation-worker';

// Driver/SQL doubles only. Destruction, guards, dispatcher return and late-callback
// controls are exercised; this is not PostgreSQL lock/cancel/commit evidence.
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function client(handler:(sql:string,args:any[])=>any){
  const calls:string[]=[],releases:any[]=[];
  const raw=Object.assign(new EventEmitter(),{query:async(sql:string,args:any[]=[])=>{
    calls.push(sql);
    if(sql.startsWith('SELECT set_config')){
      assert.match(args[0],/^\d+ms$/);assert.ok(Number.parseInt(args[0])>0);
      return {rows:[{deadline_live:Date.now()<Date.parse(args[1])}]};
    }
    return await handler(sql,args)??{rows:[]};
  },release:(destroy?:boolean)=>{releases.push(destroy);}});
  return {raw,calls,releases};
}
async function pooled(connection:any,work:()=>Promise<void>,direct?:Function){
  const globals=globalThis as any,prior=globals.ulpinPool;
  globals.ulpinPool={connect:()=>Promise.resolve(connection),query:direct};
  try{await work();}finally{if(prior===undefined)delete globals.ulpinPool;else globals.ulpinPool=prior;}
}

test('no-option database callers retain direct query and original transaction sequence',async()=>{
  const c=client(()=>({rows:[{value:1}]}));let direct=0;
  await pooled(c.raw,async()=>{
    assert.equal((await query('technical default')).rows[0].value,2);
    assert.equal(await transaction(async connection=>(await connection.query('technical action')).rows[0].value),1);
  },async()=>{direct++;return {rows:[{value:2}]};});
  assert.equal(direct,1);assert.deepEqual(c.calls,['BEGIN','technical action','COMMIT']);assert.deepEqual(c.releases,[undefined]);
});

test('expired acquisition returns and destroys a late connection without starting SQL',async()=>{
  const globals=globalThis as any,prior=globals.ulpinPool,c=client(()=>({rows:[]}));let acquired!:(value:any)=>void,ran=false;
  globals.ulpinPool={connect:()=>new Promise(resolve=>{acquired=resolve;})};
  try{
    await assert.rejects(()=>transaction(async()=>{ran=true;},{deadlineAt:Date.now()+40}),(e:any)=>e.code==='DB_DEADLINE');
    acquired(c.raw);await delay(0);assert.equal(ran,false);assert.deepEqual(c.calls,[]);assert.deepEqual(c.releases,[true]);
  }finally{if(prior===undefined)delete globals.ulpinPool;else globals.ulpinPool=prior;}
});

test('held authority query is actively destroyed and cannot continue claim after expiry',async()=>{
  let late!:(value:any)=>void;
  const c=client(sql=>sql==='held source-case gate'?new Promise(resolve=>{late=resolve;}):{rows:[]});
  await pooled(c.raw,async()=>{
    await assert.rejects(()=>claimUspJobAttempt(randomUUID(),'technical',async connection=>{
      await connection.query('held source-case gate');
    },{deadlineAt:Date.now()+40}),(e:any)=>e.code==='DB_DEADLINE');
    assert.deepEqual(c.releases,[true]);late({rows:[]});await delay(0);
    assert.equal(c.calls.some(sql=>sql.includes('SELECT * FROM jobs')),false);assert.equal(c.calls.includes('COMMIT'),false);
  });
  const fatal=client(sql=>{
    if(sql==='held idle scope'){
      setTimeout(()=>fatal.raw.emit('error',Object.assign(new Error('technical server idle expiry'),{code:'25P03'})),10);
      return new Promise(()=>{});
    }
    return {rows:[]};
  });
  await pooled(fatal.raw,async()=>{
    await assert.rejects(()=>transaction(async connection=>{await connection.query('held idle scope');},
      {deadlineAt:Date.now()+1000}),(e:any)=>e.code==='DB_DEADLINE');
    assert.deepEqual(fatal.releases,[true]);fatal.raw.emit('end');assert.equal(fatal.raw.listenerCount('error'),0);
  });
});

test('actual acceptance cannot dispatch writes/commit after controlled expiry; blocked outbox destroys staged scope',async()=>{
  const jobId=randomUUID(),hash='a'.repeat(64),attempt={jobId,number:1,fence:1,owner:'technical',leaseUntil:new Date(Date.now()+60_000).toISOString(),inputSha256:hash},
    asset={assetId:`cityjson-validation:${jobId}`,version:1,sha256:hash};
  const rows=(sql:string)=>sql.includes('FROM jobs')?{rows:[{status:'running'}]}:
    sql.includes('FROM usp_job_metadata')?{rows:[{logical_state:'running',input_sha256:hash,input_manifest_id:randomUUID()}]}:
    sql.includes('FROM usp_job_attempts')?{rows:[{state:'active',fence:1,owner:'technical',input_sha256:hash,lease_until:attempt.leaseUntil}]}:{rows:[]};
  const expired=client(rows);let resume!:()=>void;
  await pooled(expired.raw,async()=>{
    await assert.rejects(()=>acceptUspJobAttempt(attempt,asset,async()=>await new Promise<void>(resolve=>{resume=resolve;}),
      undefined,undefined,{deadlineAt:Date.now()+60}),(e:any)=>e.code==='DB_DEADLINE');
    resume();await delay(0);
    assert.equal(expired.calls.some(sql=>sql.startsWith('UPDATE')),false);assert.equal(expired.calls.includes('COMMIT'),false);
    assert.deepEqual(expired.releases,[true]);
  });
  const controller=new AbortController();let outboxResponse!:(value:any)=>void,staged=0;
  const blocked=client(sql=>{
    if(sql.startsWith('UPDATE usp_job')||sql.startsWith('UPDATE jobs')){staged++;return {rows:[]};}
    if(sql.startsWith('UPDATE usp_outbox_streams'))return {rows:[{sequence:'1'}]};
    if(sql.startsWith('INSERT INTO usp_outbox(')){
      setTimeout(()=>controller.abort(new AppError(503,'CITYJSON_VALIDATION_CANCELLED','technical stop')),10);
      return new Promise(resolve=>{outboxResponse=resolve;});
    }
    return rows(sql);
  });
  await pooled(blocked.raw,async()=>{
    await assert.rejects(()=>acceptUspJobAttempt(attempt,asset,async()=>{},undefined,undefined,
      {deadlineAt:Date.now()+1000,signal:controller.signal}),(e:any)=>e.code==='CITYJSON_VALIDATION_CANCELLED');
    assert.equal(staged,3);assert.deepEqual(blocked.releases,[true]);assert.equal(blocked.calls.includes('COMMIT'),false);
    outboxResponse({rows:[]});await delay(0);assert.equal(blocked.calls.includes('COMMIT'),false);
  });
});

test('in-flight commit is discarded and reported unknown; rollback waits are bounded',async()=>{
  const controller=new AbortController(),c=client(sql=>{
    if(sql==='COMMIT'){setTimeout(()=>controller.abort(new Error('technical stop during commit')),10);return new Promise(()=>{});}
    return {rows:[]};
  });
  await pooled(c.raw,async()=>{
    await assert.rejects(()=>transaction(async()=>1,{deadlineAt:Date.now()+1000,signal:controller.signal}),e=>e instanceof DbCommitOutcomeUnknown);
    assert.deepEqual(c.releases,[true]);assert.equal(c.calls.filter(sql=>sql==='COMMIT').length,1);
  });
  const rollback=client(sql=>sql==='ROLLBACK'?new Promise(()=>{}):{rows:[]});
  await pooled(rollback.raw,async()=>{
    const start=Date.now();await assert.rejects(()=>transaction(async()=>{throw new Error('technical action failure');},{deadlineAt:Date.now()+50}),/technical action failure/);
    assert.ok(Date.now()-start<1000);assert.deepEqual(rollback.releases,[true]);assert.equal(rollback.calls.includes('COMMIT'),false);
  });
});

test('actual validation worker installs stop before its initial lookup and releases the pending run',async()=>{
  const c=client(sql=>{
    if(sql.includes("operation='cityjson-validation'")){
      setTimeout(()=>process.emit('SIGTERM'),10);return new Promise(()=>{});
    }
    return {rows:[]};
  });
  const old=console.warn,warnings:string[]=[];console.warn=(message:string)=>{warnings.push(message);};
  try{await pooled(c.raw,async()=>{const start=Date.now();await runCityJSONValidationJob(randomUUID());assert.ok(Date.now()-start<1000);});}
  finally{console.warn=old;}
  assert.deepEqual(c.releases,[true]);assert.equal(c.calls.includes('COMMIT'),false);assert.equal(warnings.length,1);
});
