import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {localRequest} from '../apps/web/lib/server/spatial-core-http';
import {workItemAction} from '../apps/web/lib/work-queue';
const base='http://127.0.0.1:3000/api/v1/spatial-datasets';
const run=process.env.DATASET_HTTP_TESTS==='true';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('saved dataset queue action preserves durable identity without claiming publication',()=>{
 const result=workItemAction({id:'dataset-id',kind:'dataset',name:'Example',areaId:null,areaName:null,dataKind:'demonstration',buildingId:null,sourceCount:5,updatedAt:'2026-09-21',state:'SAVED',jobStatus:null,recordedHistory:false});
 assert.equal(result.href,'/studio/showcase?saved=dataset-id');assert.equal(result.status,'Saved · needs review');
});
test('local API retains both source packages and replay creates no duplicates',{skip:!run},async()=>{
 const before=await (await fetch(base)).json();assert.ok(before.length>=2);
 for(const file of ['lake-view-complete.zip','provided-master.zip']){
  const bytes=await readFile('apps/web/public/reference/'+file);
  const prior=before.find((d:any)=>d.sha256===hash(bytes));assert.ok(prior);
  const response=await fetch(base,{method:'POST',headers:{'Origin':'http://127.0.0.1:3000','X-File-Name':file,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(response.status,201);
  const saved=await response.json();assert.equal(saved.id,prior.id);
  const original=await fetch(`${base}/${saved.id}?original=1`);assert.equal(original.status,200);assert.equal(hash(new Uint8Array(await original.arrayBuffer())),hash(bytes));
 }
 assert.equal((await (await fetch(base)).json()).length,before.length);
 const queue=await (await fetch('http://127.0.0.1:3000/api/v1/work-queue')).json();
 for(const dataset of before.filter((d:any)=>['lake-view-complete.zip','provided-master.zip'].includes(d.originalName)))assert.ok(queue.items.some((i:any)=>i.kind==='dataset'&&i.id===dataset.id));
});
test('invalid packages fail without rows and cross-origin requests are refused',{skip:!run},async()=>{
 const count=(await (await fetch(base)).json()).length;
 const invalid=await fetch(base,{method:'POST',headers:{'X-File-Name':'invalid.json'},body:'{"invalid":true}'});assert.equal(invalid.status,422);
 const foreign=await fetch(base,{headers:{Origin:'https://untrusted.example'}});assert.equal(foreign.status,403);
 assert.equal((await (await fetch(base)).json()).length,count);
 const missing=await fetch(`${base}/00000000-0000-4000-8000-000000000000`);assert.equal(missing.status,404);
});

test('same-origin loopback writes use the validated browser Host, preserving port and cross-site checks',()=>{
 const request=(origin:string,host='127.0.0.1:3000',site='same-origin')=>new Request('http://localhost:3000/api/v1/spatial-datasets',{headers:{host,origin,'sec-fetch-site':site}});
 assert.doesNotThrow(()=>localRequest(request('http://127.0.0.1:3000')));
 for(const req of [request('http://127.0.0.1:3001'),request('http://localhost:3000'),request('https://external.example'),request('http://127.0.0.1:3000','external.example'),request('http://127.0.0.1:3000','127.0.0.1:3000','cross-site')])assert.throws(()=>localRequest(req));
});
