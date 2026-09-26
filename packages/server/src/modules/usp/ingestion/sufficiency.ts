import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {EvaluateSufficiencySchema,SufficiencyAnswerSchema,SufficiencyQuestionSchema,IngestionSufficiencyDecisionSchema,
  SufficiencyResultSchema,NeedsInputSchema,SUFFICIENCY_VERSION,SUFFICIENCY_LIMITS,
  type SufficiencyQuestion,type SufficiencyPins,type SufficiencyReference,type IngestionSufficiencyDecision} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {appendCaseIngestionTx,assertIngestionBinding} from './events';
import {sufficiencyCaseTx,sufficiencySourceTx,type SufficiencyContext} from './sufficiency-context';
import {assessSufficiency} from './sufficiency-policy';

const uuid=z.uuid(),kind='ingestion-sufficiency';
const same=(a:SufficiencyPins,b:SufficiencyPins)=>fingerprint(a)===fingerprint(b);
export const questionBudgetAllows=(open:number)=>Number.isSafeInteger(open) && open>=0 && open<SUFFICIENCY_LIMITS.questions;
async function saveReceipt(client:PoolClient,caseId:string,key:string,digest:string,result:unknown,receiptKind=kind){
  if(Buffer.byteLength(JSON.stringify(result))>SUFFICIENCY_LIMITS.receiptBytes)throw new AppError(413,'SUFFICIENCY_RECEIPT_LIMIT','Use a smaller task scope.');
  await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',[caseId,key,receiptKind,digest,result]);
}
async function priorReceipt(client:PoolClient,caseId:string,key:string,digest:string){
  const row=(await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',[caseId,key,kind])).rows[0];
  if(row && row.payload_hash!==digest)conflict('This request key already names different sufficiency inputs.');
  return row?.result;
}
async function saveQuestion(client:PoolClient,question:SufficiencyQuestion){
  await client.query('UPDATE usp_ingestion_questions SET revision=$2,state=$3,body=$4 WHERE id=$1',
    [question.id,question.revision,question.state,SufficiencyQuestionSchema.parse(question)]);
}
function assertPins(current:SufficiencyContext,pins:SufficiencyPins){
  if(!current.latest || !same(current.pins,pins))conflict('The source, case, approval, geometry, policy or access evidence changed. Refresh the current task decision.');
}
/** Called only under the canonical case lock. Foreign ownership/access never frees capacity. */
async function retireOwned(client:PoolClient,ctx:SufficiencyContext,key:string){
  const rows=(await client.query(`SELECT id,body FROM usp_ingestion_questions WHERE case_id=$1 AND owner_subject=$2
    AND access_sha256=$3 AND state<>'stale' AND (state='open' OR source_id=$4) ORDER BY id`,
    [ctx.pins.caseId,ctx.scope.binding.subject,ctx.pins.accessSha256,ctx.pins.sourceId])).rows;
  const changes=[];
  for(const row of rows){
    const q=SufficiencyQuestionSchema.parse(row.body);
    const current=q.pins.sourceId===ctx.pins.sourceId?ctx:await sufficiencySourceTx(client,ctx.scope,q.pins.sourceId);
    if(current.latest && same(q.pins,current.pins))continue;
    changes.push({id:q.id,fromRevision:q.revision,toRevision:q.revision+1,pins:q.pins});
    q.state='stale';q.revision++;await saveQuestion(client,q);
  }
  if(changes.length)await saveReceipt(client,ctx.pins.caseId,`scope:${key}`,fingerprint(changes),
    {actor:ctx.scope.binding.subject,changes},'ingestion-sufficiency-lifecycle');
}
async function referenceExists(client:PoolClient,ctx:SufficiencyContext,ref:SufficiencyReference){
  const source=await sufficiencySourceTx(client,ctx.scope,ref.sourceId);
  if(!source.latest || source.row.revision!==ref.sourceRevision)conflict('The referenced source revision changed.');
  if(ref.kind==='recipe'){
    if(ref.packageId || !source.recipe || source.recipe.id!==ref.id || source.recipe.revision!==ref.revision)
      conflict('The referenced recipe is not current in this source context.');
    return;
  }
  if(ref.kind==='source_part'){
    const part=(await client.query(`SELECT 1 FROM sources WHERE id=$1 AND case_id=$2 AND
      jsonb_path_exists(inspection,'$.referenceParts[*] ? (@.id == $part)',jsonb_build_object('part',$3::text))`,[ref.sourceId,ctx.pins.caseId,ref.id])).rowCount;
    if(ref.packageId || ref.revision!==source.row.revision || !part)
      throw new AppError(422,'SUFFICIENCY_EVIDENCE_REFERENCE','Choose an existing source part from the current retained revision.');
    return;
  }
  if(!ref.packageId)throw new AppError(422,'SUFFICIENCY_EVIDENCE_REFERENCE','Choose an existing package evidence reference.');
  const pkg=(await client.query(`SELECT revision,body->'review' review,
    body->'sourceRevisionIds' source_ids,
    (SELECT value FROM jsonb_array_elements(body->'factCandidates') WHERE value->>'id'=$3 LIMIT 1) candidate
    FROM import_packages WHERE case_id=$1 AND id=$2`,[ctx.pins.caseId,ref.packageId,ref.id])).rows[0];
  if(!pkg || pkg.revision!==ref.revision || !pkg.source_ids?.includes(ref.sourceId))conflict('The referenced package evidence is not current in this case.');
  if(ref.kind==='package_review' ? ref.id!==ref.packageId || !pkg.review || pkg.review.packageRevision!==pkg.revision :
    !pkg.candidate || !pkg.candidate.evidence?.some((e:{sourceRevisionId:string})=>e.sourceRevisionId===ref.sourceId))
    throw new AppError(422,'SUFFICIENCY_EVIDENCE_REFERENCE','Choose an existing source-backed candidate or current officer review.');
}
export class IngestionSufficiencyService{
  async evaluate(caseValue:string,sourceValue:string,raw:unknown){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),input=EvaluateSufficiencySchema.parse(raw);
    return transaction(async client=>{
      const scope=await sufficiencyCaseTx(client,caseId,true),ctx=await sufficiencySourceTx(client,scope,sourceId);
      if(!ctx.latest || input.expectedCaseRevision!==ctx.pins.caseRevision || input.expectedSourceRevision!==ctx.pins.sourceRevision || input.sourceSha256!==ctx.pins.sourceSha256)
        conflict('The retained source or case changed. Refresh before evaluating tasks.');
      const key=`evaluate:${input.requestKey}`,digest=fingerprint({input,sourceId,actor:scope.binding.subject,access:scope.binding.access});
      const prior=await priorReceipt(client,caseId,key,digest);
      if(prior){
        const parsed=SufficiencyResultSchema.parse(prior);
        for(const decision of parsed.decisions)assertPins(ctx,decision.pins);
        for(const question of parsed.questions){
          const current=(await client.query('SELECT revision,state FROM usp_ingestion_questions WHERE id=$1',[question.id])).rows[0];
          if(!current || current.revision!==question.revision || current.state!==question.state)conflict('The question changed after this evaluation. Request a current decision.');
        }
        assertIngestionBinding(scope.binding);return parsed;
      }
      await retireOwned(client,ctx,key);
      const questions:SufficiencyQuestion[]=[],decisions:IngestionSufficiencyDecision[]=[];
      for(const task of input.tasks){
        const assessment=assessSufficiency(ctx,task),missing=assessment.evidence.filter(e=>e.state!=='satisfied').map(e=>e.requirement);
        let question:SufficiencyQuestion|null=null;
        if(assessment.gapClass){
          const row=(await client.query(`SELECT body,owner_subject,access_sha256 FROM usp_ingestion_questions
            WHERE case_id=$1 AND source_id=$2 AND gap_class=$3 AND state<>'stale'`,[caseId,sourceId,assessment.gapClass])).rows[0];
          if(row && row.owner_subject===scope.binding.subject && row.access_sha256===scope.binding.access){
            question=SufficiencyQuestionSchema.parse(row.body);assertPins(ctx,question.pins);
            if(!question.tasks.includes(task)){
              question.tasks.push(task);question.unlocks.push(task);question.missing=[...new Set([...question.missing,...missing])];
              question.revision++;await saveQuestion(client,question);
            }
          }else if(!row){
            const open=Number((await client.query("SELECT count(*)::int n FROM usp_ingestion_questions WHERE case_id=$1 AND state='open'",[caseId])).rows[0].n);
            if(questionBudgetAllows(open)){
              question=SufficiencyQuestionSchema.parse({id:randomUUID(),revision:1,pins:ctx.pins,gapClass:assessment.gapClass,tasks:[task],
                state:'open',missing,unlocks:[task],reason:assessment.reason,choices:['provide_existing_evidence','not_sure'],proposal:null,createdAt:new Date().toISOString()});
              await client.query(`INSERT INTO usp_ingestion_questions(id,case_id,source_id,gap_class,owner_subject,access_sha256,context_sha256,revision,state,body)
                VALUES($1,$2,$3,$4,$5,$6,$7,1,'open',$8)`,[question.id,caseId,sourceId,question.gapClass,scope.binding.subject,scope.binding.access,scope.context,question]);
            }
          }
        }
        const outcome=question?.state==='open'?'ask':assessment.outcome;
        const reason=question?.state==='parked'?'Not sure was recorded for this evidence class. The affected task stays parked until source evidence or its normal approval changes.':
          question?.state==='answered'?'An existing evidence reference is proposed. Officer review has not satisfied the missing task requirements.':
          assessment.gapClass && !question?'The class question is unavailable or the case question budget is occupied. Retain the missing evidence and park this task.':assessment.reason;
        decisions.push(IngestionSufficiencyDecisionSchema.parse({version:SUFFICIENCY_VERSION,id:randomUUID(),pins:ctx.pins,recordPins:ctx.recordPins,task,
          requirements:assessment.evidence.map(e=>e.requirement),missing,outcome,availability:assessment.availability,evidence:assessment.evidence,
          unlocks:missing.length?[task]:[],questionId:question?.id??null,nextAction:question?.state==='answered'?'review_evidence':
            question?.state==='parked'?'park':assessment.nextAction,reason,createdAt:new Date().toISOString()}));
        if(question && !questions.some(q=>q.id===question!.id))questions.push(question);
      }
      const result=SufficiencyResultSchema.parse({version:SUFFICIENCY_VERSION,decisions,questions});
      await saveReceipt(client,caseId,key,digest,result);
      await appendCaseIngestionTx(client,caseId,{kind:'sufficiency.changed',sourceId,sourceRevision:ctx.pins.sourceRevision,status:'evaluated'},scope.binding.subject);
      assertIngestionBinding(scope.binding);return result;
    });
  }
  async answer(caseValue:string,questionValue:string,raw:unknown){
    const caseId=uuid.parse(caseValue),questionId=uuid.parse(questionValue),input=SufficiencyAnswerSchema.parse(raw);
    return transaction(async client=>{
      const scope=await sufficiencyCaseTx(client,caseId,true);
      const row=(await client.query('SELECT * FROM usp_ingestion_questions WHERE case_id=$1 AND id=$2',[caseId,questionId])).rows[0];
      if(!row)notFound('Question not found.');
      if(row.owner_subject!==scope.binding.subject || row.access_sha256!==scope.binding.access)
        throw new AppError(403,'SUFFICIENCY_DENIED','This source context is unavailable.');
      const question=SufficiencyQuestionSchema.parse(row.body),ctx=await sufficiencySourceTx(client,scope,row.source_id);
      assertPins(ctx,input.pins);assertPins(ctx,question.pins);
      const key=`answer:${input.requestKey}`,digest=fingerprint({input,questionId,actor:scope.binding.subject,access:scope.binding.access});
      const prior=await priorReceipt(client,caseId,key,digest);
      if(prior){
        const parsed=SufficiencyQuestionSchema.parse(prior);
        if(parsed.revision!==question.revision || fingerprint(parsed)!==fingerprint(question))conflict('The question changed after this answer.');
        if(parsed.proposal)await referenceExists(client,ctx,parsed.proposal);
        assertIngestionBinding(scope.binding);return parsed;
      }
      if(question.revision!==input.expectedQuestionRevision || question.state!=='open')conflict('This question is no longer open at the expected revision.');
      if(input.answer.choice==='provide_existing_evidence'){
        await referenceExists(client,ctx,input.answer.reference);question.proposal=input.answer.reference;question.state='answered';
      }else question.state='parked';
      question.revision++;await saveQuestion(client,question);await saveReceipt(client,caseId,key,digest,question);
      await appendCaseIngestionTx(client,caseId,{kind:'sufficiency.changed',sourceId:row.source_id,sourceRevision:ctx.pins.sourceRevision,
        status:question.state==='parked'?'parked':'answered'},scope.binding.subject);
      assertIngestionBinding(scope.binding);return question;
    });
  }
  async needsInput(caseValue:string){
    const caseId=uuid.parse(caseValue);
    return transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const scope=await sufficiencyCaseTx(client,caseId),contexts=new Map<string,SufficiencyContext>();
      const context=async(sourceId:string)=>{if(!contexts.has(sourceId))contexts.set(sourceId,await sufficiencySourceTx(client,scope,sourceId));return contexts.get(sourceId)!;};
      const rows=(await client.query(`SELECT result FROM operations WHERE case_id=$1 AND kind=$2 AND result ? 'decisions'
        AND result#>>'{decisions,0,pins,accessSha256}'=$3 ORDER BY created_at DESC,operation_key DESC LIMIT 129`,[caseId,kind,scope.binding.access])).rows;
      const questionRows=(await client.query(`SELECT body FROM usp_ingestion_questions WHERE case_id=$1 AND owner_subject=$2
        AND access_sha256=$3 AND state='open' ORDER BY created_at DESC,id DESC LIMIT 6`,[caseId,scope.binding.subject,scope.binding.access])).rows;
      const currentQuestions=new Map<string,SufficiencyQuestion>(),questions:SufficiencyQuestion[]=[],staleQuestions:SufficiencyQuestion[]=[];
      for(const row of questionRows.slice(0,128)){
        const question=SufficiencyQuestionSchema.parse(row.body),ctx=await context(question.pins.sourceId);
        if(!ctx.latest || !same(ctx.pins,question.pins)){
          if(staleQuestions.length<5)staleQuestions.push({...question,state:'stale'});
        }else {currentQuestions.set(question.id,question);if(question.state==='open' && questions.length<5)questions.push(question);}
      }
      const decisions:IngestionSufficiencyDecision[]=[],seen=new Set<string>();let overflow=false;
      for(const row of rows.slice(0,128))for(const stored of SufficiencyResultSchema.parse(row.result).decisions){
        const key=`${stored.pins.sourceId}:${stored.task}`;if(seen.has(key))continue;seen.add(key);
        if(decisions.length===25){overflow=true;continue;}
        const ctx=await context(stored.pins.sourceId);
        if(stored.questionId && !currentQuestions.has(stored.questionId)){
          const q=(await client.query(`SELECT body FROM usp_ingestion_questions WHERE id=$1 AND case_id=$2
            AND owner_subject=$3 AND access_sha256=$4`,[stored.questionId,caseId,scope.binding.subject,scope.binding.access])).rows[0];
          if(q)currentQuestions.set(stored.questionId,SufficiencyQuestionSchema.parse(q.body));
        }
        const question=stored.questionId?currentQuestions.get(stored.questionId):undefined;
        const stale=!ctx.latest || !same(ctx.pins,stored.pins);
        const decision=stale?{...stored,availability:'stale',outcome:'park',nextAction:'park',questionId:null,
          reason:'The source, case, approval, geometry, policy or access evidence changed. Reevaluate before using this decision.'}:
          question?.state==='parked'?{...stored,outcome:'park',nextAction:'park',reason:'Not sure was recorded. This task remains parked on unchanged evidence.'}:
          question?.state==='answered'?{...stored,outcome:'park',nextAction:'review_evidence',reason:'An evidence reference is proposed; the existing officer review must satisfy task requirements.'}:stored;
        decisions.push(IngestionSufficiencyDecisionSchema.parse(decision));
      }
      assertIngestionBinding(scope.binding);
      const result=NeedsInputSchema.parse({version:SUFFICIENCY_VERSION,caseId,caseRevision:scope.row.revision,decisions,questions,staleQuestions,
        hasMore:overflow||rows.length>128||questionRows.length>5});
      while(Buffer.byteLength(JSON.stringify(result))>SUFFICIENCY_LIMITS.receiptBytes && result.decisions.length){result.decisions.pop();result.hasMore=true;}
      return result;
    });
  }
}
