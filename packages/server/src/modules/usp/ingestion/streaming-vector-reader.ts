import {createHash} from 'node:crypto';
import type {Readable} from 'node:stream';
import {STREAMING_VECTOR_LIMITS as limits,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';

const whitespace=(byte:number)=>byte===32||byte===9||byte===10||byte===13;
const decode=(bytes:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
type Framing='feature-collection'|'geojson-seq-rs';

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
    }
    const raw=Buffer.from(bytes);
    // Parse one logical value only. The full collection is never assembled.
    try{JSON.parse(decode(raw));}catch{throw new AppError(422,'GEOJSON_JSON','A complete source value is not valid UTF-8 JSON.');}
    return {bytes:raw,start,end:this.offset};
  }
  digest(){return this.hash.digest('hex');}
}

export type SourceFeature={index:number;start:number;end:number;raw:Buffer;feature:unknown};
export async function readStreamingFeatures(body:Readable,framing:Framing,onFeature:(item:SourceFeature)=>Promise<void>){
  const cursor=new Cursor(body);let index=0;const metadata:Record<string,unknown>={};
  const feature=async()=>{
    const value=await cursor.value(limits.featureBytes);
    const parsed=JSON.parse(decode(value.bytes));
    await onFeature({index:index++,start:value.start,end:value.end,raw:value.bytes,feature:parsed});
  };
  if(framing==='feature-collection'){
    await cursor.expect(123);const keys=new Set<string>();let foundFeatures=false;
    while(true){
      const next=await cursor.nonspace();if(next===125){await cursor.take();break;}
      if(keys.size){await cursor.expect(44);}
      const keyValue=await cursor.value(256),key=JSON.parse(decode(keyValue.bytes));
      if(typeof key!=='string'||keys.has(key))throw new AppError(422,'GEOJSON_CONTAINER','Collection keys must be unique strings.');
      keys.add(key);await cursor.expect(58);
      if(key==='features'){
        if(metadata.type!=='FeatureCollection')throw new AppError(422,'GEOJSON_CONTAINER','Collection type must precede the features array.');
        foundFeatures=true;await cursor.expect(91);
        if(await cursor.nonspace()!==93){while(true){await feature();const delim=await cursor.nonspace();if(delim===93)break;await cursor.expect(44);}}
        await cursor.expect(93);
      }else{
        const value=await cursor.value(limits.metadataBytes);
        metadata[key]=JSON.parse(decode(value.bytes));
      }
    }
    if(!foundFeatures||metadata.type!=='FeatureCollection')throw new AppError(422,'GEOJSON_CONTAINER','A FeatureCollection with complete features is required.');
  }else{
    while(await cursor.nonspace()!==null){await cursor.expect(30);await feature();
      // RFC 7464 JSON text sequences require LF after each JSON text.
      if(await cursor.take()!==10)throw new AppError(422,'GEOJSON_SEQUENCE','Every RS framed feature must end with LF.');
    }
  }
  if(await cursor.nonspace()!==null)throw new AppError(422,'GEOJSON_CONTAINER','Trailing source content is not part of the declared framing.');
  return {features:index,metadata,bytes:cursor.offset,sha256:cursor.digest()};
}

type Point=[number,number];
const orientation=(a:Point,b:Point,c:Point)=>Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
const onSegment=(a:Point,b:Point,c:Point)=>Math.min(a[0],b[0])<=c[0]&&c[0]<=Math.max(a[0],b[0])&&Math.min(a[1],b[1])<=c[1]&&c[1]<=Math.max(a[1],b[1]);
function intersects(a:Point,b:Point,c:Point,d:Point){
  const x=orientation(a,b,c),y=orientation(a,b,d),u=orientation(c,d,a),v=orientation(c,d,b);
  return x!==y&&u!==v||x===0&&onSegment(a,b,c)||y===0&&onSegment(a,b,d)||u===0&&onSegment(c,d,a)||v===0&&onSegment(c,d,b);
}
function ringIssue(value:unknown):string|null{
  if(!Array.isArray(value)||value.length<4||value.length>2048)return 'RING_BUDGET_OR_SHAPE';
  const points:Point[]=[];
  for(const item of value){if(!Array.isArray(item)||item.length<2||item.length>4||item.some(v=>typeof v!=='number'||!Number.isFinite(v)))return 'INVALID_COORDINATE';points.push([item[0],item[1]]);}
  const n=points.length-1;
  if(points[0]![0]!==points[n]![0]||points[0]![1]!==points[n]![1])return 'OPEN_RING';
  let twiceArea=0;for(let i=0;i<n;i++)twiceArea+=points[i]![0]*points[i+1]![1]-points[i+1]![0]*points[i]![1];
  if(twiceArea===0)return 'ZERO_AREA_RING';
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(i===0&&j===n-1)continue;
    if(intersects(points[i]!,points[i+1]!,points[j]!,points[j+1]!))return 'SELF_INTERSECTION';
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
  const g=geometry as Record<string,unknown>;
  const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:null;
  if(!Array.isArray(polygons))return 'UNSUPPORTED_GEOMETRY';
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
  const issueCode=validateStreamingFeature(item.feature);
  return {featureIndex:item.index,byteStart:item.start,byteEnd:item.end,
    rawSha256:createHash('sha256').update(item.raw).digest('hex'),
    disposition:issueCode?'quarantined':'accepted',issueCode,feature:item.feature};
}
