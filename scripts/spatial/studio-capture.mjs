import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const output=process.env.STUDIO_CAPTURE_DIR||'.runtime/studio-qa/current';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={capturedAt:new Date().toISOString(),viewport:{width:1672,height:941},errors:[],failed:[],images:[]};
try{
 const page=await browser.newPage({viewport:result.viewport,deviceScaleFactor:1});page.setDefaultTimeout(60000);
 page.on('pageerror',e=>result.errors.push(e.message));
 page.on('response',r=>{if(r.url().startsWith('http://127.0.0.1:3000')&&r.status()>=400)result.failed.push({url:new URL(r.url()).pathname,status:r.status()});});
 const shot=async(name)=>{await page.waitForTimeout(2500);await page.screenshot({path:output+'/'+name+'.png'});result.images.push(name);};
 await page.goto('http://127.0.0.1:3000/studio/map/BLD-0413',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.__CITY_DEBUG__?.controlConnected,{},{timeout:120000});await shot('map');
 result.graphics=await page.locator('canvas[data-studio-canvas]').evaluate(c=>{const gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};});
 await page.getByRole('button',{name:'Open register',exact:true}).click();await page.waitForSelector('.register-overview');await shot('register');
 await page.getByRole('button',{name:'Back to map',exact:false}).click();await page.waitForSelector('.map-viewport canvas');
 await page.getByRole('button',{name:'Open workspace',exact:true}).click();await page.waitForSelector('.studio-plan-workspace');await page.getByText('Source integrity',{exact:true}).waitFor();await shot('workspace');
 await page.getByRole('button',{name:'Back to map',exact:true}).click();await page.getByRole('button',{name:'Utilities',exact:true}).click();await shot('utilities');
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('complementary',{name:'Property inspector'}).getByRole('button',{name:'Focus selected building',exact:true}).click();await shot('building-close');
 await page.getByRole('button',{name:'2D',exact:true}).click();await shot('top-down');
 await page.getByRole('button',{name:'3D',exact:true}).click();await page.getByRole('button',{name:'Fit block',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1200);await shot('mobile-map');
 await page.getByRole('button',{name:'Expand property details',exact:true}).click();await shot('mobile-inspector');
 result.result=result.errors.length||result.failed.length?'FAIL':'PASS';
}catch(error){result.result='FAIL';result.error=String(error);console.error(error);process.exitCode=1;}finally{await browser.close();await writeFile(output+'/capture.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
