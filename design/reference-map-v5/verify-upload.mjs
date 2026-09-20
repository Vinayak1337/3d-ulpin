import {launchBrowser} from '../../scripts/spatial/browser-launch.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
// Generate only test-owned corrupt packages; original fixture bytes stay unchanged.
execFileSync('python3',['-c',String.raw`
import zipfile,json,hashlib
from pathlib import Path
out=Path('.runtime/t072-import');out.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile('design/reference-map-v5/data/neem-reference-dataset.zip') as z: files={n:z.read(n) for n in z.namelist()}
prefix=next(n[:-len('normalized.json')] for n in files if n.endswith('normalized.json'))
for name,rehash in [('tampered.zip',False),('false-source-fingerprint.zip',True)]:
 f=dict(files);n=json.loads(f[prefix+'normalized.json']);n['sources'][0]['originalSha256']='0'*64;f[prefix+'normalized.json']=json.dumps(n).encode()
 if rehash:
  m=json.loads(f[prefix+'manifest.json']);item=next(i for i in m['files'] if i['path']=='normalized.json');item['sha256']=hashlib.sha256(f[prefix+'normalized.json']).hexdigest();item['bytes']=len(f[prefix+'normalized.json']);f[prefix+'manifest.json']=json.dumps(m).encode()
 with zipfile.ZipFile(out/name,'w',zipfile.ZIP_DEFLATED) as z:
  for path,content in f.items():z.writestr(path,content)
`]);
const output=process.argv[2]||'docs/engineering-plan/evidence/t073';await mkdir(output,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1512,height:982}});const errors=[],requests=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));const assert=(v,s)=>{if(!v)throw new Error(s);checks.push(s)};
const fixture=JSON.parse(await readFile('design/reference-map-v5/data/reference-scene.json','utf8'));const fileCount=JSON.parse(await readFile('design/reference-map-v5/dataset/manifest.json','utf8')).files.length;
try{
await page.goto('http://127.0.0.1:3013/#map');await page.waitForFunction(()=>window.prototypeViewer);await page.locator('#data-button').click();await page.screenshot({path:`${output}/source-package.png`});await page.locator('#data-dialog [data-close]').click();await page.locator('#import-button').click();await page.locator('#dataset-file').setInputFiles('design/reference-map-v5/data/neem-reference-dataset.zip');await page.waitForFunction(()=>!document.querySelector('#apply-import').disabled);assert((await page.locator('#import-status').textContent()).includes(`${fileCount} file hashes verified`),'ZIP verifies all package hashes');await page.screenshot({path:`${output}/upload-verified.png`});await page.locator('#apply-import').click();assert(await page.evaluate(n=>window.prototypeData.objects.length===n,fixture.objects.length),'ZIP opens all fixture objects');
await page.locator('[data-action=register]').click();assert(await page.locator('#record-body').textContent().then(s=>s.includes(fixture.objects.find(o=>o.id==='B01').systemId)&&s.includes('Not issued')),'Property record keeps internal and official identity distinct');await page.locator('#record-dialog [data-close]').click();
const before=await page.evaluate(()=>JSON.stringify(window.prototypeViewer.getState()));await page.locator('#import-button').click();const bad=structuredClone(fixture);bad.frames[0].horizontalUnit='degree';await page.locator('#dataset-file').setInputFiles({name:'wrong-units.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await page.waitForFunction(()=>document.querySelector('#import-status').classList.contains('error'));assert(await page.locator('#apply-import').isDisabled(),'Wrong measurement units cannot replace the map');assert(before===await page.evaluate(()=>JSON.stringify(window.prototypeViewer.getState())),'Failed import preserves the existing map and camera');
for(const name of ['tampered.zip','false-source-fingerprint.zip']){await page.locator('#dataset-file').setInputFiles(`.runtime/t072-import/${name}`);await page.waitForFunction(()=>document.querySelector('#import-status').classList.contains('error'));assert(await page.locator('#apply-import').isDisabled(),`${name} rejected before rendering`);}
const noRoad=structuredClone(fixture);noRoad.objects.find(o=>o.id==='R01').geometryId=null;noRoad.geometries=noRoad.geometries.filter(g=>g.objectId!=='R01');await page.locator('#dataset-file').setInputFiles({name:'unavailable-road.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(noRoad))});await page.waitForFunction(()=>!document.querySelector('#apply-import').disabled);await page.locator('#apply-import').click();await page.waitForTimeout(200);assert(await page.locator('.bm-canvas canvas').count()===1,'Unavailable road geometry is skipped safely');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/mobile.png`});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile preview has no horizontal overflow');assert(!requests.some(u=>/localhost:3000|127.0.0.1:3000/.test(u)),'Preview never requests the live application');assert(errors.length===0,'No browser errors during import, records or mobile flow');
}catch(error){checks.push(`FAIL: ${error.message}`);process.exitCode=1}finally{await writeFile(`${output}/upload-results.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));await browser.close()}
