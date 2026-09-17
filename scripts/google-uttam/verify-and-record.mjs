/** Actual application and browser acceptance. No response mocks or UI overlays. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(process.argv[2]||'../uttam-nagar-import-20260917/evidence/google');
const base='http://127.0.0.1:3000';
const state=JSON.parse(await readFile(resolve(root,'.runtime/google-uttam/installed.json'),'utf8'));
const selection=JSON.parse(await readFile(resolve(root,'fixtures/google-uttam/selection-report.json'),'utf8'));
const {chromium,expect}=createRequire(resolve(root,'package.json'))('@playwright/test');
await mkdir(out,{recursive:true});await mkdir(resolve(out,'screenshots'),{recursive:true});await mkdir(resolve(out,'video'),{recursive:true});
const report={startedAt:new Date().toISOString(),result:'RUNNING',assertions:[],chapters:[],pageErrors:[],httpErrors:[],requestFailures:[]};
const pass=text=>{report.assertions.push(text);console.log('PASS',text);};
async function api(path,body){const r=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});assert.equal(r.ok,true,`${path}: HTTP ${r.status}`);return r.json();}
const browser=await chromium.launch({headless:false,args:['--window-size=1640,1040','--window-position=60,40']});
const context=await browser.newContext({viewport:{width:1600,height:900},acceptDownloads:true,recordVideo:{dir:resolve(out,'video'),size:{width:1600,height:900}}});
await context.tracing.start({screenshots:true,snapshots:true,sources:false});
const page=await context.newPage();page.setDefaultTimeout(45000);
const videoStart=Date.now();
page.on('pageerror',e=>report.pageErrors.push(e.message));
page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
async function capture(name,description,hold=3500){await page.waitForTimeout(1500);await page.screenshot({path:resolve(out,'screenshots',name+'.png')});report.chapters.push({name,description,at:new Date().toISOString(),seconds:(Date.now()-videoStart)/1000,url:page.url()});console.log('SCENE',name);await page.waitForTimeout(hold);}
try{
 report.health=await api('/health');assert.equal(report.health.ok,true);assert.equal(report.health.dataMode,'repository');
 const real=await api(`/areas/${state.realAreaId}/context`),demo=await api(`/areas/${state.demoAreaId}/context`);
 assert.equal(real.features.length,50);assert.equal(demo.features.length,51);
 assert(real.features.every(f=>f.worldStatus==='observed'));assert(demo.features.every(f=>f.worldStatus==='synthetic'));
 assert(real.features.filter(f=>f.kind==='building').every(f=>f.height.value===null));
 const input=JSON.parse(await readFile(resolve(root,'fixtures/google-uttam/01-google-building-footprints.geojson'),'utf8'));
 for(const f of input.features){const imported=real.features.find(r=>r.sourceKey===f.properties.source_id);assert(imported);assert.deepEqual(imported.sourceGeometry,f.geometry);assert.equal(imported.properties.confidence,f.properties.confidence);}
 pass('15 original Google V3 geometries and confidence values are preserved; real heights remain unknown; 35 OSM road segments are present');
 report.real={areaId:state.realAreaId,features:50,buildings:15,roads:35,unknownHeights:true};
 report.demo={areaId:state.demoAreaId,features:51,buildings:15,roads:36,fictional:true};
 const originals=new Map();let floors=0,spaces=0,parties=0;report.buildings=[];
 for(const [buildingId,entry]of Object.entries(state.buildings)){
  const d=await api(`/buildings/${buildingId}/dossier`);const records=d.records.filter(r=>r.kind==='space');
  const fc=d.records.filter(r=>r.kind==='floor').length;assert.equal(fc,({A:3,B:4,C:2})[entry.key]);assert.equal(records.length,fc*3);
  for(const r of records){assert(r.synthetic);assert.equal(r.rights.length,1);assert(r.rights[0].party.startsWith('DEMO '));assert.equal(r.rights[0].type,'shared_use');assert(d.sources.some(s=>s.id===r.rights[0].evidence.sourceId),'Party source must remain available in this dossier');}
  floors+=fc;spaces+=records.length;parties+=records.filter(r=>!r.rights[0].party.startsWith('DEMO residents')).length;
  report.buildings.push({key:entry.key,id:buildingId,name:d.building.name,floors:fc,spaces:records.length,sources:d.sources.length,example:records[0],register:base+`/properties/${buildingId}/register`});
  for(const s of d.sources)originals.set(s.id,s);
 }
 assert.equal(floors,9);assert.equal(spaces,27);assert.equal(parties,18);report.demo={...report.demo,floors,spaces,fictionalIndividuals:parties,sharedAccessGroups:9};
 pass('Three Google-derived fictional buildings contain 9 floors, 27 recorded spaces and 18 fictional individual occupants plus 9 shared-access groups');
 for(const source of originals.values()){const r=await fetch(new URL(source.url,base));assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);}
 report.originalsVerified=originals.size;pass(`${originals.size} distinct dossier source files served over HTTP with matching SHA-256`);
 const a=report.buildings.find(b=>b.key==='A');
 await page.goto(base+'/blocks');await expect(page.getByRole('heading',{name:'Google Uttam Nagar | public footprints and roads',exact:true})).toBeVisible();
 await capture('01-directory','Separate public Google reference and fictional 3D registry; Lake View retained');
 await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Google Uttam Nagar | public footprints and roads',exact:true})}).click();
 await page.getByRole('button',{name:'2D Map',exact:true}).click();await page.getByRole('button',{name:'Fit block',exact:true}).click();
 await capture('02-public-google-footprints','Actual Google V3 building predictions and OSM centreline geometry; no invented source heights');
 await page.goto(base+`/blocks/${state.demoAreaId}`);
 await expect(page.locator('.area-cesium-host')).toHaveAttribute('data-scene-ready','true',{timeout:60000});
 await page.getByRole('button',{name:'3D',exact:true}).click();await page.getByRole('button',{name:'Fit block',exact:true}).click();
 await expect(page.locator('.area-source-credit').getByRole('link',{name:'Google Open Buildings V3',exact:true})).toBeVisible();
 await capture('03-fictional-3d-block','Same geographic reference with explicitly invented heights and 6 m road-width assumptions',5000);
 await page.locator('.ui-property-list').getByRole('button',{name:/DEMO UN-A/}).click();
 await capture('04-building-a','Select the Google-derived fictional building with 3 floors and 9 recorded spaces');
 const checkResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/area-checks')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Run check',exact:true}).click();assert((await checkResponse).ok());
 await expect(page.getByRole('region',{name:'Block findings'})).toBeVisible();
 const checked=await api(`/areas/${state.demoAreaId}/context`);assert.equal(checked.latestCheck.status,'completed');assert.equal(checked.latestCheck.stale,false);
 const crossing=checked.features.find(f=>f.sourceKey==='DEMO-UN-CROSSING');
 const finding=checked.latestCheck.findings.find(f=>f.code==='BUILDING_ROAD_OVERLAP'&&f.featureIds.includes(a.id)&&f.featureIds.includes(crossing.id));
 assert(finding,'Computed scenario crossing missing');assert(Math.abs(finding.areaM2-selection.syntheticCrossingExpectedM2)<.002,'App measurement must match independent projected-geometry calculation');
 const allIds=new Set(checked.features.map(f=>f.id));assert(checked.latestCheck.findings.every(f=>f.featureIds.every(id=>allIds.has(id))),'Unrelated overlapping scenarios must not contaminate this check');
 report.computedCheck={id:checked.latestCheck.id,createdAt:checked.latestCheck.createdAt,findings:checked.latestCheck.findings.length,expectedCrossingM2:selection.syntheticCrossingExpectedM2,actualCrossing: finding};
 await writeFile(resolve(out,'computed-check.json'),JSON.stringify(checked.latestCheck,null,2));
 pass(`Fresh computed synthetic road overlap ${finding.areaM2.toFixed(3)} m2 matches independent ${selection.syntheticCrossingExpectedM2.toFixed(3)} m2 calculation`);
 await page.getByRole('button',{name:/^Show conflicts/}).click();
 const formatted=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(finding.areaM2);
 await page.locator('.ui-finding').filter({hasText:'Building road overlap'}).filter({hasText:formatted}).first().click();
 await expect(page.getByText('Exact check geometry highlighted',{exact:true})).toBeVisible();
 await capture('05-real-computation-fictional-road','Actual computed intersection from invented test corridor, not a real encroachment claim',6500);
 await page.getByRole('button',{name:'Clear selected finding',exact:true}).click();await page.getByRole('button',{name:'Close findings',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download property PDF',exact:true}).click();await(await downloadPromise).saveAs(resolve(out,'Google-UN-A-fictional-register.pdf'));
 await page.getByRole('link',{name:'Open register',exact:true}).click();await expect(page.locator('[data-register-building]')).toHaveAttribute('data-register-building',a.id);
 await page.getByRole('navigation',{name:'Property register sections'}).getByRole('button',{name:'Floors & Units',exact:true}).click();
 await expect(page.locator('tbody tr')).toHaveCount(9);await expect(page.locator('tbody')).toContainText('DEMO Resident');
 await expect(page.locator('.property-scene .area-cesium-host')).toHaveAttribute('data-scene-ready','true');
 await capture('06-room-registry-with-fictional-occupants','Nine actual stored space records in building A, with clearly fictional occupants and shared use',6000);
 await page.getByRole('button',{name:'Rotate view right',exact:true}).click();await page.waitForTimeout(1500);
 const search=page.getByRole('textbox',{name:'Search units',exact:true});await search.fill('Resident A01');await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.locator('tbody tr').first().getByRole('button').click();await expect(page).toHaveURL(/record=/);
 const partySection=page.getByRole('region',{name:'Recorded parties and source evidence'});await partySection.scrollIntoViewIfNeeded();await expect(partySection).toContainText('fictional');
 await capture('07-selected-fictional-person','Search finds the stored fictional occupant and the corresponding actual room record',6000);
 await partySection.getByRole('button',{name:'View party source evidence',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('FICTIONAL ROOM AND OCCUPANT REGISTER');
 await capture('08-occupancy-source','The retained original explicitly says every occupant and allocation is invented',5000);
 await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'Property register sections'}).getByRole('button',{name:/^Evidence/}).click();
 await page.getByRole('button',{name:/UN-A-SYNTHETIC-plan\.png/}).click();await expect(page.getByRole('img',{name:'Original evidence: UN-A-SYNTHETIC-plan.png',exact:true})).toBeVisible();
 await capture('09-authored-plan','Authored interior source plan, explicitly labelled fictional and not surveyed',5000);
 await page.getByRole('link',{name:'Open Workspace',exact:true}).click();await page.getByRole('tab',{name:'Build details',exact:true}).click();await page.getByRole('button',{name:'3D draft',exact:true}).click();
 await capture('10-computed-draft','Stored worker-computed nine-space draft remains connected to its source files',5000);
 await page.goto(base+`/blocks/${state.demoAreaId}?feature=${a.id}`);await page.reload();await expect(page.locator('.area-cesium-host')).toHaveAttribute('data-scene-ready','true');
 await capture('11-persistence','Reload retains the new Google-derived fictional scenario and selected property');
 const lake=await api('/areas/0ded05d3-b596-46a8-9918-ab1bc0a433be/context');assert.equal(lake.features.length,22);const bronx=await api('/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d/context');assert.equal(bronx.features.length,62);
 pass('Lake View and Bronx remain present; the new Google areas survive reload');
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.httpErrors,[]);report.result='PASS';
}catch(error){report.error=String(error);report.result='FAIL';process.exitCode=1;console.error(error);await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'failure-text.txt'),await page.locator('body').innerText().catch(()=>''));}
finally{
 report.finishedAt=new Date().toISOString();await context.tracing.stop({path:resolve(out,'browser-trace.zip')});const video=page.video();await context.close();report.video=await video.path();await browser.close();await writeFile(resolve(out,'verification.json'),JSON.stringify(report,null,2));console.log('BROWSER ACCEPTANCE',report.result,out);
}
