import type {MappingPlanV2} from '@ulpin/contracts';
import {executeMappingPlanV2,mappedCellCounts,type MappingExecutionContext,type MappingExecutionResult,type MappingRow} from './mapping-executor';
import {isMappingPlanV2,mappingContextFromGisProfile} from './mapping-plan-v2';
import {type ChunkMappingObservation,type MappingPlan,type SourceProfile,type StreamedMappingPlan,
  type StreamedProfileGeneration,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {sha256} from '../../../infrastructure/storage';
import {compileMapping,setAsideGeometryTypes} from './registry';
import {compileStreamedMapping,prefixGeometryCompatible} from './streamed-mapping';
import {sourceFeaturePosition} from './streaming-vector-reader';

type Plan=MappingPlan|StreamedMappingPlan;
type Profile=SourceProfile|StreamedProfileGeneration;

type Field=ChunkMappingObservation['sourceKey'];
export type KeyRow={source_key_sha256:string;source_key:string;first_feature_index:number};
export type KeyDecision={hash:string;value:string;firstIndex:number;laterIndex:number|null};
const unknown=(path:string|null=null):Field=>({state:'unknown',value:null,sourcePath:path});
/** The existing literal_text@1 operation copies only bounded, nonempty, verbatim text. */
export const literalTextValueValid=(value:string)=>value.length>0&&value.length<=2048&&value.trim()===value;
const keyValueValid=(value:string|null):value is string=>!!value&&value.length<=256&&value.trim()===value;
const pathForProperty=(key:string)=>`/features/*/properties/${key.replaceAll('~','~0').replaceAll('/','~1')}`;
const valueType=(value:unknown)=>Array.isArray(value)?'array':typeof value;
/** Text is copied as written; a whole-number key (literal_integer_identifier@1) as its digits. */
const literal=(value:unknown,path:string,integer:boolean):Field=>value===null?{state:'null',value:null,sourcePath:path}
  :typeof value==='string'&&!integer?{state:'known',value,sourcePath:path}
    :integer&&Number.isSafeInteger(value)?{state:'known',value:String(value),sourcePath:path}:unknown(path);
const field=(feature:Record<string,unknown>,path:string,integer=false):Field=>{
  if(path==='/features/*/id')return Object.hasOwn(feature,'id')?literal(feature.id,path,integer)
    :{state:'absent',value:null,sourcePath:path};
  const prefix='/features/*/properties/';
  if(!path.startsWith(prefix))return unknown(path);
  const key=path.slice(prefix.length).replaceAll('~1','/').replaceAll('~0','~');
  const properties=feature.properties;
  if(!properties||typeof properties!=='object'||Array.isArray(properties)||!Object.hasOwn(properties,key))
    return {state:'absent',value:null,sourcePath:path};
  return literal((properties as Record<string,unknown>)[key],path,integer);
};
const keyOperation=(plan:Plan)=>plan.operations.find(op=>op.target.endsWith('.sourceKey'))!;
const integerKey=(plan:Plan)=>keyOperation(plan).conversionId==='literal_integer_identifier@1';
const sourceKeyField=(record:StreamingVectorRecord,path:string,integer:boolean,position:boolean):Field=>position
  ?{state:'known',value:`position:${sourceFeaturePosition(record)}`,sourcePath:path}
  :field(record.feature as Record<string,unknown>,path,integer);
export function candidateKeyHashes(records:StreamingVectorRecord[],plan:Plan|MappingPlanV2){
  const path=isMappingPlanV2(plan)?plan.fields.find(op=>op.target==='building.sourceKey')?.sourceField
    :keyOperation(plan).sourcePath;
  if(!path)return [];
  const integer=!isMappingPlanV2(plan)&&integerKey(plan);
  const position=!isMappingPlanV2(plan)&&keyOperation(plan).conversionId==='feature_position@1';
  return [...new Set(records.filter(record=>record.disposition==='accepted').map(record=>{
    const value=sourceKeyField(record,path,integer,position);
    return value.state==='known'?sha256(value.value!):null;
  }).filter((value):value is string=>value!==null))];
}

/** Compare each actual source record with the pinned inventory, including its permitted null and absent variants. */
function sourceShapeIssues(feature:Record<string,unknown>,profile:Profile,geometryMatches:(type:string)=>boolean){
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
    ||!geometryMatches(String((geometry as Record<string,unknown>).type)))
    issues.add('SCHEMA_DRIFT_GEOMETRY');
  return [...issues];
}

/** V2 is a pure candidate projection, not a new recipe authority or persistence route. */
export function normalizeMappedChunk(records:StreamingVectorRecord[],plan:MappingPlanV2,profile:Profile|MappingExecutionContext,
  rawJobId:string,chunkIndex:number,existing:KeyRow[]):MappingExecutionResult;
export function normalizeMappedChunk(records:StreamingVectorRecord[],plan:Plan,profile:Profile,
  rawJobId:string,chunkIndex:number,existing:KeyRow[]):ReturnType<typeof normalizeLegacyMappedChunk>;
export function normalizeMappedChunk(records:StreamingVectorRecord[],plan:Plan|MappingPlanV2,profile:Profile|MappingExecutionContext,
  rawJobId:string,chunkIndex:number,existing:KeyRow[]){
  if(!isMappingPlanV2(plan))return normalizeLegacyMappedChunk(records,plan,profile as Profile,rawJobId,chunkIndex,existing);
  const context:MappingExecutionContext='sourceKind' in profile?profile:{...mappingContextFromGisProfile(profile),
    sourceRef:profile.source.sourceId,sourceCrs:profile.version==='manual-geojson/1'?profile.crs.value:profile.reference.sourceCrs??undefined};
  const result=executeMappingPlanV2(plan,[],context);
  for(const record of records){
    const row:Record<string,unknown>=Object.create(null),feature=record.feature as Record<string,unknown>|null;
    if(record.disposition==='accepted'&&feature)for(const field of context.fields){
      const name=field.name,attributes=feature.properties as MappingRow|null;
      if(name==='/features/*/id'||name==='/features/*/geometry'){
        const key=name.endsWith('/id')?'id':'geometry';if(Object.hasOwn(feature,key))row[name]=feature[key];
      }else{
        const key=name.startsWith('/features/*/properties/')?name.slice('/features/*/properties/'.length).replaceAll('~1','/').replaceAll('~0','~'):name;
        if(attributes&&Object.hasOwn(attributes,key))row[name]=attributes[key];
      }
    }
    if(record.disposition==='accepted'&&feature?.properties&&typeof feature.properties==='object')
      for(const [key,value] of Object.entries(feature.properties)){
        const path=context.fields.some(field=>field.name.startsWith('/features/*/'))?pathForProperty(key):key;
        if(!Object.hasOwn(row,path))row[path]=value;
      }
    const mapped=executeMappingPlanV2(plan,[row],{...context,rowOffset:record.featureIndex}).rows[0];
    if(record.disposition!=='accepted')for(const field of mapped.fields){field.state='needs_input';field.issueCode=record.issueCode??'RAW_FEATURE_QUARANTINED';}
    result.rows.push(mapped);
  }
  result.counts=mappedCellCounts(result.rows);
  return result;
}

/** A pin or line an outline kind keeps aside, counted with the small layout's GEOMETRY_KIND before any key or name
 * check. Its key is reported when it is one, and never required or reserved. */
function setAsideObservation(record:StreamingVectorRecord,key:Field,namePath:string|undefined,
  geometryRef:ChunkMappingObservation['geometryRef'],issues:string[]):ChunkMappingObservation{
  return {featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,rawSha256:record.rawSha256,
    disposition:'unresolved',sourceKey:key.state==='known'&&!keyValueValid(key.value)?unknown(key.sourcePath):key,
    name:namePath?unknown(namePath):unknown(),geometryRef,issueCodes:['GEOMETRY_KIND',...issues].slice(0,8)};
}

/** A source-linked draft projection. Geometry stays in the immutable raw chunk; no frame or role is inferred. */
function normalizeLegacyMappedChunk(records:StreamingVectorRecord[],plan:Plan,profile:Profile,
  rawJobId:string,chunkIndex:number,existing:KeyRow[]){
  if(plan.version==='manual-geojson/1')compileMapping(plan,profile as SourceProfile);
  else compileStreamedMapping(plan,profile as StreamedProfileGeneration);
  // A chunk can observe a permitted subset; the slot names the pinned allowed inventory.
  const schemaFingerprint=profile.source.schemaFingerprint;
  const keyPath=keyOperation(plan).sourcePath,integer=integerKey(plan),kind=plan.kind??'building';
  const position=keyOperation(plan).conversionId==='feature_position@1';
  const namePath=plan.operations.find(op=>op.target.endsWith('.name'))?.sourcePath;
  const byHash=new Map(existing.map(row=>[row.source_key_sha256,{value:row.source_key,firstIndex:row.first_feature_index}]));
  const keys:KeyDecision[]=[],observations:ChunkMappingObservation[]=[];
  const geometryTypes=new Map<string,boolean>();
  const geometryMatches=(type:string)=>{
    if(!geometryTypes.has(type))geometryTypes.set(type,plan.version==='streamed-prefix-mapping/1'
      ?prefixGeometryCompatible(plan,profile as StreamedProfileGeneration,type):profile.geometryTypes.includes(type));
    return geometryTypes.get(type)!;
  };
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
    const geometryRef={rawJobId,chunkIndex,featureIndex:record.featureIndex,rawSha256:record.rawSha256,
      sourcePath:'/features/*/geometry' as const};
    issues.push(...sourceShapeIssues(feature,profile,geometryMatches));
    if(setAsideGeometryTypes(kind,[String((feature.geometry as {type?:unknown}|null|undefined)?.type)]).length){
      observations.push(setAsideObservation(record,sourceKeyField(record,keyPath,integer,position),
        namePath,geometryRef,issues));
      continue;
    }
    let sourceKey=sourceKeyField(record,keyPath,integer,position),name=namePath?field(feature,namePath):unknown();
    if(name.state==='known'&&!literalTextValueValid(name.value!)){
      name=unknown(namePath);issues.push('MAPPING_TEXT_INVALID');
    }
    if(sourceKey.state==='known'){
      if(!keyValueValid(sourceKey.value)){
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
      geometryRef,issueCodes:[...new Set(issues)].slice(0,8)});
  }
  const schemaDrift=observations.some(item=>item.issueCodes.some(code=>code.startsWith('SCHEMA_DRIFT')));
  return {records:observations,keys,schemaFingerprint,schemaDrift};
}
