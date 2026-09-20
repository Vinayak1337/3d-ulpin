import {Inflate} from 'fflate';
import {normalizeProvidedDatasetFiles} from './source-adapters';
import {normalizeSourceFiles,type SourceNormalizationDiagnostic} from './source-normalizer';

const MAX_INPUT=20*1024*1024,MAX_EXPANDED=30*1024*1024;
const decode=new TextDecoder('utf-8',{fatal:true});
export interface ReferencePackage {
  name:string;
  originalBytes:Uint8Array;
  originalSha256:string;
  normalizedText:string;
  files:ReadonlyMap<string,Uint8Array>;
  verifiedFiles:number;
  extraction?:{profile:'ulpin-source-package/1'|'ulpin-provided-source/1';sourceFiles:number;diagnostics:SourceNormalizationDiagnostic[]};
}
const fail=(message:string):never=>{throw new Error(message);};
const safePath=(path:string)=>!!path&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(p=>p==='..'||p==='.'||p.includes(':'));
export async function sha256Bytes(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}

/** Decode a bounded source package without writing to disk or interpreting paths as URLs. */
export async function readReferencePackage(name:string,input:Uint8Array):Promise<ReferencePackage>{
  if(!input.length||input.length>MAX_INPUT)fail('Choose a nonempty ZIP or JSON file smaller than 20 MB.');
  const originalBytes=new Uint8Array(input),originalSha256=await sha256Bytes(originalBytes);
  if(name.toLowerCase().endsWith('.json')){
    const originalText=decode.decode(originalBytes),input=JSON.parse(originalText);
    if(input&&typeof input==='object'&&typeof input.scene_id==='string'&&input.coordinate_reference_system){
      const files=new Map([['MASTER_SCENE.json',new Uint8Array(originalBytes)]]),result=await normalizeProvidedDatasetFiles(files,{mode:'master'});
      return {name,originalBytes,originalSha256,normalizedText:result.normalizedText,files,verifiedFiles:0,extraction:{profile:'ulpin-provided-source/1',sourceFiles:result.scene.sources.length,diagnostics:result.diagnostics}};
    }
    return {name,originalBytes,originalSha256,normalizedText:originalText,files:new Map([[name,new Uint8Array(originalBytes)]]),verifiedFiles:0};
  }
  if(!name.toLowerCase().endsWith('.zip'))fail('Choose a normalized JSON or manifest-backed ZIP package.');
  const view=new DataView(originalBytes.buffer),length=originalBytes.length;
  let end=-1;
  for(let i=length-22;i>=Math.max(0,length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===length){end=i;break;}
  if(end<0)fail('The ZIP directory is missing or truncated.');
  if(view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)fail('Split ZIP archives are unsupported.');
  const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryStart=view.getUint32(end+16,true);
  if(!count||count>100||view.getUint16(end+8,true)!==count||directoryStart+directorySize!==end)fail('The ZIP directory exceeds the supported package profile.');
  const entries:{path:string;start:number;compressed:number;size:number;method:number;crc:number}[]=[];
  const names=new Set<string>();let cursor=directoryStart,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)fail('Invalid ZIP directory entry.');
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),compressed=view.getUint32(cursor+20,true),size=view.getUint32(cursor+24,true),nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
    if(cursor+46+nameLength+extra+comment>end)fail('Truncated ZIP entry name.');
    const path=decode.decode(originalBytes.subarray(cursor+46,cursor+46+nameLength));cursor+=46+nameLength+extra+comment;
    if(!safePath(path)||names.has(path))fail('The ZIP has an unsafe or duplicate path.');names.add(path);
    if(flags&1||![0,8].includes(method))fail('Encrypted ZIP files or this compression method are unsupported.');
    if((total+=size)>MAX_EXPANDED)fail('Expanded package exceeds 30 MB.');
    if(offset+30>directoryStart||view.getUint32(offset,true)!==0x04034b50)fail('Invalid ZIP local entry.');
    const localNameLength=view.getUint16(offset+26,true),localExtra=view.getUint16(offset+28,true),start=offset+30+localNameLength+localExtra;
    if(start+compressed>directoryStart||decode.decode(originalBytes.subarray(offset+30,offset+30+localNameLength))!==path||view.getUint16(offset+8,true)!==method)fail('ZIP local and directory records disagree.');
    if(!path.endsWith('/'))entries.push({path,start,compressed,size,method,crc});
  }
  if(cursor!==end)fail('ZIP directory size does not match its entries.');
  const files=new Map<string,Uint8Array>();
  for(const entry of entries){
    const compressed=originalBytes.subarray(entry.start,entry.start+entry.compressed);
    const bytes=entry.method===0?new Uint8Array(compressed):inflateBounded(compressed,entry.size);
    if(bytes.length!==entry.size||crc32(bytes)!==entry.crc)fail(`ZIP length or checksum mismatch: ${entry.path}`);
    files.set(entry.path,bytes);
  }
  const manifests=[...files.keys()].filter(p=>/(^|\/)manifest\.json$/.test(p));
  if(manifests.length!==1)fail('The ZIP needs exactly one manifest.json.');
  const manifestPath=manifests[0],prefix=manifestPath.slice(0,-'manifest.json'.length);
  const manifest=JSON.parse(decode.decode(files.get(manifestPath))) as {files?:{path:string;bytes:number;sha256:string}[]};
  if(!Array.isArray(manifest.files)||!manifest.files.length)fail('The manifest has no source files.');
  const manifestFiles=manifest.files!;
  const declared=new Set<string>();
  for(const item of manifestFiles){
    if(typeof item.path!=='string'||!safePath(item.path)||declared.has(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256))fail('Invalid manifest file entry.');
    declared.add(item.path);const bytes=files.get(prefix+item.path);
    if(!bytes||bytes.length!==item.bytes||await sha256Bytes(bytes)!==item.sha256)fail(`Source fingerprint mismatch: ${item.path}`);
  }
  if(['normalized.json','source-manifest.json','provided-source-manifest.json'].filter(path=>declared.has(path)).length!==1)fail('Declare exactly one input profile: normalized.json, source-manifest.json, or provided-source-manifest.json.');
  for(const path of files.keys())if(path!==manifestPath&&(!path.startsWith(prefix)||!declared.has(path.slice(prefix.length))))fail(`Undeclared package file: ${path}`);
  const relativeFiles=new Map([...files].filter(([path])=>path.startsWith(prefix)&&path!==manifestPath).map(([path,bytes])=>[path.slice(prefix.length),bytes]));
  let providedMode:'master'|'normalized'|null=null;
  if(declared.has('provided-source-manifest.json')){const profile=JSON.parse(decode.decode(relativeFiles.get('provided-source-manifest.json')));if(profile.schemaVersion!=='ulpin-provided-source/1'||profile.classification!=='synthetic'||!['master','normalized'].includes(profile.mode))fail('Unsupported provided source profile.');providedMode=profile.mode;}
  const extracted=providedMode?await normalizeProvidedDatasetFiles(relativeFiles,{mode:providedMode}):declared.has('source-manifest.json')?await normalizeSourceFiles(relativeFiles):null;
  const normalizedText=extracted?.normalizedText??decode.decode(files.get(prefix+'normalized.json'));
  const scene=JSON.parse(normalizedText) as {sources?:{id:string;representation?:string;originalUri?:string;originalSha256?:string;byteSize?:number}[]};
  for(const source of scene.sources??[]){
    if(source.representation!=='original_file')continue;
    const path=source.originalUri?.replace(/^dataset\//,'');
    const item=manifestFiles.find(f=>f.path===path);
    if(!item||source.originalSha256!==item.sha256||source.byteSize!==item.bytes)fail(`Source revision disagrees with original bytes: ${source.id}`);
  }
  return {name,originalBytes,originalSha256,normalizedText,files,verifiedFiles:declared.size,...(extracted?{extraction:{profile:providedMode?'ulpin-provided-source/1' as const:'ulpin-source-package/1' as const,sourceFiles:extracted.scene.sources.length,diagnostics:extracted.diagnostics}}:{})};
}

function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}

function inflateBounded(compressed:Uint8Array,expected:number){
  const chunks:Uint8Array[]=[];let size=0;
  const stream=new Inflate(chunk=>{
    size+=chunk.length;
    if(size>expected||size>MAX_EXPANDED)fail('ZIP expansion exceeds its declared length.');
    chunks.push(chunk);
  });
  // Count real output incrementally. A fixed output buffer silently truncates
  // malformed streams and must never be used to verify preserved source bytes.
  for(let offset=0;offset<compressed.length;offset+=1024)stream.push(compressed.subarray(offset,offset+1024),offset+1024>=compressed.length);
  if(size!==expected)fail('ZIP expansion disagrees with its declared length.');
  const output=new Uint8Array(size);let cursor=0;for(const chunk of chunks){output.set(chunk,cursor);cursor+=chunk.length;}return output;
}
