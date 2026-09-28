import {type ChunkMappingObservation,type MappingPlan,type SourceProfile,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {sha256} from '../../../infrastructure/storage';
import {compileMapping} from './registry';

type Field=ChunkMappingObservation['sourceKey'];
export type KeyRow={source_key_sha256:string;source_key:string;first_feature_index:number};
export type KeyDecision={hash:string;value:string;firstIndex:number;laterIndex:number|null};
const unknown=(path:string|null=null):Field=>({state:'unknown',value:null,sourcePath:path});
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
export function candidateKeyHashes(records:StreamingVectorRecord[],plan:MappingPlan){
  const path=plan.operations.find(op=>op.target==='building.sourceKey')!.sourcePath;
  return [...new Set(records.filter(record=>record.disposition==='accepted').map(record=>{
    const value=field(record.feature as Record<string,unknown>,path);
    return value.state==='known'?sha256(value.value!):null;
  }).filter((value):value is string=>value!==null))];
}

/** A source-linked draft projection. Geometry stays in the immutable raw chunk; no frame or role is inferred. */
export function normalizeMappedChunk(records:StreamingVectorRecord[],plan:MappingPlan,profile:SourceProfile,
  rawJobId:string,chunkIndex:number,existing:KeyRow[],baselineSchema:string|null){
  compileMapping(plan,profile);
  const shapes=new Set<string>();
  for(const record of records){
    if(record.disposition!=='accepted')continue;
    const feature=record.feature as Record<string,unknown>;
    shapes.add(`geometry:${String((feature.geometry as Record<string,unknown>)?.type)}`);
    if(Object.hasOwn(feature,'id'))shapes.add(`id:${Array.isArray(feature.id)?'array':typeof feature.id}`);
    const properties=feature.properties;
    if(properties&&typeof properties==='object'&&!Array.isArray(properties))
      for(const [key,value] of Object.entries(properties))shapes.add(`property:${key}:${value===null?'null':Array.isArray(value)?'array':typeof value}`);
  }
  const schemaFingerprint=shapes.size?sha256(JSON.stringify([...shapes].sort())):null;
  const schemaDrift=!!baselineSchema&&!!schemaFingerprint&&baselineSchema!==schemaFingerprint;
  const keyPath=plan.operations.find(op=>op.target==='building.sourceKey')!.sourcePath;
  const namePath=plan.operations.find(op=>op.target==='building.name')?.sourcePath;
  const byHash=new Map(existing.map(row=>[row.source_key_sha256,{value:row.source_key,firstIndex:row.first_feature_index}]));
  const keys:KeyDecision[]=[],observations:ChunkMappingObservation[]=[];
  for(const record of records){
    const issues:string[]=schemaDrift?['SCHEMA_DRIFT']:[];
    if(record.disposition!=='accepted'){
      observations.push({featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,
        rawSha256:record.rawSha256,disposition:'quarantined',sourceKey:unknown(keyPath),
        name:namePath?unknown(namePath):{state:'absent',value:null,sourcePath:null},geometryRef:null,
        issueCodes:[record.issueCode??'RAW_FEATURE_QUARANTINED']});
      continue;
    }
    const feature=record.feature as Record<string,unknown>;
    let sourceKey=field(feature,keyPath),name=namePath?field(feature,namePath):{state:'absent',value:null,sourcePath:null} as Field;
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
    const sourcePath=profile.paths.find(item=>item.path===keyPath);
    if(sourcePath && (sourceKey.state==='null'&&sourcePath.explicitNull===0||sourceKey.state==='absent'&&sourcePath.absent===0))issues.push('SCHEMA_DRIFT');
    const properties=feature.properties;
    if(properties&&typeof properties==='object'&&!Array.isArray(properties)){
      for(const [key,value] of Object.entries(properties)){
        const path=`/features/*/properties/${key.replaceAll('~','~0').replaceAll('/','~1')}`;
        const expected=profile.paths.find(item=>item.path===path);
        const type=Array.isArray(value)?'array':typeof value;
        if(!expected||value!==null&&!expected.types.includes(type as typeof expected.types[number])){
          issues.push('SCHEMA_DRIFT');break;
        }
      }
    }
    if(namePath){
      const expected=profile.paths.find(item=>item.path===namePath);
      if(name.state==='unknown'||expected&&(name.state==='null'&&expected.explicitNull===0||name.state==='absent'&&expected.absent===0))issues.push('SCHEMA_DRIFT');
    }
    const geometry=feature.geometry as Record<string,unknown>|undefined;
    if(!geometry||!profile.geometryTypes.includes(String(geometry.type)))issues.push('SCHEMA_DRIFT');
    const identityIssue=issues.some(item=>item.startsWith('MAPPING_IDENTITY')||item==='DUPLICATE_SOURCE_KEY'||item==='SOURCE_KEY_HASH_COLLISION');
    observations.push({featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,
      rawSha256:record.rawSha256,disposition:identityIssue?'unresolved':'observed',sourceKey,name,
      geometryRef:{rawJobId,chunkIndex,featureIndex:record.featureIndex,rawSha256:record.rawSha256,
        sourcePath:'/features/*/geometry'},issueCodes:[...new Set(issues)].slice(0,8)});
  }
  return {records:observations,keys,schemaFingerprint,schemaDrift};
}
