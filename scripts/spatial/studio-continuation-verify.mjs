import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_BASE_URL||'http://127.0.0.1:3000';
const out='docs/evidence/t058/continuation/verification';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={startedAt:new Date().toISOString(),checks:[],unexpectedErrors:[],expectedFailures:[],backendWrites:0};let page;
const pass=(name,detail={})=>{report.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
const url=path=>base+'/studio/'+path;
try{
 const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1,acceptDownloads:true});
 page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>report.unexpectedErrors.push(e.message));
 await page.goto(url('map/BLD-0413'),{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.__CITY_DEBUG__?.controlConnected,{},{timeout:120000});await page.waitForTimeout(1700);
 const oldPicture=await page.locator('.ins-preview img').getAttribute('src');assert(oldPicture);
 await page.locator('.property-row').nth(1).click();
 const immediatePicture=await page.locator('.ins-preview img').count()?await page.locator('.ins-preview img').getAttribute('src'):null;
 assert.notEqual(immediatePicture,oldPicture);pass('Property changes never reuse the previous property thumbnail');
 await page.goto(url('map/BLD-0413?tab=floors&floor=1'));await page.waitForSelector('.ins-floor.active');
 const count=await page.evaluate(()=>history.length);
 await page.getByRole('button',{name:'Close inspector',exact:true}).click();
 assert.equal(await page.evaluate(()=>history.length),count+1);
 await page.goBack();await page.waitForSelector('.ins-floor.active');assert.match(page.url(),/floor=1/);assert.equal(await page.getByRole('heading',{name:'That record is unavailable'}).count(),0);
 pass('Close inspector is one atomic history entry and Back returns to the valid selected floor');

 await page.getByRole('button',{name:'Full register',exact:true}).click();await page.waitForSelector('.register-selection');
 const defaultUnit=await page.locator('.register-selection').getAttribute('data-selected-unit');
 await page.locator('.register-unit-row[data-unit-id="BLD-0413/F3/U2"]').click();assert.equal(await page.locator('.register-selection').getAttribute('data-selected-unit'),'BLD-0413/F3/U2');
 await page.goBack();await page.waitForFunction(expected=>document.querySelector('.register-selection')?.getAttribute('data-selected-unit')===expected,defaultUnit);
 pass('Register history restores both the route and its actual selected unit');
 await page.locator('.register-unit-row[data-unit-id="BLD-0413/F3/U2"]').click();
 await page.getByRole('button',{name:'View in map',exact:true}).click();
 await page.waitForFunction(()=>window.__CITY_DEBUG__?.selected==='BLD-0413'&&Math.abs(window.__CITY_DEBUG__.target[1]-11.2)<.15);
 assert.match(page.url(),/floor=3/);pass('View in map executes the new focus command at the selected floor elevation');


 await page.goto(url('workspace/BLD-0413?floor=0&doc=plan&unit=BLD-0413%2FF0%2FU2'));
 await page.getByRole('button',{name:'Save draft',exact:true}).first().waitFor();
 await page.waitForFunction(()=>!document.querySelector('.spw-actions button')?.disabled);
 await page.getByLabel('Review notes').fill('Ground floor note retained independently');
 await page.getByRole('button',{name:'Distance',exact:true}).click();
 const point=async(x,z)=>{
  const p=await page.locator('.spw-plan-stage>div:first-child>svg').evaluate((svg,[x,z])=>{const scale=298/18,left=(600-16*scale)/2,m=svg.getScreenCTM(),p=new DOMPoint(left+(x+8)*scale,64+(z+9)*scale).matrixTransform(m);return {x:p.x,y:p.y};},[x,z]);await page.mouse.click(p.x,p.y);
 };
 await point(-4,1);await point(-1,5);
 const groundMeasure=await page.locator('[data-workspace-measurement]').textContent();assert(Math.abs(parseFloat(groundMeasure)-5)<.04);
 await page.getByRole('button',{name:'Save draft',exact:true}).first().click();await page.getByText(/Local draft revision 1 saved/).waitFor();
 await page.getByRole('button',{name:'Next floor',exact:true}).click();assert.equal(await page.getByLabel('Review notes').inputValue(),'');assert.equal(await page.locator('[data-workspace-measurement]').count(),0);
 await page.getByLabel('Review notes').fill('First floor note is different');await page.getByRole('button',{name:'Save draft',exact:true}).first().click();await page.getByText(/Local draft revision 1 saved/).waitFor();
 await page.getByRole('button',{name:'Previous floor',exact:true}).click();assert.equal(await page.getByLabel('Review notes').inputValue(),'Ground floor note retained independently');assert.equal(await page.locator('[data-workspace-measurement]').textContent(),groundMeasure);
 assert.match(page.url(),/unit=BLD-0413%2FF0%2FU2/);
 await page.reload();await page.getByLabel('Review notes').waitFor();await page.waitForFunction(()=>document.querySelector('.spw-notes textarea')?.value==='Ground floor note retained independently');assert.equal(await page.locator('[data-workspace-measurement]').textContent(),groundMeasure);
 assert.equal(await page.locator('.studio-plan-workspace').evaluate(el=>getComputedStyle(el).position),'fixed');
 const floors=await page.evaluate(()=>[0,1].map(f=>JSON.parse(localStorage.getItem(`ulpin:studio-local-draft:v2:BLD-0413:F${f}`))));
 assert(floors.every(d=>d.revision===1));assert.notEqual(floors[0].notes,floors[1].notes);
 pass('Floor-local notes, measurements, unit association and revisions survive revisits and reload');

 await page.getByRole('button',{name:'Area',exact:true}).click();await point(-5,-5);await point(5,5);await point(-5,5);await point(5,-5);
 await page.getByRole('button',{name:'Queue for review',exact:true}).click();await page.getByText(/boundary crosses|repeats itself/).first().waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ulpin:studio-local-draft:v2:BLD-0413:F0')).revision),1);
 await page.keyboard.press('Control+q');assert.equal(await page.locator('[data-workspace-measurement]').count(),0);assert(page.url().includes('/workspace/'));
 assert.equal(await page.getByLabel('Review notes').inputValue(),'Ground floor note retained independently');
 pass('Crossed measurement cannot enter review; Control-Q clears only the drawing and retains notes');

 await page.route('**/api/v1/studio/sources/assets/records',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"deliberate verification outage"}'}));
 await page.getByRole('button',{name:'Check source',exact:true}).click();await page.getByText(/Original source verification failed \(503\)/).waitFor();
 assert.equal(await page.getByText('Source checksum verified',{exact:true}).count(),0);
 report.expectedFailures.push({kind:'source-unavailable',status:503,handled:true});
 await page.unroute('**/api/v1/studio/sources/assets/records');
 const requested=page.waitForResponse(r=>r.url().endsWith('/api/v1/studio/sources/assets/records')&&r.status()===200);
 await page.getByRole('button',{name:'Check source',exact:true}).click();await requested;await page.getByText(/Source verified: 5 floors, 10 units and 18 documents/).waitFor();
 await page.getByRole('button',{name:'Queue for review',exact:true}).click();await page.getByText(/Added to the local review queue/).waitFor();
 pass('Check source reads and validates the original bytes, reports failures and succeeds only after recovery');

 await page.getByRole('button',{name:'Back to map',exact:true}).click();await page.waitForSelector('.map-viewport canvas');await page.waitForTimeout(1200);
 await page.getByRole('button',{name:'Export',exact:true}).click();
 for(let i=0;i<14;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))));}
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:/Current map as PNG/}).click();const download=await downloadPromise;const file=out+'/actual-map-export.png';await download.saveAs(file);const png=await readFile(file);assert.equal(png.subarray(1,4).toString(),'PNG');assert(png.readUInt32BE(16)>300&&png.readUInt32BE(20)>300&&png.length>30000);
 await page.keyboard.press('Escape');await page.waitForSelector('.export-dialog',{state:'detached'});
 pass('Export is a nonempty actual rendered PNG and modal keyboard focus stays contained');

 const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const mobile=await phone.newPage();mobile.on('pageerror',e=>report.unexpectedErrors.push(e.message));await mobile.goto(url('map/BLD-0413'));await mobile.waitForFunction(()=>window.__CITY_DEBUG__?.controlConnected,{},{timeout:120000});await mobile.waitForTimeout(1400);
 const client=await phone.newCDPSession(mobile),box=await mobile.locator('.map-viewport canvas').boundingBox();
 const start={x:box.x+120,y:box.y+350},end={x:start.x+44,y:start.y+35};
 const before=await mobile.evaluate(()=>window.__CITY_DEBUG__);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,radiusX:3,radiusY:3}]});
 await mobile.waitForTimeout(650);
 for(let i=1;i<=8;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8,id:1,radiusX:3,radiusY:3}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await mobile.waitForTimeout(350);
 const after=await mobile.evaluate(()=>window.__CITY_DEBUG__);assert(Math.hypot(...after.target.map((v,i)=>v-before.target[i]))>.2);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:2,radiusX:3,radiusY:3}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x-50,y:start.y+25,id:2,radiusX:3,radiusY:3}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(350);
 const recovered=await mobile.evaluate(()=>window.__CITY_DEBUG__);assert(Math.hypot(...recovered.target.map((v,i)=>v-after.target[i]))>.2);
 await mobile.screenshot({path:out+'/touch-recovery.png'});await phone.close();
 pass('Browser-emulated held touch pan and cancellation recover on the real canvas');

 const failure=await browser.newContext({viewport:{width:1280,height:800}}),broken=await failure.newPage();
 await broken.route('**/studio-materials/daylight.hdr',route=>route.fulfill({status:503,body:'deliberately unavailable'}));
 await broken.goto(url('map/BLD-0413'));await broken.getByRole('heading',{name:'3D view is unavailable'}).waitFor({timeout:120000});
 assert.equal(await broken.getByTestId('selected-ulpin').textContent(),'11007500003527');
 await broken.screenshot({path:out+'/handled-render-resource-failure.png'});
 report.expectedFailures.push({kind:'render-resource-unavailable',status:503,handled:true,propertyRetained:true});
 await broken.unroute('**/studio-materials/daylight.hdr');await broken.getByRole('button',{name:'Reload current view',exact:true}).click();await broken.waitForFunction(()=>window.__CITY_DEBUG__?.controlConnected,{},{timeout:120000});assert(broken.url().endsWith('/studio/map/BLD-0413'));await failure.close();
 pass('Failed 3D resource exposes a recoverable error without inventing a map or changing property identity');
 assert.deepEqual(report.unexpectedErrors,[]);report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack??String(error);console.error(report.error);if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();report.finishedAt=new Date().toISOString();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
