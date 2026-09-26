import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { CaseIngestionOutboxSchema } from '../packages/contracts/src/usp/ingestion-events';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { ingestionBinding, ingestionCursor, parseIngestionCursor, reserveIngestionReader, assertIngestionBinding } from '../packages/server/src/modules/usp/ingestion/events';
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

test('reader reservations and backpressure release on disconnect without queued frames',async()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='ingestion-disconnect-control';
  try {
    const binding=ingestionBinding(randomUUID()),release=reserveIngestionReader(binding);
    assert.throws(()=>reserveIngestionReader(ingestionBinding(binding.caseId)),(e:unknown)=>e instanceof AppError&&e.status===429);
    release();reserveIngestionReader(ingestionBinding(binding.caseId))();
    const emitter=new EventEmitter(),abort=new AbortController();
    const response=Object.assign(emitter,{destroyed:false,writableEnded:false,writableLength:0,write:()=>false}) as unknown as Response;
    const writing=writeIngestionFrame(response,': heartbeat\n\n',abort.signal,()=>{});
    abort.abort();await assert.rejects(writing);
    for(const name of ['drain','close','error'])assert.equal(emitter.listenerCount(name),0);
    await assert.rejects(writeIngestionFrame(response,'x'.repeat(2049),new AbortController().signal,()=>{}));
  } finally {if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
});
