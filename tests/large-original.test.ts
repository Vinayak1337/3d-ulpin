import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import type { Request, Response } from 'express';
import { LargeOriginalController } from '../apps/api/src/modules/ingestion/large-original.controller';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { LARGE_ORIGINAL_LIMITS, LARGE_ORIGINAL_V2_LIMITS, LargeUploadCreateSchema, LargeUploadPartSchema } from '../packages/contracts/src/usp/ingestion';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { readObject } from '../packages/server/src/infrastructure/storage';
import { readBoundedBytes } from '../apps/api/src/common/body';
import { LargeOriginalService, largeOriginalStorage, uploadQuotaRefusal, type UploadQuota }
  from '../packages/server/src/modules/usp/ingestion/large-original';
import { redactDerivative } from '../packages/server/src/modules/usp/ingest/redact';

test('large-original admission rejects unbounded bytes, object keys and unsafe filenames',()=>{
  const input={requestKey:randomUUID(),expectedCaseRevision:0,filename:'district_nwic_geojson.zip',mediaType:'application/zip',bytes:71238839,sha256:'44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37',
    provenance:{issuer:'National Water Informatics Centre',originalUrl:'https://nwdp.nwic.gov.in/',acquiredAt:'2026-09-26T08:44:40Z',permissionReference:'https://www.nwdp.nwic.gov.in/footer/copyrightPolicy',limitations:['Opaque byte receipt only']}};
  assert.equal(LargeUploadCreateSchema.safeParse(input).success,true);
  for(const changed of [{bytes:LARGE_ORIGINAL_LIMITS.maxOriginalBytes+1},{bytes:0},{filename:'../original.zip'},{filename:'original\r\n.zip'},{objectKey:'caller-selected'}])
    assert.equal(LargeUploadCreateSchema.safeParse({...input,...changed}).success,false);
});

test('v2 admission has an explicit 7 GiB and 896-part ceiling without widening v1',()=>{
  const input={requestKey:randomUUID(),expectedCaseRevision:0,filename:'district_nwic_geojson.zip',mediaType:'application/zip',
    sha256:'44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37',
    provenance:{issuer:'National Water Informatics Centre',originalUrl:'https://nwdp.nwic.gov.in/',acquiredAt:'2026-09-26T08:44:40Z',
      permissionReference:'https://www.nwdp.nwic.gov.in/footer/copyrightPolicy',limitations:['Opaque byte receipt only']}};
  assert.equal(LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes,7*1024**3);
  assert.equal(LARGE_ORIGINAL_V2_LIMITS.maxParts,Math.ceil(LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes/LARGE_ORIGINAL_V2_LIMITS.partBytes));
  assert.equal(LargeUploadCreateSchema.safeParse({...input,profile:'large-original/2',bytes:LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes}).success,true);
  assert.equal(LargeUploadCreateSchema.safeParse({...input,profile:'large-original/2',bytes:LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes+1}).success,false);
  assert.equal(LargeUploadCreateSchema.safeParse({...input,bytes:LARGE_ORIGINAL_LIMITS.maxOriginalBytes+1}).success,false);
  const part={requestKey:randomUUID(),expectedRevision:1,expectedCaseRevision:0,partNumber:896,sha256:input.sha256};
  assert.equal(LargeUploadPartSchema.safeParse(part).success,true);
  assert.equal(LargeUploadPartSchema.safeParse({...part,partNumber:897}).success,false);
});

test('legacy whole-byte reader refuses a large original before accessing storage',async()=>{
  await assert.rejects(readObject('large-originals/owned/source'),(error:unknown)=>error instanceof AppError && error.code==='STREAMING_ORIGINAL_REQUIRED');
});

test('bounded raw reader releases listeners on deadline and interrupted body',async()=>{
  const stream=new PassThrough() as IncomingMessage;stream.headers={};
  await assert.rejects(readBoundedBytes(stream,8,10),(error:unknown)=>error instanceof AppError && error.status===408);
  assert.equal(stream.listenerCount('data'),0);assert.equal(stream.listenerCount('aborted'),0);stream.destroy();
  const interrupted=new PassThrough() as IncomingMessage;interrupted.headers={};
  const reading=readBoundedBytes(interrupted,8,1000);interrupted.emit('aborted');
  await assert.rejects(reading,(error:unknown)=>error instanceof AppError && error.code==='INCOMPLETE_BODY');
  assert.equal(interrupted.listenerCount('data'),0);interrupted.destroy();
});

/**
 * Byte receipts over one unassigned case, in memory, with transactions: BEGIN keeps a copy of the rows
 * and ROLLBACK restores it. A statement matching `fault` throws once, as a crash inside the transaction would.
 */
function receiptPool(caseId:string){
  type Row=Record<string,any>;
  let db={case:{id:caseId,revision:0},uploads:[] as Row[],parts:[] as Row[],sources:[] as Row[],
    jobs:[] as Row[]},kept=db;
  let sequence=0;const control={fault:null as RegExp|null,expiredPart:false,db:()=>db};
  const result=(rows:Row[])=>({rows,rowCount:rows.length});
  const run=async(sql:string,values:any[]=[])=>{
    if(control.fault?.test(sql)){control.fault=null;throw new Error('crash inside the transaction');}
    const upload=()=>db.uploads.filter(row=>row.id===values[0]);
    const part=()=>db.parts.filter(row=>row.upload_id===values[0]&&row.part_number===values[1]);
    if(sql==='BEGIN'){kept=structuredClone(db);return result([]);}
    if(sql==='ROLLBACK'){db=kept;return result([]);}
    if(/^(COMMIT|SET)|pg_advisory_xact_lock|INSERT INTO usp_outbox/.test(sql))return result([]);
    if(/FROM (registry_case_feature_mappings|import_packages)/.test(sql))return result([]);
    if(sql.includes('FROM cases WHERE id=$1'))return result([db.case]);
    if(sql.startsWith('UPDATE cases SET revision=revision+1')){db.case.revision++;return result([]);}
    if(sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources'))return result(db.sources);
    if(sql.startsWith('SELECT id FROM sources'))return result([]);
    if(sql.startsWith('INSERT INTO sources')){
      db.sources.push({id:values[0],object_key:values[6],inspection:values[7]});return result([]);
    }
    if(sql.startsWith('UPDATE usp_outbox_streams'))return result([{sequence:String(++sequence)}]);
    if(sql.startsWith('SELECT * FROM usp_source_uploads WHERE case_id=$1 AND operator_subject'))return result([]);
    if(sql.includes('count(*) FILTER'))return result([{v1_receipts:db.uploads.length,v2_receipts:0,v1_active:0,
      v2_active:0,case_active:0,operator_active:0,v1_reserved:'0',v2_reserved:'0'}]);
    if(sql.startsWith('INSERT INTO usp_source_uploads')){
      const row={id:values[0],case_id:values[1],operator_subject:values[2],request_key:values[3],
        request_hash:values[4],revision:1,case_revision:values[5],state:'receiving',source_id:values[6],
        original_bytes:String(values[7]),body:values[8],expires_at:values[9],lease_token:null,lease_expires_at:null,
        finalize_attempts:0};
      db.uploads.push(row);return result([row]);
    }
    if(sql.startsWith('SELECT * FROM usp_source_uploads WHERE id=$1')
      ||sql.startsWith('SELECT case_id FROM usp_source_uploads WHERE id=$1'))return result(upload());
    if(sql.startsWith('SELECT id FROM usp_source_uploads WHERE case_id=$1'))return result(db.uploads.filter(row=>
      row.case_id===values[0]&&row.operator_subject===values[1]
      &&JSON.stringify(row.body.derivedLineage)===JSON.stringify(values[2])
      &&['receiving','finalizing','retained'].includes(row.state)));
    if(sql.startsWith('INSERT INTO jobs')){
      db.jobs.push({id:values[0],case_id:values[1],payload:values[4],status:'queued',attempts:0});return result([]);
    }
    if(sql.includes('FROM jobs WHERE id=$1'))return result(db.jobs.filter(row=>row.id===values[0]));
    if(sql.startsWith('UPDATE jobs SET status=')){
      Object.assign(db.jobs.find(row=>row.id===values[0])!,{status:/status='(\w+)'/.exec(sql)?.[1]??values[1]});
      return result([]);
    }
    if(sql.startsWith('UPDATE usp_source_uploads SET body=$2')){
      Object.assign(upload()[0]!,{body:values[1],lease_expires_at:values[2]});return result([]);
    }
    if(sql.startsWith('UPDATE usp_source_uploads SET')){
      Object.assign(upload()[0]!,{revision:values[1],case_revision:values[2],state:values[3],body:values[4],
        lease_token:values[5],lease_expires_at:values[6],finalize_attempts:values[7]});
      return result([]);
    }
    if(sql.startsWith('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 ORDER BY')
      ||sql.startsWith('SELECT object_key FROM usp_source_upload_parts'))
      return result(db.parts.filter(row=>row.upload_id===values[0]));
    if(sql.startsWith('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 AND part_number=$2'))
      return result(part());
    if(sql.includes("state='writing' AND lease_token=$3")){
      if(sql.startsWith('SELECT')&&control.expiredPart)return result([]);
      const rows=part().filter(row=>row.state==='writing'&&row.lease_token===values[2]);
      if(sql.startsWith('UPDATE'))rows.forEach(row=>Object.assign(row,
        {state:sql.includes("SET state='failed'")?'failed':'received',lease_token:null,lease_expires_at:null}));
      return result(rows);
    }
    if(sql.startsWith('SELECT 1 FROM usp_source_upload_parts')||sql.startsWith('SELECT part_number'))return result([]);
    if(sql.startsWith('INSERT INTO usp_source_upload_parts')){
      if(part()[0]){
        Object.assign(part()[0],{state:'writing',attempts:part()[0].attempts+1,
          lease_token:values[6],lease_expires_at:values[7]});
        return result([]);
      }
      db.parts.push({upload_id:values[0],part_number:values[1],request_key:values[2],sha256:values[3],
        bytes:values[4],object_key:values[5],state:'writing',attempts:1,lease_token:values[6],
        lease_expires_at:values[7]});
      return result([]);
    }
    throw new Error(`Statement outside this protocol: ${sql.slice(0,80)}`);
  };
  const pool={query:run,connect:async()=>({query:run,release:()=>undefined})};
  return {control,pool:pool as unknown as Pool};
}

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function receiptStorage(){
  const objects=new Map<string,Uint8Array>();
  const missing=Object.assign(new Error('missing'),{$metadata:{httpStatusCode:404}});
  return {...largeOriginalStorage,assertLargeOriginalStorageProfile:async()=>undefined,
    putPartObject:async(key:string,bytes:Uint8Array)=>{objects.set(key,bytes);},
    readPartObject:async(key:string)=>objects.get(key)!,
    putOriginalStream:async(key:string,body:Readable)=>{
      const chunks:Uint8Array[]=[];for await(const chunk of body)chunks.push(chunk);
      objects.set(key,Buffer.concat(chunks));
    },
    verifyObjectStream:async(key:string)=>{
      const bytes=objects.get(key);if(!bytes)throw missing;
      return {etag:'memory-etag',sha256:digest(bytes),bytes:bytes.length};
    },
    sealUploadObject:async()=>undefined,abortOriginalAssemblies:async()=>undefined,
  } as never as typeof largeOriginalStorage;
}

test('a layer lineage is stored with its large original; a finalize failing after the insert keeps neither',async()=>{
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT??='large-original-lineage';
  const caseId='10000000-0000-4000-8000-000000000004';
  const globals=globalThis as unknown as {ulpinPool?:Pool},prior=globals.ulpinPool;
  const {control,pool}=receiptPool(caseId);globals.ulpinPool=pool;
  try{
    const bytes=new Uint8Array(4096).map((_,index)=>index%241),sha=digest(bytes);
    const service=new LargeOriginalService(receiptStorage());
    const created=await service.create(caseId,{requestKey:randomUUID(),expectedCaseRevision:0,filename:'layer.geojson',
      mediaType:'application/octet-stream',sha256:sha,bytes:bytes.length,
      provenance:{origin:'not_stated',acquiredAt:'2026-10-20T00:00:00.000Z'}});
    const claim=await service.claimPart(caseId,created.id,{requestKey:randomUUID(),expectedRevision:created.revision,
      expectedCaseRevision:0,partNumber:1,sha256:sha});
    const received=await service.receivePart(claim,bytes);
    const lineage={version:'zip-layer/1',parentSourceId:randomUUID(),parentSourceRevision:1,parentSha256:'a'.repeat(64),
      parentItemId:randomUUID(),memberPath:'uttam/layer.geojson',ordinal:4,memberBytes:bytes.length,
      compressedBytes:bytes.length,crc32:7,memberSha256:sha};
    const finalize=(revision:number,archiveMember:unknown)=>service.finalize(caseId,created.id,{requestKey:randomUUID(),
      expectedRevision:revision,expectedCaseRevision:0,sha256:sha},archiveMember);
    // A lineage above the v2 transport ceiling is refused before any statement.
    await assert.rejects(finalize(received.revision,
      {...lineage,memberBytes:LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes+1}),
      (error:unknown)=>error instanceof Error&&error.name==='ZodError'&&/memberBytes/.test(error.message));
    // The publishing transaction fails after its source insert: no source, no lineage, no case revision.
    control.fault=/^UPDATE cases SET revision=revision\+1/;
    await assert.rejects(finalize(received.revision,lineage),/crash inside the transaction/);
    const reopened=await service.read(caseId,created.id);
    assert.deepEqual([control.db().sources.length,control.db().case.revision,reopened.state,reopened.lastError],
      [0,0,'receiving','FINALIZATION_INTERRUPTED']);
    const final=await finalize(reopened.revision,lineage);
    assert.equal(final?.state,'retained');
    assert.deepEqual(control.db().sources.map(source=>[source.id,source.inspection.archiveMember]),
      [[final?.source?.sourceId,lineage]]);
  }finally{globals.ulpinPool=prior;}
});

test('v2 archive lineage survives queued finalization, publication rollback and storage restart', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'large-original-lineage';
  const priorCapacity = process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES;
  process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES =
    String(LARGE_ORIGINAL_V2_LIMITS.maxStoredBytesIncludingTemporaryCopies);
  const caseId = randomUUID(), { control, pool } = receiptPool(caseId);
  const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
  globals.ulpinPool = pool;
  try {
    const bytes = Buffer.alloc(4096, 32), sha = digest(bytes);
    const storage = receiptStorage();
    let assembled = 0;
    storage.putOriginalMultipart = async (key, parts) => {
      const chunks: Uint8Array[] = [];
      for await (const part of parts) chunks.push(part.bytes);
      assembled++;
      await storage.putOriginalStream(key, PassThrough.from(Buffer.concat(chunks)), bytes.length,
        'application/octet-stream', sha);
      return {} as never;
    };
    const service = new LargeOriginalService(storage);
    const lineage = { version: 'zip-layer/1', parentSourceId: randomUUID(), parentSourceRevision: 3,
      parentSha256: 'a'.repeat(64), parentItemId: randomUUID(), memberPath: 'maps/layer.geojson',
      ordinal: 2, memberBytes: bytes.length, compressedBytes: bytes.length, crc32: 7, memberSha256: sha };
    const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
      profile: 'large-original/2', filename: 'layer.geojson', mediaType: 'application/octet-stream',
      bytes: bytes.length, sha256: sha, provenance: { origin: 'not_stated', acquiredAt: new Date().toISOString() } },
    lineage.parentSourceId, lineage);
    assert.deepEqual((await service.findDerived(caseId, lineage))?.id, created.id);
    const claim = await service.claimPart(caseId, created.id, { requestKey: randomUUID(),
      expectedRevision: created.revision, expectedCaseRevision: 0, partNumber: 1, sha256: sha });
    const received = await service.receivePart(claim, bytes);
    const input = { requestKey: randomUUID(), expectedRevision: received.revision,
      expectedCaseRevision: 0, sha256: sha };
    await assert.rejects(service.finalize(caseId, created.id, input, { ...lineage, ordinal: 9 }),
      { code: 'STALE_REVISION' });
    const queued = await service.finalize(caseId, created.id, input, lineage);
    assert.equal(queued?.state, 'finalizing');
    assert.equal(control.db().sources.length, 0, 'no source before the storage job');
    assert.deepEqual(control.db().uploads[0].body.derivedLineage, lineage);
    const jobId = queued!.finalization!.jobId;
    control.fault = /^UPDATE cases SET revision=revision\+1/;
    await service.runV2Job(jobId);
    assert.equal(control.db().sources.length, 0, 'publication rollback keeps neither source nor lineage');
    assert.equal(control.db().case.revision, 0);
    const restarted = new LargeOriginalService(storage);
    await restarted.runV2Job(jobId);
    const retained = await restarted.findDerived(caseId, lineage);
    assert.equal(retained?.state, 'retained');
    assert.equal(assembled, 1, 'restart verifies the immutable completed object, without replacing it');
    assert.deepEqual(control.db().sources[0].inspection.archiveMember, lineage);
    assert.equal(control.db().sources[0].inspection.largeOriginal.receiptVersion, 'large-original/2');
    await restarted.runV2Job(jobId);
    assert.equal(control.db().sources.length, 1);
  } finally {
    globals.ulpinPool = prior;
    if (priorCapacity === undefined) delete process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES;
    else process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES = priorCapacity;
  }
});

test('TC1: a table derivative\'s lineage is stored in the same insert as its large original',async()=>{
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT??='large-original-lineage';
  const caseId='10000000-0000-4000-8000-000000000005';
  const globals=globalThis as unknown as {ulpinPool?:Pool},prior=globals.ulpinPool;
  const {control,pool}=receiptPool(caseId);globals.ulpinPool=pool;
  try{
    const bytes=new Uint8Array(2048).map((_,index)=>index%239),sha=digest(bytes);
    const service=new LargeOriginalService(receiptStorage());
    const created=await service.create(caseId,{requestKey:randomUUID(),expectedCaseRevision:0,filename:'plots.geojson',
      mediaType:'application/octet-stream',sha256:sha,bytes:bytes.length,
      provenance:{origin:'not_stated',acquiredAt:'2026-10-22T00:00:00.000Z'}});
    const claim=await service.claimPart(caseId,created.id,{requestKey:randomUUID(),expectedRevision:created.revision,
      expectedCaseRevision:0,partNumber:1,sha256:sha});
    const received=await service.receivePart(claim,bytes);
    const lineage={version:'table-derivative/1',conversion:'table_rows_to_geojson@1',originalSourceId:randomUUID(),
      originalSourceRevision:1,originalSha256:'b'.repeat(64),originalItemId:randomUUID(),format:'csv',layer:'csv',
      coordinates:{kind:'wkt',column:1},crs:'EPSG:32643',crsSource:'officer_stated',features:2,notWritten:1,
      skipped:{not_wkt:1},
      locator:'Each feature names its table row in its tableRow member: sourceId, sourceRevision, sha256, row.'};
    const final=await service.finalize(caseId,created.id,{requestKey:randomUUID(),expectedRevision:received.revision,
      expectedCaseRevision:0,sha256:sha},lineage);
    assert.deepEqual(control.db().sources.map(source=>[source.id,source.inspection.tableDerivative,
      source.inspection.archiveMember]),[[final?.source?.sourceId,lineage,undefined]]);
  }finally{globals.ulpinPool=prior;}
});

test('an append upload survives sibling arrivals at admission, part receipt, assembly and publication', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'large-original-lineage';
  const caseId = randomUUID(), { control, pool } = receiptPool(caseId);
  const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
  globals.ulpinPool = pool;
  try {
    const bytes = new Uint8Array(2048), sha = digest(bytes), storage = receiptStorage();
    control.db().case.revision++;
    const service = new LargeOriginalService({ ...storage, readPartObject: async (...args) => {
      control.db().case.revision++;
      return storage.readPartObject(...args);
    } });
    const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
      filename: 'protocol.laz', mediaType: 'application/octet-stream', sha256: sha, bytes: bytes.length,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-24T00:00:00.000Z' } });
    control.db().case.revision++;
    const claim = await service.claimPart(caseId, created.id, { requestKey: randomUUID(),
      expectedRevision: created.revision, expectedCaseRevision: 0, partNumber: 1, sha256: sha });
    control.db().case.revision++;
    const received = await service.receivePart(claim, bytes);
    control.db().case.revision++;
    const final = await service.finalize(caseId, created.id, { requestKey: randomUUID(),
      expectedRevision: received.revision, expectedCaseRevision: 0, sha256: sha });
    assert.equal(final?.state, 'retained');
    assert.equal(final?.verifiedSha256, sha);
    assert.equal(control.db().sources.length, 1);
    assert.equal(control.db().case.revision, 7);
  } finally { globals.ulpinPool = prior; }
});

for (const changed of ['future revision', 'upload revision', 'access context'] as const) {
  test(`an append upload refuses ${changed} before storing bytes`, async () => {
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'large-original-lineage';
    const caseId = randomUUID(), { control, pool } = receiptPool(caseId);
    const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
    globals.ulpinPool = pool;
    let writes = 0;
    try {
      const storage = receiptStorage(), sha = digest(new Uint8Array(1));
      const service = new LargeOriginalService({ ...storage,
        putPartObject: async () => { writes++; }, putOriginalStream: async () => { writes++; } });
      const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
        filename: 'protocol.laz', mediaType: 'application/octet-stream', sha256: sha, bytes: 1,
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-24T00:00:00.000Z' } });
      if (changed === 'access context') control.db().uploads[0].body.accessSha256 = 'b'.repeat(64);
      const guard = { requestKey: randomUUID(), expectedCaseRevision: changed === 'future revision' ? 1 : 0,
        expectedRevision: changed === 'upload revision' ? created.revision + 1 : created.revision, sha256: sha };
      const code = changed === 'access context' ? 'INGESTION_ACCESS_CHANGED' : 'STALE_REVISION';
      await assert.rejects(service.claimPart(caseId, created.id, { ...guard, partNumber: 1 }), { code });
      await assert.rejects(service.finalize(caseId, created.id, guard), { code });
      assert.deepEqual([writes, control.db().parts.length, control.db().sources.length], [0, 0, 0]);
    } finally { globals.ulpinPool = prior; }
  });
}

/** The NWIC district GeoJSON ZIP (datasets.json) is the real original these quota cases reserve. */
const nwicBytes=71238839;
const idle:UploadQuota={held:0,caseHeld:0,operatorHeld:0,heldBytes:0,caseBytes:0,freesAt:null,caseFreesAt:null,
  operatorFreesAt:null,v1HeldBytes:0,v2HeldBytes:0,retainedBytes:0,leftoverBytes:0};

test('finished and aborted rehearsals in other cases leave the live drop every slot',()=>{
  const rehearsed={...idle,retainedBytes:200*nwicBytes};
  assert.equal(uploadQuotaRefusal(rehearsed,false,nwicBytes,0),null);
  const capacity=LARGE_ORIGINAL_V2_LIMITS.maxStoredBytesIncludingTemporaryCopies;
  assert.equal(uploadQuotaRefusal(rehearsed,true,nwicBytes,capacity),null);
  assert.equal('maxUploadReceipts' in LARGE_ORIGINAL_LIMITS||'maxUploadReceipts' in LARGE_ORIGINAL_V2_LIMITS,false);
});

test('open receipts at their limit are refused with the limit and when a slot frees, never a value of the file',()=>{
  const freesAt='2026-10-22T05:30:00.000Z';
  const full={...idle,held:LARGE_ORIGINAL_LIMITS.maxActiveGlobal,heldBytes:4*nwicBytes,freesAt};
  const refusal=uploadQuotaRefusal(full,false,nwicBytes,0);
  assert.deepEqual(refusal&&{limit:refusal.limit,freesAt:refusal.freesAt},{limit:'open_receipts',freesAt});
  assert.match(refusal!.message,/^4 large-original\/1 receipts are open on this service, its limit; a slot frees when/);
  assert.ok(refusal!.message.includes(freesAt));
  for(const value of [String(nwicBytes),'district_nwic_geojson','44c734cc'])
    assert.equal(refusal!.message.includes(value),false);
  const operator=uploadQuotaRefusal({...idle,operatorHeld:2,heldBytes:2*nwicBytes},false,nwicBytes,0);
  assert.deepEqual(operator&&[operator.limit,operator.freesAt],['open_receipts_operator',null]);
  assert.equal(uploadQuotaRefusal({...idle,held:1},true,nwicBytes,0)?.limit,'open_receipts');
});

test('a case that already retains seven of this original is refused by its per-case retained ceiling',()=>{
  const sixRetained={...idle,caseBytes:6*nwicBytes,retainedBytes:6*nwicBytes};
  assert.equal(uploadQuotaRefusal(sixRetained,false,nwicBytes,0),null);
  const seven=uploadQuotaRefusal({...sixRetained,caseBytes:7*nwicBytes},false,nwicBytes,0);
  assert.deepEqual(seven&&[seven.limit,seven.freesAt],['case_retained_bytes',null]);
  assert.match(seven!.message,/more than 512 MiB of large-original\/1 originals/);
  // A 7 GiB ceiling written as its 10-digit byte count was masked as a phone number in the 429 body.
  const v2=uploadQuotaRefusal({...idle,caseBytes:7*1024**3},true,nwicBytes,0)!;
  assert.equal(redactDerivative(v2.message),v2.message);assert.match(v2.message,/more than 7 GiB/);
});

test('configured storage counts retained originals once and only open receipts with their temporary copies',()=>{
  const capacity=LARGE_ORIGINAL_V2_LIMITS.maxStoredBytesIncludingTemporaryCopies,gib=1024**3;
  // The earlier sum tripled every original ever reserved: 7 GiB retained alone came to 21 of 22 GiB.
  assert.equal(uploadQuotaRefusal({...idle,retainedBytes:7*gib},true,4*gib,capacity),null);
  const stale=uploadQuotaRefusal({...idle,retainedBytes:7*gib,leftoverBytes:4*gib},true,4*gib,capacity);
  assert.deepEqual(stale&&[stale.limit,stale.freesAt],['storage_capacity',null]);
  assert.equal(uploadQuotaRefusal({...idle,v2HeldBytes:6*gib},false,nwicBytes,capacity),null);
});

for (const limit of ['open_receipts', 'open_receipts_case', 'open_receipts_operator',
  'open_bytes', 'case_retained_bytes', 'storage_capacity', 'PART_ATTEMPTS']) {
  test(`create route answers ${limit} without changing other quota refusals`, async () => {
    const slot = limit.startsWith('open_receipts');
    const freesAt = '2026-10-29T12:00:00.000Z';
    const refusal = new AppError(429, limit === 'PART_ATTEMPTS' ? limit : 'UPLOAD_QUOTA',
      'Original refusal words.', { limit, freesAt });
    const service = { create: async () => { throw refusal; } } as unknown as LargeOriginalService;
    const stream = new PassThrough();
    const request = Object.assign(stream, { headers: { 'content-type': 'application/json' } });
    let status = 201;
    const response = { status: (value: number) => { status = value; } } as Response;
    const answer = new LargeOriginalController(service).create(randomUUID(), request as unknown as Request, response);
    stream.end('{}');
    if (slot) {
      assert.deepEqual(await answer, { state: 'waiting', limit, freesAt });
      assert.equal(status, 202);
    } else {
      await assert.rejects(answer, error => error === refusal);
      assert.equal(status, 201, 'the error handler receives the original refusal unchanged');
    }
  });
}

async function refusedPart(service: LargeOriginalService, receipt: { id: string; caseId: string; revision: number },
  bytes: Buffer, path: string, t: TestContext) {
  const requestKey = randomUUID(), stream = new PassThrough();
  const headers = { 'content-type': 'application/octet-stream', 'x-request-key': requestKey,
    'x-upload-revision': String(receipt.revision), 'x-case-revision': '0', 'x-part-sha256': digest(bytes) };
  const request = Object.assign(stream, { headers,
    header: (name: string) => headers[name as keyof typeof headers] });
  if (path === 'body timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
  let caught: Error | undefined;
  try {
    const operation = new LargeOriginalController(service).part(receipt.caseId, receipt.id, '1',
      request as unknown as Request);
    const rejected = assert.rejects(operation, (error: Error) => { caught = error; return true; });
    await setImmediate();
    if (path === 'body timeout') t.mock.timers.tick(LARGE_ORIGINAL_LIMITS.partRequestSeconds * 1000);
    else stream.end(path === 'integrity' ? Buffer.from('wrong bytes') : bytes);
    await rejected;
    return { requestKey, error: caught! };
  } finally { stream.destroy(); }
}

for (const path of ['body timeout', 'integrity', 'lease conflict', 'storage failure', 'accept failure']) {
  test(`part route records ${path} detail under its lease and shows it in status`, async t => {
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'large-original-part-failure';
    const caseId = randomUUID(), { control, pool } = receiptPool(caseId);
    const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
    globals.ulpinPool = pool;
    const storage = receiptStorage(), put = storage.putPartObject;
    const storageError = Object.assign(new Error('Storage refused the part. '.repeat(12)), { name: 'AbortError' });
    if (path === 'storage failure') storage.putPartObject = async () => { throw storageError; };
    const service = new LargeOriginalService(storage), bytes = Buffer.from('test_only byte transport');
    try {
      const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
        filename: 'part.tif', mediaType: 'application/octet-stream', bytes: bytes.length, sha256: digest(bytes),
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-23T00:00:00Z' } });
      if (path === 'lease conflict') control.expiredPart = true;
      if (path === 'accept failure') control.fault = /^UPDATE usp_source_upload_parts SET state='received'/;
      const { requestKey, error } = await refusedPart(service, created, bytes, path, t);
      const code = error instanceof AppError ? error.code : error.name;
      assert.equal(code, { 'body timeout': 'BODY_TIMEOUT', integrity: 'PART_INTEGRITY',
        'lease conflict': 'STALE_REVISION', 'storage failure': 'AbortError', 'accept failure': 'Error' }[path]);
      const detail = { code, message: error.message.slice(0, 200) };
      assert.deepEqual(control.db().uploads[0].body.lastErrorDetail, detail);
      const status = await service.read(caseId, created.id);
      assert.equal(status.parts[0].state, 'failed');
      assert.equal(status.parts[0].attempts, 1);
      assert.equal(status.lastError, `PART_INTERRUPTED_OR_REJECTED: ${code}: ${detail.message}`);
      // A stale producer cannot replace the explanation of the attempt that owns the row.
      const claim = { uploadId: created.id, input: { partNumber: 1 }, token: randomUUID() };
      await service.failPart(claim as never, new Error('superseded producer'));
      assert.equal((await service.read(caseId, created.id)).lastError, status.lastError);
      control.expiredPart = false;
      storage.putPartObject = put;
      const retry = await service.claimPart(caseId, created.id, { requestKey, partNumber: 1, sha256: digest(bytes),
        expectedRevision: status.revision, expectedCaseRevision: status.currentCaseRevision });
      const received = await service.receivePart(retry, bytes);
      assert.equal(received.parts[0].state, 'received');
      assert.equal(received.parts[0].attempts, 2);
      assert.equal(received.lastError, null);
    } finally { globals.ulpinPool = prior; }
  });
}
