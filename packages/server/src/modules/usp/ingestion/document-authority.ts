import type {PoolClient} from 'pg';
import {DocumentInputSchema} from '@ulpin/contracts/usp';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {documentSourceTx,assertDocumentInputTx} from './document-context';
import {isIFCProtectedSource} from './ifc';
import {isDXFProtectedSource} from './dxf';
import {isKMLProtectedSource} from './kml';
import {isCityGMLProtectedSource} from './citygml';
import {isGltfProtectedSource} from './gltf';
import {isGeoParquetProtectedSource} from './geoparquet';

type SourceRow=Record<string,any>;
type Mode='original'|'snapshot'|'copy';
const denied=()=>{throw new AppError(403,'DOCUMENT_DENIED','This source context is unavailable.');};
/** Legacy sources retain their existing authority. Marked originals and actual
 * copied-source lineage always use the canonical document authority, even when
 * a captured body predates the privacy correction. Never mutate stored history. */
export async function documentAuthorityTx(client:PoolClient,captured:SourceRow,mode:Mode='snapshot',seen=new Set<string>(),protect=false):Promise<boolean>{
  if(typeof captured.id!=='string')denied();
  if(seen.has(captured.id)||seen.size>=8)denied();seen.add(captured.id);
  const current=(await client.query('SELECT * FROM sources WHERE id=$1',[captured.id])).rows[0];
  if(isGltfProtectedSource(captured)||current&&isGltfProtectedSource(current))
    throw new AppError(409,'GLTF_CANONICAL_SOURCE_REQUIRED','Use private glTF original/job authority; legacy snapshot and copy admission are unsupported.');
  if(isKMLProtectedSource(captured)||current&&isKMLProtectedSource(current))
    throw new AppError(409,'KML_CANONICAL_SOURCE_REQUIRED','Use private KML original/job authority; legacy snapshot and copy admission are unsupported.');
  if(isCityGMLProtectedSource(captured)||current&&isCityGMLProtectedSource(current))
    throw new AppError(409,'CITYGML_CANONICAL_SOURCE_REQUIRED','Use private CityGML original/job authority; legacy snapshot and copy admission are unsupported.');
  if(isGeoParquetProtectedSource(captured)||current&&isGeoParquetProtectedSource(current))
    throw new AppError(409,'GEOPARQUET_CANONICAL_SOURCE_REQUIRED','Use private GeoParquet original/job authority; legacy snapshot and copy admission are unsupported.');
  if(isDXFProtectedSource(captured)||current&&isDXFProtectedSource(current))
    throw new AppError(409,'DXF_CANONICAL_SOURCE_REQUIRED','Use the current private DXF original/job authority; legacy snapshot and copy admission are unsupported.');
  if(isIFCProtectedSource(captured)||current&&isIFCProtectedSource(current))
    throw new AppError(409,'IFC_CANONICAL_SOURCE_REQUIRED','Use the current private IFC original/job authority; legacy snapshot and copy admission are unsupported.');
  const marked=Boolean(captured.inspection?.documentOriginal||current?.inspection?.documentOriginal);
  const lineage=captured.inspection?.copiedFrom??current?.inspection?.copiedFrom;
  if(!current){if(marked||lineage)denied();return false;}
  for(const field of ['case_id','revision','sha256','object_key'])
    if(captured[field]!==undefined&&captured[field]!==current[field])conflict('The exact document source changed.');
  if(captured.bytes!==undefined&&Number(captured.bytes)!==Number(current.bytes))conflict('The exact document byte receipt changed.');
  let document=marked;
  if(marked){
    if(!current.inspection?.documentOriginal)denied();
    if(protect)await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE',[current.case_id]);
    const ctx=await documentSourceTx(client,current.case_id,current.id);
    if(captured.inspection?.documentOriginal?.subject!==undefined&&captured.inspection.documentOriginal.subject!==ctx.binding.subject)denied();
    if(mode==='snapshot'){
      const accepted=captured.inspection?.documentAccepted??current.inspection?.documentAccepted;
      if(!accepted?.jobId||!accepted?.sha256)throw new AppError(409,'DOCUMENT_STAGE_UNAVAILABLE','A current canonical extraction receipt is required.');
      const job=(await client.query(`SELECT j.*,m.input_sha256,m.logical_state,m.result_ref FROM jobs j
        JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='document-extraction'`,
        [accepted.jobId,current.case_id,current.id])).rows[0];
      if(!job||job.status!=='succeeded'||job.logical_state!=='succeeded'||job.result_ref?.sha256!==accepted.sha256)
        throw new AppError(409,'DOCUMENT_STAGE_UNAVAILABLE','The exact canonical extraction receipt is unavailable.');
      const input=DocumentInputSchema.parse(job.payload);
      if(fingerprint(input)!==job.input_fingerprint||job.input_sha256!==job.input_fingerprint)
        throw new AppError(422,'DOCUMENT_INPUT_INTEGRITY','The canonical document input failed its hash check.');
      await assertDocumentInputTx(client,input);
    }
  }
  if(lineage?.sourceRevisionId){
    const latestLineage=current.inspection?.copiedFrom;
    if(latestLineage&&['caseId','sourceRevisionId','sourceHash','sourceRevision'].some(field=>lineage[field]!==latestLineage[field]))
      conflict('The copied source authority changed.');
    const parent=(await client.query('SELECT * FROM sources WHERE id=$1',[lineage.sourceRevisionId])).rows[0];
    if(!parent)denied();
    if(parent.case_id!==lineage.caseId||parent.sha256!==lineage.sourceHash||parent.revision!==lineage.sourceRevision
      ||parent.sha256!==current.sha256||Number(parent.bytes)!==Number(current.bytes))conflict('The copied document lineage changed.');
    document=await documentAuthorityTx(client,parent,mode,seen,protect)||document;
  }
  if(document){
    if(protect)await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE',[current.case_id]);
    const context=(await client.query('SELECT archived FROM cases WHERE id=$1',[current.case_id])).rows[0];
    if(!context||context.archived)denied();
    if(mode==='copy')throw new AppError(409,'DOCUMENT_CANONICAL_COPY_REQUIRED','Staged document sources must use their canonical extraction and a reviewed conversion. Legacy re-extraction is unavailable.');
  }
  return document;
}

/** A view of immutable history, never a rewrite of its stored hashes or bodies. */
export function documentSnapshotView<T extends SourceRow>(body:T,document:boolean):T{
  if(!document)return body;
  const {documentOriginal:_original,documentAccepted:_accepted,referenceParts:_parts,...inspection}=body.inspection??{};
  return {...body,inspection};
}

export async function captureDocumentSourceTx(client:PoolClient,source:SourceRow,packageParts:unknown[]=[]) {
  const document=await documentAuthorityTx(client,source,'snapshot',new Set(),true);
  return {...source,inspection:{...(source.inspection??{}),referenceParts:document?[]:[...(source.inspection?.referenceParts??[]),...packageParts]}};
}

export function assertDocumentPackageParts(pkg:{parts:{sourceRevisionId:string;copiedFrom?:{sourceRevisionId:string}}[]},marked:Set<string>){
  if(pkg.parts.some(part=>marked.has(part.sourceRevisionId)||marked.has(part.copiedFrom?.sourceRevisionId??'')))
    throw new AppError(409,'DOCUMENT_STAGED_PACKAGE_PARTS','This retained package contains staged document parts. Use the canonical document result and an explicitly reviewed conversion. History was not changed.');
}
