import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from '../spatial/browser-launch.mjs';
const base=process.env.STUDIO_BASE_URL||'http://127.0.0.1:3000',out='docs/evidence/t063';
await mkdir(out,{recursive:true});
const browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1440,height:900}});
const report={checks:[],errors:[],writes:[]};const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.url().startsWith(base+'/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))report.writes.push({method:r.method(),url:new URL(r.url()).pathname});});
try {
 await page.goto(base+'/',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Saved blocks',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/studio/datasets');
 assert.equal(await page.getByText('Coming soon',{exact:true}).count(),0);
 await page.screenshot({path:out+'/saved-blocks.png'});pass('Root starts with saved blocks and no unfinished location controls');
 const search=page.getByRole('textbox',{name:'Find a block',exact:true});
 await search.fill('no-such-ux-qualification-block');
 await page.screenshot({path:out+'/block-search-empty.png'});
 assert.equal(await page.locator('a[href^="/studio/areas/"]').count(),0);
 await search.fill('');pass('Block search filters results without changing saved records');
 await page.getByRole('navigation',{name:'Product sections'}).getByRole('link',{name:'Plan Workspace',exact:true}).click();
 await page.getByRole('heading',{name:'Plan Workspace',exact:true}).waitFor();
 const ws=page.getByRole('textbox',{name:'Find a workspace',exact:true});await ws.fill('T061 synthetic ML verification');
 await page.locator('a[href*="/studio/cases/b5b9b4e8-c06a-4aca-afec-c8d443b708e1"]').waitFor();
 await page.screenshot({path:out+'/workspace-search.png'});pass('Saved workspaces can be found by name');
 await ws.fill('');await page.getByLabel('Workspace status',{exact:true}).selectOption({label:'Awaiting property assignment'});
 await page.screenshot({path:out+'/workspace-status.png'});pass('Workspace assignment filter is available');
 const params='?source=source-check&page=2&floor=F1&unit=U1&area=area-check&tag=a&tag=b';
 for(const path of ['/blocks','/register','/workspace','/delhi','/v2/blocks','/legacy/workspace']) {
  await page.goto(base+path+params,{waitUntil:'networkidle'});
  await page.waitForURL(url=>url.pathname.startsWith('/studio/'));
  const url=new URL(page.url());assert(url.pathname.startsWith('/studio/'),path+' should terminate at Studio');
  for(const [key,value]of new URLSearchParams(params)) assert(url.searchParams.getAll(key).includes(value),path+' lost '+key);
 }
 pass('Old directory and historical aliases terminate in Studio and preserve repeated context');
 await page.setViewportSize({width:843,height:941});await page.goto(base+'/studio/workspaces',{waitUntil:'networkidle'});await page.getByRole('textbox',{name:'Find a workspace',exact:true}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/workspaces-tablet.png'});pass('Workspace directory fits tablet width');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e.stack);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
