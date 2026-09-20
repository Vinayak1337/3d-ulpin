import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const base=process.env.EXPLAINER_URL || 'http://127.0.0.1:3000';
const browser=await chromium.launch({headless:true,channel:'chromium'});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[],writes=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});
const nav=()=>page.getByRole('navigation',{name:'Walkthrough stages'});
const section=()=>page.getByRole('navigation',{name:'Presentation sections'});
const stage=async name=>nav().getByRole('button',{name:new RegExp(name)}).click();
const view=async name=>section().getByRole('button',{name:new RegExp(name)}).click();
try {
 await page.goto(base+'/explain',{waitUntil:'networkidle'});
 assert.match(await page.title(),/Inside 3D ULPIN/);
 await stage('Extract');
 assert.equal(await page.locator('[data-testid="prediction-overlay"] path').count(),75);
 await page.getByLabel('Show regions').uncheck();
 assert.equal(await page.locator('[data-testid="prediction-overlay"]').count(),0);
 await page.getByLabel('Show regions').check();
 await page.getByRole('button',{name:'Aerial image',exact:true}).click();
 assert.equal(await page.locator('[data-testid="prediction-overlay"] path').count(),8);
 await page.getByRole('button',{name:'Floor plan',exact:true}).click();
 assert.equal(await page.locator('[data-testid="prediction-overlay"] path').count(),75);
 await page.screenshot({path:'outputs/ml-explainer/extraction-desktop.png',fullPage:true});
 checks.push('Actual 75/8 region counts, both source selections, overlay on/off');
 await stage('Calibrate');
 assert.equal(await page.getByText('768 px → 40 m',{exact:true}).count(),1);
 assert.equal(await page.locator('svg[aria-label="Floor plan with predicted regions"] circle').count(),2);
 checks.push('Retained synthetic calibration: 768 px / 40 m and two control markers');
 await stage('Build');
 const top=page.locator('svg[aria-label^="Schematic"] polygon').last();
 const before=await top.getAttribute('points');
 await page.getByRole('button',{name:'Rotate view'}).click();
 assert.notEqual(await top.getAttribute('points'),before);
 await page.getByRole('button',{name:'2D footprint',exact:true}).click();
 assert.equal(await page.locator('svg[aria-label^="Schematic"] polygon').count(),2);
 await page.getByRole('button',{name:'3D volume',exact:true}).click();
 assert.ok(await page.locator('svg[aria-label^="Schematic"] polygon').count()>200);
 await page.screenshot({path:'outputs/ml-explainer/build-desktop.png',fullPage:true});
 checks.push('Rotation changes projection; 2D/3D toggles retain evidence geometry');
 await stage('Record');
 assert.equal(await page.getByText('HISTORICAL VERIFICATION RECORD',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Explore architecture',exact:true}).click();
 for(const name of ['Studio Next.js','Application API','Record store','Job dispatcher','Originals & artifacts','Private job service','ML & geometry worker']){
  const node=page.getByRole('button',{name:new RegExp(name)});
  await node.click();assert.equal(await node.getAttribute('aria-pressed'),'true');
 }
 await page.screenshot({path:'outputs/ml-explainer/architecture-desktop.png',fullPage:true});
 checks.push('Historical record view; all seven architecture nodes and details');
 await view('The evidence');
 for(const path of ['evaluation.md','workflow-evidence.md','floor-plan.png','building.png']){
  assert.equal((await page.request.get(base+'/explainer/'+path)).status(),200);
 }
 await page.screenshot({path:'outputs/ml-explainer/evidence-desktop.png',fullPage:true});
 checks.push('Evidence view and all four downloadable assets');
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  for(const name of ['The walkthrough','The architecture','The evidence']){
   await view(name);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow at ${width}`);
  }
  await view('The walkthrough');
  for(const name of ['Source','Extract','Calibrate','Build','Record']){
   await stage(name);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow at ${width}`);
  }
 }
 checks.push('All sections and five stages fit 320, 390, 768 and 1440 px');
 await page.setViewportSize({width:390,height:844});await stage('Extract');
 await page.screenshot({path:'outputs/ml-explainer/extraction-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1080});
 await page.getByRole('button',{name:'Present',exact:true}).click();
 await page.waitForFunction(()=>Boolean(document.fullscreenElement));
 await page.getByRole('button',{name:'Exit full screen'}).click();
 await page.waitForFunction(()=>!document.fullscreenElement);
 checks.push('Full-screen presentation enters and exits');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 checks.push('No page errors; no application API writes');
 await writeFile('outputs/ml-explainer/verification.json',JSON.stringify({passed:true,checks},null,2));
 console.log(JSON.stringify({passed:true,checks},null,2));
} finally {await browser.close();}
