import test from 'node:test';
import assert from 'node:assert/strict';
const dataset=process.env.T090_DATASET,base=process.env.T090_BASE??'http://127.0.0.1:3000';
test('saved assignment retries are stable; global floor search retains block and property context',{skip:!dataset},async()=>{
 const read=async(path:string)=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json();};
 const values=await Promise.all(Array.from({length:3},()=>read(`/api/v1/spatial-datasets/${dataset}?identifiers=1`)));
 assert.deepEqual(values[0],values[1]);assert.deepEqual(values[1],values[2]);assert.ok(values[0].length>0);
 const floor=values[0].find((r:any)=>r.floorId);assert.ok(floor);
 const search=await read('/api/v1/spatial-datasets/search?q='+encodeURIComponent(floor.identifier));
 const found=search.matches.find((r:any)=>r.identifier===floor.identifier);assert.equal(found.datasetId,dataset);assert.equal(found.buildingId,floor.buildingId);assert.equal(found.floorId,floor.floorId);
 const url=new URL(found.href,base);assert.equal(url.searchParams.get('saved'),dataset);assert.equal(url.searchParams.get('building'),floor.buildingId);assert.equal(url.searchParams.get('floor'),floor.floorId);
 const previous=await read('/api/v1/spatial-datasets/search?q='+encodeURIComponent(floor.aliases[0]));assert.ok(previous.matches.some((r:any)=>r.identifier===floor.identifier));
});
