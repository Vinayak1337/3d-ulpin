import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchBrowser} from '../spatial/browser-launch.mjs';
const base='http://127.0.0.1:3000',out='docs/evidence/t064',fixtures='.runtime/t064-fixtures/';
await mkdir(out,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1000}});
const report={checks:[],errors:[]},pass=s=>{report.checks.push(s);console.log('PASS '+s);};
page.on('pageerror',e=>report.errors.push(e.message));
async function open(){await page.goto(base+'/studio/datasets?import=1',{waitUntil:'networkidle'});await page.getByRole('dialog').waitFor();}
async function file(name){const response=page.waitForResponse(r=>r.url().endsWith('/import-packages/inspect')&&r.request().method()==='POST');await page.getByLabel('Original GIS file').setInputFiles(fixtures+name);return (await response).json();}
async function confirm(){await page.getByLabel('These boundaries represent').selectOption('building:unknown');await page.getByLabel('Source origin').selectOption('synthetic');}
try {
 await open();const dialog=page.getByRole('dialog');
 assert.equal(await dialog.getByRole('combobox').count(),0);assert.equal(await dialog.getByRole('button',{name:'Export data',exact:true}).count(),0);
 await page.screenshot({path:out+'/01-empty-intake.png'});pass('File-first intake shows no technical form before a source is selected');
 let metadata=await file('T064-fictional-projected.gpkg');assert.equal(metadata.sourceCrs,'EPSG:32643');assert.equal(metadata.featureCount,2);assert(metadata.suggestedIdField);assert(metadata.suggestedNameField);
 await confirm();assert(await page.getByRole('button',{name:'Continue to review'}).isEnabled());
 await page.screenshot({path:out+'/02-projected-intake.png'});pass('Projected GeoPackage metadata is detected; only meaning and origin need confirmation');
 const imported=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/import-packages'&&r.request().method()==='POST');await page.getByRole('button',{name:'Continue to review'}).click();const res=await imported,pkg=await res.json();assert.equal(res.status(),201,JSON.stringify(pkg));assert.equal(pkg.features.length,2);assert.notEqual(pkg.state,'COMMITTED');
 const original=await page.request.get(base+'/api/v1/sources/'+pkg.sourceRevisionIds[0]+'/file');assert(original.ok());assert.equal(createHash('sha256').update(await original.body()).digest('hex'),createHash('sha256').update(await readFile(fixtures+'T064-fictional-projected.gpkg')).digest('hex'));
 report.fixture={packageId:pkg.id,areaId:pkg.areaId,sourceRevisionId:pkg.sourceRevisionIds[0],state:pkg.state};await page.screenshot({path:out+'/03-review-draft.png'});pass('Continue creates a review draft through real ingestion and retains byte-identical original; no recording performed');
 await open();metadata=await file('T064-fictional-multiple-layers.gpkg');assert.equal(metadata.layers.length,2);assert.equal(metadata.layer,null);assert(await page.getByRole('button',{name:'Continue to review'}).isDisabled());
 const namespaces=[];for(const layer of metadata.layers){const response=page.waitForResponse(r=>r.url().endsWith('/import-packages/inspect'));await page.getByLabel('Source layer',{exact:true}).selectOption(layer);const selected=await(await response).json();assert.equal(selected.layer,layer);namespaces.push(selected.suggestedNamespace);}
 assert.notEqual(namespaces[0],namespaces[1]);await page.screenshot({path:out+'/04-multiple-layers.png'});pass('Multiple layers require explicit selection and get distinct stable identity namespaces');
 await file('T064-fictional-missing-crs.json');assert(await page.getByLabel('Source coordinate system').isVisible());assert.equal(await page.getByLabel('Source coordinate system').inputValue(),'');await confirm();assert(await page.getByRole('button',{name:'Continue to review'}).isDisabled());await page.getByLabel('Source coordinate system').fill('EPSG:32643');assert(await page.getByRole('button',{name:'Continue to review'}).isEnabled());pass('Missing ArcGIS CRS is requested without inventing coordinates');
 const ids={type:'FeatureCollection',features:[{type:'Feature',id:'T064-feature-id',properties:{name:'Fictional Feature ID'},geometry:{type:'Polygon',coordinates:[[[77,28],[77.0001,28],[77.0001,28.0001],[77,28.0001],[77,28]]]}}]};
 let response=page.waitForResponse(r=>r.url().endsWith('/import-packages/inspect'));await page.getByLabel('Original GIS file').setInputFiles({name:'T064-feature-ids.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(ids))});metadata=await(await response).json();assert(metadata.featureIdEligible);await confirm();assert(await page.getByRole('button',{name:'Continue to review'}).isEnabled());pass('Complete retained GeoJSON Feature IDs require no redundant ID-column entry');
 response=page.waitForResponse(r=>r.url().endsWith('/import-packages/inspect'));await page.getByLabel('Original GIS file').setInputFiles({name:'T064-malformed.geojson',mimeType:'application/geo+json',buffer:Buffer.from('{broken')});assert.equal((await response).status(),422);await dialog.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'Continue to review'}).isDisabled());pass('Malformed input shows an actionable error and cannot continue');
 await file('T064-fictional-projected.json');await confirm();await page.getByText('Detected details and advanced settings',{exact:true}).click();assert(await page.getByLabel('Dataset namespace').isVisible());pass('Inspection can recover with a replacement file; detailed overrides remain accessible');
 await page.getByText('Detected details and advanced settings',{exact:true}).click();await page.setViewportSize({width:843,height:941});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/05-tablet-intake.png'});pass('Intake fits tablet width');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e.stack);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
