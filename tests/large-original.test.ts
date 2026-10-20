import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { LARGE_ORIGINAL_LIMITS, LARGE_ORIGINAL_V2_LIMITS, LargeUploadCreateSchema, LargeUploadPartSchema } from '../packages/contracts/src/usp/ingestion';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { readObject } from '../packages/server/src/infrastructure/storage';
import { readBoundedBytes } from '../apps/api/src/common/body';
import { STREAMING_VECTOR_LIMITS } from '../packages/contracts/src/usp/streaming-vector';
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
 * ZL2. One v1 byte receipt over one unassigned case, in memory, with transactions: BEGIN keeps a copy of the rows
 * and ROLLBACK restores it. A statement matching `fault` throws once, as a crash inside the transaction would.
 */
function receiptPool(caseId:string){
  type Row=Record<string,any>;
  let db={case:{id:caseId,revision:0},uploads:[] as Row[],parts:[] as Row[],sources:[] as Row[]},kept=db;
  let sequence=0;const control={fault:null as RegExp|null,db:()=>db};
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
    if(sql.includes('FROM usp_source_uploads WHERE case_id=$1 AND operator_subject'))return result([]);
    if(sql.includes('count(*) FILTER'))return result([{v1_receipts:db.uploads.length,v2_receipts:0,v1_active:0,
      v2_active:0,case_active:0,operator_active:0,v1_reserved:'0',v2_reserved:'0'}]);
    if(sql.startsWith('INSERT INTO usp_source_uploads')){
      const row={id:values[0],case_id:values[1],operator_subject:values[2],request_key:values[3],
        request_hash:values[4],revision:1,case_revision:values[5],state:'receiving',source_id:values[6],
        original_bytes:String(values[7]),body:values[8],expires_at:values[9],lease_token:null,lease_expires_at:null,
        finalize_attempts:0};
      db.uploads.push(row);return result([row]);
    }
    if(sql.startsWith('SELECT * FROM usp_source_uploads WHERE id=$1'))return result(upload());
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
      const rows=part().filter(row=>row.state==='writing'&&row.lease_token===values[2]);
      if(sql.startsWith('UPDATE'))rows.forEach(row=>Object.assign(row,{state:'received',lease_token:null}));
      return result(rows);
    }
    if(sql.startsWith('SELECT 1 FROM usp_source_upload_parts')||sql.startsWith('SELECT part_number'))return result([]);
    if(sql.startsWith('INSERT INTO usp_source_upload_parts')){
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
    // A malformed lineage, here a member above the large reader's ceiling, is refused before any statement.
    await assert.rejects(finalize(received.revision,{...lineage,memberBytes:STREAMING_VECTOR_LIMITS.sourceBytes+1}),
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
