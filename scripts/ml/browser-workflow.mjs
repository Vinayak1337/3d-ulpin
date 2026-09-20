import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchBrowser} from '../spatial/browser-launch.mjs';

const dir=process.env.ML_VERIFY_DIR||'docs/evidence/t061/workflow';
const recorded=process.argv.includes('--recorded');
const out=process.env.ML_BROWSER_DIR||(recorded?'docs/evidence/t061/recorded-register':'docs/evidence/t061/browser');
const state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
assert.equal(state.stage,recorded?'recorded':'extracted-unreviewed','Use the browser phase matching the retained workflow checkpoint.');
const base=state.base,sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),scope:'Actual local retained results; no mocked API or additional writes.',checks:[],errors:[],badResponses:[],blockedWrites:[]};
const pass=(name,detail={})=>{report.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
const browser=await launchBrowser();let page;
try{
 const context=await browser.newContext({viewport:{width:1672,height:1000}});
 const get=async path=>{const r=await context.request.get(base+'/api/v1'+path);assert.equal(r.status(),200,path);return r.json();};
 const batch=await get(`/spatial-ml/batches/${state.batchId}`),pkg=await get(`/import-packages/${state.preparation.packageId}`);
 if(!recorded)assert(state.factIds.every(id=>!pkg.selectedClaimIds?.includes(id)));
 page=await context.newPage();page.setDefaultTimeout(45000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.url().startsWith(base+'/api/')&&r.status()>=400)report.badResponses.push({path:new URL(r.url()).pathname,status:r.status()});});
 await page.route('**/api/v1/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){report.blockedWrites.push({method:route.request().method(),path:new URL(route.request().url()).pathname});return route.abort();}return route.continue();});
 if(recorded){
  const dossier=await get(`/buildings/${state.building.id}/dossier`),unit=dossier.records.find(r=>r.id===state.recordedUnitId);
  assert(unit&&unit.synthetic);assert.equal(unit.geometry.volume,state.metrics.volume);
  const url=`${base}/studio/properties/${state.building.id}/register?area=${state.areaId}&tab=floors&record=${unit.id}`;
  report.url=url;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
  const row=page.getByRole('row').filter({hasText:unit.identifier});await row.waitFor();
  await page.waitForFunction(id=>document.querySelector('tr[data-selected="true"]')?.textContent?.includes(id),unit.identifier);
  const scene=page.locator('.property-scene:not(.property-scene--compact)');
  await scene.locator('[data-scene-ready="true"]').waitFor({timeout:120000});
  const canvas=scene.locator('canvas').first();await canvas.waitFor();
  const size=await canvas.evaluate(el=>({width:el.width,height:el.height}));assert(size.width>100&&size.height>100);
  assert.equal(await scene.getByRole('button',{name:'Floors & spaces',exact:true}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:join(out,'recorded-unit-register.png')});
  await scene.screenshot({path:join(out,'recorded-3d-contour.png')});
  pass('Canonical recorded test unit appears selected in a ready 3D register',{unitId:unit.id,identifier:unit.identifier,syntheticMetrics:state.metrics,canvas:size});
  await page.reload({waitUntil:'domcontentloaded'});await row.waitFor();
  await page.waitForFunction(id=>document.querySelector('tr[data-selected="true"]')?.textContent?.includes(id),unit.identifier);
  assert.equal(new URL(page.url()).searchParams.get('record'),unit.id);
  assert.deepEqual(await get(`/buildings/${state.building.id}/dossier`),dossier);
  pass('Reload retains the exact recorded unit and leaves its dossier unchanged',{apiWrites:0});
 }else{
 await page.goto(state.workspaceUrl,{waitUntil:'domcontentloaded',timeout:120000});
 const open=async()=>{await page.getByRole('tab',{name:'Build details',exact:true}).click();await page.getByRole('button',{name:'Extract plans or imagery',exact:true}).click();await page.getByRole('dialog',{name:'Spatial extraction',exact:true}).waitFor();};
 await open();
 const dialog=page.getByRole('dialog',{name:'Spatial extraction',exact:true});
 await dialog.locator('.ml-attempts article').first().waitFor();
 assert.equal(await dialog.locator('.ml-attempts article').count(),batch.items.length);
 const failed=dialog.locator('.ml-attempts article').filter({hasText:'Page 2 · Floor plan'});
 assert((await failed.innerText()).includes('failed'));assert.equal(await failed.getByRole('button',{name:'Retry',exact:true}).count(),1);
 await failed.getByRole('button').first().click();
 await dialog.getByText('Choose a PNG/JPEG original or a PDF page; an image has only page 1.',{exact:true}).waitFor();
 await dialog.getByText('Choose a PNG/JPEG original or a PDF page; an image has only page 1.',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:join(out,'partial-failure.png')});
 pass('Retained batch shows separate success and unsupported-page failure with retry affordance');
 const empty=dialog.locator('.ml-attempts article').filter({hasText:state.attachments.emptyBuilding.filename});
 await empty.getByRole('button').first().click();
 await dialog.getByText("No regions passed the model's output rules. This is not evidence that the source has no rooms or buildings.",{exact:true}).waitFor();
 await dialog.getByText("No regions passed the model's output rules. This is not evidence that the source has no rooms or buildings.",{exact:true}).scrollIntoViewIfNeeded();
 assert.equal(await dialog.locator('path.ml-region').count(),0);
 await page.screenshot({path:join(out,'retained-empty-output.png')});
 pass('Actual empty result remains visible with its limits and no invented regions');

 for(const [id,key] of [[state.floorItemId,'floor'],[state.buildingItemId,'building']]){
  const item=batch.items.find(i=>i.id===id),filename=state.attachments[key].filename;
  const attempt=dialog.locator('.ml-attempts article').filter({hasText:filename}).filter({hasText:`Page 1 · ${key==='floor'?'Floor plan':'Buildings'}`});
  assert.equal(await attempt.count(),1);await attempt.getByRole('button').first().click();
  const raster=dialog.getByLabel('Retained inference raster and suggested regions',{exact:true});await raster.waitFor();
  assert.equal(await raster.locator('image').getAttribute('href'),item.result.raster.url);
  assert.equal(await raster.getAttribute('viewBox'),`0 0 ${item.result.raster.width} ${item.result.raster.height}`);
  assert.equal(await raster.locator('path.ml-region').count(),item.result.components.length);
  const asset=await context.request.get(base+item.result.raster.url);assert.equal(asset.status(),200);assert.equal(sha(await asset.body()),item.result.raster.sha256);
  await dialog.getByText('Inference receipt and exact inputs',{exact:true}).click();
  const receipt=JSON.parse(await dialog.locator('.ml-raster-column details pre').textContent());
  assert.equal(receipt.sourceRevisionId,item.sourceRevisionId);assert.equal(receipt.sourceSha256,item.sourceSha256);assert.equal(receipt.rasterSha256,item.result.raster.sha256);assert.equal(receipt.model.sha256,item.modelSha256);
  await dialog.getByLabel('Show regions',{exact:true}).uncheck();assert.equal(await raster.locator('path.ml-region').count(),0);
  await dialog.getByLabel('Show regions',{exact:true}).check();assert.equal(await raster.locator('path.ml-region').count(),item.result.components.length);
  if(key==='floor'){
   const index=item.result.components.findIndex(c=>c.id===state.component.id);
   await dialog.locator('.ml-component').nth(index).getByRole('checkbox').check();
   await dialog.getByRole('textbox',{name:`Name for region ${index+1}`,exact:true}).fill('ML-ROOM-01');
   assert.equal(await dialog.getByRole('spinbutton',{name:'Control 2 pixel x',exact:true}).inputValue(),String(item.result.raster.width));
   assert.equal(await dialog.getByRole('textbox',{name:'Named metre frame',exact:true}).inputValue(),state.preparation.placement.targetFrame);
   assert.equal(await dialog.getByRole('button',{name:'Send 1 to fact review',exact:true}).isEnabled(),true);
   await dialog.getByText('1 retained application. Review the added facts in Build details.',{exact:true}).waitFor();
  }
  await raster.scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${key}-retained-result.png`)});
  pass(`${key} result displays exact retained raster, pixel contours, receipt and overlay controls`,{itemId:id,regions:item.result.components.length});
 }
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 // The workspace intentionally moves Build details into its compact Controls
 // dialog; enter that real mobile path instead of expecting the desktop panel
 // instance to survive its responsive unmount.
 await page.getByRole('button',{name:'Controls',exact:true}).click();
 await page.getByRole('dialog',{name:'Build details',exact:true}).getByRole('button',{name:'Extract plans or imagery',exact:true}).click();
 await dialog.waitFor();
 await dialog.locator('.ml-attempts article').filter({hasText:state.attachments.building.filename}).getByRole('button').first().click();
 await dialog.getByLabel('Retained inference raster and suggested regions',{exact:true}).scrollIntoViewIfNeeded();
 const layout=await dialog.evaluate(el=>{const body=el.querySelector('.ui-dialog-body');return {width:el.getBoundingClientRect().width,viewport:innerWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,bodyScrollWidth:body.scrollWidth,bodyClientWidth:body.clientWidth};});
 assert(layout.width<=layout.viewport+1,JSON.stringify(layout));assert(layout.scrollWidth<=layout.clientWidth+2,JSON.stringify(layout));
 assert(layout.bodyScrollWidth<=layout.bodyClientWidth+2,JSON.stringify(layout));
 await page.screenshot({path:join(out,'mobile-extraction.png')});pass('Retained result review fits a narrow viewport',{layout});
 await page.setViewportSize({width:1672,height:1000});
 await page.reload({waitUntil:'domcontentloaded'});await open();
 await dialog.locator('.ml-attempts article').first().waitFor();
 assert.equal(await dialog.locator('.ml-attempts article').count(),batch.items.length);
 await dialog.locator('.ml-attempts article').filter({hasText:state.attachments.floor.filename}).filter({hasText:'Page 1 · Floor plan'}).getByRole('button').first().click();
 await dialog.getByText('1 retained application. Review the added facts in Build details.',{exact:true}).waitFor();
 const after=await get(`/import-packages/${state.preparation.packageId}`);assert.deepEqual(after,pkg);
 pass('Reload preserves retained inference/application and leaves generated facts unreviewed',{apiWrites:0});
 }
 assert.equal(report.blockedWrites.length,0);assert.equal(report.errors.length,0);assert.equal(report.badResponses.length,0);
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack||String(error);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{report.completedAt=new Date().toISOString();await writeFile(join(out,'results.json'),JSON.stringify(report,null,2));await browser.close();}
