import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {setTimeout as pause} from 'node:timers/promises';
import {STREAMING_VECTOR_LIMITS as limits,streamingRawReadMs,TABULAR_LIMITS,type TabularPin,
  type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {readTabularSource,admitTabularSource} from './tabular-source';
import {readTabularWindows} from './tabular-stream';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';
import {openObjectStream} from '../../../infrastructure/storage';

const whitespace=(byte:number)=>byte===32||byte===9||byte===10||byte===13;
const decode=(bytes:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
type Framing='feature-collection'|'geojson-seq-rs'|'geojson-lines';

/** Retry opens before the first byte; later cuts resume at a sealed boundary, keeping the live parser and hash. */
async function* continueObject(open:(start:number,etag?:string)=>ReturnType<typeof openObjectStream>,
  etag:string|undefined,progress:()=>void,sealed:()=>number,signal:AbortSignal){
  let object:Awaited<ReturnType<typeof openObjectStream>>|undefined,delivered=0,start=0,reopens=0,connectRetries=0;
  try{
    while(true){
      try{
        signal.throwIfAborted();
        object??=await open(start,etag);
        etag??=object.etag;
        let position=start;
        for await(const value of object.body){
          const chunk=Buffer.from(value),end=position+chunk.length;
          if(chunk.length)progress();
          if(end>delivered){
            const fresh=chunk.subarray(Math.max(0,delivered-position));delivered=end;yield fresh;
          }
          position=end;
        }
        return;
      }catch(error){
        const code=(error as {code?:string}).code;
        if(signal.aborted)throw error;
        if(!delivered&&connectRetries<3
          &&['ECONNRESET','EPIPE','ETIMEDOUT','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH',
            'ERR_STREAM_PREMATURE_CLOSE'].includes(code??'')){
          object?.body.destroy();object=undefined;
          // These opens share the raw idle/outer bounds and do not spend another job attempt.
          await pause(1000*2**connectRetries++,undefined,{signal});
          continue;
        }
        if(!sealed()||reopens>=3
          ||!['ECONNRESET','EPIPE','ETIMEDOUT','ERR_STREAM_PREMATURE_CLOSE'].includes(code??''))throw error;
        object?.body.destroy();object=undefined;start=sealed();reopens++;
      }
    }
  }finally{object?.body.destroy();}
}

/** Raw-only progress bounds include consumer backpressure and the last part's publication, even after EOF. */
export async function readStreamingRaw<T>(key:string,bytes:number,etag:string|undefined,
  consume:(body:Readable,published:()=>void,sealed:(end:number)=>void)=>Promise<T>,
  bounds={idleMs:limits.rawIdleMs,outerMs:streamingRawReadMs(bytes)}):Promise<T>{
  const controller=new AbortController();
  const stopped=()=>new AppError(503,'STORAGE_TIMEOUT','The bounded object read timed out.');
  const expire=()=>controller.abort();
  const outer=setTimeout(expire,bounds.outerMs);outer.unref();
  let idle=setTimeout(expire,bounds.idleMs);idle.unref();
  const progress=()=>{
    if(controller.signal.aborted)throw stopped();
    clearTimeout(idle);idle=setTimeout(expire,bounds.idleMs);idle.unref();
  };
  let body:Readable|undefined;
  let stopWait=()=>{},sealedEnd=0;
  const sealed=(end:number)=>{if(Number.isSafeInteger(end)&&end>sealedEnd&&end<bytes)sealedEnd=end;};
  try{
    // An iterator preserves backpressure; a data listener would flow before the parser attaches.
    body=Readable.from(continueObject(
      (start,pin)=>openObjectStream(key,bytes,bounds.outerMs,pin,controller.signal,start),
      etag,progress,()=>sealedEnd,controller.signal),
    {objectMode:false});
    const interrupted=new Promise<never>((_,reject)=>{
      stopWait=()=>reject(stopped());controller.signal.addEventListener('abort',stopWait,{once:true});
    });
    const result=await Promise.race([consume(body,progress,sealed),interrupted]);
    if(controller.signal.aborted)throw stopped();
    return result;
  }catch(error){if(controller.signal.aborted)throw stopped();throw error;}
  finally{
    clearTimeout(idle);clearTimeout(outer);controller.signal.removeEventListener('abort',stopWait);
    body?.destroy();controller.abort();
  }
}

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
  private takeBuffered(){this.offset++;return this.chunk[this.position++]!;}
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
      // A byte already buffered is taken without a wait; only an exhausted chunk awaits the next one.
      const byte=this.position<this.chunk.length?this.takeBuffered():await this.take();
      if(byte===null)throw new AppError(422,'GEOJSON_CONTAINER','The original ends inside a JSON value.');
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
  /** Physical delimiters recover a bad JSON record without trying to balance its broken tokens. */
  async framedValue(lines:boolean){
    const start=this.offset,bytes:number[]=[];
    while(true){
      const next=await this.peek();
      if(next===null||!lines&&next===30)break;
      const byte=this.position<this.chunk.length?this.takeBuffered():(await this.take())!;
      bytes.push(byte);
      if(bytes.length>limits.featureBytes+2)
        throw new AppError(413,'GEOJSON_UNIT_BUDGET','A complete source value exceeds this reader profile.');
      if(lines&&byte===10)break;
    }
    if(!lines)while([32,9,13].includes(bytes.at(-1)??-1))bytes.pop();
    if(bytes.pop()!==10)
      throw new AppError(422,'GEOJSON_SEQUENCE','Every sequence line or record must end with LF.');
    if(bytes.at(-1)===13)bytes.pop();
    if(bytes.length>limits.featureBytes)
      throw new AppError(413,'GEOJSON_UNIT_BUDGET','A complete source value exceeds this reader profile.');
    return {bytes:Buffer.from(bytes),start,end:start+bytes.length};
  }
  /** Past the line ceiling, count bytes in bounded scans; progress may renew or refuse the live fence. */
  async remainingLines(onProgress?:()=>Promise<void>){
    let nonblank=0,blank=0,hasContent=false,hasBytes=false;
    while(await this.peek()!==null){
      const end=Math.min(this.position+64*1024,this.chunk.length);
      while(this.position<end){
        const byte=this.takeBuffered();
        if(byte===10){
          if(hasContent)nonblank++;else blank++;
          hasContent=false;hasBytes=false;
        }else{
          hasBytes=true;
          if(!whitespace(byte))hasContent=true;
        }
      }
      if(onProgress)await onProgress();
    }
    // The unread tail is counted, not parsed: it need not have a valid final delimiter.
    if(hasBytes){if(hasContent)nonblank++;else blank++;}
    return {nonblank,blank};
  }
  digest(){return this.hash.digest('hex');}
}

export type SourceFeature={index:number;start:number;end:number;raw:Buffer;feature:unknown;
  valueIssueCode:string|null;rawSha256?:string;collectionTypeBeforeFeatures?:boolean;
  sequencePosition?:StreamingVectorRecord['sequencePosition']};
/** Late-type collections stage privately until closure; type-first collections can publish while reading. */
export async function readStreamingFeatures(body:Readable,framing:Framing,
  onFeature:(item:SourceFeature)=>Promise<void>,featureLimit=limits.features,onProgress?:()=>Promise<void>){
  const cursor=new Cursor(body);let index=0,metadataBytes=0,blankLines=0,linesBeyondLimit=0;
  let collectionTypeBeforeFeatures=false;
  const metadata:Record<string,unknown>=Object.create(null);
  const feature=async()=>{
    if(index>=featureLimit)
      throw new AppError(413,'STREAMING_FEATURE_BUDGET','The collection exceeds the feature limit.');
    const value=await cursor.value(limits.featureBytes);
    const parsed=parseSourceValue(value.bytes);
    await onFeature({index:index++,start:value.start,end:value.end,raw:value.bytes,
      feature:parsed.value,valueIssueCode:parsed.issueCode,collectionTypeBeforeFeatures});
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
        collectionTypeBeforeFeatures=metadata.type==='FeatureCollection';
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
    if(!Object.hasOwn(metadata,'type')||metadata.type!=='FeatureCollection')
      throw new AppError(422,'GEOJSON_COLLECTION_TYPE',
        'The root type must be FeatureCollection; nothing from this collection was published.');
    if(!foundFeatures)throw new AppError(422,'GEOJSON_CONTAINER','A FeatureCollection with complete features is required.');
  }else{
    const lines=framing==='geojson-lines';let position=0;
    while((lines?await cursor.peek():await cursor.nonspace())!==null){
      if(lines&&index>=featureLimit){
        const tail=await cursor.remainingLines(onProgress);
        linesBeyondLimit=tail.nonblank;blankLines+=tail.blank;
        break;
      }
      if(!lines)await cursor.expect(30);
      const value=await cursor.framedValue(lines);position++;
      if(lines&&value.bytes.every(whitespace)){blankLines++;continue;}
      if(index>=featureLimit)
        throw new AppError(413,'STREAMING_FEATURE_BUDGET','The sequence exceeds the feature limit.');
      let parsed:{value:unknown;issueCode:string|null};
      try{parsed=parseSourceValue(value.bytes);}
      catch(error){
        if(!(error instanceof AppError)||error.code!=='GEOJSON_JSON')throw error;
        parsed={value:null,issueCode:'GEOJSON_JSON'};
      }
      await onFeature({index:index++,start:value.start,end:value.end,raw:value.bytes,
        feature:parsed.value,valueIssueCode:parsed.issueCode,
        sequencePosition:{kind:lines?'line':'record',number:position}});
    }
  }
  if(await cursor.nonspace()!==null)throw new AppError(422,'GEOJSON_CONTAINER','Trailing source content is not part of the declared framing.');
  return {features:index,metadata,blankLines,linesBeyondLimit,bytes:cursor.offset,sha256:cursor.digest()};
}

/** A CSV pinned above 16 MiB is read in row windows, never whole; each row cites its own byte range. */
async function readStreamedTabular(body:Readable,pin:TabularPin,onFeature:(item:SourceFeature)=>Promise<void>){
  const read=await readTabularWindows(body,async(window,headers)=>{
    for(const row of window.rows){
      const cells=headers.map((_,column)=>row.cells[column]===undefined?{state:'absent'}
        :{state:'literal',value:row.cells[column]});
      await onFeature({index:row.index,start:row.byteStart,end:row.byteEnd,raw:Buffer.alloc(0),
        rawSha256:row.rawSha256,feature:{cells,headers,sheet:pin.selection.sheet,sourceRow:row.sourceRow},
        valueIssueCode:null});
    }
  });
  if(read.bytes!==pin.sourceBytes)
    throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The original differs from its tabular pin.');
  return {features:read.records,metadata:{},bytes:read.bytes,sha256:read.sha256};
}

/** Tabular records retain whole-original byte/hash coverage plus physical sheet/row locators, not fake GIS. */
export async function readStreamingTabular(body:Readable,pin:TabularPin,onFeature:(item:SourceFeature)=>Promise<void>){
  if(pin.selection.format==='csv'&&pin.sourceBytes>TABULAR_LIMITS.bytes)return readStreamedTabular(body,pin,onFeature);
  const chunks:Buffer[]=[];let length=0;
  for await(const value of body){
    const chunk=Buffer.from(value);length+=chunk.length;
    if(length>TABULAR_LIMITS.bytes){
      throw new AppError(413,'TABULAR_SOURCE_BUDGET','Tabular bytes exceed the receipt bound.');
    }
    chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks),hash=createHash('sha256').update(raw).digest('hex');
  const admitted=admitTabularSource(hash,raw.length,'admission' in pin?pin.admission:{});
  const sameAdmission=admitted.kind==='case_original'
    ?'admission' in pin&&fingerprint(admitted.admission)===fingerprint(pin.admission)
    :'developmentAssetId' in pin&&admitted.asset.id===pin.developmentAssetId&&
      admitted.asset.family===pin.developmentFamily;
  if(!sameAdmission||raw.length!==pin.sourceBytes)
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

type Positions={count:number;dimensions:number|null};
function positionIssue(value:unknown,positions:Positions):string|null{
  if(!Array.isArray(value)||value.length<2||value.some(v=>typeof v!=='number'||!Number.isFinite(v)))
    return 'INVALID_COORDINATE';
  if(value.length>3)return 'UNSUPPORTED_COORDINATE_DIMENSION';
  if(positions.dimensions!==null&&positions.dimensions!==value.length)return 'MIXED_COORDINATE_DIMENSIONS';
  positions.dimensions=value.length;
  positions.count++;
  return positions.count>limits.featurePositions?'GEOMETRY_BUDGET':null;
}
function lineIssue(value:unknown,positions:Positions,ring=false):string|null{
  const shapeIssue=ring?'RING_BUDGET_OR_SHAPE':'LINE_BUDGET_OR_SHAPE';
  if(!Array.isArray(value)||value.length<(ring?4:2)||ring&&value.length>2048)return shapeIssue;
  for(const item of value){const issue=positionIssue(item,positions);if(issue)return issue;}
  if(ring){
    const first=value[0] as number[],last=value.at(-1) as number[];
    if(first[0]!==last[0]||first[1]!==last[1])return 'OPEN_RING';
  }
  return null;
}
function geometryIssue(g:Record<string,unknown>):string|null{
  if(Object.hasOwn(g,'crs'))return 'FEATURE_CRS_OVERRIDE';
  const positions:Positions={count:0,dimensions:null};
  if(g.type==='Point')return positionIssue(g.coordinates,positions);
  if(g.type==='LineString')return lineIssue(g.coordinates,positions);
  if(g.type==='MultiPoint'||g.type==='MultiLineString'){
    if(!Array.isArray(g.coordinates)||!g.coordinates.length)return 'GEOMETRY_BUDGET_OR_SHAPE';
    for(const part of g.coordinates){
      const issue=g.type==='MultiPoint'?positionIssue(part,positions):lineIssue(part,positions);
      if(issue)return issue;
    }
    return null;
  }
  const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:null;
  if(!Array.isArray(polygons))return 'UNSUPPORTED_GEOMETRY';
  if(!polygons.length)return 'POLYGON_BUDGET_OR_SHAPE';
  for(const polygon of polygons){
    if(!Array.isArray(polygon)||polygon.length<1||polygon.length>128)return 'POLYGON_BUDGET_OR_SHAPE';
    for(const ring of polygon){const issue=lineIssue(ring,positions,true);if(issue)return issue;}
  }
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
  return geometryIssue(geometry as Record<string,unknown>);
}
/**
 * TC1. The issue this reader records for one feature written as `raw` (null when it accepts it), so a writer can
 * leave out what would be quarantined; a feature over the byte limit would stop the whole read.
 */
export function streamedFeatureIssue(raw:Buffer):string|null{
  if(raw.length>limits.featureBytes)return 'GEOJSON_UNIT_BUDGET';
  const parsed=parseSourceValue(raw);
  return parsed.issueCode??validateStreamingFeature(parsed.value);
}
/** The immutable original's locator, never a chunk-local index or an attribute identifier. */
export function sourceFeaturePosition(
  record: Pick<StreamingVectorRecord, 'featureIndex' | 'sequencePosition'>,
): number {
  return record.sequencePosition?.number ?? record.featureIndex + 1;
}
export function sourceRecord(item:SourceFeature):StreamingVectorRecord{
  const featureIssue=validateStreamingFeature(item.feature);
  let issueCode=item.valueIssueCode??featureIssue;
  if(item.sequencePosition&&item.valueIssueCode!=='GEOJSON_JSON'&&featureIssue==='INVALID_FEATURE')
    issueCode=featureIssue;
  return {featureIndex:item.index,byteStart:item.start,byteEnd:item.end,
    rawSha256:createHash('sha256').update(item.raw).digest('hex'),
    ...(item.sequencePosition?{sequencePosition:item.sequencePosition}:{}),
    disposition:issueCode?'quarantined':'accepted',issueCode,feature:issueCode?null:item.feature};
}
