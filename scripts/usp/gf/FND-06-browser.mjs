import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require=createRequire(resolve('apps/web/package.json'));
const {chromium}=require('playwright');
const root=process.env.ULPIN_TEST_URL, output=process.env.ULPIN_FND06_OUTPUT;
assert.equal(root,'http://127.0.0.1:3108');assert(output);
await mkdir(resolve(output,'screenshots'),{recursive:true});
const report={schemaVersion:'fnd06-http-browser/1',checks:[],browserExternalDenied:0};
function http(path,host,headers={}) {
  return new Promise((done,fail)=>{
    const req=request(`${root}${path}`,{headers:{Host:host,...headers}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>done({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',fail);req.setTimeout(60000,()=>req.destroy(new Error('Request timeout')));req.end();
  });
}
const routes=['/studio/workspaces','/api/v1/workspace-capabilities','/api/v1/health','/cesium/Widgets/widgets.css','/_next/image?url=%2Ffavicon.ico&w=64&q=75'];
for (const path of routes) {
  for (const host of ['forged.invalid:3108','localhost.evil:3108','localhost:3108@evil','127.1:3108','localhost:3000']) {
    const response=await http(path,host,{'X-Forwarded-Host':'localhost:3108','X-Forwarded-For':'127.0.0.1','Origin':root});
    assert.equal(response.status,403);assert.equal(response.body,'Forbidden host.');
  }
  report.checks.push({name:'forged-host-before-content',path,denied:5});
}
for(const host of ['localhost:3108','127.0.0.1:3108','[::1]:3108']) {
  const response=await http('/api/v1/workspace-capabilities',host,{'X-Forwarded-Host':'forged.invalid'});
  assert.equal(response.status,200);const body=JSON.parse(response.body);
  assert.equal(body.provider,'blocked');assert.equal(body.fullResidency,'unverified');assert.equal(body.runtime,'loopback-configured');
}
report.checks.push({name:'canonical-loopback-authorities',accepted:3});
const status=await http('/api/v1/ai/status','localhost:3108');assert.equal(status.status,200);
assert.equal(JSON.parse(status.body).configured,false);assert.equal(JSON.parse(status.body).capabilities.image,false);
report.checks.push({name:'no-key-provider-status-blocked'});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark'});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){report.browserExternalDenied++;await route.abort();}
    else await route.continue();
  });
  await page.goto(`${root}/studio/workspaces`,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Local workspace status'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByText('Non-India AI access is blocked. Native preparation remains available.').waitFor();
  assert(!(await dialog.innerText()).includes('Your evidence stays here'));
  assert.equal(await page.locator('[data-ui-shell]').getAttribute('data-theme'),'light');
  const screenshot=resolve(output,'screenshots','workspace-processing-status.png');
  await page.screenshot({path:screenshot});
  // Browser zoom-equivalent CSS viewport reduction retains desktop keyboard access.
  await page.setViewportSize({width:720,height:500});
  await page.screenshot({path:resolve(output,'screenshots','workspace-processing-200-percent.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  report.checks.push({name:'active-shell-truthful-status-light-only-and-keyboard-close',screenshot});
  const staticPath=await page.locator('script[src*="/_next/static/"]').first().getAttribute('src');
  assert(staticPath);
  assert.equal((await http(staticPath,'forged.invalid:3108')).status,403);
  assert.equal((await http(staticPath,'localhost:3108')).status,200);
  report.checks.push({name:'compiled-next-static-host-protection'});
  assert.equal(report.browserExternalDenied,0);
} finally {await browser.close();await writeFile(resolve(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
