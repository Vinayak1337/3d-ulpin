import {readdir,realpath,stat} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import type {PacketImageRegionRecipe,PacketImageRegionWorker} from '../../../../../contracts/src/packet-image-region';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {settings} from '../../../infrastructure/config';
import {readBoundedOcrArtifact} from '../ingestion/document-ocr';
import {packetImageRegionRecipe} from './image-region';

export type ImageCheckpointRuntime={recipe:PacketImageRegionRecipe;
  runtime:Pick<PacketImageRegionWorker['runtime'],'pythonSha256'|'launcherSha256'|'pillowImageSha256'|'imagingSha256'>};
function unavailable():never{throw new AppError(503,'PACKET_IMAGE_CHECKPOINT_RUNTIME_UNAVAILABLE',
  'The current image decoder cannot be resolved without execution under this runtime layout. Synchronous execution remains available.');}
async function exists(path:string){try{await stat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
// Inspected installed bootstrap sources, never imported here. These hooks only
// intercept distutils or add pywin32 DLL search; they do not resolve/preload PIL.
// Source and any existing CPython cache bytes must match, not just the .pth name.
// Origins/versions and immutable file hashes are recorded in the handoff.
const hooks:Record<string,{pth:string;module:string;source:string;cached:string[]}>= {
  'distutils-precedence.pth':{pth:'2638ce9e2500e572a5e0de7faed6661eb569d1b696fcba07b0dd223da5f5d224',module:'_distutils_hack/__init__.py',
    source:'ced72e54431ecf2d8d7dbd8a1e27724f1b171af3ca1503c304bf11c59a7fe861',cached:[
      'ef0efceabde82c00c717fe459c0ecf3cda41e90ef158394dea2ae9dbe4d4245a','3ff497161e295f3a362309063c4163455bf6ecb1fc5672095ac512a81b303e44']},
  '_virtualenv.pth':{pth:'69ac3d8f27e679c81b94ab30b3b56e9cd138219b1ba94a1fa3606d5a76a1433d',module:'_virtualenv.py',
    source:'cfb3db86aaa53bb62b5ff764970bec2d71c9228590a0ebec57f6ec926cc0bf1a',cached:['922ac8fd64123299cd0ebe5f431e5f639f76dfeaa874877ae99bcef3b15d60b3']},
  'pywin32.pth':{pth:'e7cd73df98b91c407dfd96d1f4dd18b7f9a60f29902b92cf5ece79b6eb637b81',module:'pywin32_bootstrap.py',
    source:'fd31f27bc85a6b9c974670838b6eefafb32991be4a9f840f96a4f5524df3b3c3',cached:['097f522f47a4b202b83fcddca788861b84e9b5c596a2447952e6bf93d7c6bc5c']},
};

/** File-only resolution of the existing Windows Job gate: base Python runs
 * site.main(), then adds the launcher's purelib. No Python/native invocation,
 * profile creation or use of receipt-supplied filesystem paths. Layouts with
 * unrecognized startup hooks cannot be proven by static resolution and refuse.
 * This is deliberately narrower than the synchronous worker's runtime support. */
export async function inspectImageCheckpointRuntime(configured:string,deadlineAt:number){
  const live=()=>{if(Date.now()>=deadlineAt)throw new AppError(503,'PACKET_PDF_DEADLINE','The bounded image runtime check expired.');};
  const read=async(path:string,limit:number)=>{live();const value=await readBoundedOcrArtifact(await realpath(path),limit);live();return value;};
  try{
    live();if(process.platform!=='win32'||!isAbsolute(configured))unavailable();
    const launcher=await realpath(configured);if(basename(launcher).toLowerCase()!=='python.exe')unavailable();
    const directory=dirname(launcher),venv=join(dirname(directory),'pyvenv.cfg');
    let base=directory,purelib=join(base,'Lib/site-packages');
    if(await exists(venv)){
      const config=(await read(venv,4096)).toString('utf8');
      const homes=[...config.matchAll(/^home\s*=\s*(.+)\s*$/gm)];
      if(homes.length!==1||!isAbsolute(homes[0][1].trim()))unavailable();
      base=await realpath(homes[0][1].trim());purelib=join(dirname(directory),'Lib/site-packages');
    }
    const python=join(base,'python.exe'),baseLib=join(base,'Lib/site-packages');
    const startupRoots=[base,join(base,'Lib'),baseLib,purelib,join(settings.repositoryRoot,'scripts/usp/document-models')];
    // A ._pth/customization/early PIL or uninspected .pth can change the gate's
    // effective imports. Never guess which binary such startup code will load.
    for(const root of new Set(startupRoots)){
      if(!await exists(root))continue;
      const names=await readdir(root);live();if(names.length>10000)unavailable();
      if(names.some(name=>/\._pth$/i.test(name)||/^(sitecustomize|usercustomize)(\.py|\.pyc|\.pyd)?$/i.test(name)))unavailable();
      if((root===base||root===join(base,'Lib')||root===startupRoots[4])&&names.some(name=>/^PIL(\.py|\.pyc|\.zip)?$/i.test(name)))unavailable();
      for(const name of names.filter(name=>name.endsWith('.pth')).sort()){
        const pth=await read(join(root,name),65536),lines=pth.toString('utf8').split(/\r?\n/);
        if(lines.some(line=>/^import[\t ]/.test(line.trim()))){
          const hook=hooks[name];if(!hook||sha256(pth)!==hook.pth)unavailable();
          let source:string|undefined;
          for(const candidate of [join(baseLib,hook.module),join(root,hook.module),join(root,'win32/lib',hook.module)])
            if(await exists(candidate)){source=candidate;break;}
          if(!source||sha256(await read(source,65536))!==hook.source)unavailable();
          const cache=join(dirname(source),'__pycache__'),stem=basename(source,'.py');
          if(await exists(cache))for(const file of (await readdir(cache)).filter(file=>file.startsWith(stem+'.')&&file.endsWith('.pyc')))
            if(!hook.cached.includes(sha256(await read(join(cache,file),131072))))unavailable();
          // pywin32_system32 must remain a namespace directory, not code.
          if(name==='pywin32.pth'&&(await exists(join(root,'pywin32_system32/__init__.py'))||await exists(join(root,'pywin32_system32.py'))))unavailable();
        }
        for(const line of lines){
          const value=line.trim();if(!value||value.startsWith('#'))continue;
          if(/^import[\t ]/.test(value))continue;
          if(name!=='pywin32.pth'||sha256(pth)!==hooks[name].pth||!['win32','win32\\lib','pythonwin'].includes(value))unavailable();
          const added=resolve(root,value);
          for(const shadow of ['PIL','PIL.py','PIL.pyc','sitecustomize.py','usercustomize.py','_virtualenv.py','_distutils_hack'])
            if(await exists(join(added,shadow)))unavailable();
        }
      }
    }
    // The gate's base site-packages precedes the appended venv site-packages.
    const pillow=await exists(join(baseLib,'PIL'))?join(baseLib,'PIL'):join(purelib,'PIL');
    const extensions=(await readdir(pillow)).filter(name=>/^_imaging\.cp\d+-win_(amd64|arm64|32)\.pyd$/.test(name));
    if(extensions.length!==1)unavailable();
    const [pythonBytes,launcherBytes,imageBytes,imagingBytes]=await Promise.all([
      read(python,32*1024**2),read(launcher,32*1024**2),read(join(pillow,'Image.py'),1024**2),read(join(pillow,extensions[0]),32*1024**2)]);
    live();return {pythonSha256:sha256(pythonBytes),launcherSha256:sha256(launcherBytes),
      pillowImageSha256:sha256(imageBytes),imagingSha256:sha256(imagingBytes)};
  }catch(error){if(error instanceof AppError&&error.code==='PACKET_PDF_DEADLINE')throw error;unavailable();}
}
export async function packetImageCheckpointRuntime(deadlineAt:number):Promise<ImageCheckpointRuntime>{
  const configured=process.env.ULPIN_DOCUMENT_IMAGES_PYTHON??process.env.ULPIN_DOCUMENT_OCR_PYTHON;
  if(!configured)unavailable();
  const {recipe,pythonSha256:launcher}=await packetImageRegionRecipe();
  const runtime=await inspectImageCheckpointRuntime(configured,deadlineAt);
  if(runtime.launcherSha256!==launcher)unavailable();return {recipe,runtime};
}
