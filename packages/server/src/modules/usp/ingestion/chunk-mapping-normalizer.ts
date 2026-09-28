import {type ChunkMappingObservation,type MappingPlan,type SourceProfile,type StreamedMappingPlan,
  type StreamedProfileGeneration,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {sha256} from '../../../infrastructure/storage';
import {compileMapping} from './registry';
import {compileStreamedMapping} from './streamed-mapping';

type Plan=MappingPlan|StreamedMappingPlan;
type Profile=SourceProfile|StreamedProfileGeneration;

type Field=ChunkMappingObservation['sourceKey'];
export type KeyRow={source_key_sha256:string;source_key:string;first_feature_index:number};
export type KeyDecision={hash:string;value:string;firstIndex:number;laterIndex:number|null};
const unknown=(path:string|null=null):Field=>({state:'unknown',value:null,sourcePath:path});
/** The existing literal_text@1 operation copies only bounded, nonempty, verbatim text. */
export const literalTextValueValid=(value:string)=>value.length>0&&value.length<=2048&&value.trim()===value;
const pathForProperty=(key:string)=>`/features/*/properties/${key.replaceAll('~','~0').replaceAll('/','~1')}`;
const valueType=(value:unknown)=>Array.isArray(value)?'array':typeof value;
const field=(feature:Record<string,unknown>,path:string):Field=>{
  if(path==='/features/*/id')return Object.hasOwn(feature,'id')
    ? feature.id===null?{state:'null',value:null,sourcePath:path}
      :typeof feature.id==='string'?{state:'known',value:feature.id,sourcePath:path}:unknown(path)
    :{state:'absent',value:null,sourcePath:path};
  const prefix='/features/*/properties/';
  if(!path.startsWith(prefix))return unknown(path);
  const key=path.slice(prefix.length).replaceAll('~1','/').replaceAll('~0','~');
  const properties=feature.properties;
  if(!properties||typeof properties!=='object'||Array.isArray(properties)||!Object.hasOwn(properties,key))
    return {state:'absent',value:null,sourcePath:path};
  const value=(properties as Record<string,unknown>)[key];
  return value===null?{state:'null',value:null,sourcePath:path}
    :typeof value==='string'?{state:'known',value,sourcePath:path}:unknown(path);
};
export function candidateKeyHashes(records:StreamingVectorRecord[],plan:Plan){
  const path=plan.operations.find(op=>op.target==='building.sourceKey')!.sourcePath;
  return [...new Set(records.filter(record=>record.disposition==='accepted').map(record=>{
    const value=field(record.feature as Record<string,unknown>,path);
    return value.state==='known'?sha256(value.value!):null;
  }).filter((value):value is string=>value!==null))];
}

/** Compare each actual source record with the pinned inventory, including its permitted null and absent variants. */
function sourceShapeIssues(feature:Record<string,unknown>,profile:Profile){
  const issues=new Set<string>(),paths=new Map(profile.paths.map(item=>[item.path,item]));
  const properties=feature.properties;
  const attributes=properties&&typeof properties==='object'&&!Array.isArray(properties)
    ? properties as Record<string,unknown>:null;
  const observed=new Map<string,unknown>();
  if(Object.hasOwn(feature,'geometry'))observed.set('/features/*/geometry',feature.geometry);
  if(Object.hasOwn(feature,'id'))observed.set('/features/*/id',feature.id);
  if(attributes)for(const [key,value] of Object.entries(attributes))observed.set(pathForProperty(key),value);
  for(const [path,value] of observed){
    const expected=paths.get(path);
    if(!expected){issues.add('SCHEMA_DRIFT_PATH');continue;}
    if(value===null){if(expected.explicitNull===0)issues.add('SCHEMA_DRIFT_NULL');}
    else if(!expected.types.includes(valueType(value) as typeof expected.types[number]))issues.add('SCHEMA_DRIFT_TYPE');
  }
  for(const expected of profile.paths)
    if(!observed.has(expected.path)&&expected.absent===0)issues.add('SCHEMA_DRIFT_ABSENT');
  const geometry=feature.geometry;
  if(!geometry||typeof geometry!=='object'||Array.isArray(geometry)
    ||!profile.geometryTypes.includes(String((geometry as Record<string,unknown>).type)))
    issues.add('SCHEMA_DRIFT_GEOMETRY');
  return [...issues];
}

/** A source-linked draft projection. Geometry stays in the immutable raw chunk; no frame or role is inferred. */
export function normalizeMappedChunk(records:StreamingVectorRecord[],plan:Plan,profile:Profile,
  rawJobId:string,chunkIndex:number,existing:KeyRow[]){
  if(plan.version==='manual-geojson/1')compileMapping(plan,profile as SourceProfile);
  else compileStreamedMapping(plan,profile as StreamedProfileGeneration);
  // A chunk can observe a permitted subset; the slot names the pinned allowed inventory.
  const schemaFingerprint=profile.source.schemaFingerprint;
  const keyPath=plan.operations.find(op=>op.target==='building.sourceKey')!.sourcePath;
  const namePath=plan.operations.find(op=>op.target==='building.name')?.sourcePath;
  const byHash=new Map(existing.map(row=>[row.source_key_sha256,{value:row.source_key,firstIndex:row.first_feature_index}]));
  const keys:KeyDecision[]=[],observations:ChunkMappingObservation[]=[];
  for(const record of records){
    const issues:string[]=[];
    if(record.disposition!=='accepted'){
      observations.push({featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,
        rawSha256:record.rawSha256,disposition:'quarantined',sourceKey:unknown(keyPath),
        name:namePath?unknown(namePath):unknown(),geometryRef:null,
        issueCodes:[record.issueCode??'RAW_FEATURE_QUARANTINED']});
      continue;
    }
    const feature=record.feature as Record<string,unknown>;
    issues.push(...sourceShapeIssues(feature,profile));
    let sourceKey=field(feature,keyPath),name=namePath?field(feature,namePath):unknown();
    if(name.state==='known'&&!literalTextValueValid(name.value!)){
      name=unknown(namePath);issues.push('MAPPING_TEXT_INVALID');
    }
    if(sourceKey.state==='known'){
      if(!sourceKey.value||sourceKey.value.length>256||sourceKey.value.trim()!==sourceKey.value){
        sourceKey=unknown(keyPath);issues.push('MAPPING_IDENTITY_INVALID');
      }else{
        const value=sourceKey.value,hash=sha256(value),prior=byHash.get(hash);
        if(prior){
          if(prior.value!==value)issues.push('SOURCE_KEY_HASH_COLLISION');
          else {sourceKey={...sourceKey,state:'conflicting'};issues.push('DUPLICATE_SOURCE_KEY');
            keys.push({hash,value,firstIndex:prior.firstIndex,laterIndex:record.featureIndex});}
        }else{byHash.set(hash,{value,firstIndex:record.featureIndex});
          keys.push({hash,value,firstIndex:record.featureIndex,laterIndex:null});}
      }
    }else issues.push(sourceKey.state==='null'?'MAPPING_IDENTITY_NULL':sourceKey.state==='absent'?'MAPPING_IDENTITY_ABSENT':'MAPPING_IDENTITY_INVALID');
    const identityIssue=issues.some(item=>item.startsWith('MAPPING_IDENTITY')||item==='DUPLICATE_SOURCE_KEY'||item==='SOURCE_KEY_HASH_COLLISION');
    observations.push({featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,
      rawSha256:record.rawSha256,disposition:identityIssue||issues.includes('MAPPING_TEXT_INVALID')
        ||issues.some(item=>item.startsWith('SCHEMA_DRIFT'))?'unresolved':'observed',sourceKey,name,
      geometryRef:{rawJobId,chunkIndex,featureIndex:record.featureIndex,rawSha256:record.rawSha256,
        sourcePath:'/features/*/geometry'},issueCodes:[...new Set(issues)].slice(0,8)});
  }
  const schemaDrift=observations.some(item=>item.issueCodes.some(code=>code.startsWith('SCHEMA_DRIFT')));
  return {records:observations,keys,schemaFingerprint,schemaDrift};
}
