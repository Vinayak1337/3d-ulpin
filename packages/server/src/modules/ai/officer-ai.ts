import { sql } from '../../infrastructure/sql-loader';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import type { OfficerAiRun } from '../../shared/officer-ai-types';
import { query, transaction } from '../../infrastructure/db';
import { getArea, getPackage } from '../areas/areas';
import { AppError, conflict, notFound } from '../../infrastructure/errors';
import { appendPreparationFacts } from '../officer/officer-preparation';
import { aiBudget, extractionMessages, inspectModelGateway, minimizeExtractionOutput } from './officer-ai-provider';
import { AI_PROPERTIES, digest, PROMPT_VERSION, redactPrivateText, SCHEMA_VERSION, validateExtraction } from './officer-ai-validation';
import { selectedImageCrops } from './officer-ai-images';
import { assertNoImageEgress, redactDerivative, redactDocumentViews } from '../usp/ingest/redact';
import { localOperatorSubject, localRequestContext } from '../usp/principal';
import { modelGatewayRuntime, modelGatewayPolicyHash, assertCurrentGatewayPolicy, migrateModelGateway } from '../model-gateway/runtime';
import { extractionSchema } from './officer-ai-validation';

export async function migrateOfficerAi() {
  await query(sql('officer-ai.schema'));
  await migrateModelGateway();
}
const uuid=z.string().uuid(),revision=z.number().int().nonnegative();
const regionSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).strict().refine(r=>r.x+r.width<=1&&r.y+r.height<=1,'Crop must fit within the source image.');
export const officerAiExtractSchema=z.object({expectedRevision:revision,partIds:z.array(uuid).min(1).max(12),entityIds:z.array(uuid).min(1).max(5).optional(),requestKey:uuid,mode:z.enum(['live','cached']).default('live'),imageRegions:z.array(z.object({partId:uuid,region:regionSchema}).strict()).max(4).optional(),imageContentApproved:z.boolean().optional(),answers:z.array(z.object({question:z.string().min(1).max(500),answer:z.string().min(1).max(1000)}).strict()).max(20).optional()}).strict();
export const officerAiApplySchema=z.object({expectedRevision:revision,candidateIds:z.array(uuid).min(1).max(40)}).strict();
type Input=z.infer<typeof officerAiExtractSchema>;
async function snapshot(pkg:ImportPackage,input:Input) {
  if(pkg.revision!==input.expectedRevision) conflict('Preparation changed. Refresh before extracting.');
  if(pkg.state==='COMMITTED') conflict('Open a correction preparation before using AI.');
  const ids=[...new Set(input.partIds)].sort(),selected=pkg.parts.filter(p=>ids.includes(p.id));
  if(selected.length!==ids.length) throw new AppError(422,'AI_PARTS','Every selected source part must belong to this preparation.');
  const entityIds=[...new Set(input.entityIds??selected.flatMap(p=>p.entityIds))].sort();
  const entities=pkg.features.filter(f=>entityIds.includes(f.id)).map(f=>({id:f.id,kind:f.kind,worldStatus:f.worldStatus,revision:f.revision,identifiers:[f.identifier,f.sourceKey].filter(Boolean).map(id=>redactPrivateText(id).slice(0,200))}));
  if(!entityIds.length || entityIds.length>5 || entities.length!==entityIds.length || selected.some(p=>!p.entityIds.some(id=>entityIds.includes(id)))) throw new AppError(422,'AI_ASSOCIATION','Select up to five preparation entities with explicitly associated document parts.');
  const parts=selected.map(p=>({id:p.id,sourceRevisionId:p.sourceRevisionId,locator:redactPrivateText(p.locator),entityIds:p.entityIds.filter(id=>entityIds.includes(id)),text:redactPrivateText(p.text)}));
  if(input.imageRegions?.length && (!input.imageContentApproved || input.imageRegions.some(r=>!ids.includes(r.partId)) || new Set(input.imageRegions.map(r=>r.partId)).size!==input.imageRegions.length)) throw new AppError(422,'AI_IMAGE_SELECTION','Explicitly select each relevant image crop and confirm that it contains no personal fields to send.');
  if(parts.reduce((n,p)=>n+p.text.length,0)>40000) throw new AppError(413,'AI_TEXT_BUDGET','Select relevant source sections totaling at most 40,000 characters.');
  const sourceIds=[...new Set(parts.map(p=>p.sourceRevisionId))].sort();
  if(sourceIds.some(id=>!pkg.sourceRevisionIds.includes(id))) throw new AppError(422,'AI_SOURCE','Selected source is outside this preparation.');
  const sources=(await query('SELECT id,sha256 FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id',[sourceIds])).rows;
  if(sources.length!==sourceIds.length) throw new AppError(422,'AI_SOURCE','A selected original source is unavailable.');
  const sourceHashes=sources.map(s=>({sourceRevisionId:s.id,sha256:s.sha256}));
  const partHashes=selected.map(p=>({partId:p.id,sha256:digest(p)}));
  const area=await getArea(pkg.areaId);
  const preparation=(await query('SELECT body FROM building_preparations WHERE package_id=$1',[pkg.id])).rows[0]?.body;
  const frames=[...new Set([...(area.reference?[area.reference.verticalReference]:[]),...(preparation?.placement.status==='reviewed'?[preparation.placement.verticalReference,preparation.placement.sourceVerticalReference].filter(Boolean):[])])] as string[];
  const siteFrame=(await query('SELECT frame FROM registry_sites WHERE id=$1',[area.siteId])).rows[0]?.frame;
  const geometryFrames=[...new Set([siteFrame?.id,...(preparation?.placement.status==='reviewed'?[preparation.placement.sourceFrame]:[])].filter(Boolean))] as string[];
  const currentFacts=pkg.factCandidates.filter(f=>entityIds.includes(f.entityId)&&AI_PROPERTIES.includes(f.property as any)&&((typeof f.value==='number'&&Number.isFinite(f.value))||typeof f.value==='string')).slice(0,50).map(f=>({entityId:f.entityId,property:f.property,value:typeof f.value==='string'?redactPrivateText(f.value).slice(0,200):f.value,unit:f.unit,referenceFrameId:f.referenceFrameId,evidence:f.evidence.slice(0,4)}));
  const context={entities,knownReferenceFrames:frames,authorizedHorizontalFrames:geometryFrames,placementRevision:preparation?.placement.revision,currentFacts,operatorAnswers:(input.answers??[]).map(a=>({question:redactPrivateText(a.question),answer:redactPrivateText(a.answer)}))};
  const fingerprint=digest({packageId:pkg.id,revision:pkg.revision,areaRevision:area.revision,sourceHashes,partHashes,entityIds,context,imageRegions:input.imageRegions??[],cropMethod:'native-image-crop-v1',promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,
    gatewayPolicyHash:modelGatewayPolicyHash(),principalHash:digest(localOperatorSubject())});
  return {parts,entityIds,sourceHashes,partHashes,context,entities,frames,geometryFrames,fingerprint};
}
async function saveRun(run:OfficerAiRun,rawOutputs:unknown[]) {
  await query('UPDATE officer_ai_runs SET body=$2,raw_outputs=$3 WHERE id=$1',[run.id,redactDerivative(run),JSON.stringify(redactDerivative(rawOutputs))]);
}
async function recoverInterruptedRun(run:OfficerAiRun) {
  const deadline=Date.parse(run.startedAt)+run.budget.maxCalls*run.budget.timeoutMs+75000+(run.imageRegions?.length??0)*30000;
  if(run.state==='running'&&Date.now()>deadline) {
    run.state='failed';run.completedAt=new Date().toISOString();run.message='This attempt was interrupted before completion. Any admitted model reservation remains held until reconciled; manual preparation and stored receipts remain available.';
    await query("UPDATE officer_ai_runs SET body=$2 WHERE id=$1 AND body->>'state'='running'",[run.id,run]);
  }
  return redactDerivative(run);
}
async function extract(packageId:string,input:Input):Promise<OfficerAiRun> {
  assertNoImageEgress(input.imageRegions ?? []);
  const existing=(await query('SELECT body,private_input FROM officer_ai_runs WHERE package_id=$1 AND request_key=$2',[packageId,input.requestKey])).rows[0];
  const requestDigest=digest({...input,partIds:[...new Set(input.partIds)].sort(),entityIds:input.entityIds?[...new Set(input.entityIds)].sort():undefined});
  if(existing) {
    if(existing.private_input.requestDigest!==requestDigest) throw new AppError(409,'AI_REQUEST_KEY','This extraction request key was already used for different inputs.');
    if(existing.body.provider==='sarvam') {
      if(existing.body.principalHash!==digest(localOperatorSubject())) throw new AppError(403,'AI_RUN_PRINCIPAL','This extraction belongs to a different principal.');
      const current=await getPackage(packageId);
      if((await snapshot(current,input)).fingerprint!==existing.body.inputFingerprint) conflict('This extraction belongs to changed evidence or policy.');
      if(['succeeded','needs_input','applied'].includes(existing.body.state)) assertCurrentGatewayPolicy(existing.body.gatewayPolicyHash);
    } else throw new AppError(409,'AI_HISTORICAL_REQUEST','This key belongs to a historical provider run. Its history remains readable; use a new request under the current private policy.');
    return recoverInterruptedRun(existing.body);
  }
  const pkg=await getPackage(packageId),snap=await snapshot(pkg,input);
  if(input.mode==='cached') {
    const cached=(await query("SELECT body FROM officer_ai_runs WHERE package_id=$1 AND input_fingerprint=$2 AND body->>'state' IN ('succeeded','needs_input') AND body->>'promptVersion'=$3 ORDER BY created_at DESC LIMIT 1",[packageId,snap.fingerprint,PROMPT_VERSION])).rows[0]?.body;
    if(!cached) throw new AppError(404,'AI_CACHE_MISS','No completed extraction matches this exact preparation revision and evidence.');
    assertCurrentGatewayPolicy(cached.gatewayPolicyHash);
    if(cached.principalHash!==digest(localOperatorSubject())) throw new AppError(403,'AI_CACHE_PRINCIPAL','This cached extraction belongs to a different principal.');
    return {...cached,cached:true};
  }
  const run:OfficerAiRun={id:randomUUID(),packageId,packageRevision:pkg.revision,requestKey:input.requestKey,state:'running',provider:'sarvam',inputFingerprint:snap.fingerprint,
    gatewayPolicyHash:modelGatewayPolicyHash(),principalHash:digest(localOperatorSubject()),sourceHashes:snap.sourceHashes,partHashes:snap.partHashes,partIds:input.partIds,entityIds:snap.entityIds,imageRegions:input.imageRegions,answers:snap.context.operatorAnswers,promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,candidates:[],questions:[],suggestions:[],validationErrors:[],calls:[],budget:aiBudget(),startedAt:new Date().toISOString()};
  const inserted=await query('INSERT INTO officer_ai_runs(id,package_id,request_key,input_fingerprint,body,private_input) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(package_id,request_key) DO NOTHING RETURNING id',[run.id,packageId,input.requestKey,snap.fingerprint,run,{requestDigest,parts:snap.parts,context:snap.context}]);
  if(!inserted.rowCount) return extract(packageId,input);
  const rawOutputs:unknown[]=[];
  try {
    if(snap.parts.some(p=>!p.text.trim()&&!input.imageRegions?.some(r=>r.partId===p.id))) {
      run.state='needs_input';run.message='A selected part has no extracted text. Supply native text or a verified OCR derivative for the relevant page. No image or inferred geometry was sent.';
      run.questions=['Which source text supports the missing facts? Add or correct the relevant source part before resuming.'];
    } else {
      const inspection=await inspectModelGateway();
      if(inspection.status.state!=='available' || !inspection.model) {run.state='blocked';run.message=inspection.status.message;}
      else {
        run.model=inspection.model.id;
        if(input.imageRegions?.length&&!inspection.status.capabilities?.image) throw new AppError(422,'AI_IMAGE_ROUTE','The private model gateway does not support image input.');
        const cached=(await query("SELECT body FROM officer_ai_runs WHERE package_id=$1 AND input_fingerprint=$2 AND body->>'model'=$3 AND body->>'state' IN ('succeeded','needs_input') ORDER BY created_at DESC LIMIT 1",[packageId,snap.fingerprint,run.model])).rows[0]?.body;
        if(cached) {assertCurrentGatewayPolicy(cached.gatewayPolicyHash);if(cached.principalHash!==run.principalHash) throw new AppError(403,'AI_CACHE_PRINCIPAL','This cached extraction belongs to a different principal.');run.state=cached.state;run.candidates=cached.candidates;run.questions=cached.questions;run.suggestions=cached.suggestions??[];run.validationErrors=cached.validationErrors;run.derivatives=cached.derivatives;run.cached=true;run.cachedFromRunId=cached.cachedFromRunId??cached.id;run.message=`Reused stored extraction ${cached.id} for identical evidence, revision and route.`;}
        else {
          const images=await selectedImageCrops(snap.parts,input.imageRegions??[]);
          run.derivatives=images.map(({bytes,dataUrl,...metadata})=>metadata);
          for(const image of images) await query('INSERT INTO officer_ai_derivatives(run_id,part_id,sha256,bytes) VALUES($1,$2,$3,$4)',[run.id,image.partId,image.sha256,image.bytes]);
          const parts=snap.parts.map(part=>{const image=images.find(i=>i.partId===part.id);return {...part,...(image?{imageRegion:image.region,derivativeSha256:image.sha256}:{})};});
          await saveRun(run,rawOutputs);
          let repair: {output:unknown;errors:string[]}|undefined;
          const gateway=await modelGatewayRuntime();
          if(!gateway) throw new AppError(503,'MODEL_UNAVAILABLE','No private model key is configured. Manual preparation remains available.');
          const authorize=async()=>{
            assertCurrentGatewayPolicy(run.gatewayPolicyHash);
            if(digest(localOperatorSubject())!==run.principalHash) throw new AppError(403,'MODEL_PRINCIPAL_CHANGED','The extraction principal changed.');
            const current=await getPackage(packageId);
            if(current.revision!==run.packageRevision || (await snapshot(current,input)).fingerprint!==run.inputFingerprint)
              conflict('Extraction evidence changed before model dispatch or publication.');
          };
          const deadlineAt=new Date(Date.parse(run.startedAt)+45000);
          for(let attempt=0;attempt<run.budget.maxCalls;attempt++) {
            const start=Date.now();
            const port=gateway.port({invocationKey:run.id,attempt:attempt+1,consumer:'INGEST',scopeHash:run.inputFingerprint,
              sourceHashes:run.sourceHashes.map(s=>s.sha256),deadlineAt,taskKind:'officer_extraction',outputSchemaId:SCHEMA_VERSION,
              outputSchema:extractionSchema,authorize,minimizeOutput:minimizeExtractionOutput});
            const serviceResult=await port.modelGateway(localRequestContext(run.id),{
              taskKind:'officer_extraction',evidenceRefs:[],input:{messages:extractionMessages(parts,snap.context,repair,images)},
              outputSchemaId:SCHEMA_VERSION,budget:{maxInputBytes:32768,deadlineMs:Math.max(1,deadlineAt.getTime()-Date.now())},
              policyVersion:gateway.config.policyVersion,
            });
            if(serviceResult.state!=='available') throw new AppError(503,'MODEL_UNAVAILABLE','Private model inference is unavailable. Manual preparation remains available.');
            const result=serviceResult.data;
            const receipt=result.receipt!;
            run.calls.push({latencyMs:Date.now()-start,httpStatus:receipt.httpStatus,inputTokens:receipt.inputTokens,
              outputTokens:receipt.outputTokens,outputHash:receipt.responseHash,callId:receipt.callId,
              actualMicroInr:receipt.actualMicroInr,priceVersion:receipt.priceVersion,semanticError:receipt.semanticError});
            rawOutputs.push({output:result.output,outputHash:receipt.responseHash});
            await saveRun(run,rawOutputs);
            const parsed=validateExtraction(receipt.semanticError?{invalidResponse:true}:result.output,parts,snap.entities,snap.frames,snap.geometryFrames);
            for(const candidate of [...parsed.candidates].filter(c=>c.property.endsWith('.geometry'))) {
              const valid=(await query('SELECT ST_IsValid(g) AND ST_Area(g)>0.00000001 valid FROM (SELECT ST_GeomFromGeoJSON($1) g) source',[JSON.stringify(candidate.value)])).rows[0]?.valid;
              if(!valid){parsed.candidates=parsed.candidates.filter(c=>c.id!==candidate.id);parsed.errors.push('Candidate geometry failed native topology validation; supply a valid measured outline, retaining holes and multipart boundaries.');}
            }
            run.candidates=parsed.candidates;run.questions=parsed.questions;run.suggestions=parsed.suggestions;run.validationErrors=parsed.errors;
            if(!parsed.errors.length) break;
            repair={output:result.output,errors:parsed.errors};
          }
          run.state=run.questions.length||run.validationErrors.length||(!run.candidates.length&&!run.suggestions?.length)?'needs_input':'succeeded';
          run.message=run.validationErrors.length?'Unsupported output was excluded. Review grounded candidates and resolve the remaining source questions.':'Candidates are unresolved AI suggestions. Selecting them only adds draft facts; ordinary preparation review controls recording.';
        }
      }
    }
    const latest=await getPackage(packageId);
    if(latest.revision!==run.packageRevision || (await snapshot(latest,input)).fingerprint!==run.inputFingerprint) {run.state='stale';run.message='Evidence or preparation changed during extraction. Start a fresh extraction before applying suggestions.';}
  } catch(error) {
    run.state=error instanceof AppError && error.code==='STALE_REVISION'?'stale':error instanceof AppError && error.code.startsWith('MODEL_')?'blocked':'failed';
    run.message=error instanceof AppError && error.code.startsWith('MODEL_')?error.message:'The bounded extraction could not finish. No facts were applied; check provider availability and the selected source parts.';
  }
  run.completedAt=new Date().toISOString();await saveRun(run,rawOutputs);return run;
}
async function applyRun(packageId:string,runId:string,expectedRevision:number,candidateIds:string[]) {
  return transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
    const run=(await client.query('SELECT body FROM officer_ai_runs WHERE id=$1 AND package_id=$2 FOR UPDATE',[runId,packageId])).rows[0]?.body as OfficerAiRun|undefined;
    if(!run) notFound('Extraction run not found.');
    const unique=[...new Set(candidateIds)].sort();
    if(run.state==='applied') {
      if(JSON.stringify(unique)!==JSON.stringify(run.appliedCandidateIds)) conflict('This extraction already applied a different selection. Start a fresh extraction for more facts.');
      return getPackage(packageId);
    }
    if(!['succeeded','needs_input'].includes(run.state) || !run.model) throw new AppError(422,'AI_RUN_NOT_READY','Only a completed grounded extraction can add draft facts.');
    assertCurrentGatewayPolicy(run.gatewayPolicyHash);
    if(run.principalHash!==digest(localOperatorSubject())) throw new AppError(403,'AI_RUN_PRINCIPAL','This extraction belongs to a different principal.');
    if(run.packageRevision!==expectedRevision) conflict('Extraction belongs to an older preparation revision.');
    await client.query('SELECT id FROM import_packages WHERE id=$1 FOR UPDATE',[packageId]);
    const pkg=await getPackage(packageId);
    await client.query('SELECT id FROM map_areas WHERE id=$1 FOR UPDATE',[pkg.areaId]);
    const snap=await snapshot(pkg,{expectedRevision,partIds:run.partIds,entityIds:run.entityIds,requestKey:run.requestKey,mode:'live',imageRegions:run.imageRegions,imageContentApproved:!!run.imageRegions?.length,answers:run.answers});
    if(snap.fingerprint!==run.inputFingerprint) conflict('Extraction inputs are stale. Extract again from current evidence.');
    const candidates=run.candidates.filter(c=>unique.includes(c.id));
    if(!candidates.length || candidates.length!==unique.length) throw new AppError(422,'AI_SELECTION','Choose available grounded candidates from this run.');
    const facts=candidates.map(({id,citations,rationale,...fact})=>{
      if(['building.exteriorHeight','space.lower','space.upper'].includes(fact.property)) {
        if(!fact.referenceFrameId) throw new AppError(422,'AI_REFERENCE_REQUIRED','This candidate has no supported vertical reference. Record or reconcile that source fact in preparation before applying it.');
        if(fact.unit==='mm')return {...fact,value:Number(fact.value)/1000,unit:'m'};
        if(fact.unit==='ft')return {...fact,value:Number(fact.value)*0.3048,unit:'m'};
      }
      return fact;
    });
    const updated=await appendPreparationFacts(packageId,expectedRevision,facts,client);
    run.state='applied';run.appliedRevision=updated.revision;run.appliedCandidateIds=unique;
    await client.query('UPDATE officer_ai_runs SET body=$2 WHERE id=$1',[run.id,run]);return updated;
  });
}
const json=(data:unknown)=>Response.json(redactDerivative(data),{headers:{'Cache-Control':'no-store'}});
/** Match the canonical package read boundary while preserving typed technical names and geometry. */
export const officerAiPackageProjection=(pkg:ImportPackage)=>{
  const visible=redactDocumentViews(pkg);
  return {...visible,
    questions:visible.questions.map(question=>({...question,message:redactPrivateText(question.message),
      ...(question.answer?{answer:{...question.answer,reason:redactPrivateText(question.answer.reason)}}:{})})),
    warnings:visible.warnings.map(redactPrivateText),
  };
};

/** Named domain entry points for the native Nest controller. The Next adapter below remains a thin compatibility seam. */
export async function officerAiStatus() { return (await inspectModelGateway()).status; }
/** Read-time fence for current model output; never rewrites historical receipts. */
async function projectCurrentRun(run:OfficerAiRun,pkg:ImportPackage):Promise<OfficerAiRun> {
  const visible=await recoverInterruptedRun(run);
  if(run.provider!=='sarvam') return visible;
  try {
    if(pkg.revision!==run.packageRevision) throw new Error('evidence changed');
    assertCurrentGatewayPolicy(run.gatewayPolicyHash);
    if(run.principalHash!==digest(localOperatorSubject())) throw new Error('principal changed');
    const current=await snapshot(pkg,{expectedRevision:pkg.revision,partIds:run.partIds,entityIds:run.entityIds,
      requestKey:run.requestKey,mode:'cached',answers:run.answers,imageRegions:run.imageRegions,imageContentApproved:!!run.imageRegions?.length});
    if(current.fingerprint!==run.inputFingerprint) throw new Error('evidence changed');
    return visible;
  } catch {
    return {...visible,candidates:[],suggestions:[],questions:[],answers:[],validationErrors:[],
      message:'Stored model output is withheld because its current evidence, principal or policy could not be reauthorized. Billing receipts and manual preparation remain available.'};
  }
}
export async function listOfficerAiRuns(packageId:string):Promise<OfficerAiRun[]> {
  const pkg=await getPackage(uuid.parse(packageId));
  return Promise.all((await query('SELECT body FROM officer_ai_runs WHERE package_id=$1 ORDER BY created_at DESC LIMIT 30',[packageId])).rows.map(r=>projectCurrentRun(r.body,pkg)));
}
export async function getOfficerAiRun(packageId:string,runId:string):Promise<OfficerAiRun> {
  const pkg=await getPackage(uuid.parse(packageId));
  return projectCurrentRun((await query('SELECT body FROM officer_ai_runs WHERE package_id=$1 AND id=$2',
    [packageId,uuid.parse(runId)])).rows[0]?.body??notFound('Extraction run not found.'),pkg);
}
export async function createOfficerAiRun(packageId:string,value:unknown):Promise<OfficerAiRun> {
  const id=uuid.parse(packageId),run=await extract(id,officerAiExtractSchema.parse(value));
  // The terminal POST has the same current-authorization fence as GET, even after a denied repair.
  // Stored history and settled billing remain intact when this response withholds earlier output.
  return projectCurrentRun(run,await getPackage(id));
}
export async function applyOfficerAiRun(packageId:string,runId:string,value:unknown) {
  const input=officerAiApplySchema.parse(value);
  return officerAiPackageProjection(await applyRun(uuid.parse(packageId),uuid.parse(runId),input.expectedRevision,input.candidateIds));
}
export async function officerAiRoutes(request:Request,p:string[]):Promise<Response|null> {
  if(p.length===2&&p[0]==='ai'&&p[1]==='status'&&request.method==='GET') return json(await officerAiStatus());
  if(p[0]!=='import-packages'||p[2]!=='ai-extractions') return null;
  const packageId=uuid.parse(p[1]);
  if(request.method==='GET'&&p.length===6&&p[4]==='derivatives') {
    // Historic crops have no visual-redaction qualification; never treat their hashes as clearance.
    return Response.json({error:{code:'AI_IMAGE_PRIVACY',message:'Crop previews are unavailable pending visual redaction qualification. Inspect the retained original locally.'}}, {status:403,headers:{'Cache-Control':'no-store'}});
  }
  if(request.method==='GET'&&p.length===3) return json(await listOfficerAiRuns(packageId));
  if(request.method==='GET'&&p.length===4) return json(await getOfficerAiRun(packageId,p[3]));
  if(request.method==='POST'&&p.length===3) return json(await createOfficerAiRun(packageId,await request.json()));
  if(request.method==='POST'&&p.length===5&&p[4]==='apply') {
    return Response.json(await applyOfficerAiRun(packageId,p[3],await request.json()),{headers:{'Cache-Control':'no-store'}});
  }
  return null;
}
