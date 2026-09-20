import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser-launch.mjs';

const base=process.env.STUDIO_BASE_URL||'http://127.0.0.1:3000';
const out=process.env.STUDIO_SAVED_DIR||'docs/evidence/t060/saved';
await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),base,scope:'Existing local saved datasets; read-only UI/API verification; no mocked resolver or invented identities.',checks:[],errors:[],badResponses:[],blockedWrites:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprint=value=>sha(JSON.stringify(value));
const pass=(name,detail={})=>{report.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
const browser=await launchBrowser();let page;
try{
 const browserContext=await browser.newContext({viewport:{width:1672,height:941},acceptDownloads:true});
 const get=async path=>{const response=await browserContext.request.get(base+'/api/v1'+path,{timeout:60000});assert.equal(response.status(),200,path);return response.json();};
 console.log('Reading saved dataset identities');
 const areas=await get('/areas');
 const candidates=areas.filter(area=>area.dataKind==='demonstration'&&area.featureCount>0);
 const area=candidates.find(area=>/Lake View/i.test(area.name))??candidates.find(area=>/Uttam/i.test(area.name));
 assert(area,'An existing Lake View or fictional Uttam dataset is required; this verifier never seeds it.');
 const context=await get(`/areas/${area.id}/context`);
 const buildings=context.features.filter(feature=>feature.kind==='building');assert(buildings.length);
 let building,dossier;
 for(const candidate of buildings.slice(0,8)){
  const next=await get(`/buildings/${candidate.id}/dossier`);
  if(next.sources.length&&next.records.some(record=>record.kind==='space')){building=candidate;dossier=next;break;}
 }
 assert(building&&dossier,'The saved demonstration needs retained sources and unit records to qualify this journey.');
 assert.equal(dossier.canonicalBuildingId,building.id);
 const unit=dossier.records.find(record=>record.kind==='space');
 const floor=dossier.records.find(record=>record.id===unit.links.find(link=>link.type==='floor')?.targetId);
 assert(floor,'The verification unit must have a retained floor link.');
 const source=dossier.sources.find(source=>/\.pdf$/i.test(source.name))??dossier.sources[0];
 const originalResponse=await browserContext.request.get(base+`/api/v1/sources/${source.id}/file`);assert.equal(originalResponse.status(),200);
 const original=await originalResponse.body();assert.equal(sha(original),source.sha256);
 const before={context:fingerprint(context),dossier:fingerprint(dossier),source:sha(original)};
 report.selection={areaId:area.id,areaName:area.name,buildingId:building.id,identifier:building.identifier,unitId:unit.id,sourceId:source.id,sourceSha256:source.sha256};
 page=await browserContext.newPage();page.setDefaultTimeout(45000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('response',response=>{if(response.url().startsWith(base+'/api/')&&response.status()>=400)report.badResponses.push({path:new URL(response.url()).pathname,status:response.status()});});
 await page.route('**/api/v1/**',route=>{const request=route.request();if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.blockedWrites.push({method:request.method(),path:new URL(request.url()).pathname});return route.abort();}return route.continue();});
 await page.goto(base+'/studio/datasets',{waitUntil:'domcontentloaded',timeout:120000});
 await page.locator('[data-product-header]').waitFor();
 await page.getByRole('button',{name:'Choose dataset',exact:true}).click();
 const chosen=page.locator('.city-dataset-menu').getByRole('link').filter({hasText:area.name});
 await chosen.waitFor();assert.equal(await chosen.count(),1);await chosen.click();
 await page.waitForURL(url=>url.pathname===`/studio/areas/${area.id}`);
 await page.getByRole('heading',{name:area.name,exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,`/studio/areas/${area.id}`);
 await page.getByRole('button',{name:'2D Map',exact:true}).click();
 await page.locator('.ui-plan-svg').waitFor();
 await page.screenshot({path:out+'/saved-dataset-map.png'});
 pass('Dataset chooser opens an actual saved demonstration with its own identity',{areaId:area.id,features:context.features.length});

 const resolved=await get('/resolve?identifier='+encodeURIComponent(building.identifier));
 assert(resolved.matches.some(match=>match.feature?.id===building.id||match.canonicalBuildingId===building.id||match.buildingId===building.id||match.relatedBuildings?.some(item=>(item.feature?.id??item.id)===building.id)),'The actual resolver must return the saved canonical building.');
 await page.getByRole('combobox',{name:'Search ULPIN, property or owner'}).fill(building.identifier);
 const results=page.getByRole('listbox',{name:'Matching properties'});
 const result=results.getByRole('option').filter({hasText:building.identifier}).filter({hasText:'Saved record'});
 await result.waitFor();assert.equal(await result.count(),1);await result.click();
 await page.waitForURL(url=>url.pathname===`/studio/areas/${area.id}`&&url.searchParams.get('feature')===building.id);
 const inspector=page.getByRole('complementary',{name:'Context inspector'});
 await inspector.getByRole('heading',{name:building.name,exact:true}).waitFor();
 assert((await inspector.innerText()).includes(building.identifier));
 await inspector.getByRole('button',{name:'Inspect floors & units',exact:true}).click();
 await inspector.locator(`[data-quick-register="${building.id}"]`).waitFor();
 const unitFloor=inspector.locator('.quick-floor').filter({has:page.getByText(floor.name,{exact:true})});
 await unitFloor.getByRole('button').filter({has:page.getByText(unit.name,{exact:true})}).click();
 await page.waitForURL(url=>url.searchParams.get('record')===unit.id);
 await inspector.locator('.quick-unit-card').waitFor();
 assert.equal(await inspector.locator('.quick-unit-card code').textContent(),unit.identifier);
 assert.equal(new URL(page.url()).searchParams.get('record'),unit.id);
 await page.screenshot({path:out+'/saved-quick-unit.png'});
 pass('Real saved search and quick unit selection retain building, block and record identity',{buildingId:building.id,unitId:unit.id});

 await page.getByRole('button',{name:'Export',exact:true}).click();
 const exportDialog=page.getByRole('dialog',{name:'Data tools'});
 await exportDialog.getByLabel('Export scope',{exact:true}).selectOption(building.id);
 await exportDialog.getByRole('button',{name:/^SVG/}).click();
 assert.equal(await exportDialog.locator('.export-preview-paper dl div').filter({has:page.getByText('Spatial features',{exact:true})}).locator('dd').textContent(),'1');
 const downloaded=page.waitForEvent('download');await exportDialog.getByRole('button',{name:'Download export',exact:true}).click();
 const download=await downloaded,path=out+'/'+download.suggestedFilename();assert(path.endsWith('.svg'));await download.saveAs(path);
 const svg=await readFile(path,'utf8');
 const inspected=await page.evaluate(raw=>{const document=new DOMParser().parseFromString(raw,'image/svg+xml');return {errors:document.querySelectorAll('parsererror').length,ids:[...document.querySelectorAll('[data-feature-id]')].map(node=>node.getAttribute('data-feature-id')),receipt:JSON.parse(document.querySelector('metadata')?.textContent??'null')};},svg);
 assert.equal(inspected.errors,0);assert.deepEqual(inspected.ids,[building.id]);
 assert.equal(inspected.receipt.preview.features,1);assert.equal(inspected.receipt.scope.id,building.id);
 assert.deepEqual(inspected.receipt.features,[building]);
 assert.deepEqual(inspected.receipt.sources,[{id:building.sourceRevisionId,url:`/api/v1/sources/${building.sourceRevisionId}/file`}]);
 await page.screenshot({path:out+'/selected-svg-export.png'});
 await exportDialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 pass('Selected SVG contains one feature and byte-preserving source/geometry receipts',{featureId:building.id,sourceRevisionId:building.sourceRevisionId,sha256:sha(svg)});

 const registerLink=inspector.getByRole('link',{name:'Full register',exact:true});
 const registerUrl=new URL(await registerLink.getAttribute('href'),base);
 assert.equal(registerUrl.pathname,`/studio/properties/${building.id}/register`);assert.equal(registerUrl.searchParams.get('area'),area.id);assert.equal(registerUrl.searchParams.get('record'),unit.id);
 await registerLink.click();await page.getByRole('heading',{name:building.name,exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('record'),unit.id);
 const tabs=page.getByRole('navigation',{name:'Property register sections'});
 await tabs.getByRole('button',{name:/^Evidence/}).click();
 await page.getByRole('heading',{name:'Evidence & documents',exact:true}).waitFor();
 await page.getByRole('button').filter({has:page.getByText(source.name,{exact:true})}).click();
 const originalLink=page.getByRole('link',{name:'Open original ↗',exact:true});
 await originalLink.waitFor();assert.equal(await originalLink.getAttribute('href'),`/api/v1/sources/${source.id}/file`);
 await page.getByText(source.sha256,{exact:true}).waitFor();
 if(/\.(pdf|png|jpe?g|webp)$/i.test(source.name)){
  const preview=page.locator(`[data-original-id="${source.id}"] .original-page img`);
  await preview.waitFor();assert(await preview.evaluate(image=>image.complete&&image.naturalWidth>0),'The retained original must finish rendering before evidence capture.');
 }
 await page.screenshot({path:out+'/saved-register-evidence.png'});
 await tabs.getByRole('button',{name:'History',exact:true}).click();
 await page.getByRole('heading',{name:'Property history',exact:true}).waitFor();
 const revisions=await get(`/physical-features/${building.id}/revisions`);
 if(revisions.revisions.length){await page.getByRole('region',{name:'Physical revision comparison'}).waitFor();assert.equal(await page.getByLabel('After physical revision').locator('option').count(),revisions.revisions.length);}
 else await page.getByRole('heading',{name:'No retained physical revisions',exact:true}).waitFor();
 await page.screenshot({path:out+'/saved-register-history.png'});
 await tabs.getByRole('button',{name:'Investigation',exact:true}).click();
 await page.getByRole('heading',{name:'Investigation',exact:true}).waitFor();
 await page.screenshot({path:out+'/saved-register-investigation.png'});
 pass('Complete saved register exposes retained Evidence, History and Investigation',{sources:dossier.sources.length,retainedRevisions:revisions.revisions.length,investigations:dossier.investigations.length});

 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Saved register overflows the narrow viewport.');
 await page.screenshot({path:out+'/saved-register-mobile.png'});
 await page.getByRole('button',{name:'Main navigation',exact:true}).click();
 await page.getByRole('navigation',{name:'Product sections'}).getByRole('link',{name:'Plan Workspace',exact:true}).click();
 await page.getByRole('heading',{name:'Plan Workspace',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Saved workspaces',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/studio/workspaces');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Workspace directory overflows the narrow viewport.');
 await page.screenshot({path:out+'/saved-workspace-directory-mobile.png'});
 pass('Narrow register and workspace directory retain navigation without page overflow',{width:390,height:844,physicalDevice:false});

 const afterContext=await get(`/areas/${area.id}/context`),afterDossier=await get(`/buildings/${building.id}/dossier`);
 assert.equal(fingerprint(afterContext),before.context);assert.equal(fingerprint(afterDossier),before.dossier);
 const afterOriginal=await browserContext.request.get(base+`/api/v1/sources/${source.id}/file`);assert.equal(afterOriginal.status(),200);assert.equal(sha(await afterOriginal.body()),before.source);
 assert.deepEqual(report.blockedWrites,[]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);
 pass('Saved context, dossier, source bytes and revision metadata are unchanged',{before,after:before});
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack||String(error);console.error(report.error);if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();report.finishedAt=new Date().toISOString();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
