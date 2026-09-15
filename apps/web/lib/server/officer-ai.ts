import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import type { OfficerAiRun } from '../officer-ai-types';
import { query, transaction } from './db';
import { getArea, getPackage } from './areas';
import { AppError, conflict, notFound } from './errors';
import { appendPreparationFacts } from './officer-preparation';
import { aiBudget, callNous, extractionMessages, inspectNous } from './officer-ai-provider';
import { AI_PROPERTIES, digest, PROMPT_VERSION, redactPrivateText, SCHEMA_VERSION, validateExtraction } from './officer-ai-validation';
import { selectedImageCrops } from './officer-ai-images';

export async function migrateOfficerAi() {
  await query(`CREATE TABLE IF NOT EXISTS officer_ai_runs (
    id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES import_packages(id) ON DELETE CASCADE,
    request_key uuid NOT NULL, input_fingerprint text NOT NULL, body jsonb NOT NULL,
    private_input jsonb NOT NULL, raw_outputs jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(package_id,request_key)
  ); CREATE INDEX IF NOT EXISTS officer_ai_input_idx ON officer_ai_runs(package_id,input_fingerprint);
  CREATE TABLE IF NOT EXISTS officer_ai_derivatives (run_id uuid REFERENCES officer_ai_runs(id) ON DELETE CASCADE, part_id uuid NOT NULL, sha256 text NOT NULL, bytes bytea NOT NULL, PRIMARY KEY(run_id,part_id));`);
}
const uuid=z.string().uuid(),revision=z.number().int().nonnegative();
const regionSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).strict().refine(r=>r.x+r.width<=1&&r.y+r.height<=1,'Crop must fit within the source image.');
const inputSchema=z.object({expectedRevision:revision,partIds:z.array(uuid).min(1).max(12),entityIds:z.array(uuid).min(1).max(5).optional(),requestKey:uuid,mode:z.enum(['live','cached']).default('live'),imageRegions:z.array(z.object({partId:uuid,region:regionSchema}).strict()).max(4).optional(),imageContentApproved:z.boolean().optional(),answers:z.array(z.object({question:z.string().min(1).max(500),answer:z.string().min(1).max(1000)}).strict()).max(20).optional()}).strict();
type Input=z.infer<typeof inputSchema>;
async function snapshot(pkg:ImportPackage,input:Input) {
  if(pkg.revision!==input.expectedRevision) conflict('Preparation changed. Refresh before extracting.');
  if(pkg.state==='COMMITTED') conflict('Open a correction preparation before using AI.');
  const ids=[...new Set(input.partIds)].sort(),selected=pkg.parts.filter(p=>ids.includes(p.id));
  if(selected.length!==ids.length) throw new AppError(422,'AI_PARTS','Every selected source part must belong to this preparation.');
  const entityIds=[...new Set(input.entityIds??selected.flatMap(p=>p.entityIds))].sort();
  const entities=pkg.features.filter(f=>entityIds.includes(f.id)).map(f=>({id:f.id,kind:f.kind,worldStatus:f.worldStatus,revision:f.revision,identifiers:[f.identifier,f.sourceKey].filter(Boolean).map(id=>redactPrivateText(id).slice(0,200))}));
  if(!entityIds.length || entityIds.length>5 || entities.length!==entityIds.length || selected.some(p=>!p.entityIds.some(id=>entityIds.includes(id)))) throw new AppError(422,'AI_ASSOCIATION','Select up to five preparation entities with explicitly associated document parts.');
  const parts=selected.map(p=>({...p,entityIds:p.entityIds.filter(id=>entityIds.includes(id)),text:redactPrivateText(p.text)}));
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
  const fingerprint=digest({packageId:pkg.id,revision:pkg.revision,areaRevision:area.revision,sourceHashes,partHashes,entityIds,context,imageRegions:input.imageRegions??[],cropMethod:'native-image-crop-v1',promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION});
  return {parts,entityIds,sourceHashes,partHashes,context,entities,frames,geometryFrames,fingerprint};
}
async function saveRun(run:OfficerAiRun,rawOutputs:unknown[]) {
  await query('UPDATE officer_ai_runs SET body=$2,raw_outputs=$3 WHERE id=$1',[run.id,run,JSON.stringify(rawOutputs)]);
}
async function recoverInterruptedRun(run:OfficerAiRun) {
  const deadline=Date.parse(run.startedAt)+run.budget.maxCalls*run.budget.timeoutMs+75000+(run.imageRegions?.length??0)*30000;
  if(run.state==='running'&&Date.now()>deadline) {
    run.state='failed';run.completedAt=new Date().toISOString();run.message='This attempt was interrupted before completion. Stored receipts remain available; start a new request to resume from the current evidence.';
    await query("UPDATE officer_ai_runs SET body=$2 WHERE id=$1 AND body->>'state'='running'",[run.id,run]);
  }
  return run;
}
async function extract(packageId:string,input:Input):Promise<OfficerAiRun> {
  const existing=(await query('SELECT body,private_input FROM officer_ai_runs WHERE package_id=$1 AND request_key=$2',[packageId,input.requestKey])).rows[0];
  const requestDigest=digest({...input,partIds:[...new Set(input.partIds)].sort(),entityIds:input.entityIds?[...new Set(input.entityIds)].sort():undefined});
  if(existing) {
    if(existing.private_input.requestDigest!==requestDigest) throw new AppError(409,'AI_REQUEST_KEY','This extraction request key was already used for different inputs.');
    return recoverInterruptedRun(existing.body);
  }
  const pkg=await getPackage(packageId),snap=await snapshot(pkg,input);
  if(input.mode==='cached') {
    const cached=(await query("SELECT body FROM officer_ai_runs WHERE package_id=$1 AND input_fingerprint=$2 AND body->>'state' IN ('succeeded','needs_input') AND body->>'promptVersion'=$3 ORDER BY created_at DESC LIMIT 1",[packageId,snap.fingerprint,PROMPT_VERSION])).rows[0]?.body;
    if(!cached) throw new AppError(404,'AI_CACHE_MISS','No completed extraction matches this exact preparation revision and evidence.');
    return {...cached,cached:true};
  }
  const run:OfficerAiRun={id:randomUUID(),packageId,packageRevision:pkg.revision,requestKey:input.requestKey,state:'running',provider:'nous',inputFingerprint:snap.fingerprint,sourceHashes:snap.sourceHashes,partHashes:snap.partHashes,partIds:input.partIds,entityIds:snap.entityIds,imageRegions:input.imageRegions,answers:snap.context.operatorAnswers,promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,candidates:[],questions:[],suggestions:[],validationErrors:[],calls:[],budget:aiBudget(),startedAt:new Date().toISOString()};
  const inserted=await query('INSERT INTO officer_ai_runs(id,package_id,request_key,input_fingerprint,body,private_input) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(package_id,request_key) DO NOTHING RETURNING id',[run.id,packageId,input.requestKey,snap.fingerprint,run,{requestDigest,parts:snap.parts,context:snap.context}]);
  if(!inserted.rowCount) return extract(packageId,input);
  const rawOutputs:unknown[]=[];
  try {
    if(snap.parts.some(p=>!p.text.trim()&&!input.imageRegions?.some(r=>r.partId===p.id))) {
      run.state='needs_input';run.message='A selected part has no extracted text. Supply native text or a verified OCR derivative for the relevant page. No image or inferred geometry was sent.';
      run.questions=['Which source text supports the missing facts? Add or correct the relevant source part before resuming.'];
    } else {
      const inspection=await inspectNous();
      if(inspection.status.state!=='available' || !inspection.model) {run.state='blocked';run.message=inspection.status.message;}
      else {
        run.model=inspection.model.id;
        if(input.imageRegions?.length&&!inspection.status.capabilities?.image) throw new AppError(422,'AI_IMAGE_ROUTE','The authenticated free route does not support image input.');
        const cached=(await query("SELECT body FROM officer_ai_runs WHERE package_id=$1 AND input_fingerprint=$2 AND body->>'model'=$3 AND body->>'state' IN ('succeeded','needs_input') ORDER BY created_at DESC LIMIT 1",[packageId,snap.fingerprint,run.model])).rows[0]?.body;
        if(cached) {run.state=cached.state;run.candidates=cached.candidates;run.questions=cached.questions;run.suggestions=cached.suggestions??[];run.validationErrors=cached.validationErrors;run.derivatives=cached.derivatives;run.cached=true;run.cachedFromRunId=cached.cachedFromRunId??cached.id;run.message=`Reused stored extraction ${cached.id} for identical evidence, revision and route.`;}
        else {
          const images=await selectedImageCrops(snap.parts,input.imageRegions??[]);
          run.derivatives=images.map(({bytes,dataUrl,...metadata})=>metadata);
          for(const image of images) await query('INSERT INTO officer_ai_derivatives(run_id,part_id,sha256,bytes) VALUES($1,$2,$3,$4)',[run.id,image.partId,image.sha256,image.bytes]);
          const parts=snap.parts.map(part=>{const image=images.find(i=>i.partId===part.id);return {...part,...(image?{imageRegion:image.region,derivativeSha256:image.sha256}:{})};});
          await saveRun(run,rawOutputs);
          let repair: {output:unknown;errors:string[]}|undefined;
          for(let attempt=0;attempt<run.budget.maxCalls;attempt++) {
            const result=await callNous(run.model!,extractionMessages(parts,snap.context,repair,images));
            run.calls.push(result.call);rawOutputs.push(result.raw);
            await saveRun(run,rawOutputs);
            const parsed=validateExtraction(result.output,parts,snap.entities,snap.frames,snap.geometryFrames);
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
    run.state=error instanceof AppError && error.code==='STALE_REVISION'?'stale':'failed';
    run.message=error instanceof Error && /^(Nous returned HTTP|Nous attempted|NOUS_API_KEY)/.test(error.message)?error.message:'The bounded extraction could not finish. No facts were applied; check provider connectivity or retry the selected source parts.';
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
const json=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
export async function officerAiRoutes(request:Request,p:string[]):Promise<Response|null> {
  if(p.length===2&&p[0]==='ai'&&p[1]==='status'&&request.method==='GET') return json((await inspectNous()).status);
  if(p[0]!=='import-packages'||p[2]!=='ai-extractions') return null;
  const packageId=uuid.parse(p[1]);
  if(request.method==='GET'&&p.length===6&&p[4]==='derivatives') {
    const run=(await query('SELECT body FROM officer_ai_runs WHERE id=$1 AND package_id=$2',[uuid.parse(p[3]),packageId])).rows[0]?.body as OfficerAiRun|undefined;
    if(!run)notFound('Extraction run not found.');
    const image=(await query('SELECT d.bytes,d.sha256 FROM officer_ai_derivatives d JOIN officer_ai_runs r ON r.id=d.run_id WHERE d.run_id=$1 AND d.part_id=$2 AND r.package_id=$3',[run.cachedFromRunId??run.id,uuid.parse(p[5]),packageId])).rows[0];
    if(!image)notFound('Selected crop derivative is unavailable.');
    return new Response(new Uint8Array(image.bytes),{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000, immutable','X-Content-SHA256':image.sha256}});
  }
  if(request.method==='GET'&&p.length===3) {await getPackage(packageId);return json(await Promise.all((await query('SELECT body FROM officer_ai_runs WHERE package_id=$1 ORDER BY created_at DESC LIMIT 30',[packageId])).rows.map(r=>recoverInterruptedRun(r.body))));}
  if(request.method==='GET'&&p.length===4) return json(await recoverInterruptedRun((await query('SELECT body FROM officer_ai_runs WHERE package_id=$1 AND id=$2',[packageId,uuid.parse(p[3])])).rows[0]?.body??notFound('Extraction run not found.')));
  if(request.method==='POST'&&p.length===3) return json(await extract(packageId,inputSchema.parse(await request.json())));
  if(request.method==='POST'&&p.length===5&&p[4]==='apply') {
    const input=z.object({expectedRevision:revision,candidateIds:z.array(uuid).min(1).max(40)}).strict().parse(await request.json());
    return json(await applyRun(packageId,uuid.parse(p[3]),input.expectedRevision,input.candidateIds));
  }
  return null;
}
