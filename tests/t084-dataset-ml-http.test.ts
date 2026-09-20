import test from 'node:test';
import assert from 'node:assert/strict';
import {workItemAction,type WorkItem} from '../apps/web/lib/work-queue';
const base='http://127.0.0.1:3000/api/v1/spatial-datasets/22b196c2-b467-4f38-9252-5b4c5e3a2f14/ml';
const run=process.env.DATASET_HTTP_TESTS==='true';
test('saved dataset processing resumes at the ML workflow without a publication claim',()=>{
 const item={id:'dataset',kind:'dataset',jobStatus:'succeeded'} as WorkItem;
 assert.equal(workItemAction(item).href,'/studio/processing/dataset');assert.match(workItemAction(item).status,/needs review/);
 assert.equal(workItemAction({...item,jobStatus:'running'}).status,'Processing');assert.equal(workItemAction({...item,jobStatus:'failed'}).status,'Needs attention');
});
test('ML API bounds JSON, rejects foreign requests and scopes retained artifacts',{skip:!run},async()=>{
 assert.equal((await fetch(base,{method:'POST',body:'x'.repeat(100001)})).status,413);
 assert.equal((await fetch(base,{method:'POST',body:'{"invalid":true}'})).status,422);
 assert.equal((await fetch(base,{method:'POST',headers:{Origin:'https://foreign.example'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'?artifact=raster&run=not-a-uuid')).status,422);
 assert.equal((await fetch(base+'?artifact=raster&run=00000000-0000-4000-8000-000000000000')).status,404);
 const result=await fetch(base);assert.equal(result.status,200);const data=await result.json();assert.ok(data.runs.some((r:any)=>r.result?.receipt.actualInference));
 const queue=await (await fetch('http://127.0.0.1:3000/api/v1/work-queue')).json();assert.equal(queue.items.find((i:WorkItem)=>i.id===data.datasetId)?.jobStatus,'succeeded');
});
