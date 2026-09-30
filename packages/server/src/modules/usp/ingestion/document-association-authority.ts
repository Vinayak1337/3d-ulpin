import type {DocumentAssociationSource} from '@ulpin/contracts';
import type {PoolClient} from 'pg';
import {DocumentInputSchema,type DocumentInput,type RequestContext} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {conflict,notFound} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {assertLocalUsp} from '../snapshots';
import {assertDocumentInputTx} from './document-context';
import {assertDocumentAcceptedResultTx} from './documents';

/** Uses the canonical source/job/attempt authority, without original I/O or writes. */
export async function associationDocumentInput(ctx:RequestContext,pin:DocumentAssociationSource,expected?:DocumentInput){
  assertLocalUsp(ctx);
  return transaction(async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return associationDocumentInputTx(client,ctx,pin,expected);
  });
}
/** Caller-owned transaction, also used by canonical registry review/commit. */
export async function associationDocumentInputTx(client:PoolClient,ctx:RequestContext,pin:DocumentAssociationSource,
  expected?:DocumentInput,lock=false){
    assertLocalUsp(ctx);
    const job=(await client.query(`SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3
      AND operation='document-extraction'`,[pin.jobId,pin.caseId,pin.sourceId])).rows[0]??notFound('Document job unavailable.');
    const input=DocumentInputSchema.parse(job.payload);
    await assertDocumentInputTx(client,input,lock);
    if(lock){
      const locked=(await client.query('SELECT payload FROM jobs WHERE id=$1 FOR SHARE',[pin.jobId])).rows[0];
      if(!locked||fingerprint(locked.payload)!==fingerprint(input))conflict('The registered document job input changed.');
      await client.query('SELECT id FROM sources WHERE id=$1 FOR SHARE',[pin.sourceId]);
      await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR SHARE',[pin.jobId]);
      await client.query('SELECT job_id FROM usp_job_attempts WHERE job_id=$1 FOR SHARE',[pin.jobId]);
    }
    if(input.jobId!==pin.jobId || input.caseId!==pin.caseId || input.sourceId!==pin.sourceId ||
      input.caseRevision!==pin.caseRevision || input.sourceRevision!==pin.sourceRevision ||
      input.sourceSha256!==pin.sourceSha256 || (expected && fingerprint(input)!==fingerprint(expected)))
      conflict('The exact document source/job pins changed.');
    await assertDocumentAcceptedResultTx(client,input,pin.resultSha256);
    assertLocalUsp(ctx);return input;
}
