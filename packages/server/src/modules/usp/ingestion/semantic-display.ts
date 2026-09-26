import type {PoolClient} from 'pg';
import {z} from 'zod';
import {ProjectedChunkPinSchema,type SemanticDisplayPhase} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {projectedContextTx,assertProjectedInput} from './projected-vector';
import {displayReservationTx,displayOutcomeTx} from './semantic-chunks';
import {enqueuePrivateMvtTx} from '../tiles/service';
import {mvtTransaction,assertMvtDeadline} from '../tiles/bounds';
import {runPrivateMvtJob} from '../tiles/publication';
type Pin=z.infer<typeof ProjectedChunkPinSchema>;
/** Caller holds the tile advisory lock before source and attempt locks. Creation
 * and capacity consumption share the canonical job transaction, including final adoption. */
export async function createSemanticDisplayTx(client:PoolClient,job:any,phase:SemanticDisplayPhase,pin:Pin|undefined,deadline:number){
  assertMvtDeadline(deadline);
  const reservation=await displayReservationTx(client,job),outcome=reservation.outcomes[phase];
  if(outcome.state!=='reserved')return outcome.state==='created'?outcome.jobId:null;
  await client.query('SAVEPOINT semantic_display');
  try{
    const ctx=await projectedContextTx(client,job.case_id,job.source_id,true),input=assertProjectedInput(ctx,job.payload);
    const status=await enqueuePrivateMvtTx(client,job.case_id,job.source_id,{requestKey:reservation.slots[phase],expectedCaseRevision:input.caseRevision,
      expectedSourceRevision:input.sourceRevision,admissionJobId:job.id,window:null,expectedGeneration:ctx.source.inspection.privateMvt?.accepted??null,
      ...(pin?{chunk:pin}:{} )},{parentJobId:job.id,phase,jobId:reservation.slots[phase]});
    await displayOutcomeTx(client,job,phase,{state:'created',jobId:status.jobId});
    assertMvtDeadline(deadline);await client.query('RELEASE SAVEPOINT semantic_display');return status.jobId;
  }catch(error){
    await client.query('ROLLBACK TO SAVEPOINT semantic_display');await client.query('RELEASE SAVEPOINT semantic_display');
    assertMvtDeadline(deadline);
    // Display failure does not change already verified semantic validity.
    await displayOutcomeTx(client,job,phase,{state:'unavailable',code:error instanceof AppError?error.code:'MVT_DISPLAY_UNAVAILABLE'});return null;
  }
}
export async function runSemanticDisplay(job:any,attempt:UspJobAttempt,phase:'early'|'middle',pin:Pin,deadline:number){
  const child=await mvtTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))");
    const ctx=await projectedContextTx(client,job.case_id,job.source_id,true);assertProjectedInput(ctx,job.payload);
    if(ctx.source.inspection.projectedVector?.currentJobId!==job.id)throw new AppError(409,'PROJECTED_CONTEXT_STALE','Source job was superseded.');
    await assertUspJobAttemptTx(client,attempt);
    return createSemanticDisplayTx(client,job,phase,pin,deadline);
  },deadline);
  if(child)await runPrivateMvtJob(child,deadline);
  assertMvtDeadline(deadline);
}
