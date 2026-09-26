import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { LARGE_ORIGINAL_LIMITS, LargeUploadCreateSchema } from '../packages/contracts/src/usp/ingestion';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { readObject } from '../packages/server/src/infrastructure/storage';
import { readBoundedBytes } from '../apps/api/src/common/body';

test('large-original admission rejects unbounded bytes, object keys and unsafe filenames',()=>{
  const input={requestKey:randomUUID(),expectedCaseRevision:0,filename:'district_nwic_geojson.zip',mediaType:'application/zip',bytes:71238839,sha256:'44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37',
    provenance:{issuer:'National Water Informatics Centre',originalUrl:'https://nwdp.nwic.gov.in/',acquiredAt:'2026-09-26T08:44:40Z',permissionReference:'https://www.nwdp.nwic.gov.in/footer/copyrightPolicy',limitations:['Opaque byte receipt only']}};
  assert.equal(LargeUploadCreateSchema.safeParse(input).success,true);
  for(const changed of [{bytes:LARGE_ORIGINAL_LIMITS.maxOriginalBytes+1},{bytes:16*1024*1024},{filename:'../original.zip'},{filename:'original\r\n.zip'},{objectKey:'caller-selected'}])
    assert.equal(LargeUploadCreateSchema.safeParse({...input,...changed}).success,false);
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
