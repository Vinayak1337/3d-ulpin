import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from '../spatial/browser-launch.mjs';
const base='http://127.0.0.1:3000',out='docs/evidence/t065';
const before=JSON.parse(await readFile(out+'/before.json','utf8'));
const state=JSON.parse(await readFile('docs/evidence/t061/workflow/state.json','utf8'));
await mkdir(out,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1000}}),report={checks:[],errors:[],writes:[]};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.url().startsWith(base+'/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))report.writes.push(new URL(r.url()).pathname);});
const get=async p=>{const r=await page.request.get(base+'/api/v1'+p);assert.equal(r.status(),200,p);return r.json();};
try {
 const continuation=await get('/import-packages/'+before.packageId+'/continuation');report.continuation=continuation;assert.equal(continuation.status,'recorded');pass('Persisted exact current model and recorded review restore continuation from server evidence');
 await page.goto(base+'/studio/cases/'+before.caseId+'?area='+state.preparation.areaId,{waitUntil:'networkidle'});
 await page.getByRole('tab',{name:'Build details',exact:true}).click();
 await page.getByRole('link',{name:/Open recorded details/}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Build proposed 3D details',exact:true}).count(),0);
 await page.screenshot({path:out+'/01-recorded-continuation.png'});pass('Recorded workspace offers its existing record instead of another build');
 await page.reload({waitUntil:'networkidle'});
 if(await page.getByRole('tab',{name:'Build details',exact:true}).getAttribute('aria-selected')!=='true')await page.getByRole('tab',{name:'Build details',exact:true}).click();
 await page.getByRole('link',{name:/Open recorded details/}).waitFor();pass('Reload restores the same onward action without any write');
 await page.setViewportSize({width:843,height:941});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/02-tablet-continuation.png'});pass('Focused review panel fits tablet width');
 await page.getByRole('link',{name:/Open recorded details/}).click();await page.waitForURL(url=>url.pathname.includes('/register'));await page.screenshot({path:out+'/03-onward-register.png'});pass('Onward action opens the existing canonical property register');
 const [detail,pkg]=await Promise.all([get('/cases/'+before.caseId),get('/import-packages/'+before.packageId)]);
 assert.equal(pkg.revision,before.packageRevision);assert.equal(detail.case.revision,before.caseRevision);assert.equal(detail.model.id,before.modelId);assert.deepEqual(detail.sources.map(s=>s.id),before.sourceIds);assert.deepEqual(detail.jobs.filter(j=>j.operation==='build').map(j=>({id:j.id,status:j.status,inputFingerprint:j.inputFingerprint})),before.builds);assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);pass('Package, model, original receipts and build jobs remain unchanged; zero API writes');report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e.stack);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
