import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';

const hardware=process.env.SPATIAL_HARDWARE==='1';
const base='http://127.0.0.1:3000',output=hardware?'.runtime/neighbourhood-hardware-qa':'.runtime/neighbourhood-qa';
await mkdir(output,{recursive:true});
const report={kind:'actual-shared-neighbourhood-browser',startedAt:new Date().toISOString(),device:hardware?'Installed Chrome with its reported graphics backend; mobile remains viewport emulation':'Chromium software WebGL, desktop and mobile emulation; not a physical GPU benchmark',checks:[],errors:[],badResponses:[],geometryRequests:[],injectedResponses:[]};
let server,browser,page;
const pass=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS '+name);};
async function ready(){await page.waitForFunction(()=>{const node=document.querySelector('[data-tile-canvas]');return node?.getAttribute('data-scene-ready')==='true'&&Number(node.getAttribute('data-loaded-tiles'))>0;},{},{timeout:120000});await page.waitForTimeout(1100);}
async function capture(name){await page.screenshot({path:`${output}/${name}.png`,fullPage:false});}
async function selected(){return page.locator('.lab-inspector').getAttribute('data-selected-entity');}
try{
  if(process.env.SPATIAL_START_SERVER==='1'){
    let occupied=false;try{await fetch(base+'/map-lab',{signal:AbortSignal.timeout(700)});occupied=true;}catch{}
    assert(!occupied,'An existing server owns the verification port');
    server=spawn(process.execPath,['apps/web/node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','3000'],{env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore',windowsHide:true});
    for(let i=0;i<60;i++){assert(server.exitCode===null,'Owned server exited');try{if((await fetch(base+'/map-lab',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
  }
  browser=await chromium.launch(hardware?{channel:'chrome',headless:false}:{headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1});
  page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.errors.push(error.message));
  let injectedPath=null;
  page.on('response',response=>{if(response.url().startsWith(base)&&response.status()>=400){const failure={url:new URL(response.url()).pathname,status:response.status()};if(failure.url===injectedPath&&failure.status===503)report.injectedResponses.push(failure);else report.badResponses.push(failure);}});
  page.on('request',request=>{const url=new URL(request.url());if(url.origin===base&&url.pathname.endsWith('.glb')&&report.geometryRequests.length<200)report.geometryRequests.push(url.pathname);});
  await page.goto(base+'/map-lab',{waitUntil:'domcontentloaded'});await ready();await capture('01-garden-complete');
  report.graphics=await page.locator('[data-tile-canvas] canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2')??canvas.getContext('webgl');if(!gl)return null;const info=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:info?gl.getParameter(info.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION)};});
  assert.equal(await page.locator('[data-tile-canvas]').getAttribute('data-shadow-profile'),'metre-neighbourhood-bias-v1');
  assert.equal(await page.locator('[data-map-runtime-id]').count(),1);
  await page.getByRole('button',{name:'Toggle shadows',exact:true}).click();await page.waitForTimeout(1200);await capture('02-garden-without-shadows');
  await page.getByRole('button',{name:'Toggle shadows',exact:true}).click();
  await page.getByRole('button',{name:'Focus object',exact:true}).click();await ready();
  const first=await selected(),box=await page.locator('[data-tile-canvas]').boundingBox();
  const label=page.locator('[data-selection-screen-x]');await label.waitFor();
  const x=Number(await label.getAttribute('data-selection-screen-x')),y=Number(await label.getAttribute('data-selection-screen-y'));
  report.pickProbe={expectedEntity:first,canvas:{x:box.x,y:box.y,width:box.width,height:box.height},projectedRoof:{x,y}};
  await page.locator('[data-building-id]').nth(1).click();assert.notEqual(await selected(),first);
  await page.mouse.click(box.x+x,box.y+y);await page.waitForFunction(expected=>document.querySelector('.lab-inspector')?.getAttribute('data-selected-entity')===expected,first);
  pass('Actual canvas feature picking resolves the canonical property, not just list selection',{selected:first});await capture('03-building-close');
  await page.getByRole('button',{name:'Reverse view',exact:true}).click();await ready();await capture('04-reverse-view');
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('button',{name:'Fit scene',exact:true}).click();await ready();await capture('05-top-down');
  const camera=JSON.parse(await page.locator('[data-tile-canvas]').getAttribute('data-camera'));assert(Math.abs(camera.pitch+Math.PI/2)<.01);pass('2D and fit preserve the top-down state');
  await page.getByRole('button',{name:'3D',exact:true}).click();await page.selectOption('#lab-dataset','dense');await ready();await capture('06-dense-neighbourhood');
  assert.equal(await page.locator('[data-building-id]').count(),120);pass('Dense input reuses the same scene compiler and one viewport');

  if(process.env.REPO_DATA==='true'||process.env.SPATIAL_TEST_SAVED==='1'){
    const area='457bac4c-1c6c-4157-a12a-1d44ba3c1bcf';
    const descriptor=await context.request.get(`${base}/api/v1/spatial/core/areas/${area}/scene/synthetic/descriptor.json`);assert.equal(descriptor.status(),200,await descriptor.text());const view=await descriptor.json();
    await page.goto(`${base}/map-lab?area=${area}&world=synthetic`,{waitUntil:'domcontentloaded'});await ready();await capture('07-uttam-nagar-normalized');
    assert.equal(await page.locator('[data-source-kind]').getAttribute('data-source-kind'),'normalized-records');
    const savedId=await selected(),item=view.items.find(i=>i.id===savedId);assert(item);
    const currentArea=await page.locator('[data-horizontal-area]').getAttribute('data-horizontal-area');assert.equal(currentArea,item.horizontalArea==null?'':String(item.horizontalArea));
    const canvas=page.locator('[data-tile-canvas] canvas');await canvas.evaluate(node=>node.dataset.qaContinuity='original');
    await page.getByRole('tab',{name:'Sources',exact:true}).click();await page.getByText('Normalized saved records',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'Building',exact:true}).click();await page.getByText('Interior placement not supplied',{exact:true}).waitFor();
    assert.equal(await canvas.getAttribute('data-qa-continuity'),'original');assert.equal(await selected(),savedId);
    pass('Saved Uttam Nagar data uses the normalized bridge, analytical quantities and same mounted canvas',{readDigest:view.readDigest,features:view.items.length,buildings:view.items.filter(i=>i.kind==='building').length});
    await page.getByRole('tab',{name:'Map',exact:true}).click();await page.getByRole('button',{name:'Focus object',exact:true}).click();await ready();await capture('08-uttam-nagar-inspection');
    assert(view.attributions.includes('google')&&view.attributions.includes('osm'));
    await page.locator('.lab-attribution a').filter({hasText:'OpenStreetMap'}).waitFor({state:'visible'});
    injectedPath=`/api/v1/spatial/core/areas/${area}/scene/synthetic/descriptor.json`;
    const matcher=base+injectedPath;
    await page.route(matcher,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'QA_INJECTED',message:'Controlled refresh failure'}})}));
    await page.getByRole('button',{name:'Refresh saved scene',exact:true}).click();
    await page.getByText('Could not refresh. The previous scene is retained.',{exact:false}).waitFor();
    assert.equal(await canvas.getAttribute('data-qa-continuity'),'original');assert.equal(await selected(),savedId);
    assert.equal(report.injectedResponses.length,1);
    await page.unroute(matcher);injectedPath=null;
    await page.locator('.lab-refresh-error').getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.lab-refresh-error').waitFor({state:'detached'});
    assert.equal(await canvas.getAttribute('data-qa-continuity'),'original');
    pass('A controlled refresh failure retains the prior scene and identity; retry recovers without replacing the canvas');
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1300);await capture('09-mobile-map');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('button',{name:'Open layers and properties',exact:true}).click();await page.getByRole('tab',{name:'Map',exact:true}).click();
  await page.getByRole('textbox',{name:'Find in scene',exact:true}).fill('no-match-qa');await page.getByText('No property matches this search.',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Find in scene',exact:true}).fill('');await capture('10-mobile-layers');await page.keyboard.press('Escape');
  await page.locator('.lab-inspector-toggle').click();await page.getByRole('complementary',{name:'Selected property',exact:true}).waitFor({state:'visible'});await capture('11-mobile-inspector');
  await page.getByRole('button',{name:'Close property details',exact:true}).click();
  assert.equal(await page.locator('[data-map-runtime-id]').count(),1);pass('390px layout exposes both layers and property inspector without overflow or a second map');
  assert(report.geometryRequests.length>0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);pass('Actual GLBs loaded with no uncaught browser errors or failed local assets');
  report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack||String(error);console.error(report.error);process.exitCode=1;if(page)await capture('failure').catch(()=>{});}
finally{await browser?.close();server?.kill();report.finishedAt=new Date().toISOString();await writeFile(`${output}/results.json`,JSON.stringify(report,null,2));}
