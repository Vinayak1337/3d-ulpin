import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { userInfo } from 'node:os';
import { hash } from '@ulpin/server/modules/model-gateway/config';
import { reservation } from '@ulpin/server/modules/model-gateway/pricing';
import { PgModelCallLedger, type Transact } from '@ulpin/server/modules/model-gateway/ledger';
import { ModelGateway } from '@ulpin/server/modules/model-gateway/gateway';
import { ControlAdapter, ProviderFailure } from '@ulpin/server/modules/model-gateway/adapter';
import { ModelGatewayConfigSchema } from '@ulpin/server/modules/model-gateway/config';

// Control-plane budget/error inputs only. Never imports application DB/config or seeds records.
const config=(overrides:Record<string,unknown>={})=>ModelGatewayConfigSchema.parse({
  projectId:'model-core-control',policyVersion:'control-policy-v1',fundingVersion:'control-funding-v1',
  gatewayExclusiveFunding:true,indiaPrivateApproved:true,secretReference:'ULPIN_PROVIDER_KEY_CONTROL',model:'sarvam-105b',
  projectCapMicroInr:'100000000',principalDailyCallCap:20,paceMs:1500,
  price:{version:'control-price-v1',inputPerMillionMicroInr:'29280000',cachedInputPerMillionMicroInr:'10980000',outputPerMillionMicroInr:'73200000'},
  inputBound:{version:'control-byte-bound-v1',maxPromptTokens:34816},...overrides,
});
const context={requestId:'model-core-control',principal:{subject:`local-os:${userInfo().uid}:${userInfo().username}`,
  roles:['operator'],entitlementVersion:'local-1',mode:'local_demo' as const},accessViewId:'local-control',policyVersion:'usp-local-1'};
const admission=(key:string,attempt=1)=>({principalHash:hash(context.principal.subject),invocationKey:hash(key),attempt,
  consumer:'INGEST' as const,inputHash:hash('control-input'),scopeHash:hash('control-scope'),sourceHashes:[],deadlineAt:new Date(Date.now()+45000)});
const receipt=(amount:bigint)=>({httpStatus:200,responseHash:hash({control:true}),actualMicroInr:amount.toString()});

test('fresh owned SQL: atomic caps, restart exposure, settlements, privacy fences and bounded repairs',
  {skip:!process.env.ULPIN_MODEL_SQL_URL},async t=>{
    assert(!existsSync(new URL('../../.env',import.meta.url)),'This runner refuses any root .env');
    const nonce=process.env.ULPIN_MODEL_SQL_NONCE!;
    assert.match(nonce,/^[a-f0-9]{16}$/);
    const container=`ulpin-model-control-${nonce}`;
    const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
    assert.equal(info.Config.Labels['io.ulpin.task'],'DEPLOY-01');assert.equal(info.Config.Labels['io.ulpin.nonce'],nonce);
    const url=new URL(process.env.ULPIN_MODEL_SQL_URL!);
    assert.equal(url.hostname,'127.0.0.1');assert.equal(url.password,'');assert.equal(url.username,'model_control');
    assert.equal(url.pathname,`/model_control_${nonce}`);
    assert.equal(info.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');
    assert.equal(info.NetworkSettings.Ports['5432/tcp'][0].HostPort,url.port);
    const sql=readFileSync(new URL('../../database/sql/90-model-gateway/model-gateway.sql',import.meta.url),'utf8');
    const manifest=JSON.parse(readFileSync(new URL('../../database/manifest.json',import.meta.url),'utf8'));
    assert.equal(createHash('sha256').update(sql).digest('hex'),manifest.steps.find((s:any)=>s.id==='model-gateway.schema').sha256);
    const admin=new Pool({connectionString:url.href,max:1});
    const pools:Pool[]=[];let serial=0;
    const fresh=async(c=config())=>{
      const schema=`control_${nonce}_${++serial}`;
      await admin.query(`CREATE SCHEMA ${schema}`); // guarded nonce-owned identifier, never source text
      const p=new Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`});pools.push(p);
      await p.query(sql);await p.query(sql); // additive migration repeat, no records/reset
      const tx:Transact=async action=>{const client=await p.connect();try{await client.query('BEGIN');const value=await action(client);await client.query('COMMIT');return value;}
        catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
      return {p,tx,ledger:new PgModelCallLedger(tx,c,hash('control-adapter'),'control'),config:c};
    };
    const paceReady=async(p:Pool)=>p.query('UPDATE usp_model_budget SET next_admission_at=clock_timestamp()');
    const run=(state:Awaited<ReturnType<typeof fresh>>,adapter:ControlAdapter,authorize=async()=>{},key='control-invocation',attempt=1)=>
      new ModelGateway(state.config,state.ledger,adapter).propose(context,{taskKind:'control',evidenceRefs:[],input:{messages:[{role:'user',content:'control'}]},
        outputSchemaId:'control-v1',budget:{maxInputBytes:32768,deadlineMs:45000},policyVersion:state.config.policyVersion},
      {invocationKey:key,attempt,consumer:'INGEST',scopeHash:hash('control-scope'),sourceHashes:[],deadlineAt:new Date(Date.now()+45000),
        taskKind:'control',outputSchemaId:'control-v1',outputSchema:{type:'object'},authorize,minimizeOutput:v=>v});
    const ok=new ControlAdapter(async()=>({output:{control:true},responseHash:hash({control:true}),usage:{promptTokens:2000,completionTokens:1000},httpStatus:200}));
    try {
      await t.test('G-02/G-07 concurrent admission serializes; cap includes settled spend plus full reserve',async()=>{
        const r=reservation(config());const state=await fresh(config({projectCapMicroInr:(r*3n/2n).toString()}));
        const parallel=await Promise.allSettled([state.ledger.reserve(admission('one')),state.ledger.reserve(admission('two'))]);
        assert.equal(parallel.filter(v=>v.status==='fulfilled').length,1);
        const accepted=parallel.find(v=>v.status==='fulfilled') as PromiseFulfilledResult<any>;
        const id=accepted.value.call.id;
        await state.ledger.dispatch(id);await state.ledger.settle(id,r*3n/4n,{control:true},receipt(r*3n/4n));await paceReady(state.p);
        await assert.rejects(state.ledger.reserve(admission('three')),(e:any)=>e.code==='MODEL_PROJECT_CAP');
        assert.equal((await state.p.query('SELECT count(*)::int count FROM usp_model_calls')).rows[0].count,1);
      });
      await t.test('protected INGEST funds and principal daily attempt cap cannot be spent by assistance',async()=>{
        const r=reservation(config());const state=await fresh(config({projectCapMicroInr:(r*3n).toString(),principalDailyCallCap:1}));
        await assert.rejects(state.ledger.reserve({...admission('assist'),consumer:'ASSIST'}),(e:any)=>e.code==='MODEL_CONSUMER_CAP');
        const {call}=await state.ledger.reserve(admission('ingest'));await state.ledger.dispatch(call.id);
        await state.ledger.settle(call.id,1n,{control:true},receipt(1n));await paceReady(state.p);
        await assert.rejects(state.ledger.reserve(admission('over-daily')),(e:any)=>e.code==='MODEL_PRINCIPAL_CAP');
      });
      await t.test('G-10/G-11 durable unknown exposure, late duplicate settlement and changed config fail closed',async()=>{
        const state=await fresh();const {call}=await state.ledger.reserve(admission('unknown'));await state.ledger.dispatch(call.id);
        await state.ledger.retainExposure(call.id,new ProviderFailure('outcome_unknown'));
        const restarted=new PgModelCallLedger(state.tx,state.config,hash('control-adapter'),'control');
        const retry=await restarted.reserve(admission('unknown'));assert.equal(retry.admitted,false);assert.equal(retry.call.state,'outcome_unknown');
        await restarted.releaseBeforeDispatch(call.id);
        assert.equal((await state.p.query('SELECT state FROM usp_model_calls')).rows[0].state,'outcome_unknown');
        await paceReady(state.p);await assert.rejects(restarted.reserve(admission('new-key')),(e:any)=>e.code==='MODEL_EXPOSURE_PENDING');
        await restarted.settle(call.id,100n,{control:true},receipt(100n));await restarted.settle(call.id,100n,{control:true},receipt(100n));
        await assert.rejects(restarted.settle(call.id,101n,{control:true},receipt(101n)),(e:any)=>e.code==='MODEL_SETTLEMENT_CONFLICT');
        const altered=new PgModelCallLedger(state.tx,{...state.config,projectCapMicroInr:'200000000'},hash('control-adapter'),'control');
        await assert.rejects(altered.reserve(admission('changed-cap')),(e:any)=>e.code==='MODEL_RECONCILIATION_REQUIRED');
        const differentKey=new PgModelCallLedger(state.tx,state.config,hash('different-control-key'),'control');
        await assert.rejects(differentKey.reserve(admission('rollover')),(e:any)=>e.code==='MODEL_RECONCILIATION_REQUIRED');
      });
      await t.test('G-04/G-05 single-pool quota block and durable 429 cooldown never cycle or refund',async()=>{
        for(const failure of [new ProviderFailure('quota_exhausted',402),new ProviderFailure('rate_limited',429,5000)]) {
          const state=await fresh();let calls=0;const adapter=new ControlAdapter(async()=>{calls++;throw failure;});
          await assert.rejects(run(state,adapter));await assert.rejects(run(state,adapter));assert.equal(calls,1);
          const row=(await state.p.query('SELECT * FROM usp_model_budget')).rows[0];
          assert.equal(row.blocked_reason,failure.kind==='quota_exhausted'?'quota_exhausted':null);
          if(failure.kind==='rate_limited') assert(row.cooldown_until instanceof Date);
          assert.equal((await state.p.query('SELECT state FROM usp_model_calls')).rows[0].state,'outcome_unknown');
        }
      });
      await t.test('G-09/G-12 charged truncated output can repair once; missing usage holds and deficit suspends',async()=>{
        const state=await fresh();let calls=0;
        const bad=new ControlAdapter(async()=>{calls++;return {output:{control:true},responseHash:hash({control:true}),usage:{promptTokens:2000,completionTokens:1000},httpStatus:200,semanticError:'truncated_output'};});
        const first=await run(state,bad);assert.equal(first.receipt?.actualMicroInr,'131760');
        const second=await run(state,bad,async()=>{},'control-invocation',2);assert.equal(second.receipt?.semanticError,'truncated_output');assert.equal(calls,2);
        await assert.rejects(run(state,bad,async()=>{},'control-invocation',3));assert.equal(calls,2);
        const unmetered=await fresh();await assert.rejects(run(unmetered,new ControlAdapter(async()=>({output:{control:true},responseHash:hash('control'),httpStatus:200}))),
          (e:any)=>e.code==='MODEL_USAGE_UNVERIFIED');
        assert.equal((await unmetered.p.query('SELECT state FROM usp_model_calls')).rows[0].state,'usage_unverified');
        const deficit=await fresh();const {call}=await deficit.ledger.reserve(admission('deficit'));await deficit.ledger.dispatch(call.id);
        const debit=BigInt(call.reserve_micro_inr)+1n;await deficit.ledger.settle(call.id,debit,{control:true},receipt(debit));await paceReady(deficit.p);
        await assert.rejects(deficit.ledger.reserve(admission('after-deficit')),(e:any)=>e.code==='MODEL_POOL_BLOCKED');
      });
      await t.test('G-19 storage outage and predispatch access failure make zero adapter calls',async()=>{
        let calls=0;const adapter=new ControlAdapter(async request=>{calls++;return ok.propose(request);});
        const state=await fresh();const failing:Transact=async()=>{throw new Error('control SQL unavailable');};
        state.ledger=new PgModelCallLedger(failing,state.config,hash('control-adapter'),'control');
        await assert.rejects(run(state,adapter));assert.equal(calls,0);
        const denied=await fresh();let checks=0;await assert.rejects(run(denied,adapter,async()=>{if(++checks===2)throw new Error('control access revoked');}));
        assert.equal(calls,0);assert.equal((await denied.p.query('SELECT state FROM usp_model_calls')).rows[0].state,'released');
      });
      await t.test('post-dispatch timeout keeps exposure; post-response revocation settles without publication',async()=>{
        const state=await fresh(config({timeoutMs:1000}));let aborted=false;
        const hanging=new ControlAdapter(request=>new Promise(()=>request.signal.addEventListener('abort',()=>{aborted=true;})));
        await assert.rejects(run(state,hanging),(e:any)=>e.code==='MODEL_OUTCOME_UNKNOWN');assert(aborted);
        assert.equal((await state.p.query('SELECT state FROM usp_model_calls')).rows[0].state,'outcome_unknown');
        const late=await fresh(config({timeoutMs:1000}));
        const delayed=new ControlAdapter(async request=>{await new Promise(resolve=>setTimeout(resolve,1100));return ok.propose(request);});
        await assert.rejects(run(late,delayed),(e:any)=>e.code==='MODEL_OUTCOME_UNKNOWN');
        await new Promise(resolve=>setTimeout(resolve,200));
        assert.equal((await late.p.query('SELECT state FROM usp_model_calls')).rows[0].state,'settled');
        const revoked=await fresh();let allowed=true;
        const revoke=new ControlAdapter(async request=>{const result=await ok.propose(request);allowed=false;return result;});
        await assert.rejects(run(revoked,revoke,async()=>{if(!allowed)throw new Error('control publication revoked');}));
        assert.equal((await revoked.p.query('SELECT state,actual_micro_inr FROM usp_model_calls')).rows[0].state,'settled');
      });
    } finally { await Promise.all(pools.map(p=>p.end()));await admin.end(); }
  });
