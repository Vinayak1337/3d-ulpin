/** Focused Windows real-CLI regressions. Uses only private copied technical fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as children from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import {PacketRegionService} from '../packages/server/src/modules/usp/packets/region-extract';
import * as contract from '../packages/contracts/src/packet-region';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {readBoundedOcrArtifact} from '../packages/server/src/modules/usp/ingestion/document-ocr';

const python=process.env.ULPIN_PACKET_REGION_TEST_PYTHON,root=process.env.ULPIN_PACKET_REGION_TEST_ROOT;
const repo=process.cwd(),require=createRequire(path.join(repo,'package.json')),ts=require('typescript');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const repoFiles=['services/geo/geo/usp_packet_regions.py','scripts/usp/document-models/run_packet_region.py',
  'scripts/usp/document-models/packet_region_loader.py','scripts/usp/document-models/run_trial.py',
  'scripts/usp/document-models/run_pdf_pages.py','services/geo/geo/usp_document_candidates/granite.py',
  'services/geo/geo/__init__.py','services/geo/geo/usp_document_candidates/__init__.py','packages/contracts/src/packet-region.ts'];
const observations:any[]=[];
function run(args:string[],interpreter=python){
  const result=children.spawnSync(interpreter!,args,{windowsHide:true,encoding:'utf8',timeout:45000});
  assert.equal(result.status,0,`${result.error??''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
let purelib:string;
async function fixture(name:string,mutate?:(copy:string)=>Promise<void>,interpreter=python){
  const copy=path.join(root!,name,'repo');await fs.mkdir(copy,{recursive:true});
  for(const relative of repoFiles){const target=path.join(copy,relative);await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(path.join(repo,relative),target);}
  if(mutate)await mutate(copy);
  const profile=path.join(root!,name,'profile.json');
  const profileSha=run(['-B',path.join(copy,'scripts/usp/document-models/packet_region_loader.py'),
    '--create-profile',profile,'--repo',copy,'--purelib',purelib],interpreter);
  return {copy,profile,profileSha};
}
async function runtime(frozen:Awaited<ReturnType<typeof fixture>>,receiptFault=false,interpreter=python){
  const runtimeFile=path.join(repo,'packages/server/src/modules/usp/packets/region-runtime.ts');
  const source=await fs.readFile(runtimeFile,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let attempts=0,launches=0;const removed:string[]=[],retained:string[]=[];
  const adapters={privateOcrDirectory:async()=>{
    const directory=path.join(path.dirname(frozen.copy),'attempt-'+(++attempts));await fs.mkdir(directory);retained.push(directory);return directory;
  },readBoundedOcrArtifact:async(file:string,limit:number)=>{
    if(receiptFault&&path.basename(file)==='receipt.json')throw new Error('injected missing receipt');
    return readBoundedOcrArtifact(file,limit);
  }};
  const module={exports:{} as any};
  const fakeFs={...fs,rm:async(directory:string,options:any)=>{
    removed.push(directory);
    // Save technical output before successful cleanup, never operational bytes.
    try{await fs.cp(path.join(directory,'output'),path.join(path.dirname(frozen.copy),'saved-'+removed.length),{recursive:true});}catch{}
    await fs.rm(directory,options);
  }};
  const localRequire=(name:string)=>{
    if(name==='node:child_process')return {...children,spawn:(...args:any[])=>{launches++;return (children.spawn as any)(...args);}};
    if(name==='node:fs/promises')return fakeFs;
    if(name.endsWith('contracts/src/packet-region'))return contract;
    if(name.endsWith('infrastructure/config'))return {settings:{repositoryRoot:frozen.copy}};
    if(name.endsWith('infrastructure/errors'))return {AppError};
    if(name.endsWith('infrastructure/storage'))return {sha256:sha};
    if(name.endsWith('ingestion/document-ocr'))return adapters;
    return require(name);
  };
  const isolatedProcess={platform:process.platform,env:{...process.env,ULPIN_PACKET_REGIONS_PYTHON:interpreter,
    ULPIN_PACKET_REGIONS_SCRATCH:root,ULPIN_PACKET_REGIONS_PROFILE:frozen.profile,
    ULPIN_PACKET_REGIONS_PROFILE_SHA256:frozen.profileSha}};
  vm.runInNewContext(js,{module,exports:module.exports,require:localRequire,process:isolatedProcess,Buffer,
    setTimeout,clearTimeout},{filename:runtimeFile});
  const benign=await fs.readFile(path.join(root!,'benign.pdf')),active=await fs.readFile(path.join(root!,'active.pdf'));
  const selection=JSON.parse(await fs.readFile(path.join(root!,'selection.json'),'utf8'));
  const extract=(bytes=benign)=>{
    const authority={caseId:'b4d629b1-b948-4ba6-900b-28e4c2bf2458',caseRevision:1,
      sourceId:'174da4ed-bb83-4726-bd2d-d3f53578de11',sourceRevision:1,sourceSha256:sha(bytes),sourceBytes:bytes.length,
      objectKey:'technical-control',name:'technical-control',authoritySha256:'2'.repeat(64)};
    let checks=0;
    const service=new PacketRegionService({authorize:async()=>{checks++;return authority;},original:async()=>bytes,
      inspect:module.exports.inspectPrivatePacketRegion,recipe:module.exports.packetRegionRecipeSha});
    return service.extract(authority.sourceId,1,{revision:'1',sha256:authority.sourceSha256,
      purpose:'private_source_preview',selection}).then((result:any)=>{assert.equal(checks,3);return result;});
  };
  return {extract,active,assertRuntime:module.exports.assertPacketRegionRuntime,removed,retained,
    counts:()=>({attempts,launches}),profileSha:frozen.profileSha};
}
const code=(wanted:string)=>(error:any)=>error instanceof AppError&&error.code===wanted;

test('frozen execution and cleanup outcomes through actual region runtime/service',
  {skip:process.platform!=='win32'||!python||!root,timeout:240000},async()=>{
  assert(path.isAbsolute(root!));assert(!path.resolve(root!).startsWith(path.resolve(repo)+path.sep));
  await fs.mkdir(root!,{recursive:true});
  purelib=path.join(root!,'purelib');
  run(['-B','-c',`import pathlib,shutil,sysconfig,fitz,json
r=pathlib.Path(${JSON.stringify(root)}); target=r/'purelib'; target.mkdir()
p=pathlib.Path(sysconfig.get_paths()['purelib'])
for name in ('pypdfium2','pypdfium2_raw','pypdfium2_cfg','pymupdf','fitz','PIL','psutil'):
 shutil.copytree(p/name,target/name)
for name in ('pypdfium2','pymupdf','pillow','psutil'):
 for d in p.glob(name+'-*.dist-info'): shutil.copytree(d,target/d.name)
with fitz.open() as doc:
 page=doc.new_page(width=40,height=40);page.draw_rect(page.rect,color=None,fill=(0,1,0))
 annot=page.add_rect_annot(fitz.Rect(5,5,35,35));annot.set_colors(stroke=(0,0,1),fill=(0,0,1));annot.update()
 doc.save(r/'benign.pdf')
 x=doc.get_new_xref();doc.update_object(x,'<< /S /JavaScript /JS (app.alert("NO")) >>')
 doc.xref_set_key(doc.pdf_catalog(),'OpenAction',str(x)+' 0 R');doc.save(r/'active.pdf')
s={'frame':{'kind':'pdf_display_page_top_left_points','width':40,'height':40,'rotation':0},'mediaBox':[0,0,40,40],
'cropBox':[0,0,40,40],'boxConvention':'pymupdf_page_rectangles/1','coordinates':'displayed_cropbox_normalized_top_left/1',
'region':[.25,.25,.75,.75],'selectionAcknowledged':True}
(r/'selection.json').write_text(json.dumps(s))`]);

  const cache=await fixture('cache');
  const renderer=path.join(cache.copy,'services/geo/geo/usp_packet_regions.py');
  // Timestamp AND size-valid cached renderer, identical source bytes/profile.
  run(['-B','-c',`from pathlib import Path
import importlib.util,importlib._bootstrap_external as b
p=Path(${JSON.stringify(renderer)});s=p.read_text();assert 'raw.FPDF_RENDER_LIMITEDIMAGECACHE' in s
c=compile(s.replace('raw.FPDF_RENDER_LIMITEDIMAGECACHE','raw.FPDF_ANNOT | raw.FPDF_RENDER_LIMITEDIMAGECACHE'),str(p),'exec')
t=p.stat();cached=Path(importlib.util.cache_from_source(str(p)));cached.parent.mkdir(exist_ok=True)
cached.write_bytes(b._code_to_timestamp_pyc(c,int(t.st_mtime),t.st_size))`]);
  const safe=await runtime(cache);
  const cropped=await safe.extract();
  assert.equal(cropped.provenance.recipeSha256,cache.profileSha);
  await fs.writeFile(path.join(root!,'cache-output.png'),cropped.bytes);
  run(['-B','-c',`from PIL import Image
with Image.open(${JSON.stringify(path.join(root!,'cache-output.png'))}) as image:
 assert image.getextrema()==((0,0),(255,255),(0,0)), image.getextrema()`]);
  await assert.rejects(safe.extract(safe.active),code('PACKET_REGION_ACTIVE_OR_EXTERNAL_UNSUPPORTED'));
  safe.assertRuntime();await safe.extract();assert.equal(safe.removed.length,3);
  observations.push({control:'valid-poisoned-cache-ignored-and-completed-refusal-reusable',...safe.counts(),
    profileSha256:cache.profileSha,pngSha256:sha(cropped.bytes),blueAnnotationPixels:0});

  const helper=await fixture('helper');
  const helperPath=path.join(helper.copy,'scripts/usp/document-models/run_pdf_pages.py');
  await fs.writeFile(helperPath,(await fs.readFile(helperPath,'utf8')).replace('def _deny_external_files(document) -> None:',
    'def _deny_external_files(document) -> None:\n    return'));
  const helperRuntime=await runtime(helper);await assert.rejects(helperRuntime.extract(helperRuntime.active),code('PACKET_REGION_EXECUTABLE_DRIFT'));
  assert.deepEqual(helperRuntime.counts(),{attempts:0,launches:0});
  observations.push({control:'omitted-helper-drift-refused',...helperRuntime.counts()});

  const dependency=await fixture('dependency');
  const asset=path.join(purelib,'pypdfium2_raw','version.py'),before=await fs.readFile(asset);
  try{
    await fs.writeFile(asset,Buffer.concat([before,Buffer.from('\n# private resolved dependency drift\n')]));
    const drift=await runtime(dependency);await assert.rejects(drift.extract(),code('PACKET_REGION_EXECUTABLE_DRIFT'));
    assert.deepEqual(drift.counts(),{attempts:0,launches:0});
    observations.push({control:'resolved-runtime-dependency-drift-refused',...drift.counts()});
  }finally{await fs.writeFile(asset,before);}

  const fault=await fixture('supervisor-fault',async copy=>{
    const file=path.join(copy,'scripts/usp/document-models/run_trial.py');
    await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('    if max_log_bytes is not None and max_log_bytes < 1:',
      '    raise RuntimeError("owned_process_tree_survived_shutdown")\n    if max_log_bytes is not None and max_log_bytes < 1:'));
  });
  const unresolved=await runtime(fault);
  await assert.rejects(unresolved.extract(),code('PACKET_REGION_CLEANUP_UNRESOLVED'));
  assert.throws(()=>unresolved.assertRuntime(),code('PACKET_REGION_CLEANUP_UNRESOLVED'));
  await assert.rejects(unresolved.extract(),code('PACKET_REGION_CLEANUP_UNRESOLVED'));
  assert.deepEqual(unresolved.counts(),{attempts:1,launches:1});assert.equal(unresolved.removed.length,0);
  const receipt=JSON.parse(await fs.readFile(path.join(unresolved.retained[0],'output/receipt.json'),'utf8'));
  assert.equal(receipt.cleanup,'unresolved');assert.equal(receipt.profileSha256,fault.profileSha);
  assert(!JSON.stringify(receipt).includes('survived_shutdown'));
  observations.push({control:'supervisor-exception-retained-and-blocked',...unresolved.counts(),receipt,retained:unresolved.retained});

  const missing=await runtime(await fixture('missing-receipt'),true);
  await assert.rejects(missing.extract(),code('PACKET_REGION_CLEANUP_UNRESOLVED'));
  await assert.rejects(missing.extract(),code('PACKET_REGION_CLEANUP_UNRESOLVED'));
  assert.deepEqual(missing.counts(),{attempts:1,launches:1});assert.equal(missing.removed.length,0);
  observations.push({control:'missing-cleanup-receipt-retained-and-blocked',...missing.counts(),retained:missing.retained});
  await fs.writeFile(path.join(root!,'controls.json'),JSON.stringify({version:'packet-region-corrections/1',observations,
    scope:'Actual leaf source, CLI and service with technical authority dependencies; no HTTP/SQL or intentional orphan.'},null,2));
});

test('bootstrap ignores newly present valid cache in parent and gated child',
  {skip:process.platform!=='win32'||!python||!root,timeout:90000},async()=>{
  // Copy only the previously inventoried runtime and technical inputs. Never
  // create/remove a cache under the installed interpreter or package directory.
  const previous=path.resolve(root!,'..','owner-profile-final.json');
  const profile=JSON.parse(await fs.readFile(previous,'utf8'));
  const base=path.join(root!,'private-python');await fs.mkdir(base,{recursive:true});
  for(const entry of profile.files){
    const relative=path.relative(profile.base,entry.path);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||entry.path.endsWith('.pyc'))continue;
    const destination=path.join(base,relative);await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.copyFile(entry.path,destination);
  }
  const interpreter=path.join(base,'python.exe');
  const saved=path.resolve(root!,'..','controls-06');
  purelib=path.join(saved,'purelib');
  for(const file of ['benign.pdf','active.pdf','selection.json'])await fs.copyFile(path.join(saved,file),path.join(root!,file));
  const frozen=await fixture('bootstrap',undefined,interpreter);
  const leaf=await runtime(frozen,false,interpreter);
  await leaf.extract();assert.equal(leaf.removed.length,1);
  const marker=path.join(root!,'cache-executed.txt'),source=path.join(base,'Lib','sysconfig.py');
  const cache=run(['-B','-c',`from pathlib import Path
import importlib.util,importlib._bootstrap_external as b
p=Path(${JSON.stringify(source)});raw=p.read_bytes();s=raw.decode('utf-8')
payload=${JSON.stringify(`open(${JSON.stringify(marker)},'ab').write(b'bootstrap-cache-executed\\n')\n`)}
# Insert after future imports, if any, so the code is a valid module cache.
lines=s.splitlines(True);i=0
for j,line in enumerate(lines):
 if line.startswith('from __future__ import '): i=j+1
lines.insert(i,payload);c=compile(''.join(lines),str(p),'exec')
t=p.stat();cached=Path(importlib.util.cache_from_source(str(p)));cached.parent.mkdir(exist_ok=True)
cached.write_bytes(b._code_to_timestamp_pyc(c,int(t.st_mtime),t.st_size));print(cached)`]);
  const frozenJson=JSON.parse(await fs.readFile(frozen.profile,'utf8'));
  assert(!frozenJson.files.some((entry:any)=>path.resolve(entry.path)===path.resolve(cache)));
  // The isolated direct import is a positive control for this private cache.
  run(['-I','-S','-B','-c','import sysconfig'],interpreter);
  assert.equal((await fs.readFile(marker,'utf8')).trim(),'bootstrap-cache-executed');
  await fs.rename(marker,path.join(root!,'cache-positive-control.txt'));
  await leaf.extract();assert.equal(leaf.removed.length,2);
  await assert.rejects(fs.access(marker));
  const receipt=JSON.parse(await fs.readFile(path.join(root!,'bootstrap/saved-2/receipt.json'),'utf8'));
  assert.equal(receipt.cleanup,'confirmed');assert.equal(receipt.worker.exitCode,0);assert.equal(receipt.worker.gatedStart,true);
  const cacheBytes=await fs.readFile(cache);
  await fs.writeFile(path.join(root!,'bootstrap-controls.json'),JSON.stringify({version:'packet-region-bootstrap-control/1',
    profileSha256:frozen.profileSha,cache:{path:cache,sha256:sha(cacheBytes),absentFromFrozenProfile:true,
      ordinaryPrivateImportExecuted:true},corrected:{parentAndGatedChildExecutedMarker:false,
      ordinaryLaunch:true,poisonedLaunch:true,receipt,attemptsRemoved:leaf.removed.length,...leaf.counts()},
    scope:'Private copied CPython/runtime and prior technical PDF. No installed cache change, operational render or intentional orphan.'},null,2));
});
