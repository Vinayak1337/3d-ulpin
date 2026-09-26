import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { LARGE_ORIGINAL_LIMITS as limits } from '@ulpin/contracts/usp';
import { query } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import { openObjectStream,verifyObjectStream } from '../../../infrastructure/storage';
import { localOperatorSubject } from '../principal';

let readers=0;
async function authorized(id:string){
  const row=(await query(`SELECT s.*,u.state upload_state,u.operator_subject,u.body upload_body,c.revision case_revision
    FROM sources s JOIN usp_source_uploads u ON u.source_id=s.id AND u.case_id=s.case_id JOIN cases c ON c.id=s.case_id
    WHERE s.id=$1`,[id])).rows[0];
  if(!row || row.profile!=='large-original-v1' || row.upload_state!=='retained'
    || row.operator_subject!==localOperatorSubject())throw new AppError(403,'SOURCE_CONTEXT','The retained source is not available in this current local operator/case context.');
  const evidence=row.inspection?.largeOriginal;
  if(!evidence || evidence.verifiedSha256!==row.sha256 || Number(evidence.verifiedBytes)!==Number(row.bytes)
    || row.object_key!==`large-originals/${id}/${row.sha256}` || !evidence.objectEtag
    || row.upload_body.verified?.etag!==evidence.objectEtag || row.upload_body.verified?.sha256!==row.sha256
    || Number(row.upload_body.verified?.bytes)!==Number(row.bytes))
    throw new AppError(422,'SOURCE_INTEGRITY','The retained source/object pins do not match their verified receipt.');
  return row;
}
/** Two bounded reads: recompute before headers, then stream the same sealed identity. */
export async function largeOriginalDownload(id:string,signal:AbortSignal){
  if(readers>=limits.maxConcurrentDownloads)throw new AppError(429,'SOURCE_DOWNLOAD_LIMIT','The bounded original-download allowance is full.');
  readers++;let released=false;
  const release=()=>{if(!released){released=true;readers--;}};
  signal=AbortSignal.any([signal,AbortSignal.timeout(limits.downloadSeconds*1000)]);
  let object:Awaited<ReturnType<typeof openObjectStream>>|undefined;
  try{
    const before=await authorized(id),bytes=Number(before.bytes);
    await verifyObjectStream(before.object_key,bytes,before.sha256,limits.downloadSeconds*1000,before.inspection.largeOriginal.objectEtag,signal);
    // Scope/state may have changed while hashing. Recheck before opening the second conditional read or headers.
    const current=await authorized(id);
    if(current.case_id!==before.case_id || current.case_revision!==before.case_revision || current.revision!==before.revision
      || current.sha256!==before.sha256 || current.object_key!==before.object_key
      || current.inspection.largeOriginal.objectEtag!==before.inspection.largeOriginal.objectEtag)
      throw new AppError(409,'SOURCE_CONTEXT_CHANGED','The source/case context changed during integrity preflight.');
    object=await openObjectStream(current.object_key,bytes,limits.downloadSeconds*1000,current.inspection.largeOriginal.objectEtag,signal);
    const hash=createHash('sha256');let count=0;
    const integrity=new Transform({transform(chunk:Buffer,_encoding,done){count+=chunk.length;if(count>bytes){done(new AppError(422,'SOURCE_INTEGRITY','Streamed bytes exceed the original receipt.'));return;}hash.update(chunk);done(null,chunk);},
      flush(done){if(count!==bytes||hash.digest('hex')!==current.sha256)done(new AppError(422,'SOURCE_INTEGRITY','Streamed original failed its final hash/size check.'));else done();}});
    return {body:object.body,integrity,name:current.name,mimeType:current.mime_type,bytes,sha256:current.sha256,
      close(){object?.body.destroy();integrity.destroy();release();}};
  }catch(error){object?.body.destroy();release();throw error;}
}
