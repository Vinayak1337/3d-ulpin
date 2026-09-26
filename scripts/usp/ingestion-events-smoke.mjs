/** One guarded NYC source/recipe journey; protocol controls and a commit barrier use its actual records. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertUspIsolation,assertLocalOperatorProcess} from './local-isolation.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const safeEnv=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const git=args=>execFileSync('git',args,{cwd:root,env:safeEnv,encoding:'utf8',timeout:5000}).trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function run(){
  const dir=realpathSync(process.argv[2]||'');assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),owner=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  let scope,operator;try{scope=assertUspIsolation(env);operator=assertLocalOperatorProcess(env);}catch{throw new Error('Private isolation validation failed.');}
  assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');assert.equal(owner.checkout,root);assert.equal(owner.project,scope.project);
  assert.equal(owner.nonce,env.ULPIN_LOCAL_NONCE);assert.deepEqual(owner.operatorProvenance,operator);
  assert.equal(git(['rev-parse','HEAD']),owner.baseCommit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');assert(!existsSync(join(root,'.env')));
  const output=join(dir,'ingestion-events-smoke.json');assert(!existsSync(output),'Use a fresh pinned run nonce.');
  const original=readFileSync(join(root,'fixtures/real-nyc/original.geojson')),provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));
  assert.equal(hash(original),provenance.originalSha256);const nativeKey=JSON.parse(original).features[0].properties.doitt_id;assert.equal(nativeKey,provenance.sourceKey.doitt_id);
  const {Client}=createRequire(join(root,'packages/server/package.json'))('pg');
  const observer=new Client({connectionString:env.DATABASE_URL,application_name:'ingest03-observer',statement_timeout:5000});
  const barrier=new Client({connectionString:env.DATABASE_URL,application_name:'ingest03-commit-barrier',statement_timeout:5000});
  await observer.connect();await barrier.connect();
  const base=env.ULPIN_TEST_URL+'api/v1',streams=new Set();let phase='create-case',held=false;
  const receipt={version:'ingestion-events-smoke/1',status:'running',codeCommit:owner.baseCommit,project:scope.project,nonce:owner.nonce,
    source:{path:'fixtures/real-nyc/original.geojson',sha256:hash(original),bytes:original.length,issuer:provenance.provider,url:provenance.originalDownload,terms:provenance.terms,geography:'New York City, USA',purpose:'test_only'},checks:[],
    notQualified:['Multiuser authentication or revocation across replicas','Every job/source producer; large part/finalization delivery','Large archives, parsing, companions, tiles, scale, learning, Indian operational use or any release gate']};
  async function api(path,status=200,body,headers={}){
    const r=await fetch(base+path,{headers:{Connection:'close',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},
      ...(body?{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
    const value=await r.json();assert.equal(r.status,status,`${phase}: ${path}: ${value.error?.code||r.status}`);return value;
  }
  async function stream(caseId,query='',headers={}){
    const abort=new AbortController(),response=await fetch(`${base}/ingestion/cases/${caseId}/events${query}`,{headers,signal:abort.signal});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/event-stream/);assert.equal(response.headers.get('cache-control'),'private, no-store');
    const reader=response.body.getReader(),decode=new TextDecoder();let text='';
    const handle={async next(timeout=6000){
      const timer=setTimeout(()=>abort.abort(),timeout);
      try{while(true){
        const boundary=text.indexOf('\n\n');
        if(boundary>=0){const frame=text.slice(0,boundary);text=text.slice(boundary+2);const lines=frame.split('\n');
          if(frame.startsWith(':'))return {comment:frame};
          const fields=Object.fromEntries(lines.map(line=>{const at=line.indexOf(':');return [line.slice(0,at),line.slice(at+1).trimStart()];}));
          assert(fields.event);const data=JSON.parse(fields.data);return {event:fields.event,id:fields.id,data};}
        const result=await reader.read();assert(!result.done,'Stream ended before the expected frame.');text+=decode.decode(result.value,{stream:true});assert(text.length<=65536);
      }}finally{clearTimeout(timer);}
    },async close(){abort.abort();await reader.cancel().catch(()=>{});streams.delete(handle);}};
    streams.add(handle);return handle;
  }
  const form=requestKey=>{const f=new FormData();f.set('file',new Blob([original],{type:'application/geo+json'}),'original.geojson');
    for(const [key,value]of Object.entries({requestKey,expectedWorkspaceRevision:0,format:'geojson'}))f.set(key,String(value));return f;};
  const decision=revision=>({requestKey:randomUUID(),expectedRecipeRevision:revision});
  try{
    const {caseId}=await api('/source-cases',201,{requestKey:randomUUID(),name:provenance.provider+' private ingestion event test'});receipt.caseId=caseId;
    const {caseId:peer}=await api('/source-cases',201,{requestKey:randomUUID(),name:provenance.provider+' cursor boundary control'});receipt.peerCaseId=peer;
    const path=`/ingestion/cases/${caseId}`;
    let reading=await stream(caseId),ready=await reading.next();assert.equal(ready.event,'ready');assert.match(ready.id,/^[1-9]\d*$/);
    assert.equal(ready.data.cursor,ready.id);await api(path+'/events',429);
    await api(path+'/events',403,undefined,{'Sec-Fetch-Site':'cross-site'});
    const key=randomUUID();phase='source-retention';const profile=await api(path+'/sources',201,form(key));receipt.sourceId=profile.source.sourceId;
    let event=await reading.next();assert.equal(event.event,'ingestion.change');assert.equal(event.data.sequence,'1');assert.equal(event.data.change.kind,'source.retained');
    assert.equal(event.data.change.sourceId,receipt.sourceId);assert.equal(event.data.caseRevision,profile.workspaceRevision);let cursor=event.id;
    assert.equal((await reading.next()).data.reason,'context_changed');await reading.close();
    assert.deepEqual(await api(path+'/sources',201,form(key)),profile);assert.equal((await api(path+'/sources',201,form(randomUUID()))).source.sourceId,receipt.sourceId);
    const outbox=async()=>{const rows=(await observer.query("SELECT stream_id,last_sequence::text sequence FROM usp_outbox_streams WHERE stream_id LIKE $1 LIMIT 2",[`case-ingestion:${caseId}:%`])).rows;assert.equal(rows.length,1);return rows[0];};
    assert.equal((await outbox()).sequence,'1');receipt.checks.push('one committed retained-source event; source/case context resync; exact receipt replay and same-byte deduplication append no events');
    phase='cursor-boundaries';await api(`/ingestion/cases/${peer}/events`,409,undefined,{'Last-Event-ID':cursor});
    await api(path+'/events?cursor=01',422);await api(path+'/events?cursor=0&cursor=0',422);await api(path+'/events?stream=caller-selected',422);
    await api(path+'/events?cursor='+(BigInt(cursor)+1n),409,undefined,{'Last-Event-ID':cursor});
    const ahead=await api(path+'/events',409,undefined,{'Last-Event-ID':(BigInt(cursor)+1000n).toString()});assert.equal(ahead.error.code,'INGESTION_RESYNC');assert.equal(ahead.error.details.reason,'cursor_out_of_range');
    await delay(100);reading=await stream(caseId,'?cursor=0',{'Last-Event-ID':cursor});ready=await reading.next();assert.equal(ready.id,cursor);
    const plan={version:profile.version,mode:'manual_mapping',source:profile.source,caseId,workspaceRevision:profile.workspaceRevision,workspaceFingerprint:profile.workspaceFingerprint,
      operations:[{target:'building.sourceKey',sourcePath:'/features/*/properties/doitt_id',conversionId:'literal_identifier@1'},{target:'building.geometry',sourcePath:'/features/*/geometry',conversionId:'geojson_polygon@1'}]};
    const author={requestKey:randomUUID(),expectedRecipeRevision:0,plan,destination:{kind:'new_area',namespace:'nyc-oti-5zhs-2jue',name:`NYC OTI building footprint ${nativeKey}`}};
    const authorPath=path+`/sources/${receipt.sourceId}/recipes`;
    phase='recipe-author';let recipe=await api(authorPath,201,author);receipt.recipeId=recipe.id;
    event=await reading.next();assert.equal(event.data.sequence,'2');assert.equal(event.data.change.status,'proposed');cursor=event.id;
    assert.deepEqual(await api(authorPath,201,author),recipe);await api(authorPath,409,{...author,requestKey:randomUUID()});assert.equal((await outbox()).sequence,'2');
    await reading.close();await delay(100); // A new connection on the same case verifies the prior reader reservation was released.
    phase='commit-barrier';const streamRow=await outbox();await barrier.query('BEGIN');held=true;
    await barrier.query('SELECT stream_id FROM usp_outbox_streams WHERE stream_id=$1 FOR UPDATE',[streamRow.stream_id]);
    const approval=decision(1),pending=api(path+`/recipes/${recipe.id}/approve`,200,approval);let blocked=false;
    for(let attempt=0;attempt<30;attempt++){const waiting=(await observer.query("SELECT count(*)::int count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%usp_outbox_streams%' AND application_name NOT LIKE 'ingest03-%'")).rows[0].count;if(waiting){blocked=true;break;}await delay(100);}
    assert(blocked,'Actual approval transaction did not reach the held outbox sequence lock.');
    assert.equal((await outbox()).sequence,'2');assert.equal((await observer.query('SELECT revision,state FROM usp_mapping_recipes WHERE id=$1',[recipe.id])).rows[0].state,'proposed');
    reading=await stream(caseId,'',{'Last-Event-ID':cursor});ready=await reading.next();assert.equal(ready.data.headCursor,cursor);
    await barrier.query('COMMIT');held=false;recipe=await pending;
    event=await reading.next();assert.equal(event.data.sequence,'3');assert.equal(event.data.change.status,'approved');cursor=event.id;
    assert.deepEqual(await api(path+`/recipes/${recipe.id}/approve`,200,approval),recipe);await api(path+`/recipes/${recipe.id}/approve`,409,decision(1));assert.equal((await outbox()).sequence,'3');
    receipt.checks.push('actual approval blocked at the transactional outbox lock remains invisible; after commit one ordered event appears; stale and replay mutations append no success event');
    const heartbeat=await reading.next(12000);assert.equal(heartbeat.comment,': heartbeat');assert.equal(heartbeat.id,undefined);
    await reading.close();await delay(100);
    phase='offline-execution';const execution=decision(2);recipe=await api(path+`/recipes/${recipe.id}/execute`,200,execution);assert.equal(recipe.state,'executed');
    reading=await stream(caseId,'',{'Last-Event-ID':cursor});ready=await reading.next();assert.equal(ready.id,cursor);
    event=await reading.next();assert.equal(event.data.sequence,'4');assert.equal(event.data.change.status,'executed');cursor=event.id;
    await reading.close();await delay(100);reading=await stream(caseId,'?cursor=0');await reading.next();
    const replay=[];for(let i=0;i<4;i++){const item=await reading.next();assert.equal(item.event,'ingestion.change');replay.push(item.data);}
    assert.deepEqual(replay.map(e=>e.sequence),['1','2','3','4']);assert.deepEqual(replay.map(e=>e.change.status),['needs_input','proposed','approved','executed']);
    assert.equal(new Set(replay.map(e=>JSON.stringify(e.change))).size,4);
    for(const item of replay){assert.equal(item.caseId,caseId);assert.equal(item.requiresRefresh,true);assert(Buffer.byteLength(JSON.stringify(item))<1024);
      for(const field of ['filename','geometry','body','sourceSha256','operatorSubject','provenance','snapshotId','manifestId'])assert(!JSON.stringify(item).includes('"'+field+'"'));}
    await reading.close();await delay(100);reading=await stream(caseId,'',{'Last-Event-ID':cursor});await reading.next();await reading.close();
    receipt.checks.push('decimal Last-Event-ID reconnect with a fixed first cursor and after offline execution; explicit cursor=0 returns four ordered unique logical mutations; no source bytes/provenance/registry snapshots; heartbeat has no ID; cross-case, malformed, backwards-conflicting and ahead cursors reject');
    phase='disconnect-cleanup';await delay(650);
    receipt.counts=(await observer.query(`SELECT (SELECT count(*)::int FROM usp_outbox WHERE stream_id=$1) events,
      (SELECT count(*)::int FROM usp_outbox_streams WHERE stream_id=$1) streams,
      (SELECT count(*)::int FROM sources WHERE case_id=$2) sources,
      (SELECT count(*)::int FROM usp_mapping_recipe_revisions WHERE recipe_id=$3) "recipeRevisions",
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND application_name NOT LIKE 'ingest03-%') "idleReaderTransactions",
      (SELECT count(*)::int FROM usp_model_calls) "modelCalls"`,[streamRow.stream_id,caseId,recipe.id])).rows[0];
    assert.deepEqual(receipt.counts,{events:4,streams:1,sources:1,recipeRevisions:3,idleReaderTransactions:0,modelCalls:0});
    receipt.lastEventId=cursor;receipt.checks.push('disconnect permits a new same-case reader and leaves no idle reader transaction; one canonical original, three recipe revisions, one reused outbox and no model calls');
    receipt.status='passed';writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({status:receipt.status,codeCommit:receipt.codeCommit,checks:receipt.checks.length,counts:receipt.counts,receipt:output}));
  }catch(error){receipt.status='failed';receipt.phase=phase;receipt.failure='Guarded event journey failed; inspect private output without exporting configuration.';writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});throw error;}
  finally{for(const stream of streams)await stream.close();if(held)await barrier.query('ROLLBACK').catch(()=>{});await barrier.end();await observer.end();}
}
run().catch(error=>{console.error(JSON.stringify({status:'failed',name:error.name,message:error.message}));process.exitCode=1;});
