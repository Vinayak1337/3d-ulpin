import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {projectRoot} from '../../../../scripts/repo-env.mjs';
import type {StudioSourceManifest} from '@/features/studio/data/source-types';
const root=()=>path.join(projectRoot(),'fixtures/studio/reference-v2');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let cached:{stamp:string;promise:Promise<StudioSourceManifest>}|undefined;
export async function preparedStudioManifest(){const file=path.join(root(),'manifest.json'),s=await stat(file),stamp=`${s.mtimeMs}:${s.size}`;if(cached?.stamp===stamp)return cached.promise;const promise=readFile(file,'utf8').then(raw=>{const m=JSON.parse(raw) as StudioSourceManifest;if(m.schemaVersion!=='studio-prepared-sources/1'||!m.synthetic||m.documents.length>2000)throw new Error('Unqualified Studio source manifest');return m;});cached={stamp,promise};try{return await promise;}catch(error){if(cached?.promise===promise)cached=undefined;throw error;}}
/** Public synthetic specimens only; no request can resolve an arbitrary local file. */
export async function handleStudioSource(request:Request,segments:string[]){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{
  if(new URL(request.url).searchParams.size||segments.length<1||segments.length>2)return Response.json({error:'Unknown Studio asset'},{status:404,headers});
  const manifest=await preparedStudioManifest();
  if(segments.length===1&&segments[0]==='manifest.json')return Response.json(manifest,{headers});
  if(segments.length===2&&segments[0]==='documents'){
   const d=manifest.documents.find(d=>d.id===segments[1]);if(!d)return Response.json({error:'The requested document is not in this dataset'},{status:404,headers});
   const bundle=manifest.assets.find(a=>a.id==='source-bundle')!,zip=await readFile(path.join(root(),bundle.file));
   if(zip.length!==bundle.bytes||sha(zip)!==bundle.sha256)throw new Error('Prepared source archive changed');
   const key='documents/'+d.filename,bytes=unzipSync(zip,{filter:file=>file.name===key})[key];
   if(!bytes||bytes.length!==d.bytes||sha(bytes)!==d.sha256)throw new Error('Document bytes do not match the manifest');
   return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${d.filename}"`,'ETag':`"${d.sha256}"`}});
  }
  if(segments.length===2&&segments[0]==='assets'){
   const a=manifest.assets.find(a=>a.id===segments[1]);if(!a)return Response.json({error:'Unknown source asset'},{status:404,headers});
   const bytes=await readFile(path.join(root(),a.file));if(bytes.length!==a.bytes||sha(bytes)!==a.sha256)throw new Error('Source bytes changed');
   return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':a.mediaType,'Content-Disposition':`attachment; filename="${a.file}"`,'ETag':`"${a.sha256}"`}});
  }
  return Response.json({error:'Unknown source route'},{status:404,headers});
 }catch{return Response.json({error:'Prepared demonstration sources are unavailable; no document was invented'},{status:503,headers});}
}
