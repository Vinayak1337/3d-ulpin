import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from '../spatial/browser-launch.mjs';
const out='docs/evidence/t062'; await mkdir(out,{recursive:true});
const browser=await launchBrowser(); const page=await browser.newPage({viewport:{width:1440,height:900}});
const routes=[['start','/studio'],['blocks','/studio/datasets'],['workspaces','/studio/workspaces'],['preparation','/studio/cases/b5b9b4e8-c06a-4aca-afec-c8d443b708e1?area=4c039f5f-c667-405a-962c-c317e6f32a8b'],['register','/studio/properties/1e6c6e44-15ee-4c41-b6bd-067e59151b47/register?area=4c039f5f-c667-405a-962c-c317e6f32a8b']];
const report=[];
try{for(const [name,route] of routes){await page.goto('http://127.0.0.1:3000'+route,{waitUntil:'networkidle',timeout:90000});if(name==='preparation')await page.getByRole('tab',{name:'Build details',exact:true}).click();await page.screenshot({path:out+'/'+name+'-before.png'});report.push({name,route,title:await page.title(),headings:await page.locator('h1,h2').allTextContents()});console.log('Captured '+name);}}finally{await browser.close();await writeFile(out+'/baseline.json',JSON.stringify(report,null,2)+'\n');}
