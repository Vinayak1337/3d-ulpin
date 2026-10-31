import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { CaseIngestionOutboxSchema } from '../packages/contracts/src/usp/ingestion-events';
import { STREAMED_PROFILE_LIMITS } from '../packages/contracts/src/usp/streamed-profile';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { ingestionBinding, ingestionCursor, parseIngestionCursor, reserveIngestionReader, assertIngestionBinding, INGESTION_EVENT_LIMITS } from '../packages/server/src/modules/usp/ingestion/events';
import { writeIngestionFrame } from '../apps/api/src/modules/ingestion/events.transport';

test('case/access-bound decimal cursors reject cross-case, malformed and conflicting replay',()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='ingestion-protocol-control';
  try {
    const binding=ingestionBinding(randomUUID()),other=ingestionBinding(randomUUID()),maximum=9223372036854775807n;
    assert.equal(parseIngestionCursor(binding),undefined);
    assert.equal(parseIngestionCursor(binding,'0'),0n);
    assert.equal(parseIngestionCursor(binding,'0',ingestionCursor(binding,2n)),2n);
    assert.equal(parseIngestionCursor(binding,ingestionCursor(binding,1n),ingestionCursor(binding,2n)),2n);
    assert.equal(parseIngestionCursor(binding,ingestionCursor(binding,maximum)),maximum);
    assert.equal(ingestionCursor(ingestionBinding(binding.caseId.toUpperCase()),1n),ingestionCursor(binding,1n));
    for(const input of ['', '01', '-1', '1.1', '1e2','9'.repeat(98)])
      assert.throws(()=>parseIngestionCursor(binding,input),(e:unknown)=>e instanceof AppError&&e.status===422);
    assert.throws(()=>parseIngestionCursor(binding,ingestionCursor(other,1n)),(e:unknown)=>e instanceof AppError&&e.code==='INGESTION_CURSOR_SCOPE');
    assert.throws(()=>parseIngestionCursor(binding,undefined,'0'));
    assert.throws(()=>parseIngestionCursor(binding,ingestionCursor(binding,2n),ingestionCursor(binding,1n)),(e:unknown)=>e instanceof AppError&&e.code==='INGESTION_CURSOR_CONFLICT');
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='changed-ingestion-protocol-control';
    assert.throws(()=>assertIngestionBinding(binding),(e:unknown)=>e instanceof AppError&&e.status===403);
  } finally { if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous; }
});

test('case ingestion envelope rejects old registry bodies and extra source payload fields',()=>{
  const body={version:'case-ingestion/1',caseId:randomUUID(),caseRevision:0,
    change:{kind:'source.retained',sourceId:randomUUID(),sourceRevision:1,status:'needs_input'}};
  assert.equal(CaseIngestionOutboxSchema.safeParse(body).success,true);
  for(const extra of [{filename:'original.geojson'},{bytes:123},{provenance:{issuer:'text'}},{geometry:[]},{snapshotId:randomUUID()}])
    assert.equal(CaseIngestionOutboxSchema.safeParse({...body,change:{...body.change,...extra}}).success,false);
  assert.equal(CaseIngestionOutboxSchema.safeParse({streamId:'registry:control',type:'prepared',scope:{},manifestId:randomUUID(),correlationId:randomUUID()}).success,false);
});

test('a profile generation event is valid for every generation a full 5000-part read can seal',()=>{
  const generation=(n:number)=>({version:'case-ingestion/1',caseId:randomUUID(),caseRevision:0,
    change:{kind:'streamed-profile.generation',sourceId:randomUUID(),sourceRevision:1,jobId:randomUUID(),rawJobId:randomUUID(),
      generation:n,generationHash:'a'.repeat(64),coverage:'provisional',recordsSeen:n*100}});
  for(const n of [0,4097,4098,STREAMED_PROFILE_LIMITS.generations])
    assert.equal(CaseIngestionOutboxSchema.safeParse(generation(n)).success,true,`generation ${n}`);
  assert.equal(CaseIngestionOutboxSchema.safeParse(generation(STREAMED_PROFILE_LIMITS.generations+1)).success,false);
});

test('a ninth reader across batches meets the operator bound, and release frees its place',()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='reservation-operator-control';
  const releases:Array<()=>void>=[];
  try {
    for(let index=0;index<INGESTION_EVENT_LIMITS.perOperator;index++)
      releases.push(reserveIngestionReader(ingestionBinding(randomUUID(),'reservation-operator-control')));
    assert.equal(releases.length,8);
    assert.throws(()=>reserveIngestionReader(ingestionBinding(randomUUID(),'reservation-operator-control')),
      {status:429,code:'INGESTION_STREAM_LIMIT',
        message:'At most 8 pages can follow batches live for one operator. Close one of them.'});
    releases.pop()!();
    releases.push(reserveIngestionReader(ingestionBinding(randomUUID(),'reservation-operator-control')));
  } finally {
    for(const release of releases)release();
    if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;
  }
});

test('the total server bound uses the prescribed operator words and leaves other limits unchanged',()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='reservation-total-control';
  assert.deepEqual(INGESTION_EVENT_LIMITS,{connections:16,perOperator:8,perCase:4,page:32,replay:256,sources:256,
    eventBytes:1024,frameBytes:2048,bufferBytes:4096,pollMs:500,heartbeatMs:10000,durationMs:60000,
    writeMs:2000,statementMs:2000,readMs:6000,reads:121});
  const releases:Array<()=>void>=[];
  try {
    for(let index=0;index<INGESTION_EVENT_LIMITS.connections;index++)
      releases.push(reserveIngestionReader(ingestionBinding(randomUUID(),`reservation-total-${index}`)));
    assert.throws(()=>reserveIngestionReader(ingestionBinding(randomUUID(),'reservation-total-next')),
      {status:429,code:'INGESTION_STREAM_LIMIT',
        message:'At most 8 pages can follow batches live for one operator. Close one of them.'});
  } finally {
    for(const release of releases)release();
    if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;
  }
});

test('reader reservations and backpressure release on disconnect without queued frames',async()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='ingestion-disconnect-control';
  try {
    const binding=ingestionBinding(randomUUID()),releases:Array<()=>void>=[];
    try {
      for(let index=0;index<INGESTION_EVENT_LIMITS.perCase;index++)
        releases.push(reserveIngestionReader(ingestionBinding(binding.caseId)));
      assert.equal(releases.length,4);
      assert.throws(()=>reserveIngestionReader(ingestionBinding(binding.caseId)),{status:429,
        code:'INGESTION_STREAM_LIMIT',message:'At most 4 pages can follow one batch live. Close another page that shows this batch; this page keeps what it has already shown.'});
      releases.pop()!();
      releases.push(reserveIngestionReader(ingestionBinding(binding.caseId)));
    } finally {for(const release of releases)release();}
    const emitter=new EventEmitter(),abort=new AbortController();
    const response=Object.assign(emitter,{destroyed:false,writableEnded:false,writableLength:0,write:()=>false}) as unknown as Response;
    const writing=writeIngestionFrame(response,': heartbeat\n\n',abort.signal,()=>{});
    abort.abort();await assert.rejects(writing);
    for(const name of ['drain','close','error'])assert.equal(emitter.listenerCount(name),0);
    await assert.rejects(writeIngestionFrame(response,'x'.repeat(2049),new AbortController().signal,()=>{}));
  } finally {if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
});
