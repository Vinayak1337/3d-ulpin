import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { LARGE_ORIGINAL_LIMITS, LARGE_ORIGINAL_V2_LIMITS, LargeUploadCreateSchema, LargeUploadPartSchema } from '../packages/contracts/src/usp/ingestion';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { readObject } from '../packages/server/src/infrastructure/storage';
import { readBoundedBytes } from '../apps/api/src/common/body';
import { uploadQuotaRefusal, type UploadQuota } from '../packages/server/src/modules/usp/ingestion/large-original';
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
