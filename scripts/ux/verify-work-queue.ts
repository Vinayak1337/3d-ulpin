import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {readWorkQueue} from '../../apps/web/lib/server/work-queue';
import {pool} from '../../apps/web/lib/server/db';
import {workItemAction} from '../../apps/web/lib/work-queue';
async function main(){
 const first=await readWorkQueue(new URL('http://local'));
 assert(first.total>20);assert.equal(first.items.length,20);
 const next=await readWorkQueue(new URL('http://local?page=2'));
 assert.equal(next.total,first.total);assert(!next.items.some(i=>first.items.some(j=>i.id===j.id&&i.kind===j.kind)));
 const saved=await readWorkQueue(new URL('http://local?q=b5b9b4e8-c06a-4aca-afec-c8d443b708e1'));
 assert.equal(saved.items.length,1);assert.equal(saved.items[0].currentRecorded,true);assert.equal(workItemAction(saved.items[0]).label,'Open recorded details');
 const source=await readWorkQueue(new URL('http://local?q=e0caa46d-5df6-4d86-853a-6097fec87b58'));
 assert.equal(source.items.length,1);assert.equal(source.items[0].areaId,'4c039f5f-c667-405a-962c-c317e6f32a8b');
 const draft=await readWorkQueue(new URL('http://local?q=b8a94f15-0875-4109-b3f3-b7c8b620ad6d'));
 assert.equal(draft.items.length,1);assert.equal(workItemAction(draft.items[0]).label,'Review boundaries');
 const history=await readWorkQueue(new URL('http://local?status=recorded'));assert(history.items.every(i=>i.recordedHistory));
 const literal=await readWorkQueue(new URL('http://local?q='+encodeURIComponent('%_')));assert.equal(literal.total,0);
 await assert.rejects(readWorkQueue(new URL('http://local?page=-1')));
 await mkdir('docs/evidence/t067',{recursive:true});await writeFile('docs/evidence/t067/queue-state.json',JSON.stringify({result:'PASS',total:first.total,checks:8,recorded:saved.items[0],source:source.items[0],draft:draft.items[0]},null,2)+'\n');
 console.log('PASS 8 queue checks: pagination, saved record, source-only area, GIS resume, history, literal search, invalid page');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool().end());
