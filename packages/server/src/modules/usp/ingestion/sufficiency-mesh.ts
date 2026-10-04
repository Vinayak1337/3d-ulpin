import type {PoolClient} from 'pg';
import {SufficiencyProcessingSchema,SufficiencyMeshMetadataSchema,type SufficiencyRecordPinSchema} from '@ulpin/contracts/usp';
import {ObjResultSchema} from '../../../../../contracts/src/usp/obj-ingestion';
import {GltfResultSchema} from '../../../../../contracts/src/usp/gltf-ingestion';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {isObjProtectedSource,objSourceTx,objStatusTx,objResultKey,objResultBytes,objArtifactKey} from './obj';
import {isGltfProtectedSource,gltfSourceTx,gltfStatusTx,gltfResultKey,gltfResultBytes,gltfArtifactKey} from './gltf';
import {assertObjReadTools} from './obj-config';
import {assertGltfReadTools} from './gltf-config';
import {readFusionObject,fusionJson,fusionLive,type FusionBudget} from './source-fusion-authority';
import type {z} from 'zod';

export type SufficiencyMeshDependencies={read?:typeof readFusionObject;objTools?:typeof assertObjReadTools;gltfTools?:typeof assertGltfReadTools};
export type SufficiencyMeshOptions={dependencies?:SufficiencyMeshDependencies;budget?:FusionBudget};
export const meshBudget=():FusionBudget=>({deadlineAt:Date.now()+30_000,signal:AbortSignal.timeout(30_000),reservedBytes:0});
// Preserve the complete binding, including its bigint cursor tag, as JSON data.
// Raw input/reader/tool/source hashes themselves are never normalized.
const authorityFingerprint=(value:unknown)=>fingerprint(JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)));
function resultSize(size:number){if(size>512*1024)throw new AppError(413,'SUFFICIENCY_MESH_RESULT_LIMIT','Native metadata exceeds its bounded receipt profile.');return size;}
/** A present malformed/null marker still invokes the protected canonical route. */
export async function sufficiencyMeshOriginalTx(client:PoolClient,captured:Record<string,any>,lock=false){
  const current=(await client.query('SELECT * FROM sources WHERE id=$1',[captured.id])).rows[0];
  const obj=isObjProtectedSource(captured)||Boolean(current&&isObjProtectedSource(current)),
    gltf=isGltfProtectedSource(captured)||Boolean(current&&isGltfProtectedSource(current));
  if(!obj&&!gltf)return null;
  if(!current||obj&&gltf)throw new AppError(403,'SUFFICIENCY_MESH_DENIED','This retained mesh authority is unavailable or ambiguous.');
  const source=await (obj?objSourceTx:gltfSourceTx)(client,current.case_id,current.id,lock);
  if(['id','case_id','family_id','revision','sha256','profile','object_key'].some(key=>captured[key]!==undefined&&captured[key]!==source.source[key])||
    captured.bytes!==undefined&&Number(captured.bytes)!==Number(source.source.bytes)||
    fingerprint(captured.inspection??null)!==fingerprint(source.source.inspection??null))
    conflict('The exact retained mesh original authority changed.');
  if(Object.hasOwn(source.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'SUFFICIENCY_MESH_DENIED','Mesh sufficiency requires its canonical retained original, not copied source authority.');
  return {kind:obj?'obj' as const:'gltf' as const,...source};
}
/** Inspect only an exact accepted producer receipt. Artifact references/counts
 * remain metadata; no geometry arrays or omitted/unfetched resources are read. */
export async function sufficiencyMeshEvidenceTx(client:PoolClient,captured:Record<string,any>,options:SufficiencyMeshOptions={}){
  const deps=options.dependencies??{},budget=options.budget??meshBudget();fusionLive(budget);
  const source=await sufficiencyMeshOriginalTx(client,captured);if(!source)return null;
  const kind=source.kind,operation=kind+'-native',status=kind==='obj'?objStatusTx:gltfStatusTx,
    latest=(await client.query(`SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation=$3 ORDER BY created_at DESC,id LIMIT 1`,
      [source.current.id,source.source.id,operation])).rows[0],
    row=latest?await status(client,source.current.id,source.source.id,latest.id):null;
  const toolCheck=()=>{if(row){if(kind==='obj')(deps.objTools??assertObjReadTools)(row.input.tools as Parameters<typeof assertObjReadTools>[0],budget.deadlineAt);
    else (deps.gltfTools??assertGltfReadTools)(row.input.tools,budget.deadlineAt);}};
  let state='pending',nativeStatus:string|null=null,resultSha256:string|null=null,tools:'not_checked'|'current'|'unavailable'='not_checked',code:string|null=null,
    metadata:z.infer<typeof SufficiencyMeshMetadataSchema>|null=null;
  if(row){
    code=typeof row.job.error?.code==='string'?row.job.error.code.slice(0,100):null;
    state=row.stale?'stale':row.job.status==='queued'?'pending':row.job.status==='running'?'running':row.job.status==='succeeded'?'inspected_local':'failed';
    if(!row.stale&&row.job.status==='succeeded'){
      try{toolCheck();tools='current';}catch(error){if(error instanceof AppError&&error.status===503){tools='unavailable';state='unavailable';code=error.code;}else throw error;}
      if(tools==='current'){
        const hash=row.job.result_ref.sha256,size=kind==='obj'?objResultBytes(row.job.result_ref,row.input.jobId):gltfResultBytes(row.job.result_ref,row.input.jobId),
          key=kind==='obj'?objResultKey(row.input.jobId,hash):gltfResultKey(row.input.jobId,hash),
          bytes=await (deps.read??readFusionObject)(key,resultSize(size),hash,budget),raw=fusionJson(bytes,budget),
          result=kind==='obj'?ObjResultSchema.parse(raw):GltfResultSchema.parse(raw),
          artifactKey=kind==='obj'?objArtifactKey(row.input.jobId,result.artifact.sha256):gltfArtifactKey(row.input.jobId,result.artifact.sha256);
        if(fingerprint(result.input)!==fingerprint(row.input)||result.artifact.key!==artifactKey)
          throw new AppError(422,'SUFFICIENCY_MESH_RESULT_INTEGRITY','The native metadata receipt belongs to another original or accepted job.');
        metadata=kind==='obj'?{kind,summary:ObjResultSchema.parse(result).summary}:{kind,summary:GltfResultSchema.parse(result).summary};
        state=result.summary.status;nativeStatus=result.summary.status;resultSha256=hash;
      }
    }
  }
  const processing=SufficiencyProcessingSchema.parse({state,jobId:row?.job.id??null,resultSha256,nativeStatus,modelStatus:null,
    mesh:{kind,inputSha256:row?fingerprint(row.input):null,readerSha256:row?.input.readerSha256??null,
      acceptedFence:row?.job.status==='succeeded'?Number(row.job.accepted_fence):null,tools,code,metadata,
      coverage:'accepted_result_metadata_only; native_artifact_not_read'}}),
    authority={source,row},recordPins: z.infer<typeof SufficiencyRecordPinSchema>[]=row?[{authority:'job',id:row.job.id,
      revision:Number(row.job.accepted_fence??0),sha256:fingerprint(row.job)}]:[];
  const revalidate=async(lock=false)=>{
    fusionLive(budget);
    const currentSource=await sufficiencyMeshOriginalTx(client,captured,lock),
      currentLatest=(await client.query(`SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation=$3 ORDER BY created_at DESC,id LIMIT 1`,
        [source.current.id,source.source.id,operation])).rows[0],
      currentRow=currentLatest?await status(client,source.current.id,source.source.id,currentLatest.id,lock):null;
    if(authorityFingerprint({source:currentSource,row:currentRow})!==authorityFingerprint(authority))conflict('The mesh case, source, job, result or accepted attempt changed during inspection.');
    if(tools==='current')toolCheck();fusionLive(budget);
  };
  await revalidate();
  return {processing,recordPins,evidenceSha256:authorityFingerprint({authority,processing}),revalidate};
}
