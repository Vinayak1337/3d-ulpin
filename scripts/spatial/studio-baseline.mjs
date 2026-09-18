import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='docs/evidence/t058/baseline';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1672,height:941},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5175',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__CITY_DEBUG__?.controlConnected,{},{timeout:90000});
 await page.waitForTimeout(5000);await page.screenshot({path:out+'/studio-map.png'});
 await page.getByRole('button',{name:'Open register',exact:true}).click();
 await page.waitForTimeout(3000);await page.screenshot({path:out+'/studio-register.png'});
 await page.getByRole('button',{name:'Back to map',exact:false}).click();
 await page.getByRole('button',{name:'Utilities',exact:true}).click();
 await page.waitForTimeout(2000);await page.screenshot({path:out+'/studio-utilities.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1200);await page.screenshot({path:out+'/studio-mobile.png'});
 const source=['App.tsx','styles.css','refinements.css','scene/CityScene.tsx','scene/architecture.ts','data/district.ts'];
 const files=[];for(const name of source){const b=await readFile('E:/Projects/ulpin-city-studio/src/'+name);files.push({path:name,sha256:createHash('sha256').update(b).digest('hex')});}
 await writeFile(out+'/receipt.json',JSON.stringify({capturedAt:new Date().toISOString(),source:'E:/Projects/ulpin-city-studio',viewport:{width:1672,height:941},errors,files},null,2)+'\n');
 console.log(JSON.stringify({captured:4,errors,out}));
}finally{await browser.close();}
