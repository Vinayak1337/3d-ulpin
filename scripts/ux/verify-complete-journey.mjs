/** Complete only the retained, explicitly fictional T066 draft; preserve historical cases. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {launchBrowser} from '../spatial/browser-launch.mjs';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url)),{unzipSync,strFromU8}=require('fflate');
const base='http://127.0.0.1:3000',out='docs/evidence/t068';await mkdir(out,{recursive:true});
const state=JSON.parse(await readFile('docs/evidence/t066/workflow/state.json','utf8')),prior=JSON.parse(await readFile('docs/evidence/t061/workflow/state.json','utf8'));
const report={scope:'Retained T066 fictional source-only imagery draft to ordinary review/record/export; retained T061 actual ML-derived 3D unit exports. All placement and levels are fictional test evidence, not survey or rights claims.',checks:[],errors:[],writes:[]};
const hash=v=>createHash('sha256').update(v).digest('hex'),pass=name=>{report.checks.push(name);console.log('PASS '+name);};
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.url().startsWith(base+'/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))report.writes.push(new URL(r.url()).pathname);});
const get=async path=>{const r=await page.request.get(base+'/api/v1'+path,{timeout:60000});assert.equal(r.status(),200,path);return r.json();};
try{
 const pkg=await get('/import-packages/'+state.draftPackageId),before=await get('/areas/'+state.areaId+'/context');const feature=pkg.features.find(f=>f.id===state.featureId);assert(feature);assert.equal(feature.worldStatus,'synthetic');assert.equal(feature.height.value,null);
 const caseBefore=await get('/cases/'+prior.preparation.caseId);
 await page.goto(base+'/studio/imports/'+pkg.id,{waitUntil:'networkidle'});await page.locator('.ui-import-review').waitFor();
 if(pkg.state!=='COMMITTED'){
  if(pkg.questions.some(q=>!q.answer&&q.kind==='missing_height')){await page.getByPlaceholder('Record why this treatment is appropriate').fill('T068 fictional test review: overhead imagery does not supply a measured exterior height. Keep the retained contour in 2D.');await page.getByRole('button',{name:'Keep height unknown / 2D',exact:true}).click();await page.getByRole('button',{name:'Review import',exact:true}).waitFor();}
  if(pkg.state!=='REVIEWED'){await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('button',{name:'Record observations',exact:true}).waitFor();}
  await page.screenshot({path:out+'/01-review-before-record.png'});
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Record observations',exact:true}).waitFor();
  await page.getByPlaceholder('Reviewed source, geometry meaning and limitations').fill('T068 explicit fictional workflow qualification. Retained published contour with authored synthetic controls only; height unknown. No survey, parcel, ownership or official identity claim.');
  await page.getByRole('button',{name:'Record observations',exact:true}).click();await page.waitForURL(url=>url.pathname==='/studio/areas/'+state.areaId);
 }
 await page.goto(base+'/studio/imports/'+pkg.id,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Observations recorded',exact:true}).waitFor();await page.getByText('Findings (',{exact:false}).click();await page.getByRole('region',{name:'Boundary check findings'}).getByText('Provide an evidenced, confirmed recorded-parcel association and its current boundary. Nearby parcels are not substituted.',{exact:true}).first().waitFor();await page.getByText('Original source files (',{exact:false}).click();assert(await page.getByRole('link',{name:'Open original 1',exact:true}).getAttribute('href'));await page.screenshot({path:out+'/03-recorded-review-evidence.png'});
 const recorded=await get('/import-packages/'+pkg.id),after=await get('/areas/'+state.areaId+'/context');assert.equal(recorded.state,'COMMITTED');const saved=after.features.find(f=>f.id===feature.id);assert(saved);assert.deepEqual(saved.geometry,feature.geometry);assert.equal(saved.identifier,feature.identifier);assert.equal(saved.sourceRevisionId,feature.sourceRevisionId);assert.equal(saved.height.value,null);
 for(const original of before.features)assert.deepEqual(after.features.find(f=>f.id===original.id),original,'Existing feature changed');
 const caseAfter=await get('/cases/'+prior.preparation.caseId);assert.equal(caseAfter.case.revision,caseBefore.case.revision);assert.equal(caseAfter.model.id,caseBefore.model.id);assert.deepEqual(caseAfter.sources,caseBefore.sources);pass('Reviewed unknown height, restored review on reload, explicitly recorded exact fictional contour; pre-existing features/model/original receipts unchanged');
 const item=await get('/spatial-ml/items/'+state.itemId);assert.equal(item.sourceSha256,state.attachments.building.sha256);assert(item.retainedFootprintCalibration);assert.deepEqual(item.retainedFootprintCalibration.worldPoints,state.draftInput.calibration.worldPoints);
 for(const attachment of Object.values(state.attachments)){const response=await page.request.get(base+'/api/v1/sources/'+attachment.sourceRevisionId+'/file');assert.equal(response.status(),200);assert.equal(hash(await response.body()),attachment.sha256);}pass('Source-only imagery, attribution and exact reviewed controls remain available after recording');
 const block=await get('/areas/'+state.areaId+'/register?format=json');assert.equal(block.features.find(f=>f.id===feature.id).identifier,feature.identifier);assert.deepEqual(block.features.find(f=>f.id===feature.id).geometry,feature.geometry);await writeFile(out+'/block-register.json',JSON.stringify(block,null,2));
 const unitUrl='/buildings/'+prior.building.id+'/register?record='+prior.recordedUnitId;
 const unit=await get(unitUrl+'&format=json');assert.equal(unit.selection.id,prior.recordedUnitId);assert.equal(unit.register.filter(r=>r.kind==='space').length,1);assert.equal(unit.register.find(r=>r.id===prior.recordedUnitId).geometry.area,prior.metrics.area);
 for(const [name,path] of [['unit',unitUrl],['roof','/buildings/'+feature.id+'/register?']]){
  const response=await page.request.get(base+'/api/v1'+path+'&format=zip',{timeout:90000});assert.equal(response.status(),200,path);const bytes=await response.body(),files=unzipSync(bytes);assert.equal(Buffer.from(files['register.pdf']).subarray(0,5).toString(),'%PDF-');const manifest=JSON.parse(strFromU8(files['sources.json']));assert(manifest.sources.length>0);for(const source of manifest.sources)assert.equal(hash(files[source.path]),source.sha256,source.name);await writeFile(out+'/'+name+'-register.zip',bytes);report[name+'Export']={sources:manifest.sources.length,sha256:hash(bytes)};
 }
 pass('Block JSON and selected roof/unit ZIP exports preserve canonical identity, exact geometry, 3D unit area, PDFs and byte-identical original sources');
 await page.goto(base+'/studio/work?q='+state.draftPackageId,{waitUntil:'networkidle'});await page.getByRole('link',{name:'Open map',exact:true}).waitFor();await page.screenshot({path:out+'/02-recorded-work-queue.png'});pass('Completed GIS work resumes at its recorded map from the queue');
 assert.deepEqual(report.errors,[]);report.result='PASS';report.recordedFeatureId=feature.id;report.recordedPackageId=pkg.id;
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e.stack);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();await writeFile(out+'/journey.json',JSON.stringify(report,null,2)+'\n');}
