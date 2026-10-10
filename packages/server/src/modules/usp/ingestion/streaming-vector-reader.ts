import {createHash} from 'node:crypto';
import type {Readable} from 'node:stream';
import {STREAMING_VECTOR_LIMITS as limits,TABULAR_LIMITS,type TabularPin,
  type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {readTabularSource,tabularDevelopmentAsset} from './tabular-source';
import {AppError} from '../../../infrastructure/errors';

const whitespace=(byte:number)=>byte===32||byte===9||byte===10||byte===13;
const decode=(bytes:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
type Framing='feature-collection'|'geojson-seq-rs';

/** Inspect the original JSON tokens before JS can round numbers or replace duplicate keys. */
function parseSourceValue(raw:Buffer):{value:unknown;issueCode:string|null}{
  let source:string;
  try{source=decode(raw);}catch{throw new AppError(422,'GEOJSON_JSON','A complete source value is not valid UTF-8 JSON.');}
  let at=0,issueCode:string|null=null;
  const bad=():never=>{throw new AppError(422,'GEOJSON_JSON','A complete source value is not valid UTF-8 JSON.');};
  const space=()=>{while(at<source.length&&/[ \t\r\n]/.test(source[at]!))at++;};
  const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const decimal=(token:string):string|null=>{
    const match=/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
    if(!match)return null;
    const exponent=match[4]??'0';
    if(exponent.replace(/^[+-]?0*/, '').length>6)return null;
    const digits=(match[2]!+(match[3]??'')).replace(/^0+/, '');
    if(!digits)return '0';
    const trimmed=digits.replace(/0+$/, '');
    const scale=Number(exponent)-(match[3]?.length??0)+(digits.length-trimmed.length);
    return `${match[1]}${trimmed}e${scale}`;
  };
  const string=():string=>{
    const start=at;
    if(source[at++]!=='"')bad();
    while(at<source.length){
      const char=source.charCodeAt(at++);
      if(char===34){try{return JSON.parse(source.slice(start,at)) as string;}catch{bad();}}
      if(char===92){if(at>=source.length)bad();at++;}
      else if(char<32)bad();
    }
    return bad();
  };
  const node=(depth:number):void=>{
    if(depth>limits.jsonNesting)throw new AppError(413,'GEOJSON_NESTING_BUDGET','A source value exceeds the JSON nesting limit.');
    space();const char=source[at];
    if(char==='"'){string();return;}
    if(char==='{'||char==='['){
      at++;space();const object=char==='{',end=object?'}':']',seen=object?new Set<string>():null;
      if(source[at]===end){at++;return;}
      while(true){
        if(object){
          if(source[at]!=='"')bad();
          const key=string();if(seen!.has(key))issueCode??='DUPLICATE_JSON_KEY';seen!.add(key);
          space();if(source[at++]!==':')bad();
        }
        node(depth+1);space();
        if(source[at]===end){at++;return;}
        if(source[at++]!==',')bad();space();
      }
    }
    if(char==='t'||char==='f'||char==='n'){
      const literal=char==='t'?'true':char==='f'?'false':'null';
      if(source.slice(at,at+literal.length)!==literal)bad();at+=literal.length;return;
    }
    number.lastIndex=at;const match=number.exec(source);
    if(!match)return bad();
    const token=match[0],value=Number(token);
    if(!Number.isFinite(value)||Object.is(value,-0)||Number.isInteger(value)&&!Number.isSafeInteger(value)
      ||decimal(token)!==decimal(value.toString()))issueCode??='UNREPRESENTABLE_NUMBER';
    at=number.lastIndex;
  };
  node(0);space();if(at!==source.length)bad();
  try{return {value:JSON.parse(source),issueCode};}catch{return bad();}
};

/** One S3 stream, bounded to one complete JSON value. Offsets are byte offsets in the unchanged original. */
class Cursor {
  private readonly chunks:AsyncIterator<Buffer>;
  private chunk=Buffer.alloc(0);
  private position=0;
  private ended=false;
  private readonly hash=createHash('sha256');
  offset=0;
  constructor(body:Readable){this.chunks=body[Symbol.asyncIterator]() as AsyncIterator<Buffer>;}
  async peek():Promise<number|null>{
    while(this.position>=this.chunk.length){
      if(this.ended)return null;
      const next=await this.chunks.next();
      if(next.done){this.ended=true;return null;}
      this.chunk=Buffer.from(next.value);this.position=0;this.hash.update(this.chunk);
    }
    return this.chunk[this.position]!;
  }
  async take():Promise<number|null>{const value=await this.peek();if(value!==null){this.position++;this.offset++;}return value;}
  async nonspace():Promise<number|null>{let byte=await this.peek();while(byte!==null&&whitespace(byte)){await this.take();byte=await this.peek();}return byte;}
  async expect(expected:number){const value=await this.nonspace();if(value!==expected)throw new AppError(422,'GEOJSON_CONTAINER','The GeoJSON framing is incomplete or malformed.');await this.take();}
  async value(maxBytes:number):Promise<{bytes:Buffer;start:number;end:number}>{
    await this.nonspace();const start=this.offset,first=await this.take();
    if(first===null)throw new AppError(422,'GEOJSON_CONTAINER','A complete JSON value is required.');
    const bytes:number[]=[first];let inString=first===34,escaped=false;
    const brackets:number[]=[];
    if(first===123)brackets.push(125);else if(first===91)brackets.push(93);
    const compound=brackets.length>0;
    if(!compound&&first!==34&&!/[-0-9tfn]/.test(String.fromCharCode(first)))throw new AppError(422,'GEOJSON_JSON','The source contains an invalid JSON value.');
    while(true){
      if(bytes.length>maxBytes)throw new AppError(413,'GEOJSON_UNIT_BUDGET','A complete source value exceeds this reader profile.');
      if(!compound&&!inString){const next=await this.peek();if(next===null||whitespace(next)||next===44||next===93||next===125||next===30)break;}
      if(compound&&brackets.length===0||first===34&&!inString)break;
      const byte=await this.take();if(byte===null)throw new AppError(422,'GEOJSON_CONTAINER','The original ends inside a JSON value.');
      bytes.push(byte);
      if(inString){if(escaped)escaped=false;else if(byte===92)escaped=true;else if(byte===34)inString=false;continue;}
      if(byte===34){inString=true;continue;}
      if(byte===123)brackets.push(125);else if(byte===91)brackets.push(93);
      else if(byte===125||byte===93){if(brackets.pop()!==byte)throw new AppError(422,'GEOJSON_CONTAINER','JSON brackets are malformed.');}
      if(brackets.length>limits.jsonNesting)throw new AppError(413,'GEOJSON_NESTING_BUDGET','A source value exceeds the JSON nesting limit.');
    }
    const raw=Buffer.from(bytes);
    return {bytes:raw,start,end:this.offset};
  }
  digest(){return this.hash.digest('hex');}
}

export type SourceFeature={index:number;start:number;end:number;raw:Buffer;feature:unknown;
  valueIssueCode:string|null;rawSha256?:string};
export async function readStreamingFeatures(body:Readable,framing:Framing,onFeature:(item:SourceFeature)=>Promise<void>){
  const cursor=new Cursor(body);let index=0,metadataBytes=0;const metadata:Record<string,unknown>=Object.create(null);
  const feature=async()=>{
    const value=await cursor.value(limits.featureBytes);
    const parsed=parseSourceValue(value.bytes);
    await onFeature({index:index++,start:value.start,end:value.end,raw:value.bytes,
      feature:parsed.value,valueIssueCode:parsed.issueCode});
  };
  if(framing==='feature-collection'){
    await cursor.expect(123);const keys=new Set<string>();let foundFeatures=false;
    while(true){
      const next=await cursor.nonspace();if(next===125){await cursor.take();break;}
      if(keys.size){await cursor.expect(44);}
      const keyValue=await cursor.value(256),key=parseSourceValue(keyValue.bytes).value;
      if(typeof key!=='string'||keys.has(key))throw new AppError(422,'GEOJSON_CONTAINER','Collection keys must be unique strings.');
      keys.add(key);
      if(keys.size>limits.metadataFields)throw new AppError(413,'GEOJSON_METADATA_BUDGET','Collection metadata has too many fields.');
      metadataBytes+=keyValue.bytes.length;
      if(metadataBytes>limits.metadataBytes)throw new AppError(413,'GEOJSON_METADATA_BUDGET','Collection metadata exceeds this reader profile.');
      await cursor.expect(58);
      if(key==='features'){
        if(!Object.hasOwn(metadata,'type')||metadata.type!=='FeatureCollection')throw new AppError(422,'GEOJSON_CONTAINER','Collection type must precede the features array.');
        foundFeatures=true;await cursor.expect(91);
        if(await cursor.nonspace()!==93){while(true){await feature();const delim=await cursor.nonspace();if(delim===93)break;await cursor.expect(44);}}
        await cursor.expect(93);
      }else{
        const value=await cursor.value(limits.metadataBytes-metadataBytes);
        metadataBytes+=value.bytes.length;
        const parsed=parseSourceValue(value.bytes);
        if(parsed.issueCode)throw new AppError(422,'GEOJSON_METADATA','Collection metadata has duplicate keys or unrepresentable numbers.');
        metadata[key]=parsed.value;
      }
    }
    if(!foundFeatures||!Object.hasOwn(metadata,'type')||metadata.type!=='FeatureCollection')throw new AppError(422,'GEOJSON_CONTAINER','A FeatureCollection with complete features is required.');
  }else{
    while(await cursor.nonspace()!==null){await cursor.expect(30);await feature();
      // RFC 7464 JSON text sequences require LF after each JSON text.
      if(await cursor.take()!==10)throw new AppError(422,'GEOJSON_SEQUENCE','Every RS framed feature must end with LF.');
    }
  }
  if(await cursor.nonspace()!==null)throw new AppError(422,'GEOJSON_CONTAINER','Trailing source content is not part of the declared framing.');
  return {features:index,metadata,bytes:cursor.offset,sha256:cursor.digest()};
}

/** Tabular records retain whole-original byte/hash coverage plus physical sheet/row locators, not fake GIS. */
export async function readStreamingTabular(body:Readable,pin:TabularPin,onFeature:(item:SourceFeature)=>Promise<void>){
  const chunks:Buffer[]=[];let length=0;
  for await(const value of body){
    const chunk=Buffer.from(value);length+=chunk.length;
    if(length>TABULAR_LIMITS.bytes){
      throw new AppError(413,'TABULAR_SOURCE_BUDGET','Tabular bytes exceed the receipt bound.');
    }
    chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks),hash=createHash('sha256').update(raw).digest('hex');
  const asset=tabularDevelopmentAsset(hash,raw.length);
  if(asset.id!==pin.developmentAssetId||asset.family!==pin.developmentFamily||raw.length!==pin.sourceBytes)
    throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The original differs from its tabular pin.');
  const table=readTabularSource(raw,pin.selection);
  for(const [index,row] of table.rows.entries()){
    const cells=table.headers.map((_,column)=>{
      const state=table.cellStates?.[index][column]??(row[column]===undefined?'absent':'literal');
      return state==='literal'?{state,value:row[column]}:{state};
    });
    await onFeature({index,start:0,end:raw.length,raw,rawSha256:hash,feature:{cells,headers:table.headers,
      sheet:pin.selection.sheet,sourceRow:table.sourceRows[index]},valueIssueCode:null});
  }
  return {features:table.rows.length,metadata:{},bytes:raw.length,sha256:hash};
}
export function tabularSourceRecord(item: SourceFeature): StreamingVectorRecord {
  return { featureIndex: item.index, byteStart: item.start, byteEnd: item.end,
    rawSha256: item.rawSha256 ?? createHash('sha256').update(item.raw).digest('hex'),
    disposition: 'accepted', issueCode: null, feature: item.feature };
}

function ringIssue(value:unknown):string|null{
  if(!Array.isArray(value)||value.length<4||value.length>2048)return 'RING_BUDGET_OR_SHAPE';
  for(const item of value)if(!Array.isArray(item)||item.length<2||item.length>4||item.some(v=>typeof v!=='number'||!Number.isFinite(v)))return 'INVALID_COORDINATE';
  const first=value[0] as number[],last=value.at(-1) as number[];
  if(first[0]!==last[0]||first[1]!==last[1])return 'OPEN_RING';
  return null;
}
export function validateStreamingFeature(value:unknown):string|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return 'INVALID_FEATURE';
  const feature=value as Record<string,unknown>;
  if(feature.type!=='Feature')return 'INVALID_FEATURE';
  if(Object.hasOwn(feature,'crs'))return 'FEATURE_CRS_OVERRIDE';
  if(feature.properties!==undefined&&feature.properties!==null&&
    (typeof feature.properties!=='object'||Array.isArray(feature.properties)))return 'INVALID_PROPERTIES';
  const geometry=feature.geometry;
  if(!geometry||typeof geometry!=='object'||Array.isArray(geometry))return 'MISSING_GEOMETRY';
  const g=geometry as Record<string,unknown>;
  const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:null;
  if(!Array.isArray(polygons))return 'UNSUPPORTED_GEOMETRY';
  if(!polygons.length)return 'POLYGON_BUDGET_OR_SHAPE';
  let positions=0;
  for(const polygon of polygons){
    if(!Array.isArray(polygon)||polygon.length<1||polygon.length>128)return 'POLYGON_BUDGET_OR_SHAPE';
    for(const ring of polygon){positions+=Array.isArray(ring)?ring.length:0;if(positions>limits.featurePositions)return 'GEOMETRY_BUDGET';
      const issue=ringIssue(ring);if(issue)return issue;
    }
  }
  return null;
}
export function sourceRecord(item:SourceFeature):StreamingVectorRecord{
  const issueCode=item.valueIssueCode??validateStreamingFeature(item.feature);
  return {featureIndex:item.index,byteStart:item.start,byteEnd:item.end,
    rawSha256:createHash('sha256').update(item.raw).digest('hex'),
    disposition:issueCode?'quarantined':'accepted',issueCode,feature:issueCode?null:item.feature};
}
