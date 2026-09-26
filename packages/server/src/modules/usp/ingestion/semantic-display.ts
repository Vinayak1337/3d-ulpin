import type {PoolClient} from 'pg';
import {z} from 'zod';
import {SEMANTIC_CHUNK_PROFILE,ProjectedChunkPinSchema,type SemanticDisplayPhase} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {projectedContextTx,assertProjectedInput} from './projected-vector';
import {displayReservationTx,displayOutcomeTx} from './semantic-chunks';
import {enqueuePrivateMvtTx} from '../tiles/service';
import {mvtTransaction,mvtBoundsTx,assertMvtDeadline} from '../tiles/bounds';
import {runPrivateMvtJob} from '../tiles/publication';
type Pin=z.infer<typeof ProjectedChunkPinSchema>;
const budget=()=>SEMANTIC_CHUNK_PROFILE.chunkMs;
const childDeadline=(parentDeadline:number)=>Math.min(Date.now()+budget(),parentDeadline);
function displayCode(error:unknown){
  if(error instanceof AppError)return error.code==='MVT_JOB_TIMEOUT'?'MVT_DISPLAY_TIMEOUT':error.code;
  const code=(error as {code?:unknown})?.code;
  return code==='55P03'?'MVT_DISPLAY_LOCK_TIMEOUT':code==='57014'?'MVT_DISPLAY_SQL_TIMEOUT':'MVT_DISPLAY_UNAVAILABLE';
}
/** Caller holds the tile advisory lock before source and attempt locks. Creation
 * and capacity consumption share the canonical job transaction, including final adoption. */
async function createSemanticDisplayTx(client:PoolClient,job:any,phase:SemanticDisplayPhase,pin:Pin|undefined,deadline:number){
  assertMvtDeadline(deadline);
  const reservation=await displayReservationTx(client,job),outcome=reservation.outcomes[phase];
  if(outcome.state!=='reserved')return outcome.state==='created'?outcome.jobId:null;
  await client.query('SAVEPOINT semantic_display');
  try{
    const ctx=await projectedContextTx(client,job.case_id,job.source_id,true),input=assertProjectedInput(ctx,job.payload);
    assertMvtDeadline(deadline);
    const status=await enqueuePrivateMvtTx(client,job.case_id,job.source_id,{requestKey:reservation.slots[phase],expectedCaseRevision:input.caseRevision,
      expectedSourceRevision:input.sourceRevision,admissionJobId:job.id,window:null,expectedGeneration:ctx.source.inspection.privateMvt?.accepted??null,
      ...(pin?{chunk:pin}:{})},{parentJobId:job.id,phase,jobId:reservation.slots[phase],publicationMs:budget()});
    await displayOutcomeTx(client,job,phase,{state:'created',jobId:status.jobId});
    assertMvtDeadline(deadline);await client.query('RELEASE SAVEPOINT semantic_display');return status.jobId;
  }catch(error){
    await client.query('ROLLBACK TO SAVEPOINT semantic_display');await client.query('RELEASE SAVEPOINT semantic_display');throw error;
  }
}
/** Failed display bookkeeping creates no source authority or assets. Nonlocking
 * context reads avoid renewing child work while a case row is contended; the
 * canonical parent attempt is still fenced before changing its reservation. */
async function unavailableTx(client:PoolClient,job:any,phase:SemanticDisplayPhase,error:unknown,attempt?:UspJobAttempt){
  const ctx=await projectedContextTx(client,job.case_id,job.source_id);assertProjectedInput(ctx,job.payload);
  if(ctx.source.inspection.projectedVector?.currentJobId!==job.id)throw new AppError(409,'PROJECTED_CONTEXT_STALE','Source job was superseded.');
  if(attempt)await assertUspJobAttemptTx(client,attempt);
  const reservation=await displayReservationTx(client,job);
  const outcome=reservation.outcomes[phase];
  if(outcome.state==='created')await displayOutcomeTx(client,job,phase,{...outcome,errorCode:displayCode(error)});
  else if(outcome.state==='reserved')await displayOutcomeTx(client,job,phase,{state:'unavailable',code:displayCode(error)});
}
export async function runSemanticDisplay(job:any,attempt:UspJobAttempt,phase:'early'|'middle',pin:Pin,parentDeadline:number){
  const deadline=childDeadline(parentDeadline);
  try{
    const child=await mvtTransaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))");
      const ctx=await projectedContextTx(client,job.case_id,job.source_id,true);assertProjectedInput(ctx,job.payload);
      if(ctx.source.inspection.projectedVector?.currentJobId!==job.id)throw new AppError(409,'PROJECTED_CONTEXT_STALE','Source job was superseded.');
      await assertUspJobAttemptTx(client,attempt);
      return createSemanticDisplayTx(client,job,phase,pin,deadline);
    },deadline);
    if(child)await runPrivateMvtJob(child,deadline);
  }catch(error){
    assertMvtDeadline(parentDeadline);
    // No child/assets/capacity are created here. The exact reservation row and
    // live parent fence serialize bookkeeping without the failed tile lock.
    await mvtTransaction(client=>unavailableTx(client,job,phase,error,attempt),parentDeadline);
  }
  assertMvtDeadline(parentDeadline);
}
export type FinalSemanticDisplayLock={deadline:number;error?:unknown};
/** Try the display lock before case/source/job locks. Failure rolls back only
 * this acquisition; independent source adoption retains its parent deadline. */
export async function prepareFinalSemanticDisplayTx(client:PoolClient,parentDeadline:number):Promise<FinalSemanticDisplayLock>{
  const deadline=childDeadline(parentDeadline);
  await mvtBoundsTx(client,deadline);
  await client.query('SAVEPOINT final_semantic_display_lock');
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))");
    assertMvtDeadline(deadline);
    await client.query('RELEASE SAVEPOINT final_semantic_display_lock');
    return {deadline};
  }catch(error){
    await client.query('ROLLBACK TO SAVEPOINT final_semantic_display_lock');
    await client.query('RELEASE SAVEPOINT final_semantic_display_lock');
    assertMvtDeadline(parentDeadline);
    return {deadline,error};
  }
}
/** Source acceptance remains atomic and independently valid when display-only
 * creation times out. The queued final job also pins its smaller attempt budget. */
export async function createFinalSemanticDisplayTx(client:PoolClient,job:any,parentDeadline:number,prepared:FinalSemanticDisplayLock){
  try{
    if(prepared.error!==undefined)throw prepared.error;
    await createSemanticDisplayTx(client,job,'final',undefined,prepared.deadline);
  }
  catch(error){assertMvtDeadline(parentDeadline);
    await unavailableTx(client,job,'final',error);}
  assertMvtDeadline(parentDeadline);
}
