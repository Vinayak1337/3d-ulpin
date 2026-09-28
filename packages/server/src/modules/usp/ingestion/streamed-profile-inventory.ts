import {STREAMED_PROFILE_LIMITS as limits,type StreamedProfileGeneration,
  type StreamedProfilePath,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';

const escaped=(key:string)=>key.replaceAll('~','~0').replaceAll('/','~1');
const valueType=(value:unknown):StreamedProfilePath['types'][number]=>
  Array.isArray(value)?'array':typeof value as StreamedProfilePath['types'][number];
type Aggregate=Pick<StreamedProfileGeneration,'recordsSeen'|'accepted'|'quarantined'|'paths'|'geometryTypes'>;
export const emptyInventory=():Aggregate=>({recordsSeen:0,accepted:0,quarantined:0,paths:[],geometryTypes:[]});

/** Only accepted features contribute field absence. Quarantined features leave every field unknown. */
export function advanceStreamedInventory(previous:Aggregate,records:StreamingVectorRecord[]){
  const paths=new Map(previous.paths.map(path=>[path.path,{...path,types:[...path.types]}]));
  const geometryTypes=new Set(previous.geometryTypes),locators:StreamedProfileGeneration['quarantineLocators']=[];
  let accepted=previous.accepted,quarantined=previous.quarantined;
  for(const record of records){
    if(record.disposition==='quarantined'){
      quarantined++;
      locators.push({featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,
        rawSha256:record.rawSha256,issueCode:record.issueCode??'RAW_FEATURE_QUARANTINED'});
      continue;
    }
    const feature=record.feature as Record<string,unknown>,observed=new Map<string,unknown>();
    if(Object.hasOwn(feature,'geometry'))observed.set('/features/*/geometry',feature.geometry);
    if(Object.hasOwn(feature,'id'))observed.set('/features/*/id',feature.id);
    const properties=feature.properties;
    if(properties&&typeof properties==='object'&&!Array.isArray(properties))
      for(const [name,value] of Object.entries(properties))observed.set(`/features/*/properties/${escaped(name)}`,value);
    for(const path of observed.keys()){
      if(!paths.has(path)){
        if(paths.size>=limits.paths||path.length>512)
          throw new AppError(413,'STREAMED_PROFILE_PATH_BUDGET','The source has more field paths than this bounded profile permits.');
        paths.set(path,{path,types:[],values:0,explicitNull:0,absent:accepted,unknown:quarantined});
      }
    }
    for(const [path,item] of paths){
      if(!observed.has(path)){item.absent++;continue;}
      const value=observed.get(path);
      if(value===null){item.explicitNull++;continue;}
      const kind=valueType(value);
      if(!item.types.includes(kind))item.types.push(kind);
      item.values++;
    }
    const geometry=feature.geometry;
    if(geometry&&typeof geometry==='object'&&!Array.isArray(geometry))
      geometryTypes.add(String((geometry as Record<string,unknown>).type));
    if(geometryTypes.size>8)throw new AppError(413,'STREAMED_PROFILE_GEOMETRY_BUDGET','Too many geometry kinds were observed.');
    accepted++;
  }
  if(locators.length>limits.quarantineLocators)
    throw new AppError(413,'STREAMED_PROFILE_QUARANTINE_BUDGET','A raw chunk exceeds the locator budget.');
  const next={recordsSeen:accepted+quarantined,accepted,quarantined,
    paths:[...paths.values()].map(path=>({...path,types:path.types.sort(),unknown:quarantined}))
      .sort((a,b)=>a.path.localeCompare(b.path)),geometryTypes:[...geometryTypes].sort()};
  for(const path of next.paths)
    if(path.values+path.explicitNull+path.absent!==accepted)
      throw new AppError(422,'STREAMED_PROFILE_COUNTS','Accepted-source field coverage is inconsistent.');
  return {inventory:next,quarantineLocators:locators};
}
