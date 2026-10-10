import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.uuid().transform(value=>value.toLowerCase());
export type SourceFusionJsonValue=string|number|boolean|null|SourceFusionJsonValue[]|{[key:string]:SourceFusionJsonValue};
/** Validate without rebuilding records: z.json()/z.record() deliberately omit
 * own __proto__ keys. Inspect data descriptors only; never invoke accessors or
 * assign dynamic keys, so literal JSON stays intact without prototype writes. */
function literalJson(value:unknown):boolean{
  const stack=[{value,depth:0}];let count=0;
  while(stack.length){
    const {value,depth}=stack.pop()!;
    if(++count>2_000_000)return false;
    if(value===null||typeof value==='string'||typeof value==='boolean')continue;
    if(typeof value==='number'){if(!Number.isFinite(value))return false;continue;}
    if(typeof value!=='object'||depth>=64)return false;
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return false;
    const keys=Reflect.ownKeys(value);
    if(keys.length-(array?1:0)+count+stack.length>2_000_000)return false;
    // JSON arrays are dense, with no extra properties silently lost on the wire.
    if(array&&keys.length!==value.length+1)return false;
    for(const key of keys){
      if(array&&key==='length')continue;
      if(typeof key!=='string')return false;
      if(array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))return false;
      const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
      if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return false;
      stack.push({value:descriptor.value,depth:depth+1});
    }
  }
  return true;
}
const literalDescription='Literal finite JSON; all own keys retained, including __proto__; depth <=64 and values <=2000000; no accessors or non-JSON values';
// OpenAPI's JSON wire universe is recursive implicitly: unconstrained array
// items/object values can be any JSON value. Runtime checks apply at every depth.
export const SourceFusionLiteralJsonSchema=z.custom<SourceFusionJsonValue>(literalJson,'A bounded literal JSON value is required.')
  .meta({description:literalDescription,anyOf:[{type:'string'},{type:'number'},{type:'boolean'},
    {type:'string',nullable:true,enum:[null]},{type:'array',items:{}},{type:'object',additionalProperties:true}]});
export const SourceFusionLiteralObjectSchema=z.custom<Record<string,SourceFusionJsonValue>>(
  value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&literalJson(value),'A bounded literal JSON object is required.')
  .meta({description:literalDescription,type:'object',additionalProperties:true});
export const SourceFusionPinSchema=DocumentAssociationSourceSchema.extend({caseId:id,sourceId:id,jobId:id,readerSha256:hash,inputSha256:hash,
  acceptedFence:z.number().int().positive(),resultBytes:z.number().int().positive().max(4*1024*1024)});
