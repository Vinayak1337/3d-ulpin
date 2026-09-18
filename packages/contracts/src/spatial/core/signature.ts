import {assertCoreJson,coreFail} from "./scalars";
import {CORE_SNAPSHOT_POLICY} from "./snapshot-schema";

const utf8=new TextEncoder();
function scalarString(value:string):void {
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))coreFail("SIGNATURE_UNICODE","Unpaired UTF-16 surrogate is not a portable UTF-8 string");}
    else if(code>=0xdc00&&code<=0xdfff)coreFail("SIGNATURE_UNICODE","Unpaired UTF-16 surrogate is not a portable UTF-8 string");
  }
}
function scalarCompare(a:string,b:string):number {
  const left=Array.from(a),right=Array.from(b);
  for(let i=0;i<Math.min(left.length,right.length);i++){const d=left[i].codePointAt(0)!-right[i].codePointAt(0)!;if(d)return d;}
  return left.length-right.length;
}
/** Private tagged encoding, NOT JSON canonicalization/RFC8785. Arrays retain order. */
export function canonicalCoreText(input:unknown):string {
  assertCoreJson(input);
  const pieces:string[]=[];let bytes=0;
  const push=(value:string)=>{bytes+=utf8.encode(value).length;if(bytes>CORE_SNAPSHOT_POLICY.maximumEncodingBytes)coreFail("SIGNATURE_LIMIT","Canonical input exceeds the bounded encoding profile");pieces.push(value);};
  const string=(value:string)=>{scalarString(value);push(`s${utf8.encode(value).length}:${value}`);};
  const visit=(value:unknown):void=>{
    if(value===null){push("z");return;}
    if(typeof value==="boolean"){push(value?"t":"f");return;}
    if(typeof value==="number"){
      const buffer=new ArrayBuffer(8);new DataView(buffer).setFloat64(0,Object.is(value,-0)?0:value,false);
      push("n"+Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join(""));return;
    }
    if(typeof value==="string"){string(value);return;}
    if(Array.isArray(value)){push(`a${value.length}:`);for(const item of value)visit(item);return;}
    if(typeof value!=="object")coreFail("NON_JSON","Signature inputs must be JSON");
    const record=value as Record<string,unknown>,keys=Object.keys(record).sort(scalarCompare);
    push(`o${keys.length}:`);for(const key of keys){string(key);visit(record[key]);}
  };
  visit(input);return pieces.join("");
}
export async function coreInputDigest(input:unknown):Promise<string> {
  const bytes=utf8.encode(canonicalCoreText(input));
  const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
