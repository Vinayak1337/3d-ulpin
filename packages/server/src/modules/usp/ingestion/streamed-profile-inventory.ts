import {STREAMED_PROFILE_LIMITS as limits,type StreamedProfileGeneration,
  type StreamedProfilePath,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {setAsideGeometryTypes} from './registry';

const escaped=(key:string)=>key.replaceAll('~','~0').replaceAll('/','~1');
const valueType=(value:unknown):StreamedProfilePath['types'][number]=>
  Array.isArray(value)?'array':typeof value as StreamedProfilePath['types'][number];
type Aggregate=Pick<StreamedProfileGeneration,'recordsSeen'|'accepted'|'quarantined'|'paths'|'geometryTypes'>;
type Counts=NonNullable<StreamedProfilePath['outline']>;
type Tally=StreamedProfilePath&{outline:Counts};
export const emptyInventory=():Aggregate=>({recordsSeen:0,accepted:0,quarantined:0,paths:[],geometryTypes:[]});

/** A pin or line an outline kind keeps aside; every other feature is an outline it draws (registry.ts outlineRows). */
const setAside=(type:unknown)=>setAsideGeometryTypes('building',[String(type)]).length>0;
const noCounts=():Counts=>({types:[],values:0,explicitNull:0,absent:0,integers:0});
const copied=({types,values,explicitNull,absent,integers}:Counts):Counts=>
  ({types:[...types],values,explicitNull,absent,...(integers===undefined?{}:{integers})});

/** The outline counts a previous generation implies. One without its own held only outlines (its whole counts)
 * or only pins and lines (none). */
function previousOutlines(previous:Aggregate):{drawn:number;outline:(path:StreamedProfilePath)=>Counts}{
  const mixed=previous.paths.find(path=>path.outline)?.outline;
  if(mixed)return {drawn:mixed.values+mixed.explicitNull+mixed.absent,outline:path=>copied(path.outline!)};
  if(previous.geometryTypes.some(setAside))return {drawn:0,outline:noCounts};
  return {drawn:previous.accepted,outline:copied};
}

/** One accepted feature's value at one path: absent, an explicit null, or a value of its type. */
function count(item:Counts,observed:Map<string,unknown>,path:string){
  if(!observed.has(path)){item.absent++;return;}
  const value=observed.get(path);
  if(value===null){item.explicitNull++;return;}
  const kind=valueType(value);
  if(!item.types.includes(kind))item.types.push(kind);
  item.values++;
  if(item.integers!==undefined&&Number.isSafeInteger(value))item.integers++;
}

/** Only accepted features contribute field absence. Quarantined features leave every field unknown. Outline counts
 * are published only for a file that holds both outlines and pins or lines. */
export function advanceStreamedInventory(previous:Aggregate,records:StreamingVectorRecord[]){
  const prior=previousOutlines(previous);
  const paths=new Map<string,Tally>(previous.paths.map(path=>[path.path,
    {...path,types:[...path.types],outline:prior.outline(path)}]));
  const geometryTypes=new Set(previous.geometryTypes),locators:StreamedProfileGeneration['quarantineLocators']=[];
  let accepted=previous.accepted,quarantined=previous.quarantined,drawn=prior.drawn;
  for(const record of records){
    if(record.disposition==='quarantined'){
      quarantined++;
      locators.push({featureIndex:record.featureIndex,byteStart:record.byteStart,byteEnd:record.byteEnd,
        rawSha256:record.rawSha256,issueCode:record.issueCode??'RAW_FEATURE_QUARANTINED',
        ...(record.sequencePosition?{sequencePosition:record.sequencePosition}:{})});
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
        paths.set(path,{path,types:[],values:0,explicitNull:0,absent:accepted,unknown:quarantined,integers:0,
          outline:{...noCounts(),absent:drawn}});
      }
    }
    const geometry=feature.geometry;
    const outline=!setAside((geometry as {type?:unknown}|null|undefined)?.type);
    for(const [path,item] of paths){
      count(item,observed,path);
      if(outline)count(item.outline,observed,path);
    }
    if(geometry&&typeof geometry==='object'&&!Array.isArray(geometry))
      geometryTypes.add(String((geometry as Record<string,unknown>).type));
    if(geometryTypes.size>8)throw new AppError(413,'STREAMED_PROFILE_GEOMETRY_BUDGET','Too many geometry kinds were observed.');
    if(outline)drawn++;
    accepted++;
  }
  if(locators.length>limits.quarantineLocators)
    throw new AppError(413,'STREAMED_PROFILE_QUARANTINE_BUDGET','A raw chunk exceeds the locator budget.');
  const mixed=drawn>0&&drawn<accepted;
  const next={recordsSeen:accepted+quarantined,accepted,quarantined,
    paths:[...paths.values()].map(({outline,...path})=>({...path,types:path.types.sort(),unknown:quarantined,
      ...(mixed?{outline:{...outline,types:outline.types.sort()}}:{})}))
      .sort((a,b)=>a.path.localeCompare(b.path)),geometryTypes:[...geometryTypes].sort()};
  for(const path of next.paths)
    if(path.values+path.explicitNull+path.absent!==accepted||(path.outline
      &&path.outline.values+path.outline.explicitNull+path.outline.absent!==drawn))
      throw new AppError(422,'STREAMED_PROFILE_COUNTS','Accepted-source field coverage is inconsistent.');
  return {inventory:next,quarantineLocators:locators};
}
