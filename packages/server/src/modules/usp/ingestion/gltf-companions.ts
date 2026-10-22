import type {PoolClient} from 'pg';
import {GLTF_COMPANION_LIMIT,GLTF_LIMITS,GltfBufferBindingSchema,type GltfBufferBinding,type GltfInput}
  from '../../../../../contracts/src/usp/gltf-ingestion';
import {AppError,conflict} from '../../../infrastructure/errors';
import {assertIntakeSource,type IntakeSourceRow} from './intake-context';
import type {IngestionBinding} from './events';

/**
 * GB1. A glTF buffer whose uri names a plain sibling file is joined to the retained original with exactly that
 * name. services/geo/geo/native_gltf.py `companion_name` applies the identical rule and refuses on its own.
 */
const scheme=/^[A-Za-z][A-Za-z0-9+.-]*:/,badEscape=/%(?![0-9A-Fa-f]{2})/;
export function gltfCompanionName(uri:string):string|null{
  if(scheme.test(uri)||badEscape.test(uri)||uri.includes('?')||uri.includes('#'))return null;
  let name:string;
  try{name=decodeURIComponent(uri);}catch{return null;}
  if(!name||name.length>1024||name==='.'||name==='..'||/[\\/:]/.test(name)||/[\u0000-\u001f\u007f]/.test(name))return null;
  return name;
}

export type GltfExternalBuffer={bufferIndex:number;uri:string};
/** The buffer uris a glTF (JSON or GLB JSON chunk) declares, except data: uris; null when it cannot be read here. */
export function gltfExternalBuffers(raw:Buffer):GltfExternalBuffer[]|null{
  let json=raw;
  if(raw.subarray(0,4).toString('latin1')==='glTF'){
    if(raw.length<20||raw.readUInt32LE(16)!==0x4E4F534A)return null;
    const size=raw.readUInt32LE(12);if(20+size>raw.length)return null;
    json=raw.subarray(20,20+size);
  }
  let document:any;
  try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(json));}catch{return null;}
  if(!document||typeof document!=='object'||Array.isArray(document))return null;
  const buffers=document.buffers??[];
  if(!Array.isArray(buffers))return null;
  return buffers.flatMap((buffer:any,bufferIndex:number)=>buffer&&typeof buffer==='object'&&typeof buffer.uri==='string'
    &&!buffer.uri.startsWith('data:')?[{bufferIndex,uri:buffer.uri}]:[]);
}

/** A retained original offered as a companion: a case source, or a member of the ZIP the glTF came from. */
export type GltfCompanionCandidate={sourceId:string;name:string;memberPath:string|null;sha256:string;bytes:number;
  objectKey:string;authorized:boolean};
/** Where the glTF itself came from: its own retained original, or a member path inside a retained ZIP. */
export type GltfOrigin={kind:'source'}|{kind:'zip_member';zipSourceId:string;memberPath:string};

const memberFolder=(path:string)=>path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';

/**
 * Exact, deterministic binding. Source candidates match by original file name; when the glTF is a ZIP member, only
 * members of that ZIP at the same relative folder match. One candidate binds; several refuse as ambiguous; none is
 * not recorded (the reader keeps needs_input). The glTF and every bound file share the reader's 16 MiB budget.
 */
export function bindGltfBuffers(uris:GltfExternalBuffer[],candidates:GltfCompanionCandidate[],origin:GltfOrigin,
  gltfBytes:number):GltfBufferBinding[]{
  let budget=GLTF_LIMITS.originalBytes-gltfBytes;
  const bindings:GltfBufferBinding[]=[];
  for(const {bufferIndex,uri} of uris){
    if(bindings.length>=GLTF_COMPANION_LIMIT)break;
    const name=gltfCompanionName(uri);
    if(name===null){bindings.push({bufferIndex,uri,state:'refused',reason:'EXTERNAL_URI_NOT_PLAIN_NAME'});continue;}
    const matches=candidates.filter(candidate=>origin.kind==='source'
      ?candidate.memberPath===null&&candidate.name===name
      :candidate.sourceId===origin.zipSourceId&&candidate.memberPath===memberFolder(origin.memberPath)+name);
    if(!matches.length)continue;
    if(matches.length>1){bindings.push({bufferIndex,uri,state:'ambiguous',name,candidates:matches.length});continue;}
    const [match]=matches;
    if(!match.authorized){bindings.push({bufferIndex,uri,state:'refused',reason:'COMPANION_ACCESS'});continue;}
    if(match.bytes>budget){bindings.push({bufferIndex,uri,state:'refused',reason:'BYTE_BUDGET'});continue;}
    budget-=match.bytes;
    bindings.push(GltfBufferBindingSchema.parse({bufferIndex,uri,state:'bound',name,sourceId:match.sourceId,
      memberPath:match.memberPath,sha256:match.sha256,bytes:match.bytes,objectKey:match.objectKey}));
  }
  return bindings;
}

// Latest revision of each family without max(): a newer revision of the same family excludes a row.
const latest=`NOT EXISTS (SELECT 1 FROM sources n WHERE n.case_id=s.case_id AND n.family_id=s.family_id AND n.revision>s.revision)`;
const columns='s.id,s.case_id,s.family_id,s.revision,s.name,s.profile,s.bytes,s.sha256,s.object_key,s.status,s.inspection';

function candidate(row:IntakeSourceRow,binding:IngestionBinding):GltfCompanionCandidate{
  let authorized=true;
  try{assertIntakeSource(row,binding);}catch(error){if(!(error instanceof AppError))throw error;authorized=false;}
  return {sourceId:row.id,name:row.name,memberPath:null,sha256:row.sha256,bytes:Number(row.bytes),objectKey:row.object_key,authorized};
}

/**
 * The bindings of one glTF original against the other top-level retained originals of its case, read once when the
 * reader job is inserted. Nothing is read when the case holds no other original. The glTF is read only to find its
 * buffer uris; returns undefined when no uri is recorded, so the job input stays as before GB1.
 */
export async function gltfBufferBindingsTx(client:PoolClient,source:IntakeSourceRow,binding:IngestionBinding,
  readOriginal:()=>Promise<Buffer|null>):Promise<GltfBufferBinding[]|undefined>{
  const others=(await client.query(`SELECT s.id FROM sources s JOIN usp_intake_items i ON i.source_id=s.id
    AND i.case_id=s.case_id AND i.parent_item_id IS NULL WHERE s.case_id=$1 AND s.id<>$2 LIMIT 1`,
  [source.case_id,source.id])).rows.filter(row=>row.id!==source.id);
  if(!others.length)return undefined;
  const raw=await readOriginal(),uris=raw&&gltfExternalBuffers(raw);
  if(!uris?.length)return undefined;
  const names=[...new Set(uris.map(entry=>gltfCompanionName(entry.uri)).filter((name):name is string=>name!==null))];
  const rows:IntakeSourceRow[]=names.length?(await client.query(`SELECT ${columns} FROM sources s JOIN usp_intake_items i
    ON i.source_id=s.id AND i.case_id=s.case_id AND i.parent_item_id IS NULL
    WHERE s.case_id=$1 AND s.id<>$2 AND s.name=ANY($3::text[]) AND ${latest} ORDER BY s.id`,
  [source.case_id,source.id,names])).rows.filter(row=>row.id!==source.id):[];
  const bindings=bindGltfBuffers(uris,rows.map(row=>candidate(row,binding)),{kind:'source'},Number(source.bytes));
  return bindings.length?bindings:undefined;
}

/** A pinned bound original must still be the same latest retained bytes under the same access; else the input is stale. */
export async function assertGltfBuffersTx(client:PoolClient,input:GltfInput,binding:IngestionBinding){
  const bound=(input.buffers??[]).filter(entry=>entry.state==='bound');
  if(!bound.length)return;
  const rows:IntakeSourceRow[]=(await client.query(`SELECT ${columns} FROM sources s
    WHERE s.case_id=$1 AND s.id=ANY($2::uuid[]) AND ${latest}`,[input.caseId,bound.map(entry=>entry.sourceId)])).rows;
  for(const entry of bound){
    const row=rows.find(value=>value.id===entry.sourceId);
    if(!row||row.name!==entry.name||row.sha256!==entry.sha256||Number(row.bytes)!==entry.bytes||row.object_key!==entry.objectKey)
      conflict(`The retained original bound to glTF buffer ${entry.bufferIndex} (${entry.name}) changed. Read the glTF again.`);
    assertIntakeSource(row,binding);
  }
}
