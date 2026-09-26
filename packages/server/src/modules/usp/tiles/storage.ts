import {PRIVATE_MVT_PROFILE as p,PrivateMvtAssetSchema,type PrivateMvtInput} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {openObjectStream,sha256,putPrivateMvtObject} from '../../../infrastructure/storage';
export const mvtPrefix=(input:PrivateMvtInput)=>`private-mvt/${input.compiler.sha256}/${input.source.sha256}/`;
export function mvtArtifact(input:PrivateMvtInput,kind:'tiles'|'maps'|'manifests',identity:string,bytes:Buffer){
  const hash=sha256(bytes);return PrivateMvtAssetSchema.parse({key:`${mvtPrefix(input)}${kind}/${identity}-${hash}.${kind==='tiles'?'mvt':'json'}`,sha256:hash,bytes:bytes.length});
}
export async function writeMvtArtifact(input:PrivateMvtInput,ref:ReturnType<typeof mvtArtifact>,bytes:Buffer,bound:number){
  if(!ref.key.startsWith(mvtPrefix(input)))throw new AppError(422,'MVT_ASSET_SCOPE','The tile asset belongs to another compiler/source profile.');
  await putPrivateMvtObject(ref.key,bytes,ref.sha256,bound,ref.key.endsWith('.mvt')?'application/vnd.mapbox-vector-tile':'application/json');
}
export async function readMvtArtifact(input:PrivateMvtInput,value:unknown,bound:number){
  const ref=PrivateMvtAssetSchema.parse(value),suffix=ref.key.slice(mvtPrefix(input).length);
  if(!ref.key.startsWith(mvtPrefix(input))||ref.bytes>bound||bound>p.tileBytes
    ||! /^(tiles|maps|manifests)\/[a-f0-9-]+-[a-f0-9]{64}\.(mvt|json)$/.test(suffix)
    ||!ref.key.endsWith(`-${ref.sha256}.${ref.key.endsWith('.mvt')?'mvt':'json'}`))
    throw new AppError(422,'MVT_ASSET_SCOPE','Choose a registered bounded artifact from this exact source/compiler.');
  const object=await openObjectStream(ref.key,ref.bytes,p.objectMs),chunks:Buffer[]=[];let count=0;
  try{for await(const value of object.body){const chunk=value as Buffer;count+=chunk.length;if(count>ref.bytes)throw new AppError(422,'MVT_ASSET_INTEGRITY','Tile asset exceeds its pinned size.');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks,count);if(count!==ref.bytes||sha256(bytes)!==ref.sha256)throw new AppError(422,'MVT_ASSET_INTEGRITY','Tile asset differs from its pinned bytes/hash.');return bytes;
  }finally{object.body.destroy();}
}
