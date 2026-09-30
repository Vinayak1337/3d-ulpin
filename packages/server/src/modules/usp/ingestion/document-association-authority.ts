import type {DocumentAssociationSource} from '@ulpin/contracts';
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
    const job=(await client.query(`SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3
      AND operation='document-extraction'`,[pin.jobId,pin.caseId,pin.sourceId])).rows[0]??notFound('Document job unavailable.');
    const input=DocumentInputSchema.parse(job.payload);
    await assertDocumentInputTx(client,input);
    if(input.jobId!==pin.jobId || input.caseId!==pin.caseId || input.sourceId!==pin.sourceId ||
      input.caseRevision!==pin.caseRevision || input.sourceRevision!==pin.sourceRevision ||
      input.sourceSha256!==pin.sourceSha256 || (expected && fingerprint(input)!==fingerprint(expected)))
      conflict('The exact document source/job pins changed.');
    await assertDocumentAcceptedResultTx(client,input,pin.resultSha256);
    assertLocalUsp(ctx);return input;
  });
}
